const { createClient } = require('@supabase/supabase-js');
const { getServiceClient } = require('./admin-bootstrap');
const {
  RIDER_LOGIN_LOOKUP_SELECT,
  RIDER_ME_SELECT_VARIANTS,
  isMissingColumnError,
  queryRidersWithSelectFallback
} = require('./rider-select-columns');

const MISSION_SELECT = [
  'id', 'title', 'description', 'type', 'conditions', 'is_active',
  'raw_data', 'created_at', 'updated_at'
].join(',');

const NOTICE_SELECT = 'id,title,content,pinned,created_at,updated_at';

const PROMOTION_MISSION_SELECT = 'id,name,platform,type,enabled,payload,created_at,updated_at';

function promotionRowToMissionShape(row) {
  if (!row) return null;
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    id: row.id,
    title: row.name || '',
    description: payload.description || '',
    type: row.type || '',
    conditions: payload.conditions || '',
    is_active: row.enabled !== false,
    raw_data: payload,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function fetchAssignedMissionRows(supabase, missionIds = []) {
  const ids = [...new Set((missionIds || []).filter(Boolean))];
  if (!ids.length) {
    return { rows: [], error: null };
  }

  const [missionsResult, promotionsResult] = await Promise.all([
    supabase.from('missions').select(MISSION_SELECT).in('id', ids),
    supabase.from('promotions').select(PROMOTION_MISSION_SELECT).in('id', ids)
  ]);

  if (missionsResult.error && !isMissingColumnError(missionsResult.error)) {
    return { rows: [], error: missionsResult.error };
  }
  if (promotionsResult.error && !isMissingColumnError(promotionsResult.error)) {
    return { rows: [], error: promotionsResult.error };
  }

  const map = new Map();
  (missionsResult.data || []).forEach(row => map.set(row.id, row));
  (promotionsResult.data || []).forEach(row => {
    if (!map.has(row.id)) map.set(row.id, promotionRowToMissionShape(row));
  });

  return { rows: ids.map(id => map.get(id)).filter(Boolean), error: null };
}

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

async function fetchRiderById(supabase, riderId) {
  const result = await queryRidersWithSelectFallback(
    RIDER_ME_SELECT_VARIANTS,
    selectColumns => supabase
      .from('riders')
      .select(selectColumns)
      .eq('id', riderId)
      .maybeSingle()
  );
  if (!result?.error && result?.data) {
    return { ok: true, rider: result.data };
  }
  return {
    ok: false,
    status: 500,
    error: result?.error?.message || '기사 정보를 불러오지 못했습니다.'
  };
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
  if (!/^\d{4}$/.test(phoneSuffix)) {
    return { ok: false, status: 400, error: '아이디 형식이 올바르지 않습니다.' };
  }

  const namePart = normalized.slice(0, -4).replace(/\s/g, '');
  let query = supabase
    .from('riders')
    .select(RIDER_LOGIN_LOOKUP_SELECT)
    .ilike('phone', `%${phoneSuffix}`)
    .limit(25);

  if (namePart) {
    query = query.ilike('name', `${namePart}%`);
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

  const fetched = await fetchRiderById(supabase, profile.rider_id);
  if (!fetched.ok || !fetched.rider) {
    return { ok: false, status: fetched.status || 404, error: fetched.error || '기사 정보를 찾을 수 없습니다.' };
  }
  const rider = fetched.rider;

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

  const { error: updateError } = await supabase
    .from('riders')
    .update(updatePayload)
    .eq('id', rider.id);

  if (updateError) {
    return { ok: false, status: 500, error: updateError.message || '기사 정보를 저장하지 못했습니다.' };
  }

  const fetched = await fetchRiderById(supabase, rider.id);
  if (!fetched.ok || !fetched.rider) {
    return {
      ok: false,
      status: fetched.status || 500,
      error: fetched.error || '기사 정보를 저장하지 못했습니다.'
    };
  }
  const updated = fetched.rider;

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

async function getRiderAssignedMissions(accessToken) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const row = me.rider || {};
  const baeminId = String(row.selected_mission_id_baemin || row.selected_mission_id || '').trim();
  const coupangId = String(row.selected_mission_id_coupang || row.selected_mission_id || '').trim();
  const ids = [...new Set([baeminId, coupangId].filter(Boolean))];

  if (!ids.length) {
    return {
      ok: true,
      riderId: me.riderId,
      missions: { baemin: null, coupang: null }
    };
  }

  const { data, error } = await supabase
    .from('missions')
    .select(MISSION_SELECT)

  if (error) {
    return { ok: false, status: 500, error: error.message || '미션 정보를 불러오지 못했습니다.' };
  }

  const byId = new Map((data || []).map(item => [item.id, item]));
  return {
    ok: true,
    riderId: me.riderId,
    missions: {
      baemin: baeminId ? (byId.get(baeminId) || null) : null,
      coupang: coupangId ? (byId.get(coupangId) || null) : null
    }
  };
}

const RIDER_DASHBOARD_SETTING_KEYS = [
  'brem_driver_weekly_targets',
  'brem_rider_published_long_event_catalog',
  'brem_rider_published_long_event_items',
  'brem_rider_published_long_event_config',
  'brem_rider_view_publish'
];

const RIDER_SNAPSHOT_SETTING_KEYS = [
  'brem_rider_view_publish',
  'brem_rider_published_long_event_catalog',
  'brem_rider_published_long_event_items',
  'brem_rider_published_long_event_config'
];

const RIDER_LIVE_SETTING_KEYS = [
  'brem_driver_weekly_targets',
  'brem_rider_published_long_event_catalog',
  'brem_rider_published_long_event_items',
  'brem_rider_published_long_event_config'
];

function maxPublishedTimestamp(values = []) {
  const stamps = values.filter(Boolean).map(value => String(value));
  if (!stamps.length) return null;
  return stamps.sort().reverse()[0];
}

function resolveSnapshotPublishedAt(settingsRows = [], callRows = [], rejectionRows = []) {
  const publishMeta = settingsRows.find(row => row.key === 'brem_rider_view_publish')?.value;
  const metaAt = publishMeta?.publishedAt || null;
  const rowAt = maxPublishedTimestamp([
    ...callRows.map(row => row.rider_published_at || row.updated_at),
    ...rejectionRows.map(row => row.rider_published_at || row.updated_at)
  ]);
  return metaAt || rowAt || null;
}

function normalizeCallPlatform(value) {
  return String(value || '').trim().toLowerCase() === 'baemin' ? 'baemin' : 'coupang';
}

function computeLongEventProgress(riderRow, settingsRows = [], callRows = []) {
  const rider = riderRow || {};
  const riderId = String(rider.id || '');
  const settings = Array.isArray(settingsRows) ? settingsRows : [];
  const calls = Array.isArray(callRows) ? callRows : [];

  const catalogRaw = settings.find(row => row.key === 'brem_rider_published_long_event_catalog')?.value
    ?? settings.find(row => row.key === 'brem_admin_long_event_catalog')?.value;
  const itemsMapRaw = settings.find(row => row.key === 'brem_rider_published_long_event_items')?.value
    ?? settings.find(row => row.key === 'brem_admin_long_event_items')?.value;
  const catalog = Array.isArray(catalogRaw) ? catalogRaw : [];
  const itemsMap = itemsMapRaw && typeof itemsMapRaw === 'object' && !Array.isArray(itemsMapRaw)
    ? itemsMapRaw
    : {};

  const raw = rider.raw_data && typeof rider.raw_data === 'object' ? rider.raw_data : {};
  const columnItemId = String(rider.long_event_item_id || '').trim();
  const columnItemName = String(rider.long_event_item || '').trim();
  const platform = normalizeCallPlatform(
    rider.long_event_platform || raw.longEventPlatform || 'coupang'
  );

  const unsetProgress = {
    itemId: '',
    itemName: '',
    platform,
    startDate: '',
    total: 0,
    target: 0,
    rate: 0,
    status: 'unset'
  };

  if (!columnItemId && !columnItemName) {
    return unsetProgress;
  }

  const mappedItemId = itemsMap[riderId] ? String(itemsMap[riderId]).trim() : '';
  const rawItemId = String(raw.longEventItemId || '').trim();
  const itemId = columnItemId || mappedItemId || rawItemId;
  if (!itemId) {
    return unsetProgress;
  }

  const item = catalog.find(entry => entry.id === itemId) || null;
  const startDate = String(rider.long_event_start_date || raw.longEventStartDate || '').slice(0, 10);
  const target = item ? Math.max(0, Number(item.targetCount) || 0) : 0;

  if (!item || !startDate) {
    return {
      itemId: item?.id || itemId,
      itemName: item?.name || '',
      platform,
      startDate,
      total: 0,
      target,
      rate: 0,
      status: !item ? 'unset' : 'no-start'
    };
  }

  const total = calls.reduce((sum, call) => {
    const date = String(call.date || '').slice(0, 10);
    if (!date || date < startDate) return sum;
    if (normalizeCallPlatform(call.platform) !== platform) return sum;
    return sum + Math.max(0, Number(call.count) || 0);
  }, 0);
  const rate = target ? Math.round((total / target) * 100) : 0;

  return {
    itemId: item.id,
    itemName: item.name,
    platform,
    startDate,
    total,
    target,
    rate,
    status: rate >= 100 ? 'achieved' : 'in-progress'
  };
}

async function getRiderPublishStatus(accessToken) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const { data, error } = await supabase
    .from('settings')
    .select('value, updated_at')
    .eq('key', 'brem_rider_view_publish')
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: error.message || '반영 시각을 불러오지 못했습니다.' };
  }

  const meta = data?.value && typeof data.value === 'object' ? data.value : {};
  return {
    ok: true,
    riderId: me.riderId,
    publishedAt: meta.publishedAt || null,
    updatedAt: data?.updated_at || null
  };
}

