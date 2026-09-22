/**
 * 최종결산 vs 최종입금 — 동일 엔진·수동조정 반영 합계 일치 검증
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

function extractSection(id) {
  const needle = `id="${id}"`;
  const at = html.indexOf(needle);
  if (at < 0) throw new Error(`missing ${id}`);
  const start = html.lastIndexOf('<section', at);
  let depth = 0;
  const re = /<\/?section\b[^>]*>/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('</')) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error(`unclosed ${id}`);
}

const dom = new JSDOM(
  `<!doctype html><body>${extractSection('final-deposit')}</body></html>`,
  { url: 'http://localhost/', runScripts: 'outside-only' }
);
const window = dom.window;
window.BREM_SUPABASE_CONFIG = { mode: 'development', backend: 'local' };
window.BremPerf = { time() {}, timeEnd() {} };
const ctx = vm.createContext(window);
function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
}
try { load('js/platforms.js'); } catch (_) { /* optional */ }
load('js/storage.js');
load('js/direct-settlement-calc.js');
load('js/final-deposit.js');

const S = window.BremStorage;
const Calc = window.BremDirectSettlementCalc;
const FD = window.BremFinalDeposit;

function sum(rows, key) {
  return rows.reduce((acc, row) => acc + Number(row[key] || 0), 0);
}

