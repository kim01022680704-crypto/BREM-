/**
 * 수익 관리 · 지역별 정산 붙여넣기·합산 검증 (로컬, 서버 접속 없음)
 *
 * 확인 항목
 *  - 쿠팡 정산서: C열 지역구 · G열 부가세 · J열 실지급액을 지역별로 읽는지
 *  - 배민 정산서: C31 부가세액 · D31 공급대가 − (I열 고용보험 + J열 산재보험)
 *  - 지역명 매칭: 울산_/경남_ 접두사는 무시하고, (Z)는 포항중앙과 포항중앙(Z)를 구분
 *  - 엑셀 붙여넣기 A/B/C · 배민 같은 권역 합산 · 미매칭
 *  - 남은 금액 = 실지급액 − 부가세×20% − 최종입금 − 선정산
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (_) {
  console.error('jsdom 이 필요합니다: npm i -D jsdom');
  process.exit(2);
}

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

function extractSection(id) {
  const start = html.indexOf(`<section class="section" id="${id}">`);
  if (start < 0) throw new Error(`섹션 ${id} 을(를) 찾지 못했습니다.`);
  let depth = 0;
  const re = /<\/?section\b[^>]*>/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('</')) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error(`섹션 ${id} 의 끝을 찾지 못했습니다.`);
}

const dom = new JSDOM(
  `<!doctype html><html><body>${extractSection('revenue-management')}</body></html>`,
  { url: 'http://localhost/', runScripts: 'outside-only' }
);
const { window } = dom;
const ctx = vm.createContext(window);
vm.runInContext(
  fs.readFileSync(path.join(root, 'js/admin-revenue-region-settlement.js'), 'utf8'),
  ctx,
  { filename: 'admin-revenue-region-settlement.js' }
);

const M = window.BremRevenueRegionSettlement;
if (!M) {
  console.error('모듈 로드 실패');
  process.exit(2);
}

let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${ok ? '' : `  기대=${expected} 실제=${actual}`}`);
}

/** 열 인덱스로 행을 만든다. { 2: '울산_남구중앙' } → ['', '', '울산_남구중앙'] */
function row(map) {
  const max = Math.max(...Object.keys(map).map(Number), 0);
  const out = new Array(max + 1).fill('');
  Object.entries(map).forEach(([index, value]) => { out[Number(index)] = value; });
  return out;
}

// --- 쿠팡 정산서 (스크린샷 구조 재현) ---------------------------------------
// 18행: 요약(총 합계) · 22행: 지역구 헤더 · 23행~: 지역별 데이터
const coupangRows = [];
for (let i = 0; i < 17; i += 1) coupangRows.push(['']);
coupangRows.push(row({ 1: '사업자등록증명', 4: '총 수행 건수', 5: '공급가액 합계', 6: '부가세 합계', 7: '총 합계금액', 8: '총 보험료', 9: '총 실지급액' }));
coupangRows.push(row({ 1: '배달 이글스', 4: '16731', 5: '82496770', 6: '8249677', 7: '90746447', 8: '-1976541', 9: '88769906' }));
coupangRows.push(['']);
coupangRows.push(['']);
coupangRows.push(row({ 2: '지역구', 4: '수행 건수', 5: '①공급가액', 6: '②부가세', 7: '③합계금액', 8: '④보험료 합계', 9: '⑤실지급액' }));
coupangRows.push(row({ 2: '울산_남구중앙', 4: '10609', 5: '53532085', 6: '5353208', 7: '58885293', 8: '-1200228', 9: '57685065' }));
coupangRows.push(row({ 2: '울산_동구중앙(Z)', 4: '1748', 5: '8037328', 6: '803733', 7: '8841061', 8: '-218228', 9: '8622833' }));
coupangRows.push(row({ 2: '경남_양산동부(Z)', 4: '1980', 5: '10019585', 6: '1001958', 7: '11021543', 8: '-304311', 9: '10717232' }));
coupangRows.push(row({ 2: '울산_북구남부', 4: '1645', 5: '7784342', 6: '778435', 7: '8562777', 8: '-166314', 9: '8396463' }));
coupangRows.push(['']);

