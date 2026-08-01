const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');
const { provisionRiderAuthAccount, readRiderSecrets } = require('./rider-auth');
const {
  RIDER_SELECT_VARIANTS,
  RIDER_LIST_SELECT_VARIANTS,
  RIDER_DETAIL_SELECT_VARIANTS,
  RIDER_PATCH_RETURN_SELECT,
  isMissingColumnError,
  queryRidersWithSelectFallback
} = require('./rider-select-columns');

/** @deprecated use RIDER_SELECT_WITH_PLATFORM from rider-select-columns */
const RIDER_SELECT_LEGACY = RIDER_SELECT_VARIANTS[1];

/**
 * 일괄등록을 "안전하게 실패" 시키기 위한 에러.
 * 보호에 필요한 기존 데이터를 못 읽었을 때 던진다. 절대 무시하고 저장하지 않는다.
 */
class BulkRiderGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BulkRiderGuardError';
    this.isBulkGuard = true;
  }
}

function stripOptionalRiderColumns(row) {
  delete row.selected_mission_id;
  delete row.selected_mission_id_baemin;
  delete row.selected_mission_id_coupang;
  delete row.long_event_platform;
}

async function preserveRiderPasswordOnUpsert(supabase, row, passwordExplicit = false, explicitPassword = '') {
  if (!row?.id) return row;

  if (passwordExplicit) {
    const raw = row.raw_data && typeof row.raw_data === 'object' ? { ...row.raw_data } : {};
    raw.password = String(explicitPassword || raw.password || '1234').trim() || '1234';
    return { ...row, raw_data: raw };
  }

  const { data: existing, error } = await supabase
    .from('riders')
    .select('raw_data,resident_number')
    .eq('id', row.id)
    .maybeSingle();
  if (error || !existing) return row;

  const existingPassword = readRiderSecrets(existing).password;
  const raw = row.raw_data && typeof row.raw_data === 'object' ? { ...row.raw_data } : {};
  raw.password = existingPassword;
  return { ...row, raw_data: raw };
}

async function preserveRequiredRiderFieldsOnUpsert(supabase, row) {
  const next = { ...row };
  const hasName = String(next.name || '').trim();
  const hasPhone = String(next.phone || '').trim();
  if ((hasName && hasPhone) || !next.id) return next;

  const { data: existing, error } = await supabase
    .from('riders')
    .select('name,phone')
    .eq('id', next.id)
    .maybeSingle();
  if (error || !existing) return next;

  if (!hasName && existing.name) next.name = existing.name;
  if (!hasPhone && existing.phone) next.phone = formatPhoneForStorage(existing.phone);
  return next;
}

async function upsertRiderRowWithFallback(supabase, row) {
  let payload = await preserveRequiredRiderFieldsOnUpsert(supabase, row);
  if (!String(payload.name || '').trim()) {
    return {
      error: { message: '기사 이름이 없어 저장할 수 없습니다.' },
      row: payload
    };
  }
  let { error } = await supabase.from('riders').upsert(payload, { onConflict: 'id' });
  if (error && isMissingColumnError(error)) {
    stripOptionalRiderColumns(payload);
    ({ error } = await supabase.from('riders').upsert(payload, { onConflict: 'id' }));
  }
  return { error, row: payload };
}

function toDate(value) {
  const text = String(value || '').slice(0, 10);
  return text || null;
}

