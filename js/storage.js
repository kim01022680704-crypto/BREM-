/**
 * BREM 데이터 저장소
 *
 * 현재: localStorage / sessionStorage
 * 추후 Supabase 전환 시 이 파일의 adapter 구현만 교체하면 됩니다.
 */
const BremStorage = (function () {
  const KEYS = Object.freeze({
    drivers: 'brem_driver_management_drivers',
    calls: 'brem_admin_calls',
    rejections: 'brem_admin_rejection_rates',
    targets: 'brem_admin_targets',
    weeklyTargets: 'brem_driver_weekly_targets',
    notices: 'brem_admin_notices',
    riderInquiries: 'brem_rider_inquiries',
    adminSchedules: 'brem_admin_schedules',
    leases: 'brem_admin_leases',
    revenue: 'brem_admin_revenue',
    eventCatalog: 'brem_admin_long_event_catalog',
    eventItems: 'brem_admin_long_event_items',
    eventConfig: 'brem_admin_long_event_config',
    legacyBikes: 'brem_admin_driver_bikes',
    legacyMission: 'brem_admin_mission_config',
    settlements: 'brem_admin_settlements',
    settlementUnmatched: 'brem_admin_settlement_unmatched',
    promotionRules: 'brem_admin_promotion_rules',
    promotionSettings: 'brem_admin_promotion_settings',
    promotionSelectorOptions: 'brem_admin_promotion_selector_options',
    weeklySettlements: 'brem_admin_weekly_settlements',
    manualNameMappings: 'brem_admin_manual_name_mappings',
    promotionApplyResults: 'brem_admin_promotion_apply_results',
    preservedUnknown: 'brem_preserved_unknown_storage',
    adminAccounts: 'brem_admin_accounts',
    adminCredentials: 'brem_admin_credentials'
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
    driverId: 'brem_driver_logged_in_id'
  };

  const STORAGE_BACKEND_PREF_KEY = 'brem_storage_backend_preference';
  let lastSupabaseError = '';
  let activeSupabaseClient = null;
  let activeSupabaseProfile = null;

  const DEFAULT_PLATFORM = 'coupang';

  function normalizePlatform(value) {
    if (typeof BremPlatforms !== 'undefined') return BremPlatforms.normalize(value);
    if (value === 'combined') return 'combined';
    return value === 'baemin' ? 'baemin' : 'coupang';
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

    if (migrated) storageAdapter.write(KEYS.calls, normalized);
    return normalized;
  }

  function normalizeSettlements(list) {
    if (!Array.isArray(list) || !list.length) return [];

    let migrated = false;
    const normalized = list.map(item => {
      const platform = normalizePlatform(item.platform);
      const next = {
        ...item,
        platform,
        riderId: item.riderId || '',
        deliveryAmount: Number(item.deliveryAmount ?? item.settlementAmount ?? 0),
        id: `${item.driverId}-${item.period}-${platform}`
      };
      if (item.platform !== platform || item.id !== next.id) migrated = true;
      return next;
    });

    if (migrated) storageAdapter.write(KEYS.settlements, normalized);
    return normalized;
  }

  function normalizeSettlementUnmatched(list) {
    if (!Array.isArray(list) || !list.length) return [];

    let migrated = false;
    const normalized = list.map(item => {
      const platform = normalizePlatform(item.platform);
      const periodKey = String(item.period || '').slice(0, 10);
      const nameKey = String(item.rawName || item.name || '').replace(/\s/g, '');
      const next = {
        ...item,
        platform,
        id: `${periodKey}-${platform}-${nameKey}`
      };
      if (item.platform !== platform || item.id !== next.id) migrated = true;
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

  // Supabase 전환 시 activeStorageAdapter만 교체합니다.
  const localAdapter = {
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    readRaw(key) {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return { exists: false, value: null };
        return { exists: true, value: JSON.parse(raw) };
      } catch {
        return { exists: true, value: null, parseError: true };
      }
    },
    write(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
    remove(key) {
      localStorage.removeItem(key);
    },
    has(key) {
      return localStorage.getItem(key) !== null;
    },
    listBremKeys() {
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith('brem_')) keys.push(key);
      }
      return keys.sort();
    }
  };

  const blockedProductionAdapter = {
    type: 'blocked',
    read(key, fallback) {
      return fallback;
    },
    readRaw() {
      return { exists: false, value: null };
    },
    write() {
      throw new Error('운영 모드에서는 Supabase Auth 연결 전 localStorage 저장이 차단됩니다.');
    },
    remove() {
      throw new Error('운영 모드에서는 Supabase Auth 연결 전 localStorage 삭제가 차단됩니다.');
    },
    has() {
      return false;
    },
    listBremKeys() {
      return [];
    }
  };

  let activeStorageAdapter = window.BREM_SUPABASE_CONFIG?.mode === 'production'
    ? blockedProductionAdapter
    : localAdapter;

  const storageAdapter = {
    read(key, fallback) {
      return activeStorageAdapter.read(key, fallback);
    },
    readRaw(key) {
      return activeStorageAdapter.readRaw(key);
    },
    write(key, value) {
      return activeStorageAdapter.write(key, value);
    },
    remove(key) {
      return activeStorageAdapter.remove(key);
    },
    has(key) {
      return activeStorageAdapter.has(key);
    },
    listBremKeys() {
      return activeStorageAdapter.listBremKeys();
    }
  };

  function getStorageBackend() {
    if (activeStorageAdapter.type === 'blocked') return 'blocked';
    return activeStorageAdapter.type === 'supabase' ? 'supabase' : 'local';
  }

  function getStorageBackendPreference() {
    try {
      const saved = localStorage.getItem(STORAGE_BACKEND_PREF_KEY);
      return saved === 'supabase' ? 'supabase' : 'local';
    } catch {
      return 'local';
    }
  }

  function setStorageBackendPreference(backend) {
    try {
      localStorage.setItem(STORAGE_BACKEND_PREF_KEY, backend === 'supabase' ? 'supabase' : 'local');
    } catch {
      /* ignore */
    }
  }

  function getSupabaseConfig() {
    const config = window.BREM_SUPABASE_CONFIG || {};
    const mode = config.mode === 'production' ? 'production' : 'development';
    const initialAdmin = config.initialAdmin || {};
    return {
      url: String(config.url || '').trim(),
      anonKey: String(config.anonKey || '').trim(),
      backend: config.backend === 'supabase' ? 'supabase' : 'local',
      mode,
      allowLocalFallback: mode !== 'production' && config.allowLocalFallback !== false,
      functionsUrl: String(config.functionsUrl || '').trim(),
      isConfigured: Boolean(String(config.url || '').trim() && String(config.anonKey || '').trim()),
      initialAdmin: {
        loginName: String(initialAdmin.loginName || '관리자').trim() || '관리자',
        email: String(initialAdmin.email || '').trim()
      }
    };
  }

  function resolveAdminLoginInput(input) {
    const value = String(input || '').trim();
    if (!value) return value;
    if (value.includes('@')) return value;

    const { loginName, email } = getSupabaseConfig().initialAdmin;
    if (value === loginName && email) return email;
    return value;
  }

  function getStorageStatus() {
    const config = getSupabaseConfig();
    return {
      backend: getStorageBackend(),
      preference: getStorageBackendPreference(),
      mode: config.mode,
      allowLocalFallback: config.allowLocalFallback,
      supabaseConfigured: config.isConfigured,
      supabaseHydrated: activeStorageAdapter.type === 'supabase' && activeStorageAdapter.isHydrated?.() === true,
      supabaseError: lastSupabaseError
    };
  }

  function useLocalStorageAdapter() {
    activeStorageAdapter = localAdapter;
    setStorageBackendPreference('local');
    return getStorageBackend();
  }

  async function initSupabaseStorage(config) {
    const settings = config || window.BREM_SUPABASE_CONFIG;
    if (!settings?.url || !settings?.anonKey) {
      throw new Error('Supabase url / anonKey 설정이 필요합니다.');
    }
    if (!window.supabase?.createClient) {
      throw new Error('@supabase/supabase-js 가 로드되지 않았습니다.');
    }
    if (!window.BremSupabaseStorageAdapter?.createSupabaseAdapter) {
      throw new Error('storage-supabase-adapter.js 가 로드되지 않았습니다.');
    }
    const client = window.supabase.createClient(settings.url, settings.anonKey);
    const { data: sessionData } = await client.auth.getSession();
    const isProduction = settings.mode === 'production';
    if (isProduction && !sessionData?.session) {
      throw new Error('운영 모드에서는 Supabase Auth 로그인이 필요합니다.');
    }
    activeSupabaseClient = client;
    if (sessionData?.session) {
      const { data: profile, error: profileError } = await client
        .from('profiles')
        .select('*')
        .eq('user_id', sessionData.session.user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      activeSupabaseProfile = profile || null;
    }
    const adapter = window.BremSupabaseStorageAdapter.createSupabaseAdapter(client, KEYS);
    await adapter.hydrate();
    activeStorageAdapter = adapter;
    setStorageBackendPreference('supabase');
    lastSupabaseError = '';
    return { backend: 'supabase', client, adapter };
  }

  async function initStorage(options = {}) {
    const config = {
      ...getSupabaseConfig(),
      ...(options.config || {})
    };
    let backend = options.backend || config.backend || 'local';
    if (config.backend === 'local') {
      backend = 'local';
    } else if (!options.backend) {
      backend = getStorageBackendPreference() || config.backend || 'local';
    }
    if (backend === 'supabase') {
      if (!config.url || !config.anonKey) {
        lastSupabaseError = 'Supabase url / anonKey가 js/supabase-config.js 에 설정되지 않았습니다.';
        if (config.allowLocalFallback) {
          useLocalStorageAdapter();
          return { backend: 'local', fallback: true, error: lastSupabaseError };
        }
        throw new Error(lastSupabaseError);
      }
      try {
        return await initSupabaseStorage(config);
      } catch (error) {
        lastSupabaseError = error.message || 'Supabase 연결에 실패했습니다.';
        if (config.allowLocalFallback) {
          console.warn('[BREM] Supabase init failed. Falling back to localStorage:', error);
          useLocalStorageAdapter();
          return { backend: 'local', fallback: true, error: lastSupabaseError };
        }
        console.error('[BREM] Supabase init failed in production mode:', error);
        throw error;
      }
    }
    if (config.mode === 'production') {
      throw new Error('운영 모드에서는 localStorage 저장 모드를 사용할 수 없습니다.');
    }
    lastSupabaseError = '';
    useLocalStorageAdapter();
    return { backend: 'local' };
  }

  async function migrateLocalStorageToSupabase(client, options) {
    if (!window.BremSupabaseMigration?.migrateLocalStorageToSupabase) {
      throw new Error('storage-migrate-supabase.js 가 로드되지 않았습니다.');
    }
    return window.BremSupabaseMigration.migrateLocalStorageToSupabase(client, options);
  }

  function getSupabaseClient() {
    if (activeSupabaseClient) return activeSupabaseClient;
    const config = getSupabaseConfig();
    if (!config.url || !config.anonKey || !window.supabase?.createClient) return null;
    activeSupabaseClient = window.supabase.createClient(config.url, config.anonKey);
    return activeSupabaseClient;
  }

  async function loadSupabaseProfile() {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data: sessionData } = await client.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) {
      activeSupabaseProfile = null;
      return null;
    }
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    activeSupabaseProfile = data || null;
    return activeSupabaseProfile;
  }

  async function signInWithSupabase(email, password, expectedRole) {
    const client = getSupabaseClient();
    if (!client) return { ok: false, message: 'Supabase 설정이 필요합니다.' };
    const { data, error } = await client.auth.signInWithPassword({
      email: String(email || '').trim(),
      password: String(password || '')
    });
    if (error) return { ok: false, message: error.message || '로그인에 실패했습니다.' };
    const profile = await loadSupabaseProfile();
    if (!profile?.active || (expectedRole && profile.role !== expectedRole)) {
      await client.auth.signOut();
      return { ok: false, message: '접근 권한이 없습니다.' };
    }
    return { ok: true, user: data.user, profile };
  }

  const ADMIN_SESSION_KEYS = new Set([
    SESSION_KEYS.adminLoggedIn,
    SESSION_KEYS.adminAccountId
  ]);

  const sessionAdapter = {
    read(key) {
      const fromSession = sessionStorage.getItem(key);
      if (fromSession !== null) return fromSession;
      if (ADMIN_SESSION_KEYS.has(key)) {
        return localStorage.getItem(key);
      }
      return null;
    },
    write(key, value) {
      sessionStorage.setItem(key, value);
      if (ADMIN_SESSION_KEYS.has(key)) {
        localStorage.setItem(key, value);
      }
    },
    remove(key) {
      sessionStorage.removeItem(key);
      if (ADMIN_SESSION_KEYS.has(key)) {
        localStorage.removeItem(key);
      }
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
        hiddenFields: normalizeHiddenFields(next.hiddenFields)
      };

      if (
        next.residentNumber !== withPlatforms.residentNumber
        || next.password !== withPlatforms.password
        || next.baeminId !== withPlatforms.baeminId
        || next.platformCoupang !== withPlatforms.platformCoupang
        || next.platformBaemin !== withPlatforms.platformBaemin
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
    if (migrated) storageAdapter.write(KEYS.drivers, normalizedDrivers);
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
      const list = storageAdapter.read(KEYS.drivers, []);
      return normalizeDrivers(list);
    },

    getById(id) {
      return drivers.getAll().find(driver => driver.id === id) || null;
    },

    saveAll(nextDrivers) {
      storageAdapter.write(KEYS.drivers, nextDrivers);
    },

    create(driver) {
      const list = drivers.getAll();
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
        longEventItemId: driver.longEventItemId || '',
        longEventItem: driver.longEventItem || '',
        longEventStartDate: driver.longEventStartDate || '',
        joinDate: driver.joinDate,
        memo: driver.memo,
        status: driver.status,
        hiddenFields: normalizeHiddenFields(driver.hiddenFields),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      list.unshift(newDriver);
      drivers.saveAll(list);
      return newDriver;
    },

    update(id, changes) {
      const nextDrivers = drivers.getAll().map(driver => {
        if (driver.id !== id) return driver;
        const merged = { ...driver, ...changes };
        if ('password' in changes || 'residentNumber' in changes) {
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
      drivers.saveAll(nextDrivers);
    },

    remove(id) {
      drivers.saveAll(drivers.getAll().filter(driver => driver.id !== id));
    },

    resetPassword(id, defaultPassword = '1234') {
      const driver = drivers.getById(id);
      if (!driver) throw new Error('기사를 찾을 수 없습니다.');
      const password = String(defaultPassword || '1234').trim() || '1234';
      return drivers.update(id, { password });
    },

    setFieldHidden(id, fieldKey, hidden) {
      const driver = drivers.getById(id);
      if (!driver) throw new Error('기사를 찾을 수 없습니다.');
      const nextHiddenFields = { ...(driver.hiddenFields || {}) };
      if (hidden) nextHiddenFields[fieldKey] = true;
      else delete nextHiddenFields[fieldKey];
      drivers.update(id, { hiddenFields: nextHiddenFields });
      return drivers.getById(id);
    },

    setFieldHiddenForAll(fieldKey, hidden) {
      const list = drivers.getAll();
      if (!list.length) return 0;
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
      drivers.saveAll(nextDrivers);
      return nextDrivers.length;
    }
  };

  const calls = {
    getAll() {
      return normalizeCalls(storageAdapter.read(KEYS.calls, []));
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
      storageAdapter.write(KEYS.calls, list);
      return list;
    },

    upsertDaily({ driverId, date, count, platform = DEFAULT_PLATFORM }) {
      const p = normalizePlatform(platform);
      const list = calls.getAll().filter(call => !(call.driverId === driverId && call.date === date && normalizePlatform(call.platform) === p));
      list.push({
        id: `${driverId}-${date}-${p}`,
        driverId,
        date,
        platform: p,
        count: Number(count)
      });
      storageAdapter.write(KEYS.calls, list);
      return list;
    },

    sumForDriverSince(driverId, startDate) {
      if (!startDate) return 0;
      return calls.getAll()
        .filter(call => call.driverId === driverId && call.date >= startDate)
        .reduce((sum, call) => sum + Number(call.count || 0), 0);
    },

    removeById(id) {
      storageAdapter.write(KEYS.calls, calls.getAll().filter(call => call.id !== id));
    }
  };

  const rejections = {
    getAll() {
      const list = storageAdapter.read(KEYS.rejections, []);
      return migrateRejectionsPlatform(normalizeRejections(list));
    },

    upsertWeekly({ driverId, weekStart, rate, platform = DEFAULT_PLATFORM }) {
      const p = normalizePlatform(platform);
      const list = rejections.getAll().filter(item => !(item.driverId === driverId && item.weekStart === weekStart && normalizePlatform(item.platform) === p));
      list.push({
        id: `${driverId}-${weekStart}-${p}`,
        driverId,
        weekStart,
        platform: p,
        rate: Number(rate),
        updatedAt: new Date().toISOString()
      });
      storageAdapter.write(KEYS.rejections, list);
      return list;
    },

    removeById(id) {
      storageAdapter.write(KEYS.rejections, rejections.getAll().filter(item => item.id !== id));
    },

    getRateForWeek(driverId, weekStart, platform = DEFAULT_PLATFORM) {
      const p = normalizePlatform(platform);
      const entry = rejections.getAll().find(item => item.driverId === driverId && item.weekStart === weekStart && normalizePlatform(item.platform) === p);
      return entry ? Number(entry.rate) : null;
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

    upsertMonthly({ driverId, month, count }) {
      const list = targets.getAll().filter(item => !(item.driverId === driverId && item.month === month));
      list.push({
        id: `${driverId}-${month}`,
        driverId,
        month,
        count: Number(count)
      });
      storageAdapter.write(KEYS.targets, list);
      return list;
    },

    removeById(id) {
      storageAdapter.write(KEYS.targets, targets.getAll().filter(item => item.id !== id));
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

    upsert({ driverId, weekStart, count }) {
      const list = weeklyTargets.getAll().filter(item => !(item.driverId === driverId && item.weekStart === weekStart));
      list.push({
        id: `${driverId}-${weekStart}`,
        driverId,
        weekStart,
        count: Number(count)
      });
      storageAdapter.write(KEYS.weeklyTargets, list);
      return list;
    },

    removeById(id) {
      storageAdapter.write(KEYS.weeklyTargets, weeklyTargets.getAll().filter(item => item.id !== id));
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

    create(data) {
      const list = notices.getAll();
      list.unshift({
        id: createId(),
        title: data.title,
        content: data.content,
        pinned: Boolean(data.pinned),
        createdAt: new Date().toISOString()
      });
      storageAdapter.write(KEYS.notices, list);
      return list;
    },

    update(id, data) {
      const list = notices.getAll().map(notice => (
        notice.id === id ? { ...notice, ...data } : notice
      ));
      storageAdapter.write(KEYS.notices, list);
      return list;
    },

    removeById(id) {
      storageAdapter.write(KEYS.notices, notices.getAll().filter(notice => notice.id !== id));
    }
  };

  const INQUIRY_TYPES = Object.freeze([
    '라이더 지원',
    '협력사문의',
    '리스/렌탈 상담',
    '기타 문의'
  ]);

  const riderInquiries = {
    INQUIRY_TYPES,

    readLocalRaw() {
      try {
        const raw = localStorage.getItem(KEYS.riderInquiries);
        if (raw === null) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },

    shouldUseLocalRaw() {
      const config = getSupabaseConfig();
      return config.backend === 'local' || config.mode !== 'production';
    },

    persistList(list) {
      const next = Array.isArray(list) ? list : [];
      if (riderInquiries.shouldUseLocalRaw()) {
        try {
          localStorage.setItem(KEYS.riderInquiries, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
      storageAdapter.write(KEYS.riderInquiries, next);
      return next;
    },

    getAll() {
      if (riderInquiries.shouldUseLocalRaw()) {
        return riderInquiries.readLocalRaw();
      }
      return storageAdapter.read(KEYS.riderInquiries, []);
    },

    syncFromLocalRaw() {
      const localList = riderInquiries.readLocalRaw();
      if (!riderInquiries.shouldUseLocalRaw()) return riderInquiries.getAll();
      riderInquiries.persistList(localList);
      return localList;
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

    create(data) {
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
      storageAdapter.write(KEYS.adminSchedules, list);
      return next;
    },

    update(id, data) {
      const list = adminSchedules.getAll().map(item => {
        if (item.id !== id) return item;
        return {
          ...item,
          title: data.title != null ? String(data.title).trim() : item.title,
          memo: data.memo != null ? String(data.memo).trim() : item.memo,
          createdBy: data.createdBy != null ? String(data.createdBy).trim() : item.createdBy,
          updatedAt: new Date().toISOString()
        };
      });
      storageAdapter.write(KEYS.adminSchedules, list);
      return list.find(item => item.id === id) || null;
    },

    removeById(id) {
      adminSchedules.removeByIds([id]);
    },

    removeByIds(ids) {
      const idSet = new Set((Array.isArray(ids) ? ids : []).map(value => String(value || '').trim()).filter(Boolean));
      if (!idSet.size) return;
      storageAdapter.write(
        KEYS.adminSchedules,
        adminSchedules.getAll().filter(item => !idSet.has(item.id))
      );
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
      if (!item || item.contractType !== leases.CONTRACT_TYPES.LEASE) return false;
      if (!leases.hasActiveContract(item)) return false;
      if (leases.hasActiveRentalAssignment(item)) return false;
      if (String(item.renter || '').trim()) return false;
      if (String(item.lessor || '').trim()) return false;
      return true;
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

    getAll() {
      return storageAdapter.read(KEYS.leases, []);
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
      storageAdapter.write(KEYS.leases, list);
      return next;
    },

    update(id, data) {
      const existing = leases.getById(id);
      if (!existing) return null;
      const list = leases.getAll().map(item => (
        item.id === id ? leases.normalizeRecord(data, existing) : item
      ));
      storageAdapter.write(KEYS.leases, list);
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
      leases.removeByIds([id]);
    },

    removeByIds(ids) {
      const idSet = new Set((Array.isArray(ids) ? ids : []).map(value => String(value || '').trim()).filter(Boolean));
      if (!idSet.size) return;
      storageAdapter.write(
        KEYS.leases,
        leases.getAll().filter(item => !idSet.has(item.id))
      );
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

    getStartDateForDriver(driver) {
      return driver.longEventStartDate || '';
    },

    eventCallsForDriver(driver) {
      const startDate = events.getStartDateForDriver(driver);
      if (!startDate) return 0;
      return calls.sumForDriverSince(driver.id, startDate);
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
      const map = events.getDriverItemMap();
      const catalog = events.getCatalog();
      const selected = map[driver.id] || driver.longEventItemId || driver.longEventItem || '';
      return catalog.find(item => item.id === selected || item.name === selected) || null;
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

      const nextRecords = records.map(record => ({
        id: `${record.driverId}-${period}-${p}`,
        driverId: record.driverId,
        period,
        platform: p,
        riderId: record.riderId || '',
        orderCount: Number(record.orderCount ?? record.callCount ?? 0),
        settlementAmount: Number(record.settlementAmount ?? record.deliveryAmount ?? 0),
        deliveryAmount: Number(record.deliveryAmount ?? record.settlementAmount ?? 0),
        appliedAt: new Date().toISOString()
      }));

      nextRecords.forEach(record => {
        calls.upsertDaily({
          driverId: record.driverId,
          date: callDate,
          count: record.orderCount,
          platform: p
        });
      });

      const keepIds = new Set(nextRecords.map(record => record.id));
      const list = settlements.getAll().filter(item => !keepIds.has(item.id));
      list.unshift(...nextRecords);
      storageAdapter.write(KEYS.settlements, list);
      return list;
    },

    removeById(id) {
      storageAdapter.write(KEYS.settlements, settlements.getAll().filter(item => item.id !== id));
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
      applyGlobalAcceptBlock: rule.applyGlobalAcceptBlock !== false,
      priority: Number(rule.priority ?? 100),
      allowDuplicate: Boolean(rule.allowDuplicate),
      duplicateStrategy: rule.duplicateStrategy || 'highest_priority',
      noPayConditions: String(rule.noPayConditions || '').trim(),
      createdAt: rule.createdAt || new Date().toISOString(),
      updatedAt: rule.updatedAt || new Date().toISOString()
    };
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

  function patchCombinedPromotionRules(list) {
    if (!Array.isArray(list) || !list.length) return list;
    let changed = false;
    const next = list.map(item => {
      if (String(item.platform || '').trim() !== 'combined') return item;
      if (item.applyGlobalAcceptBlock === false) return item;
      changed = true;
      return { ...item, applyGlobalAcceptBlock: false, updatedAt: new Date().toISOString() };
    });
    if (changed) storageAdapter.write(KEYS.promotionRules, next);
    return changed ? storageAdapter.read(KEYS.promotionRules, []) : list;
  }

  function ensureCombinedPromotionRule() {
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
      if (storageAdapter.read(KEYS.promotionSettings, null) === null) {
        storageAdapter.write(KEYS.promotionSettings, buildDefaultPromotionSettings());
      }
      return normalizePromotionSettings(storageAdapter.read(KEYS.promotionSettings, null));
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
      if (storageAdapter.read(KEYS.promotionSelectorOptions, null) === null) {
        storageAdapter.write(KEYS.promotionSelectorOptions, normalizeSelectorOptions(null));
      }
      return normalizeSelectorOptions(storageAdapter.read(KEYS.promotionSelectorOptions, null));
    },

    saveAll(list) {
      storageAdapter.write(KEYS.promotionSelectorOptions, normalizeSelectorOptions(list));
      return promotionSelectorOptions.getAll();
    }
  };

  const promotionRules = {
    getAll() {
      if (storageAdapter.read(KEYS.promotionRules, null) === null) {
        storageAdapter.write(KEYS.promotionRules, buildExamplePromotionRules());
      } else {
        ensureCombinedPromotionRule();
      }
      let list = storageAdapter.read(KEYS.promotionRules, []);
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
      const next = normalizePromotionRule({
        ...rule,
        id: createId(),
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
      promotionRules.saveAll(promotionRules.getAll().filter(rule => rule.id !== id));
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
    const riders = Array.isArray(record.riders)
      ? record.riders.map(rider => {
        let matchedRiderId = String(rider.matchedRiderId || '').trim();
        let baeminUserId = String(rider.baeminUserId || '').trim();
        if (platform === 'baemin') {
          if (typeof BremWeeklySettlement !== 'undefined'
            && typeof BremWeeklySettlement.normalizeBaeminUserId === 'function') {
            baeminUserId = BremWeeklySettlement.normalizeBaeminUserId(baeminUserId);
          }
          if (!matchedRiderId && baeminUserId) {
            const resolved = drivers.getAll().find(item => {
              const driverId = typeof BremWeeklySettlement !== 'undefined'
                && typeof BremWeeklySettlement.normalizeBaeminUserId === 'function'
                ? BremWeeklySettlement.normalizeBaeminUserId(item.baeminId)
                : String(item.baeminId || '').trim();
              return driverId && driverId === baeminUserId;
            });
            if (resolved) matchedRiderId = resolved.id;
          }
        }
        const driver = matchedRiderId ? drivers.getById(matchedRiderId) : null;
        if (platform === 'baemin' && !baeminUserId && driver?.baeminId) {
          baeminUserId = typeof BremWeeklySettlement !== 'undefined'
            && typeof BremWeeklySettlement.normalizeBaeminUserId === 'function'
            ? BremWeeklySettlement.normalizeBaeminUserId(driver.baeminId)
            : String(driver.baeminId || '').trim();
        }
        return {
          originalName: String(rider.originalName || ''),
          riderName: String(rider.riderName || ''),
          driverName: String(rider.driverName || driver?.name || rider.riderName || ''),
          matchedRiderId,
          matched: Boolean(matchedRiderId || rider.matched),
          weeklyOrderCount: Number(rider.weeklyOrderCount || 0),
          systemCallCount: Number(rider.systemCallCount || 0),
          callCountMatched: rider.callCountMatched !== false,
          coupangLoginKey: String(rider.coupangLoginKey || ''),
          baeminUserId,
          warnings: Array.isArray(rider.warnings) ? rider.warnings.map(String) : []
        };
      })
      : [];

    const summary = record.summary || {
      totalExtracted: riders.length,
      matchedRiders: riders.length,
      unmatchedRiders: 0,
      callCountMismatches: riders.filter(r => r.callCountMatched === false).length
    };

    return {
      id: record.id || createId(),
      platform,
      region: String(record.region || '').trim(),
      fileName: String(record.fileName || '').trim(),
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

  const weeklySettlements = {
    getAll() {
      const raw = storageAdapter.read(KEYS.weeklySettlements, []);
      const list = raw.map(normalizeWeeklySettlement);
      const repaired = list.map(item => ({
        ...item,
        platform: resolveWeeklySettlementPlatform(item)
      }));
      const changed = repaired.some((item, index) => {
        const rawPlatform = String(raw[index]?.platform || '').trim();
        return rawPlatform !== item.platform;
      });
      if (changed) storageAdapter.write(KEYS.weeklySettlements, repaired);
      return repaired.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    },

    getById(id) {
      return weeklySettlements.getAll().find(item => item.id === id) || null;
    },

    save(record) {
      const next = normalizeWeeklySettlement(record);
      const list = weeklySettlements.getAll().filter(item => item.id !== next.id);
      list.unshift(next);
      storageAdapter.write(KEYS.weeklySettlements, list);
      return next;
    },

    remove(id) {
      storageAdapter.write(
        KEYS.weeklySettlements,
        weeklySettlements.getAll().filter(item => item.id !== id)
      );
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
    getAll() {
      const list = storageAdapter.read(KEYS.promotionApplyResults, []);
      return list.map(normalizePromotionApplyResult).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },

    getById(id) {
      return promotionApplyResults.getAll().find(item => item.id === id) || null;
    },

    save(record) {
      const next = normalizePromotionApplyResult(record);
      const list = promotionApplyResults.getAll().filter(item => item.id !== next.id);
      list.unshift(next);
      storageAdapter.write(KEYS.promotionApplyResults, list);
      return next;
    },

    remove(id) {
      storageAdapter.write(
        KEYS.promotionApplyResults,
        promotionApplyResults.getAll().filter(item => item.id !== id)
      );
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
    }
  };

  const settlementUnmatched = {
    getAll() {
      return normalizeSettlementUnmatched(storageAdapter.read(KEYS.settlementUnmatched, []));
    },

    saveBatch({ period, records, sourceFileName, platform = DEFAULT_PLATFORM }) {
      if (!period || !Array.isArray(records) || !records.length) return settlementUnmatched.getAll();

      const p = normalizePlatform(platform);
      const periodKey = String(period).slice(0, 10);
      const savedAt = new Date().toISOString();
      const nextRecords = records.map(record => ({
        id: `${periodKey}-${p}-${String(record.rawName || record.name || '').replace(/\s/g, '')}`,
        period: periodKey,
        platform: p,
        riderId: record.riderId || '',
        rawName: record.rawName || '',
        name: record.name || '',
        orderCount: Number(record.orderCount || 0),
        settlementAmount: Number(record.settlementAmount ?? record.deliveryAmount ?? 0),
        deliveryAmount: Number(record.deliveryAmount ?? record.settlementAmount ?? 0),
        sourceFileName: sourceFileName || '',
        savedAt
      }));

      const list = settlementUnmatched.getAll().filter(item => !(item.period === periodKey && normalizePlatform(item.platform) === p));
      list.unshift(...nextRecords);
      storageAdapter.write(KEYS.settlementUnmatched, list);
      return list;
    },

    removeById(id) {
      storageAdapter.write(
        KEYS.settlementUnmatched,
        settlementUnmatched.getAll().filter(item => item.id !== id)
      );
    },

    clearByPeriod(period, platform = DEFAULT_PLATFORM) {
      const p = normalizePlatform(platform);
      storageAdapter.write(
        KEYS.settlementUnmatched,
        settlementUnmatched.getAll().filter(item => !(item.period === period && normalizePlatform(item.platform) === p))
      );
    },

    clearByPlatform(platform) {
      const p = normalizePlatform(platform);
      storageAdapter.write(
        KEYS.settlementUnmatched,
        settlementUnmatched.getAll().filter(item => normalizePlatform(item.platform) !== p)
      );
    },

    clearAll() {
      storageAdapter.write(KEYS.settlementUnmatched, []);
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
    'lease-management',
    'calls',
    'rejections',
    'targets',
    'promotions',
    'promotion-apply',
    'settlements',
    'weekly-settlement',
    'admin-account',
    'revenue-management',
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
    const source = Array.isArray(menus) ? menus : ALL_ADMIN_MENU_IDS;
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

  function normalizeAdminAccount(raw, index = 0) {
    const now = new Date().toISOString();
    const menus = normalizeAdminMenus(raw?.menus);
    return {
      id: String(raw?.id || createId()),
      name: String(raw?.name || DEFAULT_ADMIN_ACCOUNT.name).trim() || DEFAULT_ADMIN_ACCOUNT.name,
      password: String(raw?.password || DEFAULT_ADMIN_ACCOUNT.password),
      role: normalizeAdminRole(raw?.role, index),
      menus,
      editableMenus: normalizeAdminEditableMenus(menus, raw?.editableMenus ?? menus),
      active: raw?.active !== false,
      createdAt: raw?.createdAt || now,
      updatedAt: raw?.updatedAt || now
    };
  }

  function readAdminAccountsRaw() {
    const raw = localAdapter.read(KEYS.adminAccounts);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeAdminAccounts(accounts) {
    localAdapter.write(KEYS.adminAccounts, JSON.stringify(accounts));
  }

  function migrateLegacyAdminCredentials() {
    const legacyRaw = localAdapter.read(KEYS.adminCredentials);
    if (!legacyRaw) return null;

    try {
      const legacy = JSON.parse(legacyRaw);
      return normalizeAdminAccount({
        name: legacy?.name,
        password: legacy?.password,
        role: ADMIN_ROLES.CEO,
        menus: ALL_ADMIN_MENU_IDS
      });
    } catch {
      return null;
    }
  }

  function ensureDevDefaultAdminAccount(accounts) {
    const config = getSupabaseConfig();
    if (config.mode !== 'development' || config.backend !== 'local') return accounts;

    const list = accounts.map(account => ({ ...account }));
    const defaultIndex = list.findIndex(account => account.name === DEFAULT_ADMIN_ACCOUNT.name);

    if (defaultIndex >= 0) {
      list[defaultIndex].password = DEFAULT_ADMIN_ACCOUNT.password;
      list[defaultIndex].active = true;
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
    const loggedIn = sessionStorage.getItem(SESSION_KEYS.adminLoggedIn);
    const accountId = sessionStorage.getItem(SESSION_KEYS.adminAccountId);
    if (loggedIn === 'true') {
      localStorage.setItem(SESSION_KEYS.adminLoggedIn, 'true');
      if (accountId) localStorage.setItem(SESSION_KEYS.adminAccountId, accountId);
    }
  }

  const auth = {
    ALL_ADMIN_MENU_IDS,
    ADMIN_ROLES,
    ADMIN_ROLE_LABELS,
    getAdminRoleLabel,

    isAdminLoggedIn() {
      return !!this.getAdminSessionAccount();
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
        const profile = activeSupabaseProfile;
        if (profile?.active && profile.role === 'admin') {
          return {
            id: profile.user_id,
            name: profile.display_name || '관리자',
            role: ADMIN_ROLES.CEO,
            menus: ALL_ADMIN_MENU_IDS,
            editableMenus: ALL_ADMIN_MENU_IDS,
            active: true
          };
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
      return account ? normalizeAdminMenus(account.menus) : [...ALL_ADMIN_MENU_IDS];
    },

    getAdminSessionEditableMenus() {
      const account = this.getAdminSessionAccount();
      if (!account) return [...ALL_ADMIN_MENU_IDS];
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
      const email = resolveAdminLoginInput(loginInput);
      if (!email.includes('@')) {
        return {
          ok: false,
          message: '운영 로그인 설정이 필요합니다. supabase-config.js의 initialAdmin.email을 확인하세요.'
        };
      }

      const result = await signInWithSupabase(email, password, 'admin');
      if (!result.ok) return result;
      this.setAdminSession(result.profile.user_id);
      return {
        ok: true,
        account: {
          id: result.profile.user_id,
          name: result.profile.display_name || result.user.email || '관리자',
          role: ADMIN_ROLES.CEO,
          menus: ALL_ADMIN_MENU_IDS,
          editableMenus: ALL_ADMIN_MENU_IDS,
          active: true
        }
      };
    },

    async signInDriver(email, password) {
      return signInWithSupabase(email, password, 'rider');
    },

    async signOutSupabase() {
      const client = getSupabaseClient();
      if (client) await client.auth.signOut();
      activeSupabaseProfile = null;
      this.clearAdminSession();
      this.setDriverSessionId(null);
    },

    getSupabaseProfile() {
      return activeSupabaseProfile ? { ...activeSupabaseProfile } : null;
    },

    createAdminAccount({ name, password, menus, editableMenus, active = true, role = ADMIN_ROLES.MANAGER } = {}, options = {}) {
      if (getSupabaseConfig().mode === 'production') {
        return { ok: false, message: '운영 모드에서는 Edge Function으로 관리자 계정을 생성하세요.' };
      }
      const actorRole = options.actor?.role || ADMIN_ROLES.MANAGER;
      if (actorRole !== ADMIN_ROLES.CEO) {
        return { ok: false, message: '대표만 관리자 계정을 생성할 수 있습니다.' };
      }

      const nextName = String(name || '').trim();
      const nextPassword = String(password || '').trim();
      const nextRole = normalizeAdminRole(role, 1);

      if (!nextName) {
        return { ok: false, message: '관리자 이름을 입력하세요.' };
      }
      if (nextPassword.length < 4) {
        return { ok: false, message: '비밀번호는 4자 이상 입력하세요.' };
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
        active,
        createdAt: now,
        updatedAt: now
      }, accounts.length);

      writeAdminAccounts([...accounts, account]);
      return { ok: true, message: '관리자 계정이 생성되었습니다.', account };
    },

    updateAdminAccount(accountId, { name, password, menus, editableMenus, active, role } = {}, options = {}) {
      if (getSupabaseConfig().mode === 'production') {
        return { ok: false, message: '운영 모드에서는 Edge Function으로 관리자 계정을 수정하세요.' };
      }
      const actor = options.actor || null;
      const actorRole = actor?.role || ADMIN_ROLES.MANAGER;
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

      const updated = normalizeAdminAccount({
        ...current,
        name: nextName,
        password: nextPassword,
        role: nextRole,
        menus: nextMenus,
        editableMenus: nextEditableMenus,
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

    deleteAdminAccount(accountId, options = {}) {
      const actorRole = options.actor?.role || ADMIN_ROLES.MANAGER;
      if (actorRole !== ADMIN_ROLES.CEO) {
        return { ok: false, message: '대표만 관리자 계정을 삭제할 수 있습니다.' };
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
        return activeSupabaseProfile?.role === 'rider' ? activeSupabaseProfile.rider_id : '';
      }
      return sessionAdapter.read(SESSION_KEYS.driverId);
    },

    setDriverSessionId(driverId) {
      if (getSupabaseConfig().mode === 'production') {
        return;
      }
      if (driverId) {
        sessionAdapter.write(SESSION_KEYS.driverId, driverId);
      } else {
        sessionAdapter.remove(SESSION_KEYS.driverId);
      }
    }
  };

  const DATA_GROUPS = Object.freeze({
    all: Object.freeze({
      id: 'all',
      label: '전체 데이터',
      description: '등록된 모든 BREM localStorage 데이터',
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
        KEYS.leases,
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
        KEYS.settlements
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
    let version = getSchemaVersion();

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

      Object.entries(parsed.data).forEach(([key, incomingValue]) => {
        if (!String(key).startsWith('brem_')) {
          skippedKeys.push(key);
          return;
        }
        if (allowedKeys && !allowedKeys.has(key) && key !== KEYS.preservedUnknown) {
          skippedKeys.push(key);
          return;
        }

        if (mode === 'replace') {
          storageAdapter.write(key, incomingValue);
          importedKeys.push(key);
          return;
        }

        const raw = storageAdapter.readRaw(key);
        const nextValue = raw.exists
          ? mergeImportedValue(key, raw.value, incomingValue)
          : incomingValue;
        storageAdapter.write(key, nextValue);
        importedKeys.push(key);
      });

      runDataMigrations();
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

  runDataMigrations();

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
    getSupabaseClient,
    loadSupabaseProfile,
    useLocalStorageAdapter,
    initStorage,
    initSupabaseStorage,
    migrateLocalStorageToSupabase,
    drivers,
    calls,
    rejections,
    targets,
    weeklyTargets,
    notices,
    riderInquiries,
    adminSchedules,
    leases,
    revenue,
    events,
    settlements,
    settlementUnmatched,
    promotionRules,
    promotionSettings,
    promotionSelectorOptions,
    weeklySettlements,
    resolveWeeklySettlementPlatform,
    promotionApplyResults,
    manualNameMappings,
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

if (BremStorage.getSupabaseConfig?.().backend === 'supabase') {
  const boot = () => {
    BremStorage.initStorage({ backend: 'supabase' }).then(result => {
      document.dispatchEvent(new CustomEvent('brem-storage-ready', { detail: result }));
    }).catch(error => {
      console.warn('[BREM] Supabase auto init failed:', error);
      if (BremStorage.getSupabaseConfig?.().allowLocalFallback) {
        BremStorage.useLocalStorageAdapter();
      }
      document.dispatchEvent(new CustomEvent('brem-storage-ready', {
        detail: {
          backend: BremStorage.getStorageBackend?.() || 'unavailable',
          fallback: Boolean(BremStorage.getSupabaseConfig?.().allowLocalFallback),
          error: error.message
        }
      }));
    });
  };

  if (window.BremSupabaseConfig?.load) {
    window.BremSupabaseConfig.load().then(boot);
  } else {
    boot();
  }
}
