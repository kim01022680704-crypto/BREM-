(function () {
  const SHEET_NAME = '을지_협력사 소속 라이더 정산 확인용';
  const SHEET_INDEX = 1;

  const COL = Object.freeze({
    platformId: 1,
    hourlyInsurance: 7
  });

  const HEADER_MARKERS = ['아이디', 'id', '시간제', '협력사', '라이더', '정산'];

  function cellValue(row, index) {
    if (!row || index >= row.length) return '';
    const value = row[index];
    if (value === undefined || value === null) return '';
    return value;
  }

  function parseMoney(value) {
    return window.BremPayrollSlipUtils?.parseMoney?.(value) ?? 0;
  }

  function normalizePlatformId(value) {
    return String(value || '').trim().replace(/\s/g, '');
  }

  function baeminIdMatchKey(value) {
    if (window.BremWeeklySettlement?.baeminIdMatchKey) {
      return BremWeeklySettlement.baeminIdMatchKey(value);
    }
    const v = normalizePlatformId(value);
    if (!v) return '';
    const cleaned = /^\d+\.0+$/.test(v) ? v.replace(/\.0+$/, '') : v;
    return /^\d+$/.test(cleaned) ? (cleaned.replace(/^0+/, '') || '0') : cleaned.toLowerCase();
  }

  function resolveDriverPlatformId(driver, platform) {
    const driverUtils = window.BremDriverUtils;
    if (!driver) return '';
    if (platform === 'coupang') {
      return normalizePlatformId(
        driverUtils?.getErpCoupangId?.(driver)
        || driver.coupangId
        || driver.coupangLoginKey
        || ''
      );
    }
    if (platform === 'baemin') {
      return String(driver.baeminId || '').trim();
    }
    return '';
  }

  function isHeaderRow(row) {
    const samples = [
      cellValue(row, COL.platformId),
      cellValue(row, COL.hourlyInsurance)
    ].map(value => String(value || '').trim().toLowerCase());
    return HEADER_MARKERS.some(marker => samples.some(text => text.includes(marker.toLowerCase())));
  }

  function isRowEmpty(row) {
    const platformId = normalizePlatformId(cellValue(row, COL.platformId));
    const hourlyInsurance = parseMoney(cellValue(row, COL.hourlyInsurance));
    return !platformId && !hourlyInsurance;
  }

  function matchHourlyInsuranceBulkRow(platformId, drivers) {
    const id = normalizePlatformId(platformId);
    const list = Array.isArray(drivers) ? drivers : [];

    if (!id) {
      return {
        status: 'empty_id',
        matches: [],
        driver: null,
        driverId: '',
        driverName: '',
        matchPlatform: '',
        matchPlatformLabel: '-',
        matchedPlatformId: '-',
        error: 'B열 ID 없음'
      };
    }

    const candidates = list.filter(driver => {
      const baeminId = resolveDriverPlatformId(driver, 'baemin');
      const coupangId = resolveDriverPlatformId(driver, 'coupang');
      const baeminKey = baeminIdMatchKey(baeminId);
      return (baeminKey && baeminKey === baeminIdMatchKey(id)) || coupangId === id;
    });

    if (candidates.length > 1) {
      return {
        status: 'duplicate',
        matches: candidates,
        driver: null,
        driverId: '',
        driverName: '',
        matchPlatform: '',
        matchPlatformLabel: '-',
        matchedPlatformId: id,
        error: '동일 ID로 여러 기사 매칭'
      };
    }

    if (!candidates.length) {
      return {
        status: 'unmatched',
        matches: [],
        driver: null,
        driverId: '',
        driverName: '',
        matchPlatform: '',
        matchPlatformLabel: '-',
        matchedPlatformId: id,
        error: '등록된 기사와 매칭 실패'
      };
    }

    const driver = candidates[0];
    const baeminId = resolveDriverPlatformId(driver, 'baemin');
    const coupangId = resolveDriverPlatformId(driver, 'coupang');
    let matchPlatform = '';
    if (baeminIdMatchKey(baeminId) === baeminIdMatchKey(id)) matchPlatform = 'baemin';
    else if (coupangId === id) matchPlatform = 'coupang';
    else if (baeminId && coupangId) matchPlatform = 'both';

    return {
      status: 'matched',
      matches: [driver],
      driver,
      driverId: driver.id,
      driverName: driver.name || '',
      matchPlatform,
      matchPlatformLabel: window.BremPayrollSlipUtils?.platformLabel?.(matchPlatform) || matchPlatform || '-',
      matchedPlatformId: id,
      error: ''
    };
  }

  function parseSheetRows(rows, drivers) {
    if (!Array.isArray(rows) || !rows.length) {
      return { rows: [], issues: ['시트에 데이터가 없습니다.'] };
    }

    const parsedRows = [];
    const issues = [];

    rows.forEach((row, index) => {
      if (isHeaderRow(row) || isRowEmpty(row)) return;

      const platformId = normalizePlatformId(cellValue(row, COL.platformId));
      const hourlyInsurance = parseMoney(cellValue(row, COL.hourlyInsurance));
      const match = matchHourlyInsuranceBulkRow(platformId, drivers);

      const item = rowFromMatch({
        rowNumber: index + 1,
        rowKey: `hourly-ins-bulk-${index + 1}`,
        platformId,
        hourlyInsurance
      }, match);

      parsedRows.push(item);
      if (match.status !== 'matched' && match.status !== 'manual') {
        issues.push(`${item.rowNumber}행: ${match.error || matchStatusLabel(match.status)}`);
      } else if (!hourlyInsurance) {
        issues.push(`${item.rowNumber}행: H열 시간제보험 금액 없음`);
      }
    });

    return { rows: parsedRows, issues };
  }

  function matchStatusLabel(status) {
    if (status === 'matched') return '매칭';
    if (status === 'duplicate') return '중복매칭';
    if (status === 'manual') return '수동선택';
    if (status === 'empty_id') return 'ID 없음';
    return '미매칭';
  }

  function rowFromMatch(row, match) {
    const driver = match.driver || null;
    return {
      ...row,
      matchStatus: match.status,
      matchStatusLabel: matchStatusLabel(match.status),
      matchCandidates: Array.isArray(match.matches) ? match.matches : [],
      matchPlatform: match.matchPlatform || '',
      matchPlatformLabel: match.matchPlatformLabel || '-',
      matchedPlatformId: match.matchedPlatformId || '-',
      driverId: match.driverId || '',
      driverName: match.driverName || (driver?.name || ''),
      error: match.error || ''
    };
  }

  function applyManualDriverToRow(row, driverId, drivers) {
    const id = String(driverId || '').trim();
    const list = Array.isArray(drivers) ? drivers : [];
    if (!id) {
      const rematch = matchHourlyInsuranceBulkRow(row.platformId, list);
      return rowFromMatch({ ...row, driverId: '' }, rematch);
    }
    const driver = list.find(item => item.id === id);
    if (!driver) {
      return rowFromMatch(row, matchHourlyInsuranceBulkRow(row.platformId, list));
    }

    const platformId = normalizePlatformId(row.platformId);
    const baeminId = resolveDriverPlatformId(driver, 'baemin');
    const coupangId = resolveDriverPlatformId(driver, 'coupang');
    let matchPlatform = '';
    if (baeminIdMatchKey(baeminId) === baeminIdMatchKey(platformId)) matchPlatform = 'baemin';
    else if (coupangId === platformId) matchPlatform = 'coupang';
    else if (baeminId && coupangId) matchPlatform = 'both';

    return {
      ...row,
      matchStatus: 'manual',
      matchStatusLabel: matchStatusLabel('manual'),
      matchCandidates: row.matchCandidates?.length ? row.matchCandidates : [driver],
      matchPlatform,
      matchPlatformLabel: window.BremPayrollSlipUtils?.platformLabel?.(matchPlatform) || matchPlatform || '-',
      matchedPlatformId: platformId || '-',
      driverId: driver.id,
      driverName: driver.name || '',
      error: ''
    };
  }

  function rematchRows(rows, drivers) {
    return (Array.isArray(rows) ? rows : []).map(row => {
      if (row.matchStatus === 'manual' && row.driverId) {
        return applyManualDriverToRow(row, row.driverId, drivers);
      }
      const match = matchHourlyInsuranceBulkRow(row.platformId, drivers);
      return rowFromMatch({ ...row, driverId: '' }, match);
    });
  }

  function getUnmatchedLines(rows) {
    return (Array.isArray(rows) ? rows : []).filter(row =>
      row.matchStatus === 'unmatched' || row.matchStatus === 'empty_id'
    );
  }

  function getDuplicateLines(rows) {
    return (Array.isArray(rows) ? rows : []).filter(row =>
      row.matchStatus === 'duplicate' && !String(row.driverId || '').trim()
    );
  }

  function buildHourlyInsuranceBulkMap(bulkRows) {
    const map = new Map();
    (Array.isArray(bulkRows) ? bulkRows : []).forEach(row => {
      if (row.matchStatus !== 'matched' && row.matchStatus !== 'manual') return;
      const driverId = String(row.driverId || '').trim();
      if (!driverId) return;
      const amount = parseMoney(row.hourlyInsurance);
      if (!(amount > 0)) return;
      const prev = map.get(driverId);
      if (prev) {
        prev.hourlyInsurance += amount;
        return;
      }
      map.set(driverId, {
        hourlyInsurance: amount,
        platformId: row.platformId || '',
        matchPlatformLabel: row.matchPlatformLabel || '-',
        matchedPlatformId: row.matchedPlatformId || '-'
      });
    });
    return map;
  }

  function collectAppliedDriverIds(batches) {
    const ids = new Set();
    (Array.isArray(batches) ? batches : []).forEach(batch => {
      (Array.isArray(batch.rows) ? batch.rows : []).forEach(row => {
        const id = String(row.driverId || '').trim();
        if (id) ids.add(id);
      });
    });
    return ids;
  }

  /**
   * 매칭된 행을 ERP 기사(driverId) 기준으로 합산.
   * 한 시트에 같은 기사가 여러 번(다른 ID/0원 행 포함) 나와도 금액 합산.
   */
  function aggregateMatchedRowsByDriver(rows) {
    const byDriver = new Map();
    let mergedDuplicateInSheet = 0;

    (Array.isArray(rows) ? rows : []).forEach(row => {
      if (row.matchStatus !== 'matched' && row.matchStatus !== 'manual') return;
      const driverId = String(row.driverId || '').trim();
      if (!driverId) return;
      const amount = Number(row.hourlyInsurance || 0);

      if (byDriver.has(driverId)) {
        const prev = byDriver.get(driverId);
        prev.hourlyInsurance = Number(prev.hourlyInsurance || 0) + amount;
        prev.mergeCount = Number(prev.mergeCount || 1) + 1;
        const nextId = normalizePlatformId(row.platformId);
        if (nextId && prev.platformId && nextId !== prev.platformId) {
          const parts = String(prev.platformId).split('+');
          if (!parts.includes(nextId)) prev.platformId = `${prev.platformId}+${nextId}`;
          prev.matchedPlatformId = prev.platformId;
        }
        const rowNums = String(prev.rowNumber || '').split(',');
        if (!rowNums.includes(String(row.rowNumber))) {
          prev.rowNumber = `${prev.rowNumber},${row.rowNumber}`;
        }
        mergedDuplicateInSheet += 1;
        return;
      }

      byDriver.set(driverId, {
        ...row,
        hourlyInsurance: amount,
        mergeCount: 1
      });
    });

    return {
      rows: [...byDriver.values()],
      mergedDuplicateInSheet
    };
  }

  /**
   * 월말 쪼개진 정산서·시트 내 중복 대응: 같은 기사는 금액을 합산.
   * 이미 적용된 기사 → 제외하지 않고 추가 적용(배치 합산)
   */
  function filterRowsForApply(rows, appliedDriverIds) {
    const applied = appliedDriverIds instanceof Set ? appliedDriverIds : collectAppliedDriverIds(appliedDriverIds);
    const aggregated = aggregateMatchedRowsByDriver(rows);
    let mergedAlreadyApplied = 0;
    const toApply = [];

    aggregated.rows.forEach(row => {
      if (!(Number(row.hourlyInsurance || 0) > 0)) return;
      const driverId = String(row.driverId || '').trim();
      if (applied.has(driverId)) mergedAlreadyApplied += 1;
      toApply.push(row);
    });

    return {
      toApply,
      skippedAlreadyApplied: 0,
      skippedDuplicateInSheet: 0,
      mergedDuplicateInSheet: aggregated.mergedDuplicateInSheet,
      mergedAlreadyApplied
    };
  }

  /** 미리보기용: 매칭 행은 기사별 합산, 미매칭 등은 원본 유지 */
  function buildPreviewRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const unmatched = list.filter(row =>
      row.matchStatus !== 'matched' && row.matchStatus !== 'manual'
    );
    const aggregated = aggregateMatchedRowsByDriver(list);
    const matched = aggregated.rows.map(row => {
      const mergeCount = Number(row.mergeCount || 1);
      if (mergeCount <= 1) return row;
      return {
        ...row,
        matchStatusLabel: `합산(${mergeCount})`,
        error: ''
      };
    });
    return {
      rows: [...matched, ...unmatched].sort((a, b) => {
        const aNum = Number(String(a.rowNumber || '').split(',')[0]) || 0;
        const bNum = Number(String(b.rowNumber || '').split(',')[0]) || 0;
        return aNum - bNum;
      }),
      mergedDuplicateInSheet: aggregated.mergedDuplicateInSheet
    };
  }

  /** 여러 배치·시트에 걸친 같은 기사 시간제보험을 합산한 행 목록 */
  function aggregateAppliedBatches(batches) {
    const list = Array.isArray(batches) ? batches : [];
    const byDriver = new Map();
    list.forEach(batch => {
      (Array.isArray(batch.rows) ? batch.rows : []).forEach(row => {
        if (row.matchStatus !== 'matched' && row.matchStatus !== 'manual') return;
        const id = String(row.driverId || '').trim();
        if (!id) return;
        const amount = parseMoney(row.hourlyInsurance);
        if (!(amount > 0)) return;
        const prev = byDriver.get(id);
        if (prev) {
          prev.hourlyInsurance = Number(prev.hourlyInsurance || 0) + amount;
          return;
        }
        byDriver.set(id, { ...row, hourlyInsurance: amount });
      });
    });
    return [...byDriver.values()];
  }

  function summarizeAppliedBatches(batches) {
    const list = Array.isArray(batches) ? batches : [];
    const aggregated = buildHourlyInsuranceBulkMap(aggregateAppliedBatches(list));
    let matchedDrivers = 0;
    let hourlyInsuranceTotal = 0;
    aggregated.forEach(entry => {
      matchedDrivers += 1;
      hourlyInsuranceTotal += Number(entry.hourlyInsurance || 0);
    });
    return {
      batchCount: list.length,
      matchedDrivers,
      hourlyInsuranceTotal
    };
  }

  function summarizeRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    return list.reduce((acc, row) => {
      acc.total += 1;
      if (row.matchStatus === 'matched') acc.matched += 1;
      else acc.unmatched += 1;
      acc.hourlyInsuranceTotal += Number(row.hourlyInsurance || 0);
      return acc;
    }, {
      total: 0,
      matched: 0,
      unmatched: 0,
      hourlyInsuranceTotal: 0
    });
  }

  function findSheet(workbook) {
    if (!workbook?.SheetNames?.length) return null;
    const byName = workbook.SheetNames.find(name => String(name).trim() === SHEET_NAME);
    if (byName) return workbook.Sheets[byName];
    if (workbook.SheetNames.length > SHEET_INDEX) {
      return workbook.Sheets[workbook.SheetNames[SHEET_INDEX]];
    }
    return workbook.Sheets[workbook.SheetNames[0]];
  }

  function sheetRowsFromWorkbook(workbook) {
    const sheet = findSheet(workbook);
    if (!sheet) return { rows: [], sheetName: '' };
    const sheetName = workbook.SheetNames.find(name => workbook.Sheets[name] === sheet) || SHEET_NAME;
    const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    return { rows, sheetName };
  }

  window.BremPayrollHourlyInsuranceBulk = Object.freeze({
    SHEET_NAME,
    COL,
    parseSheetRows,
    summarizeRows,
    buildHourlyInsuranceBulkMap,
    collectAppliedDriverIds,
    aggregateMatchedRowsByDriver,
    filterRowsForApply,
    buildPreviewRows,
    aggregateAppliedBatches,
    summarizeAppliedBatches,
    getUnmatchedLines,
    getDuplicateLines,
    rematchRows,
    applyManualDriverToRow,
    matchHourlyInsuranceBulkRow,
    matchStatusLabel,
    findSheet,
    sheetRowsFromWorkbook
  });
})();
