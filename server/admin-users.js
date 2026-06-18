const { getServiceClient } = require('./admin-bootstrap');

const SETTINGS_KEY = 'brem_admin_accounts';
const ADMIN_ROLES = Object.freeze({
  CEO: 'ceo',
  DIRECTOR: 'director',
  MANAGER: 'manager'
});

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function slugifyName(name) {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  return base || '';
}

function getAdminEmailDomain() {
  const fromEnv = String(process.env.BREM_ADMIN_EMAIL_DOMAIN || '').trim().toLowerCase();
  if (fromEnv) return fromEnv.replace(/^@+/, '');

  const adminEmail = normalizeEmail(process.env.BREM_ADMIN_EMAIL);
  const at = adminEmail.lastIndexOf('@');
  if (at > 0) return adminEmail.slice(at + 1);

  return 'brem.kr';
}

function generateAdminEmail(name) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const slug = slugifyName(name);
  const localPart = (slug ? `${slug}.${suffix}` : `admin.${suffix}`)
    .replace(/[^a-z0-9._+-]/g, '')
    .slice(0, 64);
  return `${localPart}@${getAdminEmailDomain()}`;
}

async function verifyAdminCaller(accessToken) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const token = String(accessToken || '').trim();
  if (!token) {
    return { ok: false, status: 401, error: 'Authorization Bearer 토큰이 필요합니다.' };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return { ok: false, status: 401, error: '유효하지 않은 로그인 세션입니다.' };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('user_id, role, active, display_name')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (profileError || profile?.role !== 'admin' || profile.active !== true) {
    return { ok: false, status: 403, error: '관리자 권한이 필요합니다.' };
  }

  return {
    ok: true,
    userId: userData.user.id,
    email: normalizeEmail(userData.user.email),
    profile
  };
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

async function writeRegistry(supabase, accounts) {
  const payload = {
    key: SETTINGS_KEY,
    value: { accounts },
    description: 'BREM admin account registry',
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from('settings').upsert(payload, { onConflict: 'key' });
  if (error) throw new Error(error.message || '관리자 계정 목록을 저장하지 못했습니다.');
}

async function ensureInitialAdminRegistry(supabase, caller) {
  const accounts = await readRegistry(supabase);
  if (accounts.some(account => account.id === caller.userId)) {
    return accounts;
  }

  const initialEmail = normalizeEmail(process.env.BREM_ADMIN_EMAIL);
  const initialName = String(process.env.BREM_ADMIN_LOGIN_NAME || '관리자').trim() || '관리자';
  const now = new Date().toISOString();

  if (initialEmail && caller.email === initialEmail) {
    const seeded = {
      id: caller.userId,
      email: caller.email,
      name: caller.profile.display_name || initialName,
      role: ADMIN_ROLES.CEO,
      menus: null,
      editableMenus: null,
      active: true,
      createdAt: now,
      updatedAt: now
    };
    const next = [seeded, ...accounts.filter(account => account.id !== caller.userId)];
    await writeRegistry(supabase, next);
    return next;
  }

  return accounts;
}

function getCallerRegistryAccount(accounts, userId) {
  return accounts.find(account => account.id === userId) || null;
}

function assertCeo(actorAccount) {
  if (actorAccount?.role !== ADMIN_ROLES.CEO) {
    return { ok: false, status: 403, error: '대표만 이 작업을 수행할 수 있습니다.' };
  }
  return { ok: true };
}

async function listAdminUsers(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  const accounts = await ensureInitialAdminRegistry(supabase, caller);
  return { ok: true, accounts };
}

async function createAdminUser(accessToken, body = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  const accounts = await ensureInitialAdminRegistry(supabase, caller);
  const actorAccount = getCallerRegistryAccount(accounts, caller.userId);
  const ceoCheck = assertCeo(actorAccount);
  if (!ceoCheck.ok) return ceoCheck;

  const name = String(body.name || '').trim();
  const password = String(body.password || '');
  const role = [ADMIN_ROLES.CEO, ADMIN_ROLES.DIRECTOR, ADMIN_ROLES.MANAGER].includes(body.role)
    ? body.role
    : ADMIN_ROLES.MANAGER;
  const active = body.active !== false;
  const menus = Array.isArray(body.menus) ? body.menus.map(String) : [];
  const editableMenus = Array.isArray(body.editableMenus) ? body.editableMenus.map(String) : menus;
  let email = normalizeEmail(body.email);

  if (!name) {
    return { ok: false, status: 400, error: '관리자 이름을 입력하세요.' };
  }
  if (password.length < 6) {
    return { ok: false, status: 400, error: '비밀번호는 6자 이상 입력하세요.' };
  }
  if (!menus.length) {
    return { ok: false, status: 400, error: '접근 가능한 메뉴를 1개 이상 선택하세요.' };
  }
  if (accounts.some(account => account.name === name)) {
    return { ok: false, status: 400, error: '이미 사용 중인 관리자 이름입니다.' };
  }

  if (!email) {
    email = generateAdminEmail(name);
  }
  if (accounts.some(account => normalizeEmail(account.email) === email)) {
    return { ok: false, status: 400, error: '이미 사용 중인 이메일입니다.' };
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: 'admin', display_name: name }
  });

  if (createError) {
    return { ok: false, status: 400, error: createError.message || 'Auth 계정 생성에 실패했습니다.' };
  }

  const userId = created.user.id;
  const { error: profileError } = await supabase.from('profiles').upsert({
    user_id: userId,
    role: 'admin',
    display_name: name,
    active
  }, { onConflict: 'user_id' });

  if (profileError) {
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    return { ok: false, status: 500, error: profileError.message || 'profiles 연결에 실패했습니다.' };
  }

  const now = new Date().toISOString();
  const account = {
    id: userId,
    email,
    name,
    role,
    menus,
    editableMenus,
    active,
    createdAt: now,
    updatedAt: now
  };

  await writeRegistry(supabase, [...accounts, account]);

  return {
    ok: true,
    account,
    message: `관리자 계정이 생성되었습니다. 로그인 이메일: ${email}`
  };
}

