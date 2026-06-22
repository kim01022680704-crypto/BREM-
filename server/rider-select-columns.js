/** Shared rider column lists — keep client adapter variants aligned manually. */

const RIDER_LIST_SELECT = [
  'id', 'name', 'phone', 'baemin_id', 'platform_coupang', 'platform_baemin',
  'status', 'join_date', 'long_event_item', 'long_event_item_id', 'long_event_start_date',
  'memo', 'raw_data', 'created_at', 'updated_at'
].join(',');

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

const RIDER_ME_SELECT_WITH_PLATFORM = `${RIDER_SELECT_WITH_PLATFORM},raw_data`;
const RIDER_ME_SELECT_BASE = `${RIDER_SELECT_BASE},raw_data`;
const RIDER_ME_SELECT = `${RIDER_SELECT},raw_data`;
const RIDER_ME_SELECT_VARIANTS = [RIDER_ME_SELECT, RIDER_ME_SELECT_WITH_PLATFORM, RIDER_ME_SELECT_BASE];

const RIDER_PATCH_RETURN_SELECT = [
  RIDER_SELECT,
  'raw_data'
].join(',');

const RIDER_LOGIN_LOOKUP_SELECT = [
  'id', 'auth_user_id', 'name', 'phone', 'resident_number', 'raw_data', 'created_at'
].join(',');

const RIDER_SELECT_VARIANTS = [RIDER_SELECT, RIDER_SELECT_WITH_PLATFORM, RIDER_SELECT_BASE];
const RIDER_LIST_SELECT_VARIANTS = [RIDER_LIST_SELECT, RIDER_SELECT_WITH_PLATFORM, RIDER_SELECT_BASE];

function isMissingColumnError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('does not exist') || message.includes('column');
}

async function queryRidersWithSelectFallback(variants, runQuery) {
  let lastResult = null;
  for (const selectColumns of variants) {
    lastResult = await runQuery(selectColumns);
    if (!lastResult?.error) {
      return { ...lastResult, selectColumns };
    }
    if (!isMissingColumnError(lastResult.error)) break;
  }
  return lastResult || { error: new Error('기사 정보를 불러오지 못했습니다.') };
}

module.exports = {
  RIDER_LIST_SELECT,
  RIDER_SELECT_BASE,
  RIDER_SELECT_WITH_PLATFORM,
  RIDER_SELECT,
  RIDER_ME_SELECT,
  RIDER_ME_SELECT_VARIANTS,
  RIDER_PATCH_RETURN_SELECT,
  RIDER_LOGIN_LOOKUP_SELECT,
  RIDER_SELECT_VARIANTS,
  RIDER_LIST_SELECT_VARIANTS,
  isMissingColumnError,
  queryRidersWithSelectFallback
};
