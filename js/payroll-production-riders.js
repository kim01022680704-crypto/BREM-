(function () {
  const CACHE_KEY = 'brem_payroll_production_riders_cache_v1';
  const META_KEY = 'brem_payroll_production_riders_meta_v1';
  const AUTH_KEY = 'brem_payroll_production_auth_v1';

  let memoryRiders = null;
  let memoryMeta = null;
  let memoryAuth = null;
  let active = false;

  function readAuth() {
    if (memoryAuth) return memoryAuth;
    try {
      const raw = sessionStorage.getItem(AUTH_KEY);
      memoryAuth = raw ? JSON.parse(raw) : null;
    } catch {
      memoryAuth = null;
    }
    return memoryAuth;
  }

  function writeAuth(auth) {
    memoryAuth = auth;
    try {
      if (auth?.access_token) {
        sessionStorage.setItem(AUTH_KEY, JSON.stringify(auth));
      } else {
        sessionStorage.removeItem(AUTH_KEY);
      }
    } catch (error) {
      console.warn('[payroll production riders] auth persist failed', error);
    }
  }

  function clearAuth() {
    memoryAuth = null;
    try {
      sessionStorage.removeItem(AUTH_KEY);
    } catch {
      /* ignore */
    }
  }

  function getAccessToken() {
    return String(readAuth()?.access_token || '').trim();
  }

  function readMeta() {
    if (memoryMeta) return memoryMeta;
    try {
      const raw = localStorage.getItem(META_KEY);
      memoryMeta = raw ? JSON.parse(raw) : null;
    } catch {
      memoryMeta = null;
    }
    return memoryMeta;
  }

  function writeMeta(meta) {
    memoryMeta = meta;
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch (error) {
      console.warn('[payroll production riders] meta persist failed', error);
    }
  }

  function readCache() {
    if (memoryRiders) return memoryRiders;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      memoryRiders = Array.isArray(parsed) ? parsed : [];
    } catch {
      memoryRiders = [];
    }
    return memoryRiders;
  }

  function writeCache(riders, meta) {
    memoryRiders = Array.isArray(riders) ? riders : [];
    active = memoryRiders.length > 0;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(memoryRiders));
    } catch (error) {
      console.warn('[payroll production riders] cache persist failed', error);
    }
    writeMeta(meta);
  }

  function clearCache() {
    memoryRiders = [];
    memoryMeta = null;
    active = false;
    try {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(META_KEY);
    } catch {
      /* ignore */
    }
  }

  function isActive() {
    return active && readCache().length > 0;
  }

  function getRiders() {
    return readCache().map(item => ({ ...item }));
  }

  function getMeta() {
    return readMeta();
  }

  async function fetchStatus() {
    const response = await fetch('/api/admin/payroll/production-riders/status', {
      credentials: 'same-origin'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || '운영 기사목록 상태를 확인하지 못했습니다.');
    }
    return payload;
  }

  async function signInProductionAdmin(login, password) {
    const response = await fetch('/api/admin/payroll/production-riders/sign-in', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || '운영 Supabase 로그인에 실패했습니다.');
    }
    if (payload.session?.access_token) {
      writeAuth(payload.session);
    }
    return payload;
  }

  async function ensureProductionAuth() {
    if (getAccessToken()) return getAccessToken();

    const email = window.prompt(
      '운영 Supabase 관리자 이메일\n(로컬 관리자/1234 와 다릅니다 — brem.kr 운영 계정)'
    );
    if (!email) {
      throw new Error('운영 관리자 이메일 입력이 취소되었습니다.');
    }
    const password = window.prompt('운영 Supabase 관리자 비밀번호');
    if (!password) {
      throw new Error('운영 관리자 비밀번호 입력이 취소되었습니다.');
    }

    await signInProductionAdmin(email, password);
    const token = getAccessToken();
    if (!token) {
      throw new Error('운영 Supabase 로그인 세션을 받지 못했습니다.');
    }
    return token;
  }

  async function syncFromProduction(options = {}) {
    const status = await fetchStatus();
    if (!status.configured) {
      throw new Error('운영 Supabase URL / ANON KEY 설정이 없습니다. .env 를 확인하세요.');
    }

    const token = options.accessToken || await ensureProductionAuth();
    const response = await fetch('/api/admin/payroll/production-riders', {
      credentials: 'same-origin',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      clearAuth();
    }
    if (!response.ok) {
      throw new Error(payload.error || '운영 기사목록 동기화에 실패했습니다.');
    }

    const riders = Array.isArray(payload.riders) ? payload.riders : [];
    const meta = {
      syncedAt: payload.syncedAt || new Date().toISOString(),
      total: payload.total ?? riders.length,
      readOnly: true,
      authMode: 'anon-rls',
      source: payload.source || 'production-supabase-riders-rls'
    };
    writeCache(riders, meta);
    return { riders, meta };
  }

  function initFromStorage() {
    readAuth();
    const riders = readCache();
    active = riders.length > 0;
    return riders.length;
  }

  initFromStorage();

  window.BremPayrollProductionRiders = Object.freeze({
    CACHE_KEY,
    AUTH_KEY,
    isActive,
    getRiders,
    getMeta,
    getAccessToken,
    fetchStatus,
    signInProductionAdmin,
    ensureProductionAuth,
    syncFromProduction,
    clearCache,
    clearAuth
  });
})();
