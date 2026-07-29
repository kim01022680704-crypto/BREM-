/**
 * 최종입금 메뉴 + 삭제 연동 검증 (로컬, 서버 접속 없음)
 *
 * 확인 항목
 *  - 쿠팡 차감내역(AB)이 저장 후에도 남는지 (예전엔 저장 때 사라져 정산결과에 0으로 보였다)
 *  - 최종입금이 그 주 정산서를 체크 방식으로 고르는지
 *  - 같은 기사가 쿠팡·배민 양쪽에 있으면 한 줄로 합산되는지
 *  - 지급내역·공제내역 열이 쿠팡·배민 통일 정의(정산결과와 동일)를 쓰는지
 *  - 정산서 체크를 풀면 합계에서 빠지는지 / 기사 체크를 풀면 최종입금액에서 빠지는지
 *  - 주정산서를 삭제하면 정산서·업로드로그·프로모션까지 정리되어 최종입금에서도 사라지는지
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
const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

function extractSection(id) {
  const start = html.indexOf(`<section class="section" id="${id}">`);
  if (start < 0) throw new Error(`섹션 ${id} 을(를) 찾지 못했습니다.`);
  let depth = 0;
  const re = /<\/?section\b[^>]*>/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('</')) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error(`섹션 ${id} 의 끝을 찾지 못했습니다.`);
}

const dom = new JSDOM(
  `<!doctype html><html><body>${extractSection('final-deposit')}</body></html>`,
  { url: 'http://localhost/', runScripts: 'outside-only' }
);
const { window } = dom;

window.BREM_SUPABASE_CONFIG = { mode: 'development', backend: 'local' };
window.BremPerf = { time() {}, timeEnd() {} };

const ctx = vm.createContext(window);
function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
}

try { load('js/platforms.js'); } catch (_) { /* 없으면 무시 */ }
load('js/storage.js');
load('js/direct-settlement-calc.js');
load('js/final-deposit.js');

const S = window.BremStorage;
const Calc = window.BremDirectSettlementCalc;
const FD = window.BremFinalDeposit;
if (!S || !Calc || !FD) {
  console.error('모듈 로드 실패:', { S: !!S, Calc: !!Calc, FD: !!FD });
  process.exit(2);
}

