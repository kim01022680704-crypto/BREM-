const SLOT_KEYS = ['morning', 'afternoon', 'evening', 'midnight'];

const BASE_QUOTA_BY_GROUP = {
  weekday: { morning: 21, afternoon: 20, evening: 30, midnight: 29 },
  friday: { morning: 24, afternoon: 21, evening: 32, midnight: 33 },
  saturday: { morning: 31, afternoon: 22, evening: 36, midnight: 35 },
  sunday: { morning: 33, afternoon: 22, evening: 35, midnight: 30 }
};

function weekdayGroupKst(dateKey) {
  const date = String(dateKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'weekday';
  const dow = new Date(`${date}T12:00:00+09:00`).getUTCDay();
  if (dow >= 1 && dow <= 4) return 'weekday';
  if (dow === 5) return 'friday';
  if (dow === 6) return 'saturday';
  return 'sunday';
}

function normalizeSetCount(value) {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num) || num < 1) return 1;
  return Math.min(num, 99);
}

function computeSlotTargets(setCount, dateKey) {
  const sets = normalizeSetCount(setCount);
  const base = BASE_QUOTA_BY_GROUP[weekdayGroupKst(dateKey)] || BASE_QUOTA_BY_GROUP.weekday;
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
  BASE_QUOTA_BY_GROUP,
  weekdayGroupKst,
  normalizeSetCount,
  computeSlotTargets,
  formatProgress
};