function resolvePatchFields(patch = {}) {
  if (patch?.changes && typeof patch.changes === 'object') {
    return patch.changes;
  }
  const { id, ...rest } = patch;
  return rest;
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeDriverName(value) {
  return String(value || '').replace(/\s/g, '').toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function formatPhoneForStorage(value) {
  const digits = normalizePhone(value);
  if (digits.length === 11 && digits.startsWith('010')) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10 && digits.startsWith('01')) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits || String(value || '').trim();
}

function normalizeRiderName(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function normalizePlatformId(value) {
  return String(value || '').trim().replace(/\s/g, '');
}

function normalizeLongEventPlatform(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'baemin') return 'baemin';
  if (v === 'both' || v === 'combined' || v === 'all') return 'both';
  return 'coupang';
}

function makeDriverMatchKey(name, phone) {
  const normName = normalizeDriverName(name);
  const normPhone = normalizePhone(phone);
  if (!normName || !normPhone) return '';
  return `${normName}|${normPhone}`;
}

function hasBaeminId(row) {
  const baeminId = String(row?.baemin_id || '').trim().toLowerCase();
  return Boolean(baeminId && baeminId !== '-');
}

function makeAutoMergePhoneKey(row) {
  const phone = normalizePhone(row?.phone);
  if (!phone || phone.length < 10) return '';
  return `phone:${phone}`;
}

function riderCompletenessScore(row) {
  let score = 0;
  if (row.auth_user_id) score += 16;
  if (String(row.long_event_item || '').trim()) score += 8;
  if (hasBaeminId(row)) score += 4;
  if (String(row.bank_name || '').trim()) score += 2;
  if (String(row.account_number || '').trim()) score += 1;
  const updatedAt = Date.parse(row.updated_at || row.created_at || 0);
  if (!Number.isNaN(updatedAt)) score += updatedAt / 1e12;
  return score;
}

function pickCanonicalRider(rows) {
  return [...rows].sort((a, b) => {
    const baeminDiff = Number(hasBaeminId(b)) - Number(hasBaeminId(a));
    if (baeminDiff !== 0) return baeminDiff;
    const scoreDiff = riderCompletenessScore(b) - riderCompletenessScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

function mergeStringField(target, source, field) {
  if (!String(target[field] || '').trim() && String(source[field] || '').trim()) {
    target[field] = source[field];
  }
}

function mergeRiderRows(keep, donor) {
  const merged = { ...keep };
  [
    'name', 'phone', 'resident_number', 'bank_name', 'account_holder', 'account_number',
    'baemin_id', 'memo', 'long_event_item_id', 'long_event_item', 'long_event_platform',
    'promotion_selector_coupang', 'promotion_selector_baemin',
    'promotion_rule_id_coupang', 'promotion_rule_id_baemin',
    'selected_mission_id', 'selected_mission_id_baemin', 'selected_mission_id_coupang'
  ].forEach(field => mergeStringField(merged, donor, field));

  if (!merged.long_event_start_date && donor.long_event_start_date) merged.long_event_start_date = donor.long_event_start_date;
  if (!merged.join_date && donor.join_date) merged.join_date = donor.join_date;
  if (donor.platform_baemin) merged.platform_baemin = true;
  if (donor.platform_coupang !== false) merged.platform_coupang = true;

  const keepHidden = keep.hidden_fields && typeof keep.hidden_fields === 'object' ? keep.hidden_fields : {};
  const donorHidden = donor.hidden_fields && typeof donor.hidden_fields === 'object' ? donor.hidden_fields : {};
  merged.hidden_fields = { ...donorHidden, ...keepHidden };
  merged.updated_at = new Date().toISOString();
  return merged;
}

async function fetchAllRiders(supabase, selectColumns) {
  if (selectColumns) {
    const allRows = [];
    let offset = 0;
    const limit = 200;

    while (true) {
      const { data, error, count } = await supabase
        .from('riders')
        .select(selectColumns, { count: 'exact' })
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      allRows.push(...(data || []));
      const total = count ?? allRows.length;
      if (!data?.length || allRows.length >= total) break;
      offset += limit;
    }

    return allRows;
  }

  const allRows = [];
  let offset = 0;
  const limit = 200;
  let activeSelect = RIDER_SELECT;

  while (true) {
    let data;
    let error;
    let count;
    ({ data, error, count, selectColumns: activeSelect } = await queryRidersWithSelectFallback(
      RIDER_SELECT_VARIANTS,
      async columns => {
      activeSelect = columns;
      return supabase
        .from('riders')
        .select(columns, { count: 'exact' })
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);
    }));

    if (error) throw error;

    allRows.push(...(data || []));
    const total = count ?? allRows.length;
    if (!data?.length || allRows.length >= total) break;
    offset += limit;
  }

  return allRows;
}

function buildAutoMergeGroups(rows) {
  const parent = new Map();
  const rowsById = new Map();
  const keyOwners = new Map();
  const keyMembers = new Map();

  const find = (id) => {
    if (!parent.has(id)) parent.set(id, id);
    const current = parent.get(id);
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };

  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  (rows || []).forEach(row => {
    const id = String(row.id || '');
    if (!id) return;
    parent.set(id, id);
    rowsById.set(id, row);
  });

  rowsById.forEach(row => {
    const id = String(row.id);
    const key = makeAutoMergePhoneKey(row);
    if (!key) return;
    if (!keyMembers.has(key)) keyMembers.set(key, []);
    keyMembers.get(key).push(id);
    if (!keyOwners.has(key)) {
      keyOwners.set(key, id);
    } else {
      union(keyOwners.get(key), id);
    }
  });

  const grouped = new Map();
  rowsById.forEach(row => {
    const root = find(String(row.id));
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(row);
  });

  return [...grouped.values()]
    .filter(group => group.length > 1)
    .map(group => {
      const groupIds = new Set(group.map(row => String(row.id)));
      const reasons = new Set();
      keyMembers.forEach((ids, key) => {
        const overlapCount = ids.filter(id => groupIds.has(id)).length;
        if (overlapCount > 1) reasons.add(key);
      });
      return { rows: group, reasons: [...reasons] };
    });
}

async function mergeRiderGroup(supabase, rows) {
  const canonical = pickCanonicalRider(rows);
  let merged = { ...canonical };
  const removedIds = [];
  const idRemap = {};

  rows.forEach(row => {
    if (row.id === canonical.id) return;
    merged = mergeRiderRows(merged, row);
    removedIds.push(row.id);
    idRemap[row.id] = canonical.id;
  });

  for (const [fromId, toId] of Object.entries(idRemap)) {
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ rider_id: toId })
      .eq('rider_id', fromId);
    if (profileError) {
      return { ok: false, status: 500, error: profileError.message || '기사 로그인 연결을 병합하지 못했습니다.' };
    }
  }

  let upsertRow = { ...merged };
  const upsertResult = await upsertRiderRowWithFallback(supabase, upsertRow);
  if (upsertResult.error) {
    return { ok: false, status: 400, error: upsertResult.error.message || '병합된 기사 저장에 실패했습니다.' };
  }
  upsertRow = upsertResult.row;

  for (const id of removedIds) {
    const { error: deleteError } = await supabase.from('riders').delete().eq('id', id);
    if (deleteError) {
      return { ok: false, status: 400, error: deleteError.message || '중복 기사 삭제에 실패했습니다.' };
    }
  }

  const provision = await provisionRiderAuthAccount(upsertRow);
  if (!provision.ok) {
    console.warn('[BREM] Rider auth provisioning failed after merge:', upsertRow.id, provision.error);
  }

  return {
    ok: true,
    keptId: canonical.id,
    keptName: canonical.name,
    keptPhone: canonical.phone,
    removedIds,
    idRemap,
    mergedCount: rows.length
  };
}

function riderToRow(driver) {
  const source = driver && typeof driver === 'object' ? { ...driver } : {};
  const passwordExplicit = Boolean(source.passwordExplicit);
  delete source.passwordExplicit;
  delete source.bulkFillPatch;
  if (!passwordExplicit) {
    delete source.password;
  } else if (source.password !== undefined) {
    source.password = String(source.password).trim() || '1234';
  }

  return {
    id: String(source.id || ''),
    auth_user_id: source.authUserId || null,
    name: normalizeRiderName(source.name),
    phone: formatPhoneForStorage(source.phone),
    resident_number: String(source.residentNumber || ''),
    bank_name: String(source.bankName || '').trim(),
    account_holder: String(source.accountHolder || '').trim(),
    account_number: String(source.accountNumber || '').trim(),
    baemin_id: normalizePlatformId(source.baeminId),
    platform_coupang: source.platformCoupang !== false,
    platform_baemin: Boolean(source.platformBaemin),
    long_event_item_id: String(source.longEventItemId || ''),
    long_event_item: String(source.longEventItem || ''),
    long_event_start_date: toDate(source.longEventStartDate),
    long_event_platform: normalizeLongEventPlatform(source.longEventPlatform),
    join_date: toDate(source.joinDate),
    status: String(source.status || '근무중'),
    memo: String(source.memo || ''),
    hidden_fields: source.hiddenFields || {},
    promotion_selector_coupang: String(source.promotionSelectorCoupang || ''),
    promotion_selector_baemin: String(source.promotionSelectorBaemin || ''),
    promotion_rule_id_coupang: String(source.promotionRuleIdCoupang || ''),
    promotion_rule_id_baemin: String(source.promotionRuleIdBaemin || ''),
    selected_mission_id: String(source.selectedMissionId || source.selectedMissionIdBaemin || source.selectedMissionIdCoupang || ''),
    selected_mission_id_baemin: String(source.selectedMissionIdBaemin || source.selectedMissionId || ''),
    selected_mission_id_coupang: String(source.selectedMissionIdCoupang || source.selectedMissionId || ''),
    raw_data: source,
    created_at: toIso(source.createdAt),
    updated_at: toIso(source.updatedAt)
  };
}

async function listRiders(accessToken, options = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 200);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const search = String(options.search || '').trim();
  const status = String(options.status || '').trim();

  const supabase = getServiceClient();

  async function runQuery(selectColumns) {
    let query = supabase
      .from('riders')
      .select(selectColumns, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && status !== '전체') {
      query = query.eq('status', status);
    }
    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    return query;
  }

  const { data, error, count } = await queryRidersWithSelectFallback(
    options.view === 'list' ? RIDER_LIST_SELECT_VARIANTS : RIDER_SELECT_VARIANTS,
    columns => runQuery(columns)
  );

  if (error) {
    return { ok: false, status: 500, error: error.message || '기사 목록을 불러오지 못했습니다.' };
  }

  const riders = data || [];
  return {
    ok: true,
    riders,
    total: count ?? riders.length,
    hasMore: offset + riders.length < (count ?? 0),
    limit,
    offset
  };
}

