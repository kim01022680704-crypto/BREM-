/**
 * 프로모션정산등록 화면 미리보기 페이지를 만든다 (로컬 전용, 서버·Supabase 접속 없음).
 * admin.html 의 실제 섹션 마크업과 실제 모듈을 그대로 쓰고, 저장소만 가짜로 끼운다.
 *
 *   node scripts/_preview-promotion-settlement.js
 *   → _preview-promotion-settlement.html 을 브라우저로 열면 된다.
 */
const fs = require('fs');
const path = require('path');

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

// 화면을 바로 보이게 active 를 붙인다. admin.css 는 .section 을 기본 숨김 처리한다.
const section = extractSection('promotion-settlement')
  .replace('<section class="section" id="promotion-settlement">', '<section class="section active" id="promotion-settlement">');

const stub = `
// --- 가짜 저장소 (미리보기용) ---------------------------------------------
const DRIVERS = [
  { id: 'd1', name: '김배민', baeminId: 'BC000001', coupangId: '' },
  { id: 'd2', name: '이배민', baeminId: 'BC000002', coupangId: '' },
  { id: 'd3', name: '박배민', baeminId: 'BC000003', coupangId: '' },
  { id: 'd4', name: '최배민', baeminId: 'BC000004', coupangId: '' },
  { id: 'd5', name: '정배민', baeminId: 'BC000005', coupangId: '' },
  { id: 'd9', name: '박쿠팡', baeminId: '', coupangId: 'CP000009' }
];

function rider(id, baeminId, orders, deliveryFee) {
  return { matchedRiderId: id, baeminUserId: baeminId, weeklyOrderCount: orders, amounts: { deliveryFee } };
}

// 같은 주(7/22)에 정산서를 두 장 올린 상황을 일부러 만들어 둔다.
// 「정산서별 등록 현황」이 필요한 이유가 바로 이 경우다.
const SETTLEMENTS = [
  {
    id: 'weekly_direct_baemin_seoul_20260722', platform: 'baemin', channel: 'direct', region: '서울',
    fileName: '을지_협력사_서울_0722.xlsx', startDate: '2026-07-22', endDate: '2026-07-28',
    riders: [rider('d1','BC000001',120,1200000), rider('d2','BC000002',95,950000), rider('d3','BC000003',80,800000)]
  },
  {
    id: 'weekly_direct_baemin_yangsan_20260722', platform: 'baemin', channel: 'direct', region: '양산',
    fileName: '을지_협력사_양산_0722.xlsx', startDate: '2026-07-22', endDate: '2026-07-28',
    riders: [rider('d4','BC000004',60,600000), rider('d5','BC000005',45,450000)]
  },
  {
    id: 'weekly_direct_baemin_seoul_20260715', platform: 'baemin', channel: 'direct', region: '서울',
    fileName: '을지_협력사_서울_0715.xlsx', startDate: '2026-07-15', endDate: '2026-07-21',
    riders: [rider('d1','BC000001',110,1100000), rider('d2','BC000002',70,700000)]
  },
  {
    id: 'weekly_direct_coupang_seoul_20260722', platform: 'coupang', channel: 'direct', region: '서울',
    fileName: '쿠팡_직계약_0722.xlsx', startDate: '2026-07-22', endDate: '2026-07-28',
    riders: [{ matchedRiderId: 'd9', coupangLoginKey: 'CP000009', weeklyOrderCount: 30, amounts: { deliveryFee: 300000 } }]
  }
];

const ERP_RESULTS = [
  {
    id: 'erp_seoul_new', platform: 'baemin', startDate: '2026-07-22', region: '서울',
    settlementId: 'bro_seoul', settlementLabel: '2026-07 4주 서울', savedAt: '2026-07-28T15:20:00',
    selectedPromotionRuleNames: ['140건 천', '주말 프로모션'],
    summary: { riderCount: 2, totalPromotionAmount: 180000 },
    results: [
      { matchedRiderId: 'd1', totalPromotionAmount: 100000, driverName: '김배민' },
      { matchedRiderId: 'd2', totalPromotionAmount: 80000, driverName: '이배민' }
    ]
  },
  {
    id: 'erp_seoul_old', platform: 'baemin', startDate: '2026-07-22', region: '서울',
    settlementId: 'bro_seoul', settlementLabel: '2026-07 4주 서울', savedAt: '2026-07-27T09:10:00',
    selectedPromotionRuleNames: ['130건 천'],
    summary: { riderCount: 2, totalPromotionAmount: 150000 },
    results: [
      { matchedRiderId: 'd1', totalPromotionAmount: 90000, driverName: '김배민' },
      { matchedRiderId: 'd2', totalPromotionAmount: 60000, driverName: '이배민' }
    ]
  },
  {
    id: 'erp_yangsan', platform: 'baemin', startDate: '2026-07-22', region: '양산',
    settlementId: 'bro_yangsan', settlementLabel: '2026-07 4주 양산', savedAt: '2026-07-28T14:00:00',
    selectedPromotionRuleNames: ['140건 천'],
    summary: { riderCount: 1, totalPromotionAmount: 45000 },
    results: [{ matchedRiderId: 'd4', totalPromotionAmount: 45000, driverName: '최배민' }]
  }
];

// 정산서 선택 기능이 생기기 전 주차 기준으로 쌓인 구 데이터.
const store = {
  promotion: {
    '2026-07-22': {
      d3: { amount: 33000, baeminId: 'BC000003', driverName: '박배민', source: 'excel' }
    },
    '2026-07-08': {
      d1: { amount: 1500000, baeminId: 'BC000001', driverName: '김배민', source: 'excel' },
      d2: { amount: 3524400, baeminId: 'BC000002', driverName: '이배민', source: 'excel' }
    },
    '2026-07-01': {
      d4: { amount: 823130, baeminId: 'BC000004', driverName: '최배민', source: 'excel' }
    }
  },
  other: {
    '2026-07-08': {
      d5: { amount: 120000, baeminId: 'BC000005', driverName: '정배민', source: 'excel' }
    }
  }
};

const adjustments = { other: {}, promotion: {} };

window.BremStorage = {
  drivers: { getAll: () => DRIVERS, getById: id => DRIVERS.find(d => d.id === id) || null },
  weeklySettlements: { getAll: channel => (channel === 'direct' ? SETTLEMENTS : []) },
  promotionApplyResults: { getAll: () => ERP_RESULTS },
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

window.BremDatePicker = {
  weekStartKey(v) {
    const d = new Date(String(v).slice(0, 10) + 'T00:00:00');
    d.setDate(d.getDate() - ((d.getDay() - 3 + 7) % 7));
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  },
  // 미리보기에서는 달력 팝업 대신 프롬프트로 대체한다.
  setupWednesdayWeekDelegated() {}
};

// 토스트를 화면에 간단히 띄운다.
document.addEventListener('brem-admin-toast', event => {
  const box = document.getElementById('previewToast');
  if (!box) return;
  box.textContent = event.detail?.message || '';
  box.hidden = false;
  clearTimeout(box._t);
  box._t = setTimeout(() => { box.hidden = true; }, 4000);
});
`;

