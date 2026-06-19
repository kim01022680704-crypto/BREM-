const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');

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
    raw_data: driver || {},
    created_at: toIso(driver.createdAt),
    updated_at: toIso(driver.updatedAt)
  };
}

async function listRiders(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('riders')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, status: 500, error: error.message || '기사 목록을 불러오지 못했습니다.' };
  }

  return { ok: true, riders: data || [] };
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

  return { ok: true, rider: row };
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
