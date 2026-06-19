/**
 * 기사등록 프로그램( rider-manage / drivers ) 접근 — 관리자 Supabase 세션 공유
 * 세션: sessionStorage only (탭/창 종료 시 로그아웃, 새로고침 시 유지)
 */
window.BremDriverProgramAccess = (function () {
  function startProgramAdminSessionSecurity() {
    if (!window.BremSessionSecurity?.start) return;
    if (!BremStorage.auth.isAdminLoggedIn?.()) return;

    window.BremSessionSecurity.start({
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

        const returnPath = `${window.location.pathname}${window.location.search}`;
        const query = returnPath && returnPath !== '/'
          ? `?return=${encodeURIComponent(returnPath)}`
          : '';
        window.location.replace(`admin.html${query}`);
      }
    });
  }

  async function ensure() {
    if (window.BremSupabaseConfig?.load) {
      await window.BremSupabaseConfig.load();
    }

    if (window.BremSessionSecurity?.isIdleExpired?.() && BremStorage.auth.isAdminLoggedIn?.()) {
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

    const access = await BremStorage.auth.ensureDriverProgramAccess?.();
    if (!access?.ok) {
      const returnPath = `${window.location.pathname}${window.location.search}`;
      const query = returnPath && returnPath !== '/'
        ? `?return=${encodeURIComponent(returnPath)}`
        : '';
      window.location.replace(`admin.html${query}`);
      return false;
    }

    startProgramAdminSessionSecurity();
    window.BremDbConnectionStatus?.bind('driverDbStatus');
    return true;
  }

  return { ensure };
})();
