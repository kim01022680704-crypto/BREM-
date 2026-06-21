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

  function calls() {
    return BremStorage.calls.getAll();
  }

  function notices() {
    return BremStorage.notices.getAll();
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

  function renderRiderPublishNotice() {
    const notice = document.getElementById('riderPublishNotice');
    const label = document.getElementById('riderPublishAt');
    if (!notice || !label) return;

    const meta = BremStorage.riderViewPublish?.getMeta?.() || {};
    let publishedAt = meta.publishedAt || null;
    if (!publishedAt) {
      publishedAt = BremStorage.rejections?.getAll?.()
        .map(entry => entry.riderPublishedAt)
        .filter(Boolean)
        .sort()
        .reverse()[0] || null;
    }

    const text = window.BremDriverUtils?.formatRiderPublishDateTime?.(publishedAt) || '';
    if (!text) {
      notice.hidden = true;
      label.textContent = '-';
      return;
    }
    notice.hidden = false;
    label.textContent = text;
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

  function renderRateDetail(platform, entry) {
    const stats = entry?.stats && typeof entry.stats === 'object' ? entry.stats : {};
    const unmeasured = stats.unmeasured === true || entry?.rate == null;
    const empty = '-';
    const countLabel = value => (entry ? `${number(value)}건` : empty);

    if (platform === 'baemin') {
      setText('baeminRateComplete', entry ? countLabel(stats.completeTotal || 0) : empty);
      setText('baeminRateReject', entry ? countLabel(stats.rejectCount || 0) : empty);
      setText('baeminRateDispatchCancel', entry ? countLabel(stats.dispatchCancelCount || 0) : empty);
      setText('baeminRateRiderCancel', entry ? countLabel(stats.riderCancelCount || 0) : empty);
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
    window.BremSessionSecurity?.stop();

    if (BremStorage.getSupabaseConfig?.().mode === 'production') {
      await BremStorage.auth.signOutSupabase();
    } else {
      BremStorage.auth.setDriverSessionId(null);
      BremStorage.auth.clearSessionAuth?.();
    }

    state.currentDriver = null;
    state.selectedWeekStart = weekStartKey();
    showLoggedOut();
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
    window.BremSessionSecurity?.stop();
    loginCard.hidden = false;
    if (mainApp) mainApp.hidden = true;
    result.hidden = true;
    toggleProfileEditPanel(false);
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
    renderDriver(driver);
    startDriverSessionSecurity();
    window.BremSessionSecurity?.touchActivity?.();
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
    const task = (async () => {
      let freshDriver = driver;
      if (options.refreshProfile !== false) {
        freshDriver = await refreshCurrentRiderFromServer(driver) || driver;
      }
      await BremStorage.hydrateDriverAppData?.({
        force: BremStorage.getSupabaseConfig?.().mode === 'production'
      });
      refreshDriverDashboard(BremStorage.drivers.getById(driverId) || freshDriver);
    })();

    driverDataLoadPromise = task.finally(() => {
      driverDataLoadPromise = null;
    });

    return driverDataLoadPromise.catch(error => {
      console.warn('[BREM] Driver app data hydrate failed:', error.message || error);
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
    return String(platform || '').toLowerCase() === 'baemin' ? '배민' : '쿠팡';
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
      const pinDiff = Number(b.pinned) - Number(a.pinned);
      if (pinDiff) return pinDiff;
      const aDate = String(a.createdAt || a.updatedAt || '');
      const bDate = String(b.createdAt || b.updatedAt || '');
      return bDate.localeCompare(aDate);
    });
  }

  function renderNoticesList(listEl, noticeList) {
    const items = noticeList
      .map(notice => `
        <article class="notice-item">
          <h3>${notice.pinned ? '📌 ' : ''}${escapeHtml(notice.title)}</h3>
          <p>${escapeHtml(notice.content)}</p>
        </article>
      `)
      .join('');

    listEl.innerHTML = items || '<div class="empty-text">등록된 공지사항이 없습니다.</div>';
  }

  async function renderNotices() {
    const listEl = document.getElementById('noticeList');
    if (!listEl) return;

    const isProduction = BremStorage.getSupabaseConfig?.().mode === 'production';

    if (isProduction && state.currentDriver) {
      listEl.innerHTML = '<div class="empty-text">공지사항 불러오는 중...</div>';
      const result = await BremStorage.fetchRiderNoticesFromServer?.().catch(error => ({
        ok: false,
        message: error.message || String(error)
      }));
      if (!result?.ok) {
        console.warn('[BREM] Rider notices render fetch failed:', result?.message || result?.error);
        listEl.innerHTML = '<div class="empty-text">등록된 공지사항이 없습니다.</div>';
        return;
      }
    }

    renderNoticesList(listEl, sortNotices(notices()));
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
      if (titleEl) titleEl.textContent = '미설정';
      if (descEl) descEl.textContent = '관리자가 미션을 배정하면 설명이 표시됩니다.';
      if (condEl) condEl.hidden = true;
      return;
    }

    let mission = assignedMission || BremStorage.missions?.getById?.(id) || null;
    if (!mission) {
      try {
        await BremStorage.ensureMissionsLoaded?.();
        mission = await BremStorage.missions?.fetchById?.(id) || mission;
      } catch (error) {
        console.warn('[BREM] Mission fetch failed:', error.message || error);
      }
    }

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
    const baeminMissionId = driver?.selectedMissionIdBaemin || driver?.selectedMissionId || '';
    const coupangMissionId = driver?.selectedMissionIdCoupang || driver?.selectedMissionId || '';

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
    const eventItem = eventProgress.item || item;
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

    setText('eventItem', eventItem ? eventItem.name : '미설정');
    setText(
      'missionDetail',
      !eventItem
        ? '장기근속이벤트 아이템이 설정되면 표시됩니다.'
        : !eventStartDate
          ? '관리자에서 시작일 설정 후 집계됩니다.'
          : `${number(total)} / ${number(missionTarget)}콜 · ${missionRate}%`
    );
    setText(
      'missionRule',
      eventItem && eventStartDate
        ? `${eventItem.name} · ${formatDate(eventStartDate)}부터 ${eventPlatformLabel} 집계 (합산 제외)`
        : eventItem
          ? `${eventItem.name} · 시작일 설정 필요`
          : '누적 콜수 기준으로 계산됩니다.'
    );
    setProgress('missionBar', missionRate);

    renderDailyCalls(driver.id);
    void renderNotices();

    result.hidden = false;
  }

  document.getElementById('driverProfileEditToggle')?.addEventListener('click', () => {
    toggleProfileEditPanel(true);
  });

  document.getElementById('driverProfileEditCancel')?.addEventListener('click', () => {
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

    const submitBtn = event.submitter || event.target.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      await BremStorage.drivers.update(driver.id, changes);
      state.currentDriver = BremStorage.drivers.getById(driver.id);
      toggleProfileEditPanel(false);
      renderDriver(state.currentDriver);
      showToast('기사 정보가 저장되었습니다.');
    } catch (error) {
      showToast(error.message || '기사 정보 저장에 실패했습니다.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
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
      loginForm.reset();
      showLoggedIn(driver);
      showToast(`${driver.name} 기사님 로그인 성공`);
      void loadDriverAppDataThenRender(driver, { refreshProfile: false });
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    }
  });

  logoutBtn.addEventListener('click', () => {
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

    void saveMonthlyTarget(
      state.currentDriver.id,
      month,
      document.getElementById('driverMonthTargetCount').value
    )
      .then(() => BremStorage.fetchRiderDashboardFromServer?.())
      .then(() => {
        showToast('월 목표 콜수가 저장되었습니다.');
        renderDriver(state.currentDriver);
        closeTargetModal();
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

    void saveWeeklyTarget(
      state.currentDriver.id,
      weekStart,
      document.getElementById('driverWeekTargetCount').value
    )
      .then(() => BremStorage.fetchRiderDashboardFromServer?.())
      .then(() => {
        showToast('주 목표 콜수가 저장되었습니다.');
        renderDriver(state.currentDriver);
        closeTargetModal();
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

  document.addEventListener('brem-driver-data-ready', () => {
    invalidateDriverCallIndex();
    if (state.currentDriver) {
      refreshDriverDashboard(state.currentDriver);
    }
  });

  document.addEventListener('brem-cache-status-changed', () => {
    const listEl = document.getElementById('noticeList');
    if (state.currentDriver && listEl) {
      renderNoticesList(listEl, sortNotices(notices()));
    }
  });

  document.addEventListener('DOMContentLoaded', async () => {
    setupDriverTargetMonthPicker();
    setupDriverWeekPicker();
    state.selectedWeekStart = weekStartKey();
    consumeLogoutNotice();

    const isProduction = BremStorage.getSupabaseConfig?.().mode === 'production';
    if (isProduction) {
      try {
        await window.BremSupabaseConfig?.load?.();
        await BremStorage.waitForStorageBootstrap?.();
        BremStorage.invalidateNoticesCache?.();
      } catch {
        showLoggedOut();
        return;
      }
    }

    if (window.BremSessionSecurity?.isIdleExpired?.()
      && (BremStorage.auth.isDriverLoggedIn?.() || BremStorage.auth.getDriverSessionId())) {
      await logoutDriver({ idle: true });
      return;
    }

    if (!enforceDriverRouteAccess()) return;

    const driverSessionId = BremStorage.auth.getDriverSessionId();
    let savedDriver = null;

    if (driverSessionId || BremStorage.auth.isDriverLoggedIn?.()) {
      if (isProduction) {
        await BremStorage.ensureDriverStorageReady?.();
        const fetched = await BremStorage.fetchCurrentRiderFromServer?.();
        if (fetched?.ok && fetched.driver) {
          savedDriver = fetched.driver;
        }
      }
      if (!savedDriver) {
        savedDriver = findDriverById(driverSessionId);
      }
    }

    if (savedDriver) {
      showLoggedIn(savedDriver);
      void loadDriverAppDataThenRender(savedDriver);
    } else {
      if (driverSessionId) {
        BremStorage.auth.setDriverSessionId(null);
      }
      showLoggedOut();
    }
  });
})();
