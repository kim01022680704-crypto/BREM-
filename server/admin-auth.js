const { createClient } = require('@supabase/supabase-js');
const { getServiceClient } = require('./admin-bootstrap');

const SETTINGS_KEY = 'brem_admin_accounts';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function readRegistry(supabase) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle();

  if (error) throw new Error(error.message || '관리자 계정 목록을 불러오지 못했습니다.');

  const accounts = Array.isArray(data?.value?.accounts) ? data.value.accounts : [];
  return accounts.map(account => ({ ...account }));
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

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const accounts = await readRegistry(supabase);
  const account = accounts.find(item => item.active !== false && String(item.name || '').trim() === value);
  if (account?.email) {
    return { ok: true, email: normalizeEmail(account.email), account };
  }

  return { ok: false, status: 404, error: '등록되지 않은 관리자 아이디입니다. 생성 시 안내된 이메일로도 로그인할 수 있습니다.' };
}

function getAnonAuthClient() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function signInAdmin(loginInput, password) {
  const resolved = await resolveAdminLoginEmail(loginInput);
  if (!resolved.ok) return resolved;

  const authClient = getAnonAuthClient();
  if (!authClient) {
    return { ok: false, status: 503, error: 'SUPABASE_ANON_KEY 가 설정되지 않았습니다.' };
  }

  const { data, error } = await authClient.auth.signInWithPassword({
    email: resolved.email,
    password: String(password || '')
  });

  if (error) {
    return { ok: false, status: 401, error: '이름(아이디) 또는 비밀번호가 올바르지 않습니다.' };
  }

  const serviceClient = getServiceClient();
  const userId = data.user?.id;
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('user_id, role, active, display_name')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileError || profile?.role !== 'admin' || profile.active !== true) {
    await authClient.auth.signOut();
    return { ok: false, status: 403, error: '접근 권한이 없습니다.' };
  }

  const registryAccount = resolved.account || null;

  return {
    ok: true,
    session: data.session,
    user: data.user,
    profile,
    account: {
      id: userId,
      email: resolved.email,
      name: registryAccount?.name || profile.display_name || data.user.email || '관리자',
      role: 'ceo',
      active: true
    }
  };
}

module.exports = {
  signInAdmin
};
