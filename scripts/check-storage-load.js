const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function load(file) {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  try {
    new Function(code);
    console.log(`OK parse: ${file}`);
  } catch (e) {
    console.error(`FAIL parse: ${file}`, e.message);
    process.exitCode = 1;
  }
}

['js/storage-supabase-mapper.js', 'js/storage-guard.js', 'js/storage-supabase-adapter.js', 'js/storage.js'].forEach(load);

const sandbox = {
  window: {},
  document: { addEventListener() {} },
  console,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

const mapper = fs.readFileSync(path.join(root, 'js/storage-supabase-mapper.js'), 'utf8');
vm.runInContext(mapper, sandbox);
const adapter = fs.readFileSync(path.join(root, 'js/storage-supabase-adapter.js'), 'utf8');
vm.runInContext(adapter, sandbox);
console.log('Adapter export:', typeof sandbox.window.BremSupabaseStorageAdapter?.createSupabaseAdapter);
