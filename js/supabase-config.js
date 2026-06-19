/**
 * Supabase 공개 설정 로더
 * - URL / anonKey 등은 서버 /api/public-config 에서 환경변수 기반으로 주입
 * - service_role 키는 절대 프론트에 포함하지 않음
 */
(function () {
  const host = String(window.location?.hostname || '');
  const isLikelyProductionHost = window.BremEnv?.isProductionHost?.(host) === true
    || /(^|\.)brem\.kr$/i.test(host.trim().toLowerCase());

  const DEFAULTS = {
    url: '',
    anonKey: '',
    mode: isLikelyProductionHost ? 'production' : 'development',
    backend: 'supabase',
    allowLocalFallback: false,
    functionsUrl: '',
    inquiryStorage: 'file',
    initialAdmin: {
      loginName: '관리자',
      email: 'admin@brem.kr'
    }
  };

  window.BREM_SUPABASE_CONFIG = Object.assign({}, DEFAULTS);

  const AUTH_STORAGE_PREFIX = 'brem-auth-';
  const LEGACY_SESSION_PREFIX = 'brem_sb_';
  const LEGACY_LOCAL_PREFIX = 'brem-auth-';

  function purgeLegacyLocalAuthStorage() {
    try {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (!key) continue;
        if (key.startsWith(AUTH_STORAGE_PREFIX) || key.startsWith(LEGACY_SESSION_PREFIX)) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      /* ignore */
    }
  }

  purgeLegacyLocalAuthStorage();

  function applyConfig(config) {
    if (!config || typeof config !== 'object') return window.BREM_SUPABASE_CONFIG;
    Object.assign(window.BREM_SUPABASE_CONFIG, DEFAULTS, config);
    window.BREM_SUPABASE_CONFIG.initialAdmin = Object.assign(
      {},
      DEFAULTS.initialAdmin,
      config.initialAdmin || {}
    );
    window.BREM_SUPABASE_CONFIG.isConfigured = Boolean(
      window.BREM_SUPABASE_CONFIG.url && window.BREM_SUPABASE_CONFIG.anonKey
    );
    document.dispatchEvent(new CustomEvent('brem-config-ready', {
      detail: { ...window.BREM_SUPABASE_CONFIG }
    }));
    return window.BREM_SUPABASE_CONFIG;
  }

  window.BremSupabaseConfig = {
    load() {
      if (!this._promise) {
        this._promise = fetch('/api/public-config', { credentials: 'same-origin' })
          .then(function (response) {
            if (!response.ok) return applyConfig({});
            return response.json().then(applyConfig);
          })
          .catch(function () {
            return applyConfig({});
          });
      }
      return this._promise;
    },

    /** Supabase Auth JWT — sessionStorage only (탭/창 종료 시 세션 소멸, 새로고침 시 유지) */
    createClient(url, anonKey) {
      if (!window.supabase?.createClient) {
        throw new Error('@supabase/supabase-js 가 로드되지 않았습니다.');
      }
      const authStorage = {
        getItem(key) {
          try {
            const sessionValue = sessionStorage.getItem(AUTH_STORAGE_PREFIX + key);
            if (sessionValue != null) return sessionValue;

            const legacySession = sessionStorage.getItem(LEGACY_SESSION_PREFIX + key);
            if (legacySession != null) {
              sessionStorage.setItem(AUTH_STORAGE_PREFIX + key, legacySession);
              sessionStorage.removeItem(LEGACY_SESSION_PREFIX + key);
              return legacySession;
            }

            try { localStorage.removeItem(LEGACY_LOCAL_PREFIX + key); } catch { /* ignore */ }
            return null;
          } catch {
            return null;
          }
        },
        setItem(key, value) {
          sessionStorage.setItem(AUTH_STORAGE_PREFIX + key, value);
          try {
            localStorage.removeItem(LEGACY_LOCAL_PREFIX + key);
            sessionStorage.removeItem(LEGACY_SESSION_PREFIX + key);
          } catch {
            /* ignore */
          }
        },
        removeItem(key) {
          try {
            sessionStorage.removeItem(AUTH_STORAGE_PREFIX + key);
            localStorage.removeItem(LEGACY_LOCAL_PREFIX + key);
            sessionStorage.removeItem(LEGACY_SESSION_PREFIX + key);
          } catch {
            /* ignore */
          }
        }
      };
      return window.supabase.createClient(url, anonKey, {
        auth: {
          storage: authStorage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
    }
  };

  window.BremSupabaseConfig.load();
})();
