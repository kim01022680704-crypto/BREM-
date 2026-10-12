/**
 * 수익 관리 · 지역별 정산 붙여넣기·합산 검증 (로컬, 서버 접속 없음)
 *
 * 확인 항목
 *  - 쿠팡 정산서: C열 지역구 · G열 부가세 · J열 실지급액을 지역별로 읽는지
 *  - 배민 정산서: C31 부가세액 · D31 공급대가 − (I열 고용보험 + J열 산재보험)
 *  - 지역명 매칭: 울산_/경남_ 접두사와 (Z) 꼬리표를 무시하고 ERP 지역명에 붙는지
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
const dpRegions = ['배달 이글스_표준울산북필드B배달이글스_DP2607217024', '배달 이글스_표준울산남A배달이글스_DP2607289309'];
check('주정산 파일명 → DP 지역',
  M.matchRegionByFileName('20260826~20260831_배달 이글스_표준울산북필드B배달이글스_DP2607217024.xlsx', dpRegions, {}),
  '배달 이글스_표준울산북필드B배달이글스_DP2607217024');
check('화요일 분할 파일도 같은 지역',
  M.matchRegionByFileName('20260901~20260901_배달 이글스_표준울산북필드B배달이글스_DP2607217024.xlsx', dpRegions, {}),
  '배달 이글스_표준울산북필드B배달이글스_DP2607217024');

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
check('열 수는 7개', headCells.length, 7);

const headText = headCells.map(th => th.textContent.replace(/\s+/g, ''));
check('최종입금 열', headText.some(t => t.includes('최종입금')), 'true');
check('선정산 열', headText.some(t => t.includes('선정산')), 'true');
check('사용률 열은 없다', headText.some(t => t.includes('사용률')), 'false');

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
const mergedRegions = M.aggregateRegions('2026-08-19').regions;
check('같은 권역은 1줄', mergedRegions.length, 1);
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

console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
process.exit(failed ? 1 : 0);
