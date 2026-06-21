const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');
const { provisionRiderAuthAccount } = require('./rider-auth');
const { mergeDuplicateRiders: runMergeDuplicateRiders } = require('./rider-merge');

const RIDER_SELECT = [
  'id', 'auth_user_id', 'name', 'phone', 'resident_number', 'bank_name', 'account_holder',
  'account_number', 'baemin_id', 'platform_coupang', 'platform_baemin',
  'long_event_item_id', 'long_event_item', 'long_event_start_date', 'join_date',
  'status', 'memo', 'hidden_fields', 'promotion_selector_coupang', 'promotion_selector_baemin',
  'promotion_rule_id_coupang', 'promotion_rule_id_baemin',
  'selected_mission_id', 'selected_mission_id_baemin', 'selected_mission_id_coupang',
  'created_at', 'updated_at'
].join(',');

const RIDER_SELECT_LEGACY = [
  'id', 'auth_user_id', 'name', 'phone', 'resident_number', 'bank_name', 'account_holder',
  'account_number', 'baemin_id', 'platform_coupang', 'platform_baemin',
  'long_event_item_id', 'long_event_item', 'long_event_start_date', 'join_date',
  'status', 'memo', 'hidden_fields', 'promotion_selector_coupang', 'promotion_selector_baemin',
  'promotion_rule_id_coupang', 'promotion_rule_id_baemin',
  'created_at', 'updated_at'
].join(',');

function isMissingColumnError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('does not exist') || message.includes('column');
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

function riderToRow(driver) {
  return {
    id: String(driver.id || ''),
    auth_user_id: driver.authUserId || null,
    name: String(driver.name || ''),
    phone: String(driver.phone || ''),
    resident_number: String(driver.residentNumber || ''),
    bank_name: String(driver.bankName || ''),
    account_holder: String(driver.accountHolder || ''),
    account_number: String(driver.accountNumber || ''),
    baemin_id: String(driver.baeminId || ''),
    platform_coupang: driver.platformCoupang !== false,
    platform_baemin: Boolean(driver.platformBaemin),
    long_event_item_id: String(driver.longEventItemId || ''),
    long_event_item: String(driver.longEventItem || ''),
    long_event_start_date: toDate(driver.longEventStartDate),
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

  let { data, error, count } = await runQuery(RIDER_SELECT);
  if (error && isMissingColumnError(error)) {
    ({ data, error, count } = await runQuery(RIDER_SELECT_LEGACY));
  }

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
  let { error } = await supabase.from('riders').upsert(row, { onConflict: 'id' });
  if (error && isMissingColumnError(error)) {
    delete row.selected_mission_id;
    delete row.selected_mission_id_baemin;
    delete row.selected_mission_id_coupang;
    ({ error } = await supabase.from('riders').upsert(row, { onConflict: 'id' }));
  }
  if (error) {
    return { ok: false, status: 400, error: error.message || '기사 저장에 실패했습니다.' };
  }

  const provision = await provisionRiderAuthAccount(row);
  if (!provision.ok) {
    console.warn('[BREM] Rider auth provisioning failed:', provision.error);
  }

  const { data, error: readError } = await supabase
    .from('riders')
    .select(RIDER_SELECT)
    .eq('id', row.id)
    .maybeSingle();

  let saved = data;
  if (readError && isMissingColumnError(readError)) {
    const legacyRead = await supabase
      .from('riders')
      .select(RIDER_SELECT_LEGACY)
      .eq('id', row.id)
      .maybeSingle();
    if (legacyRead.error) {
      return { ok: false, status: 500, error: legacyRead.error.message || '저장된 기사를 확인하지 못했습니다.' };
    }
    saved = legacyRead.data;
  } else if (readError) {
    return { ok: false, status: 500, error: readError.message || '저장된 기사를 확인하지 못했습니다.' };
  }

  return { ok: true, rider: saved };
}

async function bulkUpsertRiders(accessToken, riders, options = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const list = Array.isArray(riders) ? riders.filter(Boolean) : [];
  if (!list.length) {
    return { ok: true, succeeded: 0, failed: [], total: 0 };
  }

  const maxBatch = Math.min(Math.max(Number(options.maxBatch) || 300, 1), 500);
  if (list.length > maxBatch) {
    return {
      ok: false,
      status: 400,
      error: `한 번에 최대 ${maxBatch}명까지 처리할 수 있습니다.`
    };
  }

  const supabase = getServiceClient();
  const rows = list.map(rider => riderToRow(rider));
  let { error } = await supabase.from('riders').upsert(rows, { onConflict: 'id' });
  if (error && isMissingColumnError(error)) {
    rows.forEach(row => {
      delete row.selected_mission_id;
      delete row.selected_mission_id_baemin;
      delete row.selected_mission_id_coupang;
    });
    ({ error } = await supabase.from('riders').upsert(rows, { onConflict: 'id' }));
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
    total: list.length
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

async function mergeDuplicateRiders(accessToken, options = {}) {
  return runMergeDuplicateRiders(accessToken, options, {
    verifyAdminCaller,
    getServiceClient,
    riderToRow,
    provisionRiderAuthAccount,
    selectColumns: RIDER_SELECT
  });
}

module.exports = {
  listRiders,
  upsertRider,
  bulkUpsertRiders,
  deleteRider,
  mergeDuplicateRiders
};