async function getRider(accessToken, riderId) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const id = String(riderId || '').trim();
  if (!id) {
    return { ok: false, status: 400, error: '기사 ID가 필요합니다.' };
  }

  const supabase = getServiceClient();
  const { data, error } = await queryRidersWithSelectFallback(
    RIDER_DETAIL_SELECT_VARIANTS,
    columns => supabase.from('riders').select(columns).eq('id', id).maybeSingle()
  );

  if (error) {
    return { ok: false, status: 500, error: error.message || '기사 정보를 불러오지 못했습니다.' };
  }
  if (!data) {
    return { ok: false, status: 404, error: '기사를 찾을 수 없습니다.' };
  }

  return { ok: true, rider: data };
}

async function upsertRider(accessToken, rider) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  let row = riderToRow(rider);
  if (!row.id) {
    return { ok: false, status: 400, error: '기사 ID가 없습니다.' };
  }
  if (!normalizeRiderName(row.name)) {
    return { ok: false, status: 400, error: '기사 이름은 필수입니다.' };
  }

  row = await preserveRiderPasswordOnUpsert(
    supabase,
    row,
    Boolean(rider.passwordExplicit),
    rider.password
  );
  const { error } = await upsertRiderRowWithFallback(supabase, row);
  if (error) {
    return { ok: false, status: 400, error: error.message || '기사 저장에 실패했습니다.' };
  }

  const shouldProvisionAuth = Boolean(rider.passwordExplicit) || !row.auth_user_id;
  if (shouldProvisionAuth) {
    const provision = await provisionRiderAuthAccount(row);
    if (!provision.ok) {
      console.warn('[BREM] Rider auth provisioning failed:', provision.error);
      return {
        ok: false,
        status: provision.status || 400,
        error: provision.error || '기사 로그인 계정 갱신에 실패했습니다.'
      };
    }
  }

  const { data, error: readError } = await queryRidersWithSelectFallback(
    RIDER_DETAIL_SELECT_VARIANTS,
    columns => supabase.from('riders').select(columns).eq('id', row.id).maybeSingle()
  );

  if (readError) {
    return { ok: false, status: 500, error: readError.message || '저장된 기사를 확인하지 못했습니다.' };
  }

  return { ok: true, rider: data };
}

async function resetRiderPassword(accessToken, riderId, defaultPassword = '1234') {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const id = String(riderId || '').trim();
  if (!id) {
    return { ok: false, status: 400, error: '기사 ID가 필요합니다.' };
  }

  const supabase = getServiceClient();
  const { data: existing, error: readError } = await queryRidersWithSelectFallback(
    RIDER_DETAIL_SELECT_VARIANTS,
    columns => supabase.from('riders').select(columns).eq('id', id).maybeSingle()
  );

  if (readError) {
    return { ok: false, status: 500, error: readError.message || '기사 정보를 불러오지 못했습니다.' };
  }
  if (!existing) {
    return { ok: false, status: 404, error: '기사를 찾을 수 없습니다.' };
  }

  const password = String(defaultPassword || '1234').trim() || '1234';
  const raw = existing.raw_data && typeof existing.raw_data === 'object'
    ? { ...existing.raw_data }
    : {};
  raw.password = password;

  const { error: updateError } = await supabase
    .from('riders')
    .update({
      raw_data: raw,
      updated_at: new Date().toISOString()
    })
    .eq('id', id);

  if (updateError) {
    return {
      ok: false,
      status: 400,
      error: updateError.message || '비밀번호 초기화에 실패했습니다.'
    };
  }

  const row = {
    ...existing,
    raw_data: raw,
    updated_at: new Date().toISOString()
  };

  const provision = await provisionRiderAuthAccount(row);
  if (!provision.ok) {
    return {
      ok: false,
      status: provision.status || 400,
      error: provision.error || '기사 Auth 비밀번호 갱신에 실패했습니다.'
    };
  }

  const { data, error: reloadError } = await queryRidersWithSelectFallback(
    RIDER_DETAIL_SELECT_VARIANTS,
    columns => supabase.from('riders').select(columns).eq('id', id).maybeSingle()
  );

  if (reloadError) {
    return { ok: false, status: 500, error: reloadError.message || '저장된 기사를 확인하지 못했습니다.' };
  }

  return { ok: true, rider: data, riderId: id, password };
}

function buildExistingRiderMatchMap(rows) {
  const map = new Map();
  (rows || []).forEach(row => {
    const key = makeDriverMatchKey(row.name, row.phone);
    if (key && !map.has(key)) map.set(key, row);
  });
  return map;
}

