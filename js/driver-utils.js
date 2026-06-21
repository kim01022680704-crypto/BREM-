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

    const savedPassword = normalizeLoginPassword(driver?.password) || '1234';
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

  function normalizeImportCellText(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
    return String(value).trim();
  }

  function parseCoupangImportIdentity(platformId, excelName) {
    const idRaw = normalizeImportCellText(platformId).replace(/\s/g, '');
    const nameFromExcel = normalizeImportCellText(excelName).replace(/\s/g, '');
    const loginIds = [];
    const pushLoginId = value => {
      const next = String(value || '').replace(/\s/g, '');
      if (next && !loginIds.includes(next)) loginIds.push(next);
    };

    if (idRaw) pushLoginId(idRaw);

    // 이름+전화번호 한 셀 (예: 이기혁010-2114-8669 → 이기혁8669)
    const phoneTail = idRaw.match(/(01[\d-]{9,14})$/);
    if (phoneTail) {
      const phone = normalizePhone(phoneTail[1]);
      const name = idRaw.slice(0, idRaw.length - phoneTail[1].length);
      if (phone.length >= 10 && phone.startsWith('01') && name) {
        pushLoginId(`${name}${phone.slice(-4)}`);
        return { loginIds, name, phone };
      }
    }

    const combined = idRaw.match(/^(.+?)(01\d{8,9})$/);
    if (combined) {
      const name = combined[1];
      const phone = combined[2];
      pushLoginId(`${name}${phone.slice(-4)}`);
      return { loginIds, name, phone };
    }

    const phoneDigits = normalizePhone(idRaw);
    if (phoneDigits.length >= 10 && phoneDigits.startsWith('01')) {
      if (nameFromExcel) {
        pushLoginId(`${nameFromExcel}${phoneDigits.slice(-4)}`);
        return { loginIds, name: nameFromExcel, phone: phoneDigits };
      }
      return { loginIds, name: '', phone: phoneDigits };
    }

    return { loginIds, name: nameFromExcel, phone: '' };
  }

  function resolveCoupangImportLoginId(platformId, excelName) {
    const identity = parseCoupangImportIdentity(platformId, excelName);
    return identity.loginIds[identity.loginIds.length - 1] || identity.loginIds[0] || '';
  }

  /** ERP 쿠팡ID (이름+전화 뒤4자리). coupangLoginKey 우선 */
  function getErpCoupangId(driver) {
    const custom = String(driver?.coupangLoginKey || driver?.coupangId || driver?.coupangLoginId || '')
      .trim()
      .replace(/\s/g, '');
    if (custom) return custom;
    return makeDriverLoginId(driver);
  }

  /** 쿠팡 1번 시트 A열 → 이기혁8669 형식 (배민 로직 미사용) */
  function buildCoupangErpIdFromCell(identityCell) {
    const idRaw = normalizeImportCellText(identityCell).replace(/\s/g, '');
    if (!idRaw) {
      return { coupangId: '', name: '', phone: '', error: 'A열 공백' };
    }

    const phoneTail = idRaw.match(/(01[\d-]{9,14})$/);
    if (!phoneTail) {
      return { coupangId: '', name: '', phone: '', error: '전화번호 추출 실패' };
    }

    const phone = normalizePhone(phoneTail[1]);
    const name = idRaw.slice(0, idRaw.length - phoneTail[1].length);
    if (!name) {
      return { coupangId: '', name: '', phone, error: '이름 추출 실패' };
    }
    if (phone.length < 10 || !phone.startsWith('01')) {
      return { coupangId: '', name, phone, error: '전화번호 형식 오류' };
    }

    return {
      coupangId: `${name}${phone.slice(-4)}`,
      name,
      phone,
      error: ''
    };
  }

  function matchDriverByCoupangErpId(coupangKey, drivers) {
    const key = String(coupangKey || '').replace(/\s/g, '');
    if (!key) return null;
    const list = Array.isArray(drivers)
      ? drivers
      : (typeof BremStorage !== 'undefined' ? BremStorage.drivers.getAll() : []);
    return list.find(driver => getErpCoupangId(driver) === key) || null;
  }

  /** 배민 2번 시트 AK열 → baemin_id 만 비교 (쿠팡ID 미사용) */
  function matchDriverByBaeminErpId(baeminId, drivers) {
    const id = String(baeminId || '').trim();
    if (!id) return null;
    const list = Array.isArray(drivers)
      ? drivers
      : (typeof BremStorage !== 'undefined' ? BremStorage.drivers.getAll() : []);
    return list.find(driver => String(driver.baeminId || '').trim() === id) || null;
  }

  function normalizeDriverName(value) {
    return String(value || '').replace(/\s/g, '').toLowerCase();
  }

  function driverNamesMatch(driver, excelName) {
    if (!String(excelName || '').trim()) return null;
    return normalizeDriverName(driver?.name) === normalizeDriverName(excelName);
  }

  function makeDriverMatchKey(name, phone) {
    const normName = normalizeDriverName(name);
    const normPhone = normalizePhone(phone);
    if (!normName || !normPhone) return '';
    return `${normName}|${normPhone}`;
  }

  function buildRiderMatchMap(drivers) {
    const map = new Map();
    const list = Array.isArray(drivers)
      ? drivers
      : (typeof BremStorage !== 'undefined' ? BremStorage.drivers.getAll() : []);

    list.forEach(driver => {
      const key = makeDriverMatchKey(driver.name, driver.phone);
      if (key && !map.has(key)) map.set(key, driver);
    });
    return map;
  }

  function normalizeBulkName(value) {
    return String(value || '').trim().replace(/\s+/g, '');
  }

  function normalizeBulkPhone(value) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  function formatPhoneDisplay(value) {
    const digits = normalizeBulkPhone(value);
    if (digits.length === 11 && digits.startsWith('010')) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 10 && digits.startsWith('01')) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return digits || String(value || '').trim();
  }

  function normalizeBulkUploadRaw(raw) {
    if (!raw || typeof raw !== 'object') return {};
    return {
      name: normalizeBulkName(raw.name),
      phone: normalizeBulkPhone(raw.phone),
      residentNumber: raw.residentNumber,
      bankName: String(raw.bankName || '').trim(),
      accountHolder: String(raw.accountHolder || '').trim(),
      accountNumber: String(raw.accountNumber || '').trim(),
      baeminId: String(raw.baeminId || '').trim().replace(/\s/g, ''),
      platformCoupangRaw: raw.platformCoupangRaw,
      platformBaeminRaw: raw.platformBaeminRaw,
      longEventItem: String(raw.longEventItem || '').trim(),
      longEventStartDate: raw.longEventStartDate,
      memo: String(raw.memo || '').trim()
    };
  }

  function isBulkUploadRowEmpty(raw) {
    const normalized = normalizeBulkUploadRaw(raw);
    return !normalized.name && !normalized.phone
      && !normalized.baeminId && !normalized.residentNumber
      && !normalized.bankName && !normalized.accountHolder
      && !normalized.accountNumber && !normalized.memo;
  }

  function matchDriverByNameAndPhone(name, phone, drivers, excludeId) {
    const key = makeDriverMatchKey(name, phone);
    if (!key) return null;

    const list = Array.isArray(drivers)
      ? drivers
      : (typeof BremStorage !== 'undefined' ? BremStorage.drivers.getAll() : []);

    return list.find(driver => {
      if (excludeId && driver.id === excludeId) return false;
      return makeDriverMatchKey(driver.name, driver.phone) === key;
    }) || null;
  }

  function isBulkRawProvided(raw, key) {
    if (!raw || !key) return false;
    const value = raw[key];
    if (value === undefined || value === null) return false;
    return String(value).trim() !== '';
  }

  /**
   * 일괄등록 병합: 업로드에 값이 있는 필드만 반영합니다. 빈 셀은 기존 값을 유지합니다.
   */
  function mergeBulkDriverData(existing, uploadData, raw) {
    if (!existing) return { ...(uploadData || {}) };

    const changes = {};
    const assignString = (key) => {
      const val = String(uploadData?.[key] ?? '').trim();
      if (val) changes[key] = val;
    };

    ['name', 'phone', 'bankName', 'accountHolder', 'accountNumber', 'baeminId', 'memo'].forEach(assignString);

    const residentDigits = normalizeSecretDigits(uploadData?.residentNumber);
    if (residentDigits.length === 13) {
      changes.residentNumber = formatResidentNumber(residentDigits);
    }

    if (isBulkRawProvided(raw, 'platformCoupangRaw')) {
      changes.platformCoupang = uploadData.platformCoupang !== false;
    }
    if (isBulkRawProvided(raw, 'platformBaeminRaw')) {
      changes.platformBaemin = Boolean(uploadData.platformBaemin);
    } else if (String(uploadData?.baeminId || '').trim()) {
      changes.platformBaemin = true;
    }

    if (String(uploadData?.longEventItemId || '').trim()) {
      changes.longEventItemId = uploadData.longEventItemId;
      changes.longEventItem = String(uploadData.longEventItem || '').trim();
    }
    if (String(uploadData?.longEventStartDate || '').trim()) {
      changes.longEventStartDate = uploadData.longEventStartDate;
    }

    return changes;
  }

  function prepareBulkRiderRecord(row, buildNewDriver) {
    if (!row) return null;

    if (row.action === 'update') {
      const changes = mergeBulkDriverData(row.matchedDriver, row.data, row.raw);
      if (!Object.keys(changes).length) return row.matchedDriver;
      return { ...row.matchedDriver, ...changes };
    }

    if (typeof buildNewDriver !== 'function') {
      throw new Error('신규 기사 생성 함수가 없습니다.');
    }

    return buildNewDriver({
      ...row.data,
      platformCoupang: row.data.platformCoupang !== false,
      platformBaemin: Boolean(row.data.platformBaemin)
    });
  }

  /**
   * 엑셀 일괄등록 매칭: 아이디 우선, 이름은 보조 확인.
   * 이름이 없거나 달라도 아이디가 일치하면 매칭합니다.
   */
  function matchDriverForPlatformImport(platformId, platform, excelName, drivers) {
    const list = Array.isArray(drivers)
      ? drivers
      : (typeof BremStorage !== 'undefined' ? BremStorage.drivers.getAll() : []);
    const p = String(platform || 'coupang').toLowerCase();
    const hasName = Boolean(String(excelName || '').trim());

    if (p === 'baemin') {
      const id = String(platformId || '').trim();
      if (!id) return { driver: null, matchNote: '', resolvedPlatformId: '' };
      const matches = list.filter(driver => String(driver.baeminId || '').trim() === id);
      if (!matches.length) return { driver: null, matchNote: '', resolvedPlatformId: id };

      if (hasName) {
        const nameAndId = matches.find(driver => driverNamesMatch(driver, excelName));
        if (nameAndId) {
          return { driver: nameAndId, matchNote: '', resolvedPlatformId: id };
        }
      }

      const driver = matches[0];
      let matchNote = '';
      if (hasName && driverNamesMatch(driver, excelName) === false) {
        matchNote = '이름 불일치(아이디 기준 매칭)';
      } else if (matches.length > 1) {
        matchNote = '동일 아이디 다중(아이디 기준 매칭)';
      }
      return { driver, matchNote, resolvedPlatformId: id };
    }

    const identity = parseCoupangImportIdentity(platformId, excelName);
    if (!identity.loginIds.length && !(identity.name && identity.phone)) {
      return { driver: null, matchNote: '', resolvedPlatformId: '' };
    }

    let matches = [];
    for (const loginId of identity.loginIds) {
      matches = list.filter(driver => makeDriverLoginId(driver) === loginId);
      if (matches.length) break;
    }

    if (!matches.length && identity.name && identity.phone) {
      const byNamePhone = matchDriverByNameAndPhone(identity.name, identity.phone, list);
      if (byNamePhone) {
        const resolvedPlatformId = makeDriverLoginId(byNamePhone);
        return {
          driver: byNamePhone,
          matchNote: '이름+연락처 기준 매칭',
          resolvedPlatformId
        };
      }
    }

    if (!matches.length) {
      return { driver: null, matchNote: '', resolvedPlatformId: identity.loginIds[0] || '' };
    }

    if (hasName) {
      const nameAndId = matches.find(driver => driverNamesMatch(driver, excelName));
      if (nameAndId) {
        return {
          driver: nameAndId,
          matchNote: '',
          resolvedPlatformId: makeDriverLoginId(nameAndId)
        };
      }
    }

    const driver = matches[0];
    let matchNote = '';
    if (hasName && driverNamesMatch(driver, excelName) === false) {
      matchNote = '이름 불일치(아이디 기준 매칭)';
    } else if (matches.length > 1) {
      matchNote = '동일 아이디 다중(아이디 기준 매칭)';
    } else if (identity.phone && identity.loginIds[0] !== makeDriverLoginId(driver)) {
      matchNote = '이름+연락처→쿠팡ID 변환 매칭';
    }

    return {
      driver,
      matchNote,
      resolvedPlatformId: makeDriverLoginId(driver)
    };
  }

  function buildDriverDuplicateLookup(excludeId, drivers) {
    const byLoginId = new Map();
    const byPhone = new Map();
    const byBaeminId = new Map();

    const list = Array.isArray(drivers)
      ? drivers
      : (typeof BremStorage !== 'undefined' ? BremStorage.drivers.getAll() : []);

    list.forEach(driver => {
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

  function updateDriverTotal(el, count) {
    if (!el) return;
    const total = count != null ? count : BremStorage.drivers.getAll().length;
    el.textContent = `${total}명`;
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
    getErpCoupangId,
    buildCoupangErpIdFromCell,
    matchDriverByCoupangErpId,
    matchDriverByBaeminErpId,
    resolveCoupangImportLoginId,
    parseCoupangImportIdentity,
    normalizeDriverName,
    driverNamesMatch,
    makeDriverMatchKey,
    buildRiderMatchMap,
    normalizeBulkName,
    normalizeBulkPhone,
    formatPhoneDisplay,
    normalizeBulkUploadRaw,
    isBulkUploadRowEmpty,
    matchDriverByNameAndPhone,
    isBulkRawProvided,
    mergeBulkDriverData,
    prepareBulkRiderRecord,
    matchDriverForPlatformImport,
    buildDriverDuplicateLookup,
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
