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
    return Number.isFinite(num) ? num : 0;
  }

  function roundDays(value) {
    return Math.max(0, Math.round(money(value)));
  }

  function dailyFromWeekly(weeklyRent) {
    const weekly = money(weeklyRent);
    return weekly > 0 ? weekly / 7 : 0;
  }

  function weeklyFromDaily(dailyRent) {
    const daily = money(dailyRent);
    return daily > 0 ? daily * 7 : 0;
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
    const emptyLoss = dailyRent * emptyDays;
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
    return compute({
      weeklyRent,
      dailyRent: contract.dailyRent || vehicle.dailyChargeAmount,
      rentalDays: contract.rentalDays,
      emptyDays: contract.emptyDays ?? vehicle.emptyDays,
      unpaidDays: contract.unpaidDays ?? vehicle.unpaidDays,
      vehicleCost: contract.vehicleCost || vehicle.purchasePrice,
      insuranceCost: contract.insuranceCost || vehicle.dailyInsuranceCost * 30,
      leaseCost: contract.leaseCost || vehicle.dailyLeaseCost * 30,
      maintenanceCost: contract.maintenanceCost,
      accidentCost: contract.accidentCost,
      otherCost: contract.otherCost || vehicle.dailyOtherCost * 30,
      penaltyFee: contract.penaltyFee,
      paidAmount: contract.paidAmount,
      recoveredAmount: contract.recoveredAmount
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
    collectionMethodLabel
  };
})();

window.BremLeaseRentalCalc = BremLeaseRentalCalc;
