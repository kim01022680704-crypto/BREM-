/**
 * BREM 운영 데이터 보존 가드
 * 패치/배포/연결 오류 시 빈 데이터로 Supabase를 덮어쓰지 않습니다.
 */
window.BremStorageGuard = (function () {
  const LOCAL_WRITE_BLOCK_MESSAGE = '로컬 개발환경에서는 운영 DB 저장이 차단됩니다';

  const TABLE_PERSIST_KEYS = new Set([
    'brem_driver_management_drivers',
    'brem_admin_notices',
    'brem_admin_missions',
    'brem_admin_promotion_rules',
    'brem_rider_inquiries',
    'brem_admin_schedules',
    'brem_admin_calls',
    'brem_admin_rejection_rates',
    'brem_admin_targets',
    'brem_admin_settlements',
    'brem_admin_weekly_settlements',
    'brem_admin_settlement_upload_logs',
    'brem_admin_settlement_unmatched',
    'brem_lease_vehicles',
    'brem_lease_contracts',
    'brem_lease_payments',
    'brem_lease_accidents',
    'brem_lease_maintenance',
    'brem_lease_profit_logs',
    'brem_lease_arrears',
    'brem_payroll_slip_uploads',
    'brem_payroll_slip_lines',
    'brem_payroll_notices'
  ]);

  /** settings 테이블 JSON 키 — 빈 값으로 덮어쓰기 금지 (정산·운영 테이블 데이터 제외) */
  const PROTECTED_SETTINGS_KEYS = new Set([
    'brem_admin_call_edit_logs',
    'brem_rider_view_publish',
    'brem_admin_manual_name_mappings',
    'brem_admin_leases',
    'brem_admin_revenue',
    'brem_admin_promotion_settings',
    'brem_admin_promotion_selector_options',
    'brem_admin_promotion_apply_results',
    'brem_admin_mission_defaults',
    'brem_admin_long_event_catalog',
    'brem_admin_long_event_items',
    'brem_admin_long_event_config',
    'brem_admin_accounts',
    'brem_driver_weekly_targets'
  ]);

  const EMPTY_WRITE_ALLOW_KEYS = new Set([
    'brem_data_schema_version',
    // 급여 일정산 제외 목록: 비어 있는 것이 "전원 포함"의 정상 상태이므로 빈 값 저장 허용.
    // (마지막 기사를 급여 포함으로 되돌리면 목록이 비는데, 이때 저장이 막히면 제외가 그대로 남는다.)
    'brem_payroll_daily_excluded_settlements_v1',
    // 주정산 마무리 목록: 마무리를 모두 취소하면 빈 배열이 정상이다.
    'brem_payroll_week_finalized_v1',
    // 일정산 차단: 마지막 1명을 해제하면 빈 배열이 정상이다.
    'brem_payroll_daily_settlement_blocked_v1',
    // 금액 홀딩: 마지막 홀딩을 해제하면 빈 배열이 정상이다.
    'brem_payroll_daily_settlement_holds_v1'
  ]);

  function isProductionMode() {
    return window.BREM_SUPABASE_CONFIG?.mode === 'production';
  }

  function isLocalReadOnlySupabase() {
    const config = window.BREM_SUPABASE_CONFIG || {};
    return config.productionSupabaseForbidden === true
      || config.writeBlocked === true
      || config.supabaseReadOnly === true
      || (config.mode !== 'production' && config.backend === 'local');
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
    const deletedRowIds = Array.isArray(options.deletedRowIds) ? options.deletedRowIds : [];
    const intentionalDelete = deletedRowIds.length > 0 || options.deleteOnly === true;

    if (!key) {
      return { ok: false, message: '저장 키가 없습니다.' };
    }

    if (isLocalReadOnlySupabase() && isProtectedPersistKey(key)) {
      return {
        ok: false,
        blocked: true,
        message: LOCAL_WRITE_BLOCK_MESSAGE
      };
    }

    if (!allowEmpty && !intentionalDelete && isProtectedPersistKey(key) && isEmptyCollection(value)) {
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
    LOCAL_WRITE_BLOCK_MESSAGE,
    isProductionMode,
    isLocalReadOnlySupabase,
    isEmptyCollection,
    isTablePersistKey,
    isProtectedPersistKey,
    validatePersist,
    logBlocked
  };
})();
