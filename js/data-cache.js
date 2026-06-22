/**
 * BREM in-memory data cache (탭 세션 동안만 유지).
 * 영구 저장은 Supabase만 · 브라우저 영구 저장소 미사용.
 */
window.BremDataCache = (function () {
  const VERSION = 2;
  const PREFIX = 'brem_dc_';
  const MEMORY_ONLY_KEYS = new Set([]);
  const memory = new Map();
  const inflight = new Map();
  let coreReady = false;
  const fetchStats = {
    total: 0,
    hits: 0,
    network: 0,
    byKey: Object.create(null),
    bySource: Object.create(null)
  };

  function storageKey(key) {
    return `${PREFIX}${key}`;
  }

  function shouldMirrorSession() {
    return false;
  }

  function readEntry(key) {
    if (memory.has(key)) return memory.get(key);
    if (MEMORY_ONLY_KEYS.has(key)) return null;
    return null;
  }

  function writeEntry(key, data, meta = {}) {
    const entry = {
      v: VERSION,
      valid: true,
      data,
      meta: {
        ...meta,
        version: VERSION
      },
      storedAt: Date.now()
    };
    memory.set(key, entry);
    return entry;
  }

  function logFetch(source, key, cached) {
    fetchStats.total += 1;
    if (cached) fetchStats.hits += 1;
    else fetchStats.network += 1;
    fetchStats.byKey[key] = (fetchStats.byKey[key] || 0) + 1;
    fetchStats.bySource[source] = (fetchStats.bySource[source] || 0) + 1;
    console.debug(
      `[BREM:cache] ${cached ? 'HIT' : 'FETCH'} ${source} → ${key}`
      + ` (total=${fetchStats.total}, network=${fetchStats.network}, hits=${fetchStats.hits})`
    );
  }

  /** Console: riders|missions|…: cache hit / supabase fetch */
  function logDataSource(label, cached, detail = '') {
    const name = String(label || 'data').trim();
    const suffix = detail ? ` (${detail})` : '';
    console.info(`[BREM:data] ${name}: ${cached ? 'cache hit' : 'supabase fetch'}${suffix}`);
    logFetch(name, name, cached);
  }

  function isValid(key) {
    return Boolean(readEntry(key));
  }

  function getData(key) {
    const entry = readEntry(key);
    return entry ? entry.data : null;
  }

  function getMeta(key) {
    const entry = readEntry(key);
    if (!entry) return null;
    return {
      storedAt: entry.storedAt,
      meta: entry.meta || {},
      version: entry.v
    };
  }

  function invalidate(key) {
    memory.delete(key);
    try {
      sessionStorage.removeItem(storageKey(key));
    } catch {
      /* ignore */
    }
  }

  function invalidateKeys(keys) {
    (keys || []).forEach(invalidate);
  }

  function markCoreReady() {
    coreReady = true;
    writeEntry('__core__', true, { source: 'core' });
  }

  function isCoreReady() {
    if (coreReady) return true;
    if (isValid('__core__')) {
      coreReady = true;
      return true;
    }
    return false;
  }

  function clearCoreReady() {
    coreReady = false;
    invalidate('__core__');
  }

  /** 로그아웃·재로그인 시 Supabase에서 운영 데이터를 다시 불러오도록 탭 캐시 전체 삭제 */
  function clearAll() {
    coreReady = false;
    memory.clear();
    inflight.clear();
    fetchStats.total = 0;
    fetchStats.hits = 0;
    fetchStats.network = 0;
    fetchStats.byKey = Object.create(null);
    fetchStats.bySource = Object.create(null);
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key && key.startsWith(PREFIX)) {
          sessionStorage.removeItem(key);
        }
      }
    } catch {
      /* ignore */
    }
  }

  function restoreToAdapter(key, adapter, keysConst) {
    const entry = readEntry(key);
    if (!entry || !adapter?.stage) return false;
    adapter.stage(key, entry.data);
    return true;
  }

  function persistFromAdapter(key, adapter) {
    if (!adapter?.readRaw) return;
    const raw = adapter.readRaw(key);
    if (!raw?.exists) return;
    writeEntry(key, raw.value, { source: 'adapter' });
  }

  function runOnce(taskKey, fn, options = {}) {
    const force = options.force === true;
    if (!force && inflight.has(taskKey)) {
      return inflight.get(taskKey);
    }
    const promise = Promise.resolve()
      .then(fn)
      .finally(() => {
        inflight.delete(taskKey);
      });
    inflight.set(taskKey, promise);
    return promise;
  }

  function isInflight(taskKey) {
    return inflight.has(taskKey);
  }

  function getStatus() {
    const keys = [...memory.keys()].filter(key => !key.startsWith('__'));
    return {
      version: VERSION,
      coreReady: isCoreReady(),
      fetchStats: {
        total: fetchStats.total,
        hits: fetchStats.hits,
        network: fetchStats.network,
        byKey: { ...fetchStats.byKey },
        bySource: { ...fetchStats.bySource }
      },
      keys: keys.map(key => {
        const entry = memory.get(key);
        return {
          key,
          storedAt: entry?.storedAt || null,
          meta: entry?.meta || {}
        };
      })
    };
  }

  function formatLoadedAt(storedAt) {
    if (!storedAt) return '';
    const date = new Date(storedAt);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  return {
    VERSION,
    isValid,
    getData,
    getMeta,
    set: writeEntry,
    invalidate,
    invalidateKeys,
    markCoreReady,
    isCoreReady,
    clearCoreReady,
    clearAll,
    restoreToAdapter,
    persistFromAdapter,
    runOnce,
    isInflight,
    logFetch,
    logDataSource,
    getStatus,
    formatLoadedAt
  };
})();
