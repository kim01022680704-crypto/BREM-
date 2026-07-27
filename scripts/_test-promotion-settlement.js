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

window.BremStorage = {
  drivers: {
    getAll: () => DRIVERS,
    getById: id => DRIVERS.find(d => d.id === id) || null
  },
  weeklySettlements: {
    getAll: channel => (channel === 'direct' ? SETTLEMENTS : [])
  },
  promotionApplyResults: {
    getAll: () => ([{
      id: 'erp1', platform: 'baemin', startDate: '2026-07-22', region: '서울',
      settlementLabel: '2026-07 4주', savedAt: '2026-07-26',
      selectedPromotionRuleNames: ['주말 프로모션'],
      summary: { riderCount: 1, totalPromotionAmount: 70000 },
      results: [{ matchedRiderId: 'd2', totalPromotionAmount: 70000, driverName: '이배민' }]
    }])
  },
  directPayAdjustments: {
    getBlob: kind => store[kind] || {},
    getWeek: (kind, wk) => (store[kind] || {})[wk] || {},
    clearWeek: (kind, wk) => { if (store[kind]) delete store[kind][wk]; }
  },
  directSettlementAdjustments: {
    getSettlement: (kind, id) => adjustments[kind][id] || {},
    applyEntries(kind, id, entries) {
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

window.BremDatePicker = {
  weekStartKey(v) {
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
    d.setDate(d.getDate() - ((d.getDay() - 3 + 7) % 7));
    return d.toISOString().slice(0, 10);
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
  check('배민 정산서 2건 노출', select.options.length, 2);
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
  check('정산결과 정산서 2건', resultSelect.options.length, 2);
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

  console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\n예외:', e.stack || e.message); process.exit(2); });
