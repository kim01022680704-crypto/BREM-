/**
 * 합산 단가보장: 쿠팡+배민 콜수 합으로 구간을 고르고,
 * 쿠팡·배민 배달처리비에 각각 보장액을 적용하는지 검증.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = {
  console,
  window: {},
  document: {
    dispatchEvent() {},
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  },
  CustomEvent: class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
function loadFile(rel) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
}

loadFile('js/platforms.js');
loadFile('js/promotion-engine.js');
vm.runInContext('globalThis.BremPromotionEngine = BremPromotionEngine; globalThis.BremPlatforms = BremPlatforms;', ctx);

ctx.BremStorage = ctx.window.BremStorage = {
  drivers: {
    getById(id) {
      return {
        id,
        name: '테스트기사',
        phone: '01012345678',
        baeminId: 'BC100',
        platformCoupang: true,
        platformBaemin: true
      };
    }
  },
  rejections: { getRateForWeek() { return 5; } },
  promotionRules: {
    getById(id) {
      if (id !== 'rule_combined_guarantee') return null;
      return {
        id: 'rule_combined_guarantee',
        name: '합산단가보장',
        enabled: true,
        platform: 'combined',
        type: 'guaranteed_unit_price',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        callTiers: [
          { minCalls: 100, unitPrice: 4000 },
          { minCalls: 50, unitPrice: 3500 }
        ],
        blockConditions: [],
        bonusConditions: [],
        referenceConditions: []
      };
    }
  },
  promotionSettings: { get() { return {}; } },
  settlements: { getAll() { return []; } },
  calls: {
    getAll() {
      return [
        // 쿠팡 70 + 배민 40 = 110 → 100건 구간(4000원)
        { driverId: 'd1', date: '2026-07-22', platform: 'coupang', count: 70 },
        { driverId: 'd1', date: '2026-07-23', platform: 'baemin', count: 40 }
      ];
    }
  }
};

ctx.BremWeeklySettlement = ctx.window.BremWeeklySettlement = {
  buildDriverCallStatsForPeriod(driverId, startDate, endDate, platform) {
    const p = platform === 'baemin' ? 'baemin' : 'coupang';
    const calls = ctx.window.BremStorage.calls.getAll().filter(c => c.driverId === driverId && c.platform === p);
    const callCount = calls.reduce((s, c) => s + c.count, 0);
    const byDay = {};
    calls.forEach(c => { byDay[c.date] = c.count; });
    return { callCount, deliveryAmount: 0, byDay, uploadDays: calls.length };
  },
  resolveBaeminDriver(rider) {
    return rider?.matchedRiderId ? ctx.window.BremStorage.drivers.getById(rider.matchedRiderId) : null;
  },
  normalizeBaeminUserId(v) { return String(v || '').trim(); }
};

ctx.BremBaeminDeliveryFee = ctx.window.BremBaeminDeliveryFee = {
  lookup() {
    // 배민 40건, 건당 3000원 → 보장 4000이면 건당 1000 보정 × 40 = 40,000
    return {
      orderCount: 40,
      deliveryAmount: 120000,
      avgUnitPrice: 3000,
      deliveryFees: Array(40).fill(3000)
    };
  },
  formatMetaLabel() { return '배민 배달처리비 테스트'; }
};

ctx.BremCoupangDeliveryFee = ctx.window.BremCoupangDeliveryFee = {
  lookup() {
    return null;
  },
  formatMetaLabel() { return '쿠팡 배달처리비 테스트'; }
};

ctx.BremPromotionConditions = ctx.window.BremPromotionConditions = null;
loadFile('js/promotion-apply.js');
vm.runInContext('globalThis.BremPromotionApply = BremPromotionApply;', ctx);

const Apply = ctx.BremPromotionApply;
if (!Apply) {
  console.error('BremPromotionApply 로드 실패');
  process.exit(2);
}
let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${ok ? '' : `  기대=${expected} 실제=${actual}`}`);
}

const coupangSettlement = {
  id: 'c1', platform: 'coupang', channel: 'direct', region: '남구',
  startDate: '2026-07-22', endDate: '2026-07-28',
  riders: [{ matchedRiderId: 'd1', riderName: '테스트기사', coupangLoginKey: '테스트5678' }]
};
const baeminSettlement = {
  id: 'b1', platform: 'baemin', channel: 'direct', region: '남구',
  startDate: '2026-07-22', endDate: '2026-07-28',
  riders: [{ matchedRiderId: 'd1', riderName: '테스트기사', baeminUserId: 'BC100' }]
};

// 1) 배민 수수료만 매칭 (쿠팡 인덱스는 있으나 lookup null → 주간 콜 70 유지)
const result = Apply.applyPromotionToCombinedSettlements(
  coupangSettlement,
  baeminSettlement,
  ['rule_combined_guarantee'],
  {},
  {
    deliveryFeeIndex: { ok: true },
    coupangDeliveryFeeIndex: { size: 1 },
    deliveryFeeMeta: { fileName: 'baemin-fee.xlsx' },
    coupangDeliveryFeeMeta: { fileName: 'coupang-fee.xlsx' }
  }
);

const row = result.results[0];
console.log('\n[합산 단가보장 콜수 합산 — 배민 수수료만]');
check('쿠팡+배민 합산 구분', row.assignmentSource, '쿠팡+배민');
check('합산 콜수 110', row.callCount, 110);
check('쿠팡 70', row.coupangCallCount, 70);
check('배민(배달처리비) 40', row.baeminCallCount, 40);
check('보장단가 4000 (100건 구간)', row.guaranteedUnitPrice, 4000);
check('배민보장 40,000', row.baeminGuaranteeAmount, 40000);
check('쿠팡보장 0', row.coupangGuaranteeAmount, 0);
check('보장금액 40,000', row.guaranteePromotionAmount, 40000);
check('총 프로모션 40,000', row.totalPromotionAmount, 40000);
check('쿠팡 70만 쓰면 안 되는 단가(3500)가 아님', row.guaranteedUnitPrice === 3500, false);

// 2) 쿠팡·배민 수수료 둘 다 — 콜수·보장 각각 적용
ctx.BremCoupangDeliveryFee.lookup = function lookup() {
  // 쿠팡 70건, 건당 3500 → 보장 4000이면 건당 500 × 70 = 35,000
  return {
    orderCount: 70,
    deliveryAmount: 245000,
    avgUnitPrice: 3500,
    deliveryFees: Array(70).fill(3500)
  };
};

const result2 = Apply.applyPromotionToCombinedSettlements(
  coupangSettlement,
  baeminSettlement,
  ['rule_combined_guarantee'],
  {},
  {
    deliveryFeeIndex: { ok: true },
    coupangDeliveryFeeIndex: { size: 1 },
    deliveryFeeMeta: { fileName: 'baemin-fee.xlsx' },
    coupangDeliveryFeeMeta: { fileName: 'coupang-fee.xlsx' }
  }
);
const row2 = result2.results[0];
console.log('\n[합산 단가보장 — 쿠팡·배민 각각 적용]');
check('합산 콜수 110', row2.callCount, 110);
check('쿠팡콜(수수료) 70', row2.coupangCallCount, 70);
check('배민콜(수수료) 40', row2.baeminCallCount, 40);
check('보장단가 4000', row2.guaranteedUnitPrice, 4000);
check('쿠팡보장 35,000', row2.coupangGuaranteeAmount, 35000);
check('배민보장 40,000', row2.baeminGuaranteeAmount, 40000);
check('총 보장 75,000', row2.guaranteePromotionAmount, 75000);
check('총 프로모션 75,000', row2.totalPromotionAmount, 75000);

if (failed) {
  console.error(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log('\n모두 통과');
