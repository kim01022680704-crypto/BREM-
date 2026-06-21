/**
 * Static audit: operational data must not use localStorage or sessionStorage cache mirrors.
 * Run: node scripts/storage-persistence-audit.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failed = 0;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function pass(msg) {
  console.log(`PASS: ${msg}`);
}

function fail(msg) {
  failed += 1;
  console.error(`FAIL: ${msg}`);
}

const storageJs = read('js/storage.js');
const adapterJs = read('js/storage-supabase-adapter.js');
const cacheJs = read('js/data-cache.js');
const guardJs = read('js/storage-guard.js');

if (/localStorage\.setItem/.test(storageJs)) fail('storage.js must not setItem localStorage');
else pass('storage.js no localStorage setItem');

if (/useLocalStorageAdapter[\s\S]*throw/.test(storageJs)) pass('localStorage adapter disabled');
else fail('useLocalStorageAdapter must throw');

if (/SESSION_MIRROR_KEYS[\s\S]*brem_driver_management_drivers/.test(cacheJs)) {
  pass('data-cache drivers tab-session mirror enabled');
} else {
  fail('data-cache must mirror drivers to sessionStorage for tab navigation');
}

if (/localStorage\.(setItem|getItem)/.test(cacheJs)) {
  fail('data-cache must not use localStorage');
} else {
  pass('data-cache no localStorage');
}

const tableKeys = [
  'KEYS.adminSchedules',
  'KEYS.calls',
  'KEYS.rejections',
  'KEYS.targets'
];
tableKeys.forEach(token => {
  if (storageJs.includes(token) && /TABLE_STORAGE_KEYS/.test(storageJs)) {
    pass(`TABLE_STORAGE_KEYS includes ${token}`);
  } else {
    fail(`TABLE_STORAGE_KEYS missing ${token}`);
  }
});

if (/admin_calls/.test(adapterJs) && /admin_rejection_rates/.test(adapterJs)) {
  pass('adapter uses dedicated operation tables');
} else {
  fail('adapter missing operation table handlers');
}

if (/using settings fallback/i.test(adapterJs)) {
  fail('adapter must not use settings fallback for table-backed keys');
} else {
  pass('no settings fallback strings in adapter');
}

if (/brem_admin_schedules/.test(guardJs) && /TABLE_PERSIST_KEYS/.test(guardJs)) {
  pass('storage-guard protects table-backed keys');
} else {
  fail('storage-guard TABLE_PERSIST_KEYS incomplete');
}

if (fs.existsSync(path.join(ROOT, 'supabase/operations_tables_migration.sql'))) {
  pass('operations_tables_migration.sql exists');
} else {
  fail('operations_tables_migration.sql missing');
}

if (fs.existsSync(path.join(ROOT, 'supabase/MIGRATION_ORDER.md'))) {
  pass('MIGRATION_ORDER.md exists');
} else {
  fail('MIGRATION_ORDER.md missing');
}

console.log(`\n${failed ? failed + ' failed' : 'All checks passed'}`);
process.exit(failed ? 1 : 0);