console.log('\n[1] 쿠팡 정산서 파싱 (C열 지역구 · G열 부가세 · J열 실지급액)');
const coupang = M.parseCoupangRows(coupangRows);
check('지역 4건', coupang.length, 4);
check('첫 지역명', coupang[0]?.source, '울산_남구중앙');
check('첫 부가세 = G열', coupang[0]?.vat, 5353208);
check('첫 실지급액 = J열', coupang[0]?.supplyPaid, 57685065);
check('요약행(배달 이글스)은 제외', coupang.some(r => r.source === '배달 이글스'), 'false');
check('세 번째 지역명', coupang[2]?.source, '경남_양산동부(Z)');
check('세 번째 실지급액', coupang[2]?.supplyPaid, 10717232);

// --- 배민 정산서 (스크린샷 구조 재현) ---------------------------------------
// 24행: 주차별 정산내역 헤더 · 25행: 값 / 30행: 세금계산서 헤더 · 31행: 값
// 상단 참고사항에 "배달료"·"고용/산재보험료" 단어가 들어 있어 헤더 오인 위험이 있다.
const baeminRows = [];
for (let i = 0; i < 23; i += 1) {
  if (i === 5) {
    baeminRows.push(['- 세금계산서에 포함되는 항목은 배달료, 수기정산금, 관리비입니다.']);
  } else if (i === 9) {
    baeminRows.push(['- 이를 기반으로 계산된 고용/산재보험료가 포함되어 있습니다. 정산시작일 기준입니다.']);
  } else {
    baeminRows.push(['']);
  }
}
// 실제 시트 배치: 정산시작일 B · 배달료 D · 사업주부담 고용보험료 I · 사업주부담 산재보험료 K
baeminRows.push(row({
  1: '정산시작일', 2: '정산종료일', 3: '배달료\n(A-1)', 4: '추가정산\n(A-2)', 5: '관리비\n(B)',
  6: '부가세액\n(C)', 7: '시간제보험료\n(D)',
  8: '사업주부담\n고용보험료\n①', 9: '라이더부담\n고용보험료\n②',
  10: '사업주부담\n산재보험료\n③', 11: '라이더부담\n산재보험료\n④',
  12: '원천징수\n보험료합계(E)'
}));
baeminRows.push(row({
  1: '2026-08-12', 2: '2026-08-18', 3: '6525400', 4: '593000', 5: '218600',
  6: '733700', 7: '24089', 8: '60080', 9: '60080', 10: '50170', 11: '50170', 12: '220500'
}));
for (let i = 25; i < 29; i += 1) baeminRows.push(['']);
baeminRows.push(row({ 1: '공급가액', 2: '부가세액', 3: '공급대가' }));
baeminRows.push(row({ 1: '7337000', 2: '733700', 3: '8070700' }));

console.log('\n[2] 배민 정산서 파싱 (C31 부가세액 · D31 공급대가 − I·K열 사업주부담 보험료)');
const baemin = M.parseBaeminSheet(baeminRows);
check('부가세 = C31', baemin.vat, 733700);
check('공급대가 = D31', baemin.supplyTotal, 8070700);
check('I열 사업주부담 고용보험료', baemin.employment, 60080);
check('K열 사업주부담 산재보험료', baemin.accident, 50170);
check('실지급액 = 8,070,700 − 110,250', baemin.supplyPaid, 8070700 - 60080 - 50170);
check('보험료 열을 찾았다고 표시', baemin.insuranceFound, 'true');
check('근거 문구는 사업주부담 고용보험료', /사업주부담 고용보험료/.test(baemin.note), 'true');
check('라이더부담은 빼지 않는다', /라이더부담/.test(baemin.note), 'false');
check('참고사항 문장을 헤더로 오인하지 않는다', baemin.employment > 0 && baemin.accident > 0, 'true');

// 라벨 탐색 실패 시 고정 위치(C31·D31) 폴백
const baeminNoHeader = baeminRows.map((r, i) => (i === 29 ? [''] : r));
const fallback = M.parseBaeminSheet(baeminNoHeader);
check('헤더 없어도 D31 폴백', fallback.supplyTotal, 8070700);
check('헤더 없어도 C31 폴백', fallback.vat, 733700);

