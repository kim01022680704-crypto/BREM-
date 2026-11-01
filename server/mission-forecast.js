const { getServiceClient } = require('./admin-bootstrap');
const adminUsers = require('./admin-users');

const FORECAST_CACHE_MS = 60000;
let forecastCache = null;
let forecastCacheAt = 0;
let forecastPending = null;

function completeOf(row) {
  const parsed = row?.parsed_json && typeof row.parsed_json === 'object' ? row.parsed_json : {};
  return Math.max(0, Number(row?.completeCount ?? parsed.completeCount ?? row?.complete_count) || 0);
}

function baeminDayComplete(row) {
  const parsed = row?.parsed_json && typeof row.parsed_json === 'object' ? row.parsed_json : {};
  return Math.max(0, Number(
    row?.totalComplete ?? parsed.totalComplete
    ?? row?.allDayComplete ?? parsed.allDayComplete
    ?? row?.completeCount ?? parsed.completeCount
    ?? 0
  ) || 0);
}

function isMissingTable(error) {
  return /does not exist|Could not find the table/i.test(String(error?.message || ''));
}

async function fetchPages(build, countQuery) {
  const size = 1000;
  const cap = 50000;
  let total = null;
  if (countQuery) {
    const counted = await countQuery();
    if (counted.error) {
      if (isMissingTable(counted.error)) return [];
    } else if (Number.isFinite(counted.count)) {
      total = counted.count;
    }
  }
  if (total === 0) return [];

  const pageCount = total == null ? 1 : Math.min(Math.ceil(cap / size), Math.ceil(total / size));
  const loadPage = async (index) => {
    const from = index * size;
    const { data, error } = await build().range(from, from + size - 1);
    if (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
    return data || [];
  };

  const rows = [];
  if (total == null) {
    for (let index = 0; index < cap / size; index += 1) {
      const page = await loadPage(index);
      rows.push(...page);
      if (page.length < size) break;
    }
    return rows;
  }

  const pages = await Promise.all(Array.from({ length: pageCount }, (_, index) => loadPage(index)));
  pages.forEach(page => rows.push(...page));
  return rows;
}

async function loadBaeminWeekCalls(supabase, weekStart) {
  const byDriverId = {};
  const byUserId = {};
  const seenDriver = new Set();
  const seenUser = new Set();
  const rows = await fetchPages(
    () => supabase
      .from('baemin_live_accept_rates')
      .select('driver_id,rider_user_id,current_complete,updated_at')
      .eq('week_start', weekStart)
      .order('updated_at', { ascending: false })
      .order('id'),
    () => supabase
      .from('baemin_live_accept_rates')
      .select('id', { count: 'exact', head: true })
      .eq('week_start', weekStart)
  );
  rows.forEach(row => {
    const calls = Math.max(0, Math.round(Number(row.current_complete) || 0));
    const driverId = String(row.driver_id || '').trim();
    const userId = String(row.rider_user_id || '').trim();
    if (driverId && !seenDriver.has(driverId)) {
      seenDriver.add(driverId);
      byDriverId[driverId] = calls;
    }
    if (userId && !seenUser.has(userId)) {
      seenUser.add(userId);
      byUserId[userId] = calls;
    }
  });
  return { byDriverId, byUserId };
}

async function loadCoupangWeekCalls(supabase, weekStart, today) {
  const rows = await fetchPages(
    () => supabase
      .from('coupang_collect_items')
      .select('collect_date,collected_at,match_key,parsed_json->completeCount')
      .eq('source_menu', 'rider_daily')
      .gte('collect_date', weekStart)
      .lte('collect_date', today)
      .order('id'),
    () => supabase
      .from('coupang_collect_items')
      .select('id', { count: 'exact', head: true })
      .eq('source_menu', 'rider_daily')
      .gte('collect_date', weekStart)
      .lte('collect_date', today)
  );
  const latest = new Map();
  rows.forEach(row => {
    const key = String(row.match_key || '').replace(/\s+/g, '').trim();
    const day = String(row.collect_date || '').slice(0, 10);
    if (!key || !day) return;
    const slot = `${key}|${day}`;
    const prev = latest.get(slot);
    if (!prev || String(row.collected_at || '') > String(prev.collected_at || '')) {
      latest.set(slot, row);
    }
  });
  const byMatchKey = {};
  const dailyByMatchKey = {};
  latest.forEach(row => {
    const key = String(row.match_key || '').replace(/\s+/g, '').trim();
    const day = String(row.collect_date || '').slice(0, 10);
    const calls = Math.max(0, Math.round(completeOf(row)));
    byMatchKey[key] = (byMatchKey[key] || 0) + calls;
    if (!dailyByMatchKey[key]) dailyByMatchKey[key] = {};
    dailyByMatchKey[key][day] = calls;
  });
  return { byMatchKey, dailyByMatchKey };
}

async function loadBaeminDailyCalls(supabase, weekStart, today) {
  const rows = await fetchPages(
    () => supabase
      .from('baemin_delivery_applied_items')
      .select('collect_date,rider_user_id,parsed_json->totalComplete,parsed_json->allDayComplete,parsed_json->completeCount')
      .eq('source_menu', 'rider_history')
      .gte('collect_date', weekStart)
      .lte('collect_date', today)
      .order('id'),
    () => supabase
      .from('baemin_delivery_applied_items')
      .select('id', { count: 'exact', head: true })
      .eq('source_menu', 'rider_history')
      .gte('collect_date', weekStart)
      .lte('collect_date', today)
  );
  const best = new Map();
  rows.forEach(row => {
    const user = String(row.rider_user_id || '').trim();
    const day = String(row.collect_date || '').slice(0, 10);
    if (!user || !day) return;
    const calls = Math.max(0, Math.round(baeminDayComplete(row)));
    const slot = `${user}|${day}`;
    const prev = best.get(slot);
    if (prev == null || calls > prev) best.set(slot, calls);
  });
  const byUserId = {};
  best.forEach((calls, slot) => {
    const splitAt = slot.lastIndexOf('|');
    const user = slot.slice(0, splitAt);
    const day = slot.slice(splitAt + 1);
    if (!byUserId[user]) byUserId[user] = {};
    byUserId[user][day] = calls;
  });
  return byUserId;
}

async function listMissionForecastCalls(accessToken) {
  const caller = await adminUsers.getMyAdminAccount(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  if (forecastCache && Date.now() - forecastCacheAt < FORECAST_CACHE_MS) return forecastCache;
  if (forecastPending) return forecastPending;

  forecastPending = buildMissionForecast(supabase).then(result => {
    if (result.ok) {
      forecastCache = result;
      forecastCacheAt = Date.now();
    }
    return result;
  }).finally(() => {
    forecastPending = null;
  });
  return forecastPending;
}

async function buildMissionForecast(supabase) {
  const week = require('./baemin-settlement-week');
  const today = week.businessTodayKST();
  const weekStart = week.settlementWeekStart(today);
  const historyFrom = week.addDays(weekStart, -14);
  const days = [];
  for (let offset = 0; offset < 7; offset += 1) days.push(week.addDays(weekStart, offset));
  const weeks = [-2, -1, 0].map(offset => {
    const start = week.addDays(weekStart, offset * 7);
    return { start, end: week.addDays(start, 6), offset };
  });
  const [baemin, coupang, baeminDailyByUserId] = await Promise.all([
    loadBaeminWeekCalls(supabase, weekStart),
    loadCoupangWeekCalls(supabase, historyFrom, today),
    loadBaeminDailyCalls(supabase, historyFrom, today)
  ]);
  const coupangByMatchKey = {};
  Object.entries(coupang.dailyByMatchKey).forEach(([key, bag]) => {
    coupangByMatchKey[key] = Object.entries(bag).reduce((sum, [day, calls]) => (
      day >= weekStart && day <= today ? sum + calls : sum
    ), 0);
  });

  return {
    ok: true,
    weekStart,
    today,
    days,
    weeks,
    fetchedAt: new Date().toISOString(),
    baeminByDriverId: baemin.byDriverId,
    baeminByUserId: baemin.byUserId,
    baeminDailyByUserId,
    coupangByMatchKey,
    coupangDailyByMatchKey: coupang.dailyByMatchKey
  };
}

module.exports = { listMissionForecastCalls };
