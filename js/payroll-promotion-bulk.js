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
    const baeminId = String(cellValue(row, COL.baeminId) || '').trim();
    const coupangId = String(cellValue(row, COL.coupangId) || '').trim();
    const bremPromotion = parseMoney(cellValue(row, COL.bremPromotion));
    return !baeminId && !coupangId && !bremPromotion;
  }

  function matchPromotionBulkRow(baeminId, coupangId, drivers) {
    const baemin = String(baeminId || '').trim();
    const coupang = String(coupangId || '').trim().replace(/\s/g, '');
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
      const baeminOk = !baemin || driverBaemin === baemin;
      const coupangOk = !coupang || driverCoupang === coupang;
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

      const baeminId = String(cellValue(row, COL.baeminId) || '').trim();
      const coupangId = String(cellValue(row, COL.coupangId) || '').trim().replace(/\s/g, '');
      const bremPromotion = parseMoney(cellValue(row, COL.bremPromotion));
      const match = matchPromotionBulkRow(baeminId, coupangId, drivers);

      const item = rowFromMatch({
        rowNumber: index + 1,
        rowKey: `promo-bulk-${index + 1}`,
        baeminId,
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

  /** 정산서 여러 장 — 기사별 금액 누적 */
  function filterRowsForApply(rows) {
    const toApply = [];
    let skippedNoAmount = 0;

    (Array.isArray(rows) ? rows : []).forEach(row => {
      const okStatus = row.matchStatus === 'matched' || row.matchStatus === 'manual';
      if (!okStatus || !row.driverId) return;
      if (!Number(row.bremPromotion || 0)) {
        skippedNoAmount += 1;
        return;
      }
      toApply.push(row);
    });

    return { toApply, skippedNoAmount, skippedDuplicateInSheet: 0 };
  }

  function aggregateAppliedBatches(batches) {
    const list = Array.isArray(batches) ? batches : [];
    const summed = new Map();
    list.forEach(batch => {
      (Array.isArray(batch.rows) ? batch.rows : []).forEach(row => {
        if (!row.driverId) return;
        if (row.matchStatus !== 'matched' && row.matchStatus !== 'manual') return;
        const id = String(row.driverId).trim();
        const amount = parseMoney(row.bremPromotion);
        const prev = summed.get(id);
        if (prev) {
          prev.bremPromotion += amount;
        } else {
          summed.set(id, { ...row, bremPromotion: amount });
        }
      });
    });
    return Array.from(summed.values());
  }

  function buildPromotionBulkMap(bulkRows) {
    const map = new Map();
    (Array.isArray(bulkRows) ? bulkRows : []).forEach(row => {
      if (!row.driverId) return;
      if (row.matchStatus !== 'matched' && row.matchStatus !== 'manual') return;
      const id = String(row.driverId).trim();
      const amount = parseMoney(row.bremPromotion);
      const prev = map.get(id);
      if (prev) {
        prev.bremPromotion += amount;
      } else {
        map.set(id, {
          bremPromotion: amount,
          baeminId: row.baeminId || '',
          coupangId: row.coupangId || '',
          matchPlatformLabel: row.matchPlatformLabel || '-',
          matchedPlatformId: row.matchedPlatformId || '-'
        });
      }
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
    aggregateAppliedBatches,
    summarizeAppliedBatches,
    filterRowsForApply,
    getUnmatchedLines,
    getDuplicateLines,
    rematchRows,
    applyManualDriverToRow,
    matchPromotionBulkRow,
    matchStatusLabel,
    templateRows
  });
})();
