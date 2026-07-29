/**
 * 쿠팡 직계약 주정산서 파싱 → 저장 → 정산결과(직계약) 반영 검증 (로컬, 서버 접속 없음).
 *
 * 확인 항목
 *  - C열 성함을 쿠팡ID로 읽고, F열 오더수를 주간 오더수로 읽는지
 *  - AJ(배달료·콜수수료 공제 후) / AE(고용보험) / AG(산재보험) / AH(시간제보험) 를 뽑는지
 *  - 일정산서 서식(brem-standard)과 성함·오더수·시간제보험·정산금액 열이 일치하는지
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
// 열 인덱스: A=0 ... C=2, F=5, AE=30, AG=32, AH=33, AJ=35
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
  sheetRow({ C: '성함', F: '총 정산 오더수', AE: '고용보험', AG: '산재보험', AH: '시간제보험', AJ: '정산금액' }),
  sheetRow({ C: '박쿠팡', F: 120, AE: 9000, AG: 8000, AH: 3000, AJ: 1200000 }),
  sheetRow({ C: '최쿠팡', F: 80, AE: '6,000', AG: '5,000', AH: '2,000', AJ: '800,000' }),
  sheetRow({ C: '없는기사', F: 40, AE: 3000, AG: 2500, AH: 1000, AJ: 400000 }),
  sheetRow({ C: '합계', F: '', AE: 18000, AG: 15500, AH: 6000, AJ: 2400000 })
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
const sources = ['js/settlement-formats.js', 'js/weekly-settlement.js', 'js/settlement-result-direct.js']
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
  deliveryFee: 'AJ',
  employmentInsurance: 'AE',
  accidentInsurance: 'AG',
  hourlyInsurance: 'AH'
};

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

  console.log('\n[2] 금액·공제 열 추출 (AJ / AE / AG / AH)');
  check('배달료(AJ)', direct[0]?.amounts?.deliveryFee, 1200000);
  check('고용보험(AE)', direct[0]?.amounts?.employmentInsurance, 9000);
  check('산재보험(AG)', direct[0]?.amounts?.accidentInsurance, 8000);
  check('시간제보험(AH)', direct[0]?.amounts?.hourlyInsurance, 3000);

  console.log('\n[2-1] 일정산서 서식과 열이 일치');
  const daily = ctx.SettlementFormats.getFormatForPlatform('coupang');
  check('일정산서 성함 열 = C', daily.columns.name, 'C');
  check('일정산서 오더수 열 = F', daily.columns.orderCount, 'F');
  check('일정산서 시간제보험 열 = AH', daily.columns.hourlyInsurance, 'AH');
  check('일정산서 정산금액 열 = AJ (주정산서 배달료와 동일)', daily.columns.settlementAmount, DIRECT_COLS.deliveryFee);

  console.log('\n[3] 쉼표 들어간 금액도 숫자로');
  check('배달료 800,000', direct[1]?.amounts?.deliveryFee, 800000);
  check('고용보험 6,000', direct[1]?.amounts?.employmentInsurance, 6000);
  check('시간제보험 2,000', direct[1]?.amounts?.hourlyInsurance, 2000);

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

  const parkRow = rows.find(tr => tr.textContent.includes('박쿠팡'));
  const cells = [...parkRow.querySelectorAll('td')].map(td => td.textContent.trim());
  check('쿠팡ID 표시', cells[1], '박쿠팡');
  check('오더수 120', cells[2], '120');
  // 콜수수료 = 120 × 300 = 36,000
  check('콜수수료 36,000', cells.includes('36,000'), 'true');
  // 공제합계 = 고용9,000 + 산재8,000 + 시간제3,000 + 콜수수료36,000 = 56,000
  check('공제합계 56,000', cells.includes('56,000'), 'true');
  // 총지급액 = 1,200,000 - 56,000 = 1,144,000
  check('실지급 1,144,000', cells.includes('1,144,000'), 'true');

  console.log('\n[6] 콜수수료 단가를 바꾸면 정산결과도 따라간다');
  FEES = { coupang: { callFee: 250, dailySettlementFee: 0.02, dailySettlementFeeMode: 'percent' } };
  await Result.refresh('coupang');
  const rows6 = [...window.document.querySelectorAll('#settlementResultRows tr')];
  const cells6 = [...rows6.find(tr => tr.textContent.includes('박쿠팡')).querySelectorAll('td')]
    .map(td => td.textContent.trim());
  // 120 × 250 = 30,000
  check('콜수수료 30,000', cells6.includes('30,000'), 'true');
  check('실지급 1,150,000', cells6.includes('1,150,000'), 'true');

  console.log('\n[7] 단가 0이면 콜수수료 공제 없음');
  FEES = { coupang: { callFee: 0, dailySettlementFee: 0, dailySettlementFeeMode: 'fixed' } };
  await Result.refresh('coupang');
  const cells7 = [...[...window.document.querySelectorAll('#settlementResultRows tr')]
    .find(tr => tr.textContent.includes('박쿠팡')).querySelectorAll('td')].map(td => td.textContent.trim());
  check('실지급 1,180,000', cells7.includes('1,180,000'), 'true');

  console.log('\n[8] 쿠팡에는 없는 항목(배민미션) 열을 숨긴다');
  const headCoupang = [...window.document.querySelectorAll('#settlementResultHead th')].map(th => th.textContent.trim());
  check('배민미션 열 없음', headCoupang.includes('배민미션'), 'false');
  check('배달비 열 있음', headCoupang.includes('배달비'), 'true');
  check('원천세 열 있음', headCoupang.includes('원천세'), 'true');
  const bodyCells = [...window.document.querySelectorAll('#settlementResultRows tr')][0].querySelectorAll('td').length;
  check('헤더와 본문 열 수 일치', bodyCells, headCoupang.length);

  console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\n예외:', e.stack || e.message); process.exit(2); });
