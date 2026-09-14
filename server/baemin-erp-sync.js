/**
 * 배민 수집(applied) → admin_calls / admin_rejection_rates 서버 동기화
 * (관리자 「콜수입력/거절율입력」과 동일 규칙, 브라우저 불필요)
 */
const { getServiceClient } = require('./admin-bootstrap');
const { getRiderHistoryRangeForAdmin } = require('./baemin-collect-pipeline');
const { settlementWeekStart, todayKST, latestQueryableDate } = require('./baemin-settlement-week');
const { fetchAllPages, upsertInChunks } = require('./supabase-paginate');

const PROTECTED_REJECTION_SOURCES = new Set(['manual', 'erp-bulk', 'erp']);
const SYNC_SOURCE_PAST = 'baemin_biz_sync';
const SYNC_SOURCE_LIVE = 'baemin_biz_live';

function normalizeBaeminId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d+)\.0+$/);
  return m ? m[1] : raw;
}

function baeminIdMatchKey(value) {
  const v = normalizeBaeminId(value).replace(/\s+/g, '');
  if (!v) return '';
  return /^\d+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v.toLowerCase();
}

const METRIC_KEYS = [
  'complete',
  'foodReject', 'bmartReject', 'storeReject',
  'foodCancel', 'bmartCancel', 'storeCancel',
  'foodRiderFault', 'bmartRiderFault', 'storeRiderFault'
];

function extractMetrics(parsed = {}) {
  // 콜수입력 기준 = 화면 「총 배달완료」(allDayComplete). SLA 합계(totalComplete)보다 우선.
  const complete = Math.max(0, Number(
    parsed.allDayComplete
    ?? parsed.completeTotal
    ?? parsed.totalComplete
    ?? parsed.completeCount
    ?? 0
  ) || 0);
  const n = v => Math.max(0, Number(v || 0) || 0);
  // 거절/배차취소/라이더귀책을 서비스(푸드·비마트·스토어)별로 모두 보존해 상세 집계가 가능하게 한다.
  return {
    complete,
    foodReject: n(parsed.foodReject),
    bmartReject: n(parsed.bmartReject),
    storeReject: n(parsed.storeReject),
    foodCancel: n(parsed.foodCancel),
    bmartCancel: n(parsed.bmartCancel),
    storeCancel: n(parsed.storeCancel),
    foodRiderFault: n(parsed.foodRiderFault),
    bmartRiderFault: n(parsed.bmartRiderFault),
    storeRiderFault: n(parsed.storeRiderFault)
  };
}

function mergeMetrics(a = {}, b = {}) {
  const out = {};
  for (const k of METRIC_KEYS) out[k] = Number(a[k] || 0) + Number(b[k] || 0);
  return out;
}

// 배민 거절/수락율 규칙: 「푸드(음식배달)」만 집계에 포함. 비마트·스토어는 상세 표시용일 뿐 수락율/거절 합계에 미포함.
function calcAcceptRate(metrics = {}) {
  const complete = Number(metrics.complete || 0);
  const deny = Number(metrics.foodReject || 0)
    + Number(metrics.foodCancel || 0)
    + Number(metrics.foodRiderFault || 0);
  const denom = complete + deny;
  if (denom <= 0) return null;
  return Math.round((100 - (deny / denom) * 100) * 10) / 10;
}

/**
 * 거절율 stats
 *  - 헤드라인(거절/취소/귀책 합계·수락율) = 푸드 기준 (원래 규칙 유지)
 *  - 서비스별 상세(rejectByService 등) = 크롤 원본 푸드/비마트/스토어 표시용
 *    (total 키를 넣지 않아 renderRateDetail 헤드라인은 rejectCount(=푸드)로 폴백됨)
 */
function buildRejectionStats(metrics = {}) {
  const m = k => Number(metrics[k] || 0);
  return {
    completeTotal: m('complete'),
    rejectCount: m('foodReject'),
    dispatchCancelCount: m('foodCancel'),
    riderCancelCount: m('foodRiderFault'),
    rejectByService: { food: m('foodReject'), bmart: m('bmartReject'), store: m('storeReject') },
    dispatchCancelByService: { food: m('foodCancel'), bmart: m('bmartCancel'), store: m('storeCancel') },
    riderFaultByService: { food: m('foodRiderFault'), bmart: m('bmartRiderFault'), store: m('storeRiderFault') },
    unmeasured: false
  };
}

