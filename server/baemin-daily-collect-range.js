const { getServiceClient } = require('./admin-bootstrap');
const { addDays, todayKST, latestQueryableDate, buildDateList, computeSettlementWeekCollectRange } = require('./baemin-settlement-week');

const DAILY_COLLECT_RANGE_KEY = 'baemin_daily_collect_range';

function normalizeDateKey(value) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function defaultDailyCollectRange(referenceDate = todayKST(), now = new Date()) {
  const today = todayKST(now);
  const latest = latestQueryableDate(today, now);
  const fromDate = addDays(today, -30);
  if (!latest || latest < fromDate) {
    return {
      fromDate: null,
      toDate: null,
      dates: [],
      dayCount: 0,
      mode: 'biz_range',
      skipped: true,
      label: '수집 없음'
    };
  }
  const dates = buildDateList(fromDate, latest);
  return {
    fromDate,
    toDate: latest,
    dates,
    dayCount: dates.length,
    mode: 'biz_range',
    skipped: false,
    label: `${fromDate} ~ ${latest} (일괄 조회 ${dates.length}일)`
  };
}

function normalizeDailyCollectRange(raw = {}, referenceDate = todayKST(), now = new Date()) {
  const fallback = defaultDailyCollectRange(referenceDate, now);
  const fromDate = normalizeDateKey(raw.fromDate) || fallback.fromDate;
  const toDate = normalizeDateKey(raw.toDate) || fallback.toDate;
  if (!fromDate || !toDate || toDate < fromDate) {
    return { ...fallback };
  }
  const dates = buildDateList(fromDate, toDate);
  return {
    fromDate,
    toDate,
    dates,
    dayCount: dates.length,
    mode: 'biz_range',
    skipped: false,
    label: `${fromDate} ~ ${toDate} (일괄 조회 ${dates.length}일)`,
    updatedAt: String(raw.updatedAt || '').trim() || null,
    updatedBy: String(raw.updatedBy || '').trim() || ''
  };
}

async function readDailyCollectRange(referenceDate = todayKST()) {
  const supabase = getServiceClient();
  if (!supabase) return defaultDailyCollectRange(referenceDate);
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', DAILY_COLLECT_RANGE_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message || '일별 수집 기간을 불러오지 못했습니다.');
  return normalizeDailyCollectRange(data?.value || {}, referenceDate);
}

async function saveDailyCollectRange(fromDate, toDate, updatedBy = '') {
  const from = normalizeDateKey(fromDate);
  const to = normalizeDateKey(toDate);
  if (!from || !to) {
    return { ok: false, status: 400, error: 'INVALID_DATE', message: '시작일과 종료일을 입력하세요.' };
  }
  if (to < from) {
    return { ok: false, status: 400, error: 'INVALID_RANGE', message: '종료일은 시작일 이후여야 합니다.' };
  }
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  const payload = {
    fromDate: from,
    toDate: to,
    updatedAt: new Date().toISOString(),
    updatedBy: String(updatedBy || '').trim()
  };
  const { error } = await supabase.from('settings').upsert({
    key: DAILY_COLLECT_RANGE_KEY,
    value: payload,
    description: '배민 BIZ 일별 배달내역 수집 기간',
    updated_at: payload.updatedAt
  }, { onConflict: 'key' });
  if (error) {
    return { ok: false, status: 500, error: error.message || '일별 수집 기간 저장에 실패했습니다.' };
  }
  return {
    ok: true,
    range: normalizeDailyCollectRange(payload)
  };
}

async function getDailyCollectRangeForAdmin(referenceDate = todayKST()) {
  try {
    const range = await readDailyCollectRange(referenceDate);
    return { ok: true, range };
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '일별 수집 기간 조회 실패' };
  }
}

function resolveDailyCollectRangeFromBody(body = {}, referenceDate = todayKST()) {
  const weekStart = normalizeDateKey(body.weekStart || body.settlementWeekStart);
  if (weekStart) {
    const week = computeSettlementWeekCollectRange(weekStart);
    if (week.fromDate && week.toDate && !week.skipped) {
      return normalizeDailyCollectRange({ fromDate: week.fromDate, toDate: week.toDate }, referenceDate);
    }
  }
  const fromDate = normalizeDateKey(body.dailyFromDate || body.fromDate);
  const toDate = normalizeDateKey(body.dailyToDate || body.toDate);
  if (!fromDate || !toDate) return null;
  return normalizeDailyCollectRange({ fromDate, toDate }, referenceDate);
}

module.exports = {
  DAILY_COLLECT_RANGE_KEY,
  defaultDailyCollectRange,
  normalizeDailyCollectRange,
  readDailyCollectRange,
  saveDailyCollectRange,
  getDailyCollectRangeForAdmin,
  resolveDailyCollectRangeFromBody
};
