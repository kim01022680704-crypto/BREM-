/**
 * 쿠팡 수집(coupang_collect_items) → admin_rejection_rates 서버 동기화
 */
const { getServiceClient } = require('./admin-bootstrap');
const { settlementWeekStart, todayKST, latestQueryableDate, settlementWeekEnd } = require('./baemin-settlement-week');

const PROTECTED_SOURCES = new Set(['manual', 'erp-bulk', 'erp']);
const SYNC_SOURCE = 'coupang_crawl_sync';

function normalizeCoupangKey(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function getErpCoupangId(driver) {
  const raw = driver.raw && typeof driver.raw === 'object' ? driver.raw : {};
  return String(
    driver.coupangId
    || raw.coupangId
    || raw.coupangLoginKey
    || driver.coupang_id
    || ''
  ).replace(/\s+/g, '');
}

function buildCoupangLookup(drivers) {
  const byKey = new Map();
  (drivers || []).forEach(driver => {
    const key = normalizeCoupangKey(getErpCoupangId(driver));
    if (key && !byKey.has(key)) byKey.set(key, driver);
  });
  return { byKey };
}

function calcRejectRate(complete, reject, cancel) {
  const c = Math.max(0, Number(complete || 0));
  const r = Math.max(0, Number(reject || 0));
  const x = Math.max(0, Number(cancel || 0));
  const denom = c + r + x;
  if (denom <= 0) return null;
  return Math.round(((r + x) / denom) * 1000) / 10;
}

function metricsFromParsed(parsed = {}) {
  return {
    complete: Math.max(0, Number(
      parsed.completeCount ?? parsed.complete ?? parsed.totalComplete ?? parsed.completedCount ?? 0
    ) || 0),
    reject: Math.max(0, Number(
      parsed.rejectCount ?? parsed.reject ?? parsed.rejectedCount ?? 0
    ) || 0),
    cancel: Math.max(0, Number(
      parsed.cancelCount ?? parsed.cancel ?? parsed.canceledCount ?? parsed.cancelledCount ?? 0
    ) || 0)
  };
}

async function loadDrivers(supabase) {
  const { data, error } = await supabase
    .from('riders')
    .select('id,name,phone,baemin_id,raw_data')
    .limit(20000);
  if (error) throw new Error(error.message || '기사 목록 조회 실패');
  return (data || []).map(row => {
    const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
    return {
      id: String(row.id || ''),
      name: String(row.name || raw.name || ''),
      phone: String(row.phone || raw.phone || ''),
      coupangId: String(raw.coupangId || raw.coupangLoginKey || ''),
      raw
    };
  }).filter(d => d.id);
}

async function loadCoupangRiderDaily(supabase, fromDate, toDate) {
  const { data, error } = await supabase
    .from('coupang_collect_items')
    .select('collect_date,match_key,rider_name,phone_number,courier_id,parsed_json,source_menu')
    .in('source_menu', ['rider_daily', 'peak_realtime', 'rider_weekly'])
    .gte('collect_date', fromDate)
    .lte('collect_date', toDate)
    .limit(20000);
  if (error) throw new Error(error.message || '쿠팡 수집 조회 실패');
  return data || [];
}

async function syncCoupangRejections(options = {}) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, message: 'SUPABASE_SERVICE_ROLE_KEY 가 없습니다.' };
  }

  const today = todayKST();
  const latest = latestQueryableDate(today) || today;
  // 수요일 전주 포함: 어제(조회가능일)가 속한 주
  const weekStart = String(options.weekStart || settlementWeekStart(latest)).slice(0, 10);
  const weekEnd = String(options.weekEnd || settlementWeekEnd(weekStart) || latest).slice(0, 10);
  const fromDate = weekStart;
  const toDate = latest < weekEnd ? latest : weekEnd;

  const [drivers, rows] = await Promise.all([
    loadDrivers(supabase),
    loadCoupangRiderDaily(supabase, fromDate, toDate)
  ]);
  const lookup = buildCoupangLookup(drivers);

  const byRider = new Map();
  rows.forEach(row => {
    const matchKey = normalizeCoupangKey(row.match_key || row.courier_id || '');
    if (!matchKey) return;
    const m = metricsFromParsed(row.parsed_json || {});
    const prev = byRider.get(matchKey) || {
      matchKey,
      name: row.rider_name || '',
      complete: 0,
      reject: 0,
      cancel: 0
    };
    prev.complete += m.complete;
    prev.reject += m.reject;
    prev.cancel += m.cancel;
    if (row.rider_name) prev.name = row.rider_name;
    byRider.set(matchKey, prev);
  });

  const { data: existingRows, error: existingError } = await supabase
    .from('admin_rejection_rates')
    .select('id,driver_id,week_start,platform,source,rider_published_at')
    .eq('platform', 'coupang')
    .eq('week_start', weekStart);
  if (existingError) throw new Error(existingError.message || '거절율 조회 실패');
  const existingMap = new Map((existingRows || []).map(row => [`${row.driver_id}|${row.week_start}`, row]));

  const now = new Date().toISOString();
  const upserts = [];
  let unmatched = 0;
  let protectedCount = 0;
  let skipped = 0;

  byRider.forEach(rider => {
    const rate = calcRejectRate(rider.complete, rider.reject, rider.cancel);
    if (rate == null) {
      skipped += 1;
      return;
    }
    const driver = lookup.byKey.get(rider.matchKey) || null;
    if (!driver?.id) {
      unmatched += 1;
      return;
    }
    const existing = existingMap.get(`${driver.id}|${weekStart}`);
    const source = String(existing?.source || '').toLowerCase();
    if (existing && PROTECTED_SOURCES.has(source)) {
      protectedCount += 1;
      return;
    }
    upserts.push({
      id: `${driver.id}-${weekStart}-coupang`,
      driver_id: driver.id,
      week_start: weekStart,
      platform: 'coupang',
      rate: Number(rate),
      source: SYNC_SOURCE,
      stats: {
        completeCount: rider.complete,
        rejectCount: rider.reject,
        cancelCount: rider.cancel,
        unmeasured: false
      },
      updated_at: now,
      rider_published_at: existing?.rider_published_at || null
    });
  });

  if (upserts.length) {
    const { error } = await supabase.from('admin_rejection_rates').upsert(upserts, { onConflict: 'id' });
    if (error) throw new Error(error.message || '쿠팡 거절율 저장 실패');
  }

  return {
    ok: true,
    weekStart,
    fromDate,
    toDate,
    rejectionsUpserted: upserts.length,
    unmatched,
    protected: protectedCount,
    skipped,
    riderCount: byRider.size
  };
}

module.exports = {
  syncCoupangRejections,
  calcRejectRate,
  metricsFromParsed
};
