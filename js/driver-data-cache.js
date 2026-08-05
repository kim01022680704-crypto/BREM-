/**
 * Rider app session cache — sessionStorage only, TTL 4 minutes.
 */
window.BremDriverDataCache = (function () {
  const TTL_MS = 5 * 60 * 1000;
  const PREFIX = 'brem:driver:';

  function storageKey(riderId, kind) {
    return `${PREFIX}${kind}:${String(riderId || '').trim()}`;
  }

  function read(riderId, kind) {
    const id = String(riderId || '').trim();
    if (!id || !kind) return null;
    try {
      const raw = sessionStorage.getItem(storageKey(id, kind));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.storedAt !== 'number') return null;
      if (Date.now() - parsed.storedAt > TTL_MS) {
        sessionStorage.removeItem(storageKey(id, kind));
        return null;
      }
      return parsed.data ?? null;
    } catch {
      return null;
    }
  }

  function write(riderId, kind, data) {
    const id = String(riderId || '').trim();
    if (!id || !kind) return;
    try {
      sessionStorage.setItem(storageKey(id, kind), JSON.stringify({
        storedAt: Date.now(),
        data
      }));
    } catch (error) {
      console.warn('[BREM] driver cache write failed:', kind, error.message || error);
    }
  }

  function invalidate(riderId) {
    const id = String(riderId || '').trim();
    if (!id) return;
    ['snapshot', 'live', 'notices'].forEach(kind => {
      try {
        sessionStorage.removeItem(storageKey(id, kind));
      } catch {
        /* ignore */
      }
    });
  }

  /** 로그아웃 시 모든 기사 세션 캐시 제거 (다른 기사 잔존 방지) */
  function clearAll() {
    try {
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(PREFIX)) keys.push(key);
      }
      keys.forEach(key => {
        try { sessionStorage.removeItem(key); } catch { /* ignore */ }
      });
    } catch {
      /* ignore */
    }
  }

  return {
    TTL_MS,
    read,
    write,
    invalidate,
    clearAll
  };
})();