function dbRowToDriver(row) {
  const raw = row?.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  return {
    id: row.id,
    authUserId: row.auth_user_id || '',
    name: row.name,
    phone: row.phone,
    residentNumber: row.resident_number || raw.residentNumber || '',
    bankName: row.bank_name || '',
    accountHolder: row.account_holder || '',
    accountNumber: row.account_number || '',
    baeminId: row.baemin_id || '',
    platformCoupang: row.platform_coupang !== false,
    platformBaemin: Boolean(row.platform_baemin),
    regionBaemin: String(raw.regionBaemin || '').trim(),
    regionCoupang: String(raw.regionCoupang || '').trim(),
    longEventItemId: row.long_event_item_id || raw.longEventItemId || '',
    longEventItem: row.long_event_item || raw.longEventItem || '',
    longEventStartDate: row.long_event_start_date || raw.longEventStartDate || '',
    longEventPlatform: row.long_event_platform || raw.longEventPlatform || '',
    joinDate: row.join_date || raw.joinDate || '',
    status: row.status || '근무중',
    memo: row.memo || '',
    hiddenFields: row.hidden_fields || {},
    promotionSelectorCoupang: row.promotion_selector_coupang || raw.promotionSelectorCoupang || '',
    promotionSelectorBaemin: row.promotion_selector_baemin || raw.promotionSelectorBaemin || '',
    promotionRuleIdCoupang: row.promotion_rule_id_coupang || raw.promotionRuleIdCoupang || '',
    promotionRuleIdBaemin: row.promotion_rule_id_baemin || raw.promotionRuleIdBaemin || '',
    selectedMissionId: row.selected_mission_id
      || raw.selectedMissionId
      || row.selected_mission_id_baemin
      || row.selected_mission_id_coupang
      || '',
    selectedMissionIdBaemin: row.selected_mission_id_baemin
      || raw.selectedMissionIdBaemin
      || raw.selectedMissionId
      || '',
    selectedMissionIdCoupang: row.selected_mission_id_coupang
      || raw.selectedMissionIdCoupang
      || raw.selectedMissionId
      || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mergeIncomingRiderWithExisting(incoming, existingRow) {
  if (incoming?.bulkFillPatch) {
    return incoming;
  }

  const merged = { ...incoming };
  merged.id = existingRow.id;
  if (existingRow.auth_user_id) merged.authUserId = existingRow.auth_user_id;

  const incomingBaemin = normalizePlatformId(incoming.baeminId);
  const existingBaemin = normalizePlatformId(existingRow.baemin_id);
  merged.baeminId = incomingBaemin || existingBaemin;

  merged.platformBaemin = Boolean(incoming.platformBaemin || existingRow.platform_baemin || merged.baeminId);
  merged.platformCoupang = incoming.platformCoupang !== false && existingRow.platform_coupang !== false;

  // 일괄등록 시 미션/프로모션이 payload에 없으면 기존 값을 유지한다.
  const keep = (incomingKey, existingKey) => {
    if (String(merged[incomingKey] || '').trim()) return;
    const prev = String(existingRow[existingKey] || '').trim();
    if (prev) merged[incomingKey] = prev;
  };
  keep('selectedMissionId', 'selected_mission_id');
  keep('selectedMissionIdBaemin', 'selected_mission_id_baemin');
  keep('selectedMissionIdCoupang', 'selected_mission_id_coupang');
  keep('promotionRuleIdBaemin', 'promotion_rule_id_baemin');
  keep('promotionRuleIdCoupang', 'promotion_rule_id_coupang');
  keep('promotionSelectorBaemin', 'promotion_selector_baemin');
  keep('promotionSelectorCoupang', 'promotion_selector_coupang');
  keep('longEventItemId', 'long_event_item_id');
  keep('longEventItem', 'long_event_item');
  keep('longEventStartDate', 'long_event_start_date');
  keep('longEventPlatform', 'long_event_platform');

  return merged;
}

/**
 * 일괄등록에서 "빈 칸만 채우기" patch 는 변경 필드만 담고 있다.
 * 기존 행을 못 읽으면 patch 만으로 riderToRow 를 타게 되는데, riderToRow 는
 * 모든 컬럼을 String(x || '') 로 만들어내므로 이름·전화·계좌·배민ID가 빈 값으로
 * 덮이고 platform 플래그까지 초기화된다. 그래서 못 읽으면 저장하지 않고 중단한다.
 * (읽기 실패를 무시하고 진행하면 정확히 과거 데이터 소실 사고가 재현된다)
 */
async function expandBulkFillPatches(supabase, riders) {
  const list = Array.isArray(riders) ? riders : [];
  const patchIds = [...new Set(
    list
      .filter(rider => rider?.bulkFillPatch && rider?.id)
      .map(rider => String(rider.id).trim())
      .filter(Boolean)
  )];
  if (!patchIds.length) return list;

  // 행마다 SELECT 하면 300행 = 300 왕복이다 → 200개씩 묶어 한 번에 읽는다.
  const existingById = new Map();
  for (let offset = 0; offset < patchIds.length; offset += 200) {
    const chunk = patchIds.slice(offset, offset + 200);
    const { data, error } = await queryRidersWithSelectFallback(
      RIDER_DETAIL_SELECT_VARIANTS,
      columns => supabase.from('riders').select(columns).in('id', chunk)
    );
    if (error) {
      throw new BulkRiderGuardError(
        `기존 기사 정보를 읽지 못해 일괄등록을 중단했습니다. 그대로 저장하면 이름·연락처·계좌가 빈 값으로 덮일 수 있습니다. 잠시 후 다시 시도해 주세요. (${error.message || error})`
      );
    }
    (data || []).forEach(row => {
      if (row?.id) existingById.set(String(row.id), row);
    });
  }

  return list.map(rider => {
    if (!rider?.bulkFillPatch || !rider?.id) return rider;
    const id = String(rider.id).trim();
    const existing = existingById.get(id);
    if (!existing) {
      throw new BulkRiderGuardError(
        `일괄등록 대상 기사를 찾을 수 없어 중단했습니다. (id=${id}) 목록을 새로고침한 뒤 다시 시도해 주세요.`
      );
    }
    const base = dbRowToDriver(existing);
    const { bulkFillPatch, id: _id, ...patch } = rider;
    return { ...base, ...patch };
  });
}

const PROTECTED_RIDER_COLUMNS = [
  'selected_mission_id',
  'selected_mission_id_baemin',
  'selected_mission_id_coupang',
  'promotion_rule_id_baemin',
  'promotion_rule_id_coupang',
  'promotion_selector_baemin',
  'promotion_selector_coupang',
  'long_event_item_id',
  'long_event_item',
  'long_event_start_date',
  'long_event_platform'
];

/**
 * 일괄 upsert 시 payload 가 빈 문자열이어도 기존 미션/프로모션/장기이벤트를 덮어쓰지 않는다.
 * (계좌번호만 채우는 일괄등록에서 미션 배정이 통째로 날아가는 사고 방지)
 */
async function preserveProtectedFieldsOnBulkUpsert(supabase, rows) {
  const list = Array.isArray(rows) ? rows.filter(row => row?.id) : [];
  if (!list.length) return rows || [];

  const ids = [...new Set(list.map(row => String(row.id)))];
  const existingById = new Map();
  const chunkSize = 200;
  for (let offset = 0; offset < ids.length; offset += chunkSize) {
    const chunk = ids.slice(offset, offset + chunkSize);
    const { data, error } = await queryRidersWithSelectFallback(
      RIDER_DETAIL_SELECT_VARIANTS,
      columns => supabase.from('riders').select(columns).in('id', chunk)
    );
    if (error) {
      // 여기서 rows 를 그대로 돌려주면 미션·프로모션·장기이벤트가 빈 값으로 덮인다.
      // 읽기 실패는 곧 보호 불가이므로 저장하지 않고 중단한다.
      throw new BulkRiderGuardError(
        `기존 미션·프로모션 정보를 읽지 못해 일괄등록을 중단했습니다. 그대로 저장하면 미션 배정과 장기근속이벤트가 지워질 수 있습니다. 잠시 후 다시 시도해 주세요. (${error.message || error})`
      );
    }
    (data || []).forEach(row => {
      if (row?.id) existingById.set(String(row.id), row);
    });
  }

  const rawMissionKeys = [
    'selectedMissionId',
    'selectedMissionIdBaemin',
    'selectedMissionIdCoupang',
    'promotionRuleIdBaemin',
    'promotionRuleIdCoupang',
    'promotionSelectorBaemin',
    'promotionSelectorCoupang',
    'longEventItemId',
    'longEventItem',
    'longEventStartDate',
    'longEventPlatform'
  ];

  return (rows || []).map(row => {
    const id = String(row?.id || '');
    const existing = existingById.get(id);
    const next = { ...row };

    PROTECTED_RIDER_COLUMNS.forEach(col => {
      const incoming = String(next[col] ?? '').trim();
      if (incoming) return;
      const prev = existing ? String(existing[col] ?? '').trim() : '';
      if (prev) {
        next[col] = existing[col];
        return;
      }
      // 빈 값이면 upsert payload 에서 제거 → DB 기존 값을 덮어쓰지 않음
      delete next[col];
    });

    // raw_data 안 미션 값도 빈 값이면 기존 raw 를 유지(비밀번호는 이미 preserveRiderPasswordOnUpsert 가 처리)
    const nextRaw = next.raw_data && typeof next.raw_data === 'object' ? { ...next.raw_data } : {};
    const prevRaw = existing?.raw_data && typeof existing.raw_data === 'object' ? existing.raw_data : {};
    rawMissionKeys.forEach(key => {
      if (String(nextRaw[key] || '').trim()) return;
      if (String(prevRaw[key] || '').trim()) {
        nextRaw[key] = prevRaw[key];
        return;
      }
      delete nextRaw[key];
    });
    next.raw_data = nextRaw;
    return next;
  });
}

/**
 * 컬럼이 비었는데 raw_data 에 미션 ID 가 남아 있으면 복구한다.
 * (일괄등록 덮어쓰기 사고 후 일부 복구용)
 */
async function restoreMissionsFromRawData(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  const rows = await fetchAllRiders(supabase);
  let restored = 0;
  const samples = [];

  for (const row of rows) {
    const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
    const colBaemin = String(row.selected_mission_id_baemin || '').trim();
    const colCoupang = String(row.selected_mission_id_coupang || '').trim();
    const colAny = String(row.selected_mission_id || '').trim();
    const rawBaemin = String(raw.selectedMissionIdBaemin || raw.selectedMissionId || '').trim();
    const rawCoupang = String(raw.selectedMissionIdCoupang || raw.selectedMissionId || '').trim();
    const rawRuleBaemin = String(raw.promotionRuleIdBaemin || '').trim();
    const rawRuleCoupang = String(raw.promotionRuleIdCoupang || '').trim();

    const nextBaemin = colBaemin || rawBaemin || rawRuleBaemin;
    const nextCoupang = colCoupang || rawCoupang || rawRuleCoupang;
    const nextAny = colAny || nextBaemin || nextCoupang;
    if (!nextBaemin && !nextCoupang) continue;
    if (colBaemin === nextBaemin && colCoupang === nextCoupang && colAny === nextAny) continue;

    const patch = {
      selected_mission_id_baemin: nextBaemin,
      selected_mission_id_coupang: nextCoupang,
      selected_mission_id: nextAny,
      promotion_rule_id_baemin: String(row.promotion_rule_id_baemin || rawRuleBaemin || nextBaemin || '').trim(),
      promotion_rule_id_coupang: String(row.promotion_rule_id_coupang || rawRuleCoupang || nextCoupang || '').trim(),
      promotion_selector_baemin: String(row.promotion_selector_baemin || raw.promotionSelectorBaemin || nextBaemin || '').trim(),
      promotion_selector_coupang: String(row.promotion_selector_coupang || raw.promotionSelectorCoupang || nextCoupang || '').trim(),
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from('riders').update(patch).eq('id', row.id);
    if (error) {
      console.warn('[BREM] restore mission failed:', row.id, error.message || error);
      continue;
    }
    restored += 1;
    if (samples.length < 20) {
      samples.push({
        id: row.id,
        name: row.name,
        baemin: nextBaemin,
        coupang: nextCoupang
      });
    }
  }

  return {
    ok: true,
    scanned: rows.length,
    restored,
    samples
  };
}

async function resolveBulkRidersForUpsert(supabase, riders) {
  const existingRows = await fetchAllRiders(
    supabase,
    'id,name,phone,baemin_id,platform_coupang,platform_baemin,auth_user_id'
  );
  const matchMap = buildExistingRiderMatchMap(existingRows);

  let updated = 0;
  const resolved = riders.map(rider => {
    const key = makeDriverMatchKey(rider.name, rider.phone);
    const existing = key ? matchMap.get(key) : null;
    if (!existing) return rider;
    updated += 1;
    const merged = mergeIncomingRiderWithExisting(rider, existing);
    matchMap.set(key, {
      ...existing,
      baemin_id: merged.baeminId,
      platform_baemin: merged.platformBaemin,
      platform_coupang: merged.platformCoupang !== false
    });
    return merged;
  });

  return { resolved, updated };
}

async function bulkUpsertRiders(accessToken, riders, options = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const list = Array.isArray(riders) ? riders.filter(Boolean) : [];
  if (!list.length) {
    return { ok: true, succeeded: 0, failed: [], total: 0, updated: 0, created: 0 };
  }

  const maxBatch = Math.min(Math.max(Number(options.maxBatch) || 150, 1), 500);
  if (list.length > maxBatch) {
    return {
      ok: false,
      status: 400,
      error: `한 번에 최대 ${maxBatch}명까지 처리할 수 있습니다.`
    };
  }

  const supabase = getServiceClient();
  // 보호에 필요한 기존 데이터를 못 읽으면 아무것도 저장하지 않고 사유를 돌려준다.
  let expanded;
  let resolved;
  let updated;
  try {
    expanded = await expandBulkFillPatches(supabase, list);
    ({ resolved, updated } = await resolveBulkRidersForUpsert(supabase, expanded));
  } catch (error) {
    if (error?.isBulkGuard) {
      console.warn('[BREM] bulkUpsertRiders 중단:', error.message);
      return { ok: false, status: 503, error: error.message };
    }
    throw error;
  }
  // 비밀번호 보존을 행마다 SELECT 하면 300명 배치에 300번 왕복이라 일괄등록이 매우 느려진다.
  // 필요한 id 만 모아 한 번에(200개 청크) 읽고 메모리에서 합친다.
  const draftRows = resolved.map(rider => {
    const row = riderToRow(rider);
    // 일괄 업서트에서는 auth_user_id 를 절대 건드리지 않는다.
    // - 신규: null(기본값)으로 삽입되고, 계정 프로비저닝이 별도로 id 기준 채운다.
    // - 기존: payload 에서 빼면 UPDATE SET 대상이 아니므로 기존 값이 그대로 보존된다.
    // 이렇게 해야 한 배치 안에서 같은/충돌 auth_user_id 가 들어가 riders_auth_user_id_key
    // 유니크 제약을 위반하는 일이 사라진다.
    delete row.auth_user_id;
    return { row, rider };
  });

  const passwordLookupIds = [...new Set(
    draftRows
      .filter(({ row, rider }) => row?.id && !rider.passwordExplicit)
      .map(({ row }) => String(row.id))
  )];
  const existingSecretsById = new Map();
  for (let offset = 0; offset < passwordLookupIds.length; offset += 200) {
    const chunk = passwordLookupIds.slice(offset, offset + 200);
    const { data, error } = await supabase
      .from('riders')
      .select('id,raw_data,resident_number')
      .in('id', chunk);
    if (error) {
      console.warn('[BREM] bulkUpsertRiders 비밀번호 조회 실패:', error.message || error);
      break;
    }
    (data || []).forEach(item => {
      if (item?.id) existingSecretsById.set(String(item.id), item);
    });
  }

  const builtRows = draftRows.map(({ row, rider }) => {
    if (rider.passwordExplicit) {
      const raw = row.raw_data && typeof row.raw_data === 'object' ? { ...row.raw_data } : {};
      raw.password = String(rider.password || raw.password || '1234').trim() || '1234';
      return { ...row, raw_data: raw };
    }
    const existing = row?.id ? existingSecretsById.get(String(row.id)) : null;
    if (!existing) return row;
    const raw = row.raw_data && typeof row.raw_data === 'object' ? { ...row.raw_data } : {};
    raw.password = readRiderSecrets(existing).password;
    return { ...row, raw_data: raw };
  });
  // 배치 내 동일 id 중복 제거(마지막 값 유지) — "ON CONFLICT DO UPDATE ... affect row a second time" 방지
  const rowsById = new Map();
  builtRows.forEach(row => {
    if (row && row.auth_user_id !== undefined) delete row.auth_user_id;
    rowsById.set(String(row.id || ''), row);
  });
  let rows = Array.from(rowsById.values());
  // 일괄등록/계좌채우기 등에서 미션·프로모션·장기이벤트가 빈 값으로 덮이지 않게 기존 DB 값을 보존한다.
  try {
    rows = await preserveProtectedFieldsOnBulkUpsert(supabase, rows);
  } catch (error) {
    if (error?.isBulkGuard) {
      console.warn('[BREM] bulkUpsertRiders 중단:', error.message);
      return { ok: false, status: 503, error: error.message };
    }
    throw error;
  }

  let upsertPayload = rows;
  let { error } = await supabase.from('riders').upsert(upsertPayload, { onConflict: 'id' });
  if (error && isMissingColumnError(error)) {
    upsertPayload = rows.map(item => {
      const next = { ...item };
      stripOptionalRiderColumns(next);
      return next;
    });
    ({ error } = await supabase.from('riders').upsert(upsertPayload, { onConflict: 'id' }));
  }

  // 배치 업서트가 여전히 실패하면(예: 잔여 제약 위반) 행별로 업서트해 정상 행은 저장되게 하고,
  // 실패한 행만 사유와 함께 돌려준다.
  if (error) {
    const perRowFailed = [];
    let anySucceeded = false;
    for (const row of rows) {
      let attempt = { ...row };
      let { error: rowError } = await supabase.from('riders').upsert(attempt, { onConflict: 'id' });
      if (rowError && isMissingColumnError(rowError)) {
        stripOptionalRiderColumns(attempt);
        ({ error: rowError } = await supabase.from('riders').upsert(attempt, { onConflict: 'id' }));
      }
      if (rowError) {
        perRowFailed.push({ id: String(row.id || ''), error: rowError.message || '저장 실패' });
      } else {
        anySucceeded = true;
      }
    }
    if (perRowFailed.length && !anySucceeded) {
      return {
        ok: false,
        status: 400,
        error: error.message || '기사 일괄 저장에 실패했습니다.',
        failed: perRowFailed
      };
    }
    return {
      ok: true,
      succeeded: rows.length - perRowFailed.length,
      failed: perRowFailed,
      total: list.length,
      updated,
      created: Math.max(0, (rows.length - perRowFailed.length) - updated)
    };
  }

  if (error) {
    return {
      ok: false,
      status: 400,
      error: error.message || '기사 일괄 저장에 실패했습니다.',
      failed: list.map(rider => ({
        id: String(rider.id || ''),
        error: error.message || '저장 실패'
      }))
    };
  }

  if (!options.skipAuthProvision) {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rider = resolved[index];
      if (!rider?.passwordExplicit) continue;
      const provision = await provisionRiderAuthAccount(row);
      if (!provision.ok) {
        console.warn('[BREM] Rider auth provisioning failed:', row.id, provision.error);
      }
    }
  }

  return {
    ok: true,
    succeeded: list.length,
    failed: [],
    total: list.length,
    updated,
    created: Math.max(0, list.length - updated)
  };
}

function normalizeMissionPatchFields(fields = {}) {
  const next = {};
  if (fields.selectedMissionIdBaemin !== undefined) {
    next.selected_mission_id_baemin = String(fields.selectedMissionIdBaemin || '').trim();
  }
  if (fields.selectedMissionIdCoupang !== undefined) {
    next.selected_mission_id_coupang = String(fields.selectedMissionIdCoupang || '').trim();
  }
  if (fields.selectedMissionId !== undefined) {
    next.selected_mission_id = String(fields.selectedMissionId || '').trim();
  } else if (
    next.selected_mission_id_baemin !== undefined
    || next.selected_mission_id_coupang !== undefined
  ) {
    const baemin = next.selected_mission_id_baemin ?? '';
    const coupang = next.selected_mission_id_coupang ?? '';
    if (baemin && coupang && baemin === coupang) next.selected_mission_id = baemin;
    else if (baemin && !coupang) next.selected_mission_id = baemin;
    else if (!baemin && coupang) next.selected_mission_id = coupang;
    else if (!baemin && !coupang) next.selected_mission_id = '';
  }
  // 미션관리 저장 시 프로모션 배정 필드도 같이 맞춰 화면/적용이 되돌아가지 않게 함
  if (fields.promotionRuleIdBaemin !== undefined) {
    next.promotion_rule_id_baemin = String(fields.promotionRuleIdBaemin || '').trim();
  } else if (fields.selectedMissionIdBaemin !== undefined) {
    next.promotion_rule_id_baemin = String(fields.selectedMissionIdBaemin || '').trim();
  }
  if (fields.promotionRuleIdCoupang !== undefined) {
    next.promotion_rule_id_coupang = String(fields.promotionRuleIdCoupang || '').trim();
  } else if (fields.selectedMissionIdCoupang !== undefined) {
    next.promotion_rule_id_coupang = String(fields.selectedMissionIdCoupang || '').trim();
  }
  if (fields.promotionSelectorBaemin !== undefined) {
    next.promotion_selector_baemin = String(fields.promotionSelectorBaemin || '').trim();
  } else if (fields.selectedMissionIdBaemin !== undefined) {
    next.promotion_selector_baemin = String(fields.selectedMissionIdBaemin || '').trim();
  }
  if (fields.promotionSelectorCoupang !== undefined) {
    next.promotion_selector_coupang = String(fields.promotionSelectorCoupang || '').trim();
  } else if (fields.selectedMissionIdCoupang !== undefined) {
    next.promotion_selector_coupang = String(fields.selectedMissionIdCoupang || '').trim();
  }
  return next;
}

async function patchRiderMissionFields(supabase, riderId, fields = {}) {
  const updatePayload = {
    ...normalizeMissionPatchFields(fields),
    updated_at: new Date().toISOString()
  };
  if (Object.keys(updatePayload).length <= 1) {
    return { ok: false, status: 400, error: '저장할 미션 정보가 없습니다.' };
  }

  const { data, error } = await supabase
    .from('riders')
    .update(updatePayload)
    .eq('id', riderId)
    .select(RIDER_PATCH_RETURN_SELECT)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error)) {
      return {
        ok: false,
        status: 400,
        error: '미션 컬럼이 없습니다. Supabase SQL Editor에서 supabase/missions_migration.sql 을 실행하세요.'
      };
    }
    return { ok: false, status: 400, error: error.message || '미션 저장에 실패했습니다.' };
  }

  return { ok: true, rider: data };
}

