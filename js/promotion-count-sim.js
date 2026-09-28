/**
 * 건당 프로모션 예상 금액. 기사앱 미션 시뮬레이션용.
 * 거절율·미지급 조건은 넣지 않고, 콜수 × 건당 단가만 본다.
 */
window.BremPromotionCountSim = (function () {
  function num(value) {
    const n = Math.round(Number(value || 0));
    return Number.isFinite(n) ? n : 0;
  }

  function extract(source) {
    if (!source || typeof source !== 'object') return null;
    if (source.countPaySim && typeof source.countPaySim === 'object') {
      return extract(source.countPaySim);
    }
    const type = String(source.type || '').trim();
    if (type === 'guaranteed_unit_price') return null;
    const base = source.base && typeof source.base === 'object' ? source.base : source;
    const payStartCallCount = num(base.payStartCallCount ?? source.payStartCallCount);
    const payPerCall = num(base.payPerCall ?? source.payPerCall);
    const tiers = (Array.isArray(base.payPerCallTiers) ? base.payPerCallTiers : source.payPerCallTiers || [])
      .map(tier => ({
        minCalls: num(tier?.minCalls),
        payPerCall: num(tier?.payPerCall)
      }))
      .filter(tier => tier.minCalls > 0 && tier.payPerCall > 0)
      .sort((a, b) => a.minCalls - b.minCalls);
    if (payStartCallCount <= 0 || payPerCall <= 0) return null;
    if (type && type !== 'count_per_order' && type !== 'both') return null;
    return {
      type: type || 'count_per_order',
      payStartCallCount,
      payPerCall,
      payPerCallTiers: tiers,
      payPerCallTierMode: String(base.payPerCallTierMode ?? source.payPerCallTierMode ?? '') === 'step'
        ? 'step'
        : 'retroactive'
    };
  }

  function resolveRate(config, totalOrders) {
    const calls = num(totalOrders);
    let payPerCall = num(config?.payPerCall);
    let appliedTier = null;
    (config?.payPerCallTiers || []).forEach(tier => {
      if (calls >= tier.minCalls && tier.payPerCall > 0) {
        payPerCall = tier.payPerCall;
        appliedTier = tier;
      }
    });
    return { payPerCall, appliedTier };
  }

  function simulate(config, totalOrders) {
    const calls = num(totalOrders);
    const payStart = num(config?.payStartCallCount);
    const resolved = resolveRate(config, calls);
    if (!config || payStart <= 0 || resolved.payPerCall <= 0) {
      return { calls, amount: 0, paidCallCount: 0, payPerCall: 0, remainToStart: 0, started: false };
    }
    if (calls < payStart) {
      return {
        calls,
        amount: 0,
        paidCallCount: 0,
        payPerCall: resolved.payPerCall,
        remainToStart: payStart - calls,
        started: false,
        appliedTier: resolved.appliedTier
      };
    }
    if (config.payPerCallTierMode === 'step') {
      const cuts = [{ from: payStart, rate: num(config.payPerCall) }];
      (config.payPerCallTiers || [])
        .filter(tier => tier.minCalls > payStart && tier.payPerCall > 0)
        .forEach(tier => {
          if (cuts[cuts.length - 1].from !== tier.minCalls) {
            cuts.push({ from: tier.minCalls, rate: tier.payPerCall });
          }
        });
      let amount = 0;
      let paidCallCount = 0;
      for (let index = 0; index < cuts.length; index += 1) {
        const from = cuts[index].from;
        const nextFrom = index + 1 < cuts.length ? cuts[index + 1].from : calls + 1;
        const end = Math.min(calls, nextFrom - 1);
        if (end < from) continue;
        const count = end - from + 1;
        amount += count * cuts[index].rate;
        paidCallCount += count;
      }
      return {
        calls,
        amount,
        paidCallCount,
        payPerCall: 0,
        remainToStart: 0,
        started: true,
        appliedTier: null
      };
    }
    const paidCallCount = calls - payStart + 1;
    return {
      calls,
      amount: paidCallCount * resolved.payPerCall,
      paidCallCount,
      payPerCall: resolved.payPerCall,
      remainToStart: 0,
      started: true,
      appliedTier: resolved.appliedTier
    };
  }

  function breakpoints(config) {
    if (!config) return [];
    const start = num(config.payStartCallCount);
    const points = new Set([start]);
    (config.payPerCallTiers || []).forEach(tier => {
      if (tier.minCalls >= start) points.add(tier.minCalls);
    });
    [150, 200, 250, 300, 350, 400, 500].forEach(value => {
      if (value > start) points.add(value);
    });
    const lastTier = (config.payPerCallTiers || []).reduce((max, tier) => Math.max(max, tier.minCalls), start);
    const cap = Math.max(lastTier + 50, start + 150, 300);
    return [...points]
      .filter(value => value >= start && value <= cap)
      .sort((a, b) => a - b)
      .map(calls => simulate(config, calls));
  }

  return { extract, simulate, breakpoints, resolveRate };
})();
