/**
 * 기사등록 프로그램( rider-manage / drivers ) 접근 — 관리자 Supabase 세션 공유
 */
window.BremDriverProgramAccess = (function () {
  function startProgramAdminSessionSecurity() {
    if (!window.BremSessionSecurity?.start) return;
    if (!BremStorage.auth.isAdminLoggedIn?.()) return;

    window.BremSessionSecurity.start({
      idleMs: window.BremSessionSecurity.ADMIN_IDLE_MS,
      isLoggedIn: () => {
        try {
          return Boolean(BremStorage.auth.isAdminLoggedIn?.());
        } catch {
          return false;
        }
      },
      onIdleLogout: async (message) => {
        window.BremSessionSecurity.stop();

        if (BremStorage.getSupabaseConfig?.().mode === 'production') {
          await BremStorage.auth.signOutSupabase?.();
        } else {
          BremStorage.auth.clearAdminSession?.();
          BremStorage.auth.clearSessionAuth?.();
        }

        try {
          sessionStorage.setItem(
            BremSessionSecurity.NOTICE_KEY,
            message || BremSessionSecurity.IDLE_MESSAGE
          );
        } catch {
          /* ignore */
        }

        window.location.replace('admin.html');
      }
    });
  }

  function hasAdminAuthHint() {
    try {
      if (localStorage.getItem('brem_admin_logged_in') === 'true') return true;
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith('brem-auth-admin-') && localStorage.getItem(key)) return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  async function ensure() {
    if (window.BremSupabaseConfig?.load) {
      await window.BremSupabaseConfig.load();
    }

    try {
      window.BremLoginPrefs?.setKeepLoggedIn?.('admin', true);
      window.BremLoginPrefs?.migrateSessionToPersist?.('admin');
    } catch {
      /* ignore */
    }

    const adminIdleMs = Number(window.BremSessionSecurity?.ADMIN_IDLE_MS);
    const idleEnabled = Number.isFinite(adminIdleMs) ? adminIdleMs > 0 : true;
    if (
      idleEnabled
      && window.BremSessionSecurity?.isIdleExpired?.()
      && BremStorage.auth.isAdminLoggedIn?.()
    ) {
      try {
        sessionStorage.setItem(
          BremSessionSecurity.NOTICE_KEY,
          BremSessionSecurity.IDLE_MESSAGE
        );
      } catch {
        /* ignore */
      }
      if (BremStorage.getSupabaseConfig?.().mode === 'production') {
        await BremStorage.auth.signOutSupabase?.();
      } else {
        BremStorage.auth.clearAdminSession?.();
        BremStorage.auth.clearSessionAuth?.();
      }
      window.location.replace('admin.html');
      return false;
    }

    let access = await BremStorage.auth.ensureDriverProgramAccess?.();
    if (!access?.ok && hasAdminAuthHint()) {
      // 세션 힌트는 있는데 1회 실패 → 짧게 기다렸다 재시도
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        window.BremLoginPrefs?.migrateSessionToPersist?.('admin');
      } catch {
        /* ignore */
      }
      access = await BremStorage.auth.ensureDriverProgramAccess?.();
    }

    if (!access?.ok) {
      try {
        sessionStorage.setItem(
          'brem_driver_program_access_error',
          access?.message || '관리자 로그인이 필요합니다.'
        );
      } catch {
        /* ignore */
      }
      // return= 자동 재진입 루프 방지
      window.location.replace('admin.html');
      return false;
    }

    startProgramAdminSessionSecurity();
    window.BremSessionSecurity?.touchActivity?.();
    window.BremDbConnectionStatus?.bind('driverDbStatus');
    return true;
  }

  return { ensure, hasAdminAuthHint };
})();
