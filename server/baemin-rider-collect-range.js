const { getServiceClient } = require('./admin-bootstrap');
const { addDays, todayKST, latestQueryableDate, buildDateList } = require('./baemin-settlement-week');

const RIDER_COLLECT_RANGE_KEY = 'baemin_rider_collect_range';

function normalizeDateKey(value) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function defaultRiderCollectRange(referenceDate = todayKST(), now = new Date()) {
  const today = todayKST(now);
  const latest = latestQueryableDate(today, now);
  const fromDate = addDays(today, -30);
  if (!latest || latest < fromDate) {
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
  const dates = buildDateList(fromDate, latest);
  return {
    fromDate,
    toDate: latest,
    dates,
    dayCount: dates.length,
    mode: 'rider_per_day',
    skipped: false,
    label: `${fromDate} ~ ${latest} (일별 수집 ${dates.length}일)`
  };
}

function normalizeRiderCollectRange(raw = {}, referenceDate = todayKST(), now = new Date()) {
  const fallback = defaultRiderCollectRange(referenceDate, now);
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
    key: RIDER_COLLECT_RANGE_KEY,
    value: payload,
    description: '배민 BIZ 라이더별 배달내역 수집 기간',
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

module.exports = {
  RIDER_COLLECT_RANGE_KEY,
  defaultRiderCollectRange,
  normalizeRiderCollectRange,
  readRiderCollectRange,
  saveRiderCollectRange,
  getRiderCollectRangeForAdmin
};
