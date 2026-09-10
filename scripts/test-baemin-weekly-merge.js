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
    drivers: {
      list: [
        { id: 'd-bc', name: '박건', baeminId: 'BC740647' },
        { id: 'd-raw', name: '장정민', baeminId: '', raw_data: { baeminId: 'a700825' } },
        { id: 'd-name', name: '유일한이름', baeminId: '' }
      ],
      getAll() { return this.list; },
      getById(id) { return this.list.find(d => d.id === id) || null; }
    },
    manualNameMappings: { getAll: () => [] }
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

const parsedTue = WS.parseBaeminFileName('20260901~20260901_배달 이글스_표준울산북필드B.xlsx');
check('parse tue start', parsedTue.startDate, '2026-09-01');
check('parse tue end', parsedTue.endDate, '2026-09-01');
check('weekStart tue remainder', WS.baeminWeekStartKey(parsedTue.startDate), '2026-08-26');

const idFromTue = WS.buildWeeklySettlementRecord({
  platform: 'baemin',
  channel: 'direct',
  region: '배달 이글스_표준울산북필드B',
  fileName: '20260901~20260901_배달 이글스_표준울산북필드B.xlsx',
  startDate: '2026-09-01',
  endDate: '2026-09-01',
  matchedRiders: [],
  unmatchedRiders: []
}).id;
const idFromWedHalf = WS.buildWeeklySettlementRecord({
  platform: 'baemin',
  channel: 'direct',
  region: '배달 이글스_표준울산북필드B',
  fileName: '20260826~20260831_배달 이글스_표준울산북필드B.xlsx',
  startDate: '2026-08-26',
  endDate: '2026-08-31',
  matchedRiders: [],
  unmatchedRiders: []
}).id;
check('tue remainder id uses 8/26 week', idFromTue.includes('20260826'), true);
check('tue and wed-mon halves share id', idFromTue, idFromWedHalf);

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

// 8) B열 배민 ID(영문+숫자) · raw_data · 유일 이름 매칭
const matchedIds = WS.matchSettlementRidersWithExistingData([
  { originalName: '박건', riderName: '박건', baeminUserId: 'BC740647', weeklyOrderCount: 10 },
  { originalName: '장정민', riderName: '장정민', baeminUserId: 'a700825', weeklyOrderCount: 4 },
  { originalName: '유일한이름', riderName: '유일한이름', baeminUserId: 'unknown-id', weeklyOrderCount: 1 }
], 'baemin', { skipCallAudit: true });
check('alphanumeric baemin id', matchedIds[0]?.matchedRiderId, 'd-bc');
check('raw_data baemin id', matchedIds[1]?.matchedRiderId, 'd-raw');
check('unique name fallback', matchedIds[2]?.matchedRiderId, 'd-name');
check('all three matched', matchedIds.every(item => item.matched), true);

// 9) 사업자(회사명)가 달라도 같은 권역·주차면 한 정산으로 묶고, 겹치면 중복 제거
check(
  'strip 119라이더스',
  WS.canonicalBaeminTeamRegion('119라이더스_표준울산북필드B'),
  '표준울산북필드B'
);
check(
  'strip 배달 이글스',
  WS.canonicalBaeminTeamRegion('배달 이글스_표준울산북필드B'),
  '표준울산북필드B'
);
check(
  'strip 주식회사 119컴퍼니 prefix+suffix+DP',
  WS.canonicalBaeminTeamRegion('주식회사 119컴퍼니_표준울산북필드B주식회사119컴퍼니_DP2608315001'),
  '표준울산북필드B'
);
check(
  'strip 배달 이글스 prefix+suffix+DP',
  WS.canonicalBaeminTeamRegion('배달 이글스_표준울산북필드B배달이글스_DP2608318332'),
  '표준울산북필드B'
);
check(
  'strip 119 남A live filename region',
  WS.canonicalBaeminTeamRegion(WS.parseBaeminFileName(
    '20260902~20260908_주식회사 119컴퍼니_표준울산남A주식회사119컴퍼니_DP2608315883.xlsx'
  ).teamName),
  '표준울산남A'
);
check(
  'strip 이글스 남A live filename region',
  WS.canonicalBaeminTeamRegion(WS.parseBaeminFileName(
    '20260902~20260908_배달 이글스_표준울산남A배달이글스_DP2607278930.xlsx'
  ).teamName),
  '표준울산남A'
);
check('keep 이글스남A region', WS.canonicalBaeminTeamRegion('이글스남A'), '이글스남A');
check('keep 울산울주a', WS.canonicalBaeminTeamRegion('울산울주a'), '울산울주a');

