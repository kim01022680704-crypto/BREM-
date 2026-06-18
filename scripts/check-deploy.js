# GitHub Push / 배포 전 자동 점검
# Run: npm run check-deploy  (Node.js 필요)

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const results = [];

function pass(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
}

function warn(name, detail) {
  results.push({ name, ok: true, warn: true, detail });
  console.log(`⚠️  ${name}${detail ? ` — ${detail}` : ''}`);
}

function run(cmd, args, options) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...options
  });
}

function git(args) {
  return run('git', args);
}

function fileExists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// 1. assets/brand
const brandDir = path.join(ROOT, 'assets', 'brand');
const brandFiles = fileExists('assets/brand')
  ? fs.readdirSync(brandDir).filter(name => /\.(png|svg|jpg|webp)$/i.test(name))
  : [];

if (brandFiles.length >= 5) {
  pass('assets/brand 이미지', `${brandFiles.length}개 파일`);
} else {
  fail('assets/brand 이미지', `파일 부족 (${brandFiles.length}개)`);
}

const trackedBrand = git(['ls-files', 'assets/brand/']);
if (trackedBrand.status === 0 && trackedBrand.stdout.trim()) {
  pass('assets/brand Git 추적', trackedBrand.stdout.trim().split('\n').length + '개 추적됨');
} else {
  warn('assets/brand Git 추적', '아직 git add 되지 않음 — Push 전 add 필요');
}

// 2. supabase-config secrets
const configText = fileExists('js/supabase-config.js') ? read('js/supabase-config.js') : '';
if (/service_role|SERVICE_ROLE/i.test(configText)) {
  fail('supabase-config.js 민감정보', 'service_role 문자열 발견');
} else {
  pass('supabase-config.js service_role 없음');
}

if (/sb_publishable_|supabase\.co/.test(configText)) {
  fail('supabase-config.js 하드코딩', 'URL/키 하드코딩 잔존');
} else {
  pass('supabase-config.js 하드코딩 없음');
}

// 3. gitignore
['.env', 'data/rider_inquiries.json', '_restore_tmp'].forEach(item => {
  const ignored = git(['check-ignore', '-v', item]);
  if (ignored.status === 0) {
    pass(`gitignore: ${item}`, ignored.stdout.trim().split('\n')[0] || 'ignored');
  } else if (item === '_restore_tmp' && fileExists('_restore_tmp')) {
    warn(`gitignore: ${item}`, '폴더 존재 — .gitignore 확인 권장');
  } else if (item === 'data/rider_inquiries.json' && !fileExists(item)) {
    pass(`gitignore: ${item}`, '파일 없음 (OK)');
  } else {
    fail(`gitignore: ${item}`, '커밋 제외 미적용');
  }
});

// 4. npm install
const install = run('npm', ['install'], { stdio: 'pipe' });
if (install.status === 0) {
  pass('npm install');
} else {
  fail('npm install', (install.stderr || install.stdout || '').trim().slice(0, 200));
}

// 5. npm run qa
const qa = run('npm', ['run', 'qa'], { stdio: 'pipe' });
if (qa.status === 0) {
  pass('npm run qa');
} else {
  fail('npm run qa', (qa.stderr || qa.stdout || '').trim().slice(0, 300));
}

// 6. server routes smoke (start briefly)
const pages = ['/', '/index.html', '/portal-rider.html', '/portal-promotion.html', '/home.html', '/api/public-config'];
let serverProc = null;

try {
  serverProc = spawnSync('node', ['server/index.js'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PORT: '3099' },
    timeout: 5000
  });
} catch {
  /* timeout expected if server keeps running — use fetch alternative */
}

async function smokeRoutes() {
  const http = require('http');
  const { spawn } = require('child_process');

  return new Promise((resolve) => {
    const child = spawn('node', ['server/index.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: '3099' },
      stdio: 'ignore',
      detached: false
    });

    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* ignore */ }
      resolve(result);
    };

    setTimeout(async () => {
      try {
        for (const page of pages) {
          await new Promise((res, rej) => {
            http.get(`http://127.0.0.1:3099${page}`, (response) => {
              if (response.statusCode >= 200 && response.statusCode < 400) {
                pass(`route ${page}`, `HTTP ${response.statusCode}`);
              } else {
                fail(`route ${page}`, `HTTP ${response.statusCode}`);
              }
              response.resume();
              res();
            }).on('error', rej);
          });
        }
        done(true);
      } catch (error) {
        fail('localhost 라우팅', error.message);
        done(false);
      }
    }, 1200);

    setTimeout(() => done(false), 10000);
  });
}

smokeRoutes().then(() => {
  const failed = results.filter(item => !item.ok);
  console.log('\n---');
  if (failed.length) {
    console.log(`점검 실패: ${failed.length}건`);
    process.exit(1);
  }
  console.log('점검 통과 — Push 준비 OK (Supabase env 설정은 배포 시 별도)');
  process.exit(0);
});
