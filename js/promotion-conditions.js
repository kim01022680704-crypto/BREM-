const BremPromotionConditions = (function () {
  const MAX_CONDITIONS_PER_MODE = 50;
  const MAX_CALL_TIERS = 50;
  const MIN_SUPPORTED_COUNT = 10;

  const PROCESSING_MODES = {
    block: '미지급 조건',
    bonus: '추가 가산 조건',
    reference: '단순 참고 조건'
  };

  const CONDITION_TYPES = {
    reject_rate_over: {
      label: '거절율 초과',
      platforms: ['coupang'],
      fields: ['rateThreshold']
    },
    reject_rate_under: {
      label: '거절율 이하',
      platforms: ['coupang'],
      fields: ['rateThreshold']
    },
    accept_rate_under: {
      label: '수락률 미만',
      platforms: ['baemin'],
      fields: ['rateThreshold']
    },
    accept_rate_over: {
      label: '수락률 이상',
      platforms: ['baemin'],
      fields: ['rateThreshold']
    },
    total_orders_under: {
      label: '총 콜수 미달',
      platforms: ['coupang', 'baemin'],
      fields: ['minTotalOrders']
    },
    total_orders_over: {
      label: '총 콜수 이상',
      platforms: ['coupang', 'baemin'],
      fields: ['minTotalOrders']
    },
    working_days: {
      label: '주 근무일',
      platforms: ['coupang', 'baemin'],
      fields: ['minWorkingDays', 'dailyMinOrders']
    },
    daily_min_days: {
      label: '일일 최소 콜 달성일',
      platforms: ['coupang', 'baemin'],
      fields: ['dailyMinOrders', 'minDailyOrderDays']
    }
  };

  const BONUS_ACTION_TYPES = {
    add_pay_per_order: '건당 추가 지급',
    fixed_bonus: '정액 추가 지급',
    guarantee_unit_add: '보장단가 추가',
    percent_bonus: '프로모션 비율 추가'
  };

  function createId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function normalizePlatform(platform) {
    if (typeof BremPlatforms !== 'undefined') return BremPlatforms.normalize(platform);
    if (platform === 'combined') return 'combined';
    return platform === 'baemin' ? 'baemin' : 'coupang';
  }

  function normalizeCondition(raw = {}, index = 0) {
    return {
      id: raw.id || createId(),
      conditionName: String(raw.conditionName || '').trim(),
      conditionType: raw.conditionType || 'working_days',
      processingMode: raw.processingMode || 'block',
      rateThreshold: Number(raw.rateThreshold ?? 0),
      minTotalOrders: Number(raw.minTotalOrders ?? 0),
      minWorkingDays: Number(raw.minWorkingDays ?? 6),
      dailyMinOrders: Number(raw.dailyMinOrders ?? 30),
      minDailyOrderDays: Number(raw.minDailyOrderDays ?? 6),
      actionType: raw.actionType || 'add_pay_per_order',
      addPayPerOrder: Number(raw.addPayPerOrder ?? 0),
      fixedBonus: Number(raw.fixedBonus ?? 0),
      bonusPercent: Number(raw.bonusPercent ?? 0),
      guaranteeUnitAdd: Number(raw.guaranteeUnitAdd ?? 0),
      sortOrder: Number(raw.sortOrder ?? index)
    };
  }

  function normalizeBase(raw = {}, legacy = {}) {
    return {
      baseCallCount: Number(raw.baseCallCount ?? legacy.baseCallCount ?? legacy.minOrders ?? 0),
      payStartCallCount: Number(raw.payStartCallCount ?? legacy.payStartCallCount ?? legacy.payStartOrder ?? 0),
      payPerCall: Number(raw.payPerCall ?? legacy.payPerCall ?? legacy.payPerOrder ?? 0),
      guaranteedUnitPrice: Number(raw.guaranteedUnitPrice ?? legacy.guaranteedUnitPrice ?? 0),
      callTiers: Array.isArray(raw.callTiers ?? legacy.callTiers) ? raw.callTiers : []
    };
  }

  function splitConditionsByMode(conditions = []) {
    const blockConditions = [];
    const bonusConditions = [];
    const referenceConditions = [];
    conditions.forEach((item, index) => {
      const normalized = normalizeCondition(item, index);
      if (normalized.processingMode === 'bonus') bonusConditions.push(normalized);
      else if (normalized.processingMode === 'reference') referenceConditions.push(normalized);
      else blockConditions.push(normalized);
    });
    return { blockConditions, bonusConditions, referenceConditions };
  }

  function migrateLegacyRule(rule) {
    if (rule.base && (Array.isArray(rule.blockConditions) || Array.isArray(rule.bonusConditions))) {
      return {
        base: normalizeBase(rule.base, rule),
        blockConditions: (rule.blockConditions || []).map(normalizeCondition),
        bonusConditions: (rule.bonusConditions || []).map(normalizeCondition),
        referenceConditions: (rule.referenceConditions || []).map(normalizeCondition)
      };
    }

    if (Array.isArray(rule.conditions) && rule.conditions.length) {
      const split = splitConditionsByMode(rule.conditions);
      return { base: normalizeBase(rule.base || {}, rule), ...split };
    }

    const platform = normalizePlatform(rule.platform);
    const base = normalizeBase({}, rule);
    const blockConditions = [];
    const bonusConditions = [];
    const referenceConditions = [];

    if (platform === 'baemin' && Number(rule.minRate ?? rule.minAcceptRate ?? 0) > 0) {
      blockConditions.push(normalizeCondition({
        conditionName: `수락률 ${rule.minRate ?? rule.minAcceptRate}% 미만 미지급`,
        conditionType: 'accept_rate_under',
        processingMode: 'block',
        rateThreshold: Number(rule.minRate ?? rule.minAcceptRate ?? 0)
      }));
    }
    if (platform === 'coupang' && Number(rule.maxRate ?? rule.maxAcceptRate ?? 15) < 100) {
      blockConditions.push(normalizeCondition({
        conditionName: `거절율 ${rule.maxRate ?? rule.maxAcceptRate}% 초과 미지급`,
        conditionType: 'reject_rate_over',
        processingMode: 'block',
        rateThreshold: Number(rule.maxRate ?? rule.maxAcceptRate ?? 15)
      }));
    }
    if (Number(base.baseCallCount) > 0) {
      blockConditions.push(normalizeCondition({
        conditionName: `총 콜수 ${base.baseCallCount}건 미달 미지급`,
        conditionType: 'total_orders_under',
        processingMode: 'block',
        minTotalOrders: base.baseCallCount
      }));
    }
    if (rule.requireMinWorkingDays) {
      const item = normalizeCondition({
        conditionName: `주 ${rule.minWorkingDays ?? 6}일 조건`,
        conditionType: 'working_days',
        processingMode: rule.blockOnWorkingDaysFail === false ? 'bonus' : 'block',
        minWorkingDays: Number(rule.minWorkingDays ?? 6),
        dailyMinOrders: Number(rule.dailyMinOrders ?? 30),
        actionType: 'add_pay_per_order',
        addPayPerOrder: 0
      });
      if (item.processingMode === 'bonus') bonusConditions.push(item);
      else blockConditions.push(item);
    }
    if (rule.requireDailyMinOrders) {
      const item = normalizeCondition({
        conditionName: `하루 ${rule.dailyMinOrders ?? 30}건 ${rule.minDailyOrderDays ?? 6}일 조건`,
        conditionType: 'daily_min_days',
        processingMode: rule.blockOnDailyMinFail === false ? 'bonus' : 'block',
        dailyMinOrders: Number(rule.dailyMinOrders ?? 30),
        minDailyOrderDays: Number(rule.minDailyOrderDays ?? 6),
        actionType: 'add_pay_per_order',
        addPayPerOrder: 0
      });
      if (item.processingMode === 'bonus') bonusConditions.push(item);
      else blockConditions.push(item);
    }

    return { base, blockConditions, bonusConditions, referenceConditions };
  }

  function conditionTypesForPlatform(platform, processingMode) {
    const p = normalizePlatform(platform);
    return Object.entries(CONDITION_TYPES)
      .filter(([, meta]) => p === 'combined' || meta.platforms.includes(p))
      .filter(([type]) => {
        if (processingMode === 'block') {
          return ['reject_rate_over', 'accept_rate_under', 'total_orders_under', 'working_days', 'daily_min_days'].includes(type);
        }
        if (processingMode === 'bonus') {
          return ['reject_rate_under', 'accept_rate_over', 'total_orders_over', 'working_days', 'daily_min_days'].includes(type);
        }
        return true;
      })
      .map(([value, meta]) => ({ value, label: meta.label }));
  }

  function isRateConditionType(type) {
    return ['reject_rate_over', 'reject_rate_under', 'accept_rate_under', 'accept_rate_over'].includes(type);
  }

  function defaultRateConditionType(processingMode, platform) {
    const p = normalizePlatform(platform);
    if (processingMode === 'bonus') {
      return p === 'baemin' ? 'accept_rate_over' : 'reject_rate_under';
    }
    return p === 'baemin' ? 'accept_rate_under' : 'reject_rate_over';
  }

  function resolveRateCondition(condition, platform) {
    const normalized = normalizeCondition(condition);
    const p = normalizePlatform(platform);
    let type = normalized.conditionType;
    let threshold = Number(normalized.rateThreshold ?? 0);

    if (!isRateConditionType(type)) {
      return normalized;
    }

    if (p === 'coupang') {
      if (type === 'accept_rate_over') {
        type = 'reject_rate_under';
        threshold = 100 - threshold;
      } else if (type === 'accept_rate_under') {
        type = 'reject_rate_over';
        threshold = 100 - threshold;
      }
    } else if (p === 'baemin') {
      if (type === 'reject_rate_under') {
        type = 'accept_rate_over';
        threshold = threshold > 50 ? threshold : 100 - threshold;
      } else if (type === 'reject_rate_over') {
        type = 'accept_rate_under';
        threshold = threshold > 50 ? 100 - threshold : threshold;
      }
    }

    return {
      ...normalized,
      conditionType: type,
      rateThreshold: threshold
    };
  }

  function formatConditionLabel(condition, platform) {
    const resolved = resolveRateCondition(condition, platform);
    const type = resolved.conditionType;
    const threshold = Number(resolved.rateThreshold ?? 0);
    const mode = resolved.processingMode || condition.processingMode || 'block';

    if (type === 'reject_rate_over') {
      return mode === 'block'
        ? `거절율 ${threshold}% 초과 미지급`
        : `거절율 ${threshold}% 초과`;
    }
    if (type === 'reject_rate_under') {
      return mode === 'bonus'
        ? `거절율 ${threshold}% 이하`
        : `거절율 ${threshold}% 미만`;
    }
    if (type === 'accept_rate_under') {
      return mode === 'block'
        ? `수락률 ${threshold}% 미만 미지급`
        : `수락률 ${threshold}% 미만`;
    }
    if (type === 'accept_rate_over') {
      return mode === 'bonus'
        ? `수락률 ${threshold}% 이상`
        : `수락률 ${threshold}% 이상`;
    }

    const custom = String(resolved.conditionName || condition.conditionName || '').trim();
    if (custom) return custom;
    return CONDITION_TYPES[type]?.label || type;
  }

  function syncRateConditionName(condition, platform) {
    const normalized = normalizeCondition(condition);
    if (!isRateConditionType(normalized.conditionType)) return normalized;
    return {
      ...normalized,
      conditionName: formatConditionLabel(normalized, platform)
    };
  }

  function emptyCondition(processingMode = 'block', platform = 'coupang') {
    const p = normalizePlatform(platform);
    if (processingMode === 'bonus') {
      return syncRateConditionName(normalizeCondition({
        conditionName: '',
        conditionType: 'working_days',
        processingMode,
        actionType: 'add_pay_per_order'
      }), p);
    }
    return normalizeCondition({
      conditionName: '',
      conditionType: 'total_orders_under',
      processingMode,
      actionType: 'add_pay_per_order'
    });
  }

  function filterFilledConditions(conditions = []) {
    return (conditions || []).filter(item => String(item?.conditionName || '').trim());
  }

  return {
    MAX_CONDITIONS_PER_MODE,
    MAX_CALL_TIERS,
    MIN_SUPPORTED_COUNT,
    PROCESSING_MODES,
    CONDITION_TYPES,
    BONUS_ACTION_TYPES,
    filterFilledConditions,
    normalizeCondition,
    normalizeBase,
    migrateLegacyRule,
    conditionTypesForPlatform,
    emptyCondition,
    createId,
    isRateConditionType,
    defaultRateConditionType,
    resolveRateCondition,
    formatConditionLabel,
    syncRateConditionName
  };
})();
