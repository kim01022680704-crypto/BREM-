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
  const today = todayKST(now);
  const todayWeekday = weekdayKST(today);
  const weekStart = settlementWeekStart(today);
  const weekEnd = settlementWeekEnd(weekStart);

  if (todayWeekday === 3) {
    return {
      referenceDate,
      weekStart,
      weekEnd,
      latestQueryableDate: latestQueryableDate(today, now),
      fromDate: null,
      toDate: null,
      dates: [],
      dayCount: 0,
      mode: 'wednesday_skip',
      skipped: true,
      skipReason: '수요일 — 일별/라이더 수집 생략',
      label: '수요일 생략'
    };
  }

  const latest = latestQueryableDate(today, now);
  const fromDate = weekStart;
  const toDate = latest;

  if (!fromDate || !toDate || toDate < fromDate) {
    return {
      referenceDate,
      weekStart,
      weekEnd,
      latestQueryableDate: latest,
      fromDate: null,
      toDate: null,
      dates: [],
      dayCount: 0,
      mode: 'empty',
      skipped: true,
      skipReason: '조회 가능한 일별/라이더 기간 없음',
      label: '수집 없음'
    };
  }

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
    mode: 'history',
    skipped: false,
    label: `${fromDate} ~ ${toDate}`
  };
}

