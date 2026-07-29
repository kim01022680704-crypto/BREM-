/**
 * 「주정산서 업로드 (직계약)」 쿠팡 미리보기 표를 실제 렌더 경로로 만들어
 * 정적 HTML 로 떨어뜨린다 (로컬 전용, 서버·Supabase 접속 없음).
 *
 *   node scripts/_preview-weekly-direct.js
 *   → _preview-weekly-direct.html 을 브라우저로 열면 된다.
 *
 * admin.html 의 실제 섹션 마크업 + 실제 모듈 + 실제 admin.css 를 쓴다.
 * 표를 손으로 다시 짜면 화면과 다른 걸 보게 되므로 렌더 결과를 그대로 굽는다.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

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
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error(`섹션 ${id} 의 끝을 찾지 못했습니다.`);
}

const section = extractSection('weekly-settlement-direct')
  .replace('<section class="section" id="weekly-settlement-direct">',
    '<section class="section active" id="weekly-settlement-direct">');

// 화면에 올라온 실제 정산서와 비슷하게: 공제는 음수, 차감내역은 일부만 채워져 있다.
// 열 인덱스: C=2, F=5, AB=27, AC=28, AE=30, AG=32, AH=33, AJ=35
function sheetRow(map) {
  const row = new Array(40).fill('');
  Object.entries(map).forEach(([col, value]) => {
    let index = 0;
    for (const ch of col) index = index * 26 + (ch.charCodeAt(0) - 64);
    row[index - 1] = value;
  });
  return row;
}

const PEOPLE = [
  ['김대순2916', 34, 123290, 0, 128880, 0, -800, -3827],
  ['최유림4314', 106, 429045, 0, 447848, 0, -3080, -12643],
  ['정재남1594', 182, 664937, 14669, 702710, 0, -4830, -28113],
  ['노재현1874', 29, 112238, 0, 117152, 0, -800, -3314],
  ['김석주5516', 107, 392481, 0, 410649, 0, -2820, -12528],
  ['김명수5133', 196, 750879, 0, 807525, -10640, -5560, -24246],
  ['문솔민4466', 48, 210433, 0, 218468, 0, -1500, -5035],
  ['장우성8281', 350, 1375412, 0, 1465800, -10640, -10090, -48928],
  ['이은옹9991', 38, 152609, 0, 154729, 0, -1060, 0],
  ['이재괄7432', 4, 17622, 0, 18346, 0, -120, -484],
  ['손현남7836', 276, 1119122, 13475, 1156322, -10640, -7960, 0],
  ['조지훈7022', 271, 996410, 0, 1031870, -10640, -7090, 0]
];

const SHEET_ROWS = [
  sheetRow({ A: '쿠팡이츠 정산 내역' }),
  ...Array.from({ length: 9 }, () => sheetRow({})),
  sheetRow({ C: '성함', F: '총 정산 오더수', AB: '차감내역', AC: '총정산금액', AE: '고용보험', AG: '산재보험', AH: '시간제보험', AJ: '정산금액' }),
  ...PEOPLE.map(([name, orders, aj, ab, ac, ae, ag, ah]) =>
    sheetRow({ C: name, F: orders, AB: ab, AC: ac, AE: ae, AG: ag, AH: ah, AJ: aj })),
  sheetRow({ C: '합계', F: '' })
];

const DRIVERS = PEOPLE.map(([name], i) => ({
  id: `d${i + 1}`, name, baeminId: '', coupangId: name, status: '재직'
}));

const dom = new JSDOM(`<!doctype html><html><head>
<link rel="stylesheet" href="css/admin.css">
</head><body><div class="admin-shell"><main class="admin-main">${section}</main></div></body></html>`,
  { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

window.BremPlatforms = {
  PLATFORMS: ['coupang', 'baemin'],
  normalize: p => (p === 'baemin' ? 'baemin' : 'coupang'),
  label: p => (p === 'baemin' ? '배민' : '쿠팡')
};
window.BremSettlementParser = {
  normalizePassword: p => p || '',
  cellText: v => String(v ?? '').trim(),
  openWorkbookSheetRows: async () => SHEET_ROWS
};
window.BremDatePicker = {
  weekStartKey: value => {
    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() - ((date.getDay() - 3 + 7) % 7));
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  },
  setupWednesdayWeekDelegated: () => {}
};
window.BremStorage = {
  drivers: { getAll: () => DRIVERS, getById: id => DRIVERS.find(d => d.id === id) || null },
  refreshDriversForSettlementMatch: async () => {},
  settlementUploadLogs: {
    add: () => ({ id: 'log1' }),
    getAll: () => [],
    getFiltered: () => [],
    syncWeeklyFromSavedRecords: () => {}
  },
  settlementUnmatched: {
    getAllWeekly: () => [],
    getByWeek: () => [],
    saveWeeklyBatch: () => {}
  },
  weeklySettlements: { getAll: () => [], getById: () => null },
  // 시스템 콜수는 정산서 오더수와 일치하도록 넣어 「콜수 일치」가 정상으로 보이게 한다.
  calls: {
    getAll: () => PEOPLE.map(([name, orders], i) => ({
      driverId: `d${i + 1}`, platform: 'coupang', date: '2026-07-24', count: orders
    })),
    getWeeklyTotalsByDriver: () => ({})
  },
  settlements: { getAll: () => [] },
  callInputs: { getAll: () => [] },
  manualNameMappings: { getAll: () => [], save: () => {} }
};

// const 로 선언된 모듈은 window 에 안 붙어서 vm 컨텍스트에서 꺼내 쓴다.
const ctx = vm.createContext(window);
const sources = ['js/settlement-formats.js', 'js/weekly-settlement.js', 'js/weekly-settlement-admin.js']
  .map(rel => fs.readFileSync(path.join(root, rel), 'utf8'))
  .join('\n;\n');
vm.runInContext(`${sources}
;globalThis.SettlementFormats = SettlementFormats;
globalThis.BremWeeklySettlement = BremWeeklySettlement;
globalThis.BremWeeklySettlementAdmin = BremWeeklySettlementAdmin;`, ctx, { filename: 'bundle.js' });

(async () => {
  // 업로드가 조용히 실패하면 토스트로만 알려주므로 받아서 찍어둔다.
  window.document.addEventListener('brem-admin-toast',
    e => console.log('  [토스트]', e.detail?.message));
  ctx.BremWeeklySettlementAdmin.init();

  const set = (id, value) => { const el = window.document.getElementById(id); if (el) el.value = value; };
  set('weeklySettlementDirectRegion-coupang', '서울');
  set('weeklySettlementDirectStartDate-coupang', '2026-07-22');
  set('weeklySettlementDirectEndDate-coupang', '2026-07-28');
  set('weeklySettlementDirectStartRow-coupang', '10');

  // JSDOM 은 input.files 를 직접 못 넣어서 프로퍼티로 끼운다.
  const fileInput = window.document.getElementById('weeklySettlementDirectFile-coupang');
  Object.defineProperty(fileInput, 'files', {
    value: [{ name: '쿠팡_직계약_0722.xlsx', arrayBuffer: async () => new ArrayBuffer(8) }]
  });

  window.document.getElementById('weeklySettlementDirectUploadForm-coupang')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  await new Promise(r => setTimeout(r, 300));

  const rows = window.document.querySelectorAll('#weeklySettlementDirectPreviewRows-coupang tr');
  if (!rows.length) throw new Error('미리보기 행이 렌더되지 않았습니다.');
  console.log(`미리보기 행 ${rows.length}개 렌더됨`);

  const out = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>주정산서 업로드 (직계약) — 쿠팡 미리보기</title>
<link rel="stylesheet" href="css/admin.css">
<style>body{padding:24px;background:#0b0b0b}</style>
</head><body><div class="admin-shell"><main class="admin-main">
${window.document.querySelector('#weekly-settlement-direct').outerHTML}
</main></div></body></html>`;
  fs.writeFileSync(path.join(root, '_preview-weekly-direct.html'), out, 'utf8');
  console.log('_preview-weekly-direct.html 생성 완료');
})().catch(e => { console.error('실패:', e.stack || e.message); process.exit(1); });
