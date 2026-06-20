(function () {
  const PLATFORM_CONFIG = {
    coupang: {
      rateLabel: '거절율',
      idLabel: '쿠팡아이디',
      templateFile: 'BREM_쿠팡_거절율_양식.xlsx',
      sheetName: '거절율',
      weekInputId: 'rejectionWeekDate-coupang',
      idHeaderHints: ['쿠팡아이디', '쿠팡 아이디', 'coupang'],
      rateHeaderHints: ['거절율', '거절']
    },
    baemin: {
      rateLabel: '수락율',
      idLabel: '배민아이디',
      templateFile: 'BREM_배민_수락율_양식.xlsx',
      sheetName: '수락율',
      weekInputId: 'rejectionWeekDate-baemin',
      idHeaderHints: ['배민아이디', '배민 아이디', 'baemin'],
      rateHeaderHints: ['수락율', '수락', '거절율', '거절']
    }
  };

  const COMBINED_TEMPLATE = 'BREM_거절율_수락율_통합_양식.xlsx';

  function normalizePlatform(platform) {
    return BremPlatforms.normalize(platform);
  }

  function normalizePhone(value) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  function normalizeLoginId(value) {
    return String(value || '').replace(/\s/g, '');
  }

  function normalizeHeader(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  }

  function makeDriverLoginId(driver) {
    return `${String(driver.name || '').replace(/\s/g, '')}${normalizePhone(driver.phone).slice(-4)}`;
  }

  function formatDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(`${value}T00:00:00`));
  }

  function weekStartKey(dateValue) {
    return BremDatePicker.weekStartKey(dateValue);
  }

  function weekEndKey(weekStart) {
    const end = new Date(`${weekStart}T00:00:00`);
    end.setDate(end.getDate() + 6);
    return [
      end.getFullYear(),
      String(end.getMonth() + 1).padStart(2, '0'),
      String(end.getDate()).padStart(2, '0')
    ].join('-');
  }

  function cellValue(row, index) {
    if (!row || index < 0 || index >= row.length) return '';
    const value = row[index];
    if (value === undefined || value === null) return '';
    return value;
  }

  function hasCellText(value) {
    return String(value ?? '').trim() !== '';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function findDriverByCoupangId(coupangId) {
    const normalized = normalizeLoginId(coupangId);
    if (!normalized) return null;
    return BremStorage.drivers.getAll().find(driver => makeDriverLoginId(driver) === normalized) || null;
  }

  function findDriverByBaeminId(baeminId) {
    const normalized = String(baeminId || '').trim();
    if (!normalized) return null;
    return BremStorage.drivers.getAll().find(driver => String(driver.baeminId || '').trim() === normalized) || null;
  }

  function findDriverByPlatformId(platformId, platform) {
    return normalizePlatform(platform) === 'baemin'
      ? findDriverByBaeminId(platformId)
      : findDriverByCoupangId(platformId);
  }

  function getSelectedWeekStart(config) {
    const input = document.getElementById(config.weekInputId);
    const value = input?.value;
    if (!value) return '';
    return weekStartKey(value);
  }

  function weekLabel(weekStart) {
    if (!weekStart) return '-';
    return `${formatDate(weekStart)} ~ ${formatDate(weekEndKey(weekStart))}`;
  }

  function notify(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function parseRate(value) {
    return Number(String(value ?? '').replace(',', '.').trim());
  }

  function validatePlatformEntry(raw, rowNumber, config, weekStart, platform) {
    const errors = [];
    const platformId = normalizePlatform(platform) === 'baemin'
      ? String(raw.platformId || '').trim()
      : normalizeLoginId(raw.platformId);
    const rate = parseRate(raw.rate);
    const hasId = hasCellText(platformId);
    const hasRate = hasCellText(raw.rate);

    if (!hasId && !hasRate) {
      return { skip: true };
    }
    if (!hasId) errors.push(`${config.idLabel} 누락`);
    if (!hasRate) errors.push(`${config.rateLabel} 누락`);
    if (!weekStart) errors.push('상단 적용주 선택 필요');
    if (hasRate && Number.isNaN(rate)) errors.push(`${config.rateLabel} 숫자 아님`);
    else if (hasRate && (rate < 0 || rate > 100)) errors.push(`${config.rateLabel} 0~100 범위`);

    const driver = hasId ? findDriverByPlatformId(platformId, platform) : null;
    if (hasId && !driver) errors.push('등록된 기사 없음');

    return {
      skip: false,
      rowNumber,
      valid: errors.length === 0,
      errors,
      data: {
        driverId: driver?.id || '',
        driverName: driver?.name || raw.name || platformId,
        excelName: String(raw.name || '').trim(),
        platformId,
        weekStart,
        weekLabel: weekLabel(weekStart),
        rate,
        platform
      }
    };
  }

  function markDuplicateRows(rows) {
    const lastRowByKey = new Map();
    rows.forEach(row => {
      if (row.valid && row.data?.platformId) {
        lastRowByKey.set(`${row.data.platform}:${row.data.platformId}`, row.rowNumber);
      }
    });

    return rows.map(row => {
      if (!row.valid || !row.data?.platformId) return row;
      const key = `${row.data.platform}:${row.data.platformId}`;
      if (lastRowByKey.get(key) !== row.rowNumber) {
        return { ...row, note: '파일 내 중복 — 아래 행 값 적용' };
      }
      return row;
    });
  }

  function headerMatches(value, hints) {
    const normalized = normalizeHeader(value);
    return hints.some(hint => normalized.includes(normalizeHeader(hint)));
  }

  function detectPlatformHeaderRow(row, platform) {
    const config = PLATFORM_CONFIG[platform];
    const joined = row.map(cell => normalizeHeader(cell)).join('|');
    if (joined.includes('쿠팡') && joined.includes('배민')) return false;
    return row.some(cell => headerMatches(cell, config.idHeaderHints))
      || row.some(cell => headerMatches(cell, config.rateHeaderHints))
      || (joined.includes('이름') && joined.includes('아이디'));
  }

  function buildPlatformColumnMap(headerRow, platform) {
    const config = PLATFORM_CONFIG[platform];
    const map = { name: -1, platformId: -1, rate: -1 };

    headerRow.forEach((cell, index) => {
      const normalized = normalizeHeader(cell);
      if (!normalized) return;
      if (normalized === '이름' || normalized.includes('기사명')) {
        if (map.name < 0) map.name = index;
      }
      if (headerMatches(cell, config.idHeaderHints)) map.platformId = index;
      if (headerMatches(cell, config.rateHeaderHints)) map.rate = index;
    });

    if (map.platformId < 0 && map.rate < 0) {
      map.platformId = 0;
      map.rate = 1;
    } else {
      if (map.platformId < 0) map.platformId = 0;
      if (map.rate < 0) map.rate = map.platformId === 0 ? 1 : map.platformId + 1;
    }

    if (map.name < 0 && headerRow.length >= 3 && map.platformId === 1 && map.rate === 2) {
      map.name = 0;
    }

    return map;
  }

  function readSheetRows(workbook) {
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  }

  function parsePlatformWorkbookRows(workbook, platform) {
    const config = PLATFORM_CONFIG[platform];
    const rows = readSheetRows(workbook);
    let columnMap = { name: -1, platformId: 0, rate: 1 };
    let dataStartIndex = 0;

    for (let index = 0; index < Math.min(rows.length, 5); index += 1) {
      const row = rows[index];
      if (!row || !row.some(cell => hasCellText(cell))) continue;
      if (detectPlatformHeaderRow(row, platform)) {
        columnMap = buildPlatformColumnMap(row, platform);
        dataStartIndex = index + 1;
        break;
      }
    }

    const dataRows = [];
    rows.slice(dataStartIndex).forEach((row, offset) => {
      const excelRowNumber = dataStartIndex + offset + 1;
      if (!row || !row.some(cell => hasCellText(cell))) return;

      const raw = {
        name: columnMap.name >= 0 ? cellValue(row, columnMap.name) : '',
        platformId: cellValue(row, columnMap.platformId),
        rate: cellValue(row, columnMap.rate)
      };

      if (!hasCellText(raw.platformId) && !hasCellText(raw.rate)) return;

      dataRows.push({ rowNumber: excelRowNumber, raw });
    });

    return dataRows;
  }

  function detectCombinedHeaderRow(row) {
    const joined = row.map(cell => normalizeHeader(cell)).join('|');
    return joined.includes('쿠팡') && joined.includes('배민');
  }

  function buildCombinedColumnMap(headerRow) {
    const map = {
      coupangName: -1,
      coupangId: -1,
      coupangRate: -1,
      baeminName: -1,
      baeminId: -1,
      baeminRate: -1
    };

    headerRow.forEach((cell, index) => {
      const normalized = normalizeHeader(cell);
      if (!normalized) return;
      if (normalized.includes('쿠팡') && normalized.includes('아이디')) map.coupangId = index;
      if (normalized.includes('배민') && normalized.includes('아이디')) map.baeminId = index;
      if (normalized.includes('쿠팡') === false && normalized.includes('배민') === false) {
        if (normalized.includes('거절')) map.coupangRate = index;
      }
      if (normalized.includes('수락') || (normalized.includes('거절') && map.coupangRate !== index)) {
        if (index > (map.coupangRate >= 0 ? map.coupangRate : -1)) map.baeminRate = index;
      }
      if (normalized === '이름') {
        if (map.coupangName < 0) map.coupangName = index;
        else if (map.baeminName < 0) map.baeminName = index;
      }
    });

    if (map.coupangId < 0 && map.baeminId < 0 && headerRow.length >= 6) {
      return { coupangName: 0, coupangId: 1, coupangRate: 2, baeminName: 3, baeminId: 4, baeminRate: 5 };
    }

    if (map.coupangRate < 0 && map.coupangId >= 0) map.coupangRate = map.coupangId + 1;
    if (map.baeminRate < 0 && map.baeminId >= 0) map.baeminRate = map.baeminId + 1;

    return map;
  }

  function parseCombinedWorkbookRows(workbook) {
    const rows = readSheetRows(workbook);
    let columnMap = buildCombinedColumnMap(['이름', '쿠팡아이디', '거절율', '이름', '배민아이디', '수락율']);
    let dataStartIndex = 0;

    for (let index = 0; index < Math.min(rows.length, 5); index += 1) {
      const row = rows[index];
      if (!row || !row.some(cell => hasCellText(cell))) continue;
      if (detectCombinedHeaderRow(row)) {
        columnMap = buildCombinedColumnMap(row);
        dataStartIndex = index + 1;
        break;
      }
    }

    const dataRows = [];
    rows.slice(dataStartIndex).forEach((row, offset) => {
      const excelRowNumber = dataStartIndex + offset + 1;
      if (!row || !row.some(cell => hasCellText(cell))) return;

      const raw = {
        coupangName: columnMap.coupangName >= 0 ? cellValue(row, columnMap.coupangName) : '',
        coupangId: columnMap.coupangId >= 0 ? cellValue(row, columnMap.coupangId) : '',
        coupangRate: columnMap.coupangRate >= 0 ? cellValue(row, columnMap.coupangRate) : '',
        baeminName: columnMap.baeminName >= 0 ? cellValue(row, columnMap.baeminName) : '',
        baeminId: columnMap.baeminId >= 0 ? cellValue(row, columnMap.baeminId) : '',
        baeminRate: columnMap.baeminRate >= 0 ? cellValue(row, columnMap.baeminRate) : ''
      };

      const hasAny = [
        raw.coupangId, raw.coupangRate, raw.baeminId, raw.baeminRate
      ].some(hasCellText);
      if (!hasAny) return;

      dataRows.push({ rowNumber: excelRowNumber, raw });
    });

    return dataRows;
  }

  function validateCombinedRows(rows) {
    const coupangWeek = getSelectedWeekStart(PLATFORM_CONFIG.coupang);
    const baeminWeek = getSelectedWeekStart(PLATFORM_CONFIG.baemin);

    return rows.map(({ rowNumber, raw }) => {
      const coupang = validatePlatformEntry(
        { name: raw.coupangName, platformId: raw.coupangId, rate: raw.coupangRate },
        rowNumber,
        PLATFORM_CONFIG.coupang,
        coupangWeek,
        'coupang'
      );
      const baemin = validatePlatformEntry(
        { name: raw.baeminName, platformId: raw.baeminId, rate: raw.baeminRate },
        rowNumber,
        PLATFORM_CONFIG.baemin,
        baeminWeek,
        'baemin'
      );

      const entries = [];
      if (!coupang.skip) entries.push(coupang);
      if (!baemin.skip) entries.push(baemin);

      const validCount = entries.filter(entry => entry.valid).length;
      const errorMessages = entries.filter(entry => !entry.valid).flatMap(entry => entry.errors);

      return {
        rowNumber,
        raw,
        entries,
        valid: validCount > 0,
        errors: errorMessages,
        coupang,
        baemin
      };
    });
  }

  function renderResultCell(row) {
    if (!row.valid) {
      return `<span class="bulk-result-err">${escapeHtml(row.errors.join(', ') || '오류')}</span>`;
    }
    if (row.note) {
      return `<span class="bulk-result-warn">${escapeHtml(row.note)}</span>`;
    }
    return '<span class="bulk-result-ok">등록 가능</span>';
  }

  function initPlatform(root) {
    const platform = normalizePlatform(root.dataset.rejectionBulk);
    const config = PLATFORM_CONFIG[platform];
    if (!config) return;

    let parsedRows = [];
    let sourceRows = [];

    const templateBtn = root.querySelector('[data-rejection-bulk-template]');
    const fileInput = root.querySelector('[data-rejection-bulk-file]');
    const previewSection = root.querySelector('[data-rejection-bulk-preview]');
    const previewBody = root.querySelector('[data-rejection-bulk-preview-body]');
    const previewHead = root.querySelector('[data-rejection-bulk-preview-head]');
    const totalCountEl = root.querySelector('[data-rejection-bulk-total]');
    const validCountEl = root.querySelector('[data-rejection-bulk-valid]');
    const errorCountEl = root.querySelector('[data-rejection-bulk-error]');
    const weekNoteEl = root.querySelector('[data-rejection-bulk-week-note]');
    const applyBtn = root.querySelector('[data-rejection-bulk-apply]');
    const clearBtn = root.querySelector('[data-rejection-bulk-clear]');

    function updateWeekNote() {
      if (!weekNoteEl) return;
      const weekStart = getSelectedWeekStart(config);
      weekNoteEl.textContent = weekStart
        ? `저장 적용주: ${weekLabel(weekStart)} · 같은 기사·같은 주는 마지막 값이 최종 적용됩니다.`
        : '상단에서 적용주(수요일)를 먼저 선택하세요.';
    }

    function clearPreview() {
      parsedRows = [];
      sourceRows = [];
      if (fileInput) fileInput.value = '';
      if (previewSection) previewSection.hidden = true;
      if (previewBody) previewBody.innerHTML = '';
      if (totalCountEl) totalCountEl.textContent = '0';
      if (validCountEl) validCountEl.textContent = '0';
      if (errorCountEl) errorCountEl.textContent = '0';
      if (applyBtn) applyBtn.disabled = true;
      updateWeekNote();
    }

    function renderPreviewHead() {
      if (!previewHead) return;
      previewHead.innerHTML = `
        <th>행</th>
        <th>이름</th>
        <th>기사</th>
        <th>${config.idLabel}</th>
        <th>적용주</th>
        <th>${config.rateLabel}</th>
        <th>결과</th>
      `;
    }

    function validateRows(rows) {
      const weekStart = getSelectedWeekStart(config);
      const validated = rows
        .map(({ rowNumber, raw }) => validatePlatformEntry(raw, rowNumber, config, weekStart, platform))
        .filter(row => !row.skip)
        .map(row => ({ ...row, data: { ...row.data, platform } }));
      return markDuplicateRows(validated);
    }

    function renderPreview() {
      const validRows = parsedRows.filter(row => row.valid);
      if (totalCountEl) totalCountEl.textContent = String(parsedRows.length);
      if (validCountEl) validCountEl.textContent = String(validRows.length);
      if (errorCountEl) errorCountEl.textContent = String(parsedRows.length - validRows.length);
      if (applyBtn) applyBtn.disabled = validRows.length === 0;

      if (previewBody) {
        previewBody.innerHTML = parsedRows.map(row => `
          <tr class="${row.valid ? 'row-ok' : 'row-error'}">
            <td>${row.rowNumber}</td>
            <td>${escapeHtml(row.data.excelName || '-')}</td>
            <td>${escapeHtml(row.data.driverName || '-')}</td>
            <td>${escapeHtml(row.data.platformId || '-')}</td>
            <td>${escapeHtml(row.data.weekLabel)}</td>
            <td>${row.valid ? `${row.data.rate}%` : '-'}</td>
            <td>${renderResultCell(row)}</td>
          </tr>
        `).join('');
      }

      if (previewSection) previewSection.hidden = parsedRows.length === 0;
      updateWeekNote();
    }

    function downloadTemplate() {
      if (!window.XLSX) {
        notify('엑셀 라이브러리를 불러오지 못했습니다.');
        return;
      }

      const header = ['이름', `${config.idLabel} *`, `${config.rateLabel}(%) *`];
      const sample = platform === 'baemin'
        ? ['홍길동', 'bm_sample', '90']
        : ['홍길동', '홍길동5678', '10'];

      const sheet = XLSX.utils.aoa_to_sheet([header, sample]);
      sheet['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 14 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, config.sheetName);
      XLSX.writeFile(workbook, config.templateFile);
    }

    async function handleFileChange(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      if (!window.XLSX) {
        notify('엑셀 라이브러리를 불러오지 못했습니다.');
        return;
      }

      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
        const rows = parsePlatformWorkbookRows(workbook, platform);
        if (!rows.length) {
          notify('등록할 데이터 행이 없습니다. 2행부터 입력했는지 확인하세요.');
          clearPreview();
          return;
        }
        sourceRows = rows;
        parsedRows = validateRows(sourceRows);
        renderPreviewHead();
        renderPreview();
        notify(`미리보기 ${parsedRows.length}건 — 등록 가능 ${parsedRows.filter(row => row.valid).length}건`);
      } catch (error) {
        console.error(error);
        notify('엑셀 파일을 읽지 못했습니다.');
        clearPreview();
      }
    }

    function applyBulk() {
      parsedRows = validateRows(sourceRows);
      renderPreview();

      const readyRows = parsedRows.filter(row => row.valid);
      if (!readyRows.length) {
        notify('등록 가능한 행이 없습니다. 상단 적용주와 데이터를 확인하세요.');
        return;
      }

      const finalRows = [];
      const seen = new Map();
      readyRows.forEach(row => seen.set(row.data.driverId, row));
      seen.forEach(row => finalRows.push(row));

      if (!window.confirm(`${finalRows.length}건의 ${config.rateLabel}을 일괄 저장하시겠습니까?`)) return;

      finalRows.forEach(row => {
        BremStorage.rejections.upsertWeekly({
          driverId: row.data.driverId,
          weekStart: row.data.weekStart,
          rate: row.data.rate,
          platform
        });
      });

      notify(`${finalRows.length}건 ${config.rateLabel} 일괄 저장 완료`);
      clearPreview();
      document.dispatchEvent(new CustomEvent('brem-rejection-bulk-applied', { detail: { platform } }));
    }

    renderPreviewHead();
    updateWeekNote();

    document.getElementById(config.weekInputId)?.addEventListener('change', () => {
      if (!sourceRows.length) {
        updateWeekNote();
        return;
      }
      parsedRows = validateRows(sourceRows);
      renderPreview();
    });

    templateBtn?.addEventListener('click', downloadTemplate);
    fileInput?.addEventListener('change', handleFileChange);
    applyBtn?.addEventListener('click', applyBulk);
    clearBtn?.addEventListener('click', clearPreview);
  }

  function initCombined(root) {
    let parsedRows = [];
    let sourceRows = [];

    const templateBtn = root.querySelector('[data-rejection-bulk-combined-template]');
    const fileInput = root.querySelector('[data-rejection-bulk-combined-file]');
    const previewSection = root.querySelector('[data-rejection-bulk-combined-preview]');
    const previewHead = root.querySelector('[data-rejection-bulk-combined-preview-head]');
    const previewBody = root.querySelector('[data-rejection-bulk-combined-preview-body]');
    const totalCountEl = root.querySelector('[data-rejection-bulk-combined-total]');
    const validCountEl = root.querySelector('[data-rejection-bulk-combined-valid]');
    const errorCountEl = root.querySelector('[data-rejection-bulk-combined-error]');
    const weekNoteEl = root.querySelector('[data-rejection-bulk-combined-week-note]');
    const applyBtn = root.querySelector('[data-rejection-bulk-combined-apply]');
    const clearBtn = root.querySelector('[data-rejection-bulk-combined-clear]');

    function updateWeekNote() {
      if (!weekNoteEl) return;
      const coupangWeek = getSelectedWeekStart(PLATFORM_CONFIG.coupang);
      const baeminWeek = getSelectedWeekStart(PLATFORM_CONFIG.baemin);
      if (!coupangWeek || !baeminWeek) {
        weekNoteEl.textContent = '쿠팡·배민 탭 상단에서 적용주(수요일)를 먼저 선택하세요.';
        return;
      }
      weekNoteEl.textContent = `쿠팡 적용주: ${weekLabel(coupangWeek)} · 배민 적용주: ${weekLabel(baeminWeek)}`;
    }

    function clearPreview() {
      parsedRows = [];
      sourceRows = [];
      if (fileInput) fileInput.value = '';
      if (previewSection) previewSection.hidden = true;
      if (previewBody) previewBody.innerHTML = '';
      if (totalCountEl) totalCountEl.textContent = '0';
      if (validCountEl) validCountEl.textContent = '0';
      if (errorCountEl) errorCountEl.textContent = '0';
      if (applyBtn) applyBtn.disabled = true;
      updateWeekNote();
    }

    function renderPreviewHead() {
      if (!previewHead) return;
      previewHead.innerHTML = `
        <th>행</th>
        <th>쿠팡</th>
        <th>거절율</th>
        <th>배민</th>
        <th>수락율</th>
        <th>결과</th>
      `;
    }

    function countValidEntries(rows) {
      return rows.reduce((sum, row) => sum + row.entries.filter(entry => entry.valid).length, 0);
    }

    function renderCombinedCell(entry, label) {
      if (!entry || entry.skip) return '-';
      if (!entry.valid) return `<span class="bulk-result-err">${escapeHtml(entry.errors.join(', '))}</span>`;
      return `${escapeHtml(entry.data.driverName || entry.data.excelName || label)} · ${entry.data.rate}%`;
    }

    function renderPreview() {
      const validEntryCount = countValidEntries(parsedRows);
      const errorEntryCount = parsedRows.reduce((sum, row) => {
        return sum + row.entries.filter(entry => !entry.skip && !entry.valid).length;
      }, 0);

      if (totalCountEl) totalCountEl.textContent = String(parsedRows.length);
      if (validCountEl) validCountEl.textContent = String(validEntryCount);
      if (errorCountEl) errorCountEl.textContent = String(errorEntryCount);
      if (applyBtn) applyBtn.disabled = validEntryCount === 0;

      if (previewBody) {
        previewBody.innerHTML = parsedRows.map(row => `
          <tr class="${row.valid ? 'row-ok' : 'row-error'}">
            <td>${row.rowNumber}</td>
            <td>${renderCombinedCell(row.coupang, row.raw.coupangId)}</td>
            <td>${row.coupang?.valid ? `${row.coupang.data.rate}%` : '-'}</td>
            <td>${renderCombinedCell(row.baemin, row.raw.baeminId)}</td>
            <td>${row.baemin?.valid ? `${row.baemin.data.rate}%` : '-'}</td>
            <td>${renderResultCell(row)}</td>
          </tr>
        `).join('');
      }

      if (previewSection) previewSection.hidden = parsedRows.length === 0;
      updateWeekNote();
    }

    function downloadTemplate() {
      if (!window.XLSX) {
        notify('엑셀 라이브러리를 불러오지 못했습니다.');
        return;
      }
      const header = ['이름', '쿠팡아이디', '거절율(%)', '이름', '배민아이디', '수락율(%)'];
      const sample = ['홍길동', '홍길동5678', '10', '홍길동', 'bm_sample', '90'];
      const sheet = XLSX.utils.aoa_to_sheet([header, sample]);
      sheet['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 12 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, '거절율_수락율');
      XLSX.writeFile(workbook, COMBINED_TEMPLATE);
    }

    async function handleFileChange(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      if (!window.XLSX) {
        notify('엑셀 라이브러리를 불러오지 못했습니다.');
        return;
      }

      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
        const rows = parseCombinedWorkbookRows(workbook);
        if (!rows.length) {
          notify('등록할 데이터 행이 없습니다. 2행부터 입력했는지 확인하세요.');
          clearPreview();
          return;
        }
        sourceRows = rows;
        parsedRows = validateCombinedRows(sourceRows);
        renderPreviewHead();
        renderPreview();
        notify(`미리보기 ${parsedRows.length}행 — 등록 가능 ${countValidEntries(parsedRows)}건`);
      } catch (error) {
        console.error(error);
        notify('엑셀 파일을 읽지 못했습니다.');
        clearPreview();
      }
    }

    function applyBulk() {
      parsedRows = validateCombinedRows(sourceRows);
      renderPreview();

      const readyEntries = [];
      parsedRows.forEach(row => {
        row.entries.filter(entry => entry.valid).forEach(entry => readyEntries.push(entry));
      });

      if (!readyEntries.length) {
        notify('등록 가능한 데이터가 없습니다. 적용주와 아이디를 확인하세요.');
        return;
      }

      const finalEntries = [];
      const seen = new Map();
      readyEntries.forEach(entry => {
        seen.set(`${entry.data.platform}:${entry.data.driverId}`, entry);
      });
      seen.forEach(entry => finalEntries.push(entry));

      if (!window.confirm(`쿠팡·배민 ${finalEntries.length}건을 일괄 저장하시겠습니까?`)) return;

      finalEntries.forEach(entry => {
        BremStorage.rejections.upsertWeekly({
          driverId: entry.data.driverId,
          weekStart: entry.data.weekStart,
          rate: entry.data.rate,
          platform: entry.data.platform
        });
      });

      notify(`${finalEntries.length}건 거절율·수락율 일괄 저장 완료`);
      clearPreview();
      document.dispatchEvent(new CustomEvent('brem-rejection-bulk-applied', { detail: { platform: 'combined' } }));
    }

    renderPreviewHead();
    updateWeekNote();

    ['rejectionWeekDate-coupang', 'rejectionWeekDate-baemin'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        if (!sourceRows.length) {
          updateWeekNote();
          return;
        }
        parsedRows = validateCombinedRows(sourceRows);
        renderPreview();
      });
    });

    templateBtn?.addEventListener('click', downloadTemplate);
    fileInput?.addEventListener('change', handleFileChange);
    applyBtn?.addEventListener('click', applyBulk);
    clearBtn?.addEventListener('click', clearPreview);
  }

  function init() {
    document.querySelectorAll('[data-rejection-bulk]').forEach(initPlatform);
    document.querySelectorAll('[data-rejection-bulk-combined]').forEach(initCombined);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
