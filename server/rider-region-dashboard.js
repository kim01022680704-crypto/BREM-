const { getServiceClient } = require('./admin-bootstrap');
const { getRiderMe } = require('./rider-auth');
const { computeSlotTargets, SLOT_LABELS, currentBaeminSlotKey, kstHour } = require('./baemin-quota');
const { readWeekdayQuotaMatrix } = require('./baemin-weekday-quota');
const { readPartnerSetCountMap, normalizeSetCount } = require('./baemin-partner-set-count');
const {
  buildCoupangLookup,
  resolveDriver,
  metricsFromParsed
} = require('./coupang-erp-sync');
const {
  shortCoupangRegionLabel,
  coupangVendorMatchesRegion,
  PEAK_LABELS,
  PEAK_ORDER
} = require('./coupang-collect-sources');

const shortCoupangRegion = shortCoupangRegionLabel;

const EXPOSURE_KEY = 'brem_rider_dashboard_region_exposure_v1';

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

/** 쿠팡 현재 피크 슬롯 (KST). 0~6시는 전 영업일 마지막 피크(저녁논피크) */
function currentCoupangPeakKey(now = new Date()) {
  const hour = kstHour(now);
  if (hour < 6) return 'POST_DINNER';
  if (hour >= 7 && hour < 11) return 'MORNING';
  if (hour >= 11 && hour < 14) return 'LUNCH';
  if (hour >= 14 && hour < 17) return 'POST_LUNCH';
  if (hour >= 17 && hour < 21) return 'DINNER';
  return 'POST_DINNER';
}

function formatCoupangCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function coupangProgressLabel(complete, assigned) {
  const c = formatCoupangCount(complete);
  const a = formatCoupangCount(assigned);
  const show = v => (Number.isInteger(v) ? String(v) : String(v));
  return `${show(c)}/${show(a)}`;
}

/** 쿠팡 영업일 — KST 06:00 이전이면 전날 (coupang-session collect 와 동일) */
function coupangBusinessDateKst(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 3600 * 1000);
  if (kst.getUTCHours() < 6) kst.setUTCDate(kst.getUTCDate() - 1);
  return kst.toISOString().slice(0, 10);
}

