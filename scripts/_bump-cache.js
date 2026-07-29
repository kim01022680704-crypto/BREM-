/**
 * admin.html 의 캐시버스팅 버전을 지정한 파일들만 올린다.
 * 사용: node scripts/_bump-cache.js 20260730b js/storage.js css/admin.css ...
 */
const fs = require('fs');
const path = require('path');

const [version, ...files] = process.argv.slice(2);
if (!version || !files.length) {
  console.error('사용: node scripts/_bump-cache.js <버전> <파일...>');
  process.exit(1);
}

const target = path.join(__dirname, '..', 'admin.html');
let source = fs.readFileSync(target, 'utf8');
let bumped = 0;

files.forEach(file => {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}\\?v=[A-Za-z0-9]+`, 'g');
  const before = source;
  source = source.replace(pattern, `${file}?v=${version}`);
  if (source === before) {
    console.log(`MISS   ${file}`);
  } else {
    bumped += 1;
    console.log(`bumped ${file}`);
  }
});

fs.writeFileSync(target, source);
console.log(`총 ${bumped}개 파일 버전 상향 → ${version}`);
