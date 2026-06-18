(function () {
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
  const validCountEl = document.getElementById('bulkValidCount');
  const errorCountEl = document.getElementById('bulkErrorCount');
  const duplicateCountEl = document.getElementById('bulkDuplicateCount');
  const applyBtn = document.getElementById('bulkApplyBtn');
  const clearBtn = document.getElementById('bulkClearBtn');
  const toast = document.getElementById('toast');

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2400);
  }

  function normalizeDigits(value) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  function normalizePhone(value) {
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

  function resolvePlatforms(raw) {
    const baeminId = String(raw.baeminId || '').trim();
    let platformCoupang = parseYesNo(raw.platformCoupangRaw, true);
    let platformBaemin = parseYesNo(raw.platformBaeminRaw, Boolean(baeminId));

    if (baeminId && raw.platformBaeminRaw === '' && raw.platformCoupangRaw === '') {
      platformCoupang = true;
      platformBaemin = true;
    } else if (!baeminId && raw.platformBaeminRaw === '' && raw.platformCoupangRaw === '') {
      platformCoupang = true;
      platformBaemin = false;
    }

    return { baeminId, platformCoupang, platformBaemin };
  }

  function validateRow(raw, rowNumber, batchLoginIds, batchPhones, batchBaeminIds) {
    const errors = [];
    const name = String(raw.name || '').trim();
    const phone = normalizePhone(raw.phone);
    const residentNumber = normalizeDigits(raw.residentNumber || raw.password);
    const password = '1234';
    const joinDate = today();
    const status = '근무중';
    const memo = String(raw.memo || '').trim();
    const accountNumber = String(raw.accountNumber || '').trim();
    const bankName = String(raw.bankName || '').trim();
    const accountHolder = String(raw.accountHolder || '').trim();
    const longEventStartDate = parseExcelDate(raw.longEventStartDate);
    const platforms = resolvePlatforms(raw);
    const baeminId = platforms.baeminId;

    if (!name) errors.push('이름 누락');
    if (!phone) errors.push('연락처 누락');
    if (residentNumber && residentNumber.length !== 13) errors.push('주민등록번호 13자리 확인');

    if (!platforms.platformCoupang && !platforms.platformBaemin) {
      errors.push('쿠팡·배민 중 하나 이상 선택');
    }
    if (platforms.platformBaemin && !platforms.baeminId) {
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

    const loginId = name && phone ? makeLoginId(name, phone) : '';

    if (loginId && batchLoginIds.has(loginId)) errors.push('파일 내 쿠팡아이디 중복');
    if (phone && batchPhones.has(phone)) errors.push('파일 내 연락처 중복');
    if (baeminId && batchBaeminIds.has(baeminId)) errors.push('파일 내 배민아이디 중복');

    if (!errors.length) {
      const duplicate = window.BremDriverUtils.findDuplicateDriver({ name, phone, baeminId });
      if (duplicate) errors.push(`이미 등록된 기사 (${duplicate.reason})`);
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
      baeminId: platforms.baeminId,
      platformCoupang: platforms.platformCoupang,
      platformBaemin: platforms.platformBaemin,
      longEventItemId: eventItem ? eventItem.id : '',
      longEventItem: eventItem ? eventItem.name : '',
      longEventStartDate: longEventStartDate || '',
      memo
    };

    return {
      rowNumber,
      data,
      loginId,
      errors,
      valid: errors.length === 0,
      isDuplicate: window.BremDriverUtils.isDuplicateErrorMessage(errors)
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
    const batchLoginIds = new Set();
    const batchPhones = new Set();
    const batchBaeminIds = new Set();

    return rows.map(({ rowNumber, raw }) => {
      const result = validateRow(raw, rowNumber, batchLoginIds, batchPhones, batchBaeminIds);
      if (result.valid) {
        if (result.loginId) batchLoginIds.add(result.loginId);
        if (result.data.phone) batchPhones.add(result.data.phone);
        if (result.data.baeminId) batchBaeminIds.add(result.data.baeminId);
      }
      return result;
    });
  }

  function platformLabel(row) {
    const tags = [];
    if (row.data.platformCoupang) tags.push('쿠팡');
    if (row.data.platformBaemin) tags.push('배민');
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
    const validRows = parsedRows.filter(row => row.valid);
    const duplicateRows = parsedRows.filter(row => row.isDuplicate);
    const errorRows = parsedRows.filter(row => !row.valid && !row.isDuplicate);

    totalCountEl.textContent = String(parsedRows.length);
    validCountEl.textContent = String(validRows.length);
    if (duplicateCountEl) duplicateCountEl.textContent = String(duplicateRows.length);
    errorCountEl.textContent = String(errorRows.length);
    applyBtn.disabled = validRows.length === 0;

    previewBody.innerHTML = parsedRows.map(row => {
      const rowClass = row.valid ? 'row-ok' : row.isDuplicate ? 'row-duplicate' : 'row-error';
      let resultHtml = '<span class="bulk-result-ok">등록 가능</span>';
      if (!row.valid) {
        resultHtml = row.isDuplicate
          ? `<span class="bulk-result-dup">${escapeHtml(row.errors.join(', '))}</span>`
          : `<span class="bulk-result-err">${escapeHtml(row.errors.join(', '))}</span>`;
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

  function syncDriverEventSettings(driverId, data) {
    const item = BremStorage.events.getCatalog().find(eventItem => eventItem.id === data.longEventItemId);
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
    validCountEl.textContent = '0';
    errorCountEl.textContent = '0';
    if (duplicateCountEl) duplicateCountEl.textContent = '0';
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
      ? '엑셀 파일로 여러 기사를 한 번에 등록합니다.'
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
      showToast(`미리보기 ${parsedRows.length}건 — 등록 가능 ${parsedRows.filter(row => row.valid).length}건`);
    } catch (error) {
      console.error(error);
      showToast('엑셀 파일을 읽지 못했습니다.');
      clearPreview();
    }
  }

  function applyBulk() {
    const validRows = parsedRows.filter(row => row.valid);
    const duplicateRows = parsedRows.filter(row => row.isDuplicate);
    if (!validRows.length) {
      showToast('등록 가능한 행이 없습니다.');
      return;
    }

    let confirmMessage = `${validRows.length}명의 기사를 일괄 등록하시겠습니까?`;
    if (duplicateRows.length) {
      confirmMessage += `\n\n중복 ${duplicateRows.length}건은 자동으로 제외됩니다.`;
    }

    if (!window.confirm(confirmMessage)) return;

    let created = 0;
    validRows.forEach(row => {
      const driver = BremStorage.drivers.create(row.data);
      syncDriverEventSettings(driver.id, row.data);
      created += 1;
    });

    showToast(`${created}명 등록 완료${duplicateRows.length ? ` · 중복 ${duplicateRows.length}건 제외` : ''}`);
    clearPreview();

    if (window.BremDriverIndex && typeof window.BremDriverIndex.refresh === 'function') {
      window.BremDriverIndex.refresh();
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
