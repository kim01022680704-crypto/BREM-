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
    const baeminId = BremWeeklySettlement.normalizeBaeminUserId(
      rider?.baeminUserId || driver?.baeminId || ''
    );
    return baeminId || '-';
  }

  function getBaeminUserId(rider, driver) {
    return BremWeeklySettlement.normalizeBaeminUserId(
      rider?.baeminUserId || driver?.baeminId || ''
    );
  }

  function resolveDriverForWeeklyRider(rider, platform) {
    if (normalizePlatform(platform) === 'baemin') {
      return BremWeeklySettlement.resolveBaeminDriver(rider);
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
    const driver = row?.matchedRiderId ? BremStorage.drivers.getById(row.matchedRiderId) : null;
    return getBaeminUserId(row, driver) || '-';
  }

  function getResultRowMatchedDriverName(row) {
    const driver = row?.matchedRiderId ? BremStorage.drivers.getById(row.matchedRiderId) : null;
    return String(driver?.name || row?.driverName || '').trim();
  }

  function getResultRowDisplayName(row, platform) {
    const driver = row?.matchedRiderId ? BremStorage.drivers.getById(row.matchedRiderId) : null;
    const displayPlatform = normalizePlatform(platform) === 'combined'
      ? normalizePlatform(row.appliedPlatform || 'coupang')
      : normalizePlatform(platform);
    if (displayPlatform === 'coupang') {
      return makeCoupangDisplayName(driver, row);
    }
    if (displayPlatform === 'baemin') {
      return makeBaeminDisplayName(driver, row);
    }
    return row?.displayName || row?.driverName || row?.riderName || '';
  }

  function pickPromotionRule(driver, platform, selectedPromotionRuleIds = [], options = {}) {
    const p = normalizePlatform(platform);
    const selected = (selectedPromotionRuleIds || []).filter(Boolean);
    const assignmentMode = options.assignmentMode === 'per_driver' ? 'per_driver' : 'selected_rules';

    if (p === 'combined') {
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

    const driverRuleId = p === 'baemin'
      ? String(driver?.promotionRuleIdBaemin || driver?.promotionSelectorBaemin || driver?.selectedMissionIdBaemin || driver?.selectedMissionId || '').trim()
      : String(driver?.promotionRuleIdCoupang || driver?.promotionSelectorCoupang || driver?.selectedMissionIdCoupang || driver?.selectedMissionId || '').trim();

    if (!driverRuleId) return null;

    const assigned = BremStorage.promotionRules.getById(driverRuleId);
    if (!assigned || assigned.enabled === false) return null;
    if (normalizePlatform(assigned.platform) !== p) return null;
    return assigned;
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

  function combinedSettlementsNeedDeliveryFee(coupangSettlement, baeminSettlement, selectedRuleIds = []) {
    if (selectedRulesNeedDeliveryFee(selectedRuleIds)) return true;
    if (!baeminSettlement) return false;
    const assignments = buildDriverAssignments(coupangSettlement, baeminSettlement);
    return assignments.some(item => {
      if (normalizePlatform(item.appliedPlatform) !== 'baemin') return false;
      const driver = BremStorage.drivers.getById(item.driverId);
      if (!driver) return false;
      const rule = pickPromotionRule(driver, 'combined', selectedRuleIds);
      return ruleUsesGuarantee(rule);
    });
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
    if (!feeData || !hasValidDeliveryFeeData(feeData)) {
      return { stats, feeData: null };
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
        deliveryFees: Array.isArray(feeData.deliveryFees) ? feeData.deliveryFees : []
      }
    };
  }

  function buildDriverAssignments(coupangSettlement, baeminSettlement) {
    const coupangMap = new Map();
    const baeminMap = new Map();

    (coupangSettlement?.riders || []).forEach(rider => {
      if (rider.matchedRiderId) coupangMap.set(rider.matchedRiderId, rider);
    });
    (baeminSettlement?.riders || []).forEach(rider => {
      const driver = resolveDriverForWeeklyRider(rider, 'baemin');
      if (!driver?.id) return;
      baeminMap.set(driver.id, enrichBaeminRider(rider, driver));
    });

    const assignments = [];
    coupangMap.forEach((rider, driverId) => {
      const overlap = baeminMap.has(driverId);
      assignments.push({
        driverId,
        appliedPlatform: 'coupang',
        rider,
        settlement: coupangSettlement,
        assignmentSource: overlap ? '겹침→쿠팡' : '쿠팡'
      });
    });
    baeminMap.forEach((rider, driverId) => {
      if (!coupangMap.has(driverId)) {
        assignments.push({
          driverId,
          appliedPlatform: 'baemin',
          rider,
          settlement: baeminSettlement,
          assignmentSource: '배민'
        });
      }
    });
    return assignments;
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
    requireDeliveryFee = false
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
        ? String(driver.promotionRuleIdBaemin || driver.selectedMissionIdBaemin || '').trim()
        : String(driver.promotionRuleIdCoupang || driver.selectedMissionIdCoupang || '').trim();
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
        baeminUserId: rider.baeminUserId || driver.baeminId || '',
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

    const { stats, feeData } = driver
      ? resolveBaeminStats(rider, driver, settlement, statsPlatform, deliveryFeeIndex, {
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
        baeminUserId: rider.baeminUserId || driver.baeminId || '',
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
          ? '배달처리비 유효 건 없음 (AH열 0·배달 미수행)'
          : '배달처리비 정산서에서 User ID를 찾지 못했습니다 (K열·기사 배민 ID 확인)']
      };
    }

    const platformRate = BremStorage.rejections.getRateForWeek(driver.id, settlement.startDate, statsPlatform);

    const riderData = {
      driverId: driver.id,
      name: driver.name,
      platform: statsPlatform,
      totalOrders: stats.callCount,
      platformRate: platformRate === null || platformRate === undefined ? null : Number(platformRate),
      rateLabel: BremPlatforms.rateLabel(statsPlatform),
      dailyOrders: stats.byDay,
      deliveryAmount: stats.deliveryAmount,
      deliveryFees: Array.isArray(feeData?.deliveryFees) ? feeData.deliveryFees : [],
      selectedPromotionRuleId: rule.id,
      selectedPromotionName: rule.name,
      uploadDays: stats.uploadDays,
      weekStart: settlement.startDate,
      weekEnd: settlement.endDate
    };

    const result = BremPromotionEngine.calculatePromotionForRider(rule, riderData, promotionSettings);

    const guaranteePromotionAmount = Number(result.guaranteeBonus || 0);

    return {
      riderName: rider.riderName,
      driverName: driver.name,
      displayName: formatDriverDisplayName(statsPlatform, driver, rider),
      coupangLoginKey: rider.coupangLoginKey || '',
      originalName: rider.originalName || '',
      baeminUserId: rider.baeminUserId || driver.baeminId || '',
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
        requireDeliveryFee
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
      results,
      summary: {
        riderCount: results.length,
        totalPromotionAmount
      }
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
    const selected = (selectedPromotionRuleIds || []).filter(Boolean);
    if (!selected.length) throw new Error('적용할 합산 프로모션 조건을 선택하세요.');

    const assignments = buildDriverAssignments(coupangSettlement, baeminSettlement);
    if (!assignments.length) throw new Error('매칭된 기사가 없습니다.');

    const deliveryFeeIndex = options.deliveryFeeIndex || null;
    const requireDeliveryFee = options.requireDeliveryFee === true
      || combinedSettlementsNeedDeliveryFee(coupangSettlement, baeminSettlement, selected);

    if (requireDeliveryFee && !deliveryFeeIndex) {
      throw new Error('단가보장 프로모션은 배달처리비 정산서 업로드가 필요합니다.');
    }

    const results = assignments.map(item => {
      const driver = BremStorage.drivers.getById(item.driverId);
      return calculateRiderPromotion({
        rider: item.rider,
        driver,
        appliedPlatform: item.appliedPlatform,
        rulePlatform: 'combined',
        settlement: item.settlement,
        selectedRuleIds: selected,
        promotionSettings,
        assignmentSource: item.assignmentSource,
        deliveryFeeIndex: item.appliedPlatform === 'baemin' ? deliveryFeeIndex : null,
        requireDeliveryFee: item.appliedPlatform === 'baemin' && requireDeliveryFee
      });
    });

    const totalPromotionAmount = results.reduce((sum, item) => sum + item.totalPromotionAmount, 0);
    const startDate = [coupangSettlement.startDate, baeminSettlement.startDate].filter(Boolean).sort()[0] || '';
    const endDate = [coupangSettlement.endDate, baeminSettlement.endDate].filter(Boolean).sort().slice(-1)[0] || '';

    return {
      settlementId: `${coupangSettlement.id}|${baeminSettlement.id}`,
      coupangSettlementId: coupangSettlement.id,
      baeminSettlementId: baeminSettlement.id,
      settlementLabel: `쿠팡 ${coupangSettlement.region || '-'} + 배민 ${baeminSettlement.region || '-'}`,
      platform: 'combined',
      region: `${coupangSettlement.region || ''} / ${baeminSettlement.region || ''}`.trim(),
      startDate,
      endDate,
      selectedPromotionRuleIds: selected,
      selectedPromotionRuleNames: selected.map(id => BremStorage.promotionRules.getById(id)?.name || id).filter(Boolean),
      deliveryFeeFileName: options.deliveryFeeMeta?.fileName || '',
      deliveryFeeLabel: options.deliveryFeeMeta
        ? BremBaeminDeliveryFee.formatMetaLabel(options.deliveryFeeMeta)
        : '',
      results,
      summary: {
        riderCount: results.length,
        totalPromotionAmount,
        coupangAssigned: results.filter(item => item.appliedPlatform === 'coupang').length,
        baeminAssigned: results.filter(item => item.appliedPlatform === 'baemin').length,
        overlapAssigned: results.filter(item => item.assignmentSource === '겹침→쿠팡').length
      }
    };
  }

  function buildSaveRecord(calculationResult) {
    if (!calculationResult) throw new Error('저장할 계산 결과가 없습니다.');
    return {
      id: BremStorage.createId(),
      platform: calculationResult.platform,
      settlementId: calculationResult.settlementId,
      settlementLabel: calculationResult.settlementLabel,
      region: calculationResult.region,
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
        ['겹침→쿠팡', record.summary?.overlapAssigned ?? '']
      ] : []),
      ['적용 프로모션', record.appliedRuleLabel || (record.selectedPromotionRuleNames || []).join(', ')],
      ...(record.deliveryFeeLabel ? [['배달처리비', record.deliveryFeeLabel]] : []),
      ...(record.deliveryFeeFileName ? [['배달처리비 파일', record.deliveryFeeFileName]] : []),
      ['저장일', String(record.savedAt || '').slice(0, 19).replace('T', ' ')],
      ['기사 수', record.summary?.riderCount || 0],
      ['총 프로모션', record.summary?.totalPromotionAmount || 0],
      []
    ];
    const driverLabel = isCombined
      ? '기사'
      : (platform === 'coupang' ? '쿠팡 ID' : '기사명');
    const baeminIdLabel = '배민 RIDER ID';
    const baeminNameLabel = '매칭 기사명';
    const showDeliveryFee = platform === 'baemin'
      || (isCombined && (record.results || []).some(row => BremPlatforms.normalize(row.appliedPlatform) === 'baemin'));
    const header = [
      ...(platform === 'baemin' ? [baeminIdLabel, baeminNameLabel] : [driverLabel]),
      ...(isCombined ? ['적용 플랫폼', '구분'] : []),
      '주간 콜수',
      rateLabel,
      '적용 프로모션',
      ...(showDeliveryFee ? [
        '배달처리비합계',
        '건당실제',
        '보장단가',
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
        : [getResultRowDisplayName(row, platform)];
      const base = [
        ...identityCells,
        ...(isCombined ? [
          BremPlatforms.label(rowPlatform),
          row.assignmentSource || '-'
        ] : []),
        Number(row.callCount || 0),
        formatRateForExport(row.platformRate, rowPlatform),
        row.ruleName || '',
        ...(showDeliveryFee ? [
          Number(row.deliveryAmountTotal || 0),
          Number(row.avgDeliveryUnitPrice || 0),
          Number(row.guaranteedUnitPrice || 0),
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
      const baeminId = BremWeeklySettlement.normalizeBaeminUserId(
        row.baeminUserId || driver?.baeminId || ''
      );
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

  function getSettlementOptions(platform) {
    const p = normalizePlatform(platform);
    return BremStorage.weeklySettlements.getAll()
      .filter(item => BremStorage.resolveWeeklySettlementPlatform(item) === p)
      .map(item => ({
        id: item.id,
        label: `${item.region} · ${item.matchedNamesLabel || `${item.summary?.matchedRiders || item.riders?.length || 0}명`} (${item.startDate}~${item.endDate})`
      }));
  }

  return {
    applyPromotionToSettlement,
    applyPromotionToCombinedSettlements,
    selectedRulesNeedDeliveryFee,
    settlementNeedsDeliveryFee,
    combinedSettlementsNeedDeliveryFee,
    ruleUsesGuarantee,
    getSettlementOptions,
    getWeekStatsForDriver,
    getResultRowDisplayName,
    getResultRowBaeminRiderId,
    getResultRowMatchedDriverName,
    buildSaveRecord,
    saveResult,
    getSavedResults,
    getSavedResultById,
    deleteSavedResult,
    exportResultToExcel
  };
})();
