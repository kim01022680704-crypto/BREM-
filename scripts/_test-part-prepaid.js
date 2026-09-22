const fs = require('fs');
const path = require('path');

function addDays(key, days) {
  const date = new Date(`${key}T00:00:00`);
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function weekStartKey(dateValue) {
  const date = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
  const diff = (date.getDay() - 3 + 7) % 7;
  date.setDate(date.getDate() - diff);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function applyWeekWednesday(dateValue) {
  const date = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
  const day = date.getDay();
  if (day === 3) return String(dateValue).slice(0, 10);
  if (day === 2) return addDays(String(dateValue).slice(0, 10), 1);
  return weekStartKey(dateValue);
}

const daily = [];
const window = {
  BremDatePicker: { weekStartKey, applyWeekWednesday },
  BremStorage: {
    settlements: { getAll: () => daily },
    drivers: { getById: () => null },
    payrollDailySettlement: {
      getFees: () => ({}),
      resolveDailySettlementFee: () => 0,
      getWithdrawalHolds: () => []
    }
  }
};

const code = fs.readFileSync(path.join(__dirname, '../js/direct-settlement-calc.js'), 'utf8');
const fn = new Function('window', `${code}\nreturn window.BremDirectSettlementCalc;`);
const Calc = fn(window);

const week = '2026-09-16';
const part1 = { startDate: '2026-09-16', endDate: '2026-09-20', platform: 'baemin' };
const part2 = { startDate: '2026-09-21', endDate: '2026-09-22', platform: 'baemin' };

daily.splice(0, daily.length,
  { driverId: 'd1', platform: 'baemin', period: '2026-09-16', settlementAmount: 200000 },
  { driverId: 'd1', platform: 'baemin', period: '2026-09-17', settlementAmount: 200000 },
  { driverId: 'd1', platform: 'baemin', period: '2026-09-18', settlementAmount: 200000 },
  { driverId: 'd1', platform: 'baemin', period: '2026-09-19', settlementAmount: 100000 },
  { driverId: 'd1', platform: 'baemin', period: '2026-09-20', settlementAmount: 100000 },
  { driverId: 'd1', platform: 'baemin', period: '2026-09-21', settlementAmount: 100000 },
  { driverId: 'd1', platform: 'baemin', period: '2026-09-22', settlementAmount: 100000 }
);

const wd = [{
  driverId: 'd1',
  platform: 'baemin',
  amount: 1000000,
  status: 'completed',
  weekStart: week,
  requestDate: '2026-09-22',
  createdAt: '2026-09-22T10:00:00'
}];

const scoped1 = Calc.scopeWithdrawalsToDateRange(wd, { start: '2026-09-16', end: '2026-09-20' }, { week });
const scoped2 = Calc.scopeWithdrawalsToDateRange(wd, { start: '2026-09-21', end: '2026-09-22' }, { week });

daily.splice(0, daily.length);
const fallbackIn = Calc.scopeWithdrawalsToDateRange([{
  ...wd[0],
  amount: 500000,
  requestDate: '2026-09-17',
  createdAt: '2026-09-17T09:00:00'
}], { start: '2026-09-16', end: '2026-09-20' }, { week });
const fallbackOut = Calc.scopeWithdrawalsToDateRange([{
  ...wd[0],
  amount: 300000,
  requestDate: '2026-09-22',
  createdAt: '2026-09-22T09:00:00'
}], { start: '2026-09-16', end: '2026-09-20' }, { week });

const checks = [
  ['week of 16-20', Calc.settlementWeek(part1) === week],
  ['match 16-20 on 9/16 week', Calc.recordMatchesWeek(part1, week) === true],
  ['no match 16-20 on 9/23 week', Calc.recordMatchesWeek(part1, '2026-09-23') === false],
  ['match 21-22 on 9/16 week', Calc.recordMatchesWeek(part2, week) === true],
  ['prev week 9/9-15 not on 9/16', Calc.recordMatchesWeek({ startDate: '2026-09-09', endDate: '2026-09-15' }, week) === false],
  ['part1 range', Calc.partDateRange([part1]).start === '2026-09-16' && Calc.partDateRange([part1]).end === '2026-09-20'],
  ['FIFO 부분1 800000', scoped1.length === 1 && scoped1[0].amount === 800000],
  ['FIFO 부분2 200000', scoped2.length === 1 && scoped2[0].amount === 200000],
  ['fallback request-1 in range', fallbackIn.length === 1 && fallbackIn[0].amount === 500000],
  ['fallback 21일 일정산은 부분1 제외', fallbackOut.length === 0]
];

const cap = new Map([['id:d1', { coupang: 0, baemin: 300000 }]]);
const coupangWd = [{
  driverId: 'd1',
  platform: 'coupang',
  amount: 500000,
  feeAmount: 10000,
  status: 'completed',
  weekStart: week,
  requestDate: '2026-09-18',
  createdAt: '2026-09-18T10:00:00'
}];
const baeminWd = [{
  driverId: 'd1',
  platform: 'baemin',
  amount: 200000,
  feeAmount: 4000,
  status: 'completed',
  weekStart: week,
  requestDate: '2026-09-18',
  createdAt: '2026-09-18T10:00:00'
}];
const baeminOnly = [{ platform: 'baemin', riders: [{ matchedRiderId: 'd1' }] }];
const bothFiles = [
  { platform: 'baemin', riders: [{ matchedRiderId: 'd1' }] },
  { platform: 'coupang', riders: [{ matchedRiderId: 'd1' }] }
];
const allocCoupang = Calc.allocateWeekWithdrawals(coupangWd, week, cap, {
  dateRange: { start: '2026-09-16', end: '2026-09-20' },
  dailySettlements: [],
  weekSettlements: baeminOnly
});
const allocBaemin = Calc.allocateWeekWithdrawals(baeminWd, week, cap, {
  dateRange: { start: '2026-09-16', end: '2026-09-20' },
  dailySettlements: [],
  weekSettlements: baeminOnly
});
const bothCap = new Map([['id:d1', { coupang: 100000, baemin: 400000 }]]);
const allocLoss = Calc.allocateWeekWithdrawals(coupangWd, week, bothCap, {
  dateRange: { start: '2026-09-16', end: '2026-09-20' },
  dailySettlements: [],
  weekSettlements: bothFiles
});
const bothOverCap = new Map([['id:d1', { coupang: 100000, baemin: 100000 }]]);
const bothOverWd = coupangWd.concat(baeminWd);
const allocBothOver = Calc.allocateWeekWithdrawals(bothOverWd, week, bothOverCap, {
  dateRange: { start: '2026-09-16', end: '2026-09-20' },
  dailySettlements: [],
  weekSettlements: bothFiles
});
function usedSliceLike(part) {
  return Math.max(0, Math.round(Number(part?.prepaid || 0))) + Math.max(0, Math.round(Number(part?.fee || 0)));
}
const sliceC = allocCoupang.get('id:d1') || { coupang: { prepaid: 0, fee: 0 }, baemin: { prepaid: 0, fee: 0 } };
const sliceB = allocBaemin.get('id:d1') || { coupang: { prepaid: 0, fee: 0 }, baemin: { prepaid: 0, fee: 0 } };
const sliceL = allocLoss.get('id:d1') || { coupang: { prepaid: 0, fee: 0 }, baemin: { prepaid: 0, fee: 0 } };
const sliceO = allocBothOver.get('id:d1') || { coupang: { prepaid: 0, fee: 0 }, baemin: { prepaid: 0, fee: 0 } };
checks.push(
  ['쿠팡파일 없으면 쿠팡출금은 배민에 안 넘김', sliceC.baemin.prepaid === 0 && sliceC.baemin.fee === 0],
  ['넘길 곳 없으면 한도 초과는 안 붙임', sliceC.coupang.prepaid === 0 && sliceC.coupang.fee === 0],
  ['배민 출금은 배민 한도 안에서', sliceB.baemin.prepaid === 200000 && sliceB.baemin.fee === 4000],
  ['배민 출금은 쿠팡에 안 붙음', sliceB.coupang.prepaid === 0 && sliceB.coupang.fee === 0],
  ['한쪽만 로스면 여유 있는 쪽으로만', sliceL.coupang.prepaid + sliceL.coupang.fee === 100000
    && sliceL.baemin.prepaid === 400000 && sliceL.baemin.fee === 0],
  ['공동 양쪽 로스면 한도까지만', usedSliceLike(sliceO.coupang) === 100000
    && usedSliceLike(sliceO.baemin) === 100000]
);

const baeminPart = {
  id: 'weekly_direct_baemin_p1',
  platform: 'baemin',
  startDate: '2026-09-16',
  endDate: '2026-09-20',
  riders: [{ matchedRiderId: 'd1', amounts: { deliveryFee: 200000 }, weeklyOrderCount: 0 }]
};
const coupangFull = {
  id: 'weekly_direct_coupang_full',
  platform: 'coupang',
  startDate: '2026-09-16',
  endDate: '2026-09-22',
  riders: [{ matchedRiderId: 'd1', amounts: { deliveryFee: 500000 }, weeklyOrderCount: 0 }]
};
const jointWd = [{
  driverId: 'd1',
  platform: 'baemin',
  amount: 300000,
  feeAmount: 6000,
  status: 'completed',
  weekStart: week,
  requestDate: '2026-09-18',
  createdAt: '2026-09-18T10:00:00'
}];
const rowsB = Calc.computeRows(baeminPart, {
  withdrawals: jointWd,
  weekSettlements: [baeminPart, coupangFull],
  dateRange: { start: '2026-09-16', end: '2026-09-20' },
  dailySettlements: []
});
const rowsC = Calc.computeRows(coupangFull, {
  withdrawals: jointWd,
  weekSettlements: [baeminPart, coupangFull],
  dateRange: { start: '2026-09-16', end: '2026-09-20' },
  dailySettlements: []
});
const overB = {
  ...baeminPart,
  id: 'weekly_direct_baemin_over',
  riders: [{ matchedRiderId: 'd1', amounts: { deliveryFee: 100000 }, weeklyOrderCount: 0 }]
};
const overC = {
  ...coupangFull,
  id: 'weekly_direct_coupang_over',
  riders: [{ matchedRiderId: 'd1', amounts: { deliveryFee: 100000 }, weeklyOrderCount: 0 }]
};
const rowsOverB = Calc.computeRows(overB, {
  withdrawals: bothOverWd,
  weekSettlements: [overB, overC],
  dateRange: { start: '2026-09-16', end: '2026-09-20' },
  dailySettlements: []
});
const rowsOverC = Calc.computeRows(overC, {
  withdrawals: bothOverWd,
  weekSettlements: [overB, overC],
  dateRange: { start: '2026-09-16', end: '2026-09-20' },
  dailySettlements: []
});
checks.push(
  ['공동 배민 로스는 쿠팡 여유로', Number(rowsB[0]?.prepaid || 0) + Number(rowsB[0]?.dailySettlementFee || 0) === 200000
    && Number(rowsC[0]?.prepaid || 0) + Number(rowsC[0]?.dailySettlementFee || 0) === 106000],
  ['넘기지 못한 로스는 행에 안 붙임', Number(rowsOverC[0]?.prepaid || 0) + Number(rowsOverC[0]?.dailySettlementFee || 0) === 100000
    && Number(rowsOverB[0]?.prepaid || 0) + Number(rowsOverB[0]?.dailySettlementFee || 0) === 100000
    && Number(rowsOverC[0]?.netPay || 0) >= 0
    && Number(rowsOverB[0]?.netPay || 0) >= 0]
);

const failed = checks.filter(item => !item[1]);
if (failed.length) {
  console.error(failed);
  console.error({ scoped1, scoped2, fallbackIn, fallbackOut });
  process.exit(1);
}
console.log('part prepaid date scope ok', checks.length);