function resolveRiderBusinessDate(row = {}) {
  const parts = String(row.dedupe_key || '').split(':');
  const a = String(parts[1] || '').slice(0, 10);
  const b = String(parts[2] || '').slice(0, 10);
  const isPerDay = parts.length >= 4
    && parts[parts.length - 1] === 'rider'
    && /^\d{4}-\d{2}-\d{2}$/.test(a);
  if (isPerDay) return { date: a, period: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b) && a !== b) {
    return { date: '', period: true, periodFrom: a, periodTo: b };
  }
  const parsed = row.parsed_json || {};
  const fromParsed = String(parsed.businessDate || parsed.deliveryDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromParsed)) return { date: fromParsed, period: false };
  for (const part of parts) {
    const day = String(part || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return { date: day, period: false };
  }
  return { date: '', period: false };
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
      baeminId: String(row.baemin_id || raw.baeminId || '')
    };
  }).filter(d => d.id);
}

function buildBaeminIdDriverMap(drivers) {
  const map = new Map();
  (drivers || []).forEach(driver => {
    const key = baeminIdMatchKey(driver.baeminId);
    if (key && !map.has(key)) map.set(key, driver);
  });
  return map;
}

function matchDriverByBaeminId(baeminId, driversOrMap) {
  const key = baeminIdMatchKey(baeminId);
  if (!key) return null;
  if (driversOrMap instanceof Map) return driversOrMap.get(key) || null;
  return (driversOrMap || []).find(driver => baeminIdMatchKey(driver.baeminId) === key) || null;
}

async function upsertCallRows(supabase, rows) {
  return upsertInChunks(supabase, 'admin_calls', rows, { chunkSize: 400, onConflict: 'id' });
}

async function upsertRejectionRows(supabase, rows) {
  return upsertInChunks(supabase, 'admin_rejection_rates', rows, { chunkSize: 400, onConflict: 'id' });
}

async function loadProtectedRejectionMap(supabase, weekStarts) {
  const map = new Map();
  const weeks = [...new Set((weekStarts || []).filter(Boolean))];
  if (!weeks.length) return map;
  const { data, error } = await supabase
    .from('admin_rejection_rates')
    .select('id,driver_id,week_start,platform,source,rate,rider_published_at')
    .eq('platform', 'baemin')
    .in('week_start', weeks);
  if (error) throw new Error(error.message || '거절율 조회 실패');
  (data || []).forEach(row => {
    const key = `${row.driver_id}|${row.week_start}|baemin`;
    map.set(key, row);
  });
  return map;
}

async function loadExistingCallsMap(supabase, dates) {
  const map = new Map();
  const days = [...new Set((dates || []).filter(Boolean))];
  if (!days.length) return map;
  const { data, error } = await supabase
    .from('admin_calls')
    .select('id,driver_id,date,platform,rider_published_at')
    .eq('platform', 'baemin')
    .in('date', days);
  if (error) throw new Error(error.message || '콜수 조회 실패');
  (data || []).forEach(row => map.set(row.id, row));
  return map;
}

function weekStartsBetween(fromDate, toDate) {
  const out = [];
  let cursor = settlementWeekStart(fromDate);
  const end = String(toDate || '').slice(0, 10);
  let guard = 0;
  while (cursor && cursor <= end && guard < 20) {
    out.push(cursor);
    const d = new Date(`${cursor}T00:00:00`);
    d.setDate(d.getDate() + 7);
    cursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    guard += 1;
  }
  return out;
}