async function updateAdminUser(accessToken, userId, body = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  const accounts = await ensureInitialAdminRegistry(supabase, caller);
  const actorAccount = getCallerRegistryAccount(accounts, caller.userId);
  const index = accounts.findIndex(account => account.id === userId);

  if (index < 0) {
    return { ok: false, status: 404, error: '관리자 계정을 찾을 수 없습니다.' };
  }

  const current = accounts[index];

  if (actorAccount?.role === ADMIN_ROLES.MANAGER) {
    return { ok: false, status: 403, error: '팀장은 관리자 계정을 수정할 수 없습니다.' };
  }

  if (actorAccount?.role === ADMIN_ROLES.DIRECTOR) {
    if (current.role !== ADMIN_ROLES.MANAGER) {
      return { ok: false, status: 403, error: '총괄은 팀장 계정의 메뉴만 수정할 수 있습니다.' };
    }
    if (!Array.isArray(body.menus)) {
      return { ok: false, status: 400, error: '수정할 메뉴를 선택하세요.' };
    }

    const menus = body.menus.map(String);
    const editableMenus = Array.isArray(body.editableMenus)
      ? body.editableMenus.map(String)
      : menus;
    const updated = {
      ...current,
      menus,
      editableMenus,
      updatedAt: new Date().toISOString()
    };
    accounts[index] = updated;
    await writeRegistry(supabase, accounts);
    return { ok: true, account: updated, message: '접근 메뉴가 수정되었습니다.' };
  }

  const ceoCheck = assertCeo(actorAccount);
  if (!ceoCheck.ok) return ceoCheck;

  const name = String(body.name ?? current.name).trim();
  const role = [ADMIN_ROLES.CEO, ADMIN_ROLES.DIRECTOR, ADMIN_ROLES.MANAGER].includes(body.role)
    ? body.role
    : current.role;
  const active = body.active == null ? current.active : !!body.active;
  const menus = Array.isArray(body.menus) ? body.menus.map(String) : current.menus;
  const editableMenus = Array.isArray(body.editableMenus)
    ? body.editableMenus.map(String)
    : current.editableMenus;
  const password = body.password == null ? '' : String(body.password);

  if (!name) {
    return { ok: false, status: 400, error: '관리자 이름을 입력하세요.' };
  }
  if (password && password.length < 6) {
    return { ok: false, status: 400, error: '비밀번호는 6자 이상 입력하세요.' };
  }
  if (accounts.some(account => account.id !== userId && account.name === name)) {
    return { ok: false, status: 400, error: '이미 사용 중인 관리자 이름입니다.' };
  }
  if (!menus.length) {
    return { ok: false, status: 400, error: '접근 가능한 메뉴를 1개 이상 선택하세요.' };
  }

  if (current.role === ADMIN_ROLES.CEO && role !== ADMIN_ROLES.CEO) {
    const ceoCount = accounts.filter(account => account.role === ADMIN_ROLES.CEO).length;
    if (ceoCount <= 1) {
      return { ok: false, status: 400, error: '대표 계정은 최소 1명 필요합니다.' };
    }
  }

  if (!active) {
    const activeCount = accounts.filter(account => account.active && account.id !== userId).length;
    if (!activeCount) {
      return { ok: false, status: 400, error: '활성 관리자 계정은 최소 1개 필요합니다.' };
    }
  }

  const profilePatch = {
    user_id: userId,
    role: 'admin',
    display_name: name,
    active
  };
  const { error: profileError } = await supabase.from('profiles').upsert(profilePatch, { onConflict: 'user_id' });
  if (profileError) {
    return { ok: false, status: 500, error: profileError.message || 'profiles 수정에 실패했습니다.' };
  }

  if (password) {
    const { error: passwordError } = await supabase.auth.admin.updateUserById(userId, { password });
    if (passwordError) {
      return { ok: false, status: 400, error: passwordError.message || '비밀번호 변경에 실패했습니다.' };
    }
  }

  const updated = {
    ...current,
    name,
    role,
    menus,
    editableMenus,
    active,
    updatedAt: new Date().toISOString()
  };
  accounts[index] = updated;
  await writeRegistry(supabase, accounts);

  return { ok: true, account: updated, message: '관리자 계정이 수정되었습니다.' };
}

