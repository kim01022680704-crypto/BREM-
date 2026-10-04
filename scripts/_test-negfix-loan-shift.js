/**
 * 기타지급 일괄등록 · 마이너스 일괄맞추기가 선정산 / ERP 대여차감을 흔들지 않는지 (로컬 메모리, 실제 DB 안 건드림)
 *
 *  - 선정산·일정산수수료: 정산서·기사별로 전/후 같아야 한다 (합산 보기 · 부분 보기 둘 다)
 *  - 대여차감: 사람별 쿠팡·배민 배분이 같아야 한다
 *  - 맞춘 플랫폼은 정확히 0원, 나머지는 그대로
 *   node scripts/_test-negfix-loan-shift.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', runScripts: 'outside-only' });
const window = dom.window;
window.BREM_SUPABASE_CONFIG = { mode: 'development', backend: 'local' };
window.BremPerf = { time() {}, timeEnd() {} };
const ctx = vm.createContext(window);
const load = rel => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
try { load('js/platforms.js'); } catch (_) { /* optional */ }
load('js/data-cache.js');
load('js/storage.js');
load('js/direct-settlement-calc.js');

const S = window.BremStorage;
const Calc = window.BremDirectSettlementCalc;
// 주 전체 정산 주 / 배민 부분1·2 정산 주 (실제처럼 한 주에 섞지 않음)
const WEEKS = {
  full: { week: '2026-08-05', end: '2026-08-11' },
  part: { week: '2026-08-12', end: '2026-08-18', part1End: '2026-08-14', part2Start: '2026-08-15' }
};

let failed = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failed += 1;
  console.log(`${cond ? '  OK  ' : ' FAIL '} ${label}${detail ? `  ${detail}` : ''}`);
};

// settlement-result-direct.js grossUpForZero 와 같은 식
function grossUpForZero(row, taxRow = row) {
  const net = Math.round(Number(row.netPay || 0));
  if (net >= 0) return 0;
  const base = Math.round(Number(taxRow.promo || 0) + Number(taxRow.other || 0));
  const curTax = Math.floor(base * 0.033);
  const start = Math.max(0, Math.floor(-net / (1 - 0.033)) - 5);
  for (let x = start; x <= start + 200; x += 1) {
    if (net + x - (Math.floor((base + x) * 0.033) - curTax) >= 0) return x;
  }
  return Math.ceil(-net / (1 - 0.033));
}

function rider(id, platformKey, deliveryFee) {
  return {
    matchedRiderId: id,
    driverName: id,
    [platformKey]: `${id}-${platformKey}`,
    weeklyOrderCount: 10,
    amounts: { deliveryFee, missionPay: 0, employmentInsurance: 0, accidentInsurance: 0, hourlyInsurance: 0, withholdingTax: 0, deductionDetail: 0 }
  };
}

// baemin 이 배열이면 [부분1, 부분2] 금액
const CASES = [
  { name: '대여차감 없음 · 배민 선정산 마이너스', coupang: 30000, baemin: 100000, wd: [['baemin', '2026-08-06', 150000, 1500]], loan: 0 },
  { name: '대여 쿠팡에 붙음 · 배민 선정산 마이너스', coupang: 30000, baemin: 100000, wd: [['baemin', '2026-08-06', 150000, 1500]], loan: 30000 },
  { name: '대여가 한도 초과 · 쿠팡 마이너스', coupang: 30000, baemin: 100000, wd: [['baemin', '2026-08-09', 90000, 900]], loan: 60000 },
  { name: '양쪽 남은 한도 같음 · 대여 넘침', coupang: 50000, baemin: 50000, wd: [], loan: 140000 },
  { name: '두 플랫폼 다 마이너스 · 대여 있음', coupang: 40000, baemin: 60000, wd: [['coupang', '2026-08-06', 50000, 500], ['baemin', '2026-08-10', 70000, 700]], loan: 25000 },
  { name: '배민 한도 더 큼 · 대여 넘침', coupang: 20000, baemin: 80000, wd: [['coupang', '2026-08-05', 5000, 300]], loan: 150000 },
  { name: '배민 부분1·2 · 날짜별 선정산 · 대여 있음', coupang: 40000, baemin: [50000, 30000], wd: [['baemin', '2026-08-13', 70000, 700], ['baemin', '2026-08-16', 45000, 450], ['coupang', '2026-08-17', 10000, 300]], loan: 20000 },
  { name: '배민 부분1·2 · 부분1만 선정산 · 합치면 플러스(맞출 것 없음)', coupang: 0, baemin: [20000, 60000], wd: [['baemin', '2026-08-13', 50000, 500]], loan: 0, noNegative: true },
  { name: '배민 부분1·2 · 부분2 선정산 마이너스 · 대여 있음', coupang: 30000, baemin: [40000, 20000], wd: [['baemin', '2026-08-16', 90000, 900]], loan: 15000 }
];

