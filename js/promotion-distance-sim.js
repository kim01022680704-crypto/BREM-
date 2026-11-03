/**
 * 거리 프로모션 예상 금액. 기사앱 미션 시뮬레이션용.
 * 거절율·미지급 조건은 넣지 않고, 거리 × 단위당 단가만 본다.
 * 거리 임계값(시작 거리·구간)은 km, 단가는 원/단위(km 또는 100m)로 둔다.
 */
window.BremPromotionDistanceSim = (function () {
  function num(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function unitKmOf(unit) {
    return String(unit) === '100m' ? 0.1 : 1;
  }

  function unitLabel(unit) {
    return String(unit) === '100m' ? '100m' : 'km';
  }

  function extract(source) {
    if (!source || typeof source !== 'object') return null;
    if (source.distancePaySim && typeof source.distancePaySim === 'object') {
      return extract(source.distancePaySim);
    }
    const base = source.base && typeof source.base === 'object' ? source.base : source;
    const d = base.distance && typeof base.distance === 'object'
      ? base.distance
      : (source.distance && typeof source.distance === 'object' ? source.distance : null);
    if (!d) return null;
    const type = String(source.type || '').trim();
    const enabled = d.enabled === true || type === 'distance';
    if (!enabled) return null;
    const payPerUnit = num(d.payPerUnit);
    const tiers = (Array.isArray(d.tiers) ? d.tiers : [])
      .map(tier => ({ minKm: num(tier?.minKm), payPerUnit: num(tier?.payPerUnit) }))
      .filter(tier => tier.minKm > 0 && tier.payPerUnit > 0)
      .sort((a, b) => a.minKm - b.minKm);
    if (payPerUnit <= 0 && !tiers.length) return null;
    return {
      unit: String(d.unit) === '100m' ? '100m' : 'km',
      startKm: num(d.startKm),
      payPerUnit,
      tiers,
      tierMode: String(d.tierMode) === 'step' ? 'step' : 'retroactive'
    };
  }

  function resolveRate(config, totalKm) {
    let rate = num(config?.payPerUnit);
    let appliedTier = null;
    (config?.tiers || []).forEach(tier => {
      if (totalKm >= tier.minKm && tier.payPerUnit > 0) {
        rate = tier.payPerUnit;
        appliedTier = tier;
      }
    });
    return { rate, appliedTier };
  }

  function simulate(config, totalKm) {
    const km = num(totalKm);
    if (!config) {
      return { km, amount: 0, payableKm: 0, rate: 0, remainToStart: 0, started: false };
    }
    const startKm = num(config.startKm);
    const unitKm = unitKmOf(config.unit);
    if (km < startKm) {
      return { km, amount: 0, payableKm: 0, rate: 0, remainToStart: startKm - km, started: false };
    }
    const payableKm = Math.max(0, km - startKm);
    if (payableKm <= 0) {
      return { km, amount: 0, payableKm: 0, rate: 0, remainToStart: 0, started: false };
    }
    if (config.tierMode === 'step' && (config.tiers || []).length) {
      const cuts = [{ from: startKm, rate: num(config.payPerUnit) }];
      (config.tiers || [])
        .filter(tier => tier.minKm > startKm && tier.payPerUnit > 0)
        .forEach(tier => {
          if (cuts[cuts.length - 1].from !== tier.minKm) cuts.push({ from: tier.minKm, rate: tier.payPerUnit });
        });
      cuts.sort((a, b) => a.from - b.from);
      let amount = 0;
      for (let i = 0; i < cuts.length; i += 1) {
        const from = cuts[i].from;
        const to = i + 1 < cuts.length ? cuts[i + 1].from : Infinity;
        const segKm = Math.max(0, Math.min(km, to) - from);
        if (segKm > 0) amount += (segKm / unitKm) * cuts[i].rate;
      }
      return { km, amount: Math.round(amount), payableKm, rate: 0, remainToStart: 0, started: true };
    }
    const resolved = resolveRate(config, km);
    const amount = (payableKm / unitKm) * resolved.rate;
    return {
      km,
      amount: Math.round(amount),
      payableKm,
      rate: resolved.rate,
      appliedTier: resolved.appliedTier,
      remainToStart: 0,
      started: resolved.rate > 0
    };
  }

  function breakpoints(config) {
    if (!config) return [];
    const start = num(config.startKm);
    const points = new Set([start]);
    (config.tiers || []).forEach(tier => { if (tier.minKm >= start) points.add(tier.minKm); });
    [50, 100, 150, 200, 250, 300, 400, 500].forEach(value => { if (value > start) points.add(value); });
    const lastTier = (config.tiers || []).reduce((max, tier) => Math.max(max, tier.minKm), start);
    const cap = Math.max(lastTier + 100, start + 200, 300);
    return [...points]
      .filter(value => value >= start && value <= cap)
      .sort((a, b) => a - b)
      .map(km => simulate(config, km));
  }

  return { extract, simulate, breakpoints, resolveRate, unitLabel, unitKmOf };
})();
