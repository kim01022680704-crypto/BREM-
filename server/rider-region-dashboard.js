const { getServiceClient } = require('./admin-bootstrap');
const { getRiderMe } = require('./rider-auth');
const { computeSlotTargets, SLOT_LABELS } = require('./baemin-quota');
const { readWeekdayQuotaMatrix } = require('./baemin-weekday-quota');
const { readPartnerSetCountMap, normalizeSetCount } = require('./baemin-partner-set-count');

const EXPOSURE_KEY = 'brem_rider_dashboard_region_exposure_v1';

/** KST 기준 현재 배민 시간대 (아침점심/오후/저녁/심야) */
function currentBaeminSlotKey(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    hour12: false
  }).format(now));
  if (hour >= 7 && hour < 14) return 'morning';
  if (hour >= 14 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'midnight';
}

function isDrivingStatus(statusDesc) {
  const compact = String(statusDesc || '').replace(/\s+/g, '');
  if (!compact) return false;
  if (compact.includes('운행종료') || compact.includes('운행중지') || compact.includes('운행불가')) return false;
  return compact.includes('운행중');
}

function formatLocalDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function normalizeSettlementWeekStart(dateValue) {
  const seed = String(dateValue || '').trim().slice(0, 10);
  const base = seed || formatLocalDateKey(new Date());
  const date = new Date(`${base}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const diff = (date.getDay() - 3 + 7) % 7;
  date.setDate(date.getDate() - diff);
  return formatLocalDateKey(date);
}

function settlementWeekEnd(weekStart) {
  const start = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(start.getTime())) return '';
  start.setDate(start.getDate() + 6);
  return formatLocalDateKey(start);
}

function normalizePlatform(value) {
  return String(value || '').toLowerCase() === 'coupang' ? 'coupang' : 'baemin';
}

function maskName(name, mask = true) {
  const text = String(name || '').trim();
  if (!text) return '-';
  if (!mask) return text;
  if (text.length === 1) return text;
  if (text.length === 2) return `${text[0]}*`;
  return `${text[0]}${'*'.repeat(Math.min(2, text.length - 2))}${text[text.length - 1]}`;
}

function shortCoupangRegion(value) {
  return String(value || '').replace(/\s/g, '').slice(0, 4);
}

function normalizeBaeminUserId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d+)\.0+$/);
  return m ? m[1] : raw;
}

function baeminIdMatchKey(value) {
  const v = normalizeBaeminUserId(value).replace(/\s+/g, '');
  if (!v) return '';
  return /^\d+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v.toLowerCase();
}

function normalizePersonName(value) {
  return String(value || '').replace(/\s+/g, '').trim().toLowerCase();
}

/** 지역에 등록된 기사 인덱스 (배민ID → rider, 이름 → rider) */
function indexRegionRiders(riders = []) {
  const byBaeminId = new Map();
  const byName = new Map();
  riders.forEach(rider => {
    const idKey = baeminIdMatchKey(rider.baeminId || rider.raw_data?.baeminId);
    if (idKey) byBaeminId.set(idKey, rider);
    const nameKey = normalizePersonName(rider.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, rider);
  });
  return { byBaeminId, byName };
}

function matchRegionRider(indexes, parsed = {}) {
  if (!indexes) return null;
  const crawlId = baeminIdMatchKey(
    parsed.userId || parsed.riderId || parsed.rider_user_id || parsed.baeminId || ''
  );
  if (crawlId && indexes.byBaeminId.has(crawlId)) {
    return indexes.byBaeminId.get(crawlId);
  }
  const nameKey = normalizePersonName(
    parsed.riderName || parsed.rider_name || parsed.name || ''
  );
  if (nameKey && indexes.byName.has(nameKey)) {
    return indexes.byName.get(nameKey);
  }
  return null;
}

async function readExposureMap(supabase) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', EXPOSURE_KEY)
    .maybeSingle();
  if (error) throw error;
  const value = data?.value && typeof data.value === 'object' ? data.value : {};
  return {
    baemin: value.baemin && typeof value.baemin === 'object' ? value.baemin : {},
    coupang: value.coupang && typeof value.coupang === 'object' ? value.coupang : {}
  };
}

function listExposedRegions(exposure, platform) {
  const side = exposure[platform] || {};
  return Object.entries(side)
    .filter(([, meta]) => meta && meta.exposed !== false && meta.exposed !== 0)
    .map(([key, meta]) => ({
      key,
      platform,
      label: String(meta.label || key).trim() || key,
      partnerId: String(meta.partnerId || '').trim(),
      vendorId: String(meta.vendorId || '').trim()
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}

function riderMatchesRegion(rider, region) {
  if (!rider || !region) return false;
  if (region.platform === 'baemin') {
    const value = String(rider.regionBaemin || rider.raw_data?.regionBaemin || '').trim();
    if (!value) return false;
    return value === region.label
      || value === region.partnerId
      || value === region.key
      || (region.partnerId && value.includes(region.partnerId));
  }
  const value = String(rider.regionCoupang || rider.raw_data?.regionCoupang || '').trim();
  if (!value) return false;
  return shortCoupangRegion(value) === shortCoupangRegion(region.key)
    || shortCoupangRegion(value) === shortCoupangRegion(region.label)
    || value === region.vendorId;
}

async function loadRidersForRegion(supabase, region) {
  const { data, error } = await supabase
    .from('riders')
    .select('id,name,baemin_id,raw_data,status')
    .limit(5000);
  if (error) throw error;
  return (data || [])
    .map(row => ({
      id: row.id,
      name: row.name || '',
      baeminId: row.baemin_id || '',
      regionBaemin: String(row.raw_data?.regionBaemin || '').trim(),
      regionCoupang: String(row.raw_data?.regionCoupang || '').trim(),
      raw_data: row.raw_data || {},
      status: row.status || ''
    }))
    .filter(rider => riderMatchesRegion(rider, region));
}

async function buildWeeklyRanking(supabase, region, weekStart, weekEnd, options = {}) {
  const mask = options.maskNames !== false;
  const riders = await loadRidersForRegion(supabase, region);
  if (!riders.length) return [];
  const riderIds = riders.map(r => r.id);
  // PostgREST .in() URL 한도 대비 청크
  const totals = new Map();
  for (let i = 0; i < riderIds.length; i += 80) {
    const chunk = riderIds.slice(i, i + 80);
    const { data, error } = await supabase
      .from('admin_calls')
      .select('driver_id,date,platform,count')
      .in('driver_id', chunk)
      .eq('platform', region.platform)
      .gte('date', weekStart)
      .lte('date', weekEnd);
    if (error) throw error;
    (data || []).forEach(row => {
      const id = String(row.driver_id || '');
      if (!id) return;
      totals.set(id, (totals.get(id) || 0) + Math.max(0, Math.round(Number(row.count || 0))));
    });
  }

  return riders
    .map(rider => ({
      driverId: rider.id,
      name: maskName(rider.name, mask),
      callCount: totals.get(rider.id) || 0
    }))
    .filter(row => row.callCount > 0)
    .sort((a, b) => b.callCount - a.callCount || a.name.localeCompare(b.name, 'ko'))
    .slice(0, 10)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

/**
 * 배달현황(delivery_status) 최신 스냅샷을 지역(DP) 기준으로 읽는다.
 * 소유권 판정은 dedupe_key 접두사만 쓴다 — partner_id 컬럼은 수집 저장 payload 에서
 * 빠지기 때문에(baemin-collect-pipeline saveCollectItems) 항상 비어 있어 0건이 된다.
 */
async function loadBaeminDeliverySnapshot(supabase, partnerId, today) {
  const base = () => supabase
    .from('baemin_biz_collect_items')
    .select('dedupe_key,parsed_json,collect_date,rider_user_id,rider_name')
    .eq('source_menu', 'delivery_status')
    .like('dedupe_key', `${partnerId}:%`)
    .limit(3000);

  let { data, error } = await base().eq('collect_date', today);
  if (error) return { error };
  if (!(data || []).length) {
    // 배달현황은 DP당 최신 스냅샷만 남는다. 자정 직후에는 collect_date 가 전날일 수 있다.
    ({ data, error } = await base());
    if (error) return { error };
  }

  const rows = data || [];
  const snapshotDate = rows.reduce((latest, row) => {
    const day = String(row.collect_date || '').slice(0, 10);
    return day > latest ? day : latest;
  }, '');
  return {
    snapshotDate,
    rows: snapshotDate
      ? rows.filter(row => String(row.collect_date || '').slice(0, 10) === snapshotDate)
      : rows
  };
}

async function buildBaeminLive(supabase, region, today, options = {}) {
  const mask = options.maskNames !== false;
  const partnerId = String(region.partnerId || region.key || '').trim().toUpperCase();
  if (!/^DP\d{6,}$/.test(partnerId)) {
    return {
      metrics: { ...emptyMetrics(), sourceNote: '지역에 배민 협력사(DP) 코드가 없어 실시간 집계를 못 합니다' },
      realtimeRanking: []
    };
  }

  const [snapshot, regionRiders] = await Promise.all([
    loadBaeminDeliverySnapshot(supabase, partnerId, today),
    loadRidersForRegion(supabase, region)
  ]);

  const error = snapshot.error;
  if (error) {
    if (/does not exist|schema cache/i.test(error.message || '')) {
      return { metrics: emptyMetrics(), realtimeRanking: [] };
    }
    throw error;
  }

  const riderIndex = indexRegionRiders(regionRiders);
  const rows = snapshot.rows || [];
  let driving = 0;
  // 지역 등록 기사만 순위 — 같은 기사 중복 행은 최대 완료콜 유지
  const rankingByDriver = new Map();
  rows.forEach(row => {
    const parsed = row.parsed_json || {};
    if (isDrivingStatus(parsed.statusDesc || parsed.status_desc || '')) driving += 1;
    const complete = Math.max(0, Math.round(Number(parsed.totalComplete || parsed.total_complete || 0)));
    if (complete <= 0) return;
    const matched = matchRegionRider(riderIndex, {
      ...parsed,
      userId: parsed.userId || parsed.riderId || row.rider_user_id,
      riderName: parsed.riderName || parsed.rider_name || parsed.name || row.rider_name
    });
    if (!matched) return;
    const prev = rankingByDriver.get(matched.id);
    if (!prev || complete > prev.callCount) {
      rankingByDriver.set(matched.id, {
        driverId: matched.id,
        name: maskName(matched.name || '-', mask),
        callCount: complete
      });
    }
  });

  const top = [...rankingByDriver.values()]
    .sort((a, b) => b.callCount - a.callCount || a.name.localeCompare(b.name, 'ko'))
    .slice(0, 10)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  // 할당 = 현재 시간대 목표(요일할당 × 지역 세트수), 남은할당 = max(0, 할당 - 운행중)
  const slotKey = currentBaeminSlotKey();
  let assigned = 0;
  let quotaNote = '';
  try {
    const [setCountMap, matrix] = await Promise.all([
      readPartnerSetCountMap(),
      readWeekdayQuotaMatrix()
    ]);
    const setCount = normalizeSetCount(setCountMap?.[partnerId]?.setCount) || 1;
    const targets = computeSlotTargets(setCount, today, matrix);
    assigned = Math.max(0, Math.round(Number(targets[slotKey] || 0)));
  } catch (settingsError) {
    // 세트수·요일할당 설정을 못 읽어도 기본 할당표로는 보여준다.
    // 전부 0 으로 두면 크롤링이 안 된 것과 구분이 안 된다.
    console.warn('[BREM][region-ranking] 할당 설정 읽기 실패:', settingsError?.message || settingsError);
    assigned = Math.max(0, Math.round(Number(computeSlotTargets(1, today)[slotKey] || 0)));
    quotaNote = ' · 할당은 기본표(세트수·요일할당 설정 읽기 실패)';
  }

  const remaining = Math.max(0, assigned - driving);
  const slotLabel = SLOT_LABELS[slotKey] || slotKey;
  const snapshotDate = snapshot.snapshotDate || '';
  const snapshotNote = !rows.length
    ? ' · 오늘 배달현황 수집분이 없습니다'
    : (snapshotDate && snapshotDate !== today ? ` · 배달현황 스냅샷 ${snapshotDate}` : '');

  return {
    metrics: {
      assigned,
      operating: driving,
      remaining,
      slotKey,
      slotLabel,
      snapshotDate,
      sourceNote: `배민 ${slotLabel} 할당 · 운행현황 수집 · 실시간순위=지역등록 ${regionRiders.length}명 중${snapshotNote}${quotaNote}`
    },
    realtimeRanking: top
  };
}

async function buildCoupangLive(supabase, region, today, options = {}) {
  // options.maskNames 는 쿠팡 실시간 순위가 비활성(가중치 0.8)이라 미사용
  void options;
  const vendorId = region.vendorId || '';
  const label = shortCoupangRegion(region.label || region.key);

  const baseQuery = () => supabase
    .from('coupang_collect_items')
    .select('vendor_id,vendor_name,parsed_json,source_menu,collect_date')
    .eq('collect_date', today)
    .in('source_menu', ['peak_realtime', 'vendor_info']);

  // vendorId 가 있으면 DB 에서 먼저 좁힌다. (그날 전체 5000행을 받아 앱에서 거르면 느리다)
  // 지역명으로만 매칭되는 수집분도 있어서, 결과가 비면 기존처럼 전체를 훑는다.
  let { data, error } = vendorId
    ? await baseQuery().eq('vendor_id', vendorId).limit(5000)
    : await baseQuery().limit(5000);
  if (!error && vendorId && !(data || []).length) {
    ({ data, error } = await baseQuery().limit(5000));
  }

  if (error) {
    if (/does not exist|schema cache/i.test(error.message || '')) {
      return {
        metrics: {
          ...emptyMetrics(),
          sourceNote: '쿠팡 피크타임·지역요약 크롤링 테이블 없음'
        },
        realtimeRanking: [],
        realtimeRankingDisabled: true,
        realtimeRankingReason: '쿠팡 실시간 콜수는 피크 가중치(0.8 단위)라 기사별 순위 집계가 불가합니다. 할당·운행중·남은할당만 표시합니다.'
      };
    }
    throw error;
  }

  const rows = (data || []).filter(row => {
    const vid = String(row.vendor_id || '').trim();
    const vname = shortCoupangRegion(row.vendor_name || '');
    if (vendorId && vid === vendorId) return true;
    if (label && vname === label) return true;
    return false;
  });

  // 할당/남은할당 = 피크타임 현황(peak_realtime) 크롤링
  // 운행중 = 지역별 요약(vendor_info) 크롤링
  let assigned = 0;
  let operating = 0;
  let remaining = 0;
  let peakGoalSum = 0;
  let peakRemainSum = 0;
  let hasPeak = false;
  let hasVendor = false;

  rows.forEach(row => {
    const parsed = row.parsed_json || {};
    if (row.source_menu === 'peak_realtime') {
      hasPeak = true;
      peakGoalSum += Math.max(0, Number(parsed.goalCount || 0));
      peakRemainSum += Math.max(0, Number(parsed.remainingCount || 0));
    }
    if (row.source_menu === 'vendor_info') {
      hasVendor = true;
      operating = Math.max(operating, Math.round(Number(parsed.riderOnLineCount || parsed.onGoingCount || 0)));
      if (!hasPeak) {
        assigned = Math.max(assigned, Math.round(Number(parsed.target || 0)));
      }
    }
  });

  if (hasPeak) {
    // 피크별 목표/잔여 합산 (대시보드 피크타임 현황과 동일 소스)
    assigned = Math.round(peakGoalSum);
    remaining = Math.round(peakRemainSum);
  } else if (hasVendor && assigned > 0) {
    remaining = Math.max(0, assigned - operating);
  }

  return {
    metrics: {
      assigned,
      operating,
      remaining,
      sourceNote: hasPeak || hasVendor
        ? '쿠팡 할당=피크타임 현황(peak_realtime) · 운행중=지역별 요약(vendor_info) 크롤링'
        : '오늘 쿠팡 피크타임·지역요약 크롤링 데이터가 없습니다'
    },
    // 쿠팡 라이더별 completeCount 는 0.8 가중치 소수 → 정수 순위 불가
    realtimeRanking: [],
    realtimeRankingDisabled: true,
    realtimeRankingReason: '쿠팡 실시간 콜수는 피크 가중치(0.8 단위)라 기사별 순위 집계가 불가합니다. 할당·운행중·남은할당만 표시합니다.'
  };
}

function emptyMetrics() {
  return { assigned: 0, operating: 0, remaining: 0, sourceNote: '' };
}

async function getRiderRegionDashboard(accessToken, query = {}) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const platform = normalizePlatform(query.platform || 'baemin');
  const today = formatLocalDateKey(new Date());
  const weekStart = normalizeSettlementWeekStart(query.weekStart || today);
  const weekEnd = settlementWeekEnd(weekStart);

  let exposure;
  try {
    exposure = await readExposureMap(supabase);
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '노출 설정을 불러오지 못했습니다.' };
  }

  const regions = listExposedRegions(exposure, platform);
  if (!regions.length) {
    return {
      ok: true,
      platform,
      weekStart,
      weekEnd,
      today,
      regions: [],
      selectedRegionKey: '',
      region: null,
      metrics: emptyMetrics(),
      realtimeRanking: [],
      weeklyRanking: [],
      message: '관리자가 노출로 설정한 지역이 없습니다.'
    };
  }

  // 기사 소속 지역이 노출 목록에 있으면 기본 선택
  const riderRegionLabel = platform === 'coupang'
    ? String(me.rider?.regionCoupang || me.rider?.raw_data?.regionCoupang || '').trim()
    : String(me.rider?.regionBaemin || me.rider?.raw_data?.regionBaemin || '').trim();
  const preferred = regions.find(region => {
    if (!riderRegionLabel) return false;
    if (platform === 'coupang') {
      return shortCoupangRegion(riderRegionLabel) === shortCoupangRegion(region.key)
        || shortCoupangRegion(riderRegionLabel) === shortCoupangRegion(region.label);
    }
    return riderRegionLabel === region.label
      || riderRegionLabel === region.partnerId
      || riderRegionLabel === region.key;
  });

  const requestedKey = String(query.regionKey || '').trim();
  const selected = regions.find(region => region.key === requestedKey)
    || preferred
    || regions[0];

  let live = { metrics: emptyMetrics(), realtimeRanking: [] };
  let weeklyRanking = [];
  try {
    live = platform === 'coupang'
      ? await buildCoupangLive(supabase, selected, today)
      : await buildBaeminLive(supabase, selected, today);
    weeklyRanking = await buildWeeklyRanking(supabase, selected, weekStart, weekEnd);
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '지역 대시보드를 불러오지 못했습니다.' };
  }

  return {
    ok: true,
    platform,
    weekStart,
    weekEnd,
    today,
    regions,
    selectedRegionKey: selected.key,
    region: selected,
    metrics: live.metrics,
    realtimeRanking: live.realtimeRanking || [],
    realtimeRankingDisabled: live.realtimeRankingDisabled === true,
    realtimeRankingReason: live.realtimeRankingReason || '',
    weeklyRanking,
    message: ''
  };
}

/**
 * 관리자 기사지역관리: 실시간 TOP10 + 주간 TOP10 (노출 여부와 무관)
 */
async function getAdminRegionRanking(accessToken, query = {}) {
  const { verifyAdminCaller } = require('./admin-users');
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const platform = normalizePlatform(query.platform || 'baemin');
  const today = formatLocalDateKey(new Date());
  const weekStart = normalizeSettlementWeekStart(query.weekStart || today);
  const weekEnd = settlementWeekEnd(weekStart);
  const region = {
    key: String(query.regionKey || query.key || '').trim(),
    platform,
    label: String(query.label || query.regionKey || '').trim(),
    partnerId: String(query.partnerId || '').trim(),
    vendorId: String(query.vendorId || '').trim()
  };
  if (!region.key && !region.partnerId && !region.label) {
    return { ok: false, status: 400, error: '지역 정보가 없습니다.' };
  }
  if (!region.key) region.key = region.partnerId || region.label;
  if (!region.label) region.label = region.key;

  try {
    const live = platform === 'coupang'
      ? await buildCoupangLive(supabase, region, today, { maskNames: false })
      : await buildBaeminLive(supabase, region, today, { maskNames: false });
    const weeklyRanking = await buildWeeklyRanking(supabase, region, weekStart, weekEnd, { maskNames: false });
    return {
      ok: true,
      platform,
      today,
      weekStart,
      weekEnd,
      region,
      metrics: live.metrics,
      realtimeRanking: live.realtimeRanking || [],
      realtimeRankingDisabled: live.realtimeRankingDisabled === true,
      realtimeRankingReason: live.realtimeRankingReason || '',
      weeklyRanking: weeklyRanking || [],
      realtimeFirst: (live.realtimeRanking || [])[0] || null,
      weeklyFirst: (weeklyRanking || [])[0] || null
    };
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '지역 순위를 불러오지 못했습니다.' };
  }
}

async function getAdminRegionExposure(accessToken) {
  const { verifyAdminCaller } = require('./admin-users');
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  try {
    const exposure = await readExposureMap(supabase);
    return { ok: true, exposure };
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '노출 설정을 불러오지 못했습니다.' };
  }
}

async function saveAdminRegionExposure(accessToken, body = {}) {
  const { verifyAdminCaller } = require('./admin-users');
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const platform = normalizePlatform(body.platform);
  const key = String(body.key || '').trim();
  if (!key) return { ok: false, status: 400, error: '지역 키가 없습니다.' };

  try {
    const exposure = await readExposureMap(supabase);
    const side = { ...(exposure[platform] || {}) };
    const exposed = body.exposed === true;
    if (!exposed) {
      delete side[key];
    } else {
      side[key] = {
        exposed: true,
        label: String(body.label || key).trim() || key,
        partnerId: String(body.partnerId || '').trim(),
        vendorId: String(body.vendorId || '').trim(),
        updatedAt: new Date().toISOString()
      };
    }
    const next = {
      ...exposure,
      [platform]: side,
      updatedAt: new Date().toISOString()
    };
    const { error } = await supabase.from('settings').upsert({
      key: EXPOSURE_KEY,
      value: next,
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' });
    if (error) throw error;
    return { ok: true, exposure: next };
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '노출 설정을 저장하지 못했습니다.' };
  }
}

module.exports = {
  EXPOSURE_KEY,
  getRiderRegionDashboard,
  getAdminRegionRanking,
  getAdminRegionExposure,
  saveAdminRegionExposure
};
