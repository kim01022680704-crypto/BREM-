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
    const rate = Number(value);
    if (Number.isNaN(rate)) return '-';
    return `${rate % 1 === 0 ? rate : rate.toFixed(1)}%`;
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
    if (!window.BremSessionSecurity?.start) return;
    window.BremSessionSecurity.start({
      isLoggedIn: () => BremStorage.auth.isDriverLoggedIn?.() || Boolean(BremStorage.auth.getDriverSessionId()),
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

  function driverCalls(driverId) {
    return calls().filter(call => call.driverId === driverId);
  }

  function weeklyRateForPlatform(driverId, weekStart, platform) {
    return BremStorage.rejections.getRateForWeek(driverId, weekStart, platform);
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

  function eventCallsFor(driver) {
    return BremStorage.events.eventCallsForDriver(driver);
  }

  function targetFor(driverId, month) {
    return BremStorage.targets.getMonthlyCount(driverId, month);
  }

  function weeklyTargetFor(driverId, weekStart) {
    return BremStorage.weeklyTargets.getCount(driverId, weekStart);
  }

  function saveMonthlyTarget(driverId, month, count) {
    BremStorage.targets.upsertMonthly({ driverId, month, count });
  }

  function saveWeeklyTarget(driverId, weekStart, count) {
    BremStorage.weeklyTargets.upsert({ driverId, weekStart, count });
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

  function renderNotices() {
    const items = notices()
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt))
      .map(notice => `
        <article class="notice-item">
          <h3>${notice.pinned ? '📌 ' : ''}${escapeHtml(notice.title)}</h3>
          <p>${escapeHtml(notice.content)}</p>
        </article>
      `)
      .join('');

    document.getElementById('noticeList').innerHTML = items || '<div class="empty-text">등록된 공지사항이 없습니다.</div>';
  }

  function renderDriver(driver) {
    if (driver?.id) {
      driver = BremStorage.drivers.getById(driver.id) || driver;
      state.currentDriver = driver;
    }
    applySensitiveFieldUi(driver);

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
    const item = eventItemFor(driver);
    const eventStartDate = driver.longEventStartDate || '';
    const total = eventStartDate ? eventCallsFor(driver) : 0;
    const missionTarget = item ? Number(item.targetCount || 0) : 0;
    const missionRate = missionTarget ? Math.round((total / missionTarget) * 100) : 0;

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

    document.getElementById('driverTargetMonth').value = month;
    driverTargetMonthPicker?.setMonth(month);
    updateDriverTargetMonthLabel();
    document.getElementById('driverMonthTargetCount').value = target || '';
    updateWeekTargetPreview(weekStart);
    document.getElementById('driverWeekTargetCount').value = weeklyTarget || '';

    setText('eventItem', item ? item.name : '미설정');
    setText(
      'missionDetail',
      !item
        ? '장기근속이벤트 아이템이 설정되면 표시됩니다.'
        : !eventStartDate
          ? '관리자에서 시작일 설정 후 집계됩니다.'
          : `${number(total)} / ${number(missionTarget)}콜 · ${missionRate}%`
    );
    setText(
      'missionRule',
      item && eventStartDate
        ? `${item.name} · ${formatDate(eventStartDate)}부터 누적 집계`
        : item
          ? `${item.name} · 시작일 설정 필요`
          : '누적 콜수 기준으로 계산됩니다.'
    );
    setProgress('missionBar', missionRate);

    renderDailyCalls(driver.id);
    renderNotices();

    result.hidden = false;
  }

  document.getElementById('driverProfileEditToggle')?.addEventListener('click', () => {
    toggleProfileEditPanel(true);
  });

  document.getElementById('driverProfileEditCancel')?.addEventListener('click', () => {
    toggleProfileEditPanel(false);
  });

  document.getElementById('driverProfileEditForm')?.addEventListener('submit', event => {
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
    const savedPassword = normalizePassword(driver.password);

    const wantsPasswordChange = Boolean(newPassword || confirmPassword || currentPassword);
    if (wantsPasswordChange) {
      if (!currentPassword || currentPassword !== savedPassword) {
        showToast('현재 비밀번호가 일치하지 않습니다.');
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
      changes.password = newPassword;
    }

    BremStorage.drivers.update(driver.id, changes);
    state.currentDriver = BremStorage.drivers.getById(driver.id);
    toggleProfileEditPanel(false);
    renderDriver(state.currentDriver);
    showToast('기사 정보가 저장되었습니다.');
  });

  document.getElementById('driverEditResidentNumber')?.addEventListener('input', event => {
    if (event.target.disabled) return;
    if (!window.BremDriverUtils?.formatResidentNumber) return;
    event.target.value = BremDriverUtils.formatResidentNumber(event.target.value);
  });

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
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

    if (isProduction) {
      const status = BremStorage.getStorageStatus?.() || {};
      if (!status.supabaseHydrated) {
        await BremStorage.initStorage({ backend: 'supabase' });
      }
    }

    const riderId = isProduction
      ? (loginResult.riderId || BremStorage.auth.getDriverSessionId())
      : loginResult.driver?.id;
    const driver = isProduction
      ? BremStorage.drivers.getById(riderId)
      : loginResult.driver;
    if (!driver) {
      showLoggedOut();
      showToast('기사 데이터를 찾을 수 없습니다. 관리자에게 문의하세요.');
      return;
    }
    BremStorage.auth.setDriverSessionId(driver.id);
    loginForm.reset();
    showLoggedIn(driver);
    showToast(`${driver.name} 기사님 로그인 성공`);
    window.BremSessionSecurity?.touchActivity?.();
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
    saveMonthlyTarget(
      state.currentDriver.id,
      month,
      document.getElementById('driverMonthTargetCount').value
    );
    showToast('월 목표 콜수가 저장되었습니다.');
    renderDriver(state.currentDriver);
    closeTargetModal();
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
    saveWeeklyTarget(
      state.currentDriver.id,
      weekStart,
      document.getElementById('driverWeekTargetCount').value
    );
    showToast('주 목표 콜수가 저장되었습니다.');
    renderDriver(state.currentDriver);
    closeTargetModal();
  });

  document.getElementById('monthTargetCard')?.addEventListener('click', () => openTargetModal('month'));
  document.getElementById('weekTargetCard')?.addEventListener('click', () => openTargetModal('week'));
  document.querySelectorAll('[data-close-driver-target]').forEach(el => {
    el.addEventListener('click', closeTargetModal);
  });

  document.getElementById('prevWeekBtn').addEventListener('click', () => shiftSelectedWeek(-7));
  document.getElementById('nextWeekBtn').addEventListener('click', () => shiftSelectedWeek(7));

  document.addEventListener('DOMContentLoaded', async () => {
    setupDriverTargetMonthPicker();
    setupDriverWeekPicker();
    state.selectedWeekStart = weekStartKey();
    consumeLogoutNotice();

    const isProduction = BremStorage.getSupabaseConfig?.().mode === 'production';
    if (isProduction) {
      try {
        await window.BremSupabaseConfig?.load?.();
        const status = BremStorage.getStorageStatus?.() || {};
        if (!status.supabaseHydrated) {
          await BremStorage.initStorage({ backend: 'supabase', deferHydrate: true });
        }
        await BremStorage.loadSupabaseProfile?.();
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

    const savedDriver = findDriverById(BremStorage.auth.getDriverSessionId());
    if (savedDriver) {
      showLoggedIn(savedDriver);
    } else if (isProduction && BremStorage.auth.isDriverLoggedIn?.()) {
      const riderId = BremStorage.auth.getDriverSessionId();
      const driver = BremStorage.drivers.getById(riderId);
      if (driver) {
        showLoggedIn(driver);
      } else {
        showLoggedOut();
      }
    } else {
      showLoggedOut();
    }
  });
})();
