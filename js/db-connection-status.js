/**
 * Supabase DB 연결 상태 + 데이터 캐시 상태 표시 (관리자·기사등록 페이지 공통)
 */
window.BremDbConnectionStatus = (function () {
  function formatCacheLine(cacheStatus) {
    if (!cacheStatus) return '';
    const parts = [];
    if (cacheStatus.driversComplete && cacheStatus.driversCount) {
      const loadedAt = window.BremDataCache?.formatLoadedAt?.(cacheStatus.driversLoadedAt);
      parts.push(`기사 ${cacheStatus.driversCount}명${loadedAt ? ` · ${loadedAt}` : ''}`);
    }
    if (cacheStatus.missionsCount) {
      const loadedAt = window.BremDataCache?.formatLoadedAt?.(cacheStatus.missionsLoadedAt);
      parts.push(`미션 ${cacheStatus.missionsCount}${loadedAt ? ` · ${loadedAt}` : ''}`);
    }
    const network = cacheStatus.fetchStats?.network ?? 0;
    const hits = cacheStatus.fetchStats?.hits ?? 0;
    if (network || hits) {
      parts.push(`조회 ${network}/${network + hits}`);
    }
    return parts.join(' · ');
  }

  function render(elementId) {
    const el = document.getElementById(elementId);
    if (!el || typeof BremStorage === 'undefined') return;

    const status = BremStorage.getStorageStatus?.() || {};
    const config = BremStorage.getSupabaseConfig?.() || {};
    const cacheStatus = BremStorage.getCacheStatus?.() || {};
    const cacheLine = formatCacheLine(cacheStatus);
    const versionLabel = cacheStatus.version ? `v${cacheStatus.version}` : '';

    if (config.mode === 'production') {
      if (status.backend === 'supabase' && status.supabaseHydrated) {
        el.textContent = cacheLine
          ? `DB: Connected ${versionLabel} · ${cacheLine}`
          : `DB: Supabase Connected ${versionLabel}`.trim();
        el.className = 'db-status db-status--ok';
        el.title = cacheLine || 'Supabase 연결됨';
        return;
      }
      if (status.supabaseError) {
        el.textContent = cacheLine
          ? `DB: 오류 · 캐시 유지 (${cacheLine})`
          : `DB: Disconnected (${status.supabaseError})`;
        el.className = 'db-status db-status--error';
        el.title = status.supabaseError;
        return;
      }
      el.textContent = 'DB: Connecting…';
      el.className = 'db-status db-status--pending';
      return;
    }

    el.textContent = status.backend === 'supabase' && status.supabaseHydrated
      ? (cacheLine ? `DB: Supabase (개발) · ${cacheLine}` : 'DB: Supabase Connected (개발)')
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
    document.addEventListener('brem-admin-data-ready', update);
    document.addEventListener('brem-drivers-sync-ready', update);
    document.addEventListener('brem-cache-status-changed', update);
    return { refresh: update };
  }

  return { render, bind };
})();
