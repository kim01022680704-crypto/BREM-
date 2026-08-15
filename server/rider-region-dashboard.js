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

/** 서버 타임존과 무관하게 KST 달력 날짜(YYYY-MM-DD) */
function formatKstDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function normalizeSettlementWeekStart(dateValue) {
  const seed = String(dateValue || '').trim().slice(0, 10);
  const base = /^\d{4}-\d{2}-\d{2}$/.test(seed) ? seed : formatKstDateKey(new Date());
  // 정오 KST 고정 — DST/UTC 경계에서 요일 계산이 하루 밀리지 않게
  const date = new Date(`${base}T12:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return formatKstDateKey(new Date());
  const dow = date.getUTCDay(); // +09:00 정오 → UTC 03:00, getUTCDay = KST 요일
  const diff = (dow - 3 + 7) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  return formatKstDateKey(date);
}

function settlementWeekEnd(weekStart) {
  const startKey = normalizeSettlementWeekStart(weekStart);
  if (!startKey) return '';
  const start = new Date(`${startKey}T12:00:00+09:00`);
  if (Number.isNaN(start.getTime())) return '';
  start.setUTCDate(start.getUTCDate() + 6);
  return formatKstDateKey(start);
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

/** 기사 지역 옵션:
 * full=올노출(기본, 본인 순위 노출 + 전체 보드)
 * dashboard=전체열람(자기 순위 비노출, 남 순위+할당 열람)
 * metrics=할당만(순위 노출, 본인 보드엔 할당만)
 * leader=팀장(전원 보드 열람·본인 순위 비노출)
 */
function normalizeRiderRegionMode(value) {
  const mode = String(value || '').toLowerCase();
  if (mode === 'dashboard' || mode === 'view' || mode === '전체열람') return 'dashboard';
  if (mode === 'metrics' || mode === 'quota' || mode === '할당만') return 'metrics';
  if (mode === 'leader' || mode === 'team_leader' || mode === '팀장') return 'leader';
  return 'full';
}

function getRiderRegionMode(exposure, platform, regionKey, driverId) {
  const id = String(driverId || '').trim();
  if (!id) return 'full';
  const entry = exposure?.[platform]?.[regionKey]?.riders?.[id];
  return normalizeRiderRegionMode(entry?.mode);
}

/** 일반 기사앱 순위에 올릴 기사 — 올노출·할당만 (전체열람·팀장 제외) */
function filterRankingRiders(exposure, platform, regionKey, riders = []) {
  return (riders || []).filter(rider => {
    const mode = getRiderRegionMode(exposure, platform, regionKey, rider.id);
    return mode === 'full' || mode === 'metrics';
  });
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

function mapRiderRow(row) {
  return {
    id: row.id,
    name: row.name || '',
    baeminId: row.baemin_id || '',
    regionBaemin: String(row.raw_data?.regionBaemin || '').trim(),
    regionCoupang: String(row.raw_data?.regionCoupang || '').trim(),
    raw_data: row.raw_data || {},
    status: row.status || ''
  };
}

function escapePostgrestValue(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

/** 응답 메모리 캐시 — 같은 지역을 연속으로 열면 DB 없이 바로 돌려준다. */
const RESPONSE_CACHE_TTL_MS = 20 * 1000;
const responseCache = new Map();

function readResponseCache(key) {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > RESPONSE_CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return hit.data;
}

function writeResponseCache(key, data) {
  responseCache.set(key, { at: Date.now(), data });
  if (responseCache.size > 80) {
    const oldest = [...responseCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) responseCache.delete(oldest[0]);
  }
}

function clearResponseCache() {
  responseCache.clear();
}

async function loadRidersForRegion(supabase, region) {
  // 전체 5000건을 매번 받으면 대시보드가 12초 타임아웃 난다.
  // raw_data JSON 키로 DB에서 먼저 좁힌 뒤, 기존 매칭 규칙으로 한 번 더 거른다.
  // 한 번에 800으로 자르면 남구처럼 인원이 많은 지역이 덜 잡혀 「190 vs 71」 같은 불일치가 난다.
  const pageSize = 1000;
  const all = [];

  async function fetchPages(buildQuery) {
    for (let from = 0; from < 20000; from += pageSize) {
      const { data, error } = await buildQuery()
        .range(from, from + pageSize - 1);
      if (error) return { error, data: all };
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return { data: all, error: null };
  }

  let result;
  if (region.platform === 'baemin') {
    const parts = [region.label, region.partnerId, region.key]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .map(value => `raw_data->>regionBaemin.eq.${escapePostgrestValue(value)}`);
    if (parts.length) {
      result = await fetchPages(() => supabase
        .from('riders')
        .select('id,name,baemin_id,raw_data')
        .or(parts.join(',')));
    } else {
      result = { data: [], error: null };
    }
  } else {
    const short = shortCoupangRegion(region.label || region.key);
    const parts = [region.label, region.key, region.vendorId]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .map(value => `raw_data->>regionCoupang.eq.${escapePostgrestValue(value)}`);
    if (short) parts.push(`raw_data->>regionCoupang.ilike.%${escapePostgrestValue(short)}%`);
    if (parts.length) {
      result = await fetchPages(() => supabase
        .from('riders')
        .select('id,name,baemin_id,raw_data')
        .or(parts.join(',')));
    } else {
      result = { data: [], error: null };
    }
  }

  if (result.error) {
    console.warn('[BREM][region-dashboard] riders region filter fallback:', result.error.message || result.error);
    all.length = 0;
    result = await fetchPages(() => supabase
      .from('riders')
      .select('id,name,baemin_id,raw_data'));
    if (result.error) throw result.error;
  }

  return (result.data || all)
    .map(mapRiderRow)
    .filter(rider => riderMatchesRegion(rider, region));
}

async function buildWeeklyRanking(supabase, region, weekStart, weekEnd, options = {}) {
  const mask = options.maskNames !== false;
  const riders = Array.isArray(options.rankingRiders)
    ? options.rankingRiders
    : (Array.isArray(options.regionRiders)
      ? options.regionRiders
      : await loadRidersForRegion(supabase, region));
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

  // regionRiders 를 밖에서 넘기면 riders 테이블을 한 번만 읽는다.
  // rankingRiders 가 있으면 실시간 순위만 그 집합으로 잡는다(전체열람 기사는 제외).
  const snapshotPromise = loadBaeminDeliverySnapshot(supabase, partnerId, today);
  const ridersPromise = Array.isArray(options.regionRiders)
    ? Promise.resolve(options.regionRiders)
    : loadRidersForRegion(supabase, region);
  const [snapshot, regionRiders] = await Promise.all([snapshotPromise, ridersPromise]);
  const rankingRiders = Array.isArray(options.rankingRiders) ? options.rankingRiders : regionRiders;

  const error = snapshot.error;
  if (error) {
    if (/does not exist|schema cache/i.test(error.message || '')) {
      return { metrics: emptyMetrics(), realtimeRanking: [] };
    }
    throw error;
  }

  const riderIndex = indexRegionRiders(rankingRiders);
  const rows = snapshot.rows || [];
  const slotKey = currentBaeminSlotKey();
  const slotPeakField = {
    morning: ['morningCount', 'completeMorning'],
    afternoon: ['afternoonCount', 'completeAfternoon'],
    evening: ['eveningCount', 'completeEvening'],
    midnight: ['midnightCount', 'completeMidnight']
  }[slotKey] || ['eveningCount', 'completeEvening'];

  let driving = 0;
  let slotComplete = 0;
  // 지역 등록 기사만 순위 — 같은 기사 중복 행은 최대 완료콜 유지
  const rankingByDriver = new Map();
  rows.forEach(row => {
    const parsed = row.parsed_json || {};
    if (isDrivingStatus(parsed.statusDesc || parsed.status_desc || '')) driving += 1;
    // 콜달성 대시보드와 동일: DP 스냅샷 전체의 시간대 완료콜 합
    slotComplete += Math.max(
      0,
      Math.round(Number(parsed[slotPeakField[0]] ?? parsed[slotPeakField[1]] ?? 0))
    );
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

  // 할당/남은할당 = 콜 목표 기준 (배민현황·콜달성 대시보드와 동일).
  // 예전처럼 할당(콜) - 운행중(명) 하면 단위가 섞여 중구B가 36-7=29 로 어긋났다.
  let assigned = 0;
  let setCount = 1;
  let quotaNote = '';
  try {
    const [setCountMap, matrix] = await Promise.all([
      readPartnerSetCountMap(),
      readWeekdayQuotaMatrix()
    ]);
    setCount = normalizeSetCount(setCountMap?.[partnerId]?.setCount) || 1;
    const targets = computeSlotTargets(setCount, today, matrix);
    assigned = Math.max(0, Math.round(Number(targets[slotKey] || 0)));
  } catch (settingsError) {
    console.warn('[BREM][region-ranking] 할당 설정 읽기 실패:', settingsError?.message || settingsError);
    assigned = Math.max(0, Math.round(Number(computeSlotTargets(1, today)[slotKey] || 0)));
    quotaNote = ' · 할당은 기본표(세트수·요일할당 설정 읽기 실패)';
  }

  const remaining = Math.max(0, assigned - slotComplete);
  const slotLabel = SLOT_LABELS[slotKey] || slotKey;
  const snapshotDate = snapshot.snapshotDate || '';
  const snapshotNote = !rows.length
    ? ' · 오늘 배달현황 수집분이 없습니다'
    : (snapshotDate && snapshotDate !== today ? ` · 배달현황 스냅샷 ${snapshotDate}` : '');

  return {
    metrics: {
      assigned,
      slotComplete,
      operating: driving,
      remaining,
      progressLabel: `${slotComplete}/${assigned}`,
      setCount,
      slotKey,
      slotLabel,
      snapshotDate,
      sourceNote: `배민 ${slotLabel} ${slotComplete}/${assigned} · 운행중 ${driving}명 · ${setCount}세트 · 실시간순위=지역등록 ${regionRiders.length}명 중${snapshotNote}${quotaNote}`
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
  const today = formatKstDateKey(new Date());
  const weekStart = normalizeSettlementWeekStart(query.weekStart || today);
  const weekEnd = settlementWeekEnd(weekStart);
  const requestedKey = String(query.regionKey || '').trim();

  let exposure;
  try {
    exposure = await readExposureMap(supabase);
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '노출 설정을 불러오지 못했습니다.' };
  }

  // 라이더 노출 ON 지역 중, 이 기사가 등록된 지역만 대시보드에 보이게 한다.
  // (예전에는 노출만 켜면 전 기사가 해당 지역을 볼 수 있었다.)
  const riderRow = mapRiderRow({
    id: me.rider?.id,
    name: me.rider?.name,
    baemin_id: me.rider?.baemin_id || me.rider?.baeminId,
    raw_data: me.rider?.raw_data || {
      regionBaemin: me.rider?.regionBaemin,
      regionCoupang: me.rider?.regionCoupang
    }
  });
  const exposedAll = listExposedRegions(exposure, platform);
  const regions = exposedAll.filter(region => riderMatchesRegion(riderRow, region));
  if (!regions.length) {
    const hasAnyExposure = exposedAll.length > 0;
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
      message: hasAnyExposure
        ? '등록된 지역에 노출된 대시보드가 없습니다. 관리자 「기사지역관리」에서 본인 지역 등록·라이더 노출을 확인하세요.'
        : '관리자가 노출로 설정한 지역이 없습니다.'
    };
  }

  const selected = regions.find(region => region.key === requestedKey)
    || regions[0];

  const cacheKey = `rider|${me.riderId || riderRow.id || '-'}|${platform}|${selected.key}|${weekStart}|${today}`;
  const cached = readResponseCache(cacheKey);
  if (cached) {
    return { ...cached, regions, selectedRegionKey: selected.key, region: selected };
  }

  let live = { metrics: emptyMetrics(), realtimeRanking: [] };
  let weeklyRanking = [];
  const viewerMode = getRiderRegionMode(exposure, platform, selected.key, riderRow.id);
  try {
    const regionRiders = await loadRidersForRegion(supabase, selected);
    // 팀장: 다른 기사 올노출/전체열람 설정과 무관하게 전원 순위·할당 보드를 본다.
    // 일반: 올노출·할당만 기사를 순위에 포함 (전체열람·팀장은 순위 비노출).
    const rankingRiders = viewerMode === 'leader'
      ? regionRiders
      : filterRankingRiders(exposure, platform, selected.key, regionRiders);
    const liveOpts = { regionRiders, rankingRiders };
    const weekOpts = { regionRiders, rankingRiders };
    [live, weeklyRanking] = await Promise.all([
      platform === 'coupang'
        ? buildCoupangLive(supabase, selected, today, liveOpts)
        : buildBaeminLive(supabase, selected, today, liveOpts),
      buildWeeklyRanking(supabase, selected, weekStart, weekEnd, weekOpts)
    ]);
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '지역 대시보드를 불러오지 못했습니다.' };
  }

  const payload = {
    ok: true,
    platform,
    weekStart,
    weekEnd,
    today,
    regions,
    selectedRegionKey: selected.key,
    region: selected,
    viewerMode,
    // 할당만: 본인 보드에는 TOP 순위를 숨기고 할당 지표만
    rankingsHidden: viewerMode === 'metrics',
    metrics: live.metrics,
    realtimeRanking: viewerMode === 'metrics' ? [] : (live.realtimeRanking || []),
    realtimeRankingDisabled: viewerMode === 'metrics'
      ? true
      : live.realtimeRankingDisabled === true,
    realtimeRankingReason: viewerMode === 'metrics'
      ? '할당만 보기 — 실시간·주간 순위는 표시하지 않습니다.'
      : (live.realtimeRankingReason || ''),
    weeklyRanking: viewerMode === 'metrics' ? [] : weeklyRanking,
    message: ''
  };
  writeResponseCache(cacheKey, payload);
  return payload;
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
  const today = formatKstDateKey(new Date());
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

  const cacheKey = `admin|${platform}|${region.key}|${weekStart}|${today}|nomask`;
  const cached = readResponseCache(cacheKey);
  if (cached) return cached;

  try {
    const regionRiders = await loadRidersForRegion(supabase, region);
    const shared = { maskNames: false, regionRiders };
    const [live, weeklyRanking] = await Promise.all([
      platform === 'coupang'
        ? buildCoupangLive(supabase, region, today, shared)
        : buildBaeminLive(supabase, region, today, shared),
      buildWeeklyRanking(supabase, region, weekStart, weekEnd, shared)
    ]);
    const payload = {
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
    writeResponseCache(cacheKey, payload);
    return payload;
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

/**
 * 선택 DP의 오늘 배달현황 크롤 ↔ 전체 ERP 배민ID 매칭 미리보기.
 * 기사지역관리 「크롤링으로 지역등록」용.
 */
async function getAdminRegionCrawlMatch(accessToken, query = {}) {
  const { verifyAdminCaller } = require('./admin-users');
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const partnerId = String(query.partnerId || query.regionKey || query.key || '').trim().toUpperCase();
  const label = String(query.label || '').trim();
  if (!/^DP\d{6,}$/.test(partnerId)) {
    return { ok: false, status: 400, error: '배민 협력사(DP) 코드가 필요합니다.' };
  }

  const today = formatKstDateKey(new Date());
  const snapshot = await loadBaeminDeliverySnapshot(supabase, partnerId, today);
  if (snapshot.error) {
    return { ok: false, status: 500, error: snapshot.error.message || '배달현황 크롤을 불러오지 못했습니다.' };
  }

  // 전체 기사 — 지역 필터 없이 배민ID로만 매칭
  const { data: riderRows, error: riderError } = await supabase
    .from('riders')
    .select('id,name,baemin_id,raw_data')
    .limit(8000);
  if (riderError) {
    return { ok: false, status: 500, error: riderError.message || '기사 목록을 불러오지 못했습니다.' };
  }

  const byBaeminId = new Map();
  (riderRows || []).forEach(row => {
    const rider = mapRiderRow(row);
    const idKey = baeminIdMatchKey(rider.baeminId);
    if (idKey && !byBaeminId.has(idKey)) byBaeminId.set(idKey, rider);
  });

  function regionMatchesTarget(regionValue) {
    const value = String(regionValue || '').trim();
    if (!value) return false;
    return value === label
      || value === partnerId
      || (partnerId && value.includes(partnerId));
  }

  const seen = new Set();
  const rows = [];
  (snapshot.rows || []).forEach(row => {
    const parsed = row.parsed_json || {};
    const baeminId = String(
      parsed.userId || parsed.riderId || parsed.rider_user_id || parsed.baeminId || row.rider_user_id || ''
    ).trim();
    const idKey = baeminIdMatchKey(baeminId);
    if (!idKey || seen.has(idKey)) return;
    seen.add(idKey);

    const crawlName = String(
      parsed.riderName || parsed.rider_name || parsed.name || row.rider_name || ''
    ).trim();
    const driver = byBaeminId.get(idKey) || null;
    const currentRegion = driver
      ? String(driver.regionBaemin || driver.raw_data?.regionBaemin || '').trim()
      : '';

    let status = 'unregistered';
    if (driver) {
      status = regionMatchesTarget(currentRegion) ? 'already' : 'assignable';
    }

    rows.push({
      baeminId: baeminId || idKey,
      baeminIdKey: idKey,
      crawlName: crawlName || '-',
      driverId: driver?.id || '',
      driverName: driver?.name || '',
      currentRegion,
      status,
      targetRegion: label || partnerId
    });
  });

  rows.sort((a, b) => {
    const order = { assignable: 0, unregistered: 1, already: 2 };
    const d = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    if (d) return d;
    return String(a.crawlName).localeCompare(String(b.crawlName), 'ko');
  });

  const summary = {
    total: rows.length,
    already: rows.filter(r => r.status === 'already').length,
    assignable: rows.filter(r => r.status === 'assignable').length,
    unregistered: rows.filter(r => r.status === 'unregistered').length
  };

  return {
    ok: true,
    partnerId,
    label: label || partnerId,
    today,
    snapshotDate: snapshot.snapshotDate || '',
    summary,
    rows
  };
}

async function upsertExposureMap(supabase, next) {
  const { error } = await supabase.from('settings').upsert({
    key: EXPOSURE_KEY,
    value: next,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) throw error;
  clearResponseCache();
  return next;
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

  // 기사별 옵션 저장 (기본=올노출). driverId 가 있으면 지역 ON/OFF 대신 모드만 갱신.
  const driverId = String(body.driverId || '').trim();
  if (driverId) {
    try {
      const exposure = await readExposureMap(supabase);
      const side = { ...(exposure[platform] || {}) };
      const prev = side[key] && typeof side[key] === 'object' ? side[key] : {};
      const riders = { ...(prev.riders && typeof prev.riders === 'object' ? prev.riders : {}) };
      const mode = normalizeRiderRegionMode(body.mode);
      if (mode === 'full') {
        // 기본값이 올노출이므로 명시 full 은 맵에서 지워 용량을 줄인다.
        delete riders[driverId];
      } else {
        riders[driverId] = {
          mode, // dashboard | metrics | leader
          updatedAt: new Date().toISOString()
        };
      }
      const wasExposed = prev.exposed === true || prev.exposed === 1
        || ((!prev.exposed && body.exposed === true));
      side[key] = {
        ...prev,
        // 기사 옵션만 바꿀 때는 지역 노출을 끄지 않는다. (미존재 키 + body.exposed 로 ON 유지 가능)
        exposed: wasExposed,
        label: String(body.label || prev.label || key).trim() || key,
        partnerId: String(body.partnerId || prev.partnerId || '').trim(),
        vendorId: String(body.vendorId || prev.vendorId || '').trim(),
        riders,
        updatedAt: new Date().toISOString()
      };
      // 지역 미노출인데 기사 옵션만 저장해도 riders 는 유지 (나중에 지역 ON 해도 유지)
      if (!side[key].exposed && !Object.keys(riders).length) {
        delete side[key];
      }
      const next = await upsertExposureMap(supabase, {
        ...exposure,
        [platform]: side,
        updatedAt: new Date().toISOString()
      });
      return { ok: true, exposure: next };
    } catch (error) {
      return { ok: false, status: 500, error: error.message || '기사 노출 옵션을 저장하지 못했습니다.' };
    }
  }

  try {
    const exposure = await readExposureMap(supabase);
    const side = { ...(exposure[platform] || {}) };
    const exposed = body.exposed === true;
    const prev = side[key] && typeof side[key] === 'object' ? side[key] : {};
    const riders = prev.riders && typeof prev.riders === 'object' ? prev.riders : {};
    if (!exposed) {
      // 지역 OFF 해도 기사별 옵션(전체열람 등)은 유지
      if (Object.keys(riders).length) {
        side[key] = {
          ...prev,
          exposed: false,
          riders,
          updatedAt: new Date().toISOString()
        };
      } else {
        delete side[key];
      }
    } else {
      side[key] = {
        ...prev,
        exposed: true,
        label: String(body.label || prev.label || key).trim() || key,
        partnerId: String(body.partnerId || prev.partnerId || '').trim(),
        vendorId: String(body.vendorId || prev.vendorId || '').trim(),
        riders,
        updatedAt: new Date().toISOString()
      };
    }
    const next = await upsertExposureMap(supabase, {
      ...exposure,
      [platform]: side,
      updatedAt: new Date().toISOString()
    });
    return { ok: true, exposure: next };
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '노출 설정을 저장하지 못했습니다.' };
  }
}

module.exports = {
  EXPOSURE_KEY,
  getRiderRegionDashboard,
  getAdminRegionRanking,
  getAdminRegionCrawlMatch,
  getAdminRegionExposure,
  saveAdminRegionExposure
};
