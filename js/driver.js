(function () {
  const loginCard = document.getElementById('driverLoginCard');
  const mainApp = document.getElementById('driverMainApp');
  const loginForm = document.getElementById('driverLoginForm');
  const loginIdInput = document.getElementById('driverLoginId');
  const loginPasswordInput = document.getElementById('driverLoginPassword');
  const logoutBtn = document.getElementById('driverLogoutBtn');
  const result = document.getElementById('result');
  const toast = document.getElementById('toast');
  const state = {
    currentDriver: null,
    selectedWeekStart: null
  };
  let driverDashboardLoading = false;
  let driverLoadFailed = false;
  let baeminLiveOpsPollTimer = null;
  let coupangLiveOpsPollTimer = null;
  const BAEMIN_LIVE_OPS_POLL_MS = 2 * 60 * 1000;
  const COUPANG_LIVE_OPS_POLL_MS = 2 * 60 * 1000;

  function calls() {
    return BremStorage.calls.getAll();
  }

  function notices() {
    return BremStorage.notices.getAll();
  }

  function mergedNoticesForDriver() {
    return sortNotices(
      notices().filter(notice => notice.noticeKind !== 'payroll' && !String(notice.id || '').startsWith('payroll-'))
    );
  }

  function eventCatalog() {
    return BremStorage.events.getCatalog();
  }

  function eventItemFor(driver) {
    return BremStorage.events.getItemForDriver(driver);
  }

  function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function weekRange() {
    const start = new Date(`${state.selectedWeekStart || weekStartKey()}T00:00:00`);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  function dateValue(value) {
    return new Date(`${value}T00:00:00`);
  }

  function formatDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(dateValue(value));
  }

  let driverTargetMonthPicker = null;

  function formatMonthLabel(value) {
    if (!value || !/^\d{4}-\d{2}$/.test(value)) return '월을 선택하세요';
    const [year, month] = value.split('-');
    return `${year}년 ${month}월`;
  }

  function updateDriverTargetMonthLabel() {
    const input = document.getElementById('driverTargetMonth');
    const label = document.getElementById('driverTargetMonthLabel');
    if (label && input) label.textContent = formatMonthLabel(input.value);
  }

  function closeTargetModal() {
    const modal = document.getElementById('driverTargetModal');
    if (modal) modal.hidden = true;
  }

  function openTargetModal(mode) {
    const modal = document.getElementById('driverTargetModal');
    const monthSection = document.getElementById('driverTargetModalMonth');
    const weekSection = document.getElementById('driverTargetModalWeek');
    const title = document.getElementById('driverTargetModalTitle');
    if (!modal || !monthSection || !weekSection || !title || !state.currentDriver) return;

    const isMonth = mode === 'month';
    monthSection.hidden = !isMonth;
    weekSection.hidden = isMonth;
    title.textContent = isMonth ? '월간 목표 설정' : '주간 목표 설정';

    const month = currentMonth();
    const weekStart = state.selectedWeekStart || weekStartKey();

    if (isMonth) {
      document.getElementById('driverTargetMonth').value = month;
      driverTargetMonthPicker?.setMonth(month);
      updateDriverTargetMonthLabel();
      document.getElementById('driverMonthTargetCount').value = targetFor(state.currentDriver.id, month) || '';
    } else {
      updateWeekTargetPreview(weekStart);
      document.getElementById('driverWeekTargetCount').value = weeklyTargetFor(state.currentDriver.id, weekStart) || '';
    }

    modal.hidden = false;
  }

  function setupDriverTargetMonthPicker() {
    if (setupDriverTargetMonthPicker.bound) return;
    setupDriverTargetMonthPicker.bound = true;

    driverTargetMonthPicker = BremDatePicker.setupMonthSingle({
      popup: document.getElementById('driverTargetMonthCalendar'),
      monthsContainer: document.getElementById('driverTargetMonthGrid'),
      titleEl: document.getElementById('driverTargetMonthTitle'),
      prevBtn: document.getElementById('driverTargetMonthPrev'),
      nextBtn: document.getElementById('driverTargetMonthNext'),
      todayBtn: document.getElementById('driverTargetMonthThisMonth'),
      hiddenInput: document.getElementById('driverTargetMonth'),
      openButton: document.getElementById('driverTargetMonthButton'),
      labelEl: document.getElementById('driverTargetMonthLabel'),
      emptyLabel: '월을 선택하세요',
      onSelect: updateDriverTargetMonthLabel
    });
  }

  function dateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function number(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function formatPercent(value) {
    if (value == null) return '미집계';
    const rate = Number(value);
    if (Number.isNaN(rate)) return '-';
    return `${rate % 1 === 0 ? rate : rate.toFixed(1)}%`;
  }

  function weeklyEntryForPlatform(driverId, weekStart, platform) {
    return BremStorage.rejections.getEntryForWeek(driverId, weekStart, platform, { riderOnly: true });
  }

  function isDriverProductionMode() {
    return BremStorage.getSupabaseConfig?.().mode === 'production';
  }

  function setRiderPublishNoticeLoading(show) {
    const notice = document.getElementById('riderPublishNotice');
    const loadingEl = document.getElementById('riderPublishLoading');
    const readyEl = document.getElementById('riderPublishReady');
    const errorEl = document.getElementById('riderPublishError');
    if (!notice || !loadingEl || !readyEl) return;

    if (show) {
      driverLoadFailed = false;
      notice.hidden = false;
      notice.classList.add('is-loading');
      loadingEl.hidden = false;
      readyEl.hidden = true;
      if (errorEl) errorEl.hidden = true;
      return;
    }

    notice.classList.remove('is-loading');
    loadingEl.hidden = true;
  }

  function setRiderPublishNoticeError(show) {
    const notice = document.getElementById('riderPublishNotice');
    const loadingEl = document.getElementById('riderPublishLoading');
    const readyEl = document.getElementById('riderPublishReady');
    const errorEl = document.getElementById('riderPublishError');
    if (!notice || !loadingEl || !readyEl || !errorEl) return;

    notice.hidden = false;
    notice.classList.remove('is-loading');
    loadingEl.hidden = true;
    readyEl.hidden = true;
    errorEl.hidden = !show;
    driverLoadFailed = show;
  }

  function renderRiderPublishNotice(options = {}) {
    const notice = document.getElementById('riderPublishNotice');
    const label = document.getElementById('riderPublishAt');
    const readyEl = document.getElementById('riderPublishReady');
    if (!notice || !label || !readyEl) return;

    if (!isDriverProductionMode()) {
      notice.hidden = true;
      setRiderPublishNoticeLoading(false);
      return;
    }

    if (driverDashboardLoading) {
      setRiderPublishNoticeLoading(true);
      return;
    }

    if (options.failed || driverLoadFailed) {
      setRiderPublishNoticeError(true);
      return;
    }

    const publishedAt = options.publishedAt
      || BremStorage.getDriverAppPublishedAt?.()
      || null;
    const text = window.BremDriverUtils?.formatRiderPublishDateTime?.(publishedAt) || '';

    if (!text) {
      notice.hidden = true;
      readyEl.hidden = true;
      setRiderPublishNoticeLoading(false);
      label.textContent = '-';
      return;
    }

    setRiderPublishNoticeLoading(false);
    setRiderPublishNoticeError(false);
    notice.hidden = false;
    readyEl.hidden = false;
    label.textContent = text;
    const refreshBtn = document.getElementById('riderPublishRefreshBtn');
    if (refreshBtn) refreshBtn.disabled = false;
  }

  async function checkDriverPublishUpdateIfNeeded(options = {}) {
    if (!isDriverProductionMode() || !state.currentDriver?.id) return null;
    if (driverDashboardLoading || riderPublishCheckInFlight) return null;

    riderPublishCheckInFlight = true;
    const refreshBtn = document.getElementById('riderPublishRefreshBtn');
    if (refreshBtn && options.force) refreshBtn.disabled = true;

    try {
      const result = await BremStorage.checkDriverAppPublishUpdate?.({
        riderId: state.currentDriver.id,
        force: Boolean(options.force)
      });

      if (result?.refreshed) {
        refreshDriverDashboard(BremStorage.drivers.getById(state.currentDriver.id) || state.currentDriver);
        renderRiderPublishNotice({ publishedAt: result.publishedAt || null });
        if (options.toast) {
          showToast('최신 반영 데이터를 불러왔습니다.');
        }
      } else if (options.force && result?.ok) {
        renderRiderPublishNotice({ publishedAt: BremStorage.getDriverAppPublishedAt?.() || null });
        if (options.toast) {
          showToast('이미 최신 데이터입니다.');
        }
      }

      return result;
    } catch (error) {
      if (options.force) {
        showToast(error.message || '최신 반영을 불러오지 못했습니다.');
      }
      return null;
    } finally {
      riderPublishCheckInFlight = false;
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  function startRiderPublishPolling() {
    stopRiderPublishPolling();
    if (!isDriverProductionMode()) return;
    riderPublishPollTimer = window.setInterval(() => {
      void checkDriverPublishUpdateIfNeeded();
    }, RIDER_PUBLISH_POLL_MS);
  }

  function stopRiderPublishPolling() {
    if (riderPublishPollTimer) {
      window.clearInterval(riderPublishPollTimer);
      riderPublishPollTimer = null;
    }
    if (riderPublishVisibilityTimer) {
      window.clearTimeout(riderPublishVisibilityTimer);
      riderPublishVisibilityTimer = null;
    }
  }

  function weeklyRateForPlatform(driverId, weekStart, platform) {
    const entry = weeklyEntryForPlatform(driverId, weekStart, platform);
    return entry ? entry.rate : null;
  }

  function toggleRateDetailPanel(panelId, cardId) {
    const panel = document.getElementById(panelId);
    const card = document.getElementById(cardId);
    if (!panel || !card) return;
    const expanded = card.getAttribute('aria-expanded') === 'true';
    card.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    panel.hidden = expanded;
  }

  function serviceCount(stats, groupKey, legacyKey) {
    const group = stats?.[groupKey];
    if (group && typeof group === 'object') {
      return {
        food: Number(group.food || 0),
        bmart: Number(group.bmart || 0),
        store: Number(group.store || 0),
        total: Number(group.total ?? stats?.[legacyKey] ?? 0)
      };
    }
    const total = Number(stats?.[legacyKey] || 0);
    return { food: 0, bmart: 0, store: 0, total };
  }

  function renderRateDetail(platform, entry) {
    const stats = entry?.stats && typeof entry.stats === 'object' ? entry.stats : {};
    const unmeasured = stats.unmeasured === true || entry?.rate == null;
    const empty = '-';
    const countLabel = value => (entry ? `${number(value)}건` : empty);

    if (platform === 'baemin') {
      const reject = serviceCount(stats, 'rejectByService', 'rejectCount');
      const dispatch = serviceCount(stats, 'dispatchCancelByService', 'dispatchCancelCount');
      const rider = serviceCount(stats, 'riderFaultByService', 'riderCancelCount');
      setText('baeminRateComplete', entry ? countLabel(stats.completeTotal || 0) : empty);
      setText('baeminRateRejectFood', entry ? countLabel(reject.food) : empty);
      setText('baeminRateRejectBmart', entry ? countLabel(reject.bmart) : empty);
      setText('baeminRateRejectStore', entry ? countLabel(reject.store) : empty);
      setText('baeminRateReject', entry ? countLabel(reject.total) : empty);
      setText('baeminRateDispatchFood', entry ? countLabel(dispatch.food) : empty);
      setText('baeminRateDispatchBmart', entry ? countLabel(dispatch.bmart) : empty);
      setText('baeminRateDispatchStore', entry ? countLabel(dispatch.store) : empty);
      setText('baeminRateDispatchCancel', entry ? countLabel(dispatch.total) : empty);
      setText('baeminRateRiderFood', entry ? countLabel(rider.food) : empty);
      setText('baeminRateRiderBmart', entry ? countLabel(rider.bmart) : empty);
      setText('baeminRateRiderStore', entry ? countLabel(rider.store) : empty);
      setText('baeminRateRiderCancel', entry ? countLabel(rider.total) : empty);
      setText('baeminRateCalculated', !entry ? empty : (unmeasured ? '미집계' : formatPercent(entry.rate)));
      return;
    }

    setText('coupangRateComplete', entry ? countLabel(stats.completeCount || 0) : empty);
    setText('coupangRateReject', entry ? countLabel(stats.rejectCount || 0) : empty);
    setText('coupangRateCancel', entry ? countLabel(stats.cancelCount || 0) : empty);
    setText('coupangRateCalculated', !entry ? empty : (unmeasured ? '미집계' : formatPercent(entry.rate)));
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function normalizePhone(value) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  function normalizePassword(value) {
    return String(value || '').trim();
  }

  function normalizeLoginText(value) {
    if (window.BremDriverUtils?.normalizeLoginIdInput) {
      return BremDriverUtils.normalizeLoginIdInput(value);
    }
    return String(value || '').replace(/[\s-]/g, '');
  }

  function driverLoginId(driver) {
    if (window.BremDriverUtils?.makeDriverLoginId) {
      return BremDriverUtils.makeDriverLoginId(driver);
    }
    return `${normalizeLoginText(driver.name)}${normalizePhone(driver.phone).slice(-4)}`;
  }

  function formatPlatformLabel(driver) {
    if (window.BremDriverUtils?.formatDriverPlatformLabel) {
      return BremDriverUtils.formatDriverPlatformLabel(driver);
    }
    const coupang = driver?.platformCoupang !== false;
    const baemin = Boolean(driver?.platformBaemin);
    if (coupang && baemin) return '배민쿠팡';
    if (baemin) return '배민';
    if (coupang) return '쿠팡';
    return '-';
  }

  function formatAccountLabel(driver) {
    if (window.BremDriverUtils?.formatAccountSummary) {
      return BremDriverUtils.formatAccountSummary(driver);
    }
    const bank = String(driver?.bankName || '').trim();
    const holder = String(driver?.accountHolder || '').trim();
    const numberHidden = BremDriverUtils?.isDriverFieldHidden?.(driver, 'accountNumber');
    const numberRaw = String(driver?.accountNumber || '').trim();
    const number = numberHidden && numberRaw ? '가려진 정보' : numberRaw;
    if (!bank && !holder && !number) return '-';
    return [bank, holder, number].filter(Boolean).join(' · ');
  }

  function refreshCurrentDriver() {
    if (!state.currentDriver?.id) return null;
    state.currentDriver = BremStorage.drivers.getById(state.currentDriver.id) || state.currentDriver;
    return state.currentDriver;
  }

  function applySensitiveFieldUi(driver) {
    const residentHidden = BremDriverUtils.isDriverFieldHidden(driver, 'residentNumber');
    const accountHidden = BremDriverUtils.isDriverFieldHidden(driver, 'accountNumber');

    const residentRow = document.getElementById('driverResidentNumberRow');
    const residentDisplay = document.getElementById('driverResidentNumber');
    if (residentRow) residentRow.hidden = residentHidden;
    if (residentDisplay && !residentHidden) {
      residentDisplay.textContent = BremDriverUtils.formatResidentNumber(driver.residentNumber || '') || '-';
    }

    const residentField = document.getElementById('driverEditResidentNumberField');
    const residentInput = document.getElementById('driverEditResidentNumber');
    if (residentField) residentField.hidden = residentHidden;
    if (residentInput) {
      residentInput.disabled = residentHidden;
      residentInput.readOnly = residentHidden;
      if (residentHidden) residentInput.value = '';
      else {
        residentInput.value = BremDriverUtils.formatResidentNumber(driver.residentNumber || '');
      }
    }

    const accountField = document.getElementById('driverEditAccountNumberField');
    const accountInput = document.getElementById('driverEditAccountNumber');
    if (accountField) accountField.hidden = accountHidden;
    if (accountInput) {
      accountInput.disabled = accountHidden;
      accountInput.readOnly = accountHidden;
      if (accountHidden) accountInput.value = '';
      else accountInput.value = driver.accountNumber || '';
    }
  }

  function fillProfileEditForm(driver) {
    document.getElementById('driverEditBankName').value = driver.bankName || '';
    document.getElementById('driverEditAccountHolder').value = driver.accountHolder || '';
    document.getElementById('driverEditCurrentPassword').value = '';
    document.getElementById('driverEditNewPassword').value = '';
    document.getElementById('driverEditConfirmPassword').value = '';
    applySensitiveFieldUi(driver);
  }

  function toggleProfileEditPanel(show) {
    const panel = document.getElementById('driverProfileEditPanel');
    if (!panel) return;
    panel.hidden = !show;
    if (show) {
      const driver = refreshCurrentDriver();
      if (driver) fillProfileEditForm(driver);
    }
  }

  function findDriverByLogin(loginId, password) {
    const matchedDriver = BremStorage.drivers.getAll().find(driver => driverLoginId(driver) === normalizeLoginText(loginId));
    if (!matchedDriver) {
      return { ok: false, reason: '아이디가 일치하는 기사가 없습니다. 기사등록 프로그램의 로그인 아이디를 확인하세요.' };
    }

    if (window.BremDriverUtils?.verifyDriverLoginSecret) {
      const secretResult = BremDriverUtils.verifyDriverLoginSecret(matchedDriver, password);
      if (!secretResult.ok) return secretResult;
      return { ok: true, driver: matchedDriver };
    }

    const savedPassword = normalizePassword(matchedDriver.password);
    const inputPassword = normalizePassword(password);

    if (!savedPassword) {
      return { ok: false, reason: '비밀번호가 설정되어 있지 않습니다. 관리자에게 문의하세요.' };
    }

    if (!inputPassword) {
      return { ok: false, reason: '비밀번호를 입력하세요.' };
    }

    if (savedPassword !== inputPassword) {
      return { ok: false, reason: '비밀번호가 일치하지 않습니다.' };
    }

    return { ok: true, driver: matchedDriver };
  }

  function findDriverById(id) {
    return BremStorage.drivers.getById(id);
  }

  function consumeLogoutNotice() {
    const notice = window.BremSessionSecurity?.consumeLogoutNotice?.() || '';
    if (notice) showToast(notice);
  }

  async function logoutDriver(options = {}) {
    const { idle = false, message = '' } = options;
    const riderId = state.currentDriver?.id || BremStorage.auth.getDriverSessionId?.();
    window.BremSessionSecurity?.stop();
    stopBaeminLiveOpsPolling();
    stopCoupangLiveOpsPolling();

    if (BremStorage.getSupabaseConfig?.().mode === 'production') {
      await BremStorage.auth.signOutSupabase('rider');
    } else {
      BremStorage.auth.setDriverSessionId(null);
      BremStorage.auth.clearSessionAuth?.('rider');
    }

    BremStorage.clearRiderLiveOpsCache?.();
    BremStorage.invalidateDriverAppCache?.(riderId || '');
    window.BremDriverDataCache?.clearAll?.();

    state.currentDriver = null;
    state.selectedWeekStart = weekStartKey();
    driverDashboardLoading = false;
    driverLoadFailed = false;
    // 출금/주급명세서는 각자 모듈 상태와 캐시를 들고 있어서, 여기서 비우지 않으면
    // 다른 기사로 로그인했을 때 이전 기사의 금액이 그대로 남는다.
    window.BremDriverWithdrawal?.reset?.();
    window.BremDriverWeeklyPayslip?.reset?.();
    window.BremDriverRegionDashboard?.reset?.();
    window.BremDriverCrewLeader?.reset?.();
    window.BremDriverUrgentMissions?.reset?.();
    showLoggedOut();
    window.BremLoginPrefs?.restoreIdAfterLogout?.('rider', {
      idInput: loginIdInput,
      rememberCheckbox: document.getElementById('driverRememberId'),
      passwordInput: loginPasswordInput
    });
    if (idle) {
      showToast(message || window.BremSessionSecurity?.IDLE_MESSAGE || '로그아웃되었습니다.');
    } else {
      showToast('로그아웃되었습니다.');
    }
  }

  function startDriverSessionSecurity() {
    const isLoggedIn = () => {
      try {
        return Boolean(
          BremStorage.auth.isDriverLoggedIn?.()
          || BremStorage.auth.getDriverSessionId?.()
        );
      } catch {
        return false;
      }
    };
    if (!isLoggedIn()) return;
    if (!window.BremSessionSecurity?.start) return;
    window.BremSessionSecurity.start({
      isLoggedIn,
      idleMs: window.BREM_IS_NATIVE_APP ? 0 : undefined,
      onIdleLogout: async (message) => {
        await logoutDriver({ idle: true, message });
      }
    });
  }

  function enforceDriverRouteAccess() {
    const loggedIn = BremStorage.auth.isDriverLoggedIn?.()
      || Boolean(BremStorage.auth.getDriverSessionId());
    if (loggedIn) return true;
    showLoggedOut();
    return false;
  }

  function showLoggedOut() {
    stopBaeminLiveOpsPolling();
    window.BremSessionSecurity?.stop();
    loginCard.hidden = false;
    if (mainApp) mainApp.hidden = true;
    result.hidden = true;
    toggleProfileEditPanel(false);
    hideNoticePopup();
    noticePopupState.queue = [];
  }

  function showLoggedIn(driver) {
    if (!driver) {
      showLoggedOut();
      return;
    }
    state.currentDriver = driver;
    if (!state.selectedWeekStart) state.selectedWeekStart = weekStartKey();
    loginCard.hidden = true;
    if (mainApp) mainApp.hidden = false;
    result.hidden = false;
    if (isDriverProductionMode()) {
      setRiderPublishNoticeLoading(true);
    }
    renderDriver(driver);
    startDriverSessionSecurity();
    window.BremSessionSecurity?.touchActivity?.();
    document.dispatchEvent(new CustomEvent('brem-rider-session-ready', {
      detail: { driverId: driver.id || null }
    }));
    void window.BremDriverCrewLeader?.refreshEntryVisibility?.();
    void window.BremDriverRegionDashboard?.refreshEntryVisibility?.();
    void window.BremDriverUrgentMissions?.refresh?.();
    window.setTimeout(() => queueNoticePopups(), 250);
  }

  let driverCallIndex = null;
  let driverCallIndexKey = '';

  function invalidateDriverCallIndex() {
    driverCallIndex = null;
    driverCallIndexKey = '';
  }

  function getDriverCallIndex() {
    const list = calls();
    const key = `${list.length}:${list[0]?.id || ''}:${list[list.length - 1]?.id || ''}`;
    if (driverCallIndex && driverCallIndexKey === key) return driverCallIndex;

    const byDriver = new Map();
    for (const call of list) {
      const id = call.driverId;
      if (!id) continue;
      if (!byDriver.has(id)) byDriver.set(id, []);
      byDriver.get(id).push(call);
    }
    driverCallIndex = byDriver;
    driverCallIndexKey = key;
    return byDriver;
  }

  function driverCalls(driverId) {
    return getDriverCallIndex().get(driverId) || [];
  }

  let driverDataLoadPromise = null;
  const RIDER_PUBLISH_POLL_MS = 30 * 60 * 1000;
  let riderPublishPollTimer = null;
  let riderPublishVisibilityTimer = null;
  let riderPublishCheckInFlight = false;

  function refreshDriverDashboard(driver) {
    if (!driver?.id || state.currentDriver?.id !== driver.id) return;
    const fresh = BremStorage.drivers.getById(driver.id) || driver;
    renderDriver(fresh);
  }

  async function refreshCurrentRiderFromServer(driver) {
    if (BremStorage.getSupabaseConfig?.().mode !== 'production') {
      return driver;
    }
    const fetched = await BremStorage.fetchCurrentRiderFromServer?.().catch(() => null);
    if (fetched?.ok && fetched.driver) {
      return fetched.driver;
    }
    return driver;
  }

  function loadDriverAppDataThenRender(driver, options = {}) {
    if (!driver?.id) return Promise.resolve();

    const driverId = driver.id;
    if (isDriverProductionMode()) {
      driverDashboardLoading = true;
      setRiderPublishNoticeLoading(true);
    }

    const task = (async () => {
      let loadResult = null;
      try {
        let freshDriver = driver;
        if (options.refreshProfile !== false && !isDriverProductionMode()) {
          freshDriver = await refreshCurrentRiderFromServer(driver) || driver;
        }

        loadResult = await BremStorage.loadDriverAppBundle?.({
          force: Boolean(options.force),
          riderId: driverId
        }) || await BremStorage.hydrateDriverAppData?.({
          force: Boolean(options.force),
          riderId: driverId
        });

        if (loadResult?.rider?.id) {
          freshDriver = BremStorage.drivers.getById(loadResult.rider.id) || freshDriver;
        }

        refreshDriverDashboard(BremStorage.drivers.getById(driverId) || freshDriver);
        const readyDriver = BremStorage.drivers.getById(driverId) || freshDriver;
        if (driverHasBaemin(readyDriver)) {
          // 초기 로드 직후 바로 1회 조회 + 2분 폴링 시작 (Supabase 반영분 수신)
          void refreshBaeminLiveOps({ toast: false, source: 'boot' });
        }
        if (driverHasCoupang(readyDriver)) {
          void refreshCoupangLiveOps({ toast: false, source: 'boot' });
        }
        return loadResult;
      } finally {
        driverDashboardLoading = false;
        const failed = loadResult?.allFailed === true;
        renderRiderPublishNotice({
          failed,
          publishedAt: loadResult?.publishedAt || null
        });
      }
    })();

    driverDataLoadPromise = task.finally(() => {
      driverDataLoadPromise = null;
    });

    return driverDataLoadPromise.catch(error => {
      console.warn('[BREM] Driver app data load failed:', error.message || error);
      renderRiderPublishNotice({ failed: true });
    });
  }

  function normalizePlatform(platform) {
    return BremPlatforms.normalize(platform);
  }

  function sumCallCounts(list) {
    return list.reduce((sum, call) => sum + Number(call.count || 0), 0);
  }

  function callsByPlatform(list) {
    const coupang = sumCallCounts(list.filter(call => normalizePlatform(call.platform) === 'coupang'));
    const baemin = sumCallCounts(list.filter(call => normalizePlatform(call.platform) === 'baemin'));
    return { coupang, baemin, total: coupang + baemin };
  }

  function monthCallsByPlatform(driverId, month) {
    return callsByPlatform(driverCalls(driverId).filter(call => call.date.startsWith(month)));
  }

  function weeklyCallsByPlatform(driverId) {
    const { start, end } = weekRange();
    const list = driverCalls(driverId).filter(call => {
      const callDate = dateValue(call.date);
      return callDate >= start && callDate <= end;
    });
    return callsByPlatform(list);
  }

  function longEventPlatformLabel(platform) {
    const value = String(platform || '').trim().toLowerCase();
    if (value === 'baemin') return '배민';
    if (value === 'both' || value === 'combined' || value === 'all') return '쿠팡+배민';
    return '쿠팡';
  }

  function targetFor(driverId, month) {
    return BremStorage.targets.getMonthlyCount(driverId, month);
  }

  function weeklyTargetFor(driverId, weekStart) {
    return BremStorage.weeklyTargets.getCount(driverId, weekStart);
  }

  function saveMonthlyTarget(driverId, month, count) {
    return BremStorage.targets.upsertMonthly({ driverId, month, count });
  }

  function saveWeeklyTarget(driverId, weekStart, count) {
    return BremStorage.weeklyTargets.upsert({ driverId, weekStart, count });
  }

  function setText(id, value) {
    document.getElementById(id).textContent = value;
  }

  function setProgress(id, rate) {
    document.getElementById(id).style.width = `${Math.min(Math.max(rate, 0), 100)}%`;
  }

  function weekStartKey(dateValue = dateKey(new Date())) {
    const date = new Date(`${dateValue}T00:00:00`);
    const day = date.getDay();
    const diff = (day - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return dateKey(date);
  }

  function weekEndKey(weekStart) {
    const end = new Date(`${weekStart}T00:00:00`);
    end.setDate(end.getDate() + 6);
    return dateKey(end);
  }

  function updateWeekTargetPreview(weekStart) {
    const normalizedWeekStart = weekStartKey(weekStart || dateKey(new Date()));
    document.getElementById('driverTargetWeekDate').value = normalizedWeekStart;
    setText(
      'driverTargetWeekRange',
      `${formatDate(normalizedWeekStart)} ~ ${formatDate(weekEndKey(normalizedWeekStart))}`
    );
  }

  function setupDriverWeekPicker() {
    if (setupDriverWeekPicker.bound) return;
    setupDriverWeekPicker.bound = true;

    BremDatePicker.setupWednesdayWeekDelegated({
      popup: document.getElementById('driverWeekPickerCalendar'),
      daysContainer: document.getElementById('driverWeekPickerDays'),
      titleEl: document.getElementById('driverWeekPickerTitle'),
      prevBtn: document.getElementById('driverWeekPickerPrev'),
      nextBtn: document.getElementById('driverWeekPickerNext'),
      todayBtn: document.getElementById('driverWeekPickerThisWeek'),
      openSelector: '[data-week-picker-trigger="driver-week"]',
      getContext() {
        return {
          hiddenInput: document.getElementById('driverTargetWeekDate'),
          onSelect(value) {
            updateWeekTargetPreview(value);
          }
        };
      }
    });
  }

  function shiftSelectedWeek(days) {
    const base = new Date(`${state.selectedWeekStart || weekStartKey()}T00:00:00`);
    base.setDate(base.getDate() + days);
    const nextWeek = weekStartKey(dateKey(base));
    const latestWeek = weekStartKey();
    state.selectedWeekStart = nextWeek > latestWeek ? latestWeek : nextWeek;
    if (state.currentDriver) renderDriver(state.currentDriver);
  }

  function renderDailyCalls(driverId) {
    const { start, end } = weekRange();
    const byDate = new Map();

    driverCalls(driverId)
      .filter(call => {
        const callDate = dateValue(call.date);
        return callDate >= start && callDate <= end;
      })
      .forEach(call => {
        if (!byDate.has(call.date)) {
          byDate.set(call.date, { coupang: 0, baemin: 0 });
        }
        const bucket = byDate.get(call.date);
        const count = Number(call.count || 0);
        if (normalizePlatform(call.platform) === 'baemin') {
          bucket.baemin += count;
        } else {
          bucket.coupang += count;
        }
      });

    const rows = Array.from(byDate.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, counts]) => {
        const total = counts.coupang + counts.baemin;
        return `
          <tr>
            <td>${formatDate(date)}</td>
            <td>${counts.coupang ? `<strong>${number(counts.coupang)}콜</strong>` : '-'}</td>
            <td>${counts.baemin ? `<strong>${number(counts.baemin)}콜</strong>` : '-'}</td>
            <td><strong>${number(total)}콜</strong></td>
          </tr>
        `;
      })
      .join('');

    setText('dailyRange', `${formatDate(dateKey(start))} ~ ${formatDate(dateKey(end))}`);
    document.getElementById('dailyRows').innerHTML = rows || '<tr><td colspan="4" class="empty-text">선택한 주간의 콜수 기록이 없습니다.</td></tr>';
  }

  function sortNotices(list) {
    return list.slice().sort((a, b) => {
      const popupDiff = Number(b.popup) - Number(a.popup);
      if (popupDiff) return popupDiff;
      const pinDiff = Number(b.pinned) - Number(a.pinned);
      if (pinDiff) return pinDiff;
      const aDate = String(a.createdAt || a.updatedAt || '');
      const bDate = String(b.createdAt || b.updatedAt || '');
      return bDate.localeCompare(aDate);
    });
  }

  function formatNoticeDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      const key = raw.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
      const [, m, d] = key.split('-');
      return `${Number(m)}.${Number(d)}`;
    }
    return `${date.getMonth() + 1}.${date.getDate()}`;
  }

  let openNoticeId = '';

  function noticeReadStorageKey() {
    return `brem_notice_read_v1_${state.currentDriver?.id || 'anon'}`;
  }

  function readNoticeReadMap() {
    try {
      const raw = localStorage.getItem(noticeReadStorageKey());
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeNoticeReadMap(map) {
    try {
      localStorage.setItem(noticeReadStorageKey(), JSON.stringify(map || {}));
    } catch {
      /* ignore quota */
    }
  }

  function isNoticeRead(noticeId) {
    const id = String(noticeId || '').trim();
    return Boolean(id && readNoticeReadMap()[id]);
  }

  function markNoticeRead(noticeId) {
    const id = String(noticeId || '').trim();
    if (!id) return;
    const map = readNoticeReadMap();
    if (!map[id]) {
      map[id] = Date.now();
      writeNoticeReadMap(map);
    }
    updateNoticeUnreadBadge();
  }

  function unreadNoticeCount(noticeList) {
    return (noticeList || []).filter(notice => notice.id && !isNoticeRead(notice.id)).length;
  }

  function updateNoticeUnreadBadge(noticeList) {
    const items = noticeList || mergedNoticesForDriver();
    const count = unreadNoticeCount(items);
    const badge = document.getElementById('driverNoticeNavBadge');
    if (badge) {
      badge.hidden = count < 1;
      badge.textContent = count > 99 ? '99+' : String(count);
    }
    document.querySelectorAll('#noticeList .notice-item[data-notice-id]').forEach((item) => {
      item.classList.toggle('is-unread', !isNoticeRead(item.dataset.noticeId));
    });
  }

  function renderNoticesList(listEl, noticeList) {
    const items = noticeList
      .map((notice) => {
        const id = String(notice.id || '');
        const unread = Boolean(id && !isNoticeRead(id));
        const when = formatNoticeDate(notice.createdAt || notice.updatedAt);
        return `
        <article class="notice-item${notice.pinned ? ' is-pinned' : ''}${unread ? ' is-unread' : ''}" data-notice-id="${escapeHtml(id)}">
          <button type="button" class="notice-item__toggle">
            <span class="notice-item__title">
              ${notice.pinned ? '<span class="notice-item__pin" aria-hidden="true">📌</span>' : ''}
              ${notice.popup ? '<span class="notice-badge">팝업</span>' : ''}
              <span class="notice-item__name">${escapeHtml(notice.title)}</span>
            </span>
            <time class="notice-item__date">${when ? escapeHtml(when) : ''}</time>
          </button>
        </article>`;
      })
      .join('');

    listEl.innerHTML = items || '<div class="empty-text">등록된 공지사항이 없습니다.</div>';
  }

  function updateNoticeChrome(noticeList) {
    const countEl = document.getElementById('driverNoticeCount');
    if (countEl) countEl.textContent = noticeList.length ? `${noticeList.length}건` : '';
    updateNoticeUnreadBadge(noticeList);
  }

  const NOTICE_POPUP_HIDE_KEY = 'brem_notice_popup_hide_v1';
  const noticePopupState = { queue: [], currentId: '' };

  function readNoticePopupHideMap() {
    try {
      const raw = localStorage.getItem(NOTICE_POPUP_HIDE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeNoticePopupHideMap(map) {
    try {
      localStorage.setItem(NOTICE_POPUP_HIDE_KEY, JSON.stringify(map || {}));
    } catch {
      /* ignore quota */
    }
  }

  function isNoticePopupHiddenToday(noticeId) {
    const today = dateKey(new Date());
    const map = readNoticePopupHideMap();
    return String(map[noticeId] || '') === today;
  }

  function hideNoticePopupToday(noticeId) {
    const map = readNoticePopupHideMap();
    map[noticeId] = dateKey(new Date());
    writeNoticePopupHideMap(map);
  }

  function hideNoticePopup() {
    const overlay = document.getElementById('driverNoticePopup');
    if (overlay) overlay.hidden = true;
    noticePopupState.currentId = '';
  }

  function fillNoticePopup(notice) {
    const titleEl = document.getElementById('driverNoticePopupTitle');
    const bodyEl = document.getElementById('driverNoticePopupBody');
    if (titleEl) titleEl.textContent = String(notice.title || '').trim() || '공지사항';
    if (bodyEl) bodyEl.textContent = notice.content || notice.body || '';
  }

  function setNoticePopupMode(fromList) {
    noticePopupState.fromList = Boolean(fromList);
    const hideBtn = document.getElementById('driverNoticePopupHideToday');
    if (hideBtn) hideBtn.hidden = Boolean(fromList);
  }

  function openNoticePopup(notice, options = {}) {
    const overlay = document.getElementById('driverNoticePopup');
    if (!overlay || !notice) return;
    noticePopupState.currentId = String(notice.id || '');
    setNoticePopupMode(options.fromList);
    fillNoticePopup(notice);
    overlay.hidden = false;
    if (notice.id) markNoticeRead(notice.id);
  }

  function showNextNoticePopup() {
    const overlay = document.getElementById('driverNoticePopup');
    if (!overlay || !state.currentDriver) {
      hideNoticePopup();
      return;
    }
    while (noticePopupState.queue.length) {
      const next = noticePopupState.queue.shift();
      if (!next?.id || isNoticePopupHiddenToday(next.id)) continue;
      openNoticePopup(next, { fromList: false });
      return;
    }
    hideNoticePopup();
  }

  function queueNoticePopups() {
    if (!state.currentDriver) return;
    const items = mergedNoticesForDriver().filter(notice => notice.popup && notice.id && !isNoticePopupHiddenToday(notice.id));
    noticePopupState.queue = items;
    if (document.getElementById('driverNoticePopup')?.hidden === false && noticePopupState.currentId) {
      return;
    }
    showNextNoticePopup();
  }

  function renderNotices() {
    const listEl = document.getElementById('noticeList');
    if (!listEl) return;
    const items = mergedNoticesForDriver();
    renderNoticesList(listEl, items);
    updateNoticeChrome(items);
    queueNoticePopups();
  }

  async function renderPlatformMission(driver, platform, missionId, assignedMission = null) {
    const prefix = platform === 'baemin' ? 'Baemin' : 'Coupang';
    const wrap = document.getElementById(`riderMission${prefix}Wrap`);
    const titleEl = document.getElementById(`riderMission${prefix}Title`);
    const descEl = document.getElementById(`riderMission${prefix}Description`);
    const condEl = document.getElementById(`riderMission${prefix}Conditions`);
    const active = platform === 'baemin' ? Boolean(driver?.platformBaemin) : driver?.platformCoupang !== false;

    if (wrap) {
      wrap.hidden = !active;
      wrap.classList.remove('is-mission-assigned');
    }
    if (!active) return;

    const id = String(missionId || '').trim();
    if (!id) {
      if (titleEl) titleEl.textContent = '미선택';
      if (descEl) descEl.textContent = '관리자가 미션을 배정하면 설명이 표시됩니다.';
      if (condEl) condEl.hidden = true;
      return;
    }

    let mission = assignedMission || BremStorage.missions?.getById?.(id) || null;

    if (!mission) {
      if (titleEl) titleEl.textContent = '미설정';
      if (descEl) descEl.textContent = '배정된 미션 정보를 불러오지 못했습니다.';
      if (condEl) condEl.hidden = true;
      return;
    }

    if (wrap) wrap.classList.add('is-mission-assigned');

    if (titleEl) titleEl.textContent = mission.title || '미설정';
    if (descEl) descEl.textContent = mission.description || '';
    if (condEl) {
      if (mission.conditions) {
        condEl.textContent = `적용 조건: ${mission.conditions}`;
        condEl.hidden = false;
      } else {
        condEl.hidden = true;
      }
    }
  }

  async function renderRiderMission(driver) {
    const baeminMissionId = String(driver?.selectedMissionIdBaemin || '').trim();
    const coupangMissionId = String(driver?.selectedMissionIdCoupang || '').trim();

    let assigned = null;
    if (BremStorage.getSupabaseConfig?.().mode === 'production') {
      const result = await BremStorage.fetchRiderAssignedMissionsFromServer?.().catch(() => null);
      if (result?.ok) {
        assigned = result.missions || null;
      }
    }

    await renderPlatformMission(driver, 'baemin', baeminMissionId, assigned?.baemin || null);
    await renderPlatformMission(driver, 'coupang', coupangMissionId, assigned?.coupang || null);
  }

  function formatLiveOpsUpdatedAt(value) {
    const raw = String(value || '').trim();
    if (!raw) return '-';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${mm}. ${dd}. ${hh}:${mi}:${ss}`;
  }

  function pickLiveOpsDisplayTime(ops) {
    // 폴링 직후 cachedAt(클라이언트 조회시각)을 우선 — Supabase 반영 조회가 돌고 있음을 체감
    const candidates = [ops?.cachedAt, ops?.updatedAt, ops?.collectedAt]
      .map(value => {
        const ts = Date.parse(String(value || ''));
        return Number.isFinite(ts) ? { value, ts } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.ts - a.ts);
    return candidates[0]?.value || new Date().toISOString();
  }

  function driverHasBaemin(driver) {
    if (!driver) return false;
    if (driver.platformBaemin === true) return true;
    if (String(driver.baeminId || '').trim()) return true;
    const label = formatPlatformLabel(driver);
    return label.includes('배민');
  }

  function driverHasCoupang(driver) {
    if (!driver) return false;
    if (driver.platformCoupang === true) return true;
    if (String(driver.coupangId || '').trim()) return true;
    const label = formatPlatformLabel(driver);
    return label.includes('쿠팡');
  }

  function renderBaeminLiveOps(driver) {
    const card = document.getElementById('driverBaeminLiveOps');
    if (!card) return;

    const show = driverHasBaemin(driver);
    card.hidden = !show;
    if (!show) {
      stopBaeminLiveOpsPolling();
      return;
    }

    const ops = BremStorage.getRiderBaeminOps?.() || null;
    const emptyEl = document.getElementById('driverBaeminLiveOpsEmpty');
    const available = Boolean(ops?.available);
    card.classList.toggle('is-empty', !available);
    if (emptyEl) emptyEl.hidden = available;

    const callText = value => (
      available ? `${number(value)}콜` : '-'
    );
    setText('baeminOpsComplete', callText(ops?.complete));
    setText('baeminOpsReject', callText(ops?.foodReject));
    setText('baeminOpsCancel', callText(ops?.foodCancel));
    setText('baeminOpsRiderFault', callText(ops?.foodRiderFault));
    setText(
      'baeminOpsAcceptRate',
      available && ops?.acceptRate != null && Number.isFinite(Number(ops.acceptRate))
        ? `${Number(ops.acceptRate)}%`
        : '-'
    );
    setText(
      'driverBaeminLiveOpsUpdated',
      `마지막 업데이트: ${formatLiveOpsUpdatedAt(pickLiveOpsDisplayTime(ops))}`
    );
    syncBaeminLiveOpsPolling(driver);
  }

  function stopBaeminLiveOpsPolling() {
    if (baeminLiveOpsPollTimer) {
      window.clearInterval(baeminLiveOpsPollTimer);
      baeminLiveOpsPollTimer = null;
    }
  }

  function syncBaeminLiveOpsPolling(driver) {
    const card = document.getElementById('driverBaeminLiveOps');
    const shouldPoll = Boolean(driverHasBaemin(driver) && card && !card.hidden);
    if (!shouldPoll) {
      stopBaeminLiveOpsPolling();
      return;
    }
    if (baeminLiveOpsPollTimer) return;
    baeminLiveOpsPollTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const liveCard = document.getElementById('driverBaeminLiveOps');
      if (!liveCard || liveCard.hidden) {
        stopBaeminLiveOpsPolling();
        return;
      }
      void refreshBaeminLiveOps({ toast: false, source: 'poll' });
    }, BAEMIN_LIVE_OPS_POLL_MS);
  }

  async function refreshBaeminLiveOps(options = {}) {
    const btn = document.getElementById('driverBaeminLiveOpsRefreshBtn');
    const fromPoll = options.source === 'poll';
    if (btn && !fromPoll) {
      btn.disabled = true;
      btn.innerHTML = '업데이트 중…';
    }
    try {
      if (!BremStorage.refreshRiderBaeminOps) {
        throw new Error('실시간 갱신 API를 사용할 수 없습니다.');
      }
      const result = await BremStorage.refreshRiderBaeminOps();
      if (!result?.ok) {
        throw new Error(result?.message || result?.error || '운행현황 갱신에 실패했습니다.');
      }
      if (state.currentDriver) renderBaeminLiveOps(state.currentDriver);
      else {
        // 폴링 성공 시 조회시각만이라도 갱신
        const ops = BremStorage.getRiderBaeminOps?.();
        setText(
          'driverBaeminLiveOpsUpdated',
          `마지막 업데이트: ${formatLiveOpsUpdatedAt(pickLiveOpsDisplayTime(ops))}`
        );
      }
      if (options.toast !== false) {
        const ops = BremStorage.getRiderBaeminOps?.();
        showToast(ops?.available ? '배민 운행현황을 갱신했습니다.' : '배민 운행현황 데이터가 없습니다.');
      }
      return result;
    } catch (error) {
      if (options.toast !== false) {
        showToast(error.message || '운행현황 갱신에 실패했습니다.');
      } else if (fromPoll) {
        console.warn('[BREM] baemin live ops poll failed:', error?.message || error);
      }
      return null;
    } finally {
      if (btn && !fromPoll) {
        btn.disabled = false;
        btn.innerHTML = '<span aria-hidden="true">↻</span> 실시간 업데이트';
      }
    }
  }

  function renderCoupangLiveOps(driver) {
    const card = document.getElementById('driverCoupangLiveOps');
    if (!card) return;

    const show = driverHasCoupang(driver);
    card.hidden = !show;
    if (!show) {
      stopCoupangLiveOpsPolling();
      return;
    }

    const ops = BremStorage.getRiderCoupangOps?.() || null;
    const emptyEl = document.getElementById('driverCoupangLiveOpsEmpty');
    const available = Boolean(ops?.available);
    card.classList.toggle('is-empty', !available);
    if (emptyEl) emptyEl.hidden = available;

    const callText = value => (
      available ? `${number(value)}콜` : '-'
    );
    setText('coupangOpsComplete', callText(ops?.complete));
    setText('coupangOpsReject', callText(ops?.reject));
    setText('coupangOpsCancel', callText(ops?.cancel));
    setText('coupangOpsPastComplete', callText(ops?.pastComplete));
    setText(
      'coupangOpsRejectRate',
      available && ops?.rejectionRate != null && Number.isFinite(Number(ops.rejectionRate))
        ? `${Number(ops.rejectionRate)}%`
        : '-'
    );
    setText(
      'driverCoupangLiveOpsUpdated',
      `마지막 업데이트: ${formatLiveOpsUpdatedAt(pickLiveOpsDisplayTime(ops))}`
    );
    syncCoupangLiveOpsPolling(driver);
  }

  function stopCoupangLiveOpsPolling() {
    if (coupangLiveOpsPollTimer) {
      window.clearInterval(coupangLiveOpsPollTimer);
      coupangLiveOpsPollTimer = null;
    }
  }

  function syncCoupangLiveOpsPolling(driver) {
    const card = document.getElementById('driverCoupangLiveOps');
    const shouldPoll = Boolean(driverHasCoupang(driver) && card && !card.hidden);
    if (!shouldPoll) {
      stopCoupangLiveOpsPolling();
      return;
    }
    if (coupangLiveOpsPollTimer) return;
    coupangLiveOpsPollTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const liveCard = document.getElementById('driverCoupangLiveOps');
      if (!liveCard || liveCard.hidden) {
        stopCoupangLiveOpsPolling();
        return;
      }
      void refreshCoupangLiveOps({ toast: false, source: 'poll' });
    }, COUPANG_LIVE_OPS_POLL_MS);
  }

  async function refreshCoupangLiveOps(options = {}) {
    const btn = document.getElementById('driverCoupangLiveOpsRefreshBtn');
    const fromPoll = options.source === 'poll';
    if (btn && !fromPoll) {
      btn.disabled = true;
      btn.innerHTML = '업데이트 중…';
    }
    try {
      if (!BremStorage.refreshRiderCoupangOps) {
        throw new Error('실시간 갱신 API를 사용할 수 없습니다.');
      }
      const result = await BremStorage.refreshRiderCoupangOps();
      if (!result?.ok) {
        throw new Error(result?.message || result?.error || '쿠팡 운행현황 갱신에 실패했습니다.');
      }
      if (state.currentDriver) {
        renderCoupangLiveOps(state.currentDriver);
        if (driverHasBaemin(state.currentDriver)) renderBaeminLiveOps(state.currentDriver);
      } else {
        const ops = BremStorage.getRiderCoupangOps?.();
        setText(
          'driverCoupangLiveOpsUpdated',
          `마지막 업데이트: ${formatLiveOpsUpdatedAt(pickLiveOpsDisplayTime(ops))}`
        );
      }
      if (options.toast !== false) {
        const ops = BremStorage.getRiderCoupangOps?.();
        showToast(ops?.available ? '쿠팡 운행현황을 갱신했습니다.' : '쿠팡 운행현황 데이터가 없습니다.');
      }
      return result;
    } catch (error) {
      if (options.toast !== false) {
        showToast(error.message || '쿠팡 운행현황 갱신에 실패했습니다.');
      } else if (fromPoll) {
        console.warn('[BREM] coupang live ops poll failed:', error?.message || error);
      }
      return null;
    } finally {
      if (btn && !fromPoll) {
        btn.disabled = false;
        btn.innerHTML = '<span aria-hidden="true">↻</span> 실시간 업데이트';
      }
    }
  }

  function renderDriver(driver) {
    if (driver?.id) {
      driver = BremStorage.drivers.getById(driver.id) || driver;
      state.currentDriver = driver;
    }
    applySensitiveFieldUi(driver);
    renderRiderPublishNotice();
    void renderRiderMission(driver);

    const month = currentMonth();
    const monthStats = monthCallsByPlatform(driver.id, month);
    const weekStats = weeklyCallsByPlatform(driver.id);
    const currentMonthCalls = monthStats.total;
    const target = targetFor(driver.id, month);
    const rate = target ? Math.round((currentMonthCalls / target) * 100) : 0;
    const weekStart = state.selectedWeekStart || weekStartKey();
    const currentWeekCalls = weekStats.total;
    const weeklyTarget = weeklyTargetFor(driver.id, weekStart);
    const weeklyRate = weeklyTarget ? Math.round((currentWeekCalls / weeklyTarget) * 100) : 0;
    const weeklyRejectionCoupang = weeklyRateForPlatform(driver.id, weekStart, 'coupang');
    const weeklyAcceptanceBaemin = weeklyRateForPlatform(driver.id, weekStart, 'baemin');
    const coupangRateEntry = weeklyEntryForPlatform(driver.id, weekStart, 'coupang');
    const baeminRateEntry = weeklyEntryForPlatform(driver.id, weekStart, 'baemin');
    const item = eventItemFor(driver);
    const eventProgress = BremStorage.events.getProgressForDriver(driver);
    const isEventUnset = eventProgress.status === 'unset'
      || (!String(eventProgress.itemId || '').trim()
        && !String(eventProgress.itemName || '').trim()
        && !String(driver.longEventItemId || '').trim()
        && !String(driver.longEventItem || '').trim());
    const eventItem = isEventUnset ? null : (eventProgress.item || item);
    const longEventPanel = document.getElementById('riderLongEventPanel');
    if (longEventPanel) {
      longEventPanel.hidden = false;
    }

    const eventStartDate = eventProgress.startDate || driver.longEventStartDate || '';
    const total = eventStartDate ? Number(eventProgress.total) || 0 : 0;
    const missionTarget = Number(eventProgress.target) || (eventItem ? Number(eventItem.targetCount || 0) : 0);
    const missionRate = missionTarget
      ? Number(eventProgress.rate) || Math.round((total / missionTarget) * 100)
      : 0;
    const eventPlatformLabel = longEventPlatformLabel(eventProgress.platform || driver.longEventPlatform);

    setText('driverName', driver.name);
    setText('driverPhone', driver.phone);
    setText('driverJoinDate', formatDate(driver.joinDate));
    setText('driverPlatform', formatPlatformLabel(driver));
    setText('driverAccount', formatAccountLabel(driver));

    const platformEl = document.getElementById('driverPlatform');
    if (platformEl) {
      platformEl.className = 'platform-badge';
      const label = formatPlatformLabel(driver);
      if (label.includes('배민')) platformEl.classList.add('platform-badge--baemin');
      if (label.includes('쿠팡')) platformEl.classList.add('platform-badge--coupang');
    }

    setText('monthCallsCoupang', `${number(monthStats.coupang)}콜`);
    setText('monthCallsBaemin', `${number(monthStats.baemin)}콜`);
    renderBaeminLiveOps(driver);
    renderCoupangLiveOps(driver);

    const monthTargetEl = document.getElementById('monthTarget');
    if (monthTargetEl) {
      monthTargetEl.textContent = target ? `${number(target)}콜` : '클릭해서 설정';
      monthTargetEl.classList.toggle('summary-card__value--unset', !target);
    }

    const weekTargetEl = document.getElementById('weekTarget');
    if (weekTargetEl) {
      weekTargetEl.textContent = weeklyTarget ? `${number(weeklyTarget)}콜` : '클릭해서 설정';
      weekTargetEl.classList.toggle('summary-card__value--unset', !weeklyTarget);
    }

    setText('monthAchievementRate', target ? `${rate}%` : '-');
    setText('weekCallsCoupang', `${number(weekStats.coupang)}콜`);
    setText('weekCallsBaemin', `${number(weekStats.baemin)}콜`);
    setText('weeklyAchievementRate', weeklyTarget ? `${weeklyRate}%` : '-');
    setText('weeklyRejectionRateCoupang', weeklyRejectionCoupang === null ? '-' : formatPercent(weeklyRejectionCoupang));
    setText('weeklyAcceptanceRateBaemin', weeklyAcceptanceBaemin === null ? '-' : formatPercent(weeklyAcceptanceBaemin));
    renderRateDetail('baemin', baeminRateEntry);
    renderRateDetail('coupang', coupangRateEntry);

    document.getElementById('driverTargetMonth').value = month;
    driverTargetMonthPicker?.setMonth(month);
    updateDriverTargetMonthLabel();
    document.getElementById('driverMonthTargetCount').value = target || '';
    updateWeekTargetPreview(weekStart);
    document.getElementById('driverWeekTargetCount').value = weeklyTarget || '';

    setText('eventItem', eventItem ? eventItem.name : '미선택');
    setText(
      'missionDetail',
      isEventUnset
        ? '미선택'
        : !eventStartDate
          ? '관리자에서 시작일 설정 후 집계됩니다.'
          : `${number(total)} / ${number(missionTarget)}콜 · ${missionRate}%`
    );
    setText(
      'missionRule',
      isEventUnset
        ? '장기근속이벤트가 배정되면 진행률이 표시됩니다.'
        : eventItem && eventStartDate
          ? `${eventItem.name} · ${formatDate(eventStartDate)}부터 ${eventPlatformLabel} 집계${['both', 'combined', 'all'].includes(String(eventProgress.platform || driver.longEventPlatform || '').toLowerCase()) ? ' (합산)' : ''}`
          : eventItem
            ? `${eventItem.name} · 시작일 설정 필요`
            : '누적 콜수 기준으로 계산됩니다.'
    );
    setProgress('missionBar', isEventUnset ? 0 : missionRate);

    renderDailyCalls(driver.id);
    void renderNotices();

    result.hidden = false;
  }

  document.getElementById('driverProfileEditToggle')?.addEventListener('click', () => {
    toggleProfileEditPanel(true);
  });

  document.getElementById('driverBaeminLiveOpsRefreshBtn')?.addEventListener('click', () => {
    void refreshBaeminLiveOps({ toast: true });
  });
  document.getElementById('driverCoupangLiveOpsRefreshBtn')?.addEventListener('click', () => {
    void refreshCoupangLiveOps({ toast: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const driver = state.currentDriver;
    if (!driver) return;
    const baeminCard = document.getElementById('driverBaeminLiveOps');
    if (baeminCard && !baeminCard.hidden && driverHasBaemin(driver)) {
      syncBaeminLiveOpsPolling(driver);
      void refreshBaeminLiveOps({ toast: false, source: 'visible' });
    }
    const coupangCard = document.getElementById('driverCoupangLiveOps');
    if (coupangCard && !coupangCard.hidden && driverHasCoupang(driver)) {
      syncCoupangLiveOpsPolling(driver);
      void refreshCoupangLiveOps({ toast: false, source: 'visible' });
    }
  });

  document.getElementById('driverProfileEditCancel')?.addEventListener('click', () => {
    toggleProfileEditPanel(false);
  });

  document.getElementById('driverProfileEditHeaderClose')?.addEventListener('click', () => {
    toggleProfileEditPanel(false);
  });

  document.getElementById('driverProfileEditForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const driver = refreshCurrentDriver();
    if (!driver) return;

    const residentHidden = BremDriverUtils.isDriverFieldHidden(driver, 'residentNumber');
    const accountHidden = BremDriverUtils.isDriverFieldHidden(driver, 'accountNumber');

    const changes = {
      bankName: document.getElementById('driverEditBankName').value.trim(),
      accountHolder: document.getElementById('driverEditAccountHolder').value.trim()
    };

    if (!residentHidden) {
      const residentRaw = document.getElementById('driverEditResidentNumber').value;
      const residentNumber = String(residentRaw || '').replace(/[^0-9]/g, '');
      if (residentNumber && residentNumber.length !== 13) {
        showToast('주민등록번호는 13자리로 입력하세요.');
        return;
      }
      changes.residentNumber = residentNumber;
    }

    if (!accountHidden) {
      changes.accountNumber = document.getElementById('driverEditAccountNumber').value.trim();
    }

    const currentPassword = normalizePassword(document.getElementById('driverEditCurrentPassword').value);
    const newPassword = normalizePassword(document.getElementById('driverEditNewPassword').value);
    const confirmPassword = normalizePassword(document.getElementById('driverEditConfirmPassword').value);

    const wantsPasswordChange = Boolean(newPassword || confirmPassword || currentPassword);
    if (wantsPasswordChange) {
      if (window.BremDriverUtils?.verifyDriverLoginSecret) {
        const verify = BremDriverUtils.verifyDriverLoginSecret(driver, currentPassword);
        if (!verify.ok) {
          showToast(verify.reason || '현재 비밀번호가 일치하지 않습니다.');
          return;
        }
      } else if (!currentPassword) {
        showToast('현재 비밀번호를 입력하세요.');
        return;
      }
      if (!newPassword || newPassword.length < 4) {
        showToast('새 비밀번호는 4자 이상 입력하세요.');
        return;
      }
      if (newPassword !== confirmPassword) {
        showToast('새 비밀번호 확인이 일치하지 않습니다.');
        return;
      }
      changes.currentPassword = currentPassword;
      changes.newPassword = newPassword;
    }

    const submitBtns = [
      event.submitter,
      document.getElementById('driverProfileEditHeaderSave'),
      document.querySelector('#driverProfileEditForm [type="submit"]')
    ].filter(Boolean);
    submitBtns.forEach(btn => { btn.disabled = true; });
    try {
      await BremStorage.drivers.update(driver.id, changes);
      state.currentDriver = BremStorage.drivers.getById(driver.id);
      toggleProfileEditPanel(false);
      renderDriver(state.currentDriver);
      showToast('기사 정보가 저장되었습니다.');
    } catch (error) {
      showToast(error.message || '기사 정보 저장에 실패했습니다.');
    } finally {
      submitBtns.forEach(btn => { btn.disabled = false; });
    }
  });

  document.getElementById('driverEditResidentNumber')?.addEventListener('input', event => {
    if (event.target.disabled) return;
    if (!window.BremDriverUtils?.formatResidentNumber) return;
    event.target.value = BremDriverUtils.formatResidentNumber(event.target.value);
  });

  async function resolveCurrentDriver(isProduction, loginResult) {
    if (!isProduction) {
      return loginResult.driver || null;
    }

    if (loginResult?.driver) {
      return loginResult.driver;
    }

    const riderId = loginResult?.riderId || BremStorage.auth.getDriverSessionId();
    const cached = riderId ? BremStorage.drivers.getById(riderId) : null;
    if (cached) return cached;

    const fetched = await BremStorage.fetchCurrentRiderFromServer?.();
    if (fetched?.ok && fetched.driver) {
      return fetched.driver;
    }

    return null;
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const submitBtn = loginForm.querySelector('.login-submit');
    const originalLabel = submitBtn?.textContent || '로그인';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '로그인 중…';
    }

    try {
      const isProduction = BremStorage.getSupabaseConfig?.().mode === 'production';

      const loginResult = isProduction
        ? await BremStorage.auth.signInDriver(loginIdInput.value, loginPasswordInput.value)
        : findDriverByLogin(loginIdInput.value, loginPasswordInput.value);

      if (!loginResult.ok) {
        BremStorage.auth.setDriverSessionId(null);
        showLoggedOut();
        showToast(loginResult.reason || loginResult.message || '로그인에 실패했습니다.');
        return;
      }

      let driver = loginResult.driver || null;
      if (!driver && loginResult.riderId) {
        driver = BremStorage.drivers.getById(loginResult.riderId);
      }
      if (!driver && isProduction) {
        driver = await resolveCurrentDriver(isProduction, loginResult);
      }

      if (!driver) {
        showLoggedOut();
        showToast('기사 데이터를 찾을 수 없습니다. 관리자에게 문의하세요.');
        return;
      }

      BremStorage.auth.setDriverSessionId(driver.id);
      // 로그아웃을 거치지 않고 계정이 바뀌는 경우(세션 만료 후 재로그인 등)에도
      // 이전 기사 잔상이 남지 않도록 로그인 시점에 한 번 더 비운다.
      window.BremDriverWithdrawal?.reset?.();
      window.BremDriverWeeklyPayslip?.reset?.();
      window.BremDriverRegionDashboard?.reset?.();
      window.BremDriverCrewLeader?.reset?.();
      window.BremDriverUrgentMissions?.reset?.();
      window.BremLoginPrefs?.captureLoginPrefs?.('rider', {
        idInput: loginIdInput,
        rememberCheckbox: document.getElementById('driverRememberId'),
        keepCheckbox: document.getElementById('driverKeepLoggedIn')
      });
      loginPasswordInput.value = '';
      if (window.BremLoginPrefs?.getRememberedId?.('rider')) {
        loginIdInput.value = window.BremLoginPrefs.getRememberedId('rider');
      }
      showLoggedIn(driver);
      showToast(`${driver.name} 기사님 로그인 성공`);
      void loadDriverAppDataThenRender(driver, { refreshProfile: false });
      void window.BremDriverCrewLeader?.refreshEntryVisibility?.();
      void window.BremDriverRegionDashboard?.refreshEntryVisibility?.();
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    }
  });

  logoutBtn.addEventListener('click', () => {
    stopRiderPublishPolling();
    logoutDriver();
  });

  document.getElementById('monthTargetForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!state.currentDriver) return;
    const month = document.getElementById('driverTargetMonth').value;
    if (!month) {
      showToast('적용 월을 선택하세요.');
      return;
    }
    const submitBtn = event.submitter || event.target.querySelector('[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '저장 중…';
    }

    void window.BremPerf.runSave('driver.monthTarget', {
      write: () => saveMonthlyTarget(
        state.currentDriver.id,
        month,
        document.getElementById('driverMonthTargetCount').value
      ),
      render: () => {
        renderDriver(state.currentDriver);
        closeTargetModal();
      }
    })
      .then(() => {
        showToast('월 목표 콜수가 저장되었습니다.');
      })
      .catch(error => {
        showToast(error.message || '월 목표 저장에 실패했습니다.');
      })
      .finally(() => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '저장';
        }
      });
  });

  document.getElementById('weekTargetForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!state.currentDriver) return;
    const weekDate = document.getElementById('driverTargetWeekDate').value;
    if (!weekDate) {
      showToast('적용주 수요일을 선택하세요.');
      return;
    }
    const weekStart = weekStartKey(weekDate);
    state.selectedWeekStart = weekStart;
    const submitBtn = event.submitter || event.target.querySelector('[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '저장 중…';
    }

    void window.BremPerf.runSave('driver.weekTarget', {
      write: () => saveWeeklyTarget(
        state.currentDriver.id,
        weekStart,
        document.getElementById('driverWeekTargetCount').value
      ),
      render: () => {
        renderDriver(state.currentDriver);
        closeTargetModal();
      }
    })
      .then(() => {
        showToast('주 목표 콜수가 저장되었습니다.');
      })
      .catch(error => {
        showToast(error.message || '주 목표 저장에 실패했습니다.');
      })
      .finally(() => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '저장';
        }
      });
  });

  document.getElementById('monthTargetCard')?.addEventListener('click', () => openTargetModal('month'));
  document.getElementById('weekTargetCard')?.addEventListener('click', () => openTargetModal('week'));
  document.getElementById('weeklyAcceptanceRateBaeminCard')?.addEventListener('click', () => {
    toggleRateDetailPanel('weeklyAcceptanceRateBaeminDetail', 'weeklyAcceptanceRateBaeminCard');
  });
  document.getElementById('weeklyRejectionRateCoupangCard')?.addEventListener('click', () => {
    toggleRateDetailPanel('weeklyRejectionRateCoupangDetail', 'weeklyRejectionRateCoupangCard');
  });
  document.querySelectorAll('[data-close-driver-target]').forEach(el => {
    el.addEventListener('click', closeTargetModal);
  });

  document.getElementById('prevWeekBtn').addEventListener('click', () => shiftSelectedWeek(-7));
  document.getElementById('nextWeekBtn').addEventListener('click', () => shiftSelectedWeek(7));

  document.getElementById('riderPublishRefreshBtn')?.addEventListener('click', () => {
    void checkDriverPublishUpdateIfNeeded({ force: true, toast: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    window.clearTimeout(riderPublishVisibilityTimer);
    riderPublishVisibilityTimer = window.setTimeout(() => {
      void checkDriverPublishUpdateIfNeeded();
    }, 800);
  });

  document.addEventListener('brem-driver-data-ready', () => {
    invalidateDriverCallIndex();
    if (state.currentDriver) {
      refreshDriverDashboard(state.currentDriver);
    }
  });

  document.addEventListener('brem-cache-status-changed', () => {
    if (state.currentDriver) renderNotices();
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('#driverNoticePopupHideToday')) {
      if (noticePopupState.currentId) {
        hideNoticePopupToday(noticePopupState.currentId);
        markNoticeRead(noticePopupState.currentId);
      }
      showNextNoticePopup();
      return;
    }
    if (event.target.closest('[data-notice-popup-close]')) {
      if (noticePopupState.currentId) markNoticeRead(noticePopupState.currentId);
      hideNoticePopup();
      return;
    }

    const toggle = event.target.closest('#noticeList .notice-item__toggle');
    if (!toggle) return;
    event.preventDefault();
    const item = toggle.closest('.notice-item');
    const noticeId = String(item?.dataset.noticeId || '');
    const notice = mergedNoticesForDriver().find(entry => String(entry.id || '') === noticeId);
    if (!notice) return;
    openNoticeId = noticeId;
    openNoticePopup(notice, { fromList: true });
  });

  document.addEventListener('DOMContentLoaded', async () => {
    setupDriverTargetMonthPicker();
    setupDriverWeekPicker();
    state.selectedWeekStart = weekStartKey();
    consumeLogoutNotice();

    window.BremLoginPrefs?.applyLoginForm?.('rider', {
      idInput: loginIdInput,
      rememberCheckbox: document.getElementById('driverRememberId'),
      keepCheckbox: document.getElementById('driverKeepLoggedIn')
    });

    const isProduction = BremStorage.getSupabaseConfig?.().mode === 'production';
    if (isProduction) {
      try {
        await Promise.all([
          window.BremSupabaseConfig?.load?.() || Promise.resolve(),
          BremStorage.waitForStorageBootstrap?.() || Promise.resolve()
        ]);
      } catch {
        showLoggedOut();
        return;
      }
    }

    if (!window.BREM_IS_NATIVE_APP
      && window.BremSessionSecurity?.isIdleExpired?.()
      && (BremStorage.auth.isDriverLoggedIn?.() || BremStorage.auth.getDriverSessionId())) {
      await logoutDriver({ idle: true });
      return;
    }

    if (!enforceDriverRouteAccess()) return;

    const driverSessionId = BremStorage.auth.getDriverSessionId();
    let savedDriver = null;

    if (driverSessionId || BremStorage.auth.isDriverLoggedIn?.()) {
      if (isProduction) {
        savedDriver = findDriverById(driverSessionId);
      } else {
        savedDriver = findDriverById(driverSessionId);
      }
    }

    if (savedDriver) {
      showLoggedIn(savedDriver);
      startRiderPublishPolling();
      void loadDriverAppDataThenRender(savedDriver, { refreshProfile: false });
    } else if (isProduction && (driverSessionId || BremStorage.auth.isDriverLoggedIn?.())) {
      showLoggedIn({ id: driverSessionId, name: '기사', phone: '' });
      startRiderPublishPolling();
      void loadDriverAppDataThenRender({ id: driverSessionId }, { refreshProfile: false })
        .then(result => {
          const rider = result?.rider || BremStorage.drivers.getById(driverSessionId);
          if (rider) {
            BremStorage.auth.setDriverSessionId(rider.id);
            showLoggedIn(rider);
          } else if (result?.allFailed) {
            showToast('데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.');
          }
        });
    } else {
      if (driverSessionId) {
        BremStorage.auth.setDriverSessionId(null);
      }
      showLoggedOut();
    }
  });
})();