async function getRiderNotices(accessToken) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const { data, error } = await supabase
    .from('notices')
    .select(NOTICE_SELECT)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return { ok: false, status: 500, error: error.message || '공지사항을 불러오지 못했습니다.' };
  }

  return {
    ok: true,
    riderId: me.riderId,
    notices: data || []
  };
}

async function getRiderAppBundle(accessToken) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const riderId = me.riderId;
  const row = me.rider || {};
  const baeminMissionId = String(
    row.selected_mission_id_baemin
    || row.promotion_rule_id_baemin
    || row.selected_mission_id
    || ''
  ).trim();
  const coupangMissionId = String(
    row.selected_mission_id_coupang
    || row.promotion_rule_id_coupang
    || row.selected_mission_id
    || ''
  ).trim();
  const missionIds = [...new Set([baeminMissionId, coupangMissionId].filter(Boolean))];
  const allSettingKeys = [...new Set([
    ...RIDER_SNAPSHOT_SETTING_KEYS,
    ...RIDER_LIVE_SETTING_KEYS
  ])];

  const missionQuery = fetchAssignedMissionRows(supabase, missionIds);

  const [
    callsResult,
    rejectionsResult,
    targetsResult,
    settingsResult,
    noticesResult,
    missionsResult
  ] = await Promise.all([
    supabase
      .from('admin_calls')
      .select('id,driver_id,date,platform,count,updated_at,rider_published_at')
      .eq('driver_id', riderId)
      .order('date', { ascending: false }),
    supabase
      .from('admin_rejection_rates')
      .select('id,driver_id,week_start,platform,rate,stats,source,updated_at,rider_published_at')
      .eq('driver_id', riderId)
      .not('rider_published_at', 'is', null)
      .order('week_start', { ascending: false }),
    supabase
      .from('admin_targets')
      .select('id,driver_id,month,count,updated_at')
      .eq('driver_id', riderId)
      .order('month', { ascending: false }),
    supabase
      .from('settings')
      .select('key,value')
      .in('key', allSettingKeys),
    supabase
      .from('notices')
      .select(NOTICE_SELECT)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100),
    missionQuery
  ]);

  if (missionsResult.error) {
    return { ok: false, status: 500, error: missionsResult.error.message || '미션 정보를 불러오지 못했습니다.' };
  }

  const firstError = [
    callsResult,
    rejectionsResult,
    targetsResult,
    settingsResult,
    noticesResult
  ].find(result => result.error);

  if (firstError?.error) {
    const message = firstError.error.message || '';
    if (/does not exist|relation|schema cache/i.test(message)) {
      return {
        ok: false,
        status: 400,
        error: '운영 DB 테이블이 준비되지 않았습니다. supabase/operations_tables_migration.sql 을 실행하세요.'
      };
    }
    return { ok: false, status: 500, error: message || '기사 앱 데이터를 불러오지 못했습니다.' };
  }

  const allCalls = callsResult.data || [];
  const publishedCalls = allCalls.filter(item => item.rider_published_at != null);
  const rejections = rejectionsResult.data || [];
  const settingsRows = settingsResult.data || [];
  const snapshotSettings = settingsRows.filter(item => RIDER_SNAPSHOT_SETTING_KEYS.includes(item.key));
  const liveSettings = settingsRows.filter(item => (
    item.key !== 'brem_driver_weekly_targets' && RIDER_LIVE_SETTING_KEYS.includes(item.key)
  ));
  const missionRows = missionsResult.rows || [];
  const byId = new Map(missionRows.map(item => [item.id, item]));
  const weeklyTargetsRaw = settingsRows.find(item => item.key === 'brem_driver_weekly_targets')?.value;
  const weeklyTargets = Array.isArray(weeklyTargetsRaw)
    ? weeklyTargetsRaw.filter(item => String(item?.driverId || '') === String(riderId))
    : [];
  const longEvent = computeLongEventProgress(me.rider, settingsRows, allCalls);
  const publishedAt = resolveSnapshotPublishedAt(snapshotSettings, publishedCalls, rejections);

  return {
    ok: true,
    riderId,
    publishedAt,
    snapshot: {
      riderId,
      publishedAt,
      calls: publishedCalls,
      rejections,
      settings: snapshotSettings,
      missions: {
        baemin: baeminMissionId ? (byId.get(baeminMissionId) || null) : null,
        coupang: coupangMissionId ? (byId.get(coupangMissionId) || null) : null
      }
    },
    live: {
      riderId,
      rider: me.rider,
      targets: targetsResult.data || [],
      weeklyTargets,
      longEvent,
      settings: liveSettings
    },
    notices: noticesResult.data || []
  };
}

