/**
 * BREM 리스/렌탈 ERP 수익 계산 (엑셀 기준)
 * 1) 회사리스/렌탈 — 외부리스·외부렌탈
 * 2) 회사소유리스 — 회사보유차량
 */
const BremLeaseProfit = (function () {
  const VEHICLE_CATEGORIES = Object.freeze({
    EXTERNAL_LEASE: 'external_lease',
    EXTERNAL_RENTAL: 'external_rental',
    COMPANY_OWNED: 'company_owned'
  });

  const ERP_MODES = Object.freeze({
    COMPANY_LEASE_RENTAL: 'company_lease_rental',
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

  const PAYMENT_CHECK = Object.freeze({
    PAID: 'paid',
    UNPAID: 'unpaid'
  });

  function money(value) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.round(num) : 0;
  }

  function todayKey() {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');
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

  function getErpMode(vehicle) {
    return isCompanyOwned(vehicle) ? ERP_MODES.COMPANY_OWNED : ERP_MODES.COMPANY_LEASE_RENTAL;
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
    const daily = money(vehicle?.dailyInsuranceCost);
    if (daily > 0) return daily;
    const annual = money(vehicle?.annualInsuranceCost);
    return annual > 0 ? annual / 365 : 0;
  }

  function effectiveDailyOther(vehicle) {
    return money(vehicle?.dailyOtherCost);
  }

  function computeOwnedCostBase(vehicle) {
    const vehiclePrice = money(vehicle?.purchasePrice);
    const taxRate = money(vehicle?.acquisitionTaxRate) / 100;
    const taxAmount = money(vehicle?.acquisitionTaxAmount) > 0
      ? money(vehicle.acquisitionTaxAmount)
      : vehiclePrice * taxRate;
    const otherCost = money(vehicle?.otherAcquisitionCost);
    const annualInsurance = money(vehicle?.annualInsuranceCost)
      || money(vehicle?.dailyInsuranceCost) * 365;
    const totalCost = vehiclePrice + taxAmount + otherCost + annualInsurance;
    const insuranceDaily = money(vehicle?.dailyInsuranceCost)
      || (annualInsurance > 0 ? annualInsurance / 365 : 0);
    const dailyCost = totalCost > 0
      ? totalCost / 365
      : insuranceDaily;
    return {
      vehiclePrice,
      taxRate: money(vehicle?.acquisitionTaxRate),
      taxAmount,
      otherCost,
      annualInsurance,
      insuranceDaily,
      totalCost,
      dailyCost,
      weeklyCost: dailyCost * 7
    };
  }

  function resolveUnpaidAmount(vehicle, dailyCharge, unpaidDays) {
    if (unpaidDays > 0 && dailyCharge > 0) return unpaidDays * dailyCharge;
    return money(vehicle?.unpaidAmount);
  }

  function isEmptyVehicle(vehicle) {
    const status = String(vehicle?.vehicleStatus || '');
    if (status === VEHICLE_STATUSES.EMPTY) return true;
    return Boolean(window.BremLeaseErp?.isEmptyVehicle?.(vehicle));
  }

  function resolveEmptyDailyBase(vehicle, defaultDailyBase) {
    const override = money(vehicle?.emptyDailyLoss);
    if (override > 0) return override;
    const base = money(defaultDailyBase);
    if (base > 0) return base;
    if (isCompanyOwned(vehicle)) {
      const annualInsurance = money(vehicle?.annualInsuranceCost);
      if (annualInsurance > 0) return annualInsurance / 365;
    }
    return 0;
  }

  function computeEmptyLoss(vehicle, dailyBase, asOfDate = todayKey()) {
    if (!isEmptyVehicle(vehicle)) {
      return { emptyDays: 0, dailyBase: money(dailyBase), emptyLoss: 0 };
    }
    const emptyStart = String(vehicle?.emptyStartDate || vehicle?.returnDate || '').slice(0, 10);
    const emptyDays = daysBetween(emptyStart, asOfDate);
    const base = resolveEmptyDailyBase(vehicle, dailyBase);
    return {
      emptyDays,
      dailyBase: base,
      emptyLoss: base * emptyDays
    };
  }

  /** 엑셀 기준 ERP 계산 */
  function computeErpMetrics(vehicle, options = {}) {
    const asOfDate = options.asOfDate || todayKey();
    const mode = getErpMode(vehicle);
    const dailyCharge = effectiveDailyCharge(vehicle);
    const unpaidDays = Math.max(0, Math.round(money(vehicle?.unpaidDays)));
    const paymentCheck = String(vehicle?.paymentCheck || '').trim();

    if (mode === ERP_MODES.COMPANY_OWNED) {
      const owned = computeOwnedCostBase(vehicle);
      const marginDaily = dailyCharge - owned.dailyCost;
      const weeklyProfit = marginDaily * 7;
      const unpaidAmount = resolveUnpaidAmount(vehicle, dailyCharge, unpaidDays);
      const empty = computeEmptyLoss(vehicle, owned.dailyCost, asOfDate);
      const actualProfit = weeklyProfit - unpaidAmount - empty.emptyLoss;

      return {
        mode,
        kindLabel: '회사소유리스',
        dailyCharge,
        dailyLeaseCost: 0,
        dailyCost: owned.dailyCost,
        weeklyLeaseCost: 0,
        weeklyCharge: dailyCharge * 7,
        weeklyCost: owned.weeklyCost,
        marginDaily,
        weeklyProfit,
        unpaidDays,
        unpaidAmount,
        paymentCheck,
        unpaidCollectionMethod: String(vehicle?.unpaidCollectionMethod || '').trim(),
        emptyDays: empty.emptyDays,
        emptyLoss: empty.emptyLoss,
        emptyDailyLoss: empty.dailyBase,
        actualProfit,
        vehiclePrice: owned.vehiclePrice,
        acquisitionTaxRate: owned.taxRate,
        acquisitionTaxAmount: owned.taxAmount,
        otherAcquisitionCost: owned.otherCost,
        totalAcquisitionCost: owned.totalCost,
        annualInsuranceCost: owned.annualInsurance,
        insuranceDaily: owned.insuranceDaily
      };
    }

    const dailyLeaseCost = effectiveDailyLeaseCost(vehicle);
    const marginDaily = dailyCharge - dailyLeaseCost;
    const weeklyLeaseCost = dailyLeaseCost * 7;
    const weeklyCharge = dailyCharge * 7;
    const weeklyProfit = marginDaily * 7;
    const unpaidAmount = resolveUnpaidAmount(vehicle, dailyCharge, unpaidDays);
    const empty = computeEmptyLoss(vehicle, dailyLeaseCost, asOfDate);
    const actualProfit = weeklyProfit - unpaidAmount - empty.emptyLoss;

    return {
      mode,
      kindLabel: '회사리스',
      dailyCharge,
      dailyLeaseCost,
      dailyCost: dailyLeaseCost,
      weeklyLeaseCost,
      weeklyCharge,
      weeklyCost: weeklyLeaseCost,
      marginDaily,
      weeklyProfit,
      unpaidDays,
      unpaidAmount,
      paymentCheck,
      unpaidCollectionMethod: String(vehicle?.unpaidCollectionMethod || '').trim(),
      emptyDays: empty.emptyDays,
      emptyLoss: empty.emptyLoss,
      emptyDailyLoss: empty.dailyBase,
      actualProfit,
      vehiclePrice: 0,
      acquisitionTaxRate: 0,
      acquisitionTaxAmount: 0,
      otherAcquisitionCost: 0,
      totalAcquisitionCost: 0
    };
  }

  function computeDailyProfit(vehicle) {
    const metrics = computeErpMetrics(vehicle);
    return {
      dailyRevenue: metrics.dailyCharge,
      dailyLeaseCost: metrics.dailyLeaseCost || metrics.dailyCost,
      dailyInsurance: effectiveDailyInsurance(vehicle),
      dailyOther: effectiveDailyOther(vehicle),
      dailyCost: metrics.dailyCost + effectiveDailyInsurance(vehicle) + effectiveDailyOther(vehicle),
      dailyNet: metrics.marginDaily,
      weeklyNet: metrics.weeklyProfit,
      monthlyNet: metrics.weeklyProfit * (30 / 7),
      balanceDiff: metrics.marginDaily
    };
  }

  function computeEmptyMetrics(vehicle, asOfDate = todayKey()) {
    const metrics = computeErpMetrics(vehicle, { asOfDate });
    return {
      emptyDays: metrics.emptyDays,
      dailyEmptyLoss: metrics.emptyDays > 0 ? metrics.emptyLoss / Math.max(metrics.emptyDays, 1) : 0,
      dailyEmptyOpportunity: 0,
      totalEmptyLoss: metrics.emptyLoss,
      totalEmptyOpportunity: 0
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
    const metrics = computeErpMetrics(vehicle, { asOfDate: context.asOfDate });
    const accidentLoss = sumAccidentLoss(context.accidents || []);
    const maintenanceCost = sumMaintenanceCost(context.maintenance || []);
    const extraUnpaid = sumPaymentsUnpaid(context.payments || []);

    const netProfit = metrics.actualProfit - accidentLoss - maintenanceCost - extraUnpaid;

    return {
      ...computeDailyProfit(vehicle),
      ...computeEmptyMetrics(vehicle, context.asOfDate),
      ...metrics,
      unpaid: metrics.unpaidAmount + extraUnpaid,
      accidentLoss,
      maintenanceCost,
      rentalRevenue: metrics.weeklyCharge,
      leaseCost: metrics.weeklyCost,
      insuranceCost: effectiveDailyInsurance(vehicle) * 7,
      otherCost: effectiveDailyOther(vehicle) * 7,
      netProfit,
      periodDays: 7
    };
  }

  function countByStatus(vehicles = []) {
    const counts = {
      total: vehicles.length,
      operating: 0,
      empty: 0,
      maintenance: 0,
      accident: 0,
      terminated: 0,
      companyLeaseRental: 0,
      companyOwned: 0
    };
    vehicles.forEach(vehicle => {
      const status = String(vehicle.vehicleStatus || '');
      if (getErpMode(vehicle) === ERP_MODES.COMPANY_OWNED) counts.companyOwned += 1;
      else counts.companyLeaseRental += 1;
      if (status === VEHICLE_STATUSES.OPERATING) counts.operating += 1;
      else if (status === VEHICLE_STATUSES.EMPTY || isEmptyVehicle(vehicle)) counts.empty += 1;
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
    const periodFactor = periodType === 'monthly' ? (30 / 7) : 1;

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
      netProfit: 0,
      actualProfit: 0,
      weeklyProfit: 0
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
      totals.rentalRevenue += profit.weeklyCharge * periodFactor;
      totals.leaseCost += profit.weeklyCost * periodFactor;
      totals.insuranceCost += profit.insuranceCost * periodFactor;
      totals.otherCost += profit.otherCost * periodFactor;
      totals.unpaidTotal += profit.unpaid;
      totals.emptyLossTotal += profit.emptyLoss * periodFactor;
      totals.maintenanceCost += profit.maintenanceCost;
      totals.accidentLoss += profit.accidentLoss;
      totals.weeklyProfit += profit.weeklyProfit * periodFactor;
      totals.actualProfit += profit.actualProfit * periodFactor;
      totals.netProfit += profit.netProfit * periodFactor;
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

  function paymentCheckLabel(value) {
    switch (String(value || '')) {
      case PAYMENT_CHECK.PAID: return '완납';
      case PAYMENT_CHECK.UNPAID: return '미납';
      default: return '-';
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
      case VEHICLE_CATEGORIES.COMPANY_OWNED: return '회사소유리스';
      default: return '회사리스';
    }
  }

  function vehicleSourceLabel(vehicle) {
    return isCompanyOwned(vehicle) ? '브램리스' : '회사리스';
  }

  function erpModeLabel(mode) {
    return mode === ERP_MODES.COMPANY_OWNED ? '회사소유리스' : '회사리스';
  }

  const RIDER_WEEKLY_RENT_LABEL = '라이더부담 리스렌탈료';

  return {
    VEHICLE_CATEGORIES,
    ERP_MODES,
    VEHICLE_STATUSES,
    PAYMENT_STATUSES,
    PAYMENT_CHECK,
    money,
    todayKey,
    daysBetween,
    weekStartKey,
    weekEndKey,
    monthKey,
    getErpMode,
    isCompanyOwned,
    effectiveDailyCharge,
    effectiveDailyLeaseCost,
    computeOwnedCostBase,
    computeErpMetrics,
    computeDailyProfit,
    computeEmptyMetrics,
    computeVehicleFinalProfit,
    aggregateKpis,
    countByStatus,
    paymentStatusLabel,
    paymentCheckLabel,
    vehicleStatusLabel,
    vehicleCategoryLabel,
    vehicleSourceLabel,
    erpModeLabel,
    RIDER_WEEKLY_RENT_LABEL
  };
})();

window.BremLeaseProfit = BremLeaseProfit;