const live119Id = WS.buildWeeklySettlementRecord({
  platform: 'baemin',
  channel: 'direct',
  region: WS.parseBaeminFileName('20260902~20260908_주식회사 119컴퍼니_표준울산북필드B주식회사119컴퍼니_DP2608315001.xlsx').teamName,
  fileName: '20260902~20260908_주식회사 119컴퍼니_표준울산북필드B주식회사119컴퍼니_DP2608315001.xlsx',
  startDate: '2026-09-02',
  endDate: '2026-09-08',
  matchedRiders: [],
  unmatchedRiders: []
}).id;
const liveEaglesId = WS.buildWeeklySettlementRecord({
  platform: 'baemin',
  channel: 'direct',
  region: WS.parseBaeminFileName('20260902~20260908_배달 이글스_표준울산북필드B배달이글스_DP2608318332.xlsx').teamName,
  fileName: '20260902~20260908_배달 이글스_표준울산북필드B배달이글스_DP2608318332.xlsx',
  startDate: '2026-09-02',
  endDate: '2026-09-08',
  matchedRiders: [],
  unmatchedRiders: []
}).id;
check('live 119/이글스 북필드B stay separate until selected', live119Id !== liveEaglesId, true);

const id119 = WS.buildWeeklySettlementRecord({
  platform: 'baemin',
  channel: 'direct',
  region: '119라이더스_표준울산북필드B',
  fileName: '20260826~20260831_119라이더스_표준울산북필드B.xlsx',
  startDate: '2026-08-26',
  endDate: '2026-08-31',
  matchedRiders: [],
  unmatchedRiders: []
}).id;
const idEagles = WS.buildWeeklySettlementRecord({
  platform: 'baemin',
  channel: 'direct',
  region: '배달 이글스_표준울산북필드B',
  fileName: '20260826~20260831_배달 이글스_표준울산북필드B.xlsx',
  startDate: '2026-08-26',
  endDate: '2026-08-31',
  matchedRiders: [],
  unmatchedRiders: []
}).id;
check('company transfer keeps separate ids', id119 !== idEagles, true);
check('original region stored', WS.buildWeeklySettlementRecord({
  platform: 'baemin',
  channel: 'direct',
  region: '119라이더스_표준울산북필드B',
  fileName: '20260826~20260831_119라이더스_표준울산북필드B.xlsx',
  startDate: '2026-08-26',
  endDate: '2026-08-31',
  matchedRiders: [],
  unmatchedRiders: []
}).region, '119라이더스_표준울산북필드B');

const splitCompany = WS.mergeBaeminRidersFromParts([
  {
    fileName: '20260826~20260831_119라이더스_표준울산북필드B.xlsx',
    startDate: '2026-08-26',
    endDate: '2026-08-31',
    riders: [{
      baeminUserId: 'jihye',
      riderName: '정지혜',
      weeklyOrderCount: 80,
      amounts: { deliveryFee: 800000 }
    }]
  },
  {
    fileName: '20260901~20260901_배달 이글스_표준울산북필드B.xlsx',
    startDate: '2026-09-01',
    endDate: '2026-09-01',
    riders: [{
      baeminUserId: 'jihye',
      riderName: '정지혜',
      weeklyOrderCount: 39,
      amounts: { deliveryFee: 390000 }
    }]
  }
]);
check('split company one rider', splitCompany.length, 1);
check('split company summed calls', splitCompany[0].weeklyOrderCount, 119);
check('split company summed fee', splitCompany[0].amounts.deliveryFee, 1190000);

