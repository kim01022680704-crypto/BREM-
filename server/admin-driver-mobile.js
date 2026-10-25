const { getServiceClient } = require('./admin-bootstrap');
const ridersAdmin = require('./riders-admin');
const riderAuth = require('./rider-auth');

function kstToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

function isDrivingStatus(statusDesc) {
  const compact = String(statusDesc || '').replace(/\s+/g, '');
  if (!compact) return false;
  if (compact.includes('운행종료') || compact.includes('운행중지') || compact.includes('운행불가')) return false;
  return compact.includes('운행중');
}

function isCoupangDrivingStatus(edpStatus) {
  const compact = String(edpStatus || '').replace(/[\s_-]+/g, '').toUpperCase();
  return compact === 'ONLINE';
}

function baeminIdVariants(value) {
  const raw = String(value || '').trim().replace(/\.0+$/, '');
  if (!raw) return [];
  const digits = raw.replace(/\D/g, '');
  const stripped = digits.replace(/^0+/, '') || digits;
  const withZero = digits.startsWith('0') ? digits : (digits.length >= 10 ? `0${digits}` : digits);
  return [...new Set([raw, digits, stripped, withZero].filter(Boolean))];
}

function publicRider(row) {
  const raw = row?.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  return {
    id: row.id,
    name: row.name || '',
    phone: row.phone || '',
    status: row.status || '근무중',
    baeminId: row.baemin_id || '',
    platformBaemin: Boolean(row.platform_baemin),
    platformCoupang: row.platform_coupang !== false,
    regionBaemin: String(raw.regionBaemin || '').trim(),
    regionCoupang: String(raw.regionCoupang || '').trim()
  };
}

function slimBaemin(ops) {
  if (!ops) return null;
  return {
    available: Boolean(ops.available),
    complete: Number(ops.complete || 0),
    slaOutComplete: Number(ops.slaOutComplete || 0),
    foodReject: Number(ops.foodReject || 0),
    foodCancel: Number(ops.foodCancel || 0),
    acceptRate: ops.acceptRate ?? null,
    weekComplete: Number(ops.weekComplete || 0),
    weekSlaOutComplete: Number(ops.weekSlaOutComplete || 0),
    weekFoodReject: Number(ops.weekFoodReject || 0),
    weekFoodCancel: Number(ops.weekFoodCancel || 0),
    weekAcceptRate: ops.weekAcceptRate ?? null,
    collectedAt: ops.collectedAt || null
  };
}

function slimCoupang(ops) {
  if (!ops) return null;
  return {
    available: Boolean(ops.available),
    complete: Number(ops.complete || 0),
    reject: Number(ops.reject || 0),
    cancel: Number(ops.cancel || 0),
    rejectionRate: ops.rejectionRate ?? null,
    weekComplete: Number(ops.weekComplete || 0),
    weekReject: Number(ops.weekReject || 0),
    weekCancel: Number(ops.weekCancel || 0),
    weekRejectionRate: ops.weekRejectionRate ?? null,
    collectedAt: ops.collectedAt || null
  };
}

function unknownOperating(reason) {
  return {
    known: false,
    operating: null,
    status: '',
    collectedAt: null,
    collectDate: null,
    reason: reason || ''
  };
}

async function loadBaeminOperating(supabase, rider) {
  if (!rider?.platform_baemin && !String(rider?.baemin_id || '').trim()) {
    return { ...unknownOperating('UNUSED'), skipped: true };
  }
  const variants = baeminIdVariants(rider.baemin_id);
  if (!variants.length) return unknownOperating('NO_BAEMIN_ID');
  const today = kstToday();
  const tables = ['baemin_delivery_applied_items', 'baemin_biz_collect_items'];
  let best = null;
  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('collected_at,collect_date,parsed_json')
      .eq('source_menu', 'delivery_status')
      .in('rider_user_id', variants)
      .order('collected_at', { ascending: false })
      .limit(12);
    if (error) {
      if (!/does not exist|Could not find the table/i.test(String(error.message || ''))) {
        console.warn(`[BREM] driver mobile baemin ops (${table}):`, error.message || error);
      }
      continue;
    }
    (data || []).forEach(row => {
      const collectedAt = Date.parse(row.collected_at || '') || 0;
      if (best && collectedAt && collectedAt < best.collectedAt) return;
      const parsed = row.parsed_json && typeof row.parsed_json === 'object' ? row.parsed_json : {};
      const status = String(parsed.statusDesc || parsed.status_desc || '').trim();
      best = {
        collectedAt,
        collectDate: String(row.collect_date || '').slice(0, 10),
        status,
        operating: isDrivingStatus(status)
      };
    });
    if (best) break;
  }
  if (!best || best.collectDate !== today) return unknownOperating('NO_TODAY');
  return {
    known: true,
    operating: Boolean(best.operating),
    status: best.status || (best.operating ? '운행중' : '운행종료'),
    collectedAt: best.collectedAt || null,
    collectDate: best.collectDate
  };
}

async function loadCoupangOperating(supabase, rider) {
  if (rider?.platform_coupang === false) return { ...unknownOperating('UNUSED'), skipped: true };
  const keys = riderAuth.coupangMatchKeysForRider(rider);
  if (!keys.length) return unknownOperating('NO_COUPANG_ID');
  const today = kstToday();
  const { data, error } = await supabase
    .from('coupang_collect_items')
    .select('collected_at,collect_date,parsed_json')
    .eq('source_menu', 'rider_daily')
    .eq('collect_date', today)
    .in('match_key', keys.slice(0, 8))
    .order('collected_at', { ascending: false })
    .limit(8);
  if (error) {
    if (!/does not exist|Could not find the table/i.test(String(error.message || ''))) {
      console.warn('[BREM] driver mobile coupang ops:', error.message || error);
    }
    return unknownOperating('LOOKUP_FAILED');
  }
  const row = (data || [])[0];
  if (!row) return unknownOperating('NO_TODAY');
  const parsed = row.parsed_json && typeof row.parsed_json === 'object' ? row.parsed_json : {};
  const status = String(parsed.edpStatus || '').trim();
  const operating = isCoupangDrivingStatus(status);
  return {
    known: true,
    operating,
    status: operating ? '운행중' : (status || '운행종료'),
    collectedAt: Date.parse(row.collected_at || '') || null,
    collectDate: today
  };
}

function mergeOperating(baemin, coupang) {
  if (baemin?.operating === true || coupang?.operating === true) return true;
  if (baemin?.known || coupang?.known) return false;
  return null;
}

async function getDriverMobilePreview(accessToken, driverId) {
  const riderResult = await ridersAdmin.getRider(accessToken, driverId);
  if (!riderResult.ok) return riderResult;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const rider = riderResult.rider;
  const [baeminOps, coupangOps, baemin, coupang] = await Promise.all([
    riderAuth.loadRiderBaeminOps(supabase, rider).catch(error => {
      console.warn('[BREM] driver mobile baemin live:', error?.message || error);
      return null;
    }),
    riderAuth.loadRiderCoupangOps(supabase, rider).catch(error => {
      console.warn('[BREM] driver mobile coupang live:', error?.message || error);
      return null;
    }),
    loadBaeminOperating(supabase, rider),
    loadCoupangOperating(supabase, rider)
  ]);

  return {
    ok: true,
    rider: publicRider(rider),
    baeminOps: slimBaemin(baeminOps),
    coupangOps: slimCoupang(coupangOps),
    operating: {
      operating: mergeOperating(baemin, coupang),
      baemin,
      coupang
    }
  };
}

module.exports = { getDriverMobilePreview };
