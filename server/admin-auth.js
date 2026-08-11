const { createClient } = require('@supabase/supabase-js');
const { getServiceClient } = require('./admin-bootstrap');
const {
  normalizeEmail,
  readRegistryCached,
  buildFallbackAccountFromProfile,
  ensureInitialAdminRegistry,
  ADMIN_ROLES
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

function getLoginHints() {
  try {
    const { getPublicConfig } = require('./public-config');
    return getPublicConfig().adminLoginHints || {};
  } catch {
    return {};
  }
}

function findHintNameByEmail(email) {
  const target = normalizeEmail(email);
  if (!target) return '';
  const hints = getLoginHints();
  const entry = Object.entries(hints).find(([, value]) => normalizeEmail(value) === target);
  return entry ? String(entry[0]).trim() : '';
}

function isTrustedAdminEmail(email) {
  const target = normalizeEmail(email);
  if (!target) return false;
  const initialEmail = normalizeEmail(process.env.BREM_ADMIN_EMAIL);
  if (initialEmail && target === initialEmail) return true;
  const hints = getLoginHints();
  return Object.values(hints).some(value => normalizeEmail(value) === target);
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

  const hinted = getLoginHints()[value];
  if (hinted && String(hinted).includes('@')) {
    return { ok: true, email: normalizeEmail(hinted) };
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
      2500,
      'directory lookup timeout'
    );
    if (directoryRow?.email) {
      return { ok: true, email: normalizeEmail(directoryRow.email) };
    }
  } catch {
    /* directory table may not exist yet */
  }

  let accounts = [];
  try {
    accounts = await withTimeout(readRegistryCached(supabase), 2500, 'registry timeout');
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

async function signInWithPasswordRaw(email, password) {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) {
    return { data: null, error: new Error('SUPABASE_ANON_KEY 가 설정되지 않았습니다.') };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: normalizeEmail(email),
        password: String(password || '')
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        data: null,
        error: new Error(payload.error_description || payload.msg || payload.error || 'auth failed')
      };
    }
    return {
      data: {
        session: {
          access_token: payload.access_token,
          refresh_token: payload.refresh_token,
          expires_in: payload.expires_in,
          expires_at: payload.expires_at,
          token_type: payload.token_type,
          user: payload.user
        },
        user: payload.user
      },
      error: null
    };
  } catch (error) {
    const message = /abort/i.test(String(error?.message || ''))
      ? 'auth timeout'
      : (error.message || 'auth failed');
    return { data: null, error: new Error(message) };
  } finally {
    clearTimeout(timer);
  }
}

function buildTrustedAdminAccount(loginInput, userEmail, userId, registryAccount = null) {
  const hintName = findHintNameByEmail(userEmail);
  const displayName = hintName
    || String(loginInput || '').trim()
    || registryAccount?.name
    || String(process.env.BREM_ADMIN_LOGIN_NAME || '관리자').trim()
    || '관리자';
  const initialEmail = normalizeEmail(process.env.BREM_ADMIN_EMAIL);
  const isInitial = Boolean(initialEmail && userEmail === initialEmail);

  return {
    ...(registryAccount || {}),
    id: userId,
    email: userEmail,
    name: displayName,
    role: registryAccount?.role || (isInitial ? ADMIN_ROLES.CEO : ADMIN_ROLES.CEO),
    menus: registryAccount?.menus ?? null,
    editableMenus: registryAccount?.editableMenus ?? null,
    canOperateCrawl: registryAccount?.canOperateCrawl === true,
    active: registryAccount?.active !== false
  };
}

async function signInAdminInner(loginInput, password) {
  const resolved = await resolveAdminLoginEmail(loginInput);
  if (!resolved.ok) return resolved;

  let data = null;
  let error = null;

  ({ data, error } = await signInWithPasswordRaw(resolved.email, password));

  if (error && /timeout/i.test(String(error.message || ''))) {
    const authClient = getAnonAuthClient();
    if (authClient) {
      try {
        const sdk = await withTimeout(
          authClient.auth.signInWithPassword({
            email: resolved.email,
            password: String(password || '')
          }),
          20000,
          'auth timeout'
        );
        data = sdk.data;
        error = sdk.error;
      } catch (sdkError) {
        error = sdkError;
      }
    }
  }

  if (error || !data?.session || !data?.user) {
    const message = String(error?.message || '');
    if (/timeout/i.test(message)) {
      return { ok: false, status: 504, error: '로그인 응답이 지연되고 있습니다. 잠시 후 다시 시도하세요.' };
    }
    return { ok: false, status: 401, error: '이름(아이디) 또는 비밀번호가 올바르지 않습니다.' };
  }

  const userId = data.user.id;
  const userEmail = normalizeEmail(data.user.email || resolved.email);

  if (!isTrustedAdminEmail(userEmail)) {
    const serviceClient = getServiceClient();
    let profile = null;
    if (serviceClient) {
      try {
        const result = await withTimeout(
          serviceClient
            .from('profiles')
            .select('user_id, role, active, display_name')
            .eq('user_id', userId)
            .maybeSingle(),
          4000,
          'profile timeout'
        );
        profile = result.data;
        if (result.error || profile?.role !== 'admin' || profile.active !== true) {
          return { ok: false, status: 403, error: '접근 권한이 없습니다.' };
        }
      } catch {
        return { ok: false, status: 504, error: '관리자 권한 확인이 지연되고 있습니다. 잠시 후 다시 시도하세요.' };
      }
    } else {
      return { ok: false, status: 403, error: '접근 권한이 없습니다.' };
    }
  }

  const profile = {
    user_id: userId,
    role: 'admin',
    active: true,
    display_name: findHintNameByEmail(userEmail)
      || String(loginInput || '').trim()
      || data.user.user_metadata?.display_name
      || userEmail
  };

  const caller = { userId, email: userEmail, profile };
  let registryAccount = resolved.account || null;

  if (!registryAccount && resolved.preloadAccounts?.length) {
    registryAccount = resolved.preloadAccounts.find(item => item.id === userId) || null;
  }

  if (!registryAccount) {
    registryAccount = buildTrustedAdminAccount(loginInput, userEmail, userId);
  } else {
    registryAccount = buildTrustedAdminAccount(loginInput, userEmail, userId, registryAccount);
  }

  if (registryAccount.active === false) {
    return { ok: false, status: 403, error: '중지된 관리자 계정입니다.' };
  }

  return {
    ok: true,
    session: data.session,
    user: data.user,
    profile,
    account: registryAccount
  };
}

async function signInAdmin(loginInput, password) {
  try {
    return await withTimeout(
      signInAdminInner(loginInput, password),
      28000,
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
