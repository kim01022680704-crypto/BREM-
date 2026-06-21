/**
 * 거절율/수락율 Supabase 저장 경로 점검
 * Run: node scripts/test-rejection-supabase-storage.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const REJECTION_KEY = 'brem_admin_rejection_rates';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function pass(msg) {
  console.log(`PASS: ${msg}`);
  return true;
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  return false;
}

let ok = true;
const check = (name, condition, detail = '') => {
  if (!condition) {
    ok = false;
    fail(`${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    pass(name);
  }
};

console.log('=== 거절율/수락율 Supabase 저장 경로 점검 ===\n');

const storageJs = read('js/storage.js');
const adapterJs = read('js/storage-supabase-adapter.js');
const guardJs = read('js/storage-guard.js');
const bulkJs = read('js/rejection-bulk.js');
const dataCacheJs = read('js/data-cache.js');

check('storage.js — rejections 키', storageJs.includes(`rejections: '${REJECTION_KEY}'`));
check('storage.js — upsertWeekly → storageAdapter.write', /rejections[\s\S]*upsertWeekly[\s\S]*storageAdapter\.write\(KEYS\.rejections/.test(storageJs));
check('storage.js — localStorage setItem 없음', !/localStorage\.setItem/.test(storageJs));
check('rejection-bulk.js — localStorage 없음', !/localStorage/.test(bulkJs));
check('rejection-bulk.js — upsertWeekly 사용', bulkJs.includes('BremStorage.rejections.upsertWeekly'));
check('rejection-bulk.js — flushStorage 대기', bulkJs.includes('flushStorage'));
check('adapter — settings upsert', adapterJs.includes("from('settings').upsert"));
check('adapter — persistSetting', /async function persistSetting/.test(adapterJs));
check('guard — rejection_rates 보호', guardJs.includes(`'${REJECTION_KEY}'`));
check('data-cache — clearAll (로그아웃 캐시 삭제)', dataCacheJs.includes('function clearAll'));
check('storage.js — signOut 시 clearAll', storageJs.includes('BremDataCache?.clearAll'));

// In-memory storage smoke: write path uses adapter, not localStorage
const store = {};
const localStorage = {
  get length() { return 0; },
  key() { return null; },
  getItem() { return null; },
  setItem(k, v) { store[k] = String(v); throw new Error('localStorage write blocked in test'); },
  removeItem(k) { delete store[k]; }
};
const sessionStorage = {
  _s: {},
  get length() { return Object.keys(this._s).length; },
  key(i) { return Object.keys(this._s)[i] ?? null; },
  getItem(k) { return this._s[k] ?? null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; }
};

const code = storageJs;
const context = {
  window: { localStorage, sessionStorage, XLSX: null, BremDataCache: null, BremStorageGuard: null },
  localStorage,
  sessionStorage,
  document: { dispatchEvent() {}, addEventListener() {} },
  console
};
vm.runInNewContext(code, context);

const driver = context.BremStorage.drivers.create({
  name: '거절율테스트',
  phone: '010-1111-2222',
  platformCoupang: true
});
context.BremStorage.rejections.upsertWeekly({
  driverId: driver.id,
  weekStart: '2026-06-17',
  rate: 12.5,
  platform: 'coupang'
});
const saved = context.BremStorage.rejections.getRateForWeek(driver.id, '2026-06-17', 'coupang');
check('메모리 upsertWeekly', saved === 12.5, `rate=${saved}`);
check('localStorage 미사용', Object.keys(store).length === 0, `keys=${Object.keys(store).join(',')}`);
context.BremStorage.drivers.remove(driver.id);

console.log('\n---');
if (ok) {
  console.log('거절율/수락율은 Supabase settings 테이블에 저장됩니다.');
  console.log(`키: ${REJECTION_KEY}`);
  console.log('흐름: upsertWeekly → storageAdapter.write → settings.upsert');
  process.exit(0);
}
console.error('점검 실패');
process.exit(1);
