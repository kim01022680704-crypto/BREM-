const BremPromotionEngine = (function () {
  const WEEKDAY_KEYS = ['wed', 'thu', 'fri', 'sat', 'sun', 'mon', 'tue'];

  function normalizePlatform(platform) {
    return BremPlatforms.normalize(platform);
  }

  function weekStartKey(dateValue) {
    const date = new Date(`${dateValue}T00:00:00`);
    const day = date.getDay();
    const diff = (day - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return dateKey(date);
  }

  function weekEndKey(weekStart) {
    const end = new Date(`${weekStart}T00:00:00`);
    end.setDate(end.getDate() + 6);
    return dateKey(end);
  }

  function dateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function weekDateKeys(weekStart) {
    const keys = [];
    const cursor = new Date(`${weekStartKey(weekStart)}T00:00:00`);
    for (let i = 0; i < 7; i += 1) {
      keys.push(dateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return keys;
  }

  function weekOverlapsPromotion(weekStart, weekEnd, promoStart, promoEnd) {
    if (!promoStart || !promoEnd) return false;
    return weekStart <= promoEnd && weekEnd >= promoStart;
  }

  function getApplicableTier(tiers, callCount) {
    if (!Array.isArray(tiers) || !tiers.length) return null;
    const sorted = [...tiers].sort((a, b) => b.minCalls - a.minCalls);
    return sorted.find(tier => callCount >= Number(tier.minCalls || 0)) || null;
  }

  function getRateLabel(platform) {
    return BremPlatforms.rateLabel(platform);
  }

  function isCoupangPlatform(platform) {
    return normalizePlatform(platform) === 'coupang';
  }

  function isBaeminPlatform(platform) {
    return normalizePlatform(platform) === 'baemin';
  }

  function isRateConditionType(type) {
    return [
      'reject_rate_over',
      'reject_rate_under',
      'accept_rate_under',
      'accept_rate_over'
    ].includes(type);
  }

  function shouldApplyRateCondition(type, platform) {
    const p = normalizePlatform(platform);
    if (['reject_rate_over', 'reject_rate_under'].includes(type)) {
      return p === 'coupang';
    }
    if (['accept_rate_under', 'accept_rate_over'].includes(type)) {
      return p === 'baemin';
    }
    return true;
  }

  function getPlatformRateForDriver(driverId, weekStart, platform) {
    const storedRate = BremStorage.rejections.getRateForWeek(driverId, weekStart, normalizePlatform(platform));
    if (storedRate === null) return null;
    return Number(storedRate);
  }

  function getAcceptRateForDriver(driverId, weekStart, platform) {
    return getPlatformRateForDriver(driverId, weekStart, platform);
  }

  function getDriverSelector(driver, platform) {
    const p = normalizePlatform(platform);
    if (p === 'baemin') {
      return String(
        driver.promotionRuleIdBaemin
        || driver.promotionSelectorBaemin
        || driver.selectedPromotionType
        || ''
      ).trim();
    }
    return String(
      driver.promotionRuleIdCoupang
      || driver.promotionSelectorCoupang
      || driver.selectedPromotionType
      || ''
    ).trim();
  }

  function getPromotionNameById(ruleId) {
    if (!ruleId) return '미선택';
    const rule = BremStorage.promotionRules.getById(ruleId);
    return rule?.name || ruleId;
  }

  function buildDriverWeekStats(platform, weekStart, driverFilter) {
    const p = normalizePlatform(platform);
    const dates = weekDateKeys(weekStart);
    const dateSet = new Set(dates);
    const stats = {};

    BremStorage.settlements.getAll().forEach(record => {
      if (normalizePlatform(record.platform) !== p) return;
      const day = String(record.period).slice(0, 10);
      if (!dateSet.has(day)) return;
      if (typeof driverFilter === 'function' && !driverFilter(record.driverId)) return;

      if (!stats[record.driverId]) {
        stats[record.driverId] = { callCount: 0, deliveryAmount: 0, uploadDays: 0, byDay: {} };
      }

      const entry = stats[record.driverId];
      const dayCount = Number(record.orderCount || 0);
      const dayAmount = Number(record.deliveryAmount ?? record.settlementAmount ?? 0);
      entry.byDay[day] = { callCount: dayCount, deliveryAmount: dayAmount };
      entry.callCount += dayCount;
      entry.deliveryAmount += dayAmount;
      entry.uploadDays += 1;
    });

    return stats;
  }

  function buildRiderData(driver, stats, weekStart, platform) {
    const byDay = stats?.byDay || {};
    const dailyOrders = {};
    weekDateKeys(weekStart).forEach((date, index) => {
      dailyOrders[WEEKDAY_KEYS[index]] = byDay[date]?.callCount || 0;
      dailyOrders[date] = byDay[date]?.callCount || 0;
    });

    return {
      driverId: driver.id,
      name: driver.name,
      platform: normalizePlatform(platform),
      totalOrders: Number(stats?.callCount || 0),
      platformRate: getPlatformRateForDriver(driver.id, weekStart, platform),
      rateLabel: getRateLabel(platform),
      dailyOrders: byDay,
      deliveryAmount: Number(stats?.deliveryAmount || 0),
      selectedPromotionRuleId: getDriverSelector(driver, platform),
      selectedPromotionName: getPromotionNameById(getDriverSelector(driver, platform)),
      uploadDays: Number(stats?.uploadDays || 0),
      weekStart: weekStartKey(weekStart),
      weekEnd: weekEndKey(weekStartKey(weekStart))
    };
  }

  function countDailyQualifyingDays(byDay, dailyMinOrders) {
    return Object.values(byDay || {}).filter(day => Number(day.callCount || 0) >= Number(dailyMinOrders || 0)).length;
  }

  function checkGlobalRateBlock(settings, riderData, rule) {
    if (!settings?.globalBlockEnabled) return { passed: true, reasons: [] };
    if (rule && rule.applyGlobalAcceptBlock === false) return { passed: true, reasons: [] };

    const platform = normalizePlatform(riderData.platform);
    const blockPlatform = settings.globalBlockPlatform || 'all';
    if (blockPlatform !== 'all' && normalizePlatform(blockPlatform) !== platform) {
      return { passed: true, reasons: [] };
    }

    const applyTo = settings.globalBlockApplyTo;
    if (rule && Array.isArray(applyTo) && applyTo.length && !applyTo.includes(rule.id)) {
      return { passed: true, reasons: [] };
    }

    const rate = riderData.platformRate;

    if (platform === 'coupang') {
      if (rate === null || rate === undefined) {
        return { passed: false, reasons: ['거절율 미등록'] };
      }
      const maxRejectRate = Number(settings.globalMaxRejectRate ?? 15);
      if (rate > maxRejectRate) {
        return { passed: false, reasons: [`거절율 ${maxRejectRate}% 초과 (${rate}%)`] };
      }
      return { passed: true, reasons: [] };
    }

    if (platform === 'baemin') {
      if (rate === null || rate === undefined) {
        return { passed: false, reasons: ['수락률 미등록'] };
      }
      const minAcceptRate = Number(settings.globalMinAcceptRate ?? 85);
      if (rate < minAcceptRate) {
        return { passed: false, reasons: [`수락률 ${minAcceptRate}% 미만 (${rate}%)`] };
      }
      return { passed: true, reasons: [] };
    }

    return { passed: true, reasons: [] };
  }

  function checkGlobalAcceptanceBlock(settings, riderData, rule) {
    return checkGlobalRateBlock(settings, riderData, rule);
  }

  function getRuleRateBounds(rule, platform, options = {}) {
    const p = normalizePlatform(platform || rule.platform);
    const minRate = Number(options.minRate ?? rule.minRate ?? rule.minAcceptRate ?? 0);
    const maxRate = Number(
      options.maxRate
      ?? rule.maxRate
      ?? rule.maxAcceptRate
      ?? (isCoupangPlatform(p) ? 15 : 100)
    );
    return { minRate, maxRate };
  }

  function checkRateCondition(rule, rate, platform, options = {}) {
    const p = normalizePlatform(platform || rule.platform);
    const label = options.label || getRateLabel(p);
    const { minRate, maxRate } = getRuleRateBounds(rule, p, options);

    if (rate === null || rate === undefined) {
      return { passed: false, reasons: [`${label} 미등록`] };
    }

    if (isCoupangPlatform(p)) {
      if (rate > maxRate) {
        return { passed: false, reasons: [`${label} ${maxRate}% 초과 (${rate}%)`] };
      }
      if (rate < minRate) {
        return { passed: false, reasons: [`${label} ${minRate}% 미만 (${rate}%)`] };
      }
    } else if (rate < minRate) {
      return { passed: false, reasons: [`${label} ${minRate}% 미만 (${rate}%)`] };
    } else if (rate > maxRate) {
      return { passed: false, reasons: [`${label} ${maxRate}% 초과 (${rate}%)`] };
    }

    return { passed: true, reasons: [], minRate, maxRate, rate };
  }

  function checkAcceptanceRateCondition(rule, rate, options = {}) {
    return checkRateCondition(rule, rate, rule.platform, options);
  }

  function checkTotalOrderCondition(rule, totalOrders) {
    const minOrders = Number(rule.baseCallCount ?? rule.minOrders ?? 0);
    if (totalOrders < minOrders) {
      return {
        passed: false,
        reasons: [`총 콜수 ${minOrders}건 미만 (${totalOrders}건)`]
      };
    }
    return { passed: true, reasons: [], minOrders, totalOrders };
  }

  function checkWorkingDaysCondition(rule, riderData, options = {}) {
    const enabled = options.enabled ?? rule.requireMinWorkingDays;
    if (!enabled) return { passed: true, reasons: [], qualifyingDays: 0 };

    const minWorkingDays = Number(options.minWorkingDays ?? rule.minWorkingDays ?? 6);
    const dailyMin = Number(options.dailyMinOrders ?? rule.dailyMinOrders ?? 0);
    const byDay = riderData.dailyOrders || {};
    const qualifyingDays = countDailyQualifyingDays(byDay, dailyMin);

    if (qualifyingDays < minWorkingDays) {
      return {
        passed: false,
        reasons: [`주${minWorkingDays}일 조건 미달 (${qualifyingDays}/${minWorkingDays}일, 일 ${dailyMin}건 기준)`],
        qualifyingDays,
        minWorkingDays
      };
    }

    return { passed: true, reasons: [], qualifyingDays, minWorkingDays };
  }

  function checkDailyMinOrdersCondition(rule, riderData, options = {}) {
    const enabled = options.enabled ?? rule.requireDailyMinOrders;
    if (!enabled) return { passed: true, reasons: [], qualifyingDays: 0 };

    const dailyMin = Number(options.dailyMinOrders ?? rule.dailyMinOrders ?? 30);
    const minDays = Number(options.minDailyOrderDays ?? rule.minDailyOrderDays ?? 6);
    const byDay = riderData.dailyOrders || {};
    const reasons = [];

    Object.entries(byDay).forEach(([date, data]) => {
      const count = Number(data?.callCount ?? data ?? 0);
      if (count > 0 && count < dailyMin) {
        reasons.push(`하루 ${dailyMin}건 미달 (${date}: ${count}건)`);
      }
    });

    const qualifyingDays = countDailyQualifyingDays(byDay, dailyMin);
    if (qualifyingDays < minDays) {
      reasons.push(`하루 ${dailyMin}건 이상 달성일 부족 (${qualifyingDays}/${minDays}일)`);
    }

    return {
      passed: reasons.length === 0,
      reasons,
      qualifyingDays,
      minDays,
      dailyMin
    };
  }

  function checkSelectorCondition(rule, riderData) {
    const selected = String(
      riderData.selectedPromotionRuleId || riderData.selectedPromotionType || ''
    ).trim();

    if (!selected) {
      return { passed: false, reasons: ['프로모션 미선택'] };
    }

    if (selected === rule.id || selected === rule.name) {
      return { passed: true, reasons: [], selected, ruleName: rule.name };
    }

    if (rule.selectorKey && selected === rule.selectorKey) {
      return { passed: true, reasons: [], selected, ruleName: rule.name };
    }

    return {
      passed: false,
      reasons: [`프로모션 불일치 (선택: ${getPromotionNameById(selected)}, 적용: ${rule.name})`]
    };
  }

  function checkPeriodCondition(rule, riderData) {
    if (!weekOverlapsPromotion(riderData.weekStart, riderData.weekEnd, rule.startDate, rule.endDate)) {
      return { passed: false, reasons: ['프로모션 기간 아님'] };
    }
    return { passed: true, reasons: [] };
  }

  function getRuleBase(rule) {
    if (rule.base) return rule.base;
    return {
      baseCallCount: rule.baseCallCount,
      payStartCallCount: rule.payStartCallCount,
      payPerCall: rule.payPerCall,
      guaranteedUnitPrice: rule.guaranteedUnitPrice,
      callTiers: rule.callTiers
    };
  }

  function evaluateStructuredCondition(condition, rule, riderData) {
    const platform = normalizePlatform(riderData.platform);
    const resolved = BremPromotionConditions?.resolveRateCondition
      ? BremPromotionConditions.resolveRateCondition(condition, platform)
      : condition;
    const type = resolved.conditionType;
    const rate = riderData.platformRate;
    const totalOrders = riderData.totalOrders;
    const byDay = riderData.dailyOrders || {};
    const label = BremPromotionConditions?.formatConditionLabel
      ? BremPromotionConditions.formatConditionLabel(condition, platform)
      : (condition.conditionName || BremPromotionConditions?.CONDITION_TYPES?.[type]?.label || type);

    if (isRateConditionType(type) && !shouldApplyRateCondition(type, platform)) {
      return { passed: true, reasons: [] };
    }

    switch (type) {
      case 'reject_rate_over':
      case 'reject_rate_under': {
        const threshold = Number(resolved.rateThreshold ?? 0);
        if (rate === null || rate === undefined) {
          return { passed: false, reasons: ['거절율 미등록'] };
        }
        const passed = type === 'reject_rate_over'
          ? rate <= threshold
          : rate <= threshold;
        return {
          passed,
          reasons: passed ? [] : [type === 'reject_rate_over'
            ? `${label} (현재 ${rate}% > ${threshold}%)`
            : `${label} (현재 ${rate}% > ${threshold}%)`]
        };
      }
      case 'accept_rate_under':
      case 'accept_rate_over': {
        const threshold = Number(resolved.rateThreshold ?? 0);
        if (rate === null || rate === undefined) {
          return { passed: false, reasons: ['수락률 미등록'] };
        }
        const passed = type === 'accept_rate_under'
          ? rate >= threshold
          : rate >= threshold;
        return {
          passed,
          reasons: passed ? [] : [type === 'accept_rate_under'
            ? `${label} (현재 ${rate}% < ${threshold}%)`
            : `${label} (현재 ${rate}% < ${threshold}%)`]
        };
      }
      case 'total_orders_under': {
        const min = Number(condition.minTotalOrders ?? 0);
        const passed = totalOrders >= min;
        return {
          passed,
          reasons: passed ? [] : [`${label} (${totalOrders}/${min}건)`]
        };
      }
      case 'total_orders_over': {
        const min = Number(condition.minTotalOrders ?? 0);
        const passed = totalOrders >= min;
        return {
          passed,
          reasons: passed ? [] : [`${label} (${totalOrders}/${min}건)`]
        };
      }
      case 'working_days': {
        const minWorkingDays = Number(condition.minWorkingDays ?? 6);
        const dailyMin = Number(condition.dailyMinOrders ?? 0);
        const qualifyingDays = dailyMin > 0
          ? countDailyQualifyingDays(byDay, dailyMin)
          : Object.values(byDay).filter(day => Number(day?.callCount ?? day ?? 0) > 0).length;
        const passed = qualifyingDays >= minWorkingDays;
        return {
          passed,
          reasons: passed ? [] : [`${label} (${qualifyingDays}/${minWorkingDays}일)`],
          qualifyingDays,
          minWorkingDays
        };
      }
      case 'daily_min_days': {
        const dailyMin = Number(condition.dailyMinOrders ?? 30);
        const minDays = Number(condition.minDailyOrderDays ?? 6);
        const reasons = [];

        if (condition.processingMode === 'block') {
          Object.entries(byDay).forEach(([date, data]) => {
            const count = Number(data?.callCount ?? data ?? 0);
            if (count > 0 && count < dailyMin) {
              reasons.push(`하루 ${dailyMin}건 미달 (${date}: ${count}건)`);
            }
          });
        }

        const qualifyingDays = countDailyQualifyingDays(byDay, dailyMin);
        if (qualifyingDays < minDays) {
          reasons.push(`${label} (${qualifyingDays}/${minDays}일)`);
        }

        return {
          passed: reasons.length === 0,
          reasons,
          qualifyingDays,
          minDays,
          dailyMin
        };
      }
      default:
        return { passed: true, reasons: [] };
    }
  }

  function getCommonFailureReasons(rule, riderData, settings) {
    const reasons = [];
    if (!rule) return ['조건 없음'];
    if (!rule.enabled) return ['사용 중지'];

    const globalCheck = checkGlobalAcceptanceBlock(settings, riderData, rule);
    if (!globalCheck.passed) reasons.push(...globalCheck.reasons);

    const periodCheck = checkPeriodCondition(rule, riderData);
    if (!periodCheck.passed) reasons.push(...periodCheck.reasons);

    const selectorCheck = checkSelectorCondition(rule, riderData);
    if (!selectorCheck.passed) reasons.push(...selectorCheck.reasons);

    return reasons;
  }

  function evaluateBlockConditions(rule, riderData, settings) {
    const commonReasons = getCommonFailureReasons(rule, riderData, settings);
    if (commonReasons.length) return { passed: false, reasons: commonReasons };

    const blockReasons = [];
    const isCombinedRule = normalizePlatform(rule.platform) === 'combined';
    (rule.blockConditions || []).forEach(condition => {
      if (isCombinedRule && isRateConditionType(condition.conditionType)
        && !shouldApplyRateCondition(condition.conditionType, riderData.platform)) {
        return;
      }
      const result = evaluateStructuredCondition(condition, rule, riderData);
      if (!result.passed) blockReasons.push(...result.reasons);
    });

    return {
      passed: blockReasons.length === 0,
      reasons: blockReasons
    };
  }

  function calculateBasePayAmount(rule, riderData) {
    const base = getRuleBase(rule);
    const type = rule.type || 'count_per_order';
    const payStart = Number(base.payStartCallCount ?? 0);
    const payPerCall = Number(base.payPerCall ?? 0);

    if (type === 'guaranteed_unit_price') {
      return { basePay: 0, paidCallCount: 0, guaranteeEligible: true };
    }

    if (payPerCall <= 0 || payStart <= 0) {
      return { basePay: 0, paidCallCount: 0, failureReasons: type === 'count_per_order' ? ['건당 지급 설정 없음'] : [] };
    }

    if (riderData.totalOrders < payStart) {
      return {
        basePay: 0,
        paidCallCount: 0,
        failureReasons: [`지급 시작 콜수 미달 (${riderData.totalOrders}/${payStart})`]
      };
    }

    const paidCallCount = riderData.totalOrders - payStart + 1;
    return {
      basePay: paidCallCount * payPerCall,
      paidCallCount,
      failureReasons: []
    };
  }

  function sumGuaranteeTopUp(guaranteedUnitPrice, riderData) {
    const unit = Number(guaranteedUnitPrice || 0);
    if (unit <= 0) return 0;

    const fees = Array.isArray(riderData?.deliveryFees)
      ? riderData.deliveryFees.map(fee => Number(fee || 0)).filter(fee => fee > 0)
      : [];

    if (fees.length) {
      return fees.reduce((sum, fee) => sum + Math.max(0, unit - fee), 0);
    }

    const orders = Number(riderData?.totalOrders || 0);
    const amount = Number(riderData?.deliveryAmount || 0);
    if (orders <= 0) return 0;
    return Math.max(0, unit * orders - amount);
  }

  function calculateBonusForCondition(condition, context) {
    const { paidCallCount, basePay, riderData, rule } = context;
    const action = condition.actionType || 'add_pay_per_order';

    switch (action) {
      case 'add_pay_per_order':
        return paidCallCount * Number(condition.addPayPerOrder ?? 0);
      case 'fixed_bonus':
        return Number(condition.fixedBonus ?? 0);
      case 'guarantee_unit_add': {
        const unitAdd = Number(condition.guaranteeUnitAdd ?? 0);
        if (unitAdd <= 0 || riderData.totalOrders <= 0) return 0;
        return sumGuaranteeTopUp(unitAdd, riderData);
      }
      case 'percent_bonus':
        return Math.round(basePay * Number(condition.bonusPercent ?? 0) / 100);
      default:
        return 0;
    }
  }

  function calculateGuaranteePay(rule, riderData) {
    const base = getRuleBase(rule);
    const type = rule.type || 'count_per_order';
    if (type !== 'guaranteed_unit_price' && type !== 'both') {
      return { guaranteeBonus: 0, appliedTier: null, appliedUnitPrice: 0, failureReasons: [] };
    }

    const tier = getApplicableTier(base.callTiers || rule.callTiers, riderData.totalOrders);
    const appliedUnitPrice = tier ? Number(tier.unitPrice || 0) : 0;

    if (appliedUnitPrice <= 0 || riderData.totalOrders <= 0) {
      return { guaranteeBonus: 0, appliedTier: tier, appliedUnitPrice, failureReasons: ['단가보장 대상 아님'] };
    }

    const guaranteeBonus = sumGuaranteeTopUp(appliedUnitPrice, riderData);

    if (guaranteeBonus <= 0) {
      return {
        guaranteeBonus: 0,
        appliedTier: tier,
        appliedUnitPrice,
        failureReasons: ['실제 배달수행금액이 보장금액 이상']
      };
    }

    return { guaranteeBonus, appliedTier: tier, appliedUnitPrice, failureReasons: [] };
  }

  function getPromotionFailureReasons(rule, riderData, settings) {
    const block = evaluateBlockConditions(rule, riderData, settings);
    return block.reasons;
  }

  function calculateCountPerOrderPromotion(rule, riderData, settings) {
    const block = evaluateBlockConditions(rule, riderData, settings);
    if (!block.passed) {
      return {
        eligible: false,
        perCallBonus: 0,
        paidCallCount: 0,
        failureReasons: block.reasons
      };
    }

    const baseResult = calculateBasePayAmount(rule, riderData);
    if (baseResult.failureReasons?.length) {
      return {
        eligible: false,
        perCallBonus: 0,
        paidCallCount: 0,
        failureReasons: baseResult.failureReasons
      };
    }

    return {
      eligible: baseResult.basePay > 0,
      perCallBonus: baseResult.basePay,
      paidCallCount: baseResult.paidCallCount,
      failureReasons: baseResult.basePay > 0 ? [] : ['건당 지급 0원']
    };
  }

  function calculateGuaranteedUnitPricePromotion(rule, riderData, settings) {
    const block = evaluateBlockConditions(rule, riderData, settings);
    if (!block.passed) {
      return { eligible: false, guaranteeBonus: 0, appliedTier: null, appliedUnitPrice: 0, failureReasons: block.reasons };
    }

    const guarantee = calculateGuaranteePay(rule, riderData);
    return {
      eligible: guarantee.guaranteeBonus > 0,
      guaranteeBonus: guarantee.guaranteeBonus,
      appliedTier: guarantee.appliedTier,
      appliedUnitPrice: guarantee.appliedUnitPrice,
      failureReasons: guarantee.guaranteeBonus > 0 ? [] : guarantee.failureReasons
    };
  }

  function collectAppliedBlockConditions(rule, riderData, settings) {
    const settingsValue = settings || BremStorage.promotionSettings.get();
    const block = evaluateBlockConditions(rule, riderData, settingsValue);
    if (!block.passed) return [];

    const isCombinedRule = normalizePlatform(rule.platform) === 'combined';
    const applied = [];

    (rule.blockConditions || []).forEach(condition => {
      if (isCombinedRule && isRateConditionType(condition.conditionType)
        && !shouldApplyRateCondition(condition.conditionType, riderData.platform)) {
        return;
      }
      const result = evaluateStructuredCondition(condition, rule, riderData);
      if (!result.passed) return;
      const name = BremPromotionConditions?.formatSatisfiedConditionLabel
        ? BremPromotionConditions.formatSatisfiedConditionLabel(condition, riderData.platform)
        : (condition.conditionName || condition.conditionType);
      applied.push({ name });
    });

    return applied;
  }

  function ruleHasPassedBlockRateCondition(rule, riderData) {
    const isCombinedRule = normalizePlatform(rule.platform) === 'combined';
    return (rule.blockConditions || []).some(condition => {
      if (!isRateConditionType(condition.conditionType)) return false;
      if (isCombinedRule && !shouldApplyRateCondition(condition.conditionType, riderData.platform)) {
        return false;
      }
      return evaluateStructuredCondition(condition, rule, riderData).passed;
    });
  }

  function calculatePromotionForRider(rule, riderData, settings) {
    const settingsValue = settings || BremStorage.promotionSettings.get();
    const block = evaluateBlockConditions(rule, riderData, settingsValue);
    const referenceNotes = [];

    (rule.referenceConditions || []).forEach(condition => {
      const result = evaluateStructuredCondition(condition, rule, riderData);
      const name = BremPromotionConditions?.formatConditionLabel
        ? BremPromotionConditions.formatConditionLabel(condition, riderData.platform)
        : (condition.conditionName || condition.conditionType);
      referenceNotes.push({
        name,
        passed: result.passed,
        note: result.reasons[0] || '충족'
      });
    });

    if (!block.passed) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        eligible: false,
        status: '미지급',
        failureReasons: block.reasons,
        blockReasons: block.reasons,
        reason: block.reasons.join(', '),
        callCount: riderData.totalOrders,
        deliveryAmount: riderData.deliveryAmount,
        platformRate: riderData.platformRate,
        rateLabel: riderData.rateLabel,
        acceptRate: riderData.platformRate,
        basePay: 0,
        bonusPay: 0,
        perCallBonus: 0,
        guaranteeBonus: 0,
        totalBonus: 0,
        paidCallCount: 0,
        appliedBonusConditions: [],
        failedBonusConditions: (rule.bonusConditions || []).map(item => ({
          name: BremPromotionConditions?.formatConditionLabel
            ? BremPromotionConditions.formatConditionLabel(item, riderData.platform)
            : (item.conditionName || item.conditionType),
          reason: '미지급 조건으로 인해 미적용'
        })),
        referenceNotes,
        appliedTier: null,
        appliedUnitPrice: 0,
        qualifyingDays: 0,
        selectedPromotionRuleId: riderData.selectedPromotionRuleId,
        selectedPromotionName: riderData.selectedPromotionName,
        selectedPromotionType: riderData.selectedPromotionName,
        priority: Number(rule.priority ?? 100)
      };
    }

    const baseResult = calculateBasePayAmount(rule, riderData);
    const guaranteeResult = calculateGuaranteePay(rule, riderData);
    const type = rule.type || 'count_per_order';

    let basePay = 0;
    if (type === 'count_per_order' || type === 'both') {
      basePay = baseResult.basePay || 0;
    }

    const appliedBlockConditions = [];
    const appliedBonusConditions = [];
    const failedBonusConditions = [];
    let bonusPay = 0;
    const skipBonusRateChip = ruleHasPassedBlockRateCondition(rule, riderData);

    (rule.bonusConditions || []).forEach(condition => {
      if (normalizePlatform(rule.platform) === 'combined'
        && isRateConditionType(condition.conditionType)
        && !shouldApplyRateCondition(condition.conditionType, riderData.platform)) {
        return;
      }
      const evalResult = evaluateStructuredCondition(condition, rule, riderData);
      const name = BremPromotionConditions?.formatConditionLabel
        ? BremPromotionConditions.formatConditionLabel(condition, riderData.platform)
        : (condition.conditionName || condition.conditionType);
      if (!evalResult.passed) {
        failedBonusConditions.push({
          name,
          reason: evalResult.reasons[0] || '조건 미달'
        });
        return;
      }

      const amount = calculateBonusForCondition(condition, {
        paidCallCount: baseResult.paidCallCount,
        basePay,
        riderData,
        rule
      });

      if (amount > 0) {
        bonusPay += amount;
        if (!(skipBonusRateChip && isRateConditionType(condition.conditionType))) {
          appliedBonusConditions.push({ name, amount });
        }
      } else {
        failedBonusConditions.push({ name, reason: '추가 지급액 0원' });
      }
    });

    if (block.passed) {
      appliedBlockConditions.push(...collectAppliedBlockConditions(rule, riderData, settingsValue));
    }

    if (guaranteeBonus > 0 && guaranteeResult.appliedUnitPrice > 0) {
      appliedBlockConditions.push({
        name: `단가보장 ${Number(guaranteeBonus).toLocaleString('ko-KR')}원`
      });
    }

    const guaranteeBonus = guaranteeResult.guaranteeBonus || 0;
    const totalBonus = basePay + bonusPay + guaranteeBonus;
    const baseFailureReasons = baseResult.failureReasons || [];
    const guaranteeFailureReasons = guaranteeResult.failureReasons || [];

    let eligible = totalBonus > 0;
    let combinedReasons = [];

    if (type === 'count_per_order') {
      if (!basePay && baseFailureReasons.length) combinedReasons = baseFailureReasons;
      else eligible = totalBonus > 0;
    } else if (type === 'guaranteed_unit_price') {
      eligible = guaranteeBonus > 0;
      if (!eligible) combinedReasons = guaranteeFailureReasons;
    } else {
      eligible = totalBonus > 0;
      if (!eligible) {
        combinedReasons = [...baseFailureReasons, ...guaranteeFailureReasons].filter(Boolean);
      }
    }

    const dailyMin = (rule.bonusConditions || []).find(item => item.conditionType === 'daily_min_days')?.dailyMinOrders
      || (rule.blockConditions || []).find(item => item.conditionType === 'daily_min_days')?.dailyMinOrders
      || 30;

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      eligible: eligible && totalBonus > 0,
      status: eligible && totalBonus > 0 ? '지급' : '미지급',
      failureReasons: eligible && totalBonus > 0 ? [] : [...new Set(combinedReasons.filter(Boolean))],
      blockReasons: [],
      reason: (eligible && totalBonus > 0 ? '' : [...new Set(combinedReasons.filter(Boolean))].join(', ')),
      callCount: riderData.totalOrders,
      deliveryAmount: riderData.deliveryAmount,
      platformRate: riderData.platformRate,
      rateLabel: riderData.rateLabel,
      acceptRate: riderData.platformRate,
      basePay,
      bonusPay,
      perCallBonus: basePay,
      guaranteeBonus,
      totalBonus,
      paidCallCount: baseResult.paidCallCount || 0,
      appliedBlockConditions,
      appliedBonusConditions,
      failedBonusConditions,
      referenceNotes,
      appliedTier: guaranteeResult.appliedTier,
      appliedUnitPrice: guaranteeResult.appliedUnitPrice,
      qualifyingDays: countDailyQualifyingDays(riderData.dailyOrders, dailyMin),
      selectedPromotionRuleId: riderData.selectedPromotionRuleId,
      selectedPromotionName: riderData.selectedPromotionName,
      selectedPromotionType: riderData.selectedPromotionName,
      priority: Number(rule.priority ?? 100)
    };
  }

  function resolveDuplicateResults(results, strategy) {
    const eligible = results.filter(item => item.eligible && item.totalBonus > 0);
    if (!eligible.length) return { items: results, finalTotal: 0, applied: [] };

    const allowDuplicate = eligible.some(item => {
      const rule = BremStorage.promotionRules.getById(item.ruleId);
      return rule?.allowDuplicate;
    });

    if (allowDuplicate && strategy !== 'highest_priority') {
      const total = eligible.reduce((sum, item) => sum + item.totalBonus, 0);
      return { items: results, finalTotal: total, applied: eligible };
    }

    if (strategy === 'highest_amount') {
      const best = eligible.sort((a, b) => b.totalBonus - a.totalBonus)[0];
      return { items: results, finalTotal: best.totalBonus, applied: [best] };
    }

    const best = eligible.sort((a, b) => a.priority - b.priority)[0];
    return { items: results, finalTotal: best.totalBonus, applied: [best] };
  }

  function evaluateAllRulesForRider(driver, weekStart, platform, options = {}) {
    const p = normalizePlatform(platform);
    const normalizedWeek = weekStartKey(weekStart);
    const statsMap = buildDriverWeekStats(p, normalizedWeek, options.driverFilter);
    const stats = statsMap[driver.id] || { callCount: 0, deliveryAmount: 0, uploadDays: 0, byDay: {} };
    const riderData = buildRiderData(driver, stats, normalizedWeek, p);
    const settings = options.settings || BremStorage.promotionSettings.get();

    const rules = (options.rules || BremStorage.promotionRules.getAll())
      .filter(rule => rule.enabled && normalizePlatform(rule.platform) === p);

    const results = rules.map(rule => calculatePromotionForRider(rule, riderData, settings));
    const strategy = options.duplicateStrategy || 'highest_priority';
    const resolved = resolveDuplicateResults(results, strategy);

    return {
      driverId: driver.id,
      driverName: driver.name,
      riderData,
      results,
      finalTotal: resolved.finalTotal,
      appliedRules: resolved.applied,
      uploadDays: stats.uploadDays
    };
  }

  function evaluateRule(rule, context) {
    const platform = normalizePlatform(rule.platform);
    const riderData = {
      driverId: context.driverId,
      name: context.driverName || '',
      platform,
      totalOrders: Number(context.callCount || 0),
      platformRate: context.platformRate ?? context.acceptRate ?? null,
      rateLabel: getRateLabel(platform),
      dailyOrders: context.byDay || {},
      deliveryAmount: Number(context.deliveryAmount || 0),
      selectedPromotionRuleId: context.selectedPromotionRuleId || context.selectedPromotionType || '',
      selectedPromotionName: getPromotionNameById(context.selectedPromotionRuleId || context.selectedPromotionType || ''),
      uploadDays: Number(context.uploadDays || 0),
      weekStart: context.weekStart,
      weekEnd: context.weekEnd
    };

    const calculated = calculatePromotionForRider(rule, riderData, context.settings);
    return {
      ...calculated,
      callCount: riderData.totalOrders,
      deliveryAmount: riderData.deliveryAmount,
      platformRate: riderData.platformRate,
      rateLabel: riderData.rateLabel,
      acceptRate: riderData.platformRate,
      uploadDays: riderData.uploadDays
    };
  }

  function evaluateRuleForDrivers(rule, options = {}) {
    const p = normalizePlatform(rule.platform);
    const weekStart = weekStartKey(options.weekStart);
    const weekEnd = weekEndKey(weekStart);
    const statsMap = buildDriverWeekStats(p, weekStart, options.driverFilter);
    const settings = options.settings || BremStorage.promotionSettings.get();
    const drivers = (options.drivers || BremStorage.drivers.getAll()).filter(driver => {
      if (typeof options.driverFilter === 'function' && !options.driverFilter(driver.id)) return false;
      return p === 'baemin' ? driver.platformBaemin : driver.platformCoupang !== false;
    });

    return drivers.map(driver => {
      const stats = statsMap[driver.id] || { callCount: 0, deliveryAmount: 0, uploadDays: 0, byDay: {} };
      const result = evaluateRule(rule, {
        driverId: driver.id,
        driverName: driver.name,
        callCount: stats.callCount,
        deliveryAmount: stats.deliveryAmount,
        platformRate: getPlatformRateForDriver(driver.id, weekStart, p),
        byDay: stats.byDay,
        selectedPromotionRuleId: getDriverSelector(driver, p),
        uploadDays: stats.uploadDays,
        weekStart,
        weekEnd,
        settings
      });

      return {
        driverId: driver.id,
        driverName: driver.name,
        uploadDays: stats.uploadDays,
        ...result
      };
    }).sort((a, b) => a.driverName.localeCompare(b.driverName, 'ko'));
  }

  function evaluatePreview(rule, weekStart, driverFilter) {
    return evaluateRuleForDrivers(rule, { weekStart, driverFilter });
  }

  function evaluateCombinedPreview(platform, weekStart, driverFilter) {
    const p = normalizePlatform(platform);
    const drivers = BremStorage.drivers.getAll().filter(driver => {
      if (typeof driverFilter === 'function' && !driverFilter(driver.id)) return false;
      return p === 'baemin' ? driver.platformBaemin : driver.platformCoupang !== false;
    });

    return drivers.map(driver => {
      const evaluated = evaluateAllRulesForRider(driver, weekStart, p, { driverFilter });
      const appliedNames = evaluated.appliedRules.map(item => item.ruleName).join(', ') || '-';
      const failureReasons = evaluated.results
        .flatMap(item => item.failureReasons)
        .filter(Boolean);
      const uniqueReasons = [...new Set(failureReasons)];
      const enabledRules = BremStorage.promotionRules.getAll().filter(rule => rule.enabled && normalizePlatform(rule.platform) === p);
      const dailyMin = enabledRules.find(rule => rule.dailyMinOrders)?.dailyMinOrders || 30;

      return {
        driverId: driver.id,
        driverName: driver.name,
        callCount: evaluated.riderData.totalOrders,
        platformRate: evaluated.riderData.platformRate,
        rateLabel: evaluated.riderData.rateLabel,
        acceptRate: evaluated.riderData.platformRate,
        selectedPromotionName: evaluated.riderData.selectedPromotionName || '미선택',
        selectedPromotionType: evaluated.riderData.selectedPromotionName || '미선택',
        finalTotal: evaluated.finalTotal,
        appliedRules: appliedNames,
        failureReasons: evaluated.finalTotal > 0 ? [] : uniqueReasons,
        reason: evaluated.finalTotal > 0 ? '지급' : (uniqueReasons.join(', ') || '지급 대상 없음'),
        eligible: evaluated.finalTotal > 0,
        status: evaluated.finalTotal > 0 ? '지급' : '미지급',
        uploadDays: evaluated.uploadDays,
        qualifyingDays: countDailyQualifyingDays(evaluated.riderData.dailyOrders, dailyMin)
      };
    }).sort((a, b) => a.driverName.localeCompare(b.driverName, 'ko'));
  }

  return {
    WEEKDAY_KEYS,
    weekStartKey,
    weekEndKey,
    weekDateKeys,
    weekOverlapsPromotion,
    getApplicableTier,
    getPlatformRateForDriver,
    getAcceptRateForDriver,
    getRateLabel,
    getPromotionNameById,
    getDriverSelector,
    buildDriverWeekStats,
    buildRiderData,
    checkGlobalRateBlock,
    checkGlobalAcceptanceBlock,
    checkRateCondition,
    checkAcceptanceRateCondition,
    checkTotalOrderCondition,
    checkWorkingDaysCondition,
    checkDailyMinOrdersCondition,
    calculateCountPerOrderPromotion,
    calculateGuaranteedUnitPricePromotion,
    calculatePromotionForRider,
    getPromotionFailureReasons,
    evaluateRule,
    evaluateRuleForDrivers,
    evaluatePreview,
    evaluateCombinedPreview,
    evaluateAllRulesForRider,
    resolveDuplicateResults,
    countDailyQualifyingDays
  };
})();
