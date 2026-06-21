const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');
const { provisionRiderAuthAccount } = require('./rider-auth');

const RIDER_SELECT_BASE = [
  'id', 'auth_user_id', 'name', 'phone', 'resident_number', 'bank_name', 'account_holder',
  'account_number', 'baemin_id', 'platform_coupang', 'platform_baemin',
  'long_event_item_id', 'long_event_item', 'long_event_start_date', 'join_date',
  'status', 'memo', 'hidden_fields', 'promotion_selector_coupang', 'promotion_selector_baemin',
  'promotion_rule_id_coupang', 'promotion_rule_id_baemin',
  'created_at', 'updated_at'
].join(',');

const RIDER_SELECT_WITH_PLATFORM = [
  'id', 'auth_user_id', 'name', 'phone', 'resident_number', 'bank_name', 'account_holder',
  'account_number', 'baemin_id', 'platform_coupang', 'platform_baemin',
  'long_event_item_id', 'long_event_item', 'long_event_start_date', 'long_event_platform', 'join_date',
  'status', 'memo', 'hidden_fields', 'promotion_selector_coupang', 'promotion_selector_baemin',
  'promotion_rule_id_coupang', 'promotion_rule_id_baemin',
  'created_at', 'updated_at'
].join(',');

const RIDER_SELECT = [
  'id', 'auth_user_id', 'name', 'phone', 'resident_number', 'bank_name', 'account_holder',
  'account_number', 'baemin_id', 'platform_coupang', 'platform_baemin',
  'long_event_item_id', 'long_event_item', 'long_event_start_date', 'long_event_platform', 'join_date',
  'status', 'memo', 'hidden_fields', 'promotion_selector_coupang', 'promotion_selector_baemin',
  'promotion_rule_id_coupang', 'promotion_rule_id_baemin',
  'selected_mission_id', 'selected_mission_id_baemin', 'selected_mission_id_coupang',
  'created_at', 'updated_at'
].join(',');

const RIDER_SELECT_VARIANTS = [RIDER_SELECT, RIDER_SELECT_WITH_PLATFORM, RIDER_SELECT_BASE];

/** @deprecated use RIDER_SELECT_WITH_PLATFORM */
const RIDER_SELECT_LEGACY = RIDER_SELECT_WITH_PLATFORM;

function isMissingColumnError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('does not exist') || message.includes('column');
}

async function queryRidersWithSelectFallback(runQuery) {
  let lastResult = null;
  for (const selectColumns of RIDER_SELECT_VARIANTS) {
    lastResult = await runQuery(selectColumns);
    if (!lastResult?.error) {
      return { ...lastResult, selectColumns };
    }
    if (!isMissingColumnError(lastResult.error)) break;
  }
  return lastResult || { error: new Error('기사 목록을 불러오지 못했습니다.') };
}

function stripOptionalRiderColumns(row) {
  delete row.selected_mission_id;
  delete row.selected_mission_id_baemin;
  delete row.selected_mission_id_coupang;
  delete row.long_event_platform;
}

async function upsertRiderRowWithFallback(supabase, row) {
  let payload = { ...row };
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
  return String(value || '').trim().toLowerCase() === 'baemin' ? 'baemin' : 'coupang';
}

function makeDriverMatchKey(name, phone) {
  const normName = normalizeDriverName(name);
  const normPhone = normalizePhone(phone);
  if (!normName || !normPhone) return '';
  return `${normName}|${normPhone}`;
}

function makeCoupangLoginId(row) {
  const normName = normalizeDriverName(row?.name);
  const phoneSuffix = normalizePhone(row?.phone).slice(-4);
  if (!normName || !phoneSuffix) return '';
  return `${normName}${phoneSuffix}`;
}

function makeAutoMergeKeys(row) {
  const keys = [];
  const normName = normalizeDriverName(row?.name);
  const coupangId = makeCoupangLoginId(row);
  const baeminId = String(row?.baemin_id || '').trim().toLowerCase();

  if (normName && coupangId) keys.push(`coupang:${normName}|${coupangId}`);
  if (baeminId && baeminId !== '-') keys.push(`baemin:${baeminId}`);
  return keys;
}

function riderCompletenessScore(row) {
  let score = 0;
  if (row.auth_user_id) score += 16;
  if (String(row.long_event_item || '').trim()) score += 8;
  if (String(row.baemin_id || '').trim()) score += 4;
  if (String(row.bank_name || '').trim()) score += 2;
  if (String(row.account_number || '').trim()) score += 1;
  const updatedAt = Date.parse(row.updated_at || row.created_at || 0);
  if (!Number.isNaN(updatedAt)) score += updatedAt / 1e12;
  return score;
}

