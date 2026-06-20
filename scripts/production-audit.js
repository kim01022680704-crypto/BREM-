/**
 * BREM production deployment static audit
 * Run: node scripts/production-audit.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`PASS: ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
}

function warn(name, detail = '') {
  results.push({ name, ok: true, warn: true, detail });
  console.warn(`WARN: ${name}${detail ? ` — ${detail}` : ''}`);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function grepFiles(pattern, globs) {
  const hits = [];
  globs.forEach(rel => {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) return;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      fs.readdirSync(full).forEach(name => {
        const child = path.join(rel, name);
        if (/\.(js|html|css)$/.test(name)) {
          const text = read(child);
          if (pattern.test(text)) hits.push(child);
        }
      });
    } else if (pattern.test(read(rel))) {
      hits.push(rel);
    }
  });
  return hits;
}

// 1. No service_role in frontend
const configJs = read('js/supabase-config.js');
if (/service_role|SERVICE_ROLE/i.test(configJs)) fail('Frontend secrets', 'service_role in supabase-config.js');
else pass('Frontend secrets', 'no service_role in supabase-config.js');

// 2. localStorage write in production paths (exclude purge/migration)
const storageJs = read('js/storage.js');
if (/localStorage\.setItem/.test(storageJs)) fail('localStorage write', 'storage.js contains setItem');
else pass('localStorage write', 'storage.js has no setItem');

const migrateJs = read('js/storage-migrate-supabase.js');
if (!/isProductionMode|production.*throw/i.test(migrateJs)) warn('Migration guard', 'verify production block');
else pass('Migration guard', 'production migration blocked');

// 3. Session storage policy
if (!/sessionStorage only|sessionStorage 기준/i.test(storageJs)) warn('Session docs', 'session policy comment');
else pass('Session policy', 'documented in storage.js');

// 4. Production guard
if (!/enforceProductionStorageGuard/.test(storageJs)) fail('Production guard', 'missing');
else pass('Production guard', 'present');

// 5. Admin auth production block for local login
if (!/verifyAdminLogin[\s\S]*production[\s\S]*Supabase Auth/.test(storageJs)) fail('Admin local login block');
else pass('Admin local login block', 'production uses Supabase Auth only');

// 6. Viewport on staff pages
['admin.html', 'driver.html', 'drivers.html', 'rider-manage.html'].forEach(page => {
  const html = read(page);
  if (!/name="viewport"/.test(html)) fail(`Viewport ${page}`);
  else pass(`Viewport ${page}`);
});

// 7. Mobile CSS breakpoints
['css/admin.css', 'css/style.css', 'css/driver.css'].forEach(css => {
  if (!/@media/.test(read(css))) warn(`${css} responsive`, 'no media queries');
  else pass(`${css} responsive`);
});

// 8. Server public config
const publicConfig = read('server/public-config.js');
if (!/BREM_ALLOW_LOCAL_FALLBACK/.test(publicConfig)) warn('public-config', 'fallback env');
else pass('public-config', 'allowLocalFallback from env');

// 9. Riders API pagination
if (!/limit.*offset/.test(read('server/riders-admin.js'))) warn('Riders API', 'pagination');
else pass('Riders API pagination');

// 10. Performance indexes file
if (fs.existsSync(path.join(ROOT, 'supabase/performance_indexes.sql'))) pass('DB indexes file');
else warn('DB indexes file', 'missing performance_indexes.sql');

// 11. Data cache layer
if (fs.existsSync(path.join(ROOT, 'js/data-cache.js'))) pass('Data cache module');
else fail('Data cache module', 'missing js/data-cache.js');

const dataCacheJs = fs.existsSync(path.join(ROOT, 'js/data-cache.js'))
  ? read('js/data-cache.js')
  : '';
if (/localStorage/.test(dataCacheJs)) fail('Data cache storage', 'uses localStorage');
else if (dataCacheJs) pass('Data cache storage', 'sessionStorage only');

if (/BremLoadingUI/.test(read('js/data-loading-ui.js'))) pass('Loading UI module');
else fail('Loading UI module', 'missing BremLoadingUI');

if (/isSectionCacheReady/.test(read('js/storage.js'))) pass('Section cache guard');
else fail('Section cache guard', 'missing isSectionCacheReady');

console.log('\n---');
const failed = results.filter(r => !r.ok);
if (failed.length) {
  console.error(`Audit failed: ${failed.length} issue(s)`);
  process.exit(1);
}
console.log('Production static audit passed.');
process.exit(0);