async function getRiderSnapshot(accessToken) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const riderId = me.riderId;
  const row = me.rider || {};
  const baeminMissionId = String(
    row.selected_mission_id_baemin
    || row.promotion_rule_id_baemin
    || row.selected_mission_id
    || ''
  ).trim();
  const coupangMissionId = String(
    row.selected_mission_id_coupang
    || row.promotion_rule_id_coupang
    || row.selected_mission_id
    || ''
  ).trim();
  const missionIds = [...new Set([baeminMissionId, coupangMissionId].filter(Boolean))];

  const missionQuery = fetchAssignedMissionRows(supabase, missionIds);

  const [
    callsResult,
    rejectionsResult,
    settingsResult,
    missionsResult
  ] = await Promise.all([
    supabase
      .from('admin_calls')
      .select('id,driver_id,date,platform,count,updated_at,rider_published_at')
      .eq('driver_id', riderId)
      .not('rider_published_at', 'is', null)
      .order('date', { ascending: false }),
    supabase
      .from('admin_rejection_rates')
      .select('id,driver_id,week_start,platform,rate,stats,source,updated_at,rider_published_at')
      .eq('driver_id', riderId)
      .not('rider_published_at', 'is', null)
      .order('week_start', { ascending: false }),
    supabase
      .from('settings')
      .select('key,value')
      .in('key', RIDER_SNAPSHOT_SETTING_KEYS),
    missionQuery
  ]);

  const firstError = [callsResult, rejectionsResult, settingsResult, missionsResult]
    .find(result => result.error);
  if (firstError?.error) {
    const message = firstError.error.message || '';
    if (/does not exist|relation|schema cache/i.test(message)) {
      return {
        ok: false,
        status: 400,
        error: '운영 DB 테이블이 준비되지 않았습니다. supabase/operations_tables_migration.sql 을 실행하세요.'
      };
    }
    return { ok: false, status: 500, error: message || '기사 반영 데이터를 불러오지 못했습니다.' };
  }

  const settingsRows = settingsResult.data || [];
  const calls = callsResult.data || [];
  const rejections = rejectionsResult.data || [];
  const missionRows = missionsResult.rows || [];
  const byId = new Map(missionRows.map(item => [item.id, item]));

  return {
    ok: true,
    riderId,
    publishedAt: resolveSnapshotPublishedAt(settingsRows, calls, rejections),
    calls,
    rejections,
    settings: settingsRows,
    missions: {
      baemin: baeminMissionId ? (byId.get(baeminMissionId) || null) : null,
      coupang: coupangMissionId ? (byId.get(coupangMissionId) || null) : null
    }
  };
}

