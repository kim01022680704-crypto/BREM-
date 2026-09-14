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
      document: { dispatchEvent() {} },
      supabase: { createClient: () => ({ auth: {} }) }
    },
    localStorage,
    sessionStorage,
    document: { dispatchEvent() {} },
    fetch: async () => ({ ok: false })
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.window;
}

function loadLoginPrefs(localStorage, sessionStorage, nativeApp) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'login-preferences.js'), 'utf8');
  const context = {
    window: {
      BREM_IS_NATIVE_APP: Boolean(nativeApp),
      localStorage,
      sessionStorage
    },
    localStorage,
    sessionStorage
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.window.BremLoginPrefs;
}

function loadStorage(localStorage, sessionStorage) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8');
  const context = {
    window: {
      localStorage,
      sessionStorage,
      BremSupabaseConfig: { createClient() { return {}; } },
      document: { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} }
    },
    localStorage,
    sessionStorage,
    document: { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
    console,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    },
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.window.BremStorage || context.BremStorage;
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
  localStorage.setItem('brem-auth-rider-sb-demo-auth-token', '{"access_token":"rider"}');
  localStorage.setItem('brem-auth-admin-sb-demo-auth-token', '{"access_token":"admin"}');

  const win = loadSupabaseConfig(localStorage, sessionStorage);
  assert('legacy local auth purged on config load', localStorage.getItem('brem-auth-token') == null);
  assert('rider keep-login token kept on config load', localStorage.getItem('brem-auth-rider-sb-demo-auth-token') === '{"access_token":"rider"}');
  assert('admin keep-login token kept on config load', localStorage.getItem('brem-auth-admin-sb-demo-auth-token') === '{"access_token":"admin"}');

  const client = win.BremSupabaseConfig.createClient('https://example.supabase.co', 'anon');
  assert('createClient returns client wrapper', Boolean(client));

  sessionStorage.setItem('brem-auth-token', 'session-token');
  assert('session token readable from sessionStorage', sessionStorage.getItem('brem-auth-token') === 'session-token');
})();

(function testRiderKeepLoginPrefs() {
  const localStorage = makeStore();
  const sessionStorage = makeStore();
  const prefs = loadLoginPrefs(localStorage, sessionStorage, false);
  assert('rider keep-logged-in is always on', prefs.isKeepLoggedIn('rider') === true);
  assert('rider session store is localStorage', prefs.getSessionStore('rider') === localStorage);
})();

(function testStoragePurge() {
  const localStorage = makeStore();
  const sessionStorage = makeStore();
  localStorage.setItem('brem-auth-token', 'x');
  localStorage.setItem('brem_admin_logged_in', 'true');
  localStorage.setItem('brem_driver_logged_in_id', 'driver-1');
  localStorage.setItem('brem-auth-rider-sb-demo-auth-token', 'keep-rider');
  localStorage.setItem('brem_session_last_activity', '123');

  const BremStorage = loadStorage(localStorage, sessionStorage);
  BremStorage.purgeLegacyAuthFromLocalStorage();

  assert('purge removes unscoped auth token from localStorage', localStorage.getItem('brem-auth-token') == null);
  assert('purge keeps admin session flag in localStorage', localStorage.getItem('brem_admin_logged_in') === 'true');
  assert('purge keeps rider session id in localStorage', localStorage.getItem('brem_driver_logged_in_id') === 'driver-1');
  assert('purge keeps rider scoped token in localStorage', localStorage.getItem('brem-auth-rider-sb-demo-auth-token') === 'keep-rider');
  assert('purge removes idle marker from localStorage', localStorage.getItem('brem_session_last_activity') == null);
})();

if (errors) {
  console.error(`\n${errors} test(s) failed`);
  process.exit(1);
}
console.log('\nAll auth session tests passed.');
process.exit(0);
