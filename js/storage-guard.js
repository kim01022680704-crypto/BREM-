/**
 * BREM 운영 데이터 보존 가드
 * 패치/배포/연결 오류 시 빈 데이터로 Supabase를 덮어쓰지 않습니다.
 */
window.BremStorageGuard = (function () {
  const TABLE_PERSIST_KEYS = new Set([
    'brem_driver_management_drivers',
    'brem_admin_notices',
    'brem_admin_missions',
    'brem_admin_promotion_rules',
    'brem_rider_inquiries',
    'brem_admin_schedules',
    'brem_admin_calls',
    'brem_admin_rejection_rates',
    'brem_admin_targets'
  ]);

  /** settings 테이블 JSON 키 — 빈 값으로 덮어쓰기 금지 */
  const PROTECTED_SETTINGS_KEYS = new Set([
    'brem_admin_settlements',
    'brem_admin_settlement_unmatched',
    'brem_admin_weekly_settlements',
    'brem_admin_calls',
    'brem_admin_rejection_rates',
    'brem_admin_manual_name_mappings',
    'brem_admin_leases',
    'brem_admin_revenue',
    'brem_admin_schedules',
    'brem_admin_promotion_settings',
    'brem_admin_promotion_selector_options',
    'brem_admin_promotion_apply_results',
    'brem_admin_long_event_catalog',
    'brem_admin_long_event_items',
    'brem_admin_long_event_config',
    'brem_driver_weekly_targets',
    'brem_admin_targets'
  ]);

  const EMPTY_WRITE_ALLOW_KEYS = new Set([
    'brem_data_schema_version'
  ]);

  function isProductionMode() {
    return window.BREM_SUPABASE_CONFIG?.mode === 'production';
  }

  function isEmptyCollection(value) {
    if (value == null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
  }

  function isTablePersistKey(key) {
    const k = String(key || '');
    return TABLE_PERSIST_KEYS.has(k) || PROTECTED_SETTINGS_KEYS.has(k);
  }

  function isProtectedPersistKey(key) {
    const k = String(key || '');
    if (EMPTY_WRITE_ALLOW_KEYS.has(k)) return false;
    return k.startsWith('brem_');
  }

  function validatePersist(key, value, options = {}) {
    const allowEmpty = options.allowEmpty === true;
    const allowBulkWipe = options.allowBulkWipe === true;

    if (!key) {
      return { ok: false, message: '저장 키가 없습니다.' };
    }

    if (!allowEmpty && isProtectedPersistKey(key) && isEmptyCollection(value)) {
      return {
        ok: false,
        blocked: true,
        message: `[데이터 보호] ${key} 빈 값 저장이 차단되었습니다. 기존 Supabase 데이터를 유지합니다.`
      };
    }

    if (isProductionMode() && allowBulkWipe) {
      return {
        ok: false,
        blocked: true,
        message: '[데이터 보호] 운영 환경에서 전체 삭제/초기화 저장은 허용되지 않습니다.'
      };
    }

    return { ok: true };
  }

  function logBlocked(detail) {
    console.error('[BREM Data Guard]', detail.message || detail);
    document.dispatchEvent(new CustomEvent('brem-storage-persist-blocked', { detail }));
  }

  return {
    TABLE_PERSIST_KEYS,
    isProductionMode,
    isEmptyCollection,
    isTablePersistKey,
    isProtectedPersistKey,
    validatePersist,
    logBlocked
  };
})();
