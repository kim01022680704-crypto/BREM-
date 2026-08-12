/**
 * BREM 데이터 저장소 — Supabase 전용
 * 로그인 세션: sessionStorage only (탭/창 종료 시 소멸, 새로고침 시 유지)
 * 비활성 자동 로그아웃: session-security.js (관리자 3시간, 기사 30분)
 */
const BremStorage = (function () {
  const KEYS = Object.freeze({
    drivers: 'brem_driver_management_drivers',
    calls: 'brem_admin_calls',
    rejections: 'brem_admin_rejection_rates',
    targets: 'brem_admin_targets',
    weeklyTargets: 'brem_driver_weekly_targets',
    notices: 'brem_admin_notices',
    missions: 'brem_admin_missions',
    riderInquiries: 'brem_rider_inquiries',
    adminSchedules: 'brem_admin_schedules',
    payrollSlipUploads: 'brem_payroll_slip_uploads',
    payrollSlipLines: 'brem_payroll_slip_lines',
    payrollNotices: 'brem_payroll_notices',
    payrollRiderPublish: 'brem_payroll_rider_publish',
    leases: 'brem_admin_leases',
    leaseVehicles: 'brem_lease_vehicles',
    leaseContracts: 'brem_lease_contracts',
    leasePayments: 'brem_lease_payments',
    leaseAccidents: 'brem_lease_accidents',
    leaseMaintenance: 'brem_lease_maintenance',
    leaseProfitLogs: 'brem_lease_profit_logs',
    leaseArrears: 'brem_lease_arrears',
    revenue: 'brem_admin_revenue',
    eventCatalog: 'brem_admin_long_event_catalog',
    eventItems: 'brem_admin_long_event_items',
    eventConfig: 'brem_admin_long_event_config',
    legacyBikes: 'brem_admin_driver_bikes',
    legacyMission: 'brem_admin_mission_config',
    settlements: 'brem_admin_settlements',
    settlementUnmatched: 'brem_admin_settlement_unmatched',
    settlementUploadLogs: 'brem_admin_settlement_upload_logs',
    settlementUnmatchedDirect: 'brem_admin_settlement_unmatched_direct',
    settlementUploadLogsDirect: 'brem_admin_settlement_upload_logs_direct',
    callEditLogs: 'brem_admin_call_edit_logs',
    riderViewPublish: 'brem_rider_view_publish',
    promotionRules: 'brem_admin_promotion_rules',
    promotionSettings: 'brem_admin_promotion_settings',
    promotionSelectorOptions: 'brem_admin_promotion_selector_options',
    weeklySettlements: 'brem_admin_weekly_settlements',
    weeklySettlementsDirect: 'brem_admin_weekly_settlements_direct',
    directOtherPayments: 'brem_admin_direct_other_payments',
    directBremPromotions: 'brem_admin_direct_brem_promotions',
    directSettlementAdjustments: 'brem_admin_direct_settlement_adjustments_v1',
    directRetroAdjustments: 'brem_admin_direct_retro_adjustments_v1',
    leaseLoans: 'brem_lease_loans_v1',
    deductionLedger: 'brem_deduction_ledger_v1',
    manualNameMappings: 'brem_admin_manual_name_mappings',
    promotionApplyResults: 'brem_admin_promotion_apply_results',
    missionDefaults: 'brem_admin_mission_defaults',
    dashboardWeekBasis: 'brem_admin_dashboard_week_basis',
    leaseDashboardWeekBasis: 'brem_lease_dashboard_week_basis',
    leaseVehicleModelTypes: 'brem_lease_vehicle_model_types',
    payrollDailySettlementRoster: 'brem_payroll_daily_settlement_roster_v1',
    payrollDailySettlementRegions: 'brem_payroll_daily_settlement_regions_v1',
    payrollDailySettlementFees: 'brem_payroll_daily_settlement_fees_v1',
    payrollWithdrawalRequests: 'brem_payroll_withdrawal_requests_v1',
    payrollDailyExcludedSettlements: 'brem_payroll_daily_excluded_settlements_v1',
    payrollWeekFinalized: 'brem_payroll_week_finalized_v1',
    payrollWithdrawalPaused: 'brem_payroll_withdrawal_paused_v1',
    preservedUnknown: 'brem_preserved_unknown_storage',
    adminAccounts: 'brem_admin_accounts',
    adminCredentials: 'brem_admin_credentials',
    driverOrgChart: 'brem_admin_driver_org_chart_v1'
  });

  const SCHEMA = Object.freeze({
    versionKey: 'brem_data_schema_version',
    currentVersion: 2,
    backupFormat: 'brem-backup',
    backupFormatVersion: 1
  });

  const SESSION_KEYS = {
    adminLoggedIn: 'brem_admin_logged_in',
    adminAccountId: 'brem_admin_account_id',
    adminSessionMenus: 'brem_admin_session_menus',
    adminSessionEditableMenus: 'brem_admin_session_editable_menus',
    adminSessionRole: 'brem_admin_session_role',
    adminSessionName: 'brem_admin_session_name',
    driverId: 'brem_driver_logged_in_id'
  };


  let lastSupabaseError = '';
  let activeSupabaseClient = null;
  let activeSupabaseProfile = null;

  const DEFAULT_PLATFORM = 'coupang';

  function normalizePlatform(value) {
    if (typeof BremPlatforms !== 'undefined') return BremPlatforms.normalize(value);
    if (value === 'combined') return 'combined';
    return value === 'baemin' ? 'baemin' : 'coupang';
  }

  function parseDriverDayRecordId(id) {
    const match = String(id || '').trim().match(/^(.+)-(\d{4}-\d{2}-\d{2})-([^-]+)$/);
    if (!match) return null;
    return {
      driverId: match[1],
      periodKey: match[2],
      platform: normalizePlatform(match[3])
    };
  }

  function normalizeLongEventPlatform(value) {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'baemin') return 'baemin';
    if (v === 'both' || v === 'combined' || v === 'all') return 'both';
    return 'coupang';
  }

  function longEventPlatformLabel(platform) {
    const v = normalizeLongEventPlatform(platform);
    if (v === 'baemin') return '배민';
    if (v === 'both') return '쿠팡+배민';
    return '쿠팡';
  }

  function normalizeCalls(list) {
    if (!Array.isArray(list) || !list.length) return [];

    let migrated = false;
    const normalized = list.map(call => {
      const platform = normalizePlatform(call.platform);
      const next = {
        ...call,
        platform,
        id: `${call.driverId}-${call.date}-${platform}`
      };
      if (call.platform !== platform || call.id !== next.id) migrated = true;
      return next;
    });

    const deduped = dedupeRecordsById(normalized, item => item.id);
    if (migrated || deduped.length !== normalized.length) {
      if (deduped.length !== normalized.length) migrated = true;
      storageAdapter.write(KEYS.calls, deduped);
    }
    return deduped;
  }

  function dedupeRecordsById(list, getId) {
    const byId = new Map();
    (list || []).forEach(item => {
      const id = String(getId(item) || '').trim();
      if (id) byId.set(id, item);
    });
    return [...byId.values()];
  }

  function normalizeSettlements(list) {
    if (!Array.isArray(list) || !list.length) return [];

    let migrated = false;
    const normalized = list.map(item => {
      const platform = normalizePlatform(item.platform);
      const period = String(item.period || '').slice(0, 10);
      const next = {
        ...item,
        platform,
        period,
        riderId: item.riderId || '',
        deliveryAmount: Number(item.deliveryAmount ?? item.settlementAmount ?? 0),
        hourlyInsurance: Math.abs(Number(item.hourlyInsurance || 0)),
        id: `${item.driverId}-${period}-${platform}`
      };
      if (item.platform !== platform || item.id !== next.id || item.period !== period) migrated = true;
      return next;
    });

    const deduped = dedupeRecordsById(normalized, item => item.id);
    if (migrated || deduped.length !== normalized.length) {
      if (deduped.length !== normalized.length) migrated = true;
      storageAdapter.write(KEYS.settlements, deduped);
    }
    return deduped;
  }

  function normalizeSettlementUnmatched(list) {
    if (!Array.isArray(list) || !list.length) return [];

    let migrated = false;
    const normalized = list.map(item => {
      const platform = normalizePlatform(item.platform);
      const periodKey = String(item.period || item.startDate || '').slice(0, 10);
      const kind = item.kind === 'weekly' ? 'weekly' : 'daily';
      const weekStart = String(
        item.weekStart || (periodKey ? weekStartKeyFromDate(periodKey) : '')
      ).slice(0, 10);
      const channel = (item.channel === 'direct' || item.matchPayload?.channel === 'direct') ? 'direct' : 'bro';
      const channelTag = channel === 'direct' ? '-direct' : '';
      const nameKey = String(item.rawName || item.name || item.originalName || item.riderName || '').replace(/\s/g, '');
      const idKey = kind === 'weekly'
        ? String(item.coupangLoginKey || item.baeminUserId || nameKey)
        : nameKey;
      const defaultId = kind === 'weekly'
        ? `${weekStart}-weekly-${platform}${channelTag}-${idKey}`
        : `${periodKey}-${platform}-${nameKey}`;
      const next = {
        ...item,
        platform,
        kind,
        channel,
        weekStart,
        endDate: String(item.endDate || '').slice(0, 10),
        id: String(item.id || defaultId),
        orderCount: Number(item.orderCount ?? item.weeklyOrderCount ?? item.callCount ?? 0),
        coupangLoginKey: String(item.coupangLoginKey || item.matchPayload?.coupangLoginKey || '').trim(),
        baeminUserId: String(item.baeminUserId || item.matchPayload?.baeminUserId || '').trim()
      };
      if (
        item.platform !== platform
        || item.kind !== kind
        || item.weekStart !== weekStart
        || item.id !== next.id
      ) migrated = true;
      return next;
    });

    if (migrated) storageAdapter.write(KEYS.settlementUnmatched, normalized);
    return normalized;
  }

  function migrateRejectionsPlatform(list) {
    if (!Array.isArray(list) || !list.length) return [];

    let migrated = false;
    const normalized = list.map(item => {
      const platform = normalizePlatform(item.platform);
      const next = {
        ...item,
        platform,
        id: `${item.driverId}-${item.weekStart}-${platform}`
      };
      if (item.platform !== platform || item.id !== next.id) migrated = true;
      return next;
    });

    if (migrated) storageAdapter.write(KEYS.rejections, normalized);
    return normalized;
  }

  const unavailableStorageAdapter = {
    type: 'unavailable',
    read(key, fallback) {
      return fallback;
    },
    readRaw() {
      return { exists: false, value: null };
    },
    write() {
      throw new Error('Supabase 연결 후에만 저장할 수 있습니다.');
    },
    remove() {
      throw new Error('Supabase 연결 후에만 삭제할 수 있습니다.');
    },
    has() {
      return false;
    },
    listBremKeys() {
      return [];
    }
  };

  function readLocalDevJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeLocalDevJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    window.BremDataCache?.set?.(key, value, { source: 'local' });
  }

  const localDevStorageAdapter = {
    type: 'local',
    isHydrated() {
      return true;
    },
    isKeyLoaded(key) {
      return localStorage.getItem(key) != null;
    },
    read(key, fallback) {
      return readLocalDevJson(key, fallback);
    },
    readRaw(key) {
      const raw = localStorage.getItem(key);
      if (raw == null) return { exists: false, value: null };
      try {
        return { exists: true, value: JSON.parse(raw) };
      } catch {
        return { exists: true, value: null };
      }
    },
    write(key, value) {
      writeLocalDevJson(key, value);
      return Promise.resolve({ ok: true, localOnly: true });
    },
    remove(key) {
      localStorage.removeItem(key);
      window.BremDataCache?.invalidate?.(key);
      return Promise.resolve({ ok: true, localOnly: true });
    },
    has(key) {
      return localStorage.getItem(key) != null;
    },
    listBremKeys() {
      const keys = [];
      try {
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (key && key.startsWith('brem_')) keys.push(key);
        }
      } catch {
        /* ignore */
      }
      return keys;
    },
    stage(key, value) {
      writeLocalDevJson(key, value);
    }
  };

  let activeStorageAdapter = unavailableStorageAdapter;

  let productionAdminAccountsCache = null;
  let productionAdminSessionAccount = null;
  let supabaseInitPromise = null;
  let storageBootstrapPromise = null;
  let cachedAdminAccessToken = '';
  let supabaseAuthListenerBound = false;
  let syncAdminAccountsPromise = null;
  let driversSyncPromise = null;
  let driversFetchAllPromise = null;
  let driversLoadMeta = { complete: false, supabaseTotal: 0 };
  let dataMigrationsCompleted = false;
  let normalizedDriversCache = null;
  let normalizedDriversSourceRef = null;
  let normalizedCallsCache = null;
  let normalizedCallsSourceRef = null;
  let normalizedRejectionsCache = null;
  let normalizedRejectionsSourceRef = null;
  let rejectionsWeekIndex = null;
  let rejectionsWeekIndexRef = null;

  let adminDataHydratePromise = null;
  let ensureHydratedPromise = null;
  let bootstrapLoadPromise = null;
  let bootstrapComplete = false;
  let heavyDataPreloadPromise = null;
  let driversFullFetchInProgress = false;
  let driversBackgroundFetchPromise = null;
  const sectionLoadPromises = new Map();
  const RIDER_PUBLISH_STATUS_CACHE_MS = 90000;
  let lastRiderPublishStatusAt = 0;
  let lastRiderPublishStatusResult = null;

  const MUTATION_TRACKED_KEYS = new Set([
    KEYS.drivers,
    KEYS.notices,
    KEYS.missions,
    KEYS.promotionRules,
    KEYS.riderInquiries,
    KEYS.leases,
    KEYS.leaseVehicles,
    KEYS.leaseContracts,
    KEYS.leasePayments,
    KEYS.leaseAccidents,
    KEYS.leaseMaintenance,
    KEYS.leaseProfitLogs,
    KEYS.leaseArrears,
    KEYS.revenue,
    KEYS.adminSchedules,
    KEYS.payrollSlipUploads,
    KEYS.payrollSlipLines,
    KEYS.payrollNotices,
    KEYS.calls,
    KEYS.rejections,
    KEYS.targets,
    KEYS.weeklyTargets,
    KEYS.settlements,
    KEYS.settlementUnmatched,
    KEYS.settlementUploadLogs,
    KEYS.weeklySettlements,
    KEYS.promotionSettings,
    KEYS.promotionSelectorOptions,
    KEYS.promotionApplyResults,
    KEYS.missionDefaults,
    KEYS.manualNameMappings,
    KEYS.eventCatalog,
    KEYS.eventItems,
    KEYS.eventConfig
  ]);

  function logDataSource(label, cached, detail = '') {
    window.BremDataCache?.logDataSource?.(label, cached, detail);
  }

  function isBootstrapComplete() {
    return bootstrapComplete;
  }

  function resetBootstrapState() {
    bootstrapComplete = false;
    bootstrapLoadPromise = null;
  }

  function dispatchStorageReadyOnce(detail) {
    if (dispatchStorageReadyOnce.done) return;
    dispatchStorageReadyOnce.done = true;
    document.dispatchEvent(new CustomEvent('brem-storage-ready', { detail }));
  }

  function isProductionMode() {
    return getSupabaseConfig().mode === 'production';
  }

  function enforceProductionStorageGuard() {
    /* Supabase adapter는 운영·로컬 모두 유지. 로컬 DB 쓰기 차단은 storage-guard / read-only persist에서 처리 */
  }

  document.addEventListener('brem-config-ready', enforceProductionStorageGuard);

  // config 로드 직후에도 운영 모드 가드 적용
  if (window.BREM_SUPABASE_CONFIG?.mode === 'production') {
    enforceProductionStorageGuard();
  }

  function isStoragePersistReady() {
    if (activeStorageAdapter.type !== 'supabase') return false;
    if (!activeStorageAdapter.isHydrated?.()) return false;
    return Boolean(activeSupabaseProfile?.active && activeSupabaseProfile.role === 'admin');
  }

  function assertPersistAllowed(key, value, options = {}) {
    const guard = window.BremStorageGuard;
    if (!guard) return true;
    const result = guard.validatePersist(key, value, options);
    if (!result.ok) {
      guard.logBlocked(result);
      throw new Error(result.message || '데이터 저장이 보호 정책에 의해 차단되었습니다.');
    }
    return true;
  }

  function flushStagedSupabaseWrites() {
    if (isLocalDevBackend()) return;
    if (activeStorageAdapter.type !== 'supabase' || !activeStorageAdapter.enqueuePersist) return;
    const guard = window.BremStorageGuard;
    const productionServerKeys = new Set([KEYS.drivers, KEYS.missions]);
    const persistKeys = [
      KEYS.drivers,
      KEYS.notices,
      KEYS.missions,
      KEYS.promotionRules,
      KEYS.riderInquiries,
      KEYS.leaseVehicles,
      KEYS.leaseContracts,
      KEYS.leasePayments,
      KEYS.leaseAccidents,
      KEYS.leaseMaintenance,
      KEYS.leaseProfitLogs,
      KEYS.leaseArrears
    ];
    if (!isProductionMode()) {
      /* 관리자 레지스트리는 서버 API만 저장 — 브라우저에서 Supabase settings 덮어쓰기 금지 */
    }
    persistKeys.forEach(key => {
      if (isProductionMode() && productionServerKeys.has(key)) return;
      if (!activeStorageAdapter.has(key)) return;
      if (activeStorageAdapter.isKeyLoaded && !activeStorageAdapter.isKeyLoaded(key)) return;
      const value = activeStorageAdapter.read(key);
      if (guard?.isEmptyCollection?.(value)) return;
      try {
        assertPersistAllowed(key, value);
      } catch {
        return;
      }
      activeStorageAdapter.enqueuePersist(key, value);
    });
  }

  function writeLocalSessionCache(key, value) {
    if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.stage) {
      activeStorageAdapter.stage(key, value);
    }
    window.BremDataCache?.set?.(key, value, { source: 'local-session' });
    return Promise.resolve({ ok: true, localOnly: true });
  }

  const storageAdapter = {
    read(key, fallback) {
      return activeStorageAdapter.read(key, fallback);
    },
    readRaw(key) {
      return activeStorageAdapter.readRaw(key);
    },
    write(key, value, options = {}) {
      if (isLocalDevBackend()) {
        if (activeStorageAdapter.type === 'local') {
          return activeStorageAdapter.write(key, value);
        }
        if (isPayrollStorageKey(key) && isPayrollLocalStorageMode()) {
          return writePayrollLocalCollection(key, Array.isArray(value) ? value : []);
        }
        if (key === KEYS.adminAccounts) {
          const accounts = Array.isArray(value?.accounts)
            ? value.accounts
            : (Array.isArray(value) ? value : []);
          const normalized = accounts.map((account, index) => normalizeAdminAccount(account, index));
          productionAdminAccountsCache = normalized;
          writeLocalAdminAccounts(normalized);
          window.BremDataCache?.set?.(key, { accounts: normalized }, { source: 'local' });
          return Promise.resolve({ ok: true, localOnly: true });
        }
        return writeLocalSessionCache(key, value);
      }

      if (isPayrollStorageKey(key) && isPayrollLocalStorageMode()) {
        return Promise.reject(new Error('개발 모드에서는 급여명세서를 Supabase에 저장할 수 없습니다.'));
      }
      if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.stage) {
        if (!isStoragePersistReady()) {
          console.warn('[BREM] Storage persist deferred until Supabase session is ready:', key);
          return undefined;
        }
        try {
          assertPersistAllowed(key, value, options);
        } catch (error) {
          return Promise.reject(error);
        }
        activeStorageAdapter.stage(key, value);
        const persist = activeStorageAdapter.enqueuePersist(key, value, options);
        scheduleCacheSyncAfterWrite(key, persist);
        return persist;
      }
      if (!isStoragePersistReady()) {
        return undefined;
      }
      try {
        assertPersistAllowed(key, value, options);
      } catch (error) {
        return Promise.reject(error);
      }
      const result = activeStorageAdapter.write(key, value);
      scheduleCacheSyncAfterWrite(key, result);
      return result;
    },
    remove(key) {
      if (isLocalDevBackend()) {
        if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.stage) {
          activeStorageAdapter.stage(key, null);
        }
        window.BremDataCache?.invalidate?.(key);
        return Promise.resolve({ ok: true, localOnly: true });
      }
      if (!isStoragePersistReady()) {
        return undefined;
      }
      return activeStorageAdapter.remove(key);
    },
    has(key) {
      return activeStorageAdapter.has(key);
    },
    listBremKeys() {
      return activeStorageAdapter.listBremKeys();
    },
    async flush(options = {}) {
      if (isLocalDevBackend()) {
        return;
      }
      if (isStoragePersistReady() && options.skipStagedCore !== true) {
        flushStagedSupabaseWrites();
      }
      if (activeStorageAdapter.flush) {
        await activeStorageAdapter.flush();
      }
    }
  };

  const PAYROLL_STORAGE_KEYS = new Set([
    KEYS.payrollSlipUploads,
    KEYS.payrollSlipLines,
    KEYS.payrollNotices,
    KEYS.payrollRiderPublish
  ]);

  function isPayrollStorageKey(key) {
    return PAYROLL_STORAGE_KEYS.has(key);
  }

  function isLocalDevBackend() {
    const config = getSupabaseConfig();
    return config.mode === 'development' && config.backend === 'local';
  }

  function isPayrollLocalStorageMode() {
    const config = window.BREM_SUPABASE_CONFIG || {};
    if (config.mode === 'production') return false;
    const payrollMode = String(config.payrollStorage?.mode || '').trim().toLowerCase();
    if (payrollMode === 'supabase') return false;
    if (payrollMode === 'local') return true;
    return false;
  }

  function readPayrollLocalCollection(key, fallback = []) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return Array.isArray(fallback) ? [] : fallback;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function writePayrollLocalCollection(key, list) {
    const next = Array.isArray(list) ? list : [];
    localStorage.setItem(key, JSON.stringify(next));
    window.BremDataCache?.set?.(key, next, { source: 'write' });
  }

  function hydratePayrollLocalCache() {
    if (!isPayrollLocalStorageMode()) return;
    PAYROLL_STORAGE_KEYS.forEach(key => {
      const data = readPayrollLocalCollection(key, []);
      window.BremDataCache?.set?.(key, data, { source: 'local' });
    });
  }

  async function getPayrollStorageStatus() {
    if (isPayrollLocalStorageMode()) {
      return {
        mode: 'local',
        label: '로컬',
        canSave: true,
        canDelete: true,
        tablesAvailable: false,
        sessionReady: true,
        message: '급여명세서 저장 위치: 로컬',
        hint: '운영 payroll 테이블에는 저장되지 않습니다.'
      };
    }

    const uploadsTable = 'payroll_slip_uploads';
    const linesTable = 'payroll_slip_lines';

    if (activeStorageAdapter.probeOperationTables) {
      try {
        await activeStorageAdapter.probeOperationTables([uploadsTable, linesTable], { force: true });
      } catch {
        /* ignore probe errors */
      }
    }

    let uploadsAvailable = activeStorageAdapter.isOperationTableAvailable?.(uploadsTable);
    let linesAvailable = activeStorageAdapter.isOperationTableAvailable?.(linesTable);

    if (uploadsAvailable == null || linesAvailable == null) {
      try {
        await ensureSectionLoadedInternal('payroll-slips', { force: true });
      } catch {
        /* ignore probe errors */
      }
      uploadsAvailable = activeStorageAdapter.isOperationTableAvailable?.(uploadsTable);
      linesAvailable = activeStorageAdapter.isOperationTableAvailable?.(linesTable);
    }

    const tablesAvailable = uploadsAvailable === true && linesAvailable === true;
    const sessionReady = isStoragePersistReady();

    return {
      mode: 'supabase',
      label: 'Supabase',
      canSave: tablesAvailable && sessionReady,
      canDelete: tablesAvailable && sessionReady,
      tablesAvailable,
      sessionReady,
      message: tablesAvailable
        ? '급여명세서 저장 위치: Supabase'
        : '급여명세서 저장 위치: Supabase (테이블 미설치)',
      hint: tablesAvailable
        ? '운영 DB에 저장·조회·삭제됩니다.'
        : 'supabase/payroll_slips_migration.sql 을 실행한 뒤 저장할 수 있습니다.'
    };
  }

  function getStorageBackend() {
    if (activeStorageAdapter.type === 'local') return 'local';
    return activeStorageAdapter.type === 'supabase' ? 'supabase' : 'unavailable';
  }

  function getStorageBackendPreference() {
    const config = window.BREM_SUPABASE_CONFIG || {};
    return config.backend === 'local' ? 'local' : 'supabase';
  }

  function setStorageBackendPreference() {
    /* Supabase only */
  }

  function getSupabaseConfig() {
    const config = window.BREM_SUPABASE_CONFIG || {};
    const mode = config.mode === 'production' ? 'production' : 'development';
    const initialAdmin = config.initialAdmin || {};
    return {
      url: String(config.url || '').trim(),
      anonKey: String(config.anonKey || '').trim(),
      backend: config.backend === 'local' ? 'local' : 'supabase',
      mode,
      allowLocalFallback: config.mode !== 'production' && config.allowLocalFallback === true,
      functionsUrl: String(config.functionsUrl || '').trim(),
      supabaseReadOnly: config.writeBlocked === true
        || config.supabaseReadOnly === true
        || (mode === 'development' && config.backend === 'local'),
      writeBlocked: config.writeBlocked === true
        || (mode === 'development' && config.backend === 'local'),
      writeBlockMessage: String(config.writeBlockMessage || '').trim(),
      devSupabase: config.devSupabase === true,
      productionSupabaseForbidden: config.productionSupabaseForbidden === true,
      isConfigured: Boolean(String(config.url || '').trim() && String(config.anonKey || '').trim()),
      initialAdmin: {
        loginName: String(initialAdmin.loginName || '관리자').trim() || '관리자',
        email: String(initialAdmin.email || '').trim()
      },
      adminLoginHints: config.adminLoginHints && typeof config.adminLoginHints === 'object'
        ? { ...config.adminLoginHints }
        : {}
    };
  }

  const FALLBACK_ADMIN_LOGIN_HINTS = Object.freeze({
    관리자: 'kim01022680704@gmail.com',
    김형진: 'admin.g7yfepgm@gmail.com',
    김형진2: '2.35urtxd8@gmail.com',
    방준길: 'admin.fszu0d19@gmail.com',
    이동주: 'admin.grb0145t@gmail.com',
    박재현: 'admin.gik1wkeq@gmail.com',
    장승표: 'admin.ikk1dv0r@gmail.com',
    한승훈: 'admin.8od1nnsw@gmail.com',
    신명화: 'admin.6cdhmwe6@gmail.com',
    테스트01: '01.j4rpq9cs@gmail.com'
  });

  function resolveAdminLoginInput(input) {
    const value = String(input || '').trim();
    if (!value) return value;
    if (value.includes('@')) return value;

    const config = getSupabaseConfig();
    const { loginName, email } = config.initialAdmin;
    if (value === loginName && email) return email;

    const hinted = config.adminLoginHints?.[value] || FALLBACK_ADMIN_LOGIN_HINTS[value];
    if (hinted && String(hinted).includes('@')) return String(hinted).trim();

    const account = readAdminAccountsRaw()?.find(item => item.active && item.name === value);
    if (account?.email) return String(account.email).trim();

    return value;
  }

  function rememberAdminAccessToken(token) {
    cachedAdminAccessToken = String(token || '').trim();
  }

  function bindSupabaseAuthListener(client) {
    if (!client?.auth?.onAuthStateChange || supabaseAuthListenerBound) return;
    supabaseAuthListenerBound = true;
    client.auth.onAuthStateChange((_event, session) => {
      rememberAdminAccessToken(session?.access_token || '');
    });
  }

  async function resolveAdminAccessToken() {
    const client = getSupabaseClient();
    if (!client) return '';

    bindSupabaseAuthListener(client);

    let { data: sessionData } = await client.auth.getSession();
    let session = sessionData?.session;

    if (!session) {
      const { data: refreshed, error } = await client.auth.refreshSession();
      if (!error) session = refreshed?.session || null;
    } else if (session.expires_at) {
      const expiresMs = session.expires_at * 1000;
      if (expiresMs - Date.now() < 60_000) {
        const { data: refreshed, error } = await client.auth.refreshSession();
        if (!error && refreshed?.session) session = refreshed.session;
      }
    }

    const token = session?.access_token || cachedAdminAccessToken || '';
    if (token) rememberAdminAccessToken(token);
    return token;
  }

  async function getAdminAccessToken() {
    return resolveAdminAccessToken();
  }

  async function verifyAdminAccessTokenWithServer(token) {
    const accessToken = String(token || '').trim();
    if (!accessToken) {
      return { ok: false, message: '로그인 세션이 없습니다.' };
    }

    try {
      const response = await fetch('/api/admin/users/me', {
        credentials: 'same-origin',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          message: payload.error || `관리자 세션 확인에 실패했습니다. (${response.status})`
        };
      }
      return { ok: true, account: payload.account };
    } catch (error) {
      return { ok: false, message: error.message || '관리자 세션 확인에 실패했습니다.' };
    }
  }

  async function adminRidersApi(path, options = {}) {
    const token = await resolveAdminAccessToken();
    if (!token) {
      return { ok: false, message: '로그인 세션이 만료되었습니다. 관리자 화면에서 다시 로그인하세요.' };
    }

    try {
      window.BremPerf?.countApi?.(1);
      const response = await fetch(path, {
        credentials: 'same-origin',
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const serverMessage = payload.message || payload.error || `기사 API 요청에 실패했습니다. (${response.status})`;
        if (response.status === 401) {
          return {
            ok: false,
            status: 401,
            message: `${serverMessage} 관리자 화면에서 다시 로그인한 뒤 시도하세요.`
          };
        }
        return { ok: false, status: response.status, message: serverMessage };
      }
      return { ok: true, ...payload };
    } catch (error) {
      return { ok: false, message: error.message || '기사 API 요청에 실패했습니다.' };
    }
  }

  function invalidateDriversNormalizeCache() {
    normalizedDriversCache = null;
    normalizedDriversSourceRef = null;
  }

  function mergeRiderInCache(riderRow) {
    const mapper = window.BremSupabaseMapper;
    if (!mapper?.rowToRider || !riderRow?.id) return null;

    const driver = mapper.rowToRider(riderRow);
    const list = [...drivers.getAll()];
    const index = list.findIndex(item => item.id === driver.id);
    if (index >= 0) {
      list[index] = { ...list[index], ...driver };
    } else {
      list.unshift(driver);
    }
    markDriversCache(list, { source: 'rider-login' });
    return drivers.getById(driver.id) || driver;
  }

  async function ensureDriverStorageReady() {
    if (window.BremSupabaseConfig?.load) {
      await window.BremSupabaseConfig.load();
    }
    await waitForStorageBootstrap();
    return resumeSupabaseAfterAuth({ deferHydrate: true });
  }

  async function fetchCurrentRiderFromServer() {
    const token = await resolveAdminAccessToken();
    if (!token) {
      return { ok: false, message: '로그인 세션이 없습니다.' };
    }

    try {
      const response = await fetch('/api/rider/me', {
        credentials: 'same-origin',
        headers: { Authorization: `Bearer ${token}` }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, message: payload.error || '기사 정보를 불러오지 못했습니다.' };
      }
      const driver = mergeRiderInCache(payload.rider);
      if (!driver) {
        return { ok: false, message: '기사 데이터 변환에 실패했습니다.' };
      }
      if (payload.profile) {
        activeSupabaseProfile = payload.profile;
      }
      if (payload.riderId) {
        sessionAdapter.write(SESSION_KEYS.driverId, payload.riderId);
      }
      return { ok: true, driver };
    } catch (error) {
      return { ok: false, message: error.message || '기사 정보 요청에 실패했습니다.' };
    }
  }

  function setDriversCache(list) {
    invalidateDriversNormalizeCache();
    if (activeStorageAdapter.type === 'local') {
      writeLocalDevJson(KEYS.drivers, list);
      window.BremDataCache?.set?.(KEYS.drivers, list, {
        source: 'local',
        complete: driversLoadMeta.complete,
        supabaseTotal: driversLoadMeta.supabaseTotal || list.length
      });
      return;
    }
    if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.stage) {
      activeStorageAdapter.stage(KEYS.drivers, list);
      if (isLocalDevBackend()) {
        window.BremDataCache?.set?.(KEYS.drivers, list, {
          source: 'local-session',
          complete: driversLoadMeta.complete,
          supabaseTotal: driversLoadMeta.supabaseTotal || list.length
        });
      }
      return;
    }
    if (activeStorageAdapter.type === 'supabase') {
      try {
        storageAdapter.write(KEYS.drivers, list);
        return;
      } catch (error) {
        console.warn('[BREM] Driver cache write deferred until storage ready:', error.message || error);
      }
    }
    window.BremDataCache?.set?.(KEYS.drivers, list, {
      source: 'memory',
      complete: driversLoadMeta.complete,
      supabaseTotal: driversLoadMeta.supabaseTotal || list.length
    });
  }

  function markDriversCache(list, meta = {}) {
    const rows = dedupeDriversList(Array.isArray(list) ? list : []);
    const nextTotal = Number(meta.supabaseTotal ?? driversLoadMeta.supabaseTotal ?? rows.length);
    if (meta.complete === true) {
      driversLoadMeta = {
        complete: true,
        supabaseTotal: Number.isFinite(nextTotal) ? nextTotal : rows.length
      };
    } else if (meta.complete === false) {
      driversLoadMeta = {
        complete: false,
        supabaseTotal: Number.isFinite(nextTotal) ? nextTotal : rows.length
      };
    } else if (Number.isFinite(nextTotal) && nextTotal > 0) {
      // complete 미지정 호출에서는 총원 메타만 갱신.
      // 로컬은 중복제거로 DB total 보다 적을 수 있어 그 이유로 complete 를 강등하지 않는다.
      driversLoadMeta = {
        complete: driversLoadMeta.complete,
        supabaseTotal: nextTotal
      };
    }
    setDriversCache(rows);
    window.BremDataCache?.set?.(KEYS.drivers, rows, {
      ...meta,
      source: meta.source || 'sync',
      complete: driversLoadMeta.complete,
      supabaseTotal: driversLoadMeta.supabaseTotal
    });
  }

  function setMissionsCache(list) {
    if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.stage) {
      activeStorageAdapter.stage(KEYS.missions, list);
      return;
    }
    storageAdapter.write(KEYS.missions, list);
  }

  function markMissionsCache(list) {
    const rows = Array.isArray(list) ? list : [];
    setMissionsCache(rows);
    window.BremDataCache?.set?.(KEYS.missions, rows, { tableLoaded: true });
  }

  function restoreDriversCacheFromSession() {
    if (!window.BremDataCache?.isValid?.(KEYS.drivers)) return false;
    const cached = window.BremDataCache.getData(KEYS.drivers);
    if (!Array.isArray(cached) || !cached.length) return false;
    const cacheMeta = window.BremDataCache.getMeta?.(KEYS.drivers);
    if (!cacheMeta?.meta?.complete) return false;
    const supabaseTotal = Number(cacheMeta.meta.supabaseTotal) || 0;
    // 총원보다 적게 저장된 "완료" 캐시는 폐기하고 서버에서 다시 받는다.
    if (supabaseTotal > 0 && cached.length < supabaseTotal) {
      window.BremDataCache?.invalidate?.(KEYS.drivers);
      driversLoadMeta = { complete: false, supabaseTotal };
      return false;
    }

    if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.stage) {
      activeStorageAdapter.stage(KEYS.drivers, cached);
    } else {
      try {
        storageAdapter.write(KEYS.drivers, cached);
      } catch {
        window.BremDataCache?.set?.(KEYS.drivers, cached, {
          source: 'memory',
          complete: true,
          supabaseTotal: supabaseTotal || cached.length
        });
      }
    }
    driversLoadMeta = {
      complete: true,
      supabaseTotal: supabaseTotal || cached.length
    };
    logDataSource('riders', true, 'tab session');
    document.dispatchEvent(new CustomEvent('brem-drivers-sync-ready', {
      detail: {
        complete: true,
        cached: true,
        count: cached.length,
        supabaseTotal: driversLoadMeta.supabaseTotal
      }
    }));
    return true;
  }

  function restoreTableCachesFromSession() {
    if (activeStorageAdapter.type !== 'supabase' || !activeStorageAdapter.stage) return;
    restoreDriversCacheFromSession();
    TABLE_STORAGE_KEYS.forEach(key => {
      if (key === KEYS.drivers) return;
      if (isRiderProductionSession() && key === KEYS.notices) return;
      if (activeStorageAdapter.isKeyLoaded?.(key)) return;
      if (!window.BremDataCache?.isValid?.(key)) return;
      const cached = window.BremDataCache.getData(key);
      if (!Array.isArray(cached)) return;
      activeStorageAdapter.stage(key, cached);
    });
  }

  async function syncMissionsFromServer() {
    if (!isProductionMode()) {
      return { ok: false, message: '운영 환경에서만 서버 동기화를 사용합니다.' };
    }

    const result = await adminRidersApi('/api/admin/missions');
    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        message: result.message || result.error || '미션 목록을 불러오지 못했습니다.'
      };
    }

    const mapper = window.BremSupabaseMapper;
    if (!mapper?.rowToMission) {
      return { ok: false, message: '미션 데이터 변환 모듈이 없습니다.' };
    }

    const missionRows = (result.missions || []).map(row => mapper.rowToMission(row));
    markMissionsCache(missionRows);
    return { ok: true, count: missionRows.length };
  }

  async function persistMissionViaServer(mission) {
    const postMission = () => adminRidersApi('/api/admin/missions', {
      method: 'POST',
      body: JSON.stringify({ mission })
    });

    let result = await postMission();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await postMission();
    }
    if (!result.ok) {
      throw new Error(result.message || result.error || '미션 저장에 실패했습니다.');
    }

    const mapper = window.BremSupabaseMapper;
    if (!mapper?.rowToMission || !result.mission) {
      throw new Error('저장된 미션을 확인하지 못했습니다.');
    }

    const saved = mapper.rowToMission(result.mission);
    const list = missions.getAll();
    const exists = list.some(item => item.id === saved.id);
    const next = exists
      ? list.map(item => (item.id === saved.id ? saved : item))
      : [saved, ...list];
    markMissionsCache(next);
    return saved;
  }

  function clearMissionFromDriverCache(missionId) {
    const id = String(missionId || '').trim();
    if (!id) return;

    const list = storageAdapter.read(KEYS.drivers, []);
    let changed = false;
    const next = list.map(driver => {
      const patch = {};
      if (driver.selectedMissionId === id) patch.selectedMissionId = '';
      if (driver.selectedMissionIdBaemin === id) patch.selectedMissionIdBaemin = '';
      if (driver.selectedMissionIdCoupang === id) patch.selectedMissionIdCoupang = '';
      if (driver.promotionRuleIdBaemin === id) patch.promotionRuleIdBaemin = '';
      if (driver.promotionRuleIdCoupang === id) patch.promotionRuleIdCoupang = '';
      if (driver.promotionSelectorBaemin === id) patch.promotionSelectorBaemin = '';
      if (driver.promotionSelectorCoupang === id) patch.promotionSelectorCoupang = '';
      if (!Object.keys(patch).length) return driver;
      changed = true;
      return { ...driver, ...patch };
    });
    if (changed) {
      setDriversCache(next);
      window.BremDataCache?.set?.(KEYS.drivers, next);
    }
  }

  async function deleteMissionViaServer(id) {
    const missionId = String(id || '').trim();
    if (!missionId) throw new Error('미션 ID가 없습니다.');

    const deleteRequest = () => adminRidersApi(`/api/admin/missions/${encodeURIComponent(missionId)}`, {
      method: 'DELETE'
    });

    let result = await deleteRequest();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await deleteRequest();
    }
    if (!result.ok) {
      throw new Error(result.message || result.error || '미션 삭제에 실패했습니다.');
    }

    markMissionsCache(missions.getAll().filter(item => item.id !== missionId));
    clearMissionFromDriverCache(missionId);
    return { ok: true, id: missionId };
  }

  function markNoticesCache(list, meta = {}) {
    const value = Array.isArray(list) ? list : [];
    if (activeStorageAdapter.stage) {
      activeStorageAdapter.stage(KEYS.notices, value);
    } else {
      storageAdapter.write(KEYS.notices, value);
    }
    window.BremDataCache?.set?.(KEYS.notices, value, {
      source: meta.source || 'write',
      tableLoaded: true
    });
  }

  function mergeNoticesRowsInCache(rows = []) {
    const mapper = window.BremSupabaseMapper;
    const noticeRows = (Array.isArray(rows) ? rows : []).map(row => (
      mapper?.rowToNotice ? mapper.rowToNotice(row) : row
    ));
    stageRiderScopedCache(KEYS.notices, noticeRows, { tableLoaded: true });
    document.dispatchEvent(new CustomEvent('brem-cache-status-changed'));
    return noticeRows;
  }

  async function syncNoticesFromServer() {
    if (!isProductionMode()) {
      return { ok: false, message: '운영 환경에서만 서버 동기화를 사용합니다.' };
    }

    const result = await adminRidersApi('/api/admin/notices');
    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        message: result.message || result.error || '공지사항 목록을 불러오지 못했습니다.'
      };
    }

    const mapper = window.BremSupabaseMapper;
    if (!mapper?.rowToNotice) {
      return { ok: false, message: '공지 데이터 변환 모듈이 없습니다.' };
    }

    const noticeRows = (result.notices || []).map(row => mapper.rowToNotice(row));
    markNoticesCache(noticeRows, { source: 'server' });
    return { ok: true, count: noticeRows.length };
  }

  async function persistNoticeViaServer(notice) {
    const postNotice = () => adminRidersApi('/api/admin/notices', {
      method: 'POST',
      body: JSON.stringify({ notice })
    });

    let result = await postNotice();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await postNotice();
    }
    if (!result.ok) {
      throw new Error(result.message || result.error || '공지사항 저장에 실패했습니다.');
    }

    const mapper = window.BremSupabaseMapper;
    if (!mapper?.rowToNotice || !result.notice) {
      throw new Error('저장된 공지를 확인하지 못했습니다.');
    }

    const saved = mapper.rowToNotice(result.notice);
    const list = notices.getAll();
    const exists = list.some(item => item.id === saved.id);
    const next = exists
      ? list.map(item => (item.id === saved.id ? saved : item))
      : [saved, ...list];
    markNoticesCache(next, { source: 'server' });
    return saved;
  }

  async function deleteNoticeViaServer(id) {
    const noticeId = String(id || '').trim();
    if (!noticeId) throw new Error('공지 ID가 없습니다.');

    const deleteRequest = () => adminRidersApi(`/api/admin/notices/${encodeURIComponent(noticeId)}`, {
      method: 'DELETE'
    });

    let result = await deleteRequest();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await deleteRequest();
    }
    if (!result.ok) {
      throw new Error(result.message || result.error || '공지사항 삭제에 실패했습니다.');
    }

    markNoticesCache(notices.getAll().filter(item => item.id !== noticeId), { source: 'server' });
    return { ok: true, id: noticeId };
  }

  async function persistLeaseErpTableViaServer(table, rows, options = {}) {
    const postRows = () => adminRidersApi('/api/admin/lease-erp/upsert', {
      method: 'POST',
      body: JSON.stringify({
        table,
        rows: rows || [],
        deletedIds: Array.isArray(options.deletedRowIds) ? options.deletedRowIds : []
      })
    });

    let result = await postRows();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await postRows();
    }
    if (!result.ok) {
      throw new Error(result.message || result.error || '리스 ERP 저장에 실패했습니다.');
    }
    return result;
  }

  async function fetchRiderNoticesFromServer() {
    const token = await resolveAdminAccessToken();
    if (!token) {
      return { ok: false, message: '로그인 세션이 없습니다.' };
    }

    try {
      invalidateNoticesCache();

      const response = await fetch('/api/rider/notices', {
        credentials: 'same-origin',
        headers: { Authorization: `Bearer ${token}` }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        markNoticesCache([], { source: 'server-error' });
        return { ok: false, message: payload.error || '공지사항을 불러오지 못했습니다.' };
      }

      const mapper = window.BremSupabaseMapper;
      const noticeRows = (payload.notices || [])
        .map(row => (mapper?.rowToNotice ? mapper.rowToNotice(row) : row))
        .filter(notice => notice.noticeKind !== 'payroll' && !String(notice.id || '').startsWith('payroll-'));
      markNoticesCache(noticeRows, { source: 'server' });
      return {
        ok: true,
        riderId: payload.riderId || null,
        count: noticeRows.length
      };
    } catch (error) {
      markNoticesCache([], { source: 'server-error' });
      return { ok: false, message: error.message || '공지사항 요청에 실패했습니다.' };
    }
  }

  async function reloadNotices(force = false) {
    if (!force && window.BremDataCache?.isValid?.(KEYS.notices)) {
      const cached = window.BremDataCache.getData(KEYS.notices);
      if (Array.isArray(cached)) {
        logDataSource('notices', true);
        markNoticesCache(cached, { source: 'cache' });
        return { ok: true, cached: true, count: cached.length };
      }
    }

    logDataSource('notices', false);

    const isAdminSession = activeSupabaseProfile?.role === 'admin' && activeSupabaseProfile?.active !== false;
    if (isProductionMode() && isAdminSession) {
      return syncNoticesFromServer();
    }

    if (isRiderProductionSession()) {
      return fetchRiderNoticesFromServer();
    }

    if (activeStorageAdapter.ensureKeysLoaded) {
      await activeStorageAdapter.ensureKeysLoaded([KEYS.notices], { force });
      return { ok: true, count: notices.getAll().length };
    }

    return { ok: true, count: 0 };
  }

  async function reloadMissions(force = false) {
    if (!force && window.BremDataCache?.isValid?.(KEYS.missions)) {
      const cached = window.BremDataCache.getData(KEYS.missions);
      if (Array.isArray(cached)) {
        logDataSource('missions', true);
        setMissionsCache(cached);
        return { ok: true, cached: true, count: cached.length };
      }
    }

    logDataSource('missions', false);

    const loadViaAdapter = async () => {
      if (activeStorageAdapter.type !== 'supabase' || !activeStorageAdapter.ensureKeysLoaded) {
        return { ok: true };
      }
      try {
        await activeStorageAdapter.ensureKeysLoaded([KEYS.missions], { force });
        const count = missions.getAll().length;
        return { ok: true, count };
      } catch (error) {
        return { ok: false, message: error.message || '미션 목록을 불러오지 못했습니다.' };
      }
    };

    const isAdminSession = activeSupabaseProfile?.role === 'admin' && activeSupabaseProfile?.active !== false;

    if (isProductionMode() && isAdminSession) {
      const serverResult = await syncMissionsFromServer();
      if (serverResult.ok) {
        return serverResult;
      }
      return loadViaAdapter();
    }

    return loadViaAdapter();
  }

  function isMissingMissionsTableError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('could not find the table')
      || (message.includes('relation') && message.includes('missions') && message.includes('does not exist'));
  }

  async function getMissionsTableStatus() {
    if (!isProductionMode()) {
      return { ok: true, tableExists: true };
    }
    const result = await adminRidersApi('/api/admin/missions/status');
    if (result.ok) return result;

    const client = getSupabaseClient();
    if (client) {
      try {
        const { error } = await client.from('missions').select('id').limit(1);
        if (!error) return { ok: true, tableExists: true };
        if (isMissingMissionsTableError(error)) {
          return { ok: true, tableExists: false, count: 0 };
        }
      } catch {
        /* ignore probe errors */
      }
    }
    return result;
  }

  function getHydrateOptions() {
    return {
      skipKeys: [KEYS.drivers, KEYS.notices, KEYS.missions, KEYS.promotionRules, KEYS.riderInquiries]
    };
  }

  const HEAVY_ADMIN_TABLE_KEYS = Object.freeze([
    KEYS.calls,
    KEYS.rejections,
    KEYS.targets,
    KEYS.adminSchedules,
    KEYS.riderInquiries,
    KEYS.settlements,
    KEYS.weeklySettlements,
    KEYS.settlementUploadLogs,
    KEYS.settlementUnmatched
  ]);

  const ADMIN_SECTION_KEYS = Object.freeze({
    dashboard: [KEYS.drivers, KEYS.notices, KEYS.calls, KEYS.rejections, KEYS.leaseVehicles],
    notices: [KEYS.notices],
    'mission-management': [KEYS.promotionRules, KEYS.drivers],
    'rider-inquiries': [KEYS.riderInquiries],
    promotions: [KEYS.promotionRules],
    'promotion-apply': [KEYS.promotionRules, KEYS.drivers, KEYS.weeklySettlements, KEYS.weeklySettlementsDirect, KEYS.promotionApplyResults, KEYS.settlements, KEYS.rejections],
    calls: [KEYS.drivers, KEYS.calls, KEYS.callEditLogs],
    rejections: [KEYS.drivers, KEYS.rejections],
    targets: [KEYS.drivers, KEYS.targets],
    missions: [KEYS.drivers, KEYS.calls],
    'mission-results': [KEYS.drivers, KEYS.calls],
    settlements: [KEYS.drivers, KEYS.settlements, KEYS.settlementUploadLogs, KEYS.settlementUnmatched, KEYS.calls, KEYS.payrollDailyExcludedSettlements],
    'weekly-settlement': [KEYS.drivers, KEYS.weeklySettlements, KEYS.settlementUploadLogs, KEYS.settlementUnmatched, KEYS.calls],
    // 직계약 정산서·업로드로그·미매칭은 settings 기반이라 부트스트랩에서 일괄 로드된다.
    // (테이블 키가 아니므로 아래 목록에 넣어도 로딩·캐시 판정에는 쓰이지 않는다.)
    'weekly-settlement-direct': [KEYS.drivers, KEYS.calls],
    'promotion-settlement': [KEYS.drivers, KEYS.promotionApplyResults, KEYS.weeklySettlementsDirect, KEYS.directSettlementAdjustments, KEYS.directOtherPayments, KEYS.directBremPromotions],
    'settlement-result-direct': [KEYS.drivers, KEYS.calls, KEYS.weeklySettlementsDirect, KEYS.directSettlementAdjustments, KEYS.directRetroAdjustments, KEYS.directOtherPayments, KEYS.directBremPromotions, KEYS.payrollWithdrawalRequests, KEYS.payrollDailySettlementFees, KEYS.payrollDailySettlementRoster, KEYS.deductionLedger, KEYS.leaseLoans],
    // 최종입금은 쿠팡·배민 정산서를 한 화면에서 합치므로 정산결과와 같은 키가 필요하다.
    'final-deposit': [KEYS.drivers, KEYS.calls, KEYS.weeklySettlementsDirect, KEYS.directSettlementAdjustments, KEYS.directRetroAdjustments, KEYS.directOtherPayments, KEYS.directBremPromotions, KEYS.payrollWithdrawalRequests, KEYS.payrollDailySettlementFees, KEYS.payrollDailySettlementRoster, KEYS.deductionLedger, KEYS.leaseLoans],
    'driver-management': [KEYS.drivers, KEYS.driverOrgChart, KEYS.calls, KEYS.settlements],
    'admin-schedule': [KEYS.adminSchedules],
    'payroll-slips': [KEYS.payrollSlipUploads, KEYS.payrollSlipLines, KEYS.payrollNotices, KEYS.payrollDailySettlementRoster, KEYS.payrollDailySettlementRegions, KEYS.drivers, KEYS.calls],
    'payroll-daily-settlement': [
      KEYS.payrollDailySettlementRoster,
      KEYS.payrollDailySettlementRegions,
      KEYS.payrollDailySettlementFees,
      KEYS.payrollWithdrawalRequests,
      KEYS.payrollDailyExcludedSettlements,
      KEYS.payrollWeekFinalized,
      KEYS.payrollWithdrawalPaused,
      KEYS.drivers,
      KEYS.settlements
    ],
    'lease-management': [
      KEYS.drivers,
      KEYS.leaseVehicles,
      KEYS.leasePayments,
      KEYS.leaseAccidents,
      KEYS.leaseMaintenance,
      KEYS.leaseContracts,
      KEYS.leaseProfitLogs,
      KEYS.leaseArrears,
      KEYS.leaseLoans,
      KEYS.deductionLedger
    ],
    'revenue-management': [],
    'admin-account': [],
    'baemin-biz-status': [],
    'baemin-status': [],
    'coupang-status': [],
    'coupang-rider-status': [KEYS.drivers],
    'contribution': [],
    'data-backup': [KEYS.drivers, KEYS.notices, KEYS.missions, KEYS.promotionRules, KEYS.riderInquiries]
  });

  const TABLE_STORAGE_KEYS = new Set([
    KEYS.drivers,
    KEYS.notices,
    KEYS.missions,
    KEYS.promotionRules,
    KEYS.riderInquiries,
    KEYS.adminSchedules,
    KEYS.payrollSlipUploads,
    KEYS.payrollSlipLines,
    KEYS.payrollNotices,
    KEYS.calls,
    KEYS.rejections,
    KEYS.targets,
    KEYS.settlements,
    KEYS.weeklySettlements,
    KEYS.settlementUploadLogs,
    KEYS.settlementUnmatched,
    KEYS.promotionApplyResults,
    KEYS.leaseVehicles,
    KEYS.leaseContracts,
    KEYS.leasePayments,
    KEYS.leaseAccidents,
    KEYS.leaseMaintenance,
    KEYS.leaseProfitLogs,
    KEYS.leaseArrears
  ]);

  function scheduleCacheSyncAfterWrite(key, persistPromise) {
    if (!MUTATION_TRACKED_KEYS.has(key)) return;

    const syncCache = () => {
      try {
        if (TABLE_STORAGE_KEYS.has(key) && activeStorageAdapter.read) {
          const value = activeStorageAdapter.read(key, null);
          if (key === KEYS.drivers && Array.isArray(value)) {
            markDriversCache(value, { source: 'write' });
            return;
          }
          if (key === KEYS.missions && Array.isArray(value)) {
            markMissionsCache(value);
            return;
          }
          if (value != null) {
            window.BremDataCache?.set?.(key, value, { source: 'write' });
          }
          return;
        }
        window.BremDataCache?.persistFromAdapter?.(key, activeStorageAdapter);
      } catch (error) {
        console.warn('[BREM] Cache sync after write failed:', key, error);
      }
    };

    const onError = error => {
      console.error('[BREM] Persist failed — keeping cache:', key, error);
      document.dispatchEvent(new CustomEvent('brem-storage-persist-error', {
        detail: { key, message: error?.message || String(error) }
      }));
    };

    if (persistPromise && typeof persistPromise.then === 'function') {
      void persistPromise.then(syncCache).catch(onError);
      return;
    }

    if (activeStorageAdapter.flush) {
      void activeStorageAdapter.flush().then(syncCache).catch(onError);
    } else {
      syncCache();
    }
  }

  async function awaitPersist(result) {
    if (result && typeof result.then === 'function') {
      await result;
      return;
    }
    if (activeStorageAdapter.flush) {
      await activeStorageAdapter.flush();
    }
  }

  /** @deprecated use scheduleCacheSyncAfterWrite — kept for explicit server refresh */
  function scheduleDataRefetch(key) {
    scheduleCacheSyncAfterWrite(key);
  }

  async function refetchDataKey(key, options = {}) {
    return window.BremDataCache.runOnce(`refetch:${key}`, async () => {
      if (key === KEYS.drivers) {
        return fetchAllDriversFromServer({ force: true });
      }
      if (key === KEYS.missions) {
        return reloadMissions(true);
      }
      if (TABLE_STORAGE_KEYS.has(key) && activeStorageAdapter.ensureKeysLoaded) {
        return activeStorageAdapter.ensureKeysLoaded([key], { ...options, force: true });
      }
      if (activeStorageAdapter.reloadSettingKey) {
        await activeStorageAdapter.reloadSettingKey(key);
      }
      return { ok: true };
    });
  }

  function isSectionCacheReady(sectionId) {
    if (!activeStorageAdapter.isHydrated?.()) return false;

    const sectionKeys = ADMIN_SECTION_KEYS[sectionId] || [];
    const settingsOnlySections = new Set([
      'admin-schedule',
      'lease-management',
      'revenue-management',
      'admin-account'
    ]);

    if (bootstrapComplete) {
      if (!sectionKeys.length) {
        if (sectionId === 'admin-schedule') {
          return window.BremDataCache?.isValid?.(KEYS.adminSchedules);
        }
        return settingsOnlySections.has(sectionId)
          ? window.BremDataCache?.isCoreReady?.()
          : true;
      }
      if (sectionKeys.includes(KEYS.drivers) && !driversLoadMeta.complete) return false;
      if (sectionKeys.includes(KEYS.missions) && !window.BremDataCache?.isValid?.(KEYS.missions)) return false;
      return sectionKeys
        .filter(key => TABLE_STORAGE_KEYS.has(key) && key !== KEYS.missions && key !== KEYS.drivers)
        .every(key => window.BremDataCache?.isValid?.(key));
    }

    if (!sectionKeys.length) {
      if (sectionId === 'admin-schedule') {
        return window.BremDataCache?.isCoreReady?.()
          && window.BremDataCache?.isValid?.(KEYS.adminSchedules);
      }
      return settingsOnlySections.has(sectionId)
        ? window.BremDataCache?.isCoreReady?.()
        : true;
    }

    if (sectionKeys.includes(KEYS.drivers)) {
      const hasDrivers = window.BremDataCache?.isValid?.(KEYS.drivers) && drivers.getAll().length > 0;
      if (!hasDrivers) return false;
      if (!driversLoadMeta.complete && !driversBackgroundFetchPromise && !driversFetchAllPromise) {
        return false;
      }
    }

    if (sectionKeys.includes(KEYS.missions)) {
      const missionsReady = window.BremDataCache?.isValid?.(KEYS.missions)
        && activeStorageAdapter.isKeyLoaded?.(KEYS.missions);
      if (!missionsReady) return false;
    }

    return sectionKeys
      .filter(key => TABLE_STORAGE_KEYS.has(key) && key !== KEYS.missions && key !== KEYS.drivers)
      .every(key => {
        if (isPayrollStorageKey(key) && isPayrollLocalStorageMode()) {
          return window.BremDataCache?.isValid?.(key);
        }
        return window.BremDataCache?.isValid?.(key) && activeStorageAdapter.isKeyLoaded?.(key);
      });
  }

  async function ensureSectionLoadedInternal(sectionId, options = {}) {
    const force = Boolean(options.force || options.forceDrivers);
    if (!force && bootstrapComplete && isSectionCacheReady(sectionId)) {
      return { ok: true, cached: true };
    }

    window.BremPerf?.time?.(`storage.ensureSection:${sectionId}`);
    const hydrated = await ensureSupabaseHydrated({ skipDriversSync: true });
    if (!hydrated.ok) {
      window.BremPerf?.timeEnd?.(`storage.ensureSection:${sectionId}`);
      return hydrated;
    }

    const sectionKeys = ADMIN_SECTION_KEYS[sectionId] || [];
    const payrollLocal = isPayrollLocalStorageMode();
    const tableKeys = sectionKeys.filter(key => {
      if (!TABLE_STORAGE_KEYS.has(key)) return false;
      if (payrollLocal && isPayrollStorageKey(key)) return false;
      return true;
    });
    if (payrollLocal && sectionId === 'payroll-slips') {
      hydratePayrollLocalCache();
    }
    const needsDrivers = sectionKeys.includes(KEYS.drivers);
    const needsMissions = sectionKeys.includes(KEYS.missions);
    const needsNotices = sectionKeys.includes(KEYS.notices);
    const tasks = [];

    const tableKeysWithoutManaged = tableKeys.filter(key => key !== KEYS.missions && key !== KEYS.notices);
    const loadOptions = { force };
    if (sectionId === 'rejections' && tableKeysWithoutManaged.includes(KEYS.rejections)) {
      loadOptions.allHistory = true;
    }
    if (tableKeysWithoutManaged.length && activeStorageAdapter.ensureKeysLoaded) {
      const allTableCached = !force && tableKeysWithoutManaged.every(key => window.BremDataCache?.isValid?.(key));
      if (allTableCached) {
        tableKeysWithoutManaged.forEach(key => {
          const label = key === KEYS.promotionRules ? 'promotions' : key;
          logDataSource(label, true, sectionId);
        });
      } else {
        tasks.push(activeStorageAdapter.ensureKeysLoaded(tableKeysWithoutManaged, loadOptions));
      }
    }

    if (needsNotices) {
      const forceNoticesReload = force
        || (isProductionMode() && (sectionId === 'notices' || sectionId === 'dashboard'));
      if (!forceNoticesReload && window.BremDataCache?.isValid?.(KEYS.notices)) {
        logDataSource('notices', true, sectionId);
      } else {
        tasks.push(reloadNotices(true));
      }
    }

    if (needsMissions) {
      if (!force && window.BremDataCache?.isValid?.(KEYS.missions)) {
        logDataSource('missions', true, sectionId);
      } else {
        tasks.push(reloadMissions(force));
      }
    }

    if (needsDrivers) {
      const needsFullDrivers = sectionId === 'missions'
        || sectionId === 'mission-results'
        || sectionId === 'drivers'
        || sectionId === 'driver-management'
        || sectionId === 'mission-management'
        || sectionId === 'lease-management'
        || sectionId === 'coupang-rider-status'
        || sectionId === 'rejections';
      const hasDrivers = drivers.getAll().length > 0 && window.BremDataCache?.isValid?.(KEYS.drivers);
      const fetchInFlight = Boolean(driversFetchAllPromise || driversBackgroundFetchPromise || driversFullFetchInProgress);
      const knownTotal = Number(driversLoadMeta.supabaseTotal || 0);
      const loadedCount = drivers.getAll().length;
      // 중복제거로 loadedCount < knownTotal 일 수 있어 complete 플래그로만 판단한다.
      const looksComplete = Boolean(driversLoadMeta.complete && loadedCount > 0);

      if (!force && hasDrivers && looksComplete) {
        logDataSource('riders', true, sectionId);
      } else if (!force && !needsFullDrivers && hasDrivers && (looksComplete || fetchInFlight)) {
        logDataSource('riders', true, sectionId);
      } else if (!force && looksComplete && window.BremDataCache?.isValid?.(KEYS.drivers)) {
        logDataSource('riders', true, sectionId);
      } else if (needsFullDrivers) {
        tasks.push(
          reloadDrivers(Boolean(options.forceDrivers || options.force))
            .then(() => awaitDriversFullyLoaded())
        );
      } else {
        tasks.push(reloadDrivers(Boolean(options.forceDrivers || options.force)));
      }
    }

    if (
      sectionKeys.includes(KEYS.payrollDailySettlementRoster)
      && activeStorageAdapter.type === 'supabase'
      && activeStorageAdapter.reloadSettingKey
      && !isPayrollLocalStorageMode()
    ) {
      tasks.push(payrollDailySettlement.reloadFromServer());
    } else if (sectionKeys.includes(KEYS.payrollDailySettlementRegions)) {
      tasks.push(Promise.resolve(payrollDailySettlement.getRegions()));
    }

    if (tasks.length) {
      await Promise.all(tasks);
    }

    // 장기근속 진행률은 시작일 이후 콜수가 필요. 기본 2년 윈도우보다 이른 시작일이 있으면 더 앞부터 로드.
    if (sectionId === 'mission-results' || sectionId === 'missions') {
      await ensureLongEventCallsLoaded();
    }

    window.BremPerf?.timeEnd?.(`storage.ensureSection:${sectionId}`);
    return { ok: true };
  }

  function callsSinceDateWithBuffer(startDate, bufferDays = 7) {
    const start = String(startDate || '').slice(0, 10);
    if (!start) return '';
    const date = new Date(`${start}T00:00:00`);
    date.setDate(date.getDate() - Math.max(0, Number(bufferDays) || 0));
    return date.toISOString().slice(0, 10);
  }

  async function ensureCallsSinceDate(sinceDate, options = {}) {
    const since = String(sinceDate || '').slice(0, 10);
    if (!since || !activeStorageAdapter?.ensureKeysLoaded) return { ok: true };

    const existing = calls.getAll();
    if (!options.force && existing.length) {
      const earliest = existing.reduce((min, call) => {
        const day = String(call?.date || '').slice(0, 10);
        return !day || (min && day >= min) ? min : day;
      }, '');
      if (!earliest || earliest <= since) {
        return { ok: true, cached: true };
      }
    }

    await activeStorageAdapter.ensureKeysLoaded([KEYS.calls], {
      force: Boolean(options.force),
      [KEYS.calls]: { sinceDate: since }
    });
    return { ok: true };
  }

  async function ensureLongEventCallsLoaded(options = {}) {
    const starts = drivers.getAll()
      .map(driver => String(driver.longEventStartDate || '').slice(0, 10))
      .filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day))
      .sort();
    if (starts.length) {
      return ensureCallsSinceDate(callsSinceDateWithBuffer(starts[0], 7), options);
    }
    if (!window.BremDataCache?.isValid?.(KEYS.calls) && activeStorageAdapter.ensureKeysLoaded) {
      await activeStorageAdapter.ensureKeysLoaded([KEYS.calls], { force: Boolean(options.force) });
    }
    return { ok: true };
  }

  async function ensurePromotionCalculationCalls(startDate, endDate) {
    const sinceDate = callsSinceDateWithBuffer(startDate || endDate, 7);
    if (!sinceDate) return { ok: true };
    return ensureCallsSinceDate(sinceDate);
  }

  async function ensureSectionLoaded(sectionId, options = {}) {
    const force = options.force === true || options.forceDrivers === true;

    if (!force && isSectionCacheReady(sectionId)) {
      return { ok: true, cached: true };
    }

    const inflightKey = `${sectionId}:${force ? 'force' : 'normal'}`;
    if (sectionLoadPromises.has(inflightKey)) {
      return sectionLoadPromises.get(inflightKey);
    }

    const promise = ensureSectionLoadedInternal(sectionId, options).finally(() => {
      sectionLoadPromises.delete(inflightKey);
    });
    sectionLoadPromises.set(inflightKey, promise);
    return promise;
  }

  async function preloadHeavyAdminTables() {
    if (heavyDataPreloadPromise) return heavyDataPreloadPromise;
    if (!activeStorageAdapter.ensureKeysLoaded) return { ok: true };

    const run = () => {
      if (heavyDataPreloadPromise) return heavyDataPreloadPromise;
      window.BremPerf?.time?.('storage.preloadHeavyAdminTables');
      heavyDataPreloadPromise = activeStorageAdapter.ensureKeysLoaded([
        KEYS.rejections,
        KEYS.targets
      ])
        .then(() => {
          document.dispatchEvent(new CustomEvent('brem-heavy-data-ready'));
          return { ok: true };
        })
        .catch(error => {
          console.warn('[BREM] Dashboard table preload failed:', error.message || error);
          return { ok: false };
        })
        .finally(() => {
          heavyDataPreloadPromise = null;
          window.BremPerf?.timeEnd?.('storage.preloadHeavyAdminTables');
        });
      return heavyDataPreloadPromise;
    };

    if (typeof requestIdleCallback === 'function') {
      return new Promise(resolve => {
        requestIdleCallback(() => {
          resolve(run());
        }, { timeout: 4000 });
      });
    }
    return run();
  }

  async function loadBootstrapData(options = {}) {
    const force = options.force === true;
    if (!force && bootstrapLoadPromise) return bootstrapLoadPromise;

    if (!force && bootstrapComplete) {
      logDataSource('bootstrap', true);
      return { ok: true, cached: true };
    }

    const settingsReady = !force && window.BremDataCache?.isCoreReady?.();
    if (settingsReady && !force) {
      bootstrapComplete = true;
      logDataSource('bootstrap', true);
      return { ok: true, cached: true };
    }

    const run = async () => {
      const hydrated = await ensureSupabaseHydrated({ skipDriversSync: true });
      if (!hydrated.ok) return hydrated;

      bootstrapComplete = true;
      document.dispatchEvent(new CustomEvent('brem-cache-status-changed'));
      void preloadHeavyAdminTables();
      return { ok: true };
    };

    if (force) {
      resetBootstrapState();
      return run();
    }

    bootstrapLoadPromise = run().finally(() => {
      bootstrapLoadPromise = null;
    });
    return bootstrapLoadPromise;
  }

  function getCacheStatus() {
    const driversMeta = window.BremDataCache?.getMeta?.(KEYS.drivers);
    const missionsMeta = window.BremDataCache?.getMeta?.(KEYS.missions);
    return {
      ...(window.BremDataCache?.getStatus?.() || {}),
      bootstrapComplete,
      driversComplete: driversLoadMeta.complete,
      driversCount: drivers.getAll().length,
      driversSupabaseTotal: driversLoadMeta.supabaseTotal,
      driversLoadedAt: driversMeta?.storedAt || null,
      missionsCount: missions.getAll().length,
      missionsLoadedAt: missionsMeta?.storedAt || null
    };
  }

  async function refreshDataFromServer(key, options = {}) {
    resetBootstrapState();
    window.BremDataCache?.invalidate?.(key);
    if (TABLE_STORAGE_KEYS.has(key)) {
      activeStorageAdapter.invalidateKeys?.([key]);
    }
    if (key === KEYS.drivers) {
      clearDriversCacheHard();
      return fetchAllDriversFromServer({ force: true });
    }
    if (key === KEYS.missions) {
      return reloadMissions(true);
    }
    return refetchDataKey(key, options);
  }

  function dedupeDriversList(list) {
    const byId = new Map();
    (list || []).forEach(driver => {
      if (!driver?.id) return;
      byId.set(driver.id, driver);
    });

    const scoreOf = (driver) => {
      let score = 0;
      if (String(driver?.baeminId || '').trim()) score += 4;
      if (String(driver?.bankName || '').trim()) score += 2;
      if (String(driver?.accountNumber || '').trim()) score += 1;
      const updatedAt = Date.parse(driver?.updatedAt || driver?.createdAt || 0);
      if (!Number.isNaN(updatedAt)) score += updatedAt / 1e12;
      return score;
    };

    const byMatchKey = new Map();
    Array.from(byId.values()).forEach(driver => {
      const key = window.BremDriverUtils?.makeDriverMatchKey?.(driver.name, driver.phone) || '';
      const mapKey = key || `id:${driver.id}`;
      const existing = byMatchKey.get(mapKey);
      if (!existing || scoreOf(driver) > scoreOf(existing)) {
        byMatchKey.set(mapKey, driver);
      }
    });

    return Array.from(byMatchKey.values()).sort((a, b) => (
      String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    ));
  }

  function clearDriversCacheHard() {
    invalidateDriversNormalizeCache();
    setDriversCache([]);
    driversLoadMeta = { complete: false, supabaseTotal: 0 };
    window.BremDataCache?.invalidate?.(KEYS.drivers);
    activeStorageAdapter.invalidateKeys?.([KEYS.drivers]);
  }

  function markDriversLoadComplete(count, supabaseTotal) {
    driversLoadMeta = {
      complete: true,
      supabaseTotal: Number.isFinite(Number(supabaseTotal)) ? Number(supabaseTotal) : count
    };
  }

  async function continueDriverPagesInBackground(startOffset, pageSize, supabaseTotal) {
    if (driversBackgroundFetchPromise) return driversBackgroundFetchPromise;

    driversBackgroundFetchPromise = (async () => {
      let offset = startOffset;
      let hasMore = true;
      let pages = 0;
      let failed = false;
      try {
        while (hasMore && pages < 200) {
          const result = await syncDriversFromServer({
            limit: pageSize,
            offset,
            append: true
          });
          if (!result.ok) {
            failed = true;
            break;
          }
          if (supabaseTotal == null && result.total != null) supabaseTotal = result.total;
          hasMore = Boolean(result.hasMore);
          offset += result.count || pageSize;
          pages += 1;
          if (!result.count) break;
          document.dispatchEvent(new CustomEvent('brem-cache-status-changed'));
        }

        const deduped = dedupeDriversList(drivers.getAll());
        const total = Number(supabaseTotal ?? deduped.length);
        // 서버 total 은 DB 행 수, 로컬은 name+phone 중복제거 후라 적을 수 있다.
        // 페이지를 끝까지 받았으면(!hasMore) 전체 로드로 본다.
        const fullyLoaded = !failed && !hasMore;
        if (fullyLoaded) {
          markDriversLoadComplete(deduped.length, total);
          markDriversCache(deduped, { source: 'network', complete: true, supabaseTotal: total });
          document.dispatchEvent(new CustomEvent('brem-drivers-sync-ready', {
            detail: { complete: true, count: deduped.length, supabaseTotal: total }
          }));
        } else {
          driversLoadMeta = { complete: false, supabaseTotal: total || deduped.length };
          markDriversCache(deduped, { source: 'network', complete: false, supabaseTotal: total || deduped.length });
          document.dispatchEvent(new CustomEvent('brem-drivers-sync-ready', {
            detail: {
              complete: false,
              partial: true,
              failed,
              count: deduped.length,
              supabaseTotal: total || deduped.length
            }
          }));
          if (failed) {
            console.warn('[BREM] Background rider sync incomplete:', deduped.length, '/', total || '?');
          }
        }
      } catch (error) {
        console.warn('[BREM] Background rider sync failed:', error.message || error);
        const deduped = dedupeDriversList(drivers.getAll());
        driversLoadMeta = {
          complete: false,
          supabaseTotal: Number(supabaseTotal ?? driversLoadMeta.supabaseTotal ?? deduped.length)
        };
        markDriversCache(deduped, {
          source: 'network',
          complete: false,
          supabaseTotal: driversLoadMeta.supabaseTotal
        });
      } finally {
        driversBackgroundFetchPromise = null;
        driversFullFetchInProgress = false;
      }
    })();

    return driversBackgroundFetchPromise;
  }

  async function awaitDriversFullyLoaded(options = {}) {
    if (driversBackgroundFetchPromise) {
      await driversBackgroundFetchPromise;
    }
    if (driversFetchAllPromise) {
      await driversFetchAllPromise;
    }

    let serverTotal = Number(driversLoadMeta.supabaseTotal || 0);
    try {
      const counted = await countRidersViaServer();
      if (counted?.ok && Number(counted.count) > 0) {
        serverTotal = Number(counted.count);
        driversLoadMeta.supabaseTotal = serverTotal;
      }
    } catch (_error) {
      /* ignore count probe failures */
    }

    const count = drivers.getAll().length;
    // 중복제거로 count < serverTotal 인 것은 정상. complete 플래그만 본다.
    if (driversLoadMeta.complete && count > 0) {
      return { ok: true, count, supabaseTotal: serverTotal || count, complete: true };
    }

    const result = await fetchAllDriversFromServer({
      force: true,
      ...(options.view ? { view: options.view } : {})
    });
    if (driversBackgroundFetchPromise) await driversBackgroundFetchPromise;
    const loaded = drivers.getAll().length;
    const complete = Boolean(driversLoadMeta.complete);
    return {
      ok: result?.ok !== false && loaded > 0,
      count: loaded,
      supabaseTotal: driversLoadMeta.supabaseTotal || loaded,
      complete,
      partial: !complete,
      message: result?.message || (!complete ? '기사 목록을 끝까지 불러오지 못했습니다.' : undefined)
    };
  }

  async function fetchAllDriversFromServer(options = {}) {
    const force = options.force === true;
    const hasFilter = Boolean(String(options.search || '').trim())
      || (options.status && options.status !== '전체');

    if (!isProductionMode()) {
      if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.reloadRiders) {
        const pageSize = 200;
        let offset = 0;
        let hasMore = true;
        let supabaseTotal = null;

        if (force) clearDriversCacheHard();

        while (hasMore) {
          const result = await activeStorageAdapter.reloadRiders({
            limit: pageSize,
            offset,
            append: offset > 0,
            force: force && offset === 0,
            ...(options.view ? { view: options.view } : {})
          });
          const meta = activeStorageAdapter.getRidersMeta?.() || {};
          supabaseTotal = meta.total ?? supabaseTotal;
          hasMore = Boolean(meta.hasMore);
          offset += pageSize;
          if (!result?.riders?.length && !hasMore) break;
        }

        const deduped = dedupeDriversList(drivers.getAll());
        markDriversLoadComplete(deduped.length, supabaseTotal ?? deduped.length);
        markDriversCache(deduped, { source: 'network', complete: true });
        return {
          ok: true,
          count: deduped.length,
          supabaseTotal: supabaseTotal ?? deduped.length
        };
      }

      const list = drivers.getAll();
      markDriversLoadComplete(list.length, list.length);
      return { ok: true, count: list.length, supabaseTotal: list.length };
    }

    if (hasFilter) {
      return syncDriversFromServer({
        limit: options.limit || 200,
        offset: options.offset || 0,
        search: options.search || '',
        status: options.status || '',
        append: options.append === true
      });
    }

    if (!force && driversLoadMeta.complete && drivers.getAll().length > 0) {
      logDataSource('riders', true);
      return {
        ok: true,
        cached: true,
        count: drivers.getAll().length,
        supabaseTotal: driversLoadMeta.supabaseTotal
      };
    }

    if (driversFetchAllPromise && !force) return driversFetchAllPromise;

    const runFetch = async () => {
      logDataSource('riders', false);
      window.BremPerf?.time?.('storage.fetchAllDrivers');
      // raw_data 포함 SELECT는 페이지가 크면 타임아웃나기 쉬워 100명 단위로 받는다.
      const pageSize = Math.min(Math.max(Number(options.limit) || 100, 20), 200);
      let offset = 0;
      let hasMore = true;
      let supabaseTotal = null;
      let pages = 0;
      let failed = false;

      if (force) clearDriversCacheHard();

      driversFullFetchInProgress = true;
      try {
        while (hasMore && pages < 200) {
          const result = await syncDriversFromServer({
            limit: pageSize,
            offset,
            append: offset > 0,
            ...(options.view ? { view: options.view } : {})
          });
          if (!result.ok) {
            failed = true;
            if (drivers.getAll().length > 0) {
              const partial = dedupeDriversList(drivers.getAll());
              markDriversCache(partial, {
                source: 'network',
                complete: false,
                supabaseTotal: supabaseTotal ?? driversLoadMeta.supabaseTotal ?? partial.length
              });
              return {
                ok: true,
                cached: true,
                stale: true,
                partial: true,
                count: partial.length,
                supabaseTotal: driversLoadMeta.supabaseTotal
              };
            }
            clearDriversCacheHard();
            return {
              ok: false,
              message: result.message || result.error || '기사 목록을 Supabase에서 불러오지 못했습니다.'
            };
          }

          if (supabaseTotal == null && result.total != null) supabaseTotal = result.total;
          hasMore = Boolean(result.hasMore);
          offset += result.count || pageSize;
          pages += 1;
          if (!result.count) break;

          const dedupedAfterPage = dedupeDriversList(drivers.getAll());
          // 페이지를 다 받았으면 전체 로드. (중복제거로 로컬 수 < DB total 이어도 OK)
          const pageComplete = !hasMore;
          markDriversCache(dedupedAfterPage, {
            source: 'network',
            complete: pageComplete,
            supabaseTotal: supabaseTotal ?? dedupedAfterPage.length
          });
          document.dispatchEvent(new CustomEvent('brem-cache-status-changed'));

          if (!force && pages === 1 && hasMore) {
            void continueDriverPagesInBackground(offset, pageSize, supabaseTotal);
            window.BremPerf?.timeEnd?.('storage.fetchAllDrivers');
            document.dispatchEvent(new CustomEvent('brem-drivers-sync-ready', {
              detail: {
                complete: false,
                partial: true,
                count: dedupedAfterPage.length,
                supabaseTotal: supabaseTotal ?? dedupedAfterPage.length
              }
            }));
            return {
              ok: true,
              partial: true,
              count: dedupedAfterPage.length,
              supabaseTotal: supabaseTotal ?? dedupedAfterPage.length
            };
          }
        }

        const deduped = dedupeDriversList(drivers.getAll());
        const total = Number(supabaseTotal ?? deduped.length);
        const fullyLoaded = !failed && !hasMore;
        if (fullyLoaded) {
          markDriversLoadComplete(deduped.length, total);
          markDriversCache(deduped, { source: 'network', complete: true, supabaseTotal: total });
        } else {
          markDriversCache(deduped, { source: 'network', complete: false, supabaseTotal: total || deduped.length });
        }
        document.dispatchEvent(new CustomEvent('brem-cache-status-changed'));
        window.BremPerf?.timeEnd?.('storage.fetchAllDrivers');
        document.dispatchEvent(new CustomEvent('brem-drivers-sync-ready', {
          detail: {
            complete: fullyLoaded,
            partial: !fullyLoaded,
            count: deduped.length,
            supabaseTotal: total || deduped.length
          }
        }));
        return {
          ok: true,
          partial: !fullyLoaded,
          count: deduped.length,
          supabaseTotal: total || deduped.length
        };
      } finally {
        if (!driversBackgroundFetchPromise) {
          driversFullFetchInProgress = false;
        }
      }
    };

    if (force) return runFetch();

    if (driversFetchAllPromise) return driversFetchAllPromise;

    driversFetchAllPromise = runFetch().finally(() => {
      driversFetchAllPromise = null;
    });
    return driversFetchAllPromise;
  }

  async function waitForDriversFetch() {
    if (driversFetchAllPromise) {
      return driversFetchAllPromise;
    }
    return {
      ok: true,
      cached: driversLoadMeta.complete,
      count: drivers.getAll().length,
      supabaseTotal: driversLoadMeta.supabaseTotal
    };
  }

  async function syncDriversFromServer(options = {}) {
    if (!isProductionMode()) {
      return { ok: false, message: '운영 환경에서만 서버 동기화를 사용합니다.' };
    }

    window.BremPerf?.time?.('storage.syncDriversFromServer');
    const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 200);
    const offset = Math.max(Number(options.offset) || 0, 0);
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset)
    });
    if (options.view === 'list') params.set('view', 'list');
    const search = String(options.search || '').trim();
    const status = String(options.status || '').trim();
    if (search) params.set('search', search);
    if (status && status !== '전체') params.set('status', status);

    const fetchRiders = () => adminRidersApi(`/api/admin/riders?${params.toString()}`);
    let result = await fetchRiders();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await fetchRiders();
    }
    if (!result.ok) {
      if (!options.append && drivers.getAll().length > 0) {
        return {
          ok: true,
          cached: true,
          stale: true,
          count: drivers.getAll().length,
          total: driversLoadMeta.supabaseTotal || drivers.getAll().length,
          hasMore: false
        };
      }
      if (!options.append) clearDriversCacheHard();
      return result;
    }

    const mapper = window.BremSupabaseMapper;
    if (!mapper?.rowToRider) {
      return { ok: false, message: '기사 데이터 변환 모듈이 없습니다.' };
    }

    const riderRows = (result.riders || []).map(row => mapper.rowToRider(row));
    if (options.append) {
      const merged = new Map(drivers.getAll().map(item => [item.id, item]));
      riderRows.forEach(item => merged.set(item.id, item));
      markDriversCache(Array.from(merged.values()), { source: 'network' });
    } else {
      markDriversCache(riderRows, { source: 'network' });
    }
    if (!options.append && !String(options.search || '').trim() && (!options.status || options.status === '전체')) {
      window.BremDataCache?.set?.(KEYS.drivers, drivers.getAll());
    }
    if (!options.append && !String(options.search || '').trim() && (!options.status || options.status === '전체')) {
      if (!driversFullFetchInProgress) {
        driversLoadMeta = { complete: false, supabaseTotal: result.total ?? riderRows.length };
      }
    }
    window.BremPerf?.timeEnd?.('storage.syncDriversFromServer');
    return {
      ok: true,
      count: riderRows.length,
      total: result.total ?? riderRows.length,
      hasMore: Boolean(result.hasMore)
    };
  }

  async function syncAllDriversPagesInBackground() {
    if (!isProductionMode()) return { ok: true };
    return fetchAllDriversFromServer({ force: false });
  }

  async function deleteAllRidersViaServer() {
    const deleteAll = () => adminRidersApi('/api/admin/riders/all', { method: 'DELETE' });

    let result = await deleteAll();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await deleteAll();
    }
    if (!result.ok) {
      throw new Error(result.message || result.error || 'Supabase에서 기사 전체 삭제에 실패했습니다.');
    }
    return result;
  }

  async function countRidersViaServer() {
    const fetchCount = () => adminRidersApi('/api/admin/riders/count');
    let result = await fetchCount();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await fetchCount();
    }
    if (result.ok) return result;

    const listFallback = await adminRidersApi('/api/admin/riders?limit=1&offset=0');
    if (listFallback.ok) {
      return {
        ok: true,
        count: listFallback.total ?? (listFallback.riders || []).length
      };
    }
    return result;
  }

  function isRiderSelfUpdate(id) {
    if (!activeSupabaseProfile || activeSupabaseProfile.role !== 'rider') return false;
    return String(activeSupabaseProfile.rider_id || '') === String(id || '');
  }

  function isRiderProductionSession() {
    return isProductionMode()
      && activeSupabaseProfile?.role === 'rider'
      && activeSupabaseProfile?.active !== false;
  }

  function invalidateNoticesCache() {
    window.BremDataCache?.invalidate?.(KEYS.notices);
    if (activeStorageAdapter.invalidateKeys) {
      activeStorageAdapter.invalidateKeys([KEYS.notices]);
    }
  }

  async function persistRiderSelfViaServer(id, changes = {}) {
    const token = await resolveAdminAccessToken();
    if (!token) {
      throw new Error('로그인 세션이 없습니다. 다시 로그인하세요.');
    }

    const body = {};
    if (changes.bankName !== undefined) body.bankName = changes.bankName;
    if (changes.accountHolder !== undefined) body.accountHolder = changes.accountHolder;
    if (changes.accountNumber !== undefined) body.accountNumber = changes.accountNumber;
    if (changes.residentNumber !== undefined) body.residentNumber = changes.residentNumber;
    if (changes.currentPassword !== undefined) body.currentPassword = changes.currentPassword;
    if (changes.newPassword !== undefined) body.newPassword = changes.newPassword;

    const response = await fetch('/api/rider/profile', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || '기사 정보를 저장하지 못했습니다.');
    }

    const mapper = window.BremSupabaseMapper;
    if (payload.rider && mapper?.rowToRider) {
      mergeRiderInCache(payload.rider);
    }

    return payload;
  }

  async function persistRiderViaServer(rider) {
    const riderPayload = rider?.passwordExplicit
      ? rider
      : (() => {
        const payload = { ...(rider || {}) };
        delete payload.password;
        delete payload.passwordExplicit;
        return payload;
      })();

    const postRider = () => adminRidersApi('/api/admin/riders', {
      method: 'POST',
      body: JSON.stringify({ rider: riderPayload })
    });

    let result = await postRider();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await postRider();
    }
    if (!result.ok) {
      throw new Error(result.message || 'Supabase에 기사를 저장하지 못했습니다.');
    }

    const mapper = window.BremSupabaseMapper;
    if (result.rider && mapper?.rowToRider) {
      const saved = mapper.rowToRider(result.rider);
      const list = drivers.getAll();
      const index = list.findIndex(item => item.id === saved.id);
      if (index >= 0) {
        const prevPassword = list[index].password;
        list[index] = {
          ...list[index],
          ...saved,
          password: rider.passwordExplicit && rider.password
            ? String(rider.password).trim()
            : (saved.password && saved.password !== '1234' ? saved.password : (prevPassword || saved.password))
        };
      } else {
        list.unshift(saved);
      }
      setDriversCache(list);
    }

    return result;
  }

  async function resetRiderPasswordViaServer(id, defaultPassword = '1234') {
    const riderId = String(id || '').trim();
    if (!riderId) throw new Error('기사 ID가 없습니다.');

    const postReset = () => adminRidersApi(
      `/api/admin/riders/${encodeURIComponent(riderId)}/reset-password`,
      {
        method: 'POST',
        body: JSON.stringify({ password: String(defaultPassword || '1234').trim() || '1234' })
      }
    );

    let result = await postReset();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await postReset();
    }
    if (!result.ok) {
      throw new Error(result.message || result.error || '비밀번호 초기화에 실패했습니다.');
    }

    const mapper = window.BremSupabaseMapper;
    if (result.rider && mapper?.rowToRider) {
      const saved = mapper.rowToRider(result.rider);
      const list = drivers.getAll();
      const index = list.findIndex(item => item.id === saved.id);
      if (index >= 0) {
        list[index] = { ...list[index], ...saved, password: String(defaultPassword || '1234').trim() || '1234' };
      }
      markDriversCache(list, { source: 'write' });
    }

    return result;
  }

  async function persistRidersBulkViaServer(riders, options = {}) {
    const sanitized = (Array.isArray(riders) ? riders : []).map(item => {
      if (!item || item.passwordExplicit) return item;
      const payload = { ...item };
      delete payload.password;
      delete payload.passwordExplicit;
      return payload;
    });

    const postBulk = () => adminRidersApi('/api/admin/riders/bulk', {
      method: 'POST',
      body: JSON.stringify({
        riders: sanitized,
        skipAuthProvision: options.skipAuthProvision !== false,
        maxBatch: options.maxBatch || 300
      })
    });

    let result = await postBulk();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await postBulk();
    }
    if (!result.ok) {
      throw new Error(result.message || result.error || 'Supabase에 기사를 일괄 저장하지 못했습니다.');
    }
    return result;
  }

  const MISSION_DRIVER_FIELDS = new Set([
    'selectedMissionId',
    'selectedMissionIdBaemin',
    'selectedMissionIdCoupang',
    'promotionRuleIdBaemin',
    'promotionRuleIdCoupang',
    'promotionSelectorBaemin',
    'promotionSelectorCoupang'
  ]);

  const LONG_EVENT_DRIVER_FIELDS = new Set([
    'longEventItemId',
    'longEventItem',
    'longEventStartDate',
    'longEventPlatform'
  ]);

  function isMissionOnlyChanges(changes = {}) {
    const keys = Object.keys(changes || {}).filter(key => key !== 'updatedAt');
    return keys.length > 0 && keys.every(key => MISSION_DRIVER_FIELDS.has(key));
  }

  function extractMissionChanges(changes = {}) {
    const patch = {};
    if (changes.selectedMissionIdBaemin !== undefined) {
      patch.selectedMissionIdBaemin = changes.selectedMissionIdBaemin;
    }
    if (changes.selectedMissionIdCoupang !== undefined) {
      patch.selectedMissionIdCoupang = changes.selectedMissionIdCoupang;
    }
    if (changes.selectedMissionId !== undefined) {
      patch.selectedMissionId = changes.selectedMissionId;
    }
    if (changes.promotionRuleIdBaemin !== undefined) {
      patch.promotionRuleIdBaemin = changes.promotionRuleIdBaemin;
    }
    if (changes.promotionRuleIdCoupang !== undefined) {
      patch.promotionRuleIdCoupang = changes.promotionRuleIdCoupang;
    }
    if (changes.promotionSelectorBaemin !== undefined) {
      patch.promotionSelectorBaemin = changes.promotionSelectorBaemin;
    }
    if (changes.promotionSelectorCoupang !== undefined) {
      patch.promotionSelectorCoupang = changes.promotionSelectorCoupang;
    }
    return patch;
  }

  function isLongEventOnlyChanges(changes = {}) {
    const keys = Object.keys(changes || {}).filter(key => key !== 'updatedAt');
    return keys.length > 0 && keys.every(key => LONG_EVENT_DRIVER_FIELDS.has(key));
  }

  function flattenMissionPatch(item) {
    if (!item?.id) return null;
    const patch = { id: item.id };
    const source = (item.changes && typeof item.changes === 'object') ? item.changes : item;
    if (source.selectedMissionIdBaemin !== undefined) {
      patch.selectedMissionIdBaemin = source.selectedMissionIdBaemin;
    }
    if (source.selectedMissionIdCoupang !== undefined) {
      patch.selectedMissionIdCoupang = source.selectedMissionIdCoupang;
    }
    if (source.selectedMissionId !== undefined) {
      patch.selectedMissionId = source.selectedMissionId;
    }
    if (source.promotionRuleIdBaemin !== undefined) {
      patch.promotionRuleIdBaemin = source.promotionRuleIdBaemin;
    }
    if (source.promotionRuleIdCoupang !== undefined) {
      patch.promotionRuleIdCoupang = source.promotionRuleIdCoupang;
    }
    if (source.promotionSelectorBaemin !== undefined) {
      patch.promotionSelectorBaemin = source.promotionSelectorBaemin;
    }
    if (source.promotionSelectorCoupang !== undefined) {
      patch.promotionSelectorCoupang = source.promotionSelectorCoupang;
    }
    return patch.selectedMissionId !== undefined
      || patch.selectedMissionIdBaemin !== undefined
      || patch.selectedMissionIdCoupang !== undefined
      || patch.promotionRuleIdBaemin !== undefined
      || patch.promotionRuleIdCoupang !== undefined
      || patch.promotionSelectorBaemin !== undefined
      || patch.promotionSelectorCoupang !== undefined
      ? patch
      : null;
  }

  async function persistRiderMissionsBulkViaServer(patches, options = {}) {
    const payload = (Array.isArray(patches) ? patches : [])
      .map(flattenMissionPatch)
      .filter(Boolean);
    if (!payload.length) {
      return { ok: true, updated: 0 };
    }

    const postBulk = () => adminRidersApi('/api/admin/riders/missions/bulk', {
      method: 'POST',
      body: JSON.stringify({
        patches: payload,
        maxBatch: options.maxBatch || 300
      })
    });

    let result = await postBulk();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await postBulk();
    }
    if (!result.ok) {
      throw new Error(result.message || result.error || 'Supabase에 기사 미션을 저장하지 못했습니다.');
    }
    return result;
  }

  function flattenLongEventPatch(item) {
    if (!item?.id) return null;
    const patch = { id: item.id };
    const source = item.changes && typeof item.changes === 'object' ? item.changes : item;
    if (source.longEventItemId !== undefined) patch.longEventItemId = source.longEventItemId;
    if (source.longEventItem !== undefined) patch.longEventItem = source.longEventItem;
    if (source.longEventStartDate !== undefined) patch.longEventStartDate = source.longEventStartDate;
    if (source.longEventPlatform !== undefined) patch.longEventPlatform = source.longEventPlatform;
    const hasField = ['longEventItemId', 'longEventItem', 'longEventStartDate', 'longEventPlatform']
      .some(key => patch[key] !== undefined);
    return hasField ? patch : null;
  }

  async function persistRiderLongEventsBulkViaServer(patches, options = {}) {
    const payload = (Array.isArray(patches) ? patches : [])
      .map(flattenLongEventPatch)
      .filter(Boolean);
    if (!payload.length) {
      return { ok: true, updated: 0 };
    }

    const postBulk = () => adminRidersApi('/api/admin/riders/long-events/bulk', {
      method: 'POST',
      body: JSON.stringify({
        patches: payload,
        maxBatch: options.maxBatch || 300
      })
    });

    let result = await postBulk();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await postBulk();
    }
    if (!result.ok) {
      throw new Error(result.message || result.error || 'Supabase에 장기근속 이벤트를 저장하지 못했습니다.');
    }
    return result;
  }

  async function persistRiderTargetsViaServer(body = {}) {
    const token = await resolveAdminAccessToken();
    if (!token) {
      throw new Error('로그인 세션이 없습니다. 다시 로그인하세요.');
    }

    const response = await fetch('/api/rider/targets', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || '목표를 저장하지 못했습니다.');
    }
    return payload;
  }

  async function fetchRiderAssignedMissionsFromServer() {
    const token = await resolveAdminAccessToken();
    if (!token) {
      return { ok: false, message: '로그인 세션이 없습니다.' };
    }

    try {
      const response = await fetch('/api/rider/missions', {
        credentials: 'same-origin',
        headers: { Authorization: `Bearer ${token}` }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, message: payload.error || '미션 정보를 불러오지 못했습니다.' };
      }

      const mapper = window.BremSupabaseMapper;
      const missions = payload.missions || {};
      const mapped = {
        baemin: missions.baemin && mapper?.rowToMission ? mapper.rowToMission(missions.baemin) : null,
        coupang: missions.coupang && mapper?.rowToMission ? mapper.rowToMission(missions.coupang) : null
      };

      const current = storageAdapter.read(KEYS.missions, []) || [];
      const merged = new Map((Array.isArray(current) ? current : []).map(item => [item.id, item]));
      Object.values(mapped).forEach(mission => {
        if (mission?.id) merged.set(mission.id, mission);
      });
      if (merged.size) {
        markMissionsCache(Array.from(merged.values()));
      }

      return { ok: true, missions: mapped, riderId: payload.riderId || null };
    } catch (error) {
      return { ok: false, message: error.message || '미션 정보 요청에 실패했습니다.' };
    }
  }

  function applyRiderLongEventProgressToDriver(driver, progress = {}) {
    const unset = progress.status === 'unset' || (!progress.itemId && !progress.itemName);
    return {
      ...driver,
      longEventItemId: unset ? '' : (progress.itemId || ''),
      longEventItem: unset ? '' : (progress.itemName || ''),
      longEventStartDate: unset ? '' : (progress.startDate || ''),
      longEventPlatform: normalizeLongEventPlatform(progress.platform || driver.longEventPlatform)
    };
  }

  function stageRiderScopedCache(key, value, meta = {}) {
    if (activeStorageAdapter.stage) {
      activeStorageAdapter.stage(key, value);
    } else {
      try {
        storageAdapter.write(key, value);
      } catch {
        /* ignore */
      }
    }
    window.BremDataCache?.set?.(key, value, { source: 'rider-dashboard', ...meta });
  }

  function mergeRiderDashboardInCache(payload = {}) {
    const mapper = window.BremSupabaseMapper;

    if (Array.isArray(payload.calls)) {
      const callRows = payload.calls.map(row => ({
        id: row.id,
        driverId: row.driver_id || '',
        date: String(row.date || '').slice(0, 10),
        platform: row.platform || 'coupang',
        count: Number(row.count) || 0,
        riderPublishedAt: row.rider_published_at || null
      }));
      stageRiderScopedCache(KEYS.calls, callRows, { tableLoaded: true });
    }

    if (Array.isArray(payload.rejections)) {
      const rejectionRows = payload.rejections.map(row => {
        const stats = row.stats && typeof row.stats === 'object' ? row.stats : {};
        const unmeasured = stats.unmeasured === true;
        return {
          id: row.id,
          driverId: row.driver_id || '',
          weekStart: row.week_start,
          platform: row.platform || 'coupang',
          rate: unmeasured ? null : Number(row.rate) || 0,
          stats,
          source: row.source || 'manual',
          updatedAt: row.updated_at,
          riderPublishedAt: row.rider_published_at || null
        };
      });
      stageRiderScopedCache(KEYS.rejections, rejectionRows, { tableLoaded: true });
    }

    if (Array.isArray(payload.targets)) {
      const targetRows = payload.targets.map(row => ({
        id: row.id,
        driverId: row.driver_id || '',
        month: row.month || '',
        count: Number(row.count) || 0,
        riderPublishedAt: row.rider_published_at || null
      }));
      stageRiderScopedCache(KEYS.targets, targetRows, { tableLoaded: true });
    }

    if (Array.isArray(payload.weeklyTargets)) {
      stageRiderScopedCache(KEYS.weeklyTargets, payload.weeklyTargets);
    }

    if (Array.isArray(payload.notices) && !isRiderProductionSession()) {
      mergeNoticesRowsInCache(payload.notices);
    }

    (payload.settings || []).forEach(row => {
      if (!row?.key) return;
      stageRiderScopedCache(row.key, row.value);
    });

    if (payload.longEvent && typeof payload.longEvent === 'object') {
      riderLongEventProgress = { ...payload.longEvent };
      const riderId = String(payload.riderId || activeSupabaseProfile?.rider_id || '').trim();
      if (riderId) {
        const list = drivers.getAll();
        const index = list.findIndex(item => item.id === riderId);
        if (index >= 0) {
          const progress = payload.longEvent;
          list[index] = applyRiderLongEventProgressToDriver(list[index], progress);
          markDriversCache(list, { source: 'rider-dashboard' });
        }
      }
    }

    document.dispatchEvent(new CustomEvent('brem-cache-status-changed'));
  }

  const DRIVER_FETCH_TIMEOUT_MS = 12000;
  const REGION_DASHBOARD_TIMEOUT_MS = 20000;
  let driverAppBundlePromise = null;
  let lastDriverAppPublishedAt = null;

  async function riderApiFetch(path, label = 'request', options = {}) {
    const token = await resolveAdminAccessToken();
    if (!token) {
      return { ok: false, message: '로그인 세션이 없습니다.' };
    }

    const timeoutMs = Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : DRIVER_FETCH_TIMEOUT_MS;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    const method = String(options.method || 'GET').toUpperCase();
    const headers = {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    };
    if (method !== 'GET' && method !== 'HEAD' && options.body != null && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    try {
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers,
        body: options.body,
        signal: controller?.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, message: payload.error || '요청에 실패했습니다.' };
      }
      return { ok: true, ...payload };
    } catch (error) {
      return {
        ok: false,
        message: error?.name === 'AbortError'
          ? `${label} 시간이 초과되었습니다.`
          : (error.message || '요청에 실패했습니다.')
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function fetchRiderWeeklyPayslipFromServer(weekStart) {
    const qs = weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : '';
    return riderApiFetch(`/api/rider/weekly-payslip${qs}`, 'weekly-payslip');
  }

  async function fetchRiderRegionDashboardFromServer({ platform, regionKey, weekStart } = {}) {
    const params = new URLSearchParams();
    if (platform) params.set('platform', String(platform));
    if (regionKey) params.set('regionKey', String(regionKey));
    if (weekStart) params.set('weekStart', String(weekStart).slice(0, 10));
    const qs = params.toString() ? `?${params.toString()}` : '';
    // 지역 대시보드는 집계가 길어질 수 있어 전용 타임아웃을 쓴다.
    return riderApiFetch(`/api/rider/region-dashboard${qs}`, 'region-dashboard', {
      timeoutMs: REGION_DASHBOARD_TIMEOUT_MS
    });
  }

  async function fetchRiderWithdrawalFromServer(weekStart) {
    const qs = weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : '';
    return riderApiFetch(`/api/rider/withdrawal${qs}`, 'withdrawal');
  }

  async function submitRiderWithdrawalToServer({ weekStart, amount, platform } = {}) {
    return riderApiFetch('/api/rider/withdrawal', 'withdrawal-create', {
      method: 'POST',
      body: JSON.stringify({
        weekStart: String(weekStart || '').slice(0, 10),
        amount: Math.max(0, Math.round(Number(amount) || 0)),
        platform: String(platform || '').trim().toLowerCase()
      })
    });
  }

  async function fetchAdminWithdrawalRequestsFromServer({ weekStart, date, status, view, completedDate } = {}) {
    const params = new URLSearchParams();
    if (date) params.set('date', String(date).slice(0, 10));
    if (weekStart) params.set('weekStart', String(weekStart).slice(0, 10));
    if (status) params.set('status', String(status));
    if (view) params.set('view', String(view));
    if (completedDate) params.set('completedDate', String(completedDate).slice(0, 10));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return adminRidersApi(`/api/admin/payroll/withdrawal-requests${qs}`);
  }

  async function cancelAdminWithdrawalRequest(requestId) {
    const id = encodeURIComponent(String(requestId || '').trim());
    return adminRidersApi(`/api/admin/payroll/withdrawal-requests/${id}/cancel`, {
      method: 'POST',
      body: '{}'
    });
  }

  async function completeAdminWithdrawalRequest(requestId) {
    const id = encodeURIComponent(String(requestId || '').trim());
    return adminRidersApi(`/api/admin/payroll/withdrawal-requests/${id}/complete`, {
      method: 'POST',
      body: '{}'
    });
  }

  async function updateAdminWithdrawalRequestPlatform(requestId, platform) {
    const id = encodeURIComponent(String(requestId || '').trim());
    return adminRidersApi(`/api/admin/payroll/withdrawal-requests/${id}/platform`, {
      method: 'POST',
      body: JSON.stringify({ platform: String(platform || '').trim().toLowerCase() })
    });
  }

  async function publishDirectSettlementPayslips({ weekStart, rows } = {}) {
    return adminRidersApi('/api/admin/payroll/direct-payslip/publish', {
      method: 'POST',
      body: JSON.stringify({
        weekStart: String(weekStart || '').slice(0, 10),
        rows: Array.isArray(rows) ? rows : []
      })
    });
  }

  async function autoFixAdminWithdrawalPlatforms({ weekStart, dryRun } = {}) {
    return adminRidersApi('/api/admin/payroll/withdrawal-requests/auto-fix-platform', {
      method: 'POST',
      body: JSON.stringify({
        weekStart: String(weekStart || '').slice(0, 10),
        dryRun: dryRun === true
      })
    });
  }

  async function deleteAdminWithdrawalRequest(requestId) {
    const id = encodeURIComponent(String(requestId || '').trim());
    return adminRidersApi(`/api/admin/payroll/withdrawal-requests/${id}`, {
      method: 'DELETE'
    });
  }

  async function fetchWithdrawableDriversFromServer(weekStart) {
    const params = new URLSearchParams();
    if (weekStart) params.set('weekStart', String(weekStart).slice(0, 10));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return adminRidersApi(`/api/admin/payroll/withdrawable-drivers${qs}`);
  }

  async function adminCreateWithdrawalRequestOnServer(payload = {}) {
    return adminRidersApi('/api/admin/payroll/withdrawal-requests/admin-create', {
      method: 'POST',
      body: JSON.stringify({
        driverId: String(payload.driverId || '').trim(),
        driverName: String(payload.driverName || '').trim(),
        platform: String(payload.platform || '').trim(),
        weekStart: String(payload.weekStart || '').slice(0, 10),
        amount: Math.max(0, Math.round(Number(payload.amount || 0))),
        mode: payload.mode === 'complete' ? 'complete' : 'request',
        allowExceed: payload.allowExceed === true
      })
    });
  }

  function mergeRiderMissionsPayload(missions = {}) {
    const mapper = window.BremSupabaseMapper;
    const mapped = {
      baemin: missions.baemin && mapper?.rowToMission ? mapper.rowToMission(missions.baemin) : null,
      coupang: missions.coupang && mapper?.rowToMission ? mapper.rowToMission(missions.coupang) : null
    };
    const current = storageAdapter.read(KEYS.missions, []) || [];
    const merged = new Map((Array.isArray(current) ? current : []).map(item => [item.id, item]));
    Object.values(mapped).forEach(mission => {
      if (mission?.id) merged.set(mission.id, mission);
    });
    if (merged.size) {
      markMissionsCache(Array.from(merged.values()));
    }
    return mapped;
  }

  function mergeRiderSnapshotInCache(payload = {}) {
    mergeRiderDashboardInCache({
      riderId: payload.riderId,
      calls: payload.calls,
      rejections: payload.rejections,
      settings: payload.settings
    });

    if (payload.missions) {
      mergeRiderMissionsPayload(payload.missions);
    }

    if (payload.publishedAt) {
      lastDriverAppPublishedAt = payload.publishedAt;
      const existing = storageAdapter.read(KEYS.riderViewPublish, {}) || {};
      stageRiderScopedCache(KEYS.riderViewPublish, {
        ...existing,
        publishedAt: payload.publishedAt
      });
    }

    (payload.settings || []).forEach(row => {
      if (row?.key === 'brem_rider_published_long_event_catalog') {
        stageRiderScopedCache(KEYS.eventCatalog, row.value);
      }
      if (row?.key === 'brem_rider_published_long_event_items') {
        stageRiderScopedCache(KEYS.eventItems, row.value);
      }
    });
  }

  function mergeRiderLiveInCache(payload = {}) {
    if (payload.rider) {
      mergeRiderInCache(payload.rider);
    }

    if (Array.isArray(payload.targets)) {
      const targetRows = payload.targets.map(row => ({
        id: row.id,
        driverId: row.driver_id || '',
        month: row.month || '',
        count: Number(row.count) || 0,
        updatedAt: row.updated_at || null
      }));
      stageRiderScopedCache(KEYS.targets, targetRows, { tableLoaded: true });
    }

    if (Array.isArray(payload.weeklyTargets)) {
      stageRiderScopedCache(KEYS.weeklyTargets, payload.weeklyTargets);
    }

    (payload.settings || []).forEach(row => {
      if (!row?.key) return;
      stageRiderScopedCache(row.key, row.value);
      if (row.key === 'brem_rider_published_long_event_catalog') {
        stageRiderScopedCache(KEYS.eventCatalog, row.value);
      }
      if (row.key === 'brem_rider_published_long_event_items') {
        stageRiderScopedCache(KEYS.eventItems, row.value);
      }
    });

    if (payload.longEvent && typeof payload.longEvent === 'object') {
      riderLongEventProgress = { ...payload.longEvent };
      const riderId = String(payload.riderId || activeSupabaseProfile?.rider_id || '').trim();
      if (riderId) {
        const list = drivers.getAll();
        const index = list.findIndex(item => item.id === riderId);
        if (index >= 0) {
          const progress = payload.longEvent;
          list[index] = applyRiderLongEventProgressToDriver(list[index], progress);
          markDriversCache(list, { source: 'rider-live' });
        }
      }
    }

    const liveRiderId = String(payload.riderId || payload.rider?.id || '').trim();

    // 키가 있을 때만 해당 플랫폼을 갱신한다. (한쪽 응답 때문에 다른쪽을 비우지 않음)
    if (Object.prototype.hasOwnProperty.call(payload, 'baeminOps')) {
      if (payload.baeminOps && typeof payload.baeminOps === 'object') {
        riderBaeminOpsCache = {
          ...payload.baeminOps,
          riderId: liveRiderId || payload.baeminOps.riderId || '',
          cachedAt: new Date().toISOString()
        };
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'coupangOps')) {
      if (payload.coupangOps && typeof payload.coupangOps === 'object') {
        riderCoupangOpsCache = {
          ...payload.coupangOps,
          riderId: liveRiderId || payload.coupangOps.riderId || '',
          cachedAt: new Date().toISOString()
        };
      }
    }

    document.dispatchEvent(new CustomEvent('brem-cache-status-changed'));
  }

  function mergeRiderNoticesInCache(payload = {}) {
    const mapper = window.BremSupabaseMapper;
    const noticeRows = (payload.notices || [])
      .map(row => (mapper?.rowToNotice ? mapper.rowToNotice(row) : row))
      .filter(notice => notice.noticeKind !== 'payroll' && !String(notice.id || '').startsWith('payroll-'));
    markNoticesCache(noticeRows, { source: 'server' });
    return noticeRows;
  }

  function getDriverAppPublishedAt() {
    if (lastDriverAppPublishedAt) return lastDriverAppPublishedAt;
    const meta = riderViewPublish.getMeta?.() || {};
    if (meta.publishedAt) return meta.publishedAt;
    return rejections.getAll?.()
      .map(entry => entry.riderPublishedAt)
      .filter(Boolean)
      .sort()
      .reverse()[0] || null;
  }

  function isPublishTimestampNewer(remoteAt, localAt) {
    if (!remoteAt) return false;
    if (!localAt) return true;
    const remoteMs = Date.parse(remoteAt);
    const localMs = Date.parse(localAt);
    if (Number.isFinite(remoteMs) && Number.isFinite(localMs)) {
      return remoteMs > localMs;
    }
    return String(remoteAt) > String(localAt);
  }

  async function fetchRiderPublishStatus(options = {}) {
    if (!isProductionMode() || !isRiderProductionSession()) {
      const meta = riderViewPublish.getMeta?.() || {};
      return { ok: true, publishedAt: meta.publishedAt || null };
    }
    if (
      !options.force
      && lastRiderPublishStatusResult
      && Date.now() - lastRiderPublishStatusAt < RIDER_PUBLISH_STATUS_CACHE_MS
    ) {
      return lastRiderPublishStatusResult;
    }
    const result = await riderApiFetch('/api/rider/publish-status', 'publish-status');
    if (result.ok) {
      lastRiderPublishStatusAt = Date.now();
      lastRiderPublishStatusResult = result;
    }
    return result;
  }

  async function checkDriverAppPublishUpdate(options = {}) {
    const riderId = String(
      options.riderId
      || activeSupabaseProfile?.rider_id
      || sessionAdapter.read(SESSION_KEYS.driverId, '')
    ).trim();
    if (!riderId) {
      return { ok: false, refreshed: false, message: '기사 정보가 없습니다.' };
    }

    if (options.force) {
      invalidateDriverAppCache(riderId);
      const result = await loadDriverAppBundle({
        force: true,
        riderId,
        skipPublishCheck: true
      });
      return {
        ok: Boolean(result?.ok),
        refreshed: true,
        publishedAt: getDriverAppPublishedAt(),
        result
      };
    }

    const status = await fetchRiderPublishStatus();
    if (!status.ok) {
      return {
        ok: false,
        refreshed: false,
        message: status.message || status.error || '반영 시각 확인에 실패했습니다.'
      };
    }

    const localAt = getDriverAppPublishedAt();
    if (!isPublishTimestampNewer(status.publishedAt, localAt)) {
      return { ok: true, refreshed: false, publishedAt: localAt };
    }

    invalidateDriverAppCache(riderId);
    const result = await loadDriverAppBundle({
      force: true,
      riderId,
      skipPublishCheck: true
    });
    return {
      ok: Boolean(result?.ok),
      refreshed: true,
      publishedAt: getDriverAppPublishedAt(),
      result
    };
  }

  let riderLongEventProgress = null;
  let riderBaeminOpsCache = null;
  let riderCoupangOpsCache = null;

  function clearRiderLiveOpsCache() {
    riderBaeminOpsCache = null;
    riderCoupangOpsCache = null;
    riderLongEventProgress = null;
  }

  function invalidateDriverAppCache(riderId) {
    if (riderId) {
      window.BremDriverDataCache?.invalidate?.(riderId);
    } else {
      window.BremDriverDataCache?.clearAll?.();
    }
    // 실시간 ops는 로그아웃/기사전환 시에만 비운다. publish 갱신마다 지우면 쿠팡 카드가 깜빡인다.
    lastDriverAppPublishedAt = null;
  }

  async function loadDriverAppBundle(options = {}) {
    if (driverAppBundlePromise && !options.force) return driverAppBundlePromise;

    const run = async () => {
      console.info('[BREM:data] driver load start');
      const riderId = String(
        options.riderId
        || activeSupabaseProfile?.rider_id
        || sessionAdapter.read(SESSION_KEYS.driverId, '')
      ).trim();

      // 이전 기사 캐시가 남아 있을 때만 비움 (같은 기사 재로딩에서는 유지)
      const prevBaeminRider = String(riderBaeminOpsCache?.riderId || '').trim();
      const prevCoupangRider = String(riderCoupangOpsCache?.riderId || '').trim();
      const prevRider = prevBaeminRider || prevCoupangRider;
      if (riderId && prevRider && prevRider !== riderId) {
        clearRiderLiveOpsCache();
      }

      if (!isProductionMode() || !isRiderProductionSession()) {
        const hydrated = await ensureSupabaseHydrated({ skipDriversSync: true });
        if (!hydrated.ok) return hydrated;
        if (activeStorageAdapter.ensureKeysLoaded) {
          await activeStorageAdapter.ensureKeysLoaded([
            KEYS.calls,
            KEYS.rejections,
            KEYS.targets
          ], { force: Boolean(options.force) });
        }
        await reloadNotices(Boolean(options.force)).catch(() => ({}));
        console.info('[BREM:data] driver load done');
        return { ok: true, dev: true };
      }

      const force = options.force === true;
      const cache = window.BremDriverDataCache;

      const snapshotCached = !force && riderId ? cache?.read?.(riderId, 'snapshot') : null;
      const liveCached = !force && riderId ? cache?.read?.(riderId, 'live') : null;
      const noticesCached = !force && riderId ? cache?.read?.(riderId, 'notices') : null;

      if (snapshotCached && liveCached && noticesCached) {
        if (!options.skipPublishCheck && !force) {
          const status = await fetchRiderPublishStatus();
          if (status.ok && isPublishTimestampNewer(status.publishedAt, getDriverAppPublishedAt())) {
            invalidateDriverAppCache(riderId);
            return loadDriverAppBundle({
              ...options,
              force: true,
              skipPublishCheck: true
            });
          }
        }

        console.info('[BREM:data] driver snapshot: cache hit');
        console.info('[BREM:data] driver live: cache hit');
        console.info('[BREM:data] driver notices: cache hit');
        mergeRiderSnapshotInCache(snapshotCached);
        mergeRiderLiveInCache(liveCached);
        mergeRiderNoticesInCache({ notices: noticesCached.notices || [] });
        console.info('[BREM:data] driver load done');
        document.dispatchEvent(new CustomEvent('brem-driver-data-ready', {
          detail: { ok: true, cached: true, publishedAt: getDriverAppPublishedAt() }
        }));
        return {
          ok: true,
          cached: true,
          publishedAt: getDriverAppPublishedAt(),
          rider: liveCached.rider || null
        };
      }

      console.info('[BREM:data] driver snapshot: cache miss');
      const bundle = await riderApiFetch('/api/rider/app-bundle', 'app-bundle');

      if (bundle.ok) {
        if (riderId && bundle.snapshot) cache?.write?.(riderId, 'snapshot', bundle.snapshot);
        if (riderId && bundle.live) cache?.write?.(riderId, 'live', bundle.live);
        if (riderId) {
          cache?.write?.(riderId, 'notices', { notices: bundle.notices || [] });
        }
        mergeRiderSnapshotInCache({
          ...bundle.snapshot,
          riderId: bundle.riderId,
          publishedAt: bundle.publishedAt
        });
        mergeRiderLiveInCache(bundle.live || {});
        mergeRiderNoticesInCache({ notices: bundle.notices || [] });

        console.info('[BREM:data] driver load done');
        document.dispatchEvent(new CustomEvent('brem-driver-data-ready', {
          detail: {
            ok: true,
            publishedAt: getDriverAppPublishedAt(),
            errors: { snapshot: null, live: null, notices: null }
          }
        }));
        document.dispatchEvent(new CustomEvent('brem-cache-status-changed'));
        return {
          ok: true,
          publishedAt: getDriverAppPublishedAt(),
          rider: bundle.live?.rider || null,
          snapshot: { ok: true },
          live: { ok: true },
          notices: { ok: true, count: (bundle.notices || []).length }
        };
      }

      const [snapshotResult, liveResult, noticesResult] = await Promise.allSettled([
        (async () => {
          console.info('[BREM:data] driver snapshot: cache miss');
          const result = await riderApiFetch('/api/rider/snapshot', 'snapshot');
          if (result.ok && riderId) cache?.write?.(riderId, 'snapshot', result);
          if (result.ok) mergeRiderSnapshotInCache(result);
          return result;
        })(),
        (async () => {
          console.info('[BREM:data] driver live: cache miss');
          const result = await riderApiFetch('/api/rider/live', 'live');
          if (result.ok && riderId) cache?.write?.(riderId, 'live', result);
          if (result.ok) mergeRiderLiveInCache(result);
          return result;
        })(),
        (async () => {
          console.info('[BREM:data] driver notices: cache miss');
          const result = await riderApiFetch('/api/rider/notices', 'notices');
          if (result.ok && riderId) cache?.write?.(riderId, 'notices', result);
          if (result.ok) mergeRiderNoticesInCache(result);
          return result;
        })()
      ]);

      const unwrap = settled => (
        settled.status === 'fulfilled'
          ? settled.value
          : { ok: false, message: settled.reason?.message || '요청에 실패했습니다.' }
      );

      const snapshot = unwrap(snapshotResult);
      const live = unwrap(liveResult);
      const notices = unwrap(noticesResult);

      const anyOk = [snapshot, live, notices].some(item => item?.ok);
      const allFailed = !anyOk;

      console.info('[BREM:data] driver load done');

      document.dispatchEvent(new CustomEvent('brem-driver-data-ready', {
        detail: {
          ok: anyOk,
          partial: anyOk,
          publishedAt: getDriverAppPublishedAt(),
          errors: {
            snapshot: snapshot.message || null,
            live: live.ok ? null : (live.message || live.error),
            notices: notices.ok ? null : (notices.message || notices.error)
          }
        }
      }));
      document.dispatchEvent(new CustomEvent('brem-cache-status-changed'));

      return {
        ok: anyOk,
        partial: anyOk,
        allFailed,
        publishedAt: getDriverAppPublishedAt(),
        rider: live.rider || null,
        snapshot,
        live,
        notices
      };
    };

    if (options.force) {
      return run().finally(() => {
        driverAppBundlePromise = null;
      });
    }

    driverAppBundlePromise = run().finally(() => {
      driverAppBundlePromise = null;
    });
    return driverAppBundlePromise;
  }

  async function fetchRiderDashboardFromServer() {
    const token = await resolveAdminAccessToken();
    if (!token) {
      return { ok: false, message: '로그인 세션이 없습니다.' };
    }

    try {
      const response = await fetch('/api/rider/dashboard', {
        credentials: 'same-origin',
        headers: { Authorization: `Bearer ${token}` }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, message: payload.error || '기사 대시보드 데이터를 불러오지 못했습니다.' };
      }

      mergeRiderDashboardInCache(payload);
      return {
        ok: true,
        riderId: payload.riderId || null,
        longEvent: payload.longEvent || null,
        counts: {
          calls: Array.isArray(payload.calls) ? payload.calls.length : 0,
          rejections: Array.isArray(payload.rejections) ? payload.rejections.length : 0,
          targets: Array.isArray(payload.targets) ? payload.targets.length : 0,
          notices: Array.isArray(payload.notices) ? payload.notices.length : 0
        }
      };
    } catch (error) {
      return { ok: false, message: error.message || '기사 대시보드 요청에 실패했습니다.' };
    }
  }

  async function deleteRiderViaServer(id) {
    const result = await adminRidersApi(`/api/admin/riders/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    if (!result.ok) {
      throw new Error(result.message || 'Supabase에서 기사를 삭제하지 못했습니다.');
    }
    return result;
  }

  async function fetchRiderViaServer(id) {
    const riderId = String(id || '').trim();
    if (!riderId) {
      return { ok: false, message: '기사 ID가 없습니다.' };
    }

    const fetchOne = () => adminRidersApi(`/api/admin/riders/${encodeURIComponent(riderId)}`);
    let result = await fetchOne();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await fetchOne();
    }
    if (!result.ok) {
      return {
        ok: false,
        message: result.message || result.error || '기사 정보를 불러오지 못했습니다.'
      };
    }

    const mapper = window.BremSupabaseMapper;
    if (!result.rider || !mapper?.rowToRider) {
      return { ok: false, message: '기사 데이터를 해석하지 못했습니다.' };
    }

    const rider = mapper.rowToRider(result.rider);
    const list = drivers.getAll();
    const index = list.findIndex(item => item.id === rider.id);
    if (index >= 0) {
      list[index] = { ...list[index], ...rider };
    } else {
      list.push(rider);
    }
    markDriversCache(list, { source: 'network' });
    return { ok: true, rider };
  }

  async function mergeSelectedRidersViaServer(riderIds) {
    const postMerge = () => adminRidersApi('/api/admin/riders/merge-selected', {
      method: 'POST',
      body: JSON.stringify({ riderIds })
    });

    let result = await postMerge();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await postMerge();
    }
    if (!result.ok) {
      throw new Error(result.message || result.error || '선택 기사 병합에 실패했습니다.');
    }
    return result;
  }

  async function mergeAutoRidersViaServer() {
    const postMerge = () => adminRidersApi('/api/admin/riders/merge-auto', {
      method: 'POST',
      body: JSON.stringify({})
    });

    let result = await postMerge();
    if (!result.ok && result.status === 401) {
      const client = getSupabaseClient();
      if (client) {
        await client.auth.refreshSession();
        rememberAdminAccessToken('');
      }
      result = await postMerge();
    }
    if (!result.ok) {
      throw new Error(result.message || result.error || '전체 기사 자동병합에 실패했습니다.');
    }
    return result;
  }

  function remapDriverIdsInLocalData(idRemap) {
    if (!idRemap || !Object.keys(idRemap).length) return 0;

    let changed = 0;
    const mapId = (id) => {
      const next = idRemap[String(id || '')] || id;
      if (next !== id) changed += 1;
      return next;
    };

    const remapArrayByDriverId = (key, buildId) => {
      if (!storageAdapter.has(key)) return;
      const list = storageAdapter.read(key, []);
      if (!Array.isArray(list) || !list.length) return;
      const remapped = list.map(item => {
        const driverId = mapId(item.driverId);
        const next = { ...item, driverId };
        if (typeof buildId === 'function') next.id = buildId(next);
        return next;
      });
      const deduped = [...new Map(remapped.map(item => [item.id, item])).values()];
      storageAdapter.write(key, deduped);
    };

    remapArrayByDriverId(KEYS.calls, item => `${item.driverId}-${item.date}-${normalizePlatform(item.platform)}`);
    remapArrayByDriverId(KEYS.rejections, item => `${item.driverId}-${item.weekStart}-${normalizePlatform(item.platform)}`);
    remapArrayByDriverId(KEYS.targets, item => `${item.driverId}-${item.month}`);
    remapArrayByDriverId(KEYS.weeklyTargets, item => `${item.driverId}-${item.weekStart}`);
    remapArrayByDriverId(KEYS.settlements, item => `${item.driverId}-${item.period}-${normalizePlatform(item.platform)}`);

    if (storageAdapter.has(KEYS.eventItems)) {
      const eventMap = storageAdapter.read(KEYS.eventItems, {});
      if (eventMap && typeof eventMap === 'object') {
        const nextMap = {};
        Object.entries(eventMap).forEach(([driverId, itemId]) => {
          const nextId = mapId(driverId);
          if (!nextMap[nextId]) nextMap[nextId] = itemId;
        });
        storageAdapter.write(KEYS.eventItems, nextMap);
      }
    }

    window.BremDataCache?.invalidate?.(KEYS.drivers);
    return changed;
  }

  async function adminUsersApi(path, options = {}) {
    const token = await resolveAdminAccessToken();
    if (!token) {
      return { ok: false, message: '로그인 세션이 만료되었습니다. 다시 로그인하세요.' };
    }

    try {
      const response = await fetch(path, {
        credentials: 'same-origin',
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const raw = payload.error || '관리자 계정 API 요청에 실패했습니다.';
        const message = /invalid format/i.test(raw)
          ? '이메일 형식이 올바르지 않습니다. 영문 이메일(예: name@example.com)을 입력하세요.'
          : raw;
        return { ok: false, message };
      }
      return { ok: true, ...payload };
    } catch (error) {
      return { ok: false, message: error.message || '관리자 계정 API 요청에 실패했습니다.' };
    }
  }

  function mapProductionAdminAccount(raw, index = 0) {
    const menus = raw?.menus == null ? [...ALL_ADMIN_MENU_IDS] : normalizeAdminMenus(raw.menus);
    const editableMenus = raw?.editableMenus == null
      ? normalizeAdminEditableMenus(menus, menus)
      : normalizeAdminEditableMenus(menus, raw.editableMenus);
    return normalizeAdminAccount({
      ...raw,
      menus,
      editableMenus,
      password: ''
    }, index);
  }

  function buildProductionAdminSessionAccount(profile, registryAccount = null) {
    if (registryAccount) {
      const account = mapProductionAdminAccount(
        { ...registryAccount, id: profile.user_id },
        0
      );
      if (!account.active) return null;
      return { ...account, password: '', menusExplicit: true };
    }

    return null;
  }

  function buildInitialAdminSessionAccount(profile) {
    return {
      id: profile.user_id,
      email: getSupabaseConfig().initialAdmin?.email || '',
      name: profile.display_name || getSupabaseConfig().initialAdmin?.loginName || '관리자',
      role: ADMIN_ROLES.CEO,
      menus: [...ALL_ADMIN_MENU_IDS],
      editableMenus: [...ALL_ADMIN_MENU_IDS],
      active: true,
      menusExplicit: true
    };
  }

  function persistProductionSessionAccount(account) {
    if (!account?.id) return;
    productionAdminSessionAccount = { ...account, menusExplicit: true };
    sessionAdapter.write(SESSION_KEYS.adminAccountId, account.id);
    sessionAdapter.write(SESSION_KEYS.adminLoggedIn, 'true');
    const menuStore = getAdminSessionStore();
    menuStore.setItem(SESSION_KEYS.adminSessionMenus, JSON.stringify(account.menus || []));
    menuStore.setItem(
      SESSION_KEYS.adminSessionEditableMenus,
      JSON.stringify(account.editableMenus || account.menus || [])
    );
    menuStore.setItem(SESSION_KEYS.adminSessionRole, account.role || ADMIN_ROLES.MANAGER);
    menuStore.setItem(SESSION_KEYS.adminSessionName, account.name || '');
  }

  function readPersistedProductionSessionAccount(profile) {
    if (!profile?.user_id) return null;
    if (sessionAdapter.read(SESSION_KEYS.adminAccountId) !== profile.user_id) return null;

    try {
      const menuStore = getAdminSessionStore();
      const menusRaw = menuStore.getItem(SESSION_KEYS.adminSessionMenus);
      if (menusRaw == null) return null;
      const menus = normalizeAdminMenus(JSON.parse(menusRaw));
      if (!Array.isArray(menus)) return null;

      const editableRaw = menuStore.getItem(SESSION_KEYS.adminSessionEditableMenus);
      const editableMenus = editableRaw
        ? normalizeAdminEditableMenus(menus, JSON.parse(editableRaw))
        : menus;

      return {
        id: profile.user_id,
        email: '',
        name: menuStore.getItem(SESSION_KEYS.adminSessionName) || profile.display_name || '관리자',
        role: menuStore.getItem(SESSION_KEYS.adminSessionRole) || ADMIN_ROLES.MANAGER,
        menus,
        editableMenus: Array.isArray(editableMenus) ? editableMenus : menus,
        active: true,
        menusExplicit: true
      };
    } catch {
      return null;
    }
  }

  function clearPersistedProductionSessionAccount() {
    const menuStore = getAdminSessionStore();
    menuStore.removeItem(SESSION_KEYS.adminSessionMenus);
    menuStore.removeItem(SESSION_KEYS.adminSessionEditableMenus);
    menuStore.removeItem(SESSION_KEYS.adminSessionRole);
    menuStore.removeItem(SESSION_KEYS.adminSessionName);
  }

  function getStorageStatus() {
    const config = getSupabaseConfig();
    const backend = getStorageBackend();
    const connected = backend === 'local'
      || (backend === 'supabase' && activeStorageAdapter.isHydrated?.() === true);
    return {
      backend,
      preference: getStorageBackendPreference(),
      mode: config.mode,
      allowLocalFallback: config.allowLocalFallback,
      supabaseConfigured: config.isConfigured,
      supabaseHydrated: connected,
      supabaseError: backend === 'local' ? '' : lastSupabaseError,
      dbConnectionLabel: connected
        ? (backend === 'local' ? 'Local Storage' : 'Supabase Connected')
        : (config.mode === 'production' ? 'Disconnected' : backend)
    };
  }

  async function initLocalDevStorage() {
    if (activeStorageAdapter.type === 'local') {
      return { backend: 'local', adapter: activeStorageAdapter };
    }

    activeStorageAdapter = localDevStorageAdapter;
    ensureDefaultAdminAccounts();
    hydratePayrollLocalCache();

    const driverRows = readLocalDevJson(KEYS.drivers, []);
    const driversList = Array.isArray(driverRows) ? driverRows : [];
    markDriversCache(driversList, { source: 'local', complete: true });

    lastSupabaseError = '';
    bootstrapComplete = true;
    dispatchStorageReadyOnce({ backend: 'local', hydrated: true });
    document.dispatchEvent(new CustomEvent('brem-drivers-sync-ready', {
      detail: {
        complete: true,
        cached: true,
        count: driversList.length,
        supabaseTotal: driversList.length
      }
    }));
    return { backend: 'local', adapter: activeStorageAdapter };
  }

  function useLocalStorageAdapter() {
    throw new Error('localStorage 저장 모드는 지원하지 않습니다. Supabase만 사용합니다.');
  }

  async function initStorage(options = {}) {
    const config = {
      ...getSupabaseConfig(),
      ...(options.config || {})
    };

    if (isLocalDevBackend() && (options.backend === 'local' || !config.url || !config.anonKey)) {
      return initLocalDevStorage();
    }

    if (!config.url || !config.anonKey) {
      lastSupabaseError = 'Supabase url / anonKey 설정이 필요합니다.';
      throw new Error(lastSupabaseError);
    }

    try {
      return await initSupabaseStorage(config, options);
    } catch (error) {
      lastSupabaseError = error.message || 'Supabase 연결에 실패했습니다.';
      console.error('[BREM] Supabase init failed:', error);
      throw error;
    }
  }

  async function hydrateStorageData(settings = getSupabaseConfig(), options = {}) {
    if (activeStorageAdapter.type !== 'supabase') {
      return { ok: false, message: 'Supabase 저장소가 연결되지 않았습니다.' };
    }
    if (activeStorageAdapter.isHydrated?.()) {
      return { ok: true, cached: true };
    }

    const skipDriversSync = options.skipDriversSync === true;

    window.BremPerf?.time?.('storage.hydrateStorageData');
    if (activeStorageAdapter.hydrateCore) {
      await activeStorageAdapter.hydrateCore();
    } else {
      await activeStorageAdapter.hydrate(getHydrateOptions());
    }
    restoreTableCachesFromSession();
    lastSupabaseError = '';
    flushStagedSupabaseWrites();
    finalizeStorageReady();
    if (activeStorageAdapter.flush) {
      await activeStorageAdapter.flush();
    }
    console.info('[BREM] Supabase storage hydrated');
    const driversSessionReady = driversLoadMeta.complete && drivers.getAll().length > 0;
    if (!skipDriversSync && !driversSessionReady && (settings.mode === 'production' || isProductionMode())) {
      await syncDriversFromServer().catch(error => {
        console.warn('[BREM] Server rider sync after hydrate failed:', error.message);
      });
    }
    window.BremPerf?.timeEnd?.('storage.hydrateStorageData');
    dispatchStorageReadyOnce({ backend: 'supabase', hydrated: true });
    return { ok: true };
  }

  let adminDataSyncPromise = null;

  async function syncAdminDataInBackground() {
    if (!isProductionMode()) {
      document.dispatchEvent(new CustomEvent('brem-admin-data-ready', { detail: { ok: true } }));
      return { ok: true };
    }
    if (adminDataSyncPromise) return adminDataSyncPromise;

    window.BremPerf?.time?.('storage.syncAdminDataBackground');
    adminDataSyncPromise = syncDriversFromServer().catch(error => {
      console.warn('[BREM] Background rider sync failed:', error.message || error);
      return { ok: false };
    }).finally(() => {
      adminDataSyncPromise = null;
      window.BremPerf?.timeEnd?.('storage.syncAdminDataBackground');
      document.dispatchEvent(new CustomEvent('brem-admin-data-ready', { detail: { ok: true } }));
    });
    void auth.syncProductionAdminAccounts().catch(error => {
      console.warn('[BREM] Background admin account sync failed:', error.message || error);
    });
    return adminDataSyncPromise;
  }

  async function hydrateAdminDataInBackground() {
    if (adminDataHydratePromise) return adminDataHydratePromise;

    window.BremPerf?.time?.('storage.hydrateAdminDataBackground');
    adminDataHydratePromise = (async () => {
      try {
        if (activeStorageAdapter.type !== 'supabase' || !activeSupabaseClient) {
          await initStorage({ backend: 'supabase', deferHydrate: true });
        }

        const coreResult = activeStorageAdapter.isHydrated?.()
          ? { ok: true, cached: true }
          : await ensureSupabaseHydrated({ skipDriversSync: true });
        if (!coreResult.ok) return coreResult;

        const [bootstrapResult] = await Promise.all([
          loadBootstrapData({ force: false }),
          auth.syncProductionAdminAccounts().catch(error => {
            console.warn('[BREM] Background admin account sync failed:', error.message || error);
            return { ok: false };
          })
        ]);

        document.dispatchEvent(new CustomEvent('brem-admin-data-ready', {
          detail: { ok: bootstrapResult?.ok !== false }
        }));
        document.dispatchEvent(new CustomEvent('brem-cache-status-changed'));
        return bootstrapResult;
      } finally {
        adminDataHydratePromise = null;
        window.BremPerf?.timeEnd?.('storage.hydrateAdminDataBackground');
      }
    })();
    return adminDataHydratePromise;
  }

  let driverAppHydratePromise = null;

  function getRiderBaeminOps() {
    if (!riderBaeminOpsCache) return null;
    const sessionRiderId = String(activeSupabaseProfile?.rider_id || sessionAdapter.read(SESSION_KEYS.driverId, '') || '').trim();
    const cacheRiderId = String(riderBaeminOpsCache.riderId || '').trim();
    if (sessionRiderId && cacheRiderId && sessionRiderId !== cacheRiderId) return null;
    return { ...riderBaeminOpsCache };
  }

  function getRiderCoupangOps() {
    if (!riderCoupangOpsCache) return null;
    const sessionRiderId = String(activeSupabaseProfile?.rider_id || sessionAdapter.read(SESSION_KEYS.driverId, '') || '').trim();
    const cacheRiderId = String(riderCoupangOpsCache.riderId || '').trim();
    if (sessionRiderId && cacheRiderId && sessionRiderId !== cacheRiderId) return null;
    return { ...riderCoupangOpsCache };
  }

  async function refreshRiderBaeminOps() {
    const result = await riderApiFetch('/api/rider/live', 'live');
    if (result?.ok) {
      mergeRiderLiveInCache(result);
    }
    return result;
  }

  async function refreshRiderCoupangOps() {
    const result = await riderApiFetch('/api/rider/live', 'live');
    if (result?.ok) {
      mergeRiderLiveInCache(result);
    }
    return result;
  }

  function isDriverAppCacheReady() {
    if (!activeStorageAdapter.isHydrated?.()) return false;
    return window.BremDataCache?.isValid?.(KEYS.calls)
      && window.BremDataCache?.isValid?.(KEYS.rejections)
      && window.BremDataCache?.isValid?.(KEYS.targets)
      && window.BremDataCache?.isValid?.(KEYS.notices);
  }

  async function hydrateDriverAppData(options = {}) {
    if (isProductionMode() && isRiderProductionSession()) {
      return loadDriverAppBundle(options);
    }

    if (driverAppHydratePromise) return driverAppHydratePromise;

    window.BremPerf?.time?.('storage.hydrateDriverAppData');
    driverAppHydratePromise = (async () => {
      try {
        if (activeStorageAdapter.type !== 'supabase') {
          return { ok: true, cached: true };
        }

        const force = options.force === true;

        if (!force && !isProductionMode() && isDriverAppCacheReady()) {
          await ensureSupabaseHydrated({ skipDriversSync: true });
          if (activeStorageAdapter.hydrateCore) {
            await activeStorageAdapter.hydrateCore();
          }
          document.dispatchEvent(new CustomEvent('brem-driver-data-ready', { detail: { ok: true, cached: true } }));
          return { ok: true, cached: true };
        }

        const hydrated = await ensureSupabaseHydrated({ skipDriversSync: true });
        if (!hydrated.ok) return hydrated;

        if (activeStorageAdapter.ensureKeysLoaded) {
          if (activeStorageAdapter.hydrateCore) {
            await activeStorageAdapter.hydrateCore();
          }
          await activeStorageAdapter.ensureKeysLoaded([
            KEYS.calls,
            KEYS.rejections,
            KEYS.targets
          ], { force });
        }

        await reloadNotices(force).catch(() => ({}));
        document.dispatchEvent(new CustomEvent('brem-driver-data-ready', { detail: { ok: true } }));
        return { ok: true };
      } finally {
        driverAppHydratePromise = null;
        window.BremPerf?.timeEnd?.('storage.hydrateDriverAppData');
      }
    })();

    return driverAppHydratePromise;
  }

  async function flushActiveStorage() {
    await storageAdapter.flush();
  }

  async function refreshDriversForSettlementMatch() {
    await ensureSectionLoaded('drivers');
    // 백그라운드 부분 로드 중이면 끝까지 기다린 뒤, 부족하면 force 재로드한다.
    if (typeof awaitDriversFullyLoaded === 'function') {
      const result = await awaitDriversFullyLoaded();
      if (result?.ok === false) {
        throw new Error(result.message || '기사 목록을 불러오지 못했습니다.');
      }
      return drivers.getAll();
    }
    if (typeof fetchAllDriversFromServer === 'function') {
      const result = await fetchAllDriversFromServer({ force: true });
      if (result?.ok === false) {
        throw new Error(result.message || '기사 목록을 불러오지 못했습니다.');
      }
      return drivers.getAll();
    }
    if (typeof reloadDrivers === 'function') {
      await reloadDrivers(true);
    }
    return drivers.getAll();
  }

  /** 기사 검색 결과를 로컬 캐시에 병합 (전체 동기화 promise와 독립) */
  async function searchDriversAndMerge(keyword, options = {}) {
    const q = String(keyword || '').trim();
    if (!q) return { ok: true, count: 0 };
    if (isProductionMode()) {
      return syncDriversFromServer({
        limit: options.limit || 200,
        offset: options.offset || 0,
        search: q,
        status: options.status || '',
        append: true
      });
    }
    if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.reloadRiders) {
      return activeStorageAdapter.reloadRiders({
        limit: options.limit || 200,
        offset: options.offset || 0,
        search: q,
        status: options.status || '',
        append: true,
        force: false
      });
    }
    return { ok: true, count: 0 };
  }

  async function reloadDrivers(force = false, options = {}) {
    const hasSearch = Boolean(String(options.search || '').trim());
    const hasStatusFilter = options.status && options.status !== '전체';
    const append = options.append === true;

    if (force && !append && !hasSearch && !hasStatusFilter) {
      return fetchAllDriversFromServer({ force: true });
    }

    if (!force && !append && !hasSearch && !hasStatusFilter) {
      if (driversLoadMeta.complete && drivers.getAll().length > 0) {
        logDataSource('riders', true);
        return {
          ok: true,
          cached: true,
          count: drivers.getAll().length,
          supabaseTotal: driversLoadMeta.supabaseTotal
        };
      }
      return fetchAllDriversFromServer({ force: false });
    }

    // 검색은 전체 동기화와 겹쳐도 막히지 않게 별도 경로
    if (hasSearch && append) {
      const result = await searchDriversAndMerge(options.search, {
        limit: options.limit || 100,
        offset: options.offset || 0,
        status: options.status || ''
      });
      document.dispatchEvent(new CustomEvent('brem-drivers-sync-ready'));
      return result;
    }

    if (driversSyncPromise) return driversSyncPromise;

    const taskKey = `reload:drivers:${force ? '1' : '0'}:${hasSearch ? 's' : ''}:${hasStatusFilter ? 'f' : ''}:${append ? 'a' : ''}`;
    driversSyncPromise = window.BremDataCache.runOnce(taskKey, async () => {
      if (isProductionMode()) {
        return syncDriversFromServer({
          limit: options.limit || 100,
          offset: options.offset || 0,
          search: options.search || '',
          status: options.status || '',
          append
        });
      }
      if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.reloadRiders) {
        return activeStorageAdapter.reloadRiders({
          limit: options.limit || 100,
          offset: options.offset || 0,
          search: options.search || '',
          status: options.status || '',
          append,
          force
        });
      }
      return { ok: true };
    }).finally(() => {
      driversSyncPromise = null;
      document.dispatchEvent(new CustomEvent('brem-drivers-sync-ready'));
    });

    return driversSyncPromise;
  }

  async function waitForSupabaseReady(timeoutMs = 8000) {
    if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.isHydrated?.()) {
      return true;
    }
    return new Promise(resolve => {
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        resolve(Boolean(value));
      };
      const checkHydrated = () => {
        if (activeStorageAdapter.isHydrated?.()) finish(true);
      };
      document.addEventListener('brem-storage-ready', checkHydrated, { once: true });
      document.addEventListener('brem-storage-error', () => finish(false), { once: true });
      setTimeout(() => finish(activeStorageAdapter.isHydrated?.()), timeoutMs);
    });
  }

  async function verifyRiderPersisted(id) {
    const riderId = String(id || '').trim();
    if (!riderId) {
      return { ok: false, message: '기사 ID가 없습니다.' };
    }

    if (isProductionMode()) {
      const cached = drivers.getById(riderId);
      if (cached) return { ok: true, driver: cached };

      const synced = await syncDriversFromServer();
      if (!synced.ok) {
        return { ok: false, message: synced.message || '서버에서 기사 목록을 확인하지 못했습니다.' };
      }
      const driver = drivers.getById(riderId);
      if (!driver) {
        return {
          ok: false,
          message: 'Supabase에 기사가 저장되지 않았습니다. 관리자 로그인 후 다시 시도하세요.'
        };
      }
      return { ok: true, driver };
    }

    const cached = drivers.getById(riderId);
    if (!cached) {
      return { ok: false, message: '기사 데이터가 캐시에 없습니다.' };
    }

    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase 클라이언트를 초기화할 수 없습니다.' };
    }

    const { data, error } = await client
      .from('riders')
      .select('id')
      .eq('id', riderId)
      .maybeSingle();

    if (error) {
      return { ok: false, message: error.message || 'Supabase 기사 조회에 실패했습니다.' };
    }
    if (!data?.id) {
      return {
        ok: false,
        message: 'Supabase에 기사가 저장되지 않았습니다. 관리자 로그인 후 다시 시도하세요.'
      };
    }

    return { ok: true, driver: cached };
  }

  async function resumeSupabaseAfterAuth(options = {}) {
    if (isLocalDevBackend()) {
      if (activeStorageAdapter.type !== 'local') {
        await initLocalDevStorage();
      }
      return { ok: true };
    }

    const config = getSupabaseConfig();
    if (!config.url || !config.anonKey) {
      return { ok: false, message: 'Supabase 설정이 없습니다.' };
    }
    if (activeStorageAdapter.type !== 'supabase') {
      try {
        await initStorage({ backend: 'supabase', deferHydrate: true });
      } catch (error) {
        return { ok: false, message: error.message || 'Supabase 연결에 실패했습니다.' };
      }
    }
    if (options.deferHydrate) {
      return { ok: true, deferred: true };
    }
    return ensureSupabaseHydrated({ skipDriversSync: true });
  }

  async function ensureSupabaseHydrated(options = {}) {
    if (activeStorageAdapter.type !== 'supabase') {
      return { ok: false, message: 'Supabase 저장소가 연결되지 않았습니다.' };
    }
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase 클라이언트를 초기화할 수 없습니다.' };
    }

    const accessToken = await resolveAdminAccessToken();
    if (!accessToken) {
      return {
        ok: false,
        message: 'Supabase 로그인이 필요합니다. 관리자 화면에서 먼저 로그인하세요.'
      };
    }

    if (activeStorageAdapter.isHydrated?.()) {
      if (isProductionMode() && !(await resolveAdminAccessToken())) {
        return {
          ok: false,
          message: 'Supabase 로그인이 필요합니다. 관리자 화면에서 먼저 로그인하세요.'
        };
      }
      restoreTableCachesFromSession();
      return { ok: true };
    }

    if (ensureHydratedPromise) {
      return ensureHydratedPromise;
    }

    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session) {
      return {
        ok: false,
        message: 'Supabase 로그인이 필요합니다. 관리자 화면에서 먼저 로그인하세요.'
      };
    }

    if (!activeSupabaseProfile) {
      await loadSupabaseProfile();
    }

    ensureHydratedPromise = (async () => {
      try {
        window.BremPerf?.time?.('storage.ensureSupabaseHydrated');
        const hydrated = await hydrateStorageData(getSupabaseConfig(), options);
        window.BremPerf?.timeEnd?.('storage.ensureSupabaseHydrated');
        return hydrated;
      } catch (error) {
        lastSupabaseError = error.message || 'Supabase 데이터 로드에 실패했습니다.';
        console.error('[BREM] Supabase hydrate failed:', error);
        return { ok: false, message: lastSupabaseError };
      } finally {
        ensureHydratedPromise = null;
      }
    })();

    return ensureHydratedPromise;
  }

  function createSupabaseClient(url, anonKey) {
    if (activeSupabaseClient) return activeSupabaseClient;
    if (!window.BremSupabaseConfig?.createClient) {
      throw new Error('supabase-config.js 가 로드되지 않았습니다.');
    }
    const scope = window.BREM_AUTH_SCOPE === 'rider' ? 'rider' : 'admin';
    const client = window.BremSupabaseConfig.createClient(url, anonKey, { scope });
    bindSupabaseAuthListener(client);
    return client;
  }

  function getStorageBootstrapOptions() {
    const config = getSupabaseConfig() || {};
    if (config.mode === 'production') {
      return { backend: 'supabase', deferHydrate: true };
    }
    if (isLocalDevBackend()) {
      return { backend: 'local' };
    }
    return { backend: 'supabase' };
  }

  async function initSupabaseStorage(config, options = {}) {
    const deferHydrate = Boolean(options.deferHydrate);
    const settings = config || window.BREM_SUPABASE_CONFIG;

    if (activeStorageAdapter.type === 'supabase' && activeSupabaseClient) {
      if (!deferHydrate && !activeStorageAdapter.isHydrated?.()) {
        await hydrateStorageData(settings);
      }
      return { backend: 'supabase', client: activeSupabaseClient, adapter: activeStorageAdapter };
    }

    if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.isHydrated?.()) {
      return { backend: 'supabase', client: activeSupabaseClient, adapter: activeStorageAdapter };
    }

    if (supabaseInitPromise) {
      return supabaseInitPromise;
    }

    supabaseInitPromise = (async () => {
      if (!settings?.url || !settings?.anonKey) {
        throw new Error('Supabase url / anonKey 설정이 필요합니다.');
      }
      if (!window.supabase?.createClient) {
        throw new Error('@supabase/supabase-js 가 로드되지 않았습니다.');
      }
      if (!window.BremSupabaseStorageAdapter?.createSupabaseAdapter) {
        throw new Error('storage-supabase-adapter.js 가 로드되지 않았습니다.');
      }
      const client = createSupabaseClient(settings.url, settings.anonKey);
      const { data: sessionData } = await client.auth.getSession();
      activeSupabaseClient = client;
      if (sessionData?.session?.access_token) {
        rememberAdminAccessToken(sessionData.session.access_token);
      }

      if (sessionData?.session) {
        try {
          const { data: profile, error: profileError } = await client
            .from('profiles')
            .select('user_id,role,rider_id,display_name,active')
            .eq('user_id', sessionData.session.user.id)
            .maybeSingle();
          if (profileError) {
            console.warn('[BREM] profiles load skipped:', profileError.message || profileError);
          }
          activeSupabaseProfile = profile
            || buildProfileFromAuthUser(sessionData.session.user, 'admin')
            || null;
        } catch (profileLoadError) {
          console.warn('[BREM] profiles load failed:', profileLoadError?.message || profileLoadError);
          activeSupabaseProfile = buildProfileFromAuthUser(sessionData.session.user, 'admin');
        }
      }

      const adapter = window.BremSupabaseStorageAdapter.createSupabaseAdapter(client, KEYS);
      activeStorageAdapter = adapter;
      setStorageBackendPreference('supabase');
      lastSupabaseError = '';

      if (sessionData?.session && !deferHydrate) {
        window.BremPerf?.time?.('storage.initSupabaseStorage');
        await hydrateStorageData(settings);
        console.info('[BREM] Supabase storage initialized and hydrated');
        window.BremPerf?.timeEnd?.('storage.initSupabaseStorage');
      } else if (sessionData?.session) {
        console.info('[BREM] Supabase client ready — hydrate deferred');
      } else if (settings.mode === 'production') {
        console.info('[BREM] Supabase client ready — awaiting login to hydrate');
      } else {
        try {
          if (!deferHydrate) {
            await hydrateStorageData(settings);
          }
        } catch (error) {
          console.warn('[BREM] Supabase hydrate skipped (no auth):', error.message);
        }
      }

      return { backend: 'supabase', client, adapter };
    })();

    try {
      return await supabaseInitPromise;
    } catch (error) {
      supabaseInitPromise = null;
      throw error;
    }
  }

  async function migrateLocalStorageToSupabase(client, options) {
    if (isProductionMode()) {
      throw new Error('운영 환경에서는 localStorage 이전 기능을 사용할 수 없습니다. Supabase만 사용합니다.');
    }
    if (!window.BremSupabaseMigration?.migrateLocalStorageToSupabase) {
      throw new Error('storage-migrate-supabase.js 가 로드되지 않았습니다.');
    }
    return window.BremSupabaseMigration.migrateLocalStorageToSupabase(client, options);
  }

  function getSupabaseClient() {
    if (activeSupabaseClient) return activeSupabaseClient;
    if (supabaseInitPromise || storageBootstrapPromise) return null;
    const config = getSupabaseConfig();
    if (!config.url || !config.anonKey || !window.supabase?.createClient) return null;
    activeSupabaseClient = createSupabaseClient(config.url, config.anonKey);
    bindSupabaseAuthListener(activeSupabaseClient);
    return activeSupabaseClient;
  }

  async function ensureSupabaseClient() {
    if (activeSupabaseClient) return activeSupabaseClient;
    if (supabaseInitPromise) {
      try {
        await Promise.race([
          supabaseInitPromise,
          new Promise(resolve => setTimeout(resolve, 2000))
        ]);
      } catch {
        /* bootstrap may fail; fall through */
      }
      if (activeSupabaseClient) return activeSupabaseClient;
    }
    if (storageBootstrapPromise) {
      try {
        await Promise.race([
          storageBootstrapPromise,
          new Promise(resolve => setTimeout(resolve, 2000))
        ]);
      } catch {
        /* bootstrap may fail; fall through */
      }
      if (activeSupabaseClient) return activeSupabaseClient;
    }
    return ensureSupabaseClientForLogin();
  }

  async function waitForStorageBootstrap() {
    if (storageBootstrapPromise) {
      try {
        await storageBootstrapPromise;
      } catch {
        /* ignore */
      }
    }
    return {
      ok: activeStorageAdapter.type === 'supabase' && Boolean(activeSupabaseClient),
      backend: activeStorageAdapter.type
    };
  }

  function startStorageBootstrap() {
    if (storageBootstrapPromise) return storageBootstrapPromise;

    storageBootstrapPromise = (async () => {
      try {
        if (window.BremSupabaseConfig?.load) {
          await window.BremSupabaseConfig.load();
        }
      } catch (error) {
        console.error('[BREM] Public config load failed:', error);
      }

      purgeLegacyAuthFromLocalStorage();

      if (typeof enforceProductionStorageGuard === 'function') {
        document.addEventListener('brem-config-ready', enforceProductionStorageGuard);
      }

      const config = getSupabaseConfig() || {};
      enforceProductionStorageGuard?.();

      if (isLocalDevBackend()) {
        try {
          window.BremPerf?.time?.('storage.bootstrap');
          const result = await initLocalDevStorage();
          console.info('[BREM] Local dev storage bootstrap complete:', result?.backend || 'local');
          window.BremPerf?.timeEnd?.('storage.bootstrap');
          dispatchStorageReadyOnce(result);
        } catch (error) {
          const message = error.message || '로컬 저장소 초기화에 실패했습니다.';
          console.error('[BREM] Local dev storage bootstrap failed:', error);
          document.dispatchEvent(new CustomEvent('brem-storage-error', { detail: { error: message } }));
          dispatchStorageReadyOnce({
            backend: 'unavailable',
            error: message
          });
        }
        return;
      }

      if (!config.url || !config.anonKey) {
        const message = 'Supabase URL/anonKey가 서버 환경변수(SUPABASE_URL, SUPABASE_ANON_KEY)에 설정되지 않았습니다.';
        console.error('[BREM]', message);
        document.dispatchEvent(new CustomEvent('brem-storage-error', { detail: { error: message } }));
        dispatchStorageReadyOnce({
          backend: 'unavailable',
          error: message
        });
        return;
      }

      try {
        window.BremPerf?.time?.('storage.bootstrap');
        const result = await initStorage(getStorageBootstrapOptions());
        console.info('[BREM] Storage bootstrap complete:', result?.backend || 'supabase');
        window.BremPerf?.timeEnd?.('storage.bootstrap');
        if (getStorageStatus?.().supabaseHydrated) {
          dispatchStorageReadyOnce(result);
        }
      } catch (error) {
        const message = error.message || 'Supabase 연결에 실패했습니다.';
        console.error('[BREM] Supabase auto init failed:', error);
        document.dispatchEvent(new CustomEvent('brem-storage-error', { detail: { error: message } }));
        dispatchStorageReadyOnce({
          backend: 'unavailable',
          error: message
        });
      }
    })();

    return storageBootstrapPromise;
  }

  function isTrustedAdminAuthUser(user) {
    if (!user?.id) return false;
    const meta = user.user_metadata || {};
    const appMeta = user.app_metadata || {};
    const role = String(meta.role || appMeta.role || '').trim();
    if (role === 'admin') return true;

    const loginEmail = String(user.email || '').trim().toLowerCase();
    const config = getSupabaseConfig();
    const initialEmail = String(config.initialAdmin?.email || '').trim().toLowerCase();
    if (loginEmail && initialEmail && loginEmail === initialEmail) return true;

    const hints = {
      ...FALLBACK_ADMIN_LOGIN_HINTS,
      ...(config.adminLoginHints || {})
    };
    return Object.values(hints).some(email => String(email || '').trim().toLowerCase() === loginEmail);
  }

  function buildProfileFromAuthUser(user, expectedRole) {
    if (!user?.id) return null;
    if (expectedRole === 'admin' && !isTrustedAdminAuthUser(user)) return null;

    const meta = user.user_metadata || {};
    const config = getSupabaseConfig();
    return {
      user_id: user.id,
      role: expectedRole || String(meta.role || 'admin').trim() || 'admin',
      active: true,
      display_name: meta.display_name || config.initialAdmin?.loginName || user.email || '관리자'
    };
  }

  async function loadSupabaseProfile() {
    const client = await ensureSupabaseClientForLogin();
    if (!client) return null;
    const run = async () => {
      // 새로고침/재접속 시 액세스 토큰이 만료됐으면 refresh_token으로 갱신한 뒤 프로필 조회.
      // (갱신 없이 만료 토큰으로 조회하면 실패→로그인 화면으로 튕김)
      let { data: sessionData } = await client.auth.getSession();
      let session = sessionData?.session || null;
      const expiresMs = session?.expires_at ? session.expires_at * 1000 : 0;
      if (!session || (expiresMs && expiresMs - Date.now() < 60_000)) {
        const { data: refreshed, error: refreshError } = await client.auth.refreshSession();
        if (!refreshError && refreshed?.session) session = refreshed.session;
      }
      const user = session?.user;
      if (!user) {
        activeSupabaseProfile = null;
        return null;
      }
      const { data, error } = await client
        .from('profiles')
        .select('user_id,role,rider_id,display_name,active')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      activeSupabaseProfile = data || null;
      if (!activeSupabaseProfile && user) {
        const metaRole = String(user.user_metadata?.role || '').trim();
        if (metaRole === 'admin' || metaRole === 'rider') {
          activeSupabaseProfile = buildProfileFromAuthUser(user, metaRole);
        }
      }
      return activeSupabaseProfile;
    };
    try {
      return await Promise.race([
        run(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('profile timeout')), 12000))
      ]);
    } catch (error) {
      if (String(error?.message || '').includes('timeout')) {
        const client = await ensureSupabaseClientForLogin();
        const { data: sessionData } = await client?.auth?.getSession?.() || {};
        const fallback = buildProfileFromAuthUser(sessionData?.session?.user, 'admin');
        if (fallback) {
          activeSupabaseProfile = fallback;
          return fallback;
        }
        return activeSupabaseProfile;
      }
      throw error;
    }
  }

  async function tryEnsureInitialAdminProfile(accessToken, loginEmail) {
    const config = getSupabaseConfig();
    const expectedEmail = String(config.initialAdmin?.email || '').trim().toLowerCase();
    const normalizedLogin = String(loginEmail || '').trim().toLowerCase();
    if (!accessToken || !expectedEmail || normalizedLogin !== expectedEmail) {
      return false;
    }

    try {
      const response = await fetch('/api/admin/ensure-profile', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function ensureSupabaseClientForLogin() {
    if (activeSupabaseClient) return activeSupabaseClient;
    const config = getSupabaseConfig();
    if (!config.url || !config.anonKey || !window.supabase?.createClient) return null;
    activeSupabaseClient = createSupabaseClient(config.url, config.anonKey);
    bindSupabaseAuthListener(activeSupabaseClient);
    return activeSupabaseClient;
  }

  async function resolveLoginEmailFromSupabase(loginInput) {
    const login = String(loginInput || '').trim();
    if (!login || login.includes('@')) return login;

    const client = await ensureSupabaseClientForLogin();
    if (!client?.rpc) return '';

    try {
      const { data, error } = await Promise.race([
        client.rpc('resolve_admin_login_email', { login_name: login }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('rpc timeout')), 6000))
      ]);
      if (error) return '';
      const email = String(data || '').trim();
      return email.includes('@') ? email : '';
    } catch {
      return '';
    }
  }

  async function resolveLoginEmailFast(loginInput) {
    const results = await Promise.allSettled([
      resolveLoginEmailFromSupabase(loginInput),
      resolveLoginEmailFromApi(loginInput)
    ]);
    for (const result of results) {
      const email = result.status === 'fulfilled' ? String(result.value || '').trim() : '';
      if (email.includes('@')) return email;
    }
    return '';
  }

  async function resolveLoginEmailFromApi(loginInput) {
    const login = String(loginInput || '').trim();
    if (!login || login.includes('@')) return login;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`/api/admin/resolve-login?login=${encodeURIComponent(login)}`, {
        signal: controller.signal,
        credentials: 'same-origin'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return '';
      return String(payload.email || '').trim();
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchAdminSignInApi(loginInput, password, timeoutMs = 12000) {
    const body = JSON.stringify({
      login: String(loginInput || '').trim(),
      password: String(password || '')
    });
    const endpoints = ['/api/admin/login', '/api/admin/sign-in'];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      for (const endpoint of endpoints) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal
        });
        if (response.status === 404) continue;
        const payload = await response.json().catch(() => ({}));
        return { response, payload };
      }
      return {
        response: { ok: false, status: 404 },
        payload: { error: '로그인 API를 찾을 수 없습니다.' }
      };
    } catch (error) {
      const message = String(error?.message || '');
      if (/abort/i.test(message)) {
        return {
          response: { ok: false, status: 504 },
          payload: { error: '로그인 응답이 지연되고 있습니다. 잠시 후 다시 시도하세요.' }
        };
      }
      return {
        response: { ok: false, status: 500 },
        payload: { error: message || '로그인 API 호출에 실패했습니다.' }
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function getSupabaseAuthStorageKey(config = getSupabaseConfig()) {
    const host = String(config?.url || '').replace(/^https?:\/\//i, '').split('.')[0];
    return host ? `sb-${host}-auth-token` : '';
  }

  function persistAdminAuthSessionLocally(session, config = getSupabaseConfig()) {
    if (!session?.access_token || !session?.refresh_token) return false;
    const storageKey = getSupabaseAuthStorageKey(config);
    if (!storageKey) return false;
    const payload = JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at
        || (Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600)),
      expires_in: session.expires_in || 3600,
      token_type: session.token_type || 'bearer',
      user: session.user || null
    });
    const prefixed = `brem-auth-admin-${storageKey}`;
    try {
      localStorage.setItem(prefixed, payload);
      sessionStorage.setItem(prefixed, payload);
      window.BremLoginPrefs?.setKeepLoggedIn?.('admin', true);
      return true;
    } catch (error) {
      console.warn('[BREM] persistAdminAuthSessionLocally failed:', error?.message || error);
      return false;
    }
  }

  async function finishProductionAdminSessionFromPayload(payload, authApi) {
    // 로그인 직후 토큰이 localStorage에 쌓이도록 먼저 고정
    try {
      window.BremLoginPrefs?.setKeepLoggedIn?.('admin', true);
    } catch {
      /* ignore */
    }

    const client = await Promise.race([
      ensureSupabaseClientForLogin(),
      new Promise(resolve => setTimeout(() => resolve(null), 3000))
    ]);
    if (!client) {
      return { ok: false, message: 'Supabase 클라이언트를 초기화할 수 없습니다.' };
    }
    if (!payload?.session) {
      return { ok: false, message: '로그인 세션을 받지 못했습니다. 다시 시도해주세요.' };
    }

    // 타임아웃이 나도 localStorage에 세션을 직접 남겨 drivers.html이 읽을 수 있게 한다
    persistAdminAuthSessionLocally(payload.session);

    const sessionResult = await Promise.race([
      client.auth.setSession({
        access_token: payload.session.access_token,
        refresh_token: payload.session.refresh_token
      }),
      new Promise(resolve => setTimeout(() => resolve({ error: new Error('session timeout') }), 8000))
    ]);
    if (sessionResult?.error) {
      console.warn('[BREM] setSession delayed; using persisted local session:', sessionResult.error.message);
      persistAdminAuthSessionLocally(payload.session);
    }

    rememberAdminAccessToken(payload.session.access_token);
    bindSupabaseAuthListener(client);
    activeSupabaseProfile = payload.profile
      || buildProfileFromAuthUser(payload.user || payload.session?.user, 'admin')
      || activeSupabaseProfile;

    // 새로고침/다른 페이지에서도 getSession이 되도록 한 번 더 확인·보정
    try {
      const { data: verified } = await client.auth.getSession();
      if (!verified?.session?.access_token) {
        persistAdminAuthSessionLocally(payload.session);
        await client.auth.setSession({
          access_token: payload.session.access_token,
          refresh_token: payload.session.refresh_token
        }).catch(() => ({}));
      }
    } catch {
      persistAdminAuthSessionLocally(payload.session);
    }

    let account = null;
    if (payload.account) {
      account = mapProductionAdminAccount(payload.account, 0);
      persistProductionSessionAccount(account);
      productionAdminSessionAccount = account;
    }
    if (!account) {
      account = productionAdminSessionAccount;
    }
    if (!account && payload.user?.id) {
      account = {
        id: payload.user.id,
        name: payload.account?.name || payload.profile?.display_name || '관리자',
        role: ADMIN_ROLES.CEO,
        menus: ALL_ADMIN_MENU_IDS,
        editableMenus: ALL_ADMIN_MENU_IDS,
        active: true,
        email: payload.user.email || ''
      };
      persistProductionSessionAccount(account);
      productionAdminSessionAccount = account;
    }
    if (!account) {
      return { ok: false, message: '관리자 계정 정보를 확인할 수 없습니다. 계정 상태를 확인하세요.' };
    }

    authApi.setAdminSession(account.id);
    authApi.syncProductionAdminAccounts().catch(error => {
      console.warn('[BREM] Background admin account sync after login failed:', error.message || error);
    });
    document.dispatchEvent(new CustomEvent('brem-admin-session-ready'));
    return { ok: true, account: { ...account, password: '' } };
  }

  async function signInWithPasswordFetch(email, password, timeoutMs = 25000) {
    const config = getSupabaseConfig();
    if (!config.url || !config.anonKey) {
      return { data: null, error: new Error('Supabase 설정이 필요합니다.') };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${config.url.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: String(email || '').trim(),
          password: String(password || '')
        }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          data: null,
          error: new Error(payload.error_description || payload.msg || payload.error || '로그인에 실패했습니다.')
        };
      }
      return {
        data: {
          session: {
            access_token: payload.access_token,
            refresh_token: payload.refresh_token,
            expires_in: payload.expires_in,
            expires_at: payload.expires_at,
            token_type: payload.token_type,
            user: payload.user
          },
          user: payload.user
        },
        error: null
      };
    } catch (error) {
      const message = /abort/i.test(String(error?.message || ''))
        ? 'auth timeout'
        : (error.message || '로그인에 실패했습니다.');
      return { data: null, error: new Error(message) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function signInWithSupabase(email, password, expectedRole) {
    const client = await ensureSupabaseClientForLogin();
    if (!client) return { ok: false, message: 'Supabase 설정이 필요합니다.' };

    let data = null;
    let error = null;
    ({ data, error } = await signInWithPasswordFetch(email, password, 25000));

    if (error && /timeout/i.test(String(error.message || ''))) {
      const sdkResult = await Promise.race([
        client.auth.signInWithPassword({
          email: String(email || '').trim(),
          password: String(password || '')
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('auth timeout')), 12000))
      ]).catch(sdkError => ({ data: null, error: sdkError }));
      data = sdkResult?.data || null;
      error = sdkResult?.error || null;
    }

    if (error || !data?.session || !data?.user) {
      const message = String(error?.message || '');
      if (/timeout/i.test(message)) {
        return { ok: false, message: '로그인 응답이 지연되고 있습니다. 잠시 후 다시 시도하세요.' };
      }
      return { ok: false, message: message || '로그인에 실패했습니다.' };
    }

    const { error: sessionError } = await client.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token
    });
    if (sessionError) {
      return { ok: false, message: sessionError.message || '세션 연결에 실패했습니다.' };
    }

    rememberAdminAccessToken(data.session.access_token);
    bindSupabaseAuthListener(client);

    let profile = buildProfileFromAuthUser(data.user, expectedRole);
    if (!profile?.active || (expectedRole && profile.role !== expectedRole)) {
      try {
        profile = await Promise.race([
          loadSupabaseProfile(),
          new Promise(resolve => setTimeout(() => resolve(null), 2500))
        ]);
      } catch {
        profile = null;
      }
    }

    if ((!profile?.active || (expectedRole && profile.role !== expectedRole)) && expectedRole === 'admin') {
      const bootstrapped = await Promise.race([
        tryEnsureInitialAdminProfile(data.session.access_token, email),
        new Promise(resolve => setTimeout(() => resolve(false), 2500))
      ]).catch(() => false);
      if (bootstrapped) {
        profile = buildProfileFromAuthUser(data.user, expectedRole) || profile;
      }
    }

    if (!profile?.active || (expectedRole && profile.role !== expectedRole)) {
      profile = buildProfileFromAuthUser(data.user, expectedRole);
    }

    if (!profile?.active || (expectedRole && profile.role !== expectedRole)) {
      await client.auth.signOut().catch(() => {});
      return { ok: false, message: '접근 권한이 없습니다.' };
    }

    activeSupabaseProfile = profile;
    return { ok: true, user: data.user, profile };
  }

  function clearScopeSessionAuth(scope) {
    const normalized = scope === 'rider' ? 'rider' : 'admin';
    window.BremLoginPrefs?.clearPersistedSessionOnLogout?.(normalized);

    const keysToClear = normalized === 'rider'
      ? [SESSION_KEYS.driverId]
      : [
        SESSION_KEYS.adminLoggedIn,
        SESSION_KEYS.adminAccountId,
        SESSION_KEYS.adminSessionMenus,
        SESSION_KEYS.adminSessionEditableMenus,
        SESSION_KEYS.adminSessionRole,
        SESSION_KEYS.adminSessionName
      ];

    keysToClear.forEach(key => {
      try { sessionStorage.removeItem(key); } catch { /* ignore */ }
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    });

    if (normalized === 'admin') {
      clearPersistedProductionSessionAccount();
    }

    window.BremSessionSecurity?.clearActivityMarker?.();
  }

  function clearAllSessionAuthStorage() {
    clearScopeSessionAuth('admin');
    clearScopeSessionAuth('rider');
  }

  function purgeLegacyAuthFromLocalStorage() {
    Object.values(SESSION_KEYS).forEach(key => {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    });

    const authPrefixes = ['brem-auth-', 'brem_sb_', 'brem_session_'];
    try {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (!key) continue;
        if (authPrefixes.some(prefix => key.startsWith(prefix)) || Object.values(SESSION_KEYS).includes(key)) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      /* ignore */
    }
  }

  function getAdminSessionStore() {
    return window.BremLoginPrefs?.getSessionStore?.('admin') || sessionStorage;
  }

  function getRiderSessionStore() {
    return window.BremLoginPrefs?.getSessionStore?.('rider') || sessionStorage;
  }

  function getSessionStoreForKey(key) {
    if (key === SESSION_KEYS.driverId) return getRiderSessionStore();
    return getAdminSessionStore();
  }

  const sessionAdapter = {
    read(key) {
      try {
        const primary = getSessionStoreForKey(key);
        const value = primary.getItem(key);
        if (value != null) return value;

        const fallback = primary === localStorage ? sessionStorage : localStorage;
        return fallback.getItem(key);
      } catch {
        return null;
      }
    },
    write(key, value) {
      getSessionStoreForKey(key).setItem(key, value);
    },
    remove(key) {
      try { sessionStorage.removeItem(key); } catch { /* ignore */ }
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
  };

  function createId() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function normalizeHiddenFields(value) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {};
    if (source.residentNumber) result.residentNumber = true;
    if (source.accountNumber) result.accountNumber = true;
    return result;
  }

  function normalizeDriverPasswordFields(driver) {
    // Production note: Supabase 운영 모드에서는 기사 비밀번호를 riders 테이블에 저장하지 않는다.
    // 이 필드는 local 개발 데이터 호환용이며, 운영 로그인은 Supabase Auth가 담당한다.
    const digitsOnly = String(driver.password || '').replace(/[^0-9]/g, '');
    let residentNumber = String(driver.residentNumber || '').replace(/[^0-9]/g, '');
    let password = String(driver.password ?? '').trim();

    if (!residentNumber && digitsOnly.length === 13) {
      residentNumber = digitsOnly;
      const passwordDigits = password.replace(/[^0-9]/g, '');
      if (!password || passwordDigits === digitsOnly) {
        password = '1234';
      }
    }

    return { residentNumber, password };
  }

  function normalizeDrivers(drivers) {
    let migrated = false;
    const normalizedDrivers = drivers.map(driver => {
      let next = { ...driver };
      const legacyKey = ['res', 'identId'].join('');
      const legacyPassword = driver[legacyKey];
      if (legacyPassword !== undefined) {
        migrated = true;
        const { [legacyKey]: _removed, ...rest } = driver;
        next = { ...rest, password: driver.password || legacyPassword };
      }

      const authFields = normalizeDriverPasswordFields(next);

      const withPlatforms = {
        ...next,
        residentNumber: authFields.residentNumber,
        password: authFields.password,
        baeminId: String(next.baeminId || '').trim(),
        accountNumber: String(next.accountNumber || '').trim(),
        bankName: String(next.bankName || '').trim(),
        accountHolder: String(next.accountHolder || '').trim(),
        regionBaemin: String(next.regionBaemin || '').trim(),
        regionCoupang: String(next.regionCoupang || '').trim(),
        platformCoupang: next.platformCoupang !== false,
        platformBaemin: Boolean(next.platformBaemin),
        promotionSelectorCoupang: String(
          next.promotionSelectorCoupang || next.selectedPromotionType || ''
        ).trim(),
        promotionSelectorBaemin: String(
          next.promotionSelectorBaemin || next.selectedPromotionType || ''
        ).trim(),
        promotionRuleIdCoupang: String(
          next.promotionRuleIdCoupang || next.promotionSelectorCoupang || next.selectedPromotionType || ''
        ).trim(),
        promotionRuleIdBaemin: String(
          next.promotionRuleIdBaemin || next.promotionSelectorBaemin || next.selectedPromotionType || ''
        ).trim(),
        selectedMissionId: String(next.selectedMissionId || '').trim(),
        selectedMissionIdBaemin: String(next.selectedMissionIdBaemin || '').trim(),
        selectedMissionIdCoupang: String(next.selectedMissionIdCoupang || '').trim(),
        longEventPlatform: normalizeLongEventPlatform(next.longEventPlatform),
        hiddenFields: normalizeHiddenFields(next.hiddenFields)
      };

      if (
        next.residentNumber !== withPlatforms.residentNumber
        || next.password !== withPlatforms.password
        || next.baeminId !== withPlatforms.baeminId
        || next.platformCoupang !== withPlatforms.platformCoupang
        || next.platformBaemin !== withPlatforms.platformBaemin
        || next.longEventPlatform !== withPlatforms.longEventPlatform
        || next.promotionSelectorCoupang !== withPlatforms.promotionSelectorCoupang
        || next.promotionSelectorBaemin !== withPlatforms.promotionSelectorBaemin
        || next.promotionRuleIdCoupang !== withPlatforms.promotionRuleIdCoupang
        || next.promotionRuleIdBaemin !== withPlatforms.promotionRuleIdBaemin
        || JSON.stringify(normalizeHiddenFields(next.hiddenFields)) !== JSON.stringify(withPlatforms.hiddenFields)
      ) {
        migrated = true;
      }

      return withPlatforms;
    });
    if (migrated && !isProductionMode()) {
      invalidateDriversNormalizeCache();
      storageAdapter.write(KEYS.drivers, normalizedDrivers);
    }
    return normalizedDrivers;
  }

  function readEventCatalogRaw() {
    const catalog = storageAdapter.read(KEYS.eventCatalog, null);
    if (catalog) return catalog;

    const config = storageAdapter.read(KEYS.eventConfig, null);
    if (config && config.targetItem) {
      return [{ id: 'legacy-global', name: config.targetItem, targetCount: Number(config.targetCount || 500) }];
    }

    const legacy = storageAdapter.read(KEYS.legacyMission, {});
    if (legacy.targetItem || legacy.PCX || legacy.NMAX) {
      return [{
        id: 'legacy-global',
        name: legacy.targetItem || '장기근속 보상',
        targetCount: Number(legacy.targetCount || legacy.PCX || legacy.NMAX || 500)
      }];
    }

    return [];
  }

  const drivers = {
    getAll() {
      let list = storageAdapter.read(KEYS.drivers, []);
      if ((!Array.isArray(list) || !list.length) && window.BremDataCache?.isValid?.(KEYS.drivers)) {
        const cached = window.BremDataCache.getData(KEYS.drivers);
        if (Array.isArray(cached) && cached.length) list = cached;
      }
      const sourceRef = Array.isArray(list) ? list : [];
      // 원본 배열 기준으로 캐시한다. (예전엔 dedupe 결과로 비교해서 캐시가 절대 맞지 않아
      //  getAll() 호출마다 dedupe+normalize 를 전부 다시 돌렸다 → 목록/대시보드 렉의 주원인)
      if (normalizedDriversCache && normalizedDriversSourceRef === sourceRef) {
        return normalizedDriversCache;
      }
      const normalized = normalizeDrivers(dedupeDriversList(sourceRef));
      normalizedDriversCache = normalized;
      normalizedDriversSourceRef = sourceRef;
      return normalized;
    },

    getById(id) {
      return drivers.getAll().find(driver => driver.id === id) || null;
    },

    async fetchById(id, options = {}) {
      const riderId = String(id || '').trim();
      if (!riderId) return null;
      const cached = drivers.getById(riderId);
      if (!isProductionMode()) return cached || null;
      if (cached && options.force !== true) return cached;

      const result = await fetchRiderViaServer(riderId);
      if (!result.ok) {
        throw new Error(result.message || '기사 정보를 불러오지 못했습니다.');
      }
      return result.rider || drivers.getById(riderId);
    },

    getSupabaseTotal() {
      return driversLoadMeta.supabaseTotal || drivers.getAll().length;
    },

    async deleteAll() {
      if (!isProductionMode()) {
        throw new Error('운영 환경에서만 기사 전체 삭제를 실행할 수 있습니다.');
      }
      const result = await deleteAllRidersViaServer();
      clearDriversCacheHard();
      markDriversLoadComplete(0, 0);
      window.BremDataCache?.invalidate?.(KEYS.drivers);
      return result;
    },

    async verifySupabaseCount(expected = 0) {
      const result = await countRidersViaServer();
      if (!result.ok) {
        throw new Error(result.message || result.error || 'Supabase 기사 수를 확인하지 못했습니다.');
      }
      return {
        ok: true,
        count: Number(result.count || 0),
        matches: Number(result.count || 0) === Number(expected)
      };
    },

    saveAll(nextDrivers) {
      if (isProductionMode()) {
        setDriversCache(nextDrivers);
        return Promise.resolve(nextDrivers);
      }
      if (isLocalDevBackend()) {
        setDriversCache(nextDrivers);
        if (activeStorageAdapter.type === 'local') {
          return activeStorageAdapter.write(KEYS.drivers, nextDrivers).then(() => nextDrivers);
        }
        return Promise.resolve(nextDrivers);
      }
      storageAdapter.write(KEYS.drivers, nextDrivers);
      if (!isStoragePersistReady()) {
        return Promise.reject(new Error('Supabase에 연결되지 않았습니다. 관리자 화면에서 다시 로그인하세요.'));
      }
      return flushActiveStorage();
    },

    buildNewDriver(driver) {
      const baeminId = String(driver.baeminId || '').trim();
      const platformBaemin = driver.platformBaemin !== undefined
        ? Boolean(driver.platformBaemin)
        : Boolean(baeminId);
      const platformCoupang = driver.platformCoupang !== undefined
        ? driver.platformCoupang !== false
        : true;
      const authFields = normalizeDriverPasswordFields({
        residentNumber: driver.residentNumber,
        password: driver.password || '1234'
      });

      return {
        id: createId(),
        name: driver.name,
        phone: driver.phone,
        residentNumber: authFields.residentNumber,
        password: authFields.password || '1234',
        accountNumber: String(driver.accountNumber || '').trim(),
        bankName: String(driver.bankName || '').trim(),
        accountHolder: String(driver.accountHolder || '').trim(),
        baeminId,
        platformCoupang,
        platformBaemin,
        regionBaemin: String(driver.regionBaemin || '').trim(),
        regionCoupang: String(driver.regionCoupang || '').trim(),
        longEventItemId: driver.longEventItemId || '',
        longEventItem: driver.longEventItem || '',
        longEventStartDate: driver.longEventStartDate || '',
        longEventPlatform: normalizeLongEventPlatform(driver.longEventPlatform),
        joinDate: driver.joinDate,
        memo: driver.memo,
        status: driver.status,
        selectedMissionId: '',
        selectedMissionIdBaemin: '',
        selectedMissionIdCoupang: '',
        hiddenFields: normalizeHiddenFields(driver.hiddenFields),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    },

    bulkUpsert(riderList, options = {}) {
      const list = Array.isArray(riderList) ? riderList.filter(Boolean) : [];
      if (!list.length) return Promise.resolve({ ok: true, succeeded: 0 });

      const prevList = drivers.getAll();
      const merged = new Map(prevList.map(item => [item.id, item]));
      // 일괄등록의 "빈 칸만 채우기" 항목은 변경된 필드만 담고 있다. 그대로 덮으면
      // 캐시 안 기사에서 이름·미션·장기이벤트가 사라진다. 서버는 보호되지만,
      // 그 상태로 관리자가 해당 기사를 개별 저장하면 빈 값이 DB 까지 올라간다.
      // (개별 저장 경로에는 일괄등록용 미션 보호가 없다)
      list.forEach(item => {
        const id = item?.id;
        if (!id) return;
        const prev = merged.get(id);
        const next = prev ? { ...prev, ...item } : { ...item };
        delete next.bulkFillPatch;
        merged.set(id, next);
      });
      const nextList = Array.from(merged.values());
      setDriversCache(nextList);

      if (isProductionMode()) {
        return persistRidersBulkViaServer(list, options)
          .then(result => {
            markDriversCache(drivers.getAll(), { source: 'write' });
            return result;
          })
          .catch(error => {
            setDriversCache(prevList);
            throw error;
          });
      }

      if (activeStorageAdapter.type === 'supabase') {
        return activeStorageAdapter.write(KEYS.drivers, nextList)
          .then(() => ({ ok: true, succeeded: list.length }))
          .catch(error => {
            setDriversCache(prevList);
            throw error;
          });
      }

      return drivers.saveAll(nextList).then(() => ({ ok: true, succeeded: list.length }));
    },

    batchPatch(patches, options = {}) {
      const items = Array.isArray(patches)
        ? patches.filter(item => item?.id && item?.changes && Object.keys(item.changes).length)
        : [];
      if (!items.length) return Promise.resolve({ ok: true, updated: 0 });

      const prevList = drivers.getAll();
      const patchMap = new Map(items.map(item => [item.id, item.changes]));
      const nextDrivers = prevList.map(driver => {
        const changes = patchMap.get(driver.id);
        if (!changes) return driver;
        return {
          ...driver,
          ...changes,
          updatedAt: new Date().toISOString()
        };
      });
      const updatedRiders = nextDrivers.filter(driver => patchMap.has(driver.id));
      setDriversCache(nextDrivers);

      if (isProductionMode()) {
        const missionOnly = items.every(item => Object.keys(extractMissionChanges(item.changes)).length > 0)
          && items.every(item => isMissionOnlyChanges(item.changes));
        const longEventOnly = items.every(item => isLongEventOnlyChanges(item.changes));
        const missionPatches = items.map(item => ({
          id: item.id,
          changes: extractMissionChanges(item.changes)
        }));
        const persist = missionOnly
          ? persistRiderMissionsBulkViaServer(missionPatches, { maxBatch: options.maxBatch || 300 })
          : longEventOnly
            ? persistRiderLongEventsBulkViaServer(items, { maxBatch: options.maxBatch || 300 })
            : persistRidersBulkViaServer(updatedRiders, {
              skipAuthProvision: true,
              maxBatch: options.maxBatch || 300
            });
        return persist
          .then(result => {
            markDriversCache(drivers.getAll(), { source: 'write' });
            return { ...result, updated: updatedRiders.length };
          })
          .catch(error => {
            setDriversCache(prevList);
            throw error;
          });
      }

      if (isLocalDevBackend()) {
        return drivers.saveAll(nextDrivers).then(() => ({ ok: true, updated: updatedRiders.length }));
      }

      if (activeStorageAdapter.type === 'supabase') {
        return activeStorageAdapter.write(KEYS.drivers, nextDrivers)
          .then(() => ({ ok: true, updated: updatedRiders.length }))
          .catch(error => {
            setDriversCache(prevList);
            throw error;
          });
      }

      return drivers.saveAll(nextDrivers).then(() => ({ ok: true, updated: updatedRiders.length }));
    },

    create(driver) {
      const prevList = drivers.getAll();
      const list = [...prevList];
      const baeminId = String(driver.baeminId || '').trim();
      const platformBaemin = driver.platformBaemin !== undefined
        ? Boolean(driver.platformBaemin)
        : Boolean(baeminId);
      const platformCoupang = driver.platformCoupang !== undefined
        ? driver.platformCoupang !== false
        : true;

      const authFields = normalizeDriverPasswordFields({
        residentNumber: driver.residentNumber,
        password: driver.password || '1234'
      });

      const newDriver = {
        id: createId(),
        name: driver.name,
        phone: driver.phone,
        residentNumber: authFields.residentNumber,
        password: authFields.password || '1234',
        accountNumber: String(driver.accountNumber || '').trim(),
        bankName: String(driver.bankName || '').trim(),
        accountHolder: String(driver.accountHolder || '').trim(),
        baeminId,
        platformCoupang,
        platformBaemin,
        regionBaemin: String(driver.regionBaemin || '').trim(),
        regionCoupang: String(driver.regionCoupang || '').trim(),
        longEventItemId: driver.longEventItemId || '',
        longEventItem: driver.longEventItem || '',
        longEventStartDate: driver.longEventStartDate || '',
        longEventPlatform: normalizeLongEventPlatform(driver.longEventPlatform),
        joinDate: driver.joinDate,
        memo: driver.memo,
        status: driver.status,
        selectedMissionId: '',
        selectedMissionIdBaemin: '',
        selectedMissionIdCoupang: '',
        hiddenFields: normalizeHiddenFields(driver.hiddenFields),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      list.unshift(newDriver);
      if (isProductionMode()) {
        setDriversCache(list);
        return persistRiderViaServer(newDriver)
          .then(() => {
            markDriversCache(drivers.getAll(), { source: 'write' });
            return newDriver;
          })
          .catch(error => {
            setDriversCache(prevList);
            throw error;
          });
      }
      const persist = drivers.saveAll(list);
      if (!isLocalDevBackend() && activeStorageAdapter.type === 'supabase' && activeStorageAdapter.upsertRider) {
        return persist.then(async () => {
          await activeStorageAdapter.upsertRider(newDriver);
          return newDriver;
        });
      }
      return persist.then(() => newDriver);
    },

    update(id, changes) {
      const prevList = drivers.getAll();
      const isSelf = isRiderSelfUpdate(id);
      const nextDrivers = prevList.map(driver => {
        if (driver.id !== id) return driver;
        const merged = { ...driver, ...changes };
        delete merged.currentPassword;
        delete merged.newPassword;
        delete merged.passwordExplicit;
        if (changes.newPassword) {
          merged.password = String(changes.newPassword).trim();
        } else if (changes.password && changes.passwordExplicit) {
          merged.password = String(changes.password).trim();
        } else if ('password' in changes && !changes.passwordExplicit) {
          merged.password = driver.password;
        } else if ('password' in changes || 'residentNumber' in changes) {
          const authFields = normalizeDriverPasswordFields(merged);
          merged.residentNumber = authFields.residentNumber;
          merged.password = authFields.password;
        }
        if ('hiddenFields' in changes) {
          merged.hiddenFields = normalizeHiddenFields(changes.hiddenFields);
        }
        return {
          ...merged,
          updatedAt: new Date().toISOString()
        };
      });
      const updated = nextDrivers.find(driver => driver.id === id);
      if (!updated) throw new Error('기사를 찾을 수 없습니다.');
      if (isProductionMode()) {
        setDriversCache(nextDrivers);
        const riderPayload = changes.passwordExplicit ? { ...updated, passwordExplicit: true } : updated;
        const persist = isSelf
          ? persistRiderSelfViaServer(id, changes)
          : (isMissionOnlyChanges(changes)
            ? persistRiderMissionsBulkViaServer([{
              id,
              changes: extractMissionChanges(changes)
            }])
            : (isLongEventOnlyChanges(changes)
              ? persistRiderLongEventsBulkViaServer([{ id, changes }])
              : persistRiderViaServer(riderPayload)));
        return persist
          .then(() => {
            markDriversCache(drivers.getAll(), { source: 'write' });
            return drivers.getById(id) || updated;
          })
          .catch(error => {
            setDriversCache(prevList);
            throw error;
          });
      }
      return drivers.saveAll(nextDrivers);
    },

    remove(id) {
      const prevList = drivers.getAll();
      const next = prevList.filter(driver => driver.id !== id);
      if (isProductionMode()) {
        setDriversCache(next);
        driversLoadMeta = { ...driversLoadMeta, complete: false };
        return deleteRiderViaServer(id)
          .then(() => {
            markDriversLoadComplete(next.length, next.length);
            markDriversCache(next, { source: 'write' });
          })
          .catch(error => {
            setDriversCache(prevList);
            throw error;
          });
      }
      const persist = drivers.saveAll(next);
      if (!isLocalDevBackend() && activeStorageAdapter.type === 'supabase' && activeStorageAdapter.deleteRider) {
        return Promise.all([persist, activeStorageAdapter.deleteRider(id)]);
      }
      return persist;
    },

    async mergeSelected(riderIds) {
      const ids = [...new Set((Array.isArray(riderIds) ? riderIds : [])
        .map(id => String(id || '').trim())
        .filter(Boolean))];
      if (ids.length < 2) {
        throw new Error('병합할 기사를 2명 이상 선택하세요.');
      }
      if (!isProductionMode()) {
        throw new Error('운영 환경에서만 선택 병합을 실행할 수 있습니다.');
      }

      const result = await mergeSelectedRidersViaServer(ids);
      if (result.ok) {
        remapDriverIdsInLocalData(result.idRemap || {});
        await flushActiveStorage().catch(() => ({}));
        await reloadDrivers(true).catch(() => ({}));
      }
      return result;
    },

    async mergeAuto() {
      if (!isProductionMode()) {
        throw new Error('운영 환경에서만 전체 자동병합을 실행할 수 있습니다.');
      }

      const result = await mergeAutoRidersViaServer();
      if (result.ok) {
        remapDriverIdsInLocalData(result.idRemap || {});
        await flushActiveStorage().catch(() => ({}));
        await reloadDrivers(true).catch(() => ({}));
      }
      return result;
    },

    resetPassword(id, defaultPassword = '1234') {
      const driver = drivers.getById(id);
      if (!driver) throw new Error('기사를 찾을 수 없습니다.');
      const password = String(defaultPassword || '1234').trim() || '1234';
      if (isProductionMode()) {
        return resetRiderPasswordViaServer(id, password);
      }
      return drivers.update(id, { password, passwordExplicit: true });
    },

    setFieldHidden(id, fieldKey, hidden) {
      const driver = drivers.getById(id);
      if (!driver) throw new Error('기사를 찾을 수 없습니다.');
      const nextHiddenFields = { ...(driver.hiddenFields || {}) };
      if (hidden) nextHiddenFields[fieldKey] = true;
      else delete nextHiddenFields[fieldKey];
      return drivers.update(id, { hiddenFields: nextHiddenFields });
    },

    setFieldHiddenForAll(fieldKey, hidden) {
      const list = drivers.getAll();
      if (!list.length) return Promise.resolve(0);
      const nextDrivers = list.map(driver => {
        const nextHiddenFields = { ...(driver.hiddenFields || {}) };
        if (hidden) nextHiddenFields[fieldKey] = true;
        else delete nextHiddenFields[fieldKey];
        return {
          ...driver,
          hiddenFields: normalizeHiddenFields(nextHiddenFields),
          updatedAt: new Date().toISOString()
        };
      });
      return drivers.saveAll(nextDrivers).then(() => nextDrivers.length);
    }
  };

  const calls = {
    getAll() {
      // 콜수는 2년치(수만~수십만 행)라 매 호출 normalize 하면 화면이 멈춘다 → 원본 ref 기준 캐시
      const sourceRef = storageAdapter.read(KEYS.calls, []);
      if (normalizedCallsCache && normalizedCallsSourceRef === sourceRef) {
        return normalizedCallsCache;
      }
      const normalized = normalizeCalls(sourceRef);
      normalizedCallsCache = normalized;
      normalizedCallsSourceRef = sourceRef;
      return normalized;
    },

    saveForDriverDates(driverId, dates, count, platform = DEFAULT_PLATFORM) {
      const p = normalizePlatform(platform);
      const dateSet = new Set(dates);
      const list = calls.getAll().filter(call => !(call.driverId === driverId && dateSet.has(call.date) && normalizePlatform(call.platform) === p));
      dates.forEach(date => {
        list.push({
          id: `${driverId}-${date}-${p}`,
          driverId,
          date,
          platform: p,
          count: Number(count)
        });
      });
      const incrementalRows = dates.map(date => ({
        id: `${driverId}-${date}-${p}`,
        driverId,
        date,
        platform: p,
        count: Number(count)
      }));
      storageAdapter.write(KEYS.calls, list, { incrementalRows });
      return list;
    },

    upsertDaily({ driverId, date, count, platform = DEFAULT_PLATFORM, logEdit = true }) {
      const p = normalizePlatform(platform);
      const callDate = String(date).slice(0, 10);
      const nextCount = Number(count);
      const recordId = `${driverId}-${callDate}-${p}`;
      const existing = calls.getAll().find(call => call.id === recordId);

      if (logEdit) {
        if (existing && Number(existing.count) !== nextCount) {
          callEditLogs.append({
            callId: recordId,
            driverId,
            date: callDate,
            platform: p,
            action: 'update',
            previousCount: Number(existing.count) || 0,
            nextCount
          });
        } else if (!existing) {
          callEditLogs.append({
            callId: recordId,
            driverId,
            date: callDate,
            platform: p,
            action: 'create',
            previousCount: null,
            nextCount
          });
        }
      }

      return calls.upsertBatchDaily({
        date: callDate,
        platform: p,
        records: [{ driverId, count: nextCount }]
      });
    },

    upsertBatchDaily({ date, records = [], platform = DEFAULT_PLATFORM }) {
      const p = normalizePlatform(platform);
      const callDate = String(date).slice(0, 10);
      const normalizedRecords = (Array.isArray(records) ? records : [])
        .map(record => ({
          driverId: String(record.driverId || ''),
          count: Number(record.count ?? record.orderCount ?? 0)
        }))
        .filter(record => record.driverId);
      if (!callDate || !normalizedRecords.length) return calls.getAll();

      const byId = new Map(calls.getAll().map(call => [call.id, call]));
      normalizedRecords.forEach(record => {
        const id = `${record.driverId}-${callDate}-${p}`;
        const existing = byId.get(id);
        byId.set(id, {
          id,
          driverId: record.driverId,
          date: callDate,
          platform: p,
          count: record.count,
          riderPublishedAt: existing?.riderPublishedAt ?? null
        });
      });

      const incrementalRows = normalizedRecords.map(record => ({
        id: `${record.driverId}-${callDate}-${p}`,
        driverId: record.driverId,
        date: callDate,
        platform: p,
        count: record.count,
        riderPublishedAt: byId.get(`${record.driverId}-${callDate}-${p}`)?.riderPublishedAt ?? null
      }));

      return storageAdapter.write(KEYS.calls, [...byId.values()], { incrementalRows });
    },

    sumForDriverSince(driverId, startDate, platform) {
      if (!startDate) return 0;
      const scopedPlatform = platform ? normalizeLongEventPlatform(platform) : null;
      const sumBoth = !scopedPlatform || scopedPlatform === 'both';
      return calls.getAll()
        .filter(call => {
          if (call.driverId !== driverId || call.date < startDate) return false;
          if (sumBoth) return true;
          return normalizePlatform(call.platform) === scopedPlatform;
        })
        .reduce((sum, call) => sum + Number(call.count || 0), 0);
    },

    async removeByIdAsync(id) {
      const targetId = String(id || '').trim();
      if (!targetId) return calls.getAll();

      if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.deleteAdminCallsByIds) {
        await activeStorageAdapter.deleteAdminCallsByIds([targetId]);
        return calls.getAll();
      }

      if (!calls.getAll().some(call => call.id === targetId)) {
        return calls.getAll();
      }

      const list = calls.getAll().filter(call => call.id !== targetId);
      await awaitPersist(storageAdapter.write(KEYS.calls, list, {
        allowEmpty: true,
        deletedRowIds: [targetId]
      }));
      return calls.getAll();
    },

    removeById(id) {
      void calls.removeByIdAsync(id);
      return calls.getAll().filter(call => call.id !== id);
    },

    async removeByIdsAsync(ids = []) {
      const idSet = new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean));
      if (!idSet.size) return calls.getAll();

      if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.deleteAdminCallsByIds) {
        await activeStorageAdapter.deleteAdminCallsByIds([...idSet]);
        return calls.getAll();
      }

      const list = calls.getAll().filter(call => !idSet.has(call.id));
      await awaitPersist(storageAdapter.write(KEYS.calls, list, {
        deletedRowIds: [...idSet]
      }));
      return calls.getAll();
    },

    removeByPeriod(period, platform = DEFAULT_PLATFORM) {
      const p = normalizePlatform(platform);
      const periodKey = String(period || '').slice(0, 10);
      if (!periodKey) return calls.getAll();
      const removedIds = calls.getAll()
        .filter(call => normalizePlatform(call.platform) === p && String(call.date).slice(0, 10) === periodKey)
        .map(call => call.id);
      const list = calls.getAll().filter(call => !removedIds.includes(call.id));
      if (activeStorageAdapter.deleteAdminCallsByPeriod) {
        void activeStorageAdapter.deleteAdminCallsByPeriod(p, periodKey);
      } else if (removedIds.length) {
        storageAdapter.write(KEYS.calls, list, { deletedRowIds: removedIds });
      }
      return list;
    }
  };

  function normalizeCallEditLog(entry) {
    const platform = normalizePlatform(entry.platform);
    const date = String(entry.date || '').slice(0, 10);
    const driverId = String(entry.driverId || '');
    return {
      id: entry.id || createId(),
      callId: String(entry.callId || `${driverId}-${date}-${platform}`),
      driverId,
      date,
      platform,
      action: entry.action === 'create' ? 'create' : 'update',
      previousCount: entry.previousCount == null ? null : Number(entry.previousCount),
      nextCount: Number(entry.nextCount ?? 0),
      editedAt: entry.editedAt || new Date().toISOString(),
      editedBy: String(entry.editedBy || '').trim()
    };
  }

  const callEditLogs = {
    getAll() {
      const list = storageAdapter.read(KEYS.callEditLogs, []);
      return (Array.isArray(list) ? list : []).map(normalizeCallEditLog);
    },

    append(entry) {
      const next = normalizeCallEditLog({
        ...entry,
        editedBy: entry.editedBy || activeSupabaseProfile?.name || activeSupabaseProfile?.login_id || 'admin',
        editedAt: new Date().toISOString()
      });
      const list = [next, ...callEditLogs.getAll()];
      storageAdapter.write(KEYS.callEditLogs, list);
      return next;
    },

    getForPlatformMonth(platform, monthKey) {
      const p = normalizePlatform(platform);
      const month = String(monthKey || '').slice(0, 7);
      return callEditLogs.getAll().filter(entry => {
        if (normalizePlatform(entry.platform) !== p) return false;
        if (month && String(entry.date).slice(0, 7) !== month) return false;
        return true;
      });
    },

    getForPlatformDate(platform, dateKey) {
      const p = normalizePlatform(platform);
      const date = String(dateKey || '').slice(0, 10);
      return callEditLogs.getAll().filter(entry => {
        if (normalizePlatform(entry.platform) !== p) return false;
        if (date && String(entry.date).slice(0, 10) !== date) return false;
        return true;
      });
    }
  };

  const rejections = {
    getAll() {
      const sourceRef = storageAdapter.read(KEYS.rejections, []);
      if (normalizedRejectionsCache && normalizedRejectionsSourceRef === sourceRef) {
        return normalizedRejectionsCache;
      }
      const normalized = migrateRejectionsPlatform(normalizeRejections(sourceRef));
      normalizedRejectionsCache = normalized;
      normalizedRejectionsSourceRef = sourceRef;
      return normalized;
    },

    upsertWeekly({ driverId, weekStart, rate, platform = DEFAULT_PLATFORM, stats = null, source = 'manual', riderPublishedAt = null }) {
      const p = normalizePlatform(platform);
      const list = rejections.getAll().filter(item => !(item.driverId === driverId && item.weekStart === weekStart && normalizePlatform(item.platform) === p));
      const statsObj = stats && typeof stats === 'object' ? { ...stats } : {};
      const unmeasured = statsObj.unmeasured === true || rate == null;
      if (unmeasured) statsObj.unmeasured = true;
      const newRow = {
        id: `${driverId}-${weekStart}-${p}`,
        driverId,
        weekStart,
        platform: p,
        rate: unmeasured ? 0 : Number(rate),
        stats: statsObj,
        source: String(source || 'manual'),
        updatedAt: new Date().toISOString(),
        riderPublishedAt: riderPublishedAt || null
      };
      list.push(newRow);
      storageAdapter.write(KEYS.rejections, list, { incrementalRows: [newRow] });
      return list;
    },

    upsertWeeklyBatch(entries = []) {
      const normalized = (Array.isArray(entries) ? entries : []).filter(entry => entry?.driverId && entry?.weekStart);
      if (!normalized.length) return rejections.getAll();

      let list = rejections.getAll();
      const incrementalRows = [];
      normalized.forEach(entry => {
        const p = normalizePlatform(entry.platform);
        const statsObj = entry.stats && typeof entry.stats === 'object' ? { ...entry.stats } : {};
        const unmeasured = statsObj.unmeasured === true || entry.rate == null;
        if (unmeasured) statsObj.unmeasured = true;
        list = list.filter(item => !(
          item.driverId === entry.driverId
          && item.weekStart === entry.weekStart
          && normalizePlatform(item.platform) === p
        ));
        const newRow = {
          id: `${entry.driverId}-${entry.weekStart}-${p}`,
          driverId: entry.driverId,
          weekStart: entry.weekStart,
          platform: p,
          rate: unmeasured ? 0 : Number(entry.rate),
          stats: statsObj,
          source: String(entry.source || 'manual'),
          updatedAt: new Date().toISOString(),
          riderPublishedAt: entry.riderPublishedAt || null
        };
        list.push(newRow);
        incrementalRows.push(newRow);
      });

      storageAdapter.write(KEYS.rejections, list, { incrementalRows });
      return list;
    },

    removeById(id) {
      void rejections.removeByIdAsync(id);
      return rejections.getAll().filter(item => item.id !== id);
    },

    async removeByIdAsync(id) {
      const targetId = String(id || '').trim();
      if (!targetId) return rejections.getAll();
      if (!rejections.getAll().some(item => item.id === targetId)) return rejections.getAll();

      if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.deleteAdminRejectionRatesByIds) {
        await activeStorageAdapter.deleteAdminRejectionRatesByIds([targetId]);
        return rejections.getAll();
      }

      const list = rejections.getAll().filter(item => item.id !== targetId);
      await awaitPersist(storageAdapter.write(KEYS.rejections, list));
      return rejections.getAll();
    },

    removeByIds(ids) {
      void rejections.removeByIdsAsync(ids);
      const drop = new Set((ids || []).filter(Boolean));
      return rejections.getAll().filter(item => !drop.has(item.id));
    },

    async removeByIdsAsync(ids = []) {
      const idSet = new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean));
      if (!idSet.size) return rejections.getAll();

      if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.deleteAdminRejectionRatesByIds) {
        await activeStorageAdapter.deleteAdminRejectionRatesByIds([...idSet]);
      } else {
        const list = rejections.getAll().filter(item => !idSet.has(item.id));
        storageAdapter.write(KEYS.rejections, list);
        await storageAdapter.flush?.();
      }

      window.BremDataCache?.invalidate?.(KEYS.rejections);
      return rejections.getAll();
    },

    async removeAllForPlatformAsync(platform) {
      const p = normalizePlatform(platform);
      const ids = rejections.getAll()
        .filter(item => normalizePlatform(item.platform) === p)
        .map(item => item.id);
      if (!ids.length) return rejections.getAll();
      return rejections.removeByIdsAsync(ids);
    },

    removeAllForPlatform(platform) {
      void rejections.removeAllForPlatformAsync(platform);
      const p = normalizePlatform(platform);
      return rejections.getAll().filter(item => normalizePlatform(item.platform) !== p);
    },

    getEntryForWeek(driverId, weekStart, platform = DEFAULT_PLATFORM, options = {}) {
      const p = normalizePlatform(platform);
      const riderOnly = options.riderOnly === true;
      // 대시보드는 기사×플랫폼마다 이 함수를 부른다 → 선형 탐색이면 O(기사수 × 거절율행수).
      // 목록 1회당 인덱스 Map 을 만들어 O(1) 조회로 바꾼다.
      const list = rejections.getAll();
      if (!rejectionsWeekIndex || rejectionsWeekIndexRef !== list) {
        const index = new Map();
        list.forEach(item => {
          const key = `${item.driverId}|${item.weekStart}|${normalizePlatform(item.platform)}`;
          const bucket = index.get(key);
          if (!bucket) {
            index.set(key, item);
          } else if (!bucket.riderPublishedAt && item.riderPublishedAt) {
            index.set(key, item);
          }
        });
        rejectionsWeekIndex = index;
        rejectionsWeekIndexRef = list;
      }
      const found = rejectionsWeekIndex.get(`${driverId}|${weekStart}|${p}`) || null;
      const entry = (found && riderOnly && !found.riderPublishedAt) ? null : found;
      if (!entry) return null;
      const stats = entry.stats && typeof entry.stats === 'object' ? entry.stats : {};
      return {
        ...entry,
        stats,
        rate: stats.unmeasured ? null : Number(entry.rate)
      };
    },

    countPendingRiderPublish() {
      return rejections.getAll().filter(item => !item.riderPublishedAt).length;
    },

    async publishPendingToRiderView() {
      const now = new Date().toISOString();
      const incrementalRows = [];
      const list = rejections.getAll().map(item => {
        if (item.riderPublishedAt) return item;
        const updated = { ...item, riderPublishedAt: now };
        incrementalRows.push(updated);
        return updated;
      });

      if (!incrementalRows.length) {
        return { publishedCount: 0, publishedAt: riderViewPublish.getMeta().publishedAt || null };
      }

      await storageAdapter.write(KEYS.rejections, list, { incrementalRows });
      await storageAdapter.flush?.();

      const meta = riderViewPublish.record({
        publishedAt: now,
        rejectionsPublished: incrementalRows.length
      });

      window.BremDataCache?.invalidate?.(KEYS.rejections);
      return { publishedCount: incrementalRows.length, publishedAt: meta.publishedAt };
    },

    getRateForWeek(driverId, weekStart, platform = DEFAULT_PLATFORM, options = {}) {
      const entry = rejections.getEntryForWeek(driverId, weekStart, platform, options);
      return entry ? entry.rate : null;
    }
  };

  const riderViewPublish = {
    getMeta() {
      const raw = storageAdapter.read(KEYS.riderViewPublish, {});
      return raw && typeof raw === 'object' ? raw : {};
    },

    countPending() {
      const pendingCalls = calls.getAll().filter(item => !item.riderPublishedAt).length;
      const pendingRejections = rejections.getAll().filter(item => !item.riderPublishedAt).length;
      return {
        pendingCalls,
        pendingRejections,
        pendingTargets: 0,
        pendingTotal: pendingCalls + pendingRejections
      };
    },

    async fetchStatusFromServer() {
      const result = await adminRidersApi('/api/admin/rider-view/status');
      if (!result.ok) return result;

      const publishedAt = result.publishedAt || null;
      if (publishedAt) {
        const existing = riderViewPublish.getMeta();
        storageAdapter.write(KEYS.riderViewPublish, {
          ...existing,
          publishedAt
        });
      }

      return {
        ok: true,
        publishedAt: publishedAt || riderViewPublish.getMeta().publishedAt || null,
        pendingCalls: Number(result.pendingCalls) || 0,
        pendingRejections: Number(result.pendingRejections) || 0,
        pendingTargets: Number(result.pendingTargets) || 0,
        pendingTotal: Number(result.pendingTotal) || 0
      };
    },

    record({ publishedAt, rejectionsPublished = 0, callsPublished = 0, targetsPublished = 0, publishedBy = '', snapshots = null } = {}) {
      const meta = {
        publishedAt: publishedAt || new Date().toISOString(),
        rejectionsPublished: Number(rejectionsPublished) || 0,
        callsPublished: Number(callsPublished) || 0,
        targetsPublished: Number(targetsPublished) || 0,
        publishedBy: String(
          publishedBy
          || activeSupabaseProfile?.name
          || activeSupabaseProfile?.login_id
          || 'admin'
        ).trim()
      };
      if (snapshots && typeof snapshots === 'object') {
        meta.snapshots = snapshots;
      }
      storageAdapter.write(KEYS.riderViewPublish, meta);
      return meta;
    },

    async publishAllToRiderView() {
      await storageAdapter.flush?.();

      const apiResult = await adminRidersApi('/api/admin/rider-view/publish', {
        method: 'POST',
        body: JSON.stringify({})
      });

      if (apiResult.ok) {
        const meta = riderViewPublish.record({
          publishedAt: apiResult.publishedAt,
          publishedBy: apiResult.publishedBy,
          callsPublished: apiResult.callsPublished,
          rejectionsPublished: apiResult.rejectionsPublished,
          targetsPublished: apiResult.targetsPublished,
          snapshots: apiResult.snapshots
        });

        await Promise.all([
          refreshDataFromServer(KEYS.calls),
          refreshDataFromServer(KEYS.rejections),
          refreshDataFromServer(KEYS.targets)
        ]);

        window.BremDataCache?.invalidate?.(KEYS.riderViewPublish);
        lastRiderPublishStatusAt = 0;
        lastRiderPublishStatusResult = null;
        return {
          publishedCount: Number(apiResult.publishedCount) || 0,
          callsPublished: apiResult.callsPublished || 0,
          rejectionsPublished: apiResult.rejectionsPublished || 0,
          targetsPublished: apiResult.targetsPublished || 0,
          publishedAt: meta.publishedAt
        };
      }

      const fallback = await rejections.publishPendingToRiderView();
      return {
        publishedCount: fallback.publishedCount || 0,
        callsPublished: 0,
        rejectionsPublished: fallback.publishedCount || 0,
        targetsPublished: 0,
        publishedAt: fallback.publishedAt,
        fallback: true,
        message: apiResult.message
      };
    }
  };

  function weekStartKeyFromDate(dateValue) {
    const date = new Date(`${dateValue}T00:00:00`);
    const day = date.getDay();
    const diff = (day - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function weekEndKeyFromDate(weekStart) {
    const end = new Date(`${weekStart}T00:00:00`);
    end.setDate(end.getDate() + 6);
    return [
      end.getFullYear(),
      String(end.getMonth() + 1).padStart(2, '0'),
      String(end.getDate()).padStart(2, '0')
    ].join('-');
  }

  const adminPreferences = {
    getDashboardWeekBasis() {
      const raw = storageAdapter.read(KEYS.dashboardWeekBasis, null);
      if (raw && /^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
        return weekStartKeyFromDate(raw);
      }
      return weekStartKeyFromDate(new Date().toISOString().slice(0, 10));
    },
    setDashboardWeekBasis(dateValue) {
      const weekStart = weekStartKeyFromDate(dateValue);
      storageAdapter.write(KEYS.dashboardWeekBasis, weekStart);
      return weekStart;
    },
    getLeaseDashboardWeekBasis() {
      const raw = storageAdapter.read(KEYS.leaseDashboardWeekBasis, null);
      if (raw && /^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
        return weekStartKeyFromDate(raw);
      }
      return weekStartKeyFromDate(new Date().toISOString().slice(0, 10));
    },
    setLeaseDashboardWeekBasis(dateValue) {
      const weekStart = weekStartKeyFromDate(dateValue);
      storageAdapter.write(KEYS.leaseDashboardWeekBasis, weekStart);
      return weekStart;
    },
    normalizeLeaseVehicleModelTypes(list) {
      if (!Array.isArray(list)) return [];
      const seen = new Set();
      return list
        .map(item => String(item || '').trim())
        .filter(text => {
          if (!text || seen.has(text)) return false;
          seen.add(text);
          return true;
        })
        .sort((a, b) => a.localeCompare(b, 'ko'));
    },
    getLeaseVehicleModelTypes() {
      const raw = storageAdapter.read(KEYS.leaseVehicleModelTypes, null);
      const normalized = adminPreferences.normalizeLeaseVehicleModelTypes(raw);
      if (normalized.length) return normalized;
      return ['PCX', 'NMAX', 'FORZA', '기타'];
    },
    setLeaseVehicleModelTypes(list) {
      const normalized = adminPreferences.normalizeLeaseVehicleModelTypes(list);
      storageAdapter.write(KEYS.leaseVehicleModelTypes, normalized);
      if (activeStorageAdapter.type === 'supabase' && typeof flushActiveStorage === 'function') {
        flushActiveStorage().catch(error => {
          console.warn('[BREM] lease vehicle model types persist failed:', error);
        });
      }
      return normalized;
    },
    addLeaseVehicleModelType(name) {
      const text = String(name || '').trim();
      if (!text) return adminPreferences.getLeaseVehicleModelTypes();
      const list = adminPreferences.getLeaseVehicleModelTypes();
      if (!list.includes(text)) list.push(text);
      return adminPreferences.setLeaseVehicleModelTypes(list);
    },
    removeLeaseVehicleModelType(name) {
      const text = String(name || '').trim();
      if (!text) return adminPreferences.getLeaseVehicleModelTypes();
      return adminPreferences.setLeaseVehicleModelTypes(
        adminPreferences.getLeaseVehicleModelTypes().filter(item => item !== text)
      );
    }
  };

  function normalizeRejections(list) {
    if (!Array.isArray(list) || !list.length) return [];

    const weeklyEntries = [];
    const legacyDaily = [];
    let needsMigration = false;

    list.forEach(item => {
      if (item.weekStart) {
        weeklyEntries.push(item);
        return;
      }
      if (item.date) {
        legacyDaily.push(item);
        needsMigration = true;
      }
    });

    if (!needsMigration) return list;

    const merged = new Map();
    weeklyEntries.forEach(item => {
      merged.set(`${item.driverId}-${item.weekStart}`, item);
    });

    legacyDaily.forEach(item => {
      const weekStart = weekStartKeyFromDate(item.date);
      const key = `${item.driverId}-${weekStart}`;
      const existing = merged.get(key);
      if (!existing || item.date >= (existing.date || '')) {
        merged.set(key, {
          id: `${item.driverId}-${weekStart}-${DEFAULT_PLATFORM}`,
          driverId: item.driverId,
          weekStart,
          platform: DEFAULT_PLATFORM,
          rate: Number(item.rate),
          updatedAt: item.updatedAt || `${item.date}T00:00:00.000Z`
        });
      }
    });

    const normalized = Array.from(merged.values());
    storageAdapter.write(KEYS.rejections, normalized);
    return normalized;
  }

  const targets = {
    getAll() {
      return storageAdapter.read(KEYS.targets, []);
    },

    upsertMonthlyLocal({ driverId, month, count }) {
      const list = targets.getAll().filter(item => !(item.driverId === driverId && item.month === month));
      const newRow = {
        id: `${driverId}-${month}`,
        driverId,
        month,
        count: Number(count)
      };
      list.push(newRow);
      const writeOptions = { incrementalRows: [newRow] };
      if (isProductionMode() && isRiderSelfUpdate(driverId)) {
        stageRiderScopedCache(KEYS.targets, list, { tableLoaded: true });
        return list;
      }
      const persist = storageAdapter.write(KEYS.targets, list, writeOptions);
      return persist || list;
    },

    upsertMonthly({ driverId, month, count }) {
      if (isProductionMode() && isRiderSelfUpdate(driverId)) {
        return persistRiderTargetsViaServer({ monthly: { month, count } })
          .then(() => targets.upsertMonthlyLocal({ driverId, month, count }));
      }
      return awaitPersist(targets.upsertMonthlyLocal({ driverId, month, count }));
    },

    removeById(id) {
      const targetId = String(id || '').trim();
      const list = targets.getAll().filter(item => item.id !== targetId);
      if (activeStorageAdapter.stage) {
        activeStorageAdapter.stage(KEYS.targets, list);
        window.BremDataCache?.set?.(KEYS.targets, list, { source: 'write', tableLoaded: true });
      }
      return list;
    },

    async removeByIdAsync(id) {
      const targetId = String(id || '').trim();
      if (!targetId) return targets.getAll();

      if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.deleteAdminTargetsByIds) {
        await activeStorageAdapter.deleteAdminTargetsByIds([targetId]);
      } else {
        storageAdapter.write(KEYS.targets, targets.getAll());
        await storageAdapter.flush?.();
      }

      return targets.getAll();
    },

    getMonthlyCount(driverId, month) {
      const target = targets.getAll().find(item => item.driverId === driverId && item.month === month);
      return target ? Number(target.count || 0) : 0;
    }
  };

  const weeklyTargets = {
    getAll() {
      return storageAdapter.read(KEYS.weeklyTargets, []);
    },

    upsertLocal({ driverId, weekStart, count }) {
      const list = weeklyTargets.getAll().filter(item => !(item.driverId === driverId && item.weekStart === weekStart));
      const newRow = {
        id: `${driverId}-${weekStart}`,
        driverId,
        weekStart,
        count: Number(count)
      };
      list.push(newRow);
      if (isProductionMode() && isRiderSelfUpdate(driverId)) {
        stageRiderScopedCache(KEYS.weeklyTargets, list);
        return list;
      }
      const persist = storageAdapter.write(KEYS.weeklyTargets, list);
      return persist || list;
    },

    upsert({ driverId, weekStart, count }) {
      if (isProductionMode() && isRiderSelfUpdate(driverId)) {
        return persistRiderTargetsViaServer({ weekly: { weekStart, count } })
          .then(() => weeklyTargets.upsertLocal({ driverId, weekStart, count }));
      }
      return awaitPersist(weeklyTargets.upsertLocal({ driverId, weekStart, count }));
    },

    removeById(id) {
      const targetId = String(id || '').trim();
      const list = weeklyTargets.getAll().filter(item => item.id !== targetId);
      if (activeStorageAdapter.stage) {
        activeStorageAdapter.stage(KEYS.weeklyTargets, list);
        window.BremDataCache?.set?.(KEYS.weeklyTargets, list, { source: 'write' });
      }
      return list;
    },

    async removeByIdAsync(id) {
      const targetId = String(id || '').trim();
      if (!targetId) return weeklyTargets.getAll();

      if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.deleteWeeklyTargetsByIds) {
        await activeStorageAdapter.deleteWeeklyTargetsByIds([targetId]);
      } else {
        storageAdapter.write(KEYS.weeklyTargets, weeklyTargets.getAll());
        await storageAdapter.flush?.();
      }

      return weeklyTargets.getAll();
    },

    getCount(driverId, weekStart) {
      const target = weeklyTargets.getAll().find(item => item.driverId === driverId && item.weekStart === weekStart);
      return target ? Number(target.count || 0) : 0;
    }
  };

  const notices = {
    getAll() {
      return storageAdapter.read(KEYS.notices, []);
    },

    async persistNotice(notice) {
      if (!isStoragePersistReady()) {
        throw new Error('Supabase에 연결되지 않았습니다. 관리자 화면에서 다시 로그인하세요.');
      }

      const isAdminSession = activeSupabaseProfile?.role === 'admin' && activeSupabaseProfile?.active !== false;
      if (isProductionMode() && isAdminSession) {
        return persistNoticeViaServer(notice);
      }

      const list = notices.getAll();
      const index = list.findIndex(item => item.id === notice.id);
      if (index >= 0) list[index] = notice;
      else list.unshift(notice);
      storageAdapter.write(KEYS.notices, list);
      markNoticesCache(list);
      return notice;
    },

    create(data) {
      const notice = {
        id: createId(),
        title: String(data.title || '').trim(),
        content: String(data.content || '').trim(),
        pinned: Boolean(data.pinned),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      return notices.persistNotice(notice);
    },

    update(id, data) {
      const existing = notices.getAll().find(notice => notice.id === id);
      if (!existing) throw new Error('공지사항을 찾을 수 없습니다.');
      const notice = {
        ...existing,
        ...data,
        id,
        title: String(data.title != null ? data.title : existing.title).trim(),
        content: String(data.content != null ? data.content : existing.content).trim(),
        pinned: data.pinned != null ? Boolean(data.pinned) : Boolean(existing.pinned),
        updatedAt: new Date().toISOString()
      };
      return notices.persistNotice(notice);
    },

    removeById(id) {
      const noticeId = String(id || '').trim();
      if (!noticeId) throw new Error('공지 ID가 없습니다.');
      if (!notices.getAll().some(notice => notice.id === noticeId)) {
        throw new Error('공지사항을 찾을 수 없습니다.');
      }
      if (!isStoragePersistReady()) {
        throw new Error('Supabase에 연결되지 않았습니다. 관리자 화면에서 다시 로그인하세요.');
      }

      const isAdminSession = activeSupabaseProfile?.role === 'admin' && activeSupabaseProfile?.active !== false;
      if (isProductionMode() && isAdminSession) {
        return deleteNoticeViaServer(noticeId);
      }

      if (activeStorageAdapter.deleteTableRow) {
        void activeStorageAdapter.deleteTableRow('notices', noticeId);
      }
      const filtered = notices.getAll().filter(notice => notice.id !== noticeId);
      if (filtered.length) {
        storageAdapter.write(KEYS.notices, filtered);
      } else if (activeStorageAdapter.stage) {
        activeStorageAdapter.stage(KEYS.notices, []);
        window.BremDataCache?.set?.(KEYS.notices, []);
      }
      markNoticesCache(filtered);
      return { ok: true, id: noticeId };
    }
  };

  function buildDefaultMissions() {
    return [
      {
        id: 'brem_mission_count_140',
        title: '140건 1,500원 미션',
        description: '주간 140건 이상 달성 시 건당 1,500원 리워드가 지급되는 미션입니다.',
        type: 'count_reward',
        conditions: '주간 140건 이상 콜수 달성 · 쿠팡·배민 합산 기준',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'brem_mission_unit_guarantee_bike',
        title: '단가보장 + 오토바이 미션',
        description: '단가보장 프로그램과 오토바이 리스·렌탈 연계 혜택이 적용되는 미션입니다.',
        type: 'unit_guarantee_motorcycle',
        conditions: '단가보장 조건 충족 · 오토바이 리스/렌탈 이용 기사',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
  }

  const MAX_ADMIN_MISSIONS = 9999;
  const MAX_ADMIN_PROMOTION_RULES = 200;

  const missions = {
    maxCount: MAX_ADMIN_MISSIONS,

    getAll() {
      const raw = storageAdapter.readRaw(KEYS.missions);
      if (!raw.exists) return [];
      return Array.isArray(raw.value) ? raw.value : [];
    },

    getById(id) {
      return missions.getAll().find(item => item.id === id) || null;
    },

    getDefaultId() {
      return DEFAULT_MISSION_ID;
    },

    saveAll(list) {
      storageAdapter.write(KEYS.missions, list);
      return missions.getAll();
    },

    async persistMission(mission) {
      if (!isStoragePersistReady()) {
        throw new Error('Supabase에 연결되지 않았습니다. 관리자 화면에서 다시 로그인하세요.');
      }
      if (isProductionMode()) {
        return persistMissionViaServer(mission);
      }
      if (!activeStorageAdapter.upsertMission) {
        throw new Error('미션 저장 기능을 사용할 수 없습니다.');
      }
      const saved = await activeStorageAdapter.upsertMission(mission);
      markMissionsCache(missions.getAll());
      return saved;
    },

    canCreate() {
      return true;
    },

    create(data) {
      if (!missions.canCreate()) {
        throw new Error(`미션은 최대 ${MAX_ADMIN_MISSIONS}개까지 등록할 수 있습니다.`);
      }
      const next = {
        id: createId(),
        title: String(data.title || '').trim(),
        description: String(data.description || '').trim(),
        type: String(data.type || '').trim(),
        conditions: String(data.conditions || '').trim(),
        isActive: data.isActive !== false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      return missions.persistMission(next);
    },

    update(id, changes) {
      const list = missions.getAll();
      const index = list.findIndex(item => item.id === id);
      if (index === -1) throw new Error('미션을 찾을 수 없습니다.');
      const updated = {
        ...list[index],
        ...changes,
        id,
        title: String(changes.title != null ? changes.title : list[index].title).trim(),
        description: String(changes.description != null ? changes.description : list[index].description).trim(),
        type: String(changes.type != null ? changes.type : list[index].type).trim(),
        conditions: String(changes.conditions != null ? changes.conditions : list[index].conditions).trim(),
        isActive: changes.isActive != null ? Boolean(changes.isActive) : list[index].isActive !== false,
        updatedAt: new Date().toISOString()
      };
      return missions.persistMission(updated);
    },

    async remove(id) {
      const missionId = String(id || '').trim();
      if (!missionId) throw new Error('미션 ID가 없습니다.');
      if (!missions.getById(missionId)) throw new Error('미션을 찾을 수 없습니다.');
      if (!isStoragePersistReady()) {
        throw new Error('Supabase에 연결되지 않았습니다. 관리자 화면에서 다시 로그인하세요.');
      }

      if (isProductionMode()) {
        return deleteMissionViaServer(missionId);
      }

      if (activeStorageAdapter.deleteTableRow) {
        await activeStorageAdapter.deleteTableRow('missions', missionId);
      }

      markMissionsCache(missions.getAll().filter(item => item.id !== missionId));
      clearMissionFromDriverCache(missionId);
      return { ok: true, id: missionId };
    },

    async fetchById(id) {
      const missionId = String(id || '').trim();
      if (!missionId) return null;
      if (activeStorageAdapter.fetchMissionById) {
        return activeStorageAdapter.fetchMissionById(missionId);
      }
      return missions.getById(missionId);
    }
  };

  async function ensureMissionsLoaded(options = {}) {
    if (activeStorageAdapter.type !== 'supabase') {
      return { ok: true, cached: true };
    }
    return reloadMissions(Boolean(options.force));
  }

  const INQUIRY_TYPES = Object.freeze([
    '라이더 지원',
    '협력사문의',
    '리스/렌탈 상담',
    '기타 문의'
  ]);

  const riderInquiries = {
    INQUIRY_TYPES,

    persistList(list) {
      const next = Array.isArray(list) ? list : [];
      storageAdapter.write(KEYS.riderInquiries, next);
      return next;
    },

    getAll() {
      return storageAdapter.read(KEYS.riderInquiries, []);
    },

    create(data) {
      const list = riderInquiries.getAll();
      const next = {
        id: createId(),
        name: String(data.name || '').trim(),
        phone: String(data.phone || '').trim(),
        area: String(data.area || '').trim(),
        inquiryType: String(data.inquiryType || '라이더 지원').trim(),
        message: String(data.message || '').trim(),
        status: 'new',
        createdAt: new Date().toISOString()
      };
      list.unshift(next);
      riderInquiries.persistList(list);
      return next;
    },

    updateStatus(id, status) {
      const list = riderInquiries.getAll().map(item => (
        item.id === id ? { ...item, status: String(status || 'new'), updatedAt: new Date().toISOString() } : item
      ));
      riderInquiries.persistList(list);
      return list;
    },

    removeById(id) {
      riderInquiries.persistList(riderInquiries.getAll().filter(item => item.id !== id));
    },

    countNew() {
      return riderInquiries.getAll().filter(item => item.status === 'new').length;
    }
  };

  const adminSchedules = {
    getAll() {
      return storageAdapter.read(KEYS.adminSchedules, []);
    },

    getByDate(date) {
      return adminSchedules.getAll()
        .filter(item => item.date === date)
        .sort((a, b) => adminSchedules.sortValue(a).localeCompare(adminSchedules.sortValue(b)));
    },

    getByMonth(monthKey) {
      const prefix = String(monthKey || '').trim();
      if (!/^\d{4}-\d{2}$/.test(prefix)) return [];
      return adminSchedules.getAll()
        .filter(item => String(item.date || '').startsWith(`${prefix}-`))
        .sort((a, b) => adminSchedules.sortValue(a).localeCompare(adminSchedules.sortValue(b)));
    },

    sortValue(item) {
      return `${item.date || ''}T${item.createdAt || ''}`;
    },

    async persistList(list, options = {}) {
      const persist = storageAdapter.write(KEYS.adminSchedules, list, options);
      window.BremDataCache?.set?.(KEYS.adminSchedules, list, { source: 'write' });
      await awaitPersist(persist);
    },

    async create(data) {
      const list = adminSchedules.getAll();
      const next = {
        id: createId(),
        date: String(data.date || '').slice(0, 10),
        title: String(data.title || '').trim(),
        memo: String(data.memo || '').trim(),
        createdBy: String(data.createdBy || '').trim(),
        createdById: String(data.createdById || '').trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      list.push(next);
      await adminSchedules.persistList(list, { incrementalRows: [next] });
      return next;
    },

    async createMany(items) {
      const list = adminSchedules.getAll();
      const now = new Date().toISOString();
      const created = (Array.isArray(items) ? items : []).map(data => ({
        id: createId(),
        date: String(data.date || '').slice(0, 10),
        title: String(data.title || '').trim(),
        memo: String(data.memo || '').trim(),
        createdBy: String(data.createdBy || '').trim(),
        createdById: String(data.createdById || '').trim(),
        createdAt: now,
        updatedAt: now
      }));
      if (!created.length) return [];
      list.push(...created);
      await adminSchedules.persistList(list, { incrementalRows: created });
      return created;
    },

    async update(id, data) {
      let updatedRow = null;
      const list = adminSchedules.getAll().map(item => {
        if (item.id !== id) return item;
        updatedRow = {
          ...item,
          title: data.title != null ? String(data.title).trim() : item.title,
          memo: data.memo != null ? String(data.memo).trim() : item.memo,
          createdBy: data.createdBy != null ? String(data.createdBy).trim() : item.createdBy,
          updatedAt: new Date().toISOString()
        };
        return updatedRow;
      });
      await adminSchedules.persistList(list, updatedRow ? { incrementalRows: [updatedRow] } : {});
      return updatedRow;
    },

    async removeById(id) {
      await adminSchedules.removeByIds([id]);
    },

    async removeByIds(ids) {
      const idSet = new Set((Array.isArray(ids) ? ids : []).map(value => String(value || '').trim()).filter(Boolean));
      if (!idSet.size) return;
      const list = adminSchedules.getAll().filter(item => !idSet.has(item.id));
      await adminSchedules.persistList(list);
    }
  };

  function normalizePayrollPayMonth(value) {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}$/.test(raw)) return raw;
    return raw.slice(0, 10) || raw.slice(0, 7);
  }

  const payrollSlipUploads = {
    getAll() {
      if (isPayrollLocalStorageMode()) {
        return readPayrollLocalCollection(KEYS.payrollSlipUploads, []);
      }
      return storageAdapter.read(KEYS.payrollSlipUploads, []);
    },

    getByMonth(payMonth) {
      const month = String(payMonth || '').trim();
      return payrollSlipUploads.getAll()
        .filter(item => item.payMonth === month)
        .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
    },

    async persistList(list, options = {}) {
      if (isPayrollLocalStorageMode()) {
        await writePayrollLocalCollection(KEYS.payrollSlipUploads, list);
        return;
      }
      const persist = storageAdapter.write(KEYS.payrollSlipUploads, list, options);
      window.BremDataCache?.set?.(KEYS.payrollSlipUploads, list, { source: 'write' });
      await awaitPersist(persist);
    },

    async create(data) {
      const list = payrollSlipUploads.getAll();
      const next = {
        id: createId(),
        payMonth: normalizePayrollPayMonth(data.payMonth),
        fileName: String(data.fileName || '').trim(),
        uploadedBy: String(data.uploadedBy || '').trim(),
        uploadedById: String(data.uploadedById || '').trim(),
        status: String(data.status || 'applied').trim(),
        contentHash: String(data.contentHash || '').trim(),
        rowCount: Number(data.rowCount || 0),
        totalGross: Number(data.totalGross || 0),
        totalDeduction: Number(data.totalDeduction || 0),
        totalNet: Number(data.totalNet || 0),
        rawSummary: data.rawSummary && typeof data.rawSummary === 'object' ? data.rawSummary : {},
        uploadedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      list.unshift(next);
      await payrollSlipUploads.persistList(list, { incrementalRows: [next] });
      return next;
    },

    async removeById(id) {
      await payrollSlipUploads.removeByIds([id]);
    },

    async removeByIds(ids) {
      const idSet = new Set((Array.isArray(ids) ? ids : []).map(value => String(value || '').trim()).filter(Boolean));
      if (!idSet.size) return;
      const current = payrollSlipUploads.getAll();
      const removedIds = current.filter(item => idSet.has(item.id)).map(item => item.id);
      const list = current.filter(item => !idSet.has(item.id));
      await payrollSlipUploads.persistList(list, { deletedRowIds: removedIds });
    },

    async updateSettlementWeek(uploadId, settlementWeekStart, meta = {}) {
      const id = String(uploadId || '').trim();
      const weekStart = String(settlementWeekStart || '').trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
        throw new Error('정산주(수요일 시작)가 올바르지 않습니다.');
      }
      const weekEnd = String(meta.settlementWeekEnd || '').trim().slice(0, 10);
      const weekLabel = String(meta.settlementWeekLabel || '').trim();
      const payMonth = normalizePayrollPayMonth(weekStart);
      const now = new Date().toISOString();

      const uploadsList = payrollSlipUploads.getAll();
      const uploadIndex = uploadsList.findIndex(item => item.id === id);
      if (uploadIndex < 0) throw new Error('업로드 기록을 찾을 수 없습니다.');

      const upload = uploadsList[uploadIndex];
      const previousWeekStart = String(upload?.rawSummary?.settlementWeekStart || upload?.payMonth || '').slice(0, 10);
      const updatedUpload = {
        ...upload,
        payMonth,
        rawSummary: {
          ...(upload.rawSummary && typeof upload.rawSummary === 'object' ? upload.rawSummary : {}),
          settlementWeekStart: weekStart,
          settlementWeekEnd: weekEnd,
          settlementWeekLabel: weekLabel
        },
        updatedAt: now
      };
      uploadsList[uploadIndex] = updatedUpload;

      const linesList = payrollSlipLines.getAll();
      const updatedLines = [];
      const nextLines = linesList.map(line => {
        if (line.uploadId !== id) return line;
        const rawData = line.rawData && typeof line.rawData === 'object' ? { ...line.rawData } : {};
        const next = {
          ...line,
          payMonth,
          riderPublishedAt: null,
          rawData: {
            ...rawData,
            settlementWeekStart: weekStart,
            settlementWeekEnd: weekEnd,
            settlementWeekLabel: weekLabel
          },
          updatedAt: now
        };
        updatedLines.push(next);
        return next;
      });

      await payrollSlipLines.persistList(nextLines, { incrementalRows: updatedLines });
      await payrollSlipUploads.persistList(uploadsList, { incrementalRows: [updatedUpload] });
      return {
        upload: updatedUpload,
        linesUpdated: updatedLines.length,
        previousWeekStart,
        settlementWeekStart: weekStart
      };
    }
  };

  const payrollSlipLines = {
    getAll() {
      if (isPayrollLocalStorageMode()) {
        return readPayrollLocalCollection(KEYS.payrollSlipLines, []);
      }
      return storageAdapter.read(KEYS.payrollSlipLines, []);
    },

    getByUploadId(uploadId) {
      const id = String(uploadId || '').trim();
      return payrollSlipLines.getAll()
        .filter(item => item.uploadId === id)
        .sort((a, b) => String(a.riderName || '').localeCompare(String(b.riderName || ''), 'ko'));
    },

    getByMonth(payMonth) {
      const month = String(payMonth || '').trim();
      return payrollSlipLines.getAll()
        .filter(item => item.payMonth === month)
        .sort((a, b) => String(a.riderName || '').localeCompare(String(b.riderName || ''), 'ko'));
    },

    search(filters = {}) {
      const month = String(filters.payMonth || '').trim();
      const keyword = String(filters.keyword || '').trim().toLowerCase();
      return payrollSlipLines.getAll()
        .filter(item => {
          if (month && item.payMonth !== month) return false;
          if (!keyword) return true;
          const haystack = [
            item.riderName,
            item.employeeNo,
            item.department,
            item.memo
          ].join(' ').toLowerCase();
          return haystack.includes(keyword);
        })
        .sort((a, b) => {
          const monthCompare = String(b.payMonth || '').localeCompare(String(a.payMonth || ''));
          if (monthCompare) return monthCompare;
          return String(a.riderName || '').localeCompare(String(b.riderName || ''), 'ko');
        });
    },

    async persistList(list, options = {}) {
      if (isPayrollLocalStorageMode()) {
        await writePayrollLocalCollection(KEYS.payrollSlipLines, list);
        return;
      }
      const persist = storageAdapter.write(KEYS.payrollSlipLines, list, options);
      window.BremDataCache?.set?.(KEYS.payrollSlipLines, list, { source: 'write' });
      await awaitPersist(persist);
    },

    async createMany(items) {
      const list = payrollSlipLines.getAll();
      const now = new Date().toISOString();
      const created = (Array.isArray(items) ? items : []).map(data => ({
        id: createId(),
        uploadId: String(data.uploadId || '').trim(),
        payMonth: normalizePayrollPayMonth(data.payMonth),
        driverId: String(data.driverId || '').trim(),
        riderName: String(data.riderName || '').trim(),
        employeeNo: String(data.employeeNo || '').trim(),
        department: String(data.department || '').trim(),
        basePay: Number(data.basePay || 0),
        allowance: Number(data.allowance || 0),
        grossPay: Number(data.grossPay || 0),
        incomeTax: Number(data.incomeTax || 0),
        localTax: Number(data.localTax || 0),
        insurance: Number(data.insurance || 0),
        otherDeduction: Number(data.otherDeduction || 0),
        totalDeduction: Number(data.totalDeduction || 0),
        netPay: Number(data.netPay || 0),
        memo: String(data.memo || '').trim(),
        rawData: data.rawData && typeof data.rawData === 'object' ? data.rawData : {},
        createdAt: now,
        updatedAt: now
      }));
      if (!created.length) return [];
      list.push(...created);
      await payrollSlipLines.persistList(list, { incrementalRows: created });
      return created;
    },

    async removeByUploadId(uploadId) {
      const id = String(uploadId || '').trim();
      if (!id) return;
      const current = payrollSlipLines.getAll();
      const removedIds = current.filter(item => item.uploadId === id).map(item => item.id);
      const list = current.filter(item => item.uploadId !== id);
      await payrollSlipLines.persistList(list, { deletedRowIds: removedIds });
    },

    async removeByIds(ids) {
      const idSet = new Set((Array.isArray(ids) ? ids : []).map(value => String(value || '').trim()).filter(Boolean));
      if (!idSet.size) return;
      const current = payrollSlipLines.getAll();
      const removedIds = current.filter(item => idSet.has(item.id)).map(item => item.id);
      const list = current.filter(item => !idSet.has(item.id));
      await payrollSlipLines.persistList(list, { deletedRowIds: removedIds });
    }
  };

  function payrollLineWeekStart(line) {
    const raw = line?.rawData && typeof line.rawData === 'object' ? line.rawData : {};
    return String(raw.settlementWeekStart || raw.settlementWeekPayKey || line?.settlementWeekStart || '').slice(0, 10);
  }

  function payrollNoticeAppliesToWeek(notice, weekStart) {
    const scoped = String(notice?.settlementWeekStart || '').slice(0, 10);
    return !scoped || scoped === weekStart;
  }

  const payrollNotices = {
    getAll() {
      if (isPayrollLocalStorageMode()) {
        return readPayrollLocalCollection(KEYS.payrollNotices, []);
      }
      return storageAdapter.read(KEYS.payrollNotices, []);
    },

    async persistList(list, options = {}) {
      if (isPayrollLocalStorageMode()) {
        await writePayrollLocalCollection(KEYS.payrollNotices, list);
        return;
      }
      const persist = storageAdapter.write(KEYS.payrollNotices, list, options);
      window.BremDataCache?.set?.(KEYS.payrollNotices, list, { source: 'write' });
      await awaitPersist(persist);
    },

    async persistNotice(notice) {
      const list = payrollNotices.getAll();
      const index = list.findIndex(item => item.id === notice.id);
      if (index >= 0) list[index] = notice;
      else list.unshift(notice);
      await payrollNotices.persistList(list, { incrementalRows: [notice] });
      return notice;
    },

    create(data) {
      const now = new Date().toISOString();
      const notice = {
        id: createId(),
        title: String(data.title || '').trim(),
        body: String(data.body || '').trim(),
        label: String(data.label || 'notice').trim() || 'notice',
        settlementWeekStart: String(data.settlementWeekStart || '').slice(0, 10),
        sortOrder: Number(data.sortOrder || 0),
        riderPublishedAt: null,
        createdAt: now,
        updatedAt: now
      };
      return payrollNotices.persistNotice(notice);
    },

    async update(id, data) {
      const existing = payrollNotices.getAll().find(item => item.id === id);
      if (!existing) throw new Error('급여 공지를 찾을 수 없습니다.');
      const notice = {
        ...existing,
        ...data,
        id,
        title: String(data.title != null ? data.title : existing.title).trim(),
        body: String(data.body != null ? data.body : existing.body).trim(),
        label: String(data.label != null ? data.label : existing.label).trim() || 'notice',
        settlementWeekStart: String(
          data.settlementWeekStart != null ? data.settlementWeekStart : existing.settlementWeekStart
        ).slice(0, 10),
        sortOrder: Number(data.sortOrder != null ? data.sortOrder : existing.sortOrder || 0),
        riderPublishedAt: null,
        updatedAt: new Date().toISOString()
      };
      return payrollNotices.persistNotice(notice);
    },

    async removeById(id) {
      const noticeId = String(id || '').trim();
      if (!noticeId) return;
      const list = payrollNotices.getAll().filter(item => item.id !== noticeId);
      await payrollNotices.persistList(list);
    }
  };

  let payrollDailySettlementLegacyMigrated = false;

  function normalizePayrollDailySettlementItem(item) {
    if (!item || typeof item !== 'object') return null;
    const driverId = String(item.driverId || '').trim();
    if (!driverId) return null;
    const id = String(item.id || '').trim() || `pds_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const baeminId = String(item.baeminId || '').trim();
    const coupangId = String(item.coupangId || '').trim().replace(/\s/g, '');
    const platforms = normalizePayrollDailyPlatform({
      baeminId,
      coupangId,
      platformBaemin: item.platformBaemin,
      platformCoupang: item.platformCoupang
    });
    return {
      id,
      driverId,
      driverName: String(item.driverName || '').trim(),
      baeminId,
      coupangId,
      phone: String(item.phone || '').trim(),
      region: String(item.region || '').trim(),
      platformBaemin: platforms.platformBaemin,
      platformCoupang: platforms.platformCoupang,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || new Date().toISOString()
    };
  }

  function normalizePayrollDailyPlatform(item = {}) {
    const baeminId = String(item.baeminId || '').trim();
    const coupangId = String(item.coupangId || '').trim();
    let platformBaemin = item.platformBaemin;
    let platformCoupang = item.platformCoupang;

    if (platformBaemin === undefined && platformCoupang === undefined) {
      if (baeminId && !coupangId) {
        platformBaemin = true;
        platformCoupang = false;
      } else if (coupangId && !baeminId) {
        platformBaemin = false;
        platformCoupang = true;
      } else {
        platformBaemin = true;
        platformCoupang = true;
      }
    } else {
      platformBaemin = platformBaemin !== false;
      platformCoupang = platformCoupang !== false;
    }

    if (!platformBaemin && !platformCoupang) {
      if (baeminId) platformBaemin = true;
      else if (coupangId) platformCoupang = true;
      else {
        platformBaemin = true;
        platformCoupang = true;
      }
    }

    return { platformBaemin, platformCoupang };
  }

  function migrateLegacyPayrollDailySettlementRoster() {
    if (payrollDailySettlementLegacyMigrated) return;
    payrollDailySettlementLegacyMigrated = true;

    const key = KEYS.payrollDailySettlementRoster;
    const cached = storageAdapter.read(key, null);
    if (Array.isArray(cached) && cached.length) return;

    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.length) return;
      const normalized = parsed.map(normalizePayrollDailySettlementItem).filter(Boolean);
      if (!normalized.length) return;
      storageAdapter.write(key, normalized);
      window.BremDataCache?.set?.(key, normalized, { source: 'migrate' });
      if (activeStorageAdapter.type === 'supabase' && typeof flushActiveStorage === 'function') {
        flushActiveStorage().catch(error => {
          console.warn('[BREM] payroll daily settlement roster migration persist failed:', error);
        });
      }
    } catch (error) {
      console.warn('[BREM] payroll daily settlement roster migration skipped:', error);
    }
  }

  const payrollDailySettlement = {
    getAll() {
      migrateLegacyPayrollDailySettlementRoster();
      const raw = storageAdapter.read(KEYS.payrollDailySettlementRoster, []);
      if (!Array.isArray(raw)) return [];
      return raw.map(normalizePayrollDailySettlementItem).filter(Boolean);
    },

    saveAll(list) {
      const normalized = payrollDailySettlement.normalizeList(list);
      storageAdapter.write(KEYS.payrollDailySettlementRoster, normalized);
      window.BremDataCache?.set?.(KEYS.payrollDailySettlementRoster, normalized, { source: 'write' });
      if (activeStorageAdapter.type === 'supabase' && typeof flushActiveStorage === 'function') {
        flushActiveStorage().catch(error => {
          console.warn('[BREM] payroll daily settlement roster persist failed:', error);
        });
      }
      return normalized;
    },

    normalizeList(list) {
      return (Array.isArray(list) ? list : [])
        .map(normalizePayrollDailySettlementItem)
        .filter(Boolean);
    },

    async reloadFromServer() {
      migrateLegacyPayrollDailySettlementRoster();
      if (activeStorageAdapter.type !== 'supabase' || !activeStorageAdapter.reloadSettingKey) {
        return payrollDailySettlement.getAll();
      }
      try {
        const [rosterValue, regionsValue, feesValue, excludedValue, finalizedValue, pauseValue] = await Promise.all([
          activeStorageAdapter.reloadSettingKey(KEYS.payrollDailySettlementRoster),
          activeStorageAdapter.reloadSettingKey(KEYS.payrollDailySettlementRegions),
          activeStorageAdapter.reloadSettingKey(KEYS.payrollDailySettlementFees),
          activeStorageAdapter.reloadSettingKey(KEYS.payrollDailyExcludedSettlements),
          activeStorageAdapter.reloadSettingKey(KEYS.payrollWeekFinalized),
          activeStorageAdapter.reloadSettingKey(KEYS.payrollWithdrawalPaused)
        ]);
        const normalized = payrollDailySettlement.normalizeList(rosterValue || []);
        const regions = payrollDailySettlement.normalizeRegions(regionsValue || []);
        const fees = payrollDailySettlement.normalizeFees(feesValue || {});
        const excluded = Array.isArray(excludedValue)
          ? [...new Set(excludedValue.map(item => String(item || '').trim()).filter(Boolean))]
          : [];
        const finalized = payrollDailySettlement.normalizeFinalizedWeeks(finalizedValue || []);
        const pauseState = payrollDailySettlement.normalizeWithdrawalPause(pauseValue || {});
        window.BremDataCache?.set?.(KEYS.payrollDailySettlementRoster, normalized, { source: 'server' });
        window.BremDataCache?.set?.(KEYS.payrollDailySettlementRegions, regions, { source: 'server' });
        window.BremDataCache?.set?.(KEYS.payrollDailySettlementFees, fees, { source: 'server' });
        window.BremDataCache?.set?.(KEYS.payrollDailyExcludedSettlements, excluded, { source: 'server' });
        window.BremDataCache?.set?.(KEYS.payrollWeekFinalized, finalized, { source: 'server' });
        window.BremDataCache?.set?.(KEYS.payrollWithdrawalPaused, pauseState, { source: 'server' });
        return normalized;
      } catch (error) {
        console.warn('[BREM] payroll daily settlement reload failed:', error);
        return payrollDailySettlement.getAll();
      }
    },

    normalizeRegions(list) {
      if (!Array.isArray(list)) return [];
      const seen = new Set();
      return list
        .map(item => String(item || '').trim())
        .filter(text => {
          if (!text || seen.has(text)) return false;
          seen.add(text);
          return true;
        })
        .sort((a, b) => a.localeCompare(b, 'ko'));
    },

    getRegions() {
      const raw = storageAdapter.read(KEYS.payrollDailySettlementRegions, []);
      return payrollDailySettlement.normalizeRegions(raw);
    },

    normalizeFees(raw = {}) {
      const makeSide = side => {
        const mode = String(side?.dailySettlementFeeMode || 'fixed').toLowerCase() === 'percent'
          ? 'percent'
          : 'fixed';
        const feeRaw = Number(side?.dailySettlementFee || 0);
        const dailySettlementFee = mode === 'percent'
          ? Math.max(0, Math.round(feeRaw * 1000) / 1000)
          : Math.max(0, Math.round(feeRaw));
        return {
          callFee: Math.max(0, Math.round(Number(side?.callFee || 0))),
          dailySettlementFeeMode: mode,
          dailySettlementFee
        };
      };
      return {
        showCallFee: raw.showCallFee !== false,
        coupang: makeSide(raw.coupang || raw),
        baemin: makeSide(raw.baemin || raw)
      };
    },

    isCallFeeVisible() {
      return payrollDailySettlement.getAllFees().showCallFee !== false;
    },

    settlementRowId(driverId, period, platform = 'coupang') {
      const p = normalizePlatform(platform);
      const periodKey = String(period || '').slice(0, 10);
      const id = String(driverId || '').trim();
      if (!id || !periodKey) return '';
      return `${id}-${periodKey}-${p}`;
    },

    getExcludedSettlementIds() {
      const raw = storageAdapter.read(KEYS.payrollDailyExcludedSettlements, []);
      if (!Array.isArray(raw)) return [];
      return [...new Set(raw.map(item => String(item || '').trim()).filter(Boolean))];
    },

    getExcludedSettlementIdSet() {
      return new Set(payrollDailySettlement.getExcludedSettlementIds());
    },

    persistExcludedSettlementIds(list) {
      const normalized = [...new Set((Array.isArray(list) ? list : [])
        .map(item => String(item || '').trim())
        .filter(Boolean))];
      storageAdapter.write(KEYS.payrollDailyExcludedSettlements, normalized);
      window.BremDataCache?.set?.(KEYS.payrollDailyExcludedSettlements, normalized, { source: 'write' });
      return normalized;
    },

    async reloadExcludedSettlementIdsFromServer() {
      if (activeStorageAdapter.type !== 'supabase' || !activeStorageAdapter.reloadSettingKey) {
        return payrollDailySettlement.getExcludedSettlementIds();
      }
      try {
        const value = await activeStorageAdapter.reloadSettingKey(KEYS.payrollDailyExcludedSettlements);
        const normalized = Array.isArray(value)
          ? [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))]
          : [];
        window.BremDataCache?.set?.(KEYS.payrollDailyExcludedSettlements, normalized, { source: 'server' });
        return normalized;
      } catch (error) {
        console.warn('[BREM] payroll daily excluded settlements reload failed:', error);
        return payrollDailySettlement.getExcludedSettlementIds();
      }
    },

    /**
     * 일정산 가능 체크 → 매칭 기사를 급여 일정산 대상에 포함/제외.
     * eligible=true: 제외 목록에서 제거 / false: 제외 목록에 추가.
     */
    setPayrollDailyEligibleForRecords({ period, platform = 'coupang', records = [], eligible = true } = {}) {
      const p = normalizePlatform(platform);
      const periodKey = String(period || '').slice(0, 10);
      const ids = (Array.isArray(records) ? records : [])
        .map(row => payrollDailySettlement.settlementRowId(row.driverId, periodKey, p))
        .filter(Boolean);
      if (!periodKey || !ids.length) {
        return payrollDailySettlement.getExcludedSettlementIds();
      }
      const next = new Set(payrollDailySettlement.getExcludedSettlementIds());
      ids.forEach(id => {
        if (eligible) next.delete(id);
        else next.add(id);
      });
      return payrollDailySettlement.persistExcludedSettlementIds([...next]);
    },

    isSettlementPayrollDailyEligible(settlementOrId, period = '', platform = 'coupang') {
      const id = typeof settlementOrId === 'string'
        ? settlementOrId
        : (settlementOrId?.id || payrollDailySettlement.settlementRowId(
          settlementOrId?.driverId,
          period || settlementOrId?.period,
          platform || settlementOrId?.platform
        ));
      if (!id) return false;
      return !payrollDailySettlement.getExcludedSettlementIdSet().has(id);
    },

    resolveDailySettlementFee(settlementAmount, fees = {}) {
      const amount = Math.max(0, Math.round(Number(settlementAmount) || 0));
      const mode = String(fees.dailySettlementFeeMode || 'fixed').toLowerCase() === 'percent'
        ? 'percent'
        : 'fixed';
      const value = Math.max(0, Number(fees.dailySettlementFee || 0));
      if (mode === 'percent') {
        return Math.floor(amount * (value / 100));
      }
      return Math.max(0, Math.round(value));
    },

    getFees(platform = 'coupang') {
      const raw = storageAdapter.read(KEYS.payrollDailySettlementFees, {});
      const all = payrollDailySettlement.normalizeFees(raw && typeof raw === 'object' ? raw : {});
      const p = normalizePlatform(platform);
      return all[p] || all.coupang;
    },

    getAllFees() {
      const raw = storageAdapter.read(KEYS.payrollDailySettlementFees, {});
      return payrollDailySettlement.normalizeFees(raw && typeof raw === 'object' ? raw : {});
    },

    saveFees(nextFees) {
      const normalized = payrollDailySettlement.normalizeFees(nextFees);
      storageAdapter.write(KEYS.payrollDailySettlementFees, normalized);
      window.BremDataCache?.set?.(KEYS.payrollDailySettlementFees, normalized, { source: 'write' });
      if (activeStorageAdapter.type === 'supabase' && typeof flushActiveStorage === 'function') {
        flushActiveStorage().catch(error => {
          console.warn('[BREM] payroll daily settlement fees persist failed:', error);
        });
      }
      return normalized;
    },

    async persistFees(nextFees) {
      const normalized = payrollDailySettlement.saveFees(nextFees);
      if (typeof flushActiveStorage === 'function') {
        await flushActiveStorage();
      }
      return normalized;
    },

    /** 주정산 마무리(수~화) 목록 정규화 */
    normalizeFinalizedWeeks(list) {
      if (!Array.isArray(list)) return [];
      const byWeek = new Map();
      list.forEach(item => {
        const weekStart = typeof item === 'string'
          ? String(item || '').slice(0, 10)
          : String(item?.weekStart || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return;
        const prev = byWeek.get(weekStart);
        const next = {
          weekStart,
          weekEnd: String(item?.weekEnd || prev?.weekEnd || '').slice(0, 10),
          finalizedAt: String(item?.finalizedAt || prev?.finalizedAt || '').trim(),
          note: String(item?.note || prev?.note || '').trim()
        };
        byWeek.set(weekStart, next);
      });
      return Array.from(byWeek.values()).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    },

    getFinalizedWeeks() {
      const raw = storageAdapter.read(KEYS.payrollWeekFinalized, []);
      return payrollDailySettlement.normalizeFinalizedWeeks(raw);
    },

    getFinalizedWeekStarts() {
      return payrollDailySettlement.getFinalizedWeeks().map(item => item.weekStart);
    },

    isWeekFinalized(weekStart) {
      const key = String(weekStart || '').slice(0, 10);
      if (!key) return false;
      return payrollDailySettlement.getFinalizedWeekStarts().includes(key);
    },

    getFinalizedWeekEntry(weekStart) {
      const key = String(weekStart || '').slice(0, 10);
      if (!key) return null;
      return payrollDailySettlement.getFinalizedWeeks().find(item => item.weekStart === key) || null;
    },

    persistFinalizedWeeks(list) {
      const normalized = payrollDailySettlement.normalizeFinalizedWeeks(list);
      storageAdapter.write(KEYS.payrollWeekFinalized, normalized);
      window.BremDataCache?.set?.(KEYS.payrollWeekFinalized, normalized, { source: 'write' });
      return normalized;
    },

    async reloadFinalizedWeeksFromServer() {
      if (activeStorageAdapter.type !== 'supabase' || !activeStorageAdapter.reloadSettingKey) {
        return payrollDailySettlement.getFinalizedWeeks();
      }
      try {
        const value = await activeStorageAdapter.reloadSettingKey(KEYS.payrollWeekFinalized);
        const normalized = payrollDailySettlement.normalizeFinalizedWeeks(value || []);
        window.BremDataCache?.set?.(KEYS.payrollWeekFinalized, normalized, { source: 'server' });
        return normalized;
      } catch (error) {
        console.warn('[BREM] payroll week finalized reload failed:', error);
        return payrollDailySettlement.getFinalizedWeeks();
      }
    },

    /**
     * 정산주(수~화) 마무리 처리.
     * 마무리된 주는 기사앱 출금가능금액이 0이 되고 신규출금이 차단된다.
     */
    async finalizeWeek({ weekStart, weekEnd = '', note = '' } = {}) {
      const start = String(weekStart || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        throw new Error('정산주(수요일)를 선택하세요.');
      }
      await payrollDailySettlement.reloadFinalizedWeeksFromServer();
      const list = payrollDailySettlement.getFinalizedWeeks();
      if (list.some(item => item.weekStart === start)) {
        return { ok: true, already: true, entry: list.find(item => item.weekStart === start), list };
      }
      const entry = {
        weekStart: start,
        weekEnd: String(weekEnd || '').slice(0, 10),
        finalizedAt: new Date().toISOString(),
        note: String(note || '').trim()
      };
      const next = payrollDailySettlement.persistFinalizedWeeks([entry, ...list]);
      if (typeof flushActiveStorage === 'function') {
        await flushActiveStorage();
      }
      return { ok: true, already: false, entry, list: next };
    },

    /** 정산주 마무리 취소(출금가능금액 복구) */
    async unfinalizeWeek(weekStart) {
      const start = String(weekStart || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        throw new Error('정산주(수요일)를 선택하세요.');
      }
      await payrollDailySettlement.reloadFinalizedWeeksFromServer();
      const list = payrollDailySettlement.getFinalizedWeeks();
      if (!list.some(item => item.weekStart === start)) {
        return { ok: true, already: true, list };
      }
      const next = payrollDailySettlement.persistFinalizedWeeks(
        list.filter(item => item.weekStart !== start)
      );
      if (typeof flushActiveStorage === 'function') {
        await flushActiveStorage();
      }
      return { ok: true, already: false, list: next };
    },

    /** 출금신청 일시정지 상태 (정산 처리 중 신규신청 차단) */
    normalizeWithdrawalPause(raw) {
      if (raw === true) return { paused: true, updatedAt: '', note: '' };
      if (!raw || typeof raw !== 'object') return { paused: false, updatedAt: '', note: '' };
      return {
        paused: raw.paused === true,
        updatedAt: String(raw.updatedAt || '').trim(),
        note: String(raw.note || '').trim()
      };
    },

    getWithdrawalPause() {
      const raw = storageAdapter.read(KEYS.payrollWithdrawalPaused, {});
      return payrollDailySettlement.normalizeWithdrawalPause(raw);
    },

    isWithdrawalPaused() {
      return payrollDailySettlement.getWithdrawalPause().paused === true;
    },

    persistWithdrawalPause(nextState) {
      const normalized = payrollDailySettlement.normalizeWithdrawalPause(nextState);
      storageAdapter.write(KEYS.payrollWithdrawalPaused, normalized);
      window.BremDataCache?.set?.(KEYS.payrollWithdrawalPaused, normalized, { source: 'write' });
      return normalized;
    },

    async reloadWithdrawalPauseFromServer() {
      if (activeStorageAdapter.type !== 'supabase' || !activeStorageAdapter.reloadSettingKey) {
        return payrollDailySettlement.getWithdrawalPause();
      }
      try {
        const value = await activeStorageAdapter.reloadSettingKey(KEYS.payrollWithdrawalPaused);
        const normalized = payrollDailySettlement.normalizeWithdrawalPause(value || {});
        window.BremDataCache?.set?.(KEYS.payrollWithdrawalPaused, normalized, { source: 'server' });
        return normalized;
      } catch (error) {
        console.warn('[BREM] payroll withdrawal pause reload failed:', error);
        return payrollDailySettlement.getWithdrawalPause();
      }
    },

    /**
     * 출금신청 일시정지 on/off.
     * paused=true: 기사앱 신규 출금신청 차단 (이미 신청된 건은 유지, 관리자 처리완료 가능)
     */
    async setWithdrawalPaused(paused, note = '') {
      await payrollDailySettlement.reloadWithdrawalPauseFromServer();
      const next = payrollDailySettlement.persistWithdrawalPause({
        paused: paused === true,
        updatedAt: new Date().toISOString(),
        note: String(note || '').trim() || (paused ? 'admin-pause' : 'admin-resume')
      });
      if (typeof flushActiveStorage === 'function') {
        await flushActiveStorage();
      }
      return { ok: true, ...next };
    },

    /** 등록 기사 + 일정산 업로드 금액으로 급여 일정산 행 계산 */
    buildPayoutRows({ platform = 'coupang', period = '' } = {}) {
      const p = normalizePlatform(platform);
      const periodKey = String(period || '').slice(0, 10);
      const fees = payrollDailySettlement.getFees(p);
      const EMP_RATE = 0.008;
      const INDUSTRIAL_RATE = 0.0088;
      const WITHHOLDING_RATE = 0.033;

      const roster = payrollDailySettlement.getAll().filter(item => (
        p === 'baemin' ? item.platformBaemin !== false : item.platformCoupang !== false
      ));
      const settlementMap = new Map();
      if (periodKey) {
        const excluded = payrollDailySettlement.getExcludedSettlementIdSet();
        settlements.getAll().forEach(row => {
          if (normalizePlatform(row.platform) !== p) return;
          if (String(row.period || '').slice(0, 10) !== periodKey) return;
          const id = String(row.id || `${row.driverId}-${periodKey}-${p}`);
          if (excluded.has(id)) return;
          settlementMap.set(String(row.driverId || ''), row);
        });
      }

      const driverMap = new Map(drivers.getAll().map(driver => [String(driver.id || ''), driver]));

      return roster.map(item => {
        const settlement = settlementMap.get(String(item.driverId || '')) || null;
        const settlementAmount = Math.max(
          0,
          Math.round(Number(settlement?.settlementAmount ?? settlement?.deliveryAmount ?? 0))
        );
        const hourlyInsurance = Math.abs(Math.round(Number(settlement?.hourlyInsurance || 0)));
        const orderCount = Math.max(0, Math.round(Number(settlement?.orderCount ?? settlement?.callCount ?? 0)));
        // 고용·산재·원천세 기준은 쿠팡 정산서 AC열(deductionBase).
        // 정산금액(AL)은 콜수수료가 이미 빠진 값이라 공제 기준으로 쓰면 금액이 맞지 않는다.
        // AC가 없는 기존 행은 지금까지처럼 정산금액 기준을 유지한다. 기준을 통째로 바꾸면
        // 이미 출금이 끝난 주가 소급 재계산되어 초과출금이 된다.
        // (server/rider-withdrawal.js calcPayoutFromSettlement 과 반드시 같은 식을 쓴다)
        const deductionBase = Math.max(0, Math.round(Number(settlement?.deductionBase || 0))) || settlementAmount;
        const employmentInsurance = Math.floor(deductionBase * EMP_RATE);
        const industrialAccidentInsurance = Math.floor(deductionBase * INDUSTRIAL_RATE);
        const withholdingTax = Math.floor(deductionBase * WITHHOLDING_RATE);
        const callFeeUnit = Math.max(0, Math.round(Number(fees.callFee || 0)));
        const callFee = orderCount * callFeeUnit;
        // 일정산수수료(2%)는 출금 시에만 부과되는 회사 수익이므로 실지급액에서 빼지 않는다.
        // (실지급액에서 빼면 출금 때 또 빠져 2% 이중 차감됨) — 아래 값은 미리보기 표시용.
        const dailySettlementFee = payrollDailySettlement.resolveDailySettlementFee(settlementAmount, fees);
        const netPay = settlementAmount
          - employmentInsurance
          - industrialAccidentInsurance
          - withholdingTax
          - callFee
          - hourlyInsurance;
        const driver = driverMap.get(String(item.driverId || '')) || null;
        return {
          rosterId: item.id,
          driverId: item.driverId,
          driverName: item.driverName || driver?.name || '',
          baeminId: item.baeminId || driver?.baeminId || '',
          coupangId: item.coupangId
            || (typeof BremDriverUtils !== 'undefined' ? BremDriverUtils.getErpCoupangId?.(driver) : '')
            || driver?.coupangId
            || '',
          accountNumber: String(driver?.accountNumber || '').trim(),
          bankName: String(driver?.bankName || '').trim(),
          accountHolder: String(driver?.accountHolder || '').trim(),
          period: periodKey,
          platform: p,
          settlementAmount,
          deductionBase,
          orderCount,
          callFeeUnit,
          hourlyInsurance,
          employmentInsurance,
          industrialAccidentInsurance,
          withholdingTax,
          callFee,
          dailySettlementFee,
          netPay,
          hasSettlement: Boolean(settlement)
        };
      }).sort((a, b) => String(a.driverName || '').localeCompare(String(b.driverName || ''), 'ko'));
    },

    getRegionOptions() {
      const catalog = payrollDailySettlement.getRegions();
      const catalogSet = new Set(catalog);
      const extras = new Set();
      payrollDailySettlement.getAll().forEach(item => {
        const region = String(item.region || '').trim();
        if (region && !catalogSet.has(region)) extras.add(region);
      });
      return [...catalog, ...[...extras].sort((a, b) => a.localeCompare(b, 'ko'))];
    },

    saveRegions(list) {
      const normalized = payrollDailySettlement.normalizeRegions(list);
      storageAdapter.write(KEYS.payrollDailySettlementRegions, normalized);
      window.BremDataCache?.set?.(KEYS.payrollDailySettlementRegions, normalized, { source: 'write' });
      if (activeStorageAdapter.type === 'supabase' && typeof flushActiveStorage === 'function') {
        flushActiveStorage().catch(error => {
          console.warn('[BREM] payroll daily settlement regions persist failed:', error);
        });
      }
      return normalized;
    },

    async persistRegions(list) {
      const normalized = payrollDailySettlement.normalizeRegions(list);
      storageAdapter.write(KEYS.payrollDailySettlementRegions, normalized);
      window.BremDataCache?.set?.(KEYS.payrollDailySettlementRegions, normalized, { source: 'write' });
      if (activeStorageAdapter.type === 'supabase' && typeof flushActiveStorage === 'function') {
        await flushActiveStorage();
      }
      return normalized;
    },

    async addRegion(name) {
      const text = String(name || '').trim();
      if (!text) return payrollDailySettlement.getRegions();
      const list = payrollDailySettlement.getRegions();
      if (!list.includes(text)) list.push(text);
      list.sort((a, b) => a.localeCompare(b, 'ko'));
      return payrollDailySettlement.persistRegions(list);
    },

    async removeRegion(name) {
      const text = String(name || '').trim();
      if (!text) return payrollDailySettlement.getRegions();
      const list = payrollDailySettlement.getRegions().filter(item => item !== text);
      await payrollDailySettlement.persistRegions(list);
      const roster = payrollDailySettlement.getAll().map(item => (
        item.region === text ? { ...item, region: '', updatedAt: new Date().toISOString() } : item
      ));
      await payrollDailySettlement.persistAll(roster);
      return list;
    },

    getByRegion(regionName) {
      const region = String(regionName || '').trim();
      const list = payrollDailySettlement.getAll();
      if (!region || region === '__all__') return list;
      if (region === '__unset__') {
        return list.filter(item => !String(item.region || '').trim());
      }
      return list.filter(item => String(item.region || '').trim() === region);
    },

    countByRegion() {
      const counts = new Map();
      payrollDailySettlement.getAll().forEach(item => {
        const key = String(item.region || '').trim() || '__unset__';
        counts.set(key, (counts.get(key) || 0) + 1);
      });
      return counts;
    },

    async persistAll(list) {
      const normalized = payrollDailySettlement.normalizeList(list);
      storageAdapter.write(KEYS.payrollDailySettlementRoster, normalized);
      window.BremDataCache?.set?.(KEYS.payrollDailySettlementRoster, normalized, { source: 'write' });
      if (activeStorageAdapter.type === 'supabase' && typeof flushActiveStorage === 'function') {
        await flushActiveStorage();
      }
      return normalized;
    },

    getEnrolledDriverIdSet() {
      return new Set(payrollDailySettlement.getAll().map(item => item.driverId).filter(Boolean));
    },

    getRegionByDriverId(driverId) {
      const id = String(driverId || '').trim();
      if (!id) return '';
      const item = payrollDailySettlement.getAll().find(row => row.driverId === id);
      return item?.region || '';
    },

    normalizePlatform(item = {}) {
      return normalizePayrollDailyPlatform(item);
    }
  };

  const payrollWithdrawal = {
    getAll() {
      const raw = storageAdapter.read(KEYS.payrollWithdrawalRequests, []);
      return Array.isArray(raw) ? raw : [];
    },

    saveAll(list) {
      const normalized = Array.isArray(list) ? list : [];
      storageAdapter.write(KEYS.payrollWithdrawalRequests, normalized);
      window.BremDataCache?.set?.(KEYS.payrollWithdrawalRequests, normalized, { source: 'write' });
      return normalized;
    },

    async reloadFromServer() {
      if (activeStorageAdapter.type !== 'supabase' || !activeStorageAdapter.reloadSettingKey) {
        return payrollWithdrawal.getAll();
      }
      try {
        const value = await activeStorageAdapter.reloadSettingKey(KEYS.payrollWithdrawalRequests);
        const normalized = Array.isArray(value) ? value : [];
        window.BremDataCache?.set?.(KEYS.payrollWithdrawalRequests, normalized, { source: 'server' });
        return normalized;
      } catch (error) {
        console.warn('[BREM] payroll withdrawal reload failed:', error);
        return payrollWithdrawal.getAll();
      }
    },

    async fetchFromAdminApi(options = {}) {
      const result = await fetchAdminWithdrawalRequestsFromServer(options);
      if (!result?.ok) {
        throw new Error(result?.error || result?.message || '출금신청 목록을 불러오지 못했습니다.');
      }
      return Array.isArray(result.requests) ? result.requests : [];
    },

    async cancelRequest(requestId) {
      const result = await cancelAdminWithdrawalRequest(requestId);
      if (!result?.ok) {
        throw new Error(result?.error || result?.message || '출금신청 취소에 실패했습니다.');
      }
      return result;
    },

    async completeRequest(requestId) {
      const result = await completeAdminWithdrawalRequest(requestId);
      if (!result?.ok) {
        throw new Error(result?.error || result?.message || '출금완료 처리에 실패했습니다.');
      }
      return result;
    },

    async updateRequestPlatform(requestId, platform) {
      const result = await updateAdminWithdrawalRequestPlatform(requestId, platform);
      if (!result?.ok) {
        throw new Error(result?.error || result?.message || '플랫폼 변경에 실패했습니다.');
      }
      return result;
    },

    async autoFixPlatforms({ weekStart, dryRun } = {}) {
      const result = await autoFixAdminWithdrawalPlatforms({ weekStart, dryRun });
      if (!result?.ok) {
        throw new Error(result?.error || result?.message || '플랫폼 자동 교정에 실패했습니다.');
      }
      return result;
    },

    async deleteRequest(requestId) {
      const result = await deleteAdminWithdrawalRequest(requestId);
      if (!result?.ok) {
        throw new Error(result?.error || result?.message || '출금신청 삭제에 실패했습니다.');
      }
      return result;
    },

    async fetchAvailableDrivers(weekStart) {
      const result = await fetchWithdrawableDriversFromServer(weekStart);
      if (!result?.ok) {
        throw new Error(result?.error || result?.message || '기사별 출금가능금액을 불러오지 못했습니다.');
      }
      return result;
    },

    async adminCreate(payload = {}) {
      const result = await adminCreateWithdrawalRequestOnServer(payload);
      if (!result?.ok) {
        throw new Error(result?.error || result?.message || '관리자 출금 처리에 실패했습니다.');
      }
      return result;
    }
  };

  const payrollPublish = {
    getMeta() {
      const raw = isPayrollLocalStorageMode()
        ? readPayrollLocalCollection(KEYS.payrollRiderPublish, {})
        : storageAdapter.read(KEYS.payrollRiderPublish, {});
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    },

    countPendingForWeek(weekStart) {
      const week = String(weekStart || '').slice(0, 10);
      const weekLines = payrollSlipLines.getAll().filter(line => payrollLineWeekStart(line) === week);
      const pendingLines = weekLines.filter(line => !line.riderPublishedAt).length;
      const applicableNotices = payrollNotices.getAll().filter(notice => payrollNoticeAppliesToWeek(notice, week));
      const pendingNotices = applicableNotices.filter(notice => !notice.riderPublishedAt).length;
      return {
        settlementWeekStart: week,
        totalLines: weekLines.length,
        pendingLines,
        publishedLines: weekLines.length - pendingLines,
        totalNotices: applicableNotices.length,
        pendingNotices,
        publishedNotices: applicableNotices.length - pendingNotices,
        pendingTotal: pendingLines + pendingNotices
      };
    },

    async fetchStatusFromServer(weekStart) {
      const qs = weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : '';
      const result = await adminRidersApi(`/api/admin/payroll/publish-status${qs}`);
      if (!result.ok) return result;
      return {
        ok: true,
        settlementWeekStart: result.settlementWeekStart || weekStart,
        totalLines: Number(result.totalLines) || 0,
        pendingLines: Number(result.pendingLines) || 0,
        publishedLines: Number(result.publishedLines) || 0,
        totalNotices: Number(result.totalNotices) || 0,
        pendingNotices: Number(result.pendingNotices) || 0,
        publishedNotices: Number(result.publishedNotices) || 0,
        pendingTotal: Number(result.pendingTotal) || 0,
        lastPublishedAt: result.lastPublishedAt || null,
        lastPublishedBy: result.lastPublishedBy || '',
        paymentDate: result.paymentDate || '',
        columnMissing: Boolean(result.columnMissing),
        noticesTableMissing: Boolean(result.noticesTableMissing)
      };
    },

    recordWeekPublish({ weekStart, publishedAt, publishedBy, linesPublished = 0, noticesPublished = 0, paymentDate = '' } = {}) {
      const settlementWeekStart = String(weekStart || '').slice(0, 10);
      const existing = payrollPublish.getMeta();
      const weeks = existing.weeks && typeof existing.weeks === 'object' ? { ...existing.weeks } : {};
      weeks[settlementWeekStart] = {
        publishedAt: publishedAt || new Date().toISOString(),
        publishedBy: String(publishedBy || 'admin').trim(),
        linesPublished: Number(linesPublished) || 0,
        noticesPublished: Number(noticesPublished) || 0,
        paymentDate: String(paymentDate || weeks[settlementWeekStart]?.paymentDate || '').slice(0, 10)
      };
      const meta = {
        ...existing,
        publishedAt: publishedAt || new Date().toISOString(),
        publishedBy: String(publishedBy || 'admin').trim(),
        settlementWeekStart,
        linesPublished: Number(linesPublished) || 0,
        noticesPublished: Number(noticesPublished) || 0,
        paymentDate: String(paymentDate || '').slice(0, 10),
        weeks
      };
      if (isPayrollLocalStorageMode()) {
        localStorage.setItem(KEYS.payrollRiderPublish, JSON.stringify(meta));
      } else {
        storageAdapter.write(KEYS.payrollRiderPublish, meta);
      }
      return meta;
    },

    async publishWeekToRiders(weekStart, options = {}) {
      const settlementWeekStart = String(weekStart || '').slice(0, 10);
      if (!settlementWeekStart) {
        throw new Error('정산주(수요일 시작)를 선택하세요.');
      }
      const paymentDate = String(options.paymentDate || '').slice(0, 10);

      await storageAdapter.flush?.();

      const apiResult = await adminRidersApi('/api/admin/payroll/publish', {
        method: 'POST',
        body: JSON.stringify({ weekStart: settlementWeekStart, paymentDate })
      });

      if (apiResult.ok) {
        payrollPublish.recordWeekPublish({
          weekStart: settlementWeekStart,
          publishedAt: apiResult.publishedAt,
          publishedBy: apiResult.publishedBy,
          linesPublished: apiResult.linesPublished,
          noticesPublished: apiResult.noticesPublished,
          paymentDate: apiResult.paymentDate || paymentDate
        });
        await Promise.all([
          refreshDataFromServer(KEYS.payrollSlipLines),
          refreshDataFromServer(KEYS.payrollNotices)
        ]);
        return {
          ok: true,
          settlementWeekStart,
          linesPublished: Number(apiResult.linesPublished) || 0,
          noticesPublished: Number(apiResult.noticesPublished) || 0,
          publishedCount: Number(apiResult.publishedCount) || 0,
          publishedAt: apiResult.publishedAt
        };
      }

      if (!isPayrollLocalStorageMode()) {
        return {
          ok: false,
          message: apiResult.message || apiResult.error || '급여명세서 반영에 실패했습니다.'
        };
      }

      const now = new Date().toISOString();
      const lines = payrollSlipLines.getAll().map(line => {
        if (payrollLineWeekStart(line) !== settlementWeekStart) return line;
        return { ...line, riderPublishedAt: now, updatedAt: now };
      });
      const notices = payrollNotices.getAll().map(notice => {
        if (!payrollNoticeAppliesToWeek(notice, settlementWeekStart)) return notice;
        return { ...notice, riderPublishedAt: now, updatedAt: now };
      });
      await payrollSlipLines.persistList(lines);
      await payrollNotices.persistList(notices);
      const linesPublished = lines.filter(
        line => payrollLineWeekStart(line) === settlementWeekStart && line.riderPublishedAt === now
      ).length;
      const noticesPublished = notices.filter(
        notice => payrollNoticeAppliesToWeek(notice, settlementWeekStart) && notice.riderPublishedAt === now
      ).length;
      const meta = payrollPublish.recordWeekPublish({
        weekStart: settlementWeekStart,
        publishedAt: now,
        linesPublished,
        noticesPublished,
        paymentDate
      });
      return {
        ok: true,
        settlementWeekStart,
        linesPublished,
        noticesPublished,
        publishedCount: linesPublished + noticesPublished,
        publishedAt: meta.publishedAt,
        fallback: true
      };
    }
  };

  const leases = {
    CONTRACT_TYPES: Object.freeze({
      LEASE: 'lease',
      RENTAL: 'rental'
    }),

    normalizeContractType(value) {
      const text = String(value || '').trim().toLowerCase();
      if (['rental', '렌탈', '렌트', 'rent', 'r'].includes(text)) return leases.CONTRACT_TYPES.RENTAL;
      if (['lease', '리스', 'l'].includes(text)) return leases.CONTRACT_TYPES.LEASE;
      return leases.CONTRACT_TYPES.LEASE;
    },

    normalizeMoney(value) {
      const num = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
      return Number.isFinite(num) ? num : 0;
    },

    normalizeWeeklyRent(dailyRent, weeklyRent) {
      const daily = leases.normalizeMoney(dailyRent);
      if (daily > 0) return daily * 7;
      return leases.normalizeMoney(weeklyRent);
    },

    normalizeDate(value) {
      if (!value && value !== 0) return '';
      if (typeof value === 'number' && window.XLSX?.SSF) {
        const parsed = window.XLSX.SSF.parse_date_code(value);
        if (parsed) {
          return [
            parsed.y,
            String(parsed.m).padStart(2, '0'),
            String(parsed.d).padStart(2, '0')
          ].join('-');
        }
      }
      const text = String(value).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
      const digits = text.replace(/[^\d]/g, '');
      if (digits.length === 8) {
        return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
      }
      const parsedDate = new Date(text);
      if (!Number.isNaN(parsedDate.getTime())) {
        return [
          parsedDate.getFullYear(),
          String(parsedDate.getMonth() + 1).padStart(2, '0'),
          String(parsedDate.getDate()).padStart(2, '0')
        ].join('-');
      }
      return '';
    },

    normalizeRecord(raw = {}, existing = null) {
      const contractType = leases.normalizeContractType(
        raw.contractType != null ? raw.contractType : existing?.contractType
      );
      return {
        id: existing?.id || raw.id || createId(),
        contractType,
        model: String(raw.model != null ? raw.model : existing?.model || '').trim(),
        chassisNumber: String(raw.chassisNumber != null ? raw.chassisNumber : existing?.chassisNumber || '').trim(),
        vehicleNumber: String(raw.vehicleNumber != null ? raw.vehicleNumber : existing?.vehicleNumber || '').trim(),
        insuranceCompany: String(raw.insuranceCompany != null ? raw.insuranceCompany : existing?.insuranceCompany || '').trim(),
        insuranceAge: String(raw.insuranceAge != null ? raw.insuranceAge : existing?.insuranceAge || '').trim(),
        insuranceType: String(raw.insuranceType != null ? raw.insuranceType : existing?.insuranceType || '').trim(),
        contractStartDate: leases.normalizeDate(
          raw.contractStartDate != null ? raw.contractStartDate : existing?.contractStartDate
        ),
        contractEndDate: leases.normalizeDate(
          raw.contractEndDate != null ? raw.contractEndDate : existing?.contractEndDate
        ),
        dailyRent: leases.normalizeMoney(raw.dailyRent != null ? raw.dailyRent : existing?.dailyRent),
        weeklyRent: leases.normalizeWeeklyRent(
          raw.dailyRent != null ? raw.dailyRent : existing?.dailyRent,
          raw.weeklyRent != null ? raw.weeklyRent : (raw.monthlyRent != null ? raw.monthlyRent : existing?.weeklyRent ?? existing?.monthlyRent)
        ),
        memo: String(raw.memo != null ? raw.memo : existing?.memo || '').trim(),
        renter: String(raw.renter != null ? raw.renter : existing?.renter || '').trim(),
        lessor: String(raw.lessor != null ? raw.lessor : existing?.lessor || '').trim(),
        returnDate: leases.normalizeDate(
          raw.returnDate != null ? raw.returnDate : existing?.returnDate
        ),
        rentalAssignment: leases.normalizeRentalAssignment(
          raw.rentalAssignment !== undefined ? raw.rentalAssignment : existing?.rentalAssignment
        ),
        createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    },

    normalizeRentalAssignment(raw) {
      if (raw === null || raw === false) return null;
      if (!raw || typeof raw !== 'object') return null;
      const renter = String(raw.renter || '').trim();
      const startDate = leases.normalizeDate(raw.startDate);
      const returnDate = leases.normalizeDate(raw.returnDate);
      const dailyRent = leases.normalizeMoney(raw.dailyRent);
      const weeklyRent = leases.normalizeWeeklyRent(dailyRent, raw.weeklyRent ?? raw.monthlyRent);
      const memo = String(raw.memo || '').trim();
      if (!renter && !startDate && !dailyRent && !weeklyRent && !returnDate && !memo) return null;
      return { renter, startDate, returnDate, dailyRent, weeklyRent, memo };
    },

    todayKey() {
      const now = new Date();
      return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
      ].join('-');
    },

    hasActiveContract(item) {
      const end = String(item?.contractEndDate || '').trim();
      if (!end) return true;
      return end >= leases.todayKey();
    },

    hasActiveRentalAssignment(item) {
      const assignment = item?.rentalAssignment;
      if (!assignment) return false;
      if (!String(assignment.renter || '').trim()) return false;
      const returnDate = String(assignment.returnDate || '').trim();
      if (!returnDate) return true;
      return returnDate >= leases.todayKey();
    },

    isEmptyVehicle(item) {
      if (window.BremLeaseErp?.isEmptyVehicle) {
        return window.BremLeaseErp.isEmptyVehicle(item);
      }
      if (!item || item.contractType !== leases.CONTRACT_TYPES.LEASE) return false;
      if (!leases.hasActiveContract(item)) return false;
      if (leases.hasActiveRentalAssignment(item)) return false;
      return !String(item.renter || '').trim();
    },

    getEmptyVehicles() {
      return leases.getAll().filter(item => leases.isEmptyVehicle(item));
    },

    assignRental(leaseId, assignment) {
      const existing = leases.getById(leaseId);
      if (!existing || existing.contractType !== leases.CONTRACT_TYPES.LEASE) return null;
      return leases.update(leaseId, {
        ...existing,
        rentalAssignment: leases.normalizeRentalAssignment(assignment)
      });
    },

    clearRentalAssignment(leaseId) {
      const existing = leases.getById(leaseId);
      if (!existing) return null;
      return leases.update(leaseId, { ...existing, rentalAssignment: null });
    },

    syncLeaseCache(list) {
      const value = Array.isArray(list) ? list : leases.getAll();
      window.BremDataCache?.set?.(KEYS.leaseVehicles, value, { source: 'write' });
      return value;
    },

    writeList(list, options = {}) {
      const next = Array.isArray(list) ? list : [];
      leases.syncLeaseCache(next);
      return storageAdapter.write(KEYS.leaseVehicles, next, {
        allowEmpty: next.length === 0,
        ...options
      });
    },

    async persist() {
      const list = leases.getAll();
      await awaitPersist(storageAdapter.write(KEYS.leaseVehicles, list, {
        allowEmpty: list.length === 0
      }));
    },

    getAll() {
      return storageAdapter.read(KEYS.leaseVehicles, []);
    },

    getById(id) {
      return leases.getAll().find(item => item.id === id) || null;
    },

    findByVehicleKey({ chassisNumber, vehicleNumber } = {}) {
      const chassis = String(chassisNumber || '').trim();
      const vehicle = String(vehicleNumber || '').trim();
      return leases.getAll().find(item => {
        if (chassis && item.chassisNumber === chassis) return true;
        if (vehicle && item.vehicleNumber === vehicle) return true;
        return false;
      }) || null;
    },

    sortValue(item) {
      return `${item.contractType || ''}T${item.contractEndDate || ''}T${item.updatedAt || ''}`;
    },

    create(data) {
      const list = leases.getAll();
      const next = leases.normalizeRecord(data);
      list.unshift(next);
      leases.writeList(list);
      return next;
    },

    update(id, data) {
      const existing = leases.getById(id);
      if (!existing) return null;
      const list = leases.getAll().map(item => (
        item.id === id ? leases.normalizeRecord(data, existing) : item
      ));
      leases.writeList(list);
      return list.find(item => item.id === id) || null;
    },

    upsert(data) {
      const existing = data.id
        ? leases.getById(data.id)
        : leases.findByVehicleKey(data);
      if (existing) return leases.update(existing.id, { ...existing, ...data });
      return leases.create(data);
    },

    upsertMany(records = []) {
      const results = [];
      records.forEach(record => {
        results.push(leases.upsert(record));
      });
      return results;
    },

    removeById(id) {
      return leases.removeByIds([id]);
    },

    removeByIds(ids) {
      const idSet = new Set((Array.isArray(ids) ? ids : []).map(value => String(value || '').trim()).filter(Boolean));
      if (!idSet.size) return Promise.resolve();
      const deletedRowIds = [...idSet];
      const next = leases.getAll().filter(item => !idSet.has(item.id));
      return leases.writeList(next, { deletedRowIds, deleteOnly: true, allowEmpty: true });
    }
  };

  const revenue = {
    COLLECTIONS: Object.freeze({
      OFFICE: 'officeExpenses',
      BROPAY: 'bropay',
      INCOME_BAEMIN: 'incomeBaemin',
      INCOME_COUPANG: 'incomeCoupang',
      WEEKLY_PROFIT: 'weeklyProfit',
      WEEKLY_FINAL: 'weeklyFinalSettlement',
      MONTHLY_SETTLEMENT: 'monthlySettlements',
      DEBT_BAEMIN: 'debtBaemin',
      DEBT_COUPANG: 'debtCoupang'
    }),

    FIXED_EXPENSE_NAMES: Object.freeze([
      '사무실월세1', '사무실월세2',
      '전기세1', '전기세2',
      '가스비1', '가스비2',
      '관리비1', '관리비2',
      '인터넷비1', '인터넷비2',
      '정수기비용1', '정수기비용2'
    ]),

    WEEKLY_PROFIT_REVENUE_ROWS: Object.freeze([
      { key: 'sales', label: '매출액' },
      { key: 'calls', label: '콜수' },
      { key: 'mgmtProfit', label: '관리비 수익' },
      { key: 'salesFeeProfit', label: '매출 수수료 수익' },
      { key: 'callFeeProfit', label: '콜당 수수료 수익' },
      { key: 'otherRevenue', label: '기타 수익' }
    ]),

    WEEKLY_PROFIT_EXPENSE_ROWS: Object.freeze([
      { key: 'employment', label: '고용보험' },
      { key: 'industrial', label: '산재보험' },
      { key: 'promotion', label: '프로모션' },
      { key: 'priceGuarantee', label: '단가보장' },
      { key: 'bikeReserve', label: '오토바이 지급 적립금' },
      { key: 'otherExpense', label: '기타 지출' }
    ]),

    normalizeMoney(value) {
      const num = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
      return Number.isFinite(num) ? num : 0;
    },

    normalizeDate(value) {
      if (!value && value !== 0) return '';
      if (typeof value === 'number' && window.XLSX?.SSF) {
        const parsed = window.XLSX.SSF.parse_date_code(value);
        if (parsed) {
          return [
            parsed.y,
            String(parsed.m).padStart(2, '0'),
            String(parsed.d).padStart(2, '0')
          ].join('-');
        }
      }
      const text = String(value).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
      const digits = text.replace(/[^\d]/g, '');
      if (digits.length === 8) {
        return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
      }
      const parsedDate = new Date(text);
      if (!Number.isNaN(parsedDate.getTime())) {
        return [
          parsedDate.getFullYear(),
          String(parsedDate.getMonth() + 1).padStart(2, '0'),
          String(parsedDate.getDate()).padStart(2, '0')
        ].join('-');
      }
      return '';
    },

    normalizeMonthKey(value) {
      const text = String(value || '').trim();
      if (/^\d{4}-\d{2}$/.test(text)) return text;
      const date = revenue.normalizeDate(text);
      if (date) return date.slice(0, 7);
      const digits = text.replace(/[^\d]/g, '');
      if (digits.length >= 6) {
        return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
      }
      return '';
    },

    emptyStore() {
      return {
        officeExpenses: [],
        bropay: [],
        incomeBaemin: [],
        incomeCoupang: [],
        weeklyProfit: [],
        weeklyFinalSettlement: [],
        monthlySettlements: [],
        debtBaemin: [],
        debtCoupang: []
      };
    },

    readStore() {
      const raw = storageAdapter.read(KEYS.revenue, null);
      if (!raw || typeof raw !== 'object') return revenue.emptyStore();
      const base = revenue.emptyStore();
      Object.keys(base).forEach(key => {
        if (Array.isArray(raw[key])) base[key] = raw[key];
      });
      return base;
    },

    writeStore(store) {
      storageAdapter.write(KEYS.revenue, store);
    },

    getCollection(name) {
      const store = revenue.readStore();
      return Array.isArray(store[name]) ? [...store[name]] : [];
    },

    setCollection(name, list) {
      const store = revenue.readStore();
      store[name] = Array.isArray(list) ? list : [];
      revenue.writeStore(store);
      return store[name];
    },

    normalizePlatformPair(raw = {}) {
      return {
        coupang: revenue.normalizeMoney(raw.coupang),
        baemin: revenue.normalizeMoney(raw.baemin)
      };
    },

    normalizeWeeklyProfit(raw = {}, existing = null) {
      const revenueRows = {};
      revenue.WEEKLY_PROFIT_REVENUE_ROWS.forEach(row => {
        revenueRows[row.key] = revenue.normalizePlatformPair(
          raw.revenue?.[row.key] || existing?.revenue?.[row.key]
        );
      });
      const expenseRows = {};
      revenue.WEEKLY_PROFIT_EXPENSE_ROWS.forEach(row => {
        expenseRows[row.key] = revenue.normalizePlatformPair(
          raw.expense?.[row.key] || existing?.expense?.[row.key]
        );
      });
      return {
        id: existing?.id || raw.id || createId(),
        weekStart: revenue.normalizeDate(raw.weekStart != null ? raw.weekStart : existing?.weekStart),
        weekLabel: String(raw.weekLabel != null ? raw.weekLabel : existing?.weekLabel || '').trim(),
        revenue: revenueRows,
        expense: expenseRows,
        final: {
          totalRevenue: revenue.normalizeMoney(raw.final?.totalRevenue ?? existing?.final?.totalRevenue),
          totalExpense: revenue.normalizeMoney(raw.final?.totalExpense ?? existing?.final?.totalExpense),
          weeklyNetProfit: revenue.normalizeMoney(raw.final?.weeklyNetProfit ?? existing?.final?.weeklyNetProfit),
          totalCalls: revenue.normalizeMoney(raw.final?.totalCalls ?? existing?.final?.totalCalls)
        },
        memo: String(raw.memo != null ? raw.memo : existing?.memo || '').trim(),
        createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    },

    normalizeOfficeExpense(raw = {}, existing = null) {
      const category = raw.category === 'fixed' || existing?.category === 'fixed' ? 'fixed' : 'variable';
      return {
        id: existing?.id || raw.id || createId(),
        monthKey: revenue.normalizeMonthKey(raw.monthKey != null ? raw.monthKey : existing?.monthKey),
        category,
        fixedItemName: String(raw.fixedItemName != null ? raw.fixedItemName : existing?.fixedItemName || '').trim(),
        writtenDate: revenue.normalizeDate(raw.writtenDate != null ? raw.writtenDate : existing?.writtenDate),
        spender: String(raw.spender != null ? raw.spender : existing?.spender || '').trim(),
        name: String(raw.name != null ? raw.name : existing?.name || '').trim(),
        plannedAmount: revenue.normalizeMoney(raw.plannedAmount != null ? raw.plannedAmount : existing?.plannedAmount),
        paidAmount: revenue.normalizeMoney(raw.paidAmount != null ? raw.paidAmount : existing?.paidAmount),
        paidDate: revenue.normalizeDate(raw.paidDate != null ? raw.paidDate : existing?.paidDate),
        location: String(raw.location != null ? raw.location : existing?.location || '').trim(),
        finalAmount: revenue.normalizeMoney(raw.finalAmount != null ? raw.finalAmount : existing?.finalAmount),
        createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    },

    normalizeBropay(raw = {}, existing = null) {
      return {
        id: existing?.id || raw.id || createId(),
        weekStart: revenue.normalizeDate(raw.weekStart != null ? raw.weekStart : existing?.weekStart),
        withdrawalDate: revenue.normalizeDate(raw.withdrawalDate != null ? raw.withdrawalDate : existing?.withdrawalDate),
        name: String(raw.name != null ? raw.name : existing?.name || '').trim(),
        branch: String(raw.branch != null ? raw.branch : existing?.branch || '').trim(),
        amount: revenue.normalizeMoney(raw.amount != null ? raw.amount : existing?.amount),
        reason: String(raw.reason != null ? raw.reason : existing?.reason || '').trim(),
        createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    },

    normalizeIncome(platform, raw = {}, existing = null) {
      const isCoupang = platform === 'coupang';
      const riderPayment = revenue.normalizeMoney(
        raw.riderPayment != null ? raw.riderPayment : existing?.riderPayment
      );
      let paymentFeePercent = Number(
        raw.paymentFeePercent != null ? raw.paymentFeePercent : existing?.paymentFeePercent
      );
      if (!Number.isFinite(paymentFeePercent) || paymentFeePercent <= 0) {
        const legacyFee = revenue.normalizeMoney(
          raw.paymentFee3pct != null ? raw.paymentFee3pct : existing?.paymentFee3pct
        );
        paymentFeePercent = riderPayment > 0 && legacyFee
          ? (legacyFee / riderPayment) * 100
          : 3;
      }
      const callFeePerCall = revenue.normalizeMoney(
        raw.callFeePerCall != null
          ? raw.callFeePerCall
          : (raw.callFee != null ? raw.callFee : (existing?.callFeePerCall ?? existing?.callFee))
      );
      const base = {
        id: existing?.id || raw.id || createId(),
        weekStart: revenue.normalizeDate(raw.weekStart != null ? raw.weekStart : existing?.weekStart),
        region: String(raw.region != null ? raw.region : existing?.region || '').trim(),
        supplyPrice: revenue.normalizeMoney(raw.supplyPrice != null ? raw.supplyPrice : existing?.supplyPrice),
        riderPayment,
        paymentFeePercent,
        mgmtFee: revenue.normalizeMoney(raw.mgmtFee != null ? raw.mgmtFee : existing?.mgmtFee),
        promotion: revenue.normalizeMoney(raw.promotion != null ? raw.promotion : existing?.promotion),
        callCount: revenue.normalizeMoney(raw.callCount != null ? raw.callCount : existing?.callCount),
        callFeePerCall,
        expenseEmployment: revenue.normalizeMoney(
          raw.expenseEmployment != null ? raw.expenseEmployment : existing?.expenseEmployment
        ),
        expenseIndustrial: revenue.normalizeMoney(
          raw.expenseIndustrial != null ? raw.expenseIndustrial : existing?.expenseIndustrial
        ),
        vatReserve: revenue.normalizeMoney(
          raw.vatReserve != null ? raw.vatReserve : existing?.vatReserve
        ),
        expensePromotion: revenue.normalizeMoney(
          raw.expensePromotion != null ? raw.expensePromotion : existing?.expensePromotion
        ),
        deficitCompensation: isCoupang
          ? revenue.normalizeMoney(raw.deficitCompensation != null ? raw.deficitCompensation : existing?.deficitCompensation)
          : 0,
        memo: String(raw.memo != null ? raw.memo : existing?.memo || '').trim(),
        createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString()
      };
      return revenue.computeIncomeRecord(platform, base);
    },

    computeIncomeRecord(platform, base) {
      const paymentFeeAmount = Math.round(
        revenue.normalizeMoney(base.riderPayment) * (Number(base.paymentFeePercent) || 3) / 100
      );
      const callFeeTotal = Math.round(
        revenue.normalizeMoney(base.callCount) * revenue.normalizeMoney(base.callFeePerCall)
      );
      const totalRevenue = paymentFeeAmount
        + revenue.normalizeMoney(base.mgmtFee)
        + revenue.normalizeMoney(base.promotion)
        + callFeeTotal;
      const totalExpense = revenue.normalizeMoney(base.expenseEmployment)
        + revenue.normalizeMoney(base.expenseIndustrial)
        + revenue.normalizeMoney(base.vatReserve)
        + revenue.normalizeMoney(base.expensePromotion);
      const deficitCompensation = platform === 'coupang'
        ? revenue.normalizeMoney(base.deficitCompensation)
        : 0;
      const netProfit = totalRevenue - totalExpense;

      return {
        ...base,
        paymentFeeAmount,
        callFeeTotal,
        totalRevenue,
        totalExpense,
        deficitCompensation,
        netProfit,
        updatedAt: new Date().toISOString()
      };
    },

    normalizeIncomeBaemin(raw = {}, existing = null) {
      return revenue.normalizeIncome('baemin', raw, existing);
    },

    normalizeIncomeCoupang(raw = {}, existing = null) {
      return revenue.normalizeIncome('coupang', raw, existing);
    },

    normalizeDebt(raw = {}, existing = null) {
      const platform = raw.platform === 'coupang' || existing?.platform === 'coupang' ? 'coupang' : 'baemin';
      return {
        id: existing?.id || raw.id || createId(),
        platform,
        weekStart: revenue.normalizeDate(raw.weekStart != null ? raw.weekStart : existing?.weekStart),
        name: String(raw.name != null ? raw.name : existing?.name || '').trim(),
        amount: revenue.normalizeMoney(raw.amount != null ? raw.amount : existing?.amount),
        leaseAmount: revenue.normalizeMoney(raw.leaseAmount != null ? raw.leaseAmount : existing?.leaseAmount),
        preSettlementAmount: revenue.normalizeMoney(raw.preSettlementAmount != null ? raw.preSettlementAmount : existing?.preSettlementAmount),
        total: revenue.normalizeMoney(raw.total != null ? raw.total : existing?.total),
        memo: String(raw.memo != null ? raw.memo : existing?.memo || '').trim(),
        createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    },

    listWeeklyProfit() {
      return revenue.getCollection(revenue.COLLECTIONS.WEEKLY_PROFIT);
    },

    getWeeklyProfitByWeek(weekStart) {
      const key = revenue.normalizeDate(weekStart);
      return revenue.listWeeklyProfit().find(item => item.weekStart === key) || null;
    },

    saveWeeklyProfit(data) {
      const existing = data.id
        ? revenue.listWeeklyProfit().find(item => item.id === data.id)
        : revenue.getWeeklyProfitByWeek(data.weekStart);
      const next = revenue.normalizeWeeklyProfit(data, existing);
      const list = revenue.listWeeklyProfit().filter(item => item.id !== next.id && item.weekStart !== next.weekStart);
      list.push(next);
      revenue.setCollection(revenue.COLLECTIONS.WEEKLY_PROFIT, list);
      return next;
    },

    removeWeeklyProfit(id) {
      revenue.setCollection(
        revenue.COLLECTIONS.WEEKLY_PROFIT,
        revenue.listWeeklyProfit().filter(item => item.id !== id)
      );
    },

    sumIncomeList(list) {
      return (Array.isArray(list) ? list : []).reduce((acc, item) => {
        acc.totalRevenue += revenue.normalizeMoney(item.totalRevenue);
        acc.totalExpense += revenue.normalizeMoney(item.totalExpense);
        acc.netProfit += revenue.normalizeMoney(item.netProfit);
        acc.callCount += revenue.normalizeMoney(item.callCount);
        acc.count += 1;
        return acc;
      }, { totalRevenue: 0, totalExpense: 0, netProfit: 0, callCount: 0, count: 0 });
    },

    aggregateWeekSettlement(weekStart) {
      const key = revenue.normalizeDate(weekStart);
      const baeminItems = revenue.listIncomeBaemin(key);
      const coupangItems = revenue.listIncomeCoupang(key);
      const bropayItems = revenue.listBropay(key);
      const baemin = { ...revenue.sumIncomeList(baeminItems), items: baeminItems };
      const coupang = { ...revenue.sumIncomeList(coupangItems), items: coupangItems };
      const bropayTotal = bropayItems.reduce(
        (sum, item) => sum + revenue.normalizeMoney(item.amount),
        0
      );
      const totalRevenue = baemin.totalRevenue + coupang.totalRevenue;
      const totalExpense = baemin.totalExpense + coupang.totalExpense;
      const netProfit = baemin.netProfit + coupang.netProfit;
      return {
        weekStart: key,
        baemin,
        coupang,
        bropayTotal,
        bropayCount: bropayItems.length,
        combined: {
          totalRevenue,
          totalExpense,
          netProfit,
          callCount: baemin.callCount + coupang.callCount,
          regionCount: baemin.count + coupang.count
        }
      };
    },

    getFinalSettlementByWeek(weekStart) {
      const key = revenue.normalizeDate(weekStart);
      return revenue.getCollection(revenue.COLLECTIONS.WEEKLY_FINAL)
        .find(item => item.weekStart === key) || null;
    },

    saveFinalSettlement(weekStart, memo = '') {
      const snapshot = revenue.aggregateWeekSettlement(weekStart);
      const existing = revenue.getFinalSettlementByWeek(weekStart);
      const record = {
        id: existing?.id || createId(),
        weekStart: snapshot.weekStart,
        memo: String(memo || existing?.memo || '').trim(),
        snapshot,
        savedAt: new Date().toISOString(),
        createdAt: existing?.createdAt || new Date().toISOString()
      };
      const list = revenue.getCollection(revenue.COLLECTIONS.WEEKLY_FINAL)
        .filter(item => item.weekStart !== record.weekStart);
      list.push(record);
      revenue.setCollection(revenue.COLLECTIONS.WEEKLY_FINAL, list);
      return record;
    },

    listMonthlySettlements(monthKey) {
      const key = revenue.normalizeMonthKey(monthKey);
      return revenue.getCollection(revenue.COLLECTIONS.MONTHLY_SETTLEMENT)
        .filter(item => !key || item.monthKey === key)
        .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    },

    aggregateMonthSettlement(monthKey) {
      const key = revenue.normalizeMonthKey(monthKey);
      const store = revenue.readStore();
      const weekStarts = new Set();
      [...store.incomeBaemin, ...store.incomeCoupang, ...store.bropay].forEach(item => {
        const date = item.weekStart || item.withdrawalDate || '';
        if (String(date).startsWith(key)) weekStarts.add(revenue.normalizeDate(item.weekStart || date));
      });
      store.weeklyFinalSettlement.forEach(item => {
        if (String(item.weekStart || '').startsWith(key)) weekStarts.add(item.weekStart);
      });

      const weeks = [...weekStarts].filter(Boolean).sort();
      const weekSnapshots = weeks.map(week => revenue.aggregateWeekSettlement(week));
      const officeItems = revenue.listOfficeExpenses(key);
      const officeTotal = officeItems.reduce(
        (sum, item) => sum + revenue.normalizeMoney(item.finalAmount || item.paidAmount),
        0
      );

      const totalRevenue = weekSnapshots.reduce((sum, w) => sum + w.combined.totalRevenue, 0);
      const totalExpense = weekSnapshots.reduce((sum, w) => sum + w.combined.totalExpense, 0) + officeTotal;
      const netProfit = weekSnapshots.reduce((sum, w) => sum + w.combined.netProfit, 0) - officeTotal;

      return {
        monthKey: key,
        weeks: weekSnapshots,
        officeTotal,
        officeCount: officeItems.length,
        combined: { totalRevenue, totalExpense, netProfit }
      };
    },

    saveMonthlySettlement(monthKey, memo = '') {
      const snapshot = revenue.aggregateMonthSettlement(monthKey);
      const existing = revenue.listMonthlySettlements(monthKey)[0];
      const record = {
        id: existing?.id || createId(),
        monthKey: snapshot.monthKey,
        memo: String(memo || existing?.memo || '').trim(),
        snapshot,
        savedAt: new Date().toISOString(),
        createdAt: existing?.createdAt || new Date().toISOString()
      };
      const list = revenue.getCollection(revenue.COLLECTIONS.MONTHLY_SETTLEMENT)
        .filter(item => item.monthKey !== record.monthKey);
      list.push(record);
      revenue.setCollection(revenue.COLLECTIONS.MONTHLY_SETTLEMENT, list);
      return record;
    },

    listOfficeExpenses(monthKey) {
      const key = revenue.normalizeMonthKey(monthKey);
      return revenue.getCollection(revenue.COLLECTIONS.OFFICE)
        .map(item => revenue.normalizeOfficeExpense(item))
        .filter(item => !key || item.monthKey === key);
    },

    saveOfficeExpense(data) {
      const list = revenue.getCollection(revenue.COLLECTIONS.OFFICE);
      const existing = data.id ? list.find(item => item.id === data.id) : null;
      const next = revenue.normalizeOfficeExpense(data, existing);
      const filtered = list.filter(item => item.id !== next.id);
      filtered.push(next);
      revenue.setCollection(revenue.COLLECTIONS.OFFICE, filtered);
      return next;
    },

    removeOfficeExpense(id) {
      revenue.setCollection(
        revenue.COLLECTIONS.OFFICE,
        revenue.getCollection(revenue.COLLECTIONS.OFFICE).filter(item => item.id !== id)
      );
    },

    listBropay(weekStart) {
      const key = revenue.normalizeDate(weekStart);
      return revenue.getCollection(revenue.COLLECTIONS.BROPAY)
        .map(item => revenue.normalizeBropay(item))
        .filter(item => !key || item.weekStart === key);
    },

    saveBropay(data) {
      const list = revenue.getCollection(revenue.COLLECTIONS.BROPAY);
      const existing = data.id ? list.find(item => item.id === data.id) : null;
      const next = revenue.normalizeBropay(data, existing);
      const filtered = list.filter(item => item.id !== next.id);
      filtered.push(next);
      revenue.setCollection(revenue.COLLECTIONS.BROPAY, filtered);
      return next;
    },

    removeBropay(id) {
      revenue.setCollection(
        revenue.COLLECTIONS.BROPAY,
        revenue.getCollection(revenue.COLLECTIONS.BROPAY).filter(item => item.id !== id)
      );
    },

    listIncomeBaemin(weekStart) {
      const key = revenue.normalizeDate(weekStart);
      return revenue.getCollection(revenue.COLLECTIONS.INCOME_BAEMIN)
        .map(item => revenue.normalizeIncomeBaemin(item))
        .filter(item => !key || item.weekStart === key);
    },

    saveIncomeBaemin(data) {
      const list = revenue.getCollection(revenue.COLLECTIONS.INCOME_BAEMIN);
      const existing = data.id ? list.find(item => item.id === data.id) : null;
      const next = revenue.normalizeIncomeBaemin(data, existing);
      const filtered = list.filter(item => item.id !== next.id);
      filtered.push(next);
      revenue.setCollection(revenue.COLLECTIONS.INCOME_BAEMIN, filtered);
      return next;
    },

    bulkSaveIncomeBaemin(records) {
      const results = [];
      (Array.isArray(records) ? records : []).forEach(record => {
        results.push(revenue.saveIncomeBaemin(record));
      });
      return results;
    },

    removeIncomeBaemin(id) {
      revenue.setCollection(
        revenue.COLLECTIONS.INCOME_BAEMIN,
        revenue.getCollection(revenue.COLLECTIONS.INCOME_BAEMIN).filter(item => item.id !== id)
      );
    },

    listIncomeCoupang(weekStart) {
      const key = revenue.normalizeDate(weekStart);
      return revenue.getCollection(revenue.COLLECTIONS.INCOME_COUPANG)
        .map(item => revenue.normalizeIncomeCoupang(item))
        .filter(item => !key || item.weekStart === key);
    },

    saveIncomeCoupang(data) {
      const list = revenue.getCollection(revenue.COLLECTIONS.INCOME_COUPANG);
      const existing = data.id ? list.find(item => item.id === data.id) : null;
      const next = revenue.normalizeIncomeCoupang(data, existing);
      const filtered = list.filter(item => item.id !== next.id);
      filtered.push(next);
      revenue.setCollection(revenue.COLLECTIONS.INCOME_COUPANG, filtered);
      return next;
    },

    bulkSaveIncomeCoupang(records) {
      const results = [];
      (Array.isArray(records) ? records : []).forEach(record => {
        results.push(revenue.saveIncomeCoupang(record));
      });
      return results;
    },

    removeIncomeCoupang(id) {
      revenue.setCollection(
        revenue.COLLECTIONS.INCOME_COUPANG,
        revenue.getCollection(revenue.COLLECTIONS.INCOME_COUPANG).filter(item => item.id !== id)
      );
    },

    listDebt(platform, weekStart) {
      const key = revenue.normalizeDate(weekStart);
      const collection = platform === 'coupang'
        ? revenue.COLLECTIONS.DEBT_COUPANG
        : revenue.COLLECTIONS.DEBT_BAEMIN;
      return revenue.getCollection(collection)
        .map(item => revenue.normalizeDebt(item))
        .filter(item => item.platform === platform && (!key || item.weekStart === key));
    },

    saveDebt(data) {
      const platform = data.platform === 'coupang' ? 'coupang' : 'baemin';
      const collection = platform === 'coupang'
        ? revenue.COLLECTIONS.DEBT_COUPANG
        : revenue.COLLECTIONS.DEBT_BAEMIN;
      const list = revenue.getCollection(collection);
      const existing = data.id ? list.find(item => item.id === data.id) : null;
      const next = revenue.normalizeDebt({ ...data, platform }, existing);
      const filtered = list.filter(item => item.id !== next.id);
      filtered.push(next);
      revenue.setCollection(collection, filtered);
      return next;
    },

    removeDebt(platform, id) {
      const collection = platform === 'coupang'
        ? revenue.COLLECTIONS.DEBT_COUPANG
        : revenue.COLLECTIONS.DEBT_BAEMIN;
      revenue.setCollection(
        collection,
        revenue.getCollection(collection).filter(item => item.id !== id)
      );
    },

    sumPlatformPair(rows) {
      return Object.values(rows || {}).reduce((acc, pair) => {
        acc.coupang += revenue.normalizeMoney(pair?.coupang);
        acc.baemin += revenue.normalizeMoney(pair?.baemin);
        acc.total += revenue.normalizeMoney(pair?.coupang) + revenue.normalizeMoney(pair?.baemin);
        return acc;
      }, { coupang: 0, baemin: 0, total: 0 });
    },

    computeWeeklyProfitTotals(record) {
      const revenueSum = revenue.sumPlatformPair(record?.revenue);
      const expenseSum = revenue.sumPlatformPair(record?.expense);
      const weeklyNetProfit = (record?.final?.weeklyNetProfit || 0)
        || (revenueSum.total - expenseSum.total);
      return {
        revenueSum,
        expenseSum,
        weeklyNetProfit
      };
    }
  };

  const events = {
    getCatalog() {
      return readEventCatalogRaw();
    },

    upsertCatalogItem({ name, targetCount }) {
      const catalog = events.getCatalog();
      const existing = catalog.find(item => item.name === name);
      if (existing) {
        existing.targetCount = Number(targetCount);
      } else {
        catalog.push({ id: createId(), name, targetCount: Number(targetCount) });
      }
      storageAdapter.write(KEYS.eventCatalog, catalog);
      return catalog;
    },

    removeCatalogItem(id) {
      storageAdapter.write(KEYS.eventCatalog, events.getCatalog().filter(item => item.id !== id));
    },

    getDriverItemMap() {
      const map = storageAdapter.read(KEYS.eventItems, null);
      if (map) return map;
      return storageAdapter.read(KEYS.legacyBikes, {});
    },

    saveDriverItemMap(map) {
      storageAdapter.write(KEYS.eventItems, map);
    },

    setDriverItem(driverId, item) {
      const map = events.getDriverItemMap();
      if (item && item.id) {
        map[driverId] = item.id;
      } else {
        delete map[driverId];
      }
      events.saveDriverItemMap(map);
      drivers.update(driverId, {
        longEventItemId: item ? item.id : '',
        longEventItem: item ? item.name : '',
        longEventStartDate: item ? (drivers.getById(driverId)?.longEventStartDate || '') : ''
      });
    },

    setDriverStartDate(driverId, startDate) {
      drivers.update(driverId, { longEventStartDate: startDate || '' });
    },

    getDriverEventPlatform(driver) {
      return normalizeLongEventPlatform(driver?.longEventPlatform || 'coupang');
    },

    setDriverEventPlatform(driverId, platform) {
      drivers.update(driverId, { longEventPlatform: normalizeLongEventPlatform(platform) });
    },

    getStartDateForDriver(driver) {
      return driver.longEventStartDate || '';
    },

    eventCallsForDriver(driver) {
      const startDate = events.getStartDateForDriver(driver);
      if (!startDate) return 0;
      return calls.sumForDriverSince(driver.id, startDate, events.getDriverEventPlatform(driver));
    },

    getProgressForDriver(driver) {
      if (
        isProductionMode()
        && activeSupabaseProfile?.role === 'rider'
        && riderLongEventProgress
        && (!driver?.id || String(activeSupabaseProfile.rider_id || '') === String(driver.id))
      ) {
        const progress = riderLongEventProgress;
        const unset = progress.status === 'unset' || (!progress.itemId && !progress.itemName);
        const item = unset
          ? null
          : progress.itemName
            ? {
              id: progress.itemId || '',
              name: progress.itemName,
              targetCount: Number(progress.target) || 0
            }
            : events.getItemForDriver(driver);
        return {
          ...progress,
          item,
          itemId: unset ? '' : (progress.itemId || ''),
          itemName: unset ? '' : (progress.itemName || ''),
          total: Number(progress.total) || 0,
          target: Number(progress.target) || 0,
          rate: Number(progress.rate) || 0,
          status: unset ? 'unset' : (progress.status || 'unset')
        };
      }

      const item = events.getItemForDriver(driver);
      const startDate = events.getStartDateForDriver(driver);
      const platform = events.getDriverEventPlatform(driver);
      const total = startDate ? calls.sumForDriverSince(driver.id, startDate, platform) : 0;
      const target = item ? Number(item.targetCount) || 0 : 0;
      const rate = target ? Math.round((total / target) * 100) : 0;
      let status = 'unset';
      if (item && !startDate) status = 'no-start';
      else if (item && startDate) status = rate >= 100 ? 'achieved' : 'in-progress';

      return {
        itemId: item?.id || '',
        itemName: item?.name || '',
        platform,
        startDate,
        total,
        target,
        rate,
        status,
        item
      };
    },

    removeCatalogItemReferences(itemId) {
      events.removeCatalogItem(itemId);

      const map = events.getDriverItemMap();
      Object.keys(map).forEach(driverId => {
        if (map[driverId] === itemId) delete map[driverId];
      });
      events.saveDriverItemMap(map);

      drivers.getAll().forEach(driver => {
        if (driver.longEventItemId === itemId) {
          drivers.update(driver.id, { longEventItemId: '', longEventItem: '', longEventStartDate: '' });
        }
      });
    },

    getItemForDriver(driver) {
      const driverItemId = String(driver?.longEventItemId || '').trim();
      const driverItemName = String(driver?.longEventItem || '').trim();
      if (!driverItemId && !driverItemName) {
        if (!isRiderProductionSession()) {
          const map = events.getDriverItemMap();
          const mappedId = String(map[driver?.id] || '').trim();
          if (mappedId) {
            const catalog = events.getCatalog();
            return catalog.find(item => item.id === mappedId) || null;
          }
        }
        return null;
      }
      const catalog = events.getCatalog();
      const selected = driverItemId || driverItemName || '';
      return catalog.find(item => item.id === selected || item.name === selected) || null;
    },

    saveDriverSettings(driverId, { itemId, itemName, platform, startDate } = {}) {
      const map = events.getDriverItemMap();
      const normalizedItemId = String(itemId || '').trim();
      if (normalizedItemId) {
        map[driverId] = normalizedItemId;
      } else {
        delete map[driverId];
      }
      events.saveDriverItemMap(map);

      const effectiveStartDate = normalizedItemId ? String(startDate || '').slice(0, 10) : '';

      return drivers.update(driverId, {
        longEventItemId: normalizedItemId,
        longEventItem: normalizedItemId ? String(itemName || '').trim() : '',
        longEventStartDate: effectiveStartDate,
        longEventPlatform: normalizeLongEventPlatform(platform)
      });
    }
  };

  const settlements = {
    getAll() {
      return normalizeSettlements(storageAdapter.read(KEYS.settlements, []));
    },

    upsertBatch({ period, records, platform = DEFAULT_PLATFORM }) {
      if (!period) throw new Error('정산 기간이 필요합니다.');

      const p = normalizePlatform(platform);
      const callDate = String(period).slice(0, 10);
      const appliedAt = new Date().toISOString();

      const nextRecords = records.map(record => ({
        id: `${record.driverId}-${callDate}-${p}`,
        driverId: record.driverId,
        period: callDate,
        platform: p,
        riderId: record.riderId || '',
        orderCount: Number(record.orderCount ?? record.callCount ?? 0),
        hourlyInsurance: Math.abs(Number(record.hourlyInsurance || 0)),
        // 원천세·고용·산재 기준 금액(쿠팡 AC열). 0 이면 정산금액 기준으로 계산된다.
        deductionBase: Math.abs(Number(record.deductionBase || 0)),
        settlementAmount: Number(record.settlementAmount ?? record.deliveryAmount ?? 0),
        deliveryAmount: Number(record.deliveryAmount ?? record.settlementAmount ?? 0),
        appliedAt
      }));

      // 배민 콜수는 이제 BIZ 현황 크롤링(콜수·거절율 동기화)에서만 반영한다.
      // 일정산서 업로드는 배민 정산금액·시간제보험만 저장하고 콜수(brem_admin_calls)는 건드리지 않는다.
      // 쿠팡은 기존대로 일정산서 업로드가 콜수를 반영한다.
      if (p !== 'baemin') {
        calls.upsertBatchDaily({
          date: callDate,
          platform: p,
          records: nextRecords.map(record => ({
            driverId: record.driverId,
            count: record.orderCount
          }))
        });
      }

      const keepIds = new Set(nextRecords.map(record => record.id));
      const list = settlements.getAll().filter(item => !keepIds.has(item.id));
      list.unshift(...nextRecords);
      const persist = storageAdapter.write(KEYS.settlements, list, { incrementalRows: nextRecords });
      try {
        applyLoanDailyDeductFromSettlementPeriod(callDate);
      } catch (error) {
        console.warn('[settlements.upsertBatch] loan daily deduct sync skipped:', error?.message || error);
      }
      return persist || list;
    },

    /** 시간제보험만 반영 — 콜수/정산금액·콜입력은 건드리지 않음 */
    upsertHourlyInsuranceBatch({ period, records = [], platform = DEFAULT_PLATFORM }) {
      if (!period) throw new Error('정산 기간이 필요합니다.');
      const p = normalizePlatform(platform);
      const callDate = String(period).slice(0, 10);
      const appliedAt = new Date().toISOString();
      const list = settlements.getAll();
      const byId = new Map(list.map(item => [item.id, { ...item }]));
      const touched = [];

      (Array.isArray(records) ? records : []).forEach(record => {
        const driverId = String(record.driverId || '').trim();
        if (!driverId) return;
        const id = `${driverId}-${callDate}-${p}`;
        const existing = byId.get(id);
        const hourlyInsurance = Math.abs(Number(record.hourlyInsurance || 0));
        const next = existing
          ? {
              ...existing,
              riderId: String(record.riderId || existing.riderId || ''),
              hourlyInsurance,
              appliedAt
            }
          : {
              id,
              driverId,
              period: callDate,
              platform: p,
              riderId: String(record.riderId || ''),
              orderCount: 0,
              hourlyInsurance,
              settlementAmount: 0,
              deliveryAmount: 0,
              appliedAt
            };
        byId.set(id, next);
        touched.push(next);
      });

      if (!touched.length) return list;
      const keepIds = new Set(touched.map(item => item.id));
      const nextList = [...touched, ...list.filter(item => !keepIds.has(item.id))];
      const persist = storageAdapter.write(KEYS.settlements, nextList, { incrementalRows: touched });
      return persist || nextList;
    },

    removeById(id) {
      const target = settlements.getAll().find(item => item.id === id);
      storageAdapter.write(
        KEYS.settlements,
        settlements.getAll().filter(item => item.id !== id),
        { allowEmpty: true }
      );
      if (target) {
        const periodKey = String(target.period).slice(0, 10);
        const p = normalizePlatform(target.platform);
        // 배민 콜수는 BIZ 크롤링 소유이므로 일정산 삭제 시 배민 콜은 지우지 않는다. (쿠팡만 연동 삭제)
        if (p !== 'baemin') {
          const callId = `${target.driverId}-${periodKey}-${p}`;
          storageAdapter.write(
            KEYS.calls,
            calls.getAll().filter(call => call.id !== callId),
            { allowEmpty: true }
          );
          if (activeStorageAdapter.deleteAdminCallsByIds) {
            void activeStorageAdapter.deleteAdminCallsByIds([callId]);
          }
        }
      }
      return settlements.getAll();
    },

    async removeByIdAsync(id) {
      const targetId = String(id || '').trim();
      if (!targetId) return settlements.getAll();

      const target = settlements.getAll().find(item => item.id === targetId);
      const parsed = target
        ? {
          driverId: target.driverId,
          periodKey: String(target.period).slice(0, 10),
          platform: normalizePlatform(target.platform)
        }
        : parseDriverDayRecordId(targetId);
      if (!parsed) return settlements.getAll();

      const { driverId, periodKey, platform: parsedPlatform } = parsed;
      const p = normalizePlatform(parsedPlatform);
      const callId = `${driverId}-${periodKey}-${p}`;

      const nextSettlements = settlements.getAll().filter(item => item.id !== targetId);
      storageAdapter.write(KEYS.settlements, nextSettlements, { allowEmpty: true });

      // 배민 콜수는 BIZ 크롤링 소유이므로 일정산 삭제 시 배민 콜은 지우지 않는다. (쿠팡만 연동 삭제)
      if (p !== 'baemin') {
        if (activeStorageAdapter.deleteAdminCallsByIds) {
          await activeStorageAdapter.deleteAdminCallsByIds([callId]);
        } else {
          storageAdapter.write(
            KEYS.calls,
            calls.getAll().filter(call => call.id !== callId),
            { allowEmpty: true }
          );
        }
      }

      if (activeStorageAdapter.deleteDailySettlementsByIds) {
        await activeStorageAdapter.deleteDailySettlementsByIds([targetId]);
      }

      await storageAdapter.flush({ skipStagedCore: true });
      window.BremDataCache?.invalidate?.(KEYS.settlements);
      window.BremDataCache?.invalidate?.(KEYS.calls);
      return settlements.getAll();
    },

    async removeByIdsAsync(ids = []) {
      const idSet = new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean));
      if (!idSet.size) return settlements.getAll();

      if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.deleteDailySettlementsByIds) {
        await activeStorageAdapter.deleteDailySettlementsByIds([...idSet]);
        return settlements.getAll();
      }

      const list = settlements.getAll().filter(item => !idSet.has(item.id));
      await awaitPersist(storageAdapter.write(KEYS.settlements, list, {
        allowEmpty: true,
        deletedRowIds: [...idSet]
      }));
      return settlements.getAll();
    },

    async clearByPeriod(period, platform = DEFAULT_PLATFORM, options = {}) {
      const p = normalizePlatform(platform);
      const periodKey = String(period).slice(0, 10);
      if (!periodKey) return settlements.getAll();

      if (activeStorageAdapter.type === 'supabase' && activeStorageAdapter.ensureKeysLoaded) {
        await activeStorageAdapter.ensureKeysLoaded([KEYS.calls]);
      }

      const removed = settlements.getAll().filter(item => {
        const itemPeriod = String(item.period).slice(0, 10);
        return normalizePlatform(item.platform) === p && itemPeriod === periodKey;
      });
      const nextSettlements = settlements.getAll().filter(item => {
        const itemPeriod = String(item.period).slice(0, 10);
        return !(normalizePlatform(item.platform) === p && itemPeriod === periodKey);
      });

      if (removed.length && activeStorageAdapter.deleteDailySettlementsByIds) {
        await activeStorageAdapter.deleteDailySettlementsByIds(removed.map(item => item.id));
      } else {
        await storageAdapter.write(
          KEYS.settlements,
          nextSettlements,
          { allowEmpty: true }
        );
      }

      if (activeStorageAdapter.deleteAdminCallsByPeriod) {
        await activeStorageAdapter.deleteAdminCallsByPeriod(p, periodKey);
      } else {
        calls.removeByPeriod(periodKey, p);
        await storageAdapter.flush?.();
      }

      if (options.keepUploadLogs !== true) {
        await settlementUploadLogs.removeDailyByPeriod(periodKey, p);
      }

      window.BremDataCache?.invalidate?.(KEYS.settlements);
      window.BremDataCache?.invalidate?.(KEYS.calls);
      window.BremDataCache?.invalidate?.(KEYS.settlementUploadLogs);

      return nextSettlements;
    },

    getForDriver(driverId) {
      return settlements.getAll().filter(item => item.driverId === driverId);
    },

    getLatestForDriver(driverId) {
      return settlements.getForDriver(driverId)
        .sort((a, b) => b.period.localeCompare(a.period) || b.appliedAt.localeCompare(a.appliedAt))[0] || null;
    }
  };

  function normalizePromotionTier(tier, index) {
    return {
      id: tier.id || createId(),
      minCalls: Number(tier.minCalls ?? 0),
      unitPrice: Number(tier.unitPrice ?? 0),
      sortOrder: Number(tier.sortOrder ?? index)
    };
  }

  function normalizePromotionPayPerCallTier(tier, index) {
    return {
      id: tier.id || createId(),
      minCalls: Number(tier.minCalls ?? 0),
      payPerCall: Number(tier.payPerCall ?? 0),
      sortOrder: Number(tier.sortOrder ?? index)
    };
  }

  function inferPromotionType(rule) {
    const base = rule.base || rule;
    const hasPay = Number(base.payPerCall ?? rule.payPerCall ?? rule.payPerOrder ?? 0) > 0;
    const hasGuarantee = Array.isArray(base.callTiers ?? rule.callTiers)
      && (base.callTiers ?? rule.callTiers).some(tier => Number(tier.unitPrice ?? 0) > 0);
    if (rule.type) return rule.type;
    if (hasPay && hasGuarantee) return 'both';
    if (hasGuarantee) return 'guaranteed_unit_price';
    return 'count_per_order';
  }

  function normalizePromotionRule(rule) {
    const migrated = typeof BremPromotionConditions !== 'undefined'
      ? BremPromotionConditions.migrateLegacyRule(rule)
      : { base: {}, blockConditions: [], bonusConditions: [], referenceConditions: [] };
    const platform = normalizePlatform(rule.platform);
    const base = migrated.base;
    const source = String(rule.source || rule.payload?.source || '').trim();

    // 소급 단가 구간은 콜수 오름차순으로 정리해 둔다. 계산은 달성한 구간 중
    // 가장 높은 하나만 쓰므로 정렬이 흐트러져도 금액은 같지만, 편집 화면과
    // 근거 표시가 뒤죽박죽 보이는 것을 막는다.
    const payPerCallTiers = Array.isArray(base.payPerCallTiers)
      ? base.payPerCallTiers
        .map(normalizePromotionPayPerCallTier)
        .filter(tier => tier.minCalls > 0 && tier.payPerCall > 0)
        .sort((a, b) => a.minCalls - b.minCalls)
      : [];
    base.payPerCallTiers = payPerCallTiers;

    return {
      id: rule.id || createId(),
      name: String(rule.name || '').trim() || '프로모션',
      type: inferPromotionType({ ...rule, ...base }),
      selectorKey: String(rule.selectorKey || '').trim(),
      platform,
      enabled: rule.enabled !== false,
      startDate: String(rule.startDate || '').slice(0, 10),
      endDate: String(rule.endDate || '').slice(0, 10),
      base,
      blockConditions: migrated.blockConditions,
      bonusConditions: migrated.bonusConditions,
      referenceConditions: migrated.referenceConditions,
      baseCallCount: base.baseCallCount,
      payStartCallCount: base.payStartCallCount,
      payPerCall: base.payPerCall,
      guaranteedUnitPrice: base.guaranteedUnitPrice,
      callTiers: Array.isArray(base.callTiers)
        ? base.callTiers.map(normalizePromotionTier).sort((a, b) => a.minCalls - b.minCalls)
        : [],
      payPerCallTiers,
      applyGlobalAcceptBlock: rule.applyGlobalAcceptBlock !== false,
      priority: Number(rule.priority ?? 100),
      allowDuplicate: Boolean(rule.allowDuplicate),
      duplicateStrategy: rule.duplicateStrategy || 'highest_priority',
      noPayConditions: String(rule.noPayConditions || '').trim(),
      source,
      isBuiltin: rule.isBuiltin === true || rule.payload?.isBuiltin === true,
      createdAt: rule.createdAt || new Date().toISOString(),
      updatedAt: rule.updatedAt || new Date().toISOString()
    };
  }

  const BUILTIN_PROMOTION_RULE_NAMES = new Set([
    '합산 공통 프로모션',
    '배민 141건 프로모션 (예시)',
    '쿠팡 기본 프로모션 (예시)',
    '단가보장제 (예시)'
  ]);

  function isBuiltinPromotionRule(rule) {
    if (!rule) return false;
    if (rule.source === 'user') return false;
    if (rule.isBuiltin === true) return true;
    if (rule.source === 'builtin' || rule.source === 'example' || rule.source === 'seed') return true;
    const name = String(rule.name || '').trim();
    if (BUILTIN_PROMOTION_RULE_NAMES.has(name)) return true;
    if (/\(예시\)/i.test(name)) return true;
    return false;
  }

  function getUserPromotionRules() {
    const raw = storageAdapter.readRaw(KEYS.promotionRules);
    if (!raw.exists) return [];
    let list = Array.isArray(raw.value) ? raw.value : [];
    list = patchCombinedPromotionRules(list);
    return list.map(normalizePromotionRule).filter(rule => !isBuiltinPromotionRule(rule));
  }

  function normalizePromotionSettings(raw) {
    const settings = raw || {};
    return {
      globalBlockEnabled: settings.globalBlockEnabled !== false,
      globalMinAcceptRate: Number(settings.globalMinAcceptRate ?? 85),
      globalMaxRejectRate: Number(settings.globalMaxRejectRate ?? 15),
      globalBlockPlatform: settings.globalBlockPlatform || 'all',
      globalBlockApplyTo: Array.isArray(settings.globalBlockApplyTo)
        ? settings.globalBlockApplyTo
        : 'all',
      updatedAt: settings.updatedAt || new Date().toISOString()
    };
  }

  function normalizeSelectorOptions(raw) {
    const defaults = [
      { key: '', label: '미선택' },
      { key: 'encourage', label: '독려 프로모션' },
      { key: 'basic', label: '기본 프로모션' },
      { key: 'high_price', label: '고단가 프로모션' },
      { key: 'guaranteed', label: '단가보장제' }
    ];
    if (!Array.isArray(raw) || !raw.length) return defaults;
    return raw.map(item => ({
      key: String(item.key ?? '').trim(),
      label: String(item.label || item.key || '').trim() || '미선택'
    }));
  }

  function buildExamplePromotionRules() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const startDate = `${year}-${month}-01`;
    const endDate = `${year}-${month}-${String(new Date(year, now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

    const tierSteps = [50, 100, 150, 200, 250, 300, 350];
    const tierPrices = [2800, 3000, 3200, 3400, 3700, 4000, 4500];

    return [
      normalizePromotionRule({
        name: '배민 141건 프로모션 (예시)',
        platform: 'baemin',
        enabled: false,
        startDate,
        endDate,
        priority: 20,
        base: {
          baseCallCount: 141,
          payStartCallCount: 141,
          payPerCall: 1000,
          guaranteedUnitPrice: 0,
          callTiers: []
        },
        blockConditions: [
          {
            conditionName: '수락률 85% 미만 미지급',
            conditionType: 'accept_rate_under',
            processingMode: 'block',
            rateThreshold: 85
          }
        ],
        bonusConditions: [
          {
            conditionName: '주6일 이상 추가 지급',
            conditionType: 'working_days',
            processingMode: 'bonus',
            minWorkingDays: 6,
            dailyMinOrders: 30,
            actionType: 'add_pay_per_order',
            addPayPerOrder: 500
          },
          {
            conditionName: '하루 30건 이상 6일 추가 지급',
            conditionType: 'daily_min_days',
            processingMode: 'bonus',
            dailyMinOrders: 30,
            minDailyOrderDays: 6,
            actionType: 'add_pay_per_order',
            addPayPerOrder: 500
          }
        ],
        referenceConditions: []
      }),
      normalizePromotionRule({
        name: '쿠팡 기본 프로모션 (예시)',
        platform: 'coupang',
        enabled: false,
        startDate,
        endDate,
        priority: 30,
        base: {
          baseCallCount: 141,
          payStartCallCount: 141,
          payPerCall: 1000,
          guaranteedUnitPrice: 0,
          callTiers: []
        },
        blockConditions: [
          {
            conditionName: '거절율 15% 초과 미지급',
            conditionType: 'reject_rate_over',
            processingMode: 'block',
            rateThreshold: 15
          },
          {
            conditionName: '기준 콜수 141건 미달 미지급',
            conditionType: 'total_orders_under',
            processingMode: 'block',
            minTotalOrders: 141
          }
        ],
        bonusConditions: [],
        referenceConditions: []
      }),
      normalizePromotionRule({
        name: '단가보장제 (예시)',
        platform: 'baemin',
        enabled: false,
        startDate,
        endDate,
        priority: 40,
        type: 'guaranteed_unit_price',
        base: {
          baseCallCount: 50,
          payStartCallCount: 0,
          payPerCall: 0,
          guaranteedUnitPrice: 2800,
          callTiers: tierSteps.map((minCalls, index) => ({
            minCalls,
            unitPrice: tierPrices[index],
            sortOrder: index
          }))
        },
        blockConditions: [
          {
            conditionName: '수락률 90% 미만 미지급',
            conditionType: 'accept_rate_under',
            processingMode: 'block',
            rateThreshold: 90
          }
        ],
        bonusConditions: [],
        referenceConditions: []
      }),
      normalizePromotionRule({
        name: '합산 공통 프로모션',
        platform: 'combined',
        enabled: true,
        applyGlobalAcceptBlock: false,
        startDate,
        endDate,
        priority: 10,
        base: {
          baseCallCount: 0,
          payStartCallCount: 1,
          payPerCall: 1000,
          guaranteedUnitPrice: 0,
          callTiers: []
        },
        blockConditions: [
          {
            conditionName: '거절율 15% 초과 미지급 (쿠팡)',
            conditionType: 'reject_rate_over',
            processingMode: 'block',
            rateThreshold: 15
          },
          {
            conditionName: '수락률 85% 미만 미지급 (배민)',
            conditionType: 'accept_rate_under',
            processingMode: 'block',
            rateThreshold: 85
          }
        ],
        bonusConditions: [],
        referenceConditions: []
      })
    ];
  }

  function patchCombinedPromotionRules(list, options = {}) {
    if (!Array.isArray(list) || !list.length) return list;
    let changed = false;
    const next = list.map(item => {
      if (String(item.platform || '').trim() !== 'combined') return item;
      if (item.applyGlobalAcceptBlock === false) return item;
      changed = true;
      return { ...item, applyGlobalAcceptBlock: false, updatedAt: new Date().toISOString() };
    });
    if (changed && options.persist === true && isStoragePersistReady()) {
      storageAdapter.write(KEYS.promotionRules, next);
      return storageAdapter.read(KEYS.promotionRules, next);
    }
    return changed ? next : list;
  }

  function ensureCombinedPromotionRule() {
    if (isProductionMode()) return;
    const list = storageAdapter.read(KEYS.promotionRules, []);
    if (!Array.isArray(list)) return;
    const hasCombined = list.some(item => String(item.platform || '').trim() === 'combined');
    if (hasCombined) return;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const startDate = `${year}-${month}-01`;
    const endDate = `${year}-${month}-${String(new Date(year, now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
    list.unshift(normalizePromotionRule({
      name: '합산 공통 프로모션',
      platform: 'combined',
      enabled: true,
      applyGlobalAcceptBlock: false,
      startDate,
      endDate,
      priority: 10,
      base: {
        baseCallCount: 0,
        payStartCallCount: 1,
        payPerCall: 1000,
        guaranteedUnitPrice: 0,
        callTiers: []
      },
      blockConditions: [
        {
          conditionName: '거절율 15% 초과 미지급 (쿠팡)',
          conditionType: 'reject_rate_over',
          processingMode: 'block',
          rateThreshold: 15
        },
        {
          conditionName: '수락률 85% 미만 미지급 (배민)',
          conditionType: 'accept_rate_under',
          processingMode: 'block',
          rateThreshold: 85
        }
      ],
      bonusConditions: [],
      referenceConditions: []
    }));
    storageAdapter.write(KEYS.promotionRules, list);
  }

  function buildDefaultPromotionSettings() {
    return normalizePromotionSettings({
      globalBlockEnabled: true,
      globalMinAcceptRate: 85,
      globalMaxRejectRate: 15,
      globalBlockPlatform: 'all',
      globalBlockApplyTo: 'all'
    });
  }

  const promotionSettings = {
    get() {
      const raw = storageAdapter.readRaw(KEYS.promotionSettings);
      if (!raw.exists) return buildDefaultPromotionSettings();
      return normalizePromotionSettings(raw.value);
    },

    save(settings) {
      const next = normalizePromotionSettings({
        ...settings,
        updatedAt: new Date().toISOString()
      });
      storageAdapter.write(KEYS.promotionSettings, next);
      return next;
    },

    update(changes) {
      return promotionSettings.save({ ...promotionSettings.get(), ...changes });
    }
  };

  const promotionSelectorOptions = {
    getAll() {
      const raw = storageAdapter.readRaw(KEYS.promotionSelectorOptions);
      if (!raw.exists) return normalizeSelectorOptions(null);
      return normalizeSelectorOptions(raw.value);
    },

    saveAll(list) {
      storageAdapter.write(KEYS.promotionSelectorOptions, normalizeSelectorOptions(list));
      return promotionSelectorOptions.getAll();
    }
  };

  const promotionRules = {
    getAll() {
      const raw = storageAdapter.readRaw(KEYS.promotionRules);
      if (!raw.exists) return [];
      let list = Array.isArray(raw.value) ? raw.value : [];
      list = patchCombinedPromotionRules(list);
      return list.map(normalizePromotionRule);
    },

    getById(id) {
      return promotionRules.getAll().find(rule => rule.id === id) || null;
    },

    saveAll(list) {
      storageAdapter.write(KEYS.promotionRules, list.map(normalizePromotionRule));
      return promotionRules.getAll();
    },

    create(rule) {
      const existing = promotionRules.getAll();
      if (existing.length >= MAX_ADMIN_PROMOTION_RULES) {
        throw new Error(`프로모션 조건은 최대 ${MAX_ADMIN_PROMOTION_RULES}개까지 등록할 수 있습니다.`);
      }
      const next = normalizePromotionRule({
        ...rule,
        id: createId(),
        source: 'user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      promotionRules.saveAll([next, ...promotionRules.getAll()]);
      return next;
    },

    update(id, changes) {
      const list = promotionRules.getAll();
      const index = list.findIndex(rule => rule.id === id);
      if (index === -1) throw new Error('프로모션 조건을 찾을 수 없습니다.');
      list[index] = normalizePromotionRule({
        ...list[index],
        ...changes,
        id,
        updatedAt: new Date().toISOString()
      });
      promotionRules.saveAll(list);
      return list[index];
    },

    remove(id) {
      if (activeStorageAdapter.deleteTableRow) {
        void activeStorageAdapter.deleteTableRow('promotions', id);
      }
      const filtered = promotionRules.getAll().filter(rule => rule.id !== id);
      if (filtered.length) {
        promotionRules.saveAll(filtered);
      } else if (activeStorageAdapter.stage) {
        activeStorageAdapter.stage(KEYS.promotionRules, []);
        window.BremDataCache?.set?.(KEYS.promotionRules, []);
      }
    },

    duplicate(id) {
      const source = promotionRules.getById(id);
      if (!source) throw new Error('프로모션 조건을 찾을 수 없습니다.');
      const copy = normalizePromotionRule({
        ...source,
        id: createId(),
        name: `${source.name} (복사)`,
        enabled: false,
        callTiers: source.callTiers.map(tier => ({ ...tier, id: createId() })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      promotionRules.saveAll([copy, ...promotionRules.getAll()]);
      return copy;
    },

    toggleEnabled(id) {
      const rule = promotionRules.getById(id);
      if (!rule) throw new Error('프로모션 조건을 찾을 수 없습니다.');
      return promotionRules.update(id, { enabled: !rule.enabled });
    }
  };

  function resolveWeeklySettlementPlatform(record = {}) {
    const explicit = String(record.platform || '').trim();
    if (explicit === 'baemin' || explicit === 'coupang') return explicit;
    const id = String(record.id || '').toLowerCase();
    if (id.includes('baemin')) return 'baemin';
    if (id.includes('coupang')) return 'coupang';
    const fileName = String(record.fileName || '').replace(/\.(xlsx|xls)$/i, '');
    if (/^\d{8}_\d{8}_.+_정산서$/i.test(fileName)) return 'baemin';
    return DEFAULT_PLATFORM;
  }

  function inferWeeklySettlementPlatform(record = {}) {
    return resolveWeeklySettlementPlatform(record);
  }

  function normalizeWeeklySettlement(record = {}) {
    const platform = normalizePlatform(record.platform || inferWeeklySettlementPlatform(record));
    const normBaemin = (typeof BremWeeklySettlement !== 'undefined'
      && typeof BremWeeklySettlement.normalizeBaeminUserId === 'function')
      ? BremWeeklySettlement.normalizeBaeminUserId
      : (value) => String(value || '').trim();
    // 성능: 라이더 루프 밖에서 기사 인덱스를 1회 구성한다.
    // (기존엔 라이더마다 drivers.getById(O(n))·배민 find(O(n))를 반복해 O(riders×drivers) → 45건/1,836라이더에 ~1.8초)
    const driverList = (Array.isArray(record.riders) && record.riders.length) ? drivers.getAll() : [];
    const driverById = new Map(driverList.map(item => [item.id, item]));
    let driverByBaeminId = null;
    const matchBaemin = (typeof BremWeeklySettlement !== 'undefined'
      && typeof BremWeeklySettlement.baeminIdMatchKey === 'function')
      ? BremWeeklySettlement.baeminIdMatchKey
      : (value) => {
        const v = normBaemin(value).replace(/\s+/g, '');
        if (!v) return '';
        return /^\d+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v.toLowerCase();
      };
    if (platform === 'baemin' && driverList.length) {
      driverByBaeminId = new Map();
      driverList.forEach(item => {
        // 앞자리 0 유무 차이를 무시해 엑셀 숫자변환 ID 와도 매칭한다.
        const key = matchBaemin(item.baeminId);
        if (key && !driverByBaeminId.has(key)) driverByBaeminId.set(key, item);
      });
    }
    const riders = Array.isArray(record.riders)
      ? record.riders.map(rider => {
        let matchedRiderId = String(rider.matchedRiderId || '').trim();
        let baeminUserId = String(rider.baeminUserId || '').trim();
        if (platform === 'baemin') {
          baeminUserId = normBaemin(baeminUserId);
          if (!matchedRiderId && baeminUserId && driverByBaeminId) {
            const resolved = driverByBaeminId.get(matchBaemin(baeminUserId));
            if (resolved) matchedRiderId = resolved.id;
          }
        }
        const driver = matchedRiderId ? (driverById.get(matchedRiderId) || null) : null;
        if (platform === 'baemin' && driver?.baeminId) {
          // 엑셀에서 앞 0 이 빠진 ID 대신 기사 등록 배민 ID(010…)로 복원한다.
          const prefer = (typeof BremWeeklySettlement !== 'undefined'
            && typeof BremWeeklySettlement.preferRegisteredBaeminId === 'function')
            ? BremWeeklySettlement.preferRegisteredBaeminId
            : null;
          baeminUserId = prefer
            ? prefer(baeminUserId, driver)
            : (normBaemin(driver.baeminId) || baeminUserId);
        }
        const normalized = {
          originalName: String(rider.originalName || ''),
          riderName: String(rider.riderName || ''),
          driverName: String(rider.driverName || driver?.name || rider.riderName || ''),
          matchedRiderId,
          matched: Boolean(matchedRiderId || rider.matched),
          weeklyOrderCount: Number(rider.weeklyOrderCount || 0),
          systemCallCount: Number(rider.systemCallCount || 0),
          callCountMatched: rider.callCountMatched !== false,
          // 여러 권역 콜 등: 콜수 불일치여도 정산금액은 유지하고 경고만 승인 처리
          callCountIgnored: rider.callCountIgnored === true,
          coupangLoginKey: String(rider.coupangLoginKey || ''),
          baeminUserId,
          warnings: Array.isArray(rider.warnings) ? rider.warnings.map(String) : []
        };
        // 직계약 금액/공제(배달료·추가지급·총배달료·고용/산재보험·원천세) 보존
        if (rider.amounts && typeof rider.amounts === 'object') {
          const a = rider.amounts;
          normalized.amounts = {
            deliveryFee: Number(a.deliveryFee || 0),
            missionPay: Number(a.missionPay || 0),
            totalDeliveryPay: Number(a.totalDeliveryPay || 0),
            // 쿠팡 원천세 기준 금액(AC열). 배민은 원천세를 Y열에서 바로 읽어 0이다.
            deductionBase: Number(a.deductionBase || 0),
            // 쿠팡 차감내역(AB열). 표기 전용이지만 저장 때 빠뜨리면 정산결과에서 0으로 보인다.
            deductionDetail: Number(a.deductionDetail || 0),
            hourlyInsurance: Number(a.hourlyInsurance || 0),
            employmentInsurance: Number(a.employmentInsurance || 0),
            accidentInsurance: Number(a.accidentInsurance || 0),
            withholdingTax: Number(a.withholdingTax || 0)
          };
        }
        return normalized;
      })
      : [];

    const summary = record.summary || {
      totalExtracted: riders.length,
      matchedRiders: riders.length,
      unmatchedRiders: 0,
      callCountMismatches: riders.filter(r => r.callCountMatched === false && r.callCountIgnored !== true).length
    };
    const channel = (record.channel === 'direct' || summary.channel === 'direct') ? 'direct' : 'bro';
    summary.channel = channel;
    summary.callCountIgnoredIds = riders
      .filter(r => r.callCountIgnored === true && r.matchedRiderId)
      .map(r => String(r.matchedRiderId));
    summary.callCountMismatches = riders.filter(r => r.callCountMatched === false && r.callCountIgnored !== true).length;

    const fileNames = Array.isArray(record.fileNames)
      ? record.fileNames.map(item => String(item || '').trim()).filter(Boolean)
      : [];
    const sourceParts = Array.isArray(record.sourceParts)
      ? record.sourceParts.map(part => ({
        fileName: String(part?.fileName || '').trim(),
        startDate: String(part?.startDate || '').slice(0, 10),
        endDate: String(part?.endDate || '').slice(0, 10),
        riders: Array.isArray(part?.riders) ? part.riders : []
      })).filter(part => part.fileName)
      : undefined;

    return {
      id: record.id || createId(),
      platform,
      channel,
      region: String(record.region || '').trim(),
      fileName: String(record.fileName || '').trim()
        || (fileNames.length ? fileNames.join(' + ') : ''),
      fileNames: fileNames.length
        ? fileNames
        : (String(record.fileName || '').includes(' + ')
          ? String(record.fileName).split(/\s*\+\s*/).map(s => s.trim()).filter(Boolean)
          : (record.fileName ? [String(record.fileName).trim()] : [])),
      sourceParts,
      baseSettlementDate: String(record.baseSettlementDate || '').slice(0, 10),
      startDate: String(record.startDate || '').slice(0, 10),
      endDate: String(record.endDate || '').slice(0, 10),
      paymentDate: String(record.paymentDate || '').slice(0, 10),
      settlementWeekLabel: String(record.settlementWeekLabel || '').trim(),
      uploadedAt: record.uploadedAt || new Date().toISOString(),
      matchedNamesLabel: String(record.matchedNamesLabel || '').trim()
        || riders.map(item => item.driverName || item.riderName).filter(Boolean).join(', '),
      riders,
      summary
    };
  }

  // 브로/직계약 채널별 저장 키 라우터. 직계약은 별도 settings 키에 완전 분리 보관.
  function weeklySettlementsKey(channel) {
    return channel === 'direct' ? KEYS.weeklySettlementsDirect : KEYS.weeklySettlements;
  }
  function settlementUploadLogsKey(channel) {
    return channel === 'direct' ? KEYS.settlementUploadLogsDirect : KEYS.settlementUploadLogs;
  }
  function settlementUnmatchedKey(channel) {
    return channel === 'direct' ? KEYS.settlementUnmatchedDirect : KEYS.settlementUnmatched;
  }

  // settlement_unmatched 는 upsert 전용 테이블이라, 목록에서 빠진 행을 그냥 다시 쓰면
  // Supabase 에서는 지워지지 않는다. 그러면 매칭이 끝난 건이 새로고침 때 미매칭으로
  // 되살아난다. 삭제할 id 를 명시해서 넘겨야 실제로 지워진다.
  function removedUnmatchedIds(before, after) {
    const keep = new Set((after || []).map(item => String(item?.id || '').trim()).filter(Boolean));
    return (before || [])
      .map(item => String(item?.id || '').trim())
      .filter(id => id && !keep.has(id));
  }

  const weeklySettlements = {
    getAll(channel) {
      const key = weeklySettlementsKey(channel === 'direct' ? 'direct' : 'bro');
      const raw = storageAdapter.read(key, []);
      const list = raw.map(normalizeWeeklySettlement);
      const repaired = list.map(item => ({
        ...item,
        platform: resolveWeeklySettlementPlatform(item)
      }));
      const changed = repaired.some((item, index) => {
        const rawPlatform = String(raw[index]?.platform || '').trim();
        return rawPlatform !== item.platform;
      });
      if (changed) storageAdapter.write(key, repaired);
      return repaired.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    },

    getById(id, channel) {
      if (channel === 'direct' || channel === 'bro') {
        return weeklySettlements.getAll(channel).find(item => item.id === id) || null;
      }
      return weeklySettlements.getAll('bro').find(item => item.id === id)
        || weeklySettlements.getAll('direct').find(item => item.id === id)
        || null;
    },

    save(record) {
      const next = normalizeWeeklySettlement(record);
      const key = weeklySettlementsKey(next.channel);
      const list = weeklySettlements.getAll(next.channel).filter(item => item.id !== next.id);
      list.unshift(next);
      storageAdapter.write(key, list);
      return next;
    },

    remove(id, channel) {
      const writeRemoved = (ch) => {
        const before = weeklySettlements.getAll(ch);
        const next = before.filter(item => item.id !== id);
        if (next.length === before.length) return;
        // 마지막 정산서를 지우면 빈 배열이 된다. allowEmpty 없이 쓰면
        // 데이터 보호가 막아 Supabase에 삭제가 안 남고 새로고침 때 되살아난다.
        storageAdapter.write(weeklySettlementsKey(ch), next, {
          allowEmpty: true,
          deletedRowIds: [id]
        });
      };
      if (channel === 'direct' || channel === 'bro') {
        writeRemoved(channel);
        return;
      }
      writeRemoved('bro');
      writeRemoved('direct');
    }
  };

  function normalizeSettlementUploadApplyRecord(record = {}) {
    return {
      driverId: String(record.driverId || ''),
      driverName: String(record.driverName || ''),
      riderId: String(record.riderId || ''),
      rawName: String(record.rawName || ''),
      name: String(record.name || ''),
      orderCount: Number(record.orderCount ?? record.callCount ?? 0),
      hourlyInsurance: Math.abs(Number(record.hourlyInsurance || 0)),
      // 공제기준금액(쿠팡 AC열)이 빠지면 「재반영」때 0으로 덮여 원천세가 어긋난다.
      deductionBase: Math.abs(Number(record.deductionBase || 0)),
      deliveryAmount: Number(record.deliveryAmount ?? record.settlementAmount ?? 0),
      settlementAmount: Number(record.settlementAmount ?? record.deliveryAmount ?? 0),
      reason: String(record.reason || '')
    };
  }

  function buildSettlementUploadContentHash(platform, period, records = []) {
    const p = normalizePlatform(platform);
    const periodKey = String(period || '').slice(0, 10);
    const rows = (Array.isArray(records) ? records : [])
      .map(normalizeSettlementUploadApplyRecord)
      .map(row => ({
        driverId: row.driverId,
        riderId: row.riderId,
        orderCount: row.orderCount,
        hourlyInsurance: row.hourlyInsurance,
        settlementAmount: row.settlementAmount
      }))
      .sort((a, b) => a.driverId.localeCompare(b.driverId, 'ko'));
    const payload = JSON.stringify({ platform: p, period: periodKey, rows });
    let hash = 2166136261;
    for (let i = 0; i < payload.length; i += 1) {
      hash ^= payload.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `s${(hash >>> 0).toString(36)}`;
  }

  function normalizeSettlementUploadKind(kind) {
    const value = String(kind || '').trim();
    if (value === 'weekly') return 'weekly';
    if (value === 'hourly_insurance') return 'hourly_insurance';
    return 'daily';
  }

  function normalizeSettlementUploadLog(entry = {}) {
    const period = String(entry.period || entry.startDate || '').slice(0, 10);
    const weekStart = String(entry.weekStart || (period ? weekStartKeyFromDate(period) : '')).slice(0, 10);
    const kind = normalizeSettlementUploadKind(entry.kind);
    const matchedRecords = Array.isArray(entry.matchedRecords)
      ? entry.matchedRecords.map(normalizeSettlementUploadApplyRecord)
      : [];
    const unmatchedRecords = Array.isArray(entry.unmatchedRecords)
      ? entry.unmatchedRecords.map(normalizeSettlementUploadApplyRecord)
      : [];
    const appliedRecords = Array.isArray(entry.appliedRecords)
      ? entry.appliedRecords.map(normalizeSettlementUploadApplyRecord)
      : [];
    const totalOrderCount = Number(
      entry.totalOrderCount
      || appliedRecords.reduce((sum, row) => sum + row.orderCount, 0)
      || matchedRecords.reduce((sum, row) => sum + row.orderCount, 0)
    );
    const totalDeliveryAmount = Number(
      entry.totalDeliveryAmount
      || entry.totalHourlyInsurance
      || (kind === 'hourly_insurance'
        ? (appliedRecords.length ? appliedRecords : matchedRecords)
          .reduce((sum, row) => sum + Number(row.hourlyInsurance || 0), 0)
        : 0)
    );
    return {
      id: String(entry.id || createId()),
      kind,
      channel: entry.channel === 'direct' ? 'direct' : (entry.channel === 'bro' ? 'bro' : ''),
      platform: normalizePlatform(entry.platform),
      fileName: String(entry.fileName || '').trim(),
      period,
      weekStart,
      weekEnd: String(entry.weekEnd || (weekStart ? weekEndKeyFromDate(weekStart) : '')).slice(0, 10),
      region: String(entry.region || '').trim(),
      startDate: String(entry.startDate || period).slice(0, 10),
      endDate: String(entry.endDate || '').slice(0, 10),
      status: String(entry.status || 'uploaded'),
      matchedCount: Number(entry.matchedCount || matchedRecords.length || 0),
      unmatchedCount: Number(entry.unmatchedCount ?? unmatchedRecords.length ?? 0),
      totalDeliveryAmount,
      totalHourlyInsurance: kind === 'hourly_insurance' ? totalDeliveryAmount : Number(entry.totalHourlyInsurance || 0),
      totalOrderCount,
      contentHash: String(entry.contentHash || ''),
      matchedRecords,
      unmatchedRecords,
      appliedRecords,
      duplicateOfLogId: String(entry.duplicateOfLogId || ''),
      skipReason: String(entry.skipReason || ''),
      linkedRecordId: String(entry.linkedRecordId || ''),
      uploadedAt: entry.uploadedAt || new Date().toISOString(),
      appliedAt: entry.appliedAt || '',
      updatedAt: entry.updatedAt || entry.uploadedAt || new Date().toISOString()
    };
  }

  const settlementUploadLogs = {
    getAll(channel) {
      const key = settlementUploadLogsKey(channel === 'direct' ? 'direct' : 'bro');
      return storageAdapter.read(key, [])
        .map(normalizeSettlementUploadLog)
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    },

    getById(id) {
      return settlementUploadLogs.getAll('bro').find(item => item.id === id)
        || settlementUploadLogs.getAll('direct').find(item => item.id === id)
        || null;
    },

    getFiltered(options = {}) {
      const kind = options.kind ? String(options.kind) : '';
      const platform = options.platform ? normalizePlatform(options.platform) : '';
      const weekStart = String(options.weekStart || '').slice(0, 10);
      // 직계약은 별도 저장 키에 완전 분리되어 있어 채널별로 해당 키만 읽으면 됨(추가 필터/맵 불필요).
      const channel = options.channel === 'direct' ? 'direct' : 'bro';
      return settlementUploadLogs.getAll(channel).filter(item => {
        if (kind && item.kind !== kind) return false;
        if (platform && item.platform !== platform) return false;
        if (weekStart) {
          const itemWeekStart = String(
            item.weekStart || (item.period ? weekStartKeyFromDate(item.period) : '')
          ).slice(0, 10);
          if (itemWeekStart !== weekStart) return false;
        }
        return true;
      });
    },

    persistList(list, options = {}) {
      const key = options.channel === 'direct' ? KEYS.settlementUploadLogsDirect : KEYS.settlementUploadLogs;
      const value = (Array.isArray(list) ? list : []).map(normalizeSettlementUploadLog);
      return storageAdapter.write(key, value, options);
    },

    add(entry) {
      const next = normalizeSettlementUploadLog(entry);
      const channel = next.channel === 'direct' ? 'direct' : 'bro';
      const list = [next, ...settlementUploadLogs.getAll(channel).filter(item => item.id !== next.id)];
      settlementUploadLogs.persistList(list, { incrementalRows: [next], channel });
      return next;
    },

    update(id, patch = {}) {
      const channel = patch.channel === 'direct' ? 'direct'
        : patch.channel === 'bro' ? 'bro'
        : (settlementUploadLogs.getAll('direct').some(item => item.id === id) ? 'direct' : 'bro');
      const list = settlementUploadLogs.getAll(channel).map(item => (
        item.id === id
          ? normalizeSettlementUploadLog({ ...item, ...patch, updatedAt: new Date().toISOString() })
          : item
      ));
      const updated = list.find(item => item.id === id) || null;
      settlementUploadLogs.persistList(list, updated ? { incrementalRows: [updated], channel } : { channel });
      return updated;
    },

    remove(id, options = {}) {
      const channel = settlementUploadLogs.getAll('direct').some(item => item.id === id) ? 'direct' : 'bro';
      const target = settlementUploadLogs.getAll(channel).find(item => item.id === id) || null;
      const rollback = options.rollback !== false;
      // 롤백(정산/콜수 되돌리기)은 일정산(브로 메인 키)에만 해당. 직계약 주정산 로그는 단순 삭제.
      if (rollback && target && channel === 'bro') {
        if (target.kind === 'hourly_insurance') {
          void settlementUploadLogs.rollbackAppliedHourlyInsuranceLogAsync(target);
        } else {
          void settlementUploadLogs.rollbackAppliedDailyLogAsync(target);
        }
      }
      settlementUploadLogs.persistList(
        settlementUploadLogs.getAll(channel).filter(item => item.id !== id),
        { channel, allowEmpty: true, deletedRowIds: [id] }
      );
      return target || null;
    },

    async removeAsync(id, options = {}) {
      const target = settlementUploadLogs.getById(id);
      const rollback = options.rollback !== false;
      let rollbackResult = { rolledBackSettlements: 0, rolledBackCalls: 0, rolledBackHourly: 0 };
      if (rollback && target) {
        if (target.kind === 'hourly_insurance') {
          rollbackResult = await settlementUploadLogs.rollbackAppliedHourlyInsuranceLogAsync(target);
        } else {
          rollbackResult = await settlementUploadLogs.rollbackAppliedDailyLogAsync(target);
        }
      }
      const nextList = settlementUploadLogs.getAll().filter(item => item.id !== id);
      await settlementUploadLogs.persistList(nextList, { allowEmpty: true, deletedRowIds: [id] });
      await storageAdapter.flush({ skipStagedCore: true });
      window.BremDataCache?.invalidate?.(KEYS.settlements);
      window.BremDataCache?.invalidate?.(KEYS.calls);
      window.BremDataCache?.invalidate?.(KEYS.settlementUploadLogs);
      await refetchDataKey(KEYS.settlements);
      await refetchDataKey(KEYS.calls);
      return { ...target, rollbackResult };
    },

    async removeDailyByWeekAsync(weekStart, platform = DEFAULT_PLATFORM, options = {}) {
      const p = normalizePlatform(platform);
      const weekKey = String(weekStart || '').slice(0, 10);
      if (!weekKey) return { removed: 0, appliedCount: 0, rolledBackCalls: 0 };

      const targets = settlementUploadLogs.getFiltered({
        kind: 'daily',
        platform: p,
        weekStart: weekKey
      });
      if (!targets.length) return { removed: 0, appliedCount: 0, rolledBackCalls: 0 };

      const rollback = options.rollback !== false;
      const sorted = [...targets].sort((a, b) => {
        const periodCmp = String(a.period).localeCompare(String(b.period));
        if (periodCmp !== 0) return periodCmp;
        return String(b.appliedAt || b.uploadedAt || '').localeCompare(String(a.appliedAt || a.uploadedAt || ''));
      });

      if (rollback && activeStorageAdapter.ensureKeysLoaded) {
        await activeStorageAdapter.ensureKeysLoaded([KEYS.settlements, KEYS.calls], { force: true });
      }

      let appliedCount = 0;
      let rolledBackCalls = 0;
      const deletedIds = [];

      for (const log of sorted) {
        if (rollback && log.status === 'applied') {
          appliedCount += 1;
          const result = await settlementUploadLogs.rollbackAppliedDailyLogAsync(log);
          const rolledBack = result.rolledBackCalls || 0;
          rolledBackCalls += rolledBack < 0 ? 1 : rolledBack;
        }
        deletedIds.push(log.id);
      }

      const deletedIdSet = new Set(deletedIds);
      const nextList = settlementUploadLogs.getAll().filter(item => !deletedIdSet.has(item.id));
      await settlementUploadLogs.persistList(nextList, { allowEmpty: true, deletedRowIds: deletedIds });
      await storageAdapter.flush({ skipStagedCore: true });
      window.BremDataCache?.invalidate?.(KEYS.settlements);
      window.BremDataCache?.invalidate?.(KEYS.calls);
      window.BremDataCache?.invalidate?.(KEYS.settlementUploadLogs);
      await refetchDataKey(KEYS.settlements);
      await refetchDataKey(KEYS.calls);
      return { removed: deletedIds.length, appliedCount, rolledBackCalls };
    },

    async rollbackAppliedDailyLogAsync(log) {
      if (!log || log.kind !== 'daily' || log.status !== 'applied') {
        return { rolledBackSettlements: 0, rolledBackCalls: 0 };
      }

      const p = normalizePlatform(log.platform);
      const periodKey = String(log.period || log.startDate || '').slice(0, 10);
      if (!periodKey) return { rolledBackSettlements: 0, rolledBackCalls: 0 };

      const logAppliedAt = String(log.appliedAt || log.uploadedAt || '');
      const hasNewerAppliedLog = settlementUploadLogs.getAll().some(item => (
        item.id !== log.id
        && item.kind === 'daily'
        && normalizePlatform(item.platform) === p
        && String(item.period).slice(0, 10) === periodKey
        && item.status === 'applied'
        && String(item.appliedAt || item.uploadedAt || '') > logAppliedAt
      ));
      if (hasNewerAppliedLog) {
        return { rolledBackSettlements: 0, rolledBackCalls: 0 };
      }

      if (activeStorageAdapter.ensureKeysLoaded) {
        await activeStorageAdapter.ensureKeysLoaded([KEYS.settlements, KEYS.calls], { force: true });
      }

      const appliedRecords = (
        Array.isArray(log.appliedRecords) && log.appliedRecords.length
          ? log.appliedRecords
          : log.matchedRecords
      ) || [];

      const driverIds = [...new Set(
        appliedRecords.map(row => String(row.driverId || '').trim()).filter(Boolean)
      )];

      if (!driverIds.length) {
        const hasOtherAppliedLog = settlementUploadLogs.getAll().some(item => (
          item.id !== log.id
          && item.kind === 'daily'
          && normalizePlatform(item.platform) === p
          && String(item.period).slice(0, 10) === periodKey
          && item.status === 'applied'
        ));
        if (!hasOtherAppliedLog) {
          await settlements.clearByPeriod(periodKey, p, { keepUploadLogs: true });
          return { rolledBackSettlements: -1, rolledBackCalls: -1 };
        }
        return { rolledBackSettlements: 0, rolledBackCalls: 0 };
      }

      let rolledBackSettlements = 0;
      let rolledBackCalls = 0;
      for (const driverId of driverIds) {
        const settlementId = `${driverId}-${periodKey}-${p}`;
        const matches = settlements.getAll().filter(item => item.id === settlementId);
        let removed = false;

        if (matches.length) {
          for (const item of matches) {
            const settlementAppliedAt = String(item.appliedAt || '');
            if (settlementAppliedAt && logAppliedAt && settlementAppliedAt > logAppliedAt) continue;
            await settlements.removeByIdAsync(item.id);
            rolledBackSettlements += 1;
            rolledBackCalls += 1;
            removed = true;
          }
        }

        if (!removed) {
          const settlement = settlements.getAll().find(item => item.id === settlementId);
          const settlementAppliedAt = String(settlement?.appliedAt || '');
          if (settlementAppliedAt && logAppliedAt && settlementAppliedAt > logAppliedAt) {
            continue;
          }
          await settlements.removeByIdAsync(settlementId);
          rolledBackSettlements += 1;
          rolledBackCalls += 1;
        }
      }
      return { rolledBackSettlements, rolledBackCalls };
    },

    rollbackAppliedDailyLog(log) {
      if (!log || log.kind !== 'daily' || log.status !== 'applied') {
        return { rolledBack: 0 };
      }
      settlementUploadLogs.rollbackAppliedDailyLogAsync(log);
      return { rolledBack: 0 };
    },

    async rollbackAppliedHourlyInsuranceLogAsync(log) {
      if (!log || log.kind !== 'hourly_insurance' || log.status !== 'applied') {
        return { rolledBackHourly: 0 };
      }
      const p = normalizePlatform(log.platform);
      const periodKey = String(log.period || log.startDate || '').slice(0, 10);
      if (!periodKey) return { rolledBackHourly: 0 };

      const logAppliedAt = String(log.appliedAt || log.uploadedAt || '');
      const hasNewerAppliedLog = settlementUploadLogs.getAll().some(item => (
        item.id !== log.id
        && item.kind === 'hourly_insurance'
        && normalizePlatform(item.platform) === p
        && String(item.period).slice(0, 10) === periodKey
        && item.status === 'applied'
        && String(item.appliedAt || item.uploadedAt || '') > logAppliedAt
      ));
      if (hasNewerAppliedLog) return { rolledBackHourly: 0 };

      const appliedRecords = (
        Array.isArray(log.appliedRecords) && log.appliedRecords.length
          ? log.appliedRecords
          : log.matchedRecords
      ) || [];
      const records = appliedRecords
        .filter(row => String(row.driverId || '').trim())
        .map(row => ({
          driverId: String(row.driverId || '').trim(),
          riderId: String(row.riderId || ''),
          hourlyInsurance: 0
        }));
      if (!records.length) return { rolledBackHourly: 0 };

      settlements.upsertHourlyInsuranceBatch({
        period: periodKey,
        platform: p,
        records
      });
      return { rolledBackHourly: records.length };
    },

    async removeHourlyInsuranceByWeekAsync(weekStart, platform = DEFAULT_PLATFORM, options = {}) {
      const p = normalizePlatform(platform);
      const weekKey = String(weekStart || '').slice(0, 10);
      if (!weekKey) return { removed: 0, appliedCount: 0, rolledBackHourly: 0 };

      const targets = settlementUploadLogs.getFiltered({
        kind: 'hourly_insurance',
        platform: p,
        weekStart: weekKey
      });
      if (!targets.length) return { removed: 0, appliedCount: 0, rolledBackHourly: 0 };

      const rollback = options.rollback !== false;
      let appliedCount = 0;
      let rolledBackHourly = 0;
      const deletedIds = [];

      for (const log of targets) {
        if (rollback && log.status === 'applied') {
          appliedCount += 1;
          const result = await settlementUploadLogs.rollbackAppliedHourlyInsuranceLogAsync(log);
          rolledBackHourly += Number(result.rolledBackHourly || 0);
        }
        deletedIds.push(log.id);
      }

      const nextList = settlementUploadLogs.getAll().filter(item => !deletedIds.includes(item.id));
      await settlementUploadLogs.persistList(nextList, { allowEmpty: true, deletedRowIds: deletedIds });
      await storageAdapter.flush({ skipStagedCore: true });
      window.BremDataCache?.invalidate?.(KEYS.settlements);
      window.BremDataCache?.invalidate?.(KEYS.settlementUploadLogs);
      await refetchDataKey(KEYS.settlements);
      return { removed: deletedIds.length, appliedCount, rolledBackHourly };
    },

    async removeDailyByPeriod(period, platform = DEFAULT_PLATFORM) {
      const p = normalizePlatform(platform);
      const periodKey = String(period || '').slice(0, 10);
      if (!periodKey) return settlementUploadLogs.getAll();
      const next = settlementUploadLogs.getAll().filter(item => {
        if (item.kind !== 'daily') return true;
        if (normalizePlatform(item.platform) !== p) return true;
        return String(item.period).slice(0, 10) !== periodKey;
      });
      await settlementUploadLogs.persistList(next, { allowEmpty: true });
      return next;
    },

    removeByLinkedRecordId(linkedRecordId) {
      const targetId = String(linkedRecordId || '').trim();
      if (!targetId) return;
      // 채널별로 지운 id 를 넘겨야 빈 배열 저장이 「의도된 삭제」로 통과한다.
      // 안 그러면 마지막 로그를 지울 때 데이터 보호가 막아 정산결과 삭제가 안 된다.
      ['bro', 'direct'].forEach(channel => {
        const before = settlementUploadLogs.getAll(channel);
        const deletedRowIds = before
          .filter(item => item.linkedRecordId === targetId)
          .map(item => item.id);
        if (!deletedRowIds.length) return;
        settlementUploadLogs.persistList(
          before.filter(item => item.linkedRecordId !== targetId),
          { channel, allowEmpty: true, deletedRowIds }
        );
      });
    },

    syncWeeklyFromSavedRecords(channel) {
      const ch = channel === 'direct' ? 'direct' : 'bro';
      const existingLinks = new Set(
        settlementUploadLogs.getAll(ch)
          .filter(item => item.kind === 'weekly' && item.linkedRecordId)
          .map(item => item.linkedRecordId)
      );
      weeklySettlements.getAll(ch).forEach(record => {
        if (existingLinks.has(record.id)) return;
        settlementUploadLogs.add({
          kind: 'weekly',
          channel: ch,
          platform: record.platform,
          fileName: record.fileName,
          period: record.startDate,
          weekStart: weekStartKeyFromDate(record.startDate || record.baseSettlementDate || record.uploadedAt),
          region: record.region,
          startDate: record.startDate,
          endDate: record.endDate,
          status: 'saved',
          matchedCount: Number(record.summary?.matchedRiders || record.riders?.length || 0),
          linkedRecordId: record.id,
          uploadedAt: record.uploadedAt
        });
      });
    },

    buildContentHash(platform, period, records = []) {
      return buildSettlementUploadContentHash(platform, period, records);
    },

    findAppliedDuplicate({ platform, period, contentHash, excludeLogId = '' }) {
      const p = normalizePlatform(platform);
      const periodKey = String(period || '').slice(0, 10);
      const hash = String(contentHash || '');
      if (!periodKey || !hash) return null;
      return settlementUploadLogs.getAll().find(item => (
        item.kind === 'daily'
        && item.platform === p
        && item.period === periodKey
        && item.contentHash === hash
        && item.status === 'applied'
        && item.id !== excludeLogId
      )) || null;
    },

    settlementsMatchRecords(platform, period, records = []) {
      const p = normalizePlatform(platform);
      const periodKey = String(period || '').slice(0, 10);
      const normalized = (Array.isArray(records) ? records : []).map(normalizeSettlementUploadApplyRecord);
      const existing = settlements.getAll().filter(item => (
        normalizePlatform(item.platform) === p
        && String(item.period).slice(0, 10) === periodKey
      ));
      if (!normalized.length || existing.length !== normalized.length) return false;
      const map = new Map(existing.map(item => [item.driverId, item]));
      return normalized.every(row => {
        const current = map.get(row.driverId);
        if (!current) return false;
        return Number(current.orderCount) === row.orderCount
          && Number(current.settlementAmount ?? current.deliveryAmount ?? 0) === row.settlementAmount;
      });
    },

    isDuplicateApply({ platform, period, contentHash, records = [], excludeLogId = '' }) {
      const existingLog = settlementUploadLogs.findAppliedDuplicate({
        platform,
        period,
        contentHash,
        excludeLogId
      });
      if (existingLog) {
        return { duplicate: true, reason: 'log', existingLog };
      }
      return { duplicate: false, reason: '', existingLog: null };
    }
  };

  function normalizePromotionApplyResultRow(row = {}) {
    return {
      riderName: String(row.riderName || ''),
      driverName: String(row.driverName || row.riderName || ''),
      displayName: String(row.displayName || row.driverName || row.riderName || ''),
      coupangLoginKey: String(row.coupangLoginKey || ''),
      originalName: String(row.originalName || ''),
      baeminUserId: String(row.baeminUserId || ''),
      matchedRiderId: String(row.matchedRiderId || ''),
      callCount: Number(row.callCount || 0),
      platformRate: row.platformRate === null || row.platformRate === undefined || row.platformRate === ''
        ? null
        : Number(row.platformRate),
      ruleName: String(row.ruleName || ''),
      basePromotionAmount: Number(row.basePromotionAmount || 0),
      extraPromotionAmount: Number(row.extraPromotionAmount || 0),
      totalPromotionAmount: Number(row.totalPromotionAmount || 0),
      deliveryAmountTotal: Number(row.deliveryAmountTotal || 0),
      avgDeliveryUnitPrice: Number(row.avgDeliveryUnitPrice || 0),
      guaranteedUnitPrice: Number(row.guaranteedUnitPrice || 0),
      guaranteePromotionAmount: Number(row.guaranteePromotionAmount || 0),
      appliedConditions: Array.isArray(row.appliedConditions) ? row.appliedConditions.map(String) : [],
      failedConditions: Array.isArray(row.failedConditions) ? row.failedConditions.map(String) : [],
      failureReasons: Array.isArray(row.failureReasons) ? row.failureReasons.map(String) : [],
      appliedPlatform: String(row.appliedPlatform || ''),
      assignmentSource: String(row.assignmentSource || '')
    };
  }

  function normalizePromotionApplyResult(record = {}) {
    const results = Array.isArray(record.results)
      ? record.results.map(normalizePromotionApplyResultRow)
      : [];
    const summary = record.summary || {
      riderCount: results.length,
      totalPromotionAmount: results.reduce((sum, item) => sum + item.totalPromotionAmount, 0)
    };

    return {
      id: record.id || createId(),
      platform: normalizePlatform(record.platform),
      // 브로/직계약 구분. 채널이 없는 기존 저장본은 브로에서 계산한 것이다.
      channel: record.channel === 'direct' ? 'direct' : 'bro',
      settlementId: String(record.settlementId || ''),
      settlementLabel: String(record.settlementLabel || '').trim(),
      region: String(record.region || '').trim(),
      startDate: String(record.startDate || '').slice(0, 10),
      endDate: String(record.endDate || '').slice(0, 10),
      selectedPromotionRuleIds: Array.isArray(record.selectedPromotionRuleIds)
        ? record.selectedPromotionRuleIds.map(String)
        : [],
      selectedPromotionRuleNames: Array.isArray(record.selectedPromotionRuleNames)
        ? record.selectedPromotionRuleNames.map(String)
        : [],
      deliveryFeeFileName: String(record.deliveryFeeFileName || ''),
      deliveryFeeLabel: String(record.deliveryFeeLabel || ''),
      savedAt: record.savedAt || new Date().toISOString(),
      coupangSettlementId: String(record.coupangSettlementId || ''),
      baeminSettlementId: String(record.baeminSettlementId || ''),
      results,
      summary
    };
  }

  const promotionApplyResults = {
    readRaw() {
      return storageAdapter.read(KEYS.promotionApplyResults, []);
    },

    getAll() {
      return promotionApplyResults.readRaw()
        .map(normalizePromotionApplyResult)
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },

    getById(id) {
      return promotionApplyResults.getAll().find(item => item.id === id) || null;
    },

    save(record) {
      const next = normalizePromotionApplyResult(record);
      const list = promotionApplyResults.readRaw().filter(item => item.id !== next.id);
      list.unshift(next);
      storageAdapter.write(KEYS.promotionApplyResults, list);
      window.BremDataCache?.set?.(KEYS.promotionApplyResults, list, { source: 'write' });
      return next;
    },

    remove(id) {
      const list = promotionApplyResults.readRaw().filter(item => item.id !== id);
      storageAdapter.write(KEYS.promotionApplyResults, list);
      window.BremDataCache?.set?.(KEYS.promotionApplyResults, list, { source: 'write' });
      if (activeStorageAdapter.deletePromotionApplyResultById) {
        void activeStorageAdapter.deletePromotionApplyResultById(id).catch(error => {
          console.error('[BREM] promotion apply result delete failed:', error);
        });
      }
    },

    async persist() {
      await flushActiveStorage();
    }
  };

  function normalizeManualNameMapping(record = {}) {
    return {
      id: record.id || createId(),
      platform: normalizePlatform(record.platform),
      originalName: String(record.originalName || '').trim(),
      driverId: String(record.driverId || '').trim(),
      driverName: String(record.driverName || '').trim(),
      updatedAt: record.updatedAt || new Date().toISOString()
    };
  }

  const manualNameMappings = {
    getAll() {
      return storageAdapter.read(KEYS.manualNameMappings, []).map(normalizeManualNameMapping);
    },

    save(mapping) {
      const next = normalizeManualNameMapping(mapping);
      const list = manualNameMappings.getAll().filter(item => {
        if (item.id === next.id) return false;
        return !(item.platform === next.platform && item.originalName === next.originalName);
      });
      list.unshift(next);
      storageAdapter.write(KEYS.manualNameMappings, list);
      return next;
    },

    getForOriginalName(platform, originalName) {
      const p = normalizePlatform(platform);
      const key = String(originalName || '').trim();
      return manualNameMappings.getAll().find(item => item.platform === p && item.originalName === key) || null;
    },

    removeById(id) {
      const key = String(id || '').trim();
      if (!key) return;
      const list = manualNameMappings.getAll().filter(item => item.id !== key);
      storageAdapter.write(KEYS.manualNameMappings, list, { allowEmpty: true });
    },

    // 미매칭 매칭 툴에서 지운 매핑을 원본명 기준으로 되돌린다.
    removeForOriginalName(platform, originalName) {
      const p = normalizePlatform(platform);
      const key = String(originalName || '').trim();
      if (!key) return;
      const list = manualNameMappings.getAll()
        .filter(item => !(item.platform === p && item.originalName === key));
      storageAdapter.write(KEYS.manualNameMappings, list, { allowEmpty: true });
    }
  };

  // 직계약 지급 조정(기타지급 · BREM프로모션) — 주(수~화) 단위 기사별 금액.
  // 저장 형태: { [weekStart]: { [driverId]: { amount, baeminId, driverName, source, updatedAt } } }
  const directPayAdjustments = {
    keyFor(kind) {
      return kind === 'promotion' ? KEYS.directBremPromotions : KEYS.directOtherPayments;
    },
    getBlob(kind) {
      const raw = storageAdapter.read(this.keyFor(kind), {});
      return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    },
    getWeek(kind, weekStart) {
      const wk = String(weekStart || '').slice(0, 10);
      const week = this.getBlob(kind)[wk];
      return (week && typeof week === 'object') ? week : {};
    },
    // entries: [{ driverId, amount, baeminId, driverName, source }]
    applyEntries(kind, weekStart, entries, options = {}) {
      const wk = String(weekStart || '').slice(0, 10);
      if (!wk) return {};
      const blob = this.getBlob(kind);
      const existing = options.replace
        ? {}
        : (blob[wk] && typeof blob[wk] === 'object' ? { ...blob[wk] } : {});
      const now = new Date().toISOString();
      (Array.isArray(entries) ? entries : []).forEach(entry => {
        const id = String(entry.driverId || '').trim();
        if (!id) return;
        existing[id] = {
          amount: Math.round(Number(entry.amount || 0)),
          baeminId: String(entry.baeminId || '').trim(),
          driverName: String(entry.driverName || '').trim(),
          source: entry.source === 'erp' ? 'erp' : 'excel',
          updatedAt: now
        };
      });
      blob[wk] = existing;
      storageAdapter.write(this.keyFor(kind), blob);
      return existing;
    },
    removeDriver(kind, weekStart, driverId) {
      const wk = String(weekStart || '').slice(0, 10);
      const blob = this.getBlob(kind);
      if (blob[wk]) {
        delete blob[wk][String(driverId || '').trim()];
        storageAdapter.write(this.keyFor(kind), blob, { allowEmpty: true });
      }
      return blob[wk] || {};
    },
    clearWeek(kind, weekStart) {
      const wk = String(weekStart || '').slice(0, 10);
      const blob = this.getBlob(kind);
      delete blob[wk];
      storageAdapter.write(this.keyFor(kind), blob, { allowEmpty: true });
    }
  };

  // 정산서 단위 기타지급/BREM프로모션 (직계약).
  // 주차만으로 묶으면 같은 주에 지역·플랫폼이 여러 개일 때 섞이므로 정산서 id 로 묶는다.
  // 정산서 id 에 플랫폼·지역·기간이 모두 들어 있어 쿠팡/배민 분리가 자동으로 된다.
  // 기존 주차 단위 데이터(directPayAdjustments)는 건드리지 않고 별도 키에 저장한다.
  // 소급분: 「마이너스 일괄 맞추기」로 기타지급에 얹은 그로스업 금액을 주별로 기록한다.
  // unpaidBalance = 맞추기 전 |총지급액| (차감관리 이관용). amount = 그로스업액(참고).
  const directRetroAdjustments = {
    getAll() {
      const raw = storageAdapter.read(KEYS.directRetroAdjustments, {});
      return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    },
    getWeek(weekStart) {
      const wk = String(weekStart || '').slice(0, 10);
      const all = this.getAll();
      return (all[wk] && typeof all[wk] === 'object' && !Array.isArray(all[wk])) ? all[wk] : {};
    },
    add(weekStart, entries) {
      const wk = String(weekStart || '').slice(0, 10);
      if (!wk) return {};
      const all = this.getAll();
      const wkMap = (all[wk] && typeof all[wk] === 'object' && !Array.isArray(all[wk])) ? { ...all[wk] } : {};
      const now = new Date().toISOString();
      (Array.isArray(entries) ? entries : []).forEach(e => {
        const id = String(e.driverId || '').trim();
        if (!id) return;
        const add = Math.round(Number(e.amount || 0));
        if (!add) return;
        const key = `${id}|${e.platform || ''}`;
        const prev = wkMap[key];
        const unpaidBalance = Math.max(
          0,
          Math.round(Number(e.unpaidBalance != null ? e.unpaidBalance : (prev?.unpaidBalance || 0)))
        );
        wkMap[key] = {
          driverId: id,
          name: String(e.name || prev?.name || ''),
          idLabel: String(e.idLabel || prev?.idLabel || ''),
          platform: e.platform || prev?.platform || '',
          settlementId: String(e.settlementId || prev?.settlementId || ''),
          amount: (prev ? Number(prev.amount || 0) : 0) + add,
          grossUpAmount: (prev ? Number(prev.grossUpAmount || prev.amount || 0) : 0) + add,
          unpaidBalance: unpaidBalance > 0
            ? unpaidBalance
            : Math.max(0, Math.round(Number(prev?.unpaidBalance || 0))),
          status: prev?.status === 'sent_to_deduction'
            ? prev.status
            : String(e.status || prev?.status || 'logged'),
          reason: String(e.reason != null ? e.reason : (prev?.reason || '')),
          ledgerId: String(
            prev?.status === 'sent_to_deduction'
              ? (prev.ledgerId || '')
              : (e.ledgerId != null ? e.ledgerId : (prev?.ledgerId || ''))
          ),
          updatedAt: now
        };
      });
      all[wk] = wkMap;
      storageAdapter.write(KEYS.directRetroAdjustments, all);
      return wkMap;
    },
    updateEntry(weekStart, entryKey, patch = {}) {
      const wk = String(weekStart || '').slice(0, 10);
      const key = String(entryKey || '').trim();
      if (!wk || !key) return null;
      const all = this.getAll();
      const wkMap = (all[wk] && typeof all[wk] === 'object' && !Array.isArray(all[wk])) ? { ...all[wk] } : {};
      const prev = wkMap[key];
      if (!prev) return null;
      wkMap[key] = {
        ...prev,
        ...patch,
        driverId: prev.driverId,
        platform: prev.platform,
        updatedAt: new Date().toISOString()
      };
      all[wk] = wkMap;
      storageAdapter.write(KEYS.directRetroAdjustments, all);
      return wkMap[key];
    },
    clearWeek(weekStart) {
      const wk = String(weekStart || '').slice(0, 10);
      const all = this.getAll();
      if (all[wk]) {
        delete all[wk];
        storageAdapter.write(KEYS.directRetroAdjustments, all, { allowEmpty: true });
      }
    }
  };

  /**
   * 대여 일차감 스케줄.
   * 예: 100만 / 3만 → 32일×3만 + 마지막날 4만(3만+나머지1만) = 33일, 합계 정확히 100만.
   */
  function addDaysToDateKey(startKey, days) {
    const raw = String(startKey || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
    const date = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + Math.max(0, Math.round(Number(days) || 0)));
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function computeLoanDeductSchedule({ principal, dailyDeduct, deductStartDate, amount } = {}) {
    const target = Math.max(0, Math.round(Number(
      amount != null ? amount : (principal != null ? principal : 0)
    )));
    const daily = Math.max(0, Math.round(Number(dailyDeduct || 0)));
    const start = String(deductStartDate || '').slice(0, 10);
    if (target <= 0 || daily <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      return {
        ok: false,
        principal: target,
        dailyDeduct: daily,
        deductStartDate: start,
        deductEndDate: '',
        days: 0,
        regularDays: 0,
        lastDayAmount: 0,
        total: 0
      };
    }
    const fullDays = Math.floor(target / daily);
    const rem = target % daily;
    let days;
    let lastDayAmount;
    let regularDays;
    if (rem === 0) {
      days = fullDays;
      lastDayAmount = daily;
      // 마지막날을 lastDayAmount로 쓰므로 regularDays는 fullDays-1 (아니면 total이 하루치 더해짐)
      regularDays = Math.max(0, fullDays - 1);
    } else if (fullDays === 0) {
      days = 1;
      lastDayAmount = target;
      regularDays = 0;
    } else {
      // 나머지(1만)를 마지막 일차감에 합쳐 4만으로 — 총액이 원금과 일치
      days = fullDays;
      lastDayAmount = daily + rem;
      regularDays = fullDays - 1;
    }
    const deductEndDate = addDaysToDateKey(start, days - 1);
    const total = regularDays * daily + lastDayAmount;
    return {
      ok: total === target && Boolean(deductEndDate),
      principal: target,
      dailyDeduct: daily,
      deductStartDate: start,
      deductEndDate,
      days,
      regularDays,
      lastDayAmount,
      total
    };
  }

  /**
   * 일정산 업로드 후: 해당 주(수~화) 정산일을 다시 돌며 ERP차감 대여 balance 감소.
   * 리스 일차감 → 대여 일차감(+주내 이월). period별 rawData.dailyApplied 로 중복 방지.
   */
  function applyLoanDailyDeductFromSettlementPeriod(period) {
    const periodKey = String(period || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodKey)) return { ok: false, updated: 0 };
    const weekStart = weekStartKeyFromDate(periodKey);
    const weekEnd = addDaysToDateKey(weekStart, 6);
    if (!weekStart || !weekEnd) return { ok: false, updated: 0 };

    const EMP_RATE = 0.008;
    const INDUSTRIAL_RATE = 0.0088;
    const WITHHOLDING_RATE = 0.033;
    const excluded = typeof payrollDailySettlement?.getExcludedSettlementIdSet === 'function'
      ? payrollDailySettlement.getExcludedSettlementIdSet()
      : new Set();

    const netPayRow = (row) => {
      const settlementAmount = Math.max(0, Math.round(Number(row.settlementAmount ?? row.deliveryAmount ?? 0)));
      const deductionBase = Math.max(0, Math.round(Number(row.deductionBase || 0))) || settlementAmount;
      const hourlyInsurance = Math.abs(Math.round(Number(row.hourlyInsurance || 0)));
      const orderCount = Math.max(0, Math.round(Number(row.orderCount ?? row.callCount ?? 0)));
      const fees = payrollDailySettlement.getFees(normalizePlatform(row.platform));
      const callFee = orderCount * Math.max(0, Math.round(Number(fees.callFee || 0)));
      return Math.max(0, settlementAmount
        - Math.floor(deductionBase * EMP_RATE)
        - Math.floor(deductionBase * INDUSTRIAL_RATE)
        - Math.floor(deductionBase * WITHHOLDING_RATE)
        - callFee
        - hourlyInsurance);
    };

    // driverId → [{ date, left }]
    const poolsByDriver = new Map();
    const touchedDrivers = new Set();
    settlements.getAll().forEach(row => {
      const date = String(row.period || '').slice(0, 10);
      if (!date || date < weekStart || date > weekEnd) return;
      const driverId = String(row.driverId || '').trim();
      if (!driverId) return;
      const platform = normalizePlatform(row.platform);
      const id = String(row.id || `${driverId}-${date}-${platform}`);
      if (excluded.has(id)) return;
      if (date === periodKey) touchedDrivers.add(driverId);
      if (!poolsByDriver.has(driverId)) poolsByDriver.set(driverId, new Map());
      const byDate = poolsByDriver.get(driverId);
      byDate.set(date, (byDate.get(date) || 0) + netPayRow(row));
    });
    if (!touchedDrivers.size) return { ok: true, updated: 0 };

    const driverMap = new Map(drivers.getAll().map(d => [String(d.id || ''), d]));
    let contracts = [];
    try {
      contracts = window.BremLeaseErp?.contracts?.()?.getAll?.() || [];
    } catch (_e) {
      contracts = [];
    }

    const matchDriver = (item, driverId, driver) => {
      if (item?.driverId && String(item.driverId) === String(driverId)) return true;
      const name = String(item?.driverName || item?.rawData?.driverName || '').replace(/\s+/g, '').toLowerCase();
      const phone = String(item?.driverPhone || item?.rawData?.driverPhone || '').replace(/[^0-9]/g, '');
      const dName = String(driver?.name || '').replace(/\s+/g, '').toLowerCase();
      const dPhone = String(driver?.phone || '').replace(/[^0-9]/g, '');
      return Boolean(name && dName && name === dName && phone && dPhone && phone === dPhone);
    };

    const toPool = (byDate) => [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, netPay]) => ({ date, left: Math.max(0, Math.round(netPay || 0)) }));

    let updated = 0;
    touchedDrivers.forEach(driverId => {
      const driver = driverMap.get(driverId);
      const pool = toPool(poolsByDriver.get(driverId) || new Map());
      if (!pool.length) return;

      const contract = contracts.find(c => {
        const raw = c.rawData || {};
        const enabled = c.finalApplyEnabled != null ? c.finalApplyEnabled : raw.finalApplyEnabled;
        if (!enabled) return false;
        return matchDriver({
          driverId: c.driverId || raw.driverId,
          driverName: c.driverName || raw.driverName,
          driverPhone: c.driverPhone || raw.driverPhone
        }, driverId, driver);
      });
      if (contract) {
        const raw = contract.rawData || {};
        // 계약/렌탈 일렌탈료 (차량 리스비 원가 사용 금지)
        const dailyRent = Math.max(0, Math.round(Number(
          contract.dailyCharge || contract.daily_charge || contract.dailyRent || raw.dailyRent || 0
        )));
        const cStart = String(contract.startDate || raw.startDate || '').slice(0, 10);
        const deductStart = String(raw.deductStartDate || '').slice(0, 10);
        const effectiveStart = [cStart, deductStart].filter(Boolean).sort().pop() || '';
        const cEnd = String(contract.returnDate || contract.endDate || raw.returnDate || raw.endDate || '').slice(0, 10);
        let leaseCarry = 0;
        pool.forEach(slot => {
          const active = (!effectiveStart || slot.date >= effectiveStart) && (!cEnd || slot.date <= cEnd);
          if (!active || dailyRent <= 0) return;
          const due = dailyRent + leaseCarry;
          const applied = Math.min(due, slot.left);
          slot.left -= applied;
          leaseCarry = due - applied;
        });
      }

      leaseLoans.getAll().forEach(loan => {
        if (!loan?.finalApplyEnabled) return;
        if (String(loan.status || '') === 'paid' || String(loan.status || '') === 'deleted') return;
        if (!matchDriver(loan, driverId, driver)) return;
        const appliedMap = { ...(loan.rawData?.dailyApplied || {}) };
        let balance = Math.max(0, Math.round(Number(loan.balance != null ? loan.balance : loan.principal || 0)));
        // 이미 기록된 적용분은 잔액에 다시 더해 주 전체 재계산 (idempotent)
        Object.keys(appliedMap).forEach(date => {
          if (date < weekStart || date > weekEnd) return;
          balance += Math.max(0, Math.round(Number(appliedMap[date]) || 0));
          delete appliedMap[date];
        });
        if (balance <= 0) return;
        const daily = Math.max(0, Math.round(Number(loan.dailyDeduct || 0)));
        const start = String(loan.deductStartDate || '').slice(0, 10);
        const end = String(loan.deductEndDate || '').slice(0, 10);
        const last = Math.max(0, Math.round(Number(loan.lastDayAmount || 0))) || daily;
        let carry = 0;
        let changed = false;
        let nextBalance = balance;
        // 기사별 풀 복사본 (대출 여러 건이면 순차 소비)
        const loanPool = pool.map(slot => ({ date: slot.date, left: slot.left }));
        loanPool.forEach(slot => {
          if (nextBalance <= 0) return;
          if (start && slot.date < start) return;
          if (end && slot.date > end) return;
          const dayFee = (end && slot.date === end) ? last : daily;
          if (dayFee <= 0 && carry <= 0) return;
          const due = Math.min(nextBalance, dayFee + carry);
          const applied = Math.min(due, slot.left);
          slot.left -= applied;
          carry = due - applied;
          if (applied > 0) {
            appliedMap[slot.date] = applied;
            nextBalance = Math.max(0, nextBalance - applied);
            changed = true;
          }
          // 풀 원본에도 반영 (다음 대출 건)
          const origin = pool.find(p => p.date === slot.date);
          if (origin) origin.left = slot.left;
        });
        if (!changed) return;
        leaseLoans.save({
          ...loan,
          balance: nextBalance,
          status: nextBalance <= 0 ? 'paid' : (loan.status || 'active'),
          paidAt: nextBalance <= 0 ? (loan.paidAt || periodKey) : loan.paidAt,
          finalApplyEnabled: nextBalance <= 0 ? false : loan.finalApplyEnabled,
          rawData: {
            ...(loan.rawData || {}),
            dailyApplied: appliedMap
          }
        });
        updated += 1;
      });
    });
    return { ok: true, updated };
  }

  /** 구간 내 대여 스케줄 차감액(잔액 한도). 마지막날은 lastDayAmount. */
  function loanChargeInDateRange(item, rangeStart, rangeEnd, todayKey) {
    if (!item) return 0;
    const balance = Math.max(0, Math.round(Number(item.balance != null ? item.balance : item.principal || 0)));
    if (balance <= 0) return 0;
    const daily = Math.max(0, Math.round(Number(item.dailyDeduct || 0)));
    if (daily <= 0) return 0;
    const start = String(item.deductStartDate || item.weekStart || '').slice(0, 10);
    let end = String(item.deductEndDate || '').slice(0, 10);
    let lastDayAmount = Math.max(0, Math.round(Number(item.lastDayAmount || 0)));
    if (!end || lastDayAmount <= 0) {
      const sched = computeLoanDeductSchedule({
        amount: Math.max(0, Math.round(Number(
          (Number(item.principal || 0) + Number(item.interest || 0)) || balance
        ))),
        dailyDeduct: daily,
        deductStartDate: start
      });
      if (!sched.ok) {
        // 스케줄 불가 시 기존 방식(일×일수, 잔액 한도)
        const from = [String(rangeStart || '').slice(0, 10), start].filter(Boolean).sort().pop() || '';
        const toCandidates = [String(rangeEnd || '').slice(0, 10), String(todayKey || '').slice(0, 10)].filter(Boolean).sort();
        const to = toCandidates[0] || '';
        if (!from || !to || from > to) return 0;
        let days = 0;
        for (let cur = from; cur <= to; cur = addDaysToDateKey(cur, 1)) days += 1;
        return Math.min(balance, daily * days);
      }
      end = sched.deductEndDate;
      lastDayAmount = sched.lastDayAmount;
    }
    const from = [String(rangeStart || '').slice(0, 10), start].filter(Boolean).sort().pop() || '';
    const toCandidates = [
      String(rangeEnd || '').slice(0, 10),
      String(todayKey || '').slice(0, 10),
      end
    ].filter(Boolean).sort();
    const to = toCandidates[0] || '';
    if (!from || !to || from > to) return 0;
    let sum = 0;
    for (let cur = from; cur <= to; cur = addDaysToDateKey(cur, 1)) {
      if (cur < start || cur > end) continue;
      sum += (cur === end) ? lastDayAmount : daily;
      if (sum >= balance) return balance;
    }
    return Math.min(balance, sum);
  }

  function normalizeLeaseLoan(raw = {}, existing = null) {
    const principal = Math.max(0, Math.round(Number(raw.principal != null ? raw.principal : existing?.principal || 0)));
    const interest = Math.max(0, Math.round(Number(raw.interest != null ? raw.interest : existing?.interest || 0)));
    const totalAmount = principal + interest;
    const dailyDeduct = Math.max(0, Math.round(Number(raw.dailyDeduct != null ? raw.dailyDeduct : existing?.dailyDeduct || 0)));
    const balance = Math.max(0, Math.round(Number(
      raw.balance != null ? raw.balance : (existing?.balance != null ? existing.balance : totalAmount)
    )));
    const platform = String(raw.deductionPlatform || existing?.deductionPlatform || 'coupang') === 'baemin'
      ? 'baemin'
      : 'coupang';
    const deductStartDate = String(
      raw.deductStartDate != null ? raw.deductStartDate : (existing?.deductStartDate || '')
    ).slice(0, 10);
    const schedule = computeLoanDeductSchedule({
      amount: totalAmount,
      dailyDeduct,
      deductStartDate
    });
    const deductEndDate = String(
      raw.deductEndDate != null ? raw.deductEndDate : (existing?.deductEndDate || schedule.deductEndDate || '')
    ).slice(0, 10) || schedule.deductEndDate || '';
    const lastDayAmount = Math.max(0, Math.round(Number(
      raw.lastDayAmount != null ? raw.lastDayAmount : (existing?.lastDayAmount != null ? existing.lastDayAmount : schedule.lastDayAmount || 0)
    ))) || schedule.lastDayAmount || 0;
    const externalPaid = Math.max(0, Math.round(Number(
      raw.externalPaid != null ? raw.externalPaid : (existing?.externalPaid || 0)
    )));
    const status = String(raw.status != null ? raw.status : (existing?.status || 'active')).trim() || 'active';
    const paidAtRaw = raw.paidAt != null ? raw.paidAt : (existing?.paidAt || '');
    const paidAt = String(paidAtRaw || '').slice(0, 10);
    const enabled = raw.finalApplyEnabled != null
      ? Boolean(raw.finalApplyEnabled)
      : Boolean(existing?.finalApplyEnabled);
    return {
      id: String(raw.id || existing?.id || createId()),
      driverId: String(raw.driverId != null ? raw.driverId : (existing?.driverId || '')).trim(),
      driverName: String(raw.driverName != null ? raw.driverName : (existing?.driverName || '')).trim(),
      driverPhone: String(raw.driverPhone != null ? raw.driverPhone : (existing?.driverPhone || '')).trim(),
      principal,
      interest,
      totalAmount,
      dailyDeduct,
      balance,
      deductionPlatform: platform,
      deductStartDate,
      deductEndDate,
      lastDayAmount,
      externalPaid,
      reason: String(raw.reason != null ? raw.reason : (existing?.reason || '')).trim(),
      status,
      paidAt: (status === 'paid' && balance <= 0)
        ? (paidAt || new Date().toISOString().slice(0, 10))
        : (status === 'paid' ? paidAt : ''),
      finalApplyEnabled: enabled,
      finalAppliedAt: enabled
        ? String(raw.finalAppliedAt || existing?.finalAppliedAt || new Date().toISOString())
        : String(raw.finalAppliedAt != null ? raw.finalAppliedAt : (existing?.finalAppliedAt || '')),
      createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rawData: { ...(existing?.rawData || {}), ...(raw.rawData || {}) }
    };
  }

  function normalizeDeductionLedgerItem(raw = {}, existing = null) {
    const kindRaw = String(raw.kind || existing?.kind || 'unpaid').trim() || 'unpaid';
    const kind = ['unpaid', 'manual', 'loan'].includes(kindRaw) ? kindRaw : 'unpaid';
    const platform = String(raw.deductionPlatform || existing?.deductionPlatform || 'coupang') === 'baemin'
      ? 'baemin'
      : 'coupang';
    const dailyDeduct = Math.max(0, Math.round(Number(raw.dailyDeduct != null ? raw.dailyDeduct : existing?.dailyDeduct || 0)));
    const balance = Math.max(0, Math.round(Number(raw.balance != null ? raw.balance : existing?.balance || 0)));
    const enabled = raw.finalApplyEnabled != null
      ? Boolean(raw.finalApplyEnabled)
      : Boolean(existing?.finalApplyEnabled);
    const deductStartDate = String(
      raw.deductStartDate != null ? raw.deductStartDate : (existing?.deductStartDate || '')
    ).slice(0, 10);
    const deductEndDate = String(
      raw.deductEndDate != null ? raw.deductEndDate : (existing?.deductEndDate || '')
    ).slice(0, 10);
    const lastDayAmount = Math.max(0, Math.round(Number(
      raw.lastDayAmount != null ? raw.lastDayAmount : (existing?.lastDayAmount || 0)
    )));
    return {
      id: String(raw.id || existing?.id || createId()),
      kind,
      sourceRef: String(raw.sourceRef != null ? raw.sourceRef : (existing?.sourceRef || '')).trim(),
      driverId: String(raw.driverId != null ? raw.driverId : (existing?.driverId || '')).trim(),
      driverName: String(raw.driverName != null ? raw.driverName : (existing?.driverName || '')).trim(),
      driverPhone: String(raw.driverPhone != null ? raw.driverPhone : (existing?.driverPhone || '')).trim(),
      dailyDeduct,
      balance,
      reason: String(raw.reason != null ? raw.reason : (existing?.reason || '')).trim(),
      deductionPlatform: platform,
      deductStartDate,
      deductEndDate,
      lastDayAmount,
      finalApplyEnabled: enabled,
      finalAppliedAt: enabled
        ? String(raw.finalAppliedAt || existing?.finalAppliedAt || new Date().toISOString())
        : String(raw.finalAppliedAt != null ? raw.finalAppliedAt : (existing?.finalAppliedAt || '')),
      weekStart: String(raw.weekStart != null ? raw.weekStart : (existing?.weekStart || '')).slice(0, 10),
      status: String(raw.status != null ? raw.status : (existing?.status || 'active')).trim() || 'active',
      createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rawData: { ...(existing?.rawData || {}), ...(raw.rawData || {}) }
    };
  }

  const leaseLoans = {
    getAll() {
      const raw = storageAdapter.read(KEYS.leaseLoans, []);
      return (Array.isArray(raw) ? raw : []).map(item => normalizeLeaseLoan(item));
    },
    getById(id) {
      const target = String(id || '').trim();
      return this.getAll().find(item => item.id === target) || null;
    },
    save(raw) {
      const list = this.getAll();
      const existing = raw?.id ? list.find(item => item.id === raw.id) : null;
      const schedule = computeLoanDeductSchedule({
        principal: raw?.principal != null ? raw.principal : existing?.principal,
        amount: Math.max(0, Math.round(Number(
          (raw?.principal != null ? raw.principal : existing?.principal || 0)
        ))) + Math.max(0, Math.round(Number(
          raw?.interest != null ? raw.interest : (existing?.interest || 0)
        ))),
        dailyDeduct: raw?.dailyDeduct != null ? raw.dailyDeduct : existing?.dailyDeduct,
        deductStartDate: raw?.deductStartDate != null ? raw.deductStartDate : existing?.deductStartDate
      });
      const next = normalizeLeaseLoan({
        ...raw,
        deductEndDate: schedule.ok ? schedule.deductEndDate : (raw?.deductEndDate || existing?.deductEndDate || ''),
        lastDayAmount: schedule.ok ? schedule.lastDayAmount : (raw?.lastDayAmount || existing?.lastDayAmount || 0)
      }, existing);
      const out = existing
        ? list.map(item => (item.id === next.id ? next : item))
        : [...list, next];
      storageAdapter.write(KEYS.leaseLoans, out);
      return next;
    },
    remove(id) {
      const target = String(id || '').trim();
      const next = this.getAll().filter(item => item.id !== target);
      storageAdapter.write(KEYS.leaseLoans, next, { allowEmpty: true });
    }
  };

  const deductionLedger = {
    getAll() {
      const raw = storageAdapter.read(KEYS.deductionLedger, []);
      return (Array.isArray(raw) ? raw : []).map(item => normalizeDeductionLedgerItem(item));
    },
    getById(id) {
      const target = String(id || '').trim();
      return this.getAll().find(item => item.id === target) || null;
    },
    findBySource(kind, sourceRef) {
      const k = String(kind || '').trim();
      const ref = String(sourceRef || '').trim();
      return this.getAll().find(item => item.kind === k && item.sourceRef === ref) || null;
    },
    save(raw) {
      const list = this.getAll();
      const existing = raw?.id ? list.find(item => item.id === raw.id) : null;
      const balance = Math.max(0, Math.round(Number(
        raw?.balance != null ? raw.balance : (existing?.balance || 0)
      )));
      const dailyDeduct = Math.max(0, Math.round(Number(
        raw?.dailyDeduct != null ? raw.dailyDeduct : (existing?.dailyDeduct || 0)
      )));
      const deductStartDate = String(
        raw?.deductStartDate != null ? raw.deductStartDate : (existing?.deductStartDate || '')
      ).slice(0, 10);
      const schedule = computeLoanDeductSchedule({
        amount: balance,
        principal: balance,
        dailyDeduct,
        deductStartDate
      });
      const next = normalizeDeductionLedgerItem({
        ...raw,
        deductEndDate: schedule.ok
          ? schedule.deductEndDate
          : (raw?.deductEndDate || existing?.deductEndDate || ''),
        lastDayAmount: schedule.ok
          ? schedule.lastDayAmount
          : (raw?.lastDayAmount || existing?.lastDayAmount || 0)
      }, existing);
      const out = existing
        ? list.map(item => (item.id === next.id ? next : item))
        : [...list, next];
      storageAdapter.write(KEYS.deductionLedger, out);
      return next;
    },
    remove(id) {
      const target = String(id || '').trim();
      const next = this.getAll().filter(item => item.id !== target);
      storageAdapter.write(KEYS.deductionLedger, next, { allowEmpty: true });
    }
  };

  const directSettlementAdjustments = {
    normalizeKind(kind) {
      const raw = String(kind || '').trim();
      if (raw === 'promotion') return 'promotion';
      if (raw === 'leaseFee') return 'leaseFee';
      if (raw === 'loanFee') return 'loanFee';
      return 'other';
    },
    normalizeSource(source) {
      if (source === 'erp') return 'erp';
      if (source === 'manual') return 'manual';
      return 'excel';
    },
    getBlob() {
      const raw = storageAdapter.read(KEYS.directSettlementAdjustments, {});
      return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    },
    getKind(kind) {
      const k = this.normalizeKind(kind);
      const blob = this.getBlob();
      const value = blob[k];
      return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
    },
    getSettlement(kind, settlementId) {
      const id = String(settlementId || '').trim();
      if (!id) return {};
      const entry = this.getKind(kind)[id];
      return (entry && typeof entry === 'object') ? entry : {};
    },
    // entries: [{ driverId, amount, baeminId, driverName, source }]
    applyEntries(kind, settlementId, entries, options = {}) {
      const k = this.normalizeKind(kind);
      const id = String(settlementId || '').trim();
      if (!id) return {};
      const blob = this.getBlob();
      const byKind = (blob[k] && typeof blob[k] === 'object') ? { ...blob[k] } : {};
      const existing = options.replace
        ? {}
        : (byKind[id] && typeof byKind[id] === 'object' ? { ...byKind[id] } : {});
      const now = new Date().toISOString();
      (Array.isArray(entries) ? entries : []).forEach(entry => {
        const driverId = String(entry.driverId || '').trim();
        if (!driverId) return;
        existing[driverId] = {
          amount: Math.round(Number(entry.amount || 0)),
          baeminId: String(entry.baeminId || '').trim(),
          coupangId: String(entry.coupangId || '').trim(),
          driverName: String(entry.driverName || '').trim(),
          source: this.normalizeSource(entry.source),
          updatedAt: now
        };
      });
      byKind[id] = existing;
      blob[k] = byKind;
      storageAdapter.write(KEYS.directSettlementAdjustments, blob);
      return existing;
    },
    removeDriver(kind, settlementId, driverId) {
      const k = this.normalizeKind(kind);
      const id = String(settlementId || '').trim();
      const blob = this.getBlob();
      if (blob[k] && blob[k][id]) {
        delete blob[k][id][String(driverId || '').trim()];
        storageAdapter.write(KEYS.directSettlementAdjustments, blob, { allowEmpty: true });
      }
      return (blob[k] && blob[k][id]) || {};
    },
    clearSettlement(kind, settlementId) {
      const k = this.normalizeKind(kind);
      const id = String(settlementId || '').trim();
      const blob = this.getBlob();
      if (blob[k]) {
        delete blob[k][id];
        storageAdapter.write(KEYS.directSettlementAdjustments, blob, { allowEmpty: true });
      }
    },
    summary(settlementId) {
      const promo = this.getSettlement('promotion', settlementId);
      const other = this.getSettlement('other', settlementId);
      const lease = this.getSettlement('leaseFee', settlementId);
      const loan = this.getSettlement('loanFee', settlementId);
      const sum = map => Object.values(map).reduce((acc, item) => acc + Number(item?.amount || 0), 0);
      return {
        promotionCount: Object.keys(promo).length,
        promotionTotal: sum(promo),
        otherCount: Object.keys(other).length,
        otherTotal: sum(other),
        leaseFeeCount: Object.keys(lease).length,
        leaseFeeTotal: sum(lease),
        loanFeeCount: Object.keys(loan).length,
        loanFeeTotal: sum(loan)
      };
    }
  };

  const settlementUnmatched = {
    getAll(channel) {
      const key = settlementUnmatchedKey(channel === 'direct' ? 'direct' : 'bro');
      return normalizeSettlementUnmatched(storageAdapter.read(key, []));
    },

    getByWeek({ weekStart, platform, kind, channel }) {
      const weekKey = String(weekStart || '').slice(0, 10);
      const p = platform ? normalizePlatform(platform) : '';
      const kindFilter = kind === 'weekly' || kind === 'daily' ? kind : '';
      // 직계약은 별도 저장 키 → 채널 키만 읽으면 됨.
      return settlementUnmatched.getAll(channel === 'direct' ? 'direct' : 'bro').filter((item) => {
        if (item.weekStart !== weekKey) return false;
        if (p && normalizePlatform(item.platform) !== p) return false;
        if (kindFilter && item.kind !== kindFilter) return false;
        return true;
      });
    },

    saveBatch({ period, records, sourceFileName, platform = DEFAULT_PLATFORM }) {
      if (!period || !Array.isArray(records) || !records.length) return settlementUnmatched.getAll();

      const p = normalizePlatform(platform);
      const periodKey = String(period).slice(0, 10);
      const weekStart = weekStartKeyFromDate(periodKey);
      const savedAt = new Date().toISOString();
      const nextRecords = records.map(record => {
        const rawName = String(record.rawName || record.name || '').trim();
        const name = String(record.name || rawName).trim();
      const nameKey = rawName.replace(/\s/g, '');
      const riderId = String(record.riderId || '').trim();
      const baeminUserId = p === 'baemin' && riderId
        ? (typeof BremWeeklySettlement !== 'undefined'
          ? BremWeeklySettlement.normalizeBaeminUserId(riderId)
          : riderId)
        : '';
      const coupangLoginKey = p === 'coupang' ? nameKey : '';
      const recordIdKey = baeminUserId || coupangLoginKey || nameKey || 'unknown';
      return {
          id: `${periodKey}-${p}-${recordIdKey}`,
          kind: 'daily',
          weekStart,
          period: periodKey,
          endDate: '',
          platform: p,
          riderId,
          baeminUserId,
          coupangLoginKey,
          rawName,
          name,
          orderCount: Number(record.orderCount || 0),
          hourlyInsurance: Math.abs(Number(record.hourlyInsurance || 0)),
          deductionBase: Math.abs(Number(record.deductionBase || 0)),
          settlementAmount: Number(record.settlementAmount ?? record.deliveryAmount ?? 0),
          deliveryAmount: Number(record.deliveryAmount ?? record.settlementAmount ?? 0),
          matchPayload: {
            rawName,
            name,
            riderId: String(record.riderId || '').trim(),
            orderCount: Number(record.orderCount || 0),
            hourlyInsurance: Math.abs(Number(record.hourlyInsurance || 0)),
            // 나중에 매칭 재시도할 때 AC(공제기준금액)가 살아있어야 원천세가 맞게 계산된다.
            deductionBase: Math.abs(Number(record.deductionBase || 0)),
            deliveryAmount: Number(record.deliveryAmount ?? record.settlementAmount ?? 0),
            settlementAmount: Number(record.settlementAmount ?? record.deliveryAmount ?? 0)
          },
          sourceFileName: sourceFileName || '',
          savedAt
        };
      });

      const current = settlementUnmatched.getAll();
      const list = current.filter(item => !(
        item.kind === 'daily'
        && item.period === periodKey
        && normalizePlatform(item.platform) === p
      ));
      list.unshift(...nextRecords);
      // 재업로드로 밀려난 옛 미매칭 행도 함께 지운다. (upsert 만 하면 DB 에 남는다)
      storageAdapter.write(KEYS.settlementUnmatched, list, {
        incrementalRows: nextRecords,
        deletedRowIds: removedUnmatchedIds(current, list)
      });
      return list;
    },

    saveWeeklyBatch({ weekStart, startDate, endDate, records, sourceFileName, platform = DEFAULT_PLATFORM, region = '', channel = 'bro' }) {
      const weekKey = String(weekStart || weekStartKeyFromDate(startDate)).slice(0, 10);
      const startKey = String(startDate || weekKey).slice(0, 10);
      const endKey = String(endDate || weekEndKeyFromDate(weekKey)).slice(0, 10);
      const p = normalizePlatform(platform);
      const ch = channel === 'direct' ? 'direct' : 'bro';
      const channelTag = ch === 'direct' ? '-direct' : '';
      if (!weekKey || !Array.isArray(records) || !records.length) {
        return settlementUnmatched.getAll();
      }

      const savedAt = new Date().toISOString();
      const regionKey = String(region || '').trim();
      const nextRecords = records.map(record => {
        const rawName = String(record.originalName || record.rawName || record.riderName || record.name || '').trim();
        const name = String(record.riderName || record.name || rawName).trim();
        const coupangLoginKey = String(record.coupangLoginKey || '').trim();
        const baeminUserId = String(record.baeminUserId || '').trim();
        const idKey = coupangLoginKey || baeminUserId || rawName.replace(/\s/g, '');
        return {
          id: `${weekKey}-weekly-${p}${channelTag}-${idKey}`,
          kind: 'weekly',
          channel: ch,
          weekStart: weekKey,
          period: startKey,
          endDate: endKey,
          platform: p,
          region: String(region || '').trim(),
          rawName,
          name,
          orderCount: Number(record.weeklyOrderCount ?? record.orderCount ?? 0),
          settlementAmount: 0,
          deliveryAmount: 0,
          riderId: '',
          coupangLoginKey,
          baeminUserId,
          matchPayload: {
            originalName: rawName,
            riderName: name,
            coupangLoginKey,
            baeminUserId,
            weeklyOrderCount: Number(record.weeklyOrderCount ?? record.orderCount ?? 0),
            channel: ch
          },
          sourceFileName: sourceFileName || '',
          savedAt
        };
      });

      const incomingIds = new Set(nextRecords.map(record => record.id));
      const current = settlementUnmatched.getAll(ch);
      const list = current.filter(item => {
        if (item.kind !== 'weekly') return true;
        if (normalizePlatform(item.platform) !== p) return true;
        if (item.weekStart !== weekKey) return true;
        if (regionKey && item.region === regionKey) return false;
        if (incomingIds.has(item.id)) return false;
        return true;
      });
      list.unshift(...nextRecords);
      // 재업로드로 밀려난 옛 미매칭 행도 함께 지운다. (upsert 만 하면 DB 에 남는다)
      storageAdapter.write(settlementUnmatchedKey(ch), list, {
        incrementalRows: nextRecords,
        deletedRowIds: removedUnmatchedIds(current, list)
      });
      return list;
    },

    removeById(id) {
      const inDirect = settlementUnmatched.getAll('direct').some(item => item.id === id);
      const ch = inDirect ? 'direct' : 'bro';
      storageAdapter.write(
        settlementUnmatchedKey(ch),
        settlementUnmatched.getAll(ch).filter(item => item.id !== id)
      );
    },

    clearByPeriod(period, platform = DEFAULT_PLATFORM) {
      const p = normalizePlatform(platform);
      const periodKey = String(period).slice(0, 10);
      const current = settlementUnmatched.getAll();
      const next = current.filter(item => {
        const itemPeriod = String(item.period).slice(0, 10);
        return !(itemPeriod === periodKey && normalizePlatform(item.platform) === p && item.kind === 'daily');
      });
      storageAdapter.write(KEYS.settlementUnmatched, next, {
        allowEmpty: true,
        deletedRowIds: removedUnmatchedIds(current, next)
      });
    },

    clearByWeek({ weekStart, platform, kind }) {
      const weekKey = String(weekStart || '').slice(0, 10);
      const p = platform ? normalizePlatform(platform) : '';
      const kindFilter = kind === 'weekly' || kind === 'daily' ? kind : '';
      if (!weekKey) return;
      const current = settlementUnmatched.getAll();
      const next = current.filter(item => {
        if (item.weekStart !== weekKey) return true;
        if (p && normalizePlatform(item.platform) !== p) return true;
        if (kindFilter && item.kind !== kindFilter) return true;
        return false;
      });
      storageAdapter.write(KEYS.settlementUnmatched, next, {
        allowEmpty: true,
        deletedRowIds: removedUnmatchedIds(current, next)
      });
    },

    clearByPlatform(platform) {
      const p = normalizePlatform(platform);
      const current = settlementUnmatched.getAll();
      const next = current.filter(item => normalizePlatform(item.platform) !== p);
      storageAdapter.write(KEYS.settlementUnmatched, next, {
        allowEmpty: true,
        deletedRowIds: removedUnmatchedIds(current, next)
      });
    },

    clearAll() {
      const current = settlementUnmatched.getAll();
      storageAdapter.write(KEYS.settlementUnmatched, [], {
        allowEmpty: true,
        deletedRowIds: removedUnmatchedIds(current, [])
      });
    },

    retryDailyMatching({ platform, weekStart, period = '', recordIds = [] } = {}) {
      const p = normalizePlatform(platform);
      const weekKey = String(weekStart || '').slice(0, 10);
      const periodKey = String(period || '').slice(0, 10);
      const idFilter = new Set((Array.isArray(recordIds) ? recordIds : []).map(String).filter(Boolean));
      if (!weekKey || typeof BremSettlementParser === 'undefined') {
        return { matchedCount: 0, stillUnmatchedCount: 0, applied: 0 };
      }
      const format = typeof SettlementFormats !== 'undefined'
        ? SettlementFormats.getFormatForPlatform(p)
        : null;
      const drivers = BremStorage.drivers.getAll();
      const weekPending = settlementUnmatched.getByWeek({ weekStart: weekKey, platform: p, kind: 'daily' });
      let pending = weekPending;
      if (periodKey) {
        pending = pending.filter(item => String(item.period || '').slice(0, 10) === periodKey);
      }
      if (idFilter.size) {
        pending = pending.filter(item => idFilter.has(String(item.id)));
      }
      const untouched = weekPending.filter(item => !pending.some(row => row.id === item.id));
      if (!pending.length) {
        return { matchedCount: 0, stillUnmatchedCount: untouched.length, applied: 0 };
      }

      const byPeriod = new Map();
      const stillUnmatched = [];
      let matchedCount = 0;

      pending.forEach(item => {
        const row = {
          ...(item.matchPayload || item),
          rawName: item.rawName,
          name: item.name,
          riderId: item.riderId || '',
          orderCount: item.orderCount,
          deliveryAmount: item.deliveryAmount,
          settlementAmount: item.settlementAmount
        };
        const { matched } = BremSettlementParser.matchDrivers([row], drivers, format);
        const hit = matched[0];
        if (hit?.driverId) {
          matchedCount += 1;
          const periodKey = String(item.period || '').slice(0, 10);
          if (!byPeriod.has(periodKey)) byPeriod.set(periodKey, []);
          byPeriod.get(periodKey).push({
            driverId: hit.driverId,
            riderId: hit.riderId || '',
            orderCount: Number(hit.orderCount || 0),
            // 시간제보험·공제기준금액을 안 넘기면 재매칭된 건만 공제가 0이 되어
            // 실지급액이 부풀고 초과출금으로 이어진다.
            hourlyInsurance: Math.abs(Number(hit.hourlyInsurance ?? item.hourlyInsurance ?? 0)),
            deductionBase: Math.abs(Number(hit.deductionBase ?? item.deductionBase ?? 0)),
            deliveryAmount: Number(hit.deliveryAmount ?? hit.settlementAmount ?? 0),
            settlementAmount: Number(hit.settlementAmount ?? hit.deliveryAmount ?? 0)
          });
        } else {
          stillUnmatched.push(item);
        }
      });

      let applied = 0;
      byPeriod.forEach((records, periodKey) => {
        settlements.upsertBatch({ period: periodKey, platform: p, records });
        applied += records.length;
      });

      const current = settlementUnmatched.getAll();
      const other = current.filter(item => !(
        item.kind === 'daily'
        && item.weekStart === weekKey
        && normalizePlatform(item.platform) === p
      ));
      const next = other.concat(untouched).concat(stillUnmatched);
      storageAdapter.write(KEYS.settlementUnmatched, next, {
        allowEmpty: true,
        deletedRowIds: removedUnmatchedIds(current, next)
      });
      return {
        matchedCount,
        stillUnmatchedCount: stillUnmatched.length,
        applied
      };
    },

    retryWeeklyMatching({ platform, weekStart, recordIds = [], channel = 'bro' } = {}) {
      const p = normalizePlatform(platform);
      const weekKey = String(weekStart || '').slice(0, 10);
      const ch = channel === 'direct' ? 'direct' : 'bro';
      const channelTag = ch === 'direct' ? '-direct' : '';
      const idFilter = new Set((Array.isArray(recordIds) ? recordIds : []).map(String).filter(Boolean));
      if (!weekKey || typeof BremWeeklySettlement === 'undefined') {
        return { matchedCount: 0, stillUnmatchedCount: 0, mergedToSaved: 0, needsManualSave: false };
      }
      const weekPending = settlementUnmatched.getByWeek({ weekStart: weekKey, platform: p, kind: 'weekly', channel: ch });
      let pending = weekPending;
      if (idFilter.size) {
        pending = pending.filter(item => idFilter.has(String(item.id)));
      }
      const untouched = weekPending.filter(item => !pending.some(row => row.id === item.id));
      if (!pending.length) {
        return {
          matchedCount: 0,
          stillUnmatchedCount: untouched.length,
          mergedToSaved: 0,
          needsManualSave: false
        };
      }

      const startDate = pending[0].period;
      const endDate = pending[0].endDate || weekEndKeyFromDate(weekKey);
      const riders = pending.map(item => ({
        ...(item.matchPayload || {}),
        originalName: item.rawName || item.name,
        riderName: item.name || item.rawName,
        coupangLoginKey: item.coupangLoginKey || item.matchPayload?.coupangLoginKey || '',
        baeminUserId: item.baeminUserId || item.matchPayload?.baeminUserId || '',
        weeklyOrderCount: Number(item.orderCount ?? item.matchPayload?.weeklyOrderCount ?? 0),
        _unmatchedId: item.id
      }));
      const rematched = BremWeeklySettlement.matchSettlementRidersWithExistingData(riders, p, { startDate, endDate });
      const newlyMatched = rematched.filter(item => item.matched);
      const stillUnmatchedRaw = rematched.filter(item => !item.matched);

      let mergedToSaved = 0;
      if (newlyMatched.length) {
        const saved = weeklySettlements.getAll(ch).find(record => (
          normalizePlatform(record.platform) === p
          && weekStartKeyFromDate(record.startDate || record.period) === weekKey
        ));
        if (saved) {
          const existingIds = new Set((saved.riders || []).map(r => String(r.matchedRiderId || '')));
          newlyMatched.forEach(rider => {
            const riderId = String(rider.matchedRiderId || '');
            if (!riderId || existingIds.has(riderId)) return;
            saved.riders = saved.riders || [];
            saved.riders.push(rider);
            existingIds.add(riderId);
            mergedToSaved += 1;
          });
          if (mergedToSaved) {
            saved.matchedNamesLabel = BremWeeklySettlement.buildMatchedNamesLabel(saved.riders);
            saved.summary = BremWeeklySettlement.buildWeeklySummary(saved.riders, []);
            weeklySettlements.save(saved);
          }
        }
      }

      const nextPending = stillUnmatchedRaw.map(record => {
        const rawName = String(record.originalName || record.riderName || '').trim();
        const name = String(record.riderName || rawName).trim();
        const coupangLoginKey = String(record.coupangLoginKey || '').trim();
        const baeminUserId = String(record.baeminUserId || '').trim();
        const idKey = coupangLoginKey || baeminUserId || rawName.replace(/\s/g, '');
        const source = pending.find(item => item.id === record._unmatchedId);
        return {
          id: `${weekKey}-weekly-${p}${channelTag}-${idKey}`,
          kind: 'weekly',
          channel: ch,
          weekStart: weekKey,
          period: startDate,
          endDate,
          platform: p,
          region: source?.region || '',
          rawName,
          name,
          orderCount: Number(record.weeklyOrderCount ?? 0),
          coupangLoginKey,
          baeminUserId,
          matchPayload: {
            originalName: rawName,
            riderName: name,
            coupangLoginKey,
            baeminUserId,
            weeklyOrderCount: Number(record.weeklyOrderCount ?? 0),
            channel: ch
          },
          sourceFileName: source?.sourceFileName || '',
          savedAt: new Date().toISOString()
        };
      });

      const current = settlementUnmatched.getAll(ch);
      const other = current.filter(item => !(
        item.kind === 'weekly'
        && item.weekStart === weekKey
        && normalizePlatform(item.platform) === p
      ));
      const next = other.concat(untouched).concat(nextPending);
      storageAdapter.write(settlementUnmatchedKey(ch), next, {
        allowEmpty: true,
        deletedRowIds: removedUnmatchedIds(current, next)
      });
      return {
        matched: newlyMatched,
        matchedCount: newlyMatched.length,
        stillUnmatchedCount: nextPending.length,
        mergedToSaved,
        needsManualSave: newlyMatched.length > 0 && mergedToSaved === 0,
        startDate,
        endDate,
        region: pending[0]?.region || ''
      };
    }
  };

  function normalizeMissionDefaults(meta = {}) {
    const raw = meta && typeof meta === 'object' ? meta : {};
    return {
      defaultBaemin: String(raw.defaultBaemin || '').trim(),
      defaultCoupang: String(raw.defaultCoupang || '').trim(),
      customBaemin: Array.isArray(raw.customBaemin)
        ? [...new Set(raw.customBaemin.map(id => String(id || '').trim()).filter(Boolean))]
        : [],
      customCoupang: Array.isArray(raw.customCoupang)
        ? [...new Set(raw.customCoupang.map(id => String(id || '').trim()).filter(Boolean))]
        : []
    };
  }

  const missionDefaults = {
    getMeta() {
      return normalizeMissionDefaults(storageAdapter.read(KEYS.missionDefaults, {}));
    },

    saveMeta(meta) {
      const next = normalizeMissionDefaults(meta);
      storageAdapter.write(KEYS.missionDefaults, next);
      return next;
    },

    setDefault(platform, missionId) {
      const p = normalizePlatform(platform);
      const meta = missionDefaults.getMeta();
      if (p === 'baemin') meta.defaultBaemin = String(missionId || '').trim();
      else meta.defaultCoupang = String(missionId || '').trim();
      return missionDefaults.saveMeta(meta);
    },

    isCustom(platform, driverId) {
      const p = normalizePlatform(platform);
      const id = String(driverId || '').trim();
      if (!id) return false;
      const meta = missionDefaults.getMeta();
      const list = p === 'baemin' ? meta.customBaemin : meta.customCoupang;
      return list.includes(id);
    },

    markCustom(platform, driverId) {
      const p = normalizePlatform(platform);
      const id = String(driverId || '').trim();
      if (!id) return missionDefaults.getMeta();
      const meta = missionDefaults.getMeta();
      const key = p === 'baemin' ? 'customBaemin' : 'customCoupang';
      const set = new Set(meta[key]);
      set.add(id);
      meta[key] = Array.from(set);
      return missionDefaults.saveMeta(meta);
    },

    clearCustom(platform, driverId) {
      const p = normalizePlatform(platform);
      const id = String(driverId || '').trim();
      if (!id) return missionDefaults.getMeta();
      const meta = missionDefaults.getMeta();
      const key = p === 'baemin' ? 'customBaemin' : 'customCoupang';
      meta[key] = meta[key].filter(item => item !== id);
      return missionDefaults.saveMeta(meta);
    }
  };

  const DEFAULT_ADMIN_ACCOUNT = Object.freeze({
    name: '관리자',
    // Production guard: 운영 모드에서는 이 기본 계정 로그인이 차단되고 Supabase Auth만 사용된다.
    // local 개발 데이터 호환용 기본값이다.
    password: '1234'
  });

  const ALL_ADMIN_MENU_IDS = Object.freeze([
    'notices',
    'rider-inquiries',
    'dashboard',
    'admin-schedule',
    'mission-results',
    'missions',
    'mission-management',
    'lease-management',
    'calls',
    'baemin-biz-status',
    'baemin-status',
    'coupang-rider-status',
    'coupang-status',
    'contribution',
    'rejections',
    'targets',
    'promotions',
    'promotion-apply',
    'promotion-settlement',
    'settlements',
    'weekly-settlement',
    'weekly-settlement-direct',
    'settlement-result-direct',
    'final-deposit',
    'driver-management',
    'admin-account',
    'revenue-management',
    'payroll-slips',
    'payroll-daily-settlement',
    'data-backup'
  ]);

  const ADMIN_ROLES = Object.freeze({
    CEO: 'ceo',
    DIRECTOR: 'director',
    MANAGER: 'manager'
  });

  const ADMIN_ROLE_LABELS = Object.freeze({
    ceo: '대표',
    director: '총괄',
    manager: '팀장'
  });

  function normalizeAdminRole(role, index = 0) {
    const value = String(role || '').trim();
    if (value === ADMIN_ROLES.CEO || value === ADMIN_ROLES.DIRECTOR || value === ADMIN_ROLES.MANAGER) {
      return value;
    }
    return index === 0 ? ADMIN_ROLES.CEO : ADMIN_ROLES.MANAGER;
  }

  function getAdminRoleLabel(role) {
    return ADMIN_ROLE_LABELS[normalizeAdminRole(role)] || ADMIN_ROLE_LABELS.manager;
  }

  function countAdminAccountsByRole(accounts, role) {
    return accounts.filter(account => account.role === role).length;
  }

  function normalizeAdminMenus(menus) {
    const isExplicitList = Array.isArray(menus);
    const source = isExplicitList ? menus : ALL_ADMIN_MENU_IDS;
    const allowed = new Set(ALL_ADMIN_MENU_IDS);
    const normalized = source
      .map(menuId => String(menuId || '').trim())
      .filter(menuId => allowed.has(menuId));

    if (normalized.includes('missions') && !normalized.includes('mission-results')) {
      const dashboardIndex = normalized.indexOf('dashboard');
      if (dashboardIndex >= 0) {
        normalized.splice(dashboardIndex + 1, 0, 'mission-results');
      } else {
        normalized.unshift('mission-results');
      }
    }

    if (normalized.includes('missions') && !normalized.includes('mission-management')) {
      const missionsIndex = normalized.indexOf('missions');
      normalized.splice(missionsIndex + 1, 0, 'mission-management');
    }

    if (!normalized.includes('mission-management')) {
      const targetsIndex = normalized.indexOf('targets');
      if (targetsIndex >= 0) {
        normalized.splice(targetsIndex, 0, 'mission-management');
      } else {
        normalized.push('mission-management');
      }
    }

    const legacyBaeminIndex = normalized.indexOf('baemin-delivery-status');
    if (legacyBaeminIndex >= 0) {
      normalized.splice(legacyBaeminIndex, 1, 'baemin-biz-status', 'baemin-status');
    }

    if (!normalized.includes('baemin-biz-status')) {
      const callsIndex = normalized.indexOf('calls');
      if (callsIndex >= 0) {
        normalized.splice(callsIndex + 1, 0, 'baemin-biz-status');
      } else {
        normalized.push('baemin-biz-status');
      }
    }

    if (!normalized.includes('baemin-status')) {
      const bizIndex = normalized.indexOf('baemin-biz-status');
      if (bizIndex >= 0) {
        normalized.splice(bizIndex + 1, 0, 'baemin-status');
      } else {
        normalized.push('baemin-status');
      }
    }

    if (!normalized.includes('coupang-status')) {
      const baeIndex = normalized.indexOf('baemin-status');
      if (baeIndex >= 0) {
        normalized.splice(baeIndex + 1, 0, 'coupang-status');
      } else {
        normalized.push('coupang-status');
      }
    }

    if (!normalized.includes('contribution')) {
      const coupangIndex = normalized.indexOf('coupang-status');
      if (coupangIndex >= 0) {
        normalized.splice(coupangIndex + 1, 0, 'contribution');
      } else {
        normalized.push('contribution');
      }
    }

    // 최종입금은 정산결과(직계약)를 볼 수 있는 계정에게 함께 열어준다.
    // 기존 계정은 메뉴 목록이 저장돼 있어 이 보정이 없으면 새 메뉴가 안 보인다.
    if (normalized.includes('settlement-result-direct') && !normalized.includes('final-deposit')) {
      normalized.splice(normalized.indexOf('settlement-result-direct') + 1, 0, 'final-deposit');
    }

    if (!normalized.includes('driver-management')) {
      const adminIdx = normalized.indexOf('admin-account');
      if (adminIdx >= 0) normalized.splice(adminIdx, 0, 'driver-management');
      else normalized.push('driver-management');
    }

    if (!normalized.includes('payroll-slips')) {
      const backupIndex = normalized.indexOf('data-backup');
      if (backupIndex >= 0) {
        normalized.splice(backupIndex, 0, 'payroll-slips');
      } else {
        const revenueIndex = normalized.indexOf('revenue-management');
        if (revenueIndex >= 0) {
          normalized.splice(revenueIndex + 1, 0, 'payroll-slips');
        } else {
          normalized.push('payroll-slips');
        }
      }
    } else {
      const payrollIndex = normalized.indexOf('payroll-slips');
      const backupIndex = normalized.indexOf('data-backup');
      if (backupIndex >= 0 && payrollIndex !== backupIndex - 1) {
        normalized.splice(payrollIndex, 1);
        const nextBackupIndex = normalized.indexOf('data-backup');
        normalized.splice(nextBackupIndex, 0, 'payroll-slips');
      }
    }

    if (isExplicitList) {
      return normalized;
    }

    if (!normalized.includes('admin-schedule')) {
      const dashboardIndex = normalized.indexOf('dashboard');
      if (dashboardIndex >= 0) {
        normalized.splice(dashboardIndex + 1, 0, 'admin-schedule');
      } else {
        normalized.unshift('admin-schedule');
      }
    }

    if (!normalized.includes('rider-inquiries')) {
      const noticesIndex = normalized.indexOf('notices');
      if (noticesIndex >= 0) {
        normalized.splice(noticesIndex + 1, 0, 'rider-inquiries');
      } else {
        normalized.unshift('rider-inquiries');
      }
    }

    if (!normalized.includes('lease-management')) {
      const callsIndex = normalized.indexOf('calls');
      if (callsIndex >= 0) {
        normalized.splice(callsIndex, 0, 'lease-management');
      } else {
        normalized.push('lease-management');
      }
    } else {
      const leaseIndex = normalized.indexOf('lease-management');
      const callsIndex = normalized.indexOf('calls');
      if (callsIndex >= 0 && leaseIndex !== callsIndex - 1) {
        normalized.splice(leaseIndex, 1);
        const nextCallsIndex = normalized.indexOf('calls');
        normalized.splice(nextCallsIndex, 0, 'lease-management');
      }
    }

    if (!normalized.includes('revenue-management')) {
      const backupIndex = normalized.indexOf('data-backup');
      if (backupIndex >= 0) {
        normalized.splice(backupIndex, 0, 'revenue-management');
      } else {
        normalized.push('revenue-management');
      }
    } else {
      const revenueIndex = normalized.indexOf('revenue-management');
      const backupIndex = normalized.indexOf('data-backup');
      if (backupIndex >= 0 && revenueIndex !== backupIndex - 1) {
        normalized.splice(revenueIndex, 1);
        const nextBackupIndex = normalized.indexOf('data-backup');
        normalized.splice(nextBackupIndex, 0, 'revenue-management');
      }
    }

    return normalized.length ? normalized : [...ALL_ADMIN_MENU_IDS];
  }

  function normalizeAdminEditableMenus(menus, editableMenus) {
    const normalizedMenus = normalizeAdminMenus(menus);
    const allowed = new Set(normalizedMenus);
    if (editableMenus == null) return [...normalizedMenus];
    if (!Array.isArray(editableMenus)) return [...normalizedMenus];
    return editableMenus
      .map(menuId => String(menuId || '').trim())
      .filter(menuId => allowed.has(menuId));
  }

  function normalizeBaeminPartnerIdList(list) {
    return [...new Set((Array.isArray(list) ? list : [])
      .map(id => String(id || '').trim().toUpperCase())
      .filter(id => /^DP\d{6,}$/i.test(id)))];
  }

  function normalizeCoupangVendorIdList(list) {
    return [...new Set((Array.isArray(list) ? list : [])
      .map(id => String(id || '').trim())
      .filter(Boolean))];
  }

  function normalizeAdminAccount(raw, index = 0) {
    const now = new Date().toISOString();
    const menus = normalizeAdminMenus(raw?.menus);
    const account = {
      id: String(raw?.id || createId()),
      email: String(raw?.email || '').trim(),
      name: String(raw?.name || DEFAULT_ADMIN_ACCOUNT.name).trim() || DEFAULT_ADMIN_ACCOUNT.name,
      password: raw?.password == null ? '' : String(raw.password),
      role: normalizeAdminRole(raw?.role, index),
      menus,
      editableMenus: normalizeAdminEditableMenus(menus, raw?.editableMenus ?? menus),
      baeminPartnerIds: normalizeBaeminPartnerIdList(raw?.baeminPartnerIds),
      coupangVendorIds: normalizeCoupangVendorIdList(raw?.coupangVendorIds),
      canOperateCrawl: raw?.canOperateCrawl === true,
      active: raw?.active !== false,
      createdAt: raw?.createdAt || now,
      updatedAt: raw?.updatedAt || now
    };
    return applyCeoPrivileges(account);
  }

  function applyCeoPrivileges(account) {
    if (!account || account.role !== ADMIN_ROLES.CEO) return account;

    const menus = normalizeAdminMenus(account.menus);
    const editableMenus = normalizeAdminEditableMenus(menus, account.editableMenus ?? menus);
    const nextMenus = menus.includes('admin-account') ? menus : [...menus, 'admin-account'];
    let nextEditable = editableMenus.includes('admin-account')
      ? editableMenus
      : [...editableMenus, 'admin-account'];
    if (nextMenus.includes('baemin-biz-status') && !nextEditable.includes('baemin-biz-status')) {
      nextEditable = [...nextEditable, 'baemin-biz-status'];
    }
    if (nextMenus.includes('baemin-status') && !nextEditable.includes('baemin-status')) {
      nextEditable = [...nextEditable, 'baemin-status'];
    }
    if (nextMenus.includes('coupang-status') && !nextEditable.includes('coupang-status')) {
      nextEditable = [...nextEditable, 'coupang-status'];
    }
    if (nextMenus.includes('contribution') && !nextEditable.includes('contribution')) {
      nextEditable = [...nextEditable, 'contribution'];
    }
    if (nextMenus.includes('payroll-slips') && !nextEditable.includes('payroll-slips')) {
      nextEditable = [...nextEditable, 'payroll-slips'];
    }
    if (nextMenus.includes('payroll-daily-settlement') && !nextEditable.includes('payroll-daily-settlement')) {
      nextEditable = [...nextEditable, 'payroll-daily-settlement'];
    }

    return { ...account, menus: nextMenus, editableMenus: nextEditable };
  }

  function parseAdminAccountsValue(raw) {
    if (!raw) return null;
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.accounts)) return raw.accounts;
    return null;
  }

  function readLocalAdminAccountsRaw() {
    try {
      const raw = localStorage.getItem(KEYS.adminAccounts);
      if (!raw) return null;
      return parseAdminAccountsValue(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  function writeLocalAdminAccounts(accounts) {
    localStorage.setItem(KEYS.adminAccounts, JSON.stringify({ accounts }));
  }

  function readAdminAccountsRaw() {
    if (isProductionMode()) {
      return productionAdminAccountsCache;
    }
    if (isLocalDevBackend()) {
      return readLocalAdminAccountsRaw();
    }
    if (productionAdminAccountsCache?.length) {
      return productionAdminAccountsCache;
    }
    if (activeStorageAdapter.type !== 'supabase' || !activeStorageAdapter.isHydrated?.()) {
      return null;
    }
    const raw = storageAdapter.read(KEYS.adminAccounts, null);
    return parseAdminAccountsValue(raw);
  }

  function writeAdminAccounts(accounts) {
    const normalized = accounts.map((account, index) => normalizeAdminAccount(account, index));
    productionAdminAccountsCache = normalized;
    if (isLocalDevBackend()) {
      writeLocalAdminAccounts(normalized);
    }
    /* 운영/개발 공통: brem_admin_accounts 는 server/admin-users.js 만 Supabase에 기록 */
  }

  function migrateLegacyAdminCredentials() {
    return null;
  }

  function ensureDevDefaultAdminAccount(accounts) {
    const config = getSupabaseConfig();
    if (config.mode !== 'development') return accounts;

    const list = accounts.map(account => ({ ...account }));
    const defaultIndex = list.findIndex(account => account.name === DEFAULT_ADMIN_ACCOUNT.name);

    if (defaultIndex >= 0) {
      list[defaultIndex].password = DEFAULT_ADMIN_ACCOUNT.password;
      list[defaultIndex].active = true;
      list[defaultIndex].menus = normalizeAdminMenus(list[defaultIndex].menus);
      list[defaultIndex].editableMenus = normalizeAdminEditableMenus(
        list[defaultIndex].menus,
        list[defaultIndex].editableMenus
      );
      return list;
    }

    list.unshift(normalizeAdminAccount({
      ...DEFAULT_ADMIN_ACCOUNT,
      role: ADMIN_ROLES.CEO,
      menus: ALL_ADMIN_MENU_IDS
    }));
    return list;
  }

  function ensureDefaultAdminAccounts() {
    if (isProductionMode()) {
      if (productionAdminAccountsCache?.length) {
        return productionAdminAccountsCache.map((account, index) => normalizeAdminAccount(account, index));
      }
      return [];
    }

    const existing = readAdminAccountsRaw();
    if (existing?.length) {
      const normalized = ensureDevDefaultAdminAccount(
        existing.map((account, index) => normalizeAdminAccount(account, index))
      );
      writeAdminAccounts(normalized);
      return normalized;
    }

    const migrated = migrateLegacyAdminCredentials();
    const seed = normalizeAdminAccount({
      ...(migrated || DEFAULT_ADMIN_ACCOUNT),
      role: ADMIN_ROLES.CEO,
      menus: ALL_ADMIN_MENU_IDS
    });
    writeAdminAccounts([seed]);
    return [seed];
  }

  function syncAdminSessionMirrors() {
    /* sessionStorage only — no localStorage mirror in production */
  }

  const auth = {
    ALL_ADMIN_MENU_IDS,
    ADMIN_ROLES,
    ADMIN_ROLE_LABELS,
    getAdminRoleLabel,

    isAdminLoggedIn() {
      return !!this.getAdminSessionAccount();
    },

    async refreshProductionAdminSession() {
      if (getSupabaseConfig().mode !== 'production') {
        productionAdminSessionAccount = null;
        return { ok: true };
      }

      const profile = activeSupabaseProfile || await loadSupabaseProfile();
      if (!profile?.active || profile.role !== 'admin') {
        productionAdminSessionAccount = null;
        return { ok: false, message: '관리자 프로필이 없습니다.' };
      }

      const meResult = await adminUsersApi('/api/admin/users/me');
      if (meResult.ok && meResult.account) {
        const account = buildProductionAdminSessionAccount(profile, meResult.account);
        if (account) {
          persistProductionSessionAccount(account);
          document.dispatchEvent(new CustomEvent('brem-admin-session-ready'));
        }
        return { ok: true, account };
      }

      await this.syncProductionAdminAccounts();
      const registryAccount = this.getAdminAccountById(profile.user_id);
      if (registryAccount) {
        const account = buildProductionAdminSessionAccount(profile, registryAccount);
        if (account) {
          persistProductionSessionAccount(account);
          document.dispatchEvent(new CustomEvent('brem-admin-session-ready'));
        }
        return { ok: true, account };
      }

      const initialEmail = getSupabaseConfig().initialAdmin?.email?.toLowerCase();
      const client = getSupabaseClient();
      const { data: userData } = client ? await client.auth.getUser() : { data: null };
      const userEmail = String(userData?.user?.email || '').trim().toLowerCase();
      if (initialEmail && userEmail === initialEmail) {
        const account = buildInitialAdminSessionAccount(profile);
        persistProductionSessionAccount(account);
        document.dispatchEvent(new CustomEvent('brem-admin-session-ready'));
        return { ok: true, account };
      }

      const fallbackAccount = mapProductionAdminAccount({
        id: profile.user_id,
        name: profile.display_name || '관리자',
        role: ADMIN_ROLES.MANAGER,
        menus: null,
        editableMenus: null,
        active: true
      }, 0);
      persistProductionSessionAccount(fallbackAccount);
      document.dispatchEvent(new CustomEvent('brem-admin-session-ready'));
      return { ok: true, account: fallbackAccount };
    },

    async ensureDriverProgramAccess() {
      if (window.BremSupabaseConfig?.load) {
        await window.BremSupabaseConfig.load();
      }

      if (isLocalDevBackend()) {
        try {
          await initLocalDevStorage();
        } catch (error) {
          return { ok: false, message: error.message || '로컬 저장소 초기화에 실패했습니다.' };
        }
        if (!this.isAdminLoggedIn()) {
          return { ok: false, message: '관리자 로그인이 필요합니다.' };
        }
        return { ok: true };
      }

      const config = getSupabaseConfig();

      try {
        await initStorage(getStorageBootstrapOptions());
      } catch (error) {
        return { ok: false, message: error.message || 'Supabase 연결에 실패했습니다.' };
      }

      // 로그인 유지 토큰이 sessionStorage에만 남아 있어도 localStorage로 승격
      try {
        window.BremLoginPrefs?.setKeepLoggedIn?.('admin', true);
        window.BremLoginPrefs?.migrateSessionToPersist?.('admin');
      } catch {
        /* ignore */
      }

      if (config.mode === 'production') {
        // 접근 판정은 세션/프로필만 본다. hydrate 실패로 로그인창 루프를 만들지 않는다.
        let profile = activeSupabaseProfile;
        if (!profile) {
          try {
            profile = await loadSupabaseProfile();
          } catch (error) {
            console.warn('[BREM] ensureDriverProgramAccess profile load:', error?.message || error);
            profile = null;
          }
        }
        if (!profile?.active || profile.role !== 'admin') {
          const client = await ensureSupabaseClientForLogin();
          let sessionUser = null;
          try {
            const { data: sessionData } = await client?.auth?.getSession?.() || {};
            sessionUser = sessionData?.session?.user || null;
            // localStorage에 직접 저장된 세션이 있으면 setSession으로 복구
            if (!sessionUser) {
              const storageKey = getSupabaseAuthStorageKey();
              const raw = storageKey
                ? (localStorage.getItem(`brem-auth-admin-${storageKey}`)
                  || sessionStorage.getItem(`brem-auth-admin-${storageKey}`))
                : null;
              if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed?.access_token && parsed?.refresh_token) {
                  await client.auth.setSession({
                    access_token: parsed.access_token,
                    refresh_token: parsed.refresh_token
                  }).catch(() => ({}));
                  const { data: restored } = await client.auth.getSession();
                  sessionUser = restored?.session?.user || null;
                  if (restored?.session?.access_token) {
                    rememberAdminAccessToken(restored.session.access_token);
                  }
                }
              }
            }
          } catch (restoreError) {
            console.warn('[BREM] session restore:', restoreError?.message || restoreError);
          }
          if (sessionUser) {
            profile = buildProfileFromAuthUser(sessionUser, 'admin');
            activeSupabaseProfile = profile;
          }
        }
        if (!profile?.active || profile.role !== 'admin') {
          const token = await resolveAdminAccessToken();
          if (!token) {
            return { ok: false, message: '관리자 로그인이 필요합니다.' };
          }
          // 토큰은 유효한데 profiles 조회만 실패한 경우 — 로그인창 루프 방지 위해 진입 허용
          const fallbackId = sessionAdapter.read(SESSION_KEYS.adminAccountId)
            || productionAdminSessionAccount?.id
            || 'admin';
          if (!activeSupabaseProfile) {
            activeSupabaseProfile = {
              user_id: fallbackId,
              role: 'admin',
              active: true,
              display_name: productionAdminSessionAccount?.name || '관리자'
            };
          }
          this.setAdminSession(fallbackId);
          void ensureSupabaseHydrated({ skipDriversSync: true }).catch(() => {});
          void this.refreshProductionAdminSession().catch(() => ({}));
          return { ok: true };
        }

        const persisted = readPersistedProductionSessionAccount(profile);
        if (persisted) {
          productionAdminSessionAccount = persisted;
        }
        this.setAdminSession(profile.user_id);

        // 데이터 hydrate는 백그라운드 — 실패해도 페이지 진입은 허용
        void ensureSupabaseHydrated({ skipDriversSync: true }).catch(error => {
          console.warn('[BREM] drivers hydrate deferred:', error?.message || error);
        });
        void this.refreshProductionAdminSession().catch(() => ({}));
        return { ok: true };
      }

      if (this.isAdminLoggedIn()) {
        return { ok: true };
      }

      return { ok: false, message: '관리자 로그인이 필요합니다.' };
    },

    async ensureAppAccess(options = {}) {
      if (window.BremSupabaseConfig?.load) {
        await window.BremSupabaseConfig.load();
      }

      const config = getSupabaseConfig();

      try {
        await initStorage({ backend: 'supabase' });
        const needsHydrated = (config.mode === 'production' || options.requireHydrated) && !options.deferHydrate;
        if (needsHydrated) {
          const hydrated = await ensureSupabaseHydrated({ skipDriversSync: true });
          if (!hydrated.ok) {
            return hydrated;
          }
        }
      } catch (error) {
        return { ok: false, message: error.message || 'Supabase 연결에 실패했습니다.' };
      }

      if (config.mode === 'production') {
        let profile = activeSupabaseProfile;
        if (!profile) {
          profile = await loadSupabaseProfile();
        }
        if (profile?.active && profile.role === 'admin') {
          const persisted = readPersistedProductionSessionAccount(profile);
          if (persisted) {
            productionAdminSessionAccount = persisted;
          }
          if (sessionAdapter.read(SESSION_KEYS.adminLoggedIn) !== 'true') {
            this.setAdminSession(profile.user_id);
          }
          if (options.refreshMenus) {
            await this.refreshProductionAdminSession();
          }
          return { ok: true };
        }
        return { ok: false, message: '관리자 로그인이 필요합니다.' };
      }

      if (this.isAdminLoggedIn()) {
        return { ok: true };
      }

      return { ok: false, message: '관리자 로그인이 필요합니다.' };
    },

    setAdminLoggedIn(value) {
      if (!value) {
        this.clearAdminSession();
        return;
      }
      sessionAdapter.write(SESSION_KEYS.adminLoggedIn, 'true');
    },

    setAdminSession(accountId) {
      if (!accountId) {
        this.clearAdminSession();
        return;
      }
      sessionAdapter.write(SESSION_KEYS.adminAccountId, accountId);
      sessionAdapter.write(SESSION_KEYS.adminLoggedIn, 'true');
    },

    clearAdminSession() {
      sessionAdapter.remove(SESSION_KEYS.adminAccountId);
      sessionAdapter.remove(SESSION_KEYS.adminLoggedIn);
      productionAdminSessionAccount = null;
      clearPersistedProductionSessionAccount();
    },

    clearSessionAuth(scope) {
      if (scope === 'rider') {
        clearScopeSessionAuth('rider');
      } else if (scope === 'admin') {
        clearScopeSessionAuth('admin');
      } else {
        clearAllSessionAuthStorage();
      }
      rememberAdminAccessToken('');
      if (scope !== 'rider') {
        productionAdminSessionAccount = null;
      }
    },

    clearScopeSessionAuth,

    isDriverLoggedIn() {
      if (getSupabaseConfig().mode === 'production') {
        if (activeSupabaseProfile?.active && activeSupabaseProfile.role === 'rider') {
          return true;
        }
      }
      return Boolean(sessionAdapter.read(SESSION_KEYS.driverId));
    },

    getAdminAccounts() {
      return ensureDefaultAdminAccounts().map(account => ({ ...account }));
    },

    getAdminAccountById(accountId) {
      return this.getAdminAccounts().find(account => account.id === accountId) || null;
    },

    getAdminSessionAccount() {
      syncAdminSessionMirrors();
      if (getSupabaseConfig().mode === 'production') {
        if (
          productionAdminSessionAccount?.id
          && sessionAdapter.read(SESSION_KEYS.adminLoggedIn) === 'true'
        ) {
          const profile = activeSupabaseProfile;
          if (!profile || profile.user_id === productionAdminSessionAccount.id) {
            return { ...productionAdminSessionAccount, password: '' };
          }
        }

        const profile = activeSupabaseProfile;
        if (!profile?.active || profile.role !== 'admin') {
          return null;
        }

        const registryAccount = this.getAdminAccounts().find(account => account.id === profile.user_id);
        if (registryAccount) {
          const sessionAccount = buildProductionAdminSessionAccount(profile, registryAccount);
          if (sessionAccount) {
            productionAdminSessionAccount = sessionAccount;
            persistProductionSessionAccount(sessionAccount);
            return { ...sessionAccount, password: '' };
          }
        }

        if (productionAdminSessionAccount?.id === profile.user_id) {
          return { ...productionAdminSessionAccount, password: '' };
        }

        const persisted = readPersistedProductionSessionAccount(profile);
        if (persisted) {
          productionAdminSessionAccount = persisted;
          return { ...persisted, password: '' };
        }

        return null;
      }

      const accountId = sessionAdapter.read(SESSION_KEYS.adminAccountId);
      if (accountId) {
        const account = this.getAdminAccountById(accountId);
        if (account?.active) return account;
      }

      if (sessionAdapter.read(SESSION_KEYS.adminLoggedIn) === 'true') {
        const fallback = this.getAdminAccounts().find(account => account.active) || null;
        if (fallback) {
          this.setAdminSession(fallback.id);
          return fallback;
        }
      }

      return null;
    },

    getAdminSessionMenus() {
      const account = this.getAdminSessionAccount();
      if (!account) return [];
      return normalizeAdminMenus(account.menus);
    },

    getAdminSessionEditableMenus() {
      const account = this.getAdminSessionAccount();
      if (!account) return [];
      return normalizeAdminEditableMenus(account.menus, account.editableMenus);
    },

    canEditAdminMenu(menuId) {
      return this.getAdminSessionEditableMenus().includes(menuId);
    },

    verifyAdminLogin(name, password) {
      if (getSupabaseConfig().mode === 'production') {
        return { ok: false, message: '운영 모드에서는 Supabase Auth 로그인을 사용하세요.' };
      }
      const loginName = String(name || '').trim();
      const loginPassword = String(password || '');
      const account = this.getAdminAccounts().find(item =>
        item.active
        && item.name === loginName
        && item.password === loginPassword
      );

      if (!account) {
        return { ok: false, message: '이름 또는 비밀번호가 올바르지 않습니다.' };
      }

      return { ok: true, account: { ...account } };
    },

    async signInAdmin(loginInput, password) {
      if (getSupabaseConfig().mode === 'production') {
        try {
          if (window.BremSupabaseConfig?.load) {
            await Promise.race([
              window.BremSupabaseConfig.load(),
              new Promise(resolve => setTimeout(resolve, 1500))
            ]);
          }

          const { response, payload } = await fetchAdminSignInApi(loginInput, password, 35000);
          if (response.ok) {
            await ensureSupabaseClientForLogin();
            return finishProductionAdminSessionFromPayload(payload, this);
          }

          const message = payload.error || '로그인에 실패했습니다.';
          if (response.status === 401) {
            return { ok: false, message: '이름(아이디) 또는 비밀번호가 올바르지 않습니다.' };
          }
          return { ok: false, message };
        } catch (error) {
          const message = String(error?.message || '');
          if (/abort|timeout/i.test(message)) {
            return { ok: false, message: '로그인 응답이 지연되고 있습니다. 잠시 후 다시 시도하세요.' };
          }
          return { ok: false, message: message || '로그인에 실패했습니다.' };
        }
      }

      const email = resolveAdminLoginInput(loginInput);
      if (!email.includes('@')) {
        return {
          ok: false,
          message: '운영 로그인 설정이 필요합니다. supabase-config.js의 initialAdmin.email을 확인하세요.'
        };
      }

      const result = await signInWithSupabase(email, password, 'admin');
      if (!result.ok) return result;

      this.syncProductionAdminAccounts().catch(error => {
        console.warn('[BREM] Background admin account sync after login failed:', error.message || error);
      });
      const registryAccount = this.getAdminAccountById(result.profile.user_id);
      const account = registryAccount || {
        id: result.profile.user_id,
        name: result.profile.display_name || result.user.email || '관리자',
        role: ADMIN_ROLES.CEO,
        menus: ALL_ADMIN_MENU_IDS,
        editableMenus: ALL_ADMIN_MENU_IDS,
        active: true
      };

      this.setAdminSession(account.id);
      return { ok: true, account: { ...account, password: '' } };
    },

    async signInDriver(loginInput, password) {
      if (getSupabaseConfig().mode === 'production') {
        try {
          const loginBody = {
            login: String(loginInput || '').trim(),
            password: String(password || '')
          };
          const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const timeoutMs = 25000;
          const timer = controller
            ? setTimeout(() => controller.abort(), timeoutMs)
            : null;

          // 설정 로드와 로그인 API를 병렬 — 로그인 버튼이 설정 로드만 기다리지 않게
          const configPromise = window.BremSupabaseConfig?.load
            ? window.BremSupabaseConfig.load().catch(() => null)
            : Promise.resolve(null);

          const responsePromise = fetch('/api/rider/sign-in', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loginBody),
            signal: controller?.signal
          });

          const [, response] = await Promise.all([configPromise, responsePromise]);
          if (timer) clearTimeout(timer);

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            return {
              ok: false,
              reason: payload.error || '로그인에 실패했습니다.'
            };
          }

          const client = await ensureSupabaseClient();
          if (!client || !payload.session) {
            return { ok: false, reason: '로그인 세션을 받지 못했습니다.' };
          }

          const { error: sessionError } = await client.auth.setSession({
            access_token: payload.session.access_token,
            refresh_token: payload.session.refresh_token
          });
          if (sessionError) {
            return { ok: false, reason: sessionError.message || '세션 연결에 실패했습니다.' };
          }

          if (payload.profile) {
            activeSupabaseProfile = payload.profile;
          } else if (!activeSupabaseProfile) {
            activeSupabaseProfile = await loadSupabaseProfile();
          }
          if (payload.riderId) {
            sessionAdapter.write(SESSION_KEYS.driverId, payload.riderId);
          }
          void resumeSupabaseAfterAuth({ deferHydrate: true }).catch(error => {
            console.warn('[BREM] Rider storage resume deferred:', error.message || error);
          });
          const mapper = window.BremSupabaseMapper;
          const mappedDriver = payload.rider && mapper?.rowToRider
            ? mapper.rowToRider(payload.rider)
            : null;
          let driver = null;
          if (payload.rider) {
            try {
              driver = mergeRiderInCache(payload.rider);
            } catch (error) {
              console.warn('[BREM] mergeRiderInCache failed:', error.message || error);
              driver = mappedDriver;
            }
          }
          return {
            ok: true,
            riderId: payload.riderId,
            profile: activeSupabaseProfile,
            driver: driver || mappedDriver
          };
        } catch (error) {
          const aborted = error?.name === 'AbortError';
          return {
            ok: false,
            reason: aborted
              ? '로그인이 시간 초과되었습니다. 네트워크 상태를 확인 후 다시 시도하세요.'
              : (error.message || '로그인에 실패했습니다.')
          };
        }
      }

      return signInWithSupabase(String(loginInput || '').trim(), password, 'rider');
    },

    async signOutSupabase(scope = window.BREM_AUTH_SCOPE === 'rider' ? 'rider' : 'admin') {
      const client = getSupabaseClient();
      if (client) await client.auth.signOut();
      rememberAdminAccessToken('');
      activeSupabaseProfile = null;
      supabaseInitPromise = null;
      activeStorageAdapter = unavailableStorageAdapter;
      if (scope !== 'rider') {
        productionAdminSessionAccount = null;
      }
      this.clearSessionAuth(scope);
      resetBootstrapState();
      clearRiderLiveOpsCache();
      window.BremDriverDataCache?.clearAll?.();
      window.BremDataCache?.clearAll?.();
      window.BremSessionSecurity?.stop?.();
    },

    getSupabaseProfile() {
      return activeSupabaseProfile ? { ...activeSupabaseProfile } : null;
    },

    async syncProductionAdminAccounts() {
      if (getSupabaseConfig().mode !== 'production') return { ok: true };
      if (syncAdminAccountsPromise) return syncAdminAccountsPromise;

      syncAdminAccountsPromise = (async () => {
        window.BremPerf?.time?.('storage.syncProductionAdminAccounts');
        const result = await adminUsersApi('/api/admin/users');
        if (!result.ok) return result;

        const accounts = (result.accounts || []).map((account, index) => mapProductionAdminAccount(account, index));
        writeAdminAccounts(accounts);
        window.BremPerf?.timeEnd?.('storage.syncProductionAdminAccounts');
        return { ok: true, accounts };
      })().finally(() => {
        syncAdminAccountsPromise = null;
      });

      return syncAdminAccountsPromise;
    },

    async createAdminAccount({ name, password, menus, editableMenus, active = true, role = ADMIN_ROLES.MANAGER, email, baeminPartnerIds, coupangVendorIds, canOperateCrawl = false } = {}, options = {}) {
      const actorRole = options.actor?.role || ADMIN_ROLES.MANAGER;
      if (actorRole !== ADMIN_ROLES.CEO) {
        return { ok: false, message: '대표만 관리자 계정을 생성할 수 있습니다.' };
      }

      const nextName = String(name || '').trim();
      const nextPassword = String(password || '').trim();
      const nextRole = normalizeAdminRole(role, 1);
      const isProduction = getSupabaseConfig().mode === 'production';

      if (!nextName) {
        return { ok: false, message: '관리자 이름을 입력하세요.' };
      }
      if (nextPassword.length < (isProduction ? 6 : 4)) {
        return {
          ok: false,
          message: isProduction ? '비밀번호는 6자 이상 입력하세요.' : '비밀번호는 4자 이상 입력하세요.'
        };
      }

      if (isProduction) {
        const apiResult = await adminUsersApi('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            name: nextName,
            password: nextPassword,
            role: nextRole,
            menus: normalizeAdminMenus(menus),
            editableMenus: normalizeAdminEditableMenus(menus, editableMenus),
            baeminPartnerIds: normalizeBaeminPartnerIdList(baeminPartnerIds),
            coupangVendorIds: normalizeCoupangVendorIdList(coupangVendorIds),
            canOperateCrawl: canOperateCrawl === true,
            active,
            email: String(email || '').trim() || undefined
          })
        });
        if (!apiResult.ok) {
          return { ok: false, message: apiResult.message };
        }

        await this.syncProductionAdminAccounts();
        const account = mapProductionAdminAccount(apiResult.account, 0);
        return {
          ok: true,
          message: apiResult.message || '관리자 계정이 생성되었습니다.',
          account
        };
      }

      const accounts = ensureDefaultAdminAccounts();
      if (accounts.some(account => account.name === nextName)) {
        return { ok: false, message: '이미 사용 중인 관리자 이름입니다.' };
      }

      const now = new Date().toISOString();
      const normalizedMenus = normalizeAdminMenus(menus);
      const account = normalizeAdminAccount({
        id: createId(),
        name: nextName,
        password: nextPassword,
        role: nextRole,
        menus: normalizedMenus,
        editableMenus: normalizeAdminEditableMenus(normalizedMenus, editableMenus),
        baeminPartnerIds: normalizeBaeminPartnerIdList(baeminPartnerIds),
        coupangVendorIds: normalizeCoupangVendorIdList(coupangVendorIds),
        canOperateCrawl: canOperateCrawl === true,
        active,
        createdAt: now,
        updatedAt: now
      }, accounts.length);

      writeAdminAccounts([...accounts, account]);
      return { ok: true, message: '관리자 계정이 생성되었습니다.', account };
    },

    async updateAdminAccount(accountId, { name, password, menus, editableMenus, active, role, baeminPartnerIds, coupangVendorIds, canOperateCrawl } = {}, options = {}) {
      const actor = options.actor || null;
      const actorRole = actor?.role || ADMIN_ROLES.MANAGER;
      const isProduction = getSupabaseConfig().mode === 'production';

      if (isProduction) {
        const payload = {};
        if (name != null) payload.name = name;
        if (password != null && password !== '') payload.password = password;
        if (menus != null) payload.menus = menus;
        if (editableMenus != null) payload.editableMenus = editableMenus;
        if (active != null) payload.active = active;
        if (role != null) payload.role = role;
        if (baeminPartnerIds != null) payload.baeminPartnerIds = normalizeBaeminPartnerIdList(baeminPartnerIds);
        if (coupangVendorIds != null) payload.coupangVendorIds = normalizeCoupangVendorIdList(coupangVendorIds);
        if (canOperateCrawl != null) payload.canOperateCrawl = canOperateCrawl === true;

        const apiResult = await adminUsersApi(`/api/admin/users/${encodeURIComponent(accountId)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        if (!apiResult.ok) {
          return { ok: false, message: apiResult.message };
        }

        const account = mapProductionAdminAccount(apiResult.account, 0);
        await this.syncProductionAdminAccounts();
        if (activeSupabaseProfile?.user_id === accountId) {
          await this.refreshProductionAdminSession();
        }
        return {
          ok: true,
          message: apiResult.message || '관리자 계정이 수정되었습니다.',
          account
        };
      }

      const accounts = ensureDefaultAdminAccounts();
      const index = accounts.findIndex(account => account.id === accountId);
      if (index < 0) {
        return { ok: false, message: '관리자 계정을 찾을 수 없습니다.' };
      }

      const current = accounts[index];

      if (actorRole === ADMIN_ROLES.MANAGER) {
        return { ok: false, message: '팀장은 관리자 계정을 수정할 수 없습니다.' };
      }

      if (actorRole === ADMIN_ROLES.DIRECTOR) {
        if (current.role !== ADMIN_ROLES.MANAGER) {
          return { ok: false, message: '총괄은 팀장 계정의 메뉴만 수정할 수 있습니다.' };
        }
        if (menus == null) {
          return { ok: false, message: '수정할 메뉴를 선택하세요.' };
        }

        const updated = normalizeAdminAccount({
          ...current,
          menus: normalizeAdminMenus(menus),
          editableMenus: normalizeAdminEditableMenus(menus, editableMenus),
          baeminPartnerIds: baeminPartnerIds == null
            ? current.baeminPartnerIds
            : normalizeBaeminPartnerIdList(baeminPartnerIds),
          coupangVendorIds: coupangVendorIds == null
            ? current.coupangVendorIds
            : normalizeCoupangVendorIdList(coupangVendorIds),
          canOperateCrawl: canOperateCrawl == null
            ? current.canOperateCrawl === true
            : canOperateCrawl === true,
          updatedAt: new Date().toISOString()
        }, index);

        accounts[index] = updated;
        writeAdminAccounts(accounts);

        const sessionAccount = this.getAdminSessionAccount();
        if (sessionAccount?.id === accountId) {
          this.setAdminSession(accountId);
        }

        return { ok: true, message: '접근 메뉴가 수정되었습니다.', account: updated };
      }

      const nextName = String(name ?? current.name).trim();
      const nextPassword = password == null || password === ''
        ? current.password
        : String(password).trim();
      const nextRole = role == null ? current.role : normalizeAdminRole(role, index);
      const nextMenus = menus == null ? current.menus : normalizeAdminMenus(menus);
      const nextEditableMenus = editableMenus == null
        ? current.editableMenus
        : normalizeAdminEditableMenus(nextMenus, editableMenus);
      const nextActive = active == null ? current.active : !!active;

      if (!nextName) {
        return { ok: false, message: '관리자 이름을 입력하세요.' };
      }
      if (nextPassword.length < 4) {
        return { ok: false, message: '비밀번호는 4자 이상 입력하세요.' };
      }
      if (accounts.some(account => account.id !== accountId && account.name === nextName)) {
        return { ok: false, message: '이미 사용 중인 관리자 이름입니다.' };
      }
      if (!nextMenus.length) {
        return { ok: false, message: '접근 가능한 메뉴를 1개 이상 선택하세요.' };
      }

      if (current.role === ADMIN_ROLES.CEO && nextRole !== ADMIN_ROLES.CEO) {
        const ceoCount = countAdminAccountsByRole(accounts, ADMIN_ROLES.CEO);
        if (ceoCount <= 1) {
          return { ok: false, message: '대표 계정은 최소 1명 필요합니다.' };
        }
      }

      if (!nextActive) {
        const activeCount = accounts.filter(account => account.active && account.id !== accountId).length;
        if (!activeCount) {
          return { ok: false, message: '활성 관리자 계정은 최소 1개 필요합니다.' };
        }
        if (current.role === ADMIN_ROLES.CEO) {
          const activeCeoCount = accounts.filter(account =>
            account.active
            && account.role === ADMIN_ROLES.CEO
            && account.id !== accountId
          ).length;
          if (!activeCeoCount) {
            return { ok: false, message: '활성 대표 계정은 최소 1명 필요합니다.' };
          }
        }
      }

      const nextBaeminPartnerIds = baeminPartnerIds == null
        ? current.baeminPartnerIds
        : normalizeBaeminPartnerIdList(baeminPartnerIds);
      const nextCoupangVendorIds = coupangVendorIds == null
        ? current.coupangVendorIds
        : normalizeCoupangVendorIdList(coupangVendorIds);
      const nextCanOperateCrawl = canOperateCrawl == null
        ? current.canOperateCrawl === true
        : canOperateCrawl === true;

      const updated = normalizeAdminAccount({
        ...current,
        name: nextName,
        password: nextPassword,
        role: nextRole,
        menus: nextMenus,
        editableMenus: nextEditableMenus,
        baeminPartnerIds: nextBaeminPartnerIds,
        coupangVendorIds: nextCoupangVendorIds,
        canOperateCrawl: nextCanOperateCrawl,
        active: nextActive,
        updatedAt: new Date().toISOString()
      }, index);

      accounts[index] = updated;
      writeAdminAccounts(accounts);

      const sessionAccount = this.getAdminSessionAccount();
      if (sessionAccount?.id === accountId) {
        this.setAdminSession(accountId);
      }

      return { ok: true, message: '관리자 계정이 수정되었습니다.', account: updated };
    },

    async deleteAdminAccount(accountId, options = {}) {
      const actorRole = options.actor?.role || ADMIN_ROLES.MANAGER;
      if (actorRole !== ADMIN_ROLES.CEO) {
        return { ok: false, message: '대표만 관리자 계정을 삭제할 수 있습니다.' };
      }

      if (getSupabaseConfig().mode === 'production') {
        const apiResult = await adminUsersApi(`/api/admin/users/${encodeURIComponent(accountId)}`, {
          method: 'DELETE'
        });
        if (!apiResult.ok) {
          return { ok: false, message: apiResult.message };
        }

        await this.syncProductionAdminAccounts();

        const sessionAccount = this.getAdminSessionAccount();
        if (sessionAccount?.id === accountId) {
          this.clearAdminSession();
        }

        return { ok: true, message: apiResult.message || '관리자 계정이 삭제되었습니다.' };
      }

      const accounts = ensureDefaultAdminAccounts();
      if (accounts.length <= 1) {
        return { ok: false, message: '마지막 관리자 계정은 삭제할 수 없습니다.' };
      }

      const target = accounts.find(account => account.id === accountId);
      if (!target) {
        return { ok: false, message: '관리자 계정을 찾을 수 없습니다.' };
      }

      if (target.role === ADMIN_ROLES.CEO && countAdminAccountsByRole(accounts, ADMIN_ROLES.CEO) <= 1) {
        return { ok: false, message: '마지막 대표 계정은 삭제할 수 없습니다.' };
      }

      const nextAccounts = accounts.filter(account => account.id !== accountId);
      writeAdminAccounts(nextAccounts);

      const sessionAccount = this.getAdminSessionAccount();
      if (sessionAccount?.id === accountId) {
        this.clearAdminSession();
      }

      return { ok: true, message: '관리자 계정이 삭제되었습니다.' };
    },

    getDriverSessionId() {
      if (getSupabaseConfig().mode === 'production') {
        if (activeSupabaseProfile?.role === 'rider') {
          return activeSupabaseProfile.rider_id || '';
        }
        return sessionAdapter.read(SESSION_KEYS.driverId) || '';
      }
      return sessionAdapter.read(SESSION_KEYS.driverId);
    },

    setDriverSessionId(driverId) {
      if (!driverId) {
        sessionAdapter.remove(SESSION_KEYS.driverId);
        return;
      }
      sessionAdapter.write(SESSION_KEYS.driverId, driverId);
    }
  };

  const DATA_GROUPS = Object.freeze({
    all: Object.freeze({
      id: 'all',
      label: '전체 데이터',
      description: '등록된 모든 BREM Supabase/settings 데이터',
      keys: Object.freeze([
        ...Object.values(KEYS),
        SCHEMA.versionKey
      ])
    }),
    drivers: Object.freeze({
      id: 'drivers',
      label: '기사 데이터',
      description: '기사, 콜수, 거절율, 목표, 장기근속, 공지',
      keys: Object.freeze([
        KEYS.drivers,
        KEYS.calls,
        KEYS.rejections,
        KEYS.targets,
        KEYS.weeklyTargets,
        KEYS.eventCatalog,
        KEYS.eventItems,
        KEYS.eventConfig,
        KEYS.legacyBikes,
        KEYS.legacyMission,
        KEYS.notices,
        KEYS.adminSchedules,
        KEYS.leaseVehicles,
        KEYS.revenue
      ])
    }),
    promotions: Object.freeze({
      id: 'promotions',
      label: '프로모션 조건',
      description: '프로모션 규칙, 설정, 선택 옵션, 적용 결과',
      keys: Object.freeze([
        KEYS.promotionRules,
        KEYS.promotionSettings,
        KEYS.promotionSelectorOptions,
        KEYS.promotionApplyResults
      ])
    }),
    weeklySettlements: Object.freeze({
      id: 'weeklySettlements',
      label: '주간정산 결과',
      description: '주정산서 업로드·매칭 결과',
      keys: Object.freeze([KEYS.weeklySettlements])
    }),
    regions: Object.freeze({
      id: 'regions',
      label: '지역·매칭 데이터',
      description: '수동 이름 매칭, 미매칭 정산, 일정산 지역 데이터',
      keys: Object.freeze([
        KEYS.manualNameMappings,
        KEYS.settlementUnmatched,
        KEYS.settlements,
        KEYS.payrollDailySettlementRoster,
        KEYS.payrollDailySettlementRegions,
        KEYS.payrollDailySettlementFees,
        KEYS.payrollWithdrawalRequests,
        KEYS.payrollDailyExcludedSettlements,
        KEYS.payrollWeekFinalized,
        KEYS.payrollWithdrawalPaused
      ])
    })
  });

  function getSchemaVersion() {
    const version = storageAdapter.read(SCHEMA.versionKey, 0);
    return Number.isFinite(Number(version)) ? Number(version) : 0;
  }

  function setSchemaVersion(version) {
    storageAdapter.write(SCHEMA.versionKey, Number(version));
  }

  function catalogUnknownBremKeys() {
    const known = new Set([...Object.values(KEYS), SCHEMA.versionKey]);
    const preserved = { ...(storageAdapter.read(KEYS.preservedUnknown, {}) || {}) };
    let changed = false;

    storageAdapter.listBremKeys().forEach(key => {
      if (known.has(key)) return;
      const raw = storageAdapter.readRaw(key);
      if (!raw.exists) return;
      if (preserved[key] === undefined || preserved[key] !== raw.value) {
        preserved[key] = raw.value;
        changed = true;
      }
    });

    if (changed) storageAdapter.write(KEYS.preservedUnknown, preserved);
    return preserved;
  }

  function runDataMigrations() {
    if (dataMigrationsCompleted) return;

    let version = getSchemaVersion();
    if (isProductionMode() && version >= SCHEMA.currentVersion) {
      dataMigrationsCompleted = true;
      return;
    }

    if (version < 1) {
      const driverList = storageAdapter.read(KEYS.drivers, null);
      if (Array.isArray(driverList)) {
        storageAdapter.write(KEYS.drivers, normalizeDrivers(driverList));
      }
      if (storageAdapter.has(KEYS.calls)) normalizeCalls(storageAdapter.read(KEYS.calls, []));
      if (storageAdapter.has(KEYS.rejections)) migrateRejectionsPlatform(storageAdapter.read(KEYS.rejections, []));
      if (storageAdapter.has(KEYS.settlements)) normalizeSettlements(storageAdapter.read(KEYS.settlements, []));
      if (storageAdapter.has(KEYS.settlementUnmatched)) {
        normalizeSettlementUnmatched(storageAdapter.read(KEYS.settlementUnmatched, []));
      }
      version = 1;
      setSchemaVersion(version);
    }

    if (version < 2) {
      catalogUnknownBremKeys();
      version = 2;
      setSchemaVersion(version);
    }

    dataMigrationsCompleted = true;
  }

  function finalizeStorageReady() {
    if (activeStorageAdapter.type !== 'supabase' || !activeStorageAdapter.isHydrated?.()) {
      return;
    }
    try {
      runDataMigrations();
    } catch (error) {
      console.error('[BREM] Data migration failed:', error);
    }
  }

  function isArrayData(value) {
    return Array.isArray(value);
  }

  function mergeRecordsById(existing, incoming, idField = 'id') {
    const map = new Map();
    (Array.isArray(existing) ? existing : []).forEach(item => {
      if (item && item[idField] != null) map.set(String(item[idField]), item);
    });
    (Array.isArray(incoming) ? incoming : []).forEach(item => {
      if (!item || item[idField] == null) return;
      const id = String(item[idField]);
      if (!map.has(id)) {
        map.set(id, item);
        return;
      }
      const current = map.get(id);
      const currentTime = String(current.updatedAt || current.createdAt || '');
      const incomingTime = String(item.updatedAt || item.createdAt || '');
      if (incomingTime >= currentTime) map.set(id, item);
    });
    return Array.from(map.values());
  }

  function mergePlainObject(existing, incoming) {
    return { ...(existing && typeof existing === 'object' ? existing : {}), ...(incoming && typeof incoming === 'object' ? incoming : {}) };
  }

  function mergeImportedValue(key, existingValue, incomingValue) {
    if (incomingValue === undefined) return existingValue;
    if (existingValue === undefined || existingValue === null) return incomingValue;
    if (isArrayData(incomingValue)) {
      return mergeRecordsById(existingValue, incomingValue);
    }
    if (incomingValue && typeof incomingValue === 'object' && !Array.isArray(incomingValue)) {
      if (existingValue && typeof existingValue === 'object' && !Array.isArray(existingValue)) {
        return mergePlainObject(existingValue, incomingValue);
      }
      return incomingValue;
    }
    return existingValue;
  }

  function collectGroupData(groupId, { includeMissing = false } = {}) {
    const group = DATA_GROUPS[groupId];
    if (!group) throw new Error('알 수 없는 백업 그룹입니다.');

    const data = {};
    const stats = {};
    group.keys.forEach(key => {
      const raw = storageAdapter.readRaw(key);
      if (raw.exists || includeMissing) {
        data[key] = raw.exists ? raw.value : null;
        stats[key] = raw.exists ? 1 : 0;
      }
    });

    if (groupId === 'all') {
      const preserved = storageAdapter.read(KEYS.preservedUnknown, null);
      if (preserved && Object.keys(preserved).length) {
        data[KEYS.preservedUnknown] = preserved;
      }
    }

    return { data, stats };
  }

  function buildBackupPayload(groupId, { includeMissing = false } = {}) {
    const group = DATA_GROUPS[groupId];
    const { data } = collectGroupData(groupId, { includeMissing });
    return {
      format: SCHEMA.backupFormat,
      formatVersion: SCHEMA.backupFormatVersion,
      schemaVersion: getSchemaVersion(),
      group: group.id,
      groupLabel: group.label,
      exportedAt: new Date().toISOString(),
      keyNames: Object.keys(data),
      data
    };
  }

  function validateBackupPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('백업 파일 형식이 올바르지 않습니다.');
    }
    if (payload.format !== SCHEMA.backupFormat) {
      throw new Error('BREM 백업 파일이 아닙니다.');
    }
    if (!payload.data || typeof payload.data !== 'object') {
      throw new Error('백업 데이터가 비어 있습니다.');
    }
    return payload;
  }

  const dataBackup = {
    SCHEMA,
    DATA_GROUPS,
    KEYS,
    getSchemaVersion,
    runMigrations: runDataMigrations,

    getStatus() {
      const groups = {};
      Object.values(DATA_GROUPS).forEach(group => {
        let storedKeys = 0;
        group.keys.forEach(key => {
          if (storageAdapter.has(key)) storedKeys += 1;
        });
        groups[group.id] = {
          label: group.label,
          description: group.description,
          storedKeys,
          totalKeys: group.keys.length
        };
      });
      return {
        schemaVersion: getSchemaVersion(),
        currentSchemaVersion: SCHEMA.currentVersion,
        bremKeyCount: storageAdapter.listBremKeys().length,
        groups
      };
    },

    exportGroup(groupId, options) {
      return buildBackupPayload(groupId, options);
    },

    importPayload(payload, { mode = 'merge', groupId = null } = {}) {
      const parsed = validateBackupPayload(payload);
      const allowedKeys = groupId && DATA_GROUPS[groupId]
        ? new Set(DATA_GROUPS[groupId].keys)
        : null;
      const importedKeys = [];
      const skippedKeys = [];
      const guard = window.BremStorageGuard;

      Object.entries(parsed.data).forEach(([key, incomingValue]) => {
        if (!String(key).startsWith('brem_')) {
          skippedKeys.push(key);
          return;
        }
        if (allowedKeys && !allowedKeys.has(key) && key !== KEYS.preservedUnknown) {
          skippedKeys.push(key);
          return;
        }

        if (guard?.isTablePersistKey?.(key) && guard.isEmptyCollection(incomingValue)) {
          skippedKeys.push(key);
          return;
        }

        if (mode === 'replace') {
          try {
            assertPersistAllowed(key, incomingValue, { allowEmpty: false });
          } catch (error) {
            skippedKeys.push(key);
            return;
          }
          storageAdapter.write(key, incomingValue);
          importedKeys.push(key);
          return;
        }

        const raw = storageAdapter.readRaw(key);
        const nextValue = raw.exists
          ? mergeImportedValue(key, raw.value, incomingValue)
          : incomingValue;
        try {
          assertPersistAllowed(key, nextValue, { allowEmpty: false });
        } catch (error) {
          skippedKeys.push(key);
          return;
        }
        storageAdapter.write(key, nextValue);
        importedKeys.push(key);
      });

      finalizeStorageReady();
      return {
        mode,
        importedKeys,
        skippedKeys,
        group: parsed.group,
        importedAt: new Date().toISOString()
      };
    },

    downloadJson(payload, filename) {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },

    buildFilename(groupId) {
      const group = DATA_GROUPS[groupId] || DATA_GROUPS.all;
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      return `BREM_${group.id}_${stamp}.json`;
    }
  };

  function invalidateLeaseVehicleCaches() {
    window.BremDataCache?.invalidate?.(KEYS.leaseVehicles);
    window.BremDataCache?.invalidate?.(KEYS.leases);
    activeStorageAdapter.invalidateKeys?.([KEYS.leaseVehicles, KEYS.leases]);
  }

  async function ensureLeaseErpKeysLoaded(options = {}) {
    const targetKeys = [
      KEYS.leaseVehicles,
      KEYS.leasePayments,
      KEYS.leaseAccidents,
      KEYS.leaseMaintenance,
      KEYS.leaseContracts,
      KEYS.leaseProfitLogs,
      KEYS.leaseArrears
    ];
    if (!activeStorageAdapter?.ensureKeysLoaded) return { ok: true };
    await activeStorageAdapter.ensureKeysLoaded(targetKeys, options);
    return { ok: true };
  }

  function readTableKey(key) {
    return storageAdapter.read(key, []) || [];
  }

  function writeTableKey(key, list, options = {}) {
    const next = Array.isArray(list) ? list : [];
    window.BremDataCache?.set?.(key, next, { source: 'write' });
    const result = storageAdapter.write(key, next, options);
    if (result === undefined) {
      throw new Error('Supabase 저장 준비가 되지 않았습니다. 로그인 상태를 확인한 뒤 다시 시도하세요.');
    }
    return result;
  }

  return {
    createId,
    STORAGE_KEYS: KEYS,
    SCHEMA,
    DATA_GROUPS,
    dataBackup,
    getStorageBackend,
    getStorageBackendPreference,
    setStorageBackendPreference,
    getSupabaseConfig,
    getStorageStatus,
    getPayrollStorageStatus,
    isPayrollLocalStorageMode,
    isLocalDevBackend,
    hydratePayrollLocalCache,
    getSupabaseClient,
    ensureSupabaseClient,
    waitForStorageBootstrap,
    startStorageBootstrap,
    resolveAdminAccessToken,
    loadSupabaseProfile,
    enforceProductionStorageGuard,
    useLocalStorageAdapter,
    flushStorage: flushActiveStorage,
    awaitPersist,
    reloadDrivers,
    searchDriversAndMerge,
    fetchAllDriversFromServer,
    awaitDriversFullyLoaded,
    waitForDriversFetch,
    fetchRiderViaServer,
    dedupeDriversList,
    refreshDriversForSettlementMatch,
    reloadMissions,
    reloadNotices,
    fetchRiderNoticesFromServer,
    invalidateNoticesCache,
    getMissionsTableStatus,
    syncAllDriversPagesInBackground,
    verifyRiderPersisted,
    mergeRiderInCache,
    ensureDriverStorageReady,
    fetchCurrentRiderFromServer,
    fetchRiderAssignedMissionsFromServer,
    fetchRiderDashboardFromServer,
    fetchRiderWeeklyPayslipFromServer,
    fetchRiderRegionDashboardFromServer,
    fetchRiderWithdrawalFromServer,
    submitRiderWithdrawalToServer,
    fetchAdminWithdrawalRequestsFromServer,
    cancelAdminWithdrawalRequest,
    completeAdminWithdrawalRequest,
    updateAdminWithdrawalRequestPlatform,
    autoFixAdminWithdrawalPlatforms,
    publishDirectSettlementPayslips,
    deleteAdminWithdrawalRequest,
    loadDriverAppBundle,
    getDriverAppPublishedAt,
    fetchRiderPublishStatus,
    checkDriverAppPublishUpdate,
    invalidateDriverAppCache,
    clearRiderLiveOpsCache,
    purgeLegacyAuthFromLocalStorage,
    waitForSupabaseReady,
    ensureSupabaseHydrated,
    ensureLeaseErpKeysLoaded,
    invalidateLeaseVehicleCaches,
    readTableKey,
    writeTableKey,
    persistLeaseErpTableViaServer,
    ensureSectionLoaded,
    ensureCallsSinceDate,
    ensureLongEventCallsLoaded,
    ensurePromotionCalculationCalls,
    isSectionCacheReady,
    isBootstrapComplete,
    loadBootstrapData,
    getCacheStatus,
    refreshDataFromServer,
    refetchDataKey,
    adminPreferences,
    getMissingOperationTables() {
      return activeStorageAdapter.getMissingOperationTables?.() || [];
    },
    hydrateAdminDataInBackground,
    hydrateDriverAppData,
    isDriverAppCacheReady,
    getRiderBaeminOps,
    refreshRiderBaeminOps,
    getRiderCoupangOps,
    refreshRiderCoupangOps,
    syncAdminDataInBackground,
    resumeSupabaseAfterAuth,
    initStorage,
    initSupabaseStorage,
    migrateLocalStorageToSupabase,
    drivers,
    calls,
    callEditLogs,
    rejections,
    riderViewPublish,
    targets,
    weeklyTargets,
    notices,
    missions,
    ensureMissionsLoaded,
    riderInquiries,
    adminSchedules,
    payrollSlipUploads,
    payrollSlipLines,
    payrollNotices,
    payrollDailySettlement,
    payrollWithdrawal,
    payrollPublish,
    leases,
    revenue,
    events,
    settlements,
    settlementUnmatched,
    settlementUploadLogs,
    missionDefaults,
    promotionRules,
    isBuiltinPromotionRule,
    getUserPromotionRules,
    promotionSettings,
    promotionSelectorOptions,
    weeklySettlements,
    resolveWeeklySettlementPlatform,
    promotionApplyResults,
    manualNameMappings,
    directPayAdjustments,
    directSettlementAdjustments,
    directRetroAdjustments,
    leaseLoans,
    computeLoanDeductSchedule,
    loanChargeInDateRange,
    addDaysToDateKey,
    deductionLedger,
    driverOrgChart: {
      get() {
        const raw = storageAdapter.read(KEYS.driverOrgChart, null);
        const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
        return {
          nodes: nodes.map((node, index) => ({
            id: String(node.id || '').trim() || createId(),
            label: String(node.label || '').trim() || `박스 ${index + 1}`,
            parentId: node.parentId ? String(node.parentId) : '',
            memberRefs: Array.isArray(node.memberRefs)
              ? node.memberRefs
                .map(ref => ({
                  kind: ref?.kind === 'admin' ? 'admin' : 'driver',
                  id: String(ref?.id || '').trim()
                }))
                .filter(ref => ref.id)
              : [],
            sortOrder: Number.isFinite(Number(node.sortOrder)) ? Number(node.sortOrder) : index
          }))
        };
      },
      save(chart) {
        const nodes = Array.isArray(chart?.nodes) ? chart.nodes : [];
        const payload = {
          nodes,
          updatedAt: new Date().toISOString()
        };
        return storageAdapter.write(KEYS.driverOrgChart, payload).then(() => payload);
      }
    },
    auth
  };
})();

window.BremStorage = BremStorage;

// 기존 코드 호환용 alias (신규 코드는 BremStorage 사용)
const DriverStorage = {
  createId: () => BremStorage.createId(),
  getAll: () => BremStorage.drivers.getAll(),
  saveAll: drivers => BremStorage.drivers.saveAll(drivers),
  create: driver => BremStorage.drivers.create(driver),
  update: (id, changes) => BremStorage.drivers.update(id, changes),
  remove: id => BremStorage.drivers.remove(id)
};

BremStorage.startStorageBootstrap?.();