async function getRiderLive(accessToken) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const riderId = me.riderId;
  const [
    targetsResult,
    settingsResult,
    callsResult
  ] = await Promise.all([
    supabase
      .from('admin_targets')
      .select('id,driver_id,month,count,updated_at')
      .eq('driver_id', riderId)
      .order('month', { ascending: false }),
    supabase
      .from('settings')
      .select('key,value')
      .in('key', RIDER_LIVE_SETTING_KEYS),
    supabase
      .from('admin_calls')
      .select('id,driver_id,date,platform,count,updated_at')
      .eq('driver_id', riderId)
      .order('date', { ascending: false })
  ]);

  const firstError = [targetsResult, settingsResult, callsResult].find(result => result.error);
  if (firstError?.error) {
    const message = firstError.error.message || '';
    if (/does not exist|relation|schema cache/i.test(message)) {
      return {
        ok: false,
        status: 400,
        error: '운영 DB 테이블이 준비되지 않았습니다. supabase/operations_tables_migration.sql 을 실행하세요.'
      };
    }
    return { ok: false, status: 500, error: message || '실시간 기사 데이터를 불러오지 못했습니다.' };
  }

  const settingsRows = settingsResult.data || [];
  const weeklyTargetsRaw = settingsRows.find(row => row.key === 'brem_driver_weekly_targets')?.value;
  const weeklyTargets = Array.isArray(weeklyTargetsRaw)
    ? weeklyTargetsRaw.filter(item => String(item?.driverId || '') === String(riderId))
    : [];

  const longEvent = computeLongEventProgress(
    me.rider,
    settingsRows,
    callsResult.data || []
  );

  return {
    ok: true,
    riderId,
    rider: me.rider,
    targets: targetsResult.data || [],
    weeklyTargets,
    longEvent,
    settings: settingsRows.filter(row => row.key !== 'brem_driver_weekly_targets')
  };
}

