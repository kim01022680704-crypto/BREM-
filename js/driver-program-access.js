/**
 * 기사등록 프로그램( rider-manage / drivers ) 접근 — 관리자 Supabase 세션 공유
 */
window.BremDriverProgramAccess = (function () {
  async function ensure() {
    if (window.BremSupabaseConfig?.load) {
      await window.BremSupabaseConfig.load();
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

    window.BremDbConnectionStatus?.bind('driverDbStatus');
    return true;
  }

  return { ensure };
})();
