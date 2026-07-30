const { getServiceClient } = require('./admin-bootstrap');
const { getRiderMe } = require('./rider-auth');
const { computeSlotTargets, SLOT_LABELS } = require('./baemin-quota');
const { readWeekdayQuotaMatrix } = require('./baemin-weekday-quota');
const { readPartnerSetCountMap, normalizeSetCount } = require('./baemin-partner-set-count');

const EXPOSURE_KEY = 'brem_rider_dashboard_region_exposure_v1';

/** KST 기준 현재 배민 시간대 (아침점심/오후/저녁/심야) */
function currentBaeminSlotKey(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    hour12: false
  }).format(now));
  if (hour >= 7 && hour < 14) return 'morning';
  if (hour >= 14 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'midnight';
}

function isDrivingStatus(statusDesc) {
  const compact = String(statusDesc || '').replace(/\s+/g, '');
  if (!compact) return false;
  if (compact.includes('운행종료') || compact.includes('운행중지') || compact.includes('운행불가')) return false;
  return compact.includes('운행중');
}

function formatLocalDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function normalizeSettlementWeekStart(dateValue) {
  const seed = String(dateValue || '').trim().slice(0, 10);
  const base = seed || formatLocalDateKey(new Date());
  const date = new Date(`${base}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const diff = (date.getDay() - 3 + 7) % 7;
  date.setDate(date.getDate() - diff);
  return formatLocalDateKey(date);
}

function settlementWeekEnd(weekStart) {
  const start = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(start.getTime())) return '';
  start.setDate(start.getDate() + 6);
  return formatLocalDateKey(start);
}

function normalizePlatform(value) {
  return String(value || '').toLowerCase() === 'coupang' ? 'coupang' : 'baemin';
}

function maskName(name) {
  const text = String(name || '').trim();
  if (!text) return '-';
  if (text.length === 1) return text;
  if (text.length === 2) return `${text[0]}*`;
  return `${text[0]}${'*'.repeat(Math.min(2, text.length - 2))}${text[text.length - 1]}`;
}

function shortCoupangRegion(value) {
  return String(value || '').replace(/\s/g, '').slice(0, 4);
}

async function readExposureMap(supabase) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', EXPOSURE_KEY)
    .maybeSingle();
  if (error) throw error;
  const value = data?.value && typeof data.value === 'object' ? data.value : {};
  return {
    baemin: value.baemin && typeof value.baemin === 'object' ? value.baemin : {},
    coupang: value.coupang && typeof value.coupang === 'object' ? value.coupang : {}
  };
}

function listExposedRegions(exposure, platform) {
  const side = exposure[platform] || {};
  return Object.entries(side)
    .filter(([, meta]) => meta && meta.exposed !== false && meta.exposed !== 0)
    .map(([key, meta]) => ({
      key,
      platform,
      label: String(meta.label || key).trim() || key,
      partnerId: String(meta.partnerId || '').trim(),
      vendorId: String(meta.vendorId || '').trim()
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}

function riderMatchesRegion(rider, region) {
  if (!rider || !region) return false;
  if (region.platform === 'baemin') {
    const value = String(rider.regionBaemin || rider.raw_data?.regionBaemin || '').trim();
    if (!value) return false;
    return value === region.label
      || value === region.partnerId
      || value === region.key
      || (region.partnerId && value.includes(region.partnerId));
  }
  const value = String(rider.regionCoupang || rider.raw_data?.regionCoupang || '').trim();
  if (!value) return false;
  return shortCoupangRegion(value) === shortCoupangRegion(region.key)
    || shortCoupangRegion(value) === shortCoupangRegion(region.label)
    || value === region.vendorId;
}

async function loadRidersForRegion(supabase, region) {
  const { data, error } = await supabase
    .from('riders')
    .select('id,name,baemin_id,raw_data,status')
    .limit(5000);
  if (error) throw error;
  return (data || [])
    .map(row => ({
      id: row.id,
      name: row.name || '',
      baeminId: row.baemin_id || '',
      regionBaemin: String(row.raw_data?.regionBaemin || '').trim(),
      regionCoupang: String(row.raw_data?.regionCoupang || '').trim(),
      raw_data: row.raw_data || {},
      status: row.status || ''
    }))
    .filter(rider => riderMatchesRegion(rider, region));
}

async function buildWeeklyRanking(supabase, region, weekStart, weekEnd) {
  const riders = await loadRidersForRegion(supabase, region);
  if (!riders.length) return [];
  const riderIds = riders.map(r => r.id);
  const { data, error } = await supabase
    .from('admin_calls')
    .select('driver_id,date,platform,count')
    .in('driver_id', riderIds)
    .eq('platform', region.platform)
    .gte('date', weekStart)
    .lte('date', weekEnd);
  if (error) throw error;

  const totals = new Map();
  (data || []).forEach(row => {
    const id = String(row.driver_id || '');
    if (!id) return;
    totals.set(id, (totals.get(id) || 0) + Math.max(0, Math.round(Number(row.count || 0))));
  });

  return riders
    .map(rider => ({
      driverId: rider.id,
      name: maskName(rider.name),
      callCount: totals.get(rider.id) || 0
    }))
    .filter(row => row.callCount > 0)
    .sort((a, b) => b.callCount - a.callCount || a.name.localeCompare(b.name, 'ko'))
    .slice(0, 10)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

async function buildBaeminLive(supabase, region, today) {
  const partnerId = String(region.partnerId || region.key || '').trim().toUpperCase();
  const { data, error } = await supabase
    .from('baemin_biz_collect_items')
    .select('dedupe_key,parsed_json,partner_id')
    .eq('collect_date', today)
    .eq('source_menu', 'delivery_status')
    .eq('partner_id', partnerId)
    .limit(3000);

  if (error) {
    if (/does not exist|schema cache/i.test(error.message || '')) {
      return { metrics: emptyMetrics(), realtimeRanking: [] };
    }
    throw error;
  }

  const rows = data || [];
  let driving = 0;
  const ranking = [];
  rows.forEach(row => {
    const parsed = row.parsed_json || {};
    if (isDrivingStatus(parsed.statusDesc || parsed.status_desc || '')) driving += 1;
    const complete = Math.max(0, Math.round(Number(parsed.totalComplete || parsed.total_complete || 0)));
    const name = String(parsed.riderName || parsed.rider_name || parsed.name || '').trim();
    if (complete > 0 || name) {
      ranking.push({
        driverId: String(row.dedupe_key || parsed.userId || ''),
        name: maskName(name || '-'),
        callCount: complete
      });
    }
  });

  ranking.sort((a, b) => b.callCount - a.callCount || a.name.localeCompare(b.name, 'ko'));
  const top = ranking.slice(0, 10).map((row, index) => ({ ...row, rank: index + 1 }));

  // 할당 = 현재 시간대 목표(요일할당 × 지역 세트수), 남은할당 = max(0, 할당 - 운행중)
  let assigned = 0;
  let slotKey = currentBaeminSlotKey();
  try {
    const [setCountMap, matrix] = await Promise.all([
      readPartnerSetCountMap(),
      readWeekdayQuotaMatrix()
    ]);
    const setCount = normalizeSetCount(setCountMap?.[partnerId]?.setCount) || 1;
    const targets = computeSlotTargets(setCount, today, matrix);
    assigned = Math.max(0, Math.round(Number(targets[slotKey] || 0)));
  } catch (_) {
    assigned = 0;
  }

  const remaining = Math.max(0, assigned - driving);
  const slotLabel = SLOT_LABELS[slotKey] || slotKey;

  return {
    metrics: {
      assigned,
      operating: driving,
      remaining,
      slotKey,
      slotLabel,
      sourceNote: `배민 ${slotLabel} 할당 · 운행현황 수집 기준`
    },
    realtimeRanking: top
  };
}

async function buildCoupangLive(supabase, region, today) {
  const vendorId = region.vendorId || '';
  const label = shortCoupangRegion(region.label || region.key);

  let vendorFilter = supabase
    .from('coupang_collect_items')
    .select('vendor_id,vendor_name,parsed_json,source_menu,collect_date')
    .eq('collect_date', today)
    .in('source_menu', ['peak_realtime', 'vendor_info', 'rider_daily'])
    .limit(5000);

  const { data, error } = await vendorFilter;
  if (error) {
    if (/does not exist|schema cache/i.test(error.message || '')) {
      return { metrics: emptyMetrics(), realtimeRanking: [] };
    }
    throw error;
  }

  const rows = (data || []).filter(row => {
    const vid = String(row.vendor_id || '').trim();
    const vname = shortCoupangRegion(row.vendor_name || '');
    if (vendorId && vid === vendorId) return true;
    if (label && vname === label) return true;
    if (label && shortCoupangRegion(row.vendor_name || '') === label) return true;
    return false;
  });

  let assigned = 0;
  let operating = 0;
  let remaining = 0;
  const ranking = [];

  rows.forEach(row => {
    const parsed = row.parsed_json || {};
    if (row.source_menu === 'peak_realtime') {
      assigned = Math.max(assigned, Math.round(Number(parsed.goalCount || 0)));
      remaining = Math.max(remaining, Math.round(Number(parsed.remainingCount || 0)));
    }
    if (row.source_menu === 'vendor_info') {
      operating = Math.max(operating, Math.round(Number(parsed.riderOnLineCount || parsed.onGoingCount || 0)));
      if (!assigned) assigned = Math.round(Number(parsed.target || 0));
    }
    if (row.source_menu === 'rider_daily') {
      const complete = Math.max(0, Math.round(Number(parsed.completeCount || 0)));
      const name = String(parsed.name || parsed.riderName || '').trim();
      ranking.push({
        driverId: String(parsed.courierId || parsed.matchKey || ''),
        name: maskName(name || '-'),
        callCount: complete
      });
    }
  });

  ranking.sort((a, b) => b.callCount - a.callCount || a.name.localeCompare(b.name, 'ko'));
  return {
    metrics: {
      assigned,
      operating,
      remaining,
      sourceNote: '쿠팡 대시보드 수집 기준'
    },
    realtimeRanking: ranking.slice(0, 10).map((row, index) => ({ ...row, rank: index + 1 }))
  };
}

function emptyMetrics() {
  return { assigned: 0, operating: 0, remaining: 0, sourceNote: '' };
}

async function getRiderRegionDashboard(accessToken, query = {}) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const platform = normalizePlatform(query.platform || 'baemin');
  const today = formatLocalDateKey(new Date());
  const weekStart = normalizeSettlementWeekStart(query.weekStart || today);
  const weekEnd = settlementWeekEnd(weekStart);

  let exposure;
  try {
    exposure = await readExposureMap(supabase);
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '노출 설정을 불러오지 못했습니다.' };
  }

  const regions = listExposedRegions(exposure, platform);
  if (!regions.length) {
    return {
      ok: true,
      platform,
      weekStart,
      weekEnd,
      today,
      regions: [],
      selectedRegionKey: '',
      region: null,
      metrics: emptyMetrics(),
      realtimeRanking: [],
      weeklyRanking: [],
      message: '관리자가 노출로 설정한 지역이 없습니다.'
    };
  }

  // 기사 소속 지역이 노출 목록에 있으면 기본 선택
  const riderRegionLabel = platform === 'coupang'
    ? String(me.rider?.regionCoupang || me.rider?.raw_data?.regionCoupang || '').trim()
    : String(me.rider?.regionBaemin || me.rider?.raw_data?.regionBaemin || '').trim();
  const preferred = regions.find(region => {
    if (!riderRegionLabel) return false;
    if (platform === 'coupang') {
      return shortCoupangRegion(riderRegionLabel) === shortCoupangRegion(region.key)
        || shortCoupangRegion(riderRegionLabel) === shortCoupangRegion(region.label);
    }
    return riderRegionLabel === region.label
      || riderRegionLabel === region.partnerId
      || riderRegionLabel === region.key;
  });

  const requestedKey = String(query.regionKey || '').trim();
  const selected = regions.find(region => region.key === requestedKey)
    || preferred
    || regions[0];

  let live = { metrics: emptyMetrics(), realtimeRanking: [] };
  let weeklyRanking = [];
  try {
    live = platform === 'coupang'
      ? await buildCoupangLive(supabase, selected, today)
      : await buildBaeminLive(supabase, selected, today);
    weeklyRanking = await buildWeeklyRanking(supabase, selected, weekStart, weekEnd);
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '지역 대시보드를 불러오지 못했습니다.' };
  }

  return {
    ok: true,
    platform,
    weekStart,
    weekEnd,
    today,
    regions,
    selectedRegionKey: selected.key,
    region: selected,
    metrics: live.metrics,
    realtimeRanking: live.realtimeRanking,
    weeklyRanking,
    message: ''
  };
}

async function getAdminRegionExposure(accessToken) {
  const { verifyAdminCaller } = require('./admin-users');
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  try {
    const exposure = await readExposureMap(supabase);
    return { ok: true, exposure };
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '노출 설정을 불러오지 못했습니다.' };
  }
}

async function saveAdminRegionExposure(accessToken, body = {}) {
  const { verifyAdminCaller } = require('./admin-users');
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const platform = normalizePlatform(body.platform);
  const key = String(body.key || '').trim();
  if (!key) return { ok: false, status: 400, error: '지역 키가 없습니다.' };

  try {
    const exposure = await readExposureMap(supabase);
    const side = { ...(exposure[platform] || {}) };
    const exposed = body.exposed === true;
    if (!exposed) {
      delete side[key];
    } else {
      side[key] = {
        exposed: true,
        label: String(body.label || key).trim() || key,
        partnerId: String(body.partnerId || '').trim(),
        vendorId: String(body.vendorId || '').trim(),
        updatedAt: new Date().toISOString()
      };
    }
    const next = {
      ...exposure,
      [platform]: side,
      updatedAt: new Date().toISOString()
    };
    const { error } = await supabase.from('settings').upsert({
      key: EXPOSURE_KEY,
      value: next,
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' });
    if (error) throw error;
    return { ok: true, exposure: next };
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '노출 설정을 저장하지 못했습니다.' };
  }
}

module.exports = {
  EXPOSURE_KEY,
  getRiderRegionDashboard,
  getAdminRegionExposure,
  saveAdminRegionExposure
};
