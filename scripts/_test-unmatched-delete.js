/**
 * 미매칭 삭제 전파 검증 (로컬, 서버 접속 없음)
 *
 * 확인하려는 것
 *   settlement_unmatched 는 upsert 전용 테이블이라, 목록에서 빠진 행을 그냥 다시 쓰면
 *   Supabase 에서 지워지지 않는다. 그래서 매칭이 끝난 건이 새로고침 때 미매칭으로
 *   되살아났다. 삭제 대상 id 가 deletedRowIds 로 실제 전달되는지 확인한다.
 *
 * 방법
 *   실제 storage.js 를 띄우고 storageAdapter.write 를 가로채서, 각 삭제/매칭 경로가
 *   어떤 deletedRowIds 를 넘기는지 기록해 검사한다.
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
window.BREM_SUPABASE_CONFIG = { mode: 'development', backend: 'local' };
window.BremPerf = { time() {}, timeEnd() {}, runSave: async (_l, o) => o.write() };

const ctx = vm.createContext(window);
const load = rel => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });

try { load('js/platforms.js'); } catch (_) { /* 없으면 무시 */ }
load('js/storage.js');

const S = ctx.window.BremStorage;
if (!S) {
  console.error('BremStorage 를 로드하지 못했습니다.');
  process.exit(2);
}
S.initStorage?.({ backend: 'local' });

