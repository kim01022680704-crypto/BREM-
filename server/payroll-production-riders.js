const { createClient } = require('@supabase/supabase-js');

const PAGE_SIZE = 500;
const SELECT_COLUMNS = 'id,name,phone,baemin_id,promotion_selector_coupang,raw_data,hidden_fields';

function isProductionDeployment() {
  return process.env.NODE_ENV === 'production' && process.env.BREM_MODE === 'production';
}

function isFeatureEnabled() {
  // brem-dev 분리: 로컬은 dev Supabase riders 사용 — 운영 DB 읽기 API 비활성
  return false;
}

function getProductionConfig() {
  const url = String(
    process.env.BREM_PRODUCTION_SUPABASE_URL
    || process.env.BREM_PAYROLL_PRODUCTION_SUPABASE_URL
    || process.env.SUPABASE_URL
    || ''
  ).trim();
  const anonKey = String(
    process.env.BREM_PRODUCTION_SUPABASE_ANON_KEY
    || process.env.BREM_PAYROLL_PRODUCTION_SUPABASE_ANON_KEY
    || process.env.SUPABASE_ANON_KEY
    || ''
  ).trim();
  return { url, anonKey };
}

function isConfigured() {
  if (!isFeatureEnabled()) return false;
  const { url, anonKey } = getProductionConfig();
  return Boolean(url && anonKey);
}

function createAnonClient() {
  const { url, anonKey } = getProductionConfig();
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function createAuthedReadClient(accessToken) {
  const { url, anonKey } = getProductionConfig();
  const token = String(accessToken || '').trim();
  if (!url || !anonKey || !token) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

function pickString(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function mapReadOnlyRider(row) {
  const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  const hidden = row.hidden_fields && typeof row.hidden_fields === 'object' ? row.hidden_fields : {};
  const phoneDigits = String(row.phone || '').replace(/[^0-9]/g, '');
  const nameKey = String(row.name || '').replace(/\s/g, '');
  const fallbackCoupangId = nameKey && phoneDigits.length >= 4
    ? `${nameKey}${phoneDigits.slice(-4)}`
    : '';

  return {
    id: String(row.id || '').trim(),
    name: String(row.name || '').trim(),
    phone: String(row.phone || '').trim(),
    employeeNo: pickString(raw.employeeNo, raw.employee_no, hidden.employeeNo, hidden.employee_no),
    coupangId: pickString(
      raw.coupangId,
      raw.coupangLoginKey,
      raw.coupangLoginId,
      row.promotion_selector_coupang,
      fallbackCoupangId
    ),
    baeminId: String(row.baemin_id || raw.baeminId || '').trim()
  };
}

async function verifyProductionAdmin(accessToken) {
  const client = createAnonClient();
  const token = String(accessToken || '').trim();
  if (!client || !token) {
    return { ok: false, status: 401, error: '운영 Supabase 관리자 로그인이 필요합니다.' };
  }

  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData?.user) {
    return { ok: false, status: 401, error: '운영 Supabase 로그인 세션이 유효하지 않습니다.' };
  }

  const authed = createAuthedReadClient(token);
  const { data: profile, error: profileError } = await authed
    .from('profiles')
    .select('user_id, role, active')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (profileError || profile?.role !== 'admin' || profile.active !== true) {
    return { ok: false, status: 403, error: '운영 Supabase 관리자 권한이 없습니다.' };
  }

  return { ok: true, userId: userData.user.id };
}

async function signInProductionAdmin(login, password) {
  if (!isFeatureEnabled()) {
    return {
      ok: false,
      status: 403,
      error: '운영 기사목록 읽기는 로컬 개발 환경에서만 사용할 수 있습니다.'
    };
  }

  const client = createAnonClient();
  if (!client) {
    return {
      ok: false,
      status: 503,
      error: '운영 Supabase URL / ANON KEY 설정이 없습니다.'
    };
  }

  const loginInput = String(login || '').trim();
  const loginPassword = String(password || '');
  if (!loginInput || !loginPassword) {
    return { ok: false, status: 400, error: '운영 관리자 이메일과 비밀번호를 입력하세요.' };
  }

  let email = loginInput;
  if (!email.includes('@')) {
    const mappedEmail = String(process.env.BREM_ADMIN_EMAIL || '').trim();
    if (loginInput === String(process.env.BREM_ADMIN_LOGIN_NAME || '관리자').trim() && mappedEmail) {
      email = mappedEmail;
    } else {
      return {
        ok: false,
        status: 400,
        error: '운영 Supabase 관리자 이메일로 로그인하세요. (로컬 관리자/1234 와 다릅니다)'
      };
    }
  }

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: loginPassword
  });

  if (error || !data?.session?.access_token) {
    return {
      ok: false,
      status: 401,
      error: '운영 Supabase 로그인에 실패했습니다. 이메일/비밀번호를 확인하세요.'
    };
  }

  const verified = await verifyProductionAdmin(data.session.access_token);
  if (!verified.ok) {
    await client.auth.signOut();
    return verified;
  }

  return {
    ok: true,
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at
    },
    readOnly: true
  };
}

async function fetchReadOnlyRiders(accessToken) {
  if (!isFeatureEnabled()) {
    return {
      ok: false,
      status: 403,
      error: '운영 기사목록 읽기는 로컬 개발 환경에서만 사용할 수 있습니다.'
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

  const riders = [];
  let offset = 0;
  let total = null;

  while (true) {
    const { data, error, count } = await supabase
      .from('riders')
      .select(SELECT_COLUMNS, { count: offset === 0 ? 'exact' : undefined })
      .order('name', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
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

    const batch = Array.isArray(data) ? data : [];
    if (total == null && Number.isFinite(count)) total = count;
    riders.push(...batch.map(mapReadOnlyRider).filter(item => item.id && item.name));

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return {
    ok: true,
    riders,
    total: total ?? riders.length,
    syncedAt: new Date().toISOString(),
    readOnly: true,
    source: 'production-supabase-riders-rls'
  };
}

function getStatus() {
  const { url, anonKey } = getProductionConfig();
  return {
    ok: true,
    enabled: isFeatureEnabled(),
    configured: isConfigured(),
    readOnly: true,
    authMode: 'anon-rls',
    url,
    hasAnonKey: Boolean(anonKey),
    source: 'production-supabase-riders-rls'
  };
}

module.exports = {
  isFeatureEnabled,
  isConfigured,
  getProductionConfig,
  verifyProductionAdmin,
  createAuthedReadClient,
  createAnonClient,
  mapReadOnlyRider,
  signInProductionAdmin,
  fetchReadOnlyRiders,
  getStatus
};
