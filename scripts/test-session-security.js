/**
 * session-security.js start/stop null-guard regression test (Node)
 * Run: node scripts/test-session-security.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'session-security.js'), 'utf8');
const context = {
  window: {},
  document: {
    addEventListener() {},
    removeEventListener() {}
  },
  sessionStorage: {
    store: {},
    setItem(key, value) { this.store[key] = String(value); },
    getItem(key) { return this.store[key] ?? null; },
    removeItem(key) { delete this.store[key]; }
  }
};
context.window = context;
vm.createContext(context);
vm.runInContext(code, context);

const security = context.window.BremSessionSecurity;
let errors = 0;

function assert(name, condition) {
  if (!condition) {
    console.error('FAIL:', name);
    errors += 1;
    return;
  }
  console.log('PASS:', name);
}

assert('start rejects missing isLoggedIn', security.start({}) === false);
assert('start rejects null isLoggedIn', security.start({ isLoggedIn: null }) === false);
assert('start rejects logged-out callback', security.start({
  isLoggedIn: () => false
}) === false);

const started = security.start({
  isLoggedIn: () => true,
  onIdleLogout: async () => {}
});
assert('start accepts logged-in callback', started === true);
assert('isActive after start', security.isActive() === true);

security.stop();
assert('isActive after stop', security.isActive() === false);

assert('touchActivity after stop does not throw', (() => {
  security.touchActivity();
  return true;
})());

assert('start after stop with valid session', security.start({
  isLoggedIn: () => true,
  onIdleLogout: async () => {}
}) === true);

assert('start survives throwing isLoggedIn', security.start({
  isLoggedIn: () => { throw new Error('boom'); }
}) === false);

if (errors) {
  console.error(`\n${errors} test(s) failed`);
  process.exit(1);
}
console.log('\nAll session-security tests passed.');
