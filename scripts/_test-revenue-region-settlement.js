/**
 * 수익 관리 · 지역별 정산 업로드 파서 검증 (로컬, 서버 접속 없음)
 *
 * 확인 항목
 *  - 쿠팡 정산서: C열 지역구 · G열 부가세 · J열 실지급액을 지역별로 읽는지
 *  - 배민 정산서: C31 부가세액 · D31 공급대가 − (I열 고용보험 + J열 산재보험)
 *  - 지역명 매칭: 울산_/경남_ 접두사와 (Z) 꼬리표를 무시하고 ERP 지역명에 붙는지
 *  - 파일명 매칭(배민)
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
const baeminRows = [];
for (let i = 0; i < 23; i += 1) baeminRows.push(['']);
baeminRows.push(row({
  0: '정산시작일', 1: '정산종료일', 2: '배달료(A-1)', 3: '주기정산(A-2)', 4: '관리비(B)',
  5: '부가세액(C)', 6: '시간제보험료(D)', 7: '사업주부담 고용보험료①', 8: '라이더부담 고용보험료②',
  9: '사업주부담 산재보험료③', 10: '라이더부담 산재보험료④', 11: '원천징수 보험료합계(E)'
}));
baeminRows.push(row({
  0: '2026-08-12', 1: '2026-08-18', 2: '6525400', 3: '593000', 4: '218600',
  5: '733700', 6: '24089', 7: '60000', 8: '60000', 9: '50170', 10: '50170', 11: '220500'
}));
for (let i = 25; i < 29; i += 1) baeminRows.push(['']);
baeminRows.push(row({ 1: '공급가액', 2: '부가세액', 3: '공급대가' }));
baeminRows.push(row({ 1: '7337000', 2: '733700', 3: '8070700' }));

console.log('\n[2] 배민 정산서 파싱 (C31 부가세액 · D31 공급대가 − I·J열 보험료)');
const baemin = M.parseBaeminSheet(baeminRows);
check('부가세 = C31', baemin.vat, 733700);
check('공급대가 = D31', baemin.supplyTotal, 8070700);
check('I열 고용보험', baemin.employment, 60000);
check('J열 산재보험', baemin.accident, 50170);
check('실지급액 = 8,070,700 − 110,170', baemin.supplyPaid, 8070700 - 60000 - 50170);
check('근거 문구에 헤더명 포함', /라이더부담 고용보험료/.test(baemin.note), 'true');

// 라벨 탐색 실패 시 고정 위치(C31·D31) 폴백
const baeminNoHeader = baeminRows.map((r, i) => (i === 29 ? [''] : r));
const fallback = M.parseBaeminSheet(baeminNoHeader);
check('헤더 없어도 D31 폴백', fallback.supplyTotal, 8070700);
check('헤더 없어도 C31 폴백', fallback.vat, 733700);

// --- 지역 매칭 --------------------------------------------------------------
console.log('\n[3] 지역명 매칭 (접두사·(Z) 무시)');
const REGIONS = ['남구중앙', '동구중앙(Z)', '양산동부(Z)', '북구남부', '북구중앙', '창원성산'];
check('울산_남구중앙 → 남구중앙', M.matchRegionByLabel('울산_남구중앙', REGIONS, {}), '남구중앙');
check('경남_양산동부(Z) → 양산동부(Z)', M.matchRegionByLabel('경남_양산동부(Z)', REGIONS, {}), '양산동부(Z)');
check('울산_동구중앙(Z) → 동구중앙(Z)', M.matchRegionByLabel('울산_동구중앙(Z)', REGIONS, {}), '동구중앙(Z)');
check('없는 지역은 빈값', M.matchRegionByLabel('울산_남구서부(Z)', REGIONS, {}), '');
check('별칭이 있으면 우선', M.matchRegionByLabel('울산_남구서부(Z)', REGIONS, { '울산_남구서부(Z)': '북구남부' }), '북구남부');

console.log('\n[4] 배민 파일명 매칭');
check('파일명 안의 지역 추출', M.matchRegionByFileName('2026년8월3주차_정산서_북구남부.xlsx', REGIONS, {}), '북구남부');
check('공백·하이픈 섞여도 매칭', M.matchRegionByFileName('배민 정산서 - 창원성산 (8월3주).xlsx', REGIONS, {}), '창원성산');
check('매칭 없으면 빈값', M.matchRegionByFileName('정산서_미지정지역.xlsx', REGIONS, {}), '');

// --- 표 렌더링 (열 수 · 사용률 방향) ----------------------------------------
console.log('\n[5] 표 렌더링 · 열 수와 사용률');

const GENERAL_DEDUCT_KEYS = [
  'employmentInsurance', 'accidentInsurance', 'hourlyInsurance',
  'withholdingTax', 'promotionWithholdingTax', 'callFee'
];
const sum = (src, keys) => keys.reduce((acc, key) => acc + Math.round(Number(src?.[key] || 0)), 0);

// 중구중앙: 지급합계 36,181 · 일반공제 1,470 → 입급가액 34,711 · 원천세합 1,220
const CALC_ROW = {
  region: '중구중앙',
  grossPay: 36181,
  employmentInsurance: 150,
  accidentInsurance: 100,
  hourlyInsurance: 0,
  withholdingTax: 1120,
  promotionWithholdingTax: 100,
  callFee: 0
};

window.BremDirectSettlementCalc = {
  GENERAL_DEDUCT_KEYS,
  generalDeductTotal: src => sum(src, GENERAL_DEDUCT_KEYS),
  withholdingTaxTotal: src => sum(src, ['withholdingTax', 'promotionWithholdingTax']),
  weekStartKey: value => String(value || '2026-08-19').slice(0, 10),
  settlementWeek: () => '2026-08-19',
  computeRows: () => [CALC_ROW]
};
window.BremStorage = {
  weeklySettlements: { getAll: () => [{ id: 's1', region: '중구중앙', startDate: '2026-08-19' }] },
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

const headText = headCells.map(th => th.textContent.replace(/\s+/g, ''));
check('사용률 기준은 공급대가−부가세', headText.some(t => t.includes('입급가액÷(공급대가−부가세)')), 'true');

const bodyText = bodyCells.map(td => td.textContent.replace(/\s+/g, ''));
// 공급대가 40,179 · 부가세 3,698 → 기준 36,481 / 입급가액 34,711 · 원천세 1,220
check('입급가액 34,711원', bodyText.includes('34,711원'), 'true');
check('사용률 = 34,711÷36,481 = 95.1%', bodyText.includes('95.1%'), 'true');
check('원천세 포함 = 34,711÷37,701 = 92.1%', bodyText.includes('92.1%'), 'true');
check('공급대가 기준(86.4%)은 더 이상 없다', bodyText.includes('86.4%'), 'false');
// 남은 금액 = 40,179 + 1,220 − 34,711 − 740(부가세 3,698×20%) = 5,948
check('세무처리비 740원', bodyText.includes('740원'), 'true');
check('남은 금액 5,948원 남음', bodyText.some(t => t.includes('5,948원남음')), 'true');
check('보조줄(원천세 포함)은 없앴다', bodyText.some(t => t.includes('원천세포함')), 'false');

// 사용자 예시: 공급가액 100만 + 부가세 10만 = 공급대가 110만, 105만 지출 → 105%
const exampleBase = 1100000 - 100000;
check('예시 105만 지출 → 105.0%', ((1050000 / exampleBase) * 100).toFixed(1), '105.0');

console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
process.exit(failed ? 1 : 0);
