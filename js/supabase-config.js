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
      email: 'kim01022680704@gmail.com'
    },
    // public-config 지연 시에도 이름 로그인이 가능하도록 클라이언트 기본 매핑
    adminLoginHints: {
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
    }
  };

  window.BREM_SUPABASE_CONFIG = Object.assign({}, DEFAULTS);

  const AUTH_STORAGE_PREFIX = 'brem-auth-';
  const LEGACY_SESSION_PREFIX = 'brem_sb_';
  const LEGACY_LOCAL_PREFIX = 'brem-auth-';

  function purgeLegacyLocalAuthStorage() {
    try {
      const prefixes = [
        AUTH_STORAGE_PREFIX,
        LEGACY_SESSION_PREFIX,
        'brem-auth-admin-',
        'brem-auth-rider-'
      ];
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (!key) continue;
        if (prefixes.some(prefix => key.startsWith(prefix))) {
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
    window.BREM_SUPABASE_CONFIG.adminLoginHints = Object.assign(
      {},
      DEFAULTS.adminLoginHints,
      config.adminLoginHints || {}
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

    /** Supabase Auth JWT — sessionStorage (default) or localStorage when "로그인 유지" */
    createClient(url, anonKey, options = {}) {
      if (!window.supabase?.createClient) {
        throw new Error('@supabase/supabase-js 가 로드되지 않았습니다.');
      }

      const scope = options.scope === 'rider' ? 'rider' : 'admin';
      const scopedPrefix = scope === 'rider' ? 'brem-auth-rider-' : 'brem-auth-admin-';

      function readAuthValue(key) {
        // keep-logged-in / LoginPrefs 없어도 localStorage 토큰을 읽을 수 있게 항상 둘 다 확인
        const stores = [];
        const preferLocal = window.BremLoginPrefs?.isKeepLoggedIn?.(scope) !== false;
        if (preferLocal) stores.push(localStorage);
        stores.push(sessionStorage);
        if (!preferLocal) stores.push(localStorage);

        const seen = new Set();
        for (const store of stores) {
          if (seen.has(store)) continue;
          seen.add(store);
          try {
            const scoped = store.getItem(scopedPrefix + key);
            if (scoped != null) return scoped;

            const legacySession = store.getItem(LEGACY_SESSION_PREFIX + key);
            if (legacySession != null) {
              store.setItem(scopedPrefix + key, legacySession);
              store.removeItem(LEGACY_SESSION_PREFIX + key);
              return legacySession;
            }

            const legacyAuth = store.getItem(AUTH_STORAGE_PREFIX + key);
            if (legacyAuth != null) {
              store.setItem(scopedPrefix + key, legacyAuth);
              store.removeItem(AUTH_STORAGE_PREFIX + key);
              return legacyAuth;
            }
          } catch {
            /* ignore */
          }
        }

        return null;
      }

      function resolveWriteStore() {
        return window.BremLoginPrefs?.getSessionStore?.(scope) || sessionStorage;
      }

      const authStorage = {
        getItem(key) {
          return readAuthValue(key);
        },
        setItem(key, value) {
          const store = resolveWriteStore();
          store.setItem(scopedPrefix + key, value);
          try {
            sessionStorage.removeItem(AUTH_STORAGE_PREFIX + key);
            sessionStorage.removeItem(LEGACY_SESSION_PREFIX + key);
            localStorage.removeItem(AUTH_STORAGE_PREFIX + key);
            localStorage.removeItem(LEGACY_LOCAL_PREFIX + key);
            localStorage.removeItem(LEGACY_SESSION_PREFIX + key);
          } catch {
            /* ignore */
          }
        },
        removeItem(key) {
          [sessionStorage, localStorage].forEach(store => {
            try {
              store.removeItem(scopedPrefix + key);
              store.removeItem(AUTH_STORAGE_PREFIX + key);
              store.removeItem(LEGACY_LOCAL_PREFIX + key);
              store.removeItem(LEGACY_SESSION_PREFIX + key);
            } catch {
              /* ignore */
            }
          });
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
