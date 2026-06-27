(function () {
  const META_KEY = 'brem_payroll_local_base_meta_v1';
  const DRIVERS_KEY = 'brem_payroll_local_base_drivers_v1';
  const CALLS_KEY = 'brem_payroll_local_base_calls_v1';
  const MAPPINGS_KEY = 'brem_payroll_local_base_manual_mappings_v1';

  let memoryMeta = null;
  let memoryDrivers = null;
  let memoryCalls = null;
  let memoryMappings = null;
  let active = false;

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function readMeta() {
    if (memoryMeta) return memoryMeta;
    memoryMeta = readJson(META_KEY, null);
    return memoryMeta;
  }

  function writeMeta(meta) {
    memoryMeta = meta;
    writeJson(META_KEY, meta);
  }

  function readDrivers() {
    if (memoryDrivers) return memoryDrivers;
    const parsed = readJson(DRIVERS_KEY, []);
    memoryDrivers = Array.isArray(parsed) ? parsed : [];
    return memoryDrivers;
  }

  function readCalls() {
    if (memoryCalls) return memoryCalls;
    const parsed = readJson(CALLS_KEY, []);
    memoryCalls = Array.isArray(parsed) ? parsed : [];
    return memoryCalls;
  }

  function readMappings() {
    if (memoryMappings) return memoryMappings;
    const parsed = readJson(MAPPINGS_KEY, []);
    memoryMappings = Array.isArray(parsed) ? parsed : [];
    return memoryMappings;
  }

  function writeAll(payload) {
    const drivers = Array.isArray(payload.drivers) ? payload.drivers : [];
    const calls = Array.isArray(payload.calls) ? payload.calls : [];
    const manualNameMappings = Array.isArray(payload.manualNameMappings) ? payload.manualNameMappings : [];
    const counts = payload.counts || {};

    memoryDrivers = drivers;
    memoryCalls = calls;
    memoryMappings = manualNameMappings;
    active = drivers.length > 0;

    writeJson(DRIVERS_KEY, drivers);
    writeJson(CALLS_KEY, calls);
    writeJson(MAPPINGS_KEY, manualNameMappings);
    writeMeta({
      syncedAt: payload.syncedAt || new Date().toISOString(),
      readOnly: true,
      source: payload.source || 'production-supabase-base-data-rls',
      callsSinceDate: payload.callsSinceDate || '',
      counts: {
        drivers: counts.drivers ?? drivers.length,
        calls: counts.calls ?? calls.length,
        manualNameMappings: counts.manualNameMappings ?? manualNameMappings.length,
        reference: counts.reference ?? (calls.length + manualNameMappings.length)
      },
      warnings: Array.isArray(payload.warnings) ? payload.warnings : []
    });
  }

  function clearCache() {
    memoryMeta = null;
    memoryDrivers = [];
    memoryCalls = [];
    memoryMappings = [];
    active = false;
    [META_KEY, DRIVERS_KEY, CALLS_KEY, MAPPINGS_KEY].forEach(key => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    });
  }

  function isActive() {
    return active && readDrivers().length > 0;
  }

  function hasExistingData() {
    if (readMeta()) return true;
    return readDrivers().length > 0
      || readCalls().length > 0
      || readMappings().length > 0;
  }

  function getMeta() {
    return readMeta();
  }

  function getDrivers() {
    return readDrivers().map(item => ({ ...item }));
  }

  function getCalls() {
    return readCalls().map(item => ({ ...item }));
  }

  function getManualNameMappings() {
    return readMappings().map(item => ({ ...item }));
  }

  async function fetchStatus() {
    const response = await fetch('/api/admin/payroll/production-base-data/status', {
      credentials: 'same-origin'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || '운영 데이터 가져오기 상태를 확인하지 못했습니다.');
    }
    return payload;
  }

  function mergeCallsIntoCache(newCalls, rangeMeta = {}) {
    const existing = readCalls();
    const map = new Map(existing.map(item => [item.id, item]));
    (Array.isArray(newCalls) ? newCalls : []).forEach(item => {
      if (item?.id) map.set(item.id, item);
    });
    memoryCalls = Array.from(map.values());
    writeJson(CALLS_KEY, memoryCalls);
    const meta = readMeta() || {};
    writeMeta({
      ...meta,
      lastCallsSyncAt: rangeMeta.syncedAt || new Date().toISOString(),
      lastCallsRange: {
        sinceDate: rangeMeta.sinceDate || '',
        untilDate: rangeMeta.untilDate || ''
      }
    });
    return memoryCalls;
  }

  async function fetchCallsForSettlementWeek(weekStart, weekEnd, options = {}) {
    const start = String(weekStart || '').slice(0, 10);
    const end = String(weekEnd || start).slice(0, 10);
    if (!start) return { calls: [], fetched: false, source: 'empty' };

    const cached = readCalls().filter(call => {
      const day = String(call.date || '').slice(0, 10);
      return day >= start && day <= end;
    });
    if (cached.length && options.force !== true) {
      return { calls: cached, fetched: false, source: 'cache', total: cached.length };
    }

    const status = await fetchStatus();
    if (!status.configured) {
      return { calls: cached, fetched: false, source: 'cache-empty', total: cached.length };
    }

    const prodAuth = window.BremPayrollProductionRiders;
    const token = options.accessToken
      || prodAuth?.getAccessToken?.()
      || await prodAuth?.ensureProductionAuth?.();
    if (!token) {
      return { calls: cached, fetched: false, source: 'cache-no-auth', total: cached.length };
    }

    const query = new URLSearchParams({ start, end });
    const response = await fetch(`/api/admin/payroll/production-base-data/calls?${query}`, {
      credentials: 'same-origin',
      headers: { Authorization: `Bearer ${token}` }
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      prodAuth?.clearAuth?.();
    }
    if (!response.ok) {
      throw new Error(payload.error || '정산주 콜수 조회에 실패했습니다.');
    }

    const fetched = Array.isArray(payload.calls) ? payload.calls : [];
    mergeCallsIntoCache(fetched, {
      syncedAt: payload.syncedAt,
      sinceDate: payload.sinceDate || start,
      untilDate: payload.untilDate || end
    });
    const merged = readCalls().filter(call => {
      const day = String(call.date || '').slice(0, 10);
      return day >= start && day <= end;
    });
    return { calls: merged, fetched: true, source: 'production', total: merged.length };
  }

  async function importFromProduction(options = {}) {
    const status = await fetchStatus();
    if (!status.configured) {
      throw new Error('운영 Supabase URL / ANON KEY 설정이 없습니다. .env 를 확인하세요.');
    }

    const prodAuth = window.BremPayrollProductionRiders;
    const token = options.accessToken
      || prodAuth?.getAccessToken?.()
      || await prodAuth?.ensureProductionAuth?.();
    if (!token) {
      throw new Error('운영 Supabase 관리자 로그인이 필요합니다.');
    }

    const response = await fetch('/api/admin/payroll/production-base-data', {
      credentials: 'same-origin',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      prodAuth?.clearAuth?.();
    }
    if (!response.ok) {
      throw new Error(payload.error || '운영 데이터 가져오기에 실패했습니다.');
    }

    writeAll(payload);
    return {
      meta: getMeta(),
      drivers: getDrivers(),
      calls: getCalls(),
      manualNameMappings: getManualNameMappings(),
      warnings: payload.warnings || []
    };
  }

  function initFromStorage() {
    const drivers = readDrivers();
    active = drivers.length > 0;
    return drivers.length;
  }

  initFromStorage();

  window.BremPayrollLocalBaseData = Object.freeze({
    META_KEY,
    DRIVERS_KEY,
    CALLS_KEY,
    MAPPINGS_KEY,
    isActive,
    hasExistingData,
    getMeta,
    getDrivers,
    getCalls,
    getManualNameMappings,
    fetchStatus,
    importFromProduction,
    fetchCallsForSettlementWeek,
    mergeCallsIntoCache,
    clearCache
  });
})();
