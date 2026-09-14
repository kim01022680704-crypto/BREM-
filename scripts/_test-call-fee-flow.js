/**
 * 정산서별 콜수수료 입력·전달 회귀 검증 (로컬, 서버 접속 없음).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (_) {
  console.error('jsdom 이 필요합니다: npm i -D jsdom');
  process.exit(2);
}

const root = path.join(__dirname, '..');
let failed = 0;

function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${ok ? '' : `  기대=${expected} 실제=${actual}`}`);
}

async function testDialog() {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="callFeeSetupDialog" hidden>
      <button data-close-call-fee-dialog></button>
      <section>
        <form id="callFeeSetupForm">
          <h2 id="callFeeSetupTitle"></h2>
          <p id="callFeeSetupMeta"></p>
          <strong id="callFeeSetupCalls"></strong>
          <input id="callFeeSetupUnit">
          <p id="callFeeSetupError"></p>
          <button type="submit">확정</button>
        </form>
      </section>
    </div>
  </body>`, { runScripts: 'outside-only' });
  const context = dom.getInternalVMContext();
  const source = fs.readFileSync(path.join(root, 'js', 'call-fee-dialog.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'call-fee-dialog.js' });

  const { document, BremCallFeeDialog } = dom.window;
  const resultPromise = BremCallFeeDialog.open({
    platform: 'baemin',
    kind: 'daily',
    fileName: '정산서.xlsx',
    period: '2026-09-01',
    totalCalls: 125
  });
  check('팝업이 열린다', document.querySelector('#callFeeSetupDialog').hidden, false);
  check('정산서 총 콜수 표시', document.querySelector('#callFeeSetupCalls').textContent, '125콜');

  document.querySelector('#callFeeSetupForm')
    .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  check('빈 값은 오류', Boolean(document.querySelector('#callFeeSetupError').textContent), true);
  check('빈 값으로 팝업이 닫히지 않음', document.querySelector('#callFeeSetupDialog').hidden, false);

  document.querySelector('#callFeeSetupUnit').value = '0';
  document.querySelector('#callFeeSetupForm')
    .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  check('명시적 0원 허용', await resultPromise, 0);
  check('확정 후 팝업 닫힘', document.querySelector('#callFeeSetupDialog').hidden, true);
}

function testFlowWiring() {
  const admin = fs.readFileSync(path.join(root, 'js', 'admin.js'), 'utf8');
  const weekly = fs.readFileSync(path.join(root, 'js', 'weekly-settlement-admin.js'), 'utf8');
  const storage = fs.readFileSync(path.join(root, 'js', 'storage.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

  check('일정산 빈 입력은 null', admin.includes("if (!el || el.value === '') return null;"), true);
  check('일정산 최초 미리보기에서 팝업 호출',
    /renderSettlements\(\);\s*const selectedCallFeeUnit = await requestSettlementPreviewCallFeeUnit\(p\)/.test(admin), true);
  check('일정산 주간 재반영도 로그 단가 사용',
    admin.includes('callFeeUnit: resolveDailyLogCallFeeUnit(log)'), true);
  check('일정산 업로드 기록에 수수료 수정 버튼',
    admin.includes('data-edit-settlement-call-fee='), true);
  check('일정산 수수료 수정 즉시 재반영',
    /function editSettlementUploadLogCallFee[\s\S]*?forceReapply: true,[\s\S]*?callFeeUnit: unit/.test(admin), true);
  check('일정산 업로드 상세에 총·기사별 콜수수료 차감 표시',
    admin.includes('콜수수료 반영: ${callFeeSummary}')
      && admin.includes('<th>콜수수료 차감</th>'), true);
  check('배민 일정산 상세에 매칭 시간제보험 표시',
    admin.includes('매칭 시간제보험: <strong>${formatMoney(totalHourlyInsurance)}</strong>')
      && /isBaeminSettlementPlatform\(p\)[\s\S]*?<th>시간제보험<\/th>/.test(admin), true);
  check('일정산 미매칭 저장에 단가 보존',
    /saveBatch\(\{ period, records, sourceFileName, platform, callFeeUnit \}\)/.test(admin), true);
  check('미매칭 재매칭이 단가를 upsert에 전달',
    /records: group\.records,\s*callFeeUnit: group\.callFeeUnit/.test(storage), true);

  check('직계약 주정산 빈 입력은 null',
    /function readDirectCallFeeUnit[\s\S]*?if \(raw === ''\) return null;/.test(weekly), true);
  check('직계약 주정산 최초 미리보기에서 팝업 호출',
    weekly.includes('selectedCallFeeUnit = await requestDirectCallFeeUnit(platform, record);'), true);
  check('배민 다중지역 즉시 저장 전에도 팝업 호출',
    weekly.includes('batchCallFeeUnit = await requestDirectCallFeeUnit(platform, firstRecord'), true);
  check('주정산 미리보기에 콜수수료 열', (html.match(/<th>콜수수료<\/th>/g) || []).length >= 4, true);
  check('직계약 주정산 기록에 수수료 수정 버튼',
    weekly.includes('data-weekly-edit-call-fee='), true);
  check('주정산 수수료 수정 시 저장된 기사 전체 재스탬프',
    /function editWeeklySettlementCallFee[\s\S]*?weeklySettlements\.save\(record, \{ callFeeUnit: unit \}\)/.test(weekly), true);
  check('직계약 주정산 상세에 총·기사별 콜수수료 차감 표시',
    weekly.includes('콜수수료 반영: <strong>')
      && weekly.includes('<th>콜수수료 차감</th>'), true);
  check('주정산 재매칭 저장에 단가 전달',
    storage.includes('callFeeUnit: pendingCallFeeUnit == null'), true);
}

(async () => {
  console.log('\n[1] 필수 설정 팝업');
  await testDialog();
  console.log('\n[2] 일정산·주정산 전달 경로');
  testFlowWiring();
  console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(2);
});