// --- 지역 매칭 --------------------------------------------------------------
console.log('\n[3] 지역명 매칭 (접두사 무시 · (Z) 구분)');
const REGIONS = ['남구중앙', '동구중앙(Z)', '양산동부(Z)', '북구남부', '북구중앙', '창원성산', '포항중앙', '포항중앙(Z)'];
check('울산_남구중앙 → 남구중앙', M.matchRegionByLabel('울산_남구중앙', REGIONS, {}), '남구중앙');
check('경남_양산동부(Z) → 양산동부(Z)', M.matchRegionByLabel('경남_양산동부(Z)', REGIONS, {}), '양산동부(Z)');
check('울산_동구중앙(Z) → 동구중앙(Z)', M.matchRegionByLabel('울산_동구중앙(Z)', REGIONS, {}), '동구중앙(Z)');
check('없는 지역은 빈값', M.matchRegionByLabel('울산_남구서부(Z)', REGIONS, {}), '');
check('별칭이 있으면 우선', M.matchRegionByLabel('울산_남구서부(Z)', REGIONS, { '울산_남구서부(Z)': '북구남부' }), '북구남부');
check('포항중앙은 일반만', M.matchRegionByLabel('포항중앙', REGIONS, {}), '포항중앙');
check('포항중앙(Z)는 Z만', M.matchRegionByLabel('포항중앙(Z)', REGIONS, {}), '포항중앙(Z)');
check('울산_포항중앙은 일반만', M.matchRegionByLabel('울산_포항중앙', REGIONS, {}), '포항중앙');
check('울산_동구중앙은 Z만 있으면 그 정산서', M.matchRegionByLabel('울산_동구중앙', REGIONS, {}), '동구중앙(Z)');
const BOTH_Z = ['북구남부', '북구남부(Z)'];
check('일반·Z가 둘이면 Z 없는 붙여넣기는 일반', M.matchRegionByLabel('울산_북구남부', BOTH_Z, {}), '북구남부');
check('Z를 적은 붙여넣기는 Z 정산서', M.matchRegionByLabel('울산_북구남부(Z)', BOTH_Z, {}), '북구남부(Z)');
const BAEMIN = ['표준경북포항북A', '표준경북포항남B', '표준경남창원성산A', '표준경남양산A', '표준경남양산B', '표준울산중필드A', '표준울산울주A', '표준울산북필드B', '표준울산북필드A', '표준울산동A', '표준울산남A'];
check('포항북A → 표준경북포항북A', M.matchRegionByLabel('포항북A', BAEMIN, {}), '표준경북포항북A');
check('청원성산A → 창원성산', M.matchRegionByLabel('청원성산A', BAEMIN, {}), '표준경남창원성산A');
check('울산중A → 중필드A', M.matchRegionByLabel('울산중A', BAEMIN, {}), '표준울산중필드A');
check('울산북B → 북필드B', M.matchRegionByLabel('울산북B', BAEMIN, {}), '표준울산북필드B');
check('울산북A는 북필드B와 안 붙음', M.matchRegionByLabel('울산북A', BAEMIN, {}), '표준울산북필드A');
check('틀린 별칭이 있어도 울산북A는 포항북이 아님', M.matchRegionByLabel('울산북A', BAEMIN, { '울산북A': '표준경북포항북A' }), '표준울산북필드A');
check('양산A → 양산A', M.matchRegionByLabel('양산A', BAEMIN, {}), '표준경남양산A');
check('울산남A → 남A', M.matchRegionByLabel('울산남A', BAEMIN, {}), '표준울산남A');
const LEGACY = ['울산동a', '표준울산동A', '주식회사 119컴퍼니_표준울산동A주식회사119컴퍼니_DP2608316054', '창원성산', '표준경남창원성산A'];
check('울산동A는 예전 짧은 이름보다 표준', M.matchRegionByLabel('울산동A', LEGACY, {}), '표준울산동A');
check('청원성산A는 쿠팡 창원성산과 안 붙음', M.matchRegionByLabel('청원성산A', LEGACY, {}), '표준경남창원성산A');
check('일반과 (Z) 키는 다름', M.normalizeRegionKey('포항중앙') === M.normalizeRegionKey('포항중앙(Z)'), 'false');