async function getRiderDashboard(accessToken) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const riderId = me.riderId;
  const [
    callsResult,
    rejectionsResult,
    targetsResult,
    noticesResult,
    settingsResult
  ] = await Promise.all([
    supabase
      .from('admin_calls')
      .select('id,driver_id,date,platform,count,updated_at,rider_published_at')
      .eq('driver_id', riderId)
      .not('rider_published_at', 'is', null)
      .order('date', { ascending: false }),
    supabase
      .from('admin_rejection_rates')
      .select('id,driver_id,week_start,platform,rate,stats,source,updated_at,rider_published_at')
      .eq('driver_id', riderId)
      .not('rider_published_at', 'is', null)
      .order('week_start', { ascending: false }),
    supabase
      .from('admin_targets')
      .select('id,driver_id,month,count,updated_at')
      .eq('driver_id', riderId)
      .order('month', { ascending: false }),
    supabase
      .from('notices')
      .select(NOTICE_SELECT)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('settings')
      .select('key,value')
      .in('key', RIDER_DASHBOARD_SETTING_KEYS)
  ]);

  const firstError = [callsResult, rejectionsResult, targetsResult, noticesResult, settingsResult]
    .find(result => result.error);
  if (firstError?.error) {
    const message = firstError.error.message || '';
    if (/does not exist|relation|schema cache/i.test(message)) {
      return {
        ok: false,
        status: 400,
        error: '운영 DB 테이블이 준비되지 않았습니다. supabase/operations_tables_migration.sql 을 실행하세요.'
      };
    }
    return { ok: false, status: 500, error: message || '기사 대시보드 데이터를 불러오지 못했습니다.' };
  }

  const settingsRows = settingsResult.data || [];
  const weeklyTargetsRaw = settingsRows.find(row => row.key === 'brem_driver_weekly_targets')?.value;
  const weeklyTargets = Array.isArray(weeklyTargetsRaw)
    ? weeklyTargetsRaw.filter(item => String(item?.driverId || '') === String(riderId))
    : [];

  const longEvent = computeLongEventProgress(
    me.rider,
    settingsRows,
    callsResult.data || []
  );

  return {
    ok: true,
    riderId,
    calls: callsResult.data || [],
    rejections: rejectionsResult.data || [],
    targets: targetsResult.data || [],
    weeklyTargets,
    notices: noticesResult.data || [],
    settings: settingsRows.filter(row => row.key !== 'brem_driver_weekly_targets'),
    longEvent
  };
}

