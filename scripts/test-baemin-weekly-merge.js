'use strict';
/**
 * 배민 월말 쪼개진 주정산서 합치기 검증
 * 사용: npm run test:baemin-weekly-merge
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const failures = [];
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected)
    || (typeof expected === 'number' && Number(actual) === expected)
    || (typeof expected === 'string' && String(actual) === expected);
  if (!ok) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

const sandbox = {
  console,
  BremPlatforms: {
    normalize: (p) => {
      const v = String(p || '').toLowerCase();
      if (v.includes('baemin') || v.includes('배민')) return 'baemin';
      if (v.includes('coupang') || v.includes('쿠팡')) return 'coupang';
      return v || 'coupang';
    }
  },
  BremSettlementParser: {},
  BremStorage: {
    weeklySettlements: {
      getById: () => null,
      save: (r) => r,
      getAll: () => []
    },
    settlements: { getAll: () => [] },
    calls: { getAll: () => [] },
    drivers: { getAll: () => [], getById: () => null }
  },
  BremDatePicker: {
    weekStartKey(dateValue) {
      const raw = String(dateValue || '').slice(0, 10);
      const date = new Date(`${raw}T00:00:00`);
      const day = date.getDay();
      const diff = (day - 3 + 7) % 7;
      date.setDate(date.getDate() - diff);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    },
    applyWeekWednesday(dateValue) {
      const raw = String(dateValue || '').slice(0, 10);
      const date = new Date(`${raw}T00:00:00`);
      if (date.getDay() === 2) {
        date.setDate(date.getDate() + 1);
      } else {
        return sandbox.BremDatePicker.weekStartKey(raw);
      }
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const src = fs.readFileSync(path.join(root, 'js', 'weekly-settlement.js'), 'utf8');
vm.runInContext(src + '\n;var __WS = BremWeeklySettlement;', sandbox, { filename: 'weekly-settlement.js' });
const WS = sandbox.__WS;

// 1) YYMMDD-YYMMDD 지역명 파일명
const parsedA = WS.parseBaeminFileName('260729-260731 울산울주a.xlsx');
check('parse start A', parsedA.startDate, '2026-07-29');
check('parse end A', parsedA.endDate, '2026-07-31');
check('parse team A', parsedA.teamName, '울산울주a');

const parsedNoSpace = WS.parseBaeminFileName('260729-260731울산aa.xlsx');
check('parse no-space start', parsedNoSpace.startDate, '2026-07-29');
check('parse no-space team', parsedNoSpace.teamName, '울산aa');

const parsedB = WS.parseBaeminFileName('260801-260804 울산울주a.xlsx');
check('parse start B', parsedB.startDate, '2026-08-01');
check('parse end B', parsedB.endDate, '2026-08-04');
check('parse team B', parsedB.teamName, '울산울주a');

// 2) 수~화 weekStart 동일
const weekA = WS.baeminWeekStartKey(parsedA.startDate);
const weekB = WS.baeminWeekStartKey(parsedB.startDate);
check('weekStart A', weekA, '2026-07-29');
check('weekStart B same week', weekB, '2026-07-29');

// 3) 기사별 금액·콜수 합산
const merged = WS.mergeBaeminRiders([
  [{
    baeminUserId: '0123',
    riderName: '강승원',
    weeklyOrderCount: 10,
    amounts: { deliveryFee: 100000, withholdingTax: 3000, missionPay: 5000 }
  }],
  [{
    baeminUserId: '123', // 앞 0 무시 매칭
    riderName: '강승원',
    weeklyOrderCount: 7,
    amounts: { deliveryFee: 50000, withholdingTax: 1500, employmentInsurance: 800 }
  }]
]);
check('merge rider count', merged.length, 1);
check('merge order count', merged[0].weeklyOrderCount, 17);
check('merge deliveryFee', merged[0].amounts.deliveryFee, 150000);
check('merge withholdingTax', merged[0].amounts.withholdingTax, 4500);
check('merge missionPay', merged[0].amounts.missionPay, 5000);
check('merge employmentInsurance', merged[0].amounts.employmentInsurance, 800);

// 4) id 는 weekStart 기준 (반쪽 startDate 아님)
const idFromA = WS.buildWeeklySettlementRecord({
  platform: 'baemin',
  channel: 'direct',
  region: '울산울주a',
  fileName: '260729-260731 울산울주a.xlsx',
  startDate: '2026-07-29',
  endDate: '2026-07-31',
  matchedRiders: [],
  unmatchedRiders: []
}).id;
const idFromB = WS.buildWeeklySettlementRecord({
  platform: 'baemin',
  channel: 'direct',
  region: '울산울주a',
  fileName: '260801-260804 울산울주a.xlsx',
  startDate: '2026-08-01',
  endDate: '2026-08-04',
  matchedRiders: [],
  unmatchedRiders: []
}).id;
check('id uses weekStart not Aug1', idFromA.includes('20260729'), true);
check('ids equal across halves', idFromA, idFromB);

// 5) part upsert — 두 반쪽 합치면 기간·금액 확장
const first = WS.upsertBaeminWeeklyParts(null, {
  platform: 'baemin',
  channel: 'direct',
  region: '울산울주a',
  fileName: '260729-260731 울산울주a.xlsx',
  startDate: '2026-07-29',
  endDate: '2026-07-31',
  riders: [{
    baeminUserId: '9',
    matched: true,
    matchedRiderId: 'd1',
    weeklyOrderCount: 3,
    amounts: { deliveryFee: 10000 }
  }]
});
const second = WS.upsertBaeminWeeklyParts(first, {
  platform: 'baemin',
  channel: 'direct',
  region: '울산울주a',
  fileName: '260801-260804 울산울주a.xlsx',
  startDate: '2026-08-01',
  endDate: '2026-08-04',
  riders: [{
    baeminUserId: '9',
    matched: true,
    matchedRiderId: 'd1',
    weeklyOrderCount: 4,
    amounts: { deliveryFee: 20000 }
  }]
});
check('upsert start', second.startDate, '2026-07-29');
check('upsert end', second.endDate, '2026-08-04');
check('upsert parts', second.sourceParts.length, 2);
check('upsert order', second.riders[0].weeklyOrderCount, 7);
check('upsert fee', second.riders[0].amounts.deliveryFee, 30000);

// 6) 같은 파일 재업로드는 교체(이중 합산 방지)
const replaced = WS.upsertBaeminWeeklyParts(second, {
  platform: 'baemin',
  channel: 'direct',
  region: '울산울주a',
  fileName: '260801-260804 울산울주a.xlsx',
  startDate: '2026-08-01',
  endDate: '2026-08-04',
  riders: [{
    baeminUserId: '9',
    matched: true,
    matchedRiderId: 'd1',
    weeklyOrderCount: 1,
    amounts: { deliveryFee: 1000 }
  }]
});
check('replace parts still 2', replaced.sourceParts.length, 2);
check('replace no double', replaced.riders[0].weeklyOrderCount, 4); // 3 + 1
check('replace fee', replaced.riders[0].amounts.deliveryFee, 11000);

// 기존 strict 파일명도 유지
const legacy = WS.parseBaeminFileName('20260729_20260804_울산동a_정산서.xlsx');
check('legacy start', legacy.startDate, '2026-07-29');
check('legacy team', legacy.teamName, '울산동a');

// 7) 한 파일 안 같은 ID(같은 이름) 중복 → 금액·콜수 합산
const withinFile = WS.mergeBaeminRiders([[
  {
    baeminUserId: '555',
    riderName: '홍길동',
    weeklyOrderCount: 2,
    amounts: { deliveryFee: 40000, withholdingTax: 1000 }
  },
  {
    baeminUserId: '555',
    riderName: '홍길동',
    weeklyOrderCount: 3,
    amounts: { deliveryFee: 60000, withholdingTax: 2000 }
  }
]]);
check('within-file one rider', withinFile.length, 1);
check('within-file orders', withinFile[0].weeklyOrderCount, 5);
check('within-file fee', withinFile[0].amounts.deliveryFee, 100000);
check('within-file tax', withinFile[0].amounts.withholdingTax, 3000);

if (failures.length) {
  failures.forEach(msg => console.log('FAIL:', msg));
  process.exit(1);
}
console.log('OK: 배민 월말 주정산 합치기 (파일명·주차·금액합산·part upsert) 통과');
