const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { window: {} };
ctx.window = ctx;
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '..', 'js/promotion-count-sim.js'), 'utf8'),
  ctx,
  { filename: 'promotion-count-sim.js' }
);

const S = ctx.window.BremPromotionCountSim;
let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${ok ? '' : `  기대=${expected} 실제=${actual}`}`);
}

const rule = {
  type: 'count_per_order',
  payStartCallCount: 141,
  payPerCall: 1000,
  payPerCallTiers: [
    { minCalls: 300, payPerCall: 1200 },
    { minCalls: 400, payPerCall: 1500 }
  ]
};

const cfg = S.extract(rule);
check('설정 추출', cfg.payStartCallCount, 141);

const before = S.simulate(cfg, 87);
check('141 전은 0원', before.amount, 0);
check('남은 콜', before.remainToStart, 54);

const first = S.simulate(cfg, 141);
check('141콜 1건', first.paidCallCount, 1);
check('141콜 1,000원', first.amount, 1000);

const mid = S.simulate(cfg, 160);
check('160콜 20건', mid.paidCallCount, 20);
check('160콜 20,000원', mid.amount, 20000);

const t300 = S.simulate(cfg, 300);
check('300콜은 소급 1,200원', t300.payPerCall, 1200);
check('300콜 160×1,200 (141부터)', t300.amount, 192000);

const t400 = S.simulate(cfg, 400);
check('400콜은 소급 1,500원', t400.payPerCall, 1500);
check('400콜 260×1,500 (141부터)', t400.amount, 390000);

const from101 = S.extract({
  type: 'count_per_order',
  payStartCallCount: 101,
  payPerCall: 1000,
  payPerCallTiers: [
    { minCalls: 300, payPerCall: 1200 },
    { minCalls: 400, payPerCall: 1500 }
  ]
});
check('101부터 400콜은 300×1,500', S.simulate(from101, 400).amount, 450000);

check('단가보장은 없음', S.extract({ type: 'guaranteed_unit_price', payStartCallCount: 1, payPerCall: 1000 }), null);

const nested = S.extract({
  type: 'both',
  base: { payStartCallCount: 101, payPerCall: 1000, payPerCallTiers: [] }
});
check('base 중첩도 읽음', nested.payStartCallCount, 101);

console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
process.exit(failed ? 1 : 0);