/** rider_daily 조회일 — 영업일 우선, 없으면 최신 수집일 (자정~06시 0건 방지) */
async function resolveCoupangRiderDailyDate(supabase, preferredDate = '') {
  const want = String(preferredDate || '').slice(0, 10);
  const biz = coupangBusinessDateKst();
  const cal = formatKstDateKey(new Date());
  const candidates = [];
  if (want) candidates.push(want);
  if (!candidates.includes(biz)) candidates.push(biz);
  if (!candidates.includes(cal)) candidates.push(cal);

  for (const date of candidates) {
    const { count, error } = await supabase
      .from('coupang_collect_items')
      .select('*', { count: 'exact', head: true })
      .eq('source_menu', 'rider_daily')
      .eq('collect_date', date);
    if (!error && (count || 0) > 0) {
      const primary = want || biz;
      return {
        collectDate: date,
        requestedDate: primary,
        fallback: date !== primary,
        crawlRowCount: count || 0
      };
    }
  }

  const { data, error } = await supabase
    .from('coupang_collect_items')
    .select('collect_date')
    .eq('source_menu', 'rider_daily')
    .order('collect_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const latest = String(data?.collect_date || '').slice(0, 10);
  const primary = want || biz;
  return {
    collectDate: latest || primary,
    requestedDate: primary,
    fallback: Boolean(latest && latest !== primary),
    crawlRowCount: 0
  };
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
 * hidden=미노출(기사앱 대시보드만 숨김 — 집계·순위·팀장 열람에는 포함)
 */
/**
 * 설정이 없을 때의 기본 모드 = 미노출.
 * 신규 등록 기사가 자동으로 기사앱 대시보드에 노출되지 않게 한다.
 * (미노출은 "앱 대시보드만 숨김"이고 집계·순위에는 그대로 포함된다 — filterRankingRiders 참고)
 */
const DEFAULT_RIDER_REGION_MODE = 'hidden';

function normalizeRiderRegionMode(value) {
  const mode = String(value || '').toLowerCase();
  if (mode === 'dashboard' || mode === 'view' || mode === '전체열람') return 'dashboard';
  if (mode === 'metrics' || mode === 'quota' || mode === '할당만') return 'metrics';
  if (mode === 'leader' || mode === 'team_leader' || mode === '팀장') return 'leader';
  if (mode === 'hidden' || mode === 'off' || mode === 'none' || mode === '미노출') return 'hidden';
  // 올노출은 명시값으로 다뤄야 한다. 기본값이 미노출이라 여기서 흘려보내면 안 된다.
  if (mode === 'full' || mode === 'all' || mode === '올노출') return 'full';
  return DEFAULT_RIDER_REGION_MODE;
}

function getRiderRegionMode(exposure, platform, regionKey, driverId) {
  const id = String(driverId || '').trim();
  if (!id) return DEFAULT_RIDER_REGION_MODE;
  const entry = exposure?.[platform]?.[String(regionKey || '').trim()]?.riders?.[id];
  return normalizeRiderRegionMode(entry?.mode);
}

/** region 객체 기준으로 모드 조회 (key / partnerId / label 모두 시도) */
function getRiderRegionModeForRegion(exposure, region, driverId) {
  const id = String(driverId || '').trim();
  if (!id || !region) return DEFAULT_RIDER_REGION_MODE;
  const platform = normalizePlatform(region.platform || 'baemin');
  const side = exposure?.[platform] || {};
  const keys = [region.key, region.partnerId, region.label]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
  for (const key of keys) {
    const entry = side[key]?.riders?.[id];
    if (entry && entry.mode != null && String(entry.mode).trim() !== '') {
      return normalizeRiderRegionMode(entry.mode);
    }
  }
  return DEFAULT_RIDER_REGION_MODE;
}

/** 일반 순위에 올릴 기사 — 올노출·할당만·미노출 (전체열람·팀장만 제외)
 * 미노출 = 기사앱 대시보드만 숨김. 집계·순위·팀장 열람에는 그대로 포함.
 * 팀장 = 순위에 절대 안 올림 (본인 포함).
 */
function filterRankingRiders(exposure, platform, regionKey, riders = [], region = null) {
  return (riders || []).filter(rider => {
    const mode = region
      ? getRiderRegionModeForRegion(exposure, region, rider.id)
      : getRiderRegionMode(exposure, platform, regionKey, rider.id);
    return mode === 'full' || mode === 'metrics' || mode === 'hidden';
  });
}

/** 팀장 열람용 순위 집합 — 전원 보되 팀장(본인·다른 팀장)은 목록에서 제외 */
function filterLeaderViewRankingRiders(exposure, region, riders = []) {
  return (riders || []).filter(rider => {
    const mode = getRiderRegionModeForRegion(exposure, region, rider.id);
    return mode !== 'leader';
  });
}

/** 기사앱에 대시보드를 보여줄 지역 — 미노출 기사 제외 */
function filterViewerRegions(exposure, platform, riderRow, regions = []) {
  const riderId = riderRow?.id;
  return (regions || []).filter(region => {
    if (!riderMatchesRegion(riderRow, region)) return false;
    return getRiderRegionModeForRegion(exposure, { ...region, platform }, riderId) !== 'hidden';
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
      || (region.partnerId && String(region.partnerId).length >= 6 && value.includes(region.partnerId));
  }
  const value = String(rider.regionCoupang || rider.raw_data?.regionCoupang || '').trim();
  if (!value) return false;
  if (value === region.vendorId || value === region.key) return true;
  if (region.vendorName && value === region.vendorName) return true;
  const valueShort = shortCoupangRegionLabel(value);
  const regionShort = shortCoupangRegionLabel(region.label || region.vendorName || '');
  return Boolean(valueShort && regionShort && valueShort === regionShort);
}

function mapRiderRow(row) {
  return {
    id: row.id,
    name: row.name || '',
    baeminId: row.baemin_id || '',
    phone: String(row.phone || row.raw_data?.phone || '').trim(),
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
    const partnerId = String(region.partnerId || '').trim();
    // 클라이언트 driversInRegion 의 includes(partnerId) 와 맞춘다.
    if (partnerId.length >= 6) {
      parts.push(`raw_data->>regionBaemin.ilike.%${escapePostgrestValue(partnerId)}%`);
    }
    if (parts.length) {
      result = await fetchPages(() => supabase
        .from('riders')
        .select('id,name,baemin_id,phone,raw_data')
        .or(parts.join(',')));
    } else {
      result = { data: [], error: null };
    }
  } else {
    const short = shortCoupangRegion(region.label || region.key);
    const parts = [region.label, region.key, region.vendorId, region.vendorName]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .map(value => `raw_data->>regionCoupang.eq.${escapePostgrestValue(value)}`);
    if (short) parts.push(`raw_data->>regionCoupang.ilike.%${escapePostgrestValue(short)}%`);
    if (parts.length) {
      result = await fetchPages(() => supabase
        .from('riders')
        .select('id,name,baemin_id,phone,raw_data')
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
      .select('id,name,baemin_id,phone,raw_data'));
    if (result.error) throw result.error;
  }

  return (result.data || all)
    .map(mapRiderRow)
    .filter(rider => riderMatchesRegion(rider, region));
}

/**
 * 주간 콜수 — admin_calls 우선, 없으면 일정산(daily_settlements) order_count (기사지역관리·조직도와 동일)
 */
async function loadWeekCallTotalsForDrivers(supabase, driverIds, weekStart, weekEnd, platform) {
  const ids = [...new Set((driverIds || []).map(id => String(id || '').trim()).filter(Boolean))];
  const plat = normalizePlatform(platform);
  const totals = new Map();
  if (!ids.length) return totals;

  const touch = (driverId) => {
    if (!totals.has(driverId)) {
      totals.set(driverId, { callCount: 0, orderByDay: new Map() });
    }
    return totals.get(driverId);
  };

  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const { data: callRows, error: callError } = await supabase
      .from('admin_calls')
      .select('driver_id,date,platform,count')
      .in('driver_id', chunk)
      .eq('platform', plat)
      .gte('date', weekStart)
      .lte('date', weekEnd);
    if (callError) throw callError;
    (callRows || []).forEach(row => {
      const id = String(row.driver_id || '').trim();
      if (!id) return;
      touch(id).callCount += Math.max(0, Math.round(Number(row.count || 0)));
    });

    const { data: settlementRows, error: settlementError } = await supabase
      .from('daily_settlements')
      .select('driver_id,period,platform,order_count,applied_at')
      .in('driver_id', chunk)
      .eq('platform', plat)
      .gte('period', weekStart)
      .lte('period', weekEnd);
    if (settlementError) throw settlementError;
    (settlementRows || []).forEach(row => {
      const id = String(row.driver_id || '').trim();
      if (!id) return;
      const day = String(row.period || '').slice(0, 10);
      if (!day) return;
      const bucket = touch(id);
      const appliedAt = String(row.applied_at || '');
      const orderCount = Math.max(0, Math.round(Number(row.order_count || 0)));
      const prev = bucket.orderByDay.get(day);
      if (!prev || appliedAt >= prev.appliedAt) {
        bucket.orderByDay.set(day, { orderCount, appliedAt });
      }
    });
  }

  ids.forEach(id => {
    const row = totals.get(id);
    if (!row) {
      totals.set(id, 0);
      return;
    }
    let callCount = row.callCount;
    if (callCount <= 0) {
      row.orderByDay.forEach(day => {
        callCount += day.orderCount;
      });
    }
    totals.set(id, callCount);
  });

  return totals;
}

/** 쿠팡 rider_daily completeCount — 0.8/1 가중치 합(소수). 정수만 있으면 ×0.8 */
function coupangRealtimeCallUnits(complete) {
  const n = Math.max(0, Number(complete) || 0);
  if (n <= 0) return 0;
  if (!Number.isInteger(n)) return Math.round(n * 10) / 10;
  return Math.round(n * 0.8 * 10) / 10;
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
  const totals = await loadWeekCallTotalsForDrivers(
    supabase,
    riderIds,
    weekStart,
    weekEnd,
    region.platform
  );

  return riders
    .map(rider => ({
      driverId: rider.id,
      name: maskName(rider.name, mask),
      callCount: totals.get(String(rider.id)) || 0
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
  const mask = options.maskNames !== false;
  const rankingRiders = Array.isArray(options.rankingRiders)
    ? options.rankingRiders
    : (Array.isArray(options.regionRiders)
      ? options.regionRiders
      : await loadRidersForRegion(supabase, region));
  const vendorId = region.vendorId || '';
  const label = shortCoupangRegion(region.label || region.key);

  const baseQuery = () => supabase
    .from('coupang_collect_items')
    .select('vendor_id,vendor_name,parsed_json,source_menu,collect_date')
    .eq('collect_date', today)
    .in('source_menu', ['peak_realtime', 'vendor_info']);

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
        realtimeRanking: []
      };
    }
    throw error;
  }

  const regionRef = {
    key: vendorId || label,
    vendorId,
    label: shortCoupangRegionLabel(region.label || region.key || region.vendorName || ''),
    vendorName: region.vendorName || region.label || ''
  };

  const rows = (data || []).filter(row => {
    const parsed = row.parsed_json || {};
    return coupangVendorMatchesRegion(
      regionRef,
      row.vendor_id || parsed.vendorId,
      row.vendor_name || parsed.vendorName
    );
  });

  const peaksByType = {};
  let vendorInfo = null;
  let operating = 0;

  rows.forEach(row => {
    const parsed = row.parsed_json || {};
    if (row.source_menu === 'peak_realtime') {
      const peakType = String(parsed.peakType || '').toUpperCase();
      if (PEAK_ORDER.includes(peakType)) {
        peaksByType[peakType] = {
          goal: Math.max(0, Number(parsed.goalCount || 0)),
          completed: Math.max(0, Number(parsed.completedCount || 0))
        };
      }
    }
    if (row.source_menu === 'vendor_info') {
      vendorInfo = parsed;
      operating = Math.max(operating, Math.round(Number(parsed.riderOnLineCount || 0)));
    }
  });

  const peakKey = currentCoupangPeakKey();
  const peakLabel = PEAK_LABELS[peakKey] || peakKey;
  const currentPeak = peaksByType[peakKey];
  let assigned = 0;
  let slotComplete = 0;
  let remaining = 0;
  let metricsSource = '';

  if (currentPeak && currentPeak.goal > 0) {
    assigned = formatCoupangCount(currentPeak.goal);
    slotComplete = formatCoupangCount(currentPeak.completed);
    remaining = formatCoupangCount(Math.max(0, currentPeak.goal - currentPeak.completed));
    metricsSource = `피크 ${peakLabel}`;
  } else if (vendorInfo) {
    assigned = formatCoupangCount(vendorInfo.target || 0);
    slotComplete = formatCoupangCount(vendorInfo.completedCount || 0);
    remaining = formatCoupangCount(Math.max(0, assigned - slotComplete));
    metricsSource = '현재시프트';
  }

  const dailyBaseQuery = () => supabase
    .from('coupang_collect_items')
    .select('vendor_id,vendor_name,match_key,phone_number,courier_id,parsed_json,collect_date')
    .eq('collect_date', today)
    .eq('source_menu', 'rider_daily');

  let { data: dailyRows, error: dailyError } = vendorId
    ? await dailyBaseQuery().eq('vendor_id', vendorId).limit(5000)
    : await dailyBaseQuery().limit(5000);
  if (!dailyError && vendorId && !(dailyRows || []).length) {
    ({ data: dailyRows, error: dailyError } = await dailyBaseQuery().limit(5000));
  }

  let realtimeRanking = [];
  if (!dailyError) {
    const filteredDaily = (dailyRows || []).filter(row => {
      const parsed = row.parsed_json || {};
      return coupangVendorMatchesRegion(
        regionRef,
        row.vendor_id || parsed.vendorId,
        row.vendor_name || parsed.vendorName
      );
    });

    const lookup = buildCoupangLookup(rankingRiders.map(rider => ({
      id: rider.id,
      name: rider.name,
      phone: rider.phone || rider.raw_data?.phone || '',
      raw: rider.raw_data || {},
      coupangId: rider.raw_data?.coupangId || rider.raw_data?.coupangLoginKey || ''
    })));
    const rankingIds = new Set(rankingRiders.map(rider => rider.id));
    const rankingByDriver = new Map();

    filteredDaily.forEach(row => {
      const parsed = row.parsed_json || {};
      const driver = resolveDriver({
        matchKey: row.match_key || parsed.matchKey,
        phone: row.phone_number || parsed.phone
      }, lookup);
      if (!driver || !rankingIds.has(driver.id)) return;
      const complete = coupangRealtimeCallUnits(metricsFromParsed(parsed).complete);
      if (complete <= 0) return;
      const prev = rankingByDriver.get(driver.id);
      if (!prev || complete > prev.callCount) {
        rankingByDriver.set(driver.id, {
          driverId: driver.id,
          name: maskName(driver.name || parsed.name || '-', mask),
          callCount: complete
        });
      }
    });

    realtimeRanking = [...rankingByDriver.values()]
      .filter(row => row.callCount > 0)
      .sort((a, b) => b.callCount - a.callCount || a.name.localeCompare(b.name, 'ko'))
      .slice(0, 10)
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }

  const metricsNote = Object.keys(peaksByType).length
    ? `쿠팡 피크타임 현황 · 운행중 ${operating}명 · 실시간순위=rider_daily 0.8가중치`
    : metricsSource
      ? `쿠팡 ${metricsSource} ${coupangProgressLabel(slotComplete, assigned)} · 운행중 ${operating}명 · 실시간순위=rider_daily 0.8가중치`
      : '오늘 쿠팡 피크타임·지역요약 크롤링 데이터가 없습니다';

  const peaks = Object.fromEntries(PEAK_ORDER.map(pt => {
    const row = peaksByType[pt] || { goal: 0, completed: 0 };
    return [pt, {
      goal: formatCoupangCount(row.goal),
      completed: formatCoupangCount(row.completed),
      has: Boolean(peaksByType[pt])
    }];
  }));

  return {
    metrics: {
      assigned,
      slotComplete,
      operating,
      remaining,
      progressLabel: assigned > 0 ? coupangProgressLabel(slotComplete, assigned) : undefined,
      peakKey,
      peakLabel,
      peaks,
      collectDate: today,
      sourceNote: realtimeRanking.length
        ? `${metricsNote} · 지역등록 ${rankingRiders.length}명 중`
        : metricsNote
    },
    realtimeRanking
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
  // 미노출(hidden) 기사는 해당 지역 대시보드 자체를 숨긴다.
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
  const regions = filterViewerRegions(exposure, platform, riderRow, exposedAll);
  if (!regions.length) {
    const hasAnyExposure = exposedAll.length > 0;
    const hiddenOnly = hasAnyExposure && exposedAll.some(region =>
      riderMatchesRegion(riderRow, region)
      && getRiderRegionModeForRegion(exposure, region, riderRow.id) === 'hidden'
    );
    return {
      ok: true,
      platform,
      weekStart,
      weekEnd,
      today,
      regions: [],
      selectedRegionKey: '',
      region: null,
      viewerMode: hiddenOnly ? 'hidden' : 'full',
      dashboardHidden: hiddenOnly,
      metrics: emptyMetrics(),
      realtimeRanking: [],
      weeklyRanking: [],
      message: hiddenOnly
        ? '관리자가 이 계정의 기사대시보드를 미노출로 설정했습니다.'
        : hasAnyExposure
          ? '등록된 지역에 노출된 대시보드가 없습니다. 관리자 「기사지역관리」에서 본인 지역 등록·라이더 노출을 확인하세요.'
          : '관리자가 노출로 설정한 지역이 없습니다.'
    };
  }

  const selected = regions.find(region => region.key === requestedKey)
    || regions[0];

  const coupangDateInfo = platform === 'coupang'
    ? await resolveCoupangRiderDailyDate(supabase, today)
    : null;
  const liveDate = platform === 'coupang' ? coupangDateInfo.collectDate : today;
  const slotKey = platform === 'coupang' ? currentCoupangPeakKey() : currentBaeminSlotKey();
  const cacheKey = `rider|${me.riderId || riderRow.id || '-'}|${platform}|${selected.key}|${weekStart}|${liveDate}|${slotKey}`;
  const cached = readResponseCache(cacheKey);
  if (cached) {
    return { ...cached, regions, selectedRegionKey: selected.key, region: selected };
  }

  let live = { metrics: emptyMetrics(), realtimeRanking: [] };
  let weeklyRanking = [];
  const viewerMode = getRiderRegionModeForRegion(exposure, selected, riderRow.id);
  try {
    const regionRiders = await loadRidersForRegion(supabase, selected);
    // 팀장: 미노출·전체열람 포함 전원을 보되, 팀장 본인(및 다른 팀장)은 순위 목록에서 뺀다.
    // 일반: 올노출·할당만·미노출을 순위에 포함 (전체열람·팀장은 순위 비노출).
    const rankingRiders = viewerMode === 'leader'
      ? filterLeaderViewRankingRiders(exposure, selected, regionRiders)
      : filterRankingRiders(exposure, platform, selected.key, regionRiders, selected);
    const liveOpts = { regionRiders, rankingRiders };
    const weekOpts = { regionRiders, rankingRiders };
    [live, weeklyRanking] = await Promise.all([
      platform === 'coupang'
        ? buildCoupangLive(supabase, selected, liveDate, liveOpts)
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
    today: platform === 'coupang' ? liveDate : today,
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

  const cacheKey = `admin|${platform}|${region.key}|${weekStart}|${today}|nomask|${platform === 'coupang' ? currentCoupangPeakKey() : currentBaeminSlotKey()}`;
  const cached = readResponseCache(cacheKey);
  if (cached) return cached;

  try {
    const exposure = await readExposureMap(supabase);
    const regionRiders = await loadRidersForRegion(supabase, region);
    // 관리자 화면도 기사앱과 동일: 팀장·전체열람은 순위에서 제외 (미노출은 집계 포함)
    const rankingRiders = filterRankingRiders(exposure, platform, region.key, regionRiders, region);
    const shared = { maskNames: false, regionRiders, rankingRiders };
    const coupangDateInfo = platform === 'coupang'
      ? await resolveCoupangRiderDailyDate(supabase, today)
      : null;
    const liveDate = platform === 'coupang' ? coupangDateInfo.collectDate : today;
    const [live, weeklyRanking] = await Promise.all([
      platform === 'coupang'
        ? buildCoupangLive(supabase, region, liveDate, shared)
        : buildBaeminLive(supabase, region, today, shared),
      buildWeeklyRanking(supabase, region, weekStart, weekEnd, shared)
    ]);
    const payload = {
      ok: true,
      platform,
      today: platform === 'coupang' ? liveDate : today,
      weekStart,
      weekEnd,
      region,
      registeredCount: regionRiders.length,
      rankingCount: rankingRiders.length,
      metrics: live.metrics,
      realtimeRanking: live.realtimeRanking || [],
      realtimeRankingDisabled: live.realtimeRankingDisabled === true,
      realtimeRankingReason: live.realtimeRankingReason || '',
      weeklyRanking: weeklyRanking || [],
      realtimeFirst: (live.realtimeRanking || [])[0] || null,
      weeklyFirst: (weeklyRanking || [])[0] || null,
      collectDate: platform === 'coupang' ? liveDate : today,
      dateNote: platform === 'coupang' && coupangDateInfo?.fallback
        ? `rider_daily ${liveDate} (오늘 ${coupangDateInfo.requestedDate} 수집분 없음)`
        : ''
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
 * 선택 쿠팡 지역의 오늘 rider_daily 크롤 ↔ ERP 기사 매칭 미리보기.
 */
async function getAdminRegionCoupangCrawlMatch(accessToken, query = {}) {
  const { verifyAdminCaller } = require('./admin-users');
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const vendorId = String(query.vendorId || '').trim();
  const label = String(query.label || query.regionKey || '').trim();
  const short = shortCoupangRegion(label);
  if (!vendorId && !short) {
    return { ok: false, status: 400, error: '쿠팡 vendorId 또는 지역명이 필요합니다.' };
  }

  const dateInfo = await resolveCoupangRiderDailyDate(supabase, query.date || '');
  const collectDate = dateInfo.collectDate;
  const baseQuery = () => supabase
    .from('coupang_collect_items')
    .select('vendor_id,vendor_name,match_key,phone_number,courier_id,rider_name,parsed_json,collect_date')
    .eq('collect_date', collectDate)
    .eq('source_menu', 'rider_daily');

  let { data: crawlRows, error: crawlError } = vendorId
    ? await baseQuery().eq('vendor_id', vendorId).limit(5000)
    : await baseQuery().limit(5000);
  if (!crawlError && vendorId && !(crawlRows || []).length) {
    ({ data: crawlRows, error: crawlError } = await baseQuery().limit(5000));
  }
  if (crawlError) {
    return { ok: false, status: 500, error: crawlError.message || '쿠팡 라이더일일 크롤을 불러오지 못했습니다.' };
  }

  const targetRegion = { key: vendorId || short, vendorId, label: short || label, vendorName: label };
  const rowsFiltered = (crawlRows || []).filter(row => {
    const parsed = row.parsed_json || {};
    return coupangVendorMatchesRegion(targetRegion, row.vendor_id || parsed.vendorId, row.vendor_name || parsed.vendorName);
  });

  const { data: riderRows, error: riderError } = await supabase
    .from('riders')
    .select('id,name,phone,baemin_id,raw_data')
    .limit(8000);
  if (riderError) {
    return { ok: false, status: 500, error: riderError.message || '기사 목록을 불러오지 못했습니다.' };
  }

  const drivers = (riderRows || []).map(row => {
    const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
    return {
      id: String(row.id || ''),
      name: String(row.name || raw.name || ''),
      phone: String(row.phone || raw.phone || ''),
      coupangId: String(raw.coupangId || raw.coupangLoginKey || ''),
      coupangLoginKey: String(raw.coupangLoginKey || ''),
      regionCoupang: String(raw.regionCoupang || '').trim(),
      raw
    };
  }).filter(driver => driver.id);

  const lookup = buildCoupangLookup(drivers);

  function regionMatchesTarget(regionValue) {
    const value = String(regionValue || '').trim();
    if (!value) return false;
    if (value === targetRegion.vendorId || value === targetRegion.label) return true;
    if (targetRegion.vendorName && value === targetRegion.vendorName) return true;
    const valueShort = shortCoupangRegionLabel(value);
    const targetShort = shortCoupangRegionLabel(targetRegion.label || targetRegion.vendorName || '');
    return Boolean(valueShort && targetShort && valueShort === targetShort);
  }

  const seen = new Set();
  const rows = [];
  rowsFiltered.forEach(row => {
    const parsed = row.parsed_json || {};
    const matchKey = String(row.match_key || parsed.matchKey || '').trim();
    const courierId = String(row.courier_id || parsed.courierId || '').trim();
    const identity = matchKey || courierId;
    if (!identity || seen.has(identity)) return;
    seen.add(identity);

    const crawlName = String(
      row.rider_name || parsed.name || parsed.riderName || ''
    ).trim();
    const phone = String(row.phone_number || parsed.phone || '').trim();
    const driver = resolveDriver({ matchKey, phone, courierId }, lookup);
    const currentRegion = driver ? String(driver.regionCoupang || '').trim() : '';

    let status = 'unregistered';
    if (driver) {
      status = regionMatchesTarget(currentRegion) ? 'already' : 'assignable';
    }

    rows.push({
      matchKey,
      coupangId: courierId || matchKey,
      crawlName: crawlName || '-',
      phone,
      driverId: driver?.id || '',
      driverName: driver?.name || '',
      currentRegion,
      status,
      targetRegion: short || label
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
    platform: 'coupang',
    vendorId,
    label: short || label,
    today: collectDate,
    collectDate,
    snapshotDate: collectDate,
    dateNote: dateInfo.fallback
      ? `rider_daily ${collectDate} (요청일 ${dateInfo.requestedDate} 수집분 없음)`
      : '',
    summary,
    rows
  };
}

/**
 * 선택 DP의 오늘 배달현황 크롤 ↔ 전체 ERP 배민ID 매칭 미리보기.
 * 기사지역관리 「크롤링으로 지역등록」용.
 */
async function getAdminRegionCrawlMatch(accessToken, query = {}) {
  const platform = normalizePlatform(query.platform || 'baemin');
  if (platform === 'coupang') {
    return getAdminRegionCoupangCrawlMatch(accessToken, query);
  }
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

/**
 * 쿠팡 rider_daily 크롤의 vendor(클러스터)별 ERP 기사 자동 배정 미리보기.
 * 지역별 수집 없이 한 번에 받은 rider_daily 에 vendorId/vendorName 이 있으면
 * 4글자 클러스터(울산남 등)로 묶어 배정 후보를 만든다.
 */
async function getAdminCoupangClusterCrawlAssign(accessToken, query = {}) {
  const { verifyAdminCaller } = require('./admin-users');
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const dateInfo = await resolveCoupangRiderDailyDate(supabase, query.date || '');
  const collectDate = dateInfo.collectDate;
  const { data: crawlRows, error: crawlError } = await supabase
    .from('coupang_collect_items')
    .select('vendor_id,vendor_name,match_key,phone_number,courier_id,rider_name,parsed_json,collect_date')
    .eq('collect_date', collectDate)
    .eq('source_menu', 'rider_daily')
    .limit(20000);
  if (crawlError) {
    return { ok: false, status: 500, error: crawlError.message || '쿠팡 라이더일일 크롤을 불러오지 못했습니다.' };
  }

  const { data: riderRows, error: riderError } = await supabase
    .from('riders')
    .select('id,name,phone,baemin_id,raw_data')
    .limit(8000);
  if (riderError) {
    return { ok: false, status: 500, error: riderError.message || '기사 목록을 불러오지 못했습니다.' };
  }

  const drivers = (riderRows || []).map(row => {
    const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
    return {
      id: String(row.id || ''),
      name: String(row.name || raw.name || ''),
      phone: String(row.phone || raw.phone || ''),
      coupangId: String(raw.coupangId || raw.coupangLoginKey || ''),
      coupangLoginKey: String(raw.coupangLoginKey || ''),
      regionCoupang: String(raw.regionCoupang || '').trim(),
      raw
    };
  }).filter(driver => driver.id);

  const lookup = buildCoupangLookup(drivers);
  const bestByDriver = new Map();
  const noVendorRows = [];
  const unregistered = [];

  (crawlRows || []).forEach(row => {
    const parsed = row.parsed_json || {};
    const vendorId = String(row.vendor_id || parsed.vendorId || '').trim();
    const vendorName = String(row.vendor_name || parsed.vendorName || '').trim();
    const cluster = shortCoupangRegionLabel(vendorName) || '';
    const matchKey = String(row.match_key || parsed.matchKey || '').trim();
    const courierId = String(row.courier_id || parsed.courierId || '').trim();
    const crawlName = String(row.rider_name || parsed.name || parsed.riderName || '').trim();
    const phone = String(row.phone_number || parsed.phone || '').trim();
    const completeCount = metricsFromParsed(parsed).complete;

    if (!cluster) {
      noVendorRows.push({
        matchKey,
        coupangId: courierId || matchKey,
        crawlName: crawlName || '-',
        phone,
        completeCount: Math.round(completeCount * 10) / 10
      });
      return;
    }

    const driver = resolveDriver({ matchKey, phone, courierId }, lookup);
    if (!driver) {
      unregistered.push({
        cluster,
        vendorId,
        vendorName,
        matchKey,
        coupangId: courierId || matchKey,
        crawlName: crawlName || '-',
        phone,
        completeCount: Math.round(completeCount * 10) / 10
      });
      return;
    }

    const prev = bestByDriver.get(driver.id);
    if (!prev || completeCount > prev.completeCount) {
      bestByDriver.set(driver.id, {
        driverId: driver.id,
        driverName: driver.name || crawlName || '-',
        currentRegion: String(driver.regionCoupang || '').trim(),
        cluster,
        vendorId,
        vendorName,
        completeCount: Math.round(completeCount * 10) / 10,
        crawlName: crawlName || '-'
      });
    }
  });

  const assignments = [];
  const clusterMap = new Map();

  bestByDriver.forEach(entry => {
    const currentShort = shortCoupangRegionLabel(entry.currentRegion);
    const status = currentShort === entry.cluster ? 'already' : 'assignable';
    const row = { ...entry, status, targetRegion: entry.cluster };
    assignments.push(row);

    if (!clusterMap.has(entry.cluster)) {
      clusterMap.set(entry.cluster, {
        key: entry.cluster,
        label: entry.cluster,
        vendorId: entry.vendorId,
        vendorName: entry.vendorName,
        assignable: 0,
        already: 0,
        rows: []
      });
    }
    const bucket = clusterMap.get(entry.cluster);
    bucket.rows.push(row);
    if (status === 'assignable') bucket.assignable += 1;
    else bucket.already += 1;
    if (!bucket.vendorId && entry.vendorId) bucket.vendorId = entry.vendorId;
    if (!bucket.vendorName && entry.vendorName) bucket.vendorName = entry.vendorName;
  });

  const clusters = [...clusterMap.values()]
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));

  const summary = {
    crawlTotal: (crawlRows || []).length,
    matchedDrivers: assignments.length,
    assignable: assignments.filter(r => r.status === 'assignable').length,
    already: assignments.filter(r => r.status === 'already').length,
    unregistered: unregistered.length,
    noVendor: noVendorRows.length,
    clusterCount: clusters.length
  };

  return {
    ok: true,
    platform: 'coupang',
    today: collectDate,
    collectDate,
    dateNote: dateInfo.fallback
      ? `rider_daily ${collectDate} (요청일 ${dateInfo.requestedDate} 수집분 없음 · 쿠팡 영업일 06시 기준)`
      : `rider_daily ${collectDate}`,
    summary,
    clusters,
    assignments,
    unregistered,
    noVendorRows
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

  // 기사별 옵션 저장 (기본=올노출).
  // - driverId: 단건
  // - driverIds: 일괄 (전체 올노출/미노출 등)
  const driverIdsBulk = Array.isArray(body.driverIds)
    ? body.driverIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const driverId = String(body.driverId || '').trim();
  if (driverId || driverIdsBulk.length) {
    try {
      const exposure = await readExposureMap(supabase);
      const side = { ...(exposure[platform] || {}) };
      const prev = side[key] && typeof side[key] === 'object' ? side[key] : {};
      const riders = { ...(prev.riders && typeof prev.riders === 'object' ? prev.riders : {}) };
      const mode = normalizeRiderRegionMode(body.mode);
      const targets = driverIdsBulk.length ? driverIdsBulk : [driverId];
      const now = new Date().toISOString();
      targets.forEach(id => {
        if (mode === DEFAULT_RIDER_REGION_MODE) {
          // 기본값(미노출)은 맵에서 지워 용량을 줄인다. 조회 시 기본값으로 되돌아온다.
          // ※ 올노출은 반드시 명시 저장해야 한다. 지우면 기본값인 미노출이 되어버린다.
          delete riders[id];
        } else {
          riders[id] = {
            mode, // dashboard | metrics | leader | hidden
            updatedAt: now
          };
        }
      });
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
        updatedAt: now
      };
      // 지역 미노출인데 기사 옵션만 저장해도 riders 는 유지 (나중에 지역 ON 해도 유지)
      if (!side[key].exposed && !Object.keys(riders).length) {
        delete side[key];
      }
      const next = await upsertExposureMap(supabase, {
        ...exposure,
        [platform]: side,
        updatedAt: now
      });
      return { ok: true, exposure: next, updatedCount: targets.length };
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
  DEFAULT_RIDER_REGION_MODE,
  getRiderRegionDashboard,
  getAdminRegionRanking,
  getAdminRegionCrawlMatch,
  getAdminCoupangClusterCrawlAssign,
  getAdminRegionExposure,
  saveAdminRegionExposure,
  // 기본값 변경 검증용 (scripts/_test-region-mode-default.js)
  __test: {
    normalizeRiderRegionMode,
    getRiderRegionMode,
    getRiderRegionModeForRegion,
    filterRankingRiders,
    filterLeaderViewRankingRiders,
    filterViewerRegions
  }
};
