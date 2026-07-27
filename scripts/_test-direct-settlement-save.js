/**
 * 직계약 주정산서 저장 경로 검증 (로컬, 서버 접속 없음)
 *
 * 수요일에 실제 정산서를 올리기 전에, 저장이 올바른 키로 가는지·여러 장 올려도
 * 이전 정산서가 살아 있는지를 실제 storage.js 코드로 확인한다.
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
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  runScripts: 'outside-only'
});
const { window } = dom;

// 로컬 백엔드로 붙여야 실제 write 경로가 돈다. (Supabase 미설정 시 어댑터가 no-op)
window.BREM_SUPABASE_CONFIG = { mode: 'development', backend: 'local' };
window.BremPerf = { time() {}, timeEnd() {} };

const ctx = vm.createContext(window);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
}

try {
  load('js/platforms.js');
} catch (_) { /* 없으면 무시 */ }
load('js/storage.js');

const S = ctx.window.BremStorage;
if (!S) {
  console.error('BremStorage 를 로드하지 못했습니다.');
  process.exit(2);
}

let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${ok ? '' : `  기대=${expected} 실제=${actual}`}`);
}

function makeRecord({ id, region, startDate, endDate, riders, channel }) {
  return {
    id,
    platform: 'baemin',
    channel,
    region,
    fileName: `${region}.xlsx`,
    startDate,
    endDate,
    paymentDate: endDate,
    uploadedAt: new Date().toISOString(),
    riders,
    summary: { channel }
  };
}

const riderA = [{ originalName: '김배민', riderName: '김배민', baeminUserId: 'BC000001', weeklyOrderCount: 100, amounts: { deliveryFee: 1000000 } }];
const riderB = [{ originalName: '이배민', riderName: '이배민', baeminUserId: 'BC000002', weeklyOrderCount: 50, amounts: { deliveryFee: 500000 } }];

(async () => {
await S.initStorage({ backend: 'local' });
check('로컬 저장소 백엔드 활성', S.getStorageBackend?.(), 'local');

console.log('\n[1] 직계약 저장이 직계약 키로 가는가');
S.weeklySettlements.save(makeRecord({
  id: 'weekly_direct_baemin_ulsan_20260722', region: '울산',
  startDate: '2026-07-22', endDate: '2026-07-28', riders: riderA, channel: 'direct'
}));
check('직계약 목록 1건', S.weeklySettlements.getAll('direct').length, 1);
check('브로 목록은 그대로 0건', S.weeklySettlements.getAll('bro').length, 0);
check('저장된 채널', S.weeklySettlements.getAll('direct')[0].channel, 'direct');

const rawDirect = JSON.parse(window.localStorage.getItem('brem_admin_weekly_settlements_direct') || '[]');
check('직계약 전용 키에 기록됨', rawDirect.length, 1);
check('브로 키는 비어 있음', window.localStorage.getItem('brem_admin_weekly_settlements') || '(없음)', '(없음)');

console.log('\n[2] 두 번째 정산서를 올려도 첫 번째가 남는가 (지역별 다중 업로드)');
S.weeklySettlements.save(makeRecord({
  id: 'weekly_direct_baemin_busan_20260722', region: '부산',
  startDate: '2026-07-22', endDate: '2026-07-28', riders: riderB, channel: 'direct'
}));
const twoUp = S.weeklySettlements.getAll('direct');
check('직계약 목록 2건', twoUp.length, 2);
check('울산 정산서 유지', twoUp.some(r => r.region === '울산'), 'true');
check('부산 정산서 추가', twoUp.some(r => r.region === '부산'), 'true');

console.log('\n[3] 같은 id 로 다시 올리면 덮어쓰기 (중복 누적 아님)');
S.weeklySettlements.save(makeRecord({
  id: 'weekly_direct_baemin_ulsan_20260722', region: '울산',
  startDate: '2026-07-22', endDate: '2026-07-28', riders: riderA.concat(riderB), channel: 'direct'
}));
const afterOverwrite = S.weeklySettlements.getAll('direct');
check('여전히 2건', afterOverwrite.length, 2);
check('울산 라이더 2명으로 갱신', afterOverwrite.find(r => r.region === '울산').riders.length, 2);

console.log('\n[4] 브로와 직계약이 서로 침범하지 않는가');
S.weeklySettlements.save(makeRecord({
  id: 'weekly_baemin_ulsan_20260722', region: '울산',
  startDate: '2026-07-22', endDate: '2026-07-28', riders: riderA, channel: 'bro'
}));
check('브로 1건', S.weeklySettlements.getAll('bro').length, 1);
check('직계약 여전히 2건', S.weeklySettlements.getAll('direct').length, 2);
check('브로 채널 표기', S.weeklySettlements.getAll('bro')[0].channel, 'bro');

console.log('\n[5] 삭제가 채널을 넘어가지 않는가');
S.weeklySettlements.remove('weekly_direct_baemin_busan_20260722', 'direct');
check('직계약 1건으로 감소', S.weeklySettlements.getAll('direct').length, 1);
check('브로 영향 없음', S.weeklySettlements.getAll('bro').length, 1);

console.log('\n[6] 정산서 금액(amounts) 이 저장 후에도 보존되는가');
const kept = S.weeklySettlements.getAll('direct')[0];
check('deliveryFee 보존', kept.riders[0]?.amounts?.deliveryFee, 1000000);

console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\n예외:', e.stack || e.message); process.exit(2); });
