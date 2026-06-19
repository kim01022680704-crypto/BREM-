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

  const { data, error } = await supabase
    .from('riders')
    .select('*')
    .order('created_at', { ascending: false });

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

async function ensureRiderAuthAccount(supabase, rider, plainPassword) {
  const email = riderAuthEmail(rider.id);
  const authPassword = toSupabaseAuthPassword(plainPassword);
  let userId = rider.auth_user_id || null;

  if (userId) {
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
      const authClient = getAnonAuthClient();
      const { data: signInData, error: signInError } = authClient
        ? await authClient.auth.signInWithPassword({ email, password: authPassword })
        : { data: null, error: createError };
      if (signInError || !signInData?.user) {
        return { ok: false, status: 400, error: createError.message || '기사 Auth 계정 생성에 실패했습니다.' };
      }
      userId = signInData.user.id;
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
  provisionRiderAuthAccount,
  makeRiderLoginId
};
