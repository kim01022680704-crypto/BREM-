/**
 * BREM smoke QA — Node (storage/auth/revenue logic)
 * Run: node scripts/qa-check.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createStorage() {
  const store = {};
  const localStorage = {
    get length() { return Object.keys(store).length; },
    key(i) { return Object.keys(store)[i] ?? null; },
    getItem(k) { return store[k] ?? null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { Object.keys(store).forEach(k => delete store[k]); }
  };
  const sessionStorage = { ...localStorage, _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } };

  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8');
  const context = {
    window: { localStorage, sessionStorage, XLSX: null },
    localStorage,
    sessionStorage,
    document: { dispatchEvent() {} },
    console
  };
  vm.runInNewContext(code, context);
  return { BremStorage: context.BremStorage, localStorage, sessionStorage };
}

const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
}

function assert(name, condition, detail) {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

const { BremStorage, localStorage } = createStorage();
const weekStart = '2026-06-17'; // Wednesday

// 1. Admin login
BremStorage.auth.clearAdminSession?.();
const badLogin = BremStorage.auth.verifyAdminLogin('관리자', 'wrong');
assert('관리자 로그인 — 잘못된 비밀번호 거부', badLogin.ok === false);

const goodLogin = BremStorage.auth.verifyAdminLogin('관리자', '1234');
assert('관리자 로그인 — 기본 계정', goodLogin.ok === true, '관리자 / 1234');

if (goodLogin.ok) BremStorage.auth.setAdminSession(goodLogin.account.id);
const session = BremStorage.auth.getAdminSessionAccount();
assert('관리자 로그인 — 세션 유지', !!session?.name, session?.name);

// 2. Driver CRUD
const driver = BremStorage.drivers.create({
  name: 'QA테스트기사',
  phone: '010-9999-0001',
  password: '1234',
  platformCoupang: true,
  platformBaemin: false
});
assert('기사 등록', !!driver?.id, driver?.id);

const updated = BremStorage.drivers.update(driver.id, { phone: '010-9999-0002' });
assert('기사 수정', updated?.phone === '010-9999-0002', updated?.phone);

BremStorage.drivers.remove(driver.id);
const gone = BremStorage.drivers.getAll().find(d => d.id === driver.id);
assert('기사 삭제', !gone);

// 3. Baemin income calculation
const baemin = BremStorage.revenue.saveIncomeBaemin({
  weekStart,
  region: '울산남배',
  riderPayment: 1000000,
  paymentFeePercent: 3,
  mgmtFee: 500000,
  promotion: 100000,
  callCount: 100,
  callFeePerCall: 50,
  expenseEmployment: 100000,
  expenseIndustrial: 50000,
  vatReserve: 20000,
  expensePromotion: 30000
});
const baeminExpectedFee = Math.round(1000000 * 3 / 100);
const baeminExpectedCall = 100 * 50;
const baeminExpectedRev = baeminExpectedFee + 500000 + 100000 + baeminExpectedCall;
const baeminExpectedExp = 100000 + 50000 + 20000 + 30000;
const baeminExpectedNet = baeminExpectedRev - baeminExpectedExp;
assert(
  '배민 정산 계산',
  baemin.paymentFeeAmount === baeminExpectedFee
    && baemin.callFeeTotal === baeminExpectedCall
    && baemin.totalRevenue === baeminExpectedRev
    && baemin.totalExpense === baeminExpectedExp
    && baemin.netProfit === baeminExpectedNet,
  `순익 ${baemin.netProfit} (기대 ${baeminExpectedNet})`
);

// 4. Coupang income + deficit compensation saved as reference only
const coupang = BremStorage.revenue.saveIncomeCoupang({
  weekStart,
  region: '울산쿠팡',
  riderPayment: 2000000,
  paymentFeePercent: 3,
  mgmtFee: 300000,
  promotion: 0,
  callCount: 200,
  callFeePerCall: 100,
  expenseEmployment: 80000,
  expenseIndustrial: 40000,
  vatReserve: 10000,
  expensePromotion: 0,
  deficitCompensation: 50000
});
const coupangRev = Math.round(2000000 * 3 / 100) + 300000 + 200 * 100;
const coupangExp = 80000 + 40000 + 10000;
const coupangNet = coupangRev - coupangExp;
assert(
  '쿠팡 정산 계산 (결손보전 순익 제외)',
  coupang.totalRevenue === coupangRev && coupang.netProfit === coupangNet && coupang.deficitCompensation === 50000,
  `순익 ${coupang.netProfit} (기대 ${coupangNet})`
);

// 5. Bropay
const bropay = BremStorage.revenue.saveBropay({
  weekStart,
  withdrawalDate: '2026-06-18',
  name: 'QA',
  branch: '울산',
  amount: 150000,
  reason: '테스트'
});
assert('브로페이 입출금 저장', bropay.amount === 150000 && bropay.weekStart === weekStart);

// 6. Office expense
const office = BremStorage.revenue.saveOfficeExpense({
  monthKey: '2026-06',
  category: 'variable',
  writtenDate: '2026-06-01',
  spender: '관리자',
  name: '사무용품',
  paidAmount: 50000,
  paidDate: '2026-06-02',
  finalAmount: 50000
});
assert('사무실 지출 저장', office.finalAmount === 50000 && office.monthKey === '2026-06');

// 7. Weekly final settlement aggregation
const agg = BremStorage.revenue.aggregateWeekSettlement(weekStart);
assert(
  '주간 손익 자동 집계',
  agg.combined.totalRevenue === baemin.totalRevenue + coupang.totalRevenue
    && agg.combined.netProfit === baemin.netProfit + coupang.netProfit
    && agg.baemin.count === 1
    && agg.coupang.count === 1,
  `순익 ${agg.combined.netProfit}, 브로페이 ${agg.bropayTotal}`
);

const savedFinal = BremStorage.revenue.saveFinalSettlement(weekStart, 'QA');
assert('주간 정산 저장', savedFinal.snapshot.combined.totalRevenue === agg.combined.totalRevenue);

// 8. Persistence (simulate refresh)
const raw = localStorage.getItem('brem_admin_revenue');
const { BremStorage: BremStorage2 } = createStorage();
localStorage.setItem('brem_admin_revenue', raw);
const reloaded = BremStorage2.revenue.listIncomeBaemin(weekStart);
assert('새로고침 후 데이터 유지', reloaded.length === 1 && reloaded[0].region === '울산남배');

// 9. Supabase config status
const config = BremStorage.getSupabaseConfig?.() || {};
assert(
  'Supabase 설정 상태',
  true,
  config.url ? 'url 설정됨 — 브라우저/대시보드에서 연동 테스트 필요' : 'url 미설정 — localStorage 모드 (정상)'
);

const failed = results.filter(r => !r.ok);
console.log('\n---');
console.log(`총 ${results.length}项, 성공 ${results.length - failed.length}, 실패 ${failed.length}`);
process.exit(failed.length ? 1 : 0);