(async () => {
  await S.initStorage({ backend: 'local' });
  const withdrawals = [];

  CASES.forEach((c, i) => {
    const id = `d${i}`;
    c.id = id;
    c.w = Array.isArray(c.baemin) ? WEEKS.part : WEEKS.full;
    const { week: WEEK, end: END } = c.w;
    c.sids = { coupang: [], baemin: [] };
    if (c.coupang) {
      const sid = `t${i}_coupang_${WEEK}`;
      c.sids.coupang.push(sid);
      S.weeklySettlements.save({ id: sid, platform: 'coupang', channel: 'direct', region: 'T', fileName: 'c.xlsx', startDate: WEEK, endDate: END, riders: [rider(id, 'coupangLoginKey', c.coupang)] });
    }
    const baeminParts = Array.isArray(c.baemin)
      ? [[WEEK, c.w.part1End, c.baemin[0], 1], [c.w.part2Start, END, c.baemin[1], 2]]
      : [[WEEK, END, c.baemin, 0]];
    baeminParts.forEach(([start, end, fee, slot]) => {
      const sid = `t${i}_baemin_${start}`;
      c.sids.baemin.push(sid);
      S.weeklySettlements.save({ id: sid, platform: 'baemin', channel: 'direct', region: 'T', fileName: 'b.xlsx', startDate: start, endDate: end, ...(slot ? { slot, partSlot: slot, partLabel: `부분${slot}` } : {}), riders: [rider(id, 'baeminUserId', fee)] });
    });
    if (c.loan) {
      S.deductionLedger.save({ id: `ledger-${id}`, kind: 'manual', driverId: id, driverName: id, balance: c.loan, finalApplyEnabled: true, deductStartDate: '2026-08-01', status: 'active' });
    }
    c.wd.forEach(([platform, date, amount, feeAmount], k) => {
      withdrawals.push({ id: `w-${id}-${k}`, driverId: id, platform, status: 'completed', amount, feeAmount, weekStart: WEEK, requestDate: date, createdAt: `${date}T03:00:00Z`, completedAt: `${date}T03:00:00Z`, date });
    });
  });

  const weekSettlements = ({ week, end }) => S.weeklySettlements.getAll('direct')
    .filter(s => String(s.startDate) >= week && String(s.startDate) <= end);
  const both = fn => {
    const parts = Object.values(WEEKS).map(fn);
    if (!Array.isArray(parts[0])) {
      return { rows: parts.flatMap(p => p.rows), split: new Map(parts.flatMap(p => [...p.split])) };
    }
    return parts.flat();
  };

  // 합산(주 전체) 보기 — computeCombinedRows / finalRows 와 같은 순서
  const computeCombined = () => both(computeCombinedWeek);
  const computePerPart = () => both(computePerPartWeek);
  function computeCombinedWeek(w) {
    const WEEK = w.week;
    const allWeek = weekSettlements(w).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    const dateRange = { start: WEEK, end: w.end };
    const allocation = Calc.allocateWeekWithdrawals(withdrawals, WEEK, Calc.buildWeekCapacityMap(allWeek), { dateRange, weekSettlements: allWeek, dailySettlements: [] });
    const spill = Calc.buildLeaseLoanSpilloverAllocation(allWeek, { week: WEEK, withdrawals, dateRange, dailySettlements: [], _allocation: allocation });
    // 계산기는 instanceof Map 으로 공유 잔액을 판별하므로 같은 realm 의 Map 이어야 한다
    const remain = new window.Map();
    const leaseConsumed = new window.Set();
    const loanConsumed = new window.Set();
    const rows = [];
    allWeek.forEach(settlement => {
      Calc.computeRows(settlement, {
        withdrawals, weekSettlements: allWeek, dateRange, dailySettlements: [],
        _allocation: allocation, _prepaidRemain: remain, _leaseLoanSpill: spill,
        _leaseConsumed: leaseConsumed, _loanConsumed: loanConsumed
      }).forEach(r => rows.push({ ...r, settlementId: settlement.id }));
    });
    const split = new Map();
    spill.loanAlloc.forEach((v, k) => split.set(`${WEEK}|${k}`, { coupang: Math.round(v.coupang || 0), baemin: Math.round(v.baemin || 0) }));
    return { rows, split };
  }

  // 부분 보기(정산서 한 장씩) — computeRows() 의 단일 정산서 경로
  function computePerPartWeek(w) {
    const allWeek = weekSettlements(w);
    const rows = [];
    allWeek.forEach(settlement => {
      const slotList = allWeek.filter(s => s.startDate === settlement.startDate && s.endDate === settlement.endDate);
      Calc.computeRows(settlement, {
        withdrawals, weekSettlements: allWeek, dailySettlements: [],
        dateRange: Calc.partDateRange?.(slotList) || { start: settlement.startDate, end: settlement.endDate }
      }).forEach(r => rows.push({ ...r, settlementId: settlement.id }));
    });
    return rows;
  }

  const prepaidSnapshot = rows => new Map(rows.map(r => [`${r.settlementId}|${r.driverId}`, `${r.prepaid}/${r.dailySettlementFee}`]));
  function samePrepaid(label, a, b) {
    const diffs = [...a.keys()].filter(k => a.get(k) !== b.get(k));
    check(label, diffs.length === 0 && a.size === b.size,
      diffs.length ? diffs.map(k => `${k} ${a.get(k)}→${b.get(k)}`).join(', ') : `${a.size}줄`);
  }

  // 같은 사람·플랫폼 부분들을 합친 순지급 (합산 보기 1줄)
  function mergedByPlatform(rows) {
    const map = new Map();
    rows.forEach(r => {
      const key = `${r.driverId}|${r.platform}`;
      const cur = map.get(key) || { driverId: r.driverId, platform: r.platform, netPay: 0, promo: 0, other: 0, prepaid: 0, loanFee: 0, parts: [] };
      cur.netPay += r.netPay; cur.promo += r.promo || 0; cur.other += r.other || 0;
      cur.prepaid += r.prepaid || 0; cur.loanFee += r.loanFee || 0;
      cur.parts.push(r);
      map.set(key, cur);
    });
    return map;
  }

  const base = computeCombined();
  const basePart = computePerPart();
  const prepaid0 = prepaidSnapshot(base.rows);
  const prepaidPart0 = prepaidSnapshot(basePart);
  const sumPrepaid = rows => rows.reduce((s, r) => s + (r.prepaid || 0), 0);
  const sumWd = withdrawals.reduce((s, w) => s + w.amount, 0);

  console.log('\n[0] 기준 상태');
  check('출금 전액이 선정산으로 붙음 (합산 보기)', sumPrepaid(base.rows) === sumWd, `${sumPrepaid(base.rows)} / 출금 ${sumWd}`);
  check('출금 전액이 선정산으로 붙음 (부분 보기)', sumPrepaid(basePart) === sumWd, `${sumPrepaid(basePart)} / 출금 ${sumWd}`);

  // 1) 프로모션정산등록 기타지급 일괄등록: 쿠팡 정산서마다 1인 7,000원
  console.log('\n[1] 기타지급 일괄등록 뒤');
  CASES.forEach(c => c.sids.coupang.forEach(sid => {
    S.directSettlementAdjustments.applyEntries('other', sid, [{ driverId: c.id, amount: 7000 }], { add: true });
  }));
  const afterBulk = computeCombined();
  samePrepaid('선정산·일정산수수료 정산서별 그대로 (합산 보기)', prepaid0, prepaidSnapshot(afterBulk.rows));
  samePrepaid('선정산·일정산수수료 정산서별 그대로 (부분 보기)', prepaidPart0, prepaidSnapshot(computePerPart()));

  // 2) 마이너스 일괄맞추기: 사람·플랫폼 합산 순지급 기준, 마지막 부분에 얹음
  const beforeFix = afterBulk;
  const mergedBefore = mergedByPlatform(beforeFix.rows);
  mergedBefore.forEach(m => {
    const x = grossUpForZero(m, m);
    if (!x) return;
    const target = m.parts[m.parts.length - 1];
    S.directSettlementAdjustments.applyEntries('other', target.settlementId, [{ driverId: m.driverId, amount: x }], { add: true });
  });
  const afterFix = computeCombined();
  const mergedAfter = mergedByPlatform(afterFix.rows);

  console.log('\n[2] 마이너스 일괄맞추기 뒤 (전체)');
  samePrepaid('선정산·일정산수수료 정산서별 그대로 (합산 보기)', prepaid0, prepaidSnapshot(afterFix.rows));
  samePrepaid('선정산·일정산수수료 정산서별 그대로 (부분 보기)', prepaidPart0, prepaidSnapshot(computePerPart()));

  CASES.forEach(c => {
    console.log(`\n[${c.name}]`);
    ['coupang', 'baemin'].forEach(p => {
      const b = mergedBefore.get(`${c.id}|${p}`);
      const a = mergedAfter.get(`${c.id}|${p}`);
      if (!b) return;
      const parts = a.parts.map(r => `${r.settlementId.split('_').pop()} 선정산 ${r.prepaid}`).join(', ');
      console.log(`    ${p === 'coupang' ? '쿠팡' : '배민'}: 선정산 ${b.prepaid}→${a.prepaid} 대여 ${b.loanFee}→${a.loanFee} 기타 ${b.other}→${a.other} 총지급 ${b.netPay}→${a.netPay}  (${parts})`);
    });
    const key = `${c.w.week}|${Calc.canonicalDriverKey(c.id)}`;
    const lb = beforeFix.split.get(key) || { coupang: 0, baemin: 0 };
    const la = afterFix.split.get(key) || { coupang: 0, baemin: 0 };
    const mine = [...mergedBefore.values()].filter(m => m.driverId === c.id);
    if (c.noNegative) {
      check('마이너스 없음 → 기타지급 안 붙음', mine.every(m => m.netPay >= 0 && mergedAfter.get(`${m.driverId}|${m.platform}`).other === m.other));
    } else {
      check('맞추기 전 마이너스 있음', mine.some(m => m.netPay < 0));
    }
    check('대여차감 쿠팡·배민 배분 그대로', lb.coupang === la.coupang && lb.baemin === la.baemin, `쿠팡 ${lb.coupang}→${la.coupang} · 배민 ${lb.baemin}→${la.baemin}`);
    check('마이너스였던 플랫폼은 정확히 0원', mine.filter(m => m.netPay < 0).every(m => mergedAfter.get(`${m.driverId}|${m.platform}`).netPay === 0));
    check('마이너스 아니던 플랫폼은 그대로', mine.filter(m => m.netPay >= 0).every(m => mergedAfter.get(`${m.driverId}|${m.platform}`).netPay === m.netPay));
  });

  console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과');
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(2); });
