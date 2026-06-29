/** 정산주(수요일~화요일) + 배민 조회 가능 최신일 계산 (KST) */

function parseDateKey(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function todayKST() {
  return formatDateKey(new Date());
}

function addDays(dateKey, days) {
  const raw = String(dateKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(`${raw}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date);
}

function weekdayKST(dateKey) {
  const raw = String(dateKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return -1;
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    weekday: 'long'
  }).format(new Date(`${raw}T12:00:00+09:00`));
  const map = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6
  };
  return map[dayName] ?? -1;
}

/** 수요일 시작 정산주 (KST 요일 기준) */
function settlementWeekStart(dateKey = todayKST()) {
  const ref = String(dateKey || todayKST()).slice(0, 10);
  const day = weekdayKST(ref);
  if (day < 0) return ref;
  const diff = (day - 3 + 7) % 7;
  return addDays(ref, -diff);
}

function settlementWeekEnd(weekStart) {
  const start = settlementWeekStart(weekStart);
  return addDays(start, 6);
}

function getKSTHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    hour: 'numeric',
    hour12: false
  }).formatToParts(date);
  return Number(parts.find(p => p.type === 'hour')?.value || 0);
}

/**
 * 배민 영업일: 당일 06:00 ~ 익일 05:59 (KST).
 * 06:00 이전에는 전일 영업일이 아직 마감되지 않아 조회 불가.
 */
function latestQueryableDate(dateKey = todayKST(), now = new Date()) {
  const refKey = dateKey || todayKST(now);
  const hour = getKSTHour(now);
  if (hour < 6) {
    return addDays(refKey, -2);
  }
  return addDays(refKey, -1);
}

function computeHistoryCollectRange(dateKey = todayKST(), now = new Date()) {
  const referenceDate = String(dateKey || todayKST(now)).slice(0, 10);
  const weekStart = settlementWeekStart(referenceDate);
  const weekEnd = settlementWeekEnd(weekStart);
  const latest = latestQueryableDate(referenceDate, now);
  const toDate = latest < weekEnd ? latest : weekEnd;
  const fromDate = weekStart <= toDate ? weekStart : toDate;

  const dates = [];
  let cursor = fromDate;
  while (cursor <= toDate) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return {
    referenceDate,
    weekStart,
    weekEnd,
    latestQueryableDate: latest,
    fromDate,
    toDate,
    dates,
    dayCount: dates.length,
    mode: 'history'
  };
}

function computeDeliveryStatusCollectContext(dateKey = todayKST()) {
  const collectDate = String(dateKey || todayKST()).slice(0, 10);
  return {
    referenceDate: collectDate,
    collectDate,
    mode: 'today',
    label: '오늘 기준'
  };
}

function buildMenuDateRanges(dateKey = todayKST(), now = new Date()) {
  const history = computeHistoryCollectRange(dateKey, now);
  const delivery = computeDeliveryStatusCollectContext(dateKey);
  const historyLabel = `${history.fromDate} ~ ${history.toDate}`;
  return {
    delivery_status: {
      ...delivery,
      fromDate: delivery.collectDate,
      toDate: delivery.collectDate
    },
    daily_history: {
      ...history,
      label: historyLabel
    },
    rider_history: {
      ...history,
      label: historyLabel
    }
  };
}

function computeCollectDateRange(dateKey = todayKST(), now = new Date()) {
  return computeHistoryCollectRange(dateKey, now);
}

/** 일별/라이더 내역 API·SPA URL용 fromDate/toDate (수요일~어제, KST) */
function resolveHistoryMenuQueryDates(collectDate, dateRange = null, now = new Date()) {
  const referenceDate = String(collectDate || todayKST(now)).slice(0, 10);
  const fresh = computeHistoryCollectRange(referenceDate, now);
  const cappedToDate = dateRange?.toDate && dateRange.toDate < fresh.toDate
    ? dateRange.toDate
    : fresh.toDate;
  const fromDate = fresh.fromDate;
  const toDate = cappedToDate;
  const dates = [];
  let cursor = fromDate;
  while (cursor <= toDate) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return {
    ...fresh,
    referenceDate,
    fromDate,
    toDate,
    dates,
    dayCount: dates.length
  };
}

module.exports = {
  parseDateKey,
  formatDateKey,
  todayKST,
  getKSTHour,
  addDays,
  weekdayKST,
  settlementWeekStart,
  settlementWeekEnd,
  latestQueryableDate,
  computeHistoryCollectRange,
  computeDeliveryStatusCollectContext,
  buildMenuDateRanges,
  computeCollectDateRange,
  resolveHistoryMenuQueryDates
};
