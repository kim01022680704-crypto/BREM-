const BremPromotionApply = (function () {
  function normalizePlatform(platform) {
    return BremPlatforms.normalize(platform);
  }

  function getWeekStatsForDriver(driverId, startDate, endDate, platform) {
    const stats = BremWeeklySettlement.buildDriverCallStatsForPeriod(
      driverId,
      startDate,
      endDate,
      platform
    );
    return {
      callCount: stats.callCount,
      deliveryAmount: stats.deliveryAmount,
      byDay: stats.byDay,
      uploadDays: stats.uploadDays
    };
  }

  function makeCoupangLoginIdFromDriver(driver) {
    if (!driver) return '';
    const name = String(driver.name || '').replace(/\s+/g, '');
    const phone = String(driver.phone || '').replace(/[^0-9]/g, '').slice(-4);
    return phone ? `${name}${phone}` : name;
  }

  function makeCoupangDisplayName(driver, rider) {
    const fromDriver = makeCoupangLoginIdFromDriver(driver);
    if (fromDriver) return fromDriver;

    const name = String(rider?.driverName || rider?.riderName || '').replace(/\s+/g, '');
    const fromRider = String(rider?.coupangLoginKey || rider?.originalName || '').trim().replace(/\s+/g, '');
    return fromRider || name;
  }

  function makeBaeminDisplayName(driver, rider) {
    return getBaeminUserId(rider, driver) || '-';
  }

  function matchKeyBaemin(value) {
    if (typeof BremWeeklySettlement?.baeminIdMatchKey === 'function') {
      return BremWeeklySettlement.baeminIdMatchKey(value);
    }
    const v = String(value || '').trim().replace(/\s+/g, '');
    if (!v) return '';
    return /^\d+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v.toLowerCase();
  }

  // 엑셀 ID(104…)로 기사 등록 ID(010…)를 찾아낸다.
  function findDriverByBaeminIdLoose(baeminId) {
    const key = matchKeyBaemin(baeminId);
    if (!key) return null;
    const list = BremStorage?.drivers?.getAll?.() || [];
    return list.find(driver => matchKeyBaemin(driver.baeminId) === key) || null;
  }

  // 엑셀에서 0 이 빠진 ID 보다 기사 등록 배민 ID(010…)를 항상 우선한다.
  function getBaeminUserId(rider, driver) {
    const excel = String(rider?.baeminUserId || rider?.baeminId || '').trim();
    let resolved = driver;
    if (!String(resolved?.baeminId || '').trim()) {
      resolved = findDriverByBaeminIdLoose(excel)
        || (rider?.matchedRiderId ? BremStorage.drivers.getById(rider.matchedRiderId) : null);
    }
    if (typeof BremWeeklySettlement?.preferRegisteredBaeminId === 'function') {
      return BremWeeklySettlement.preferRegisteredBaeminId(excel, resolved) || excel || '';
    }
    const registered = String(resolved?.baeminId || '').trim();
    if (registered && excel && matchKeyBaemin(registered) === matchKeyBaemin(excel)) {
      return registered;
    }
    return registered || excel || '';
  }

  function resolveDriverForWeeklyRider(rider, platform) {
    if (normalizePlatform(platform) === 'baemin') {
      return BremWeeklySettlement.resolveBaeminDriver(rider)
        || findDriverByBaeminIdLoose(rider?.baeminUserId);
    }
    const driverId = String(rider?.matchedRiderId || '').trim();
    return driverId ? BremStorage.drivers.getById(driverId) || null : null;
  }

  function enrichBaeminRider(rider, driver) {
    if (!driver) return rider;
    return {
      ...rider,
      matchedRiderId: driver.id,
      driverName: driver.name,
      baeminUserId: getBaeminUserId(rider, driver)
    };
  }

  function formatDriverDisplayName(platform, driver, rider) {
    if (normalizePlatform(platform) === 'coupang') {
      return makeCoupangDisplayName(driver, rider);
    }
    if (normalizePlatform(platform) === 'baemin') {
      return makeBaeminDisplayName(driver, rider);
    }
    return driver?.name || rider?.driverName || rider?.riderName || '';
  }

  function getResultRowBaeminRiderId(row) {
    const driver = (row?.matchedRiderId ? BremStorage.drivers.getById(row.matchedRiderId) : null)
      || findDriverByBaeminIdLoose(row?.baeminUserId);
    return getBaeminUserId(row, driver) || '-';
  }

  function getResultRowMatchedDriverName(row) {
    const driver = row?.matchedRiderId ? BremStorage.drivers.getById(row.matchedRiderId) : null;
    return String(driver?.name || row?.driverName || '').trim();
  }

  function getResultRowDisplayName(row, platform) {
    const driver = row?.matchedRiderId ? BremStorage.drivers.getById(row.matchedRiderId) : null;
    let displayPlatform = normalizePlatform(platform);
    if (displayPlatform === 'combined') {
      const applied = normalizePlatform(row.appliedPlatform || 'coupang');
      displayPlatform = applied === 'combined'
        ? (row.baeminUserId || driver?.baeminId ? 'baemin' : 'coupang')
        : applied;
    }
    if (displayPlatform === 'coupang') {
      return makeCoupangDisplayName(driver, row);
    }
    if (displayPlatform === 'baemin') {
      return makeBaeminDisplayName(driver, row);
    }
    return row?.displayName || row?.driverName || row?.riderName || '';
  }

  function getResultRowErpName(row) {
    return getResultRowMatchedDriverName(row)
      || String(row?.driverName || row?.riderName || '').trim()
      || '-';
  }

  function getResultRowCoupangId(row) {
    const driver = row?.matchedRiderId ? BremStorage.drivers.getById(row.matchedRiderId) : null;
    return makeCoupangLoginIdFromDriver(driver)
      || String(row?.coupangLoginKey || '').trim()
      || '-';
  }

  function getResultRowBaeminId(row) {
    return getResultRowBaeminRiderId(row) || '-';
  }

  function pickPromotionRule(driver, platform, selectedPromotionRuleIds = [], options = {}) {
    const p = normalizePlatform(platform);
    const selected = (selectedPromotionRuleIds || []).filter(Boolean);
    const assignmentMode = options.assignmentMode === 'per_driver' ? 'per_driver' : 'selected_rules';

    if (p === 'combined') {
      if (assignmentMode === 'per_driver') {
        const catalog = window.BremMissionPromotionCatalog;
        if (catalog?.getDriverAssignment) {
          const assigned = catalog.getDriverAssignment(driver);
          if (assigned.combined) {
            const rule = BremStorage.promotionRules.getById(assigned.combined);
            if (rule && rule.enabled !== false && normalizePlatform(rule.platform) === 'combined') return rule;
          }
        }
        const driverRuleId = String(
          driver?.selectedMissionIdCombined
          || driver?.promotionRuleIdCombined
          || driver?.promotionSelectorCombined
          || ''
        ).trim();
        if (driverRuleId) {
          const assigned = BremStorage.promotionRules.getById(driverRuleId);
          if (assigned && assigned.enabled !== false && normalizePlatform(assigned.platform) === 'combined') {
            return assigned;
          }
        }
        return null;
      }
      const combinedIds = selected.filter(id => {
        const rule = BremStorage.promotionRules.getById(id);
        return rule && normalizePlatform(rule.platform) === 'combined';
      });
      if (combinedIds.length === 1) return BremStorage.promotionRules.getById(combinedIds[0]);
      if (combinedIds.length) return BremStorage.promotionRules.getById(combinedIds[0]);
      return null;
    }

    if (assignmentMode === 'selected_rules') {
      const forPlatform = selected.filter(id => {
        const rule = BremStorage.promotionRules.getById(id);
        return rule && normalizePlatform(rule.platform) === p;
      });
      if (forPlatform.length === 1) return BremStorage.promotionRules.getById(forPlatform[0]);
      if (forPlatform.length) return BremStorage.promotionRules.getById(forPlatform[0]);
      return null;
    }

    const driverRuleId = (() => {
      const catalog = window.BremMissionPromotionCatalog;
      if (catalog?.getDriverAssignment) {
        const assigned = catalog.getDriverAssignment(driver);
        const fromMission = p === 'baemin' ? assigned.baemin : assigned.coupang;
        if (fromMission) return fromMission;
      }
      // 미션관리와 동일: selectedMissionId* 우선 (레거시 promotionRuleId* 는 뒤)
      return p === 'baemin'
        ? String(driver?.selectedMissionIdBaemin || driver?.promotionRuleIdBaemin || driver?.promotionSelectorBaemin || driver?.selectedMissionId || '').trim()
        : String(driver?.selectedMissionIdCoupang || driver?.promotionRuleIdCoupang || driver?.promotionSelectorCoupang || driver?.selectedMissionId || '').trim();
    })();

    if (!driverRuleId) return null;

    const assigned = BremStorage.promotionRules.getById(driverRuleId);
    if (!assigned || assigned.enabled === false) return null;
    if (normalizePlatform(assigned.platform) !== p) return null;
    return assigned;
  }

  function getEnabledPromotionRule(ruleId, expectedPlatform) {
    const id = String(ruleId || '').trim();
    if (!id) return null;
    const rule = BremStorage.promotionRules.getById(id);
    if (!rule || rule.enabled === false) return null;
    if (normalizePlatform(rule.platform) !== normalizePlatform(expectedPlatform)) return null;
    return rule;
  }

  /** 합산 탭 · 기사별 미션: 합산 우선, 없으면 쿠팡/배민 개별(또는 둘 다) */
  function resolveCombinedTabDriverPlan(driver, assignment, assignmentMode, selectedRuleIds = []) {
    if (assignmentMode === 'selected_rules') {
      const rule = pickPromotionRule(driver, 'combined', selectedRuleIds, { assignmentMode: 'selected_rules' });
      return rule ? { kind: 'combined', rule } : { kind: 'none' };
    }

    const assigned = window.BremMissionPromotionCatalog?.getDriverAssignment?.(driver) || {};
    const combinedRule = getEnabledPromotionRule(assigned.combined, 'combined');
    if (combinedRule) return { kind: 'combined', rule: combinedRule };

    const hasCoupang = Boolean(assignment?.coupangRider);
    const hasBaemin = Boolean(assignment?.baeminRider);
    const coupangRule = hasCoupang ? getEnabledPromotionRule(assigned.coupang, 'coupang') : null;
    const baeminRule = hasBaemin ? getEnabledPromotionRule(assigned.baemin, 'baemin') : null;

    if (coupangRule && baeminRule) return { kind: 'split', coupangRule, baeminRule };
    if (coupangRule) return { kind: 'coupang', rule: coupangRule };
    if (baeminRule) return { kind: 'baemin', rule: baeminRule };
    return { kind: 'none' };
  }

  function collectResultRuleSummary(results = []) {
    const names = [...new Set(results.map(row => row.ruleName).filter(Boolean))];
    const unassigned = results.filter(row => (row.failureReasons || []).includes('미션 미배정')).length;
    const label = names.length
      ? names.join(', ')
      : (unassigned ? `미션 미배정 ${unassigned}명` : '기사별 미션 배정');
    return { names, label, unassigned };
  }

  function ruleUsesGuarantee(rule) {
    if (!rule) return false;
    const type = rule.type || 'count_per_order';
    return type === 'guaranteed_unit_price' || type === 'both';
  }

  function selectedRulesNeedDeliveryFee(ruleIds = []) {
    return (ruleIds || []).some(id => ruleUsesGuarantee(BremStorage.promotionRules.getById(id)));
  }

  function settlementNeedsDeliveryFee(settlement, platform, selectedRuleIds = [], options = {}) {
    const assignmentMode = options.assignmentMode === 'per_driver' ? 'per_driver' : 'selected_rules';
    if (assignmentMode === 'selected_rules' && selectedRulesNeedDeliveryFee(selectedRuleIds)) return true;
    if (!settlement) return false;
    const p = normalizePlatform(platform);
    const pickOptions = { assignmentMode };
    const ruleIds = assignmentMode === 'per_driver' ? [] : selectedRuleIds;
    return (settlement.riders || []).some(rider => {
      const driver = resolveDriverForWeeklyRider(rider, p);
      if (!driver) return false;
      const rule = pickPromotionRule(driver, p, ruleIds, pickOptions);
      return ruleUsesGuarantee(rule);
    });
  }

  function guaranteeTopUpFromFees(unitPrice, fees, orders, amount) {
    const unit = Number(unitPrice || 0);
    if (unit <= 0) return 0;
    const list = Array.isArray(fees)
      ? fees.map(fee => Number(fee || 0)).filter(fee => Number.isFinite(fee))
      : [];
    if (list.length) {
      return list.reduce((sum, fee) => sum + Math.max(0, unit - fee), 0);
    }
    const orderCount = Number(orders || 0);
    const deliveryAmount = Number(amount || 0);
    if (orderCount <= 0) return 0;
    return Math.max(0, unit * orderCount - deliveryAmount);
  }

  // 기상할증(AC)이 붙은 건은 AH에 500원이 이미 포함되어 있다.
  // 우천적용 시 비교 금액을 AH-500으로 두고 단가보장을 계산한다. (보장액이 500원 오르는 것과 같음)
  const WEATHER_SURCHARGE_WON = 500;

  function adjustBaeminFeesForRain(fees, weatherFlags, rainApply) {
    const list = Array.isArray(fees) ? fees.map(fee => Number(fee || 0)) : [];
    const flags = Array.isArray(weatherFlags) ? weatherFlags : [];
    if (!rainApply) {
      return { fees: list, weatherCount: flags.filter(Boolean).length };
    }
    let weatherCount = 0;
    const adjusted = list.map((fee, i) => {
      if (!flags[i]) return fee;
      weatherCount += 1;
      return Math.max(0, fee - WEATHER_SURCHARGE_WON);
    });
    return { fees: adjusted, weatherCount };
  }

  function combinedSettlementsNeedDeliveryFee(coupangSettlement, baeminSettlement, selectedRuleIds = [], options = {}) {
    // 합산 단가보장은 쿠팡+배민 콜수 합으로 구간을 고르고,
    // 쿠팡·배민 배달처리비에 각각 보장액을 적용한다.
    const assignmentMode = options.assignmentMode === 'per_driver' ? 'per_driver' : 'selected_rules';
    const ruleIds = assignmentMode === 'per_driver' ? [] : selectedRuleIds;
    if (selectedRulesNeedDeliveryFee(ruleIds)) return true;
    if (!coupangSettlement && !baeminSettlement) return false;
    const assignments = buildDriverAssignments(coupangSettlement, baeminSettlement);
    return assignments.some(item => {
      const driver = BremStorage.drivers.getById(item.driverId);
      if (!driver) return false;
      const plan = resolveCombinedTabDriverPlan(driver, item, assignmentMode, ruleIds);
      if (plan.kind === 'combined') return ruleUsesGuarantee(plan.rule);
      if (plan.kind === 'coupang') return ruleUsesGuarantee(plan.rule);
      if (plan.kind === 'baemin') return ruleUsesGuarantee(plan.rule);
      if (plan.kind === 'split') {
        return ruleUsesGuarantee(plan.coupangRule) || ruleUsesGuarantee(plan.baeminRule);
      }
      return false;
    });
  }

  function emptyWeekStats() {
    return { callCount: 0, deliveryAmount: 0, byDay: {}, uploadDays: 0 };
  }

  function mergeDailyOrders(a = {}, b = {}) {
    const out = { ...a };
    Object.entries(b || {}).forEach(([day, count]) => {
      out[day] = Number(out[day] || 0) + Number(count || 0);
    });
    return out;
  }

  function hasValidDeliveryFeeData(feeData) {
    return Boolean(
      feeData
      && Number(feeData.orderCount || 0) > 0
      && Number(feeData.deliveryAmount || 0) > 0
    );
  }

  function resolveBaeminStats(rider, driver, settlement, statsPlatform, deliveryFeeIndex, options = {}) {
    const stats = getWeekStatsForDriver(
      driver.id,
      settlement.startDate,
      settlement.endDate,
      statsPlatform
    );

    const useDeliveryFee = options.useDeliveryFee === true;
    if (statsPlatform !== 'baemin' || !useDeliveryFee || !deliveryFeeIndex) {
      return { stats, feeData: null };
    }

    const feeData = BremBaeminDeliveryFee.lookup(deliveryFeeIndex, rider, driver);
    if (!hasValidDeliveryFeeData(feeData)) {
      return { stats, feeData: feeData || null };
    }

    const callCount = feeData.orderCount;

    return {
      stats: {
        ...stats,
        callCount,
        deliveryAmount: feeData.deliveryAmount
      },
      feeData: {
        ...feeData,
        callCount,
        deliveryFees: Array.isArray(feeData.deliveryFees) ? feeData.deliveryFees : [],
        weatherFlags: Array.isArray(feeData.weatherFlags) ? feeData.weatherFlags : []
      }
    };
  }

  function buildDriverAssignments(coupangSettlement, baeminSettlement) {
    const coupangMap = new Map();
    const baeminMap = new Map();

    (coupangSettlement?.riders || []).forEach(rider => {
      if (rider.matchedRiderId) coupangMap.set(String(rider.matchedRiderId), rider);
    });
    (baeminSettlement?.riders || []).forEach(rider => {
      const driver = resolveDriverForWeeklyRider(rider, 'baemin');
      if (!driver?.id) return;
      baeminMap.set(String(driver.id), enrichBaeminRider(rider, driver));
    });

    const driverIds = new Set([...coupangMap.keys(), ...baeminMap.keys()]);
    return [...driverIds].map(driverId => {
      const coupangRider = coupangMap.get(driverId) || null;
      const baeminRider = baeminMap.get(driverId) || null;
      const hasCoupang = Boolean(coupangRider);
      const hasBaemin = Boolean(baeminRider);
      let assignmentSource = '쿠팡';
      if (hasCoupang && hasBaemin) assignmentSource = '쿠팡+배민';
      else if (hasBaemin) assignmentSource = '배민';
      // 거절율/수락률 조건 판별용. 양쪽이면 거절율(쿠팡) 기준을 유지한다.
      const ratePlatform = hasCoupang ? 'coupang' : 'baemin';
      return {
        driverId,
        coupangRider,
        baeminRider,
        rider: baeminRider || coupangRider,
        ratePlatform,
        appliedPlatform: hasCoupang && hasBaemin ? 'combined' : ratePlatform,
        assignmentSource
      };
    });
  }

  function mergeAppliedConditionNames(result) {
    const names = [
      ...(result?.appliedBlockConditions || []).map(item => item.name),
      ...(result?.appliedBonusConditions || []).map(item => item.name)
    ];
    const seen = new Set();
    return names.filter(name => {
      const key = String(name || '').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function calculateRiderPromotion({
    rider,
    driver,
    appliedPlatform,
    rulePlatform,
    settlement,
    selectedRuleIds,
    promotionSettings,
    assignmentSource = '',
    assignmentMode = 'per_driver',
    deliveryFeeIndex = null,
    requireDeliveryFee = false,
    ignoreMissingRates = false,
    rainApply = false
  }) {
    const statsPlatform = normalizePlatform(appliedPlatform);
    const ruleP = normalizePlatform(rulePlatform);

    if (!driver) {
      return {
        riderName: rider.riderName,
        driverName: rider.driverName || rider.riderName,
        displayName: formatDriverDisplayName(statsPlatform, null, rider),
        coupangLoginKey: rider.coupangLoginKey || '',
        originalName: rider.originalName || '',
        baeminUserId: rider.baeminUserId || '',
        matchedRiderId: rider.matchedRiderId || '',
        appliedPlatform: statsPlatform,
        assignmentSource,
        basePromotionAmount: 0,
        extraPromotionAmount: 0,
        totalPromotionAmount: 0,
        appliedConditions: [],
        failedConditions: [],
        failureReasons: [statsPlatform === 'baemin' ? '배민 User ID 미매칭' : '기사 데이터 없음']
      };
    }

    const ruleMode = assignmentMode === 'selected_rules' ? 'selected_rules' : 'per_driver';
    const rule = pickPromotionRule(driver, ruleP, selectedRuleIds, { assignmentMode: ruleMode });
    const needsDeliveryFee = statsPlatform === 'baemin' && ruleUsesGuarantee(rule);

    if (!rule || !rule.enabled || normalizePlatform(rule.platform) !== ruleP) {
      const assignedId = statsPlatform === 'baemin'
        ? String(driver.selectedMissionIdBaemin || driver.promotionRuleIdBaemin || '').trim()
        : String(driver.selectedMissionIdCoupang || driver.promotionRuleIdCoupang || '').trim();
      const failureReasons = ruleMode === 'selected_rules'
        ? ['선택한 프로모션 조건을 찾을 수 없거나 비활성화되었습니다']
        : [assignedId
          ? '배정된 미션이 비활성화되었거나 플랫폼이 맞지 않습니다'
          : '미션 미배정 (미션 관리에서 기사별 배정)'];
      return {
        riderName: rider.riderName,
        driverName: driver.name,
        displayName: formatDriverDisplayName(statsPlatform, driver, rider),
        coupangLoginKey: rider.coupangLoginKey || makeCoupangLoginIdFromDriver(driver),
        originalName: rider.originalName || '',
        baeminUserId: getBaeminUserId(rider, driver),
        matchedRiderId: driver.id,
        appliedPlatform: statsPlatform,
        assignmentSource,
        basePromotionAmount: 0,
        extraPromotionAmount: 0,
        totalPromotionAmount: 0,
        appliedConditions: [],
        failedConditions: [],
        failureReasons
      };
    }

    // 매칭·조회는 기사 등록 배민 ID(앞 0 포함) 기준으로 통일
    const riderForLookup = driver
      ? { ...rider, baeminUserId: getBaeminUserId(rider, driver) }
      : rider;

    const { stats, feeData } = driver
      ? resolveBaeminStats(riderForLookup, driver, settlement, statsPlatform, deliveryFeeIndex, {
        useDeliveryFee: needsDeliveryFee
      })
      : { stats: { callCount: 0, deliveryAmount: 0, byDay: {}, uploadDays: 0 }, feeData: null };

    if (needsDeliveryFee && !hasValidDeliveryFeeData(feeData)) {
      return {
        riderName: rider.riderName,
        driverName: driver.name,
        displayName: formatDriverDisplayName(statsPlatform, driver, rider),
        coupangLoginKey: rider.coupangLoginKey || '',
        originalName: rider.originalName || '',
        baeminUserId: getBaeminUserId(rider, driver),
        matchedRiderId: driver.id,
        appliedPlatform: statsPlatform,
        assignmentSource,
        callCount: 0,
        deliveryAmountTotal: 0,
        avgDeliveryUnitPrice: 0,
        guaranteedUnitPrice: 0,
        guaranteePromotionAmount: 0,
        basePromotionAmount: 0,
        extraPromotionAmount: 0,
        totalPromotionAmount: 0,
        appliedConditions: [],
        failedConditions: [],
        failureReasons: [feeData
          ? '배달처리비 유효 건 없음 (U·V열 빈칸·AH열 0·배달 미수행)'
          : '배달처리비 정산서에서 User ID를 찾지 못했습니다 (K열·기사 배민 ID 확인)']
      };
    }

    const platformRate = BremStorage.rejections.getRateForWeek(driver.id, settlement.startDate, statsPlatform);
    const rainAdjusted = adjustBaeminFeesForRain(
      feeData?.deliveryFees,
      feeData?.weatherFlags,
      rainApply === true
    );

    const riderData = {
      driverId: driver.id,
      name: driver.name,
      platform: statsPlatform,
      totalOrders: stats.callCount,
      platformRate: platformRate === null || platformRate === undefined ? null : Number(platformRate),
      rateLabel: BremPlatforms.rateLabel(statsPlatform),
      dailyOrders: stats.byDay,
      deliveryAmount: stats.deliveryAmount,
      deliveryFees: rainAdjusted.fees,
      selectedPromotionRuleId: rule.id,
      selectedPromotionName: rule.name,
      uploadDays: stats.uploadDays,
      weekStart: settlement.startDate,
      weekEnd: settlement.endDate,
      ignoreMissingRates: ignoreMissingRates === true
    };

    const result = BremPromotionEngine.calculatePromotionForRider(rule, riderData, promotionSettings);

    const guaranteePromotionAmount = Number(result.guaranteeBonus || 0);

    return {
      riderName: rider.riderName,
      driverName: driver.name,
      displayName: formatDriverDisplayName(statsPlatform, driver, rider),
      coupangLoginKey: rider.coupangLoginKey || '',
      originalName: rider.originalName || '',
      baeminUserId: getBaeminUserId(rider, driver),
      matchedRiderId: driver.id,
      appliedPlatform: statsPlatform,
      assignmentSource,
      callCount: stats.callCount,
      platformRate: riderData.platformRate,
      deliveryAmountTotal: Number(feeData?.deliveryAmount ?? stats.deliveryAmount ?? 0),
      avgDeliveryUnitPrice: Number(feeData?.avgUnitPrice || 0),
      guaranteedUnitPrice: Number(result.appliedUnitPrice || 0),
      guaranteePromotionAmount,
      ruleId: rule.id,
      ruleName: rule.name,
      basePromotionAmount: Number(result.basePay || result.perCallBonus || 0),
      extraPromotionAmount: Number(result.bonusPay || 0),
      totalPromotionAmount: Number(result.totalBonus || 0),
      appliedConditions: mergeAppliedConditionNames(result),
      failedConditions: (result.failedBonusConditions || []).map(item => item.name || item.reason),
      failureReasons: result.failureReasons || []
    };
  }

  function applyPromotionToSettlement(settlement, selectedPromotionRuleIds = [], settings, options = {}) {
    if (!settlement) throw new Error('저장된 주간정산을 선택하세요.');

    const platform = normalizePlatform(settlement.platform);
    const promotionSettings = settings || BremStorage.promotionSettings.get();
    const selected = (selectedPromotionRuleIds || []).filter(Boolean);
    const assignmentMode = options.assignmentMode === 'per_driver' ? 'per_driver' : 'selected_rules';
    const pickOptions = { assignmentMode };

    if (assignmentMode === 'selected_rules' && !selected.length) {
      throw new Error('적용할 프로모션 조건을 선택하세요.');
    }

    const deliveryFeeIndex = options.deliveryFeeIndex || null;
    const feeRuleIds = assignmentMode === 'per_driver' ? [] : selected;
    const requireDeliveryFee = options.requireDeliveryFee === true
      || settlementNeedsDeliveryFee(settlement, platform, feeRuleIds, pickOptions);

    if (requireDeliveryFee && !deliveryFeeIndex) {
      throw new Error('단가보장 프로모션은 배달처리비 정산서 업로드가 필요합니다.');
    }

    const calcRuleIds = assignmentMode === 'per_driver' ? [] : selected;
    const results = (settlement.riders || []).map(rider => {
      const driver = resolveDriverForWeeklyRider(rider, platform);
      const riderForCalc = platform === 'baemin' && driver
        ? enrichBaeminRider(rider, driver)
        : rider;
      return calculateRiderPromotion({
        rider: riderForCalc,
        driver,
        appliedPlatform: platform,
        rulePlatform: platform,
        settlement,
        selectedRuleIds: calcRuleIds,
        promotionSettings,
        assignmentMode,
        deliveryFeeIndex: platform === 'baemin' ? deliveryFeeIndex : null,
        requireDeliveryFee,
        ignoreMissingRates: options.ignoreMissingRates === true,
        rainApply: options.rainApply === true
      });
    });

    const totalPromotionAmount = results.reduce((sum, item) => sum + item.totalPromotionAmount, 0);
    const ruleSummary = collectResultRuleSummary(results);
    const selectedRuleNames = selected
      .map(id => BremStorage.promotionRules.getById(id)?.name)
      .filter(Boolean);

    return {
      settlementId: settlement.id,
      settlementLabel: `${settlement.region} · ${settlement.matchedNamesLabel || ''}`,
      // 어느 채널 정산서로 계산했는지 남긴다. 프로모션정산등록에서 브로/직계약을
      // 구분해 보여줘야 엉뚱한 채널 결과를 적용하는 실수를 막을 수 있다.
      channel: normalizeChannel(options.channel || settlement.channel),
      platform,
      region: settlement.region,
      startDate: settlement.startDate,
      endDate: settlement.endDate,
      assignmentMode,
      selectedPromotionRuleIds: assignmentMode === 'selected_rules'
        ? selected
        : [...new Set(results.map(row => row.ruleId).filter(Boolean))],
      selectedPromotionRuleNames: assignmentMode === 'selected_rules'
        ? selectedRuleNames
        : ruleSummary.names,
      appliedRuleLabel: assignmentMode === 'selected_rules'
        ? (selectedRuleNames.join(', ') || '-')
        : ruleSummary.label,
      unassignedRiderCount: assignmentMode === 'selected_rules' ? 0 : ruleSummary.unassigned,
      deliveryFeeFileName: options.deliveryFeeMeta?.fileName || '',
      deliveryFeeLabel: options.deliveryFeeMeta
        ? BremBaeminDeliveryFee.formatMetaLabel(options.deliveryFeeMeta)
        : '',
      rainApply: options.rainApply === true,
      results,
      summary: {
        riderCount: results.length,
        totalPromotionAmount
      }
    };
  }

  /** 합산 결과를 정산서에 붙일 때: 1순위 배민, 2순위 쿠팡(배민-only·쿠팡-only·양쪽 겹침 규칙) */
  function assignCombinedAttachAmounts(row = {}) {
    const total = Number(row.totalPromotionAmount || 0);
    if (row.baeminAttachAmount != null && row.coupangAttachAmount != null) {
      return {
        ...row,
        baeminAttachAmount: Number(row.baeminAttachAmount || 0),
        coupangAttachAmount: Number(row.coupangAttachAmount || 0)
      };
    }

    const source = String(row.assignmentSource || '').trim();
    let baeminAttachAmount = 0;
    let coupangAttachAmount = 0;
    if (source === '배민') {
      baeminAttachAmount = total;
    } else if (source === '쿠팡') {
      coupangAttachAmount = total;
    } else if (source === '쿠팡+배민') {
      baeminAttachAmount = total;
    } else {
      const applied = normalizePlatform(row.appliedPlatform || '');
      if (applied === 'coupang') coupangAttachAmount = total;
      else baeminAttachAmount = total;
    }
    return { ...row, baeminAttachAmount, coupangAttachAmount };
  }

  function resolveCombinedRowAttachAmount(row, settlementPlatform) {
    const attach = assignCombinedAttachAmounts(row);
    return normalizePlatform(settlementPlatform) === 'coupang'
      ? Number(attach.coupangAttachAmount || 0)
      : Number(attach.baeminAttachAmount || 0);
  }

  function mergeCombinedDriverResults(rows, context = {}) {
    const parts = (Array.isArray(rows) ? rows : []).filter(Boolean);
    if (!parts.length) return null;
    if (parts.length === 1) return assignCombinedAttachAmounts(parts[0]);

    const { driver, assignment, displayRider, ratePlatform } = context;
    const totalPromotionAmount = parts.reduce((sum, row) => sum + Number(row.totalPromotionAmount || 0), 0);
    const baeminAttachAmount = parts.reduce((sum, row) => (
      normalizePlatform(row.appliedPlatform) === 'baemin'
        ? sum + Number(row.totalPromotionAmount || 0)
        : sum
    ), 0);
    const coupangAttachAmount = parts.reduce((sum, row) => (
      normalizePlatform(row.appliedPlatform) === 'coupang'
        ? sum + Number(row.totalPromotionAmount || 0)
        : sum
    ), 0);
    const failureReasons = totalPromotionAmount > 0
      ? []
      : [...new Set(parts.flatMap(row => row.failureReasons || []).filter(Boolean))];

    return {
      riderName: displayRider?.riderName || driver?.name || parts[0].riderName,
      driverName: driver?.name || parts[0].driverName,
      displayName: parts[0].displayName,
      coupangLoginKey: parts[0].coupangLoginKey,
      originalName: parts[0].originalName,
      baeminUserId: parts[0].baeminUserId,
      matchedRiderId: driver?.id || parts[0].matchedRiderId,
      appliedPlatform: assignment?.appliedPlatform || 'combined',
      assignmentSource: assignment?.assignmentSource || parts[0].assignmentSource,
      callCount: parts.reduce((sum, row) => sum + Number(row.callCount || 0), 0),
      coupangCallCount: parts.reduce((sum, row) => sum + Number(
        row.coupangCallCount ?? (normalizePlatform(row.appliedPlatform) === 'coupang' ? row.callCount : 0)
      ), 0),
      baeminCallCount: parts.reduce((sum, row) => sum + Number(
        row.baeminCallCount ?? (normalizePlatform(row.appliedPlatform) === 'baemin' ? row.callCount : 0)
      ), 0),
      platformRate: parts.find(row => row.platformRate != null)?.platformRate ?? null,
      deliveryAmountTotal: parts.reduce((sum, row) => sum + Number(row.deliveryAmountTotal || 0), 0),
      avgDeliveryUnitPrice: 0,
      guaranteedUnitPrice: 0,
      guaranteePromotionAmount: parts.reduce((sum, row) => sum + Number(row.guaranteePromotionAmount || 0), 0),
      coupangGuaranteeAmount: parts.reduce((sum, row) => sum + Number(row.coupangGuaranteeAmount || 0), 0),
      baeminGuaranteeAmount: parts.reduce((sum, row) => sum + Number(row.baeminGuaranteeAmount || 0), 0),
      ruleId: parts.map(row => row.ruleId).filter(Boolean).join('+'),
      ruleName: parts.map(row => row.ruleName).filter(Boolean).join(' + '),
      basePromotionAmount: parts.reduce((sum, row) => sum + Number(row.basePromotionAmount || 0), 0),
      extraPromotionAmount: parts.reduce((sum, row) => sum + Number(row.extraPromotionAmount || 0), 0),
      totalPromotionAmount,
      appliedConditions: [...new Set(parts.flatMap(row => row.appliedConditions || []))],
      failedConditions: [...new Set(parts.flatMap(row => row.failedConditions || []))],
      failureReasons,
      baeminAttachAmount,
      coupangAttachAmount
    };
  }

  function calculateCoupangPortionInCombined({
    rule,
    assignment,
    driver,
    coupangSettlement,
    promotionSettings,
    coupangDeliveryFeeIndex = null,
    ignoreMissingRates = false,
    rainApply = false
  }) {
    const rider = assignment.coupangRider;
    const displayRider = rider || assignment.rider;

    if (!ruleUsesGuarantee(rule)) {
      return calculateRiderPromotion({
        rider,
        driver,
        appliedPlatform: 'coupang',
        rulePlatform: 'coupang',
        settlement: coupangSettlement,
        selectedRuleIds: [rule.id],
        promotionSettings,
        assignmentSource: assignment.assignmentSource,
        assignmentMode: 'selected_rules',
        ignoreMissingRates
      });
    }

    let stats = getWeekStatsForDriver(
      driver.id,
      coupangSettlement.startDate,
      coupangSettlement.endDate,
      'coupang'
    );
    const coupangRiderForLookup = {
      ...(rider || {}),
      coupangLoginKey: rider?.coupangLoginKey || makeCoupangLoginIdFromDriver(driver)
    };
    let feeData = null;
    if (coupangDeliveryFeeIndex && typeof BremCoupangDeliveryFee?.lookup === 'function') {
      feeData = BremCoupangDeliveryFee.lookup(coupangDeliveryFeeIndex, coupangRiderForLookup, driver);
      if (hasValidDeliveryFeeData(feeData)) {
        stats = {
          ...stats,
          callCount: Number(feeData.orderCount || 0),
          deliveryAmount: Number(feeData.deliveryAmount || 0),
          uploadDays: Math.max(Number(stats.uploadDays || 0), 1)
        };
      }
    }

    if (!hasValidDeliveryFeeData(feeData)) {
      return {
        riderName: displayRider?.riderName || driver.name,
        driverName: driver.name,
        displayName: formatDriverDisplayName('coupang', driver, displayRider),
        coupangLoginKey: coupangRiderForLookup.coupangLoginKey,
        originalName: displayRider?.originalName || '',
        baeminUserId: '',
        matchedRiderId: driver.id,
        appliedPlatform: 'coupang',
        assignmentSource: assignment.assignmentSource,
        callCount: 0,
        coupangCallCount: 0,
        baeminCallCount: 0,
        basePromotionAmount: 0,
        extraPromotionAmount: 0,
        totalPromotionAmount: 0,
        appliedConditions: [],
        failedConditions: [],
        failureReasons: [feeData
          ? '쿠팡 배달처리비 유효 건 없음 (Y열 정산금액 0)'
          : '쿠팡 배달처리비에서 이름(B열)·쿠팡ID 매칭 실패']
      };
    }

    const fees = Array.isArray(feeData.deliveryFees) ? feeData.deliveryFees : [];
    const platformRate = BremStorage.rejections.getRateForWeek(driver.id, coupangSettlement.startDate, 'coupang');
    const riderData = {
      driverId: driver.id,
      name: driver.name,
      platform: 'coupang',
      totalOrders: stats.callCount,
      platformRate: platformRate === null || platformRate === undefined ? null : Number(platformRate),
      rateLabel: BremPlatforms.rateLabel('coupang'),
      dailyOrders: stats.byDay,
      deliveryAmount: stats.deliveryAmount,
      deliveryFees: fees,
      selectedPromotionRuleId: rule.id,
      selectedPromotionName: rule.name,
      uploadDays: stats.uploadDays,
      weekStart: coupangSettlement.startDate,
      weekEnd: coupangSettlement.endDate,
      ignoreMissingRates: ignoreMissingRates === true
    };
    const result = BremPromotionEngine.calculatePromotionForRider(rule, riderData, promotionSettings);
    const guaranteedUnitPrice = Number(result.appliedUnitPrice || 0);
    const guaranteePromotionAmount = guaranteeTopUpFromFees(
      guaranteedUnitPrice,
      fees,
      stats.callCount,
      stats.deliveryAmount
    );
    const engineGuarantee = Number(result.guaranteeBonus || 0);
    const engineTotal = Number(result.totalBonus || 0);
    const totalPromotionAmount = Math.max(0, engineTotal - engineGuarantee + guaranteePromotionAmount);

    return {
      riderName: displayRider?.riderName || driver.name,
      driverName: driver.name,
      displayName: formatDriverDisplayName('coupang', driver, displayRider),
      coupangLoginKey: coupangRiderForLookup.coupangLoginKey,
      originalName: displayRider?.originalName || '',
      baeminUserId: '',
      matchedRiderId: driver.id,
      appliedPlatform: 'coupang',
      assignmentSource: assignment.assignmentSource,
      callCount: stats.callCount,
      coupangCallCount: stats.callCount,
      baeminCallCount: 0,
      platformRate: riderData.platformRate,
      deliveryAmountTotal: stats.deliveryAmount,
      avgDeliveryUnitPrice: stats.callCount > 0 ? Math.round(stats.deliveryAmount / stats.callCount) : 0,
      guaranteedUnitPrice,
      guaranteePromotionAmount,
      coupangGuaranteeAmount: guaranteePromotionAmount,
      baeminGuaranteeAmount: 0,
      ruleId: rule.id,
      ruleName: rule.name,
      basePromotionAmount: Number(result.basePay || result.perCallBonus || 0),
      extraPromotionAmount: Number(result.bonusPay || 0),
      totalPromotionAmount,
      appliedConditions: mergeAppliedConditionNames(result),
      failedConditions: (result.failedBonusConditions || []).map(item => item.name || item.reason),
      failureReasons: result.failureReasons || []
    };
  }

  function calculateCombinedRiderPromotion({
    assignment,
    driver,
    coupangSettlement,
    baeminSettlement,
    selectedRuleIds,
    promotionSettings,
    deliveryFeeIndex = null,
    coupangDeliveryFeeIndex = null,
    ignoreMissingRates = false,
    rainApply = false,
    assignmentMode = 'selected_rules'
  }) {
    const ratePlatform = normalizePlatform(assignment.ratePlatform || 'coupang');
    const displayRider = assignment.baeminRider || assignment.coupangRider || assignment.rider;

    if (!driver) {
      return {
        riderName: displayRider?.riderName || '',
        driverName: displayRider?.driverName || displayRider?.riderName || '',
        displayName: formatDriverDisplayName(ratePlatform, null, displayRider),
        coupangLoginKey: displayRider?.coupangLoginKey || '',
        originalName: displayRider?.originalName || '',
        baeminUserId: displayRider?.baeminUserId || '',
        matchedRiderId: '',
        appliedPlatform: assignment.appliedPlatform || ratePlatform,
        assignmentSource: assignment.assignmentSource || '',
        basePromotionAmount: 0,
        extraPromotionAmount: 0,
        totalPromotionAmount: 0,
        appliedConditions: [],
        failedConditions: [],
        failureReasons: [ratePlatform === 'baemin' ? '배민 User ID 미매칭' : '기사 데이터 없음']
      };
    }

    const ruleMode = assignmentMode === 'selected_rules' ? 'selected_rules' : 'per_driver';
    const plan = resolveCombinedTabDriverPlan(driver, assignment, ruleMode, selectedRuleIds);

    if (plan.kind === 'baemin') {
      const baeminRider = assignment.baeminRider || displayRider;
      return calculateRiderPromotion({
        rider: baeminRider,
        driver,
        appliedPlatform: 'baemin',
        rulePlatform: 'baemin',
        settlement: baeminSettlement,
        selectedRuleIds: [plan.rule.id],
        promotionSettings,
        assignmentSource: assignment.assignmentSource,
        assignmentMode: 'selected_rules',
        deliveryFeeIndex,
        ignoreMissingRates,
        rainApply
      });
    }

    if (plan.kind === 'coupang') {
      return calculateCoupangPortionInCombined({
        rule: plan.rule,
        assignment,
        driver,
        coupangSettlement,
        promotionSettings,
        coupangDeliveryFeeIndex,
        ignoreMissingRates,
        rainApply
      });
    }

    if (plan.kind === 'split') {
      return mergeCombinedDriverResults([
        calculateCoupangPortionInCombined({
          rule: plan.coupangRule,
          assignment,
          driver,
          coupangSettlement,
          promotionSettings,
          coupangDeliveryFeeIndex,
          ignoreMissingRates,
          rainApply
        }),
        calculateRiderPromotion({
          rider: assignment.baeminRider || displayRider,
          driver,
          appliedPlatform: 'baemin',
          rulePlatform: 'baemin',
          settlement: baeminSettlement,
          selectedRuleIds: [plan.baeminRule.id],
          promotionSettings,
          assignmentSource: assignment.assignmentSource,
          assignmentMode: 'selected_rules',
          deliveryFeeIndex,
          ignoreMissingRates,
          rainApply
        })
      ], { driver, assignment, displayRider, ratePlatform });
    }

    if (plan.kind === 'none') {
      const assigned = window.BremMissionPromotionCatalog?.getDriverAssignment?.(driver) || {};
      const hasAnyMission = assigned.combined || assigned.coupang || assigned.baemin;
      const failureReasons = ruleMode === 'selected_rules'
        ? ['선택한 프로모션 조건을 찾을 수 없거나 비활성화되었습니다']
        : [hasAnyMission
          ? '배정된 미션이 비활성화되었거나 플랫폼이 맞지 않습니다'
          : '미션 미배정 (미션 관리에서 합산·쿠팡·배민 미션 배정)'];
      return {
        riderName: displayRider?.riderName || driver.name,
        driverName: driver.name,
        displayName: formatDriverDisplayName(ratePlatform, driver, displayRider),
        coupangLoginKey: displayRider?.coupangLoginKey || makeCoupangLoginIdFromDriver(driver),
        originalName: displayRider?.originalName || '',
        baeminUserId: getBaeminUserId(displayRider, driver),
        matchedRiderId: driver.id,
        appliedPlatform: assignment.appliedPlatform || ratePlatform,
        assignmentSource: assignment.assignmentSource || '',
        basePromotionAmount: 0,
        extraPromotionAmount: 0,
        totalPromotionAmount: 0,
        appliedConditions: [],
        failedConditions: [],
        failureReasons
      };
    }

    const rule = plan.rule;

    const needsDeliveryFee = ruleUsesGuarantee(rule);
    let coupangStats = assignment.coupangRider && coupangSettlement
      ? getWeekStatsForDriver(driver.id, coupangSettlement.startDate, coupangSettlement.endDate, 'coupang')
      : emptyWeekStats();
    let baeminStats = assignment.baeminRider && baeminSettlement
      ? getWeekStatsForDriver(driver.id, baeminSettlement.startDate, baeminSettlement.endDate, 'baemin')
      : emptyWeekStats();

    const coupangRiderForLookup = {
      ...(assignment.coupangRider || {}),
      coupangLoginKey: assignment.coupangRider?.coupangLoginKey
        || makeCoupangLoginIdFromDriver(driver)
    };
    const baeminRiderForLookup = {
      ...(assignment.baeminRider || displayRider || {}),
      baeminUserId: getBaeminUserId(assignment.baeminRider || displayRider, driver)
    };

    let coupangFeeData = null;
    let baeminFeeData = null;

    if (needsDeliveryFee && coupangDeliveryFeeIndex && typeof BremCoupangDeliveryFee?.lookup === 'function') {
      coupangFeeData = BremCoupangDeliveryFee.lookup(
        coupangDeliveryFeeIndex,
        coupangRiderForLookup,
        driver
      );
      if (hasValidDeliveryFeeData(coupangFeeData)) {
        coupangStats = {
          ...coupangStats,
          callCount: Number(coupangFeeData.orderCount || 0),
          deliveryAmount: Number(coupangFeeData.deliveryAmount || 0),
          uploadDays: Math.max(Number(coupangStats.uploadDays || 0), 1)
        };
      }
    }

    if (needsDeliveryFee && deliveryFeeIndex) {
      baeminFeeData = BremBaeminDeliveryFee.lookup(
        deliveryFeeIndex,
        baeminRiderForLookup,
        driver
      );
      if (hasValidDeliveryFeeData(baeminFeeData)) {
        baeminStats = {
          ...baeminStats,
          callCount: Number(baeminFeeData.orderCount || 0),
          deliveryAmount: Number(baeminFeeData.deliveryAmount || 0),
          uploadDays: Math.max(Number(baeminStats.uploadDays || 0), 1)
        };
      }
    }

    const hasCoupangFee = hasValidDeliveryFeeData(coupangFeeData);
    const hasBaeminFee = hasValidDeliveryFeeData(baeminFeeData);

    if (needsDeliveryFee && !hasCoupangFee && !hasBaeminFee) {
      const reasons = [];
      if (assignment.coupangRider) {
        reasons.push(coupangFeeData
          ? '쿠팡 배달처리비 유효 건 없음 (Y열 정산금액 0)'
          : '쿠팡 배달처리비에서 이름(B열)·쿠팡ID 매칭 실패');
      }
      if (assignment.baeminRider) {
        reasons.push(baeminFeeData
          ? '배민 배달처리비 유효 건 없음 (U·V열 빈칸·AH열 0)'
          : '배민 배달처리비에서 User ID(K열) 매칭 실패');
      }
      if (!reasons.length) {
        reasons.push('배달처리비 정산서에서 해당 기사를 찾지 못했습니다');
      }
      return {
        riderName: displayRider?.riderName || driver.name,
        driverName: driver.name,
        displayName: formatDriverDisplayName(ratePlatform, driver, displayRider),
        coupangLoginKey: displayRider?.coupangLoginKey || makeCoupangLoginIdFromDriver(driver),
        originalName: displayRider?.originalName || '',
        baeminUserId: getBaeminUserId(displayRider, driver),
        matchedRiderId: driver.id,
        appliedPlatform: assignment.appliedPlatform || ratePlatform,
        assignmentSource: assignment.assignmentSource || '',
        callCount: 0,
        coupangCallCount: Number(coupangStats.callCount || 0),
        baeminCallCount: Number(baeminStats.callCount || 0),
        deliveryAmountTotal: 0,
        avgDeliveryUnitPrice: 0,
        guaranteedUnitPrice: 0,
        guaranteePromotionAmount: 0,
        coupangGuaranteeAmount: 0,
        baeminGuaranteeAmount: 0,
        basePromotionAmount: 0,
        extraPromotionAmount: 0,
        totalPromotionAmount: 0,
        appliedConditions: [],
        failedConditions: [],
        failureReasons: reasons
      };
    }

    const coupangCallCount = Number(coupangStats.callCount || 0);
    const baeminCallCount = Number(baeminStats.callCount || 0);
    // 단가보장 구간·건당 지급 모두 쿠팡+배민 합산 콜수로 적용한다.
    const totalOrders = coupangCallCount + baeminCallCount;
    const weekStart = coupangSettlement?.startDate || baeminSettlement?.startDate || '';
    const weekEnd = coupangSettlement?.endDate || baeminSettlement?.endDate || '';
    const platformRate = BremStorage.rejections.getRateForWeek(driver.id, weekStart, ratePlatform);

    const coupangFees = hasCoupangFee && Array.isArray(coupangFeeData.deliveryFees)
      ? coupangFeeData.deliveryFees
      : [];
    const baeminFeesRaw = hasBaeminFee && Array.isArray(baeminFeeData.deliveryFees)
      ? baeminFeeData.deliveryFees
      : [];
    const baeminRain = adjustBaeminFeesForRain(
      baeminFeesRaw,
      baeminFeeData?.weatherFlags,
      rainApply === true
    );
    const baeminFees = baeminRain.fees;
    const coupangDeliveryAmount = hasCoupangFee
      ? Number(coupangFeeData.deliveryAmount || 0)
      : 0;
    const baeminDeliveryAmount = hasBaeminFee
      ? Number(baeminFeeData.deliveryAmount || 0)
      : 0;
    const deliveryAmountTotal = coupangDeliveryAmount + baeminDeliveryAmount;

    const riderData = {
      driverId: driver.id,
      name: driver.name,
      platform: ratePlatform,
      totalOrders,
      platformRate: platformRate === null || platformRate === undefined ? null : Number(platformRate),
      rateLabel: BremPlatforms.rateLabel(ratePlatform),
      dailyOrders: mergeDailyOrders(coupangStats.byDay, baeminStats.byDay),
      deliveryAmount: deliveryAmountTotal,
      deliveryFees: [...coupangFees, ...baeminFees],
      selectedPromotionRuleId: rule.id,
      selectedPromotionName: rule.name,
      uploadDays: Math.max(Number(coupangStats.uploadDays || 0), Number(baeminStats.uploadDays || 0)),
      weekStart,
      weekEnd,
      ignoreMissingRates: ignoreMissingRates === true
    };

    const result = BremPromotionEngine.calculatePromotionForRider(rule, riderData, promotionSettings);
    const guaranteedUnitPrice = Number(result.appliedUnitPrice || 0);
    const coupangGuaranteeAmount = guaranteeTopUpFromFees(
      guaranteedUnitPrice,
      coupangFees,
      hasCoupangFee ? coupangCallCount : 0,
      coupangDeliveryAmount
    );
    const baeminGuaranteeAmount = guaranteeTopUpFromFees(
      guaranteedUnitPrice,
      baeminFees,
      hasBaeminFee ? baeminCallCount : 0,
      baeminDeliveryAmount
    );
    const guaranteePromotionAmount = coupangGuaranteeAmount + baeminGuaranteeAmount;
    // 엔진 합산과 분리 합이 다르면(둘 다 없는 경우 등) 엔진 값을 우선하되, 분리 적용이 있으면 그 합을 쓴다.
    const engineGuarantee = Number(result.guaranteeBonus || 0);
    const finalGuarantee = (coupangFees.length || baeminFees.length)
      ? guaranteePromotionAmount
      : engineGuarantee;
    const avgDeliveryUnitPrice = totalOrders > 0
      ? Math.round(deliveryAmountTotal / totalOrders)
      : 0;

    // 엔진 totalBonus 에서 엔진 보장액을 빼고 분리 보장액으로 교체
    const engineTotal = Number(result.totalBonus || 0);
    const basePromotionAmount = Number(result.basePay || result.perCallBonus || 0);
    const extraPromotionAmount = Number(result.bonusPay || 0);
    const totalPromotionAmount = Math.max(0, engineTotal - engineGuarantee + finalGuarantee);

    return {
      riderName: displayRider?.riderName || driver.name,
      driverName: driver.name,
      displayName: formatDriverDisplayName(ratePlatform, driver, displayRider),
      coupangLoginKey: displayRider?.coupangLoginKey || makeCoupangLoginIdFromDriver(driver),
      originalName: displayRider?.originalName || '',
      baeminUserId: getBaeminUserId(displayRider, driver),
      matchedRiderId: driver.id,
      appliedPlatform: assignment.appliedPlatform || ratePlatform,
      assignmentSource: assignment.assignmentSource || '',
      callCount: totalOrders,
      coupangCallCount,
      baeminCallCount,
      platformRate: riderData.platformRate,
      deliveryAmountTotal,
      avgDeliveryUnitPrice,
      guaranteedUnitPrice,
      guaranteePromotionAmount: finalGuarantee,
      coupangGuaranteeAmount,
      baeminGuaranteeAmount,
      ruleId: rule.id,
      ruleName: rule.name,
      basePromotionAmount,
      extraPromotionAmount,
      totalPromotionAmount,
      appliedConditions: mergeAppliedConditionNames(result),
      failedConditions: (result.failedBonusConditions || []).map(item => item.name || item.reason),
      failureReasons: result.failureReasons || []
    };
  }

  function applyPromotionToCombinedSettlements(
    coupangSettlement,
    baeminSettlement,
    selectedPromotionRuleIds = [],
    settings,
    options = {}
  ) {
    if (!coupangSettlement) throw new Error('저장된 쿠팡 주정산서를 선택하세요.');
    if (!baeminSettlement) throw new Error('저장된 배민 주정산서를 선택하세요.');

    const promotionSettings = settings || BremStorage.promotionSettings.get();
    const assignmentMode = options.assignmentMode === 'per_driver' ? 'per_driver' : 'selected_rules';
    const selected = assignmentMode === 'per_driver'
      ? []
      : (selectedPromotionRuleIds || []).filter(Boolean);
    if (assignmentMode === 'selected_rules' && !selected.length) {
      throw new Error('적용할 합산 프로모션 조건을 선택하세요.');
    }

    const assignments = buildDriverAssignments(coupangSettlement, baeminSettlement);
    if (!assignments.length) throw new Error('매칭된 기사가 없습니다.');

    const deliveryFeeIndex = options.deliveryFeeIndex || null;
    const coupangDeliveryFeeIndex = options.coupangDeliveryFeeIndex || null;
    const requireDeliveryFee = options.requireDeliveryFee === true
      || combinedSettlementsNeedDeliveryFee(coupangSettlement, baeminSettlement, selected, { assignmentMode });

    if (requireDeliveryFee && !deliveryFeeIndex) {
      throw new Error('단가보장 프로모션은 배민 배달처리비 정산서 업로드가 필요합니다.');
    }
    if (requireDeliveryFee && !coupangDeliveryFeeIndex) {
      throw new Error('단가보장 프로모션은 쿠팡 배달처리비 정산서 업로드가 필요합니다.');
    }

    const results = assignments.map(item => {
      const driver = BremStorage.drivers.getById(item.driverId);
      return assignCombinedAttachAmounts(calculateCombinedRiderPromotion({
        assignment: item,
        driver,
        coupangSettlement,
        baeminSettlement,
        selectedRuleIds: selected,
        promotionSettings,
        deliveryFeeIndex,
        coupangDeliveryFeeIndex,
        ignoreMissingRates: options.ignoreMissingRates === true,
        rainApply: options.rainApply === true,
        assignmentMode
      }));
    });

    const totalPromotionAmount = results.reduce((sum, item) => sum + item.totalPromotionAmount, 0);
    const baeminAttachTotal = results.reduce((sum, item) => sum + Number(item.baeminAttachAmount || 0), 0);
    const coupangAttachTotal = results.reduce((sum, item) => sum + Number(item.coupangAttachAmount || 0), 0);
    const startDate = [coupangSettlement.startDate, baeminSettlement.startDate].filter(Boolean).sort()[0] || '';
    const endDate = [coupangSettlement.endDate, baeminSettlement.endDate].filter(Boolean).sort().slice(-1)[0] || '';

    const baeminLabel = options.deliveryFeeMeta && typeof BremBaeminDeliveryFee?.formatMetaLabel === 'function'
      ? BremBaeminDeliveryFee.formatMetaLabel(options.deliveryFeeMeta)
      : '';
    const coupangLabel = options.coupangDeliveryFeeMeta && typeof BremCoupangDeliveryFee?.formatMetaLabel === 'function'
      ? BremCoupangDeliveryFee.formatMetaLabel(options.coupangDeliveryFeeMeta)
      : '';
    const feeLabels = [coupangLabel, baeminLabel].filter(Boolean);
    const feeFiles = [
      options.coupangDeliveryFeeMeta?.fileName,
      options.deliveryFeeMeta?.fileName
    ].filter(Boolean);

    return {
      settlementId: `${coupangSettlement.id}|${baeminSettlement.id}`,
      coupangSettlementId: coupangSettlement.id,
      baeminSettlementId: baeminSettlement.id,
      settlementLabel: `쿠팡 ${coupangSettlement.region || '-'} + 배민 ${baeminSettlement.region || '-'}`,
      channel: normalizeChannel(options.channel || coupangSettlement.channel),
      platform: 'combined',
      region: `${coupangSettlement.region || ''} / ${baeminSettlement.region || ''}`.trim(),
      startDate,
      endDate,
      assignmentMode,
      selectedPromotionRuleIds: selected,
      selectedPromotionRuleNames: assignmentMode === 'per_driver'
        ? collectResultRuleSummary(results).names
        : selected.map(id => BremStorage.promotionRules.getById(id)?.name || id).filter(Boolean),
      appliedRuleLabel: assignmentMode === 'per_driver' ? collectResultRuleSummary(results).label : '',
      unassignedRiderCount: assignmentMode === 'per_driver' ? collectResultRuleSummary(results).unassigned : 0,
      deliveryFeeFileName: feeFiles.join(' / '),
      deliveryFeeLabel: feeLabels.join(' / '),
      rainApply: options.rainApply === true,
      results,
      summary: {
        riderCount: results.length,
        totalPromotionAmount,
        baeminAttachTotal,
        coupangAttachTotal,
        coupangAssigned: results.filter(item => item.assignmentSource === '쿠팡').length,
        baeminAssigned: results.filter(item => item.assignmentSource === '배민').length,
        overlapAssigned: results.filter(item => item.assignmentSource === '쿠팡+배민').length
      }
    };
  }

  function dateKeyLocal(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function todayLocal() {
    return dateKeyLocal(new Date());
  }

  function parseLocalDate(value) {
    const raw = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const date = new Date(`${raw}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function weekStartKey(dateValue = todayLocal()) {
    if (window.BremDatePicker?.weekStartKey) return BremDatePicker.weekStartKey(dateValue);
    const date = parseLocalDate(dateValue) || parseLocalDate(todayLocal());
    if (!date) return todayLocal();
    const day = date.getDay();
    const diff = (day - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return dateKeyLocal(date);
  }

  function applyWeekWednesday(dateValue) {
    if (window.BremDatePicker?.applyWeekWednesday) return BremDatePicker.applyWeekWednesday(dateValue);
    const date = parseLocalDate(dateValue);
    if (!date) return weekStartKey(dateValue);
    if (date.getDay() === 3) return dateKeyLocal(date);
    if (date.getDay() === 2) {
      date.setDate(date.getDate() + 1);
      return dateKeyLocal(date);
    }
    return weekStartKey(dateValue);
  }

  function weekEndKey(weekStart) {
    if (window.BremDatePicker?.weekEndKey) return BremDatePicker.weekEndKey(weekStart);
    const date = parseLocalDate(applyWeekWednesday(weekStart));
    if (!date) return '';
    date.setDate(date.getDate() + 6);
    return dateKeyLocal(date);
  }

  function getWeeklySettlementWeekStart(record) {
    const start = String(record?.startDate || record?.baseSettlementDate || '').slice(0, 10);
    const end = String(record?.endDate || '').slice(0, 10);
    if (start) return applyWeekWednesday(start);
    if (end) return weekStartKey(end);
    const legacy = String(record?.weekStart || '').slice(0, 10);
    return legacy ? applyWeekWednesday(legacy) : '';
  }

  function buildSaveRecord(calculationResult) {
    if (!calculationResult) throw new Error('저장할 계산 결과가 없습니다.');
    const weekStart = getWeeklySettlementWeekStart({
      weekStart: calculationResult.weekStart,
      startDate: calculationResult.startDate
    });
    return {
      id: BremStorage.createId(),
      platform: calculationResult.platform,
      channel: normalizeChannel(calculationResult.channel),
      settlementId: calculationResult.settlementId,
      settlementLabel: calculationResult.settlementLabel,
      region: calculationResult.region,
      weekStart,
      startDate: calculationResult.startDate,
      endDate: calculationResult.endDate,
      selectedPromotionRuleIds: calculationResult.selectedPromotionRuleIds || [],
      selectedPromotionRuleNames: calculationResult.selectedPromotionRuleNames || [],
      appliedRuleLabel: calculationResult.appliedRuleLabel || '',
      assignmentMode: calculationResult.assignmentMode || '',
      unassignedRiderCount: Number(calculationResult.unassignedRiderCount || 0),
      deliveryFeeFileName: String(calculationResult.deliveryFeeFileName || ''),
      deliveryFeeLabel: String(calculationResult.deliveryFeeLabel || ''),
      savedAt: new Date().toISOString(),
      coupangSettlementId: calculationResult.coupangSettlementId || '',
      baeminSettlementId: calculationResult.baeminSettlementId || '',
      results: calculationResult.results || [],
      summary: calculationResult.summary || { riderCount: 0, totalPromotionAmount: 0 }
    };
  }

  function saveResult(calculationResult) {
    return BremStorage.promotionApplyResults.save(buildSaveRecord(calculationResult));
  }

  function getSavedResults(platform) {
    const list = BremStorage.promotionApplyResults.getAll();
    if (!platform) return list;
    const p = normalizePlatform(platform);
    return list.filter(item => normalizePlatform(item.platform) === p);
  }

  function getSavedResultById(id) {
    return BremStorage.promotionApplyResults.getById(id);
  }

  function deleteSavedResult(id) {
    return BremStorage.promotionApplyResults.remove(id);
  }

  function formatRateForExport(value, platform) {
    if (value === null || value === undefined || value === '') return '-';
    return `${Number(value).toLocaleString('ko-KR')}%`;
  }

  function buildExportRows(record) {
    const platform = normalizePlatform(record.platform);
    const isCombined = platform === 'combined';
    const rateLabel = isCombined ? '수락/거절율' : BremPlatforms.rateLabel(platform);
    const metaRows = [
      ['프로모션 적용 결과'],
      ['플랫폼', BremPlatforms.label(platform)],
      ['지역', record.region || ''],
      ['정산기간', `${record.startDate || ''} ~ ${record.endDate || ''}`],
      ['주간정산', record.settlementLabel || ''],
      ...(isCombined ? [
        ['쿠팡 정산서 ID', record.coupangSettlementId || ''],
        ['배민 정산서 ID', record.baeminSettlementId || ''],
        ['쿠팡 적용', record.summary?.coupangAssigned ?? ''],
        ['배민 적용', record.summary?.baeminAssigned ?? ''],
        ['겹침→배민(1순위)', record.summary?.overlapAssigned ?? ''],
        ['배민 정산서 합계', record.summary?.baeminAttachTotal ?? ''],
        ['쿠팡 정산서 합계', record.summary?.coupangAttachTotal ?? '']
      ] : []),
      ['적용 프로모션', record.appliedRuleLabel || (record.selectedPromotionRuleNames || []).join(', ')],
      ...(record.deliveryFeeLabel ? [['배달처리비', record.deliveryFeeLabel]] : []),
      ...(record.deliveryFeeFileName ? [['배달처리비 파일', record.deliveryFeeFileName]] : []),
      ['저장일', String(record.savedAt || '').slice(0, 19).replace('T', ' ')],
      ['기사 수', record.summary?.riderCount || 0],
      ['총 프로모션', record.summary?.totalPromotionAmount || 0],
      []
    ];
    const baeminIdLabel = '배민 RIDER ID';
    const baeminNameLabel = '매칭 기사명';
    const showDeliveryFee = platform === 'baemin' || isCombined
      || (record.results || []).some(row => Number(row.guaranteePromotionAmount || 0) > 0);
    const header = [
      ...(platform === 'baemin'
        ? [baeminIdLabel, baeminNameLabel]
        : isCombined
          ? ['ERP 기사명', '쿠팡ID', '배민ID']
          : [platform === 'coupang' ? '쿠팡 ID' : '기사명', 'ERP 기사명']),
      ...(isCombined ? ['적용 플랫폼', '구분', '쿠팡콜', '배민콜'] : []),
      '주간 콜수',
      rateLabel,
      '적용 프로모션',
      ...(showDeliveryFee ? [
        '배달처리비합계',
        '건당실제',
        '보장단가',
        ...(isCombined ? ['쿠팡보장', '배민보장'] : []),
        '단가보장지급'
      ] : []),
      '기본 지급',
      '추가 지급',
      '총 지급',
      '적용 조건',
      '미달성 조건',
      '미지급 사유'
    ];
    const dataRows = (record.results || []).map(row => {
      const rowPlatform = isCombined ? normalizePlatform(row.appliedPlatform || 'coupang') : platform;
      const identityCells = platform === 'baemin'
        ? [getResultRowBaeminRiderId(row), getResultRowMatchedDriverName(row)]
        : isCombined
          ? [getResultRowErpName(row), getResultRowCoupangId(row), getResultRowBaeminId(row)]
          : [getResultRowDisplayName(row, platform), getResultRowErpName(row)];
      const base = [
        ...identityCells,
        ...(isCombined ? [
          BremPlatforms.label(rowPlatform),
          row.assignmentSource || '-',
          Number(row.coupangCallCount || 0),
          Number(row.baeminCallCount || 0)
        ] : []),
        Number(row.callCount || 0),
        formatRateForExport(row.platformRate, rowPlatform),
        row.ruleName || '',
        ...(showDeliveryFee ? [
          Number(row.deliveryAmountTotal || 0),
          Number(row.avgDeliveryUnitPrice || 0),
          Number(row.guaranteedUnitPrice || 0),
          ...(isCombined ? [
            Number(row.coupangGuaranteeAmount || 0),
            Number(row.baeminGuaranteeAmount || 0)
          ] : []),
          Number(row.guaranteePromotionAmount || 0)
        ] : []),
        Number(row.basePromotionAmount || 0),
        Number(row.extraPromotionAmount || 0),
        Number(row.totalPromotionAmount || 0),
        (row.appliedConditions || []).join(', '),
        (row.failedConditions || []).join(', '),
        (row.failureReasons || []).join(', ') || '없음'
      ];
      return base;
    });
    return metaRows.concat([header], dataRows);
  }

  function buildExportFileName(record) {
    const region = String(record.region || '지역')
      .split('/')[0]
      .trim()
      .replace(/[\\/:*?"<>|]/g, '_');
    const date = String(record.savedAt || record.startDate || new Date().toISOString()).slice(0, 10);
    return `${region}_프로모션계산결과_${date}.xlsx`;
  }

  function buildSimpleExportRows(record) {
    const rows = (record.results || []).map(row => {
      const driver = row.matchedRiderId ? BremStorage.drivers.getById(row.matchedRiderId) : null;
      const platform = normalizePlatform(row.appliedPlatform || record.platform);
      const baeminId = getBaeminUserId(row, driver);
      const coupangId = makeCoupangLoginIdFromDriver(driver) || row.coupangLoginKey || '';
      const name = driver?.name || row.driverName || row.riderName || '';
      return {
        baeminId: baeminId || '-',
        coupangId: coupangId || '-',
        name,
        amount: Number(row.totalPromotionAmount) || 0,
        platform: BremPlatforms.label(platform),
        region: record.region || '',
        missionName: row.ruleName || '',
        weekLabel: `${record.startDate || ''} ~ ${record.endDate || ''}`,
        basis: (row.appliedConditions || []).join(', ') || (row.failureReasons || []).join(', ') || '-'
      };
    });
    return rows;
  }

  function exportResultToExcel(record) {
    if (!window.XLSX) throw new Error('엑셀 라이브러리를 불러오지 못했습니다.');
    if (!record) throw new Error('다운로드할 결과가 없습니다.');

    const simpleRows = buildSimpleExportRows(record);
    const simpleHeader = ['배민ID', '쿠팡ID', '이름', '금액', '플랫폼', '지역', '미션명', '정산주차', '계산기준'];
    const simpleSheet = XLSX.utils.aoa_to_sheet([
      simpleHeader,
      ...simpleRows.map(row => [
        row.baeminId,
        row.coupangId,
        row.name,
        row.amount,
        row.platform,
        row.region,
        row.missionName,
        row.weekLabel,
        row.basis
      ])
    ]);

    const detailRows = buildExportRows(record);
    const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, simpleSheet, '요약');
    XLSX.utils.book_append_sheet(workbook, detailSheet, '상세');
    XLSX.writeFile(workbook, buildExportFileName(record));
  }

  function settlementWeekKey(item) {
    return applyWeekWednesday(item?.weekStart || item?.startDate || item?.endDate || '');
  }

  function getSettlementOptions(platform, options = {}) {
    const p = normalizePlatform(platform);
    const weekStart = options.weekStart ? applyWeekWednesday(options.weekStart) : '';
    let items = getWeeklySettlementIndex(options.channel)
      .filter(item => item.platform === p);
    if (weekStart) {
      items = items.filter(item => settlementWeekKey(item) === weekStart);
    }
    return items
      .map(item => ({
        id: item.id,
        weekStart: item.weekStart,
        region: item.region,
        startDate: item.startDate,
        endDate: item.endDate,
        label: `${item.region} · ${item.matchedNamesLabel} (${item.startDate}~${item.endDate})`
      }))
      .sort((a, b) => String(a.region || '').localeCompare(String(b.region || ''), 'ko'));
  }

  // 브로와 직계약은 저장 키가 달라서 캐시도 채널별로 나눠 둔다.
  // 하나로 두면 채널을 바꿀 때 이전 채널 목록이 그대로 남는다.
  const weeklySettlementIndexCache = {};

  function normalizeChannel(channel) {
    return channel === 'direct' ? 'direct' : 'bro';
  }

  function getWeeklySettlementIndex(channel) {
    const ch = normalizeChannel(channel);
    const all = BremStorage.weeklySettlements.getAll(ch);
    const fingerprint = all.map(item => `${item.id}:${item.uploadedAt || ''}`).join('|');
    if (weeklySettlementIndexCache[ch]?.fingerprint === fingerprint) {
      return weeklySettlementIndexCache[ch].items;
    }

    const items = all.map(item => ({
      id: item.id,
      channel: ch,
      platform: BremStorage.resolveWeeklySettlementPlatform(item),
      weekStart: getWeeklySettlementWeekStart(item),
      region: item.region,
      startDate: item.startDate,
      endDate: item.endDate,
      matchedNamesLabel: item.matchedNamesLabel || `${item.summary?.matchedRiders || item.riders?.length || 0}명`
    }));
    weeklySettlementIndexCache[ch] = { fingerprint, items };
    return items;
  }

  function invalidateSettlementOptionsCache() {
    Object.keys(weeklySettlementIndexCache).forEach(key => {
      delete weeklySettlementIndexCache[key];
    });
  }

  function getSavedResultWeekStart(item) {
    if (!item) return '';
    const raw = String(item.weekStart || item.startDate || '').slice(0, 10);
    return raw ? applyWeekWednesday(raw) : '';
  }

  function exportWeekResultsToExcel(records, weekStart) {
    if (!window.XLSX) throw new Error('엑셀 라이브러리를 불러오지 못했습니다.');
    if (!records?.length) throw new Error('보낼 결과가 없습니다.');

    const simpleHeader = ['적용주', '배민ID', '쿠팡ID', '이름', '금액', '플랫폼', '지역', '미션명', '정산기간', '계산기준'];
    const simpleRows = [];
    records.forEach(record => {
      const itemWeekStart = getSavedResultWeekStart(record);
      const weekLabel = itemWeekStart
        ? `${itemWeekStart} ~ ${weekEndKey(itemWeekStart)}`
        : `${record.startDate || ''} ~ ${record.endDate || ''}`;
      buildSimpleExportRows(record).forEach(row => {
        simpleRows.push([
          weekLabel,
          row.baeminId,
          row.coupangId,
          row.name,
          row.amount,
          row.platform,
          row.region,
          row.missionName,
          row.weekLabel,
          row.basis
        ]);
      });
    });

    const simpleSheet = XLSX.utils.aoa_to_sheet([simpleHeader, ...simpleRows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, simpleSheet, '요약');

    const usedSheetNames = new Set(['요약']);
    records.forEach((record, index) => {
      let sheetName = String(record.region || `결과${index + 1}`)
        .split('/')[0]
        .trim()
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 28) || `결과${index + 1}`;
      let suffix = 2;
      while (usedSheetNames.has(sheetName)) {
        const base = sheetName.slice(0, 24);
        sheetName = `${base}_${suffix}`;
        suffix += 1;
      }
      usedSheetNames.add(sheetName);
      const detailSheet = XLSX.utils.aoa_to_sheet(buildExportRows(record));
      XLSX.utils.book_append_sheet(workbook, detailSheet, sheetName);
    });

    const weekKey = String(weekStart || '전체').slice(0, 10);
    XLSX.writeFile(workbook, `프로모션적용_${weekKey}.xlsx`);
  }

  return {
    applyPromotionToSettlement,
    applyPromotionToCombinedSettlements,
    selectedRulesNeedDeliveryFee,
    settlementNeedsDeliveryFee,
    combinedSettlementsNeedDeliveryFee,
    ruleUsesGuarantee,
    getSettlementOptions,
    invalidateSettlementOptionsCache,
    getWeeklySettlementWeekStart,
    getWeeklySettlementIndex,
    getSavedResultWeekStart,
    weekStartKey,
    applyWeekWednesday,
    weekEndKey,
    exportWeekResultsToExcel,
    getWeekStatsForDriver,
    getResultRowDisplayName,
    getResultRowBaeminRiderId,
    getResultRowMatchedDriverName,
    getResultRowErpName,
    getResultRowCoupangId,
    getResultRowBaeminId,
    buildSaveRecord,
    saveResult,
    getSavedResults,
    getSavedResultById,
    deleteSavedResult,
    exportResultToExcel,
    assignCombinedAttachAmounts,
    resolveCombinedRowAttachAmount
  };
})();

(function normalizePromotionApplyWeekFields() {
  const KEYS = ['coupang', 'baemin', 'combined-coupang', 'combined-baemin'];

  function formatRange(weekStart) {
    if (!weekStart) return '';
    if (window.BremDatePicker?.formatWednesdayWeekRange) {
      return `표시 범위: ${BremDatePicker.formatWednesdayWeekRange(weekStart)}`;
    }
    const end = BremPromotionApply.weekEndKey(weekStart);
    const weekday = value => {
      const day = new Date(`${value}T00:00:00`).getDay();
      return ['일', '월', '화', '수', '목', '금', '토'][day] || '';
    };
    const fmt = value => new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(`${value}T00:00:00`));
    return `표시 범위: ${fmt(weekStart)}(${weekday(weekStart)}) ~ ${fmt(end)}(${weekday(end)})`;
  }

  function syncField(selectKey) {
    const input = document.getElementById(`promotionApplySettlementWeek-${selectKey}`);
    if (!input?.value) return;
    const week = BremPromotionApply.applyWeekWednesday(input.value);
    if (week !== input.value) input.value = week;
    const label = document.querySelector(`[data-promotion-apply-week-label="${selectKey}"]`);
    if (label && window.BremDatePicker) {
      const weekday = BremDatePicker.formatWeekdayKo(week);
      label.textContent = weekday
        ? `${BremDatePicker.formatDate(week)}(${weekday})`
        : BremDatePicker.formatDate(week);
    }
    const range = document.getElementById(`promotionApplySettlementWeekRange-${selectKey}`);
    if (range) range.textContent = formatRange(week);
  }

  function run() {
    if (!document.getElementById('promotion-apply')) return;
    KEYS.forEach(syncField);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
