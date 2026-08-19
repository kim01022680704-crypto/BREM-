const { getServiceClient } = require('./admin-bootstrap');
const { addDays, todayKST, latestQueryableDate, buildDateList, computeSettlementWeekCollectRange, computeHistoryLookbackRange } = require('./baemin-settlement-week');

const RIDER_COLLECT_RANGE_KEY = 'baemin_rider_collect_range';

function normalizeDateKey(value) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function defaultRiderCollectRange(referenceDate = todayKST(), now = new Date()) {
  const lookback = computeHistoryLookbackRange(referenceDate, now);
  if (lookback.skipped || !lookback.fromDate || !lookback.toDate) {
    return {
      fromDate: null,
      toDate: null,
      dates: [],
      dayCount: 0,
      mode: 'rider_per_day',
      skipped: true,
      label: '수집 없음'
    };
  }
  return {
    fromDate: lookback.fromDate,
    toDate: lookback.toDate,
    dates: lookback.dates,
    dayCount: lookback.dayCount,
    mode: 'rider_per_day',
    skipped: false,
    label: lookback.label
  };
}

function normalizeRiderCollectRange(raw = {}, referenceDate = todayKST(), now = new Date()) {
  const fallback = defaultRiderCollectRange(referenceDate, now);
  let fromDate = normalizeDateKey(raw.fromDate) || fallback.fromDate;
  let toDate = normalizeDateKey(raw.toDate) || fallback.toDate;
  const latest = latestQueryableDate(referenceDate, now);
  if (latest && toDate && toDate > latest) {
    toDate = latest;
  }
  // 저장된 기간이 어제보다 이전이면 전날 포함 8일로 굴린다 (수요일 주차 전환·지난주 고정 방지)
  if (latest && toDate && toDate < latest) {
    return {
      ...fallback,
      updatedAt: String(raw.updatedAt || '').trim() || null,
      updatedBy: String(raw.updatedBy || '').trim() || ''
    };
  }
  if (!fromDate || !toDate || toDate < fromDate) {
    return { ...fallback };
  }
  // 최대 30일(한달치)만 허용
  const minFrom = addDays(toDate, -30);
  if (fromDate < minFrom) fromDate = minFrom;
  const dates = buildDateList(fromDate, toDate);
  return {
    fromDate,
    toDate,
    dates,
    dayCount: dates.length,
    mode: 'rider_per_day',
    skipped: false,
    label: `${fromDate} ~ ${toDate} (일별 수집 ${dates.length}일)`,
    updatedAt: String(raw.updatedAt || '').trim() || null,
    updatedBy: String(raw.updatedBy || '').trim() || ''
  };
}

async function readRiderCollectRange(referenceDate = todayKST()) {
  const supabase = getServiceClient();
  if (!supabase) return defaultRiderCollectRange(referenceDate);
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', RIDER_COLLECT_RANGE_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message || '라이더 수집 기간을 불러오지 못했습니다.');
  return normalizeRiderCollectRange(data?.value || {}, referenceDate);
}

async function saveRiderCollectRange(fromDate, toDate, updatedBy = '') {
  const from = normalizeDateKey(fromDate);
  const to = normalizeDateKey(toDate);
  if (!from || !to) {
    return { ok: false, status: 400, error: 'INVALID_DATE', message: '시작일과 종료일을 입력하세요.' };
  }
  if (to < from) {
    return { ok: false, status: 400, error: 'INVALID_RANGE', message: '종료일은 시작일 이후여야 합니다.' };
  }
  const clamped = normalizeRiderCollectRange({ fromDate: from, toDate: to });
  if (clamped.dayCount > 31) {
    return { ok: false, status: 400, error: 'RANGE_TOO_LONG', message: '라이더 수집 기간은 최대 30일(한달치)까지입니다.' };
  }
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  const payload = {
    fromDate: clamped.fromDate,
    toDate: clamped.toDate,
    updatedAt: new Date().toISOString(),
    updatedBy: String(updatedBy || '').trim()
  };
  const { error } = await supabase.from('settings').upsert({
    key: RIDER_COLLECT_RANGE_KEY,
    value: payload,
    description: '배민 BIZ 라이더별 배달내역 수집 기간(최대 30일)',
    updated_at: payload.updatedAt
  }, { onConflict: 'key' });
  if (error) {
    return { ok: false, status: 500, error: error.message || '라이더 수집 기간 저장에 실패했습니다.' };
  }
  return {
    ok: true,
    range: normalizeRiderCollectRange(payload)
  };
}

async function getRiderCollectRangeForAdmin(referenceDate = todayKST()) {
  try {
    const range = await readRiderCollectRange(referenceDate);
    return { ok: true, range };
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '라이더 수집 기간 조회 실패' };
  }
}

function resolveRiderCollectRangeFromBody(body = {}, referenceDate = todayKST()) {
  const weekStart = normalizeDateKey(body.weekStart || body.settlementWeekStart);
  if (weekStart) {
    const week = computeSettlementWeekCollectRange(weekStart);
    if (week.fromDate && week.toDate && !week.skipped) {
      return normalizeRiderCollectRange({ fromDate: week.fromDate, toDate: week.toDate }, referenceDate);
    }
  }
  const fromDate = normalizeDateKey(body.riderFromDate || body.fromDate);
  const toDate = normalizeDateKey(body.riderToDate || body.toDate);
  if (!fromDate || !toDate) return null;
  return normalizeRiderCollectRange({ fromDate, toDate }, referenceDate);
}

module.exports = {
  RIDER_COLLECT_RANGE_KEY,
  defaultRiderCollectRange,
  normalizeRiderCollectRange,
  readRiderCollectRange,
  saveRiderCollectRange,
  getRiderCollectRangeForAdmin,
  resolveRiderCollectRangeFromBody
};