function pickCanonicalRider(rows) {
  return [...rows].sort((a, b) => {
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
    ({ data, error, count, selectColumns: activeSelect } = await queryRidersWithSelectFallback(async columns => {
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
    makeAutoMergeKeys(row).forEach(key => {
      if (!keyMembers.has(key)) keyMembers.set(key, []);
      keyMembers.get(key).push(id);
      if (!keyOwners.has(key)) {
        keyOwners.set(key, id);
      } else {
        union(keyOwners.get(key), id);
      }
    });
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
  return {
    id: String(driver.id || ''),
    auth_user_id: driver.authUserId || null,
    name: normalizeRiderName(driver.name),
    phone: formatPhoneForStorage(driver.phone),
    resident_number: String(driver.residentNumber || ''),
    bank_name: String(driver.bankName || '').trim(),
    account_holder: String(driver.accountHolder || '').trim(),
    account_number: String(driver.accountNumber || '').trim(),
    baemin_id: normalizePlatformId(driver.baeminId),
    platform_coupang: driver.platformCoupang !== false,
    platform_baemin: Boolean(driver.platformBaemin),
    long_event_item_id: String(driver.longEventItemId || ''),
    long_event_item: String(driver.longEventItem || ''),
    long_event_start_date: toDate(driver.longEventStartDate),
    long_event_platform: normalizeLongEventPlatform(driver.longEventPlatform),
    join_date: toDate(driver.joinDate),
    status: String(driver.status || '근무중'),
    memo: String(driver.memo || ''),
    hidden_fields: driver.hiddenFields || {},
    promotion_selector_coupang: String(driver.promotionSelectorCoupang || ''),
    promotion_selector_baemin: String(driver.promotionSelectorBaemin || ''),
    promotion_rule_id_coupang: String(driver.promotionRuleIdCoupang || ''),
    promotion_rule_id_baemin: String(driver.promotionRuleIdBaemin || ''),
    selected_mission_id: String(driver.selectedMissionId || driver.selectedMissionIdBaemin || driver.selectedMissionIdCoupang || ''),
    selected_mission_id_baemin: String(driver.selectedMissionIdBaemin || driver.selectedMissionId || ''),
    selected_mission_id_coupang: String(driver.selectedMissionIdCoupang || driver.selectedMissionId || ''),
    raw_data: driver || {},
    created_at: toIso(driver.createdAt),
    updated_at: toIso(driver.updatedAt)
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

  const { data, error, count } = await queryRidersWithSelectFallback(columns => runQuery(columns));

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

async function upsertRider(accessToken, rider) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const row = riderToRow(rider);
  if (!row.id) {
    return { ok: false, status: 400, error: '기사 ID가 없습니다.' };
  }

  const supabase = getServiceClient();
  const { error } = await upsertRiderRowWithFallback(supabase, row);
  if (error) {
    return { ok: false, status: 400, error: error.message || '기사 저장에 실패했습니다.' };
  }

  const provision = await provisionRiderAuthAccount(row);
  if (!provision.ok) {
    console.warn('[BREM] Rider auth provisioning failed:', provision.error);
  }

  const { data, error: readError } = await queryRidersWithSelectFallback(columns =>
    supabase.from('riders').select(columns).eq('id', row.id).maybeSingle()
  );

  if (readError) {
    return { ok: false, status: 500, error: readError.message || '저장된 기사를 확인하지 못했습니다.' };
  }

  return { ok: true, rider: data };
}

function buildExistingRiderMatchMap(rows) {
  const map = new Map();
  (rows || []).forEach(row => {
    const key = makeDriverMatchKey(row.name, row.phone);
    if (key && !map.has(key)) map.set(key, row);
  });
  return map;
}

function mergeIncomingRiderWithExisting(incoming, existingRow) {
  const merged = { ...incoming };
  merged.id = existingRow.id;
  if (existingRow.auth_user_id) merged.authUserId = existingRow.auth_user_id;

  const incomingBaemin = normalizePlatformId(incoming.baeminId);
  const existingBaemin = normalizePlatformId(existingRow.baemin_id);
  merged.baeminId = incomingBaemin || existingBaemin;

  merged.platformBaemin = Boolean(incoming.platformBaemin || existingRow.platform_baemin || merged.baeminId);
  merged.platformCoupang = incoming.platformCoupang !== false && existingRow.platform_coupang !== false;

  return merged;
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
  const { resolved, updated } = await resolveBulkRidersForUpsert(supabase, list);
  const rows = resolved.map(rider => riderToRow(rider));
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
    for (const row of rows) {
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
  upsertRider,
  bulkUpsertRiders,
  countRiders,
  deleteAllRiders,
  deleteRider,
  mergeSelectedRiders,
  mergeAutoRiders
};
