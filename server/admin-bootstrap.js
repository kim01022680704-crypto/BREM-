const { createClient } = require('@supabase/supabase-js');

let client = null;

function getServiceClient() {
  if (client) return client;

  const url = String(process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRoleKey) return null;

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return client;
}

function isEnabled() {
  return Boolean(getServiceClient());
}

/**
 * 최초 관리자: Auth 로그인은 성공했지만 profiles.admin 이 없을 때
 * BREM_ADMIN_EMAIL 과 일치하는 사용자만 admin 프로필을 upsert 합니다.
 */
async function ensureInitialAdminFromToken(accessToken, expectedEmail) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const normalizedExpected = String(expectedEmail || '').trim().toLowerCase();
  if (!normalizedExpected) {
    return { ok: false, status: 503, error: 'BREM_ADMIN_EMAIL 이 설정되지 않았습니다.' };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return { ok: false, status: 401, error: '유효하지 않은 로그인 세션입니다.' };
  }

  const user = userData.user;
  const userEmail = String(user.email || '').trim().toLowerCase();
  if (userEmail !== normalizedExpected) {
    return { ok: false, status: 403, error: '지정된 관리자 이메일이 아닙니다.' };
  }

  const displayName = String(process.env.BREM_ADMIN_LOGIN_NAME || '관리자').trim() || '관리자';
  const { error: upsertError } = await supabase.from('profiles').upsert({
    user_id: user.id,
    role: 'admin',
    display_name: displayName,
    active: true
  }, { onConflict: 'user_id' });

  if (upsertError) {
    return { ok: false, status: 500, error: upsertError.message || 'profiles 연결에 실패했습니다.' };
  }

  return {
    ok: true,
    userId: user.id,
    email: userEmail,
    role: 'admin',
    displayName
  };
}

module.exports = {
  isEnabled,
  getServiceClient,
  ensureInitialAdminFromToken
};
