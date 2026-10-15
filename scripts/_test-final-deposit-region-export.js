/**
 * 최종입금 「지역별 엑셀」 — 지역마다 최종입금(플러스만) + 선정산
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
try { load('js/platforms.js'); } catch (_) { /* optional */ }
load('js/storage.js');
load('js/direct-settlement-calc.js');
load('js/final-deposit.js');

const S = window.BremStorage;
const FD = window.BremFinalDeposit;
if (!S || !FD?.buildRegionExportGroups) {
  console.error('모듈 로드 실패');
  process.exit(2);
}

let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${ok ? '' : `  기대=${expected} 실제=${actual}`}`);
}

const WEEK = '2026-10-07';
const END = '2026-10-13';

function rider(id, name, delivery, extra = {}) {
  return {
    matchedRiderId: id,
    driverName: name,
    coupangLoginKey: `${name}1111`,
    weeklyOrderCount: 10,
    amounts: {
      deliveryFee: delivery,
      deductionDetail: 0,
      employmentInsurance: 0,
      accidentInsurance: 0,
      hourlyInsurance: 0,
      withholdingTax: 0,
      ...extra
    }
  };
}

function settlement(id, region, riders) {
  return {
    id,
    platform: 'coupang',
    channel: 'direct',
    region,
    fileName: `${region}.xlsx`,
    startDate: WEEK,
    endDate: END,
    riders
  };
}

(async () => {
  await S.initStorage({ backend: 'local' });
  S.weeklySettlements.save(settlement('weekly_direct_coupang_east_20261007', '동구중앙(Z)', [
    rider('d1', '한유범', 46275, { deductionDetail: 16485 })
  ]));
  S.weeklySettlements.save(settlement('weekly_direct_coupang_south_20261007', '남구중앙', [
    rider('d2', '박창혁', 186955)
  ]));
  S.weeklySettlements.save(settlement('weekly_direct_baemin_south_20261007', '표준울산남A', [
    rider('d2', '박창혁', 80000)
  ]));

  FD.state.week = WEEK;
  await FD.refresh();
  FD.state.withdrawals = [
    { id: 'w1', driverId: 'd1', platform: 'coupang', status: 'completed', weekStart: WEEK, amount: 43045, feeAmount: 0 },
    { id: 'w2', driverId: 'd2', platform: 'coupang', status: 'completed', weekStart: WEEK, amount: 50000, feeAmount: 0 },
    { id: 'w3', driverId: 'd2', platform: 'baemin', status: 'completed', weekStart: WEEK, amount: 12000, feeAmount: 0 }
  ];

  const help = window.document.querySelector('#final-deposit .form-help')?.textContent || '';
  check('안내문에 선정산', help.includes('선정산'), 'true');

  const { ordered, grand, prepaidGrand } = FD.buildRegionExportGroups();
  check('시트 2개 (쿠팡·배민)', ordered.length, 2);
  check('쿠팡이 앞', ordered[0].platform, 'coupang');
  check('배민이 뒤', ordered[1].platform, 'baemin');

  const coupang = ordered[0];
  const east = coupang.items.find(item => item.region.includes('동구'));
  const south = coupang.items.find(item => item.region.includes('남구'));
  check('동구 선정산 43,045', east?.prepaid, 43045);
  check('동구 최종입금 0 (마이너스 제외)', east?.amount, 0);
  check('남구 선정산 50,000', south?.prepaid, 50000);
  check('남구 최종입금 배달-선정산', south?.amount, 186955 - 50000);

  const baemin = ordered[1];
  check('배민 1지역', baemin.items.length, 1);
  check('배민 선정산 12,000', baemin.items[0].prepaid, 12000);
  check('배민 최종입금 배달-선정산', baemin.items[0].amount, 80000 - 12000);

  check('최종입금 합계', grand, (186955 - 50000) + (80000 - 12000));
  check('선정산 합계', prepaidGrand, 43045 + 50000 + 12000);

  [
    'weekly_direct_coupang_east_20261007',
    'weekly_direct_coupang_south_20261007',
    'weekly_direct_baemin_south_20261007'
  ].forEach(id => S.weeklySettlements.remove(id));

  console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
  process.exit(failed ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(2);
});