function computeDeliveryStatusCollectContext(dateKey = todayKST(), now = new Date()) {
  const collectDate = todayKST(now);
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
  const historyLabel = history.skipped
    ? (history.label || history.skipReason || '수집 생략')
    : `${history.fromDate} ~ ${history.toDate}`;
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

function buildDateList(fromDate, toDate) {
  const dates = [];
  if (!fromDate || !toDate || toDate < fromDate) {
    return dates;
  }
  let cursor = fromDate;
  while (cursor <= toDate) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function parseUrlHistoryDates(url) {
  try {
    const parsed = new URL(String(url || ''));
    const fromDate = String(parsed.searchParams.get('fromDate') || '').slice(0, 10);
    const toDate = String(parsed.searchParams.get('toDate') || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      return { fromDate, toDate };
    }
  } catch {
    // ignore
  }
  return null;
}

function historyDateRangeMatchesRequest(urlOrCapture, requestedRange = null) {
  if (!requestedRange?.fromDate || !requestedRange?.toDate) return true;
  const url = typeof urlOrCapture === 'string'
    ? urlOrCapture
    : String(urlOrCapture?.sampleUrl || urlOrCapture?.url || '');
  const parsed = parseUrlHistoryDates(url);
  if (!parsed) return false;
  return parsed.fromDate <= requestedRange.fromDate && parsed.toDate >= requestedRange.toDate;
}

/** 일별/라이더 내역 API·SPA URL용 fromDate/toDate */
function resolveHistoryMenuQueryDates(collectDate, dateRange = null, now = new Date()) {
  const referenceDate = String(collectDate || todayKST(now)).slice(0, 10);

  if (
    dateRange
    && dateRange.fromDate
    && dateRange.toDate
    && dateRange.mode === 'biz_month'
    && !dateRange.skipped
  ) {
    const dates = buildDateList(dateRange.fromDate, dateRange.toDate);
    return {
      ...dateRange,
      referenceDate,
      fromDate: dateRange.fromDate,
      toDate: dateRange.toDate,
      dates,
      dayCount: dates.length
    };
  }

  const fresh = computeHistoryCollectRange(referenceDate, now);

  if (dateRange?.fromDate && dateRange?.toDate) {
    const fromDate = dateRange.fromDate;
    const toDate = dateRange.mode === 'biz_month'
      ? dateRange.toDate
      : (dateRange.toDate <= (fresh.toDate || dateRange.toDate) ? dateRange.toDate : fresh.toDate);
    const dates = buildDateList(fromDate, toDate);
    if (dates.length) {
      return {
        ...fresh,
        ...dateRange,
        referenceDate,
        fromDate,
        toDate,
        dates,
        dayCount: dates.length,
        skipped: false
      };
    }
  }

  if (dateRange?.toDate && !dateRange.fromDate) {
    const biz = computeBizHistoryCollectRange(referenceDate, now);
    const fromDate = biz.fromDate || fresh.fromDate;
    const toDate = dateRange.toDate;
    const dates = buildDateList(fromDate, toDate);
    if (dates.length) {
      return {
        ...fresh,
        ...biz,
        ...dateRange,
        referenceDate,
        fromDate,
        toDate,
        dates,
        dayCount: dates.length,
        skipped: false
      };
    }
  }

  if (fresh.skipped) {
    return { ...fresh };
  }

  const fromDate = dateRange?.fromDate || fresh.fromDate;
  const toDate = dateRange?.toDate
    ? (dateRange.toDate <= fresh.toDate ? dateRange.toDate : fresh.toDate)
    : fresh.toDate;
  const dates = buildDateList(fromDate, toDate);
  return {
    ...fresh,
    referenceDate,
    fromDate,
    toDate,
    dates,
    dayCount: dates.length
  };
}

function computeBizHistoryCollectRange(dateKey = todayKST(), now = new Date()) {
  const referenceDate = String(dateKey || todayKST(now)).slice(0, 10);
  const today = todayKST(now);
  const weekStart = settlementWeekStart(today);
  const weekEnd = settlementWeekEnd(weekStart);
  const latest = latestQueryableDate(today, now);
  const fromDate = addDays(today, -30);

  if (!latest || latest < fromDate) {
    return {
      referenceDate,
      weekStart,
      weekEnd,
      latestQueryableDate: latest,
      fromDate: null,
      toDate: null,
      dates: [],
      dayCount: 0,
      mode: 'empty',
      skipped: true,
      skipReason: '조회 가능한 일별/라이더 기간 없음',
      label: '수집 없음'
    };
  }

  const dates = [];
  let cursor = fromDate;
  while (cursor <= latest) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return {
    referenceDate,
    weekStart,
    weekEnd,
    latestQueryableDate: latest,
    fromDate,
    toDate: latest,
    dates,
    dayCount: dates.length,
    mode: 'biz_month',
    skipped: false,
    label: `${fromDate} ~ ${latest} (최근 30일)`
  };
}

function buildBizMenuDateRanges(dateKey = todayKST(), now = new Date(), riderCollectRange = null) {
  const history = computeBizHistoryCollectRange(dateKey, now);
  const delivery = computeDeliveryStatusCollectContext(dateKey, now);
  const historyLabel = history.skipped
    ? (history.label || history.skipReason || '수집 생략')
    : (history.label || `${history.fromDate} ~ ${history.toDate}`);

  let riderHistory;
  if (riderCollectRange?.fromDate && riderCollectRange?.toDate) {
    const riderDates = buildDateList(riderCollectRange.fromDate, riderCollectRange.toDate);
    riderHistory = {
      ...riderCollectRange,
      fromDate: riderCollectRange.fromDate,
      toDate: riderCollectRange.toDate,
      dates: riderDates,
      dayCount: riderDates.length,
      mode: 'rider_per_day',
      skipped: riderDates.length === 0,
      label: riderCollectRange.label || `${riderCollectRange.fromDate} ~ ${riderCollectRange.toDate} (일별 수집 ${riderDates.length}일)`
    };
  } else {
    const riderDates = history.dates || buildDateList(history.fromDate, history.toDate);
    riderHistory = {
      ...history,
      dates: riderDates,
      dayCount: riderDates.length,
      mode: 'rider_per_day',
      label: history.skipped
        ? historyLabel
        : `${history.fromDate} ~ ${history.toDate} (일별 수집 ${riderDates.length}일)`
    };
  }

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
    rider_history: riderHistory
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
  computeBizHistoryCollectRange,
  computeDeliveryStatusCollectContext,
  buildMenuDateRanges,
  buildBizMenuDateRanges,
  computeCollectDateRange,
  resolveHistoryMenuQueryDates,
  buildDateList,
  parseUrlHistoryDates,
  historyDateRangeMatchesRequest
};
