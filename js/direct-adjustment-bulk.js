(function () {
  // 직계약 지급 조정 일괄 업로드 파서 — A열 기사ID(배민 또는 쿠팡), B열 금액.
  const COL = Object.freeze({
    baeminId: 0,
    amount: 1
  });

  const HEADER_MARKERS = ['배민', 'baemin', '쿠팡', 'coupang', '아이디', 'id', '금액', 'amount', '프로모션', 'brem', '기타지급'];

  function normalizePlatform(platform) {
    return platform === 'coupang' ? 'coupang' : 'baemin';
  }

  function platformIdField(platform) {
    return normalizePlatform(platform) === 'coupang' ? 'coupangId' : 'baeminId';
  }

  function platformIdLabel(platform) {
    return normalizePlatform(platform) === 'coupang' ? '쿠팡ID' : '배민ID';
  }

  function cellValue(row, index) {
    if (!row || index >= row.length) return '';
    const value = row[index];
    if (value === undefined || value === null) return '';
    return value;
  }

  function parseMoney(value) {
    return window.BremPayrollSlipUtils?.parseMoney?.(value)
      ?? (Number(String(value ?? '').replace(/[^\d.-]/g, '')) || 0);
  }

  function normalizeBaeminId(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (window.BremWeeklySettlement?.normalizeBaeminUserId) {
      return window.BremWeeklySettlement.normalizeBaeminUserId(raw);
    }
    return raw;
  }

  function baeminIdMatchKey(value) {
    if (window.BremWeeklySettlement?.baeminIdMatchKey) {
      return window.BremWeeklySettlement.baeminIdMatchKey(value);
    }
    const v = normalizeBaeminId(value).replace(/\s+/g, '');
    if (!v) return '';
    return /^\d+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v.toLowerCase();
  }

  // 쿠팡ID는 배민 사용자ID 정규화 규칙과 다르므로 공백만 제거하고 대소문자만 맞춘다.
  function normalizeCoupangId(value) {
    return String(value ?? '').trim().replace(/\s/g, '').toLowerCase();
  }

  function normalizeIdFor(platform, value) {
    return normalizePlatform(platform) === 'coupang'
      ? normalizeCoupangId(value)
      : normalizeBaeminId(value);
  }

  function matchIdFor(platform, value) {
    return normalizePlatform(platform) === 'coupang'
      ? normalizeCoupangId(value)
      : baeminIdMatchKey(value);
  }

  // 기사 레코드에는 쿠팡ID가 따로 저장되지 않는다. 쿠팡ID는 「이름+연락처 뒤 4자리」로
  // 계산되는 값이라, driver.coupangId 를 그대로 보면 비어 있어서 전원 미매칭이 된다.
  // 주정산서 업로드·급여명세서 일괄등록과 같은 방식으로 계산해서 비교한다.
  function driverIdForMatch(driver, platform) {
    const p = normalizePlatform(platform);
    const resolved = window.BremPayrollSlipUtils?.resolveDriverPlatformId?.(driver, p);
    if (resolved) return resolved;
    if (p === 'coupang') {
      return String(
        window.BremDriverUtils?.getErpCoupangId?.(driver)
        || driver?.coupangLoginKey
        || driver?.coupangId
        || ''
      ).replace(/\s/g, '');
    }
    return String(driver?.baeminId || '').trim();
  }

  function normalizedDriverIdForMatch(driver, platform) {
    return matchIdFor(platform, driverIdForMatch(driver, platform));
  }

  function isHeaderRow(row) {
    const idText = String(cellValue(row, COL.baeminId) || '').trim().toLowerCase();
    if (!idText) return false;
    // 금액 칸이 숫자면 데이터 행으로 간주(헤더 아님)
    const amountText = String(cellValue(row, COL.amount) ?? '').trim();
    const amountIsNumeric = /^[\d,]+(\.\d+)?$/.test(amountText.replace(/\s/g, ''));
    if (amountIsNumeric) return false;
    return HEADER_MARKERS.some(marker => idText.includes(marker));
  }

  function isRowEmpty(row) {
    const baeminId = normalizeBaeminId(cellValue(row, COL.baeminId));
    const amount = parseMoney(cellValue(row, COL.amount));
    return !baeminId && !amount;
  }

  function matchStatusLabel(status) {
    if (status === 'matched') return '매칭';
    if (status === 'duplicate') return '중복매칭';
    if (status === 'manual') return '수동선택';
    if (status === 'empty_id') return 'ID 없음';
    return '미매칭';
  }

  function matchRow(baeminId, drivers, platform) {
    const p = normalizePlatform(platform);
    const label = platformIdLabel(p);
    const id = matchIdFor(p, baeminId);
    const list = Array.isArray(drivers) ? drivers : [];
    if (!id) {
      return { status: 'empty_id', driver: null, driverId: '', driverName: '', matches: [], error: `A열 ${label} 없음` };
    }
    const candidates = list.filter(driver => normalizedDriverIdForMatch(driver, p) === id);
    if (candidates.length > 1) {
      return { status: 'duplicate', driver: null, driverId: '', driverName: '', matches: candidates, error: `동일 ${label}로 여러 기사 매칭` };
    }
    if (!candidates.length) {
      return { status: 'unmatched', driver: null, driverId: '', driverName: '', matches: [], error: '등록된 기사와 매칭 실패' };
    }
    const driver = candidates[0];
    return { status: 'matched', driver, driverId: driver.id, driverName: driver.name || '', matches: [driver], error: '' };
  }

  function rowFromMatch(row, match, platform) {
    return {
      ...row,
      matchStatus: match.status,
      matchStatusLabel: matchStatusLabel(match.status),
      matchCandidates: Array.isArray(match.matches) ? match.matches : [],
      driverId: match.driverId || '',
      driverName: match.driverName || (match.driver?.name || ''),
      matchedBaeminId: match.driver ? driverIdForMatch(match.driver, platform) : '',
      error: match.error || ''
    };
  }

  function applyManualDriverToRow(row, driverId, drivers, platform) {
    const p = normalizePlatform(platform);
    const id = String(driverId || '').trim();
    const list = Array.isArray(drivers) ? drivers : [];
    if (!id) {
      return rowFromMatch({ ...row, driverId: '' }, matchRow(row.baeminId, list, p), p);
    }
    const driver = list.find(item => item.id === id);
    if (!driver) {
      return rowFromMatch(row, matchRow(row.baeminId, list, p), p);
    }
    return {
      ...row,
      matchStatus: 'manual',
      matchStatusLabel: matchStatusLabel('manual'),
      matchCandidates: row.matchCandidates?.length ? row.matchCandidates : [driver],
      driverId: driver.id,
      driverName: driver.name || '',
      matchedBaeminId: driverIdForMatch(driver, p),
      error: ''
    };
  }

  function rematchRows(rows, drivers, platform) {
    const p = normalizePlatform(platform);
    return (Array.isArray(rows) ? rows : []).map(row => {
      if (row.matchStatus === 'manual' && row.driverId) {
        return applyManualDriverToRow(row, row.driverId, drivers, p);
      }
      return rowFromMatch({ ...row, driverId: '' }, matchRow(row.baeminId, drivers, p), p);
    });
  }

  function parseSheetRows(rows, drivers, platform) {
    const p = normalizePlatform(platform);
    if (!Array.isArray(rows) || !rows.length) {
      return { rows: [], issues: ['시트에 데이터가 없습니다.'] };
    }
    const parsedRows = [];
    const issues = [];
    rows.forEach((row, index) => {
      if (isHeaderRow(row) || isRowEmpty(row)) return;
      // 표시는 원본 그대로 두고, 매칭할 때만 플랫폼 규칙으로 정규화한다.
      const baeminId = String(cellValue(row, COL.baeminId) ?? '').trim();
      const amount = parseMoney(cellValue(row, COL.amount));
      const match = matchRow(baeminId, drivers, p);
      const item = rowFromMatch({
        rowNumber: index + 1,
        rowKey: `direct-adj-${index + 1}`,
        baeminId,
        amount
      }, match, p);
      parsedRows.push(item);
      if (match.status !== 'matched' && match.status !== 'manual') {
        issues.push(`${item.rowNumber}행: ${match.error || matchStatusLabel(match.status)}`);
      } else if (!amount) {
        issues.push(`${item.rowNumber}행: B열 금액 없음`);
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

  // 같은 기사가 시트에 여러 번 나오면 금액을 합산해 1행으로 만든다.
  // (예: 강승원2471 10,000원 + 강승원2471 23,000원 → 33,000원)
  function filterRowsForApply(rows) {
    const byDriver = new Map();
    const toApply = [];
    let mergedRows = 0;
    let mergedDrivers = 0;
    let skippedNoAmount = 0;
    (Array.isArray(rows) ? rows : []).forEach(row => {
      const ok = row.matchStatus === 'matched' || row.matchStatus === 'manual';
      if (!ok || !row.driverId) return;
      const amount = Number(row.amount || 0);
      if (!amount) { skippedNoAmount += 1; return; }
      const id = String(row.driverId).trim();
      const existing = byDriver.get(id);
      if (existing) {
        existing.amount += amount;
        existing.mergedRowNumbers.push(row.rowNumber);
        mergedRows += 1;
        if (existing.mergedRowNumbers.length === 2) mergedDrivers += 1;
        return;
      }
      // 원본 미리보기 행은 그대로 두고 합산용 사본을 만든다.
      const entry = { ...row, amount, mergedRowNumbers: [row.rowNumber] };
      byDriver.set(id, entry);
      toApply.push(entry);
    });
    return { toApply, mergedRows, mergedDrivers, skippedNoAmount };
  }

  /** 미리보기에서 "합산됨"을 알려주기 위한 기사별 중복 그룹. driverId → { rowNumbers, total } */
  function duplicateDriverGroups(rows) {
    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach(row => {
      const ok = row.matchStatus === 'matched' || row.matchStatus === 'manual';
      const id = String(row.driverId || '').trim();
      const amount = Number(row.amount || 0);
      if (!ok || !id || !amount) return;
      const group = groups.get(id) || { rowNumbers: [], total: 0 };
      group.rowNumbers.push(row.rowNumber);
      group.total += amount;
      groups.set(id, group);
    });
    groups.forEach((group, id) => {
      if (group.rowNumbers.length < 2) groups.delete(id);
    });
    return groups;
  }

  function summarizeRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    return list.reduce((acc, row) => {
      acc.total += 1;
      if (row.matchStatus === 'matched' || row.matchStatus === 'manual') acc.matched += 1;
      else acc.unmatched += 1;
      acc.amountTotal += Number(row.amount || 0);
      return acc;
    }, { total: 0, matched: 0, unmatched: 0, amountTotal: 0 });
  }

  function sheetRowsFromWorkbook(workbook) {
    if (!workbook?.SheetNames?.length) return { rows: [], sheetName: '' };
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    return { rows, sheetName };
  }

  function templateRows(kindLabel, platform) {
    return [
      [`A ${platformIdLabel(platform)}`, `B ${kindLabel || '금액'}`],
      ['BC063824', 100000],
      ['kivw3233', 50000]
    ];
  }

  window.BremDirectAdjustmentBulk = Object.freeze({
    COL,
    platformIdField,
    platformIdLabel,
    driverIdForMatch,
    parseSheetRows,
    rematchRows,
    applyManualDriverToRow,
    matchRow,
    matchStatusLabel,
    getUnmatchedLines,
    getDuplicateLines,
    filterRowsForApply,
    duplicateDriverGroups,
    summarizeRows,
    sheetRowsFromWorkbook,
    templateRows
  });
})();
