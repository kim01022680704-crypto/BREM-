/**
 * BREM session-scoped data cache (memory + sessionStorage).
 * 운영 데이터·로그인 세션은 localStorage에 저장하지 않습니다.
 */
window.BremDataCache = (function () {
  const VERSION = 1;
  const PREFIX = 'brem_dc_';
  const memory = new Map();
  const inflight = new Map();
  let coreReady = false;

  function storageKey(key) {
    return `${PREFIX}${key}`;
  }

  function readEntry(key) {
    if (memory.has(key)) return memory.get(key);
    try {
      const raw = sessionStorage.getItem(storageKey(key));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== VERSION || parsed.valid !== true) return null;
      memory.set(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  function writeEntry(key, data, meta = {}) {
    const entry = {
      v: VERSION,
      valid: true,
      data,
      meta,
      storedAt: Date.now()
    };
    memory.set(key, entry);
    try {
      sessionStorage.setItem(storageKey(key), JSON.stringify(entry));
    } catch (error) {
      console.warn('[BREM] sessionStorage cache write failed:', key, error.message || error);
    }
    return entry;
  }

  function isValid(key) {
    return Boolean(readEntry(key));
  }

  function getData(key) {
    const entry = readEntry(key);
    return entry ? entry.data : null;
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
    writeEntry('__core__', true);
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
    writeEntry(key, raw.value);
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

  return {
    isValid,
    getData,
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
    isInflight
  };
})();
