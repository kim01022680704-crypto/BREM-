/**
 * 프로모션정산등록 → 정산결과(직계약) 흐름 검증 (로컬, 서버 접속 없음)
 * admin.html 의 해당 섹션만 떼어 jsdom 에 올리고 실제 모듈을 로드해 동작을 확인한다.
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
  // 해당 섹션의 닫는 태그까지 균형 맞춰 자른다.
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
  `<!doctype html><html><body>${extractSection('promotion-settlement')}${extractSection('settlement-result-direct')}</body></html>`,
  { runScripts: 'outside-only' }
);
const { window } = dom;

// --- 가짜 저장소 -----------------------------------------------------------
const DRIVERS = [
  { id: 'd1', name: '김배민', baeminId: 'BC000001', coupangId: '' },
  { id: 'd2', name: '이배민', baeminId: 'BC000002', coupangId: '' },
  { id: 'd3', name: '박쿠팡', baeminId: '', coupangId: 'CP000003' }
];

const store = {};
const adjustments = { other: {}, promotion: {} };

const SETTLEMENTS = [
  {
    id: 'weekly_direct_baemin_seoul_20260722',
    platform: 'baemin', channel: 'direct', region: '서울',
    fileName: '을지_2026_07.xlsx', startDate: '2026-07-22', endDate: '2026-07-28',
    riders: [
      { matchedRiderId: 'd1', baeminUserId: 'BC000001', weeklyOrderCount: 100,
        amounts: { deliveryFee: 1000000, missionPay: 50000, employmentInsurance: 9000, accidentInsurance: 8000, hourlyInsurance: 3000, withholdingTax: 33000 } },
      { matchedRiderId: 'd2', baeminUserId: 'BC000002', weeklyOrderCount: 50,
        amounts: { deliveryFee: 500000, missionPay: 0, employmentInsurance: 4500, accidentInsurance: 4000, hourlyInsurance: 1500, withholdingTax: 16500 } }
    ]
  },
  {
    id: 'weekly_direct_baemin_seoul_20260715',
    platform: 'baemin', channel: 'direct', region: '서울',
    fileName: '을지_2026_06.xlsx', startDate: '2026-07-15', endDate: '2026-07-21',
    riders: [
      { matchedRiderId: 'd1', baeminUserId: 'BC000001', weeklyOrderCount: 80, amounts: { deliveryFee: 800000 } }
    ]
  },
  {
    id: 'weekly_direct_coupang_seoul_20260722',
    platform: 'coupang', channel: 'direct', region: '서울',
    fileName: '쿠팡_직계약.xlsx', startDate: '2026-07-22', endDate: '2026-07-28',
    riders: [
      { matchedRiderId: 'd3', coupangLoginKey: 'CP000003', weeklyOrderCount: 30, amounts: { deliveryFee: 300000 } }
    ]
  }
];

// 프로모션 적용 저장 결과. [10] 이후 테스트에서 중복 저장본을 덧붙인다.
const ERP_RESULTS = [{
  id: 'erp1', platform: 'baemin', startDate: '2026-07-22', region: '서울',
  settlementId: 'bro_seoul_base',
  settlementLabel: '2026-07 4주', savedAt: '2026-07-26T12:00:00',
  selectedPromotionRuleNames: ['주말 프로모션'],
  summary: { riderCount: 1, totalPromotionAmount: 70000 },
  results: [{ matchedRiderId: 'd2', totalPromotionAmount: 70000, driverName: '이배민' }]
}];

window.BremStorage = {
  drivers: {
    getAll: () => DRIVERS,
    getById: id => DRIVERS.find(d => d.id === id) || null
  },
  weeklySettlements: {
    getAll: channel => (channel === 'direct' ? SETTLEMENTS : [])
  },
  promotionApplyResults: {
    getAll: () => ERP_RESULTS
  },
  directPayAdjustments: {
    getBlob: kind => store[kind] || {},
    getWeek: (kind, wk) => (store[kind] || {})[wk] || {},
    clearWeek: (kind, wk) => { if (store[kind]) delete store[kind][wk]; }
  },
  directSettlementAdjustments: {
    getSettlement: (kind, id) => adjustments[kind][id] || {},
    applyEntries(kind, id, entries, options = {}) {
      if (options.replace) adjustments[kind][id] = {};
      const cur = adjustments[kind][id] || (adjustments[kind][id] = {});
      entries.forEach(e => {
        cur[e.driverId] = {
          amount: Math.round(Number(e.amount || 0)),
          baeminId: e.baeminId || '', coupangId: e.coupangId || '',
          driverName: e.driverName || '', source: e.source === 'erp' ? 'erp' : 'excel'
        };
      });
      return cur;
    },
    removeDriver: (kind, id, driverId) => { if (adjustments[kind][id]) delete adjustments[kind][id][driverId]; },
    summary(id) {
      const sum = m => Object.values(m || {}).reduce((s, x) => s + Number(x.amount || 0), 0);
      return {
        promotionCount: Object.keys(adjustments.promotion[id] || {}).length,
        promotionTotal: sum(adjustments.promotion[id]),
        otherCount: Object.keys(adjustments.other[id] || {}).length,
        otherTotal: sum(adjustments.other[id])
      };
    }
  },
  payrollDailySettlement: {
    getFees: () => ({ callFee: 100, dailySettlementFeeRate: 0.02 }),
    resolveDailySettlementFee: amount => Math.round(Number(amount || 0) * 0.02)
  },
  payrollWithdrawal: { getAll: () => [] },
  ensureSectionLoaded: async () => {},
  flushStorage: async () => {}
};

// 실제 BremDatePicker 와 마찬가지로 로컬 기준으로 찍는다.
// toISOString 을 쓰면 UTC+9 에서 하루 밀려 테스트가 실제 동작과 어긋난다.
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
const sources = ['js/direct-adjustment-bulk.js', 'js/direct-adjustment-admin.js', 'js/settlement-result-direct.js']
  .map(rel => fs.readFileSync(path.join(root, rel), 'utf8'))
  .join('\n;\n');
// 모듈들이 top-level const 로 선언되어 전역 객체에 붙지 않으므로 명시적으로 내보낸다.
vm.runInContext(`${sources}
;globalThis.__Adj = BremDirectAdjustmentAdmin;
globalThis.__Result = BremSettlementResultDirect;`, ctx, { filename: 'bundle.js' });

const Adj = ctx.__Adj;
const Result = ctx.__Result;

let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${ok ? '' : `  기대=${expected} 실제=${actual}`}`);
}

(async () => {
  console.log('\n[1] 배민 정산서 목록');
  Adj.init();
  await Adj.refresh('baemin');
  const select = window.document.getElementById('directAdjustSettlementSelect');
  // 정산주 필터가 기본으로 최신 주에 걸리므로 그 주 정산서만 보인다.
  check('기본 정산주의 배민 정산서 1건', select.options.length, 1);
  check('최신 정산서가 기본 선택', select.value, 'weekly_direct_baemin_seoul_20260722');
  check('ID 라벨이 배민ID', window.document.querySelector('[data-direct-id-label]').textContent, '배민ID');

  console.log('\n[2] 쿠팡 전환 시 정산서 분리');
  await Adj.refresh('coupang');
  check('쿠팡 정산서 1건만 노출', window.document.getElementById('directAdjustSettlementSelect').options.length, 1);
  check('ID 라벨이 쿠팡ID', window.document.querySelector('[data-direct-id-label]').textContent, '쿠팡ID');

  console.log('\n[3] 엑셀 파싱 — 플랫폼별 매칭');
  const bulk = ctx.BremDirectAdjustmentBulk;
  const baeminRows = bulk.parseSheetRows([['배민ID', '금액'], ['BC000001', 30000]], DRIVERS, 'baemin');
  check('배민 시트 1행 매칭', baeminRows.rows[0]?.matchStatus, 'matched');
  check('배민 시트 매칭 기사', baeminRows.rows[0]?.driverId, 'd1');
  const coupangRows = bulk.parseSheetRows([['쿠팡ID', '금액'], ['CP000003', 20000]], DRIVERS, 'coupang');
  check('쿠팡 시트 1행 매칭', coupangRows.rows[0]?.matchStatus, 'matched');
  check('쿠팡 시트 매칭 기사', coupangRows.rows[0]?.driverId, 'd3');
  const crossRows = bulk.parseSheetRows([['배민ID', '금액'], ['BC000001', 30000]], DRIVERS, 'coupang');
  check('배민ID를 쿠팡으로 올리면 미매칭', crossRows.rows[0]?.matchStatus, 'unmatched');

  console.log('\n[4] 정산서에 적용 → 저장 위치 분리');
  await Adj.refresh('baemin');
  window.BremStorage.directSettlementAdjustments.applyEntries('promotion', 'weekly_direct_baemin_seoul_20260722',
    [{ driverId: 'd1', amount: 100000, baeminId: 'BC000001', driverName: '김배민', source: 'excel' }]);
  window.BremStorage.directSettlementAdjustments.applyEntries('other', 'weekly_direct_baemin_seoul_20260722',
    [{ driverId: 'd1', amount: 20000, baeminId: 'BC000001', driverName: '김배민', source: 'excel' }]);
  window.BremStorage.directSettlementAdjustments.applyEntries('promotion', 'weekly_direct_baemin_seoul_20260715',
    [{ driverId: 'd1', amount: 999999, baeminId: 'BC000001', driverName: '김배민', source: 'excel' }]);
  const s = window.BremStorage.directSettlementAdjustments.summary('weekly_direct_baemin_seoul_20260722');
  check('7/22 정산서 프로모션 합계', s.promotionTotal, 100000);
  check('7/22 정산서 기타지급 합계', s.otherTotal, 20000);
  check('7/15 정산서는 별도 보관', window.BremStorage.directSettlementAdjustments.summary('weekly_direct_baemin_seoul_20260715').promotionTotal, 999999);

  console.log('\n[5] 정산결과에서 불러오기');
  Result.init();
  await Result.refresh('baemin');
  const resultSelect = window.document.getElementById('settlementResultSettlementSelect');
  check('정산결과 기본 주 정산서 1건', resultSelect.options.length, 1);
  const rows = window.document.querySelectorAll('#settlementResultRows tr');
  check('라이더 2명 표시', rows.length, 2);
  const firstRow = [...rows].find(tr => tr.textContent.includes('김배민'));
  const cells = [...firstRow.querySelectorAll('td')].map(td => td.textContent.trim());
  // 지급합계 = 배달비1,000,000 + 미션50,000 + 기타20,000 + 프로모션100,000
  check('김배민 기타지급 반영', cells[5], '20,000');
  check('김배민 BREM프로모션 반영', cells[6], '100,000');
  check('김배민 지급합계', cells[7], '1,170,000');
  // 프로모션원천세 = (100,000+20,000)*3.3% = 3,960
  check('프로모션원천세 3.3%', cells[12], '3,960');
  // 콜수수료 = 100콜 * 100원
  check('콜수수료', cells[13], '10,000');
  // 공제합계 = 9000+8000+3000+33000+3960+10000+0+0
  check('공제합계', cells[16], '66,960');
  check('총지급액', cells[17], '1,103,040');

  console.log('\n[6] 7/15 정산서로 바꾸면 그 정산서 금액만');
  Result.state.week = '2026-07-15';
  Result.state.settlementId = 'weekly_direct_baemin_seoul_20260715';
  await Result.refresh('baemin');
  // refresh 는 플랫폼이 같으면 settlementId 를 유지한다
  const rows2 = window.document.querySelectorAll('#settlementResultRows tr');
  const cells2 = [...rows2[0].querySelectorAll('td')].map(td => td.textContent.trim());
  check('7/15 정산서 프로모션', cells2[6], '999,999');

  console.log('\n[7] ERP 프로모션 → 선택한 정산서에 적용 (실제 버튼 동작)');
  await Adj.refresh('baemin');
  Adj.state.settlementId = 'weekly_direct_baemin_seoul_20260722';
  await Adj.refresh('baemin');
  const erpRow = window.document.querySelector('#directErpSavedRows [data-erp-select]');
  check('ERP 저장결과가 같은 주로 노출', !!erpRow, 'true');
  erpRow.checked = true;
  erpRow.dispatchEvent(new window.Event('change', { bubbles: true }));
  window.document.getElementById('directErpApplyBtn').click();
  check('ERP 금액이 정산서에 적용(d2 = 70,000)',
    adjustments.promotion['weekly_direct_baemin_seoul_20260722']?.d2?.amount, 70000);
  check('ERP 출처 기록', adjustments.promotion['weekly_direct_baemin_seoul_20260722']?.d2?.source, 'erp');
  check('기존 d1 프로모션 유지', adjustments.promotion['weekly_direct_baemin_seoul_20260722']?.d1?.amount, 100000);
  check('저장 결과 표시', /BREM프로모션/.test(window.document.getElementById('directAdjustAppliedSummary').textContent), 'true');

  console.log('\n[8] ERP 적용분이 정산결과에 반영');
  Result.state.week = '2026-07-22';
  Result.state.settlementId = 'weekly_direct_baemin_seoul_20260722';
  await Result.refresh('baemin');
  const erpApplied = [...window.document.querySelectorAll('#settlementResultRows tr')]
    .find(tr => tr.textContent.includes('이배민'));
  check('이배민 프로모션 70,000', [...erpApplied.querySelectorAll('td')][6].textContent.trim(), '70,000');

  console.log('\n[9] 쿠팡 정산결과 분리');
  await Result.refresh('coupang');
  const coupangRowsEl = window.document.querySelectorAll('#settlementResultRows tr');
  check('쿠팡 라이더 1명', coupangRowsEl.length, 1);
  check('쿠팡 ID 표시', [...coupangRowsEl[0].querySelectorAll('td')][1].textContent.trim(), 'CP000003');

  console.log('\n[10] 같은 정산서 중복 저장본 — 최신만 기본 사용');
  // 같은 브로 정산서(bro_seoul_A)를 두 번 저장한 상황 + 다른 지역 1건
  ERP_RESULTS.push(
    {
      id: 'erpA_new', platform: 'baemin', startDate: '2026-07-22', region: '양산',
      settlementId: 'bro_seoul_A', savedAt: '2026-07-26T10:00:00',
      selectedPromotionRuleNames: ['140건 천'],
      summary: { riderCount: 1, totalPromotionAmount: 10000 },
      results: [{ matchedRiderId: 'd1', totalPromotionAmount: 10000, driverName: '김배민' }]
    },
    {
      id: 'erpA_old', platform: 'baemin', startDate: '2026-07-22', region: '양산',
      settlementId: 'bro_seoul_A', savedAt: '2026-07-26T09:00:00',
      selectedPromotionRuleNames: ['140건 천'],
      summary: { riderCount: 1, totalPromotionAmount: 12000 },
      results: [{ matchedRiderId: 'd1', totalPromotionAmount: 12000, driverName: '김배민' }]
    },
    {
      id: 'erpB', platform: 'baemin', startDate: '2026-07-22', region: '북구',
      settlementId: 'bro_seoul_B', savedAt: '2026-07-26T08:00:00',
      selectedPromotionRuleNames: ['130건 천'],
      summary: { riderCount: 2, totalPromotionAmount: 12000 },
      results: [
        { matchedRiderId: 'd1', totalPromotionAmount: 5000, driverName: '김배민' },
        { matchedRiderId: 'd99', totalPromotionAmount: 7000, driverName: '없는기사' }
      ]
    }
  );

  Adj.state.settlementId = 'weekly_direct_baemin_seoul_20260722';
  Adj.state.erpSelected.clear();
  await Adj.refresh('baemin');
  const rowsEl = [...window.document.querySelectorAll('#directErpSavedRows tr')];
  check('ERP 저장본 4건 노출', rowsEl.length, 4);
  const staleRows = rowsEl.filter(tr => tr.classList.contains('direct-erp-stale-row'));
  check('이전 저장본 1건만 stale 표시', staleRows.length, 1);
  check('stale 인 것이 erpA_old', staleRows[0].querySelector('[data-erp-select]').dataset.erpSelect, 'erpA_old');

  console.log('\n[11] 전체선택은 이전 저장본을 건너뛴다');
  window.document.getElementById('directErpSelectAllBtn').click();
  check('최신 3건만 선택', Adj.state.erpSelected.size, 3);
  check('이전 저장본은 미선택', Adj.state.erpSelected.has('erpA_old'), 'false');

  console.log('\n[12] 적용 미리보기 경고');
  // 경고가 뜨는 상황에서는 confirm 을 거치므로 자동 승인해둔다.
  let confirmText = '';
  window.confirm = message => { confirmText = message; return true; };
  const preview = window.document.getElementById('directErpPreview');
  check('미리보기 노출', preview.hidden, 'false');
  check('여러 결과에 걸친 기사 경고', /여러 곳에 들어 있어/.test(preview.textContent), 'true');
  check('정산서에 없는 기사 경고', /이 정산서에 없어 제외됩니다/.test(preview.textContent), 'true');
  check('엑셀 덮어쓰기 경고', /엑셀로 넣은 금액/.test(preview.textContent), 'true');

  console.log('\n[13] 적용 결과 — 겹치는 기사는 합산, 없는 기사는 무시');
  window.document.getElementById('directErpApplyBtn').click();
  const applied13 = adjustments.promotion['weekly_direct_baemin_seoul_20260722'];
  // d1 = erpA_new 10,000 + erpB 5,000 (erpA_old 12,000 은 미선택)
  check('d1 = 15,000 (이중 합산 없음)', applied13.d1?.amount, 15000);
  check('d1 출처가 erp 로 갱신', applied13.d1?.source, 'erp');
  check('d2 = 70,000 유지 (erp1 도 함께 선택됨)', applied13.d2?.amount, 70000);
  check('정산서에 없는 d99 는 저장 안 함', applied13.d99, undefined);
  check('confirm 에 덮어쓰기 안내 포함', /엑셀로 넣은 금액/.test(confirmText), 'true');

  console.log('\n[14] 같은 선택으로 다시 눌러도 금액이 쌓이지 않는다');
  window.document.getElementById('directErpApplyBtn').click();
  window.document.getElementById('directErpApplyBtn').click();
  const applied14 = adjustments.promotion['weekly_direct_baemin_seoul_20260722'];
  check('d1 여전히 15,000', applied14.d1?.amount, 15000);
  check('d2 여전히 70,000', applied14.d2?.amount, 70000);

  console.log('\n[15] 이전 저장본까지 같이 고르면 경고');
  Adj.state.erpSelected.add('erpA_old');
  Adj.renderErpList?.();
  const preview15 = window.document.getElementById('directErpPreview').textContent;
  check('같은 정산서 2건 선택 경고', /같은 정산서에서 저장본을 2건 이상/.test(preview15), 'true');
  check('이전 저장본 포함 경고', /이전 저장본/.test(preview15), 'true');

  console.log('\n[16] 선택에서 빠진 이전 ERP 적용분은 빠진다고 알린다');
  Adj.state.erpSelected.clear();
  Adj.state.erpSelected.add('erpB');
  Adj.renderErpList?.();
  const preview16 = window.document.getElementById('directErpPreview').textContent;
  check('빠지는 ERP 안내', /이번 선택에 없어 빠집니다/.test(preview16), 'true');
  window.document.getElementById('directErpApplyBtn').click();
  const applied16 = adjustments.promotion['weekly_direct_baemin_seoul_20260722'];
  check('erpB 만 남아 d1 = 5,000', applied16.d1?.amount, 5000);
  check('선택 안 한 erp1 의 d2 는 제거', applied16.d2, undefined);

  console.log('\n[17] 정산주 선택 — 그 주 정산서만 남는다');
  Adj.state.week = '';
  await Adj.refresh('baemin');
  const weekBtn = window.document.getElementById('directAdjustWeekBtn');
  check('기본 정산주 = 최신 정산서 주', Adj.state.week, '2026-07-22');
  check('주 버튼에 날짜 표시', /2026/.test(weekBtn.textContent), 'true');
  check('그 주 정산서 1건만', window.document.getElementById('directAdjustSettlementSelect').options.length, 1);

  Adj.onWeekPicked('2026-07-15');
  check('7/15 주로 이동', Adj.state.week, '2026-07-15');
  check('7/15 주 정산서 1건', window.document.getElementById('directAdjustSettlementSelect').options.length, 1);
  check('선택된 정산서가 7/15 것', Adj.state.settlementId, 'weekly_direct_baemin_seoul_20260715');

  console.log('\n[18] 수요일이 아닌 날짜를 넣어도 수요일로 맞춘다');
  Adj.onWeekPicked('2026-07-24'); // 금요일 → 7/22(수) 주
  check('금요일 → 수요일 주로 보정', Adj.state.week, '2026-07-22');

  console.log('\n[19] 정산서 없는 주 · 전체 주');
  Adj.onWeekPicked('2026-01-07');
  const emptySelect = window.document.getElementById('directAdjustSettlementSelect');
  check('정산서 없음 표시', emptySelect.disabled, 'true');
  check('안내에 전체 건수', /전체 2건/.test(window.document.getElementById('directAdjustSettlementInfo').textContent), 'true');
  window.document.getElementById('directAdjustWeekAllBtn').click();
  check('전체 주로 해제', Adj.state.week, '');
  check('전체 주에서 2건 노출', window.document.getElementById('directAdjustSettlementSelect').options.length, 2);

  console.log('\n[20] 정산결과에도 같은 주 선택');
  Result.state.week = '';
  Result.state.settlementId = '';
  await Result.refresh('baemin');
  check('정산결과 기본 주', Result.state.week, '2026-07-22');
  check('그 주 정산서 1건', window.document.getElementById('settlementResultSettlementSelect').options.length, 1);
  Result.onWeekPicked('2026-07-15');
  await new Promise(resolve => setTimeout(resolve, 0));
  check('7/15 주로 이동', Result.state.week, '2026-07-15');
  const rows20 = window.document.querySelectorAll('#settlementResultRows tr');
  check('7/15 정산서 라이더 1명', rows20.length, 1);

  console.log('\n[21] 정산서별 등록 현황 — 어느 정산서에 등록됐는지 표기');
  Adj.state.week = '';
  Adj.state.settlementId = '';
  await Adj.refresh('baemin');
  Adj.onWeekPicked('2026-07-22');
  const regRows = [...window.document.querySelectorAll('#directRegistryBody tr')];
  check('등록 현황 카드 노출', window.document.getElementById('directRegistryCard').hidden, 'false');
  check('7/22 주 정산서 1장만', regRows.length, 1);
  check('지금 고른 정산서 표시', /선택됨/.test(regRows[0].textContent), 'true');
  check('헤더에 정산서 장수', /1장/.test(window.document.getElementById('directRegistryHead').textContent), 'true');

  window.document.getElementById('directAdjustWeekAllBtn').click();
  const regAll = [...window.document.querySelectorAll('#directRegistryBody tr')];
  check('전체 주에서 정산서 2장', regAll.length, 2);
  const row0715 = regAll.find(tr => tr.textContent.includes('999,999'));
  check('7/15 정산서 등록액이 그 행에 표기', Boolean(row0715), 'true');
  const pickBtn = regAll.map(tr => tr.querySelector('[data-direct-registry-pick]')).find(Boolean);
  pickBtn.click();
  check('「이 정산서 보기」로 전환', Adj.state.settlementId, 'weekly_direct_baemin_seoul_20260715');

  console.log('\n[22] 정산서 미지정(구 데이터) — 고른 주만 표시');
  store.promotion = {
    '2026-07-22': { d1: { amount: 11000, baeminId: 'BC000001', driverName: '김배민', source: 'excel' } },
    '2026-07-08': { d2: { amount: 22000, baeminId: 'BC000002', driverName: '이배민', source: 'excel' } }
  };
  Adj.onWeekPicked('2026-07-22');
  const legacyRows = [...window.document.querySelectorAll('#directLegacyBody tr')];
  check('고른 주 미지정 1건만', legacyRows.length, 1);
  check('그 주 금액 표시', /11,000/.test(legacyRows[0].textContent), 'true');
  check('다른 주 금액은 목록에 없음', /22,000/.test(legacyRows[0].textContent), 'false');
  const legacyNote = window.document.getElementById('directLegacyNote');
  check('다른 주 잔여 안내 노출', legacyNote.hidden, 'false');
  check('다른 주 합계 안내', /22,000/.test(legacyNote.textContent), 'true');
  check('옮길 대상 정산서 표기', /옮길 대상 정산서/.test(window.document.getElementById('directLegacyTarget').textContent), 'true');

  Adj.onWeekPicked('2026-07-15');
  check('미지정 없는 주 안내', Boolean(window.document.querySelector('#directLegacyBody .empty')), 'true');
  check('남은 2건 안내', /2건/.test(window.document.getElementById('directLegacyNote').textContent), 'true');

  window.document.getElementById('directAdjustWeekAllBtn').click();
  check('전체 주에서 미지정 2건', window.document.querySelectorAll('#directLegacyBody tr').length, 2);
  check('전체 주에서는 잔여 안내 없음', window.document.getElementById('directLegacyNote').hidden, 'true');

  console.log('\n[23] 미지정 → 고른 정산서로 이동');
  Adj.onWeekPicked('2026-07-22');
  window.document.querySelector('[data-direct-legacy-move]').click();
  check('선택한 정산서로 들어감', adjustments.promotion['weekly_direct_baemin_seoul_20260722']?.d1?.amount, 11000);
  check('이동한 주는 미지정에서 비워짐', Boolean(store.promotion['2026-07-22']), 'false');
  check('다른 주 미지정은 그대로', store.promotion['2026-07-08']?.d2?.amount, 22000);
  check('등록 현황에 반영', /11,000/.test(window.document.getElementById('directRegistryBody').textContent), 'true');

  // 적용 직후 「등록 현황」이 그대로 0장으로 남아 있으면, 실제로는 저장됐는데도
  // 아무것도 안 들어간 것처럼 보인다. 새로고침 없이 즉시 갱신돼야 한다.
  console.log('\n[24] 적용 직후 등록 현황이 새로고침 없이 갱신');
  const registryText = () => window.document.getElementById('directRegistryBody').textContent;
  const registryHeadText = () => window.document.getElementById('directRegistryHead').textContent;

  adjustments.promotion = {};
  adjustments.other = {};
  store.promotion = {};
  store.other = {};
  Adj.state.settlementId = 'weekly_direct_baemin_seoul_20260722';
  Adj.state.erpSelected.clear();
  await Adj.refresh('baemin');
  Adj.onWeekPicked('2026-07-22');
  check('시작 시 등록된 정산서 0장', /등록된 정산서 0장/.test(registryHeadText()), 'true');

  // 엑셀 일괄등록 → 적용하기
  Adj.state.pending.other = {
    rows: bulk.parseSheetRows([['BC000001', 33000]], DRIVERS, 'baemin').rows,
    issues: []
  };
  window.document.getElementById('directOtherBulkApplyBtn').click();
  check('엑셀 적용 후 등록 현황에 금액', /33,000/.test(registryText()), 'true');
  check('엑셀 적용 후 등록된 정산서 1장', /등록된 정산서 1장/.test(registryHeadText()), 'true');
  check('「미등록」 표시가 사라짐', /미등록/.test(registryText()), 'false');

  // ERP 적용
  const erpRow24 = [...window.document.querySelectorAll('#directErpSavedRows [data-erp-select]')]
    .find(el => el.dataset.erpSelect === 'erp1');
  check('ERP 저장본 노출', Boolean(erpRow24), 'true');
  erpRow24.checked = true;
  erpRow24.dispatchEvent(new window.Event('change', { bubbles: true }));
  window.document.getElementById('directErpApplyBtn').click();
  check('ERP 적용 후 등록 현황에 프로모션 금액', /70,000/.test(registryText()), 'true');

  // 삭제
  const removeBtn24 = window.document.querySelector('[data-direct-adj-remove="other"]');
  check('적용 목록에 삭제 버튼', Boolean(removeBtn24), 'true');
  removeBtn24.click();
  check('삭제 후 등록 현황에서 빠짐', /33,000/.test(registryText()), 'false');

  console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\n예외:', e.stack || e.message); process.exit(2); });