console.log('\n[4] 배민 파일명 매칭');
check('파일명 안의 지역 추출', M.matchRegionByFileName('2026년8월3주차_정산서_북구남부.xlsx', REGIONS, {}), '북구남부');
check('공백·하이픈 섞여도 매칭', M.matchRegionByFileName('배민 정산서 - 창원성산 (8월3주).xlsx', REGIONS, {}), '창원성산');
check('매칭 없으면 빈값', M.matchRegionByFileName('정산서_미지정지역.xlsx', REGIONS, {}), '');
const dpRegions = ['배달 이글스_표준울산북필드B배달이글스_DP2607217024', '배달 이글스_표준울산남A배달이글스_DP2607289309'];
check('주정산 파일명 → 표준 권역',
  M.matchRegionByFileName('20260826~20260831_배달 이글스_표준울산북필드B배달이글스_DP2607217024.xlsx', dpRegions, {}),
  '표준울산북필드B');
check('화요일 분할 파일도 같은 권역',
  M.matchRegionByFileName('20260901~20260901_배달 이글스_표준울산북필드B배달이글스_DP2607217024.xlsx', dpRegions, {}),
  '표준울산북필드B');

console.log('\n[4c] 119·이글스 같은 권역으로 합치기');
check('권역만 남김',
  M.canonicalRegionLabel('주식회사 119컴퍼니_표준울산남A주식회사119컴퍼니_DP1'),
  '표준울산남A');
check('이글스도 같은 권역',
  M.canonicalRegionLabel('배달 이글스_표준울산남A배달이글스_DP2'),
  '표준울산남A');
check('합친 주정산 이름은 한 권역',
  M.canonicalRegionLabel('주식회사 119컴퍼니_표준울산남A주식회사119컴퍼니_DP1 + 배달 이글스_표준울산남A배달이글스_DP2'),
  '표준울산남A');
check('119 파일 → 권역명',
  M.matchRegionByFileName('20260902~20260908_주식회사 119컴퍼니_표준울산남A주식회사119컴퍼니_DP1.xlsx', ['표준울산남A', '표준울산북필드B'], {}),
  '표준울산남A');
check('이글스 파일 → 같은 권역',
  M.matchRegionByFileName('20260902~20260908_배달 이글스_표준울산남A배달이글스_DP2.xlsx', ['표준울산남A'], {}),
  '표준울산남A');

const companyGrouped = M.groupBaeminUploadRows([
  {
    kind: 'baemin',
    fileName: '20260902~20260908_주식회사 119컴퍼니_표준울산남A주식회사119컴퍼니_DP1.xlsx',
    region: '',
    source: '119',
    supplyPaid: 80000,
    vat: 8000,
    note: '119'
  },
  {
    kind: 'baemin',
    fileName: '20260902~20260908_배달 이글스_표준울산남A배달이글스_DP2.xlsx',
    region: '',
    source: '이글스',
    supplyPaid: 50000,
    vat: 5000,
    note: '이글스'
  },
  {
    kind: 'baemin',
    fileName: '20260902~20260908_주식회사 119컴퍼니_표준울산북필드B주식회사119컴퍼니_DP3.xlsx',
    region: '',
    source: '북필드B',
    supplyPaid: 10000,
    vat: 1000,
    note: '북필드B'
  }
]);
check('119+이글스와 북필드B는 권역 2곳', companyGrouped.length, 2);
const namA = companyGrouped.find(row => (row.fileNames || []).length === 2);
check('남A 공급대가 합산', namA?.supplyPaid, 130000);
check('남A 부가세 합산', namA?.vat, 13000);
check('남A는 2파일', (namA?.fileNames || []).length, 2);

