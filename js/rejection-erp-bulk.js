(function () {
  /** 엑셀 화면 기준: 1번 탭=쿠팡, 2번 탭=배민 (숨김 시트 제외) */
  const COUPANG_SHEET_POSITION = 1;
  const BAEMIN_SHEET_POSITION = 2;
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

  function isSheetHidden(workbook, sheetIndex) {
    const hidden = workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden;
    return hidden === 1 || hidden === 2;
  }

  function listWorkbookSheetEntries(workbook) {
    const names = workbook.SheetNames || [];
    return names.map((name, index) => ({
      index,
      position: index + 1,
      name,
      sheet: workbook.Sheets?.[name] || null,
      hidden: isSheetHidden(workbook, index)
    }));
  }

  /** 1번·2번 탭 = 사용자가 보는 순서(숨김 시트 건너뜀) */
  function resolveErpSheets(workbook) {
    const entries = listWorkbookSheetEntries(workbook);
    const visible = entries.filter(entry => !entry.hidden && entry.sheet);

    if (visible.length < 2 && entries.length < 2) {
      throw new Error('엑셀에 시트가 2개 이상 필요합니다. (1번 탭: 쿠팡, 2번 탭: 배민)');
    }

    const coupangEntry = visible[COUPANG_SHEET_POSITION - 1] || entries[COUPANG_SHEET_POSITION - 1];
    const baeminEntry = visible[BAEMIN_SHEET_POSITION - 1] || entries[BAEMIN_SHEET_POSITION - 1];

    if (!coupangEntry?.sheet || !baeminEntry?.sheet) {
      throw new Error('엑셀 1번·2번 시트를 찾지 못했습니다. 1번 탭=쿠팡, 2번 탭=배민 순서로 배치해주세요.');
    }

    return {
      coupangSheet: coupangEntry.sheet,
      baeminSheet: baeminEntry.sheet,
      coupangSheetName: coupangEntry.name,
      baeminSheetName: baeminEntry.name,
      coupangPosition: visible.indexOf(coupangEntry) >= 0
        ? visible.indexOf(coupangEntry) + 1
        : coupangEntry.position,
      baeminPosition: visible.indexOf(baeminEntry) >= 0
        ? visible.indexOf(baeminEntry) + 1
        : baeminEntry.position
    };
  }

  function sniffSheetPlatform(rows) {
    let baeminHints = 0;
    let coupangHints = 0;

    rows.slice(0, 20).forEach((row, rowIndex) => {
      const baeminId = String(cellValue(row, BAEMIN_COL.ID)).trim();
      if (baeminId) baeminHints += 3;

      const identity = String(cellValue(row, COUPANG_COL.IDENTITY)).trim();
      if (identity && /01[\d-]{8,}/.test(identity)) coupangHints += 3;

      if (rowIndex >= COUPANG_START_ROW - 1) {
        const reject = parseCount(cellValue(row, COUPANG_COL.REJECT));
        const complete = parseCount(cellValue(row, COUPANG_COL.COMPLETE));
        if (!Number.isNaN(reject) && reject > 0) coupangHints += 1;
        if (!Number.isNaN(complete) && complete > 0) coupangHints += 1;
      }

      if (rowIndex >= BAEMIN_START_ROW - 1) {
        const total = parseCount(cellValue(row, BAEMIN_COL.COMPLETE));
        if (!Number.isNaN(total) && total > 0) baeminHints += 1;
      }
    });

    if (baeminHints > coupangHints + 2) return 'baemin';
    if (coupangHints > baeminHints + 2) return 'coupang';
    return '';
  }

  function validateErpSheetOrder(resolved) {
    const coupangType = sniffSheetPlatform(sheetToRows(resolved.coupangSheet));
    const baeminType = sniffSheetPlatform(sheetToRows(resolved.baeminSheet));

    if (coupangType === 'baemin' && baeminType === 'coupang') {
      throw new Error('시트 순서가 바뀌었습니다. 1번 탭=쿠팡, 2번 탭=배민 순서로 배치해주세요.');
    }
    if (coupangType === 'baemin') {
      throw new Error(`1번 탭("${resolved.coupangSheetName}")이 쿠팡 데이터가 아닙니다. 쿠팡 시트를 첫 번째 탭에 두세요.`);
    }
    if (baeminType === 'coupang') {
      throw new Error(`2번 탭("${resolved.baeminSheetName}")이 배민 데이터가 아닙니다. 배민 시트를 두 번째 탭에 두세요.`);
    }
  }

  function getSelectedWeekStart(platform) {
    const input = document.getElementById(`rejectionWeekDate-${platform}`);
    const value = input?.value;
    if (!value) return '';
    return weekStartKey(value);
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

    for (const loginId of identity.loginIds) {
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
    const rows = sheetToRows(sheet);
    const parsed = [];

    rows.slice(COUPANG_START_ROW - 1).forEach((row, offset) => {
      const rowNumber = COUPANG_START_ROW + offset;
      const identityCell = cellValue(row, COUPANG_COL.IDENTITY);
      const rejectRaw = cellValue(row, COUPANG_COL.REJECT);
      const cancelRaw = cellValue(row, COUPANG_COL.CANCEL);
      const completeRaw = cellValue(row, COUPANG_COL.COMPLETE);

      if (!String(identityCell).trim()
        && !String(rejectRaw).trim()
        && !String(cancelRaw).trim()
        && !String(completeRaw).trim()) {
        return;
      }

      const match = matchCoupangDriver(identityCell);
      const rateResult = calcCoupangRate(rejectRaw, cancelRaw, completeRaw);
      const errors = [];
      if (match.error) errors.push(match.error);
      if (rateResult.error) errors.push(rateResult.error);
      if (!weekStart) errors.push('쿠팡 적용주 미선택');

      const stats = {
        rejectCount: parseCount(rejectRaw) || 0,
        cancelCount: parseCount(cancelRaw) || 0,
        completeCount: parseCount(completeRaw) || 0,
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
        valid: Boolean(match.driver && weekStart && !rateResult.error && errors.length <= (match.error ? 1 : 0)),
        errors,
        canSave: Boolean(match.driver && weekStart && !rateResult.error)
      });
    });

    return parsed;
  }

  function parseBaeminSheet(sheet, weekStart) {
    const rows = sheetToRows(sheet);
    const parsed = [];

    rows.slice(BAEMIN_START_ROW - 1).forEach((row, offset) => {
      const rowNumber = BAEMIN_START_ROW + offset;
      const baeminIdRaw = cellValue(row, BAEMIN_COL.ID);
      const completeRaw = cellValue(row, BAEMIN_COL.COMPLETE);
      const rejectRaw = cellValue(row, BAEMIN_COL.REJECT);
      const dispatchRaw = cellValue(row, BAEMIN_COL.DISPATCH_CANCEL);
      const riderRaw = cellValue(row, BAEMIN_COL.RIDER_CANCEL);

      if (!String(baeminIdRaw).trim()
        && !String(completeRaw).trim()
        && !String(rejectRaw).trim()
        && !String(dispatchRaw).trim()
        && !String(riderRaw).trim()) {
        return;
      }

      const match = matchBaeminDriver(baeminIdRaw);
      if (match.skip) return;

      const rateResult = calcBaeminAcceptanceRate(completeRaw, rejectRaw, dispatchRaw, riderRaw);
      const errors = [];
      if (match.error) errors.push(match.error);
      if (rateResult.error) errors.push(rateResult.error);
      if (!weekStart) errors.push('배민 적용주 미선택');

      const stats = {
        completeTotal: parseCount(completeRaw) || 0,
        rejectCount: parseCount(rejectRaw) || 0,
        dispatchCancelCount: parseCount(dispatchRaw) || 0,
        riderCancelCount: parseCount(riderRaw) || 0,
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
    });

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

  function validateWorkbookStructure(workbook) {
    const resolved = resolveErpSheets(workbook);
    validateErpSheetOrder(resolved);

    const baeminRows = sheetToRows(resolved.baeminSheet);
    const baeminHeader = baeminRows[BAEMIN_START_ROW - 2] || [];
    if (baeminHeader.length < BAEMIN_COL.ID + 1) {
      throw new Error(`배민 시트(2번 탭「${resolved.baeminSheetName}」) AK열(배민ID)을 찾을 수 없습니다. 4행부터 AK열 기준으로 업로드해주세요.`);
    }

    const coupangRows = sheetToRows(resolved.coupangSheet);
    const sampleCoupang = coupangRows[COUPANG_START_ROW - 1] || [];
    if (sampleCoupang.length < COUPANG_COL.COMPLETE + 1) {
      throw new Error(`쿠팡 시트(1번 탭「${resolved.coupangSheetName}」) B/C/D열(거절·취소·완료)을 찾을 수 없습니다. 2행부터 A~D열 기준으로 업로드해주세요.`);
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
        ? ` · 1번탭(쿠팡)「${sheetInfo.coupangSheetName}」· 2번탭(배민)「${sheetInfo.baeminSheetName}」`
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
          const failCount = Number(failEl?.textContent || 0);
          notify(`총 ${payloads.length}건 저장 완료 / 매칭 실패 ${failCount}건`);
          clearPreview();
          document.dispatchEvent(new CustomEvent('brem-rejection-erp-applied'));
        } catch (error) {
          console.error('[BREM] ERP rejection persist failed:', error);
          notify(error.message || 'Supabase 저장에 실패했습니다.');
        }
      })();
    }

    updateWeekNote();
    ['rejectionWeekDate-coupang', 'rejectionWeekDate-baemin'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        if (parsedBundle) revalidate();
        else updateWeekNote();
      });
    });
    fileInput?.addEventListener('change', handleFileChange);
    applyBtn?.addEventListener('click', applyBulk);
    clearBtn?.addEventListener('click', clearPreview);
  }

  function initAll() {
    document.querySelectorAll('[data-rejection-erp-bulk]').forEach(init);
  }

  document.addEventListener('DOMContentLoaded', initAll);
})();
