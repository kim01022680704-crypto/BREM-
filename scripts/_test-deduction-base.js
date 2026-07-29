/**
 * 공제기준금액(쿠팡 AC열) 전환 검증 (로컬, 서버 접속 없음).
 *
 * 가장 중요한 확인:
 *  - AC가 있는 새 행은 고용·산재·원천세를 AC 기준으로 계산한다
 *  - AC가 없는 기존 행은 지금까지처럼 정산금액(AJ) 기준을 유지한다 (소급 재계산 금지)
 *  - 관리자(js/storage.js)와 서버(server/rider-withdrawal.js) 계산이 완전히 같다
 *    → 두 곳이 어긋나면 출금 한도가 깨진다
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${ok ? '' : `  기대=${expected} 실제=${actual}`}`);
}

// --- 서버 계산 함수를 실제 파일에서 그대로 꺼내 쓴다 -------------------------
const serverSrc = fs.readFileSync(path.join(root, 'server', 'rider-withdrawal.js'), 'utf8');

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} 함수를 찾지 못했습니다.`);
  let depth = 0;
  let started = false;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === '{') { depth += 1; started = true; }
    else if (src[i] === '}') {
      depth -= 1;
      if (started && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${name} 함수의 끝을 찾지 못했습니다.`);
}

const serverCtx = vm.createContext({});
vm.runInContext(`
  const EMP_RATE = 0.008;
  const INDUSTRIAL_RATE = 0.0088;
  const WITHHOLDING_RATE = 0.033;
  function normalizePlatform(value) {
    return String(value || '').toLowerCase() === 'baemin' ? 'baemin' : 'coupang';
  }
  function resolveDailySettlementFee(amount, fees = {}) {
    const mode = String(fees.dailySettlementFeeMode || 'fixed').toLowerCase();
    const fee = Number(fees.dailySettlementFee || 0);
    return mode === 'percent'
      ? Math.round(Number(amount || 0) * fee / 100)
      : Math.round(fee);
  }
  ${extractFunction(serverSrc, 'calcPayoutFromSettlement')}
  globalThis.calcPayoutFromSettlement = calcPayoutFromSettlement;
`, serverCtx, { filename: 'server-extract.js' });

const serverCalc = serverCtx.calcPayoutFromSettlement;

// --- 관리자 계산은 같은 식을 그대로 옮겨 비교한다 ---------------------------
// (js/storage.js buildDriverWeekSummary 안에 있어 통째로 떼오기 어려우므로,
//  그 파일에서 해당 라인들을 읽어 실제로 같은 식인지 문자열로 검사한다)
const storageSrc = fs.readFileSync(path.join(root, 'js', 'storage.js'), 'utf8');

const FEES = { coupang: { callFee: 0, dailySettlementFee: 2, dailySettlementFeeMode: 'percent' } };

console.log('\n[1] AC 있는 새 행 — 고용·산재·원천세가 AC 기준');
// AJ 1,200,000 / AC 1,212,000
const fresh = serverCalc(
  { platform: 'coupang', settlement_amount: 1200000, deduction_base: 1212000, order_count: 120, hourly_insurance: 3000 },
  FEES
);
check('정산금액은 AJ 그대로', fresh.settlementAmount, 1200000);
check('공제기준은 AC', fresh.deductionBase, 1212000);
check('고용보험 = AC×0.8%', fresh.employmentInsurance, Math.floor(1212000 * 0.008));
check('산재보험 = AC×0.88%', fresh.industrialAccidentInsurance, Math.floor(1212000 * 0.0088));
check('원천세 = AC×3.3%', fresh.withholdingTax, Math.floor(1212000 * 0.033));
check('실지급 = AJ − 공제 − 시간제', fresh.netPay,
  1200000
  - Math.floor(1212000 * 0.008)
  - Math.floor(1212000 * 0.0088)
  - Math.floor(1212000 * 0.033)
  - 3000);

console.log('\n[2] AC 없는 기존 행 — 지금까지 값이 그대로 (소급 재계산 없음)');
const legacy = serverCalc(
  { platform: 'coupang', settlement_amount: 1200000, order_count: 120, hourly_insurance: 3000 },
  FEES
);
check('공제기준이 정산금액으로 대체', legacy.deductionBase, 1200000);
check('고용보험 = AJ×0.8%', legacy.employmentInsurance, Math.floor(1200000 * 0.008));
check('산재보험 = AJ×0.88%', legacy.industrialAccidentInsurance, Math.floor(1200000 * 0.0088));
check('원천세 = AJ×3.3%', legacy.withholdingTax, Math.floor(1200000 * 0.033));
check('실지급이 전환 전과 동일', legacy.netPay,
  1200000
  - Math.floor(1200000 * 0.008)
  - Math.floor(1200000 * 0.0088)
  - Math.floor(1200000 * 0.033)
  - 3000);

console.log('\n[3] deduction_base 가 0 이거나 이상값이어도 안전');
[0, null, undefined, '', 'abc', -500].forEach(value => {
  const row = { platform: 'coupang', settlement_amount: 500000, deduction_base: value, order_count: 10 };
  const out = serverCalc(row, FEES);
  check(`deduction_base=${JSON.stringify(value)} → 정산금액 기준`, out.deductionBase, 500000);
});

console.log('\n[4] AC 기준이면 공제가 늘어 실지급이 준다 (AC > AJ 인 경우)');
check('AC 기준 실지급 < AJ 기준 실지급', fresh.netPay < legacy.netPay, 'true');
check('차액 = 공제 증가분', legacy.netPay - fresh.netPay,
  (Math.floor(1212000 * 0.008) - Math.floor(1200000 * 0.008))
  + (Math.floor(1212000 * 0.0088) - Math.floor(1200000 * 0.0088))
  + (Math.floor(1212000 * 0.033) - Math.floor(1200000 * 0.033)));

console.log('\n[5] 관리자·서버가 같은 식을 쓰는지');
// 두 파일이 어긋나면 관리자 화면과 기사 앱 출금 한도가 달라진다.
const adminHasBase = /const deductionBase = Math\.max\(0, Math\.round\(Number\(settlement\?\.deductionBase \|\| 0\)\)\) \|\| settlementAmount;/
  .test(storageSrc);
check('관리자도 deductionBase 폴백 사용', adminHasBase, 'true');
['employmentInsurance = Math.floor(deductionBase * EMP_RATE)',
  'industrialAccidentInsurance = Math.floor(deductionBase * INDUSTRIAL_RATE)',
  'withholdingTax = Math.floor(deductionBase * WITHHOLDING_RATE)'].forEach(expr => {
  check(`관리자: ${expr}`, storageSrc.includes(expr), 'true');
});
['employmentInsurance = Math.floor(deductionBase * EMP_RATE)',
  'industrialAccidentInsurance = Math.floor(deductionBase * INDUSTRIAL_RATE)',
  'withholdingTax = Math.floor(deductionBase * WITHHOLDING_RATE)'].forEach(expr => {
  check(`서버: ${expr}`, serverSrc.includes(expr), 'true');
});

console.log('\n[6] 서버가 deduction_base 를 실제로 조회하는지');
const selectCount = (serverSrc.match(/deduction_base/g) || []).length;
check('SELECT 3곳 + 계산부 = 4회 이상 등장', selectCount >= 4, 'true');
check('daily_settlements SELECT 에 포함',
  /select\('driver_id,period,platform,order_count,hourly_insurance,deduction_base,/.test(serverSrc), 'true');

console.log('\n[7] 배민은 영향 없음 (AC 열이 없는 서식)');
const baemin = serverCalc(
  { platform: 'baemin', settlement_amount: 900000, order_count: 90, hourly_insurance: 0 },
  { baemin: { callFee: 100, dailySettlementFee: 2, dailySettlementFeeMode: 'percent' }, coupang: {} }
);
check('배민 공제기준 = 정산금액', baemin.deductionBase, 900000);
check('배민 원천세 = 정산금액×3.3%', baemin.withholdingTax, Math.floor(900000 * 0.033));
check('배민 콜수수료 = 90×100', baemin.callFee, 9000);

console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
process.exit(failed ? 1 : 0);