console.log('\n[4b] 배민 한 지역 2파일 합산');
const grouped = M.groupBaeminUploadRows([
  {
    kind: 'baemin',
    fileName: '20260826~20260831_배달 이글스_표준울산북필드B.xlsx',
    region: '북필드B',
    source: '전반',
    supplyPaid: 100000,
    vat: 10000,
    note: '전반'
  },
  {
    kind: 'baemin',
    fileName: '20260901~20260901_배달 이글스_표준울산북필드B.xlsx',
    region: '북필드B',
    source: '화요일',
    supplyPaid: 20000,
    vat: 2000,
    note: '화요일'
  },
  {
    kind: 'baemin',
    fileName: '20260826~20260831_배달 이글스_표준울산남A.xlsx',
    region: '남A',
    source: '남A',
    supplyPaid: 50000,
    vat: 5000,
    note: '남A'
  }
]);
check('같은 지역 2파일은 1줄', grouped.filter(row => row.region === '북필드B').length, 1);
check('다른 지역은 따로', grouped.filter(row => row.region === '남A').length, 1);
const north = grouped.find(row => row.region === '북필드B');
check('공급대가 합산', north?.supplyPaid, 120000);
check('부가세 합산', north?.vat, 12000);
check('파일명 + 로 연결', String(north?.fileName || '').includes(' + '), 'true');
check('합산 줄은 2파일', (north?.fileNames || []).length, 2);

// --- 표 렌더링 (열 수 · 남은 금액) ------------------------------------------
console.log('\n[5] 표 렌더링 · 실지급−세무처리비−최종입금−선정산');

const CALC_ROW = {
  region: '중구중앙',
  netPay: 30000,
  prepaid: 2000
};

window.BremDirectSettlementCalc = {
  weekStartKey: value => String(value || '2026-08-19').slice(0, 10),
  settlementWeek: () => '2026-08-19',
  computeRows: () => [CALC_ROW]
};
window.BremStorage = {
  weeklySettlements: { getAll: () => [{ id: 's1', region: '중구중앙', startDate: '2026-08-19' }] },
  payrollWithdrawal: { getAll: () => [] },
  settlements: { getAll: () => [] },
  revenue: {
    getRegionSettlementByWeek: () => ({
      weekStart: '2026-08-19',
      taxFeePercent: 20,
      regions: { 중구중앙: { supplyPaid: 40179, vat: 3698 } }
    }),
    getRegionAliasMap: () => ({}),
    saveRegionSettlement: (weekStart, data) => ({ weekStart, ...data, savedAt: new Date().toISOString() }),
    saveRegionAliases: () => ({})
  },
  ensureSectionLoaded: async () => ({ ok: true })
};

M.setWeekStart('2026-08-19');
M.render();

const headCells = [...window.document.querySelectorAll('.revenue-region-table thead tr th')];
const bodyCells = [...window.document.querySelectorAll('#revenueRegionBody tr td')];
const footCells = [...window.document.querySelectorAll('#revenueRegionFoot tr td')];

check('본문 열 수 = 헤더 열 수', bodyCells.length, headCells.length);
check('합계 열 수 = 헤더 열 수', footCells.length, headCells.length);
check('열 수는 9개', headCells.length, 9);

const headText = headCells.map(th => th.textContent.replace(/\s+/g, ''));
check('최종입금 열', headText.some(t => t.includes('최종입금')), 'true');
check('선정산 열', headText.some(t => t.includes('선정산')), 'true');
check('소진율 열', headText.some(t => t.includes('소진율')), 'true');

const bodyText = bodyCells.map(td => td.textContent.replace(/\s+/g, ''));
check('세무처리비 740원', bodyText.includes('740원'), 'true');
check('최종입금 30,000원', bodyText.includes('30,000원'), 'true');
check('선정산 2,000원', bodyText.includes('2,000원'), 'true');
// 40,179 − 740 − 30,000 − 2,000 = 7,439
check('남은 금액 7,439원 남음', bodyText.some(t => t.includes('7,439원남음')), 'true');