async function deleteAdminUser(accessToken, userId) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  const accounts = await ensureInitialAdminRegistry(supabase, caller);
  const actorAccount = getCallerRegistryAccount(accounts, caller.userId);
  const ceoCheck = assertCeo(actorAccount);
  if (!ceoCheck.ok) return ceoCheck;

  if (accounts.length <= 1) {
    return { ok: false, status: 400, error: '마지막 관리자 계정은 삭제할 수 없습니다.' };
  }

  const target = accounts.find(account => account.id === userId);
  if (!target) {
    return { ok: false, status: 404, error: '관리자 계정을 찾을 수 없습니다.' };
  }

  if (target.role === ADMIN_ROLES.CEO) {
    const ceoCount = accounts.filter(account => account.role === ADMIN_ROLES.CEO).length;
    if (ceoCount <= 1) {
      return { ok: false, status: 400, error: '마지막 대표 계정은 삭제할 수 없습니다.' };
    }
  }

  if (userId === caller.userId) {
    return { ok: false, status: 400, error: '현재 로그인한 계정은 삭제할 수 없습니다.' };
  }

  const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(userId);
  if (deleteAuthError) {
    return { ok: false, status: 400, error: deleteAuthError.message || 'Auth 계정 삭제에 실패했습니다.' };
  }

  await writeRegistry(supabase, accounts.filter(account => account.id !== userId));
  return { ok: true, message: '관리자 계정이 삭제되었습니다.' };
}

module.exports = {
  listAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser
};
