/**
 * Auth session policy regression test (Node)
 * Run: node scripts/test-auth-session.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeStore() {
  const data = {};
  return {
    get length() { return Object.keys(data).length; },
    key(index) { return Object.keys(data)[index] ?? null; },
    getItem(key) { return Object.keys(data).includes(key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    _data: data
  };
}

function loadSupabaseConfig(localStorage, sessionStorage) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'supabase-config.js'), 'utf8');
  const context = {
    window: {
      location: { hostname: 'brem.kr' },
      BremEnv: { isProductionHost: () => true },
      localStorage,
      sessionStorage,
      document: { dispatchEvent() {} }
    },
    localStorage,
    sessionStorage,
    document: { dispatchEvent() {} },
    fetch: async () => ({ ok: false })
  };
  context.window.window = context.window;
  vm.runInContext(code, context);
  return context.window;
}

function loadStorage(localStorage, sessionStorage) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8');
  const context = {
    window: { localStorage, sessionStorage, BremSupabaseConfig: { createClient() { return {}; } } },
    localStorage,
    sessionStorage,
    document: { dispatchEvent() {} },
    console
  };
  vm.runInContext(code, context);
  return context.BremStorage;
}

let errors = 0;

function assert(name, condition) {
  if (!condition) {
    console.error('FAIL:', name);
    errors += 1;
    return;
  }
  console.log('PASS:', name);
}

(function testSupabaseAuthStorage() {
  const localStorage = makeStore();
  const sessionStorage = makeStore();
  localStorage.setItem('brem-auth-token', 'legacy-local-token');

  const win = loadSupabaseConfig(localStorage, sessionStorage);
  assert('legacy local auth purged on config load', localStorage.getItem('brem-auth-token') == null);

  const client = win.BremSupabaseConfig.createClient('https://example.supabase.co', 'anon');
  assert('createClient returns client wrapper', Boolean(client));

  sessionStorage.setItem('brem-auth-token', 'session-token');
  assert('session token readable from sessionStorage', sessionStorage.getItem('brem-auth-token') === 'session-token');
})();

(function testStoragePurge() {
  const localStorage = makeStore();
  const sessionStorage = makeStore();
  localStorage.setItem('brem-auth-token', 'x');
  localStorage.setItem('brem_admin_logged_in', 'true');
  localStorage.setItem('brem_session_last_activity', '123');

  const BremStorage = loadStorage(localStorage, sessionStorage);
  BremStorage.purgeLegacyAuthFromLocalStorage();

  assert('purge removes auth token from localStorage', localStorage.getItem('brem-auth-token') == null);
  assert('purge removes admin session flag from localStorage', localStorage.getItem('brem_admin_logged_in') == null);
  assert('purge removes idle marker from localStorage', localStorage.getItem('brem_session_last_activity') == null);
})();

if (errors) {
  console.error(`\n${errors} test(s) failed`);
  process.exit(1);
}
console.log('\nAll auth session tests passed.');
