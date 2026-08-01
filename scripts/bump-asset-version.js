/**
 * 수정된 프론트엔드 파일의 ?v= 캐시버스터를 한 번에 올린다.
 * 사용: node scripts/bump-asset-version.js <version> <파일명...>
 * 예:  node scripts/bump-asset-version.js 20260801f storage.js admin.js
 */
const fs = require('fs');
const path = require('path');

const [version, ...assets] = process.argv.slice(2);
if (!version || !assets.length) {
  console.error('사용법: node scripts/bump-asset-version.js <version> <파일명...>');
  process.exit(1);
}

const HTML_FILES = fs
  .readdirSync(process.cwd())
  .filter(name => name.endsWith('.html'));

let changedFiles = 0;
for (const htmlFile of HTML_FILES) {
  const abs = path.join(process.cwd(), htmlFile);
  const before = fs.readFileSync(abs, 'utf8');
  let after = before;
  for (const asset of assets) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    after = after.replace(
      new RegExp(`(js/${escaped})\\?v=[A-Za-z0-9._-]+`, 'g'),
      `$1?v=${version}`
    );
  }
  if (after !== before) {
    fs.writeFileSync(abs, after);
    changedFiles += 1;
    console.log(`bumped ${htmlFile}`);
  }
}
console.log(changedFiles ? `\n${changedFiles}개 HTML 갱신 (v=${version})` : '\n변경된 참조가 없습니다.');
