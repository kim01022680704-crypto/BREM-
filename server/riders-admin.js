const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');
const { provisionRiderAuthAccount } = require('./rider-auth');

const RIDER_SELECT = [
  'id', 'auth_user_id', 'name', 'phone', 'resident_number', 'bank_name', 'account_holder',
  'account_number', 'baemin_id', 'platform_coupang', 'platform_baemin',
  'long_event_item_id', 'long_event_item', 'long_event_start_date', 'join_date',
  'status', 'memo', 'hidden_fields', 'promotion_selector_coupang', 'promotion_selector_baemin',
  'promotion_rule_id_coupang', 'promotion_rule_id_baemin', 'selected_mission_id', 'created_at', 'updated_at'
].join(',');

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
    selected_mission_id: String(driver.selectedMissionId || ''),
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
  let query = supabase
    .from('riders')
    .select(RIDER_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && status !== '전체') {
    query = query.eq('status', status);
  }
  if (search) {
    query = query.ilike('name', `%${search}%`);
  }

  const { data, error, count } = await query;

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
  const { error } = await supabase.from('riders').upsert(row, { onConflict: 'id' });
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

  if (readError) {
    return { ok: false, status: 500, error: readError.message || '저장된 기사를 확인하지 못했습니다.' };
  }

  return { ok: true, rider: data };
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

module.exports = {
  listRiders,
  upsertRider,
  deleteRider
};
