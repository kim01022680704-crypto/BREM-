const { createClient } = require('@supabase/supabase-js');
const { getServiceClient } = require('./admin-bootstrap');
const {
  normalizeEmail,
  readRegistryCached,
  buildFallbackAccountFromProfile,
  ensureInitialAdminRegistry
} = require('./admin-registry');

let anonAuthClient = null;

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message || 'timeout')), ms);
    })
  ]);
}

async function resolveAdminLoginEmail(loginInput) {
  const value = String(loginInput || '').trim();
  if (!value) {
    return { ok: false, status: 400, error: '아이디를 입력하세요.' };
  }

  if (value.includes('@')) {
    return { ok: true, email: normalizeEmail(value) };
  }

  const initialLoginName = String(process.env.BREM_ADMIN_LOGIN_NAME || '관리자').trim();
  const initialEmail = normalizeEmail(process.env.BREM_ADMIN_EMAIL);
  if (value === initialLoginName && initialEmail) {
    return { ok: true, email: initialEmail };
  }

  try {
    const { getPublicConfig } = require('./public-config');
    const hinted = getPublicConfig().adminLoginHints?.[value];
    if (hinted && String(hinted).includes('@')) {
      return { ok: true, email: normalizeEmail(hinted) };
    }
  } catch {
    /* ignore */
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  try {
    const { data: directoryRow } = await withTimeout(
      supabase
        .from('admin_login_directory')
        .select('email')
        .eq('login_name', value)
        .maybeSingle(),
      4000,
      'directory lookup timeout'
    );
    if (directoryRow?.email) {
      return { ok: true, email: normalizeEmail(directoryRow.email) };
    }
  } catch {
    /* directory table may not exist yet */
  }

  try {
    const { data: profileRow } = await withTimeout(
      supabase
        .from('profiles')
        .select('user_id, display_name, active, role')
        .eq('role', 'admin')
        .eq('display_name', value)
        .eq('active', true)
        .maybeSingle(),
      5000,
      'profile lookup timeout'
    );
    if (profileRow?.user_id) {
      const { fetchUserEmail } = require('./admin-registry');
      const email = await withTimeout(
        fetchUserEmail(supabase, profileRow.user_id),
        5000,
        'email lookup timeout'
      ).catch(() => '');
      if (email) {
        return { ok: true, email: normalizeEmail(email) };
      }
    }
  } catch {
    /* profiles lookup failed — fall through to registry */
  }

  let accounts = [];
  try {
    accounts = await withTimeout(readRegistryCached(supabase), 6000, 'registry timeout');
  } catch {
    accounts = [];
  }
  const account = accounts.find(item => item.active !== false && String(item.name || '').trim() === value);
  if (account?.email) {
    return {
      ok: true,
      email: normalizeEmail(account.email),
      account,
      preloadAccounts: accounts
    };
  }

  return { ok: false, status: 404, error: '등록되지 않은 관리자 아이디입니다. 생성 시 안내된 이메일로도 로그인할 수 있습니다.' };
}

function getAnonAuthClient() {
  if (anonAuthClient) return anonAuthClient;
  const url = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) return null;
  anonAuthClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return anonAuthClient;
}

async function signInAdminInner(loginInput, password) {
  const resolved = await resolveAdminLoginEmail(loginInput);
  if (!resolved.ok) return resolved;

  const authClient = getAnonAuthClient();
  if (!authClient) {
    return { ok: false, status: 503, error: 'SUPABASE_ANON_KEY 가 설정되지 않았습니다.' };
  }

  const { data, error } = await withTimeout(
    authClient.auth.signInWithPassword({
      email: resolved.email,
      password: String(password || '')
    }),
    12000,
    'auth timeout'
  );

  if (error) {
    return { ok: false, status: 401, error: '이름(아이디) 또는 비밀번호가 올바르지 않습니다.' };
  }

  const serviceClient = getServiceClient();
  const userId = data.user?.id;
  const userEmail = normalizeEmail(data.user?.email);
  const { data: profile, error: profileError } = await withTimeout(
    serviceClient
      .from('profiles')
      .select('user_id, role, active, display_name')
      .eq('user_id', userId)
      .maybeSingle(),
    8000,
    'profile timeout'
  ).catch(error => ({ data: null, error }));

  if (profileError || profile?.role !== 'admin' || profile.active !== true) {
    await authClient.auth.signOut();
    return { ok: false, status: 403, error: '접근 권한이 없습니다.' };
  }

  const caller = {
    userId,
    email: userEmail,
    profile
  };

  let accounts = resolved.preloadAccounts || [];
  if (!accounts.length) {
    try {
      accounts = await withTimeout(readRegistryCached(serviceClient), 6000, 'registry timeout');
    } catch {
      accounts = [];
    }
  }
  let registryAccount = accounts.find(item => item.id === userId) || resolved.account || null;

  if (!registryAccount) {
    try {
      accounts = await withTimeout(
        ensureInitialAdminRegistry(serviceClient, caller, accounts),
        6000,
        'registry bootstrap timeout'
      );
    } catch {
      /* use fallback account */
    }
    registryAccount = accounts.find(item => item.id === userId) || null;
  }

  if (!registryAccount) {
    registryAccount = buildFallbackAccountFromProfile(caller);
  }

  if (registryAccount && registryAccount.active === false) {
    await authClient.auth.signOut();
    return { ok: false, status: 403, error: '중지된 관리자 계정입니다.' };
  }

  return {
    ok: true,
    session: data.session,
    user: data.user,
    profile,
    account: {
      ...registryAccount,
      id: userId,
      email: userEmail || registryAccount.email,
      active: registryAccount.active !== false
    }
  };
}

async function signInAdmin(loginInput, password) {
  try {
    return await withTimeout(
      signInAdminInner(loginInput, password),
      20000,
      '로그인 서버 응답 시간 초과'
    );
  } catch (error) {
    return { ok: false, status: 504, error: error.message || '로그인 서버 응답 시간 초과' };
  }
}

module.exports = {
  signInAdmin,
  resolveAdminLoginEmail
};