const dupCompany = WS.mergeBaeminRidersFromParts([
  {
    fileName: '20260826~20260901_119라이더스_표준울산북필드B.xlsx',
    startDate: '2026-08-26',
    endDate: '2026-09-01',
    riders: [{
      baeminUserId: 'jihye',
      riderName: '정지혜',
      weeklyOrderCount: 119,
      amounts: { deliveryFee: 1190000 }
    }]
  },
  {
    fileName: '20260826~20260901_배달 이글스_표준울산북필드B.xlsx',
    startDate: '2026-08-26',
    endDate: '2026-09-01',
    riders: [{
      baeminUserId: 'jihye',
      riderName: '정지혜',
      weeklyOrderCount: 119,
      amounts: { deliveryFee: 1190000 }
    }]
  }
]);
check('duplicate company one rider', dupCompany.length, 1);
check('duplicate company keeps 119 not 238', dupCompany[0].weeklyOrderCount, 119);
check('duplicate company warning', Array.isArray(dupCompany[0].warnings) && dupCompany[0].warnings.some(w => /중복/.test(w)), true);

const overlapDiff = WS.mergeBaeminRidersFromParts([
  {
    fileName: '20260826~20260901_119라이더스_표준울산북필드B.xlsx',
    startDate: '2026-08-26',
    endDate: '2026-09-01',
    riders: [{
      baeminUserId: 'jihye',
      riderName: '정지혜',
      weeklyOrderCount: 80,
      amounts: { deliveryFee: 800000 }
    }]
  },
  {
    fileName: '20260826~20260901_배달 이글스_표준울산북필드B.xlsx',
    startDate: '2026-08-26',
    endDate: '2026-09-01',
    riders: [{
      baeminUserId: 'jihye',
      riderName: '정지혜',
      weeklyOrderCount: 119,
      amounts: { deliveryFee: 1190000 }
    }]
  }
]);
check('overlap different calls summed', overlapDiff[0].weeklyOrderCount, 199);
check('overlap different warning', Array.isArray(overlapDiff[0].warnings) && overlapDiff[0].warnings.some(w => /겹칩니다/.test(w)), true);

const companyFirst = WS.upsertBaeminWeeklyParts(null, {
  platform: 'baemin',
  channel: 'direct',
  region: '119라이더스_표준울산북필드B',
  fileName: '20260826~20260901_119라이더스_표준울산북필드B.xlsx',
  startDate: '2026-08-26',
  endDate: '2026-09-01',
  riders: [{
    baeminUserId: 'jihye',
    riderName: '정지혜',
    weeklyOrderCount: 119,
    amounts: { deliveryFee: 1190000 }
  }]
});
const companySecond = WS.upsertBaeminWeeklyParts(companyFirst, {
  platform: 'baemin',
  channel: 'direct',
  region: '배달 이글스_표준울산북필드B',
  fileName: '20260826~20260901_배달 이글스_표준울산북필드B.xlsx',
  startDate: '2026-08-26',
  endDate: '2026-09-01',
  riders: [{
    baeminUserId: 'jihye',
    riderName: '정지혜',
    weeklyOrderCount: 119,
    amounts: { deliveryFee: 1190000 }
  }]
});
check('sequential company upsert keeps id', companySecond.id, companyFirst.id);
check('sequential company region canonical', companySecond.region, '표준울산북필드B');
check('sequential company no double count', companySecond.riders[0].weeklyOrderCount, 119);
check('sequential company two parts', companySecond.sourceParts.length, 2);

