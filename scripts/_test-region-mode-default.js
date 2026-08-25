/**
 * 기사지역관리 기본값 = 미노출 검증 (로컬, DB 접속 없음)
 *
 * 확인 항목
 *  - 설정이 없으면 미노출 (신규 등록 기사)
 *  - 「올노출」은 명시값이므로 그대로 유지 (기본값에 먹히지 않는다)
 *  - 「팀장」 명시값 유지 (기존 8명 보존)
 *  - 미노출도 집계·순위에는 계속 포함 (앱 대시보드만 숨김)
 *  - 서버·클라이언트 기본값이 서로 같다
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const server = require(path.join(root, 'server', 'rider-region-dashboard.js'));
const S = server.__test;

let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${ok ? '' : `  기대=${expected} 실제=${actual}`}`);
}

const REGION = { key: 'r1', platform: 'baemin', label: '남구e', partnerId: 'DP2607289309' };

console.log('\n[1] 서버 — 설정이 없을 때 기본값');
check('기본 상수 = hidden', server.DEFAULT_RIDER_REGION_MODE, 'hidden');
check('빈 exposure → hidden', S.getRiderRegionModeForRegion({}, REGION, 'newRider'), 'hidden');
check('지역은 있고 기사 설정만 없음 → hidden',
  S.getRiderRegionModeForRegion({ baemin: { r1: { riders: {} } } }, REGION, 'newRider'), 'hidden');
check('driverId 없음 → hidden', S.getRiderRegionModeForRegion({}, REGION, ''), 'hidden');
check('getRiderRegionMode 도 hidden', S.getRiderRegionMode({}, 'baemin', 'r1', 'newRider'), 'hidden');

console.log('\n[2] 서버 — 명시값은 기본값에 먹히지 않는다');
const withModes = {
  baemin: {
    r1: {
      riders: {
        A: { mode: 'full' },
        B: { mode: 'leader' },
        C: { mode: 'hidden' },
        D: { mode: 'dashboard' },
        E: { mode: 'metrics' },
        F: { mode: '' },
        G: { mode: '올노출' }
      }
    }
  }
};
check('명시 full → full',      S.getRiderRegionModeForRegion(withModes, REGION, 'A'), 'full');
check('명시 leader → leader',  S.getRiderRegionModeForRegion(withModes, REGION, 'B'), 'leader');
check('명시 hidden → hidden',  S.getRiderRegionModeForRegion(withModes, REGION, 'C'), 'hidden');
check('명시 dashboard 유지',   S.getRiderRegionModeForRegion(withModes, REGION, 'D'), 'dashboard');
check('명시 metrics 유지',     S.getRiderRegionModeForRegion(withModes, REGION, 'E'), 'metrics');
check('빈 문자열 → hidden',    S.getRiderRegionModeForRegion(withModes, REGION, 'F'), 'hidden');
check('한글 "올노출" → full',  S.getRiderRegionModeForRegion(withModes, REGION, 'G'), 'full');

console.log('\n[3] 서버 — 저장 시 정규화 (라디오 값 그대로 들어온다)');
check("normalize('full')", S.normalizeRiderRegionMode('full'), 'full');
check("normalize('hidden')", S.normalizeRiderRegionMode('hidden'), 'hidden');
check("normalize('leader')", S.normalizeRiderRegionMode('leader'), 'leader');
check("normalize(undefined) → hidden", S.normalizeRiderRegionMode(undefined), 'hidden');
check("normalize('알수없는값') → hidden", S.normalizeRiderRegionMode('zzz'), 'hidden');

console.log('\n[4] 미노출도 집계·순위에는 포함 (앱 대시보드만 숨김)');
const riders = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }, { id: 'E' }, { id: 'newRider' }];
const ranked = S.filterRankingRiders(withModes, 'baemin', 'r1', riders, REGION).map(r => r.id);
check('full 포함', ranked.includes('A'), 'true');
check('hidden 포함', ranked.includes('C'), 'true');
check('metrics 포함', ranked.includes('E'), 'true');
check('설정없음(신규)도 포함', ranked.includes('newRider'), 'true');
check('leader 제외', ranked.includes('B'), 'false');
check('dashboard 제외', ranked.includes('D'), 'false');

console.log('\n[5] 클라이언트 기본값이 서버와 같은가');
const dom = { document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} } };
const src = fs.readFileSync(path.join(root, 'js', 'driver-management-admin.js'), 'utf8');
const constMatch = src.match(/const\s+DEFAULT_DRIVER_REGION_MODE\s*=\s*'([^']+)'/);
check('클라이언트 상수 존재', Boolean(constMatch), 'true');
check('클라이언트 = 서버 기본값', constMatch?.[1], server.DEFAULT_RIDER_REGION_MODE);
check('클라이언트 normalize 에 full 분기 있음',
  /mode === 'full' \|\| mode === 'all'/.test(src), 'true');
check('클라이언트 getDriverRegionMode 가 상수를 반환',
  /return DEFAULT_DRIVER_REGION_MODE;/.test(src), 'true');

console.log('\n[6] 저장 압축 규칙 — 올노출을 지우면 안 된다');
const saveSrc = fs.readFileSync(path.join(root, 'server', 'rider-region-dashboard.js'), 'utf8');
check('DEFAULT 모드일 때만 delete', /if \(mode === DEFAULT_RIDER_REGION_MODE\) \{[\s\S]{0,200}delete riders\[id\]/.test(saveSrc), 'true');
check("더 이상 mode === 'full' 로 delete 하지 않음", /if \(mode === 'full'\)\s*\{\s*\n\s*\/\/[^\n]*\n\s*delete riders/.test(saveSrc), 'false');

console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
process.exit(failed ? 1 : 0);
