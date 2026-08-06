/**
 * 리스/렌탈 ERP — 실시간 손익 계산 (입력 즉시 반영)
 */
const BremLeaseRentalCalc = (function () {
  const MODEL_TYPES = Object.freeze(['PCX', 'NMAX', 'FORZA', '기타']);
  const COLLECTION_METHODS = Object.freeze({
    SALARY: 'salary_deduction',
    DEPOSIT: 'separate_deposit'
  });
  const ARREAR_STATUS = Object.freeze({
    UNPAID: 'unpaid',
    COLLECTING: 'collecting',
    COMPLETED: 'completed'
  });

  function money(value) {
    const num = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? Math.round(num) : 0;
  }

  function roundDays(value) {
    return Math.max(0, Math.round(money(value)));
  }

  function dailyFromWeekly(weeklyRent) {
    const weekly = money(weeklyRent);
    return weekly > 0 ? Math.round(weekly / 7) : 0;
  }

  function weeklyFromDaily(dailyRent) {
    const daily = money(dailyRent);
    return daily > 0 ? Math.round(daily * 7) : 0;
  }

  function daysInclusive(startDate, endDate) {
    if (!startDate || !endDate) return 0;
    const start = String(startDate).slice(0, 10);
    const end = String(endDate).slice(0, 10);
    if (!start || !end || end < start) return 0;
    const ms = new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`);
    return Math.floor(ms / 86400000) + 1;
  }

  function daysInMonth(monthKey) {
    const [y, m] = String(monthKey || '').split('-').map(Number);
    if (!y || !m) return 30;
    return new Date(y, m, 0).getDate();
  }

  function weekRange(weekStart) {
    const start = String(weekStart || '').slice(0, 10);
    if (!start) return { start: '', end: '' };
    const endDate = new Date(`${start}T00:00:00`);
    endDate.setDate(endDate.getDate() + 6);
    const end = [
      endDate.getFullYear(),
      String(endDate.getMonth() + 1).padStart(2, '0'),
      String(endDate.getDate()).padStart(2, '0')
    ].join('-');
    return { start, end };
  }

  function overlapDays(rangeStart, rangeEnd, periodStart, periodEnd) {
    const start = [rangeStart, periodStart].filter(Boolean).sort().pop();
    const end = [rangeEnd, periodEnd].filter(Boolean).sort()[0];
    if (!start || !end || end < start) return 0;
    return daysInclusive(start, end);
  }

  /** 입력 즉시 손익 계산 */
  function compute(input = {}) {
    const weeklyRent = money(input.weeklyRent);
    const dailyRent = money(input.dailyRent) > 0 ? money(input.dailyRent) : dailyFromWeekly(weeklyRent);
    const resolvedWeekly = weeklyRent > 0 ? weeklyRent : weeklyFromDaily(dailyRent);

    const rentalDays = roundDays(input.rentalDays);
    const emptyDays = roundDays(input.emptyDays);
    const unpaidDays = roundDays(input.unpaidDays);

    const vehicleCost = money(input.vehicleCost);
    const insuranceCost = money(input.insuranceCost);
    const leaseCost = money(input.leaseCost);
    const maintenanceCost = money(input.maintenanceCost);
    const accidentCost = money(input.accidentCost);
    const otherCost = money(input.otherCost);
    const penaltyFee = money(input.penaltyFee);
    const paidAmount = money(input.paidAmount);
    const recoveredAmount = money(input.recoveredAmount);

    const rentalRevenue = dailyRent * rentalDays;
    const unpaidGross = dailyRent * unpaidDays;
    const unpaidAmount = Math.max(0, unpaidGross - paidAmount);
    const emptyDailyLoss = money(input.emptyDailyLoss);
    const emptyLoss = emptyDailyLoss > 0
      ? emptyDailyLoss * emptyDays
      : dailyRent * emptyDays;
    const totalCost = insuranceCost + leaseCost + maintenanceCost + accidentCost + otherCost + emptyLoss;
    const expectedProfit = rentalRevenue + penaltyFee - totalCost - unpaidGross;
    const actualProfit = rentalRevenue + penaltyFee + recoveredAmount - totalCost - unpaidAmount;
    const netProfit = actualProfit;
    const isDeficit = netProfit < 0;

    return {
      weeklyRent: resolvedWeekly,
      dailyRent,
      rentalDays,
      emptyDays,
      unpaidDays,
      vehicleCost,
      insuranceCost,
      leaseCost,
      maintenanceCost,
      accidentCost,
      otherCost,
      penaltyFee,
      paidAmount,
      recoveredAmount,
      rentalRevenue,
      unpaidGross,
      unpaidAmount,
      emptyDailyLoss,
      emptyLoss,
      totalCost,
      expectedProfit,
      actualProfit,
      netProfit,
      isDeficit,
      statusLabel: isDeficit ? '적자' : (netProfit > 0 ? '순이익' : '손익분기')
    };
  }

  function computeFromContract(contract = {}, vehicle = {}) {
    const weeklyRent = money(contract.weeklyRent) || weeklyFromDaily(contract.dailyRent || vehicle.dailyChargeAmount);
    const metrics = window.BremLeaseProfit?.computeErpMetrics?.(vehicle) || {};
    const emptyDaily = money(vehicle.emptyDailyLoss)
      || metrics.emptyDailyLoss
      || metrics.dailyCost
      || metrics.dailyLeaseCost
      || 0;
    const annualInsurance = money(vehicle.annualInsuranceCost)
      || money(vehicle.dailyInsuranceCost) * 365;
    return compute({
      weeklyRent,
      dailyRent: contract.dailyRent || vehicle.dailyChargeAmount,
      rentalDays: contract.rentalDays,
      emptyDays: contract.emptyDays ?? vehicle.emptyDays,
      unpaidDays: contract.unpaidDays ?? vehicle.unpaidDays,
      vehicleCost: contract.vehicleCost || vehicle.purchasePrice,
      insuranceCost: contract.insuranceCost || (annualInsurance ? annualInsurance / 12 : money(vehicle.dailyInsuranceCost) * 30),
      leaseCost: contract.leaseCost || money(vehicle.dailyLeaseCost) * 30,
      maintenanceCost: contract.maintenanceCost,
      accidentCost: contract.accidentCost,
      otherCost: contract.otherCost || money(vehicle.dailyOtherCost) * 30,
      penaltyFee: contract.penaltyFee,
      paidAmount: contract.paidAmount,
      recoveredAmount: contract.recoveredAmount,
      emptyDailyLoss: emptyDaily
    });
  }

  function aggregateRows(rows = []) {
    const totals = {
      count: rows.length,
      operatingCount: 0,
      emptyCount: 0,
      rentalRevenue: 0,
      unpaidAmount: 0,
      recoveredAmount: 0,
      emptyLoss: 0,
      totalCost: 0,
      netProfit: 0,
      deficitCount: 0
    };
    rows.forEach(row => {
      if (row.emptyDays > 0) totals.emptyCount += 1;
      else totals.operatingCount += 1;
      totals.rentalRevenue += money(row.rentalRevenue);
      totals.unpaidAmount += money(row.unpaidAmount);
      totals.recoveredAmount += money(row.recoveredAmount);
      totals.emptyLoss += money(row.emptyLoss);
      totals.totalCost += money(row.totalCost);
      totals.netProfit += money(row.netProfit);
      if (row.isDeficit) totals.deficitCount += 1;
    });
    return totals;
  }

  function buildProfitLogSnapshot({ vehicleId, contractId, periodType, periodStart, periodEnd, metrics, vehicle, contract }) {
    return {
      vehicleId: vehicleId || '',
      contractId: contractId || '',
      periodType: periodType || 'snapshot',
      periodStart: periodStart || '',
      periodEnd: periodEnd || '',
      rentalRevenue: metrics.rentalRevenue,
      leaseCost: metrics.leaseCost,
      insuranceCost: metrics.insuranceCost,
      otherCost: metrics.otherCost,
      maintenanceCost: metrics.maintenanceCost,
      accidentLoss: metrics.accidentCost,
      unpaidAmount: metrics.unpaidAmount,
      emptyLoss: metrics.emptyLoss,
      emptyOpportunity: 0,
      netProfit: metrics.netProfit,
      rawData: {
        vehicleNumber: vehicle?.vehicleNumber || contract?.vehicleNumber || '',
        vehicleName: contract?.vehicleName || vehicle?.model || '',
        driverName: contract?.driverName || vehicle?.renter || '',
        weeklyRent: metrics.weeklyRent,
        dailyRent: metrics.dailyRent,
        rentalDays: metrics.rentalDays,
        emptyDays: metrics.emptyDays,
        unpaidDays: metrics.unpaidDays,
        paidAmount: metrics.paidAmount,
        recoveredAmount: metrics.recoveredAmount,
        penaltyFee: metrics.penaltyFee,
        totalCost: metrics.totalCost,
        expectedProfit: metrics.expectedProfit,
        actualProfit: metrics.actualProfit,
        statusLabel: metrics.statusLabel,
        contractId: contractId || '',
        savedAt: new Date().toISOString()
      }
    };
  }

  function arrearsStatusLabel(status) {
    switch (String(status || '')) {
      case ARREAR_STATUS.COLLECTING: return '회수중';
      case ARREAR_STATUS.COMPLETED: return '처리완료';
      default: return '미납';
    }
  }

  function collectionMethodLabel(method) {
    if (method === COLLECTION_METHODS.SALARY) return '급여공제';
    if (method === COLLECTION_METHODS.DEPOSIT) return '별도입금';
    return method || '-';
  }

  function isDateInRange(date, start, end) {
    const d = String(date || '').slice(0, 10);
    if (!d || !start) return false;
    if (end && d > end) return false;
    return d >= start;
  }

  /** 계약이 기간 내 실제 운행한 날짜 구간 (반납일·종료 반영) */
  function resolveContractActiveWindow(contract, periodStart, periodEnd, vehicle = null) {
    if (!contract) return null;
    const driverName = String(contract.driverName || vehicle?.renter || '').trim();
    if (!driverName) return null;

    const pStart = String(periodStart || '').slice(0, 10);
    const pEnd = String(periodEnd || periodStart || '').slice(0, 10);
    if (!pStart || !pEnd) return null;

    const cStart = String(contract.startDate || '').slice(0, 10);
    if (!cStart) return null;

    let cEnd = String(contract.endDate || '').slice(0, 10);
    const returned = String(contract.returnDate || '').slice(0, 10);
    const ended = String(contract.status || '') === 'ended';
    const today = String(new Date().toISOString().slice(0, 10));
    const effectiveEnd = window.BremLeaseErp?.resolveEffectiveContractEnd?.(cEnd, returned, today)
      || (returned && returned > today ? returned : (cEnd && returned && cEnd > returned && cEnd >= today ? cEnd : (returned || cEnd)));

    if (effectiveEnd) {
      cEnd = effectiveEnd;
    } else if (returned && (!cEnd || cEnd >= returned)) {
      cEnd = returned;
    } else if (ended && cEnd) {
      // 종료 상태 — endDate까지
    } else if (!cEnd) {
      cEnd = pEnd;
    }

    if (ended && returned && returned < pStart) return null;
    if (cEnd && cEnd < pStart) return null;
    if (cStart > pEnd) return null;

    const winStart = [cStart, pStart].filter(Boolean).sort().pop();
    const winEnd = [cEnd || pEnd, pEnd].filter(Boolean).sort()[0];
    if (!winStart || !winEnd || winEnd < winStart) return null;

    return {
      start: winStart,
      end: winEnd,
      rentalDays: daysInclusive(winStart, winEnd)
    };
  }

  /** 차량 기준 기간 손익 — 계약·원가·미납·공차 대조 (해당 주/월만 집계) */
  function computeVehiclePeriodMetrics(input = {}) {
    const {
      vehicle = {},
      contract = null,
      periodStart = '',
      periodEnd = '',
      arrears = [],
      accidents = [],
      maintenance = []
    } = input;

    const vm = window.BremLeaseProfit?.computeErpMetrics?.(vehicle) || {};
    const start = String(periodStart || '').slice(0, 10);
    const end = String(periodEnd || start).slice(0, 10);
    const periodDays = start && end ? daysInclusive(start, end) : 7;
    const vehicleId = vehicle.id || '';

    const activeWindow = resolveContractActiveWindow(contract, start, end, vehicle);
    const rentalDays = activeWindow?.rentalDays || 0;

    const dailyRent = money(contract?.dailyRent) || money(vehicle.dailyChargeAmount) || money(vm.dailyCharge) || 0;
    const dailyLeaseCost = money(vm.dailyLeaseCost) || money(vehicle.dailyLeaseCost) || 0;
    const dailyOwnedCost = money(vm.dailyCost) || 0;
    const emptyDailyOverride = money(vehicle.emptyDailyLoss) || money(vm.emptyDailyLoss) || 0;

    let emptyDays = Math.max(0, periodDays - rentalDays);
    if (rentalDays > 0 && rentalDays < periodDays && vehicle.emptyStartDate) {
      const emptyOverlap = overlapDays(start, end, vehicle.emptyStartDate, end);
      emptyDays = Math.max(emptyDays, emptyOverlap);
    }
    emptyDays = Math.min(emptyDays, periodDays);

    const completed = ARREAR_STATUS.COMPLETED;
    const openArrears = (arrears || []).filter(item =>
      item.vehicleId === vehicleId && String(item.collectionStatus || '') !== completed
    );
    const unpaidAmount = openArrears.reduce((sum, item) => sum + money(item.unpaidAmount), 0);
    const unpaidDays = openArrears.reduce((sum, item) => sum + roundDays(item.unpaidDays), 0);

    const recoveredAmount = (arrears || [])
      .filter(item => item.vehicleId === vehicleId && String(item.collectionStatus || '') === completed)
      .filter(item => isDateInRange(item.processedDate, start, end))
      .reduce((sum, item) => sum + money(item.recoveredAmount || item.paidAmount), 0);

    const maintenanceCost = (maintenance || [])
      .filter(row => row.vehicleId === vehicleId && isDateInRange(row.maintenanceDate || row.date, start, end))
      .reduce((sum, row) => sum + money(row.cost || row.amount), 0);

    const accidentCost = (accidents || [])
      .filter(row => row.vehicleId === vehicleId && isDateInRange(row.accidentDate || row.date, start, end))
      .reduce((sum, row) => sum + money(row.cost || row.amount || row.lossAmount), 0);

    const insuranceDaily = money(vehicle.dailyInsuranceCost)
      || (money(vehicle.annualInsuranceCost) / 365)
      || 0;
    const insuranceCost = Math.round(insuranceDaily * periodDays);
    const leaseCost = Math.round(dailyLeaseCost * periodDays);
    const vehicleCost = Math.round(dailyOwnedCost * periodDays);
    const owned = String(vehicle.vehicleCategory || vm.mode || '') === 'company_owned';
    const resolvedVehicleCost = owned ? vehicleCost : leaseCost;
    const dailyHoldingCost = owned ? dailyOwnedCost : dailyLeaseCost;

    // 배정(운행·계약예정) vs 이번 기간 수금창 — 대수는 배정, 공차손실은 이번 기간 빈 차만
    const driverName = String(contract?.driverName || vehicle?.renter || '').trim();
    const contractEnded = String(contract?.status || '') === 'ended';
    const contractStart = String(contract?.startDate || '').slice(0, 10);
    const contractEndBound = String(contract?.returnDate || contract?.endDate || '').slice(0, 10);
    const today = String(new Date().toISOString().slice(0, 10));
    const isScheduled = Boolean(
      driverName && !contractEnded && contractStart && contractStart > today
      && (!contractEndBound || contractEndBound >= contractStart)
    );
    const hasAssignedContract = Boolean(activeWindow && driverName) || isScheduled;
    const hasCollectionThisPeriod = Boolean(activeWindow && driverName);

    // 해당 기간 렌탈매출 = 계약 일렌탈료 × 그 주(월) 계약 일수
    const rentalRevenue = dailyRent * rentalDays;

    let emptyLoss = 0;
    let totalCost = 0;
    let expectedProfit = 0;
    let actualProfit = 0;

    if (hasCollectionThisPeriod) {
      // 이번 주(월) 계약 창 있음 → 공차손실 아님
      emptyLoss = 0;
      totalCost = resolvedVehicleCost + insuranceCost + maintenanceCost + accidentCost;
      expectedProfit = rentalRevenue - totalCost;
      actualProfit = rentalRevenue + recoveredAmount - totalCost;
    } else {
      // 이번 기간 빈 차 = 회사 리스비(일×기간) 실지출
      const emptyPeriodDays = periodDays;
      emptyLoss = Math.round(dailyHoldingCost * emptyPeriodDays);
      if (emptyDailyOverride > dailyHoldingCost) {
        emptyLoss = Math.round(emptyDailyOverride * emptyPeriodDays);
      }
      totalCost = maintenanceCost + accidentCost;
      expectedProfit = 0;
      actualProfit = recoveredAmount - totalCost;
      emptyDays = emptyPeriodDays;
    }

    const netProfit = actualProfit;
    const hasUnpaid = unpaidAmount > 0 || unpaidDays > 0;
    const erpCollecting = hasAssignedContract && (
      contract?.finalApplyEnabled != null
        ? Boolean(contract.finalApplyEnabled)
        : Boolean(contract?.rawData?.finalApplyEnabled)
    );
    const unpaidCountsAsDeficit = hasUnpaid && hasAssignedContract && !erpCollecting;
    // 적자 대수: 미배정 공차 + 수기 미납 (계약예정은 공차 아님)
    const isDeficit = unpaidCountsAsDeficit || !hasAssignedContract;

    return {
      periodDays,
      rentalDays,
      emptyDays,
      unpaidDays,
      dailyRent,
      rentalRevenue,
      recoveredAmount,
      unpaidAmount,
      emptyLoss,
      insuranceCost,
      leaseCost: hasCollectionThisPeriod ? resolvedVehicleCost : emptyLoss,
      vehicleCost: hasCollectionThisPeriod ? resolvedVehicleCost : emptyLoss,
      maintenanceCost,
      accidentCost,
      totalCost,
      expectedProfit,
      actualProfit,
      netProfit,
      weekLossExposure: emptyLoss + unpaidAmount,
      isDeficit,
      isOperating: rentalDays > 0 || isScheduled,
      isEmpty: !hasAssignedContract,
      hasUnpaid,
      hasPlannedCollection: hasAssignedContract
    };
  }

  function aggregateFleetPeriodMetrics(rows = []) {
    return rows.reduce((totals, row) => {
      totals.count += 1;
      if (row.isOperating) totals.operatingCount += 1;
      if (row.isEmpty) totals.emptyCount += 1;
      if (row.hasUnpaid) totals.unpaidCount += 1;
      totals.rentalRevenue += money(row.rentalRevenue);
      totals.recoveredAmount += money(row.recoveredAmount);
      totals.unpaidAmount += money(row.unpaidAmount);
      totals.emptyLoss += money(row.emptyLoss);
      totals.weekLossExposure += money(row.weekLossExposure != null
        ? row.weekLossExposure
        : (money(row.emptyLoss) + money(row.unpaidAmount)));
      totals.totalCost += money(row.totalCost);
      totals.expectedProfit += money(row.expectedProfit);
      totals.actualProfit += money(row.actualProfit);
      totals.netProfit += money(row.netProfit);
      if (row.isDeficit) totals.deficitCount += 1;
      return totals;
    }, {
      count: 0,
      operatingCount: 0,
      emptyCount: 0,
      unpaidCount: 0,
      deficitCount: 0,
      rentalRevenue: 0,
      recoveredAmount: 0,
      unpaidAmount: 0,
      emptyLoss: 0,
      weekLossExposure: 0,
      totalCost: 0,
      expectedProfit: 0,
      actualProfit: 0,
      netProfit: 0
    });
  }

  return {
    MODEL_TYPES,
    COLLECTION_METHODS,
    ARREAR_STATUS,
    money,
    dailyFromWeekly,
    weeklyFromDaily,
    daysInclusive,
    daysInMonth,
    weekRange,
    overlapDays,
    compute,
    computeFromContract,
    aggregateRows,
    buildProfitLogSnapshot,
    arrearsStatusLabel,
    collectionMethodLabel,
    isDateInRange,
    resolveContractActiveWindow,
    computeVehiclePeriodMetrics,
    aggregateFleetPeriodMetrics
  };
})();

window.BremLeaseRentalCalc = BremLeaseRentalCalc;
