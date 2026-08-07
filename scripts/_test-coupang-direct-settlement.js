/**
 * 쿠팡 직계약 주정산서 파싱 → 저장 → 정산결과(직계약) 반영 검증 (로컬, 서버 접속 없음).
 *
 * 확인 항목
 *  - C열 성함을 쿠팡ID로 읽고, F열 오더수를 주간 오더수로 읽는지
 *  - 배달료 = AM+AB (AM은 AB 차감 후) / AB·AE·AG·AH(공제) / 원천세만 AC×3.3%
 *  - 일정산서 서식은 배달료 AL (주정산 AM과 다름)
 *  - 헤더·설명·합계 행을 건너뛰는지 (직계약만 해당)
 *  - 브로 채널 업로드는 금액 열 없이 기존 동작을 유지하는지
 *  - 콜수수료 = 오더수 × 콜수수료 단가 로 정산결과 공제에 들어가는지
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
  `<!doctype html><html><body>${extractSection('settlement-result-direct')}</body></html>`,
  { runScripts: 'outside-only' }
);
const { window } = dom;

// --- 시트 스텁 -------------------------------------------------------------
// 열 인덱스: C=2, F=5, AB=27, AC=28, AH=33, AL=37, AM=38
function sheetRow(map) {
  const row = new Array(40).fill('');
  Object.entries(map).forEach(([col, value]) => {
    let index = 0;
    for (const ch of col) index = index * 26 + (ch.charCodeAt(0) - 64);
    row[index - 1] = value;
  });
  return row;
}

// 실제 쿠팡 정산서 모양: 앞쪽에 제목·안내·헤더 행이 있고 12행부터 데이터, 끝에 합계 행.
// AE/AG 는 시트에 있어도 무시한다 — 공제는 AC×요율로 우리가 계산한다.
const COUPANG_ROWS = [
  sheetRow({ A: '쿠팡이츠 정산 내역' }),
  sheetRow({ A: '기간', B: '2026-07-22 ~ 2026-07-28' }),
  sheetRow({}),
  sheetRow({}),
  sheetRow({}),
  sheetRow({}),
  sheetRow({}),
  sheetRow({}),
  sheetRow({}),
  sheetRow({}),
  sheetRow({ C: '성함', F: '총 정산 오더수', AB: '차감내역', AC: '총정산금액', AE: '고용보험', AG: '산재보험', AH: '시간제보험', AM: '배달료' }),
  // 공제 열은 음수로 올 수 있다. 절대값으로 읽어 공제에 넣는다. 원천세만 AC×3.3%.
  sheetRow({ C: '박쿠팡', F: 120, AB: 5000, AC: 1212000, AE: -9000, AG: -8000, AH: -3000, AM: 1200000 }),
  sheetRow({ C: '최쿠팡', F: 80, AB: '-1,500', AC: '808,000', AE: '-6,000', AG: '-5,000', AH: '-2,000', AM: '800,000' }),
  sheetRow({ C: '없는기사', F: 40, AB: '', AC: 404000, AE: 3000, AG: 2500, AH: 1000, AM: 400000 }),
  sheetRow({ C: '합계', F: '', AB: 6500, AC: 2424000, AE: -18000, AG: -15500, AH: -6000, AM: 2400000 })
];

const DRIVERS = [
  { id: 'd1', name: '박쿠팡', baeminId: '', coupangId: '박쿠팡' },
  { id: 'd2', name: '최쿠팡', baeminId: '', coupangId: '최쿠팡' }
];

let FEES = { coupang: { callFee: 300, dailySettlementFee: 0.02, dailySettlementFeeMode: 'percent' } };

const SETTLEMENTS = [];
const adjustments = { other: {}, promotion: {} };

window.BremPlatforms = {
  normalize: p => (String(p || '') === 'baemin' ? 'baemin' : 'coupang'),
  label: p => (p === 'baemin' ? '배민' : '쿠팡')
};

window.BremSettlementParser = {
  normalizePassword: p => p || '',
  cellText: v => String(v ?? '').trim(),
  openWorkbookSheetRows: async () => COUPANG_ROWS
};

window.BremStorage = {
  drivers: {
    getAll: () => DRIVERS,
    getById: id => DRIVERS.find(d => d.id === id) || null
  },
  weeklySettlements: {
    getAll: channel => (channel === 'direct' ? SETTLEMENTS : [])
  },
  manualNameMappings: { getAll: () => [], save: () => {} },
  directSettlementAdjustments: {
    getSettlement: (kind, id) => adjustments[kind][id] || {}
  },
  payrollDailySettlement: {
    getFees: platform => FEES[platform] || { callFee: 0 },
    resolveDailySettlementFee: (amount, fees) => Math.round(Number(amount || 0) * Number(fees?.dailySettlementFee || 0))
  },
  payrollWithdrawal: { getAll: () => [] },
  ensureSectionLoaded: async () => {},
  flushStorage: async () => {},
  settlements: { getAll: () => [] },
  callInputs: { getAll: () => [] }
};

window.BremDatePicker = {
  weekStartKey(v) {
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
    d.setDate(d.getDate() - ((d.getDay() - 3 + 7) % 7));
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
};

// --- 모듈 로드 -------------------------------------------------------------
const ctx = vm.createContext(window);
const sources = ['js/settlement-formats.js', 'js/weekly-settlement.js', 'js/direct-settlement-calc.js', 'js/settlement-result-direct.js']
  .map(rel => fs.readFileSync(path.join(root, rel), 'utf8'))
  .join('\n;\n');
vm.runInContext(`${sources}
;globalThis.SettlementFormats = SettlementFormats;
globalThis.__WS = BremWeeklySettlement;
globalThis.__Result = BremSettlementResultDirect;`, ctx, { filename: 'bundle.js' });

const WS = ctx.__WS;
const Result = ctx.__Result;

let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${ok ? '' : `  기대=${expected} 실제=${actual}`}`);
}

const fakeFile = { arrayBuffer: async () => new ArrayBuffer(8) };

const DIRECT_COLS = {
  deliveryFee: 'AM',
  deductionDetail: 'AB',
  deductionBase: 'AC',
  employmentInsurance: 'AE',
  accidentInsurance: 'AG',
  hourlyInsurance: 'AH'
};

const TAX = base => Math.floor(base * 0.033);

(async () => {
  console.log('\n[1] 쿠팡 직계약 파싱 — C열 쿠팡ID · F열 오더수');
  const direct = await WS.extractCoupangWeeklyRiders(fakeFile, '', {
    nameColumn: 'C',
    orderCountColumn: 'F',
    startRow: 10,
    amountColumns: DIRECT_COLS
  });
  // 시작행을 10으로 앞당겼지만 헤더(11행)와 합계(오더수 비어있음) 행은 걸러져야 한다.
  check('데이터 3명만 추출', direct.length, 3);
  check('첫 기사 쿠팡ID', direct[0]?.coupangLoginKey, '박쿠팡');
  check('첫 기사 오더수', direct[0]?.weeklyOrderCount, 120);
  check('헤더 행 제외', direct.some(r => r.coupangLoginKey === '성함'), 'false');
  check('합계 행 제외', direct.some(r => r.coupangLoginKey === '합계'), 'false');

  console.log('\n[2] 배달료(AM+AB) + 공제 시트값(AB/AE/AG/AH) + 원천세만 AC×3.3%');
  check('배달료(AM+AB)', direct[0]?.amounts?.deliveryFee, 1205000);
  check('시트 AM 원본 보존', direct[0]?.amounts?.deliveryFeeAm, 1200000);
  check('고용보험(AE) 음수를 공제액으로', direct[0]?.amounts?.employmentInsurance, 9000);
  check('산재보험(AG) 음수를 공제액으로', direct[0]?.amounts?.accidentInsurance, 8000);
  check('시간제보험(AH) 음수를 공제액으로', direct[0]?.amounts?.hourlyInsurance, 3000);
  check('양수로 적혀 있으면 그대로', direct[2]?.amounts?.employmentInsurance, 3000);

  console.log('\n[2-1] 원천세만 AC×3.3%로 계산');
  check('원천세기준(AC)', direct[0]?.amounts?.deductionBase, 1212000);
  check('원천세 = AC×3.3%', direct[0]?.amounts?.withholdingTax, TAX(1212000));
  check('AC 쉼표 처리', direct[1]?.amounts?.deductionBase, 808000);
  check('두번째 기사 원천세', direct[1]?.amounts?.withholdingTax, TAX(808000));
  check('두번째 기사 고용보험(시트)', direct[1]?.amounts?.employmentInsurance, 6000);
  check('두번째 기사 산재보험(시트)', direct[1]?.amounts?.accidentInsurance, 5000);

  console.log('\n[2-1-1] 차감내역(AB)도 공제 항목으로 읽는다');
  check('차감내역(AB)', direct[0]?.amounts?.deductionDetail, 5000);
  check('음수로 적혀도 차감액으로 읽음', direct[1]?.amounts?.deductionDetail, 1500);
  check('빈 칸은 0', direct[2]?.amounts?.deductionDetail, 0);

  console.log('\n[2-2] 일정산서 배달료는 AL, 주정산 직계약은 AM (서로 다름)');
  const daily = ctx.SettlementFormats.getFormatForPlatform('coupang');
  check('일정산서 성함 열 = C', daily.columns.name, 'C');
  check('일정산서 오더수 열 = F', daily.columns.orderCount, 'F');
  check('일정산서 시간제보험 열 = AH', daily.columns.hourlyInsurance, 'AH');
  check('일정산서 정산금액 열 = AL', daily.columns.settlementAmount, 'AL');
  check('일정산서 공제기준 열 = AC', daily.columns.deductionBase, 'AC');
  check('주정산 배달료 열 = AM (일정산 AL과 다름)', DIRECT_COLS.deliveryFee, 'AM');
  check('일정산 AL ≠ 주정산 AM', daily.columns.settlementAmount === DIRECT_COLS.deliveryFee, 'false');

  console.log('\n[3] 쉼표 들어간 금액도 숫자로');
  check('배달료 800,000+1,500', direct[1]?.amounts?.deliveryFee, 801500);
  check('고용보험 -6,000 → 6,000', direct[1]?.amounts?.employmentInsurance, 6000);
  check('시간제보험 -2,000 → 2,000', direct[1]?.amounts?.hourlyInsurance, 2000);

  console.log('\n[4] 브로 업로드는 기존 동작 유지 (금액 열 없음)');
  const bro = await WS.extractCoupangWeeklyRiders(fakeFile, '', {
    nameColumn: 'C',
    orderCountColumn: 'F',
    startRow: 12
  });
  check('브로는 amounts 없음', bro[0]?.amounts, undefined);
  check('브로 오더수는 그대로', bro[0]?.weeklyOrderCount, 120);
  check('브로는 합계 행도 읽음(기존 동작)', bro.some(r => r.coupangLoginKey === '합계'), 'true');

  console.log('\n[5] 정산결과(직계약) 반영 — 콜수수료 = 오더수 × 단가');
  SETTLEMENTS.length = 0;
  SETTLEMENTS.push({
    id: 'weekly_direct_coupang_seoul_20260722',
    platform: 'coupang', channel: 'direct', region: '서울',
    fileName: '쿠팡_직계약_0722.xlsx', startDate: '2026-07-22', endDate: '2026-07-28',
    riders: [
      { matchedRiderId: 'd1', coupangLoginKey: '박쿠팡', weeklyOrderCount: 120, amounts: direct[0].amounts },
      { matchedRiderId: 'd2', coupangLoginKey: '최쿠팡', weeklyOrderCount: 80, amounts: direct[1].amounts }
    ]
  });
  Result.init();
  await Result.refresh('coupang');
  const rows = [...window.document.querySelectorAll('#settlementResultRows tr')];
  check('라이더 2명 표시', rows.length, 2);

  const money = n => Number(n).toLocaleString('ko-KR');
  const BASE = 1212000;
  const parkTax = TAX(BASE);
  // 배달료 = AM+AB = 1,200,000+5,000
  const parkDelivery = 1205000;
  // AB 5,000 + AE 9,000 + AG 8,000 + AH 3,000
  const parkSheetDeduct = 5000 + 9000 + 8000 + 3000;

  const parkRow = rows.find(tr => tr.textContent.includes('박쿠팡'));
  const cells = [...parkRow.querySelectorAll('td')].map(td => td.textContent.trim());
  check('쿠팡ID 표시', cells[1], '박쿠팡');
  check('오더수 120', cells[2], '120');
  check('원천세 = AC×3.3%', cells.includes(money(parkTax)), 'true');
  check('고용보험 시트값 표시', cells.includes('9,000'), 'true');
  check('산재보험 시트값 표시', cells.includes('8,000'), 'true');
  check('차감내역 공제 표시', cells.includes('5,000'), 'true');
  // 콜수수료 = 120 × 300 = 36,000
  check('콜수수료 36,000', cells.includes('36,000'), 'true');
  check(`공제합계 ${money(parkSheetDeduct + parkTax + 36000)}`, cells.includes(money(parkSheetDeduct + parkTax + 36000)), 'true');
  check(`실지급 ${money(parkDelivery - parkSheetDeduct - parkTax - 36000)}`,
    cells.includes(money(parkDelivery - parkSheetDeduct - parkTax - 36000)), 'true');

  console.log('\n[6] 콜수수료 단가를 바꾸면 정산결과도 따라간다');
  FEES = { coupang: { callFee: 250, dailySettlementFee: 0.02, dailySettlementFeeMode: 'percent' } };
  await Result.refresh('coupang');
  const cells6 = [...[...window.document.querySelectorAll('#settlementResultRows tr')]
    .find(tr => tr.textContent.includes('박쿠팡')).querySelectorAll('td')].map(td => td.textContent.trim());
  // 120 × 250 = 30,000
  check('콜수수료 30,000', cells6.includes('30,000'), 'true');
  check(`실지급 ${money(parkDelivery - parkSheetDeduct - parkTax - 30000)}`,
    cells6.includes(money(parkDelivery - parkSheetDeduct - parkTax - 30000)), 'true');

  console.log('\n[7] 단가 0이면 콜수수료 공제 없음');
  FEES = { coupang: { callFee: 0, dailySettlementFee: 0, dailySettlementFeeMode: 'fixed' } };
  await Result.refresh('coupang');
  const cells7 = [...[...window.document.querySelectorAll('#settlementResultRows tr')]
    .find(tr => tr.textContent.includes('박쿠팡')).querySelectorAll('td')].map(td => td.textContent.trim());
  check(`실지급 ${money(parkDelivery - parkSheetDeduct - parkTax)}`, cells7.includes(money(parkDelivery - parkSheetDeduct - parkTax)), 'true');

  console.log('\n[8] 쿠팡·배민 지급/공제 열을 통일한다 (한쪽에만 있는 항목도 0으로 표기)');
  // 헤더는 2줄(그룹행 + 열이름행)이라 열 이름은 두 번째 줄에서 읽는다.
  const headRows = [...window.document.querySelectorAll('#settlementResultHead tr')];
  const headCoupang = [...headRows[1].querySelectorAll('th')].map(th => th.textContent.trim());
  check('배민 전용 추가지급 열도 쿠팡에 있음', headCoupang.includes('추가지급(미션)'), 'true');
  check('배달비 열 있음', headCoupang.includes('배달비'), 'true');
  check('원천세 열 있음', headCoupang.includes('원천세'), 'true');
  const groupLabels = [...headRows[0].querySelectorAll('th')].map(th => th.textContent.trim());
  check('지급내역 묶음 헤더', groupLabels.includes('지급내역'), 'true');
  check('공제내역 묶음 헤더', groupLabels.includes('공제내역'), 'true');
  const bodyCells = [...window.document.querySelectorAll('#settlementResultRows tr')][0].querySelectorAll('td').length;
  check('헤더와 본문 열 수 일치', bodyCells, headCoupang.length);

  console.log('\n[9] 차감내역(AB)은 공제합계·총지급액에 포함한다');
  check('차감내역 열 있음(쿠팡)', headCoupang.includes('차감내역'), 'true');
  const cells9 = [...[...window.document.querySelectorAll('#settlementResultRows tr')]
    .find(tr => tr.textContent.includes('박쿠팡')).querySelectorAll('td')].map(td => td.textContent.trim());
  check('차감내역 5,000 표시', cells9.includes('5,000'), 'true');
  // AB(5,000)가 공제에 들어가야 한다.
  check(`공제합계에 AB 포함 ${money(parkSheetDeduct + parkTax)}`, cells9.includes(money(parkSheetDeduct + parkTax)), 'true');
  check(`총지급액에 AB 반영 ${money(parkDelivery - parkSheetDeduct - parkTax)}`,
    cells9.includes(money(parkDelivery - parkSheetDeduct - parkTax)), 'true');

  console.log('\n[9-1] 음수 공제가 총지급액을 부풀리지 않는다');
  const netPark = parkDelivery - parkSheetDeduct - parkTax;
  check('총지급액 < 배달료', netPark < parkDelivery, 'true');
  check(`총지급액 ${money(netPark)}`, cells9.includes(money(netPark)), 'true');
  check('공제합계가 양수', cells9.some(c => c === money(parkSheetDeduct + parkTax)), 'true');
  check('음수 표기 없음', cells9.some(c => c.startsWith('-')), 'false');

  console.log('\n[9-2] ID는 파란 태그로 표기하고 기사명 가나다순 정렬');
  const idTags = [...window.document.querySelectorAll('#settlementResultRows .weekly-id-tag')]
    .map(el => el.textContent.trim());
  check('ID 태그 2개', idTags.length, 2);
  check('태그 안에 쿠팡ID', idTags.includes('박쿠팡'), 'true');
  const names = [...window.document.querySelectorAll('#settlementResultRows tr')]
    .map(tr => tr.querySelector('td')?.textContent.trim());
  check('가나다순 정렬', JSON.stringify(names), JSON.stringify([...names].sort((a, b) => a.localeCompare(b, 'ko-KR'))));

  console.log('\n[10] 배민도 쿠팡과 같은 열 구성을 쓴다');
  SETTLEMENTS.push({
    id: 'weekly_direct_baemin_seoul_20260722',
    platform: 'baemin', channel: 'direct', region: '서울',
    fileName: '배민_직계약_0722.xlsx', startDate: '2026-07-22', endDate: '2026-07-28',
    riders: [{
      matchedRiderId: 'd1', baeminUserId: 'bm1', weeklyCallCount: 100,
      amounts: { deliveryFee: 900000, missionPay: 50000, hourlyInsurance: 0,
        employmentInsurance: 7000, accidentInsurance: 6000, withholdingTax: 30000 }
    }]
  });
  await Result.refresh('baemin');
  const headBaemin = [...[...window.document.querySelectorAll('#settlementResultHead tr')][1].querySelectorAll('th')]
    .map(th => th.textContent.trim());
  check('배민도 차감내역 열 있음', headBaemin.includes('차감내역'), 'true');
  check('배민도 추가지급 열 있음', headBaemin.includes('추가지급(미션)'), 'true');
  check('쿠팡·배민 열 구성 동일', JSON.stringify(headBaemin), JSON.stringify(headCoupang));
  const bodyBaemin = [...window.document.querySelectorAll('#settlementResultRows tr')][0].querySelectorAll('td').length;
  check('배민도 헤더와 본문 열 수 일치', bodyBaemin, headBaemin.length);

  console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\n예외:', e.stack || e.message); process.exit(2); });
