(async function () {
  const {
    makeDriverLoginId,
    normalizePhone,
    formatResidentNumber,
    normalizeLoginPassword,
    DEFAULT_DRIVER_PASSWORD,
    DRIVER_SENSITIVE_FIELDS,
    isDriverFieldHidden,
    updateDriverTotal,
    showToast: showToastUtil,
    findDuplicateDriver
  } = window.BremDriverUtils;

  const form = document.getElementById('driverForm');
  if (!form) return;

  const pageParams = new URLSearchParams(window.location.search);
  if (!pageParams.get('edit') && !pageParams.get('register')) {
    window.location.replace('drivers.html');
    return;
  }

  async function ensureAdminAccess() {
    return window.BremDriverProgramAccess?.ensure?.() ?? false;
  }

  const driverIdInput = document.getElementById('driverId');
  const nameInput = document.getElementById('driverName');
  const phoneInput = document.getElementById('driverPhone');
  const baeminIdInput = document.getElementById('driverBaeminId');
  const platformCoupangInput = document.getElementById('platformCoupang');
  const platformBaeminInput = document.getElementById('platformBaemin');
  const passwordInput = document.getElementById('driverPassword');
  const residentNumberInput = document.getElementById('driverResidentNumber');
  const bankNameInput = document.getElementById('driverBankName');
  const accountHolderInput = document.getElementById('driverAccountHolder');
  const accountNumberInput = document.getElementById('driverAccountNumber');
  const eventItemInput = document.getElementById('driverEventItem');
  const eventStartButton = document.getElementById('driverEventStartButton');
  const eventStartDateInput = document.getElementById('driverEventStartDate');
  const joinDateInput = document.getElementById('driverJoinDate');
  const statusInput = document.getElementById('driverStatus');
  const memoInput = document.getElementById('driverMemo');
  const submitBtn = document.getElementById('submitBtn');
  const resetBtn = document.getElementById('resetBtn');
  const formTitle = document.getElementById('formTitle');
  const driverTotal = document.getElementById('driverTotal');
  const toast = document.getElementById('toast');
  const resetDriverPasswordBtn = document.getElementById('resetDriverPasswordBtn');
  const hideResidentNumberBtn = document.getElementById('hideResidentNumberBtn');
  const hideAccountNumberBtn = document.getElementById('hideAccountNumberBtn');
  const hideAllResidentNumbersBtn = document.getElementById('hideAllResidentNumbersBtn');
  const unhideAllResidentNumbersBtn = document.getElementById('unhideAllResidentNumbersBtn');
  const residentNumberBulkStatus = document.getElementById('residentNumberBulkStatus');
  const residentNumberPrivacyStatus = document.getElementById('residentNumberPrivacyStatus');
  const accountNumberPrivacyStatus = document.getElementById('accountNumberPrivacyStatus');
  const loginIdPreview = document.getElementById('loginIdPreview');

  const SENSITIVE_FIELDS = DRIVER_SENSITIVE_FIELDS.map(field => ({
    ...field,
    input: field.key === 'residentNumber' ? residentNumberInput : accountNumberInput,
    hideBtn: field.key === 'residentNumber' ? hideResidentNumberBtn : hideAccountNumberBtn,
    statusEl: field.key === 'residentNumber' ? residentNumberPrivacyStatus : accountNumberPrivacyStatus,
    formatValue(value) {
      if (field.key === 'residentNumber') return formatResidentNumber(value || '');
      return String(value || '');
    }
  }));

  let eventStartDatePicker;
  let platformAutoSync = true;

  function today() {
    return new Date().toISOString().split('T')[0];
  }

  function showToast(message) {
    showToastUtil(toast, message);
  }

  function isFieldHidden(driver, fieldKey) {
    return isDriverFieldHidden(driver, fieldKey);
  }

  function updatePrivacyStatusUi(driver) {
    const editing = Boolean(driver?.id);
    SENSITIVE_FIELDS.forEach(field => {
      const hidden = editing && isFieldHidden(driver, field.key);
      if (field.statusEl) {
        field.statusEl.hidden = !editing;
        field.statusEl.textContent = hidden ? '가리기 ON' : '가리기 OFF';
        field.statusEl.classList.toggle('field-privacy-status--on', hidden);
        field.statusEl.classList.toggle('field-privacy-status--off', !hidden);
      }
      if (field.hideBtn) {
        field.hideBtn.hidden = !editing;
        field.hideBtn.textContent = hidden ? field.unhideLabel : field.hideLabel;
        field.hideBtn.classList.toggle('field-hide-btn--active', hidden);
      }
    });

    const all = BremStorage.drivers.getAll();
    const hiddenCount = all.filter(item => isFieldHidden(item, 'residentNumber')).length;
    if (residentNumberBulkStatus) {
      if (!all.length) {
        residentNumberBulkStatus.hidden = true;
        residentNumberBulkStatus.textContent = '';
      } else {
        residentNumberBulkStatus.hidden = false;
        residentNumberBulkStatus.textContent = `주민번호 가림 ${hiddenCount}/${all.length}명`;
        residentNumberBulkStatus.classList.toggle('header-privacy-status--on', hiddenCount === all.length);
        residentNumberBulkStatus.classList.toggle('header-privacy-status--partial', hiddenCount > 0 && hiddenCount < all.length);
        residentNumberBulkStatus.classList.toggle('header-privacy-status--off', hiddenCount === 0);
      }
    }
  }

  function applySensitiveFieldUi(driver) {
    const editing = Boolean(driver?.id);
    SENSITIVE_FIELDS.forEach(field => {
      if (!field.input) return;
      field.input.classList.remove('field-input--masked');
      field.input.readOnly = false;
      field.input.disabled = false;
      field.input.value = editing
        ? field.formatValue(driver?.[field.key] || '')
        : field.input.value;
    });
    updatePrivacyStatusUi(driver);
  }

  function resetSensitiveFieldUi() {
    SENSITIVE_FIELDS.forEach(field => {
      if (!field.input) return;
      field.input.classList.remove('field-input--masked');
      field.input.readOnly = false;
      field.input.disabled = false;
      field.input.value = '';
      if (field.hideBtn) {
        field.hideBtn.hidden = true;
        field.hideBtn.textContent = field.hideLabel;
        field.hideBtn.classList.remove('field-hide-btn--active');
      }
      if (field.statusEl) {
        field.statusEl.hidden = true;
        field.statusEl.textContent = '가리기 OFF';
        field.statusEl.classList.remove('field-privacy-status--on');
        field.statusEl.classList.add('field-privacy-status--off');
      }
    });
    updatePrivacyStatusUi(null);
  }

  async function toggleFieldHidden(fieldKey, label) {
    const id = driverIdInput.value;
    if (!id) return;

    const driver = BremStorage.drivers.getById(id);
    if (!driver) return;

    const currentlyHidden = isFieldHidden(driver, fieldKey);
    try {
      if (!currentlyHidden) {
        if (!window.confirm(`${label} 가리기를 켜시겠습니까?\n기사 전용·기사 목록에서는 표시·수정되지 않습니다.\n(index에서는 계속 확인·수정 가능)`)) return;
        await BremStorage.drivers.setFieldHidden(id, fieldKey, true);
        showToast(`${label} 가리기 ON`);
      } else {
        if (!window.confirm(`${label} 가리기를 해제하시겠습니까?\n기사 전용·기사 목록에서 다시 표시·수정됩니다.`)) return;
        await BremStorage.drivers.setFieldHidden(id, fieldKey, false);
        showToast(`${label} 가리기 OFF`);
      }
      await BremStorage.flushStorage?.();
      editDriver(id);
    } catch (error) {
      showToast(error.message || '가리기 설정 저장에 실패했습니다.');
    }
  }

  async function handleHideAllResidentNumbers() {
    const all = BremStorage.drivers.getAll();
    if (!all.length) {
      showToast('등록된 기사가 없습니다.');
      return;
    }
    const visibleCount = all.filter(driver => !isFieldHidden(driver, 'residentNumber')).length;
    if (!visibleCount) {
      showToast('모든 기사 주민번호가 이미 가려져 있습니다.');
      return;
    }
    if (!window.confirm(`등록된 기사 ${all.length}명의 주민등록번호 가리기를 켜시겠습니까?\n기사 전용·기사 목록에만 적용됩니다.`)) return;
    try {
      await BremStorage.drivers.setFieldHiddenForAll('residentNumber', true);
      await BremStorage.flushStorage?.();
      showToast(`기사 ${all.length}명 주민번호 가리기 ON`);
      const id = driverIdInput.value;
      if (id) editDriver(id);
    } catch (error) {
      showToast(error.message || '가리기 설정 저장에 실패했습니다.');
    }
  }

  async function handleUnhideAllResidentNumbers() {
    const all = BremStorage.drivers.getAll();
    if (!all.length) {
      showToast('등록된 기사가 없습니다.');
      return;
    }
    const hiddenCount = all.filter(driver => isFieldHidden(driver, 'residentNumber')).length;
    if (!hiddenCount) {
      showToast('가려진 주민번호가 없습니다.');
      return;
    }
    if (!window.confirm(`가려진 주민등록번호 ${hiddenCount}명분의 가리기를 해제하시겠습니까?`)) return;
    try {
      await BremStorage.drivers.setFieldHiddenForAll('residentNumber', false);
      await BremStorage.flushStorage?.();
      showToast(`기사 ${hiddenCount}명 주민번호 가리기 OFF`);
      const id = driverIdInput.value;
      if (id) editDriver(id);
    } catch (error) {
      showToast(error.message || '가리기 설정 저장에 실패했습니다.');
    }
  }

  function normalizeResidentNumber(value) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  function updateLoginIdPreview() {
    if (!loginIdPreview) return;
    const name = nameInput.value.trim();
    const phone = normalizePhone(phoneInput.value);
    if (!name || phone.length < 4) {
      loginIdPreview.textContent = '이름과 연락처 입력 후 자동 표시';
      return;
    }
    loginIdPreview.textContent = makeDriverLoginId({ name, phone });
  }

  function syncPlatformChecksFromBaeminId() {
    const hasBaeminId = baeminIdInput.value.trim().length > 0;
    platformCoupangInput.checked = true;
    platformBaeminInput.checked = hasBaeminId;
  }

  function ensurePlatformSelection() {
    if (!platformCoupangInput.checked && !platformBaeminInput.checked) {
      platformCoupangInput.checked = true;
      showToast('쿠팡 또는 배민 중 하나 이상 선택해야 합니다.');
    }
  }

  function eventCatalog() {
    return BremStorage.events.getCatalog();
  }

  function renderEventOptions(selectedValue) {
    const items = eventCatalog();
    eventItemInput.innerHTML = '<option value="">미선택</option>';
    items.forEach(item => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = `${item.name} (목표 ${item.targetCount}개)`;
      if (selectedValue && (selectedValue === item.id || selectedValue === item.name)) {
        option.selected = true;
      }
      eventItemInput.appendChild(option);
    });
  }

  function selectedEventItem() {
    const item = eventCatalog().find(eventItem => eventItem.id === eventItemInput.value);
    return {
      id: item ? item.id : '',
      name: item ? item.name : ''
    };
  }

  function refreshHeader() {
    updateDriverTotal(driverTotal);
    updatePrivacyStatusUi(driverIdInput.value ? BremStorage.drivers.getById(driverIdInput.value) : null);
  }

  function resetForm() {
    form.reset();
    driverIdInput.value = '';
    platformAutoSync = true;
    renderEventOptions('');
    joinDateInput.value = today();
    if (eventStartDatePicker) eventStartDatePicker.setDate('');
    else if (eventStartDateInput) eventStartDateInput.value = '';
    statusInput.value = '근무중';
    baeminIdInput.value = '';
    if (bankNameInput) bankNameInput.value = '';
    if (accountHolderInput) accountHolderInput.value = '';
    if (accountNumberInput) accountNumberInput.value = '';
    passwordInput.value = DEFAULT_DRIVER_PASSWORD;
    resetSensitiveFieldUi();
    platformCoupangInput.checked = true;
    platformBaeminInput.checked = false;
    formTitle.textContent = '기사 등록';
    submitBtn.textContent = '기사 등록';
    updateLoginIdPreview();
    nameInput.focus();
  }

  function syncDriverEventSettings(driverId, data) {
    const item = eventCatalog().find(eventItem => eventItem.id === data.longEventItemId);
    if (item) {
      BremStorage.events.setDriverItem(driverId, item);
      if (data.longEventStartDate) {
        BremStorage.events.setDriverStartDate(driverId, data.longEventStartDate);
      }
    } else if (!data.longEventItemId) {
      BremStorage.events.setDriverItem(driverId, null);
    }
  }

  function getFormData() {
    const eventItem = selectedEventItem();
    const baeminId = baeminIdInput.value.trim();
    return {
      name: nameInput.value.trim(),
      phone: phoneInput.value.trim(),
      residentNumber: normalizeResidentNumber(residentNumberInput?.value || ''),
      password: normalizeLoginPassword(passwordInput.value) || DEFAULT_DRIVER_PASSWORD,
      bankName: bankNameInput ? bankNameInput.value.trim() : '',
      accountHolder: accountHolderInput ? accountHolderInput.value.trim() : '',
      accountNumber: accountNumberInput ? accountNumberInput.value.trim() : '',
      baeminId,
      platformCoupang: platformCoupangInput.checked,
      platformBaemin: platformBaeminInput.checked,
      longEventItemId: eventItem.id,
      longEventItem: eventItem.name,
      longEventStartDate: eventStartDateInput.value,
      joinDate: joinDateInput.value,
      status: statusInput.value,
      memo: memoInput.value.trim()
    };
  }

  function validateFormData(data) {
    if (!data.name || !data.phone || !data.password || !data.joinDate || !data.status) {
      showToast('필수 항목을 모두 입력해주세요.');
      return false;
    }

    if (!data.platformCoupang && !data.platformBaemin) {
      showToast('쿠팡 또는 배민 중 하나 이상 선택해주세요.');
      return false;
    }

    if (data.platformBaemin && !data.baeminId) {
      showToast('배민 수행 선택 시 배민 아이디를 입력해주세요.');
      return false;
    }

    if (!driverIdInput.value) {
      const duplicate = findDuplicateDriver(data);
      if (duplicate) {
        showToast(`중복 기사입니다. ${duplicate.reason} (${duplicate.driver.name})`);
        return false;
      }
    } else {
      const duplicate = findDuplicateDriver(data, driverIdInput.value);
      if (duplicate) {
        showToast(`다른 기사와 중복됩니다. ${duplicate.reason} (${duplicate.driver.name})`);
        return false;
      }
    }

    return true;
  }

  async function ensureStorageReadyForSave() {
    const resume = await BremStorage.resumeSupabaseAfterAuth?.();
    if (!resume?.ok) {
      throw new Error(resume?.message || 'Supabase에 연결되지 않았습니다. 관리자 화면에서 다시 로그인하세요.');
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const data = getFormData();
    if (!validateFormData(data)) return;

    const editingId = driverIdInput.value;
    const previousLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = editingId ? '수정 중…' : '등록 중…';

    try {
      await ensureStorageReadyForSave();

      const persist = editingId
        ? BremStorage.drivers.update(editingId, data)
        : BremStorage.drivers.create(data);

      const driver = await Promise.resolve(persist);
      const savedDriver = editingId
        ? BremStorage.drivers.getById(editingId)
        : driver;
      if (!savedDriver) return;

      syncDriverEventSettings(savedDriver.id, data);
      await BremStorage.flushStorage?.();

      refreshHeader();
      window.BremDbConnectionStatus?.render('driverDbStatus');

      if (editingId) {
        showToast('기사 정보가 수정되었습니다.');
        editDriver(savedDriver.id);
        return;
      }

      showToast(`기사가 등록되었습니다. 로그인: ${makeDriverLoginId(savedDriver)} / 비밀번호: ${savedDriver.password || DEFAULT_DRIVER_PASSWORD}`);
      window.location.href = 'drivers.html';
    } catch (error) {
      showToast(error.message || '기사 저장에 실패했습니다.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = previousLabel;
    }
  }

  function editDriver(id) {
    const driver = BremStorage.drivers.getById(id);
    if (!driver) return;

    driverIdInput.value = driver.id;
    nameInput.value = driver.name;
    phoneInput.value = driver.phone;
    baeminIdInput.value = driver.baeminId || '';
    platformAutoSync = false;
    platformCoupangInput.checked = driver.platformCoupang !== false;
    platformBaeminInput.checked = Boolean(driver.platformBaemin);
    passwordInput.value = driver.password || DEFAULT_DRIVER_PASSWORD;
    if (bankNameInput) bankNameInput.value = driver.bankName || '';
    if (accountHolderInput) accountHolderInput.value = driver.accountHolder || '';
    applySensitiveFieldUi(driver);
    renderEventOptions(driver.longEventItemId || driver.longEventItem || '');
    if (eventStartDatePicker) eventStartDatePicker.setDate(driver.longEventStartDate || '');
    else if (eventStartDateInput) eventStartDateInput.value = driver.longEventStartDate || '';
    joinDateInput.value = driver.joinDate;
    statusInput.value = driver.status;
    memoInput.value = driver.memo || '';
    formTitle.textContent = '기사 수정';
    submitBtn.textContent = '수정 저장';
    updateLoginIdPreview();

    window.scrollTo({ top: 0, behavior: 'smooth' });
    nameInput.focus();
  }

  function loadEditFromQuery() {
    const id = new URLSearchParams(window.location.search).get('edit');
    if (id) editDriver(id);
  }

  function setupEventStartDatePicker() {
    eventStartDatePicker = BremDatePicker.setupSingle({
      popup: document.getElementById('indexDateCalendar'),
      daysContainer: document.getElementById('indexDateCalendarDays'),
      titleEl: document.getElementById('indexDateCalendarTitle'),
      prevBtn: document.getElementById('indexDateCalendarPrev'),
      nextBtn: document.getElementById('indexDateCalendarNext'),
      hiddenInput: eventStartDateInput,
      openButton: eventStartButton,
      dayAttr: 'data-index-pick-date',
      emptyLabel: '시작일 선택'
    });
  }

  async function handleResetDriverPassword() {
    const id = driverIdInput.value;
    if (id) {
      const driver = BremStorage.drivers.getById(id);
      if (!driver) return;
      if (!window.confirm(`${driver.name} 기사의 로그인 비밀번호를 1234로 초기화할까요?`)) return;
      try {
        await BremStorage.drivers.resetPassword(id, DEFAULT_DRIVER_PASSWORD);
        passwordInput.value = DEFAULT_DRIVER_PASSWORD;
        showToast('비밀번호를 1234로 초기화했습니다.');
      } catch (error) {
        showToast(error.message || '비밀번호 초기화에 실패했습니다.');
      }
      return;
    }
    passwordInput.value = DEFAULT_DRIVER_PASSWORD;
    showToast('비밀번호를 1234로 설정했습니다.');
  }

  function init() {
    joinDateInput.value = today();
    if (!driverIdInput.value) passwordInput.value = DEFAULT_DRIVER_PASSWORD;
    setupEventStartDatePicker();
    renderEventOptions('');
    if (residentNumberInput) {
      residentNumberInput.addEventListener('input', () => {
        if (residentNumberInput.disabled) return;
        residentNumberInput.value = formatResidentNumber(residentNumberInput.value);
      });
    }
    hideResidentNumberBtn?.addEventListener('click', () => {
      toggleFieldHidden('residentNumber', '주민등록번호');
    });
    hideAccountNumberBtn?.addEventListener('click', () => {
      toggleFieldHidden('accountNumber', '계좌번호');
    });
    hideAllResidentNumbersBtn?.addEventListener('click', handleHideAllResidentNumbers);
    unhideAllResidentNumbersBtn?.addEventListener('click', handleUnhideAllResidentNumbers);
    resetDriverPasswordBtn?.addEventListener('click', handleResetDriverPassword);
    nameInput.addEventListener('input', updateLoginIdPreview);
    phoneInput.addEventListener('input', updateLoginIdPreview);
    baeminIdInput.addEventListener('input', () => {
      if (platformAutoSync) syncPlatformChecksFromBaeminId();
    });
    platformCoupangInput.addEventListener('change', () => {
      platformAutoSync = false;
      ensurePlatformSelection();
    });
    platformBaeminInput.addEventListener('change', () => {
      platformAutoSync = false;
      ensurePlatformSelection();
    });
    form.addEventListener('submit', handleSubmit);
    resetBtn.addEventListener('click', resetForm);
    refreshHeader();
    loadEditFromQuery();
    window.BremDriverIndex = { refresh: refreshHeader };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  if (!(await ensureAdminAccess())) return;

  refreshHeader();
  loadEditFromQuery();
  void BremStorage.reloadDrivers?.(false).then(() => {
    refreshHeader();
    loadEditFromQuery();
  }).catch(error => {
    showToast(error?.message || '기사 목록을 불러오지 못했습니다.');
  });
})();
