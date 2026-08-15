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
  // 배민 자동수집 반영 — 화면이 열려 있으면 수동 새로고침 없이 갱신
  const POLL_MS = 60 * 1000;
  const PERSIST_KEY = 'brem_rider_region_dashboard_v1';
  const cache = new Map();

  const state = {
    visible: false,
    loading: false,
    requestSeq: 0,
    platform: 'baemin',
    regionKey: '',
    weekStart: '',
    lastResult: null,
    pollTimer: null
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

  function localDateKey(date = new Date()) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  // 정산주 수~화 — 오늘이 토요일이어도 그 주의 수요일로 당긴다.
  function settlementWeekStart(dateValue) {
    if (window.BremDatePicker?.weekStartKey) {
      return window.BremDatePicker.weekStartKey(dateValue || localDateKey());
    }
    const seed = String(dateValue || localDateKey()).slice(0, 10);
    const date = new Date(`${/^\d{4}-\d{2}-\d{2}$/.test(seed) ? seed : localDateKey()}T00:00:00`);
    if (Number.isNaN(date.getTime())) return localDateKey();
    date.setDate(date.getDate() - ((date.getDay() - 3 + 7) % 7));
    return localDateKey(date);
  }

  function ensureWeekStart() {
    state.weekStart = settlementWeekStart(state.weekStart || localDateKey());
    return state.weekStart;
  }

  function formatWeekLabel(weekStart, weekEnd) {
    if (!weekStart || !weekEnd) return '-';
    const fmt = (key, dow) => {
      const [, m, d] = String(key).split('-');
      return `${Number(m)}.${Number(d)}(${dow})`;
    };
    return `${fmt(weekStart, '수')}~${fmt(weekEnd, '화')}`;
  }

  function cacheKey(platform = state.platform, regionKey = state.regionKey, weekStart = state.weekStart) {
    return [platform || 'baemin', regionKey || '-', weekStart || '-'].join('|');
  }

  function readMemoryCache(key = cacheKey()) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
      cache.delete(key);
      return null;
    }
    return hit.data;
  }

  function writeMemoryCache(data, key = cacheKey()) {
    cache.set(key, { at: Date.now(), data });
  }

  function readPersistedDashboard() {
    try {
      const raw = sessionStorage.getItem(PERSIST_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.ok || !parsed?.platform) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function writePersistedDashboard(data) {
    if (!data?.ok) return;
    try {
      sessionStorage.setItem(PERSIST_KEY, JSON.stringify({
        ...data,
        savedAt: new Date().toISOString()
      }));
    } catch (_) {
      // quota 초과는 무시
    }
  }

  function findBestStale() {
    const weekStart = ensureWeekStart();
    const exact = readMemoryCache(cacheKey(state.platform, state.regionKey, weekStart));
    if (exact) return exact;
    const persisted = readPersistedDashboard();
    if (!persisted) return null;
    if (persisted.platform !== state.platform) return null;
    if (state.regionKey && persisted.selectedRegionKey && persisted.selectedRegionKey !== state.regionKey) {
      return null;
    }
    // 같은 플랫폼의 직전 성공분이면 즉시 그려서 빈 화면을 피한다.
    return persisted;
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

    if (regions.length) {
      setEntryVisible(true);
    } else if (result?.dashboardHidden === true || result?.viewerMode === 'hidden') {
      void refreshEntryVisibility();
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
    const assignedLabelEl = document.getElementById('driverRegionDashAssignedLabel');
    const hasProgress = typeof metrics.progressLabel === 'string';
    if (assignedLabelEl) assignedLabelEl.textContent = hasProgress ? '완료/할당' : '할당';
    if (assignedEl) {
      assignedEl.textContent = hasProgress ? metrics.progressLabel : formatNumber(metrics.assigned);
    }
    if (operatingEl) operatingEl.textContent = formatNumber(metrics.operating);
    if (remainingEl) remainingEl.textContent = formatNumber(metrics.remaining);

    const rankingsHidden = result?.rankingsHidden === true
      || result?.viewerMode === 'metrics';
    document.querySelectorAll('.driver-region-dash-rank-block').forEach(el => {
      el.hidden = rankingsHidden;
    });

    if (rankingsHidden) {
      renderRanking(realtimeList, [], '할당만 보기 — 순위는 표시하지 않습니다.');
      renderRanking(weeklyList, []);
      if (noteEl) {
        const slot = metrics.slotLabel ? ` · ${metrics.slotLabel}` : '';
        noteEl.textContent = [
          metrics.sourceNote || '할당 현황만 표시됩니다',
          '순위 보드는 숨김(본인 설정: 할당만)'
        ].filter(Boolean).join(' · ') + (slot || '');
      }
      return;
    }

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

  function stopAutoPoll() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function startAutoPoll() {
    stopAutoPoll();
    state.pollTimer = setInterval(() => {
      if (!state.visible || document.visibilityState === 'hidden') return;
      if (state.loading) return;
      cache.delete(cacheKey());
      void loadDashboard({ silent: true, force: true });
    }, POLL_MS);
  }

  async function loadDashboard({ silent = false, force = false } = {}) {
    if (!window.BremStorage?.fetchRiderRegionDashboardFromServer) {
      if (!silent) showToast('대시보드 API를 사용할 수 없습니다.');
      return;
    }
    const seq = ++state.requestSeq;
    ensureWeekStart();
    const freshMemory = force ? null : readMemoryCache();
    if (freshMemory) {
      renderDashboard(freshMemory);
      return;
    }
    const stale = force ? null : findBestStale();
    if (stale) renderDashboard(stale);

    // 이전 데이터가 있으면 전체 로딩 오버레이를 쓰지 않아 화면이 깜빡이지 않는다.
    // 자동 폴링(silent)은 깜빡임 클래스도 생략한다.
    const hasStaleUi = Boolean(stale) || Boolean(state.lastResult);
    state.loading = true;
    if (!hasStaleUi) panel.classList.add('is-loading');
    else if (!silent) panel.classList.add('is-refreshing');
    try {
      const weekStart = ensureWeekStart();
      const result = await window.BremStorage.fetchRiderRegionDashboardFromServer({
        platform: state.platform,
        regionKey: state.regionKey,
        weekStart
      });
      if (seq !== state.requestSeq) return;
      if (!result?.ok) {
        const msg = result?.message || result?.error || '기사대시보드를 불러오지 못했습니다.';
        if (!silent) showToast(hasStaleUi ? `이전 데이터 표시 중 · ${msg}` : msg);
        // 타임아웃/실패 때 empty를 덮어쓰지 않는다. (노출 안내와 섞이면 안 됨)
        if (!hasStaleUi && /노출/i.test(msg)) {
          if (emptyEl) {
            emptyEl.hidden = false;
            emptyEl.querySelector('p')?.replaceChildren(document.createTextNode(msg));
          }
          if (contentEl) contentEl.hidden = true;
        }
        return;
      }
      writeMemoryCache(result);
      writePersistedDashboard(result);
      renderDashboard(result);
    } catch (error) {
      if (seq !== state.requestSeq) return;
      const msg = error.message || '기사대시보드를 불러오지 못했습니다.';
      if (!silent) showToast(hasStaleUi ? `이전 데이터 표시 중 · ${msg}` : msg);
    } finally {
      if (seq === state.requestSeq) {
        state.loading = false;
        panel.classList.remove('is-loading');
        panel.classList.remove('is-refreshing');
      }
    }
  }

  function setEntryVisible(visible) {
    openBtn.hidden = !visible;
    if (!visible) {
      closePanel();
    }
  }

  async function refreshEntryVisibility() {
    if (!window.BremStorage?.fetchRiderRegionDashboardFromServer) return;
    try {
      const weekStart = ensureWeekStart();
      const [baemin, coupang] = await Promise.all([
        window.BremStorage.fetchRiderRegionDashboardFromServer({ platform: 'baemin', weekStart }),
        window.BremStorage.fetchRiderRegionDashboardFromServer({ platform: 'coupang', weekStart })
      ]);
      const has = Boolean(
        (baemin?.ok && baemin.regions?.length)
        || (coupang?.ok && coupang.regions?.length)
      );
      // 둘 다 성공했는데 지역이 없으면 숨김. 한쪽만 실패하면 버튼을 남긴다.
      const bothOk = baemin?.ok === true && coupang?.ok === true;
      if (bothOk) setEntryVisible(has);
    } catch {
      /* 네트워크 실패 시 버튼 유지 */
    }
  }

  function openPanel() {
    window.BremDriverWithdrawal?.close?.();
    window.BremDriverWeeklyPayslip?.close?.();
    state.visible = true;
    panel.hidden = false;
    openBtn.setAttribute('aria-expanded', 'true');
    ensureWeekStart();
    syncPlatformTabs();
    // 열자마자 직전 성공분을 먼저 그린다.
    const stale = findBestStale();
    if (stale) renderDashboard(stale);
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    void loadDashboard({ force: false }).then(() => {
      const result = state.lastResult;
      if (result?.ok && !result.regions?.length) {
        // 현재 플랫폼이 비어도 다른 플랫폼에 있을 수 있어 전체 재검사
        void refreshEntryVisibility();
      }
    });
    startAutoPoll();
  }

  function closePanel() {
    state.visible = false;
    stopAutoPoll();
    panel.hidden = true;
    openBtn.setAttribute('aria-expanded', 'false');
  }

  function resetPanel() {
    state.requestSeq += 1;
    state.platform = 'baemin';
    state.regionKey = '';
    state.weekStart = settlementWeekStart(localDateKey());
    state.lastResult = null;
    state.loading = false;
    cache.clear();
    stopAutoPoll();
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
    void loadDashboard({ force: true });
  });
  regionSelect?.addEventListener('change', () => {
    state.regionKey = regionSelect.value || '';
    void loadDashboard({ force: false });
  });
  panel.addEventListener('click', event => {
    const tab = event.target.closest('[data-region-dash-platform]');
    if (!tab) return;
    const next = tab.dataset.regionDashPlatform;
    if (!['baemin', 'coupang'].includes(next) || next === state.platform) return;
    state.platform = next;
    state.regionKey = '';
    syncPlatformTabs();
    const stale = findBestStale();
    if (stale) renderDashboard(stale);
    void loadDashboard({ force: false });
  });

  window.BremDriverRegionDashboard = {
    open: openPanel,
    close: closePanel,
    reload: loadDashboard,
    reset: resetPanel,
    invalidateCache() {
      cache.clear();
    },
    refreshEntryVisibility
  };

  void refreshEntryVisibility();
})();
