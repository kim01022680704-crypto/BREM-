/**
 * 기사등록 프로그램( rider-manage / drivers ) 접근 — 관리자 Supabase 세션 공유
 * 세션: sessionStorage only (탭/창 종료 시 로그아웃, 새로고침 시 유지)
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

    // 관리자 유휴 로그아웃이 꺼져 있으면(ADMIN_IDLE_MS=0) 이 검사로 강제 로그아웃하지 않음
    // (이전: isIdleExpired가 30분 기본값으로 true → drivers.html 진입 불가/루프)
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
    window.BremSessionSecurity?.touchActivity?.();
    window.BremDbConnectionStatus?.bind('driverDbStatus');
    return true;
  }

  return { ensure };
})();