function normalizeLongEventPatchFields(fields = {}) {
  const next = {};
  if (fields.longEventItemId !== undefined) {
    next.long_event_item_id = String(fields.longEventItemId || '').trim();
  }
  if (fields.longEventItem !== undefined) {
    next.long_event_item = String(fields.longEventItem || '').trim();
  }
  if (fields.longEventStartDate !== undefined) {
    next.long_event_start_date = toDate(fields.longEventStartDate);
  }
  if (fields.longEventPlatform !== undefined) {
    next.long_event_platform = normalizeLongEventPlatform(fields.longEventPlatform);
  }
  return next;
}

const LONG_EVENT_ITEMS_SETTINGS_KEY = 'brem_admin_long_event_items';

async function readLongEventItemsMap(supabase) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', LONG_EVENT_ITEMS_SETTINGS_KEY)
    .maybeSingle();
  if (error) {
    return { ok: false, error: error.message || '장기근속 이벤트 매핑을 불러오지 못했습니다.' };
  }
  const map = data?.value && typeof data.value === 'object' && !Array.isArray(data.value)
    ? { ...data.value }
    : {};
  return { ok: true, map };
}

async function writeLongEventItemsMap(supabase, map) {
  const { error } = await supabase.from('settings').upsert({
    key: LONG_EVENT_ITEMS_SETTINGS_KEY,
    value: map,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) {
    return { ok: false, error: error.message || '장기근속 이벤트 매핑을 저장하지 못했습니다.' };
  }
  return { ok: true };
}

async function patchRiderLongEventFields(supabase, riderId, fields = {}) {
  const normalized = normalizeLongEventPatchFields(fields);
  if (Object.keys(normalized).length === 0) {
    return { ok: false, status: 400, error: '저장할 장기근속 이벤트 정보가 없습니다.' };
  }

  const { data: existing, error: readError } = await supabase
    .from('riders')
    .select('raw_data')
    .eq('id', riderId)
    .maybeSingle();
  if (readError) {
    return { ok: false, status: 400, error: readError.message || '기사 정보를 불러오지 못했습니다.' };
  }

  const raw = existing?.raw_data && typeof existing.raw_data === 'object'
    ? { ...existing.raw_data }
    : {};
  if (normalized.long_event_item_id !== undefined) {
    raw.longEventItemId = normalized.long_event_item_id;
    if (!normalized.long_event_item_id) {
      normalized.long_event_item = '';
      normalized.long_event_start_date = null;
      raw.longEventItem = '';
      raw.longEventStartDate = '';
    } else {
      raw.longEventItem = normalized.long_event_item || '';
    }
  }
  if (normalized.long_event_start_date !== undefined) {
    raw.longEventStartDate = normalized.long_event_start_date || '';
  }
  if (normalized.long_event_platform !== undefined) {
    raw.longEventPlatform = normalized.long_event_platform;
  }

  const updatePayload = {
    ...normalized,
    raw_data: raw,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('riders')
    .update(updatePayload)
    .eq('id', riderId)
    .select(RIDER_PATCH_RETURN_SELECT)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error)) {
      stripOptionalRiderColumns(updatePayload);
      const retry = await supabase
        .from('riders')
        .update(updatePayload)
        .eq('id', riderId)
        .select(RIDER_PATCH_RETURN_SELECT)
        .maybeSingle();
      if (retry.error) {
        return { ok: false, status: 400, error: retry.error.message || '장기근속 이벤트 저장에 실패했습니다.' };
      }
      if (normalized.long_event_item_id !== undefined) {
        const mapResult = await readLongEventItemsMap(supabase);
        if (!mapResult.ok) {
          return { ok: false, status: 500, error: mapResult.error };
        }
        const itemId = normalized.long_event_item_id;
        if (itemId) mapResult.map[riderId] = itemId;
        else delete mapResult.map[riderId];
        const writeResult = await writeLongEventItemsMap(supabase, mapResult.map);
        if (!writeResult.ok) {
          return { ok: false, status: 500, error: writeResult.error };
        }
      }
      return { ok: true, rider: retry.data };
    }
    return { ok: false, status: 400, error: error.message || '장기근속 이벤트 저장에 실패했습니다.' };
  }

  if (normalized.long_event_item_id !== undefined) {
    const mapResult = await readLongEventItemsMap(supabase);
    if (!mapResult.ok) {
      return { ok: false, status: 500, error: mapResult.error };
    }
    const itemId = normalized.long_event_item_id;
    if (itemId) mapResult.map[riderId] = itemId;
    else delete mapResult.map[riderId];
    const writeResult = await writeLongEventItemsMap(supabase, mapResult.map);
    if (!writeResult.ok) {
      return { ok: false, status: 500, error: writeResult.error };
    }
  }

  return { ok: true, rider: data };
}

