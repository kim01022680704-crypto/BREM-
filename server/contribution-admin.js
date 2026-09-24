/**
 * 관리자 기여도 v3: 활성화 이후 증가분만 append-only 원장에 기록한다.
 * 기존 contribution_daily는 보존하되 이 모듈에서 조회하거나 합산하지 않는다.
 */
const { verifyAdminCaller } = require('./admin-users');
const { getServiceClient } = require('./admin-bootstrap');
const coupangPipeline = require('./coupang-collect-pipeline');
const {
  computeSlotTargets,
  currentBaeminSlotKey,
  kstHour
} = require('./baemin-quota');
const { readPartnerSetCountMap } = require('./baemin-partner-set-count');
const { readWeekdayQuotaMatrix } = require('./baemin-weekday-quota');
const { readPartnerRegionMap } = require('./baemin-partner-region');

const CONFIG_KEY = 'brem_contribution_ledger_v3_config';
const DEFAULT_CONFIG = Object.freeze({
  active: false,
  activatedAt: null,
  version: 1,
  baeminPointsPerCall: 10,
  coupangPoints08: 8,
  coupangPoints10: 10,
  updatedAt: null
});

function todayKst(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

function addDateDays(dateKey, amount) {
  const date = new Date(`${dateKey}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + amount);
  return todayKst(date);
}

function currentContributionDate(now = new Date()) {
  const today = todayKst(now);
  return kstHour(now) < 6 ? addDateDays(today, -1) : today;
}

function contributionCollectDates(now = new Date()) {
  const live = currentContributionDate(now);
  const calendar = todayKst(now);
  return calendar === live ? [live] : [live, calendar].sort();
}

function itemContributionDate(item, now = new Date()) {
  const at = new Date(item?.collected_at || 0);
  return currentContributionDate(Number.isFinite(at.getTime()) ? at : now);
}

function filterItemsForContributionDate(items, date, now = new Date()) {
  const live = String(date || currentContributionDate(now)).slice(0, 10);
  return (items || []).filter(item => itemContributionDate(item, now) === live);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function nonNegative(value) {
  return Math.max(0, num(value));
}

function round1(value) {
  return Math.round(num(value) * 10) / 10;
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function baeminIdKey(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function partnerFromDedupe(dedupeKey) {
  const match = String(dedupeKey || '').match(/^(DP\d+)/i);
  return match ? match[1].toUpperCase() : '';
}

function slotCountFromParsed(parsed, slotKey) {
  const columns = {
    morning: ['morningCount', 'completeMorning'],
    afternoon: ['afternoonCount', 'completeAfternoon'],
    evening: ['eveningCount', 'completeEvening'],
    midnight: ['midnightCount', 'completeMidnight']
  }[slotKey] || ['eveningCount', 'completeEvening'];
  return Math.max(0, Math.round(num(parsed?.[columns[0]] ?? parsed?.[columns[1]])));
}

function currentCoupangPeakKey(now = new Date()) {
  const hour = kstHour(now);
  if (hour >= 7 && hour < 11) return 'MORNING';
  if (hour >= 11 && hour < 13) return 'LUNCH';
  if (hour >= 13 && hour < 17) return 'POST_LUNCH';
  if (hour >= 17 && hour < 20) return 'DINNER';
  if (hour >= 20) return 'POST_DINNER';
  return 'POST_DINNER';
}

function startedBaeminSlotKeys(now = new Date()) {
  const order = ['morning', 'afternoon', 'evening', 'midnight'];
  const current = currentBaeminSlotKey(now);
  const index = order.indexOf(current);
  if (index < 0) return [current];
  return order.slice(0, index + 1);
}

function startedCoupangPeakKeys(now = new Date()) {
  const order = ['MORNING', 'LUNCH', 'POST_LUNCH', 'DINNER', 'POST_DINNER'];
  const current = currentCoupangPeakKey(now);
  const index = order.indexOf(current);
  if (index < 0) return [current];
  return order.slice(0, index + 1);
}

function normalizePoints(value, fallback) {
  if (value === '' || value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    active: source.active === true,
    activatedAt: source.activatedAt ? String(source.activatedAt) : null,
    version: Math.max(1, Math.floor(num(source.version) || DEFAULT_CONFIG.version)),
    baeminPointsPerCall: normalizePoints(
      source.baeminPointsPerCall,
      DEFAULT_CONFIG.baeminPointsPerCall
    ),
    coupangPoints08: normalizePoints(source.coupangPoints08, DEFAULT_CONFIG.coupangPoints08),
    coupangPoints10: normalizePoints(source.coupangPoints10, DEFAULT_CONFIG.coupangPoints10),
    updatedAt: source.updatedAt ? String(source.updatedAt) : null
  };
}

function scoringChanged(before, after) {
  return before.baeminPointsPerCall !== after.baeminPointsPerCall
    || before.coupangPoints08 !== after.coupangPoints08
    || before.coupangPoints10 !== after.coupangPoints10;
}

function ruleSnapshot(config) {
  return {
    version: config.version,
    baeminPointsPerCall: config.baeminPointsPerCall,
    coupangPoints08: config.coupangPoints08,
    coupangPoints10: config.coupangPoints10
  };
}

/**
 * 0.8*n08 + 1*n10 = weightedDelta를 0.1 단위 정수 문제로 푼다.
 * exact 조합은 n10 최대, 불가능하면 오차 최소 후 n10 최대를 택한다.
 */
function decomposeCoupangWeightedDelta(weightedDelta) {
  const rawWeightedDelta = nonNegative(weightedDelta);
  const units = Math.max(0, Math.round(rawWeightedDelta * 10));
  const maxCount = Math.ceil(units / 8) + 2;
  let best = null;

  for (let count08 = 0; count08 <= maxCount; count08 += 1) {
    for (let count10 = 0; count10 <= maxCount; count10 += 1) {
      const representedUnits = 8 * count08 + 10 * count10;
      const errorUnits = Math.abs(representedUnits - units);
      const candidate = { count08, count10, representedUnits, errorUnits };
      if (!best
        || candidate.errorUnits < best.errorUnits
        || (candidate.errorUnits === best.errorUnits && candidate.count10 > best.count10)
        || (candidate.errorUnits === best.errorUnits
          && candidate.count10 === best.count10
          && candidate.count08 < best.count08)) {
        best = candidate;
      }
    }
  }

  const normalizedWeightedDelta = best.representedUnits / 10;
  return {
    count08: best.count08,
    count10: best.count10,
    weightedDelta: normalizedWeightedDelta,
    rawWeightedDelta,
    exact: best.errorUnits === 0,
    corrected: best.errorUnits !== 0 || Math.abs(rawWeightedDelta * 10 - units) > 1e-9,
    correction: round1(normalizedWeightedDelta - rawWeightedDelta)
  };
}

function mapRider(row) {
  const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  const name = String(row.name || '').trim();
  const phone = String(row.phone || raw.phone || '').trim();
  const phone4 = normalizePhone(phone).slice(-4);
  return {
    id: String(row.id || ''),
    name,
    phone,
    erpId: name && phone4 ? `${name.replace(/\s+/g, '')}${phone4}` : '',
    baeminId: String(row.baemin_id || raw.baeminId || '').trim(),
    regionBaemin: String(raw.regionBaemin || '').trim(),
    regionCoupang: String(raw.regionCoupang || '').trim(),
    status: String(row.status || '').trim()
  };
}

function buildRiderIndexes(riders) {
  const byBaeminId = new Map();
  const byNamePhone = new Map();
  const byName = new Map();
  riders.forEach(rider => {
    const baeminId = baeminIdKey(rider.baeminId);
    if (baeminId) byBaeminId.set(baeminId, rider);
    const name = normalizeName(rider.name);
    const phone4 = normalizePhone(rider.phone).slice(-4);
    if (name && phone4) byNamePhone.set(`${name}|${phone4}`, rider);
    if (name && !byName.has(name)) byName.set(name, rider);
  });
  return { byBaeminId, byNamePhone, byName };
}

async function loadRiders(supabase) {
  const { data, error } = await supabase
    .from('riders')
    .select('id,name,phone,baemin_id,raw_data,status')
    .limit(20000);
  if (error) throw error;
  return (data || [])
    .map(mapRider)
    .filter(rider => rider.id && rider.status.toLowerCase() !== 'deleted');
}

const RIDER_CACHE_MS = 30000;
let riderCache = { at: 0, riders: [], indexes: null };

async function loadRidersCached(supabase) {
  if (riderCache.indexes && (Date.now() - riderCache.at) < RIDER_CACHE_MS) return riderCache;
  const riders = await loadRiders(supabase);
  riderCache = { at: Date.now(), riders, indexes: buildRiderIndexes(riders) };
  return riderCache;
}

function filterLatestWave(items, identityOf, windowMs = 8000) {
  const latestAt = new Map();
  (items || []).forEach(item => {
    const id = identityOf(item);
    if (!id) return;
    const at = new Date(item.collected_at || 0).getTime();
    if (!Number.isFinite(at)) return;
    if (at > (latestAt.get(id) || 0)) latestAt.set(id, at);
  });
  return (items || []).filter(item => {
    const id = identityOf(item);
    const latest = latestAt.get(id);
    if (!id || !latest) return false;
    const at = new Date(item.collected_at || 0).getTime();
    return Number.isFinite(at) && Math.abs(at - latest) <= windowMs;
  });
}

function vendorIdOfCoupangItem(item) {
  return String(item?.vendor_id || item?.parsed_json?.vendorId || '').trim();
}

function partnerIdOfBaeminItem(item) {
  return partnerFromDedupe(item?.dedupe_key)
    || String(item?.parsed_json?.partnerId || '').trim().toUpperCase();
}

async function readConfig(supabase) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', CONFIG_KEY)
    .maybeSingle();
  if (error) throw error;
  return normalizeConfig(data?.value);
}

async function writeConfig(supabase, config) {
  const normalized = normalizeConfig(config);
  const { error } = await supabase.from('settings').upsert({
    key: CONFIG_KEY,
    value: normalized,
    description: '기여도 비소급 v3 원장 설정',
    updated_at: normalized.updatedAt || new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) throw error;
  return normalized;
}

async function getConfig(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  try {
    return { ok: true, config: await readConfig(supabase) };
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '기여도 설정 조회 실패' };
  }
}

async function saveConfig(accessToken, body = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  try {
    const before = await readConfig(supabase);
    const proposed = normalizeConfig({ ...before, ...body });
    // inactive→active 전환은 반드시 baseline을 만드는 activate API로만 허용한다.
    proposed.active = before.active;
    proposed.activatedAt = before.activatedAt;
    proposed.version = before.version + (scoringChanged(before, proposed) ? 1 : 0);
    proposed.updatedAt = new Date().toISOString();
    const config = await writeConfig(supabase, proposed);
    return { ok: true, config };
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '기여도 설정 저장 실패' };
  }
}

async function loadBaeminDeliveryRows(supabase, dates) {
  const dayList = [...new Set(
    (Array.isArray(dates) ? dates : [dates])
      .map(value => String(value || '').slice(0, 10))
      .filter(Boolean)
  )];
  if (!dayList.length) return [];
  const items = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    let query = supabase
      .from('baemin_biz_collect_items')
      .select('collect_date,collected_at,dedupe_key,rider_user_id,rider_name,parsed_json')
      .eq('source_menu', 'delivery_status');
    query = dayList.length === 1
      ? query.eq('collect_date', dayList[0])
      : query.in('collect_date', dayList);
    const { data, error } = await query.range(offset, offset + 999);
    if (error) throw error;
    const chunk = data || [];
    items.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return items;
}

function isoMax(values, fallback = new Date().toISOString()) {
  const valid = values
    .map(value => new Date(value || 0))
    .filter(value => Number.isFinite(value.getTime()));
  if (!valid.length) return fallback;
  return new Date(Math.max(...valid.map(value => value.getTime()))).toISOString();
}

async function buildBaeminCurrentGroups(items, indexes, date, now = new Date()) {
  let setCountMap = {};
  let matrix = null;
  let regionMap = {};
  try {
    [setCountMap, matrix, regionMap] = await Promise.all([
      readPartnerSetCountMap(),
      readWeekdayQuotaMatrix(),
      readPartnerRegionMap()
    ]);
  } catch (_error) {
    setCountMap = {};
    matrix = null;
    regionMap = {};
  }

  const byPartner = new Map();
  filterLatestWave(items, partnerIdOfBaeminItem).forEach(item => {
    const partnerId = partnerIdOfBaeminItem(item);
    if (!partnerId) return;
    if (!byPartner.has(partnerId)) byPartner.set(partnerId, []);
    byPartner.get(partnerId).push(item);
  });

  const startedSlots = startedBaeminSlotKeys(now);
  const groups = [];
  byPartner.forEach((partnerItems, partnerId) => {
    const capturedAt = isoMax(partnerItems.map(item => item.collected_at), now.toISOString());
    const setCount = Math.max(1, Math.round(num(setCountMap?.[partnerId]?.setCount) || 1));
    const slotTargets = computeSlotTargets(setCount, date, matrix) || {};
    startedSlots.forEach(slotKey => {
      const target = nonNegative(slotTargets[slotKey]);
      const riderTotals = {};
      partnerItems.forEach(item => {
        const parsed = item.parsed_json || {};
        const absolute = slotCountFromParsed(parsed, slotKey);
        const crawlUserId = baeminIdKey(
          item.rider_user_id || parsed.userId || parsed.riderId || parsed.rider_user_id
        );
        const riderName = String(item.rider_name || parsed.riderName || parsed.name || '').trim();
        const matched = (crawlUserId && indexes.byBaeminId.get(crawlUserId))
          || indexes.byName.get(normalizeName(riderName))
          || null;
        const riderId = matched?.id
          || (crawlUserId
            ? `crawl:baemin:${crawlUserId}`
            : `crawl:baemin:${normalizeName(riderName) || 'unknown'}`);
        const previous = riderTotals[riderId];
        if (previous && previous.value >= absolute) return;
        riderTotals[riderId] = {
          value: absolute,
          name: matched?.name || riderName || '-',
          region: matched?.regionBaemin || partnerId,
          matchKey: String(crawlUserId || ''),
          raw: { matched: Boolean(matched), crawlUserId }
        };
      });
      const regionComplete = Object.values(riderTotals)
        .reduce((sum, rider) => sum + nonNegative(rider.value), 0);
      groups.push({
        date,
        platform: 'baemin',
        region: String(regionMap?.[partnerId] || partnerId),
        vendorOrPartner: partnerId,
        slotKey,
        riderTotals,
        assignedTarget: target,
        regionComplete,
        capturedAt
      });
    });
  });
  return groups;
}

function coupangAbsolute(parsed, peakKey) {
  if (peakKey === 'LUNCH') return nonNegative(parsed.lunchPeak);
  if (peakKey === 'DINNER') return nonNegative(parsed.dinnerPeak);
  return nonNegative(parsed.nonPeak);
}

function buildCoupangCurrentGroups(riderItems, peakItems, indexes, date, now = new Date()) {
  const latestRiders = filterLatestWave(riderItems, vendorIdOfCoupangItem);
  const latestPeaks = filterLatestWave(peakItems, vendorIdOfCoupangItem);
  const slotByVendor = new Map();
  const stampVendor = item => {
    const vendorId = vendorIdOfCoupangItem(item);
    if (!vendorId) return;
    const current = slotByVendor.get(vendorId) || { collectedAt: [], vendorName: '' };
    current.collectedAt.push(item.collected_at);
    current.vendorName = current.vendorName
      || String(item.vendor_name || item.parsed_json?.vendorName || '').trim();
    slotByVendor.set(vendorId, current);
  };
  latestRiders.forEach(stampVendor);
  latestPeaks.forEach(stampVendor);
  slotByVendor.forEach(meta => {
    meta.capturedAt = isoMax(meta.collectedAt, now.toISOString());
    meta.slotKey = currentCoupangPeakKey(new Date(meta.capturedAt));
  });

  const peakByVendor = new Map();
  latestPeaks.forEach(item => {
    const parsed = item.parsed_json || {};
    const vendorId = vendorIdOfCoupangItem(item);
    const slotKey = slotByVendor.get(vendorId)?.slotKey;
    const peakType = String(parsed.peakType || '').toUpperCase();
    if (!vendorId || !slotKey || peakType !== slotKey) return;
    const current = peakByVendor.get(vendorId) || {
      goal: 0,
      completed: 0,
      vendorName: '',
      collectedAt: []
    };
    current.goal += nonNegative(parsed.goalCount);
    current.completed += nonNegative(parsed.completedCount ?? (
      num(parsed.goalCount) - num(parsed.remainingCount)
    ));
    current.vendorName = current.vendorName
      || String(item.vendor_name || parsed.vendorName || '').trim();
    current.collectedAt.push(item.collected_at);
    peakByVendor.set(vendorId, current);
  });

  const groups = new Map();
  latestRiders.forEach(item => {
    const parsed = item.parsed_json || {};
    const vendorId = vendorIdOfCoupangItem(item);
    const meta = slotByVendor.get(vendorId);
    const slotKey = meta?.slotKey;
    if (!vendorId || !slotKey) return;
    const peak = peakByVendor.get(vendorId) || {
      goal: 0, completed: 0, vendorName: '', collectedAt: []
    };
    if (!groups.has(vendorId)) {
      groups.set(vendorId, {
        date,
        platform: 'coupang',
        region: peak.vendorName
          || meta.vendorName
          || String(item.vendor_name || parsed.vendorName || '').trim()
          || vendorId,
        vendorOrPartner: vendorId,
        slotKey,
        riderTotals: {},
        assignedTarget: round1(peak.goal),
        regionComplete: round1(peak.completed),
        collectedAt: [...peak.collectedAt]
      });
    }
    const group = groups.get(vendorId);
    group.collectedAt.push(item.collected_at);
    const riderName = String(item.rider_name || parsed.name || parsed.riderName || '').trim();
    const phone = String(item.phone_number || parsed.phone || parsed.phoneNumber || '').trim();
    const nameKey = normalizeName(riderName);
    const phone4 = normalizePhone(phone).slice(-4);
    const matched = (nameKey && phone4 && indexes.byNamePhone.get(`${nameKey}|${phone4}`))
      || indexes.byName.get(nameKey)
      || null;
    const courierId = String(item.courier_id || parsed.courierId || '').trim();
    const matchKey = String(item.match_key || parsed.matchKey || '').trim()
      || `${nameKey}${phone4}`;
    const riderId = matched?.id
      || (courierId ? `crawl:coupang:${courierId}` : `crawl:coupang:${matchKey || 'unknown'}`);
    const absolute = coupangAbsolute(parsed, slotKey);
    const previous = group.riderTotals[riderId];
    if (previous && previous.value >= absolute) return;
    group.riderTotals[riderId] = {
      value: absolute,
      name: matched?.name || riderName || '-',
      region: matched?.regionCoupang || group.region,
      matchKey,
      raw: {
        matched: Boolean(matched),
        courierId,
        sourceField: slotKey === 'LUNCH'
          ? 'lunchPeak'
          : (slotKey === 'DINNER' ? 'dinnerPeak' : 'nonPeak')
      }
    };
  });

  // peak 데이터만 먼저 도착해도 상태/동결 판단은 가능하다.
  peakByVendor.forEach((peak, vendorId) => {
    if (groups.has(vendorId)) return;
    const meta = slotByVendor.get(vendorId);
    groups.set(vendorId, {
      date,
      platform: 'coupang',
      region: peak.vendorName || meta?.vendorName || vendorId,
      vendorOrPartner: vendorId,
      slotKey: meta?.slotKey || currentCoupangPeakKey(now),
      riderTotals: {},
      assignedTarget: round1(peak.goal),
      regionComplete: round1(peak.completed),
      collectedAt: [...peak.collectedAt]
    });
  });

  return [...groups.values()].map(group => ({
    ...group,
    capturedAt: isoMax(
      group.collectedAt,
      slotByVendor.get(group.vendorOrPartner)?.capturedAt || now.toISOString()
    ),
    collectedAt: undefined
  }));
}

function stateIdentity(group) {
  return `${group.date}|${group.platform}|${group.vendorOrPartner}|${group.slotKey}`;
}

function stateRowIdentity(row) {
  return `${row.date}|${row.platform}|${row.vendor_or_partner}|${row.slot_key}`;
}

function makeCaptureKey(group) {
  return [
    group.date,
    group.platform,
    group.vendorOrPartner,
    group.slotKey,
    group.capturedAt
  ].join('|');
}

function captureIsAfter(previous, capturedAt) {
  if (!previous?.last_captured_at) return true;
  return new Date(capturedAt).getTime() > new Date(previous.last_captured_at).getTime();
}

function isActivationSlot(group, config) {
  if (!config?.activatedAt) return false;
  const activatedAt = new Date(config.activatedAt);
  if (!Number.isFinite(activatedAt.getTime()) || currentContributionDate(activatedAt) !== group.date) return false;
  const activatedSlot = group.platform === 'baemin'
    ? currentBaeminSlotKey(activatedAt)
    : currentCoupangPeakKey(activatedAt);
  return activatedSlot === group.slotKey;
}

/**
 * 한 지역+슬롯의 다음 상태와 이벤트를 계산하는 순수 함수.
 * state 부재는 활성화 이후 생긴 future slot이므로 0 baseline으로 계산한다.
 */
function computeCaptureTransition(group, previous, config, options = {}) {
  if (previous?.frozen) return { skipped: 'frozen', events: [], state: previous };
  if (previous && !captureIsAfter(previous, group.capturedAt)) {
    return { skipped: 'duplicate_or_reverse', events: [], state: previous };
  }

  const cumulativeCoupangNonPeak = group.platform === 'coupang'
    && ['POST_LUNCH', 'POST_DINNER'].includes(group.slotKey);
  const baselineOnly = options.baselineOnly === true
    || (!previous && isActivationSlot(group, config))
    || (!previous && cumulativeCoupangNonPeak);
  const previousTotals = previous?.rider_totals && typeof previous.rider_totals === 'object'
    ? previous.rider_totals
    : {};
  const nextTotals = { ...previousTotals };
  const regionBefore = nonNegative(previous?.region_complete);
  const regionAfter = Math.max(regionBefore, nonNegative(group.regionComplete));
  const assignedTarget = nonNegative(group.assignedTarget);
  const reached = assignedTarget > 0 && regionAfter >= assignedTarget;
  const captureKey = makeCaptureKey(group);
  const snapshot = ruleSnapshot(config);
  const events = [];
  let remainingWeight = assignedTarget > 0
    ? Math.max(0, round1(Math.min(
      regionAfter - regionBefore,
      assignedTarget - regionBefore
    )))
    : 0;

  Object.entries(group.riderTotals || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([riderId, current]) => {
    const previousValue = baselineOnly ? current.value : nonNegative(previousTotals[riderId]?.value);
    const currentValue = Math.max(nonNegative(current.value), previousValue);
    nextTotals[riderId] = { ...current, value: currentValue };
    const rawDelta = round1(currentValue - previousValue);
    if (baselineOnly || rawDelta <= 0 || remainingWeight <= 0) return;

    let weightedDelta = Math.min(rawDelta, remainingWeight);
    let count08 = 0;
    let count10 = 0;
    let creditedCalls = weightedDelta;
    let points = weightedDelta * config.baeminPointsPerCall;
    let estimated = false;
    let estimateDetail = null;

    if (group.platform === 'coupang') {
      const sourceEstimate = decomposeCoupangWeightedDelta(rawDelta);
      let weightLeft = remainingWeight;
      count10 = Math.min(sourceEstimate.count10, Math.floor(weightLeft + 1e-9));
      weightLeft = round1(weightLeft - count10);
      count08 = Math.min(sourceEstimate.count08, Math.floor((weightLeft + 1e-9) / 0.8));
      weightedDelta = round1(count08 * 0.8 + count10);
      if (weightedDelta <= 0) return;
      estimateDetail = {
        ...sourceEstimate,
        weightedDelta,
        cappedWeightedDelta: weightedDelta,
        targetRemainingBefore: remainingWeight
      };
      weightedDelta = round1(count08 * 0.8 + count10);
      creditedCalls = count08 + count10;
      points = count08 * config.coupangPoints08 + count10 * config.coupangPoints10;
      estimated = true;
    }
    remainingWeight = Math.max(0, round1(remainingWeight - weightedDelta));

    events.push({
      date: group.date,
      platform: group.platform,
      region: group.region,
      vendor_or_partner: group.vendorOrPartner,
      slot_key: group.slotKey,
      rider_id: riderId,
      name: current.name || '-',
      weighted_delta: round1(weightedDelta),
      count_08: count08,
      count_10: count10,
      credited_calls: round1(creditedCalls),
      points: round1(points),
      assigned_target: assignedTarget,
      region_complete_before: regionBefore,
      region_complete_after: regionAfter,
      capture_key: captureKey,
      captured_at: group.capturedAt,
      rule_version: config.version,
      rule_snapshot: snapshot,
      estimated,
      raw_json: {
        absoluteBefore: previousValue,
        absoluteAfter: currentValue,
        rawDelta,
        creditedWeightedDelta: weightedDelta,
        cappedAtTarget: weightedDelta < rawDelta,
        estimate: estimateDetail,
        source: current.raw || {},
        matchKey: current.matchKey || ''
      }
    });
  });

  return {
    events,
    state: {
      date: group.date,
      platform: group.platform,
      region: group.region,
      vendor_or_partner: group.vendorOrPartner,
      slot_key: group.slotKey,
      rider_totals: nextTotals,
      last_capture_key: captureKey,
      last_captured_at: group.capturedAt,
      region_complete: regionAfter,
      assigned_target: assignedTarget,
      region_complete_reached: reached || Boolean(previous?.region_complete_reached),
      frozen: reached,
      frozen_at: reached ? group.capturedAt : null
    }
  };
}

async function loadStates(supabase, date, platform = 'all') {
  let query = supabase
    .from('contribution_slot_states')
    .select('*')
    .eq('date', date)
    .limit(10000);
  if (platform === 'baemin' || platform === 'coupang') query = query.eq('platform', platform);
  const { data, error } = await query;
  if (error) throw error;
  const map = new Map();
  (data || []).forEach(row => map.set(stateRowIdentity(row), row));
  return map;
}

async function freezeEndedStates(supabase, date, platform = 'all', now = new Date()) {
  const frozenAt = now.toISOString();
  let oldQuery = supabase
    .from('contribution_slot_states')
    .update({ frozen: true, frozen_at: frozenAt, updated_at: frozenAt })
    .lt('date', date)
    .eq('frozen', false);
  if (platform === 'baemin' || platform === 'coupang') oldQuery = oldQuery.eq('platform', platform);
  const oldResult = await oldQuery;
  if (oldResult.error) throw oldResult.error;

  const targets = [];
  if (platform === 'all' || platform === 'baemin') {
    const current = currentBaeminSlotKey(now);
    const order = ['morning', 'afternoon', 'evening', 'midnight'];
    targets.push({ platform: 'baemin', slots: order.slice(0, Math.max(0, order.indexOf(current))) });
  }
  if (platform === 'all' || platform === 'coupang') {
    const current = currentCoupangPeakKey(now);
    const order = ['MORNING', 'LUNCH', 'POST_LUNCH', 'DINNER', 'POST_DINNER'];
    targets.push({ platform: 'coupang', slots: order.slice(0, Math.max(0, order.indexOf(current))) });
  }
  for (const target of targets) {
    if (!target.slots.length) continue;
    const { error } = await supabase
      .from('contribution_slot_states')
      .update({ frozen: true, frozen_at: frozenAt, updated_at: frozenAt })
      .eq('date', date)
      .eq('platform', target.platform)
      .eq('frozen', false)
      .in('slot_key', target.slots);
    if (error) throw error;
  }
}

async function loadOneState(supabase, group) {
  const { data, error } = await supabase
    .from('contribution_slot_states')
    .select('*')
    .eq('date', group.date)
    .eq('platform', group.platform)
    .eq('vendor_or_partner', group.vendorOrPartner)
    .eq('slot_key', group.slotKey)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function recordGroup(supabase, group, previous, config, options = {}) {
  let prior = previous || null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const transition = computeCaptureTransition(group, prior, config, options);
    if (transition.skipped) return { ok: true, skipped: transition.skipped, recorded: 0 };
    const { data, error } = await supabase.rpc('brem_record_contribution_capture_v3', {
      p_state: transition.state,
      p_events: transition.events,
      p_expected_previous_capture_key: prior?.last_capture_key || null
    });
    if (error) throw error;
    if (!data?.conflict) return data || { ok: true, recorded: transition.events.length };
    prior = await loadOneState(supabase, group);
  }
  return { ok: false, conflict: true, recorded: 0 };
}

async function buildCurrentGroups(supabase, platform, date, indexes, now = new Date()) {
  const groups = [];
  const errors = [];
  const collectDates = contributionCollectDates(now);
  const fromDate = collectDates[0];
  const toDate = collectDates[collectDates.length - 1];
  if (platform === 'all' || platform === 'baemin') {
    try {
      const items = filterItemsForContributionDate(
        await loadBaeminDeliveryRows(supabase, collectDates),
        date,
        now
      );
      groups.push(...await buildBaeminCurrentGroups(items, indexes, date, now));
    } catch (error) {
      errors.push(`배민: ${error.message || error}`);
    }
  }
  if (platform === 'all' || platform === 'coupang') {
    try {
      const [riderResult, peakResult] = await Promise.all([
        coupangPipeline.readCollectItems('rider_daily', '', {
          fromDate, toDate, limit: 30000
        }),
        coupangPipeline.readCollectItems('peak_realtime', '', {
          fromDate, toDate, limit: 10000
        })
      ]);
      if (!riderResult.ok) throw new Error(riderResult.message || riderResult.error || '라이더 조회 실패');
      groups.push(...buildCoupangCurrentGroups(
        filterItemsForContributionDate(riderResult.items || [], date, now),
        filterItemsForContributionDate(peakResult.ok ? (peakResult.items || []) : [], date, now),
        indexes,
        date,
        now
      ));
      if (!peakResult.ok) errors.push(`쿠팡 피크: ${peakResult.message || peakResult.error}`);
    } catch (error) {
      errors.push(`쿠팡: ${error.message || error}`);
    }
  }
  return { groups, errors };
}

function isMissingLedger(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return text.includes('contribution_slot_states')
    || text.includes('brem_record_contribution_capture_v3')
    || text.includes('schema cache');
}

async function processCurrentCapture(supabase, config, options = {}) {
  const now = options.now || new Date();
  const date = currentContributionDate(now);
  const platform = ['baemin', 'coupang'].includes(String(options.platform || '').toLowerCase())
    ? String(options.platform).toLowerCase()
    : 'all';
  const indexes = (await loadRidersCached(supabase)).indexes;
  const { groups, errors } = await buildCurrentGroups(
    supabase,
    platform,
    date,
    indexes,
    now
  );
  const states = await loadStates(supabase, date, platform);
  const summary = {
    groups: groups.length,
    baeminGroups: groups.filter(group => group.platform === 'baemin').length,
    coupangGroups: groups.filter(group => group.platform === 'coupang').length,
    events: 0,
    frozen: 0,
    skippedFrozen: 0,
    skippedDuplicate: 0,
    conflicts: 0,
    errors
  };

  if (options.requireBothPlatforms
    && (summary.baeminGroups === 0 || summary.coupangGroups === 0)) {
    if (summary.baeminGroups === 0) summary.errors.push('배민 현재 슬롯 snapshot이 없습니다.');
    if (summary.coupangGroups === 0) summary.errors.push('쿠팡 현재 피크 snapshot이 없습니다.');
    return {
      ok: false,
      status: 409,
      date,
      saved: 0,
      summary,
      message: '두 플랫폼의 현재 snapshot이 모두 있어야 활성화할 수 있습니다.'
    };
  }

  for (const group of groups) {
    try {
      const result = await recordGroup(
        supabase,
        group,
        states.get(stateIdentity(group)),
        config,
        { baselineOnly: options.baselineOnly === true }
      );
      summary.events += num(result.recorded);
      if (result.frozen) summary.frozen += 1;
      if (result.skipped === 'frozen') summary.skippedFrozen += 1;
      if (result.skipped === 'duplicate_or_reverse') summary.skippedDuplicate += 1;
      if (result.conflict) summary.conflicts += 1;
    } catch (error) {
      summary.errors.push(`${group.platform}/${group.vendorOrPartner}/${group.slotKey}: ${error.message || error}`);
    }
  }

  await freezeEndedStates(supabase, date, platform, now);

  return {
    ok: summary.errors.length === 0,
    status: summary.errors.length ? 500 : 200,
    date,
    saved: summary.events,
    summary,
    message: options.baselineOnly
      ? `현재 슬롯 baseline ${groups.length}개 저장 (0점)`
      : `현재 슬롯 원장 이벤트 ${summary.events}건 저장`
  };
}

async function refreshSnapshotCore(options = {}) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  try {
    let config = options.config ? normalizeConfig(options.config) : await readConfig(supabase);
    if (!config.active && options.autoActivate === true) {
      const activatedAt = (options.now || new Date()).toISOString();
      const staged = await writeConfig(supabase, {
        ...config,
        active: false,
        activatedAt,
        updatedAt: activatedAt,
        version: config.version + 1
      });
      const baseline = await processCurrentCapture(supabase, staged, {
        date: options.date || currentContributionDate(options.now || new Date()),
        platform: 'all',
        baselineOnly: true,
        requireBothPlatforms: false,
        now: options.now
      });
      if (!baseline.ok) return baseline;
      config = await writeConfig(supabase, {
        ...staged,
        active: true,
        updatedAt: new Date().toISOString()
      });
      return {
        ...baseline,
        active: true,
        autoActivated: true,
        config,
        message: `크롤 감지 · 기여도 자동 활성화 · ${baseline.summary.groups}개 기준값 저장(0점)`
      };
    }
    if (!config.active && options.baselineOnly !== true) {
      return {
        ok: true,
        active: false,
        saved: 0,
        message: '기여도 v3 원장이 비활성 상태라 갱신하지 않았습니다.'
      };
    }
    return await processCurrentCapture(supabase, config, options);
  } catch (error) {
    return {
      ok: false,
      status: isMissingLedger(error) ? 503 : 500,
      tableMissing: isMissingLedger(error),
      error: isMissingLedger(error)
        ? '기여도 v3 migration이 필요합니다: supabase/contribution_ledger_v3.sql'
        : (error.message || '기여도 원장 갱신 실패')
    };
  }
}

async function refreshSnapshot(accessToken, options = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  return refreshSnapshotCore(options);
}

async function activateLedger(accessToken, body = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  try {
    const before = await readConfig(supabase);
    if (before.active) {
      return { ok: true, alreadyActive: true, config: before, message: '이미 활성화되어 있습니다.' };
    }
    const proposed = normalizeConfig({ ...before, ...body });
    // baseline 작성 중 자동 크롤 훅이 점수를 기록하지 않도록 staging은 inactive로 둔다.
    proposed.active = false;
    proposed.activatedAt = new Date().toISOString();
    proposed.updatedAt = proposed.activatedAt;
    proposed.version = before.version + 1;
    const config = await writeConfig(supabase, proposed);
    const baseline = await processCurrentCapture(supabase, config, {
      date: currentContributionDate(),
      platform: 'all',
      baselineOnly: true,
      requireBothPlatforms: false
    });
    if (!baseline.ok) {
      const inactiveConfig = await writeConfig(supabase, {
        ...config,
        active: false,
        activatedAt: null,
        updatedAt: new Date().toISOString()
      });
      return {
        ok: false,
        status: baseline.status || 500,
        error: 'baseline 저장 실패로 원장을 활성화하지 않았습니다.',
        baseline,
        config: inactiveConfig
      };
    }
    const activeConfig = await writeConfig(supabase, {
      ...config,
      active: true,
      updatedAt: new Date().toISOString()
    });
    return {
      ok: true,
      config: activeConfig,
      baseline,
      message: `v3 원장 활성화 · ${baseline.summary.groups}개 현재 슬롯 baseline 저장 · 0점`
    };
  } catch (error) {
    return {
      ok: false,
      status: isMissingLedger(error) ? 503 : 500,
      tableMissing: isMissingLedger(error),
      error: error.message || '기여도 원장 활성화 실패'
    };
  }
}

const AUTO_REFRESH_COALESCE_MS = 0;
const AUTO_REFRESH_HEARTBEAT_MS = 15000;
const autoRefreshJobs = new Map();
let contributionHeartbeat = null;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isShortLivedRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

async function runAutoRefresh(options) {
  let lastResult = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      lastResult = await refreshSnapshotCore(options);
    } catch (error) {
      lastResult = { ok: false, error: error?.message || String(error) };
    }
    if (lastResult?.ok) return lastResult;
    if (attempt < 3) await wait(attempt * 250);
  }
  console.warn('[contribution-v3] auto refresh failed:', lastResult?.error || lastResult);
  return lastResult || { ok: false, error: '기여도 자동 반영 실패' };
}

function ensureContributionHeartbeat() {
  if (contributionHeartbeat || isShortLivedRuntime()) return;
  contributionHeartbeat = setInterval(() => {
    void scheduleAutoRefresh({ platform: 'all', autoActivate: true });
  }, AUTO_REFRESH_HEARTBEAT_MS);
}

function scheduleAutoRefresh(options = {}) {
  const date = currentContributionDate(options.now || new Date());
  const platform = String(options.platform || 'all').trim().toLowerCase();
  const key = `${date}|${platform}`;
  const job = autoRefreshJobs.get(key) || {
    dirty: null,
    timer: null,
    firstAt: 0,
    running: null
  };
  job.dirty = {
    date,
    platform,
    autoActivate: options.autoActivate === true || job.dirty?.autoActivate === true
  };
  if (!job.firstAt) job.firstAt = Date.now();
  autoRefreshJobs.set(key, job);
  ensureContributionHeartbeat();

  const run = () => {
    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    if (job.running) return job.running;
    const payload = job.dirty;
    if (!payload) {
      autoRefreshJobs.delete(key);
      return Promise.resolve({ ok: true, skipped: true });
    }
    job.dirty = null;
    job.firstAt = 0;
    job.running = runAutoRefresh(payload).finally(() => {
      job.running = null;
      if (job.dirty) {
        job.firstAt = Date.now();
        job.timer = setTimeout(run, 0);
      } else if (autoRefreshJobs.get(key) === job) {
        autoRefreshJobs.delete(key);
      }
    });
    return job.running;
  };

  if (job.running) return job.running;
  return run();
}

async function queryEvents(supabase, options = {}) {
  const date = String(options.date || currentContributionDate()).slice(0, 10);
  const fromDate = String(options.fromDate || date).slice(0, 10);
  const toDate = String(options.toDate || date).slice(0, 10);
  const platform = String(options.platform || 'all').trim().toLowerCase();
  const region = String(options.region || '').trim();
  const riderId = String(options.riderId || options.rider_id || '').trim();
  const slotKey = String(options.slotKey || options.slot_key || '').trim();
  const limit = Math.min(50000, Math.max(1, Math.floor(num(options.limit) || 5000)));
  const rows = [];
  for (let offset = 0; offset < limit; offset += 1000) {
    const pageSize = Math.min(1000, limit - offset);
    let query = supabase
      .from('contribution_ledger_events')
      .select('*')
      .gte('date', fromDate)
      .lte('date', toDate)
      .order('captured_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (platform === 'baemin' || platform === 'coupang') query = query.eq('platform', platform);
    if (region) query = query.ilike('region', `%${region}%`);
    if (riderId) query = query.eq('rider_id', riderId);
    if (slotKey) query = query.eq('slot_key', slotKey);
    const { data, error } = await query;
    if (error) throw error;
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  const keyword = String(options.keyword || '').trim().toLowerCase();
  const items = keyword
    ? rows.filter(row => [
      row.name, row.region, row.rider_id, row.vendor_or_partner, row.slot_key
    ].join(' ').toLowerCase().includes(keyword))
    : rows;
  return { date, fromDate, toDate, items };
}

async function listEvents(accessToken, options = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  try {
    const result = await queryEvents(supabase, options);
    return { ok: true, date: result.date, count: result.items.length, items: result.items };
  } catch (error) {
    return {
      ok: false,
      status: isMissingLedger(error) ? 503 : 500,
      tableMissing: isMissingLedger(error),
      error: error.message || '기여도 이벤트 조회 실패'
    };
  }
}

function isCrawlRiderId(riderId) {
  return String(riderId || '').startsWith('crawl:');
}

function assignedRegionOf(rider, platform) {
  if (!rider) return '';
  return String(platform === 'coupang' ? rider.regionCoupang || '' : rider.regionBaemin || '').trim();
}

function regionsEqual(left, right) {
  const normalize = value => String(value || '').replace(/\s+/g, '').toLowerCase();
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && a === b);
}

function attachMatchFields(item, rider) {
  const assigned = assignedRegionOf(rider, item.platform);
  item.matched = Boolean(rider) && !isCrawlRiderId(item.rider_id);
  item.assigned_region = assigned;
  item.region_matched = item.matched && regionsEqual(assigned, item.region);
  return item;
}

function aggregateDaily(events, states, riderMap = new Map()) {
  const stateMap = new Map();
  (states || []).forEach(state => stateMap.set(stateRowIdentity(state), state));
  const aggregates = new Map();

  (events || []).forEach(event => {
    const key = [
      event.date, event.platform, event.vendor_or_partner, event.slot_key, event.rider_id
    ].join('|');
    if (!aggregates.has(key)) {
      aggregates.set(key, {
        date: event.date,
        platform: event.platform,
        region: event.region,
        rider_id: event.rider_id,
        rider_name: event.name,
        name: event.name,
        slot_key: event.slot_key,
        vendor_or_partner: event.vendor_or_partner,
        score: 0,
        points: 0,
        credited_calls: 0,
        weighted_delta: 0,
        count_08: 0,
        count_10: 0,
        frozen: false,
        live: true,
        raw_json: { events: [] },
        _vendors: new Set([event.vendor_or_partner])
      });
    }
    const item = aggregates.get(key);
    item.score = round1(item.score + num(event.points));
    item.points = item.score;
    item.credited_calls = round1(item.credited_calls + num(event.credited_calls));
    item.weighted_delta = round1(item.weighted_delta + num(event.weighted_delta));
    item.count_08 += Math.round(num(event.count_08));
    item.count_10 += Math.round(num(event.count_10));
    item._vendors.add(event.vendor_or_partner);
    item.raw_json.events.push(event);
  });

  const items = [...aggregates.values()].map(item => {
    const vendors = [...item._vendors];
    const relevantStates = vendors
      .map(vendor => stateMap.get([
        item.date, item.platform, vendor, item.slot_key
      ].join('|')))
      .filter(Boolean);
    item.vendor_or_partner = vendors.join(',');
    item.frozen = relevantStates.length > 0 && relevantStates.every(state => state.frozen);
    item.live = !item.frozen;
    item.raw_json.states = relevantStates;
    if (relevantStates[0]?.region) item.region = relevantStates[0].region;
    const rider = riderMap.get(String(item.rider_id || ''));
    const firstEvent = item.raw_json.events[0] || {};
    const source = firstEvent.raw_json?.source || {};
    item.erp_id = rider?.erpId || String(firstEvent.raw_json?.matchKey || source.matchKey || '').trim();
    item.baemin_id = rider?.baeminId
      || (item.platform === 'baemin'
        ? String(source.crawlUserId || firstEvent.raw_json?.matchKey || '').trim()
        : '');
    attachMatchFields(item, rider);
    delete item._vendors;
    return item;
  }).sort((a, b) => b.points - a.points);

  const totals = items.reduce((acc, item) => {
    acc.count += 1;
    acc.pointsSum = round1(acc.pointsSum + item.points);
    acc.scoreSum = acc.pointsSum;
    acc.creditedCalls = round1(acc.creditedCalls + item.credited_calls);
    if (item.platform === 'baemin') acc.baemin += 1;
    if (item.platform === 'coupang') acc.coupang += 1;
    if (item.frozen) acc.frozen += 1;
    else acc.live += 1;
    return acc;
  }, {
    count: 0,
    pointsSum: 0,
    scoreSum: 0,
    creditedCalls: 0,
    baemin: 0,
    coupang: 0,
    frozen: 0,
    live: 0
  });
  return { items, totals };
}

function contributionWeekRange(dateValue) {
  const date = String(dateValue || todayKst()).slice(0, 10);
  const noon = new Date(`${date}T12:00:00+09:00`);
  const day = noon.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const dateAt = offset => {
    const value = new Date(noon.getTime() + offset * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(value);
  };
  return { fromDate: dateAt(mondayOffset), toDate: dateAt(mondayOffset + 6) };
}

function aggregateWeekly(events, states, riderMap = new Map()) {
  const stateMap = new Map();
  (states || []).forEach(state => stateMap.set(stateRowIdentity(state), state));
  const aggregates = new Map();

  (events || []).forEach(event => {
    const state = stateMap.get([
      event.date, event.platform, event.vendor_or_partner, event.slot_key
    ].join('|'));
    const region = String(state?.region || event.region || event.vendor_or_partner || '지역 미지정');
    const key = [event.platform, region, event.rider_id].join('|');
    if (!aggregates.has(key)) {
      aggregates.set(key, {
        date: event.date,
        platform: event.platform,
        region,
        rider_id: event.rider_id,
        rider_name: event.name,
        name: event.name,
        slot_key: 'weekly',
        vendor_or_partner: '',
        score: 0,
        points: 0,
        credited_calls: 0,
        weighted_delta: 0,
        count_08: 0,
        count_10: 0,
        frozen: false,
        live: true,
        raw_json: { events: [], states: [] },
        _vendors: new Set(),
        _stateKeys: new Set()
      });
    }
    const item = aggregates.get(key);
    item.score = round1(item.score + num(event.points));
    item.points = item.score;
    item.credited_calls = round1(item.credited_calls + num(event.credited_calls));
    item.weighted_delta = round1(item.weighted_delta + num(event.weighted_delta));
    item.count_08 += Math.round(num(event.count_08));
    item.count_10 += Math.round(num(event.count_10));
    item.raw_json.events.push(event);
    item._vendors.add(event.vendor_or_partner);
    if (state) {
      const stateKey = stateRowIdentity(state);
      if (!item._stateKeys.has(stateKey)) {
        item._stateKeys.add(stateKey);
        item.raw_json.states.push(state);
      }
    }
  });

  const items = [...aggregates.values()].map(item => {
    item.vendor_or_partner = [...item._vendors].join(',');
    const rider = riderMap.get(String(item.rider_id || ''));
    const firstEvent = item.raw_json.events[0] || {};
    const source = firstEvent.raw_json?.source || {};
    item.erp_id = rider?.erpId || String(firstEvent.raw_json?.matchKey || source.matchKey || '').trim();
    item.baemin_id = rider?.baeminId
      || (item.platform === 'baemin'
        ? String(source.crawlUserId || firstEvent.raw_json?.matchKey || '').trim()
        : '');
    attachMatchFields(item, rider);
    delete item._vendors;
    delete item._stateKeys;
    return item;
  }).sort((a, b) => b.points - a.points
    || b.credited_calls - a.credited_calls
    || String(a.name).localeCompare(String(b.name), 'ko'));

  const totals = items.reduce((acc, item) => {
    acc.count += 1;
    acc.pointsSum = round1(acc.pointsSum + item.points);
    acc.scoreSum = acc.pointsSum;
    acc.creditedCalls = round1(acc.creditedCalls + item.credited_calls);
    if (item.platform === 'baemin') acc.baemin += 1;
    if (item.platform === 'coupang') acc.coupang += 1;
    return acc;
  }, {
    count: 0, pointsSum: 0, scoreSum: 0, creditedCalls: 0,
    baemin: 0, coupang: 0, frozen: 0, live: 0
  });
  return { items, totals };
}

function buildRegionProgress(events, states, options = {}) {
  const eventTotals = new Map();
  (events || []).forEach(event => {
    const key = [
      event.date, event.platform, event.vendor_or_partner, event.slot_key
    ].join('|');
    const current = eventTotals.get(key) || { weightedCalls: 0, creditedCalls: 0, points: 0 };
    current.weightedCalls = round1(current.weightedCalls + num(event.weighted_delta));
    current.creditedCalls = round1(current.creditedCalls + num(event.credited_calls));
    current.points = round1(current.points + num(event.points));
    eventTotals.set(key, current);
  });
  const regionFilter = String(options.region || '').trim().toLowerCase();
  return (states || [])
    .filter(state => {
      const text = [
        state.region, state.vendor_or_partner, state.slot_key
      ].join(' ').toLowerCase();
      return !regionFilter || text.includes(regionFilter);
    })
    .map(state => {
      const key = [
        state.date, state.platform, state.vendor_or_partner, state.slot_key
      ].join('|');
      const earned = eventTotals.get(key) || { weightedCalls: 0, creditedCalls: 0, points: 0 };
      const completed = nonNegative(state.region_complete);
      const target = nonNegative(state.assigned_target);
      const rate = target > 0 ? Math.min(100, Math.round((completed / target) * 1000) / 10) : 0;
      return {
        date: state.date,
        platform: state.platform,
        region: state.region || state.vendor_or_partner,
        vendor_or_partner: state.vendor_or_partner,
        slot_key: state.slot_key,
        completed,
        target,
        rate,
        weighted_calls: earned.weightedCalls,
        credited_calls: earned.creditedCalls,
        points: earned.points,
        frozen: state.frozen === true,
        captured_at: state.last_captured_at
      };
    })
    .sort((a, b) => a.region.localeCompare(b.region, 'ko') || a.slot_key.localeCompare(b.slot_key));
}

async function listDaily(accessToken, options = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  try {
    const period = String(options.period || '').toLowerCase() === 'week' ? 'week' : 'day';
    const range = period === 'week'
      ? contributionWeekRange(options.date)
      : {
        fromDate: String(options.date || currentContributionDate()).slice(0, 10),
        toDate: String(options.date || currentContributionDate()).slice(0, 10)
      };
    const [eventResult, riderCacheResult] = await Promise.all([
      queryEvents(supabase, { ...options, ...range, limit: options.limit || 50000 }),
      loadRidersCached(supabase)
    ]);
    const riders = riderCacheResult.riders;
    const platform = String(options.platform || 'all').trim().toLowerCase();
    let stateQuery = supabase
      .from('contribution_slot_states')
      .select('*')
      .gte('date', range.fromDate)
      .lte('date', range.toDate)
      .limit(10000);
    if (platform === 'baemin' || platform === 'coupang') {
      stateQuery = stateQuery.eq('platform', platform);
    }
    const { data: states, error } = await stateQuery;
    if (error) throw error;
    const riderMap = new Map(riders.map(rider => [String(rider.id), rider]));
    const aggregated = period === 'week'
      ? aggregateWeekly(eventResult.items, states || [], riderMap)
      : aggregateDaily(eventResult.items, states || [], riderMap);
    const regions = buildRegionProgress(eventResult.items, states || [], options);
    return {
      ok: true,
      date: eventResult.date,
      period,
      fromDate: range.fromDate,
      toDate: range.toDate,
      items: aggregated.items,
      regions,
      totals: aggregated.totals,
      ledgerVersion: 3,
      legacyContributionDailyExcluded: true
    };
  } catch (error) {
    return {
      ok: false,
      status: isMissingLedger(error) ? 503 : 500,
      tableMissing: isMissingLedger(error),
      error: isMissingLedger(error)
        ? '기여도 v3 migration이 필요합니다: supabase/contribution_ledger_v3.sql'
        : (error.message || '기여도 일별 조회 실패')
    };
  }
}

module.exports = {
  CONFIG_KEY,
  DEFAULT_CONFIG,
  normalizeConfig,
  decomposeCoupangWeightedDelta,
  currentCoupangPeakKey,
  startedBaeminSlotKeys,
  startedCoupangPeakKeys,
  currentContributionDate,
  contributionCollectDates,
  itemContributionDate,
  filterItemsForContributionDate,
  coupangAbsolute,
  isActivationSlot,
  computeCaptureTransition,
  filterLatestWave,
  buildCoupangCurrentGroups,
  aggregateDaily,
  aggregateWeekly,
  contributionWeekRange,
  buildRegionProgress,
  getConfig,
  saveConfig,
  activateLedger,
  listEvents,
  refreshSnapshot,
  refreshSnapshotCore,
  scheduleAutoRefresh,
  listDaily,
  todayKst
};