(async () => {
  await S.initStorage({ backend: 'local' });
  const WEEK = '2026-08-05';
  const END = '2026-08-11';
  const sidC = `verify_coupang_${WEEK}`;
  const sidB = `verify_baemin_${WEEK}`;

  S.weeklySettlements.save({
    id: sidC,
    platform: 'coupang',
    channel: 'direct',
    region: '양산',
    fileName: 'c.xlsx',
    startDate: WEEK,
    endDate: END,
    riders: [{
      matchedRiderId: 'd1',
      driverName: '강승원',
      coupangLoginKey: '강승원2471',
      weeklyOrderCount: 252,
      amounts: {
        deliveryFee: 938372,
        missionPay: 0,
        employmentInsurance: 1000,
        accidentInsurance: 1000,
        hourlyInsurance: 0,
        withholdingTax: 10000,
        deductionDetail: 0
      }
    }]
  });
  S.weeklySettlements.save({
    id: sidB,
    platform: 'baemin',
    channel: 'direct',
    region: '양산A',
    fileName: 'b.xlsx',
    startDate: WEEK,
    endDate: END,
    riders: [{
      matchedRiderId: 'd1',
      driverName: '강승원',
      baeminUserId: 'cima13',
      weeklyOrderCount: 10,
      amounts: {
        deliveryFee: 100000,
        missionPay: 5000,
        employmentInsurance: 500,
        accidentInsurance: 500,
        hourlyInsurance: 0,
        withholdingTax: 3000,
        deductionDetail: 0
      }
    }]
  });

  // 최종결산 팝업에서 넣는 수동 조정과 동일 store/kind
  S.directSettlementAdjustments.applyEntries('other', sidC, [
    { driverId: 'd1', amount: 22000, driverName: '강승원', source: 'manual' }
  ]);
  S.directSettlementAdjustments.applyEntries('missionPay', sidC, [
    { driverId: 'd1', amount: 3000, driverName: '강승원', source: 'manual' }
  ]);
  S.directSettlementAdjustments.applyEntries('promotion', sidC, [
    { driverId: 'd1', amount: 204000, driverName: '강승원', source: 'excel' }
  ]);
  S.directSettlementAdjustments.applyEntries('leaseFee', sidC, [
    { driverId: 'd1', amount: 26000, driverName: '강승원', source: 'manual' }
  ]);
  S.directSettlementAdjustments.applyEntries('loanFee', sidC, [
    { driverId: 'd1', amount: 0, driverName: '강승원', source: 'manual' }
  ]);

  const settlements = [
    S.weeklySettlements.getById(sidC, 'direct'),
    S.weeklySettlements.getById(sidB, 'direct')
  ];

  // 최종결산 finalRows 와 동일
  function finalLikeRows() {
    const leaseConsumed = new Set();
    const loanConsumed = new Set();
    const spill = Calc.buildLeaseLoanSpilloverAllocation(settlements, {
      week: WEEK,
      withdrawals: []
    });
    const rows = [];
    settlements.forEach(settlement => {
      Calc.computeRows(settlement, {
        withdrawals: [],
        weekSettlements: settlements,
        _leaseLoanSpill: spill,
        _leaseConsumed: leaseConsumed,
        _loanConsumed: loanConsumed
      }).forEach(row => rows.push(row));
    });
    return rows;
  }

  // 최종입금 mergedRows 와 동일 (전체 체크)
  function depositLikeRows() {
    const allocation = Calc.allocateWeekWithdrawals(
      [],
      WEEK,
      Calc.buildWeekCapacityMap(settlements)
    );
    const remain = new Map();
    const leaseConsumed = new Set();
    const loanConsumed = new Set();
    const spill = Calc.buildLeaseLoanSpilloverAllocation(settlements, {
      week: WEEK,
      withdrawals: [],
      _allocation: allocation
    });
    const byDriver = new Map();
    settlements.forEach(settlement => {
      Calc.computeRows(settlement, {
        withdrawals: [],
        weekSettlements: settlements,
        _allocation: allocation,
        _prepaidRemain: remain,
        _leaseLoanSpill: spill,
        _leaseConsumed: leaseConsumed,
        _loanConsumed: loanConsumed
      }).forEach(row => {
        const key = `${row.driverId ? `d:${row.driverId}` : 'u'}|${row.platform}`;
        const existing = byDriver.get(key);
        if (!existing) {
          byDriver.set(key, { ...row, key });
          return;
        }
        Calc.NUMERIC_KEYS.forEach(field => {
          existing[field] += Number(row[field] || 0);
        });
      });
    });
    return [...byDriver.values()];
  }

  const finalRows = finalLikeRows();
  const depositRows = depositLikeRows();

  console.log('=== 최종결산 행 ===');
  finalRows.forEach(r => {
    console.log(
      r.platform,
      'mission', r.missionPay,
      'other', r.other,
      'promo', r.promo,
      'lease', r.leaseFee,
      'gross', r.grossPay,
      'net', r.netPay
    );
  });
  console.log('=== 최종입금 행 ===');
  depositRows.forEach(r => {
    console.log(
      r.platform,
      'mission', r.missionPay,
      'other', r.other,
      'promo', r.promo,
      'lease', r.leaseFee,
      'gross', r.grossPay,
      'net', r.netPay
    );
  });

  const keys = [
    'missionPay', 'other', 'promo', 'leaseFee', 'loanFee',
    'grossPay', 'deductTotal', 'netPay', 'promotionWithholdingTax', 'prepaid'
  ];
  let failed = 0;
  keys.forEach(key => {
    const a = sum(finalRows, key);
    const b = sum(depositRows, key);
    const ok = a === b;
    if (!ok) failed += 1;
    console.log(`${ok ? 'OK' : 'FAIL'} ${key}: 최종결산=${a} 최종입금=${b}`);
  });

  // 쿠팡 행에 수동 조정이 들어갔는지
  const coupangFinal = finalRows.find(r => r.platform === 'coupang');
  console.log('\n쿠팡 수동조정 반영 확인');
  console.log('  missionPay==3000', coupangFinal?.missionPay === 3000);
  console.log('  other==22000', coupangFinal?.other === 22000);
  console.log('  promo==204000', coupangFinal?.promo === 204000);
  console.log('  leaseFee==26000', coupangFinal?.leaseFee === 26000);
  if (coupangFinal?.missionPay !== 3000) failed += 1;
  if (coupangFinal?.other !== 22000) failed += 1;
  if (coupangFinal?.promo !== 204000) failed += 1;
  if (coupangFinal?.leaseFee !== 26000) failed += 1;

  FD.state.week = WEEK;
  FD.state.withdrawals = [];
  FD.state.excludedSettlementIds.clear();
  FD.state.excludedDriverKeys.clear();
  await FD.refresh();
  const summary = window.document.querySelector('#finalDepositSummary')?.textContent || '';
  const net = sum(depositRows, 'netPay');
  const netShown = summary.includes(net.toLocaleString('ko-KR'));
  console.log('\n최종입금 화면 합계에 net 표기', netShown, 'net=', net);

  console.log(failed ? `\n실패 ${failed}건` : '\n전부 일치 — 동일 계산 엔진·수동조정 공유');
  process.exit(failed ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(2);
});