async function bulkPatchRiderLongEvents(accessToken, patches = [], options = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const list = Array.isArray(patches)
    ? patches.filter(item => {
      if (!item?.id) return false;
      const normalized = normalizeLongEventPatchFields(resolvePatchFields(item));
      return Object.keys(normalized).length > 0;
    })
    : [];
  if (!list.length) {
    return { ok: true, updated: 0, failed: [] };
  }

  const maxBatch = Math.min(Math.max(Number(options.maxBatch) || 300, 1), 500);
  if (list.length > maxBatch) {
    return {
      ok: false,
      status: 400,
      error: `한 번에 최대 ${maxBatch}명까지 장기근속 이벤트를 적용할 수 있습니다.`
    };
  }

  const supabase = getServiceClient();
  const failed = [];
  let updated = 0;

  for (const patch of list) {
    const riderId = String(patch.id || '').trim();
    const result = await patchRiderLongEventFields(supabase, riderId, resolvePatchFields(patch));
    if (!result.ok) {
      failed.push({ id: riderId, error: result.error || '저장 실패' });
      continue;
    }
    updated += 1;
  }

  if (failed.length && failed.length === list.length) {
    return {
      ok: false,
      status: 400,
      error: failed[0].error || '장기근속 이벤트 일괄 저장에 실패했습니다.',
      failed,
      updated: 0
    };
  }

  return {
    ok: true,
    updated,
    failed,
    total: list.length
  };
}

