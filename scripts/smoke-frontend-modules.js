/**
 * 프론트엔드 모듈이 브라우저 환경에서 로드/동작하는지 최소 확인한다.
 * (문법 오류·초기화 시점 예외·오타로 인한 ReferenceError 를 잡는 용도)
 * 사용: node scripts/smoke-frontend-modules.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = process.cwd();
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://localhost/',
  runScripts: 'outside-only'
});

const { window } = dom;
window.fetch = () => Promise.reject(new Error('smoke test: network disabled'));

const failures = [];
function load(relPath) {
  const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  try {
    window.eval(code);
    console.log(`  ok  ${relPath}`);
  } catch (error) {
    failures.push(`${relPath}: ${error.message}`);
    console.log(` FAIL ${relPath} — ${error.message}`);
  }
}

console.log('브라우저 모듈 로드 확인');
['js/brem-env.js', 'js/perf.js', 'js/data-cache.js', 'js/driver-utils.js'].forEach(load);

console.log('\n동작 확인');
const utils = window.BremDriverUtils;
const todayKST = utils?.todayKST?.();
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(todayKST))) {
  failures.push(`BremDriverUtils.todayKST() 형식 오류: ${todayKST}`);
  console.log(` FAIL todayKST → ${todayKST}`);
} else {
  const utcToday = new Date().toISOString().slice(0, 10);
  console.log(`  ok  todayKST → ${todayKST} (UTC ${utcToday})`);
}

console.log(failures.length ? `\n실패 ${failures.length}건\n- ${failures.join('\n- ')}` : '\n전부 통과');
process.exit(failures.length ? 1 : 0);
