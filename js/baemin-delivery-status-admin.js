(function () {
  const state = {
    config: null,
    loading: false,
    collecting: false,
    applying: false,
    setupPollTimer: null,
    statusPollTimer: null,
    localHealthPollTimer: null,
    localServerRunning: false,
    localBrowser: null,
    localSession: null,
    localAutoCollect: null,
    activeSection: 'baemin-biz-status',
    activePartnerId: '',
    activeMenu: 'delivery_status',
    partners: [],
    contamination: null,
    appliedCollectDate: '',
    viewWeekStart: '',
    bizPreviewCollectDate: '',
    dataCache: {
      key: '',
      byPartner: {},
      loadingPartner: ''
    },
    localSessionConfig: {
      port: 3939,
      localHealthUrls: [
        'http://127.0.0.1:3939/health',
        'http://localhost:3939/health'
      ]
    }
  };

  function $(id) {
    return document.getElementById(id);
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  async function adminApi(path, options = {}) {
    const token = await BremStorage.resolveAdminAccessToken?.();
    if (!token) {
      return { ok: false, message: '관리자 로그인이 필요합니다.' };
    }

    try {
      const response = await fetch(path, {
        credentials: 'same-origin',
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false,
          message: payload.message || payload.error || `요청 실패 (${response.status})`
        };
      }
      return { ok: true, ...payload };
    } catch (error) {
      return { ok: false, message: error.message || '네트워크 오류' };
    }
  }

  const MENU_IDS = ['delivery_status', 'daily_history', 'rider_history'];

  function isViewSection() {
    return state.activeSection === 'baemin-status';
  }

  function resolveBizCaptureDate() {
    return String(
      state.bizPreviewCollectDate
      || $('baeminDeliveryCaptureDate')?.value
      || todayKstDate()
    ).slice(0, 10);
  }

  function setBizCaptureDate(date) {
    const value = String(date || '').slice(0, 10);
    if (!value) return;
    state.bizPreviewCollectDate = value;
    const dateInput = $('baeminDeliveryCaptureDate');
    if (dateInput) dateInput.value = value;
  }

  function clearBizPreviewTables(message) {
    const ui = tableUiConfig();
    const text = message || ui.emptyMessage;
    Object.entries(ui.rowsMap).forEach(([menu, rowsId]) => {
      const summaryId = ui.summaryMap[menu];
      const summaryEl = $(summaryId);
      const rowsEl = $(rowsId);
      const colspan = menu === 'daily_history' ? 11 : (menu === 'rider_history' ? 13 : 14);
      if (summaryEl) summaryEl.textContent = '데이터 없음';
      if (rowsEl) rowsEl.innerHTML = `<tr><td colspan="${colspan}" class="form-help">${text}</td></tr>`;
    });
  }

  function ensureViewWeekStart() {
    if (state.viewWeekStart) return state.viewWeekStart;
    const today = todayKstDate();
    state.viewWeekStart = window.BremDatePicker?.applyWeekWednesday?.(today) || today;
    return state.viewWeekStart;
  }

  function formatViewWeekRangeLabel(weekStart) {
    if (window.BremDatePicker?.formatWednesdayWeekRange) {
      return BremDatePicker.formatWednesdayWeekRange(weekStart);
    }
    return weekStart || '';
  }

  function syncViewWeekPicker() {
    const input = $('baeminStatusWeekStart');
    const label = $('baeminStatusWeekRangeLabel');
    const weekStart = ensureViewWeekStart();
    if (input) input.value = weekStart;
    if (label) {
      label.textContent = weekStart
        ? `조회 기간: ${formatViewWeekRangeLabel(weekStart)}`
        : '';
    }
  }

  function updateWeekPickerVisibility() {
    const row = $('baeminStatusWeekPickerRow');
    if (!row || !isViewSection()) {
      if (row) row.hidden = true;
      return;
    }
    const show = state.activeMenu === 'daily_history' || state.activeMenu === 'rider_history';
    row.hidden = !show;
    if (show) syncViewWeekPicker();
  }

  function isHistoryViewMenu(menu = state.activeMenu) {
    return menu === 'daily_history' || menu === 'rider_history';
  }

  function buildViewPartnersQuery(captureDate) {
    let query = `/api/admin/baemin-delivery/partners?collectDate=${encodeURIComponent(captureDate)}&appliedOnly=1`;
    if (isHistoryViewMenu()) {
      query += `&weekStart=${encodeURIComponent(ensureViewWeekStart())}&sourceMenu=${encodeURIComponent(state.activeMenu)}`;
    }
    return query;
  }

  function buildViewItemsQuery(captureDate, sourceMenu, partnerId) {
    let query = `/api/admin/baemin-delivery/items?collectDate=${encodeURIComponent(captureDate)}&sourceMenu=${encodeURIComponent(sourceMenu)}&partnerId=${encodeURIComponent(partnerId)}&appliedOnly=1`;
    if (isHistoryViewMenu(sourceMenu)) {
      query += `&weekStart=${encodeURIComponent(ensureViewWeekStart())}`;
    }
    return query;
  }

  function buildCacheKey() {
    const ui = tableUiConfig();
    if (isViewSection()) {
      const applied = state.config?.applied || {};
      const weekPart = isHistoryViewMenu() ? `:week=${ensureViewWeekStart()}` : '';
      return `view:${state.activeMenu}:${state.appliedCollectDate || applied.collectDate || ''}:${applied.batchId || ''}${weekPart}`;
    }
    const captureDate = resolveBizCaptureDate();
    return `biz:${captureDate}`;
  }

  function invalidateDataCache() {
    state.dataCache = { key: '', byPartner: {}, loadingPartner: '' };
  }

  function getCachedPartnerBundle(partnerId) {
    const key = buildCacheKey();
    if (state.dataCache.key !== key) return null;
    return state.dataCache.byPartner[partnerId] || null;
  }

  function setCachedPartnerBundle(partnerId, bundle) {
    const key = buildCacheKey();
    if (state.dataCache.key !== key) {
      state.dataCache = { key, byPartner: {}, loadingPartner: '' };
    }
    state.dataCache.byPartner[partnerId] = bundle;
  }

  function tableUiConfig() {
    if (isViewSection()) {
      return {
        partnerBarId: 'baeminStatusPartnerSubtabBar',
        menuBarId: 'baeminStatusMenuSubtabBar',
        sectionRootId: 'baemin-status',
        panelAttr: 'data-baemin-panel',
        appliedQuery: '&appliedOnly=1',
        emptyMessage: '「배민 BIZ 현황」에서 수집 후 [적용하기]를 눌러 주세요.',
        summaryMap: {
          delivery_status: 'baeminStatusDeliveryStatusSummary',
          daily_history: 'baeminStatusDailyHistorySummary',
          rider_history: 'baeminStatusRiderHistorySummary'
        },
        rowsMap: {
          delivery_status: 'baeminStatusDeliveryStatusRows',
          daily_history: 'baeminStatusDailyHistoryRows',
          rider_history: 'baeminStatusRiderHistoryRows'
        }
      };
    }
    return {
      partnerBarId: 'baeminBizPartnerSubtabBar',
      menuBarId: 'baeminBizMenuSubtabBar',
      sectionRootId: 'baemin-biz-status',
      panelAttr: 'data-baemin-biz-panel',
      appliedQuery: '',
      emptyMessage: '수집된 데이터가 없습니다. [배민 전체 데이터 수집]을 실행하세요.',
      summaryMap: {
        delivery_status: 'baeminBizDeliveryStatusSummary',
        daily_history: 'baeminBizDailyHistorySummary',
        rider_history: 'baeminBizRiderHistorySummary'
      },
      rowsMap: {
        delivery_status: 'baeminBizDeliveryStatusRows',
        daily_history: 'baeminBizDailyHistoryRows',
        rider_history: 'baeminBizRiderHistoryRows'
      }
    };
  }

  function syncPartnerColumnVisibility(show) {
    const root = isViewSection() ? '#baemin-status' : '#baemin-biz-status';
    document.querySelectorAll(`${root} .baemin-data-table`).forEach(table => {
      const headerCell = table.querySelector('thead tr th:first-child');
      if (headerCell && headerCell.textContent.trim() === '협력사') {
        headerCell.hidden = !show;
      }
      table.querySelectorAll('tbody tr td[data-partner-col]').forEach(cell => {
        cell.hidden = !show;
      });
    });
  }

  function formatPartnerCell(parsed) {
    return parsed?.partnerName || parsed?.partnerId || '-';
  }

  function selectedPartnerId() {
    return String(state.activePartnerId || '').trim();
  }

  function renderContaminationBanner(contamination) {
    const el = $('baeminDeliveryContaminationStatus');
    const toolbar = $('baeminBizPartnerToolbar');
    if (!el || isViewSection()) return;

    const needsScrub = Boolean(contamination?.needsScrub);
    if (toolbar) toolbar.hidden = !state.partners.length;

    if (!needsScrub) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }

    const groups = contamination.duplicateGroups || [];
    const lines = groups.map(group => {
      const removed = (group.removePartnerNames || group.removePartnerIds || []).join(', ');
      const kept = group.keepPartnerName || group.keepPartnerId || '-';
      const menus = (group.menus || ['delivery_status']).map(menu => {
        if (menu === 'daily_history') return '일별';
        if (menu === 'rider_history') return '라이더별';
        return '배달현황';
      }).join('·');
      return `<li><strong>${removed}</strong> — ${menus} 데이터가 <strong>${kept}</strong> 과 동일</li>`;
    }).join('');

    const inconsistent = contamination.inconsistentPartners || [];
    const partialLines = inconsistent.map(row => {
      const counts = row.menuCounts || {};
      return `<li><strong>${row.partnerName || row.partnerId}</strong> — 배달 ${formatNumber(counts.delivery_status || 0)} · 일별 ${formatNumber(counts.daily_history || 0)} · 라이더 ${formatNumber(counts.rider_history || 0)} (메뉴별 건수 불일치)</li>`;
    }).join('');

    el.hidden = false;
    el.innerHTML = `
      <strong>협력사별 데이터가 섞여 있습니다</strong>
      <p class="form-help">배달현황만 막히고 일별/라이더 데이터가 다른 협력사 이름으로 저장된 경우가 있습니다. 아래 [협력사 중복 데이터 정리] 후 [수집일 데이터 전체 삭제] → 다시 수집하세요.</p>
      ${lines ? `<ul>${lines}</ul>` : ''}
      ${partialLines ? `<ul>${partialLines}</ul>` : ''}
    `;
  }

  function renderPartnerTabs(partners = []) {
    const ui = tableUiConfig();
    const bar = $(ui.partnerBarId);
    if (!bar) return;
    state.partners = Array.isArray(partners) ? partners : [];
    if (!state.partners.length) {
      bar.hidden = true;
      bar.innerHTML = '';
      const toolbar = $('baeminBizPartnerToolbar');
      if (toolbar) toolbar.hidden = true;
      if (!isViewSection()) {
        clearBizPreviewTables();
        updatePanelVisibility();
      }
      return;
    }

    bar.hidden = false;
    bar.innerHTML = state.partners.map(partner => {
      const id = partner.partnerId;
      const label = partner.partnerName || id;
      const count = Number(partner.riderCount || 0);
      const menuCounts = partner.menuCounts || {};
      const menuHint = menuCounts.delivery_status || menuCounts.daily_history || menuCounts.rider_history
        ? `배달 ${formatNumber(menuCounts.delivery_status || 0)} · 일별 ${formatNumber(menuCounts.daily_history || 0)} · 라이더 ${formatNumber(menuCounts.rider_history || 0)}`
        : (count > 0 ? `${formatNumber(count)}명` : '');
      const countLabel = menuHint ? ` (${menuHint})` : '';
      const active = state.activePartnerId === id ? ' is-active' : '';
      const contaminated = partner.contaminated || partner.inconsistent ? ' is-contaminated' : '';
      const dupHint = partner.duplicateOf ? ` · ${partner.duplicateOf}와 중복` : '';
      const partialHint = partner.inconsistent ? ' · 메뉴 불일치' : '';
      return `<button type="button" class="promotion-tab${active}${contaminated}" data-baemin-partner="${id}" title="${label} (${id})${dupHint}${partialHint}">${label}${countLabel}</button>`;
    }).join('');

    bar.querySelectorAll('[data-baemin-partner]').forEach(btn => {
      btn.addEventListener('click', () => {
        switchBaeminPartner(btn.dataset.baeminPartner || '');
      });
    });
  }

  function clearViewTablesNotApplied() {
    const ui = tableUiConfig();
    const message = ui.emptyMessage;
    Object.entries(ui.rowsMap).forEach(([menu, rowsId]) => {
      const summaryId = ui.summaryMap[menu];
      const summaryEl = $(summaryId);
      const rowsEl = $(rowsId);
      const colspan = menu === 'daily_history' ? 11 : (menu === 'rider_history' ? 13 : 14);
      if (summaryEl) summaryEl.textContent = '적용된 데이터 없음';
      if (rowsEl) rowsEl.innerHTML = `<tr><td colspan="${colspan}" class="form-help">${message}</td></tr>`;
    });
  }

  async function loadPartnerTabs() {
    const ui = tableUiConfig();
    const captureDate = isViewSection()
      ? (state.appliedCollectDate || state.config?.applied?.collectDate || todayKstDate())
      : resolveBizCaptureDate();
    const partnersUrl = isViewSection()
      ? buildViewPartnersQuery(captureDate)
      : `/api/admin/baemin-delivery/partners?collectDate=${encodeURIComponent(captureDate)}${ui.appliedQuery}`;
    const result = await adminApi(partnersUrl);
    if (isViewSection() && result.notApplied && !isHistoryViewMenu()) {
      state.appliedCollectDate = '';
      state.activePartnerId = '';
      state.partners = [];
      renderPartnerTabs([]);
      renderViewAppliedBanner(null);
      clearViewTablesNotApplied();
      updatePanelVisibility();
      return;
    }
    state.appliedCollectDate = isViewSection() ? (result.collectDate || '') : captureDate;
    if (!isViewSection() && result.collectDate && result.collectDate !== captureDate) {
      setBizCaptureDate(result.collectDate);
    }
    const partners = result.ok ? (result.partners || []) : [];
    state.contamination = result.contamination || null;
    const nextCacheKey = buildCacheKey();
    if (state.dataCache.key && state.dataCache.key !== nextCacheKey) {
      invalidateDataCache();
    }
    renderPartnerTabs(partners);
    renderContaminationBanner(state.contamination);
    if (isViewSection()) {
      renderViewAppliedBanner(state.config?.applied || null);
      updateWeekPickerVisibility();
    }
    if (state.activePartnerId && !partners.some(partner => partner.partnerId === state.activePartnerId)) {
      state.activePartnerId = '';
    }
    if (!state.activePartnerId && partners.length) {
      switchBaeminPartner(partners[0].partnerId);
    } else if (!partners.length) {
      updatePanelVisibility();
    }
  }

  function updateMenuTabBar() {
    const ui = tableUiConfig();
    const menuBar = $(ui.menuBarId);
    if (!menuBar) return;
    if (isViewSection()) {
      menuBar.hidden = false;
    } else {
      menuBar.hidden = !(Boolean(state.activePartnerId) && state.partners.length > 0);
    }
    menuBar.querySelectorAll('[data-baemin-menu]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.baeminMenu === state.activeMenu);
    });
    updateWeekPickerVisibility();
  }

  function updatePanelVisibility() {
    const ui = tableUiConfig();
    const section = document.getElementById(ui.sectionRootId);
    if (!section) return;
    const hasPartner = Boolean(state.activePartnerId);
    section.querySelectorAll(`[${ui.panelAttr}]`).forEach(panel => {
      const menu = panel.getAttribute(ui.panelAttr);
      if (isViewSection()) {
        panel.hidden = state.activeMenu !== menu;
        return;
      }
      panel.hidden = hasPartner
        ? state.activeMenu !== menu
        : menu !== 'delivery_status';
    });
    const partnerBar = $(ui.partnerBarId);
    if (partnerBar) {
      partnerBar.hidden = isViewSection()
        ? !state.partners.length
        : !state.partners.length;
    }
    updateMenuTabBar();
  }

  function switchBaeminPartner(partnerId) {
    const ui = tableUiConfig();
    const id = String(partnerId || '').trim();
    if (!id) return;
    state.activePartnerId = id;
    if (!state.activeMenu) state.activeMenu = 'delivery_status';
    $(ui.partnerBarId)?.querySelectorAll('[data-baemin-partner]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.baeminPartner === id);
    });
    updatePanelVisibility();

    const cached = getCachedPartnerBundle(id);
    if (cached?.[state.activeMenu]) {
      renderSubtabRows(state.activeMenu, id, cached[state.activeMenu], cached.meta || {});
      return;
    }
    void loadPartnerBundle(id, state.activeMenu);
  }

  function switchBaeminMenu(menuId) {
    const menu = String(menuId || '').trim();
    if (!menu) return;

    if (isViewSection()) {
      const prevMenu = state.activeMenu;
      state.activeMenu = menu;
      updatePanelVisibility();
      if (menu !== prevMenu) {
        state.activePartnerId = '';
        invalidateDataCache();
        void loadPartnerTabs().then(() => {
          if (state.activePartnerId) {
            void loadPartnerBundle(state.activePartnerId, menu);
          } else {
            clearViewTablesForMenu(menu);
          }
        });
      } else if (state.activePartnerId) {
        const cached = getCachedPartnerBundle(state.activePartnerId);
        if (cached?.[menu]) {
          renderSubtabRows(menu, state.activePartnerId, cached[menu], cached.meta || {});
        } else {
          void loadPartnerBundle(state.activePartnerId, menu);
        }
      }
      return;
    }

    if (!state.activePartnerId) return;
    state.activeMenu = menu;
    updatePanelVisibility();

    const cached = getCachedPartnerBundle(state.activePartnerId);
    if (cached?.[menu]) {
      renderSubtabRows(menu, state.activePartnerId, cached[menu], cached.meta || {});
      return;
    }
    void loadPartnerBundle(state.activePartnerId, menu);
  }

  function clearViewTablesForMenu(menuId) {
    const ui = tableUiConfig();
    const menu = String(menuId || '').trim();
    const rowsId = ui.rowsMap[menu];
    const summaryId = ui.summaryMap[menu];
    const summaryEl = $(summaryId);
    const rowsEl = $(rowsId);
    const colspan = menu === 'daily_history' ? 10 : (menu === 'rider_history' ? 12 : 13);
    if (summaryEl) {
      summaryEl.textContent = isHistoryViewMenu(menu)
        ? `${formatViewWeekRangeLabel(ensureViewWeekStart())} · 데이터 없음`
        : '데이터 없음';
    }
    if (rowsEl) {
      rowsEl.innerHTML = `<tr><td colspan="${colspan}" class="form-help">${ui.emptyMessage}</td></tr>`;
    }
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  }

  function formatStatusLabel(status) {
    if (status === 'success') return '성공';
    if (status === 'failed') return '실패';
    return '-';
  }

  function setLoading(loading) {
    state.loading = loading;
    updateActionButtons();
  }

  function setCollecting(collecting) {
    state.collecting = collecting;
    updateActionButtons();
  }

  function updateActionButtons() {
    const fullBtn = $('baeminFullCollectBtn');
    const browserBtn = $('baeminBrowserOpenBtn');
    const shutdownBtn = $('baeminServerShutdownBtn');
    const jsonBtn = $('baeminDeliveryJsonPasteBtn');
    const sessionBtn = $('baeminDeliverySessionRefreshBtn');
    const localCollecting = Boolean(state.localAutoCollect?.collectRunning || state.collecting);

    if (fullBtn) {
      fullBtn.disabled = state.loading || localCollecting || !state.localServerRunning;
      fullBtn.textContent = localCollecting ? '이미 수집 중…' : '배민 전체 데이터 수집';
    }
    if (browserBtn) {
      browserBtn.disabled = state.loading || localCollecting || !state.localServerRunning;
    }
    if (shutdownBtn) {
      shutdownBtn.disabled = state.loading || localCollecting || !state.localServerRunning;
    }
    if (jsonBtn) jsonBtn.disabled = state.loading || localCollecting;
    if (sessionBtn) sessionBtn.disabled = state.loading || localCollecting;
  }

  function isSessionExpired(config) {
    if (state.localSession?.state === 'ok' && !state.localSession?.paused) return false;
    if (state.localBrowser?.browserOpen && state.localBrowser?.sessionLoggedIn) return false;
    return Boolean(config?.sessionLastError || config?.autoCollect?.sessionExpired || config?.autoCollect?.sessionPaused);
  }

  function renderSessionStatus(config) {
    const el = $('baeminDeliverySessionStatus');
    if (!el) return;

    if (isSessionExpired(config)) {
      el.className = 'baemin-session-status baemin-session-status--error';
      const message = config?.sessionLastError || config?.autoCollect?.lastError || '배민 로그인 만료';
      el.innerHTML = `<strong>세션 만료 — 배민 세션 갱신 필요</strong> — ${message} · <button type="button" class="link-btn" id="baeminSessionRefreshInlineBtn">세션 갱신</button>`;
      $('baeminSessionRefreshInlineBtn')?.addEventListener('click', () => void startSessionRefresh());
      return;
    }

    if (config?.sessionConfigured) {
      el.className = 'baemin-session-status baemin-session-status--ok';
      el.innerHTML = `
        <strong>배민 세션 연결됨</strong>
        · 갱신: ${formatDateTime(config.sessionUpdatedAt)}
        · 확인: ${formatDateTime(config.sessionLastValidatedAt)}
      `;
      return;
    }

    el.className = 'baemin-session-status baemin-session-status--warn';
    el.innerHTML = '<strong>배민 세션 없음</strong> — [배민 세션 갱신]으로 로그인하세요.';
  }

  function renderAutoCollectStatus(config) {
    const el = $('baeminDeliveryAutoCollectStatus');
    if (!el) return;

    const auto = config?.autoCollect || {};
    const local = state.localAutoCollect || {};
    const browser = state.localBrowser || {};
    const session = state.localSession || {};
    const localRunning = state.localServerRunning || auto.localServerRecentlyActive;
    const sessionExpired = isSessionExpired(config)
      || session.state === 'expired'
      || Boolean(local.sessionPaused);
    const localCollecting = Boolean(local.collectRunning || state.collecting);
    const scheduleText = (auto.schedule || local.schedule || ['10:00', '14:00', '17:00', '20:00', '23:30']).join(', ');
    const lastCollect = local.lastCollectResult || {};

    el.className = sessionExpired
      ? 'baemin-auto-collect-panel baemin-auto-collect-panel--paused'
      : 'baemin-auto-collect-panel';

    const lastRunAt = local.lastRunAt || auto.lastRunAt;
    const lastStatus = local.lastStatus || auto.lastStatus;
    const lastError = local.lastError || auto.lastError;

    const lastRunSummary = lastStatus === 'success'
      ? `${formatStatusLabel(lastStatus)} · ${formatNumber(local.lastSavedCount || auto.lastSavedCount || lastCollect.savedTotal || 0)}건`
      : (lastStatus === 'failed'
        ? `${formatStatusLabel(lastStatus)}${lastError ? ` — ${lastError}` : ''}`
        : (lastCollect.message || '-'));

    const sessionStateLabel = sessionExpired
      ? '만료 — 갱신 필요'
      : (session.state === 'ok' || config?.sessionConfigured ? '정상' : '없음');

    el.innerHTML = `
      <strong>로컬 자동수집 서버</strong>
      <dl class="baemin-auto-collect-grid">
        <div>
          <dt>로컬 서버</dt>
          <dd>${localRunning ? '실행 중' : '중지됨'}</dd>
        </div>
        <div>
          <dt>Playwright 브라우저</dt>
          <dd>${browser.browserOpen ? '유지 중' : '닫힘/미실행'}</dd>
        </div>
        <div>
          <dt>세션 상태</dt>
          <dd>${sessionStateLabel}</dd>
        </div>
        <div>
          <dt>현재 수집 중</dt>
          <dd>${localCollecting ? '예 — 이미 수집 중입니다' : '아니오'}</dd>
        </div>
        <div>
          <dt>마지막 수집</dt>
          <dd>${formatDateTime(lastRunAt || lastCollect.at)}</dd>
        </div>
        <div>
          <dt>마지막 결과</dt>
          <dd>${lastRunSummary}</dd>
        </div>
        <div>
          <dt>다음 자동 수집</dt>
          <dd>${localRunning && !sessionExpired ? formatDateTime(local.nextScheduledAt || auto.nextScheduledAt) : '-'}</dd>
        </div>
        <div>
          <dt>브라우저 URL</dt>
          <dd style="word-break:break-all;font-size:0.82rem">${browser.currentUrl || '-'}</dd>
        </div>
      </dl>
      <p class="baemin-auto-collect-schedule">스케줄(KST): ${scheduleText} · PC에서 <code>npm run baemin:session-server</code> 실행 · 수집 후에도 브라우저 유지</p>
    `;

    updateActionButtons();
  }

  function formatRiderFaultCell(parsed) {
    const p = parsed || {};
    return formatNumber(Number(p.riderFault ?? p.totalRiderFault ?? 0));
  }

  function renderMenuDatePlan(menuDatePlan) {
    if (!menuDatePlan) return '';
    const rows = [
      ['배달현황', menuDatePlan.delivery_status?.label || '오늘 기준'],
      ['일별 배달내역', menuDatePlan.daily_history?.label || '-'],
      ['라이더별 배달내역', menuDatePlan.rider_history?.label || '-']
    ];
    return `
      <ul class="baemin-collect-stats baemin-collect-date-plan">
        ${rows.map(([label, range]) => `<li>${label}: <strong>${range}</strong></li>`).join('')}
      </ul>
    `;
  }

  function renderMenuCollectStatus(config) {
    const el = $('baeminDeliveryMenuCollectStatus');
    if (!el) return;

    const menus = config?.menuStatus || config?.autoCollect?.menuStatus || [];
    const menuDatePlan = config?.autoCollect?.menuDatePlan || config?.menuDatePlan || null;
    if (!menus.length) {
      el.innerHTML = `<strong>메뉴별 수집</strong>${renderMenuDatePlan(menuDatePlan)}<p class="form-help">아직 수집 기록이 없습니다.</p>`;
      return;
    }

    const rows = menus.map(menu => {
      const statusClass = menu.lastStatus === 'success'
        ? 'baemin-menu-collect-status--success'
        : (menu.lastStatus === 'failed' ? 'baemin-menu-collect-status--failed' : 'baemin-menu-collect-status--idle');
      const statusLabel = menu.lastStatus === 'success'
        ? '성공'
        : (menu.lastStatus === 'failed' ? '실패' : '-');
      const errorText = menu.lastStatus === 'failed' && menu.lastError
        ? `<br><span style="font-size:0.8rem">${menu.lastError}</span>`
        : '';
      return `
        <tr>
          <td>${menu.label || menu.id}</td>
          <td>${menu.dateRangeLabel || '-'}</td>
          <td>${formatDateTime(menu.lastCollectedAt)}</td>
          <td class="${statusClass}">${statusLabel}${errorText}</td>
          <td>${formatNumber(menu.rowCount || 0)}</td>
        </tr>
      `;
    }).join('');

    el.innerHTML = `
      <strong>메뉴별 수집 상태</strong>
      ${renderMenuDatePlan(menuDatePlan)}
      <p class="form-help">배달현황=오늘 기준 · 일별/라이더=정산주 수요일~어제 (오늘 데이터 미제공)</p>
      <table class="baemin-menu-collect-table">
        <thead>
          <tr>
            <th>수집 대상</th>
            <th>수집 기간</th>
            <th>마지막 수집</th>
            <th>결과</th>
            <th>저장 건수</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderAppliedStatus(config) {
    const el = $('baeminDeliveryAppliedStatus');
    const applyBtn = $('baeminDeliveryApplyBtn');
    if (!el) return;

    const applied = config?.applied;
    if (!applied?.collectDate) {
      el.className = 'baemin-applied-status baemin-applied-status--warn';
      el.innerHTML = '<strong>아직 적용된 데이터 없음</strong> — 수집 미리보기 확인 후 [적용하기]를 누르면 Supabase에 저장되고 배민현황에 반영됩니다.';
      if (applyBtn) applyBtn.disabled = state.loading || state.applying;
      return;
    }

    el.className = 'baemin-applied-status baemin-applied-status--ok';
    el.innerHTML = `
      <strong>배민현황 적용됨 (Supabase 저장)</strong>
      · 기준일 ${applied.collectDate}
      · ${formatNumber(applied.savedCount || applied.itemCount || 0)}건
      · 적용 ${formatDateTime(applied.appliedAt)}
    `;
    if (applyBtn) applyBtn.disabled = state.loading || state.applying;
  }

  function renderDeliveryStatusMeta(applied) {
    const meta = $('baeminStatusDeliveryMeta');
    if (!meta || !isViewSection()) return;

    const data = applied || state.config?.applied;
    if (!data?.collectDate) {
      meta.hidden = true;
      meta.innerHTML = '';
      return;
    }

    const partnerNames = state.partners.map(partner => partner.partnerName || partner.partnerId).filter(Boolean);
    const activePartner = state.partners.find(partner => partner.partnerId === state.activePartnerId);
    const partnerLabel = activePartner
      ? `${activePartner.partnerName || activePartner.partnerId}`
      : (partnerNames.length ? partnerNames.join(', ') : '-');

    meta.hidden = false;
    meta.innerHTML = `
      <div><strong>적용일시</strong> ${formatDateTime(data.appliedAt)}</div>
      <div><strong>수집일시</strong> ${formatDateTime(data.collectedAt)}</div>
      <div><strong>협력사</strong> ${partnerLabel}</div>
    `;
  }

  function renderViewAppliedBanner(applied) {
    const banner = $('baeminStatusAppliedBanner');
    if (!banner) return;

    const data = applied || state.config?.applied;
    if (!data?.collectDate) {
      banner.hidden = false;
      banner.className = 'baemin-applied-banner baemin-applied-banner--warn';
      banner.innerHTML = '<strong>표시할 데이터가 없습니다.</strong> 「배민 BIZ 현황」에서 수집 후 [적용하기]를 눌러 주세요.';
      renderDeliveryStatusMeta(null);
      return;
    }

    banner.hidden = false;
    banner.className = 'baemin-applied-banner baemin-applied-banner--ok';
    banner.innerHTML = '<strong>배민현황</strong> · Supabase 저장 데이터 조회 전용 (배민 Biz 실시간 호출 없음)';
    renderDeliveryStatusMeta(data);
  }

  function renderConfig(config) {
    state.config = config;
    const hint = $('baeminDeliveryConfigHint');
    if (hint) {
      renderSessionStatus(config);
      renderAutoCollectStatus(config);
      renderMenuCollectStatus(config);

      const missingLegacy = !config?.tableExists;
      const missingBiz = config?.bizCollectTableExists === false;

      if (missingLegacy || missingBiz) {
        hint.textContent = 'Supabase 테이블이 없습니다. supabase/baemin_all_migrations.sql 내용 전체를 SQL Editor에 붙여넣고 Run 하세요.';
        hint.className = 'form-help form-help--warn';
      } else {
        hint.textContent = '자동 수집은 PC 로컬 세션 서버가 켜져 있을 때만 동작합니다. 세션은 Supabase settings에 저장됩니다.';
        hint.className = 'form-help';
      }
    }

    renderAppliedStatus(config);
    if (isViewSection()) {
      renderViewAppliedBanner(config?.applied);
    }
  }

  function todayKstDate() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  }

  function renderSummary(result, errorMessage) {
    const box = $('baeminDeliveryCollectResult');
    if (!box) return;

    if (errorMessage) {
      box.hidden = false;
      box.className = 'baemin-collect-result baemin-collect-result--error';
      box.innerHTML = `<strong>수집 실패</strong><p>${errorMessage}</p>`;
      return;
    }

    if (!result) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }

    const savedCount = Number(result.savedCount || 0);
    if (savedCount <= 0) {
      box.hidden = false;
      box.className = 'baemin-collect-result baemin-collect-result--error';
      box.innerHTML = `
        <strong>저장된 데이터 없음</strong>
        <p>수집 API는 호출됐지만 Supabase에 저장된 건수가 0입니다.</p>
        <ul class="baemin-collect-stats">
          <li>1) Supabase SQL Editor에서 <code>baemin_all_migrations.sql</code> 실행</li>
          <li>2) [배민 세션 갱신] 후 세션 연결됨 확인</li>
          <li>3) 수집 날짜를 <strong>오늘(KST)</strong>로 맞추기</li>
        </ul>
        ${renderMenuResultsList(result.menuResults || result.results)}
      `;
      return;
    }

    box.hidden = false;
    box.className = 'baemin-collect-result baemin-collect-result--success';
    const totals = result.summaryTotals || {};
    box.innerHTML = `
      <strong>수집 완료</strong>
      ${renderMenuDatePlan(result.menuDateRanges || result.menuDatePlan)}
      <ul class="baemin-collect-stats">
        <li>수집 기준일: <strong>${result.captureDate || '-'}</strong></li>
        <li>수집일수(일별/라이더): <strong>${formatNumber(totals.dayCount || result.dateRange?.dayCount || 0)}</strong></li>
        <li>라이더수: <strong>${formatNumber(totals.riderCount || 0)}</strong></li>
        <li>총 저장 건수: <strong>${formatNumber(result.savedCount)}</strong></li>
        <li>완료합계: <strong>${formatNumber(totals.completeTotal || result.totalCompleteSum || 0)}</strong></li>
        <li>거절합계: <strong>${formatNumber(totals.rejectTotal || 0)}</strong></li>
        <li>배차취소합계: <strong>${formatNumber(totals.cancelTotal || 0)}</strong></li>
      </ul>
      ${renderMenuResultsList(result.menuResults)}
    `;
  }

  function renderMenuResultsList(menuResults) {
    if (!menuResults || typeof menuResults !== 'object') return '';
    const items = Object.entries(menuResults).map(([id, row]) => {
      const label = row.label || id;
      const range = row.dateRangeLabel ? ` · ${row.dateRangeLabel}` : '';
      const status = row.ok ? '성공' : '실패';
      const detail = row.ok
        ? `${formatNumber(row.savedCount || 0)}건`
        : (row.message || row.error || '실패');
      return `<li>${label}${range}: <strong>${status}</strong> (${detail})</li>`;
    });
    if (!items.length) return '';
    return `<ul class="baemin-collect-stats">${items.join('')}</ul>`;
  }

  function stopSetupPoll() {
    if (state.setupPollTimer) {
      clearInterval(state.setupPollTimer);
      state.setupPollTimer = null;
    }
  }

  function stopStatusPoll() {
    if (state.statusPollTimer) {
      clearInterval(state.statusPollTimer);
      state.statusPollTimer = null;
    }
  }

  function renderSetupDialog(contentHtml) {
    const dialog = $('baeminDeliverySessionDialog');
    const body = $('baeminDeliverySessionDialogBody');
    if (body) body.innerHTML = contentHtml;
    if (dialog?.showModal) dialog.showModal();
  }

  function closeSetupDialog() {
    stopSetupPoll();
    const dialog = $('baeminDeliverySessionDialog');
    if (dialog?.close) dialog.close();
  }

  function collectLocalHealthUrls(config, setup) {
    const urls = [];
    const push = value => {
      const text = String(value || '').trim();
      if (text && !urls.includes(text)) urls.push(text);
    };

    (setup?.localHealthUrls || []).forEach(push);
    push(setup?.localHealthUrl);
    (config?.localHealthUrls || []).forEach(push);
    push(config?.localHealthUrl);
    (state.localSessionConfig?.localHealthUrls || []).forEach(push);

    const port = setup?.localSessionPort
      || config?.localSessionPort
      || state.localSessionConfig?.port
      || 3939;
    push(`http://127.0.0.1:${port}/health`);
    push(`http://localhost:${port}/health`);

    return urls;
  }

  async function loadPublicLocalSessionConfig() {
    try {
      const response = await fetch('/api/public-config', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json().catch(() => ({}));
      if (payload?.baeminSessionLocal) {
        state.localSessionConfig = {
          ...state.localSessionConfig,
          ...payload.baeminSessionLocal
        };
      }
    } catch {
      // ignore — defaults remain
    }
  }

  async function fetchLocalHealth(config, setup) {
    const healthUrls = collectLocalHealthUrls(config, setup);
    for (const healthUrl of healthUrls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const response = await fetch(healthUrl, {
          signal: controller.signal,
          cache: 'no-store',
          mode: 'cors'
        });
        clearTimeout(timer);
        if (!response.ok) continue;
        const payload = await response.json().catch(() => ({}));
        if (payload?.port) {
          state.localSessionConfig = {
            ...state.localSessionConfig,
            port: payload.port
          };
        }
        return {
          running: true,
          autoCollect: payload.autoCollect || null,
          browser: payload.browser || null,
          session: payload.session || null,
          version: payload.version || '',
          healthUrl
        };
      } catch {
        // try next host/port candidate
      }
    }
    return { running: false, autoCollect: null, healthUrl: healthUrls[0] || '' };
  }

  async function refreshLocalServerStatus() {
    const local = await fetchLocalHealth(state.config, null);
    state.localServerRunning = local.running;
    state.localAutoCollect = local.autoCollect;
    state.localBrowser = local.browser;
    state.localSession = local.session;
    if (state.config) renderAutoCollectStatus(state.config);
    updateActionButtons();
  }

  function getLocalServerBaseUrl() {
    const port = state.localSessionConfig?.port || 3939;
    return `http://127.0.0.1:${port}`;
  }

  async function callLocalServer(path, options = {}) {
    const base = getLocalServerBaseUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 120000);
    try {
      const response = await fetch(`${base}${path}`, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        body: options.body != null ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
        cache: 'no-store',
        mode: 'cors'
      });
      clearTimeout(timer);
      const payload = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, ...payload };
    } catch (error) {
      clearTimeout(timer);
      return { ok: false, message: error.message || '로컬 서버 연결 실패' };
    }
  }

  async function openLocalBrowser() {
    if (state.loading || state.collecting) return;

    const local = await fetchLocalHealth(state.config, null);
    state.localServerRunning = local.running;
    if (!local.running) {
      showToast('로컬 세션 서버가 실행 중이 아닙니다. npm run baemin:session-server 를 실행하세요.');
      return;
    }

    setLoading(true);
    const result = await callLocalServer('/browser/open', { method: 'POST', timeoutMs: 60000 });
    setLoading(false);
    await refreshLocalServerStatus();

    if (!result.ok) {
      showToast(result.message || '브라우저 열기에 실패했습니다.');
      return;
    }
    showToast(result.message || 'Playwright 브라우저를 열었습니다.');
  }

  async function runFullCollect() {
    if (state.loading || state.collecting) return;

    const local = await fetchLocalHealth(state.config, null);
    state.localServerRunning = local.running;
    if (!local.running) {
      showToast('로컬 세션 서버가 실행 중이 아닙니다. npm run baemin:session-server 를 실행하세요.');
      return;
    }

    if (local.autoCollect?.collectRunning) {
      showToast('이미 수집 중입니다.');
      return;
    }

    setCollecting(true);
    renderSummary(null);

    const captureDate = resolveBizCaptureDate();
    const result = await callLocalServer('/collect/full', {
      method: 'POST',
      body: { collectDate: captureDate },
      timeoutMs: 300000
    });

    await refreshLocalServerStatus();
    setCollecting(false);

    if (result.status === 409 && result.message?.includes('이미 수집')) {
      showToast('이미 수집 중입니다.');
      return;
    }

    if (!result.ok) {
      renderSummary(null, result.message || '배민 전체 데이터 수집에 실패했습니다.');
      await loadConfig();
      return;
    }

    const savedCount = Number(result.savedCount || 0);
    const menuResults = result.results
      ? Object.fromEntries(Object.entries(result.results).map(([id, row]) => [id, {
        label: row.label || id,
        ok: row.ok,
        savedCount: row.savedCount,
        message: row.message,
        dateRangeLabel: row.dateRangeLabel
      }]))
      : null;

    if (savedCount <= 0) {
      renderSummary({
        captureDate: result.collectDate || captureDate,
        savedCount,
        totalCompleteSum: result.totalCompleteSum,
        menuDateRanges: result.menuDateRanges,
        menuResults
      }, result.message || '저장된 데이터가 0건입니다.');
      await loadConfig();
      return;
    }

    renderSummary({
      captureDate: result.collectDate || captureDate,
      savedCount,
      totalCompleteSum: result.summaryTotals?.completeTotal || result.totalCompleteSum,
      summaryTotals: result.summaryTotals,
      dateRange: result.dateRange,
      menuDateRanges: result.menuDateRanges,
      menuResults
    });
    setBizCaptureDate(result.collectDate || captureDate);
    showToast(`배민 전체 데이터 수집 완료 — ${formatNumber(savedCount)}건 저장${result.partnerCount > 1 ? ` (협력사 ${result.partnerCount}곳)` : ''}${result.scrubResult?.deletedCount ? ` · 중복 정리 ${formatNumber(result.scrubResult.deletedCount)}건` : ''} · 아래 미리보기 확인 후 [적용하기]`);
    invalidateDataCache();
    await loadConfig();
    if (!isViewSection()) {
      state.activePartnerId = '';
      await loadAllSubtabData();
    }
  }

  async function shutdownLocalServer() {
    if (state.loading || state.collecting) return;

    const local = await fetchLocalHealth(state.config, null);
    if (!local.running) {
      showToast('로컬 세션 서버가 이미 중지되어 있습니다.');
      return;
    }

    if (!window.confirm('자동수집 서버를 종료합니다. Playwright 브라우저도 함께 닫힙니다. 계속할까요?')) {
      return;
    }

    setLoading(true);
    const result = await callLocalServer('/shutdown', { method: 'POST', timeoutMs: 10000 });
    setLoading(false);

    state.localServerRunning = false;
    state.localBrowser = null;
    state.localAutoCollect = null;
    if (state.config) renderAutoCollectStatus(state.config);

    showToast(result.message || '자동수집 서버 종료를 요청했습니다.');
  }

  function pollSessionSetup(setupId) {
    stopSetupPoll();
    state.setupPollTimer = setInterval(async () => {
      const status = await adminApi(`/api/admin/baemin-delivery/session/setup?setupId=${encodeURIComponent(setupId)}`);
      if (!status.ok) return;

      if (status.status === 'completed') {
        stopSetupPoll();
        renderSetupDialog('<p><strong>세션 저장 완료!</strong> 창을 닫으면 자동 수집이 재개됩니다.</p>');
        await loadConfig();
        showToast('배민Biz 세션이 저장되었습니다.');
        return;
      }

      if (status.status === 'failed' || status.status === 'expired') {
        stopSetupPoll();
        renderSetupDialog(`<p class="form-help form-help--warn">${status.message || '세션 갱신에 실패했습니다.'}</p>`);
      }
    }, 2000);
  }

  async function startSessionRefresh() {
    if (state.loading) return;
    setLoading(true);

    const setup = await adminApi('/api/admin/baemin-delivery/session/setup', { method: 'POST', body: '{}' });
    setLoading(false);

    if (!setup.ok) {
      showToast(setup.message || '세션 갱신 준비에 실패했습니다.');
      return;
    }

    const localRunning = await fetchLocalHealth(state.config, setup);
    state.localServerRunning = localRunning.running;
    const portLabel = setup.localSessionPort || state.localSessionConfig?.port || 3939;
    const instructions = localRunning.running
      ? `<p>로컬 세션 서버가 실행 중입니다. (포트 ${portLabel})</p><p>브라우저 창에서 배민Biz 로그인·휴대폰 인증을 완료하세요.</p>`
      : `<p><strong>로컬 세션 서버에 연결하지 못했습니다.</strong></p>
         <p>PC 터미널에서 프로젝트 폴더로 이동 후 아래 명령을 실행하세요:</p>
         <pre class="baemin-cli-block">npm run baemin:session-server</pre>
         <p>기본 포트: <strong>${portLabel}</strong> · 확인 URL: <code>${localRunning.healthUrl || setup.localHealthUrl || `http://127.0.0.1:${portLabel}/health`}</code></p>
         <p>서버 실행 후 ERP에서 [배민 세션 갱신]을 다시 누르거나 아래 URL을 브라우저에서 엽니다:</p>
         <pre class="baemin-cli-block">${setup.startUrl}</pre>`;

    renderSetupDialog(`${instructions}<p class="hint">완료되면 이 창이 자동으로 갱신됩니다.</p>`);

    if (setup.startUrl) {
      window.open(setup.startUrl, '_blank', 'noopener,noreferrer,width=520,height=720');
    }

    pollSessionSetup(setup.setupId);
  }

  async function saveManualCookie() {
    const cookie = String($('baeminDeliverySessionCookie')?.value || '').trim();
    if (!cookie) {
      showToast('쿠키를 입력하세요.');
      return;
    }
    const result = await adminApi('/api/admin/baemin-delivery/session', {
      method: 'POST',
      body: JSON.stringify({ cookie })
    });
    if (!result.ok) {
      showToast(result.message || '쿠키 저장에 실패했습니다.');
      return;
    }
    showToast('비상용 쿠키가 저장되었습니다.');
    await loadConfig();
  }

  async function loadViewConfig() {
    const result = await adminApi('/api/admin/baemin-delivery/config?viewOnly=1');
    if (!result.ok) {
      if (result.message) showToast(result.message);
      return;
    }
    state.config = {
      ...(state.config || {}),
      tableExists: result.tableExists,
      bizCollectTableExists: result.bizCollectTableExists,
      applied: result.applied || null
    };
    renderViewAppliedBanner(result.applied || null);
  }

  async function loadConfig() {
    if (isViewSection()) {
      await loadViewConfig();
      return;
    }
    const result = await adminApi('/api/admin/baemin-delivery/config');
    if (result.ok) {
      renderConfig(result);
      await refreshLocalServerStatus();
      return;
    }
    renderConfig({ tableExists: false });
    if (result.message) showToast(result.message);
  }

  async function loadLatestSummary() {
    const captureDate = resolveBizCaptureDate();
    const result = await adminApi(`/api/admin/baemin-delivery/latest?captureDate=${encodeURIComponent(captureDate)}`);
    if (result.ok && result.savedCount > 0) {
      if (result.captureDate) setBizCaptureDate(result.captureDate);
      renderSummary({
        captureDate: result.captureDate,
        savedCount: result.savedCount,
        totalCompleteSum: result.totalCompleteSum,
        menuResults: result.byMenu
          ? Object.fromEntries(Object.entries(result.byMenu).map(([id, count]) => [id, {
            label: id,
            ok: true,
            savedCount: count
          }]))
          : null
      });
    }
  }

  async function loadPartnerBundle(partnerId, focusMenu = state.activeMenu) {
    const id = String(partnerId || '').trim();
    if (!id) return null;

    const cached = getCachedPartnerBundle(id);
    if (cached && MENU_IDS.every(menu => Array.isArray(cached[menu]))) {
      if (focusMenu && cached[focusMenu]) {
        renderSubtabRows(focusMenu, id, cached[focusMenu], cached.meta || {});
      }
      return cached;
    }

    if (state.dataCache.loadingPartner === id) return null;
    state.dataCache.loadingPartner = id;

    const ui = tableUiConfig();
    const captureDate = isViewSection()
      ? (state.appliedCollectDate || state.config?.applied?.collectDate || todayKstDate())
      : resolveBizCaptureDate();
    const partnerQuery = `&partnerId=${encodeURIComponent(id)}`;
    const menusToLoad = isViewSection()
      ? [String(focusMenu || state.activeMenu || 'delivery_status').trim()]
      : MENU_IDS;

    const results = await Promise.all(menusToLoad.map(async sourceMenu => {
      const itemsUrl = isViewSection()
        ? buildViewItemsQuery(captureDate, sourceMenu, id)
        : `/api/admin/baemin-delivery/items?collectDate=${encodeURIComponent(captureDate)}&sourceMenu=${encodeURIComponent(sourceMenu)}${partnerQuery}${ui.appliedQuery}`;
      const result = await adminApi(itemsUrl);
      return { sourceMenu, result };
    }));

    state.dataCache.loadingPartner = '';
    const bundle = getCachedPartnerBundle(id) || { meta: { captureDate, notApplied: false } };
    bundle.meta = { captureDate, notApplied: false };
    results.forEach(({ sourceMenu, result }) => {
      if (isViewSection() && result.notApplied && sourceMenu === 'delivery_status') {
        bundle.meta.notApplied = true;
      }
      bundle[sourceMenu] = result.ok ? (result.items || []) : [];
      if (isViewSection() && result.weekStart) {
        bundle.meta.weekStart = result.weekStart;
        bundle.meta.weekEnd = result.weekEnd;
      }
    });
    setCachedPartnerBundle(id, bundle);

    if (focusMenu) {
      renderSubtabRows(focusMenu, id, bundle[focusMenu] || [], bundle.meta);
    }
    return bundle;
  }

  function renderSubtabRows(sourceMenu, partnerId, items, meta = {}) {
    const ui = tableUiConfig();
    const captureDate = meta.captureDate
      || (isViewSection()
        ? (state.appliedCollectDate || state.config?.applied?.collectDate || todayKstDate())
        : resolveBizCaptureDate());

    const summaryEl = $(ui.summaryMap[sourceMenu]);
    const rowsEl = $(ui.rowsMap[sourceMenu]);
    if (!rowsEl) return;

    if (isViewSection() && meta.notApplied && sourceMenu === 'delivery_status') {
      if (summaryEl) summaryEl.textContent = '적용된 데이터가 없습니다.';
      rowsEl.innerHTML = `<tr><td colspan="13" class="form-help">${ui.emptyMessage}</td></tr>`;
      renderViewAppliedBanner(null);
      return;
    }

    const menuDatePlan = state.config?.autoCollect?.menuDatePlan || state.config?.menuDatePlan || null;
    const rangeLabel = meta.weekStart && meta.weekEnd
      ? `${meta.weekStart} ~ ${meta.weekEnd}`
      : menuDatePlan?.[sourceMenu]?.label;
    const partnerLabel = state.partners.find(partner => partner.partnerId === partnerId)?.partnerName || partnerId;
    if (summaryEl) {
      if (sourceMenu === 'delivery_status') {
        summaryEl.textContent = isViewSection()
          ? `${partnerLabel} · 최신 적용 스냅샷 · ${formatNumber(items.length)}건`
          : `${partnerLabel} · 적용 기준 (${captureDate}) · ${formatNumber(items.length)}건`;
      } else if (rangeLabel) {
        const periodHint = sourceMenu === 'rider_history' ? ' · 완료=기간 합계' : '';
        summaryEl.textContent = `${partnerLabel} · ${rangeLabel} · ${formatNumber(items.length)}건${periodHint}`;
      } else {
        summaryEl.textContent = `${partnerLabel} · ${captureDate} · ${formatNumber(items.length)}건`;
      }
    }

    if (isViewSection()) {
      renderViewAppliedBanner(state.config?.applied || null);
    }

    const showPartnerColumn = false;
    syncPartnerColumnVisibility(showPartnerColumn);
    const partnerCell = showPartnerColumn
      ? (p) => `<td data-partner-col>${formatPartnerCell(p)}</td>`
      : () => '';

    if (!items.length) {
      const emptyColspan = sourceMenu === 'daily_history'
        ? (showPartnerColumn ? 11 : 10)
        : (sourceMenu === 'rider_history'
          ? (showPartnerColumn ? 13 : 12)
          : (showPartnerColumn ? 14 : 13));
      rowsEl.innerHTML = `<tr><td colspan="${emptyColspan}" class="form-help">${ui.emptyMessage}</td></tr>`;
      return;
    }

    if (sourceMenu === 'delivery_status') {
      rowsEl.innerHTML = items.map(row => {
        const p = row.parsed_json || {};
        const collectedCell = isViewSection()
          ? ''
          : `<td>${formatDateTime(row.collected_at)}</td>`;
        return `<tr>
          ${partnerCell(p)}
          <td>${row.rider_name || '-'}</td>
          <td>${p.statusDesc || '-'}</td>
          <td>${row.rider_user_id || '-'}</td>
          <td>${row.phone_number || '-'}</td>
          <td>${formatNumber(p.totalComplete || 0)}</td>
          <td>${formatNumber(p.totalReject || p.foodReject || 0)}</td>
          <td>${formatNumber(p.cancelCount || 0)}</td>
          <td>${formatRiderFaultCell(p)}</td>
          <td>${formatNumber(p.morningCount || 0)}</td>
          <td>${formatNumber(p.afternoonCount || 0)}</td>
          <td>${formatNumber(p.eveningCount || 0)}</td>
          <td>${formatNumber(p.midnightCount || 0)}</td>
          ${collectedCell}
        </tr>`;
      }).join('');
      return;
    }

    if (sourceMenu === 'daily_history') {
      rowsEl.innerHTML = items.map(row => {
        const p = row.parsed_json || {};
        const collectedCell = isViewSection()
          ? ''
          : `<td>${formatDateTime(row.collected_at)}</td>`;
        return `<tr>
          ${partnerCell(p)}
          <td>${p.deliveryDate || row.collect_date || '-'}</td>
          <td>${formatNumber(p.totalComplete || 0)}</td>
          <td>${formatNumber(p.totalReject ?? p.foodReject ?? 0)}</td>
          <td>${formatNumber(p.cancelCount || 0)}</td>
          <td>${formatRiderFaultCell(p)}</td>
          <td>${formatNumber(p.morningCount || 0)}</td>
          <td>${formatNumber(p.afternoonCount || 0)}</td>
          <td>${formatNumber(p.eveningCount || 0)}</td>
          <td>${formatNumber(p.midnightCount || 0)}</td>
          ${collectedCell}
        </tr>`;
      }).join('');
      return;
    }

    rowsEl.innerHTML = items.map(row => {
      const p = row.parsed_json || {};
      const deliveryCount = Number(row.raw_json?.deliveryCount || p.totalComplete || 0);
      const collectedCell = isViewSection()
        ? ''
        : `<td>${formatDateTime(row.collected_at)}</td>`;
      return `<tr>
        ${partnerCell(p)}
        <td>${row.rider_name || '-'}</td>
        <td>${row.rider_user_id || '-'}</td>
        <td>${row.phone_number || '-'}</td>
        <td>${formatNumber(p.totalComplete || deliveryCount || 0)}</td>
        <td>${formatNumber(p.totalReject ?? p.foodReject ?? 0)}</td>
        <td>${formatNumber(p.cancelCount || 0)}</td>
        <td>${formatRiderFaultCell(p)}</td>
        <td>${formatNumber(p.morningCount || 0)}</td>
        <td>${formatNumber(p.afternoonCount || 0)}</td>
        <td>${formatNumber(p.eveningCount || 0)}</td>
        <td>${formatNumber(p.midnightCount || 0)}</td>
        ${collectedCell}
      </tr>`;
    }).join('');
  }

  async function loadSubtabData(sourceMenu, partnerIdOverride = '') {
    const partnerId = String(partnerIdOverride || selectedPartnerId() || '').trim();
    if (!partnerId) return;
    await loadPartnerBundle(partnerId, sourceMenu);
  }

  async function scrubDuplicatePartners() {
    if (state.loading || state.collecting) return;
    const captureDate = resolveBizCaptureDate();
    if (!window.confirm(`${captureDate} 수집 데이터에서 협력사 간 동일 라이더 중복을 정리합니다.\n가장 먼저 수집된 협력사만 남기고 나머지 중복 협력사 데이터를 삭제합니다.\n계속할까요?`)) {
      return;
    }

    setLoading(true);
    const result = await adminApi('/api/admin/baemin-delivery/scrub-duplicates', {
      method: 'POST',
      body: JSON.stringify({ collectDate: captureDate })
    });
    setLoading(false);

    if (!result.ok) {
      showToast(result.message || result.error || '중복 정리에 실패했습니다.');
      return;
    }

    showToast(result.message || `중복 정리 완료 — ${formatNumber(result.deletedCount || 0)}건 삭제`);
    invalidateDataCache();
    state.activePartnerId = '';
    await loadAllSubtabData();
  }

  async function purgeCollectDateData() {
    if (state.loading || state.collecting) return;
    const captureDate = resolveBizCaptureDate();
    if (!window.confirm(`${captureDate} 수집 데이터를 전부 삭제합니다.\n삭제 후 [배민 전체 데이터 수집]으로 다시 받아야 합니다.\n계속할까요?`)) {
      return;
    }

    setLoading(true);
    const result = await adminApi('/api/admin/baemin-delivery/purge-collect', {
      method: 'POST',
      body: JSON.stringify({ collectDate: captureDate })
    });
    setLoading(false);

    if (!result.ok) {
      showToast(result.message || result.error || '삭제에 실패했습니다.');
      return;
    }

    showToast(result.message || `수집 데이터 ${formatNumber(result.deletedCount || 0)}건 삭제`);
    invalidateDataCache();
    state.activePartnerId = '';
    await loadAllSubtabData();
  }

  async function applyToErp() {
    if (state.applying || state.loading) return;
    const captureDate = resolveBizCaptureDate();
    state.applying = true;
    renderAppliedStatus(state.config);
    const result = await adminApi('/api/admin/baemin-delivery/apply', {
      method: 'POST',
      body: JSON.stringify({ collectDate: captureDate })
    });
    state.applying = false;
    if (!result.ok) {
      showToast(result.message || '적용에 실패했습니다.');
      renderAppliedStatus(state.config);
      return;
    }
    showToast(`배민현황에 ${result.collectDate} 데이터 ${formatNumber(result.itemCount || result.savedCount || 0)}건이 저장·적용되었습니다.`);
    invalidateDataCache();
    await loadConfig();
    if (!isViewSection()) {
      state.activePartnerId = '';
      await loadAllSubtabData();
    }
  }

  async function loadAllSubtabData() {
    await loadPartnerTabs();
    if (state.activePartnerId && state.activeMenu) {
      await loadSubtabData(state.activeMenu, state.activePartnerId);
    }
  }

  async function runAutoCollect() {
    return runFullCollect();
  }

  function openJsonDialog() {
    const dialog = $('baeminDeliveryJsonDialog');
    const textarea = $('baeminDeliveryJsonInput');
    if (textarea) textarea.value = '';
    if (dialog?.showModal) dialog.showModal();
  }

  function closeJsonDialog() {
    const dialog = $('baeminDeliveryJsonDialog');
    if (dialog?.close) dialog.close();
  }

  async function submitJsonImport() {
    const textarea = $('baeminDeliveryJsonInput');
    const raw = String(textarea?.value || '').trim();
    if (!raw) {
      showToast('JSON을 붙여넣으세요.');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      showToast('JSON 형식이 올바르지 않습니다.');
      return;
    }

    if (state.loading) return;
    setLoading(true);
    closeJsonDialog();

    const captureDate = $('baeminDeliveryCaptureDate')?.value || new Date().toISOString().slice(0, 10);
    const result = await adminApi('/api/admin/baemin-delivery/import-json', {
      method: 'POST',
      body: JSON.stringify({ payload, captureDate })
    });

    setLoading(false);
    if (!result.ok) {
      renderSummary(null, result.message || 'JSON 저장에 실패했습니다.');
      return;
    }
    renderSummary(result);
    showToast('배민 JSON 데이터가 저장되었습니다.');
    if (!isViewSection()) {
      state.activePartnerId = '';
      await loadAllSubtabData();
    }
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    $('baeminDeliverySessionRefreshBtn')?.addEventListener('click', () => {
      void startSessionRefresh();
    });

    $('baeminBrowserOpenBtn')?.addEventListener('click', () => {
      void openLocalBrowser();
    });

    $('baeminFullCollectBtn')?.addEventListener('click', () => {
      void runFullCollect();
    });

    $('baeminServerShutdownBtn')?.addEventListener('click', () => {
      void shutdownLocalServer();
    });

    $('baeminDeliveryAutoCollectBtn')?.addEventListener('click', () => {
      void runFullCollect();
    });

    $('baeminDeliveryJsonPasteBtn')?.addEventListener('click', () => {
      openJsonDialog();
    });

    $('baeminDeliveryManualCookieSaveBtn')?.addEventListener('click', () => {
      void saveManualCookie();
    });

    $('baeminDeliveryJsonSubmitBtn')?.addEventListener('click', () => {
      void submitJsonImport();
    });

    $('baeminDeliveryJsonCancelBtn')?.addEventListener('click', () => {
      closeJsonDialog();
    });

    $('baeminDeliverySessionDialogCloseBtn')?.addEventListener('click', () => {
      closeSetupDialog();
    });

    $('baeminDeliveryApplyBtn')?.addEventListener('click', () => {
      void applyToErp();
    });

    $('baeminDeliveryScrubDupBtn')?.addEventListener('click', () => {
      void scrubDuplicatePartners();
    });

    $('baeminDeliveryPurgeCollectBtn')?.addEventListener('click', () => {
      void purgeCollectDateData();
    });

    $('baeminDeliveryCaptureDate')?.addEventListener('change', () => {
      state.bizPreviewCollectDate = $('baeminDeliveryCaptureDate')?.value || '';
      invalidateDataCache();
      void loadLatestSummary();
      if (!isViewSection()) {
        state.activePartnerId = '';
        void loadAllSubtabData();
      }
    });

    $('baeminStatusWeekStart')?.addEventListener('change', () => {
      if (!isViewSection()) return;
      const raw = $('baeminStatusWeekStart')?.value || '';
      state.viewWeekStart = window.BremDatePicker?.applyWeekWednesday?.(raw) || raw;
      syncViewWeekPicker();
      invalidateDataCache();
      state.activePartnerId = '';
      void loadPartnerTabs().then(() => {
        if (state.activePartnerId) {
          void loadPartnerBundle(state.activePartnerId, state.activeMenu);
        } else {
          clearViewTablesForMenu(state.activeMenu);
        }
      });
    });

    ['baeminStatusMenuSubtabBar', 'baeminBizMenuSubtabBar'].forEach(barId => {
      $(barId)?.querySelectorAll('[data-baemin-menu]').forEach(btn => {
        btn.addEventListener('click', () => {
          switchBaeminMenu(btn.dataset.baeminMenu || 'delivery_status');
        });
      });
    });
  }

  async function refresh(sectionId) {
    const nextSection = String(sectionId || state.activeSection || 'baemin-biz-status').trim();
    if (state.activeSection !== nextSection) {
      stopPolling();
      state.activePartnerId = '';
      state.partners = [];
      invalidateDataCache();
    }
    state.activeSection = nextSection;
    bindEvents();
    const dateInput = $('baeminDeliveryCaptureDate');
    if (dateInput && !dateInput.value) {
      dateInput.value = todayKstDate();
    }

    if (isViewSection()) {
      if (!state.activeMenu) state.activeMenu = 'delivery_status';
      ensureViewWeekStart();
      syncViewWeekPicker();
      updatePanelVisibility();
      invalidateDataCache();
      await loadViewConfig();
      await loadAllSubtabData();
      return;
    }

    stopStatusPoll();
    await loadPublicLocalSessionConfig();
    await loadConfig();
    await loadLatestSummary();
    await loadAllSubtabData();

    state.statusPollTimer = setInterval(async () => {
      await loadConfig();
    }, 15000);

    stopLocalHealthPoll();
    state.localHealthPollTimer = setInterval(async () => {
      await refreshLocalServerStatus();
    }, 4000);
  }

  function stopLocalHealthPoll() {
    if (state.localHealthPollTimer) {
      clearInterval(state.localHealthPollTimer);
      state.localHealthPollTimer = null;
    }
  }

  function stopPolling() {
    stopStatusPoll();
    stopLocalHealthPoll();
    stopSetupPoll();
  }

  window.BremBaeminDeliveryStatusAdmin = { refresh, stopPolling };
  bindEvents();
})();
