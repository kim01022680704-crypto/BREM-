/**
 * 프로모션 적용 · 평균콜수 = 콜수 / 정산인원
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
const start = html.indexOf('<section class="section" id="promotion-apply">');
if (start < 0) throw new Error('promotion-apply 섹션 없음');
let depth = 0;
const re = /<\/?section\b[^>]*>/g;
re.lastIndex = start;
let m;
let end = -1;
while ((m = re.exec(html))) {
  if (m[0].startsWith('</')) depth -= 1;
  else depth += 1;
  if (depth === 0) {
    end = m.index + m[0].length;
    break;
  }
}
const dom = new JSDOM(`<!doctype html><html><body>${html.slice(start, end)}</body></html>`, {
  url: 'http://localhost/',
  runScripts: 'outside-only'
});
const { window } = dom;
window.BREM_SUPABASE_CONFIG = { mode: 'development', backend: 'local' };
window.BremPerf = { time() {}, timeEnd() {} };
window.BremDatePicker = {
  today: () => '2026-10-15',
  formatDate: value => String(value || '').slice(0, 10),
  formatWeekdayKo: () => '수',
  formatWednesdayWeekRange: start => `${start} ~ ${start}`
};

const ctx = vm.createContext(window);
function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
}
load('js/platforms.js');
load('js/storage.js');
load('js/promotion-engine.js');
load('js/promotion-apply.js');
load('js/promotion-apply-admin.js');

const S = window.BremStorage;
const Admin = window.BremPromotionApplyAdmin;
if (!S || !Admin?.buildAvgCallRows) {
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

(async () => {
  await S.initStorage({ backend: 'local' });
  S.weeklySettlements.save({
    id: 'weekly_direct_coupang_avg_east',
    platform: 'coupang',
    channel: 'direct',
    region: '동구중앙(Z)',
    startDate: WEEK,
    endDate: END,
    riders: [
      { matchedRiderId: 'd1', driverName: '갑', weeklyOrderCount: 120 },
      { matchedRiderId: 'd2', driverName: '을', weeklyOrderCount: 80 }
    ]
  }, 'direct');
  S.weeklySettlements.save({
    id: 'weekly_bro_baemin_avg_south',
    platform: 'baemin',
    channel: 'bro',
    region: '표준울산남A',
    startDate: WEEK,
    endDate: END,
    riders: [
      { matchedRiderId: 'd3', driverName: '병', weeklyOrderCount: 90 },
      { matchedRiderId: 'd4', driverName: '정', weeklyOrderCount: 0 },
      { matchedRiderId: 'd5', driverName: '무', weeklyOrderCount: 60 }
    ]
  }, 'bro');

  check('소메뉴 있음', Boolean(window.document.querySelector('[data-promotion-apply-channel="avgcalls"]')), 'true');
  check('안내문에 정산인원', (window.document.querySelector('#promotionApplyAvgCallsPanel')?.textContent || '').includes('정산인원'), 'true');

  const all = Admin.buildAvgCallRows(WEEK, 'all');
  const east = all.find(row => row.platform === 'coupang' && row.region.includes('동구'));
  const south = all.find(row => row.platform === 'baemin' && row.region.includes('남A'));
  check('직계약 동구 콜수', east?.calls, 200);
  check('직계약 동구 인원', east?.people, 2);
  check('직계약 동구 평균', east?.avg, 100);
  check('브로 남A 콜수', south?.calls, 150);
  check('브로 남A 인원(0콜 포함)', south?.people, 3);
  check('브로 남A 평균 50', south?.avg, 50);

  const onlyDirect = Admin.buildAvgCallRows(WEEK, 'direct');
  check('직계약만 쿠팡 1건', onlyDirect.filter(row => row.platform !== 'combined').length, 1);

  S.weeklySettlements.save({
    id: 'weekly_direct_baemin_avg_east',
    platform: 'baemin',
    channel: 'direct',
    region: '표준울산동A',
    startDate: WEEK,
    endDate: END,
    riders: [
      { matchedRiderId: 'd1', driverName: '갑', weeklyOrderCount: 90 },
      { matchedRiderId: 'd6', driverName: '기', weeklyOrderCount: 60 }
    ]
  }, 'direct');
  const combined = Admin.buildAvgCallRows(WEEK, 'direct', 'combined');
  check('합산 1건', combined.length, 1);
  check('합산 지역에 쿠팡+배민', combined[0]?.region.includes('동구') && combined[0]?.region.includes('동A'), 'true');
  check('합산 콜수 350', combined[0]?.calls, 350);
  check('합산 인원 3(겹친 갑은 1명)', combined[0]?.people, 3);
  check('합산 평균', Math.round(combined[0]?.avg * 10) / 10, 116.7);

  S.weeklySettlements.save({
    id: 'weekly_direct_coupang_avg_yangsan',
    platform: 'coupang',
    channel: 'direct',
    region: '양산중앙(Z)',
    startDate: WEEK,
    endDate: END,
    riders: [
      { matchedRiderId: 'y1', driverName: '양갑', weeklyOrderCount: 100 },
      { matchedRiderId: 'y2', driverName: '양을', weeklyOrderCount: 80 }
    ]
  }, 'direct');
  S.weeklySettlements.save({
    id: 'weekly_direct_baemin_avg_yangsan_b',
    platform: 'baemin',
    channel: 'direct',
    region: '양산B',
    startDate: WEEK,
    endDate: END,
    riders: [
      { matchedRiderId: 'y1', driverName: '양갑', weeklyOrderCount: 50 },
      { matchedRiderId: 'y3', driverName: '양병', weeklyOrderCount: 40 }
    ]
  }, 'direct');
  S.weeklySettlements.save({
    id: 'weekly_direct_baemin_avg_yangsan_c',
    platform: 'baemin',
    channel: 'direct',
    region: '양산C',
    startDate: WEEK,
    endDate: END,
    riders: [
      { matchedRiderId: 'y1', driverName: '양갑', weeklyOrderCount: 30 },
      { matchedRiderId: 'y2', driverName: '양을', weeklyOrderCount: 20 }
    ]
  }, 'direct');
  const yangsan = Admin.buildAvgCallRows(WEEK, 'direct', 'combined')
    .find(row => String(row.region).includes('양산'));
  check('양산 합산 1쿠팡+2배민', Boolean(yangsan?.region.includes('양산B') && yangsan?.region.includes('양산C')), 'true');
  check('양산 합산 콜수 320', yangsan?.calls, 320);
  check('양산 합산 인원 3', yangsan?.people, 3);

  [
    'weekly_direct_coupang_avg_east',
    'weekly_direct_baemin_avg_east',
    'weekly_direct_coupang_avg_yangsan',
    'weekly_direct_baemin_avg_yangsan_b',
    'weekly_direct_baemin_avg_yangsan_c',
    'weekly_bro_baemin_avg_south'
  ].forEach(id => {
    S.weeklySettlements.remove(id, 'direct');
    S.weeklySettlements.remove(id, 'bro');
  });

  console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
  process.exit(failed ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(2);
});