const WEEKLY_TARGETS_SETTINGS_KEY = 'brem_driver_weekly_targets';

function normalizeMonthKey(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${String(match[2]).padStart(2, '0')}`;
}

function normalizeWeekStart(value) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

async function readWeeklyTargetsSetting(supabase) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', WEEKLY_TARGETS_SETTINGS_KEY)
    .maybeSingle();
  if (error) {
    return { ok: false, error: error.message || '주간 목표 설정을 불러오지 못했습니다.' };
  }
  const list = Array.isArray(data?.value) ? data.value : [];
  return { ok: true, list };
}

async function writeWeeklyTargetsSetting(supabase, list) {
  const { error } = await supabase.from('settings').upsert({
    key: WEEKLY_TARGETS_SETTINGS_KEY,
    value: list,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) {
    return { ok: false, error: error.message || '주간 목표를 저장하지 못했습니다.' };
  }
  return { ok: true };
}

async function saveRiderTargets(accessToken, body = {}) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const riderId = me.riderId;
  const monthly = body.monthly && typeof body.monthly === 'object' ? body.monthly : null;
  const weekly = body.weekly && typeof body.weekly === 'object' ? body.weekly : null;

  if (!monthly && !weekly) {
    return { ok: false, status: 400, error: '저장할 목표 정보가 없습니다.' };
  }

  const result = { ok: true, riderId, monthly: null, weekly: null };

  if (monthly) {
    const month = normalizeMonthKey(monthly.month);
    const count = Math.max(0, Number(monthly.count) || 0);
    if (!month) {
      return { ok: false, status: 400, error: '월간 목표 적용 월이 올바르지 않습니다.' };
    }

    const id = `${riderId}-${month}`;
    const now = new Date().toISOString();
    const { error } = await supabase.from('admin_targets').upsert({
      id,
      driver_id: riderId,
      month,
      count,
      updated_at: now,
      rider_published_at: now
    }, { onConflict: 'id' });

    if (error) {
      const message = error.message || '';
      if (/does not exist|relation|schema cache/i.test(message)) {
        return {
          ok: false,
          status: 400,
          error: '운영 DB 테이블이 준비되지 않았습니다. supabase/operations_tables_migration.sql 을 실행하세요.'
        };
      }
      return { ok: false, status: 500, error: message || '월간 목표를 저장하지 못했습니다.' };
    }

    result.monthly = { id, driverId: riderId, month, count };
  }

  if (weekly) {
    const weekStart = normalizeWeekStart(weekly.weekStart);
    const count = Math.max(0, Number(weekly.count) || 0);
    if (!weekStart) {
      return { ok: false, status: 400, error: '주간 목표 적용 주가 올바르지 않습니다.' };
    }

    const readResult = await readWeeklyTargetsSetting(supabase);
    if (!readResult.ok) {
      return { ok: false, status: 500, error: readResult.error };
    }

    const list = readResult.list.filter(item => !(
      String(item?.driverId || '') === String(riderId)
      && String(item?.weekStart || '').slice(0, 10) === weekStart
    ));
    list.push({
      id: `${riderId}-${weekStart}`,
      driverId: riderId,
      weekStart,
      count
    });

    const writeResult = await writeWeeklyTargetsSetting(supabase, list);
    if (!writeResult.ok) {
      return { ok: false, status: 500, error: writeResult.error };
    }

    result.weekly = { id: `${riderId}-${weekStart}`, driverId: riderId, weekStart, count };
  }

  return result;
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

  const rider = found.rider;

  return {
    ok: true,
    session: data.session,
    user: data.user,
    riderId: found.rider.id,
    rider,
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
  getRiderAssignedMissions,
  getRiderNotices,
  getRiderSnapshot,
  getRiderLive,
  getRiderAppBundle,
  getRiderPublishStatus,
  getRiderDashboard,
  saveRiderTargets,
  updateRiderProfile,
  provisionRiderAuthAccount,
  makeRiderLoginId
};