async function syncBaeminCallsAndRejections(options = {}) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, message: 'SUPABASE_SERVICE_ROLE_KEY 가 없습니다.' };
  }

  const today = todayKST();
  const latest = latestQueryableDate(today) || today;
  const fromDate = String(options.fromDate || settlementWeekStart(latest)).slice(0, 10);
  const toDate = String(options.toDate || latest).slice(0, 10);
  const mode = String(options.mode || 'all'); // calls | rejection | all

  const fetched = await getRiderHistoryRangeForAdmin({
    fromDate,
    toDate,
    compact: true,
    skipScopeCheck: true
  });
  if (!fetched.ok) {
    return { ok: false, message: fetched.message || fetched.error || '라이더 내역 조회 실패', notApplied: fetched.notApplied };
  }

  const items = Array.isArray(fetched.items) ? fetched.items : [];
  const drivers = await loadDrivers(supabase);
  const driverByBaeminId = buildBaeminIdDriverMap(drivers);
  const summary = {
    fromDate,
    toDate,
    weekStarts: weekStartsBetween(fromDate, toDate),
    callsUpserted: 0,
    rejectionsUpserted: 0,
    unmatched: 0,
    protected: 0,
    skipped: 0
  };

  // ---- calls ----
  if (mode === 'all' || mode === 'calls') {
    const byDayDriver = new Map();
    items.forEach(row => {
      const resolved = resolveRiderBusinessDate(row);
      if (resolved.period || !resolved.date) return;
      const complete = extractMetrics(row.parsed_json).complete;
      if (!(complete > 0)) return;
      const baeminId = normalizeBaeminId(row.rider_user_id);
      const driver = matchDriverByBaeminId(baeminId, driverByBaeminId);
      if (!driver?.id) {
        summary.unmatched += 1;
        return;
      }
      const key = `${driver.id}|${resolved.date}`;
      const prev = byDayDriver.get(key) || { driverId: driver.id, date: resolved.date, count: 0 };
      prev.count += complete;
      byDayDriver.set(key, prev);
    });

    const dates = [...new Set([...byDayDriver.values()].map(r => r.date))];
    const existing = await loadExistingCallsMap(supabase, dates);
    const now = new Date().toISOString();
    const callRows = [...byDayDriver.values()].map(entry => {
      const id = `${entry.driverId}-${entry.date}-baemin`;
      const prev = existing.get(id);
      return {
        id,
        driver_id: entry.driverId,
        date: entry.date,
        platform: 'baemin',
        count: entry.count,
        updated_at: now,
        rider_published_at: prev?.rider_published_at || null
      };
    });
    summary.callsUpserted = await upsertCallRows(supabase, callRows);
  }

  // ---- rejections (past + live for current week) ----
  if (mode === 'all' || mode === 'rejection') {
    const byRiderWeek = new Map();
    items.forEach(row => {
      const resolved = resolveRiderBusinessDate(row);
      const day = resolved.date || String(row.collect_date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
      const weekStart = settlementWeekStart(day);
      const baeminId = normalizeBaeminId(row.rider_user_id);
      if (!baeminId) return;
      const key = `${baeminId}|${weekStart}`;
      const prev = byRiderWeek.get(key) || {
        baeminId,
        weekStart,
        riderName: row.rider_name || '',
        metrics: extractMetrics()
      };
      prev.metrics = mergeMetrics(prev.metrics, extractMetrics(row.parsed_json));
      if (row.rider_name) prev.riderName = row.rider_name;
      byRiderWeek.set(key, prev);
    });

    const weekStarts = [...new Set([...byRiderWeek.values()].map(r => r.weekStart))];
    const protectedMap = await loadProtectedRejectionMap(supabase, weekStarts);
    const currentWeek = settlementWeekStart(latest);
    const now = new Date().toISOString();
    const rejectionRows = [];

    byRiderWeek.forEach(entry => {
      const rate = calcAcceptRate(entry.metrics);
      if (rate == null) {
        summary.skipped += 1;
        return;
      }
      const driver = matchDriverByBaeminId(entry.baeminId, driverByBaeminId);
      if (!driver?.id) {
        summary.unmatched += 1;
        return;
      }
      const id = `${driver.id}-${entry.weekStart}-baemin`;
      const existing = protectedMap.get(`${driver.id}|${entry.weekStart}|baemin`);
      const source = String(existing?.source || '').toLowerCase();
      if (existing && PROTECTED_REJECTION_SOURCES.has(source)) {
        summary.protected += 1;
        return;
      }
      const useLive = entry.weekStart === currentWeek;
      rejectionRows.push({
        id,
        driver_id: driver.id,
        week_start: entry.weekStart,
        platform: 'baemin',
        rate: Number(rate),
        source: useLive ? SYNC_SOURCE_LIVE : SYNC_SOURCE_PAST,
        stats: buildRejectionStats(entry.metrics),
        updated_at: now,
        rider_published_at: existing?.rider_published_at || null
      });
    });

    summary.rejectionsUpserted = await upsertRejectionRows(supabase, rejectionRows);
  }

  return { ok: true, ...summary };
}

module.exports = {
  syncBaeminCallsAndRejections,
  calcAcceptRate,
  extractMetrics,
  baeminIdMatchKey,
  resolveRiderBusinessDate
};
