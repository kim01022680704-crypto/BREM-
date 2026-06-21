const { createClient } = require('@supabase/supabase-js');
const { getServiceClient } = require('./admin-bootstrap');

function getAnonAuthClient() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function getRiderEmailDomain() {
  const fromEnv = String(process.env.BREM_RIDER_EMAIL_DOMAIN || process.env.BREM_ADMIN_EMAIL_DOMAIN || 'brem.kr').trim();
  return fromEnv.replace(/^@+/, '').toLowerCase() || 'brem.kr';
}

function normalizeLoginText(value) {
  return String(value || '').replace(/[\s-]/g, '');
}

function normalizeDigits(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function makeRiderLoginId(rider) {
  const name = String(rider?.name || '').replace(/\s/g, '');
  const phone = normalizeDigits(rider?.phone);
  return `${name}${phone.slice(-4)}`;
}

function riderAuthEmail(riderId) {
  const safeId = String(riderId || '').replace(/[^a-zA-Z0-9-]/g, '');
  return `rider+${safeId}@${getRiderEmailDomain()}`;
}

function toSupabaseAuthPassword(plainPassword) {
  const plain = String(plainPassword || '').trim() || '1234';
  if (plain.length >= 8) return plain;
  return `Brem${plain}R!`;
}

function readRiderSecrets(rider) {
  const raw = rider?.raw_data && typeof rider.raw_data === 'object' ? rider.raw_data : {};
  return {
    password: String(raw.password ?? '').trim() || '1234',
    residentNumber: normalizeDigits(rider?.resident_number || raw.residentNumber || '')
  };
}

function verifyRiderSecret(rider, inputPassword) {
  const inputRaw = String(inputPassword || '').trim();
  const inputDigits = normalizeDigits(inputPassword);
  if (!inputRaw && !inputDigits) {
    return { ok: false, error: '비밀번호를 입력하세요.' };
  }

  const { password: savedPassword, residentNumber } = readRiderSecrets(rider);
  if (savedPassword && savedPassword === inputRaw) {
    return { ok: true, plainPassword: savedPassword };
  }

  if (residentNumber.length === 13) {
    if (inputDigits.length === 7 && residentNumber.slice(-7) === inputDigits) {
      return { ok: true, plainPassword: savedPassword };
    }
    if (inputDigits.length === 13 && residentNumber === inputDigits) {
      return { ok: true, plainPassword: savedPassword };
    }
    if (inputDigits && residentNumber === inputDigits) {
      return { ok: true, plainPassword: savedPassword };
    }
  }

  return { ok: false, error: '비밀번호가 일치하지 않습니다.' };
}

async function findRiderByLoginId(supabase, loginInput) {
  const normalized = normalizeLoginText(loginInput);
  if (!normalized) {
    return { ok: false, status: 400, error: '아이디를 입력하세요.' };
  }

  const phoneSuffix = normalized.slice(-4);
  let query = supabase.from('riders').select('*');

  if (/^\d{4}$/.test(phoneSuffix)) {
    query = query.ilike('phone', `%${phoneSuffix}`);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    return { ok: false, status: 500, error: error.message || '기사 정보를 불러오지 못했습니다.' };
  }

  const rider = (data || []).find(row => makeRiderLoginId(row) === normalized);
  if (!rider) {
    return {
      ok: false,
      status: 404,
      error: '아이디가 일치하는 기사가 없습니다. 기사등록 프로그램의 로그인 아이디를 확인하세요.'
    };
  }

  return { ok: true, rider };
}

async function getRiderMe(accessToken) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const token = String(accessToken || '').trim();
  if (!token) {
    return { ok: false, status: 401, error: '로그인이 필요합니다.' };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return { ok: false, status: 401, error: '로그인 세션이 만료되었습니다.' };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('user_id, role, rider_id, active, display_name')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (profileError || !profile?.active || profile.role !== 'rider' || !profile.rider_id) {
    return { ok: false, status: 403, error: '기사 세션이 아닙니다.' };
  }

  const { data: rider, error: riderError } = await supabase
    .from('riders')
    .select('*')
    .eq('id', profile.rider_id)
    .maybeSingle();

  if (riderError || !rider) {
    return { ok: false, status: 404, error: '기사 정보를 찾을 수 없습니다.' };
  }

  return {
    ok: true,
    riderId: rider.id,
    rider,
    profile: {
      user_id: profile.user_id,
      role: profile.role,
      rider_id: profile.rider_id,
      display_name: profile.display_name || rider.name || '',
      active: true
    }
  };
}

async function findAuthUserIdByEmail(supabase, email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = (data?.users || []).find(user => String(user.email || '').trim().toLowerCase() === target);
    if (match?.id) return match.id;
    if ((data?.users || []).length < 200) break;
  }
  return null;
}

function isDuplicateAuthUserError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('already been registered')
    || message.includes('already registered')
    || message.includes('duplicate');
}

async function updateLinkedRiderAuthUser(supabase, userId, rider, email, authPassword) {
  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    email,
    password: authPassword,
    email_confirm: true,
    user_metadata: {
      role: 'rider',
      rider_id: rider.id,
      display_name: rider.name || ''
    }
  });
  if (updateError) {
    return { ok: false, status: 400, error: updateError.message || '기사 Auth 비밀번호 갱신에 실패했습니다.' };
  }
  return { ok: true, userId };
}

