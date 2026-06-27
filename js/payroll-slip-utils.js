(function () {
  // Excel column letters → 0-based index (A=0, B=1, …)
  const COL = Object.freeze({
    branchName: 1,              // B 대리점명
    riderName: 2,               // C 기사명
    callCount: 5,               // F 운행건수 → 콜수
    totalDeliveryFee: 6,        // G 배달료
    baeminMission: 7,           // H 배민미션
    otherPayment: 8,            // I 기타지급
    jColumnAmount: 9,           // J (원천세 Q 차감 기준 — BREM 지급과 별개)
    employmentInsurance: 10,    // K 고용보험
    industrialAccidentInsurance: 12, // M 산재보험
    callFeeO: 14,               // O 콜수수료(1)
    callFeeP: 15,               // P 콜수수료(2)
    excelWithholdingTax: 16,    // Q 원천세(엑셀)
    excelNetPay: 17             // R 실지급액
  });

  /** 엑셀 1행=헤더, 2행부터 데이터 (0-based index 1) */
  const DATA_START_ROW_INDEX = 1;

  const DAILY_SETTLEMENT_RATE = 0.02;
  const PROMOTION_WITHHOLDING_RATE = 0.033;
  const HEADER_MARKERS = ['대리점', '기사명', '기사', 'branch', 'name'];

  const PAYSLIP_PREVIEW_GROUPS = Object.freeze([
    {
      id: 'info',
      label: '기사',
      fields: [
        { key: 'riderName', label: '기사명' },
        { key: 'matchedCoupangId', label: '쿠팡ID', idField: true },
        { key: 'matchedBaeminId', label: '배민ID', idField: true },
        { key: 'matchStatusLabel', label: '매칭', adminOnly: true },
        { key: 'selectedDriverName', label: '선택', adminOnly: true },
        { key: 'dailySettlementApply', label: '일정산', applyToggle: true }
      ]
    },
    {
      id: 'pay',
      label: '지급',
      fields: [
        { key: 'totalDeliveryFee', label: '배달료', money: true },
        { key: 'baeminMission', label: '배민미션', money: true },
        { key: 'otherPayment', label: '기타지급', money: true },
        { key: 'bremPromotion', label: 'BREM프로모션', money: true, bulkOnly: true },
        { key: 'grossPaymentTotal', label: '지급총액', money: true, emphasis: true }
      ]
    },
    {
      id: 'deduct',
      label: '공제',
      fields: [
        { key: 'employmentInsurance', label: '고용', money: true },
        { key: 'industrialAccidentInsurance', label: '산재', money: true },
        { key: 'hourlyInsurance', label: '시간제보험', money: true },
        { key: 'withholdingTax', label: '원천세', money: true },
        { key: 'promotionWithholdingTax', label: '프로모션원천세', money: true, bulkOnly: true },
        { key: 'callFee', label: '콜수수료', money: true },
        { key: 'dailySettlementFee', label: '일정산수수료', money: true, dailyOnly: true },
        { key: 'deductionTotal', label: '공제합', money: true, emphasis: true }
      ]
    },
    {
      id: 'net',
      label: '실지급',
      fields: [
        { key: 'calculatedNetPay', label: '최종지급액', money: true, emphasis: true },
        { key: 'excelNetPay', label: '엑셀', money: true, adminOnly: true },
        { key: 'netPayDiff', label: '차액', money: true, diff: true, adminOnly: true }
      ]
    }
  ]);

  /** 급여명세서 목록·저장·출력용 그룹 (미리보기와 동일 구조, 관리/토글 제외) */
  const PAYSLIP_LIST_GROUPS = Object.freeze([
    {
      id: 'info',
      label: '기사',
      fields: [
        { key: 'riderName', label: '기사명' },
        { key: 'coupangId', label: '쿠팡ID', idField: true },
        { key: 'baeminId', label: '배민ID', idField: true }
      ]
    },
    {
      id: 'pay',
      label: '지급',
      fields: [
        { key: 'totalDeliveryFee', label: '배달료', money: true },
        { key: 'baeminMission', label: '배민미션', money: true },
        { key: 'otherPayment', label: '기타지급', money: true },
        { key: 'bremPromotion', label: 'BREM프로모션', money: true, bulkOnly: true },
        { key: 'grossPaymentTotal', label: '지급총액', money: true, emphasis: true }
      ]
    },
    {
      id: 'deduct',
      label: '공제',
      fields: [
        { key: 'employmentInsurance', label: '고용', money: true },
        { key: 'industrialAccidentInsurance', label: '산재', money: true },
        { key: 'hourlyInsurance', label: '시간제보험', money: true },
        { key: 'withholdingTax', label: '원천세', money: true },
        { key: 'promotionWithholdingTax', label: '프로모션원천세', money: true, bulkOnly: true },
        { key: 'callFee', label: '콜수수료', money: true },
        { key: 'dailySettlementFee', label: '일정산수수료', money: true, dailyOnly: true },
        { key: 'deductionTotal', label: '공제합', money: true, emphasis: true }
      ]
    },
    {
      id: 'net',
      label: '실지급',
      fields: [
        { key: 'finalNetPay', label: '최종지급액', money: true, emphasis: true }
      ]
    }
  ]);

  /** 급여명세서 저장·출력용 필드 */
  const PAYSLIP_RECORD_FIELDS = Object.freeze([
    { key: 'riderName', label: '기사명' },
    { key: 'coupangId', label: '쿠팡ID' },
    { key: 'baeminId', label: '배민ID' },
    { key: 'totalDeliveryFee', label: '배달료', money: true },
    { key: 'baeminMission', label: '배민미션', money: true },
    { key: 'otherPayment', label: '기타지급', money: true },
    { key: 'bremPromotion', label: 'BREM프로모션', money: true },
    { key: 'grossPaymentTotal', label: '지급총액', money: true },
    { key: 'employmentInsurance', label: '고용', money: true },
    { key: 'industrialAccidentInsurance', label: '산재', money: true },
    { key: 'hourlyInsurance', label: '시간제보험', money: true },
    { key: 'withholdingTax', label: '원천세', money: true },
    { key: 'promotionWithholdingTax', label: '프로모션원천세', money: true },
    { key: 'callFee', label: '콜수수료', money: true },
    { key: 'dailySettlementFee', label: '일정산수수료', money: true },
    { key: 'deductionTotal', label: '공제합', money: true },
    { key: 'finalNetPay', label: '최종지급액', money: true }
  ]);

  const PAYSLIP_DETAIL_FIELDS = Object.freeze([
    { key: 'branchName', label: '대리점' },
    { key: 'totalDeliveryFee', label: '배달료', money: true },
    { key: 'withholdingTax', label: '원천세', money: true },
    { key: 'callCount', label: '콜수', number: true },
    { key: 'registeredCallCount', label: '등록콜수', number: true },
    { key: 'excelWithholdingTax', label: 'Q열(엑셀)', money: true },
    { key: 'jColumnAmount', label: 'J열', money: true },
    { key: 'jWithholdingDeduction', label: 'J×3.3%', money: true },
    { key: 'matchPlatformLabel', label: '플랫폼' },
    { key: 'matchedPlatformId', label: '매칭ID' }
  ]);

  /** @deprecated 상세/레거시용 */
  const PREVIEW_FIELDS = Object.freeze([
    { key: 'branchName', label: '대리점명' },
    { key: 'riderName', label: '기사명' },
    { key: 'matchStatusLabel', label: '매칭상태' },
    { key: 'matchPlatformLabel', label: '매칭플랫폼' },
    { key: 'matchedPlatformId', label: '매칭ID' },
    { key: 'selectedDriverName', label: '선택된 기사' },
    { key: 'callCount', label: '콜수', number: true },
    { key: 'registeredCallCount', label: '등록 콜수(정산주)', number: true },
    { key: 'totalDeliveryFee', label: '배달료', money: true },
    { key: 'baeminMission', label: '배민미션', money: true },
    { key: 'otherPayment', label: '기타지급', money: true },
    { key: 'bremPromotion', label: 'BREM프로모션', money: true },
    { key: 'grossPaymentTotal', label: '지급총액', money: true },
    { key: 'employmentInsurance', label: '고용보험', money: true },
    { key: 'industrialAccidentInsurance', label: '산재보험', money: true },
    { key: 'hourlyInsurance', label: '시간제보험', money: true },
    { key: 'excelWithholdingTax', label: 'Q열(원본)', money: true, adminOnly: true },
    { key: 'jColumnAmount', label: 'J열', money: true, adminOnly: true },
    { key: 'jWithholdingDeduction', label: 'J×3.3%차감', money: true, adminOnly: true },
    { key: 'withholdingTax', label: '원천세', money: true },
    { key: 'promotionWithholdingTax', label: '프로모션원천세(3.3%)', money: true },
    { key: 'callFee', label: '콜수수료(O+P)', money: true },
    { key: 'dailySettlementFee', label: '일정산 수수료(2%)', money: true, adminOnly: true },
    { key: 'adminAdjustedCallFee', label: '일정산 조정 콜수', money: true, adminOnly: true },
    { key: 'dailySettlementRegion', label: '일정산 지역', adminOnly: true },
    { key: 'paymentTotal', label: '지급합계', money: true },
    { key: 'deductionTotal', label: '공제합계', money: true },
    { key: 'calculatedNetPay', label: '최종지급액', money: true },
    { key: 'excelNetPay', label: '엑셀 실지급액', money: true },
    { key: 'netPayDiff', label: '차액', money: true }
  ]);

  function calcJWithholdingDeduction(jColumnAmount) {
    const amount = parseMoney(jColumnAmount);
    if (!amount) return 0;
    return Math.floor(amount * PROMOTION_WITHHOLDING_RATE);
  }

  function calcPromotionWithholdingTax(bremPromotion, fromBulk) {
    if (!fromBulk) return 0;
    return calcJWithholdingDeduction(bremPromotion);
  }

  /** @deprecated calcJWithholdingDeduction 사용 */
  function calcOtherPaymentWithholdingDeduction(amount) {
    return calcJWithholdingDeduction(amount);
  }

  function applyPromotionBulkToLine(line, bulkMap) {
    if (!bulkMap || !line.selectedDriverId) return line;
    const bulk = bulkMap.get(line.selectedDriverId);
    if (!bulk) return line;
    return {
      ...line,
      bremPromotion: bulk.bremPromotion,
      bremPromotionFromBulk: true
    };
  }

  function applyHourlyInsuranceBulkToLine(line, bulkMap) {
    if (!bulkMap || !line.selectedDriverId) return line;
    const bulk = bulkMap.get(line.selectedDriverId);
    if (!bulk) return line;
    return {
      ...line,
      hourlyInsurance: bulk.hourlyInsurance,
      hourlyInsuranceFromBulk: true
    };
  }

  function buildPromotionBulkMap(bulkRows) {
    const bulkUtils = window.BremPayrollPromotionBulk;
    if (bulkUtils?.buildPromotionBulkMap) {
      return bulkUtils.buildPromotionBulkMap(bulkRows);
    }
    const map = new Map();
    (Array.isArray(bulkRows) ? bulkRows : []).forEach(row => {
      if (!row.driverId) return;
      if (row.matchStatus !== 'matched' && row.matchStatus !== 'manual') return;
      const id = String(row.driverId).trim();
      if (map.has(id)) return;
      map.set(id, {
        bremPromotion: parseMoney(row.bremPromotion),
        baeminId: row.baeminId || '',
        coupangId: row.coupangId || ''
      });
    });
    return map;
  }

  function buildHourlyInsuranceBulkMap(bulkRows) {
    const bulkUtils = window.BremPayrollHourlyInsuranceBulk;
    if (bulkUtils?.buildHourlyInsuranceBulkMap) {
      return bulkUtils.buildHourlyInsuranceBulkMap(bulkRows);
    }
    const map = new Map();
    (Array.isArray(bulkRows) ? bulkRows : []).forEach(row => {
      if (row.matchStatus !== 'matched' || !row.driverId) return;
      if (map.has(row.driverId)) return;
      map.set(row.driverId, {
        hourlyInsurance: parseMoney(row.hourlyInsurance),
        platformId: row.platformId || ''
      });
    });
    return map;
  }

  function detectBranchPlatform(branchName) {
    const text = String(branchName || '').trim().toLowerCase();
    if (/쿠팡|coupang/.test(text)) return 'coupang';
    if (/배민|baemin|우아한/.test(text)) return 'baemin';
    return '';
  }

  function platformLabel(platform) {
    if (platform === 'coupang') return '쿠팡';
    if (platform === 'baemin') return '배민';
    if (platform === 'both') return '쿠팡·배민';
    return '-';
  }

  function resolveDriverPlatformId(driver, platform) {
    if (!driver) return '';
    const driverUtils = window.BremDriverUtils;
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

  function inferMatchPlatform(branchPlatform, driver) {
    if (branchPlatform) return branchPlatform;
    if (!driver) return '';
    const coupangId = resolveDriverPlatformId(driver, 'coupang');
    const baeminId = resolveDriverPlatformId(driver, 'baemin');
    if (coupangId && baeminId) return 'both';
    if (coupangId) return 'coupang';
    if (baeminId) return 'baemin';
    return '';
  }

  function resolveMatchedPlatformId(platform, driver, branchPlatform) {
    if (!driver) return '';
    const effectivePlatform = platform || inferMatchPlatform(branchPlatform, driver);
    if (effectivePlatform === 'both') {
      const baeminId = resolveDriverPlatformId(driver, 'baemin');
      const coupangId = resolveDriverPlatformId(driver, 'coupang');
      if (branchPlatform === 'baemin' && baeminId) return baeminId;
      if (branchPlatform === 'coupang' && coupangId) return coupangId;
      if (baeminId && coupangId) return `${baeminId} / ${coupangId}`;
      return baeminId || coupangId || '';
    }
    return resolveDriverPlatformId(driver, effectivePlatform);
  }

  function attachPlatformMatchFields(line, selectedDriver) {
    const branchPlatform = detectBranchPlatform(line.branchName);
    const matchPlatform = inferMatchPlatform(branchPlatform, selectedDriver);
    const matchedPlatformId = selectedDriver
      ? resolveMatchedPlatformId(matchPlatform, selectedDriver, branchPlatform)
      : '';
    return {
      branchPlatform,
      matchPlatform,
      matchPlatformLabel: selectedDriver && matchPlatform ? platformLabel(matchPlatform) : '-',
      matchedPlatformId: matchedPlatformId || '-',
      matchedBaeminId: selectedDriver ? resolveDriverPlatformId(selectedDriver, 'baemin') : '',
      matchedCoupangId: selectedDriver ? resolveDriverPlatformId(selectedDriver, 'coupang') : ''
    };
  }

  function parseMoney(value) {
    if (value === undefined || value === null || value === '') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    const text = String(value).replace(/[,원\s]/g, '').trim();
    if (!text) return 0;
    const num = Number(text);
    return Number.isFinite(num) ? Math.round(num) : 0;
  }

  function parseCount(value) {
    if (value === undefined || value === null || value === '') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    const text = String(value).replace(/[,건\s]/g, '').trim();
    const num = Number(text);
    return Number.isFinite(num) ? Math.round(num) : 0;
  }

  function cellValue(row, index) {
    if (!row || index >= row.length) return '';
    const value = row[index];
    if (value === undefined || value === null) return '';
    return value;
  }

  function normalizeNameKey(value) {
    return String(value || '').trim().replace(/\s+/g, '');
  }

  function matchPrefixesForName(value) {
    const normalized = normalizeNameKey(value);
    const prefixes = [];
    if (normalized.length >= 3) prefixes.push(normalized.slice(0, 3));
    if (normalized.length >= 2) prefixes.push(normalized.slice(0, 2));
    return prefixes;
  }

  function driverMatchesPrefix(driverName, prefix) {
    const normalized = normalizeNameKey(driverName);
    if (!normalized || !prefix) return false;
    if (prefix.length >= 3) return normalized.slice(0, 3) === prefix;
    return normalized.slice(0, 2) === prefix;
  }

  function isHeaderRow(row) {
    const samples = [cellValue(row, COL.branchName), cellValue(row, COL.riderName), cellValue(row, 0)]
      .map(value => String(value || '').trim().toLowerCase());
    return HEADER_MARKERS.some(marker => samples.some(text => text.includes(marker.toLowerCase())));
  }

  function isRowEmpty(row) {
    const riderName = String(cellValue(row, COL.riderName) || '').trim();
    const branchName = String(cellValue(row, COL.branchName) || '').trim();
    const hasMoney = parseMoney(cellValue(row, COL.totalDeliveryFee))
      || parseMoney(cellValue(row, COL.excelNetPay));
    return !riderName && !branchName && !hasMoney;
  }

  function readExcelRow(row) {
    return {
      branchName: String(cellValue(row, COL.branchName) || '').trim(),
      riderName: String(cellValue(row, COL.riderName) || '').trim(),
      callCount: parseCount(cellValue(row, COL.callCount)),
      totalDeliveryFee: parseMoney(cellValue(row, COL.totalDeliveryFee)),
      baeminMission: parseMoney(cellValue(row, COL.baeminMission)),
      otherPayment: parseMoney(cellValue(row, COL.otherPayment)),
      jColumnAmount: parseMoney(cellValue(row, COL.jColumnAmount)),
      bremPromotion: 0,
      bremPromotionFromBulk: false,
      hourlyInsurance: 0,
      employmentInsurance: parseMoney(cellValue(row, COL.employmentInsurance)),
      industrialAccidentInsurance: parseMoney(cellValue(row, COL.industrialAccidentInsurance)),
      callFeeO: parseMoney(cellValue(row, COL.callFeeO)),
      callFeeP: parseMoney(cellValue(row, COL.callFeeP)),
      excelWithholdingTax: parseMoney(cellValue(row, COL.excelWithholdingTax)),
      excelNetPay: parseMoney(cellValue(row, COL.excelNetPay)),
      dailySettlementEnrolled: false,
      dailySettlementRegion: ''
    };
  }

  function computeLine(raw) {
    const totalDeliveryFee = parseMoney(raw.totalDeliveryFee);
    const baeminMission = parseMoney(raw.baeminMission);
    const otherPayment = parseMoney(raw.otherPayment);
    const bremPromotion = parseMoney(raw.bremPromotion);
    const jColumnAmount = parseMoney(raw.jColumnAmount);

    const employmentInsurance = parseMoney(raw.employmentInsurance);
    const industrialAccidentInsurance = parseMoney(raw.industrialAccidentInsurance);
    const hourlyInsurance = parseMoney(raw.hourlyInsurance);
    const excelWithholdingTax = parseMoney(raw.excelWithholdingTax);

    const rawCallFee = parseMoney(raw.callFeeO) + parseMoney(raw.callFeeP);
    const dailySettlementEnrolled = raw.dailySettlementEnrolled === true;
    const dailySettlementApply = dailySettlementEnrolled && raw.dailySettlementApply !== false;
    const dailySettlementFee = dailySettlementApply
      ? Math.floor(totalDeliveryFee * DAILY_SETTLEMENT_RATE)
      : 0;
    const callFee = dailySettlementApply
      ? Math.max(0, rawCallFee - dailySettlementFee)
      : rawCallFee;
    const adminAdjustedCallFee = callFee;

    const jWithholdingDeduction = calcJWithholdingDeduction(jColumnAmount);
    const withholdingTax = Math.max(0, excelWithholdingTax - jWithholdingDeduction);
    const promotionWithholdingTax = calcPromotionWithholdingTax(
      bremPromotion,
      Boolean(raw.bremPromotionFromBulk)
    );

    const grossPaymentTotal = totalDeliveryFee + baeminMission + otherPayment + bremPromotion;
    const paymentTotal = grossPaymentTotal;
    const deductionTotal = employmentInsurance + industrialAccidentInsurance + hourlyInsurance
      + withholdingTax + promotionWithholdingTax + callFee + dailySettlementFee;
    const calculatedNetPay = paymentTotal - deductionTotal;
    const excelNetPay = parseMoney(raw.excelNetPay);
    const netPayDiff = calculatedNetPay - excelNetPay;

    return {
      ...raw,
      callCount: parseCount(raw.callCount),
      totalDeliveryFee,
      baeminMission,
      otherPayment,
      bremPromotion,
      bremPromotionFromBulk: Boolean(raw.bremPromotionFromBulk),
      jColumnAmount,
      grossPaymentTotal,
      employmentInsurance,
      industrialAccidentInsurance,
      hourlyInsurance,
      hourlyInsuranceFromBulk: Boolean(raw.hourlyInsuranceFromBulk),
      excelWithholdingTax,
      jWithholdingDeduction,
      otherPaymentWithholdingDeduction: jWithholdingDeduction,
      withholdingTax,
      promotionWithholdingTax,
      callFeeO: parseMoney(raw.callFeeO),
      callFeeP: parseMoney(raw.callFeeP),
      callFee,
      rawCallFee,
      dailySettlementEnrolled,
      dailySettlementApply,
      dailySettlementFee,
      adminAdjustedCallFee,
      dailySettlementRegion: String(raw.dailySettlementRegion || '').trim(),
      paymentTotal,
      deductionTotal,
      calculatedNetPay,
      excelNetPay,
      netPayDiff,
      grossPay: paymentTotal,
      totalDeduction: deductionTotal,
      netPay: calculatedNetPay
    };
  }

  function matchStatusLabel(status) {
    if (status === 'matched') return '매칭';
    if (status === 'duplicate') return '동명이인';
    if (status === 'manual') return '수동선택';
    if (status === 'short_name') return '이름 2자 미만';
    return '미매칭';
  }

  function matchDriversByPrefix(riderName, drivers) {
    const prefixes = matchPrefixesForName(riderName);
    if (!prefixes.length) {
      return { status: 'short_name', matches: [], prefix: normalizeNameKey(riderName) };
    }

    const list = Array.isArray(drivers) ? drivers : [];
    for (const prefix of prefixes) {
      const matches = list.filter(driver => driverMatchesPrefix(driver.name, prefix));
      if (matches.length === 1) {
        return { status: 'matched', matches, prefix, driverId: matches[0].id, matchLength: prefix.length };
      }
      if (matches.length > 1) {
        return { status: 'duplicate', matches, prefix, driverId: '', matchLength: prefix.length };
      }
    }

    return { status: 'unmatched', matches: [], prefix: prefixes[0], driverId: '' };
  }

  function applyDriverMatch(line, drivers, options = {}) {
    const match = matchDriversByPrefix(line.riderName, drivers);
    let driverId = String(options.selectedDriverId || line.selectedDriverId || '').trim();
    let matchStatus = match.status;

    if (driverId) {
      const selected = (Array.isArray(drivers) ? drivers : []).find(item => item.id === driverId);
      if (selected) {
        matchStatus = 'manual';
      } else {
        driverId = '';
      }
    }

    if (!driverId && match.driverId) {
      driverId = match.driverId;
      matchStatus = 'matched';
    }

    const selectedDriver = driverId
      ? (Array.isArray(drivers) ? drivers : []).find(item => item.id === driverId) || null
      : null;

    const platformFields = attachPlatformMatchFields(line, selectedDriver);

    return {
      ...line,
      matchStatus,
      matchStatusLabel: matchStatusLabel(matchStatus),
      matchCandidates: match.matches,
      namePrefix: match.prefix,
      selectedDriverId: driverId,
      selectedDriverName: selectedDriver?.name || '',
      registeredCallCount: options.registeredCallCount ?? line.registeredCallCount ?? 0,
      ...platformFields
    };
  }

  function validateLine(line) {
    const issues = [];
    if (!String(line.riderName || '').trim()) {
      issues.push('기사명 없음');
    }
    if (!line.paymentTotal && !line.excelNetPay) {
      issues.push('지급·실지급 데이터 없음');
    }
    if (Math.abs(line.netPayDiff || 0) > 1) {
      issues.push('실지급액 차액');
    }
    if (line.matchStatus === 'duplicate' && !line.selectedDriverId) {
      issues.push('동명이인 선택 필요');
    }
    if (line.selectedDriverId && line.registeredCallCount != null
      && line.callCount !== line.registeredCallCount) {
      issues.push('콜수 불일치');
    }
    return issues;
  }

  function summarizeLines(lines) {
    const list = Array.isArray(lines) ? lines : [];
    const totals = list.reduce((acc, line) => {
      acc.paymentTotal += Number(line.paymentTotal || line.grossPay || 0);
      acc.grossPaymentTotal += Number(line.grossPaymentTotal || 0);
      acc.deductionTotal += Number(line.deductionTotal || line.totalDeduction || 0);
      acc.calculatedNetPay += Number(line.calculatedNetPay || line.netPay || 0);
      acc.excelNetPay += Number(line.excelNetPay || 0);
      return acc;
    }, {
      paymentTotal: 0,
      grossPaymentTotal: 0,
      deductionTotal: 0,
      calculatedNetPay: 0,
      excelNetPay: 0
    });
    return {
      ...totals,
      grossPay: totals.paymentTotal,
      totalDeduction: totals.deductionTotal,
      netPay: totals.calculatedNetPay,
      count: list.length
    };
  }

  function parseSheetRows(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      return { lines: [], issues: ['시트에 데이터가 없습니다.'] };
    }

    const lines = [];
    const issues = [];

    rows.forEach((row, index) => {
      if (index < DATA_START_ROW_INDEX) return;
      if (isHeaderRow(row) || isRowEmpty(row)) return;
      const raw = readExcelRow(row);
      if (!String(raw.riderName || '').trim()) return;

      const excelRowNumber = index + 1;
      const line = computeLine({
        ...raw,
        rowNumber: excelRowNumber,
        rowKey: `row-${excelRowNumber}`
      });
      const rowIssues = validateLine(line);
      lines.push({
        ...line,
        matchStatus: 'unmatched',
        matchStatusLabel: matchStatusLabel('unmatched'),
        matchCandidates: [],
        selectedDriverId: '',
        selectedDriverName: '',
        registeredCallCount: null,
        issues: rowIssues
      });
      if (rowIssues.length) {
        issues.push(`${line.rowNumber}행: ${rowIssues.join(', ')}`);
      }
    });

    return { lines, issues };
  }

  function sumCallsForDriverInSettlementWeek(driverId, settlementWeekStart, calls) {
    const id = String(driverId || '').trim();
    const start = normalizeSettlementWeekStart(settlementWeekStart);
    const end = settlementWeekEnd(start);
    if (!id || !start) return 0;
    return (Array.isArray(calls) ? calls : [])
      .filter(call => {
        const day = String(call.date || '').slice(0, 10);
        return call.driverId === id && day >= start && day <= end;
      })
      .reduce((sum, call) => sum + Number(call.count || 0), 0);
  }

  /** @deprecated 주급 정산 — sumCallsForDriverInSettlementWeek 사용 */
  function sumCallsForDriverInMonth(driverId, payMonth, calls) {
    return sumCallsForDriverInSettlementWeek(driverId, payMonth, calls);
  }

  function parseDateKey(value) {
    const text = String(value || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }

  function addDays(dateKeyValue, days) {
    const date = new Date(`${parseDateKey(dateKeyValue)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + days);
    return formatLocalDateKey(date);
  }

  function formatLocalDateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function normalizeSettlementWeekStart(dateValue) {
    const picker = window.BremDatePicker;
    const fallbackToday = picker?.today?.() || formatLocalDateKey(new Date());
    if (picker?.applyWeekWednesday) {
      return picker.applyWeekWednesday(dateValue || picker.weekStartKey?.(fallbackToday) || fallbackToday);
    }
    const seed = parseDateKey(dateValue) || parseDateKey(fallbackToday);
    if (!seed) return '';
    const date = new Date(`${seed}T00:00:00`);
    const diff = (date.getDay() - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return formatLocalDateKey(date);
  }

  function settlementWeekEnd(weekStart) {
    const picker = window.BremDatePicker;
    const normalized = normalizeSettlementWeekStart(weekStart);
    if (!normalized) return '';
    if (picker?.weekEndKey) return picker.weekEndKey(normalized);
    return addDays(normalized, 6);
  }

  /** 수~화 정산주 종료(화) 기준 기본 지급일 = 금요일 (+3일) */
  function defaultPaymentDateForWeek(weekStart) {
    const weekEnd = settlementWeekEnd(weekStart);
    return weekEnd ? addDays(weekEnd, 3) : '';
  }

  function settlementWeekPayKey(weekStart) {
    return normalizeSettlementWeekStart(weekStart);
  }

  function formatSettlementWeekLabel(weekStart) {
    const picker = window.BremDatePicker;
    const normalized = normalizeSettlementWeekStart(weekStart);
    if (!normalized) return '정산주 미선택';
    if (picker?.formatWednesdayWeekRange) {
      return picker.formatWednesdayWeekRange(normalized);
    }
    const end = settlementWeekEnd(normalized);
    return `${normalized}(수) ~ ${end}(화)`;
  }

  function settlementWeekOverlapsMonth(weekStart, monthKey) {
    const month = String(monthKey || '').trim().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return false;
    const start = normalizeSettlementWeekStart(weekStart);
    const end = settlementWeekEnd(start);
    if (!start || !end) return false;
    const monthStart = `${month}-01`;
    const [year, monthNum] = month.split('-').map(Number);
    const monthEnd = `${month}-${String(new Date(year, monthNum, 0).getDate()).padStart(2, '0')}`;
    return start <= monthEnd && end >= monthStart;
  }

  function matchesPayPeriodFilter(recordPayMonth, filterKey) {
    const filter = String(filterKey || '').trim();
    if (!filter) return true;
    const record = String(recordPayMonth || '').trim();
    if (!record) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(filter)) {
      return normalizeSettlementWeekStart(record) === normalizeSettlementWeekStart(filter);
    }
    if (/^\d{4}-\d{2}$/.test(filter)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(record)) {
        return settlementWeekOverlapsMonth(record, filter);
      }
      return record === filter || record.startsWith(`${filter}-`);
    }
    return record === filter;
  }

  function enrichLinesWithDrivers(lines, drivers, calls, settlementWeekStart, options = {}) {
    const bulkMap = options.promotionBulkMap || null;
    const hourlyInsuranceBulkMap = options.hourlyInsuranceBulkMap || null;
    const dailySettlementSet = options.dailySettlementSet || null;
    const dailySettlementRegionFn = options.dailySettlementRegionFn || null;

    return (Array.isArray(lines) ? lines : []).map(line => {
      const matched = applyDriverMatch(line, drivers, { selectedDriverId: line.selectedDriverId });
      const withPromotionBulk = applyPromotionBulkToLine(matched, bulkMap);
      const withBulk = applyHourlyInsuranceBulkToLine(withPromotionBulk, hourlyInsuranceBulkMap);
      const dailySettlementEnrolled = Boolean(
        withBulk.selectedDriverId
        && dailySettlementSet?.has(withBulk.selectedDriverId)
      );
      const dailySettlementApply = dailySettlementEnrolled
        && line.dailySettlementApply !== false;
      const dailySettlementRegion = dailySettlementEnrolled && dailySettlementRegionFn
        ? dailySettlementRegionFn(withBulk.selectedDriverId)
        : '';
      const computed = computeLine({
        ...withBulk,
        dailySettlementEnrolled,
        dailySettlementApply,
        dailySettlementRegion
      });
      const registeredCallCount = computed.selectedDriverId
        ? sumCallsForDriverInSettlementWeek(computed.selectedDriverId, settlementWeekStart, calls)
        : null;
      const next = {
        ...computed,
        registeredCallCount: registeredCallCount ?? computed.registeredCallCount
      };
      next.issues = validateLine(next);
      return next;
    });
  }

  function getUnmatchedLines(lines) {
    return (Array.isArray(lines) ? lines : []).filter(line =>
      line.matchStatus === 'unmatched' || line.matchStatus === 'short_name'
    );
  }

  function getDuplicateLines(lines) {
    return (Array.isArray(lines) ? lines : []).filter(line =>
      line.matchStatus === 'duplicate' && !String(line.selectedDriverId || '').trim()
    );
  }

  function templateRows() {
    const header = ['', 'B 대리점명', 'C 기사명', '', '', 'F 콜수', 'G 배달료', 'H 배민미션', 'I 기타지급', 'J (Q차감기준)', 'K 고용보험', '', 'M 산재보험', '', 'O 콜수', 'P 콜수', 'Q 원천세', 'R 실지급액'];
    const sample = ['', 'OO대리점', '홍길동', '', '', 120, 3500000, 50000, 30000, 20000, 15000, '', 8000, '', 50000, 7000, 120000, 3400000];
    return [header, sample];
  }

  function normalizePayslipId(value) {
    const text = String(value || '').trim();
    return text && text !== '-' ? text : '';
  }

  function resolveWithholdingTax(source) {
    const raw = source && typeof source === 'object' ? source : {};
    const hasExcelQ = raw.excelWithholdingTax !== undefined
      && raw.excelWithholdingTax !== null
      && String(raw.excelWithholdingTax).trim() !== '';
    if (hasExcelQ || parseMoney(raw.jColumnAmount)) {
      return Math.max(
        0,
        parseMoney(raw.excelWithholdingTax) - calcJWithholdingDeduction(raw.jColumnAmount)
      );
    }
    return parseMoney(raw.withholdingTax);
  }

  function buildPayslipRecord(line) {
    const source = line && typeof line === 'object' ? line : {};
    const withholdingTax = resolveWithholdingTax(source);
    return {
      riderName: String(source.riderName || source.selectedDriverName || '').trim(),
      coupangId: normalizePayslipId(source.coupangId ?? source.matchedCoupangId),
      baeminId: normalizePayslipId(source.baeminId ?? source.matchedBaeminId),
      totalDeliveryFee: parseMoney(source.totalDeliveryFee),
      baeminMission: parseMoney(source.baeminMission),
      otherPayment: parseMoney(source.otherPayment),
      bremPromotion: parseMoney(source.bremPromotion),
      grossPaymentTotal: parseMoney(source.grossPaymentTotal ?? source.paymentTotal),
      employmentInsurance: parseMoney(source.employmentInsurance),
      industrialAccidentInsurance: parseMoney(source.industrialAccidentInsurance),
      hourlyInsurance: parseMoney(source.hourlyInsurance),
      excelWithholdingTax: parseMoney(source.excelWithholdingTax),
      jColumnAmount: parseMoney(source.jColumnAmount),
      withholdingTax,
      promotionWithholdingTax: parseMoney(source.promotionWithholdingTax),
      callFee: parseMoney(source.callFee),
      dailySettlementFee: parseMoney(source.dailySettlementFee),
      deductionTotal: parseMoney(source.deductionTotal ?? source.totalDeduction),
      finalNetPay: parseMoney(source.calculatedNetPay ?? source.finalNetPay ?? source.netPay)
    };
  }

  function flattenPayslipPreviewFields(includeDetail = false) {
    const fields = PAYSLIP_PREVIEW_GROUPS.flatMap(group => group.fields);
    if (includeDetail) {
      return fields.concat(PAYSLIP_DETAIL_FIELDS);
    }
    return fields;
  }

  window.BremPayrollSlipUtils = Object.freeze({
    COL,
    DAILY_SETTLEMENT_RATE,
    PROMOTION_WITHHOLDING_RATE,
    PAYSLIP_PREVIEW_GROUPS,
    PAYSLIP_LIST_GROUPS,
    PAYSLIP_RECORD_FIELDS,
    PAYSLIP_DETAIL_FIELDS,
    PREVIEW_FIELDS,
    parseMoney,
    parseCount,
    calcJWithholdingDeduction,
    calcPromotionWithholdingTax,
    calcOtherPaymentWithholdingDeduction,
    resolveWithholdingTax,
    detectBranchPlatform,
    platformLabel,
    buildPromotionBulkMap,
    buildHourlyInsuranceBulkMap,
    applyPromotionBulkToLine,
    applyHourlyInsuranceBulkToLine,
    computeLine,
    validateLine,
    summarizeLines,
    parseSheetRows,
    matchDriversByPrefix,
    applyDriverMatch,
    enrichLinesWithDrivers,
    getUnmatchedLines,
    getDuplicateLines,
    sumCallsForDriverInSettlementWeek,
    sumCallsForDriverInMonth,
    normalizeSettlementWeekStart,
    settlementWeekEnd,
    settlementWeekPayKey,
    defaultPaymentDateForWeek,
    formatSettlementWeekLabel,
    settlementWeekOverlapsMonth,
    matchesPayPeriodFilter,
    matchStatusLabel,
    templateRows,
    buildPayslipRecord,
    flattenPayslipPreviewFields,
    DATA_START_ROW_INDEX
  });
})();
