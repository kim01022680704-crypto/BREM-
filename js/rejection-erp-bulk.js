(function () {
  /** 엑셀 SheetNames 기준: 1번 시트(인덱스0)=쿠팡, 2번 시트(인덱스1)=배민 */
  const COUPANG_SHEET_INDEX = 0;
  const BAEMIN_SHEET_INDEX = 1;
  const COUPANG_START_ROW = 2;
  const BAEMIN_START_ROW = 4;

  const COUPANG_COL = { IDENTITY: 0, REJECT: 1, CANCEL: 2, COMPLETE: 3 };
  const BAEMIN_COL = { COMPLETE: 4, REJECT: 5, DISPATCH_CANCEL: 6, RIDER_CANCEL: 7, ID: 36 };

  function normalizePlatform(platform) {
    return BremPlatforms.normalize(platform);
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

  function formatDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(`${value}T00:00:00`));
  }

  function weekLabel(weekStart) {
    if (!weekStart) return '-';
    return `${formatDate(weekStart)} ~ ${formatDate(weekEndKey(weekStart))}`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function notify(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function cellValue(row, index) {
    if (!row || index < 0 || index >= row.length) return '';
    const value = row[index];
    if (value === undefined || value === null) return '';
    return value;
  }

  function parseCount(value) {
    if (value === '' || value === null || value === undefined) return 0;
    const n = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : NaN;
  }

  function roundRate1(value) {
    return Math.round(Number(value) * 10) / 10;
  }

  function sheetToRows(sheet) {
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  }

  function getSheetRowCount(sheet) {
    if (!sheet || !sheet['!ref']) return 0;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    return range.e.r + 1;
  }

  /** AK열 등 먼 열을 안정적으로 읽기 위해 시트 셀 직접 접근 */
  function getSheetCell(sheet, row1Based, col0Based) {
    if (!sheet) return '';
    const addr = XLSX.utils.encode_cell({ r: row1Based - 1, c: col0Based });
    const cell = sheet[addr];
    if (!cell || cell.v === undefined || cell.v === null) return '';
    return cell.v;
  }

  function resolveErpSheets(workbook) {
    const names = workbook.SheetNames || [];
    if (names.length < 2) {
      throw new Error('엑셀에 시트가 2개 이상 필요합니다. (1번 시트: 쿠팡, 2번 시트: 배민)');
    }

    const coupangName = names[COUPANG_SHEET_INDEX];
    const baeminName = names[BAEMIN_SHEET_INDEX];
    const coupangSheet = workbook.Sheets?.[coupangName];
    const baeminSheet = workbook.Sheets?.[baeminName];

    if (!coupangSheet || !baeminSheet) {
      throw new Error('1번·2번 시트를 읽지 못했습니다. 1번=쿠팡, 2번=배민 순서를 확인하세요.');
    }

    return {
      coupangSheet,
      baeminSheet,
      coupangSheetName: coupangName,
      baeminSheetName: baeminName,
      coupangPosition: COUPANG_SHEET_INDEX + 1,
      baeminPosition: BAEMIN_SHEET_INDEX + 1
    };
  }

  function getSelectedWeekStart(platform) {
    const erpInput = document.querySelector(`[data-rejection-erp-week-${platform}]`);
    const panelInput = document.getElementById(`rejectionWeekDate-${platform}`);
    const value = erpInput?.value || panelInput?.value;
    if (!value) return '';
    return weekStartKey(value);
  }

  function syncWeekInputs(platform, weekStart) {
    const normalized = weekStart ? weekStartKey(weekStart) : '';
    const erpInput = document.querySelector(`[data-rejection-erp-week-${platform}]`);
    const panelInput = document.getElementById(`rejectionWeekDate-${platform}`);
    if (erpInput) erpInput.value = normalized;
    if (panelInput) panelInput.value = normalized;
  }

  function calcCoupangRate(rejectCount, cancelCount, completeCount) {
    const reject = parseCount(rejectCount);
    const cancel = parseCount(cancelCount);
    const complete = parseCount(completeCount);
    if ([reject, cancel, complete].some(Number.isNaN)) {
      return { rate: null, unmeasured: true, error: '쿠팡 건수가 숫자가 아닙니다.' };
    }
    const denominator = reject + cancel + complete;
    if (denominator <= 0) {
      return { rate: null, unmeasured: true };
    }
    return {
      rate: roundRate1(((reject + cancel) / denominator) * 100),
      unmeasured: false
    };
  }

  function calcBaeminAcceptanceRate(completeTotal, rejectCount, dispatchCancel, riderCancel) {
    const e = parseCount(completeTotal);
    const f = parseCount(rejectCount);
    const g = parseCount(dispatchCancel);
    const h = parseCount(riderCancel);
    if ([e, f, g, h].some(Number.isNaN)) {
      return { rate: null, unmeasured: true, error: '배민 건수가 숫자가 아닙니다.' };
    }
    const denominator = e + f + g + h;
    if (denominator <= 0) {
      return { rate: null, unmeasured: true };
    }
    const rejectShare = ((f + g + h) / denominator) * 100;
    return {
      rate: roundRate1(100 - rejectShare),
      unmeasured: false
    };
  }

  function formatRateDisplay(rate, unmeasured) {
    if (unmeasured || rate == null) return '미집계';
    return `${rate}%`;
  }

  function matchCoupangDriver(identityCell) {
    const identity = window.BremDriverUtils?.parseCoupangImportIdentity?.(identityCell, '') || {
      loginIds: [],
      name: '',
      phone: ''
    };
    if (!identity.loginIds.length && !(identity.name && identity.phone)) {
      return {
        driver: null,
        coupangId: '',
        error: '이름+전화번호 형식 오류'
      };
    }

    for (const loginId of [...identity.loginIds].reverse()) {
      const result = window.BremDriverUtils?.matchDriverForPlatformImport?.(loginId, 'coupang', identity.name);
      if (result?.driver) {
        return {
          driver: result.driver,
          coupangId: result.resolvedPlatformId || loginId,
          error: ''
        };
      }
    }

    if (identity.name && identity.phone) {
      const byPhone = window.BremDriverUtils?.matchDriverByNameAndPhone?.(identity.name, identity.phone);
      if (byPhone) {
        return {
          driver: byPhone,
          coupangId: window.BremDriverUtils.makeDriverLoginId(byPhone),
          error: ''
        };
      }
    }

    const fallbackId = identity.loginIds[identity.loginIds.length - 1] || '';
    if (fallbackId.length >= 5 && !/\d{4}$/.test(fallbackId)) {
      return { driver: null, coupangId: fallbackId, error: '전화번호 뒤 4자리 추출 실패' };
    }

    return {
      driver: null,
      coupangId: fallbackId,
      error: '등록된 기사 없음'
    };
  }

  function matchBaeminDriver(baeminId) {
    const id = String(baeminId || '').trim();
    if (!id) {
      return { driver: null, baeminId: '', error: '배민ID 공백', skip: true };
    }
    const result = window.BremDriverUtils?.matchDriverForPlatformImport?.(id, 'baemin', '');
    if (!result?.driver) {
      return { driver: null, baeminId: id, error: '등록된 기사 없음' };
    }
    return { driver: result.driver, baeminId: id, error: '' };
  }

  function parseCoupangSheet(sheet, weekStart) {
    const parsed = [];
    const rowCount = getSheetRowCount(sheet);

    for (let rowNumber = COUPANG_START_ROW; rowNumber <= rowCount; rowNumber += 1) {
      const identityCell = getSheetCell(sheet, rowNumber, COUPANG_COL.IDENTITY);
      const rejectRaw = getSheetCell(sheet, rowNumber, COUPANG_COL.REJECT);
      const cancelRaw = getSheetCell(sheet, rowNumber, COUPANG_COL.CANCEL);
      const completeRaw = getSheetCell(sheet, rowNumber, COUPANG_COL.COMPLETE);

      if (!String(identityCell).trim()
        && !String(rejectRaw).trim()
        && !String(cancelRaw).trim()
        && !String(completeRaw).trim()) {
        continue;
      }

      const match = matchCoupangDriver(identityCell);
      const rateResult = calcCoupangRate(rejectRaw, cancelRaw, completeRaw);
      const errors = [];
      if (match.error) errors.push(match.error);
      if (rateResult.error) errors.push(rateResult.error);
      if (!weekStart) errors.push('쿠팡 적용주 미선택');

      const rejectCount = parseCount(rejectRaw);
      const cancelCount = parseCount(cancelRaw);
      const completeCount = parseCount(completeRaw);
      const stats = {
        rejectCount: Number.isNaN(rejectCount) ? 0 : rejectCount,
        cancelCount: Number.isNaN(cancelCount) ? 0 : cancelCount,
        completeCount: Number.isNaN(completeCount) ? 0 : completeCount,
        unmeasured: rateResult.unmeasured
      };

      parsed.push({
        platform: 'coupang',
        rowNumber,
        excelIdentity: String(identityCell || '').trim(),
        driver: match.driver,
        driverId: match.driver?.id || '',
        driverName: match.driver?.name || String(identityCell || '').trim(),
        platformLabel: match.coupangId,
        rate: rateResult.rate,
        unmeasured: rateResult.unmeasured,
        stats,
        weekStart,
        valid: Boolean(match.driver && weekStart && !rateResult.error),
        errors,
        canSave: Boolean(match.driver && weekStart && !rateResult.error)
      });
    }

    return parsed;
  }

  function parseBaeminSheet(sheet, weekStart) {
    const parsed = [];
    const rowCount = getSheetRowCount(sheet);

    for (let rowNumber = BAEMIN_START_ROW; rowNumber <= rowCount; rowNumber += 1) {
      const baeminIdRaw = getSheetCell(sheet, rowNumber, BAEMIN_COL.ID);
      const completeRaw = getSheetCell(sheet, rowNumber, BAEMIN_COL.COMPLETE);
      const rejectRaw = getSheetCell(sheet, rowNumber, BAEMIN_COL.REJECT);
      const dispatchRaw = getSheetCell(sheet, rowNumber, BAEMIN_COL.DISPATCH_CANCEL);
      const riderRaw = getSheetCell(sheet, rowNumber, BAEMIN_COL.RIDER_CANCEL);

      if (!String(baeminIdRaw).trim()
        && !String(completeRaw).trim()
        && !String(rejectRaw).trim()
        && !String(dispatchRaw).trim()
        && !String(riderRaw).trim()) {
        continue;
      }

      const match = matchBaeminDriver(baeminIdRaw);
      if (match.skip) continue;

      const rateResult = calcBaeminAcceptanceRate(completeRaw, rejectRaw, dispatchRaw, riderRaw);
      const errors = [];
      if (match.error) errors.push(match.error);
      if (rateResult.error) errors.push(rateResult.error);
      if (!weekStart) errors.push('배민 적용주 미선택');

      const completeTotal = parseCount(completeRaw);
      const rejectCount = parseCount(rejectRaw);
      const dispatchCancelCount = parseCount(dispatchRaw);
      const riderCancelCount = parseCount(riderRaw);
      const stats = {
        completeTotal: Number.isNaN(completeTotal) ? 0 : completeTotal,
        rejectCount: Number.isNaN(rejectCount) ? 0 : rejectCount,
        dispatchCancelCount: Number.isNaN(dispatchCancelCount) ? 0 : dispatchCancelCount,
        riderCancelCount: Number.isNaN(riderCancelCount) ? 0 : riderCancelCount,
        unmeasured: rateResult.unmeasured
      };

      parsed.push({
        platform: 'baemin',
        rowNumber,
        driver: match.driver,
        driverId: match.driver?.id || '',
        driverName: match.driver?.name || '',
        platformLabel: match.baeminId,
        rate: rateResult.rate,
        unmeasured: rateResult.unmeasured,
        stats,
        weekStart,
        valid: Boolean(match.driver && weekStart && !rateResult.error),
        errors,
        canSave: Boolean(match.driver && weekStart && !rateResult.error)
      });
    }

    return parsed;
  }

  function buildPreviewRows(coupangRows, baeminRows) {
    const merged = new Map();
    const orphanCoupang = [];
    const orphanBaemin = [];

    function ensureRow(driverId, seed) {
      if (!merged.has(driverId)) {
        merged.set(driverId, {
          driverId,
          name: seed.driverName || '-',
          coupangId: '',
          coupangRate: null,
          coupangUnmeasured: false,
          baeminId: '',
          baeminRate: null,
          baeminUnmeasured: false,
          matchStatus: '매칭',
          errors: [],
          coupangPayload: null,
          baeminPayload: null
        });
      }
      return merged.get(driverId);
    }

    coupangRows.forEach(entry => {
      if (entry.driverId) {
        const row = ensureRow(entry.driverId, entry);
        row.name = entry.driverName;
        row.coupangId = entry.platformLabel;
        row.coupangRate = entry.rate;
        row.coupangUnmeasured = entry.unmeasured;
        row.coupangPayload = entry;
        if (!entry.valid) row.errors.push(...entry.errors);
      } else {
        orphanCoupang.push({
          driverId: '',
          name: entry.excelIdentity || entry.driverName || '-',
          coupangId: entry.platformLabel || entry.excelIdentity || '-',
          coupangRate: entry.rate,
          coupangUnmeasured: entry.unmeasured,
          baeminId: '-',
          baeminRate: null,
          baeminUnmeasured: false,
          matchStatus: entry.errors[0] || '쿠팡 미매칭',
          errors: entry.errors,
          coupangPayload: null,
          baeminPayload: null
        });
      }
    });

    baeminRows.forEach(entry => {
      if (entry.driverId) {
        const row = ensureRow(entry.driverId, entry);
        row.name = row.name === '-' ? entry.driverName : row.name;
        row.baeminId = entry.platformLabel;
        row.baeminRate = entry.rate;
        row.baeminUnmeasured = entry.unmeasured;
        row.baeminPayload = entry;
        if (!entry.valid) row.errors.push(...entry.errors);
        if (row.coupangPayload && row.baeminPayload) row.matchStatus = '쿠팡·배민 매칭';
        else if (row.baeminPayload) row.matchStatus = row.coupangPayload ? row.matchStatus : '배민만 매칭';
      } else {
        orphanBaemin.push({
          driverId: '',
          name: entry.platformLabel || '-',
          coupangId: '-',
          coupangRate: null,
          coupangUnmeasured: false,
          baeminId: entry.platformLabel || '-',
          baeminRate: entry.rate,
          baeminUnmeasured: entry.unmeasured,
          matchStatus: entry.errors[0] || '배민 미매칭',
          errors: entry.errors,
          coupangPayload: null,
          baeminPayload: null
        });
      }
    });

    const combined = [...merged.values(), ...orphanCoupang, ...orphanBaemin];
    combined.forEach(row => {
      if (row.errors.length) {
        row.matchStatus = row.errors[0];
      } else if (row.coupangPayload && row.baeminPayload) {
        row.matchStatus = '쿠팡·배민 매칭';
      } else if (row.coupangPayload) {
        row.matchStatus = '쿠팡만 매칭';
      } else if (row.baeminPayload) {
        row.matchStatus = '배민만 매칭';
      }
      row.canSave = Boolean(
        (row.coupangPayload?.canSave)
        || (row.baeminPayload?.canSave)
      );
    });

    return combined;
  }

  function sheetHasCoupangData(sheet) {
    const rowCount = getSheetRowCount(sheet);
    for (let row = COUPANG_START_ROW; row <= Math.min(rowCount, COUPANG_START_ROW + 30); row += 1) {
      if (String(getSheetCell(sheet, row, COUPANG_COL.IDENTITY)).trim()) return true;
      if (String(getSheetCell(sheet, row, COUPANG_COL.REJECT)).trim()) return true;
      if (String(getSheetCell(sheet, row, COUPANG_COL.COMPLETE)).trim()) return true;
    }
    return false;
  }

  function sheetHasBaeminData(sheet) {
    const rowCount = getSheetRowCount(sheet);
    for (let row = BAEMIN_START_ROW; row <= Math.min(rowCount, BAEMIN_START_ROW + 30); row += 1) {
      if (String(getSheetCell(sheet, row, BAEMIN_COL.ID)).trim()) return true;
      if (String(getSheetCell(sheet, row, BAEMIN_COL.COMPLETE)).trim()) return true;
    }
    return false;
  }

  function validateWorkbookStructure(workbook) {
    const resolved = resolveErpSheets(workbook);

    if (!sheetHasBaeminData(resolved.baeminSheet)) {
      throw new Error(`배민 2번 시트「${resolved.baeminSheetName}」에서 AK열(배민ID)·E열 데이터를 찾지 못했습니다. 4행부터 확인하세요.`);
    }

    if (!sheetHasCoupangData(resolved.coupangSheet)) {
      throw new Error(`쿠팡 1번 시트「${resolved.coupangSheetName}」에서 A~D열 데이터를 찾지 못했습니다. 2행부터 확인하세요.`);
    }

    return resolved;
  }

  function parseWorkbook(workbook) {
    const resolved = validateWorkbookStructure(workbook);

    const coupangWeek = getSelectedWeekStart('coupang');
    const baeminWeek = getSelectedWeekStart('baemin');
    const coupangRows = parseCoupangSheet(resolved.coupangSheet, coupangWeek);
    const baeminRows = parseBaeminSheet(resolved.baeminSheet, baeminWeek);

    if (!coupangRows.length && !baeminRows.length) {
      throw new Error('쿠팡·배민 시트에서 데이터 행을 찾지 못했습니다. (쿠팡 2행~, 배민 4행~, AK열 배민ID)');
    }

    return {
      coupangRows,
      baeminRows,
      previewRows: buildPreviewRows(coupangRows, baeminRows),
      sheetInfo: {
        coupangSheetName: resolved.coupangSheetName,
        baeminSheetName: resolved.baeminSheetName,
        coupangPosition: resolved.coupangPosition,
        baeminPosition: resolved.baeminPosition
      }
    };
  }

  function init(root) {
    let previewRows = [];
    let parsedBundle = null;

    const fileInput = root.querySelector('[data-rejection-erp-file]');
    const previewSection = root.querySelector('[data-rejection-erp-preview]');
    const previewBody = root.querySelector('[data-rejection-erp-preview-body]');
    const totalEl = root.querySelector('[data-rejection-erp-total]');
    const saveEl = root.querySelector('[data-rejection-erp-save]');
    const failEl = root.querySelector('[data-rejection-erp-fail]');
    const weekNoteEl = root.querySelector('[data-rejection-erp-week-note]');
    const applyBtn = root.querySelector('[data-rejection-erp-apply]');
    const clearBtn = root.querySelector('[data-rejection-erp-clear]');

    function updateWeekNote() {
      if (!weekNoteEl) return;
      const coupangWeek = getSelectedWeekStart('coupang');
      const baeminWeek = getSelectedWeekStart('baemin');
      const sheetInfo = parsedBundle?.sheetInfo;
      const sheetLabel = sheetInfo
        ? ` · 1번시트(쿠팡)「${sheetInfo.coupangSheetName}」· 2번시트(배민)「${sheetInfo.baeminSheetName}」`
        : '';

      if (!coupangWeek || !baeminWeek) {
        weekNoteEl.textContent = `쿠팡·배민 탭 상단에서 적용주(수요일)를 먼저 선택하세요.${sheetLabel}`;
        return;
      }
      weekNoteEl.textContent = `쿠팡: ${weekLabel(coupangWeek)} · 배민: ${weekLabel(baeminWeek)}${sheetLabel}`;
    }

    function clearPreview() {
      previewRows = [];
      parsedBundle = null;
      if (fileInput) fileInput.value = '';
      if (previewSection) previewSection.hidden = true;
      if (previewBody) previewBody.innerHTML = '';
      if (totalEl) totalEl.textContent = '0';
      if (saveEl) saveEl.textContent = '0';
      if (failEl) failEl.textContent = '0';
      if (applyBtn) applyBtn.disabled = true;
      updateWeekNote();
    }

    function renderPreview() {
      const saveCount = previewRows.reduce((sum, row) => {
        let n = 0;
        if (row.coupangPayload?.canSave) n += 1;
        if (row.baeminPayload?.canSave) n += 1;
        return sum + n;
      }, 0);
      const failCount = previewRows.filter(row => !row.canSave).length;

      if (totalEl) totalEl.textContent = String(previewRows.length);
      if (saveEl) saveEl.textContent = String(saveCount);
      if (failEl) failEl.textContent = String(failCount);
      if (applyBtn) applyBtn.disabled = saveCount === 0;

      if (previewBody) {
        previewBody.innerHTML = previewRows.map(row => `
          <tr class="${row.canSave ? 'row-ok' : 'row-error'}">
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(row.coupangId || '-')}</td>
            <td>${escapeHtml(formatRateDisplay(row.coupangRate, row.coupangUnmeasured))}</td>
            <td>${escapeHtml(row.baeminId || '-')}</td>
            <td>${escapeHtml(formatRateDisplay(row.baeminRate, row.baeminUnmeasured))}</td>
            <td>${row.canSave
              ? '<span class="bulk-result-ok">등록 가능</span>'
              : `<span class="bulk-result-err">${escapeHtml(row.matchStatus)}</span>`}
            </td>
          </tr>
        `).join('');
      }

      if (previewSection) previewSection.hidden = previewRows.length === 0;
      updateWeekNote();
    }

    function revalidate() {
      if (!parsedBundle) return;
      const coupangWeek = getSelectedWeekStart('coupang');
      const baeminWeek = getSelectedWeekStart('baemin');
      parsedBundle.coupangRows = parsedBundle.coupangRows.map(entry => {
        const rateResult = calcCoupangRate(entry.stats.rejectCount, entry.stats.cancelCount, entry.stats.completeCount);
        const errors = entry.driver ? [] : [entry.errors[0] || '등록된 기사 없음'];
        if (!coupangWeek) errors.push('쿠팡 적용주 미선택');
        if (rateResult.error) errors.push(rateResult.error);
        return {
          ...entry,
          weekStart: coupangWeek,
          rate: rateResult.rate,
          unmeasured: rateResult.unmeasured,
          stats: { ...entry.stats, unmeasured: rateResult.unmeasured },
          errors,
          valid: Boolean(entry.driver && coupangWeek && !rateResult.error),
          canSave: Boolean(entry.driver && coupangWeek && !rateResult.error)
        };
      });
      parsedBundle.baeminRows = parsedBundle.baeminRows.map(entry => {
        const rateResult = calcBaeminAcceptanceRate(
          entry.stats.completeTotal,
          entry.stats.rejectCount,
          entry.stats.dispatchCancelCount,
          entry.stats.riderCancelCount
        );
        const errors = entry.driver ? [] : [entry.errors[0] || '등록된 기사 없음'];
        if (!baeminWeek) errors.push('배민 적용주 미선택');
        if (rateResult.error) errors.push(rateResult.error);
        return {
          ...entry,
          weekStart: baeminWeek,
          rate: rateResult.rate,
          unmeasured: rateResult.unmeasured,
          stats: { ...entry.stats, unmeasured: rateResult.unmeasured },
          errors,
          valid: Boolean(entry.driver && baeminWeek && !rateResult.error),
          canSave: Boolean(entry.driver && baeminWeek && !rateResult.error)
        };
      });
      previewRows = buildPreviewRows(parsedBundle.coupangRows, parsedBundle.baeminRows);
      renderPreview();
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
        parsedBundle = parseWorkbook(workbook);
        previewRows = parsedBundle.previewRows;
        renderPreview();
        const saveCount = Number(saveEl?.textContent || 0);
        notify(`미리보기 ${previewRows.length}행 · 등록 가능 ${saveCount}건`);
      } catch (error) {
        console.error('[BREM] ERP rejection parse failed:', error);
        notify(error.message || '엑셀 파일을 읽지 못했습니다.');
        clearPreview();
      }
    }

    function applyBulk() {
      revalidate();
      const payloads = [];
      previewRows.forEach(row => {
        if (row.coupangPayload?.canSave) payloads.push(row.coupangPayload);
        if (row.baeminPayload?.canSave) payloads.push(row.baeminPayload);
      });

      if (!payloads.length) {
        notify('등록 가능한 데이터가 없습니다.');
        return;
      }

      if (!window.confirm(`쿠팡·배민 ${payloads.length}건을 저장하시겠습니까?`)) return;

      payloads.forEach(entry => {
        BremStorage.rejections.upsertWeekly({
          driverId: entry.driverId,
          weekStart: entry.weekStart,
          rate: entry.unmeasured ? null : entry.rate,
          platform: entry.platform,
          stats: entry.stats,
          source: 'erp-bulk'
        });
      });

      void (async () => {
        try {
          await BremStorage.flushStorage?.();
          if (BremStorage.refreshDataFromServer) {
            await BremStorage.refreshDataFromServer(BremStorage.KEYS?.rejections || 'brem_admin_rejection_rates');
          }
          const failCount = Number(failEl?.textContent || 0);
          notify(`총 ${payloads.length}건 저장 완료 / 매칭 실패 ${failCount}건`);
          clearPreview();
          document.dispatchEvent(new CustomEvent('brem-rejection-erp-applied'));
        } catch (error) {
          console.error('[BREM] ERP rejection persist failed:', error);
          const message = String(error.message || '');
          if (message.includes('stats') || message.includes('column')) {
            notify('Supabase에 stats 컬럼이 없습니다. supabase/rejection_stats_migration.sql 을 실행하세요.');
            return;
          }
          notify(message || 'Supabase 저장에 실패했습니다.');
        }
      })();
    }

    function initWeekPickers() {
      const defaultWeek = weekStartKey();
      ['coupang', 'baemin'].forEach(platform => {
        const panelValue = document.getElementById(`rejectionWeekDate-${platform}`)?.value;
        syncWeekInputs(platform, panelValue || defaultWeek);
      });
    }

    function bindWeekPicker(platform) {
      const erpInput = root.querySelector(`[data-rejection-erp-week-${platform}]`);
      const panelInput = document.getElementById(`rejectionWeekDate-${platform}`);
      erpInput?.addEventListener('change', event => {
        syncWeekInputs(platform, event.target.value);
        if (parsedBundle) revalidate();
        else updateWeekNote();
      });
      panelInput?.addEventListener('change', event => {
        syncWeekInputs(platform, event.target.value);
        if (parsedBundle) revalidate();
        else updateWeekNote();
      });
    }

    initWeekPickers();
    ['coupang', 'baemin'].forEach(bindWeekPicker);
    fileInput?.addEventListener('change', handleFileChange);
    applyBtn?.addEventListener('click', applyBulk);
    clearBtn?.addEventListener('click', clearPreview);
  }

  function initAll() {
    document.querySelectorAll('[data-rejection-erp-bulk]').forEach(init);
  }

  document.addEventListener('DOMContentLoaded', initAll);
})();
