/**
 * BREM data cache layer tests
 * Run: node scripts/test-data-cache.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

function loadCacheModule() {
  const code = fs.readFileSync(path.join(ROOT, 'js/data-cache.js'), 'utf8');
  const sandbox = { window: { sessionStorage: session }, sessionStorage: session, console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.BremDataCache;
}

function loadStorageChecks() {
  const storageJs = fs.readFileSync(path.join(ROOT, 'js/storage.js'), 'utf8');
  return storageJs;
}

const session = {
  store: new Map(),
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  },
  setItem(key, value) {
    this.store.set(key, value);
  },
  removeItem(key) {
    this.store.delete(key);
  }
};

global.sessionStorage = session;

const cache = loadCacheModule();
assert('BremDataCache module loads', Boolean(cache));

cache.set('brem_driver_management_drivers', [{ id: '1' }], { complete: true });
assert('cache set/get memory', cache.getData('brem_driver_management_drivers')[0].id === '1');
assert('drivers memory-only (no sessionStorage mirror)', session.getItem('brem_dc_brem_driver_management_drivers') == null);

cache.set('test-key', [{ id: '2' }]);
assert('non-mirror key skips sessionStorage', session.getItem('brem_dc_test-key') == null);

cache.invalidate('test-key');
assert('cache invalidate clears memory', cache.getData('test-key') == null);
assert('cache invalidate clears sessionStorage', session.getItem('brem_dc_test-key') == null);

let fetchCount = 0;
const p1 = cache.runOnce('task-a', async () => {
  fetchCount += 1;
  await new Promise(resolve => setTimeout(resolve, 20));
  return 'done';
});
const p2 = cache.runOnce('task-a', async () => {
  fetchCount += 1;
  return 'duplicate';
});

Promise.all([p1, p2]).then(([a, b]) => {
  assert('runOnce dedupes concurrent calls', fetchCount === 1);
  assert('runOnce returns same result', a === 'done' && b === 'done');

  const storageJs = loadStorageChecks();
  assert('storage.js has section cache ready helper', /function isSectionCacheReady/.test(storageJs));
  assert('storage.js dedupes section loads', /sectionLoadPromises/.test(storageJs));
  assert('storage.js has cache sync on mutation', /function scheduleCacheSyncAfterWrite/.test(storageJs));
  assert('storage.js has bootstrap loader', /function loadBootstrapData/.test(storageJs));
  assert('storage.js removed drivers TTL refetch', !/DRIVERS_SYNC_TTL_MS/.test(storageJs));
  assert('adapter uses BremDataCache', /BremDataCache/.test(fs.readFileSync(path.join(ROOT, 'js/storage-supabase-adapter.js'), 'utf8')));
  assert('loading UI module exists', fs.existsSync(path.join(ROOT, 'js/data-loading-ui.js')));
  assert('loading UI has showStatus', /showStatus/.test(fs.readFileSync(path.join(ROOT, 'js/data-loading-ui.js'), 'utf8')));
  assert('no localStorage API in data-cache', !/localStorage\.(setItem|getItem)/.test(fs.readFileSync(path.join(ROOT, 'js/data-cache.js'), 'utf8')));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}).catch(error => {
  console.error(error);
  process.exit(1);
});
