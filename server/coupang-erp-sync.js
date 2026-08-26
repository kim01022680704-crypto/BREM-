/**
 * 쿠팡 수집(coupang_collect_items) → admin_rejection_rates 서버 동기화
 * ERP 매칭은 관리자 UI와 동일: 이름+전화뒤4 / 커스텀 쿠팡ID / 전화 유일
 */
const { getServiceClient } = require('./admin-bootstrap');
const { settlementWeekStart, todayKST, settlementWeekEnd } = require('./baemin-settlement-week');
const { fetchAllPages, upsertInChunks } = require('./supabase-paginate');

const PROTECTED_SOURCES = new Set(['manual', 'erp-bulk', 'erp']);
const SYNC_SOURCE = 'coupang_crawl_sync';

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function normalizeCoupangKey(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function makeDriverLoginId(driver) {
  const name = String(driver?.name || '').replace(/\s+/g, '');
  const tail = normalizePhone(driver?.phone).slice(-4);
  return name && tail ? `${name}${tail}` : '';
}

/** ERP 쿠팡ID — 커스텀 키 우선, 없으면 이름+전화뒤4 (UI getErpCoupangId 와 동일) */
function getErpCoupangId(driver) {
  const raw = driver.raw && typeof driver.raw === 'object' ? driver.raw : {};
  const custom = String(
    driver.coupangId
    || driver.coupangLoginKey
    || raw.coupangId
    || raw.coupangLoginKey
    || driver.coupang_id
    || ''
  ).replace(/\s+/g, '');
  if (custom) return custom;
  return makeDriverLoginId(driver);
}

function buildCoupangLookup(drivers) {
  const byKey = new Map();
  const byPhone = new Map();
  (drivers || []).forEach(driver => {
    const loginId = normalizeCoupangKey(makeDriverLoginId(driver));
    const erpId = normalizeCoupangKey(getErpCoupangId(driver));
    if (loginId && !byKey.has(loginId)) byKey.set(loginId, driver);
    if (erpId && !byKey.has(erpId)) byKey.set(erpId, driver);

    const phone = normalizePhone(driver.phone);
    if (phone) {
      if (!byPhone.has(phone)) byPhone.set(phone, []);
      byPhone.get(phone).push(driver);
    }
  });
  return { byKey, byPhone };
}

function resolveDriver(rider, lookup) {
  const matchKey = normalizeCoupangKey(rider.matchKey || '');
  if (matchKey && lookup.byKey.has(matchKey)) {
    return lookup.byKey.get(matchKey);
  }
  const phone = normalizePhone(rider.phone || '');
  if (phone) {
    const cands = lookup.byPhone.get(phone) || [];
    if (cands.length === 1) return cands[0];
  }
  return null;
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
  const data = await fetchAllPages((offset, pageSize) => supabase
    .from('riders')
    .select('id,name,phone,baemin_id,raw_data')
    .order('id', { ascending: true })
    .range(offset, offset + pageSize - 1), { pageSize: 1000 });
  return (data || []).map(row => {
    const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
    return {
      id: String(row.id || ''),
      name: String(row.name || raw.name || ''),
      phone: String(row.phone || raw.phone || ''),
      coupangId: String(raw.coupangId || raw.coupangLoginKey || ''),
      coupangLoginKey: String(raw.coupangLoginKey || ''),
      raw
    };
  }).filter(d => d.id);
}

async function loadCoupangRiderDaily(supabase, fromDate, toDate) {
  // UI와 동일: rider_daily만 합산 (peak_realtime 중복 방지) — 페이지로 전체 수집
  return fetchAllPages((offset, pageSize) => supabase
    .from('coupang_collect_items')
    .select('collect_date,match_key,rider_name,phone_number,courier_id,parsed_json,source_menu')
    .eq('source_menu', 'rider_daily')
    .gte('collect_date', fromDate)
    .lte('collect_date', toDate)
    .order('collect_date', { ascending: true })
    .range(offset, offset + pageSize - 1), { pageSize: 1000 });
}

async function syncCoupangRejections(options = {}) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, message: 'SUPABASE_SERVICE_ROLE_KEY 가 없습니다.' };
  }

  const today = todayKST();
  // 쿠팡은 당일 rider_daily 수집 가능 → 배민 latestQueryable(어제)로 weekEnd를 자르지 않음
  const weekStart = String(options.weekStart || settlementWeekStart(today)).slice(0, 10);
  const weekEnd = settlementWeekEnd(weekStart);
  const fromDate = weekStart;
  const toDate = today < weekEnd ? today : weekEnd;

  const [drivers, rows] = await Promise.all([
    loadDrivers(supabase),
    loadCoupangRiderDaily(supabase, fromDate, toDate)
  ]);
  const lookup = buildCoupangLookup(drivers);

  const byRider = new Map();
  rows.forEach(row => {
    const matchKey = normalizeCoupangKey(row.match_key || '');
    const phone = normalizePhone(row.phone_number || row.parsed_json?.phone || '');
    const identity = matchKey || (phone ? `phone:${phone}` : '') || normalizeCoupangKey(row.courier_id || '');
    if (!identity) return;
    const m = metricsFromParsed(row.parsed_json || {});
    const prev = byRider.get(identity) || {
      matchKey: matchKey || identity,
      name: row.rider_name || '',
      phone,
      complete: 0,
      reject: 0,
      cancel: 0
    };
    prev.complete += m.complete;
    prev.reject += m.reject;
    prev.cancel += m.cancel;
    if (row.rider_name) prev.name = row.rider_name;
    if (phone) prev.phone = phone;
    if (matchKey) prev.matchKey = matchKey;
    byRider.set(identity, prev);
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
    const driver = resolveDriver(rider, lookup);
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
    await upsertInChunks(supabase, 'admin_rejection_rates', upserts, {
      chunkSize: 400,
      onConflict: 'id'
    });
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
  metricsFromParsed,
  getErpCoupangId,
  makeDriverLoginId,
  buildCoupangLookup,
  resolveDriver,
  normalizeCoupangKey
};
