const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '../js/settlement-holiday-calendar.js'), 'utf8');
const window = {
  BremDatePicker: null,
  BremWeeklySettlement: {
    listBaeminSourceParts(record) {
      if (Array.isArray(record.sourceParts) && record.sourceParts.length) return record.sourceParts;
      return [{
        fileName: record.fileName || 'x',
        startDate: record.startDate,
        endDate: record.endDate,
        riders: record.riders || []
      }];
    },
    mergeBaeminRidersFromParts(parts) {
      return parts.flatMap(part => part.riders || []);
    }
  }
};
const trimmed = code.replace(/if \(document[\s\S]*$/, '})();');
const fn = new Function('window', `${trimmed}\nreturn window.BremSettlementHoliday;`);
const H = fn(window);
const week = '2026-09-16';
const w1 = H.getPayoutWave(week, 'baemin-fee-0923');
const w2 = H.getPayoutWave(week, 'coupang-0928');
const w3 = H.getPayoutWave(week, 'baemin-promo-0929');
const s16 = {
  id: 'b1',
  platform: 'baemin',
  startDate: '2026-09-16',
  endDate: '2026-09-20',
  fileName: 'a.xlsx',
  riders: [{ matchedRiderId: 'd1', amounts: { deliveryFee: 100000 }, weeklyOrderCount: 10 }]
};
const merged = {
  ...s16,
  endDate: '2026-09-22',
  sourceParts: [
    {
      fileName: 'a.xlsx',
      startDate: '2026-09-16',
      endDate: '2026-09-20',
      riders: [{ matchedRiderId: 'd1', amounts: { deliveryFee: 100000 }, weeklyOrderCount: 10 }]
    },
    {
      fileName: 'b.xlsx',
      startDate: '2026-09-21',
      endDate: '2026-09-22',
      riders: [{ matchedRiderId: 'd1', amounts: { deliveryFee: 40000 }, weeklyOrderCount: 4 }]
    }
  ]
};
const a = H.sliceSettlementForWave(s16, w1, week);
const b = H.sliceSettlementForWave(merged, w1, week);
const c = H.sliceSettlementForWave(merged, w3, week);
const d = H.sliceSettlementForWave({
  id: 'c1',
  platform: 'coupang',
  startDate: '2026-09-16',
  endDate: '2026-09-22',
  riders: [{}]
}, w2, week);
const e = H.sliceSettlementForWave(s16, w2, week);
const checks = [
  ['default wave', H.defaultPayoutWaveId(week) === 'baemin-fee-0923'],
  ['upcoming pay', H.upcomingPaymentDate(week) === '2026-09-23'],
  ['16-20 wave1 no promo', a && a.includePromo === false && a.riders[0].amounts.deliveryFee === 100000],
  ['merged wave1 100000', b && b.includePromo === false && b.riders[0].amounts.deliveryFee === 100000 && b.endDate === '2026-09-20'],
  ['merged wave3 promo+40000', c && c.includePromo === true && c.riders[0].amounts.deliveryFee === 40000 && c.startDate === '2026-09-21'],
  ['coupang wave includes promo', d && d.includePromo === true],
  ['baemin hidden on coupang wave', e == null]
];
const failed = checks.filter(item => !item[1]);
if (failed.length) {
  console.error(failed);
  process.exit(1);
}
console.log('payout wave slice ok', checks.length);
