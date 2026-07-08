const SLOT_KEYS = ['morning', 'afternoon', 'evening', 'midnight'];

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const WEEKDAY_LABELS = {
  mon: '월요일',
  tue: '화요일',
  wed: '수요일',
  thu: '목요일',
  fri: '금요일',
  sat: '토요일',
  sun: '일요일'
};

const SLOT_LABELS = {
  morning: '아침점심',
  afternoon: '오후',
  evening: '저녁',
  midnight: '심야'
};

/** 1세트 기본값 (월~일 × 시간대). 토 심야=31 (기존 하드코딩 35와 상이 → 입력표 기준) */
const DEFAULT_WEEKDAY_QUOTA = {
  mon: { morning: 21, afternoon: 20, evening: 30, midnight: 29 },
  tue: { morning: 21, afternoon: 20, evening: 30, midnight: 29 },
  wed: { morning: 21, afternoon: 20, evening: 30, midnight: 29 },
  thu: { morning: 21, afternoon: 20, evening: 30, midnight: 29 },
  fri: { morning: 24, afternoon: 21, evening: 32, midnight: 33 },
  sat: { morning: 31, afternoon: 22, evening: 36, midnight: 31 },
  sun: { morning: 33, afternoon: 22, evening: 35, midnight: 30 }
};

/** @deprecated 호환용 — 그룹 단위 레거시 */
const BASE_QUOTA_BY_GROUP = {
  weekday: DEFAULT_WEEKDAY_QUOTA.mon,
  friday: DEFAULT_WEEKDAY_QUOTA.fri,
  saturday: DEFAULT_WEEKDAY_QUOTA.sat,
  sunday: DEFAULT_WEEKDAY_QUOTA.sun
};

function cloneDefaultWeekdayQuota() {
  return JSON.parse(JSON.stringify(DEFAULT_WEEKDAY_QUOTA));
}

function normalizeQuotaSlotValue(value, fallback = 0) {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num) || num < 0) return Math.max(0, Math.floor(Number(fallback) || 0));
  return Math.min(num, 9999);
}

function normalizeWeekdayQuotaMatrix(raw) {
  const defaults = cloneDefaultWeekdayQuota();
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const matrix = {};
  WEEKDAY_KEYS.forEach(day => {
    const row = source[day] && typeof source[day] === 'object' ? source[day] : {};
    const fallback = defaults[day];
    matrix[day] = {};
    SLOT_KEYS.forEach(slot => {
      matrix[day][slot] = normalizeQuotaSlotValue(row[slot], fallback[slot]);
    });
  });
  return matrix;
}

function weekdayKeyKst(dateKey) {
  const date = String(dateKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'mon';
  const dow = new Date(`${date}T12:00:00+09:00`).getUTCDay();
  return WEEKDAY_KEYS[(dow + 6) % 7];
}

function weekdayShortLabelKst(dateKey) {
  const key = weekdayKeyKst(dateKey);
  return ({ mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' })[key] || '';
}

function weekdayGroupKst(dateKey) {
  const key = weekdayKeyKst(dateKey);
  if (key === 'fri') return 'friday';
  if (key === 'sat') return 'saturday';
  if (key === 'sun') return 'sunday';
  return 'weekday';
}

function normalizeSetCount(value) {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num) || num < 1) return 1;
  return Math.min(num, 99);
}

function computeSlotTargets(setCount, dateKey, matrix = null) {
  const sets = normalizeSetCount(setCount);
  const effective = normalizeWeekdayQuotaMatrix(matrix || DEFAULT_WEEKDAY_QUOTA);
  const day = weekdayKeyKst(dateKey);
  const base = effective[day] || effective.mon;
  return {
    morning: base.morning * sets,
    afternoon: base.afternoon * sets,
    evening: base.evening * sets,
    midnight: base.midnight * sets
  };
}

function formatProgress(actual, target) {
  const done = Number(actual || 0);
  const goal = Math.max(0, Number(target || 0));
  const percent = goal > 0 ? Math.round((done / goal) * 1000) / 10 : (done > 0 ? 100 : 0);
  return {
    actual: done,
    target: goal,
    label: `${done}/${goal}`,
    percent,
    percentLabel: `${percent}%`
  };
}

module.exports = {
  SLOT_KEYS,
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  SLOT_LABELS,
  DEFAULT_WEEKDAY_QUOTA,
  BASE_QUOTA_BY_GROUP,
  cloneDefaultWeekdayQuota,
  normalizeWeekdayQuotaMatrix,
  weekdayKeyKst,
  weekdayShortLabelKst,
  weekdayGroupKst,
  normalizeSetCount,
  computeSlotTargets,
  formatProgress
};