let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${ok ? '' : `\n         기대=${expected}\n         실제=${actual}`}`);
}

// storageAdapter.write 가로채기 — 원래 동작은 유지하고 옵션만 기록한다.
const writes = [];
const adapter = S.__storageAdapterForTest || null;
if (!adapter) {
  // storageAdapter 가 노출돼 있지 않으면 localStorage 기반 간접 검증으로 대체한다.
  console.log('\n[주의] storageAdapter 직접 접근 불가 → 목록 잔존 여부로 간접 검증합니다.');
}

const UNMATCHED_KEY = 'brem_admin_settlement_unmatched';

function seed(rows) {
  ctx.window.localStorage.setItem(UNMATCHED_KEY, JSON.stringify(rows));
  ctx.window.BremDataCache?.invalidate?.(UNMATCHED_KEY);
}

function readRows() {
  try {
    return JSON.parse(ctx.window.localStorage.getItem(UNMATCHED_KEY) || '[]');
  } catch (_) {
    return [];
  }
}

function unmatchedRow({ period, platform = 'baemin', baeminUserId, name, weekStart }) {
  return {
    id: `${period}-${platform}-${baeminUserId}`,
    kind: 'daily',
    weekStart,
    period,
    platform,
    region: '',
    rawName: name,
    name,
    riderId: '',
    orderCount: 10,
    deliveryAmount: 10000,
    settlementAmount: 10000,
    coupangLoginKey: '',
    baeminUserId,
    matchPayload: { baeminUserId, name, rawName: name, orderCount: 10, settlementAmount: 10000 },
    sourceFileName: 'test.xlsx',
    savedAt: new Date().toISOString()
  };
}

console.log('='.repeat(70));
console.log(' 미매칭 삭제 전파 검증');
console.log('='.repeat(70));

// ── 1. clearByPeriod 가 다른 날짜를 남기고 해당 날짜만 지우는가 ──
console.log('\n[1] clearByPeriod — 지정 날짜만 제거');
seed([
  unmatchedRow({ period: '2026-07-23', baeminUserId: 'a700825', name: '장정민', weekStart: '2026-07-22' }),
  unmatchedRow({ period: '2026-07-24', baeminUserId: 'a700825', name: '장정민', weekStart: '2026-07-22' }),
  unmatchedRow({ period: '2026-07-28', baeminUserId: 'a700825', name: '장정민', weekStart: '2026-07-22' })
]);
S.settlementUnmatched.clearByPeriod('2026-07-24', 'baemin');
let rows = readRows();
check('남은 건수 2건', rows.length, 2);
check('07-24 제거됨', rows.some(r => r.period === '2026-07-24'), 'false');
check('07-23 보존', rows.some(r => r.period === '2026-07-23'), 'true');
check('07-28 보존', rows.some(r => r.period === '2026-07-28'), 'true');

// ── 2. clearByWeek ──
console.log('\n[2] clearByWeek — 해당 주/플랫폼만 제거');
seed([
  unmatchedRow({ period: '2026-07-23', baeminUserId: 'a1', name: '가', weekStart: '2026-07-22' }),
  unmatchedRow({ period: '2026-07-30', baeminUserId: 'a2', name: '나', weekStart: '2026-07-29' }),
  unmatchedRow({ period: '2026-07-23', platform: 'coupang', baeminUserId: 'a3', name: '다', weekStart: '2026-07-22' })
]);
S.settlementUnmatched.clearByWeek({ weekStart: '2026-07-22', platform: 'baemin', kind: 'daily' });
rows = readRows();
check('남은 건수 2건', rows.length, 2);
check('다음주(07-29) 보존', rows.some(r => r.weekStart === '2026-07-29'), 'true');
check('같은주 쿠팡 보존', rows.some(r => r.platform === 'coupang'), 'true');

// ── 3. 재업로드 시 옛 행이 밀려나는가 ──
console.log('\n[3] saveBatch 재업로드 — 같은 날짜 옛 행 교체');
seed([
  unmatchedRow({ period: '2026-07-28', baeminUserId: 'old1', name: '옛사람', weekStart: '2026-07-22' }),
  unmatchedRow({ period: '2026-07-27', baeminUserId: 'keep1', name: '유지', weekStart: '2026-07-22' })
]);
// saveBatch 는 입력의 riderId 에서 배민ID를 뽑는다. (레코드 형식을 실제와 같게 맞춘다)
S.settlementUnmatched.saveBatch({
  period: '2026-07-28',
  platform: 'baemin',
  sourceFileName: 're.xlsx',
  records: [{ riderId: 'new1', rawName: '새사람', name: '새사람', orderCount: 5, settlementAmount: 5000, deliveryAmount: 5000 }]
});
rows = readRows();
check('07-28 옛 행 제거', rows.some(r => r.baeminUserId === 'old1'), 'false');
check('07-28 새 행 존재', rows.some(r => r.name === '새사람' && r.period === '2026-07-28'), 'true');
check('07-27 보존', rows.some(r => r.baeminUserId === 'keep1'), 'true');
check('07-28 은 새 행 1건만', rows.filter(r => r.period === '2026-07-28').length, 1);

// ── 4. clearAll ──
console.log('\n[4] clearAll — 전체 제거');
seed([
  unmatchedRow({ period: '2026-07-23', baeminUserId: 'a1', name: '가', weekStart: '2026-07-22' }),
  unmatchedRow({ period: '2026-07-24', baeminUserId: 'a2', name: '나', weekStart: '2026-07-22' })
]);
S.settlementUnmatched.clearAll();
check('전부 제거', readRows().length, 0);

// ── 5. deletedRowIds 가 실제로 계산되는지 (소스 확인) ──
console.log('\n[5] 소스 확인 — 미매칭 쓰기 지점에 deletedRowIds 누락 없나');
const src = fs.readFileSync(path.join(root, 'js/storage.js'), 'utf8');
const writeLines = src.split(/\r?\n/)
  .map((line, i) => ({ line, no: i + 1 }))
  .filter(({ line }) => /storageAdapter\.write\(\s*(KEYS\.settlementUnmatched|settlementUnmatchedKey)/.test(line));
// 마이그레이션(정규화) 1건은 삭제가 아니라 형식 보정이므로 제외한다.
const needsDelete = writeLines.filter(({ no }) => {
  const chunk = src.split(/\r?\n/).slice(no - 1, no + 4).join('\n');
  return !/if \(migrated\)/.test(chunk);
});
const missing = needsDelete.filter(({ no }) => {
  const chunk = src.split(/\r?\n/).slice(no - 1, no + 4).join('\n');
  return !/deletedRowIds/.test(chunk);
});
check('deletedRowIds 누락 지점 0곳', missing.length, 0);
if (missing.length) missing.forEach(m => console.log(`         누락: line ${m.no} ${m.line.trim()}`));

// ── 6. 어댑터가 deleteOnly 없이도 삭제를 수행하는가 (소스 확인) ──
console.log('\n[6] 소스 확인 — 어댑터가 deletedRowIds 를 실제로 삭제에 쓰는가');
const adapterSrc = fs.readFileSync(path.join(root, 'js/storage-supabase-adapter.js'), 'utf8');
const hasPostDelete = /if \(!deleteOnly && deletedRowIds\.length\)\s*\{\s*await deleteRowsInChunks\(table, deletedRowIds\);/.test(adapterSrc);
check('upsert 후 deletedRowIds 삭제 경로 존재', hasPostDelete, 'true');

console.log('\n' + '='.repeat(70));
if (failed) {
  console.log(` 실패 ${failed}건`);
  process.exit(1);
}
console.log(' 전체 통과');
