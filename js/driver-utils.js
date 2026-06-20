window.BremDriverUtils = (function () {
  function normalizePhone(value) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  function formatResidentNumber(value) {
    const digits = String(value || '').replace(/[^0-9]/g, '').slice(0, 13);
    if (digits.length <= 6) return digits;
    return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  }

  const DEFAULT_DRIVER_PASSWORD = '1234';

  const DRIVER_SENSITIVE_FIELDS = [
    {
      key: 'residentNumber',
      label: '주민등록번호',
      hideLabel: '주민번호 가리기',
      unhideLabel: '주민번호 해제',
      listHideLabel: '주민 가리기',
      listUnhideLabel: '주민 해제'
    },
    {
      key: 'accountNumber',
      label: '계좌번호',
      hideLabel: '계좌번호 가리기',
      unhideLabel: '계좌번호 해제',
      listHideLabel: '계좌 가리기',
      listUnhideLabel: '계좌 해제'
    }
  ];

  function isDriverFieldHidden(driver, fieldKey) {
    return Boolean(driver?.hiddenFields?.[fieldKey]);
  }

  function normalizeLoginPassword(value) {
    return String(value || '').trim();
  }

  function normalizeSecretDigits(value) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  function normalizeLoginIdInput(value) {
    return String(value || '').replace(/[\s-]/g, '');
  }

  function getDriverResidentDigits(driver) {
    const residentDigits = normalizeSecretDigits(driver?.residentNumber);
    if (residentDigits.length === 13) return residentDigits;

    const passwordDigits = normalizeSecretDigits(driver?.password);
    if (passwordDigits.length === 13) return passwordDigits;

    return '';
  }

  function verifyDriverLoginSecret(driver, input) {
    const inputRaw = normalizeLoginPassword(input);
    const inputDigits = normalizeSecretDigits(input);

    if (!inputRaw) {
      return { ok: false, reason: '비밀번호를 입력하세요.' };
    }

    const savedPassword = normalizeLoginPassword(driver?.password);
    if (savedPassword && savedPassword === inputRaw) {
      return { ok: true };
    }

    const residentDigits = getDriverResidentDigits(driver);
    if (residentDigits) {
      if (inputDigits.length === 7 && residentDigits.slice(-7) === inputDigits) {
        return { ok: true };
      }
      if (inputDigits.length === 13 && residentDigits === inputDigits) {
        return { ok: true };
      }
      if (inputDigits && residentDigits === inputDigits) {
        return { ok: true };
      }
    }

    if (!savedPassword && !residentDigits) {
      return { ok: false, reason: '비밀번호가 설정되어 있지 않습니다. 관리자에게 문의하세요.' };
    }

    return {
      ok: false,
      reason: '비밀번호가 일치하지 않습니다. 기본 비밀번호 1234 또는 주민번호 뒷자리 7자리를 입력하세요.'
    };
  }

  function formatDriverPlatformLabel(driver) {
    const coupang = driver?.platformCoupang !== false;
    const baemin = Boolean(driver?.platformBaemin);
    if (coupang && baemin) return '배민쿠팡';
    if (baemin) return '배민';
    if (coupang) return '쿠팡';
    return '-';
  }

  function formatAccountSummary(driver) {
    const bank = String(driver?.bankName || '').trim();
    const holder = String(driver?.accountHolder || '').trim();
    const numberHidden = isDriverFieldHidden(driver, 'accountNumber');
    const numberRaw = String(driver?.accountNumber || '').trim();
    const number = numberHidden && numberRaw ? '가려진 정보' : numberRaw;
    if (!bank && !holder && !number) return '-';
    const parts = [bank, holder, number].filter(Boolean);
    return parts.join(' · ');
  }

  function makeDriverLoginId(driver) {
    return `${String(driver.name || '').replace(/\s/g, '')}${normalizePhone(driver.phone).slice(-4)}`;
  }

  function buildDriverDuplicateLookup(excludeId) {
    const byLoginId = new Map();
    const byPhone = new Map();
    const byBaeminId = new Map();

    BremStorage.drivers.getAll().forEach(driver => {
      if (excludeId && driver.id === excludeId) return;

      const loginId = makeDriverLoginId(driver);
      if (loginId) byLoginId.set(loginId, driver);

      const phone = normalizePhone(driver.phone);
      if (phone) byPhone.set(phone, driver);

      const baeminId = String(driver.baeminId || '').trim();
      if (baeminId) byBaeminId.set(baeminId, driver);
    });

    return { byLoginId, byPhone, byBaeminId };
  }

  function findDuplicateDriver(driverInput, excludeId) {
    const name = String(driverInput?.name || '').trim();
    const phone = normalizePhone(driverInput?.phone);
    const baeminId = String(driverInput?.baeminId || '').trim();
    const loginId = makeDriverLoginId({ name, phone });
    const lookup = buildDriverDuplicateLookup(excludeId);

    if (loginId && lookup.byLoginId.has(loginId)) {
      return {
        driver: lookup.byLoginId.get(loginId),
        reason: '쿠팡아이디(이름+연락처 뒤4자리) 중복',
        loginId
      };
    }

    if (phone && lookup.byPhone.has(phone)) {
      return {
        driver: lookup.byPhone.get(phone),
        reason: '연락처 중복',
        loginId
      };
    }

    if (baeminId && lookup.byBaeminId.has(baeminId)) {
      return {
        driver: lookup.byBaeminId.get(baeminId),
        reason: '배민아이디 중복',
        loginId
      };
    }

    return null;
  }

  function isDuplicateErrorMessage(errors) {
    return (errors || []).some(error => /중복|이미 등록/.test(error));
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '-';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}.${m}.${d}`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function statusClass(status) {
    if (status === '근무중') return 'working';
    if (status === '휴무') return 'off';
    return 'left';
  }

  function renderPlatformBadges(driver) {
    const tags = [];
    if (driver.platformBaemin) tags.push('<span class="platform-tag platform-tag--baemin">배민</span>');
    if (driver.platformCoupang !== false) tags.push('<span class="platform-tag platform-tag--coupang">쿠팡</span>');
    return tags.join('') || '-';
  }

  function updateDriverTotal(el) {
    if (!el) return;
    el.textContent = `${BremStorage.drivers.getAll().length}명`;
  }

  function showToast(toastEl, message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  return {
    normalizePhone,
    formatResidentNumber,
    DEFAULT_DRIVER_PASSWORD,
    DRIVER_SENSITIVE_FIELDS,
    isDriverFieldHidden,
    normalizeLoginPassword,
    normalizeLoginIdInput,
    verifyDriverLoginSecret,
    formatDriverPlatformLabel,
    formatAccountSummary,
    makeDriverLoginId,
    findDuplicateDriver,
    isDuplicateErrorMessage,
    formatDate,
    escapeHtml,
    statusClass,
    renderPlatformBadges,
    updateDriverTotal,
    showToast
  };
})();
