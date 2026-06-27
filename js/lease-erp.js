/**
 * BREM 리스/렌탈 ERP — Supabase 테이블 저장소
 */
const BremLeaseErp = (function () {
  const CONTRACT_TYPES = Object.freeze({ LEASE: 'lease', RENTAL: 'rental' });
  const KEYS = {
    vehicles: 'brem_lease_vehicles',
    contracts: 'brem_lease_contracts',
    payments: 'brem_lease_payments',
    accidents: 'brem_lease_accidents',
    maintenance: 'brem_lease_maintenance',
    profitLogs: 'brem_lease_profit_logs',
    arrears: 'brem_lease_arrears',
    legacy: 'brem_admin_leases'
  };

  const CONTRACT_STATUS = Object.freeze({ ACTIVE: 'active', ENDED: 'ended' });
  const ARREAR_STATUS = Object.freeze({
    UNPAID: 'unpaid',
    COLLECTING: 'collecting',
    COMPLETED: 'completed'
  });

  let migrationDone = false;

  function createId() {
    return BremStorage?.createId?.() || `lease_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function normalizeMoney(value) {
    const num = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? Math.round(num) : 0;
  }

  function normalizeRate(value) {
    const num = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? num : 0;
  }

  function normalizeDate(value) {
    if (!value && value !== 0) return '';
    if (typeof value === 'number' && window.XLSX?.SSF) {
      const parsed = window.XLSX.SSF.parse_date_code(value);
      if (parsed) {
        return [parsed.y, String(parsed.m).padStart(2, '0'), String(parsed.d).padStart(2, '0')].join('-');
      }
    }
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const digits = text.replace(/[^\d]/g, '');
    if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    const parsedDate = new Date(text);
    if (!Number.isNaN(parsedDate.getTime())) {
      return [
        parsedDate.getFullYear(),
        String(parsedDate.getMonth() + 1).padStart(2, '0'),
        String(parsedDate.getDate()).padStart(2, '0')
      ].join('-');
    }
    return '';
  }

  function normalizeContractType(value) {
    const text = String(value || '').trim().toLowerCase();
    if (['rental', '렌탈', '렌트', 'rent', 'r', 'external_rental'].includes(text)) return CONTRACT_TYPES.RENTAL;
    return CONTRACT_TYPES.LEASE;
  }

  function normalizeVehicleCategory(value, contractType) {
    const text = String(value || '').trim().toLowerCase();
    if (['company_owned', '회사보유', '회사보유차량', '자사'].includes(text)) {
      return BremLeaseProfit.VEHICLE_CATEGORIES.COMPANY_OWNED;
    }
    if (['external_rental', '외부렌탈'].includes(text)) {
      return BremLeaseProfit.VEHICLE_CATEGORIES.EXTERNAL_RENTAL;
    }
    if (['external_lease', '외부리스'].includes(text)) return BremLeaseProfit.VEHICLE_CATEGORIES.EXTERNAL_LEASE;
    return contractType === CONTRACT_TYPES.RENTAL
      ? BremLeaseProfit.VEHICLE_CATEGORIES.EXTERNAL_RENTAL
      : BremLeaseProfit.VEHICLE_CATEGORIES.EXTERNAL_LEASE;
  }

  function normalizeRentalAssignment(raw) {
    if (raw === null || raw === false) return null;
    if (!raw || typeof raw !== 'object') return null;
    const renter = String(raw.renter || '').trim();
    const startDate = normalizeDate(raw.startDate);
    const returnDate = normalizeDate(raw.returnDate);
    const dailyRent = normalizeMoney(raw.dailyRent);
    const weeklyRent = dailyRent > 0 ? dailyRent * 7 : normalizeMoney(raw.weeklyRent ?? raw.monthlyRent);
    const memo = String(raw.memo || '').trim();
    if (!renter && !startDate && !dailyRent && !weeklyRent && !returnDate && !memo) return null;
    return { renter, startDate, returnDate, dailyRent, weeklyRent, memo };
  }

  function todayKey() {
    return BremLeaseProfit.todayKey();
  }

  function hasActiveContract(item) {
    const end = String(item?.contractEndDate || '').trim();
    if (!end) return true;
    return end >= todayKey();
  }

  function hasActiveRentalAssignment(item) {
    const assignment = item?.rentalAssignment;
    if (!assignment) return false;
    if (!String(assignment.renter || '').trim()) return false;
    const returnDate = String(assignment.returnDate || '').trim();
    if (!returnDate) return true;
    return returnDate >= todayKey();
  }

  function isEmptyVehicle(item) {
    if (!item) return false;
    if (String(item.vehicleStatus) === BremLeaseProfit.VEHICLE_STATUSES.EMPTY) return true;
    const category = String(item.vehicleCategory || '');
    const isLeaseLike = category === BremLeaseProfit.VEHICLE_CATEGORIES.EXTERNAL_LEASE
      || String(item.contractType) === CONTRACT_TYPES.LEASE;
    if (!isLeaseLike) return false;
    if (!hasActiveContract(item)) return false;
    if (hasActiveRentalAssignment(item)) return false;
    if (String(item.renter || '').trim()) return false;
    return true;
  }

  function inferVehicleStatus(record, existing = null) {
    if (record.vehicleStatus) return String(record.vehicleStatus);
    if (existing?.vehicleStatus) return existing.vehicleStatus;
    const renter = String(record.renter ?? existing?.renter ?? '').trim();
    if (!renter) return BremLeaseProfit.VEHICLE_STATUSES.EMPTY;
    const end = normalizeDate(record.contractEndDate ?? existing?.contractEndDate);
    if (end && end < todayKey()) return BremLeaseProfit.VEHICLE_STATUSES.TERMINATED;
    return BremLeaseProfit.VEHICLE_STATUSES.OPERATING;
  }

  function normalizeRecord(raw = {}, existing = null) {
    const contractType = normalizeContractType(
      raw.contractType != null ? raw.contractType : existing?.contractType
    );
    const vehicleCategory = normalizeVehicleCategory(
      raw.vehicleCategory != null ? raw.vehicleCategory : existing?.vehicleCategory,
      contractType
    );
    const operationType = String(
      raw.operationType != null ? raw.operationType : existing?.operationType || contractType
    ).trim() || contractType;

    const dailyChargeAmount = normalizeMoney(
      raw.dailyChargeAmount != null ? raw.dailyChargeAmount
        : (raw.dailyRent != null ? raw.dailyRent : existing?.dailyChargeAmount ?? existing?.dailyRent)
    );
    const dailyLeaseCost = normalizeMoney(
      raw.dailyLeaseCost != null ? raw.dailyLeaseCost : existing?.dailyLeaseCost
    );
    const dailyInsuranceCost = normalizeMoney(
      raw.dailyInsuranceCost != null ? raw.dailyInsuranceCost : existing?.dailyInsuranceCost
    );
    const dailyOtherCost = normalizeMoney(
      raw.dailyOtherCost != null ? raw.dailyOtherCost : existing?.dailyOtherCost
    );
    const unpaidDays = Math.max(0, Math.round(normalizeMoney(
      raw.unpaidDays != null ? raw.unpaidDays : existing?.unpaidDays
    )));
    const acquisitionTaxRate = normalizeRate(
      raw.acquisitionTaxRate != null ? raw.acquisitionTaxRate : existing?.acquisitionTaxRate
    );
    const purchasePrice = normalizeMoney(raw.purchasePrice != null ? raw.purchasePrice : existing?.purchasePrice);
    const otherAcquisitionCost = normalizeMoney(
      raw.otherAcquisitionCost != null ? raw.otherAcquisitionCost : existing?.otherAcquisitionCost
    );
    const annualInsuranceCost = normalizeMoney(
      raw.annualInsuranceCost != null ? raw.annualInsuranceCost : existing?.annualInsuranceCost
    );
    const emptyDailyLoss = normalizeMoney(
      raw.emptyDailyLoss != null ? raw.emptyDailyLoss : existing?.emptyDailyLoss
    );
    let acquisitionTaxAmount = normalizeMoney(
      raw.acquisitionTaxAmount != null ? raw.acquisitionTaxAmount : existing?.acquisitionTaxAmount
    );
    if (!acquisitionTaxAmount && purchasePrice && acquisitionTaxRate) {
      acquisitionTaxAmount = purchasePrice * (acquisitionTaxRate / 100);
    }
    let totalAcquisitionCost = normalizeMoney(
      raw.totalAcquisitionCost != null ? raw.totalAcquisitionCost : existing?.totalAcquisitionCost
    );
    if (!totalAcquisitionCost && (purchasePrice || acquisitionTaxAmount || otherAcquisitionCost || annualInsuranceCost)) {
      totalAcquisitionCost = purchasePrice + acquisitionTaxAmount + otherAcquisitionCost + annualInsuranceCost;
    }
    let resolvedDailyInsurance = dailyInsuranceCost;
    if (!resolvedDailyInsurance && annualInsuranceCost > 0) {
      resolvedDailyInsurance = annualInsuranceCost / 365;
    }

    const record = {
      id: existing?.id || raw.id || createId(),
      vehicleCategory,
      operationType,
      contractType,
      model: String(raw.model != null ? raw.model : existing?.model || '').trim(),
      chassisNumber: String(raw.chassisNumber != null ? raw.chassisNumber : existing?.chassisNumber || '').trim(),
      vehicleNumber: String(raw.vehicleNumber != null ? raw.vehicleNumber : existing?.vehicleNumber || '').trim(),
      leaseCompany: String(
        raw.leaseCompany != null ? raw.leaseCompany : (raw.lessor != null ? raw.lessor : existing?.leaseCompany ?? existing?.lessor)
      ).trim(),
      dailyLeaseCost: vehicleCategory === BremLeaseProfit.VEHICLE_CATEGORIES.COMPANY_OWNED
        ? 0
        : (dailyLeaseCost || (contractType === CONTRACT_TYPES.LEASE ? normalizeMoney(existing?.dailyRent) : 0)),
      insuranceCompany: String(raw.insuranceCompany != null ? raw.insuranceCompany : existing?.insuranceCompany || '').trim(),
      insuranceAge: String(raw.insuranceAge != null ? raw.insuranceAge : existing?.insuranceAge || '').trim(),
      insuranceType: String(raw.insuranceType != null ? raw.insuranceType : existing?.insuranceType || '').trim(),
      dailyInsuranceCost: resolvedDailyInsurance,
      contractStartDate: normalizeDate(raw.contractStartDate != null ? raw.contractStartDate : existing?.contractStartDate),
      contractEndDate: normalizeDate(raw.contractEndDate != null ? raw.contractEndDate : existing?.contractEndDate),
      returnDate: normalizeDate(raw.returnDate != null ? raw.returnDate : existing?.returnDate),
      renter: String(raw.renter != null ? raw.renter : existing?.renter || '').trim(),
      lesseePhone: String(raw.lesseePhone != null ? raw.lesseePhone : existing?.lesseePhone || '').trim(),
      lessor: String(raw.lessor != null ? raw.lessor : existing?.lessor || '').trim(),
      dailyChargeAmount,
      dailyRent: dailyChargeAmount,
      weeklyRent: dailyChargeAmount > 0 ? dailyChargeAmount * 7 : normalizeMoney(raw.weeklyRent ?? existing?.weeklyRent),
      unpaidAmount: normalizeMoney(raw.unpaidAmount != null ? raw.unpaidAmount : existing?.unpaidAmount),
      unpaidDays,
      paymentCheck: String(raw.paymentCheck != null ? raw.paymentCheck : existing?.paymentCheck || '').trim(),
      unpaidCollectionMethod: String(
        raw.unpaidCollectionMethod != null ? raw.unpaidCollectionMethod : existing?.unpaidCollectionMethod || ''
      ).trim(),
      balanceDiff: normalizeMoney(raw.balanceDiff != null ? raw.balanceDiff : existing?.balanceDiff),
      memo: String(raw.memo != null ? raw.memo : existing?.memo || '').trim(),
      vehicleStatus: inferVehicleStatus(raw, existing),
      emptyStartDate: normalizeDate(raw.emptyStartDate != null ? raw.emptyStartDate : existing?.emptyStartDate),
      expectedDailyRent: normalizeMoney(raw.expectedDailyRent != null ? raw.expectedDailyRent : existing?.expectedDailyRent),
      dailyOtherCost,
      purchasePrice,
      acquisitionTaxRate,
      acquisitionTaxAmount,
      otherAcquisitionCost,
      totalAcquisitionCost,
      annualInsuranceCost,
      emptyDailyLoss,
      acquisitionDate: normalizeDate(raw.acquisitionDate != null ? raw.acquisitionDate : existing?.acquisitionDate),
      rentalAssignment: normalizeRentalAssignment(
        raw.rentalAssignment !== undefined ? raw.rentalAssignment : existing?.rentalAssignment
      ),
      createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!record.balanceDiff && record.dailyChargeAmount) {
      const metrics = BremLeaseProfit?.computeErpMetrics?.(record);
      record.balanceDiff = metrics?.marginDaily ?? (record.dailyChargeAmount - record.dailyLeaseCost);
    }
    if (unpaidDays > 0 && record.dailyChargeAmount && !raw.unpaidAmount && !existing?.unpaidAmount) {
      record.unpaidAmount = unpaidDays * record.dailyChargeAmount;
    }
    if (record.vehicleStatus === BremLeaseProfit.VEHICLE_STATUSES.EMPTY && !record.emptyStartDate) {
      record.emptyStartDate = record.returnDate || record.contractStartDate || todayKey();
    }
    return record;
  }

  function normalizePayment(raw = {}, existing = null) {
    const chargeAmount = normalizeMoney(raw.chargeAmount != null ? raw.chargeAmount : existing?.chargeAmount);
    const paidAmount = normalizeMoney(raw.paidAmount != null ? raw.paidAmount : existing?.paidAmount);
    const unpaidAmount = raw.unpaidAmount != null
      ? normalizeMoney(raw.unpaidAmount)
      : Math.max(0, chargeAmount - paidAmount);
    const dueDate = normalizeDate(raw.dueDate != null ? raw.dueDate : existing?.dueDate);
    const paidDate = normalizeDate(raw.paidDate != null ? raw.paidDate : existing?.paidDate);
    let overdueDays = Number(raw.overdueDays != null ? raw.overdueDays : existing?.overdueDays || 0);
    if (!overdueDays && dueDate && !paidDate && dueDate < todayKey()) {
      overdueDays = BremLeaseProfit.daysBetween(dueDate, todayKey()) - 1;
    }
    let paymentStatus = String(raw.paymentStatus || existing?.paymentStatus || '').trim();
    if (!paymentStatus) {
      if (unpaidAmount <= 0) paymentStatus = BremLeaseProfit.PAYMENT_STATUSES.NORMAL;
      else if (overdueDays > 0) paymentStatus = BremLeaseProfit.PAYMENT_STATUSES.OVERDUE;
      else paymentStatus = BremLeaseProfit.PAYMENT_STATUSES.UNPAID;
    }
    return {
      id: existing?.id || raw.id || createId(),
      vehicleId: String(raw.vehicleId != null ? raw.vehicleId : existing?.vehicleId || '').trim(),
      dueDate,
      paidDate,
      chargeAmount,
      paidAmount,
      unpaidAmount,
      overdueDays: Math.max(0, overdueDays),
      paymentStatus,
      memo: String(raw.memo != null ? raw.memo : existing?.memo || '').trim(),
      createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeAccident(raw = {}, existing = null) {
    const repairCost = normalizeMoney(raw.repairCost != null ? raw.repairCost : existing?.repairCost);
    const insurancePayout = normalizeMoney(raw.insurancePayout != null ? raw.insurancePayout : existing?.insurancePayout);
    const selfPay = normalizeMoney(raw.selfPay != null ? raw.selfPay : existing?.selfPay);
    const actualLoss = raw.actualLoss != null
      ? normalizeMoney(raw.actualLoss)
      : repairCost - insurancePayout + selfPay;
    return {
      id: existing?.id || raw.id || createId(),
      vehicleId: String(raw.vehicleId != null ? raw.vehicleId : existing?.vehicleId || '').trim(),
      accidentDate: normalizeDate(raw.accidentDate != null ? raw.accidentDate : existing?.accidentDate),
      driverName: String(raw.driverName != null ? raw.driverName : existing?.driverName || '').trim(),
      vehicleNumber: String(raw.vehicleNumber != null ? raw.vehicleNumber : existing?.vehicleNumber || '').trim(),
      repairCost,
      insurancePayout,
      selfPay,
      actualLoss,
      memo: String(raw.memo != null ? raw.memo : existing?.memo || '').trim(),
      createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeMaintenance(raw = {}, existing = null) {
    return {
      id: existing?.id || raw.id || createId(),
      vehicleId: String(raw.vehicleId != null ? raw.vehicleId : existing?.vehicleId || '').trim(),
      maintenanceDate: normalizeDate(raw.maintenanceDate != null ? raw.maintenanceDate : existing?.maintenanceDate),
      vehicleNumber: String(raw.vehicleNumber != null ? raw.vehicleNumber : existing?.vehicleNumber || '').trim(),
      description: String(raw.description != null ? raw.description : existing?.description || '').trim(),
      maintenanceCost: normalizeMoney(raw.maintenanceCost != null ? raw.maintenanceCost : existing?.maintenanceCost),
      partsCost: normalizeMoney(raw.partsCost != null ? raw.partsCost : existing?.partsCost),
      memo: String(raw.memo != null ? raw.memo : existing?.memo || '').trim(),
      createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeModelType(value) {
    const text = String(value || '').trim().toUpperCase();
    if (['PCX', 'NMAX', 'FORZA'].includes(text)) return text;
    if (text === '기타') return '기타';
    return text || '';
  }

  function normalizeCollectionMethods(raw, existing) {
    const source = raw?.collectionMethods != null ? raw.collectionMethods : existing?.collectionMethods;
    if (Array.isArray(source)) return source.filter(Boolean);
    const text = String(source || '').trim();
    if (!text) return [];
    return text.split(/[,/|]/).map(item => item.trim()).filter(Boolean);
  }

  function normalizeContract(raw = {}, existing = null) {
    let dailyRent = normalizeMoney(raw.dailyRent != null ? raw.dailyRent : existing?.dailyRent);
    let weeklyRent = normalizeMoney(raw.weeklyRent != null ? raw.weeklyRent : existing?.weeklyRent);
    if (!dailyRent && weeklyRent) dailyRent = weeklyRent;
    if (!weeklyRent && dailyRent) weeklyRent = dailyRent * 7;
    if (dailyRent && weeklyRent && Math.abs(weeklyRent - dailyRent * 7) > 1) {
      weeklyRent = dailyRent * 7;
    }
    const rentalDays = Math.max(0, Math.round(normalizeMoney(
      raw.rentalDays != null ? raw.rentalDays : existing?.rentalDays
    )));
    const emptyDays = Math.max(0, Math.round(normalizeMoney(
      raw.emptyDays != null ? raw.emptyDays : existing?.emptyDays
    )));
    const unpaidDays = Math.max(0, Math.round(normalizeMoney(
      raw.unpaidDays != null ? raw.unpaidDays : existing?.unpaidDays
    )));
    const paidAmount = normalizeMoney(raw.paidAmount != null ? raw.paidAmount : existing?.paidAmount);
    const metrics = BremLeaseRentalCalc?.compute?.({
      weeklyRent,
      dailyRent,
      rentalDays,
      emptyDays,
      unpaidDays,
      vehicleCost: normalizeMoney(raw.vehicleCost != null ? raw.vehicleCost : existing?.vehicleCost),
      insuranceCost: normalizeMoney(raw.insuranceCost != null ? raw.insuranceCost : existing?.insuranceCost),
      leaseCost: normalizeMoney(raw.leaseCost != null ? raw.leaseCost : existing?.leaseCost),
      maintenanceCost: normalizeMoney(raw.maintenanceCost != null ? raw.maintenanceCost : existing?.maintenanceCost),
      accidentCost: normalizeMoney(raw.accidentCost != null ? raw.accidentCost : existing?.accidentCost),
      otherCost: normalizeMoney(raw.otherCost != null ? raw.otherCost : existing?.otherCost),
      penaltyFee: normalizeMoney(
        raw.depositAmount != null ? raw.depositAmount
          : (raw.penaltyFee != null ? raw.penaltyFee : (existing?.depositAmount ?? existing?.penaltyFee))
      ),
      paidAmount,
      recoveredAmount: normalizeMoney(raw.recoveredAmount != null ? raw.recoveredAmount : existing?.recoveredAmount)
    }) || {};

    const depositAmount = normalizeMoney(
      raw.depositAmount != null ? raw.depositAmount
        : (raw.penaltyFee != null ? raw.penaltyFee : (existing?.depositAmount ?? existing?.penaltyFee))
    );

    return {
      id: existing?.id || raw.id || createId(),
      vehicleId: String(raw.vehicleId != null ? raw.vehicleId : existing?.vehicleId || '').trim(),
      contractType: normalizeContractType(raw.contractType != null ? raw.contractType : existing?.contractType),
      vehicleNumber: String(raw.vehicleNumber != null ? raw.vehicleNumber : existing?.vehicleNumber || '').trim(),
      vehicleName: String(raw.vehicleName != null ? raw.vehicleName : existing?.vehicleName || '').trim(),
      modelType: normalizeModelType(raw.modelType != null ? raw.modelType : existing?.modelType),
      driverName: String(raw.driverName != null ? raw.driverName : existing?.driverName || '').trim(),
      driverPhone: String(raw.driverPhone != null ? raw.driverPhone : existing?.driverPhone || '').trim(),
      startDate: normalizeDate(raw.startDate != null ? raw.startDate : existing?.startDate),
      endDate: normalizeDate(raw.endDate != null ? raw.endDate : existing?.endDate),
      weeklyRent: metrics.weeklyRent || weeklyRent,
      dailyRent: metrics.dailyRent || dailyRent,
      dailyCharge: metrics.dailyRent || dailyRent,
      dailyCost: normalizeMoney(raw.dailyCost != null ? raw.dailyCost : existing?.dailyCost),
      rentalDays,
      emptyDays,
      unpaidDays,
      paidAmount,
      unpaidAmount: metrics.unpaidAmount,
      recoveredAmount: normalizeMoney(raw.recoveredAmount != null ? raw.recoveredAmount : existing?.recoveredAmount),
      vehicleCost: normalizeMoney(raw.vehicleCost != null ? raw.vehicleCost : existing?.vehicleCost),
      insuranceCost: normalizeMoney(raw.insuranceCost != null ? raw.insuranceCost : existing?.insuranceCost),
      leaseCost: normalizeMoney(raw.leaseCost != null ? raw.leaseCost : existing?.leaseCost),
      maintenanceCost: normalizeMoney(raw.maintenanceCost != null ? raw.maintenanceCost : existing?.maintenanceCost),
      accidentCost: normalizeMoney(raw.accidentCost != null ? raw.accidentCost : existing?.accidentCost),
      otherCost: normalizeMoney(raw.otherCost != null ? raw.otherCost : existing?.otherCost),
      depositAmount,
      penaltyFee: depositAmount,
      collectionStatus: String(
        raw.collectionStatus != null ? raw.collectionStatus : existing?.collectionStatus || ARREAR_STATUS.UNPAID
      ).trim(),
      collectionMethods: normalizeCollectionMethods(raw, existing),
      collectionMethod: String(
        raw.collectionMethod != null ? raw.collectionMethod : existing?.collectionMethod || ''
      ).trim(),
      processedDate: normalizeDate(raw.processedDate != null ? raw.processedDate : existing?.processedDate),
      rentalRevenue: metrics.rentalRevenue,
      emptyLoss: metrics.emptyLoss,
      totalCost: metrics.totalCost,
      netProfit: metrics.netProfit,
      status: String(raw.status != null ? raw.status : existing?.status || CONTRACT_STATUS.ACTIVE).trim(),
      memo: String(raw.memo != null ? raw.memo : existing?.memo || '').trim(),
      rawData: { ...(existing?.rawData || {}), ...(raw.rawData || {}), metrics },
      createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeArrear(raw = {}, existing = null) {
    const unpaidDays = Math.max(0, Math.round(normalizeMoney(
      raw.unpaidDays != null ? raw.unpaidDays : existing?.unpaidDays
    )));
    const unpaidAmount = normalizeMoney(raw.unpaidAmount != null ? raw.unpaidAmount : existing?.unpaidAmount);
    const paidAmount = normalizeMoney(raw.paidAmount != null ? raw.paidAmount : existing?.paidAmount);
    const recoveredAmount = normalizeMoney(
      raw.recoveredAmount != null ? raw.recoveredAmount : existing?.recoveredAmount
    );
    return {
      id: existing?.id || raw.id || createId(),
      vehicleId: String(raw.vehicleId != null ? raw.vehicleId : existing?.vehicleId || '').trim(),
      contractId: String(raw.contractId != null ? raw.contractId : existing?.contractId || '').trim(),
      unpaidDays,
      unpaidAmount,
      paidAmount,
      recoveredAmount,
      collectionMethods: normalizeCollectionMethods(raw, existing),
      collectionStatus: String(
        raw.collectionStatus != null ? raw.collectionStatus : existing?.collectionStatus || ARREAR_STATUS.UNPAID
      ).trim(),
      processedDate: normalizeDate(raw.processedDate != null ? raw.processedDate : existing?.processedDate),
      memo: String(raw.memo != null ? raw.memo : existing?.memo || '').trim(),
      rawData: raw.rawData || existing?.rawData || {},
      createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeProfitLog(raw = {}, existing = null) {
    return {
      id: existing?.id || raw.id || createId(),
      vehicleId: String(raw.vehicleId != null ? raw.vehicleId : existing?.vehicleId || '').trim(),
      contractId: String(raw.contractId != null ? raw.contractId : existing?.contractId || '').trim(),
      periodType: String(raw.periodType != null ? raw.periodType : existing?.periodType || 'snapshot').trim(),
      periodStart: normalizeDate(raw.periodStart != null ? raw.periodStart : existing?.periodStart),
      periodEnd: normalizeDate(raw.periodEnd != null ? raw.periodEnd : existing?.periodEnd),
      rentalRevenue: normalizeMoney(raw.rentalRevenue != null ? raw.rentalRevenue : existing?.rentalRevenue),
      leaseCost: normalizeMoney(raw.leaseCost != null ? raw.leaseCost : existing?.leaseCost),
      insuranceCost: normalizeMoney(raw.insuranceCost != null ? raw.insuranceCost : existing?.insuranceCost),
      otherCost: normalizeMoney(raw.otherCost != null ? raw.otherCost : existing?.otherCost),
      maintenanceCost: normalizeMoney(raw.maintenanceCost != null ? raw.maintenanceCost : existing?.maintenanceCost),
      accidentLoss: normalizeMoney(raw.accidentLoss != null ? raw.accidentLoss : existing?.accidentLoss),
      unpaidAmount: normalizeMoney(raw.unpaidAmount != null ? raw.unpaidAmount : existing?.unpaidAmount),
      emptyLoss: normalizeMoney(raw.emptyLoss != null ? raw.emptyLoss : existing?.emptyLoss),
      emptyOpportunity: normalizeMoney(raw.emptyOpportunity != null ? raw.emptyOpportunity : existing?.emptyOpportunity),
      netProfit: normalizeMoney(raw.netProfit != null ? raw.netProfit : existing?.netProfit),
      rawData: { ...(existing?.rawData || {}), ...(raw.rawData || {}) },
      createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function saveProfitSnapshot({ vehicleId, contractId, periodType, periodStart, periodEnd, metrics, vehicle, contract }) {
    const payload = BremLeaseRentalCalc?.buildProfitLogSnapshot?.({
      vehicleId, contractId, periodType, periodStart, periodEnd, metrics, vehicle, contract
    }) || {};
    const normalized = normalizeProfitLog(payload);
    const scopedStart = String(normalized.periodStart || periodStart || '').slice(0, 10);
    const scopedType = String(normalized.periodType || periodType || '').trim();
    const existing = profitLogs().getAll().find(item =>
      item.vehicleId === vehicleId
      && item.periodType === scopedType
      && String(item.periodStart || '').slice(0, 10) === scopedStart
    ) || null;
    if (existing) {
      return profitLogs().update(existing.id, { ...normalized, id: existing.id });
    }
    return profitLogs().create(normalized);
  }

  function readList(key) {
    if (BremStorage?.readTableKey) return BremStorage.readTableKey(key) || [];
    return window.BremDataCache?.getData?.(key) || [];
  }

  const pendingWritePromises = [];

  function writeList(key, list, options = {}) {
    if (BremStorage?.writeTableKey) {
      const persistPromise = BremStorage.writeTableKey(key, list, options);
      pendingWritePromises.push(persistPromise);
      return list;
    }
    window.BremDataCache?.set?.(key, list, { source: 'write' });
    return list;
  }

  async function flushPendingWrites(options = {}) {
    const batch = pendingWritePromises.splice(0);
    await Promise.all(batch.map(promise =>
      promise && BremStorage?.awaitPersist ? BremStorage.awaitPersist(promise) : Promise.resolve()
    ));
    if (!options.skipFlushStorage && BremStorage?.flushStorage) {
      await BremStorage.flushStorage();
    }
  }

  async function persistPending(options = {}) {
    await flushPendingWrites(options);
  }

  function syncLegacyLeaseSettings(list) {
    const next = Array.isArray(list) ? list : vehicles().getAll();
    window.BremDataCache?.set?.(KEYS.legacy, next, { source: 'write' });
    if (BremStorage?.writeTableKey) {
      BremStorage.writeTableKey(KEYS.legacy, next, { allowEmpty: true });
    }
  }

  function purgeVehicleDependencies(vehicleIds = []) {
    const idSet = new Set((vehicleIds || []).map(value => String(value || '').trim()).filter(Boolean));
    if (!idSet.size) return;
    const profitIds = profitLogs().getAll().filter(item => idSet.has(item.vehicleId)).map(item => item.id);
    if (profitIds.length) profitLogs().removeByIds(profitIds);
    const arrearIds = arrears().getAll().filter(item => idSet.has(item.vehicleId)).map(item => item.id);
    if (arrearIds.length) arrears().removeByIds(arrearIds);
    const contractIds = contracts().getAll().filter(item => idSet.has(item.vehicleId)).map(item => item.id);
    if (contractIds.length) contracts().removeByIds(contractIds);
  }

  function afterVehiclesRemoved(removedIds = []) {
    purgeVehicleDependencies(removedIds);
    syncLegacyLeaseSettings(vehicles().getAll());
  }

  async function persistKey() {
    await flushPendingWrites();
  }

  function vehicles() {
    return {
      CONTRACT_TYPES,
      normalizeRecord,
      normalizeContractType,
      normalizeDate,
      normalizeMoney,
      normalizeRentalAssignment,
      todayKey,
      hasActiveContract,
      hasActiveRentalAssignment,
      isEmptyVehicle,
      getEmptyVehicles() {
        return vehicles().getAll().filter(item => isEmptyVehicle(item));
      },
      getAll() {
        return readList(KEYS.vehicles);
      },
      getById(id) {
        return vehicles().getAll().find(item => item.id === id) || null;
      },
      findByVehicleKey({ chassisNumber, vehicleNumber } = {}) {
        const chassis = String(chassisNumber || '').trim();
        const vehicle = String(vehicleNumber || '').trim();
        return vehicles().getAll().find(item => {
          if (chassis && item.chassisNumber === chassis) return true;
          if (vehicle && item.vehicleNumber === vehicle) return true;
          return false;
        }) || null;
      },
      create(raw) {
        const record = normalizeRecord(raw);
        const list = vehicles().getAll();
        list.unshift(record);
        writeList(KEYS.vehicles, list, { incrementalRows: [record] });
        return record;
      },
      update(id, raw) {
        const existing = vehicles().getById(id);
        if (!existing) return null;
        const record = normalizeRecord({ ...existing, ...raw }, existing);
        const list = vehicles().getAll().map(item => item.id === id ? record : item);
        writeList(KEYS.vehicles, list, { incrementalRows: [record] });
        return record;
      },
      upsert(raw) {
        const chassis = String(raw.chassisNumber || '').trim();
        const vehicleNo = String(raw.vehicleNumber || '').trim();
        const existing = raw.id
          ? vehicles().getById(raw.id)
          : vehicles().findByVehicleKey({ chassisNumber: chassis, vehicleNumber: vehicleNo });
        if (existing) return vehicles().update(existing.id, { ...existing, ...raw });
        return vehicles().create(raw);
      },
      upsertMany(records = []) {
        return records.map(record => vehicles().upsert(record));
      },
      removeById(id) {
        const list = vehicles().getAll().filter(item => item.id !== id);
        writeList(KEYS.vehicles, list, { deletedRowIds: [id], deleteOnly: true, allowEmpty: true });
        afterVehiclesRemoved([id]);
      },
      removeByIds(ids = []) {
        const idSet = new Set((ids || []).map(value => String(value || '').trim()).filter(Boolean));
        if (!idSet.size) return;
        const deletedRowIds = [...idSet];
        const list = vehicles().getAll().filter(item => !idSet.has(item.id));
        writeList(KEYS.vehicles, list, { deletedRowIds, deleteOnly: true, allowEmpty: true });
        afterVehiclesRemoved(deletedRowIds);
      },
      assignRental(vehicleId, assignment) {
        const existing = vehicles().getById(vehicleId);
        if (!existing) return null;
        return vehicles().update(vehicleId, {
          rentalAssignment: normalizeRentalAssignment(assignment),
          vehicleStatus: BremLeaseProfit.VEHICLE_STATUSES.OPERATING
        });
      },
      clearRentalAssignment(vehicleId) {
        const existing = vehicles().getById(vehicleId);
        if (!existing) return null;
        return vehicles().update(vehicleId, {
          rentalAssignment: null,
          vehicleStatus: isEmptyVehicle({ ...existing, rentalAssignment: null })
            ? BremLeaseProfit.VEHICLE_STATUSES.EMPTY
            : existing.vehicleStatus
        });
      },
      async persist() {
        await persistKey(KEYS.vehicles);
      }
    };
  }

  function makeChildStore(key, normalizeFn) {
    const store = {
      getAll() { return readList(key); },
      getById(id) { return store.getAll().find(item => item.id === id) || null; },
      getByVehicleId(vehicleId) {
        return store.getAll().filter(item => item.vehicleId === vehicleId);
      },
      create(raw) {
        const record = normalizeFn(raw);
        const list = store.getAll();
        list.unshift(record);
        writeList(key, list, { incrementalRows: [record] });
        return record;
      },
      update(id, raw) {
        const existing = store.getById(id);
        if (!existing) return null;
        const record = normalizeFn({ ...existing, ...raw }, existing);
        const list = store.getAll().map(item => item.id === id ? record : item);
        writeList(key, list, { incrementalRows: [record] });
        return record;
      },
      removeById(id) {
        const list = store.getAll().filter(item => item.id !== id);
        writeList(key, list, { deletedRowIds: [id], deleteOnly: true, allowEmpty: true });
      },
      removeByIds(ids = []) {
        const idSet = new Set((ids || []).map(value => String(value || '').trim()).filter(Boolean));
        if (!idSet.size) return;
        const deletedRowIds = [...idSet];
        const list = store.getAll().filter(item => !idSet.has(item.id));
        writeList(key, list, { deletedRowIds, deleteOnly: true, allowEmpty: true });
      },
      async persist() {
        await persistKey(key);
      }
    };
    return store;
  }

  function groupByVehicleId(items = []) {
    return items.reduce((map, item) => {
      const id = item.vehicleId;
      if (!id) return map;
      if (!map[id]) map[id] = [];
      map[id].push(item);
      return map;
    }, {});
  }

  function legacyRecordToVehicle(legacy) {
    const contractType = normalizeContractType(legacy.contractType);
    const assignment = normalizeRentalAssignment(legacy.rentalAssignment);
    return normalizeRecord({
      id: legacy.id,
      contractType,
      model: legacy.model,
      chassisNumber: legacy.chassisNumber,
      vehicleNumber: legacy.vehicleNumber,
      insuranceCompany: legacy.insuranceCompany,
      insuranceAge: legacy.insuranceAge,
      insuranceType: legacy.insuranceType,
      contractStartDate: legacy.contractStartDate,
      contractEndDate: legacy.contractEndDate,
      returnDate: legacy.returnDate,
      memo: legacy.memo,
      renter: legacy.renter,
      lessor: legacy.lessor,
      dailyLeaseCost: contractType === CONTRACT_TYPES.LEASE ? legacy.dailyRent : 0,
      dailyChargeAmount: contractType === CONTRACT_TYPES.RENTAL
        ? legacy.dailyRent
        : (assignment?.dailyRent || 0),
      rentalAssignment: assignment,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt
    });
  }

  async function migrateLegacySettingsIfNeeded() {
    if (migrationDone) return { migrated: 0, skipped: true };
    const current = vehicles().getAll();
    if (current.length) {
      migrationDone = true;
      return { migrated: 0, skipped: true };
    }
    const legacy = readList(KEYS.legacy) || [];
    if (!legacy.length) {
      migrationDone = true;
      return { migrated: 0, skipped: true };
    }
    const mapped = legacy.map(legacyRecordToVehicle);
    writeList(KEYS.vehicles, mapped, { allowEmpty: false });
    syncLegacyLeaseSettings(mapped);
    await vehicles().persist();
    migrationDone = true;
    return { migrated: mapped.length, skipped: false };
  }

  async function ensureLoaded(options = {}) {
    await BremStorage?.ensureSectionLoaded?.('lease-management');
    if (BremStorage?.ensureLeaseErpKeysLoaded) {
      await BremStorage.ensureLeaseErpKeysLoaded(options);
    }
    await migrateLegacySettingsIfNeeded();
    if (options.syncStatuses !== false) {
      syncAllVehicleStatusesFromContracts();
    }
    return { ok: true };
  }

  function isContractOperating(contract) {
    if (!contract || !String(contract.driverName || '').trim()) return false;
    const today = todayKey();
    const start = normalizeDate(contract.startDate);
    const end = normalizeDate(contract.endDate);
    if (start && start > today) return false;
    if (end && end < today) return false;
    return true;
  }

  function getLatestContractForVehicle(vehicleId) {
    if (!vehicleId) return null;
    const list = contracts().getAll().filter(item => item.vehicleId === vehicleId);
    if (!list.length) return null;
    const active = list.find(item => isContractOperating(item));
    if (active) return active;
    return list.sort((a, b) => {
      const byStart = String(b.startDate || '').localeCompare(String(a.startDate || ''));
      if (byStart !== 0) return byStart;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    })[0];
  }

  function hasOpenArrearForVehicle(vehicleId) {
    if (!vehicleId) return false;
    return arrears().getAll().some(item =>
      item.vehicleId === vehicleId
      && String(item.collectionStatus || '') !== ARREAR_STATUS.COMPLETED
    );
  }

  function resolveRuntimeStatus(vehicle, contract) {
    if (!vehicle) {
      return { code: 'empty', label: '공차(로스)', operating: false };
    }
    if (hasOpenArrearForVehicle(vehicle.id)) {
      return { code: 'unpaid', label: '미납중', operating: false };
    }
    if (isContractOperating(contract)) {
      return { code: 'operating', label: '운행중', operating: true };
    }
    return { code: 'empty', label: '공차(로스)', operating: false };
  }

  function resolveEmptyStartOnTransition(vehicle, contract, runtime) {
    const today = todayKey();
    if (runtime.operating) return '';
    const end = normalizeDate(contract?.endDate);
    const start = normalizeDate(contract?.startDate);
    const fallback = vehicle?.emptyStartDate
      || normalizeDate(vehicle?.contractStartDate)
      || String(vehicle?.createdAt || '').slice(0, 10)
      || today;
    if (end && end <= today) return end;
    if (start && start > today) return fallback;
    if (!contract || !String(contract.driverName || '').trim()) return fallback;
    if (String(vehicle?.vehicleStatus || '') === BremLeaseProfit.VEHICLE_STATUSES.OPERATING) {
      return today;
    }
    return fallback;
  }

  function syncVehicleFromContract(vehicle, contract = null) {
    if (!vehicle) return null;
    const resolvedContract = contract ?? getLatestContractForVehicle(vehicle.id);
    const runtime = resolveRuntimeStatus(vehicle, resolvedContract);
    const patch = {};
    if (runtime.operating) {
      patch.vehicleStatus = BremLeaseProfit.VEHICLE_STATUSES.OPERATING;
      patch.renter = resolvedContract?.driverName || '';
      patch.lesseePhone = resolvedContract?.driverPhone || '';
      patch.dailyChargeAmount = normalizeMoney(resolvedContract?.dailyRent);
      patch.dailyRent = patch.dailyChargeAmount;
      patch.weeklyRent = normalizeMoney(resolvedContract?.weeklyRent) || patch.dailyChargeAmount * 7;
      patch.emptyStartDate = '';
    } else {
      patch.vehicleStatus = BremLeaseProfit.VEHICLE_STATUSES.EMPTY;
      patch.renter = '';
      patch.lesseePhone = '';
      patch.dailyChargeAmount = 0;
      patch.dailyRent = 0;
      patch.weeklyRent = 0;
      patch.emptyStartDate = resolveEmptyStartOnTransition(vehicle, resolvedContract, runtime);
    }
    return vehicles().update(vehicle.id, patch);
  }

  function syncAllVehicleStatusesFromContracts() {
    let changed = 0;
    vehicles().getAll().forEach(vehicle => {
      const before = `${vehicle.vehicleStatus}|${vehicle.emptyStartDate}|${vehicle.renter}|${vehicle.dailyChargeAmount}`;
      const updated = syncVehicleFromContract(vehicle);
      const after = `${updated?.vehicleStatus}|${updated?.emptyStartDate}|${updated?.renter}|${updated?.dailyChargeAmount}`;
      if (before !== after) changed += 1;
    });
    return { changed };
  }

  async function persistAll(options = {}) {
    await flushPendingWrites(options);
  }

  function payments() {
    return makeChildStore(KEYS.payments, normalizePayment);
  }

  function contracts() {
    return makeChildStore(KEYS.contracts, normalizeContract);
  }

  function arrears() {
    return makeChildStore(KEYS.arrears, normalizeArrear);
  }

  function profitLogs() {
    return makeChildStore(KEYS.profitLogs, normalizeProfitLog);
  }

  function accidents() {
    return makeChildStore(KEYS.accidents, normalizeAccident);
  }

  function maintenance() {
    return makeChildStore(KEYS.maintenance, normalizeMaintenance);
  }

  function applyVehicleFilters(list, filters = {}) {
    let result = [...list];
    const erpMode = String(filters.erpMode || '').trim();
    const category = String(filters.vehicleCategory || '').trim();
    const status = String(filters.vehicleStatus || '').trim();
    const renter = String(filters.renter || '').trim().toLowerCase();
    const leaseCompany = String(filters.leaseCompany || '').trim().toLowerCase();
    const search = String(filters.search || '').trim().toLowerCase();

    if (erpMode === BremLeaseProfit.ERP_MODES.COMPANY_OWNED) {
      result = result.filter(item => BremLeaseProfit.getErpMode(item) === BremLeaseProfit.ERP_MODES.COMPANY_OWNED);
    } else if (erpMode === BremLeaseProfit.ERP_MODES.COMPANY_LEASE_RENTAL) {
      result = result.filter(item => BremLeaseProfit.getErpMode(item) === BremLeaseProfit.ERP_MODES.COMPANY_LEASE_RENTAL);
    }
    if (category) result = result.filter(item => item.vehicleCategory === category);
    if (status === 'empty') result = result.filter(item => isEmptyVehicle(item));
    else if (status) result = result.filter(item => String(item.vehicleStatus) === status);
    if (renter) {
      result = result.filter(item => {
        const renterName = String(item.renter || item.rentalAssignment?.renter || '').toLowerCase();
        return renterName.includes(renter);
      });
    }
    if (leaseCompany) {
      result = result.filter(item => String(item.leaseCompany || item.lessor || '').toLowerCase().includes(leaseCompany));
    }
    if (search) {
      result = result.filter(item => [
        item.model, item.vehicleNumber, item.chassisNumber, item.renter, item.lesseePhone, item.lessor, item.leaseCompany, item.rentalAssignment?.renter
      ].some(value => String(value || '').toLowerCase().includes(search)));
    }
    return result;
  }

  function buildDashboardKpis(filters = {}) {
    const filtered = applyVehicleFilters(vehicles().getAll(), filters);
    const paymentsByVehicle = groupByVehicleId(payments().getAll());
    const accidentsByVehicle = groupByVehicleId(accidents().getAll());
    const maintenanceByVehicle = groupByVehicleId(maintenance().getAll());
    const weekly = BremLeaseProfit.aggregateKpis(filtered, {
      periodType: 'weekly',
      paymentsByVehicle,
      accidentsByVehicle,
      maintenanceByVehicle
    });
    const monthly = BremLeaseProfit.aggregateKpis(filtered, {
      periodType: 'monthly',
      paymentsByVehicle,
      accidentsByVehicle,
      maintenanceByVehicle
    });
    return {
      counts: BremLeaseProfit.countByStatus(filtered),
      weekly,
      monthly,
      totalUnpaid: payments().getAll().reduce((sum, item) => sum + BremLeaseProfit.money(item.unpaidAmount), 0)
    };
  }

  function enrichVehicleRow(vehicle, context = {}) {
    const profit = BremLeaseProfit.computeDailyProfit(vehicle);
    const empty = BremLeaseProfit.computeEmptyMetrics(vehicle);
    const finalProfit = BremLeaseProfit.computeVehicleFinalProfit(vehicle, {
      payments: context.payments || payments().getByVehicleId(vehicle.id),
      accidents: context.accidents || accidents().getByVehicleId(vehicle.id),
      maintenance: context.maintenance || maintenance().getByVehicleId(vehicle.id),
      periodDays: context.periodDays || 1
    });
    return { vehicle, profit, empty, finalProfit };
  }

  return {
    KEYS,
    CONTRACT_TYPES,
    CONTRACT_STATUS,
    ARREAR_STATUS,
    vehicles,
    contracts,
    payments,
    accidents,
    maintenance,
    arrears,
    profitLogs,
    ensureLoaded,
    migrateLegacySettingsIfNeeded,
    inferVehicleStatus,
    isContractOperating,
    getLatestContractForVehicle,
    hasOpenArrearForVehicle,
    resolveRuntimeStatus,
    syncVehicleFromContract,
    syncAllVehicleStatusesFromContracts,
    persistAll,
    persistPending,
    saveProfitSnapshot,
    buildDashboardKpis,
    applyVehicleFilters,
    enrichVehicleRow,
    groupByVehicleId,
    isEmptyVehicle,
    normalizeRecord,
    normalizeContract,
    normalizePayment,
    normalizeAccident,
    normalizeMaintenance,
    normalizeArrear,
    normalizeProfitLog
  };
})();

window.BremLeaseErp = BremLeaseErp;
