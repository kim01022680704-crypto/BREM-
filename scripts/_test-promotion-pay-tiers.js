/**
 * 소급 단가 구간 + 프로모션 적용 채널 분리 검증.
 *
 * 확인 대상
 *  1) 소급 단가 구간이 지급 시작 콜수 이후 전체 콜에 소급 적용되는지
 *  2) 여러 구간을 달성해도 가장 높은 하나만 적용되는지 (합산 금지)
 *  3) 구간이 없는 기존 프로모션 금액이 한 원도 변하지 않는지
 *  4) 프로모션 적용 정산서 목록이 브로/직계약을 섞지 않는지
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}\n        기대: ${expected}\n        실제: ${actual}`);
  }
}

// 브라우저 모듈들은 `const BremX = (function(){...})()` 형태라 vm 컨텍스트에서
// 전역 프로퍼티로 잡히지 않는다. 마지막에 globalThis로 옮겨서 꺼낸다.
function makeSandbox(extra = {}) {
  const sandbox = {
    console,
    Math,
    Number,
    String,
    Array,
    Object,
    Boolean,
    Date,
    JSON,
    Set,
    Map,
    isNaN,
    parseFloat,
    parseInt,
    BremPlatforms: {
      normalize: p => (p === 'baemin' ? 'baemin' : (p === 'combined' ? 'combined' : 'coupang')),
      label: p => p
    },
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    ...extra
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

function loadModules(files, extra = {}, exportNames = []) {
  const sandbox = makeSandbox(extra);
  const context = vm.createContext(sandbox);
  files.forEach(file => {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(code, context, { filename: file });
  });
  exportNames.forEach(name => {
    vm.runInContext(`globalThis.${name} = typeof ${name} !== 'undefined' ? ${name} : undefined;`, context);
  });
  return sandbox;
}

const env = loadModules(
  ['js/promotion-conditions.js', 'js/promotion-engine.js'],
  {},
  ['BremPromotionConditions', 'BremPromotionEngine']
);
const engine = env.BremPromotionEngine;
if (!engine || typeof engine.calculatePromotionForRider !== 'function') {
  console.error('프로모션 엔진을 불러오지 못했습니다.');
  process.exit(1);
}

const SETTINGS = { blockOnLowAcceptRate: false, acceptRateThreshold: 0 };

function makeRule(overrides = {}) {
  const base = {
    baseCallCount: 0,
    payStartCallCount: 101,
    payPerCall: 1000,
    guaranteedUnitPrice: 0,
    callTiers: [],
    payPerCallTiers: [],
    ...(overrides.base || {})
  };
  return {
    id: 'rule-1',
    name: '테스트 프로모션',
    type: 'count_per_order',
    platform: 'coupang',
    enabled: true,
    startDate: '2026-01-01',
    endDate: '2099-12-31',
    base,
    blockConditions: [],
    bonusConditions: overrides.bonusConditions || [],
    referenceConditions: [],
    applyGlobalAcceptBlock: false,
    priority: 100,
    ...overrides,
    base
  };
}

function calcFor(rule, totalOrders) {
  return engine.calculatePromotionForRider(
    rule,
    {
      driverId: 'd1',
      platform: 'coupang',
      totalOrders,
      rejectRate: 0,
      acceptRate: 100,
      dailyOrders: [],
      weekStart: '2026-07-29',
      weekEnd: '2026-08-04',
      selectedPromotionRuleId: rule.id
    },
    SETTINGS
  );
}

function amountFor(rule, totalOrders) {
  return calcFor(rule, totalOrders).totalBonus;
}

console.log('\n[1] 구간 없는 기존 프로모션 — 금액 불변');
{
  const rule = makeRule();
  check('총 100건 → 지급 시작 미달 0원', amountFor(rule, 100), 0);
  check('총 101건 → 1건 × 1,000원', amountFor(rule, 101), 1000);
  check('총 160건 → 60건 × 1,000원', amountFor(rule, 160), 60000);
  check('총 300건 → 200건 × 1,000원', amountFor(rule, 300), 200000);
  check('총 400건 → 300건 × 1,000원', amountFor(rule, 400), 300000);
}

console.log('\n[2] 소급 단가 구간 — 사용자 요청 시나리오');
{
  const rule = makeRule({
    base: {
      payStartCallCount: 101,
      payPerCall: 1000,
      payPerCallTiers: [
        { id: 't1', minCalls: 300, payPerCall: 1200 },
        { id: 't2', minCalls: 400, payPerCall: 1500 }
      ]
    }
  });

  check('총 100건 → 지급 시작 미달 0원', amountFor(rule, 100), 0);
  check('총 200건 → 구간 미달, 100건 × 1,000원', amountFor(rule, 200), 100000);
  check('총 299건 → 구간 미달, 199건 × 1,000원', amountFor(rule, 299), 199000);
  check('총 300건 → 200건 × 1,200원 (소급)', amountFor(rule, 300), 240000);
  check('총 350건 → 250건 × 1,200원', amountFor(rule, 350), 300000);
  check('총 399건 → 299건 × 1,200원', amountFor(rule, 399), 358800);
  check('총 400건 → 300건 × 1,500원 (최고 구간만)', amountFor(rule, 400), 450000);
  check('총 500건 → 400건 × 1,500원', amountFor(rule, 500), 600000);
}

console.log('\n[3] 구간 합산 금지 확인');
{
  const rule = makeRule({
    base: {
      payStartCallCount: 101,
      payPerCall: 1000,
      payPerCallTiers: [
        { id: 't1', minCalls: 300, payPerCall: 1200 },
        { id: 't2', minCalls: 400, payPerCall: 1500 }
      ]
    }
  });
  const at400 = amountFor(rule, 400);
  check('400건이 1,200+1,500 합산(810,000원)이 아니다', at400 === 810000, false);
  check('400건이 기본+구간 합산(750,000원)이 아니다', at400 === 750000, false);
  check('400건은 정확히 450,000원', at400, 450000);
}

console.log('\n[4] 구간 순서가 뒤집혀 저장돼도 금액 동일');
{
  const reversed = makeRule({
    base: {
      payStartCallCount: 101,
      payPerCall: 1000,
      payPerCallTiers: [
        { id: 't2', minCalls: 400, payPerCall: 1500 },
        { id: 't1', minCalls: 300, payPerCall: 1200 }
      ]
    }
  });
  check('총 300건 → 240,000원', amountFor(reversed, 300), 240000);
  check('총 400건 → 450,000원', amountFor(reversed, 400), 450000);
}

console.log('\n[5] 구간 단가가 기본보다 낮게 설정된 경우 — 설정한 값을 그대로 따른다');
{
  const rule = makeRule({
    base: {
      payStartCallCount: 101,
      payPerCall: 1000,
      payPerCallTiers: [{ id: 't1', minCalls: 300, payPerCall: 800 }]
    }
  });
  check('총 300건 → 200건 × 800원', amountFor(rule, 300), 160000);
}

console.log('\n[6] 추가 가산 조건과 함께 쓸 때 — 가산은 소급 단가에 그대로 더해진다');
{
  const rule = makeRule({
    base: {
      payStartCallCount: 101,
      payPerCall: 1000,
      payPerCallTiers: [{ id: 't1', minCalls: 300, payPerCall: 1200 }]
    },
    bonusConditions: [{
      id: 'b1',
      conditionName: '정액',
      conditionType: 'total_orders_over',
      processingMode: 'bonus',
      minTotalOrders: 300,
      actionType: 'fixed_bonus',
      fixedBonus: 50000
    }]
  });
  check('총 300건 → 240,000 + 50,000', amountFor(rule, 300), 290000);
  check('총 200건 → 가산 미충족 100,000원', amountFor(rule, 200), 100000);
}

console.log('\n[7] 프로모션 적용 — 브로/직계약 정산서 목록 분리');
{
  const broRecords = [{
    id: 'bro-1', platform: 'coupang', region: '브로강남',
    startDate: '2026-07-29', endDate: '2026-08-04', riders: [], uploadedAt: '2026-07-29T00:00:00Z'
  }];
  const directRecords = [{
    id: 'direct-1', platform: 'coupang', region: '직계약강남',
    startDate: '2026-07-29', endDate: '2026-08-04', riders: [], uploadedAt: '2026-07-29T00:00:00Z'
  }];

  const storageStub = {
    weeklySettlements: {
      getAll: channel => (channel === 'direct' ? directRecords : broRecords),
      getById: (id, channel) => (channel === 'direct' ? directRecords : broRecords).find(r => r.id === id) || null
    },
    resolveWeeklySettlementPlatform: record => record.platform,
    promotionSettings: { get: () => SETTINGS },
    promotionRules: { getById: () => null, getAll: () => [] },
    drivers: { getAll: () => [] },
    calls: { getAll: () => [] },
    rejections: { getAll: () => [] },
    createId: () => 'generated-id'
  };

  const sandbox = loadModules(
    ['js/promotion-conditions.js', 'js/promotion-engine.js', 'js/promotion-apply.js'],
    { BremStorage: storageStub },
    ['BremPromotionApply']
  );

  const apply = sandbox.BremPromotionApply;
  const broOptions = apply.getSettlementOptions('coupang', { channel: 'bro' });
  const directOptions = apply.getSettlementOptions('coupang', { channel: 'direct' });

  check('브로 목록 1건', broOptions.length, 1);
  check('브로 목록에 브로 정산서', broOptions[0]?.id, 'bro-1');
  check('직계약 목록 1건', directOptions.length, 1);
  check('직계약 목록에 직계약 정산서', directOptions[0]?.id, 'direct-1');
  check('직계약 목록에 브로가 섞이지 않음', directOptions.some(o => o.id === 'bro-1'), false);

  const defaultOptions = apply.getSettlementOptions('coupang', {});
  check('채널 미지정은 브로 (기존 동작 유지)', defaultOptions[0]?.id, 'bro-1');

  const result = apply.applyPromotionToSettlement(directRecords[0], [], SETTINGS, {
    channel: 'direct',
    assignmentMode: 'per_driver'
  });
  check('계산 결과에 channel=direct', result.channel, 'direct');

  const broResult = apply.applyPromotionToSettlement(broRecords[0], [], SETTINGS, {
    channel: 'bro',
    assignmentMode: 'per_driver'
  });
  check('브로 계산 결과에 channel=bro', broResult.channel, 'bro');
}

console.log('\n[8] 저장 레코드 정규화 — channel 왕복');
{
  const sandbox = loadModules(['js/storage-supabase-mapper.js']);
  const mapper = sandbox.BremSupabaseMapper;

  const directRow = mapper.promotionApplyResultToRow({ id: 'r1', platform: 'coupang', channel: 'direct', results: [] });
  check('DB 저장 시 meta.channel=direct', directRow.meta.channel, 'direct');
  check('DB 복원 시 channel=direct', mapper.rowToPromotionApplyResult(directRow).channel, 'direct');

  const broRow = mapper.promotionApplyResultToRow({ id: 'r2', platform: 'coupang', results: [] });
  check('channel 미지정 저장 시 bro', broRow.meta.channel, 'bro');

  const legacyRow = { id: 'r3', platform: 'coupang', meta: {}, rows: [], summary: {} };
  check('기존 저장본(meta에 channel 없음)은 bro로 읽힘', mapper.rowToPromotionApplyResult(legacyRow).channel, 'bro');
}

console.log(`\n결과: ${pass}건 통과, ${fail}건 실패`);
process.exit(fail ? 1 : 0);
