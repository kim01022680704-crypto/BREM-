(function () {
  const {
    makeDriverLoginId,
    makeDriverMatchKey,
    matchDriverByNameAndPhone,
    mergeBulkDriverData,
    buildDriverDuplicateLookup,
    isBulkRawProvided
  } = window.BremDriverUtils;

  const BULK_COLUMNS = [
    { key: 'name', label: '이름', required: true },
    { key: 'phone', label: '연락처', required: true },
    { key: 'residentNumber', label: '주민등록번호', required: false },
    { key: 'bankName', label: '은행명', required: false },
    { key: 'accountHolder', label: '예금주', required: false },
    { key: 'accountNumber', label: '계좌번호', required: false },
    { key: 'baeminId', label: '배민 아이디', required: false },
    { key: 'platformCoupang', label: '쿠팡 수행', required: false },
    { key: 'platformBaemin', label: '배민 수행', required: false },
    { key: 'longEventItem', label: '이벤트 아이템', required: false },
    { key: 'longEventStartDate', label: '이벤트 시작일', required: false },
    { key: 'memo', label: '메모', required: false }
  ];

  const HEADER_MARKERS = ['이름', 'name'];

  let parsedRows = [];

  const layout = document.getElementById('mainLayout');
  const tabSingle = document.getElementById('tabSingle');
  const tabBulk = document.getElementById('tabBulk');
  const driverForm = document.getElementById('driverForm');
  const bulkPanel = document.getElementById('driverBulkPanel');
  const formSubtitle = document.getElementById('formSubtitle');
  const templateBtn = document.getElementById('bulkTemplateBtn');
  const fileInput = document.getElementById('bulkFileInput');
  const previewSection = document.getElementById('bulkPreviewSection');
  const previewBody = document.getElementById('bulkPreviewBody');
  const totalCountEl = document.getElementById('bulkTotalCount');
  const createCountEl = document.getElementById('bulkCreateCount');
  const updateCountEl = document.getElementById('bulkUpdateCount');
  const issueCountEl = document.getElementById('bulkIssueCount');
  const applyBtn = document.getElementById('bulkApplyBtn');
  const clearBtn = document.getElementById('bulkClearBtn');
  const toast = document.getElementById('toast');

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function normalizeDigits(value) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  function normalizePhoneDisplay(value) {
    return String(value || '').trim();
  }

  function makeLoginId(name, phone) {
    return `${String(name || '').replace(/\s/g, '')}${normalizeDigits(phone).slice(-4)}`;
  }

  function today() {
    return new Date().toISOString().split('T')[0];
  }

  function parseYesNo(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const text = String(value).trim().toLowerCase();
    if (['y', 'yes', '예', 'o', 'true', '1', 'v'].includes(text)) return true;
    if (['n', 'no', '아니오', '아니요', 'false', '0'].includes(text)) return false;
    return fallback;
  }

  function parseExcelDate(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'number' && window.XLSX && XLSX.SSF) {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) {
        return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
      }
    }
    const text = String(value).trim();
    const normalized = text.replace(/\./g, '-').replace(/\//g, '-');
    const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
      return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    }
    return text;
  }

  function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00`);
    return !Number.isNaN(date.getTime());
  }

  function cellValue(row, index) {
    if (!row || index >= row.length) return '';
    const value = row[index];
    if (value === undefined || value === null) return '';
    return value;
  }

  function isHeaderRow(row) {
    const first = String(cellValue(row, 0)).trim().toLowerCase();
    return HEADER_MARKERS.some(marker => first === marker.toLowerCase());
  }

  function findEventItem(name) {
    const keyword = String(name || '').trim();
    if (!keyword) return null;
    const catalog = BremStorage.events.getCatalog();
    return catalog.find(item => item.name === keyword)
      || catalog.find(item => item.name.includes(keyword))
      || null;
  }

  function resolvePlatforms(raw, isUpdate) {
    const baeminId = String(raw.baeminId || '').trim();
    const hasCoupangRaw = isBulkRawProvided(raw, 'platformCoupangRaw');
    const hasBaeminRaw = isBulkRawProvided(raw, 'platformBaeminRaw');

    if (isUpdate) {
      const result = { baeminId };
      if (hasCoupangRaw) {
        result.platformCoupang = parseYesNo(raw.platformCoupangRaw, true);
      }
      if (hasBaeminRaw) {
        result.platformBaemin = parseYesNo(raw.platformBaeminRaw, false);
      } else if (baeminId) {
        result.platformBaemin = true;
      }
      return result;
    }

    let platformCoupang = parseYesNo(raw.platformCoupangRaw, true);
    let platformBaemin = parseYesNo(raw.platformBaeminRaw, Boolean(baeminId));

    if (baeminId && !hasBaeminRaw && !hasCoupangRaw) {
      platformCoupang = true;
      platformBaemin = true;
    } else if (!baeminId && !hasBaeminRaw && !hasCoupangRaw) {
      platformCoupang = true;
      platformBaemin = false;
    }

    return { baeminId, platformCoupang, platformBaemin };
  }

  function validateRow(raw, rowNumber, batchMatchKeys, batchBaeminIds) {
    const errors = [];
    const name = String(raw.name || '').trim();
    const phone = normalizePhoneDisplay(raw.phone);
    const residentNumber = normalizeDigits(raw.residentNumber || raw.password);
    const password = '1234';
    const joinDate = today();
    const status = '근무중';
    const memo = String(raw.memo || '').trim();
    const accountNumber = String(raw.accountNumber || '').trim();
    const bankName = String(raw.bankName || '').trim();
    const accountHolder = String(raw.accountHolder || '').trim();
    const longEventStartDate = parseExcelDate(raw.longEventStartDate);
    const matchedDriver = matchDriverByNameAndPhone(name, phone);
    const isUpdate = Boolean(matchedDriver);
    const platforms = resolvePlatforms(raw, isUpdate);
    const baeminId = String(platforms.baeminId || '').trim();

    if (!name) errors.push('이름 누락');
    if (!phone) errors.push('연락처 누락');
    if (residentNumber && residentNumber.length !== 13) errors.push('주민등록번호 13자리 확인');

    const effectivePlatformCoupang = isUpdate
      ? (platforms.platformCoupang !== undefined ? platforms.platformCoupang : matchedDriver?.platformCoupang !== false)
      : platforms.platformCoupang;
    const effectivePlatformBaemin = isUpdate
      ? (platforms.platformBaemin !== undefined ? platforms.platformBaemin : Boolean(matchedDriver?.platformBaemin))
      : platforms.platformBaemin;
    const effectiveBaeminId = baeminId || String(matchedDriver?.baeminId || '').trim();

    if (!isUpdate && !effectivePlatformCoupang && !effectivePlatformBaemin) {
      errors.push('쿠팡·배민 중 하나 이상 선택');
    }
    if (effectivePlatformBaemin && !effectiveBaeminId) {
      errors.push('배민 수행 시 배민 아이디 필요');
    }

    let eventItem = null;
    if (raw.longEventItem) {
      eventItem = findEventItem(raw.longEventItem);
      if (!eventItem) errors.push('이벤트 아이템을 찾을 수 없음');
    }
    if (longEventStartDate && !isValidDate(longEventStartDate)) {
      errors.push('이벤트 시작일 형식 오류');
    }

    const matchKey = makeDriverMatchKey(name, phone);
    const loginId = name && phone ? makeLoginId(name, phone) : '';

    if (matchKey && batchMatchKeys.has(matchKey)) errors.push('파일 내 이름+연락처 중복');
    if (baeminId && batchBaeminIds.has(baeminId)) errors.push('파일 내 배민아이디 중복');

    const lookup = buildDriverDuplicateLookup();
    if (!isUpdate && loginId && lookup.byLoginId.has(loginId)) {
      const conflict = lookup.byLoginId.get(loginId);
      if (makeDriverMatchKey(conflict.name, conflict.phone) !== matchKey) {
        errors.push('쿠팡아이디(이름+연락처 뒤4자리) 중복');
      }
    }
    if (baeminId && lookup.byBaeminId.has(baeminId)) {
      const conflict = lookup.byBaeminId.get(baeminId);
      if (!matchedDriver || conflict.id !== matchedDriver.id) {
        errors.push('다른 기사에 등록된 배민아이디');
      }
    }

    const data = {
      name,
      phone,
      residentNumber,
      password,
      bankName,
      accountHolder,
      accountNumber,
      joinDate,
      status,
      baeminId,
      platformCoupang: platforms.platformCoupang,
      platformBaemin: platforms.platformBaemin,
      longEventItemId: eventItem ? eventItem.id : '',
      longEventItem: eventItem ? eventItem.name : '',
      longEventStartDate: longEventStartDate || '',
      memo
    };

    return {
      rowNumber,
      raw,
      data,
      loginId,
      matchedDriver,
      action: isUpdate ? 'update' : 'create',
      errors,
      valid: errors.length === 0,
      isIssue: errors.length > 0
    };
  }

  function parseWorkbookRows(workbook) {
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const dataRows = [];

    rows.forEach((row, index) => {
      const excelRowNumber = index + 1;
      if (!row || !row.some(cell => String(cell || '').trim())) return;
      if (isHeaderRow(row)) return;

      dataRows.push({
        rowNumber: excelRowNumber,
        raw: {
          name: cellValue(row, 0),
          phone: cellValue(row, 1),
          residentNumber: cellValue(row, 2),
          bankName: cellValue(row, 3),
          accountHolder: cellValue(row, 4),
          accountNumber: cellValue(row, 5),
          baeminId: cellValue(row, 6),
          platformCoupangRaw: cellValue(row, 7),
          platformBaeminRaw: cellValue(row, 8),
          longEventItem: cellValue(row, 9),
          longEventStartDate: cellValue(row, 10),
          memo: cellValue(row, 11)
        }
      });
    });

    return dataRows;
  }

  function buildParsedRows(rows) {
    const batchMatchKeys = new Set();
    const batchBaeminIds = new Set();

    return rows.map(({ rowNumber, raw }) => {
      const result = validateRow(raw, rowNumber, batchMatchKeys, batchBaeminIds);
      if (result.valid) {
        const matchKey = makeDriverMatchKey(result.data.name, result.data.phone);
        if (matchKey) batchMatchKeys.add(matchKey);
        if (result.data.baeminId) batchBaeminIds.add(result.data.baeminId);
      }
      return result;
    });
  }

  function platformLabel(row) {
    const existing = row.matchedDriver;
    const coupang = row.data.platformCoupang !== undefined
      ? row.data.platformCoupang !== false
      : existing?.platformCoupang !== false;
    const baemin = row.data.platformBaemin !== undefined
      ? Boolean(row.data.platformBaemin)
      : Boolean(existing?.platformBaemin);
    const tags = [];
    if (coupang) tags.push('쿠팡');
    if (baemin) tags.push('배민');
    return tags.join('·') || '-';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function renderPreview() {
    const createRows = parsedRows.filter(row => row.valid && row.action === 'create');
    const updateRows = parsedRows.filter(row => row.valid && row.action === 'update');
    const issueRows = parsedRows.filter(row => row.isIssue);
    const processableCount = createRows.length + updateRows.length;

    totalCountEl.textContent = String(parsedRows.length);
    if (createCountEl) createCountEl.textContent = String(createRows.length);
    if (updateCountEl) updateCountEl.textContent = String(updateRows.length);
    if (issueCountEl) issueCountEl.textContent = String(issueRows.length);
    applyBtn.disabled = processableCount === 0;

    previewBody.innerHTML = parsedRows.map(row => {
      const rowClass = row.valid
        ? (row.action === 'update' ? 'row-update' : 'row-ok')
        : 'row-error';
      let resultHtml = row.action === 'update'
        ? '<span class="bulk-result-update">기존 업데이트</span>'
        : '<span class="bulk-result-ok">신규 등록</span>';
      if (!row.valid) {
        resultHtml = `<span class="bulk-result-err">${escapeHtml(row.errors.join(', '))}</span>`;
      }
      return `
        <tr class="${rowClass}">
          <td>${row.rowNumber}</td>
          <td>${escapeHtml(row.data.name || '-')}</td>
          <td>${escapeHtml(row.data.phone || '-')}</td>
          <td>${escapeHtml(row.loginId || '-')}</td>
          <td>${escapeHtml(platformLabel(row))}</td>
          <td>${resultHtml}</td>
        </tr>
      `;
    }).join('');

    previewSection.hidden = parsedRows.length === 0;
  }

  function syncDriverEventSettings(driverId, data, existingDriver) {
    const itemId = String(data.longEventItemId || '').trim();
    if (!itemId) return;

    const item = BremStorage.events.getCatalog().find(eventItem => eventItem.id === itemId);
    if (item) {
      BremStorage.events.setDriverItem(driverId, item);
      if (data.longEventStartDate) {
        BremStorage.events.setDriverStartDate(driverId, data.longEventStartDate);
      }
    }
  }

  function clearPreview() {
    parsedRows = [];
    fileInput.value = '';
    previewSection.hidden = true;
    previewBody.innerHTML = '';
    totalCountEl.textContent = '0';
    if (createCountEl) createCountEl.textContent = '0';
    if (updateCountEl) updateCountEl.textContent = '0';
    if (issueCountEl) issueCountEl.textContent = '0';
    applyBtn.disabled = true;
  }

  function switchMode(mode) {
    const isBulk = mode === 'bulk';
    tabSingle.classList.toggle('active', !isBulk);
    tabBulk.classList.toggle('active', isBulk);
    tabSingle.setAttribute('aria-selected', String(!isBulk));
    tabBulk.setAttribute('aria-selected', String(isBulk));
    driverForm.hidden = isBulk;
    bulkPanel.hidden = !isBulk;
    layout.classList.toggle('layout--bulk', isBulk);
    formSubtitle.textContent = isBulk
      ? '엑셀 파일로 여러 기사를 한 번에 등록합니다. 기존 기사(이름+연락처)는 병합 업데이트됩니다.'
      : '기사 기본 정보를 입력하고 저장하세요.';
  }

  function downloadTemplate() {
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }

    const header = BULK_COLUMNS.map(col => col.label + (col.required ? ' *' : ''));
    const sample = [
      '홍길동',
      '010-1234-5678',
      '920704-1850912',
      '국민은행',
      '홍길동',
      '110-123-456789',
      '',
      'Y',
      'N',
      '',
      '',
      '신규 기사'
    ];

    const sheet = XLSX.utils.aoa_to_sheet([header, sample]);
    sheet['!cols'] = [
      { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 18 },
      { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 24 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '기사등록');
    XLSX.writeFile(workbook, 'BREM_기사등록_양식.xlsx');
  }

  async function ensureStorageReadyForSave() {
    const resume = await BremStorage.resumeSupabaseAfterAuth?.();
    if (!resume?.ok) {
      throw new Error(resume?.message || 'Supabase에 연결되지 않았습니다. 관리자 화면에서 다시 로그인하세요.');
    }
  }

  async function handleFileChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
      const rows = parseWorkbookRows(workbook);

      if (!rows.length) {
        showToast('등록할 데이터 행이 없습니다. 2행부터 입력했는지 확인하세요.');
        clearPreview();
        return;
      }

      parsedRows = buildParsedRows(rows);
      renderPreview();

      const createCount = parsedRows.filter(row => row.valid && row.action === 'create').length;
      const updateCount = parsedRows.filter(row => row.valid && row.action === 'update').length;
      showToast(`미리보기 ${parsedRows.length}건 — 신규 ${createCount}명 · 업데이트 ${updateCount}명`);
    } catch (error) {
      console.error(error);
      showToast('엑셀 파일을 읽지 못했습니다.');
      clearPreview();
    }
  }

  async function applyBulk() {
    const processableRows = parsedRows.filter(row => row.valid);
    const issueRows = parsedRows.filter(row => row.isIssue);
    if (!processableRows.length) {
      showToast('등록 가능한 행이 없습니다.');
      return;
    }

    const createCount = processableRows.filter(row => row.action === 'create').length;
    const updateCount = processableRows.filter(row => row.action === 'update').length;

    let confirmMessage = `신규 ${createCount}명 · 업데이트 ${updateCount}명을 일괄 처리하시겠습니까?`;
    if (issueRows.length) {
      confirmMessage += `\n\n중복/오류 ${issueRows.length}건은 제외됩니다.`;
    }

    if (!window.confirm(confirmMessage)) return;

    applyBtn.disabled = true;
    const previousLabel = applyBtn.textContent;
    applyBtn.textContent = '처리 중…';

    let created = 0;
    let updated = 0;

    try {
      await ensureStorageReadyForSave();

      for (const row of processableRows) {
        if (row.action === 'update') {
          const changes = mergeBulkDriverData(row.matchedDriver, row.data, row.raw);
          if (Object.keys(changes).length) {
            await Promise.resolve(BremStorage.drivers.update(row.matchedDriver.id, changes));
            syncDriverEventSettings(
              row.matchedDriver.id,
              { ...row.matchedDriver, ...changes },
              row.matchedDriver
            );
          }
          updated += 1;
        } else {
          const createPayload = {
            ...row.data,
            platformCoupang: row.data.platformCoupang !== false,
            platformBaemin: Boolean(row.data.platformBaemin)
          };
          const driver = await Promise.resolve(BremStorage.drivers.create(createPayload));
          syncDriverEventSettings(driver.id, row.data);
          created += 1;
        }
      }

      await BremStorage.flushStorage?.();

      showToast(`신규등록 ${created}명 · 기존 업데이트 ${updated}명 · 중복/오류 ${issueRows.length}건`);
      clearPreview();

      if (window.BremDriverIndex && typeof window.BremDriverIndex.refresh === 'function') {
        window.BremDriverIndex.refresh();
      }
    } catch (error) {
      console.error(error);
      showToast(error.message || '일괄 등록에 실패했습니다.');
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = previousLabel;
    }
  }

  function init() {
    if (!bulkPanel) return;

    tabSingle.addEventListener('click', () => switchMode('single'));
    tabBulk.addEventListener('click', () => switchMode('bulk'));
    templateBtn.addEventListener('click', downloadTemplate);
    fileInput.addEventListener('change', handleFileChange);
    applyBtn.addEventListener('click', applyBulk);
    clearBtn.addEventListener('click', clearPreview);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
