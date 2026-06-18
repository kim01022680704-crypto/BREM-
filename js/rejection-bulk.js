(function () {
  const PLATFORM_CONFIG = {
    coupang: {
      rateLabel: '거절율',
      idLabel: '쿠팡아이디',
      templateFile: 'BREM_쿠팡_거절율_양식.xlsx',
      sheetName: '거절율',
      format: 'simple',
      weekInputId: 'rejectionWeekDate-coupang',
      headerMarkers: ['쿠팡아이디', '쿠팡 아이디', 'coupang']
    },
    baemin: {
      rateLabel: '수락율',
      idLabel: '배민아이디',
      templateFile: 'BREM_배민_수락율_양식.xlsx',
      sheetName: '수락율',
      format: 'simple',
      weekInputId: 'rejectionWeekDate-baemin',
      headerMarkers: ['배민아이디', '배민 아이디', 'baemin']
    }
  };

  function normalizePlatform(platform) {
    return BremPlatforms.normalize(platform);
  }

  function normalizePhone(value) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  function normalizeLoginId(value) {
    return String(value || '').replace(/\s/g, '');
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
    if (!row || index >= row.length) return '';
    const value = row[index];
    if (value === undefined || value === null) return '';
    return value;
  }

  function isHeaderRow(row, markers) {
    const first = String(cellValue(row, 0)).trim().toLowerCase();
    return markers.some(marker => first === marker.toLowerCase());
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

  function validateSimpleRow(raw, rowNumber, config, weekStart, platform) {
    const errors = [];
    const platformId = normalizePlatform(platform) === 'baemin'
      ? String(raw.platformId || '').trim()
      : normalizeLoginId(raw.platformId);
    const rate = Number(String(raw.rate ?? '').replace(',', '.').trim());

    if (!platformId) errors.push(`${config.idLabel} 누락`);
    if (!weekStart) errors.push('상단에서 적용주 선택 필요');
    if (raw.rate === '' || raw.rate === undefined || raw.rate === null) errors.push(`${config.rateLabel} 누락`);
    else if (Number.isNaN(rate)) errors.push(`${config.rateLabel} 숫자 아님`);
    else if (rate < 0 || rate > 100) errors.push(`${config.rateLabel} 0~100 범위`);

    const driver = findDriverByPlatformId(platformId, platform);
    if (platformId && !driver) errors.push('등록된 기사 없음');

    return {
      rowNumber,
      valid: errors.length === 0,
      errors,
      data: {
        driverId: driver?.id || '',
        driverName: driver?.name || platformId,
        platformId,
        weekStart,
        weekLabel: weekLabel(weekStart),
        rate,
        platform
      }
    };
  }

  function markDuplicateRows(rows) {
    const lastRowById = new Map();
    rows.forEach(row => {
      if (row.valid && row.data.platformId) {
        lastRowById.set(row.data.platformId, row.rowNumber);
      }
    });

    return rows.map(row => {
      if (!row.valid || !row.data.platformId) return row;
      const lastRow = lastRowById.get(row.data.platformId);
      if (lastRow !== row.rowNumber) {
        return {
          ...row,
          note: '파일 내 중복 — 저장 시 아래 행 값 적용'
        };
      }
      return row;
    });
  }

  function parseWorkbookRows(workbook, config) {
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const dataRows = [];

    rows.forEach((row, index) => {
      const excelRowNumber = index + 1;
      if (!row || !row.some(cell => String(cell || '').trim())) return;
      if (isHeaderRow(row, config.headerMarkers)) return;

      dataRows.push({
        rowNumber: excelRowNumber,
        raw: {
          platformId: cellValue(row, 0),
          rate: cellValue(row, 1)
        }
      });
    });

    return dataRows;
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
        ? `저장 적용주: ${weekLabel(weekStart)} (상단 기준일) · 같은 기사·같은 주는 마지막 값이 최종 적용됩니다.`
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
        <tr>
          <th>행</th>
          <th>기사</th>
          <th>${config.idLabel}</th>
          <th>적용주</th>
          <th>${config.rateLabel}</th>
          <th>결과</th>
        </tr>
      `;
    }

    function renderResultCell(row) {
      if (!row.valid) {
        return `<span class="bulk-result-err">${escapeHtml(row.errors.join(', '))}</span>`;
      }
      if (row.note) {
        return `<span class="bulk-result-warn">${escapeHtml(row.note)}</span>`;
      }
      return '<span class="bulk-result-ok">등록 가능</span>';
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

    function notify(message) {
      document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
    }

    function validateRows(rows) {
      const weekStart = getSelectedWeekStart(config);
      const validated = rows.map(({ rowNumber, raw }) => validateSimpleRow(raw, rowNumber, config, weekStart, platform));
      return markDuplicateRows(validated);
    }

    function downloadTemplate() {
      if (!window.XLSX) {
        notify('엑셀 라이브러리를 불러오지 못했습니다.');
        return;
      }

      const header = [`${config.idLabel} *`, `${config.rateLabel}(%) *`];
      const sample = platform === 'baemin'
        ? ['baemin_id_sample', '90']
        : ['홍길동5678', '10'];

      const sheet = XLSX.utils.aoa_to_sheet([header, sample]);
      sheet['!cols'] = [{ wch: 18 }, { wch: 14 }];

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
        const rows = parseWorkbookRows(workbook, config);

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
      readyRows.forEach(row => {
        seen.set(row.data.driverId, row);
      });
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

    const weekInput = document.getElementById(config.weekInputId);
    weekInput?.addEventListener('change', () => {
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

  function init() {
    document.querySelectorAll('[data-rejection-bulk]').forEach(initPlatform);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
