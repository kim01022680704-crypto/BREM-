(function () {
  const panel = document.getElementById('driverRegionDashboardPanel');
  const openBtn = document.getElementById('driverRegionDashboardBtn');
  const closeBtn = document.getElementById('driverRegionDashboardCloseBtn');
  const regionSelect = document.getElementById('driverRegionDashboardRegion');
  const periodEl = document.getElementById('driverRegionDashboardPeriod');
  const regionLabelEl = document.getElementById('driverRegionDashboardRegionLabel');
  const emptyEl = document.getElementById('driverRegionDashboardEmpty');
  const contentEl = document.getElementById('driverRegionDashboardContent');
  const assignedEl = document.getElementById('driverRegionDashAssigned');
  const operatingEl = document.getElementById('driverRegionDashOperating');
  const remainingEl = document.getElementById('driverRegionDashRemaining');
  const realtimeList = document.getElementById('driverRegionDashRealtimeList');
  const weeklyList = document.getElementById('driverRegionDashWeeklyList');
  const noteEl = document.getElementById('driverRegionDashNote');
  const refreshBtn = document.getElementById('driverRegionDashboardRefreshBtn');

  if (!panel || !openBtn) return;

  const CACHE_TTL_MS = 60 * 1000;
  const cache = new Map();

  const state = {
    visible: false,
    loading: false,
    requestSeq: 0,
    platform: 'baemin',
    regionKey: '',
    weekStart: '',
    lastResult: null
  };

  function showToast(message) {
    const el = document.getElementById('toast');
    if (!el || !message) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function formatWeekLabel(weekStart, weekEnd) {
    if (!weekStart || !weekEnd) return '-';
    const fmt = (key, dow) => {
      const [, m, d] = String(key).split('-');
      return `${Number(m)}.${Number(d)}(${dow})`;
    };
    return `${fmt(weekStart, '수')}~${fmt(weekEnd, '화')}`;
  }

  function cacheKey() {
    return [state.platform, state.regionKey || '-', state.weekStart || '-'].join('|');
  }

  function readCache() {
    const hit = cache.get(cacheKey());
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
      cache.delete(cacheKey());
      return null;
    }
    return hit.data;
  }

  function writeCache(data) {
    cache.set(cacheKey(), { at: Date.now(), data });
  }

  function syncPlatformTabs() {
    panel.querySelectorAll('[data-region-dash-platform]').forEach(tab => {
      const active = tab.dataset.regionDashPlatform === state.platform;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function renderRegionOptions(regions = [], selectedKey = '') {
    if (!regionSelect) return;
    if (!regions.length) {
      regionSelect.innerHTML = '<option value="">노출 지역 없음</option>';
      regionSelect.disabled = true;
      return;
    }
    regionSelect.disabled = false;
    regionSelect.innerHTML = regions.map(region => (
      `<option value="${escapeHtml(region.key)}"${region.key === selectedKey ? ' selected' : ''}>${escapeHtml(region.label || region.key)}</option>`
    )).join('');
  }

  function renderRanking(listEl, rows = [], emptyText = '집계된 콜수가 없습니다.') {
    if (!listEl) return;
    if (!rows.length) {
      listEl.innerHTML = `<li class="driver-region-dash-rank driver-region-dash-rank--empty">${escapeHtml(emptyText)}</li>`;
      return;
    }
    listEl.innerHTML = rows.map((row, index) => {
      const rank = row.rank || index + 1;
      const top = rank === 1 ? ' is-top' : '';
      return `<li class="driver-region-dash-rank${top}">
        <span class="driver-region-dash-rank__n">${rank}</span>
        <span class="driver-region-dash-rank__name">${escapeHtml(row.name || '-')}</span>
        <strong class="driver-region-dash-rank__count">${formatNumber(row.callCount)}콜</strong>
      </li>`;
    }).join('');
  }

  function renderDashboard(result) {
    state.lastResult = result || null;
    const regions = Array.isArray(result?.regions) ? result.regions : [];
    const selectedKey = result?.selectedRegionKey || state.regionKey || '';
    state.regionKey = selectedKey;
    state.weekStart = result?.weekStart || state.weekStart;

    renderRegionOptions(regions, selectedKey);
    if (periodEl) periodEl.textContent = formatWeekLabel(result?.weekStart, result?.weekEnd);
    if (regionLabelEl) {
      regionLabelEl.textContent = result?.region?.label || selectedKey || '-';
    }

    const noRegions = !regions.length;
    const message = result?.message || (noRegions ? '관리자가 노출로 설정한 지역이 없습니다.' : '');
    if (emptyEl) {
      emptyEl.hidden = !noRegions;
      emptyEl.querySelector('p')?.replaceChildren(document.createTextNode(message || '표시할 지역이 없습니다.'));
    }
    if (contentEl) contentEl.hidden = noRegions;

    if (noRegions) {
      renderRanking(realtimeList, []);
      renderRanking(weeklyList, []);
      return;
    }

    const metrics = result?.metrics || {};
    if (assignedEl) assignedEl.textContent = formatNumber(metrics.assigned);
    if (operatingEl) operatingEl.textContent = formatNumber(metrics.operating);
    if (remainingEl) remainingEl.textContent = formatNumber(metrics.remaining);

    const realtimeDisabled = result?.realtimeRankingDisabled === true
      || result?.platform === 'coupang';
    renderRanking(
      realtimeList,
      realtimeDisabled ? [] : (result?.realtimeRanking || []),
      realtimeDisabled
        ? (result.realtimeRankingReason || '쿠팡은 실시간 기사별 순위를 집계하지 않습니다. (0.8 가중치)')
        : '집계된 콜수가 없습니다.'
    );
    renderRanking(weeklyList, result?.weeklyRanking || []);
    if (noteEl) {
      const slot = metrics.slotLabel ? ` · ${metrics.slotLabel}` : '';
      noteEl.textContent = [
        metrics.sourceNote || '노출 지역은 관리자가 설정한 지역만 표시됩니다',
        '순위는 해당 지역 등록 기사만'
      ].filter(Boolean).join(' · ') + (slot || '');
    }
  }

  async function loadDashboard({ silent = false } = {}) {
    if (!window.BremStorage?.fetchRiderRegionDashboardFromServer) {
      if (!silent) showToast('대시보드 API를 사용할 수 없습니다.');
      return;
    }
    const seq = ++state.requestSeq;
    const cached = readCache();
    if (cached) {
      renderDashboard(cached);
      if (!silent) return;
    }

    state.loading = true;
    panel.classList.add('is-loading');
    try {
      const result = await window.BremStorage.fetchRiderRegionDashboardFromServer({
        platform: state.platform,
        regionKey: state.regionKey,
        weekStart: state.weekStart
      });
      if (seq !== state.requestSeq) return;
      if (!result?.ok) {
        if (!silent) showToast(result?.message || result?.error || '기사대시보드를 불러오지 못했습니다.');
        if (!cached) {
          if (emptyEl) {
            emptyEl.hidden = false;
            emptyEl.querySelector('p')?.replaceChildren(
              document.createTextNode(result?.message || result?.error || '불러오기 실패')
            );
          }
          if (contentEl) contentEl.hidden = true;
        }
        return;
      }
      writeCache(result);
      renderDashboard(result);
    } catch (error) {
      if (seq !== state.requestSeq) return;
      if (!silent) showToast(error.message || '기사대시보드를 불러오지 못했습니다.');
    } finally {
      if (seq === state.requestSeq) {
        state.loading = false;
        panel.classList.remove('is-loading');
      }
    }
  }

  function openPanel() {
    window.BremDriverWithdrawal?.close?.();
    window.BremDriverWeeklyPayslip?.close?.();
    state.visible = true;
    panel.hidden = false;
    openBtn.setAttribute('aria-expanded', 'true');
    syncPlatformTabs();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    void loadDashboard();
  }

  function closePanel() {
    state.visible = false;
    panel.hidden = true;
    openBtn.setAttribute('aria-expanded', 'false');
  }

  function resetPanel() {
    state.requestSeq += 1;
    state.platform = 'baemin';
    state.regionKey = '';
    state.weekStart = '';
    state.lastResult = null;
    state.loading = false;
    cache.clear();
    closePanel();
    if (periodEl) periodEl.textContent = '-';
    if (regionLabelEl) regionLabelEl.textContent = '-';
    if (assignedEl) assignedEl.textContent = '-';
    if (operatingEl) operatingEl.textContent = '-';
    if (remainingEl) remainingEl.textContent = '-';
    if (realtimeList) realtimeList.innerHTML = '';
    if (weeklyList) weeklyList.innerHTML = '';
    if (contentEl) contentEl.hidden = true;
    if (emptyEl) emptyEl.hidden = false;
  }

  openBtn.addEventListener('click', () => {
    if (state.visible) {
      closePanel();
      return;
    }
    openPanel();
  });
  closeBtn?.addEventListener('click', closePanel);
  refreshBtn?.addEventListener('click', () => {
    cache.delete(cacheKey());
    void loadDashboard();
  });
  regionSelect?.addEventListener('change', () => {
    state.regionKey = regionSelect.value || '';
    cache.delete(cacheKey());
    void loadDashboard();
  });
  panel.addEventListener('click', event => {
    const tab = event.target.closest('[data-region-dash-platform]');
    if (!tab) return;
    const next = tab.dataset.regionDashPlatform;
    if (!['baemin', 'coupang'].includes(next) || next === state.platform) return;
    state.platform = next;
    state.regionKey = '';
    syncPlatformTabs();
    cache.delete(cacheKey());
    void loadDashboard();
  });

  window.BremDriverRegionDashboard = {
    open: openPanel,
    close: closePanel,
    reload: loadDashboard,
    reset: resetPanel,
    invalidateCache() {
      cache.clear();
    }
  };
})();