console.log('\n[5b] 지역별 정산 표 · 119·이글스 같은 권역 합산');
window.BremDirectSettlementCalc.computeRows = settlement => [{
  region: settlement.region,
  netPay: Number(settlement.netPay || 0),
  prepaid: Number(settlement.prepaid || 0)
}];
window.BremStorage.weeklySettlements.getAll = () => [
  {
    id: 's119',
    region: '주식회사 119컴퍼니_표준울산남A주식회사119컴퍼니_DP1',
    startDate: '2026-08-19',
    netPay: 100000,
    prepaid: 10000
  },
  {
    id: 'seagles',
    region: '배달 이글스_표준울산남A배달이글스_DP2',
    startDate: '2026-08-19',
    netPay: 40000,
    prepaid: 4000
  }
];
window.BremStorage.revenue.getRegionSettlementByWeek = () => ({
  weekStart: '2026-08-19',
  taxFeePercent: 20,
  regions: {}
});
M.setWeekStart('2026-08-19');
const settlementOnly = M.aggregateRegions('2026-08-19').regions;
check('정산서만 있어도 권역이 나옴', settlementOnly.length, 1);
check('정산서만 있을 때 최종입금', settlementOnly[0]?.finalDeposit, 140000);
check('정산서만 있을 때 선정산', settlementOnly[0]?.prepaid, 14000);

window.BremStorage.revenue.getRegionSettlementByWeek = () => ({
  weekStart: '2026-08-19',
  taxFeePercent: 20,
  regions: { 표준울산남A: { supplyPaid: 1000, vat: 100 } }
});
M.setWeekStart('2026-08-19');
const mergedRegions = M.aggregateRegions('2026-08-19').regions;
check('붙여넣은 권역만 1줄', mergedRegions.length, 1);
check('권역명은 표준울산남A', mergedRegions[0]?.region, '표준울산남A');
check('최종입금은 두 정산서 합', mergedRegions[0]?.finalDeposit, 140000);
check('선정산은 두 정산서 합', mergedRegions[0]?.prepaid, 14000);

const alreadyMerged = M.canonicalRegionLabel(
  '주식회사 119컴퍼니_표준울산남A주식회사119컴퍼니_DP1 + 배달 이글스_표준울산남A배달이글스_DP2'
);
check('이미 합친 주정산도 권역명', alreadyMerged, '표준울산남A');

console.log('\n[6] 엑셀 붙여넣기 · 배민 2파일 합산 · 미매칭');
const paste = M.parsePasteRows('권역매칭\t실지급액\t부가세\n울산_남구중앙\t57685065\t5353208\n경남_양산동부(Z)\t10717232\t1001958');
check('헤더 제외 2줄', paste.length, 2);
check('첫 권역', paste[0]?.source, '울산_남구중앙');
check('첫 실지급', paste[0]?.supplyPaid, 57685065);
check('첫 부가세', paste[0]?.vat, 5353208);

const baeminPaste = M.parsePasteRows('북필드B\t100000\t10000\n북필드B\t20000\t2000', { kind: 'baemin' });
const groupedPaste = M.groupPasteRows(baeminPaste.map(row => ({ ...row, region: '북필드B' })));
check('배민 같은 권역 2줄은 1줄', groupedPaste.length, 1);
check('배민 실지급 합산', groupedPaste[0]?.supplyPaid, 120000);
check('배민 부가세 합산', groupedPaste[0]?.vat, 12000);

check('붙여넣기 권역 매칭', M.matchRegionByLabel(paste[0].source, REGIONS, {}), '남구중앙');
check('없는 권역은 미매칭', M.matchRegionByLabel('없는권역XYZ', REGIONS, {}), '');

