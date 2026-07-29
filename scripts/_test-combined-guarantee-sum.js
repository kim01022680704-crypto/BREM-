/**
 * 합산 단가보장: 쿠팡+배민 콜수 합으로 구간을 고르고,
 * 배민 배달처리비로 보장액을 계산하는지 검증.
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

// Minimal stubs
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
  formatMetaLabel() { return '배달처리비 테스트'; }
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

const result = Apply.applyPromotionToCombinedSettlements(
  coupangSettlement,
  baeminSettlement,
  ['rule_combined_guarantee'],
  {},
  { deliveryFeeIndex: { ok: true }, deliveryFeeMeta: { fileName: 'fee.xlsx' } }
);

const row = result.results[0];
console.log('\n[합산 단가보장 콜수 합산]');
check('쿠팡+배민 합산 구분', row.assignmentSource, '쿠팡+배민');
check('합산 콜수 110', row.callCount, 110);
check('쿠팡 70', row.coupangCallCount, 70);
check('배민(배달처리비) 40', row.baeminCallCount, 40);
check('보장단가 4000 (100건 구간)', row.guaranteedUnitPrice, 4000);
check('보장금액 40,000', row.guaranteePromotionAmount, 40000);
check('총 프로모션 40,000', row.totalPromotionAmount, 40000);

// 예전 버그: 겹침→쿠팡이면 쿠팡 70만으로 3500원 구간 → 보장 0 또는 잘못된 금액
check('쿠팡 70만 쓰면 안 되는 단가(3500)가 아님', row.guaranteedUnitPrice === 3500, false);

if (failed) {
  console.error(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log('\n모두 통과');