const store = [];
sandbox.BremStorage.weeklySettlements = {
  getAll() { return store.slice(); },
  getById(id) { return store.find(item => item.id === id) || null; },
  save(record) {
    const idx = store.findIndex(item => item.id === record.id);
    if (idx >= 0) store[idx] = record;
    else store.push(record);
    return record;
  },
  remove(id) {
    const idx = store.findIndex(item => item.id === id);
    if (idx >= 0) store.splice(idx, 1);
  }
};
const old119 = WS.buildWeeklySettlementRecord({
  platform: 'baemin',
  channel: 'direct',
  region: '119라이더스_표준울산북필드B',
  fileName: '20260826~20260901_119라이더스_표준울산북필드B.xlsx',
  startDate: '2026-08-26',
  endDate: '2026-09-01',
  matchedRiders: [{
    baeminUserId: 'jihye',
    riderName: '정지혜',
    matched: true,
    matchedRiderId: 'd-jihye',
    weeklyOrderCount: 119,
    amounts: { deliveryFee: 1190000 }
  }],
  unmatchedRiders: []
});
old119.id = 'weekly_direct_baemin_119riders_old';
old119.sourceParts = [{
  fileName: '20260826~20260901_119라이더스_표준울산북필드B.xlsx',
  startDate: '2026-08-26',
  endDate: '2026-09-01',
  riders: old119.riders
}];
store.push(old119);
const incomingEagles = WS.buildWeeklySettlementRecord({
  platform: 'baemin',
  channel: 'direct',
  region: '배달 이글스_표준울산북필드B',
  fileName: '20260826~20260901_배달 이글스_표준울산북필드B.xlsx',
  startDate: '2026-08-26',
  endDate: '2026-09-01',
  matchedRiders: [{
    baeminUserId: 'jihye',
    riderName: '정지혜',
    matched: true,
    matchedRiderId: 'd-jihye',
    weeklyOrderCount: 119,
    amounts: { deliveryFee: 1190000 }
  }],
  unmatchedRiders: []
});
incomingEagles.sourceParts = [{
  fileName: '20260826~20260901_배달 이글스_표준울산북필드B.xlsx',
  startDate: '2026-08-26',
  endDate: '2026-09-01',
  riders: incomingEagles.riders
}];
const savedMerge = WS.saveWeeklySettlement(incomingEagles);
check('save does not auto-merge other company', store.length, 2);

store.length = 0;
const left = WS.buildWeeklySettlementRecord({
  platform: 'baemin',
  channel: 'direct',
  region: '주식회사 119컴퍼니_표준울산북필드B주식회사119컴퍼니_DP2608315001',
  fileName: '20260902~20260908_주식회사 119컴퍼니_표준울산북필드B주식회사119컴퍼니_DP2608315001.xlsx',
  startDate: '2026-09-02',
  endDate: '2026-09-08',
  matchedRiders: [{
    baeminUserId: 'jihye',
    riderName: '정지혜',
    matched: true,
    matchedRiderId: 'd-jihye',
    weeklyOrderCount: 80,
    amounts: { deliveryFee: 800000, withholdingTax: 26400 }
  }],
  unmatchedRiders: []
});
left.id = 'weekly_direct_baemin_left';
left.sourceParts = [{
  fileName: left.fileName,
  startDate: left.startDate,
  endDate: left.endDate,
  riders: left.riders
}];
const right = WS.buildWeeklySettlementRecord({
  platform: 'baemin',
  channel: 'direct',
  region: '배달 이글스_표준울산북필드B배달이글스_DP2608318332',
  fileName: '20260902~20260908_배달 이글스_표준울산북필드B배달이글스_DP2608318332.xlsx',
  startDate: '2026-09-02',
  endDate: '2026-09-08',
  matchedRiders: [{
    baeminUserId: 'jihye',
    riderName: '정지혜',
    matched: true,
    matchedRiderId: 'd-jihye',
    weeklyOrderCount: 39,
    amounts: { deliveryFee: 390000, withholdingTax: 12870 }
  }],
  unmatchedRiders: []
});
right.id = 'weekly_direct_baemin_right';
right.sourceParts = [{
  fileName: right.fileName,
  startDate: right.startDate,
  endDate: right.endDate,
  riders: right.riders
}];
store.push(left, right);
const selected = WS.mergeSelectedWeeklySettlements([left, right], { channel: 'direct' });
check('selected merge ok', selected.ok, true);
check('selected merge one record left', store.length, 1);
check('selected merge summed calls', store[0].riders[0].weeklyOrderCount, 119);
check('selected merge summed fee', store[0].riders[0].amounts.deliveryFee, 1190000);
check('selected merge summed tax', store[0].riders[0].amounts.withholdingTax, 39270);
check('selected merge region plus', store[0].region.includes(' + '), true);
check('selected merge file plus', store[0].fileName.includes(' + '), true);

if (failures.length) {
  failures.forEach(msg => console.log('FAIL:', msg));
  process.exit(1);
}
console.log('OK: 배민 월말 주정산 합치기 (파일명·주차·금액합산·part upsert) 통과');