let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${ok ? '' : `  기대=${expected} 실제=${actual}`}`);
}

const WEEK = '2026-07-22'; // 수요일
const END = '2026-07-28';

function coupangRecord() {
  return {
    id: 'weekly_direct_coupang_ulsan_20260722',
    platform: 'coupang', channel: 'direct', region: '울산',
    fileName: '쿠팡_울산.xlsx', startDate: WEEK, endDate: END,
    riders: [
      {
        matchedRiderId: 'd1', driverName: '김기사', coupangLoginKey: '김기사1234', weeklyOrderCount: 100,
        amounts: {
          deliveryFee: 1000000, deductionDetail: 5000, deductionBase: 1000000,
          employmentInsurance: 9000, accidentInsurance: 8000, hourlyInsurance: 3000, withholdingTax: 33000
        }
      },
      {
        matchedRiderId: 'd2', driverName: '박기사', coupangLoginKey: '박기사5678', weeklyOrderCount: 50,
        amounts: {
          deliveryFee: 500000, deductionDetail: 0, deductionBase: 500000,
          employmentInsurance: 4000, accidentInsurance: 3000, hourlyInsurance: 1000, withholdingTax: 16500
        }
      }
    ]
  };
}

function baeminRecord() {
  return {
    id: 'weekly_direct_baemin_ulsan_20260722',
    platform: 'baemin', channel: 'direct', region: '울산',
    fileName: '배민_울산.xlsx', startDate: WEEK, endDate: END,
    riders: [
      {
        // 같은 사람(d1)이 배민에도 있다 → 최종입금에서 한 줄로 합쳐져야 한다.
        matchedRiderId: 'd1', driverName: '김기사', baeminUserId: 'BC000001', weeklyOrderCount: 80,
        amounts: {
          deliveryFee: 700000, missionPay: 50000,
          employmentInsurance: 5000, accidentInsurance: 4000, hourlyInsurance: 2000, withholdingTax: 24750
        }
      },
      {
        matchedRiderId: 'd3', driverName: '최기사', baeminUserId: 'BC000002', weeklyOrderCount: 30,
        amounts: {
          deliveryFee: 300000, missionPay: 0,
          employmentInsurance: 2000, accidentInsurance: 1500, hourlyInsurance: 500, withholdingTax: 9900
        }
      }
    ]
  };
}

function headLabels() {
  const rows = [...window.document.querySelectorAll('#finalDepositHead tr')];
  return {
    groups: [...(rows[0]?.querySelectorAll('th') || [])].map(th => th.textContent.trim()),
    cols: [...(rows[1]?.querySelectorAll('th') || [])].map(th => th.textContent.trim())
  };
}

function bodyRows() {
  return [...window.document.querySelectorAll('#finalDepositRows tr')];
}

function rowFor(name) {
  return bodyRows().find(tr => tr.textContent.includes(name)) || null;
}

function cellsOf(tr) {
  return [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
}

const money = n => Number(n).toLocaleString('ko-KR');

(async () => {
  await S.initStorage({ backend: 'local' });
  check('로컬 저장소 백엔드 활성', S.getStorageBackend?.(), 'local');

  console.log('\n[1] 쿠팡 차감내역(AB)이 저장 후에도 남는다');
  S.weeklySettlements.save(coupangRecord());
  const savedCoupang = S.weeklySettlements.getById('weekly_direct_coupang_ulsan_20260722', 'direct');
  check('차감내역 5,000 보존', savedCoupang?.riders?.[0]?.amounts?.deductionDetail, 5000);
  check('원천세 기준도 보존', savedCoupang?.riders?.[0]?.amounts?.deductionBase, 1000000);

  console.log('\n[2] 최종입금 · 정산서를 체크 방식으로 고른다');
  S.weeklySettlements.save(baeminRecord());
  FD.state.week = WEEK;
  await FD.refresh();
  const boxes = [...window.document.querySelectorAll('[data-fd-settlement]')];
  check('그 주 정산서 2건이 체크박스로 나온다', boxes.length, 2);
  check('기본값은 전체 체크', boxes.every(b => b.checked), 'true');
  check('전체 선택 체크박스도 켜짐', window.document.querySelector('#finalDepositSettlementAll')?.checked, 'true');

  console.log('\n[3] 지급내역·공제내역 열이 정산결과와 같은 통일 정의를 쓴다');
  const head = headLabels();
  check('지급내역 묶음 헤더', head.groups.includes('지급내역'), 'true');
  check('공제내역 묶음 헤더', head.groups.includes('공제내역'), 'true');
  const expectedCols = [];
  Calc.COLUMNS.forEach(col => {
    expectedCols.push(col.label);
    if (col.key === 'name') expectedCols.push('플랫폼');
  });
  check('열 구성이 공용 정의 + 플랫폼', JSON.stringify(head.cols), JSON.stringify(expectedCols));
  check('차감내역 열 포함', head.cols.includes('차감내역'), 'true');
  check('추가지급 열 포함', head.cols.includes('추가지급(미션)'), 'true');
  check('헤더와 본문 열 수 일치 (체크칸 +1)', cellsOf(bodyRows()[0]).length, head.cols.length + 1);

  console.log('\n[4] 같은 기사는 쿠팡·배민을 한 줄로 합산한다');
  check('기사 3명 (d1 합쳐짐)', bodyRows().length, 3);
  const kim = rowFor('김기사');
  const kimCells = cellsOf(kim);
  check('플랫폼 표기 쿠팡+배민', kimCells.includes('쿠팡+배민'), 'true');
  check('두 ID 모두 표기', kimCells.some(c => c.includes('김기사1234') && c.includes('BC000001')), 'true');
  check('콜수 합산 180', kimCells.includes('180'), 'true');
  check(`배달비 합산 ${money(1700000)}`, kimCells.includes(money(1700000)), 'true');
  check(`추가지급 ${money(50000)}`, kimCells.includes(money(50000)), 'true');
  check('차감내역 5,000 표기', kimCells.includes(money(5000)), 'true');

  // 지급합계 = 1,000,000 + 700,000 + 50,000 = 1,750,000
  const kimGross = 1750000;
  // 공제 = 차감 5,000 + 고용 14,000 + 산재 12,000 + 시간제 5,000 + 원천세 57,750
  const kimDeduct = 5000 + 14000 + 12000 + 5000 + 57750;
  check(`지급합계 ${money(kimGross)}`, kimCells.includes(money(kimGross)), 'true');
  check(`공제합계 ${money(kimDeduct)}`, kimCells.includes(money(kimDeduct)), 'true');
  check(`총지급액 ${money(kimGross - kimDeduct)}`, kimCells.includes(money(kimGross - kimDeduct)), 'true');
  check('차감내역이 공제합계에 들어갔다', kimCells.includes(money(kimDeduct - 5000)), 'false');

  console.log('\n[5] 정산서 체크를 풀면 그 정산서는 합계에서 빠진다');
  // 체크를 바꾸면 목록을 다시 그리므로 매번 새로 찾아야 한다.
  const toggleSettlement = (idPart, checked) => {
    const box = [...window.document.querySelectorAll('[data-fd-settlement]')]
      .find(b => b.dataset.fdSettlement.includes(idPart));
    box.checked = checked;
    box.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  toggleSettlement('baemin', false);
  check('배민 정산서 제외 → 2명', bodyRows().length, 2);
  const kimCoupangOnly = cellsOf(rowFor('김기사'));
  check('플랫폼 쿠팡만', kimCoupangOnly.includes('쿠팡'), 'true');
  check(`배달비 쿠팡분만 ${money(1000000)}`, kimCoupangOnly.includes(money(1000000)), 'true');
  toggleSettlement('baemin', true);
  check('다시 체크하면 3명 복귀', bodyRows().length, 3);

  console.log('\n[6] 기사 체크를 풀면 최종입금액에서 빠진다');
  const summaryText = () => window.document.querySelector('#finalDepositSummary')?.textContent || '';
  check('체크 3명 표기', /체크\s*3명/.test(summaryText()), 'true');
  const toggleDriver = (name, checked) => {
    const chk = rowFor(name).querySelector('[data-fd-driver]');
    chk.checked = checked;
    chk.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  toggleDriver('김기사', false);
  check('체크 2명으로 줄어듦', /체크\s*2명/.test(summaryText()), 'true');
  check('전체 3명은 그대로 표기', /전체 3명/.test(summaryText()), 'true');
  check('행은 남아 있고 흐리게만 처리', bodyRows().length, 3);
  check('제외 표시 클래스', rowFor('김기사').className.includes('final-deposit-row-off'), 'true');
  check('최종입금 합계에서 김기사 제외', summaryText().includes(money(kimGross - kimDeduct)), 'false');
  toggleDriver('김기사', true);
  check('다시 체크하면 3명', /체크\s*3명/.test(summaryText()), 'true');

  console.log('\n[7] 주정산서를 삭제하면 최종입금에서도 사라진다');
  // 업로드 로그·프로모션까지 붙여 두고, 삭제가 전부 정리하는지 본다.
  S.settlementUploadLogs.add({
    kind: 'weekly', channel: 'direct', platform: 'coupang',
    fileName: '쿠팡_울산.xlsx', region: '울산', startDate: WEEK, endDate: END,
    status: 'saved', linkedRecordId: 'weekly_direct_coupang_ulsan_20260722'
  });
  S.directSettlementAdjustments.applyEntries('promotion', 'weekly_direct_coupang_ulsan_20260722', [
    { driverId: 'd1', amount: 100000, driverName: '김기사' }
  ]);
  await FD.refresh();
  check('프로모션이 지급내역에 반영', cellsOf(rowFor('김기사')).includes(money(100000)), 'true');
  check('업로드 로그 1건', S.settlementUploadLogs.getAll('direct')
    .filter(l => l.linkedRecordId === 'weekly_direct_coupang_ulsan_20260722').length, 1);

  // weekly-settlement-admin.js 의 removeSettlementRecord 와 같은 순서로 정리한다.
  S.weeklySettlements.remove('weekly_direct_coupang_ulsan_20260722');
  S.settlementUploadLogs.removeByLinkedRecordId('weekly_direct_coupang_ulsan_20260722');
  S.directSettlementAdjustments.clearSettlement('promotion', 'weekly_direct_coupang_ulsan_20260722');
  S.directSettlementAdjustments.clearSettlement('other', 'weekly_direct_coupang_ulsan_20260722');

  check('정산서 삭제됨', S.weeklySettlements.getById('weekly_direct_coupang_ulsan_20260722', 'direct'), 'null');
  check('업로드 로그도 삭제됨', S.settlementUploadLogs.getAll('direct')
    .filter(l => l.linkedRecordId === 'weekly_direct_coupang_ulsan_20260722').length, 0);
  check('프로모션도 정리됨', Object.keys(
    S.directSettlementAdjustments.getSettlement('promotion', 'weekly_direct_coupang_ulsan_20260722')
  ).length, 0);

  // 정산서가 남아 있으면 syncWeeklyFromSavedRecords 가 로그를 되살려 목록·정산결과에 다시 뜬다.
  S.settlementUploadLogs.syncWeeklyFromSavedRecords('direct');
  check('삭제한 정산서 로그가 되살아나지 않음', S.settlementUploadLogs.getAll('direct')
    .filter(l => l.linkedRecordId === 'weekly_direct_coupang_ulsan_20260722').length, 0);

  await FD.refresh();
  check('최종입금 정산서 목록 1건으로 감소', window.document.querySelectorAll('[data-fd-settlement]').length, 1);
  check('쿠팡 전용 기사(박기사) 사라짐', rowFor('박기사'), 'null');
  const kimAfter = cellsOf(rowFor('김기사'));
  check('김기사는 배민분만 남음', kimAfter.includes('배민'), 'true');
  check(`배달비 배민분 ${money(700000)}`, kimAfter.includes(money(700000)), 'true');
  check('삭제된 쿠팡 프로모션 금액 안 보임', kimAfter.includes(money(100000)), 'false');

  console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\n예외:', e.stack || e.message); process.exit(2); });