console.log('\n[6b] 붙여넣기가 표를 만들고 (Z)는 합치지 않음');
window.BremDirectSettlementCalc.computeRows = settlement => [{
  region: settlement.region,
  netPay: Number(settlement.netPay || 0),
  prepaid: Number(settlement.prepaid || 0)
}];
window.BremStorage.weeklySettlements.getAll = () => [
  { id: 's-nam', region: '남구중앙', startDate: '2026-08-19', netPay: 1000, prepaid: 100 },
  { id: 's-buk', region: '북구남부', startDate: '2026-08-19', netPay: 2000, prepaid: 200 },
  { id: 's-ph', region: '포항중앙', startDate: '2026-08-19', netPay: 10, prepaid: 1 },
  { id: 's-phz', region: '포항중앙(Z)', startDate: '2026-08-19', netPay: 99, prepaid: 9 }
];
window.BremStorage.revenue.getRegionSettlementByWeek = () => ({
  weekStart: '2026-08-19',
  taxFeePercent: 20,
  regions: {}
});
M.setWeekStart('2026-08-19');
M.handlePaste('울산_남구중앙\t40179\t3698\n없는권역XYZ\t5000\t500');
const pasteOwned = M.aggregateRegions('2026-08-19').regions;
check('붙여넣은 권역과 정산서 지역이 같이 있음', pasteOwned.length, 5);
const pastedNam = pasteOwned.find(row => row.region === '남구중앙');
check('매칭 줄 실지급', pastedNam?.supplyPaid, 40179);
M.handlePaste('울산_남구중앙\t40179\t3698');
check('다시 붙여넣으면 더하지 않음', M.aggregateRegions('2026-08-19').regions.find(row => row.region === '남구중앙')?.supplyPaid, 40179);
M.clearAmounts();
check('지우면 실지급이 0', M.aggregateRegions('2026-08-19').regions.find(row => row.region === '남구중앙')?.supplyPaid, 0);
M.handlePaste('울산_남구중앙\t40179\t3698\n없는권역XYZ\t5000\t500');
check('매칭 줄 최종입금', pastedNam?.finalDeposit, 1000);
check('매칭 줄 선정산', pastedNam?.prepaid, 100);
const pastedMiss = pasteOwned.find(row => row.unmatched);
check('미매칭 줄이 본표에 남음', !!pastedMiss, 'true');
check('미매칭 최종입금은 0', pastedMiss?.finalDeposit, 0);

M.applyRegionFix(pastedMiss.region, '북구남부');
const afterFix = M.aggregateRegions('2026-08-19').regions;
const fixedBuk = afterFix.find(row => row.region === '북구남부');
check('지역 고르면 미매칭이 사라짐', afterFix.some(row => row.unmatched), 'false');
check('고른 지역에 실지급이 붙음', fixedBuk?.supplyPaid, 5000);
check('고른 지역에 최종입금이 붙음', fixedBuk?.finalDeposit, 2000);

window.BremStorage.revenue.getRegionSettlementByWeek = () => ({
  weekStart: '2026-08-19',
  taxFeePercent: 20,
  regions: {}
});
M.setWeekStart('2026-08-19');
M.handlePaste('포항중앙\t100\t10\n포항중앙(Z)\t200\t20');
const zRows = M.aggregateRegions('2026-08-19').regions;
check('(Z)와 일반이 같이 있음', zRows.filter(row => row.region === '포항중앙' || row.region === '포항중앙(Z)').length, 2);
const zPlain = zRows.find(row => row.region === '포항중앙');
const zTwin = zRows.find(row => row.region === '포항중앙(Z)');
check('일반 실지급은 일반에만', zPlain?.supplyPaid, 100);
check('Z 실지급은 Z에만', zTwin?.supplyPaid, 200);
check('일반 최종입금은 섞이지 않음', zPlain?.finalDeposit, 10);
check('Z 최종입금은 섞이지 않음', zTwin?.finalDeposit, 99);

const baeminTwice = M.parsePasteRows('북필드B\t100000\t10000\n북필드B\t20000\t2000', { kind: 'baemin' });
M.addRowsToDraft(M.groupPasteRows(baeminTwice.map(row => ({ ...row, region: '북필드B', unmatched: false }))));
const baeminOwned = M.aggregateRegions('2026-08-19').regions.find(row => row.region === '북필드B');
check('배민 같은 권역 두 줄은 합산', baeminOwned?.supplyPaid, 120000);
check('배민 부가세도 합산', baeminOwned?.vat, 12000);

