/**
 * 세션 보안 — 30분 비활성 자동 로그아웃, 활동 감지
 * sessionStorage 기반 (탭/브라우저 종료 시 세션 소멸)
 */
window.BremSessionSecurity = (function () {
  const IDLE_MS = 30 * 60 * 1000;
  const CHECK_MS = 60 * 1000;
  const ACTIVITY_KEY = 'brem_session_last_activity';
  const NOTICE_KEY = 'brem_logout_notice';
  const IDLE_MESSAGE = '30분 동안 활동이 없어 자동 로그아웃되었습니다.';

  let timer = null;
  let config = null;
  let loggingOut = false;
  let boundActivity = null;

  function safeIsLoggedIn(isLoggedInFn) {
    if (typeof isLoggedInFn !== 'function') return false;
    try {
      return Boolean(isLoggedInFn());
    } catch {
      return false;
    }
  }

  function readLoggedInState() {
    return safeIsLoggedIn(config?.isLoggedIn);
  }

  function touchActivity() {
    if (!readLoggedInState()) return;
    try {
      sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  }

  function getLastActivity() {
    try {
      const raw = sessionStorage.getItem(ACTIVITY_KEY);
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0) return value;
    } catch {
      /* ignore */
    }
    return Date.now();
  }

  function isIdleExpired() {
    return Date.now() - getLastActivity() >= IDLE_MS;
  }

  function onUserActivity() {
    touchActivity();
  }

  function bindActivityListeners() {
    if (boundActivity) return;
    boundActivity = onUserActivity;
    ['click', 'keydown', 'touchstart'].forEach(eventName => {
      document.addEventListener(eventName, boundActivity, { capture: true, passive: true });
    });
  }

  function unbindActivityListeners() {
    if (!boundActivity) return;
    ['click', 'keydown', 'touchstart'].forEach(eventName => {
      document.removeEventListener(eventName, boundActivity, { capture: true });
    });
    boundActivity = null;
  }

  async function runIdleLogout() {
    const activeConfig = config;
    if (loggingOut || typeof activeConfig?.onIdleLogout !== 'function') return;
    loggingOut = true;
    const onIdleLogout = activeConfig.onIdleLogout;
    stop();
    try {
      await onIdleLogout(IDLE_MESSAGE);
    } finally {
      loggingOut = false;
    }
  }

  function tick() {
    if (!readLoggedInState()) return;
    if (isIdleExpired()) {
      void runIdleLogout();
    }
  }

  function start(options = {}) {
    const isLoggedInFn = typeof options?.isLoggedIn === 'function' ? options.isLoggedIn : null;
    const onIdleLogoutFn = typeof options?.onIdleLogout === 'function' ? options.onIdleLogout : null;

    stop();

    if (!isLoggedInFn) {
      return false;
    }

    if (!safeIsLoggedIn(isLoggedInFn)) {
      return false;
    }

    config = {
      isLoggedIn: isLoggedInFn,
      onIdleLogout: onIdleLogoutFn
    };

    if (isIdleExpired()) {
      void runIdleLogout();
      return false;
    }

    touchActivity();
    bindActivityListeners();
    timer = window.setInterval(tick, CHECK_MS);
    return true;
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    unbindActivityListeners();
    config = null;
  }

  function clearActivityMarker() {
    try {
      sessionStorage.removeItem(ACTIVITY_KEY);
    } catch {
      /* ignore */
    }
  }

  function consumeLogoutNotice() {
    try {
      const notice = sessionStorage.getItem(NOTICE_KEY);
      if (notice) {
        sessionStorage.removeItem(NOTICE_KEY);
        return notice;
      }
    } catch {
      /* ignore */
    }
    return '';
  }

  return {
    IDLE_MS,
    IDLE_MESSAGE,
    NOTICE_KEY,
    start,
    stop,
    touchActivity,
    clearActivityMarker,
    consumeLogoutNotice,
    isIdleExpired,
    isActive: () => Boolean(config)
  };
})();
