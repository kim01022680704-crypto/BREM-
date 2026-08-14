(function () {
  const COL = Object.freeze({
    baeminId: 0,
    coupangId: 1,
    bremPromotion: 3
  });

  const HEADER_MARKERS = ['배민', 'coupang', 'baemin', '쿠팡', '프로모션', 'brem'];

  function cellValue(row, index) {
    if (!row || index >= row.length) return '';
    const value = row[index];
    if (value === undefined || value === null) return '';
    return value;
  }

  /** 엑셀 raw 숫자(앞 0 손실) · .0 꼬리 · 공백 정리 */
  function normalizeExcelPlatformId(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
    let text = String(value)
      .trim()
      .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
      .replace(/\s+/g, '');
    if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, '');
    return text;
  }

  function baeminIdMatchKey(value) {
    if (window.BremDriverUtils?.baeminIdMatchKey) {
      return window.BremDriverUtils.baeminIdMatchKey(value);
    }
    if (window.BremWeeklySettlement?.baeminIdMatchKey) {
      return window.BremWeeklySettlement.baeminIdMatchKey(value);
    }
    const v = normalizeExcelPlatformId(value);
    if (!v) return '';
    return /^\d+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v.toLowerCase();
  }

  function baeminIdsEqual(a, b) {
    const left = baeminIdMatchKey(a);
    const right = baeminIdMatchKey(b);
    return Boolean(left && right && left === right);
  }

  function coupangIdsEqual(a, b) {
    const norm = window.BremDriverUtils?.normalizeCoupangMatchKey
      ? (value => window.BremDriverUtils.normalizeCoupangMatchKey(value))
      : (value => normalizeExcelPlatformId(value));
    const left = norm(a);
    const right = norm(b);
    return Boolean(left && right && left === right);
  }

  function parseMoney(value) {
    return window.BremPayrollSlipUtils?.parseMoney?.(value) ?? 0;
  }

  function resolveDriverPlatformId(driver, platform) {
    const driverUtils = window.BremDriverUtils;
    if (!driver) return '';
    if (platform === 'coupang') {
      return String(
        driverUtils?.getErpCoupangId?.(driver)
        || driver.coupangId
        || driver.coupangLoginKey
        || ''
      ).replace(/\s/g, '');
    }
    if (platform === 'baemin') {
      return String(driver.baeminId || '').trim();
    }
    return '';
  }

  function isHeaderRow(row) {
    const samples = [
      cellValue(row, COL.baeminId),
      cellValue(row, COL.coupangId),
      cellValue(row, COL.bremPromotion)
    ].map(value => String(value || '').trim().toLowerCase());
    return HEADER_MARKERS.some(marker => samples.some(text => text.includes(marker.toLowerCase())));
  }

  function isRowEmpty(row) {
    const baeminId = normalizeExcelPlatformId(cellValue(row, COL.baeminId));
    const coupangId = normalizeExcelPlatformId(cellValue(row, COL.coupangId));
    const bremPromotion = parseMoney(cellValue(row, COL.bremPromotion));
    return !baeminId && !coupangId && !bremPromotion;
  }

  function matchPromotionBulkRow(baeminId, coupangId, drivers) {
    const baemin = normalizeExcelPlatformId(baeminId);
    const coupang = normalizeExcelPlatformId(coupangId);
    const list = Array.isArray(drivers) ? drivers : [];

    if (!baemin && !coupang) {
      return {
        status: 'empty_id',
        matches: [],
        driver: null,
        driverId: '',
        driverName: '',
        matchPlatform: '',
        matchPlatformLabel: '-',
        matchedPlatformId: '-',
        error: '배민ID·쿠팡ID 모두 비어 있음'
      };
    }

    const candidates = list.filter(driver => {
      const driverBaemin = resolveDriverPlatformId(driver, 'baemin');
      const driverCoupang = resolveDriverPlatformId(driver, 'coupang');
      // 배민: 앞자리 0 유무 무시 (엑셀 숫자 읽기 대응). 쿠팡: 공백 무시.
      const baeminOk = !baemin || baeminIdsEqual(driverBaemin, baemin);
      const coupangOk = !coupang || coupangIdsEqual(driverCoupang, coupang);
      return baeminOk && coupangOk;
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
        matchedPlatformId: baemin || coupang || '-',
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
        matchedPlatformId: baemin || coupang || '-',
        error: '등록된 기사와 매칭 실패'
      };
    }

    const driver = candidates[0];
    let matchPlatform = 'both';
    if (baemin && !coupang) matchPlatform = 'baemin';
    else if (coupang && !baemin) matchPlatform = 'coupang';

    const matchedBaeminId = resolveDriverPlatformId(driver, 'baemin');
    const matchedCoupangId = resolveDriverPlatformId(driver, 'coupang');
    let matchedPlatformId = '-';
    if (matchPlatform === 'baemin') matchedPlatformId = matchedBaeminId || baemin;
    else if (matchPlatform === 'coupang') matchedPlatformId = matchedCoupangId || coupang;
    else if (matchedBaeminId && matchedCoupangId) matchedPlatformId = `${matchedBaeminId} / ${matchedCoupangId}`;
    else matchedPlatformId = matchedBaeminId || matchedCoupangId || baemin || coupang;

    return {
      status: 'matched',
      matches: [driver],
      driver,
      driverId: driver.id,
      driverName: driver.name || '',
      matchPlatform,
      matchPlatformLabel: window.BremPayrollSlipUtils?.platformLabel?.(matchPlatform) || matchPlatform,
      matchedPlatformId,
      error: ''
    };
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
      const rematch = matchPromotionBulkRow(row.baeminId, row.coupangId, list);
      return rowFromMatch({ ...row, driverId: '' }, rematch);
    }
    const driver = list.find(item => item.id === id);
    if (!driver) return rowFromMatch(row, matchPromotionBulkRow(row.baeminId, row.coupangId, list));

    const baemin = String(row.baeminId || '').trim();
    const coupang = String(row.coupangId || '').trim().replace(/\s/g, '');
    let matchPlatform = 'both';
    if (baemin && !coupang) matchPlatform = 'baemin';
    else if (coupang && !baemin) matchPlatform = 'coupang';

    const matchedBaeminId = resolveDriverPlatformId(driver, 'baemin');
    const matchedCoupangId = resolveDriverPlatformId(driver, 'coupang');
    let matchedPlatformId = '-';
    if (matchPlatform === 'baemin') matchedPlatformId = matchedBaeminId || baemin;
    else if (matchPlatform === 'coupang') matchedPlatformId = matchedCoupangId || coupang;
    else if (matchedBaeminId && matchedCoupangId) matchedPlatformId = `${matchedBaeminId} / ${matchedCoupangId}`;
    else matchedPlatformId = matchedBaeminId || matchedCoupangId || baemin || coupang;

    return {
      ...row,
      matchStatus: 'manual',
      matchStatusLabel: matchStatusLabel('manual'),
      matchCandidates: row.matchCandidates?.length ? row.matchCandidates : [driver],
      matchPlatform,
      matchPlatformLabel: window.BremPayrollSlipUtils?.platformLabel?.(matchPlatform) || matchPlatform,
      matchedPlatformId,
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
      const match = matchPromotionBulkRow(row.baeminId, row.coupangId, drivers);
      return rowFromMatch({ ...row, driverId: '' }, match);
    });
  }

  function parseSheetRows(rows, drivers) {
    if (!Array.isArray(rows) || !rows.length) {
      return { rows: [], issues: ['시트에 데이터가 없습니다.'] };
    }

    const parsedRows = [];
    const issues = [];

    rows.forEach((row, index) => {
      if (isHeaderRow(row) || isRowEmpty(row)) return;

      const baeminId = normalizeExcelPlatformId(cellValue(row, COL.baeminId));
      const coupangId = normalizeExcelPlatformId(cellValue(row, COL.coupangId));
      const bremPromotion = parseMoney(cellValue(row, COL.bremPromotion));
      const match = matchPromotionBulkRow(baeminId, coupangId, drivers);

      // 매칭되면 등록 기사 배민ID(앞 0 포함)를 우선 표시
      const preferredBaemin = match.driver
        ? (resolveDriverPlatformId(match.driver, 'baemin') || baeminId)
        : baeminId;

      const item = rowFromMatch({
        rowNumber: index + 1,
        rowKey: `promo-bulk-${index + 1}`,
        baeminId: preferredBaemin,
        coupangId,
        bremPromotion
      }, match);

      parsedRows.push(item);
      if (match.status !== 'matched' && match.status !== 'manual') {
        issues.push(`${item.rowNumber}행: ${match.error || matchStatusLabel(match.status)}`);
      } else if (!bremPromotion) {
        issues.push(`${item.rowNumber}행: D열 BREM프로모션 금액 없음`);
      }
    });

    return { rows: parsedRows, issues };
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

  function normalizeId(value) {
    return String(value || '').trim();
  }

  /** 매칭 행을 ERP 기사 기준으로 BREM금액 합산 */
  function aggregateMatchedRowsByDriver(rows) {
    const byDriver = new Map();
    let mergedDuplicateInSheet = 0;

    (Array.isArray(rows) ? rows : []).forEach(row => {
      if (row.matchStatus !== 'matched' && row.matchStatus !== 'manual') return;
      const driverId = normalizeId(row.driverId);
      if (!driverId) return;
      const amount = Number(row.bremPromotion || 0);

      if (byDriver.has(driverId)) {
        const prev = byDriver.get(driverId);
        prev.bremPromotion = Number(prev.bremPromotion || 0) + amount;
        prev.mergeCount = Number(prev.mergeCount || 1) + 1;
        if (!prev.baeminId && row.baeminId) prev.baeminId = row.baeminId;
        if (!prev.coupangId && row.coupangId) prev.coupangId = row.coupangId;
        const rowNums = String(prev.rowNumber || '').split(',');
        if (!rowNums.includes(String(row.rowNumber))) {
          prev.rowNumber = `${prev.rowNumber},${row.rowNumber}`;
        }
        mergedDuplicateInSheet += 1;
        return;
      }

      byDriver.set(driverId, {
        ...row,
        bremPromotion: amount,
        mergeCount: 1
      });
    });

    return {
      rows: [...byDriver.values()],
      mergedDuplicateInSheet
    };
  }

  /**
   * 여러 파일·시트 중복 대응: 같은 기사는 금액을 합산.
   * 이미 적용된 기사 → 제외하지 않고 추가 적용(배치 합산)
   */
  function filterRowsForApply(rows, appliedDriverIds) {
    const applied = appliedDriverIds instanceof Set
      ? appliedDriverIds
      : collectAppliedDriverIds(appliedDriverIds);
    const aggregated = aggregateMatchedRowsByDriver(rows);
    let mergedAlreadyApplied = 0;
    let skippedNoAmount = 0;
    const toApply = [];

    aggregated.rows.forEach(row => {
      if (!(Number(row.bremPromotion || 0) > 0)) {
        skippedNoAmount += 1;
        return;
      }
      const driverId = normalizeId(row.driverId);
      if (applied.has(driverId)) mergedAlreadyApplied += 1;
      toApply.push(row);
    });

    return {
      toApply,
      skippedAlreadyApplied: 0,
      skippedDuplicateInSheet: 0,
      skippedNoAmount,
      mergedDuplicateInSheet: aggregated.mergedDuplicateInSheet,
      mergedAlreadyApplied
    };
  }

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

  function collectAppliedDriverIds(batches) {
    const ids = new Set();
    (Array.isArray(batches) ? batches : []).forEach(batch => {
      (Array.isArray(batch.rows) ? batch.rows : []).forEach(row => {
        const id = normalizeId(row.driverId);
        if (id) ids.add(id);
      });
    });
    return ids;
  }

  function aggregateAppliedBatches(batches) {
    const list = Array.isArray(batches) ? batches : [];
    const byDriver = new Map();
    list.forEach(batch => {
      (Array.isArray(batch.rows) ? batch.rows : []).forEach(row => {
        if (row.matchStatus !== 'matched' && row.matchStatus !== 'manual') return;
        const id = normalizeId(row.driverId);
        if (!id) return;
        const amount = parseMoney(row.bremPromotion);
        if (!(amount > 0)) return;
        const prev = byDriver.get(id);
        if (prev) {
          prev.bremPromotion = Number(prev.bremPromotion || 0) + amount;
          return;
        }
        byDriver.set(id, { ...row, bremPromotion: amount });
      });
    });
    return [...byDriver.values()];
  }

  function buildPromotionBulkMap(bulkRows) {
    const map = new Map();
    (Array.isArray(bulkRows) ? bulkRows : []).forEach(row => {
      if (!row.driverId) return;
      if (row.matchStatus !== 'matched' && row.matchStatus !== 'manual') return;
      const id = normalizeId(row.driverId);
      if (!id) return;
      const amount = parseMoney(row.bremPromotion);
      if (!(amount > 0)) return;
      const prev = map.get(id);
      if (prev) {
        prev.bremPromotion += amount;
        return;
      }
      map.set(id, {
        bremPromotion: amount,
        baeminId: row.baeminId || '',
        coupangId: row.coupangId || '',
        matchPlatformLabel: row.matchPlatformLabel || '-',
        matchedPlatformId: row.matchedPlatformId || '-'
      });
    });
    return map;
  }

  function summarizeAppliedBatches(batches) {
    const aggregated = aggregateAppliedBatches(batches);
    let matchedDrivers = 0;
    let bremPromotionTotal = 0;
    aggregated.forEach(entry => {
      matchedDrivers += 1;
      bremPromotionTotal += Number(entry.bremPromotion || 0);
    });
    return {
      batchCount: (Array.isArray(batches) ? batches : []).length,
      matchedDrivers,
      bremPromotionTotal
    };
  }

  function summarizeRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    return list.reduce((acc, row) => {
      acc.total += 1;
      if (row.matchStatus === 'matched' || row.matchStatus === 'manual') acc.matched += 1;
      else acc.unmatched += 1;
      acc.bremPromotionTotal += Number(row.bremPromotion || 0);
      return acc;
    }, {
      total: 0,
      matched: 0,
      unmatched: 0,
      bremPromotionTotal: 0
    });
  }

  function templateRows() {
    return [
      ['A 배민아이디', 'B 쿠팡아이디', 'C (비고)', 'D BREM프로모션'],
      ['bm_sample01', '홍길동01012345678', '', 100000],
      ['bm_sample02', '', '', 50000]
    ];
  }

  window.BremPayrollPromotionBulk = Object.freeze({
    COL,
    parseSheetRows,
    summarizeRows,
    buildPromotionBulkMap,
    collectAppliedDriverIds,
    aggregateMatchedRowsByDriver,
    aggregateAppliedBatches,
    summarizeAppliedBatches,
    filterRowsForApply,
    buildPreviewRows,
    getUnmatchedLines,
    getDuplicateLines,
    rematchRows,
    applyManualDriverToRow,
    matchPromotionBulkRow,
    matchStatusLabel,
    templateRows
  });
})();
