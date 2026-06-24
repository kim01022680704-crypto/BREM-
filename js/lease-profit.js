/**
 * BREM 리스/렌탈 수익 계산 (감가상각 제외)
 */
const BremLeaseProfit = (function () {
  const VEHICLE_CATEGORIES = Object.freeze({
    EXTERNAL_LEASE: 'external_lease',
    EXTERNAL_RENTAL: 'external_rental',
    COMPANY_OWNED: 'company_owned'
  });

  const VEHICLE_STATUSES = Object.freeze({
    OPERATING: 'operating',
    EMPTY: 'empty',
    MAINTENANCE: 'maintenance',
    ACCIDENT: 'accident',
    TERMINATED: 'terminated'
  });

  const PAYMENT_STATUSES = Object.freeze({
    NORMAL: 'normal',
    OVERDUE: 'overdue',
    UNPAID: 'unpaid',
    COLLECTING: 'collecting'
  });

  function money(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function daysBetween(startDate, endDate = todayKey()) {
    const start = String(startDate || '').slice(0, 10);
    const end = String(endDate || '').slice(0, 10);
    if (!start || !end) return 0;
    const ms = new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`);
    if (!Number.isFinite(ms) || ms < 0) return 0;
    return Math.floor(ms / 86400000) + 1;
  }

  function weekStartKey(dateValue = todayKey()) {
    if (window.BremDatePicker?.weekStartKey) return BremDatePicker.weekStartKey(dateValue);
    const date = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
    const day = date.getDay();
    const diff = (day - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return date.toISOString().slice(0, 10);
  }

  function weekEndKey(weekStart) {
    const end = new Date(`${weekStart}T00:00:00`);
    end.setDate(end.getDate() + 6);
    return end.toISOString().slice(0, 10);
  }

  function monthKey(dateValue = todayKey()) {
    return String(dateValue).slice(0, 7);
  }

  function isCompanyOwned(vehicle) {
    return String(vehicle?.vehicleCategory || '') === VEHICLE_CATEGORIES.COMPANY_OWNED;
  }

  function effectiveDailyCharge(vehicle) {
    const assignment = vehicle?.rentalAssignment;
    if (assignment && money(assignment.dailyRent) > 0) return money(assignment.dailyRent);
    if (money(vehicle?.dailyChargeAmount) > 0) return money(vehicle.dailyChargeAmount);
    return money(vehicle?.dailyRent);
  }

  function effectiveDailyLeaseCost(vehicle) {
    if (isCompanyOwned(vehicle)) return 0;
    if (money(vehicle?.dailyLeaseCost) > 0) return money(vehicle.dailyLeaseCost);
    if (String(vehicle?.contractType) === 'lease' && money(vehicle?.dailyRent) > 0) {
      return money(vehicle.dailyRent);
    }
    return 0;
  }

  function effectiveDailyInsurance(vehicle) {
    return money(vehicle?.dailyInsuranceCost);
  }

  function effectiveDailyOther(vehicle) {
    return money(vehicle?.dailyOtherCost);
  }

  function computeDailyProfit(vehicle) {
    const dailyCharge = effectiveDailyCharge(vehicle);
    const dailyLeaseCost = effectiveDailyLeaseCost(vehicle);
    const dailyInsurance = effectiveDailyInsurance(vehicle);
    const dailyOther = effectiveDailyOther(vehicle);
    const dailyRevenue = dailyCharge;
    const dailyCost = dailyLeaseCost + dailyInsurance + dailyOther;
    const dailyNet = dailyRevenue - dailyCost;
    return {
      dailyRevenue,
      dailyLeaseCost,
      dailyInsurance,
      dailyOther,
      dailyCost,
      dailyNet,
      weeklyNet: dailyNet * 7,
      monthlyNet: dailyNet * 30,
      balanceDiff: dailyCharge - dailyLeaseCost
    };
  }

  function computeEmptyMetrics(vehicle, asOfDate = todayKey()) {
    const status = String(vehicle?.vehicleStatus || '');
    const isEmptyStatus = status === VEHICLE_STATUSES.EMPTY || BremLeaseErp?.isEmptyVehicle?.(vehicle);
    if (!isEmptyStatus) {
      return {
        emptyDays: 0,
        dailyEmptyLoss: 0,
        dailyEmptyOpportunity: 0,
        totalEmptyLoss: 0,
        totalEmptyOpportunity: 0
      };
    }

    const emptyStart = String(vehicle?.emptyStartDate || vehicle?.returnDate || '').slice(0, 10);
    const emptyDays = daysBetween(emptyStart, asOfDate);
    const dailyLeaseCost = effectiveDailyLeaseCost(vehicle);
    const dailyInsurance = effectiveDailyInsurance(vehicle);
    const dailyOther = effectiveDailyOther(vehicle);
    const expectedDailyRent = money(vehicle?.expectedDailyRent) || effectiveDailyCharge(vehicle);
    const dailyEmptyLoss = dailyLeaseCost + dailyInsurance + dailyOther;
    const dailyEmptyOpportunity = expectedDailyRent - dailyLeaseCost - dailyInsurance - dailyOther;

    return {
      emptyDays,
      dailyEmptyLoss,
      dailyEmptyOpportunity,
      totalEmptyLoss: dailyEmptyLoss * emptyDays,
      totalEmptyOpportunity: dailyEmptyOpportunity * emptyDays
    };
  }

  function sumPaymentsUnpaid(payments = []) {
    return payments.reduce((sum, item) => sum + money(item.unpaidAmount), 0);
  }

  function sumAccidentLoss(accidents = []) {
    return accidents.reduce((sum, item) => sum + money(item.actualLoss), 0);
  }

  function sumMaintenanceCost(records = []) {
    return records.reduce((sum, item) => sum + money(item.maintenanceCost) + money(item.partsCost), 0);
  }

  function computeVehicleFinalProfit(vehicle, context = {}) {
    const daily = computeDailyProfit(vehicle);
    const empty = computeEmptyMetrics(vehicle, context.asOfDate);
    const unpaid = money(vehicle?.unpaidAmount) + sumPaymentsUnpaid(context.payments || []);
    const accidentLoss = sumAccidentLoss(context.accidents || []);
    const maintenanceCost = sumMaintenanceCost(context.maintenance || []);
    const periodDays = Number(context.periodDays || 1);

    const rentalRevenue = daily.dailyRevenue * periodDays;
    const leaseCost = daily.dailyLeaseCost * periodDays;
    const insuranceCost = daily.dailyInsurance * periodDays;
    const otherCost = daily.dailyOther * periodDays;

    const netProfit = rentalRevenue
      - leaseCost
      - insuranceCost
      - otherCost
      - maintenanceCost
      - accidentLoss
      - unpaid
      - empty.totalEmptyLoss;

    return {
      ...daily,
      ...empty,
      unpaid,
      accidentLoss,
      maintenanceCost,
      rentalRevenue,
      leaseCost,
      insuranceCost,
      otherCost,
      netProfit,
      periodDays
    };
  }

  function countByStatus(vehicles = []) {
    const counts = {
      total: vehicles.length,
      operating: 0,
      empty: 0,
      maintenance: 0,
      accident: 0,
      terminated: 0
    };
    vehicles.forEach(vehicle => {
      const status = String(vehicle.vehicleStatus || '');
      if (status === VEHICLE_STATUSES.OPERATING) counts.operating += 1;
      else if (status === VEHICLE_STATUSES.EMPTY || BremLeaseErp?.isEmptyVehicle?.(vehicle)) counts.empty += 1;
      else if (status === VEHICLE_STATUSES.MAINTENANCE) counts.maintenance += 1;
      else if (status === VEHICLE_STATUSES.ACCIDENT) counts.accident += 1;
      else if (status === VEHICLE_STATUSES.TERMINATED) counts.terminated += 1;
      else counts.operating += 1;
    });
    return counts;
  }

  function aggregateKpis(vehicles = [], context = {}) {
    const asOfDate = context.asOfDate || todayKey();
    const periodType = context.periodType || 'weekly';
    const periodDays = periodType === 'monthly' ? 30 : periodType === 'weekly' ? 7 : 1;

    const paymentsByVehicle = context.paymentsByVehicle || {};
    const accidentsByVehicle = context.accidentsByVehicle || {};
    const maintenanceByVehicle = context.maintenanceByVehicle || {};

    const totals = {
      vehicleCount: vehicles.length,
      operatingCount: 0,
      emptyCount: 0,
      maintenanceCount: 0,
      accidentCount: 0,
      rentalRevenue: 0,
      leaseCost: 0,
      insuranceCost: 0,
      otherCost: 0,
      unpaidTotal: 0,
      emptyLossTotal: 0,
      emptyOpportunityTotal: 0,
      maintenanceCost: 0,
      accidentLoss: 0,
      netProfit: 0
    };

    const statusCounts = countByStatus(vehicles);
    totals.operatingCount = statusCounts.operating;
    totals.emptyCount = statusCounts.empty;
    totals.maintenanceCount = statusCounts.maintenance;
    totals.accidentCount = statusCounts.accident;

    vehicles.forEach(vehicle => {
      const vehicleContext = {
        asOfDate,
        periodDays,
        payments: paymentsByVehicle[vehicle.id] || [],
        accidents: accidentsByVehicle[vehicle.id] || [],
        maintenance: maintenanceByVehicle[vehicle.id] || []
      };
      const profit = computeVehicleFinalProfit(vehicle, vehicleContext);
      totals.rentalRevenue += profit.rentalRevenue;
      totals.leaseCost += profit.leaseCost;
      totals.insuranceCost += profit.insuranceCost;
      totals.otherCost += profit.otherCost;
      totals.unpaidTotal += profit.unpaid;
      totals.emptyLossTotal += profit.totalEmptyLoss;
      totals.emptyOpportunityTotal += profit.totalEmptyOpportunity;
      totals.maintenanceCost += profit.maintenanceCost;
      totals.accidentLoss += profit.accidentLoss;
      totals.netProfit += profit.netProfit;
    });

    return totals;
  }

  function paymentStatusLabel(status) {
    switch (String(status || '')) {
      case PAYMENT_STATUSES.OVERDUE: return '연체';
      case PAYMENT_STATUSES.UNPAID: return '미납';
      case PAYMENT_STATUSES.COLLECTING: return '회수중';
      default: return '정상';
    }
  }

  function vehicleStatusLabel(status) {
    switch (String(status || '')) {
      case VEHICLE_STATUSES.EMPTY: return '공차';
      case VEHICLE_STATUSES.MAINTENANCE: return '정비중';
      case VEHICLE_STATUSES.ACCIDENT: return '사고';
      case VEHICLE_STATUSES.TERMINATED: return '계약종료';
      default: return '운행중';
    }
  }

  function vehicleCategoryLabel(category) {
    switch (String(category || '')) {
      case VEHICLE_CATEGORIES.EXTERNAL_RENTAL: return '외부렌탈';
      case VEHICLE_CATEGORIES.COMPANY_OWNED: return '회사보유차량';
      default: return '외부리스';
    }
  }

  return {
    VEHICLE_CATEGORIES,
    VEHICLE_STATUSES,
    PAYMENT_STATUSES,
    money,
    todayKey,
    daysBetween,
    weekStartKey,
    weekEndKey,
    monthKey,
    effectiveDailyCharge,
    effectiveDailyLeaseCost,
    computeDailyProfit,
    computeEmptyMetrics,
    computeVehicleFinalProfit,
    aggregateKpis,
    countByStatus,
    paymentStatusLabel,
    vehicleStatusLabel,
    vehicleCategoryLabel
  };
})();
