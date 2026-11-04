const path = require('path');
const M = require(path.join(__dirname, '..', 'js', 'coupang-region-match.js'));

let failed = 0;
function check(label, value) {
  const ok = Boolean(value);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}`);
}

const catalog = [
  { key: '18839', vendorId: '18839', label: '포항중앙', vendorName: '배달연합#plus_경북_포항중앙' },
  { key: '19749', vendorId: '19749', label: '포항중앙(Z)', vendorName: '배달연합#plus_경북_포항중앙(Z)' },
  { key: '1', vendorId: '1', label: '남구중앙', vendorName: '배달연합#plus_대구_남구중앙' }
];
const zBases = M.coupangZBases(catalog);

console.log('\n[1] 라벨');
check('일반 표시', M.displayCoupangRegionLabel('배달연합#plus_경북_포항중앙') === '포항중앙');
check('Z 표시', M.displayCoupangRegionLabel('배달연합#plus_경북_포항중앙(Z)') === '포항중앙(Z)');

console.log('\n[2] 기사지역관리 매칭');
check('포항중앙 기사는 일반에 붙음', M.riderMatchesCoupangRegion('포항중앙', catalog[0], zBases));
check('포항중앙 기사는 Z에 안 붙음', !M.riderMatchesCoupangRegion('포항중앙', catalog[1], zBases));
check('포항중앙(Z) 기사는 Z에 붙음', M.riderMatchesCoupangRegion('포항중앙(Z)', catalog[1], zBases));
check('포항중앙(Z) 기사는 일반에 안 붙음', !M.riderMatchesCoupangRegion('포항중앙(Z)', catalog[0], zBases));
check('카탈로그는 표기 그대로 고름', M.pickCoupangCatalogRegion(catalog, '포항중앙')?.key === '18839');
check('Z 쌍 일반은 목록에서 제거', M.collapseCoupangZTwins(catalog).map(r => r.key).join(',') === '19749,1');
check('남구는 그대로', M.riderMatchesCoupangRegion('남구중앙', catalog[2], zBases));

const split = [
  { key: 'e1', vendorId: 'e1', label: '남구중앙 이글스', vendorName: '브램#plus_울산_남구중앙' },
  { key: 'z119', vendorId: 'z119', label: '남구중앙(Z) 119', vendorName: '119컴퍼니#plus_울산_남구중앙(Z)' },
  { key: 'ze', vendorId: 'ze', label: '남구중앙(Z) 이글스', vendorName: '브램#plus_울산_남구중앙(Z)' }
];
check('이글스 표기 키는 남구중앙', M.shortCoupangRegionLabel('남구중앙 이글스') === '남구중앙');
check('119 표기 키는 남구중앙', M.shortCoupangRegionLabel('남구중앙(Z) 119') === '남구중앙');
check('남구중앙은 이글스에 붙음', M.riderMatchesCoupangRegion('남구중앙', split[0]));
check('남구중앙은 Z119에 안 붙음', !M.riderMatchesCoupangRegion('남구중앙', split[1]));
check('남구중앙은 Z이글스에 안 붙음', !M.riderMatchesCoupangRegion('남구중앙', split[2]));
check('남구중앙(Z)는 Z119에 안 붙음', !M.riderMatchesCoupangRegion('남구중앙(Z)', split[1]));
check('남구중앙(Z)는 Z이글스에 붙음', M.riderMatchesCoupangRegion('남구중앙(Z)', split[2]));

console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
process.exit(failed ? 1 : 0);
