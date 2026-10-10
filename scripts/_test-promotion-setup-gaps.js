/**
 * 프로모션 적용: 미지급 조건은 빼고, 미션/지역/매칭 누락만 팝업 대상으로 잡는지 검증.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}\n        기대: ${JSON.stringify(expected)}\n        실제: ${JSON.stringify(actual)}`);
  }
}

const drivers = {
  d1: { id: 'd1', name: '김근무', regionBaemin: '', regionCoupang: '' },
  d2: { id: 'd2', name: '이지역', regionBaemin: '을지로', regionCoupang: '' }
};

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
  BremPlatforms: {
    normalize: p => (p === 'baemin' ? 'baemin' : (p === 'combined' ? 'combined' : 'coupang')),
    label: p => (p === 'baemin' ? '배민' : (p === 'combined' ? '합산' : '쿠팡'))
  },
  BremStorage: {
    drivers: {
      getById: id => drivers[id] || null
    }
  },
  document: {
    readyState: 'complete',
    addEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'js/promotion-apply.js'), 'utf8'),
  sandbox,
  { filename: 'js/promotion-apply.js' }
);
vm.runInContext('globalThis.BremPromotionApply = typeof BremPromotionApply !== "undefined" ? BremPromotionApply : window.BremPromotionApply;', sandbox);

const apply = sandbox.BremPromotionApply;
if (!apply?.collectPromotionSetupGaps || !apply?.isUnpaidConditionReason) {
  console.error('누락 분류 함수를 불러오지 못했습니다.');
  process.exit(1);
}

check('거절율 초과는 미지급', apply.isUnpaidConditionReason('거절율 10% 초과 (15%)'), true);
check('수락률 미만은 미지급', apply.isUnpaidConditionReason('수락률 80% 미만 (70%)'), true);
check('콜수 미달은 미지급', apply.isUnpaidConditionReason('총 콜수 100건 미만 (40건)'), true);
check('미션 미배정은 누락', apply.isUnpaidConditionReason('미션 미배정 (미션 관리에서 기사별 배정)'), false);
check('수락률 미등록은 누락', apply.isUnpaidConditionReason('수락률 미등록'), false);
check('배달처리비 없음은 누락', apply.isUnpaidConditionReason('단가보장은 배민 배달처리비 정산서 업로드가 필요합니다'), false);

const gaps = apply.collectPromotionSetupGaps({
  platform: 'baemin',
  results: [
    {
      matchedRiderId: 'd1',
      displayName: '김근무',
      totalPromotionAmount: 0,
      failureReasons: ['미션 미배정 (미션 관리에서 기사별 배정)']
    },
    {
      matchedRiderId: 'd2',
      displayName: '이지역',
      ruleName: '배민 기본',
      totalPromotionAmount: 0,
      failureReasons: ['수락률 80% 미만 (70%)']
    },
    {
      matchedRiderId: 'd2',
      displayName: '이지역',
      ruleName: '배민 기본',
      totalPromotionAmount: 0,
      failureReasons: ['수락률 미등록']
    },
    {
      matchedRiderId: '',
      displayName: '미매칭',
      totalPromotionAmount: 0,
      failureReasons: ['배민 User ID 미매칭']
    },
    {
      matchedRiderId: 'd2',
      displayName: '이지역',
      ruleName: '배민 기본',
      totalPromotionAmount: 12000,
      failureReasons: []
    }
  ]
});

check('누락 건수', gaps.length, 2);
check('첫 누락은 미션+지역', gaps[0].category, 'mission');
check('첫 누락에 지역 사유', gaps[0].reasons.some(reason => String(reason).includes('지역 미배정')), true);
check('둘째 누락은 미매칭', gaps[1].category, 'match');
check('미지급/미등록/지급완료는 제외', gaps.every(item => item.row.displayName !== '이지역' || item.category === 'match'), true);

const sla = apply.summarizeSlaApply([
  { ruleName: '100건 천원(울산남구)', slaApply: true },
  { ruleName: '중구 100건', slaApply: false },
  { ruleName: '중구 100건', slaApply: false }
]);
check('SLA는 일부만', sla.slaApplyAll, false);
check('SLA 인원', sla.slaApplyCount, 1);
check('SLA 아닌 인원', sla.slaOtherCount, 2);
check('SLA 미션명', sla.slaMissions, ['100건 천원(울산남구)']);

const mismatch = apply.assignmentDiffersFromRegionDefault(
  { baemin: 'namgu', coupang: '', combined: '' },
  { baemin: 'junggu', coupang: '', combined: '' }
);
check('남구 잔여 미션은 중구 기본과 다름', mismatch.length, 1);
check('다른 슬롯은 배민', mismatch[0].slot, 'baemin');
check('현재는 남구 미션', mismatch[0].currentId, 'namgu');
check('기대는 중구 기본', mismatch[0].expectedId, 'junggu');
check('같은 미션은 통과', apply.assignmentDiffersFromRegionDefault(
  { baemin: 'junggu', coupang: '', combined: '' },
  { baemin: 'junggu', coupang: '', combined: '' }
).length, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