async function bulkPatchRiderMissions(accessToken, patches = [], options = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const list = Array.isArray(patches)
    ? patches.filter(item => {
      if (!item?.id) return false;
      const normalized = normalizeMissionPatchFields(resolvePatchFields(item));
      return Boolean(
        normalized.selected_mission_id !== undefined
        || normalized.selected_mission_id_baemin !== undefined
        || normalized.selected_mission_id_coupang !== undefined
        || normalized.promotion_rule_id_baemin !== undefined
        || normalized.promotion_rule_id_coupang !== undefined
        || normalized.promotion_selector_baemin !== undefined
        || normalized.promotion_selector_coupang !== undefined
      );
    })
    : [];
  if (!list.length) {
    return { ok: true, updated: 0, failed: [] };
  }

  const maxBatch = Math.min(Math.max(Number(options.maxBatch) || 300, 1), 500);
  if (list.length > maxBatch) {
    return {
      ok: false,
      status: 400,
      error: `한 번에 최대 ${maxBatch}명까지 미션을 적용할 수 있습니다.`
    };
  }

  const supabase = getServiceClient();
  const failed = [];
  let updated = 0;

  for (const patch of list) {
    const riderId = String(patch.id || '').trim();
    const result = await patchRiderMissionFields(supabase, riderId, resolvePatchFields(patch));
    if (!result.ok) {
      failed.push({ id: riderId, error: result.error || '저장 실패' });
      continue;
    }
    updated += 1;
  }

  if (failed.length && failed.length === list.length) {
    return {
      ok: false,
      status: 400,
      error: failed[0].error || '미션 일괄 저장에 실패했습니다.',
      failed,
      updated: 0
    };
  }

  return {
    ok: true,
    updated,
    failed,
    total: list.length
  };
}

