/**
 * 프로모션정산등록 일괄등록 — 쿠팡ID 매칭 검증.
 *
 * 실제 상황: 기사 레코드에는 coupangId 가 저장되지 않는다. 쿠팡ID는
 * 「이름 + 연락처 뒤 4자리」로 계산되는 값이다. 엑셀 A열에는 `배승범1263` 처럼
 * 계산된 쿠팡ID가 들어온다. 이 상태에서 매칭이 되는지 확인한다.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  if (actual === expected) {
    pass += 1;
    console.log(`  OK   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}\n         기대: ${expected}\n         실제: ${actual}`);
  }
}

function loadBulk({ withHelpers = true } = {}) {
  const sandbox = {
    console, Math, Number, String, Array, Object, Boolean, Date, JSON, Set, Map,
    isNaN, parseFloat, parseInt, RegExp
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);

  const files = ['js/direct-adjustment-bulk.js'];
  if (withHelpers) {
    files.unshift('js/driver-utils.js', 'js/payroll-slip-utils.js');
  }
  files.forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  });
  return sandbox;
}

// 실제 저장 형태: coupangId 없음. 이름과 연락처만 있다.
const DRIVERS = [
  { id: 'd1', name: '배승범', phone: '010-1111-1263', baeminId: 'BC000001' },
  { id: 'd2', name: '김동희', phone: '010-2222-3217', baeminId: 'BC000002' },
  { id: 'd3', name: '최유림', phone: '010-3333-4314', baeminId: 'BC000003' },
  { id: 'd4', name: '송영윤', phone: '010-4444-0248', baeminId: 'BC000004' },
  // 뒤 4자리가 같지만 이름이 달라 쿠팡ID는 겹치지 않는다.
  { id: 'd5', name: '송수진', phone: '010-5555-0248', baeminId: 'BC000005' }
];

console.log('\n[1] 쿠팡 — 계산된 쿠팡ID(이름+뒤4자리)로 매칭');
{
  const env = loadBulk();
  const bulk = env.BremDirectAdjustmentBulk;

  const rows = [
    ['쿠팡ID', '금액'],
    ['배승범1263', 10000],
    ['김동희3217', 10000],
    ['최유림4314', 10000],
    ['송영윤0248', 10000],
    ['송수진0248', 10000]
  ];

  const parsed = bulk.parseSheetRows(rows, DRIVERS, 'coupang');
  const summary = bulk.summarizeRows(parsed.rows);

  check('데이터 5행 추출 (헤더 제외)', parsed.rows.length, 5);
  check('5명 전원 매칭', summary.matched, 5);
  check('미매칭 0명', summary.unmatched, 0);
  check('배승범 → d1', parsed.rows[0].driverId, 'd1');
  check('김동희 → d2', parsed.rows[1].driverId, 'd2');
  check('최유림 → d3', parsed.rows[2].driverId, 'd3');
  check('뒤4자리 같은 송영윤 → d4', parsed.rows[3].driverId, 'd4');
  check('뒤4자리 같은 송수진 → d5', parsed.rows[4].driverId, 'd5');
  check('표시 ID가 계산된 쿠팡ID', parsed.rows[0].matchedBaeminId, '배승범1263');
  check('매칭 오류 안내 없음', parsed.issues.length, 0);
}

console.log('\n[2] 쿠팡 — 공백·대소문자 차이 허용');
{
  const env = loadBulk();
  const bulk = env.BremDirectAdjustmentBulk;
  const parsed = bulk.parseSheetRows([[' 배승범 1263 ', 5000]], DRIVERS, 'coupang');
  check('공백 섞여도 매칭', parsed.rows[0].driverId, 'd1');
}

console.log('\n[3] 쿠팡 — 없는 기사는 여전히 미매칭 (과매칭 방지)');
{
  const env = loadBulk();
  const bulk = env.BremDirectAdjustmentBulk;
  const parsed = bulk.parseSheetRows([
    ['없는사람9999', 5000],
    ['배승범9999', 5000],
    ['배승범', 5000]
  ], DRIVERS, 'coupang');

  check('등록 안 된 이름 미매칭', parsed.rows[0].matchStatus, 'unmatched');
  check('이름 맞고 번호 틀리면 미매칭', parsed.rows[1].matchStatus, 'unmatched');
  check('이름만 있으면 미매칭', parsed.rows[2].matchStatus, 'unmatched');
}

console.log('\n[4] 쿠팡 — 기사에 coupangId 가 직접 저장돼 있으면 그 값이 우선');
{
  const env = loadBulk();
  const bulk = env.BremDirectAdjustmentBulk;
  const custom = [{ id: 'x1', name: '홍길동', phone: '010-0000-1111', coupangId: 'CUSTOM777' }];

  check('저장된 쿠팡ID로 매칭', bulk.parseSheetRows([['CUSTOM777', 1000]], custom, 'coupang').rows[0].driverId, 'x1');
  check('계산값은 저장값에 밀려 미매칭', bulk.parseSheetRows([['홍길동1111', 1000]], custom, 'coupang').rows[0].matchStatus, 'unmatched');
}

console.log('\n[5] 배민 — 기존 동작 그대로');
{
  const env = loadBulk();
  const bulk = env.BremDirectAdjustmentBulk;

  const parsed = bulk.parseSheetRows([
    ['BC000001', 10000],
    ['BC000003', 20000]
  ], DRIVERS, 'baemin');

  check('배민ID로 매칭', parsed.rows[0].driverId, 'd1');
  check('두번째도 매칭', parsed.rows[1].driverId, 'd3');
  check('배민 표시 ID', parsed.rows[0].matchedBaeminId, 'BC000001');

  const wrong = bulk.parseSheetRows([['배승범1263', 10000]], DRIVERS, 'baemin');
  check('쿠팡ID를 배민으로 올리면 미매칭', wrong.rows[0].matchStatus, 'unmatched');
}

console.log('\n[6] 동일 쿠팡ID 기사 2명이면 중복매칭으로 막는다');
{
  const env = loadBulk();
  const bulk = env.BremDirectAdjustmentBulk;
  const dupes = [
    { id: 'a1', name: '이중복', phone: '010-1111-2222' },
    { id: 'a2', name: '이중복', phone: '010-3333-2222' }
  ];
  const parsed = bulk.parseSheetRows([['이중복2222', 1000]], dupes, 'coupang');
  check('중복매칭 상태', parsed.rows[0].matchStatus, 'duplicate');
  check('driverId 비움', parsed.rows[0].driverId, '');
  check('후보 2명 제시', parsed.rows[0].matchCandidates.length, 2);
}

console.log('\n[7] 수동 선택 후에도 표시 ID가 계산된 쿠팡ID');
{
  const env = loadBulk();
  const bulk = env.BremDirectAdjustmentBulk;
  const parsed = bulk.parseSheetRows([['없는사람9999', 7000]], DRIVERS, 'coupang');
  const manual = bulk.applyManualDriverToRow(parsed.rows[0], 'd2', DRIVERS, 'coupang');

  check('수동선택 상태', manual.matchStatus, 'manual');
  check('수동선택 기사', manual.driverId, 'd2');
  check('표시 ID가 계산된 쿠팡ID', manual.matchedBaeminId, '김동희3217');

  const { toApply } = bulk.filterRowsForApply([manual]);
  check('수동선택도 적용 대상', toApply.length, 1);
  check('적용 금액 유지', toApply[0].amount, 7000);
}

console.log('\n[8] 헬퍼(driver-utils/payroll-slip-utils) 미로드 시에도 죽지 않는다');
{
  const env = loadBulk({ withHelpers: false });
  const bulk = env.BremDirectAdjustmentBulk;
  const custom = [{ id: 'y1', name: '홍길동', phone: '010-0000-1111', coupangLoginKey: 'KEY123' }];

  check('coupangLoginKey 로 매칭', bulk.parseSheetRows([['KEY123', 1000]], custom, 'coupang').rows[0].driverId, 'y1');
  check('계산 불가 기사는 미매칭 (예외 없이)', bulk.parseSheetRows([['배승범1263', 1000]], DRIVERS, 'coupang').rows[0].matchStatus, 'unmatched');
}

console.log('\n[9] 주정산서 업로드와 같은 쿠팡ID 규칙인지');
{
  const env = loadBulk();
  const weeklyKey = driver => `${String(driver.name || '').replace(/\s/g, '')}${String(driver.phone || '').replace(/[^0-9]/g, '').slice(-4)}`;

  DRIVERS.forEach(driver => {
    const fromBulk = env.BremDirectAdjustmentBulk.driverIdForMatch(driver, 'coupang');
    check(`${driver.name} 쿠팡ID 일치`, fromBulk, weeklyKey(driver));
  });
}

console.log(`\n결과: ${pass}건 통과, ${fail}건 실패`);
process.exit(fail ? 1 : 0);
