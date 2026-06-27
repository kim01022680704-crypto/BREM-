const {
  isFeatureEnabled,
  isConfigured,
  verifyProductionAdmin,
  createAuthedReadClient,
  mapReadOnlyRider
} = require('./payroll-production-riders');

const PAGE_SIZE = 1000;
const CALLS_LOOKBACK_DAYS = 540;
const RIDER_SELECT = 'id,name,phone,baemin_id,promotion_selector_coupang,raw_data,hidden_fields';
const CALL_SELECT = 'id,driver_id,date,platform,count,rider_published_at';
const MANUAL_MAPPINGS_KEY = 'brem_admin_manual_name_mappings';

function callsSinceDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - CALLS_LOOKBACK_DAYS);
  return date.toISOString().slice(0, 10);
}

function mapCall(row) {
  return {
    id: String(row.id || '').trim(),
    driverId: String(row.driver_id || '').trim(),
    date: String(row.date || '').slice(0, 10),
    platform: String(row.platform || 'coupang').trim(),
    count: Number(row.count) || 0,
    riderPublishedAt: row.rider_published_at || null
  };
}

function mapDriverForPayroll(row) {
  const mapped = mapReadOnlyRider(row);
  return {
    ...mapped,
    coupangLoginKey: mapped.coupangId || ''
  };
}

function isMissingTableError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('does not exist')
    || message.includes('schema cache')
    || (message.includes('relation') && message.includes('does not exist'));
}

async function fetchAllRiders(supabase) {
  const drivers = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('riders')
      .select(RIDER_SELECT)
      .order('name', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw error;
    }

    const batch = Array.isArray(data) ? data : [];
    drivers.push(...batch.map(mapDriverForPayroll).filter(item => item.id && item.name));

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return drivers;
}

async function fetchCallsForRange(supabase, sinceDate, untilDate) {
  const since = String(sinceDate || '').slice(0, 10);
  const until = String(untilDate || since).slice(0, 10);
  if (!since) return [];

  const calls = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from('admin_calls')
      .select(CALL_SELECT)
      .gte('date', since)
      .order('date', { ascending: true });

    if (until) query = query.lte('date', until);

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      if (isMissingTableError(error)) return [];
      throw error;
    }

    const batch = Array.isArray(data) ? data : [];
    calls.push(...batch.map(mapCall).filter(item => item.id));

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return calls;
}

async function fetchCallsSince(supabase, sinceDate) {
  return fetchCallsForRange(supabase, sinceDate, '');
}

async function fetchManualNameMappings(supabase) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', MANUAL_MAPPINGS_KEY)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) return [];
    return [];
  }

  const value = data?.value;
  return Array.isArray(value) ? value : [];
}

async function fetchReadOnlyBaseData(accessToken) {
  if (!isFeatureEnabled()) {
    return {
      ok: false,
      status: 403,
      error: '운영 데이터 가져오기는 로컬 개발 환경에서만 사용할 수 있습니다.'
    };
  }

  const verified = await verifyProductionAdmin(accessToken);
  if (!verified.ok) return verified;

  const supabase = createAuthedReadClient(accessToken);
  if (!supabase) {
    return {
      ok: false,
      status: 503,
      error: '운영 Supabase URL / ANON KEY 설정이 없습니다.'
    };
  }

  const sinceDate = callsSinceDate();
  let drivers = [];
  let calls = [];
  let manualNameMappings = [];
  const warnings = [];

  try {
    drivers = await fetchAllRiders(supabase);
  } catch (error) {
    const message = String(error.message || '');
    if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('policy')) {
      return {
        ok: false,
        status: 403,
        error: 'riders 조회 권한이 없습니다. 운영 관리자 계정으로 다시 로그인하세요.'
      };
    }
    return {
      ok: false,
      status: 500,
      error: error.message || '운영 riders 조회에 실패했습니다.'
    };
  }

  try {
    calls = await fetchCallsSince(supabase, sinceDate);
  } catch (error) {
    warnings.push(`콜수(admin_calls) 조회 생략: ${error.message || '오류'}`);
  }

  try {
    manualNameMappings = await fetchManualNameMappings(supabase);
  } catch (error) {
    warnings.push(`수동 이름 매핑 조회 생략: ${error.message || '오류'}`);
  }

  const referenceCount = calls.length + manualNameMappings.length;

  return {
    ok: true,
    readOnly: true,
    source: 'production-supabase-base-data-rls',
    syncedAt: new Date().toISOString(),
    callsSinceDate: sinceDate,
    drivers,
    calls,
    manualNameMappings,
    counts: {
      drivers: drivers.length,
      calls: calls.length,
      manualNameMappings: manualNameMappings.length,
      reference: referenceCount
    },
    warnings
  };
}

async function fetchReadOnlyCallsForRange(accessToken, startDate, endDate) {
  if (!isFeatureEnabled()) {
    return {
      ok: false,
      status: 403,
      error: '운영 콜수 조회는 로컬 개발 환경에서만 사용할 수 있습니다.'
    };
  }

  const verified = await verifyProductionAdmin(accessToken);
  if (!verified.ok) return verified;

  const supabase = createAuthedReadClient(accessToken);
  if (!supabase) {
    return {
      ok: false,
      status: 503,
      error: '운영 Supabase URL / ANON KEY 설정이 없습니다.'
    };
  }

  const sinceDate = String(startDate || '').slice(0, 10);
  const untilDate = String(endDate || startDate || '').slice(0, 10);
  if (!sinceDate) {
    return { ok: false, status: 400, error: '정산주 시작일이 필요합니다.' };
  }

  try {
    const calls = await fetchCallsForRange(supabase, sinceDate, untilDate);
    return {
      ok: true,
      readOnly: true,
      calls,
      sinceDate,
      untilDate,
      total: calls.length,
      syncedAt: new Date().toISOString()
    };
  } catch (error) {
    const message = String(error.message || '');
    if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('policy')) {
      return {
        ok: false,
        status: 403,
        error: 'admin_calls 조회 권한이 없습니다. 운영 관리자 계정으로 다시 로그인하세요.'
      };
    }
    return {
      ok: false,
      status: 500,
      error: error.message || '운영 콜수 조회에 실패했습니다.'
    };
  }
}

function getStatus() {
  return {
    ok: true,
    enabled: isFeatureEnabled(),
    configured: isConfigured(),
    readOnly: true,
    authMode: 'anon-rls',
    source: 'production-supabase-base-data-rls'
  };
}

module.exports = {
  fetchReadOnlyBaseData,
  fetchReadOnlyCallsForRange,
  getStatus
};
