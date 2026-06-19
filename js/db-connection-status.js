/**
 * Supabase DB 연결 상태 표시 (관리자·기사등록 페이지 공통)
 */
window.BremDbConnectionStatus = (function () {
  function render(elementId) {
    const el = document.getElementById(elementId);
    if (!el || typeof BremStorage === 'undefined') return;

    const status = BremStorage.getStorageStatus?.() || {};
    const config = BremStorage.getSupabaseConfig?.() || {};

    if (config.mode === 'production') {
      if (status.backend === 'supabase' && status.supabaseHydrated) {
        el.textContent = 'DB: Supabase Connected';
        el.className = 'db-status db-status--ok';
        return;
      }
      if (status.supabaseError) {
        el.textContent = `DB: Disconnected (${status.supabaseError})`;
        el.className = 'db-status db-status--error';
        return;
      }
      el.textContent = 'DB: Connecting…';
      el.className = 'db-status db-status--pending';
      return;
    }

    el.textContent = status.backend === 'supabase' && status.supabaseHydrated
      ? 'DB: Supabase Connected (개발)'
      : 'DB: Disconnected (개발)';
    el.className = 'db-status db-status--dev';
  }

  function bind(elementId) {
    const update = () => render(elementId);
    update();
    document.addEventListener('brem-config-ready', update);
    document.addEventListener('brem-storage-ready', update);
    document.addEventListener('brem-storage-error', update);
    document.addEventListener('brem-storage-persist-error', update);
    return { refresh: update };
  }

  return { render, bind };
})();
