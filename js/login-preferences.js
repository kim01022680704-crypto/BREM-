/**
 * Login UI preferences — remember ID (localStorage) + keep logged in (session store).
 * Never stores passwords. Admin and rider scopes are isolated.
 */
(function () {
  const SCOPES = { ADMIN: 'admin', RIDER: 'rider' };

  const ADMIN_SESSION_KEYS = [
    'brem_admin_logged_in',
    'brem_admin_account_id',
    'brem_admin_session_menus',
    'brem_admin_session_editable_menus',
    'brem_admin_session_role',
    'brem_admin_session_name'
  ];

  const RIDER_SESSION_KEYS = ['brem_driver_logged_in_id'];

  const AUTH_PREFIX = {
    admin: 'brem-auth-admin-',
    rider: 'brem-auth-rider-'
  };

  const LEGACY_AUTH_PREFIXES = ['brem-auth-', 'brem_sb_'];

  function scopeOf(scope) {
    return scope === SCOPES.RIDER ? SCOPES.RIDER : SCOPES.ADMIN;
  }

  function prefKey(kind, scope) {
    const s = scopeOf(scope);
    if (kind === 'rememberEnabled') return `brem_${s}_remember_id_enabled`;
    if (kind === 'rememberId') return `brem_${s}_remember_id`;
    if (kind === 'keepLoggedIn') return `brem_${s}_keep_logged_in`;
    return '';
  }

  function sessionKeys(scope) {
    return scopeOf(scope) === SCOPES.RIDER ? RIDER_SESSION_KEYS : ADMIN_SESSION_KEYS;
  }

  function isRememberIdEnabled(scope) {
    try {
      return localStorage.getItem(prefKey('rememberEnabled', scope)) === '1';
    } catch {
      return false;
    }
  }

  function getRememberedId(scope) {
    if (!isRememberIdEnabled(scope)) return '';
    try {
      return String(localStorage.getItem(prefKey('rememberId', scope)) || '').trim();
    } catch {
      return '';
    }
  }

  function saveRememberId(scope, loginId, enabled) {
    const trimmed = String(loginId || '').trim();
    try {
      if (enabled && trimmed) {
        localStorage.setItem(prefKey('rememberEnabled', scope), '1');
        localStorage.setItem(prefKey('rememberId', scope), trimmed);
      } else {
        localStorage.removeItem(prefKey('rememberEnabled', scope));
        localStorage.removeItem(prefKey('rememberId', scope));
      }
    } catch {
      /* ignore */
    }
  }

  function isNativeRiderApp() {
    try {
      return Boolean(window.BREM_IS_NATIVE_APP);
    } catch {
      return false;
    }
  }

  function isKeepLoggedIn(scope) {
    // 관리자: 항상 로그인 유지(명시적 로그아웃 전까지). 새로고침·브라우저 재시작에도 유지.
    if (scopeOf(scope) === SCOPES.ADMIN) return true;
    // 네이티브 기사앱: 로그아웃 전까지 유지 (앱을 닫아도 다시 로그인하지 않음)
    if (scopeOf(scope) === SCOPES.RIDER && isNativeRiderApp()) return true;
    try {
      return localStorage.getItem(prefKey('keepLoggedIn', scope)) === '1';
    } catch {
      return false;
    }
  }

  function authPrefix(scope) {
    return AUTH_PREFIX[scopeOf(scope)];
  }

  function clearAuthKeysInStore(store, scope) {
    const prefixes = [authPrefix(scope), ...LEGACY_AUTH_PREFIXES];
    try {
      for (let index = store.length - 1; index >= 0; index -= 1) {
        const key = store.key(index);
        if (!key) continue;
        if (prefixes.some(prefix => key.startsWith(prefix))) {
          store.removeItem(key);
        }
      }
    } catch {
      /* ignore */
    }
  }

  function copyAuthKeys(fromStore, toStore, scope) {
    const prefix = authPrefix(scope);
    const prefixes = [prefix, ...LEGACY_AUTH_PREFIXES];
    try {
      for (let index = fromStore.length - 1; index >= 0; index -= 1) {
        const key = fromStore.key(index);
        if (!key) continue;
        if (!prefixes.some(item => key.startsWith(item))) continue;
        const value = fromStore.getItem(key);
        if (value == null) continue;
        const scopedKey = key.startsWith(prefix)
          ? key
          : prefix + key.replace(/^(brem-auth-|brem_sb_)/, '');
        toStore.setItem(scopedKey, value);
      }
    } catch {
      /* ignore */
    }
  }

  function migrateSessionToPersist(scope) {
    const keys = sessionKeys(scope);
    try {
      keys.forEach(key => {
        const value = sessionStorage.getItem(key);
        if (value != null) {
          localStorage.setItem(key, value);
        }
      });
      copyAuthKeys(sessionStorage, localStorage, scope);
    } catch {
      /* ignore */
    }
  }

  function clearSessionKeys(scope, stores) {
    const keys = sessionKeys(scope);
    stores.forEach(store => {
      keys.forEach(key => {
        try { store.removeItem(key); } catch { /* ignore */ }
      });
      clearAuthKeysInStore(store, scope);
    });
  }

  function setKeepLoggedIn(scope, enabled) {
    try {
      if (enabled) {
        localStorage.setItem(prefKey('keepLoggedIn', scope), '1');
        migrateSessionToPersist(scope);
        return;
      }
      localStorage.removeItem(prefKey('keepLoggedIn', scope));
      clearSessionKeys(scope, [localStorage]);
    } catch {
      /* ignore */
    }
  }

  function getSessionStore(scope) {
    // 관리자 세션은 항상 localStorage(영구). 로그아웃 시에만 clearPersistedSessionOnLogout로 해제.
    if (scopeOf(scope) === SCOPES.ADMIN) return localStorage;
    if (isNativeRiderApp()) return localStorage;
    return isKeepLoggedIn(scope) ? localStorage : sessionStorage;
  }

  function clearPersistedSessionOnLogout(scope) {
    try {
      localStorage.removeItem(prefKey('keepLoggedIn', scope));
    } catch {
      /* ignore */
    }
    clearSessionKeys(scope, [sessionStorage, localStorage]);
  }

  function applyLoginForm(scope, elements = {}) {
    const { idInput, rememberCheckbox, keepCheckbox } = elements;
    if (rememberCheckbox) rememberCheckbox.checked = isRememberIdEnabled(scope);
    if (keepCheckbox) {
      // 관리자: 기본 로그인 유지(로그아웃할 때까지)
      if (scopeOf(scope) === SCOPES.ADMIN) {
        keepCheckbox.checked = true;
        if (!isKeepLoggedIn(scope)) setKeepLoggedIn(scope, true);
      } else if (isNativeRiderApp()) {
        keepCheckbox.checked = true;
        setKeepLoggedIn(scope, true);
      } else {
        keepCheckbox.checked = isKeepLoggedIn(scope);
      }
    }
    if (idInput) {
      const remembered = getRememberedId(scope);
      if (remembered) idInput.value = remembered;
    }
  }

  function captureLoginPrefs(scope, elements = {}) {
    const { idInput, rememberCheckbox, keepCheckbox } = elements;
    const loginId = String(idInput?.value || '').trim();
    saveRememberId(scope, loginId, Boolean(rememberCheckbox?.checked));
    // 관리자: 체크 여부와 관계없이 항상 로그인 유지
    if (scopeOf(scope) === SCOPES.ADMIN) {
      setKeepLoggedIn(scope, true);
    } else {
      setKeepLoggedIn(scope, Boolean(keepCheckbox?.checked));
    }
  }

  function restoreIdAfterLogout(scope, elements = {}) {
    const { idInput, rememberCheckbox, passwordInput } = elements;
    if (passwordInput) passwordInput.value = '';
    applyLoginForm(scope, { idInput, rememberCheckbox });
  }

  window.BremLoginPrefs = {
    SCOPES,
    isRememberIdEnabled,
    getRememberedId,
    saveRememberId,
    isKeepLoggedIn,
    setKeepLoggedIn,
    getSessionStore,
    migrateSessionToPersist,
    clearPersistedSessionOnLogout,
    applyLoginForm,
    captureLoginPrefs,
    restoreIdAfterLogout,
    authPrefix
  };
})();