const boot = `
(async () => {
  // 서울 정산서에 미리 등록된 금액을 넣어 «등록 현황»에 값이 보이게 한다.
  const seoul = 'weekly_direct_baemin_seoul_20260722';
  window.BremStorage.directSettlementAdjustments.applyEntries('promotion', seoul, [
    { driverId: 'd1', amount: 100000, baeminId: 'BC000001', driverName: '김배민', source: 'erp' },
    { driverId: 'd2', amount: 80000, baeminId: 'BC000002', driverName: '이배민', source: 'erp' }
  ]);
  window.BremStorage.directSettlementAdjustments.applyEntries('other', seoul, [
    { driverId: 'd1', amount: 20000, baeminId: 'BC000001', driverName: '김배민', source: 'excel' },
    { driverId: 'd3', amount: 35000, baeminId: 'BC000003', driverName: '박배민', source: 'excel' }
  ]);

  const Adj = window.BremDirectAdjustmentAdmin;
  Adj.init();
  await Adj.refresh('baemin');

  document.getElementById('previewPlatform').addEventListener('change', async e => {
    await Adj.refresh(e.target.value);
  });
  document.getElementById('previewWeek').addEventListener('change', e => {
    if (e.target.value) Adj.onWeekPicked(e.target.value);
  });
})();
`;

const out = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>미리보기 · 프로모션정산등록</title>
<link rel="stylesheet" href="css/admin.css">
<style>
  body { padding: 20px 24px 80px; }
  .preview-bar {
    position: sticky; top: 0; z-index: 50; display: flex; gap: 14px; align-items: center;
    flex-wrap: wrap; padding: 12px 16px; margin-bottom: 18px; border-radius: 12px;
    background: #1d2440; border: 1px solid #34c77b;
  }
  .preview-bar strong { color: #34c77b; }
  .preview-bar label { display: flex; gap: 6px; align-items: center; font-size: 13px; }
  .preview-bar select { padding: 6px 10px; }
  #previewToast {
    position: fixed; right: 24px; bottom: 24px; z-index: 200; padding: 12px 18px;
    border-radius: 10px; background: #34c77b; color: #08130c; font-weight: 700;
  }
</style>
</head>
<body>
<div class="preview-bar">
  <strong>미리보기 (가짜 데이터)</strong>
  <label>플랫폼
    <select id="previewPlatform">
      <option value="baemin">배민</option>
      <option value="coupang">쿠팡</option>
    </select>
  </label>
  <label>정산주 바로가기
    <select id="previewWeek">
      <option value="">(선택)</option>
      <option value="2026-07-22">2026-07-22(수) · 정산서 2장</option>
      <option value="2026-07-15">2026-07-15(수) · 정산서 1장</option>
      <option value="2026-07-08">2026-07-08(수) · 정산서 없음 / 미지정 있음</option>
    </select>
  </label>
  <span>달력 버튼은 실제 페이지에서만 열립니다. 여기서는 &lt;&lt; &gt;&gt; 와 위 드롭다운으로 주를 옮기세요.</span>
</div>

${section}

<div id="previewToast" hidden></div>

<script>${stub}</script>
<script src="js/direct-adjustment-bulk.js"></script>
<script src="js/direct-adjustment-admin.js"></script>
<script>
  window.BremDirectAdjustmentAdmin = BremDirectAdjustmentAdmin;
</script>
<script>${boot}</script>
</body>
</html>
`;

const target = path.join(root, '_preview-promotion-settlement.html');
fs.writeFileSync(target, out, 'utf8');
console.log(`미리보기 생성 완료: ${target}`);
