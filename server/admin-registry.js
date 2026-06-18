const SETTINGS_KEY = 'brem_admin_accounts';

const ADMIN_ROLES = Object.freeze({
  CEO: 'ceo',
  DIRECTOR: 'director',
  MANAGER: 'manager'
});

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function parseRegistryAccounts(value) {
  if (!value) return [];
  if (Array.isArray(value?.accounts)) {
    return value.accounts.map(account => ({ ...account }));
  }
  if (Array.isArray(value)) {
    return value.map(account => ({ ...account }));
  }
  return [];
}

async function readRegistry(supabase) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle();

  if (error) throw new Error(error.message || '관리자 계정 목록을 불러오지 못했습니다.');

  const accounts = parseRegistryAccounts(data?.value);

  // 클라이언트가 배열 형태로 덮어쓴 레지스트리를 서버 형식으로 자동 복구
  if (data?.value && Array.isArray(data.value)) {
    await writeRegistry(supabase, accounts);
  }

  return accounts;
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

async function fetchUserEmail(supabase, userId) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return '';
  return normalizeEmail(data.user.email);
}

async function syncRegistryFromProfiles(supabase, accounts) {
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('user_id, role, active, display_name')
    .eq('role', 'admin')
    .eq('active', true);

  if (error) throw new Error(error.message || '관리자 프로필 목록을 불러오지 못했습니다.');

  const registryById = new Map(accounts.map(account => [account.id, account]));
  const initialEmail = normalizeEmail(process.env.BREM_ADMIN_EMAIL);
  const initialName = String(process.env.BREM_ADMIN_LOGIN_NAME || '관리자').trim() || '관리자';
  const now = new Date().toISOString();
  let changed = false;
  const next = [...accounts];

  for (const profile of profiles || []) {
    const userId = profile.user_id;
    if (!userId || registryById.has(userId)) continue;

    const email = await fetchUserEmail(supabase, userId);
    const isInitial = Boolean(initialEmail && email === initialEmail);
    const displayName = String(profile.display_name || '').trim() || initialName;

    const entry = {
      id: userId,
      email: email || `${userId.slice(0, 8)}@brem.local`,
      name: displayName,
      role: isInitial ? ADMIN_ROLES.CEO : ADMIN_ROLES.MANAGER,
      menus: null,
      editableMenus: null,
      active: true,
      createdAt: now,
      updatedAt: now
    };

    next.push(entry);
    registryById.set(userId, entry);
    changed = true;
  }

  if (changed) {
    await writeRegistry(supabase, next);
  }

  return next;
}

function buildFallbackAccountFromProfile(caller, profileRow = null) {
  const profile = profileRow || caller.profile;
  const initialEmail = normalizeEmail(process.env.BREM_ADMIN_EMAIL);
  const initialName = String(process.env.BREM_ADMIN_LOGIN_NAME || '관리자').trim() || '관리자';
  const isInitial = Boolean(initialEmail && caller.email === initialEmail);

  return {
    id: caller.userId,
    email: caller.email,
    name: profile?.display_name || initialName,
    role: isInitial ? ADMIN_ROLES.CEO : ADMIN_ROLES.MANAGER,
    menus: null,
    editableMenus: null,
    active: true
  };
}

async function loadAdminRegistry(supabase, caller = null) {
  let accounts = await readRegistry(supabase);

  if (caller) {
    accounts = await ensureInitialAdminRegistry(supabase, caller, accounts);
  }

  accounts = await syncRegistryFromProfiles(supabase, accounts);
  return accounts;
}

async function ensureInitialAdminRegistry(supabase, caller, accountsInput = null) {
  const accounts = accountsInput ? [...accountsInput] : await readRegistry(supabase);
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

module.exports = {
  SETTINGS_KEY,
  ADMIN_ROLES,
  normalizeEmail,
  parseRegistryAccounts,
  readRegistry,
  writeRegistry,
  syncRegistryFromProfiles,
  loadAdminRegistry,
  ensureInitialAdminRegistry,
  buildFallbackAccountFromProfile
};