const commaPaste = M.parsePasteRows('울산_남구중앙\t57,685,065\t5,353,208');
check('탭+쉼표 실지급', commaPaste[0]?.supplyPaid, 57685065);
check('탭+쉼표 부가세', commaPaste[0]?.vat, 5353208);
const spacePaste = M.parsePasteRows('울산_남구중앙 57685065 5353208');
check('띄어쓰기 실지급', spacePaste[0]?.supplyPaid, 57685065);
check('띄어쓰기 권역', spacePaste[0]?.source, '울산_남구중앙');
check('쉼표 금액 파싱', M.parseMoneyText('57,685,065'), 57685065);

console.log('\n[7] 남은 금액 공식');
check('실지급-부가세20%-최종입금-선정산', M.computeRemain({
  supplyPaid: 40179, vat: 3698, taxFeePercent: 20, finalDeposit: 30000, prepaid: 2000
}), 7439);
check('입력 없으면 0', M.computeRemain({ finalDeposit: 30000, prepaid: 2000 }), 0);
const bundle = M.summarizeBundle([
  { supplyPaid: 100, vat: 3, finalDeposit: 10, prepaid: 1 },
  { supplyPaid: 50, vat: 3, finalDeposit: 5, prepaid: 1 }
], 20);
check('묶음 실지급은 세로 합', bundle.supplyPaid, 150);
check('묶음 부가세 20%는 합계에 한 번', bundle.taxFee, 1);
check('묶음 남은 금액은 합계 공식', bundle.remain, 132);

console.log('\n[7b] 계산서 주별 실지급·부가세를 지역에 붙이기');
const invoiceGroups = M.groupInvoiceLines([
  {
    kind: 'baemin',
    label: '표준울산남A · 119',
    fileName: '20261021~20261027_주식회사 119컴퍼니_표준울산남A.xlsx',
    supplyPaid: 80000,
    vat: 8000
  },
  {
    kind: 'baemin',
    label: '표준울산남A · 이글스',
    fileName: '20261021~20261027_배달 이글스_표준울산남A.xlsx',
    supplyPaid: 50000,
    vat: 5000
  },
  {
    kind: 'coupang',
    label: '울산_남구중앙',
    fileName: 'coupang.xlsx',
    supplyPaid: 57685065,
    vat: 5353208
  }
], ['표준울산남A', '남구중앙']);
const invoiceNam = invoiceGroups.rows.find(row => row.region === '표준울산남A');
const invoiceSouth = invoiceGroups.rows.find(row => row.region === '남구중앙');
check('119+이글스는 한 지역', invoiceNam?.supplyPaid, 130000);
check('119+이글스 부가세 합산', invoiceNam?.vat, 13000);
check('쿠팡 실지급은 남구중앙', invoiceSouth?.supplyPaid, 57685065);
check('쿠팡 부가세는 남구중앙', invoiceSouth?.vat, 5353208);
check('맞춘 계산서는 미매칭 없음', invoiceGroups.missed, 0);
check('가져온 실지급으로 남은 금액', M.computeRemain({
  supplyPaid: invoiceNam?.supplyPaid,
  vat: invoiceNam?.vat,
  taxFeePercent: 20,
  finalDeposit: 100000,
  prepaid: 0
}), 130000 - Math.round(13000 * 0.2) - 100000);

console.log('\n[8] 소진율 (최종입금+선정산)÷(실지급−부가세)');
// 실지급 100만, 부가세 10만 → 기준 90만. 최종+선정산 90만 → 정확히 100%
const u100 = M.usageRatio(1000000, 100000, 850000, 50000);
check('예시대로 100%', Math.round(u100.ratio), 100);
check('초과 0%', Math.round(u100.over), 0);
// 기준 90만을 넘겨 쓰면 초과율이 양수
const uOver = M.usageRatio(1000000, 100000, 900000, 90000);
check('99만÷90만 = 110%', Math.round(uOver.ratio), 110);
check('초과율 +10%', Math.round(uOver.over), 10);
// 실지급−부가세가 0 이하면 계산 불가(null)
check('기준 0 이하면 null', M.usageRatio(100000, 100000, 50000, 0).ratio, null);
// 묶음 합계에도 소진율이 붙는다
check('묶음에도 소진율', bundle.usage && typeof bundle.usage.ratio === 'number', true);

console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
process.exit(failed ? 1 : 0);