async function countRiders(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  const { count, error } = await supabase
    .from('riders')
    .select('id', { count: 'exact', head: true });

  if (error) {
    return { ok: false, status: 500, error: error.message || '기사 수를 확인하지 못했습니다.' };
  }

  return { ok: true, count: count ?? 0 };
}

async function deleteAllRiders(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  const before = await countRiders(accessToken);
  if (!before.ok) return before;

  const { error } = await supabase.from('riders').delete().neq('id', '');
  if (error) {
    return { ok: false, status: 400, error: error.message || '기사 전체 삭제에 실패했습니다.' };
  }

  const after = await countRiders(accessToken);
  if (!after.ok) return after;

  return {
    ok: true,
    deletedCount: before.count ?? 0,
    remainingCount: after.count ?? 0
  };
}

async function deleteRider(accessToken, riderId) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const id = String(riderId || '').trim();
  if (!id) {
    return { ok: false, status: 400, error: '기사 ID가 없습니다.' };
  }

  const supabase = getServiceClient();
  const { error } = await supabase.from('riders').delete().eq('id', id);
  if (error) {
    return { ok: false, status: 400, error: error.message || '기사 삭제에 실패했습니다.' };
  }

  return { ok: true };
}

async function mergeSelectedRiders(accessToken, riderIds = []) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const ids = [...new Set((Array.isArray(riderIds) ? riderIds : [])
    .map(id => String(id || '').trim())
    .filter(Boolean))];
  if (ids.length < 2) {
    return { ok: false, status: 400, error: '병합할 기사를 2명 이상 선택하세요.' };
  }

  const supabase = getServiceClient();
  let { data, error } = await supabase
    .from('riders')
    .select(RIDER_SELECT)
    .in('id', ids);
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabase
      .from('riders')
      .select(RIDER_SELECT_LEGACY)
      .in('id', ids));
  }
  if (error) {
    return { ok: false, status: 500, error: error.message || '선택한 기사 정보를 불러오지 못했습니다.' };
  }

  const rows = data || [];
  if (rows.length !== ids.length) {
    return { ok: false, status: 404, error: '선택한 기사 중 일부를 찾지 못했습니다.' };
  }

  const matchKeys = new Set(rows.map(row => makeDriverMatchKey(row.name, row.phone)));
  if (matchKeys.size !== 1 || ![...matchKeys][0]) {
    return { ok: false, status: 400, error: '이름과 연락처가 같은 기사만 병합할 수 있습니다.' };
  }

  return mergeRiderGroup(supabase, rows);
}

async function mergeAutoRiders(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  let rows;
  try {
    rows = await fetchAllRiders(supabase, RIDER_SELECT);
  } catch (error) {
    if (isMissingColumnError(error)) {
      rows = await fetchAllRiders(supabase, RIDER_SELECT_LEGACY);
    } else {
      return { ok: false, status: 500, error: error.message || '기사 목록을 불러오지 못했습니다.' };
    }
  }

  const groups = buildAutoMergeGroups(rows);
  if (!groups.length) {
    return {
      ok: true,
      groupsMerged: 0,
      ridersRemoved: 0,
      idRemap: {},
      details: []
    };
  }

  const idRemap = {};
  const details = [];
  let ridersRemoved = 0;

  for (const group of groups) {
    const result = await mergeRiderGroup(supabase, group.rows);
    if (!result.ok) return result;

    Object.assign(idRemap, result.idRemap || {});
    ridersRemoved += result.removedIds.length;
    details.push({
      keptId: result.keptId,
      keptName: result.keptName,
      keptPhone: result.keptPhone,
      mergedCount: result.mergedCount,
      removedIds: result.removedIds,
      reasons: group.reasons
    });
  }

  return {
    ok: true,
    groupsMerged: details.length,
    ridersRemoved,
    idRemap,
    details
  };
}

module.exports = {
  listRiders,
  getRider,
  upsertRider,
  bulkUpsertRiders,
  bulkPatchRiderMissions,
  bulkPatchRiderLongEvents,
  restoreMissionsFromRawData,
  countRiders,
  deleteAllRiders,
  deleteRider,
  mergeSelectedRiders,
  mergeAutoRiders,
  resetRiderPassword,
  // 일괄등록 보호 검증 전용 노출. 검증이 보호 로직을 따로 구현하면 실제 코드와
  // 갈라져서 검증 결과를 믿을 수 없으므로, 실제로 쓰는 함수를 그대로 내보낸다.
  // (supabase 클라이언트를 인자로 받으므로 가짜 클라이언트로 주입 검증이 가능하다)
  __test: {
    BulkRiderGuardError,
    PROTECTED_RIDER_COLUMNS,
    riderToRow,
    expandBulkFillPatches,
    preserveProtectedFieldsOnBulkUpsert,
    mergeIncomingRiderWithExisting,
    stripOptionalRiderColumns
  }
};
