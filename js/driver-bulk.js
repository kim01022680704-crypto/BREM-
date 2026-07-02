(function () {
  const {
    makeDriverLoginId,
    makeDriverMatchKey,
    mergeBulkDriverData,
    describeBulkDriverChanges,
    prepareBulkRiderRecord,
    buildDriverDuplicateLookup,
    buildRiderMatchMap,
    normalizeBulkUploadRaw,
    isBulkUploadRowEmpty,
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
  const BULK_BATCH_SIZE = 300;
  const PREVIEW_LIMIT = 50;

  let parsedRows = [];
  let previewRowNumbers = new Set();

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
  const previewHighlights = document.getElementById('bulkPreviewHighlights');
  const previewCreateBox = document.getElementById('bulkPreviewCreateBox');
  const previewCreateBody = document.getElementById('bulkPreviewCreateBody');
  const previewCreateTitle = document.getElementById('bulkPreviewCreateTitle');
  const previewIssueBox = document.getElementById('bulkPreviewIssueBox');
  const previewIssueBody = document.getElementById('bulkPreviewIssueBody');
  const previewIssueTitle = document.getElementById('bulkPreviewIssueTitle');
  const totalCountEl = document.getElementById('bulkTotalCount');
  const createCountEl = document.getElementById('bulkCreateCount');
  const updateCountEl = document.getElementById('bulkUpdateCount');
  const unchangedCountEl = document.getElementById('bulkUnchangedCount');
  const issueCountEl = document.getElementById('bulkIssueCount');
  const applyBtn = document.getElementById('bulkApplyBtn');
  const clearBtn = document.getElementById('bulkClearBtn');
  const applyProgressEl = document.getElementById('bulkApplyProgress');
  const applyProgressFillEl = document.getElementById('bulkApplyProgressFill');
  const applyProgressTextEl = document.getElementById('bulkApplyProgressText');
  const applySummaryEl = document.getElementById('bulkApplySummary');
  const applySummaryTextEl = document.getElementById('bulkApplySummaryText');
  const applySummaryFailedEl = document.getElementById('bulkApplyFailedList');
  const toast = document.getElementById('toast');

  let isApplying = false;

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
    return window.BremDriverUtils.formatPhoneDisplay(value);
  }

  async function ensureAllDriversLoaded() {
    const status = BremStorage.getCacheStatus?.() || {};
    if (status.driversComplete && BremStorage.drivers.getAll().length > 0) {
      return { ok: true, cached: true };
    }
    const result = await BremStorage.fetchAllDriversFromServer?.({ force: false });
    if (!result?.ok && BremStorage.drivers.getAll().length > 0) {
      return { ok: true, cached: true, stale: true };
    }
    return result || { ok: true, cached: true };
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

  function validateRow(raw, rowNumber, batchMatchKeys, batchBaeminIds, lookup, riderMatchMap) {
    const errors = [];
    const name = String(raw.name || '').trim();
    const phone = normalizePhoneDisplay(raw.phone);
    const residentNumber = normalizeDigits(raw.residentNumber || raw.password);
    const joinDate = today();
    const status = '근무중';
    const memo = String(raw.memo || '').trim();
    const accountNumber = String(raw.accountNumber || '').trim();
    const bankName = String(raw.bankName || '').trim();
    const accountHolder = String(raw.accountHolder || '').trim();
    const longEventStartDate = parseExcelDate(raw.longEventStartDate);
    const matchKey = makeDriverMatchKey(name, phone);
    const matchedDriver = matchKey ? (riderMatchMap.get(matchKey) || null) : null;
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

    const loginId = name && phone ? makeLoginId(name, phone) : '';

    if (matchKey && batchMatchKeys.has(matchKey)) errors.push('파일 내 이름+연락처 중복');
    if (baeminId && batchBaeminIds.has(baeminId)) errors.push('파일 내 배민아이디 중복');

    const lookupTable = lookup || buildDriverDuplicateLookup();
    if (!isUpdate && loginId && lookupTable.byLoginId.has(loginId)) {
      const conflict = lookupTable.byLoginId.get(loginId);
      if (makeDriverMatchKey(conflict.name, conflict.phone) !== matchKey) {
        errors.push('쿠팡아이디(이름+연락처 뒤4자리) 중복');
      }
    }
    if (baeminId && lookupTable.byBaeminId.has(baeminId)) {
      const conflict = lookupTable.byBaeminId.get(baeminId);
      if (!matchedDriver || conflict.id !== matchedDriver.id) {
        errors.push('다른 기사에 등록된 배민아이디');
      }
    }

    const data = {
      name,
      phone,
      residentNumber,
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

    if (!isUpdate) {
      data.password = '1234';
    }

    const bulkChanges = isUpdate && matchedDriver
      ? mergeBulkDriverData(matchedDriver, data, raw)
      : {};
    const action = isUpdate
      ? (Object.keys(bulkChanges).length ? 'update' : 'unchanged')
      : 'create';

    return {
      rowNumber,
      raw,
      data,
      loginId,
      matchedDriver,
      bulkChanges,
      action,
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

      const raw = normalizeBulkUploadRaw({
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
      });

      if (isBulkUploadRowEmpty(raw)) return;

      dataRows.push({
        rowNumber: excelRowNumber,
        raw
      });
    });

    return dataRows;
  }

  function buildParsedRows(rows, existingDrivers) {
    const batchMatchKeys = new Set();
    const batchBaeminIds = new Set();
    const drivers = Array.isArray(existingDrivers) ? existingDrivers : BremStorage.drivers.getAll();
    const riderMatchMap = buildRiderMatchMap(drivers);
    const lookup = buildDriverDuplicateLookup(undefined, drivers);

    return rows.map(({ rowNumber, raw }) => {
      const result = validateRow(raw, rowNumber, batchMatchKeys, batchBaeminIds, lookup, riderMatchMap);
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

  function getRowClass(row) {
    if (row.applyStatus === 'processing') return 'row-processing';
    if (row.applyStatus === 'done') return 'row-done';
    if (row.applyStatus === 'failed' || row.isIssue) return 'row-failed';
    if (row.valid && row.action === 'unchanged') return 'row-unchanged';
    if (row.valid) return row.action === 'update' ? 'row-update' : 'row-ok';
    return 'row-error';
  }

  function getRowResultHtml(row) {
    if (row.applyStatus === 'processing') {
      return '<span class="bulk-result-processing">처리 중…</span>';
    }
    if (row.applyStatus === 'done') {
      const label = row.applyAction === 'update' ? '업데이트 완료!' : '등록완료!';
      return `<span class="bulk-result-done">${label}</span>`;
    }
    if (row.applyStatus === 'failed') {
      return `<span class="bulk-result-err">${escapeHtml(row.applyMessage || '등록실패')}</span>`;
    }
    if (!row.valid) {
      return `<span class="bulk-result-err">${escapeHtml(row.errors.join(', '))}</span>`;
    }
    if (row.action === 'unchanged') {
      return '<span class="bulk-result-unchanged">변경 없음</span>';
    }
    if (row.action === 'update') {
      const detail = describeBulkDriverChanges(row.bulkChanges);
      return `<span class="bulk-result-update">기존 업데이트${detail ? ` · ${escapeHtml(detail)}` : ''}</span>`;
    }
    return '<span class="bulk-result-ok">신규 등록</span>';
  }

  function findPreviewRow(rowNumber) {
    return previewBody?.querySelector(`tr[data-bulk-row="${rowNumber}"]`) || null;
  }

  function updatePreviewRowStatus(row) {
    const tr = findPreviewRow(row.rowNumber);
    if (!tr) return;
    tr.className = getRowClass(row);
    const resultCell = tr.querySelector('.bulk-row-result');
    if (resultCell) resultCell.innerHTML = getRowResultHtml(row);
    if (row.applyStatus === 'processing' && row.rowNumber % 10 === 0) {
      tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function resetApplyUi() {
    if (applyProgressEl) applyProgressEl.hidden = true;
    if (applySummaryEl) {
      applySummaryEl.hidden = true;
      applySummaryEl.classList.remove('is-partial');
    }
    if (applyProgressFillEl) applyProgressFillEl.style.width = '0%';
    if (applyProgressTextEl) applyProgressTextEl.textContent = '처리 중…';
    if (applySummaryTextEl) applySummaryTextEl.textContent = '';
    if (applySummaryFailedEl) {
      applySummaryFailedEl.hidden = true;
      applySummaryFailedEl.innerHTML = '';
    }
  }

  function setApplyUiActive(active) {
    isApplying = active;
    if (applyProgressEl) applyProgressEl.hidden = !active;
    if (applySummaryEl) applySummaryEl.hidden = active;
    if (applyBtn) applyBtn.disabled = active || parsedRows.filter(row => row.valid).length === 0;
    if (clearBtn) clearBtn.disabled = active;
    if (templateBtn) templateBtn.disabled = active;
    if (fileInput) fileInput.disabled = active;
  }

  function updateApplyProgress(current, total, created, updated, failed) {
    const percent = total ? Math.round((current / total) * 100) : 0;
    if (applyProgressFillEl) applyProgressFillEl.style.width = `${percent}%`;
    if (applyProgressTextEl) {
      applyProgressTextEl.textContent = `${current}/${total} 저장 중 · 신규 ${created} · 업데이트 ${updated} · 실패 ${failed}`;
    }
  }

  function formatFailedRiderLabel(row) {
    const name = String(row.data?.name || '').trim() || '-';
    const phone = String(row.data?.phone || '').trim() || '-';
    return `${name} (${phone})`;
  }

  function renderFailedRidersList(failedRows) {
    if (!applySummaryFailedEl) return;
    if (!failedRows.length) {
      applySummaryFailedEl.hidden = true;
      applySummaryFailedEl.innerHTML = '';
      return;
    }

    applySummaryFailedEl.hidden = false;
    applySummaryFailedEl.innerHTML = `
      <p class="bulk-failed-title">실패한 기사 (${failedRows.length}명)</p>
      <ul class="bulk-failed-list">
        ${failedRows.map(row => `
          <li>
            <span class="bulk-failed-name">${escapeHtml(formatFailedRiderLabel(row))}</span>
            <span class="bulk-failed-meta">${row.rowNumber}행 · ${escapeHtml(row.applyMessage || '등록실패')}</span>
          </li>
        `).join('')}
      </ul>
    `;
  }

  function showApplySummary(created, updated, failedRows, skipped) {
    if (applyProgressEl) applyProgressEl.hidden = true;
    if (!applySummaryEl || !applySummaryTextEl) return;

    const failedCount = failedRows.length;
    applySummaryEl.hidden = false;
    applySummaryEl.classList.toggle('is-partial', failedCount > 0 || skipped > 0);
    applySummaryTextEl.textContent = `신규등록 ${created}명 · 업데이트 ${updated}명 · 실패 ${failedCount}명${skipped ? ` · 사전 오류 ${skipped}건` : ''}`;
    renderFailedRidersList(failedRows);
  }

  function yieldToUi(index) {
    if (index % 10 !== 0) return Promise.resolve();
    return new Promise(resolve => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  function prepareRiderForBulk(row) {
    return prepareBulkRiderRecord(row, data => BremStorage.drivers.buildNewDriver(data));
  }

  function buildBulkSavePlan(processableRows) {
    return processableRows
      .map(row => ({
        row,
        rider: prepareRiderForBulk(row),
        action: row.action
      }))
      .filter(entry => entry.rider);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function renderPreviewDataRow(row, options = {}) {
    const includeResult = options.includeResult !== false;
    const includeReason = Boolean(options.includeReason);
    const reasonText = options.reasonFromChanges
      ? describeBulkDriverChanges(row.bulkChanges)
      : row.errors.join(', ');
    return `
      <tr class="${getRowClass(row)}" data-bulk-row="${row.rowNumber}">
        <td>${row.rowNumber}</td>
        <td>${escapeHtml(row.data.name || '-')}</td>
        <td>${escapeHtml(row.data.phone || '-')}</td>
        <td>${escapeHtml(row.loginId || '-')}</td>
        <td>${escapeHtml(platformLabel(row))}</td>
        ${includeResult ? `<td class="bulk-row-result">${getRowResultHtml(row)}</td>` : ''}
        ${includeReason ? `<td class="bulk-row-reason">${escapeHtml(reasonText || '-')}</td>` : ''}
      </tr>
    `;
  }

  function renderPreviewHighlights(createRows, updateRows, issueRows) {
    const hasCreate = createRows.length > 0;
    const hasUpdate = updateRows.length > 0;
    const hasIssue = issueRows.length > 0;
    const showHighlights = hasCreate || hasUpdate || hasIssue;

    if (previewHighlights) previewHighlights.hidden = !showHighlights;

    if (previewCreateBox) previewCreateBox.hidden = !hasCreate;
    if (previewCreateTitle) previewCreateTitle.textContent = String(createRows.length);
    if (previewCreateBody) {
      previewCreateBody.innerHTML = hasCreate
        ? createRows.map(row => renderPreviewDataRow(row, { includeResult: false })).join('')
        : '';
    }

    const previewUpdateBox = document.getElementById('bulkPreviewUpdateBox');
    const previewUpdateBody = document.getElementById('bulkPreviewUpdateBody');
    const previewUpdateTitle = document.getElementById('bulkPreviewUpdateTitle');
    if (previewUpdateBox) previewUpdateBox.hidden = !hasUpdate;
    if (previewUpdateTitle) previewUpdateTitle.textContent = String(updateRows.length);
    if (previewUpdateBody) {
      previewUpdateBody.innerHTML = hasUpdate
        ? updateRows.map(row => renderPreviewDataRow(row, { includeResult: false, includeReason: true, reasonFromChanges: true })).join('')
        : '';
    }

    if (previewIssueBox) previewIssueBox.hidden = !hasIssue;
    if (previewIssueTitle) previewIssueTitle.textContent = String(issueRows.length);
    if (previewIssueBody) {
      previewIssueBody.innerHTML = hasIssue
        ? issueRows.map(row => renderPreviewDataRow(row, { includeResult: false, includeReason: true })).join('')
        : '';
    }
  }

  function renderPreview() {
    const createRows = parsedRows.filter(row => row.valid && row.action === 'create');
    const updateRows = parsedRows.filter(row => row.valid && row.action === 'update');
    const unchangedRows = parsedRows.filter(row => row.valid && row.action === 'unchanged');
    const issueRows = parsedRows.filter(row => row.isIssue);
    const processableCount = createRows.length + updateRows.length;

    totalCountEl.textContent = String(parsedRows.length);
    if (createCountEl) createCountEl.textContent = String(createRows.length);
    if (updateCountEl) updateCountEl.textContent = String(updateRows.length);
    if (unchangedCountEl) unchangedCountEl.textContent = String(unchangedRows.length);
    if (issueCountEl) issueCountEl.textContent = String(issueRows.length);
    applyBtn.disabled = processableCount === 0 || isApplying;

    const previewRows = parsedRows.slice(0, PREVIEW_LIMIT);
    previewRowNumbers = new Set(previewRows.map(row => row.rowNumber));
    const hiddenCount = Math.max(0, parsedRows.length - previewRows.length);

    previewBody.innerHTML = [
      ...previewRows.map(row => renderPreviewDataRow(row)),
      hiddenCount > 0 ? `
        <tr class="row-preview-more">
          <td colspan="6">외 ${hiddenCount}건 — 저장 시 전체 ${parsedRows.length}건이 처리됩니다 (미리보기 ${PREVIEW_LIMIT}건만 표시)</td>
        </tr>
      ` : ''
    ].join('');

    renderPreviewHighlights(createRows, updateRows, issueRows);
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
    if (previewHighlights) previewHighlights.hidden = true;
    if (previewCreateBox) previewCreateBox.hidden = true;
    if (previewCreateBody) previewCreateBody.innerHTML = '';
    if (previewIssueBox) previewIssueBox.hidden = true;
    if (previewIssueBody) previewIssueBody.innerHTML = '';
    previewRowNumbers = new Set();
    totalCountEl.textContent = '0';
    if (createCountEl) createCountEl.textContent = '0';
    if (updateCountEl) updateCountEl.textContent = '0';
    if (unchangedCountEl) unchangedCountEl.textContent = '0';
    if (issueCountEl) issueCountEl.textContent = '0';
    applyBtn.disabled = true;
    resetApplyUi();
    setApplyUiActive(false);
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
      ? '엑셀 파일로 여러 기사를 한 번에 등록합니다. 기존 기사는 비어 있는 칸만 채우며, 비밀번호는 변경되지 않습니다.'
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
      '000000-0000000',
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

      showToast('기존 기사 목록 불러오는 중…');
      await ensureAllDriversLoaded();

      parsedRows = buildParsedRows(rows, BremStorage.drivers.getAll());
      resetApplyUi();
      renderPreview();

      const createCount = parsedRows.filter(row => row.valid && row.action === 'create').length;
      const updateCount = parsedRows.filter(row => row.valid && row.action === 'update').length;
      const unchangedCount = parsedRows.filter(row => row.valid && row.action === 'unchanged').length;
      showToast(`미리보기 ${parsedRows.length}건 — 신규 ${createCount}명 · 변경 ${updateCount}명 · 변경없음 ${unchangedCount}명`);
    } catch (error) {
      console.error(error);
      showToast('엑셀 파일을 읽지 못했습니다.');
      clearPreview();
    }
  }

  async function applyBulk() {
    const processableRows = parsedRows.filter(row => row.valid && row.action !== 'unchanged');
    const issueRows = parsedRows.filter(row => row.isIssue);
    const unchangedRows = parsedRows.filter(row => row.valid && row.action === 'unchanged');
    if (!processableRows.length) {
      showToast(unchangedRows.length
        ? '변경할 내용이 없습니다. 빈 칸을 채울 값만 업로드하세요.'
        : '등록 가능한 행이 없습니다.');
      return;
    }

    const createCount = processableRows.filter(row => row.action === 'create').length;
    const updateCount = processableRows.filter(row => row.action === 'update').length;

    let confirmMessage = `신규 ${createCount}명 · 변경 ${updateCount}명을 일괄 처리하시겠습니까?\n\n기존 기사는 빈 칸만 채워지며, 비밀번호와 이미 등록된 값은 변경되지 않습니다.`;
    if (unchangedRows.length) {
      confirmMessage += `\n\n변경 없음 ${unchangedRows.length}건은 저장하지 않습니다.`;
    }
    if (issueRows.length) {
      confirmMessage += `\n\n중복/오류 ${issueRows.length}건은 제외됩니다.`;
    }

    if (!window.confirm(confirmMessage)) return;

    resetApplyUi();
    setApplyUiActive(true);
    const previousLabel = applyBtn.textContent;
    applyBtn.textContent = '처리 중…';

    let created = 0;
    let updated = 0;
    const failedRows = [];
    let savePlan = [];
    let total = 0;
    let current = 0;
    const eventSyncQueue = [];

    function markRowFailed(entry, message) {
      if (entry.row.applyStatus === 'failed') return;
      entry.row.applyStatus = 'failed';
      entry.row.applyMessage = message || '등록실패';
      failedRows.push(entry.row);
      if (previewRowNumbers.has(entry.row.rowNumber)) {
        updatePreviewRowStatus(entry.row);
      }
    }

    try {
      await ensureStorageReadyForSave();
      await ensureAllDriversLoaded();

      savePlan = buildBulkSavePlan(processableRows);
      if (!savePlan.length) {
        showToast('저장할 변경 내용이 없습니다.');
        return;
      }

      total = savePlan.length;
      updateApplyProgress(0, total, 0, 0, 0);

      for (let offset = 0; offset < savePlan.length; offset += BULK_BATCH_SIZE) {
        const batch = savePlan.slice(offset, offset + BULK_BATCH_SIZE);
        const riders = batch.map(entry => entry.rider);

        try {
          await BremStorage.drivers.bulkUpsert(riders, {
            skipAuthProvision: true,
            maxBatch: BULK_BATCH_SIZE
          });

          batch.forEach(entry => {
            entry.row.applyStatus = 'done';
            entry.row.applyAction = entry.action;
            if (entry.action === 'create') created += 1;
            else updated += 1;
            if (previewRowNumbers.has(entry.row.rowNumber)) {
              updatePreviewRowStatus(entry.row);
            }
            if (String(entry.row.data.longEventItemId || '').trim()) {
              eventSyncQueue.push({ rider: entry.rider, data: entry.row.data });
            }
          });
        } catch (error) {
          const message = error.message || '등록실패';
          batch.forEach(entry => markRowFailed(entry, message));
        }

        current = offset + batch.length;
        updateApplyProgress(current, total, created, updated, failedRows.length);
        await yieldToUi(current);
      }

      eventSyncQueue.forEach(({ rider, data }) => {
        syncDriverEventSettings(rider.id, { ...rider, ...data });
      });

      document.dispatchEvent(new CustomEvent('brem-cache-status-changed'));
      document.dispatchEvent(new CustomEvent('brem-drivers-sync-ready', {
        detail: { complete: true, count: BremStorage.drivers.getAll().length }
      }));

      showApplySummary(created, updated, failedRows, issueRows.length);
      if (failedRows.length) {
        const failedNames = failedRows.slice(0, 5).map(formatFailedRiderLabel).join(', ');
        const moreCount = failedRows.length > 5 ? ` 외 ${failedRows.length - 5}명` : '';
        showToast(`실패 ${failedRows.length}명: ${failedNames}${moreCount}`);
      } else {
        showToast(`신규등록 ${created}명 · 변경 ${updated}명 · 실패 0명${issueRows.length ? ` · 사전 오류 ${issueRows.length}건` : ''}${unchangedRows.length ? ` · 변경없음 ${unchangedRows.length}건` : ''}`);
      }

      if (window.BremDriverIndex && typeof window.BremDriverIndex.refresh === 'function') {
        window.BremDriverIndex.refresh();
      }
    } catch (error) {
      console.error(error);
      const message = error.message || '일괄 등록에 실패했습니다.';
      savePlan.slice(current).forEach(entry => {
        if (entry.row.applyStatus !== 'done') {
          markRowFailed(entry, message);
        }
      });
      showApplySummary(created, updated, failedRows, issueRows.length);
      showToast(message);
    } finally {
      setApplyUiActive(false);
      applyBtn.disabled = true;
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