async function ensureRiderAuthAccount(supabase, rider, plainPassword) {
  const email = riderAuthEmail(rider.id);
  const authPassword = toSupabaseAuthPassword(plainPassword);
  let userId = rider.auth_user_id || null;

  if (userId) {
    const linked = await updateLinkedRiderAuthUser(supabase, userId, rider, email, authPassword);
    if (linked.ok) {
      userId = linked.userId;
    } else {
      userId = null;
    }
  }

  if (!userId) {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: authPassword,
      email_confirm: true,
      user_metadata: {
        role: 'rider',
        rider_id: rider.id,
        display_name: rider.name || ''
      }
    });

    if (createError) {
      if (isDuplicateAuthUserError(createError)) {
        try {
          userId = await findAuthUserIdByEmail(supabase, email);
        } catch (lookupError) {
          return { ok: false, status: 500, error: lookupError.message || '기사 Auth 계정 조회에 실패했습니다.' };
        }
        if (!userId) {
          return { ok: false, status: 400, error: '이미 등록된 Auth 계정을 찾지 못했습니다. 관리자에게 문의하세요.' };
        }
        const linked = await updateLinkedRiderAuthUser(supabase, userId, rider, email, authPassword);
        if (!linked.ok) return linked;
      } else {
        return { ok: false, status: 400, error: createError.message || '기사 Auth 계정 생성에 실패했습니다.' };
      }
    } else {
      userId = created.user.id;
    }

    const { error: linkError } = await supabase
      .from('riders')
      .update({ auth_user_id: userId })
      .eq('id', rider.id);
    if (linkError) {
      return { ok: false, status: 500, error: linkError.message || '기사 Auth 연결에 실패했습니다.' };
    }
  }

  const { error: profileError } = await supabase.from('profiles').upsert({
    user_id: userId,
    role: 'rider',
    rider_id: rider.id,
    display_name: rider.name || '',
    active: true
  }, { onConflict: 'user_id' });

  if (profileError) {
    return { ok: false, status: 500, error: profileError.message || '기사 프로필 연결에 실패했습니다.' };
  }

  return { ok: true, userId, email, authPassword };
}

async function provisionRiderAuthAccount(riderRow) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const { password } = readRiderSecrets(riderRow);
  return ensureRiderAuthAccount(supabase, riderRow, password);
}

async function updateRiderProfile(accessToken, body = {}) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const rider = me.rider;
  const raw = rider.raw_data && typeof rider.raw_data === 'object' ? { ...rider.raw_data } : {};
  const {
    bankName,
    accountHolder,
    accountNumber,
    residentNumber,
    currentPassword,
    newPassword
  } = body || {};

  const nextPassword = String(newPassword || '').trim();
  const wantsPasswordChange = Boolean(nextPassword);
  if (wantsPasswordChange) {
    const verified = verifyRiderSecret(rider, currentPassword);
    if (!verified.ok) {
      return { ok: false, status: 400, error: '현재 비밀번호가 일치하지 않습니다.' };
    }
    if (nextPassword.length < 4) {
      return { ok: false, status: 400, error: '새 비밀번호는 4자 이상 입력하세요.' };
    }
    raw.password = nextPassword;
  }

  const updatePayload = {
    updated_at: new Date().toISOString(),
    raw_data: raw
  };

  if (bankName !== undefined) {
    updatePayload.bank_name = String(bankName || '').trim();
    raw.bankName = updatePayload.bank_name;
  }
  if (accountHolder !== undefined) {
    updatePayload.account_holder = String(accountHolder || '').trim();
    raw.accountHolder = updatePayload.account_holder;
  }
  if (accountNumber !== undefined) {
    updatePayload.account_number = String(accountNumber || '').trim();
    raw.accountNumber = updatePayload.account_number;
  }
  if (residentNumber !== undefined) {
    const digits = normalizeDigits(residentNumber);
    updatePayload.resident_number = digits;
    raw.residentNumber = digits;
  }

  updatePayload.raw_data = raw;

  const { data: updated, error } = await supabase
    .from('riders')
    .update(updatePayload)
    .eq('id', rider.id)
    .select('*')
    .single();

  if (error || !updated) {
    return { ok: false, status: 500, error: error?.message || '기사 정보를 저장하지 못했습니다.' };
  }

  const plainPassword = readRiderSecrets(updated).password;
  const authResult = await ensureRiderAuthAccount(supabase, updated, plainPassword);
  if (!authResult.ok) return authResult;

  return {
    ok: true,
    riderId: updated.id,
    rider: updated,
    profile: me.profile
  };
}

async function signInRider(loginInput, password) {
  const supabase = getServiceClient();
  const authClient = getAnonAuthClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  if (!authClient) {
    return { ok: false, status: 503, error: 'SUPABASE_ANON_KEY 가 설정되지 않았습니다.' };
  }

  const found = await findRiderByLoginId(supabase, loginInput);
  if (!found.ok) return found;

  const verified = verifyRiderSecret(found.rider, password);
  if (!verified.ok) {
    return { ok: false, status: 401, error: verified.error };
  }

  const account = await ensureRiderAuthAccount(supabase, found.rider, verified.plainPassword);
  if (!account.ok) return account;

  const { data, error } = await authClient.auth.signInWithPassword({
    email: account.email,
    password: account.authPassword
  });

  if (error || !data.session) {
    return { ok: false, status: 401, error: '로그인에 실패했습니다. 잠시 후 다시 시도하세요.' };
  }

  return {
    ok: true,
    session: data.session,
    user: data.user,
    riderId: found.rider.id,
    rider: found.rider,
    profile: {
      user_id: account.userId,
      role: 'rider',
      rider_id: found.rider.id,
      display_name: found.rider.name || '',
      active: true
    }
  };
}

module.exports = {
  signInRider,
  getRiderMe,
  updateRiderProfile,
  provisionRiderAuthAccount,
  makeRiderLoginId
};
