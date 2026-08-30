'use strict';
/**
 * 일정산 미매칭 매칭 툴 검증
 *  1) matchDrivers 의 수동 매핑 동작 (브라우저 없이 최소 전역만 채워 실행)
 *  2) 매칭 모달이 참조하는 DOM id / data 속성이 admin.html·admin.css 에 존재하는지
 * 사용: npm run test:settlement-match
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sandbox = { console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const read = file => fs.readFileSync(path.join(root, 'js', file), 'utf8');
// const 선언은 vm 전역 객체에 붙지 않으므로 한 프로그램으로 합쳐서 var 로 꺼낸다.
vm.runInContext(
  [
    read('settlement-formats.js'),
    read('settlement-client.js'),
    'var __exports = { SettlementFormats, BremSettlementParser };'
  ].join('\n'),
  sandbox,
  { filename: 'settlement-bundle.js' }
);

const { SettlementFormats, BremSettlementParser } = sandbox.__exports;
const coupangFormat = SettlementFormats.getFormatForPlatform('coupang');
const baeminFormat = SettlementFormats.getFormatForPlatform('baemin');

const drivers = [
  { id: 'd1', name: '정우성', phone: '010-1111-8281', baeminId: '5001' },
  { id: 'd2', name: '김철수', phone: '010-2222-9999', baeminId: '' },
  { id: 'd3', name: '김철수', phone: '010-3333-7777', baeminId: '' }
];

const failures = [];
const check = (label, actual, expected) => {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
};

// 1) 매핑이 없으면 미매칭 (동명이인 2명 → 이름 단독 매칭 금지)
let out = BremSettlementParser.matchDrivers(
  [{ rawName: '김철수1234', name: '김철수', riderId: '' }],
  drivers,
  coupangFormat,
  { manualMappings: [] }
);
check('매핑 없음 → 미매칭', out.unmatched.length, 1);

// 2) 쿠팡: 성함칸(쿠팡ID) 기준 수동 매핑 적용
out = BremSettlementParser.matchDrivers(
  [{ rawName: '김철수1234', name: '김철수', riderId: '' }],
  drivers,
  coupangFormat,
  { manualMappings: [{ platform: 'coupang', originalName: '김철수1234', driverId: 'd2' }] }
);
check('쿠팡 수동 매핑 매칭수', out.matched.length, 1);
check('쿠팡 수동 매핑 대상', out.matched[0]?.driverId, 'd2');

// 3) 쿠팡: 다른 성함칸(동명이인)에는 매핑이 번지지 않는다
out = BremSettlementParser.matchDrivers(
  [{ rawName: '김철수5678', name: '김철수', riderId: '' }],
  drivers,
  coupangFormat,
  { manualMappings: [{ platform: 'coupang', originalName: '김철수1234', driverId: 'd2' }] }
);
check('동명이인 오매칭 방지', out.unmatched.length, 1);

// 4) 배민: 라이더 User ID 기준 수동 매핑
out = BremSettlementParser.matchDrivers(
  [{ rawName: '홍길동', name: '홍길동', riderId: '9091' }],
  drivers,
  baeminFormat,
  { manualMappings: [{ platform: 'baemin', originalName: '9091', driverId: 'd3' }] }
);
check('배민 수동 매핑 대상', out.matched[0]?.driverId, 'd3');

// 5) 정확한 쿠팡ID 기사가 있으면 낡은 매핑보다 우선한다 (박준혁4453 사고)
out = BremSettlementParser.matchDrivers(
  [{ rawName: '정우성8281', name: '정우성', riderId: '' }],
  drivers,
  coupangFormat,
  { manualMappings: [{ platform: 'coupang', originalName: '정우성8281', driverId: 'd2' }] }
);
check('정확한 키 > 낡은 매핑', out.matched[0]?.driverId, 'd1');

// 6) 매핑 대상 기사가 삭제된 경우 자동 키로 되돌아간다
out = BremSettlementParser.matchDrivers(
  [{ rawName: '정우성8281', name: '정우성', riderId: '' }],
  drivers,
  coupangFormat,
  { manualMappings: [{ platform: 'coupang', originalName: '정우성8281', driverId: 'deleted' }] }
);
check('삭제된 매핑 → 자동 매칭', out.matched[0]?.driverId, 'd1');

// 7) 매핑 없이 자동 매칭(회귀)
out = BremSettlementParser.matchDrivers(
  [{ rawName: '정우성8281', name: '정우성', riderId: '' }],
  drivers,
  coupangFormat,
  { manualMappings: [] }
);
check('쿠팡ID 자동 매칭 유지', out.matched[0]?.driverId, 'd1');

out = BremSettlementParser.matchDrivers(
  [{ rawName: '정우성', name: '정우성', riderId: '5001' }],
  drivers,
  baeminFormat,
  { manualMappings: [] }
);
check('배민ID 자동 매칭 유지', out.matched[0]?.driverId, 'd1');

// ===== 모달 DOM 연결 검증 =====
const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'js', 'admin.js'), 'utf8');
const storageJs = fs.readFileSync(path.join(root, 'js', 'storage.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'admin.css'), 'utf8');

// ===== 공제기준금액(쿠팡 AC열) 유실 방지 =====
// 정산 반영·업로드 기록 직렬화에서 deductionBase 가 빠지면 재반영 때 0 으로 덮이고
// 원천세가 정산금액 기준으로 계산되어 실지급액이 부푼다.
const deductionBaseGuards = [
  ['admin.js serializeSettlementLogRecords', adminJs, 'function serializeSettlementLogRecords'],
  ['admin.js 정산 반영 upsertBatch', adminJs, 'BremStorage.settlements.upsertBatch({'],
  ['storage.js normalizeSettlementUploadApplyRecord', storageJs, 'function normalizeSettlementUploadApplyRecord'],
  ['storage.js settlements.upsertBatch', storageJs, 'upsertBatch({ period, records']
];
deductionBaseGuards.forEach(([label, source, marker]) => {
  const at = source.indexOf(marker);
  if (at < 0) {
    failures.push(`${label}: 코드를 찾지 못해 공제기준금액 검사를 못했습니다`);
    return;
  }
  // 마커 뒤 레코드 매핑 블록 안에 deductionBase 가 있어야 한다.
  if (!source.slice(at, at + 900).includes('deductionBase')) {
    failures.push(`${label}: deductionBase 누락 — 재반영 시 공제가 0 으로 덮입니다`);
  }
});

const modalIds = [...new Set(
  [...adminJs.matchAll(/\$\('#(settlementMatch[A-Za-z0-9_-]+)'\)/g)].map(m => m[1])
)];
modalIds.forEach(id => {
  if (!html.includes(`id="${id}"`)) failures.push(`admin.html 에 id="${id}" 없음`);
});

[
  'data-settlement-match-tab',
  'data-settlement-match-pane',
  'data-close-settlement-match',
  'data-open-settlement-match-queue'
].forEach(attr => {
  if (!html.includes(attr)) failures.push(`admin.html 에 ${attr} 없음`);
  if (!adminJs.includes(attr)) failures.push(`admin.js 에 ${attr} 처리 없음`);
});

['data-match-settlement-unmatched', 'data-settlement-match-driver'].forEach(attr => {
  if (!adminJs.includes(attr)) failures.push(`admin.js 에 ${attr} 처리 없음`);
});

[
  'settlement-match-modal',
  'settlement-match-candidate',
  'settlement-match-grid',
  'settlement-failed-head'
].forEach(cls => {
  if (!css.includes(`.${cls}`)) failures.push(`admin.css 에 .${cls} 스타일 없음`);
});

// ===== 미반영 기사 목록은 "주 단위" 여야 한다 =====
// 업로드 폼의 정산일로 좁히면 29일·30일에 각각 미매칭된 같은 기사를 볼 수 없다.
[
  ['renderSettlementUnmatched', 'function renderSettlementUnmatched'],
  ['settlementMatchQueue', 'function settlementMatchQueue'],
  ['retryDailySettlementUnmatched', 'function retryDailySettlementUnmatched']
].forEach(([label, marker]) => {
  const at = adminJs.indexOf(marker);
  if (at < 0) {
    failures.push(`${label}: 함수를 찾지 못해 주 단위 검사를 못했습니다`);
    return;
  }
  const body = adminJs.slice(at, at + 1200);
  if (body.includes('matchesSettlementPeriod')) {
    failures.push(`${label}: 정산일 필터가 남아 있음 — 미반영 목록이 주 단위로 안 보입니다`);
  }
  if (!body.includes('getSettlementUnmatchedWeekFilter')) {
    failures.push(`${label}: 적용주 필터를 쓰지 않습니다`);
  }
});

// ===== 적용주 달력은 수요일만 선택 가능해야 한다 =====
['coupang', 'baemin'].forEach(platform => {
  ['settlementLogWeek', 'settlementUnmatchedWeek'].forEach(prefix => {
    if (html.includes(`type="date" id="${prefix}-${platform}"`)) {
      failures.push(`${prefix}-${platform}: date input 이 남아 있음 — 수요일 외 날짜가 선택됩니다`);
    }
    if (!html.includes(`id="${prefix}Btn-${platform}"`)) {
      failures.push(`${prefix}-${platform}: 수요일 달력 트리거 버튼 없음`);
    }
    if (!html.includes(`type="hidden" id="${prefix}-${platform}"`)) {
      failures.push(`${prefix}-${platform}: hidden input 없음`);
    }
  });
  ['log', 'unmatched'].forEach(kind => {
    if (!html.includes(`data-week-picker-trigger="settlement-${kind}-${platform}"`)) {
      failures.push(`settlement-${kind}-${platform}: 달력 트리거 속성 없음`);
    }
  });
});
if (!adminJs.includes('/^settlement-(log|unmatched)-(coupang|baemin)$/')) {
  failures.push('admin.js 에 일정산 적용주 달력 트리거 처리 없음');
}

if (failures.length) {
  failures.forEach(msg => console.log('FAIL:', msg));
  process.exit(1);
}
console.log(`OK: 수동 매핑 8개 케이스 + 모달 DOM(id ${modalIds.length}개) + 공제기준금액 ${deductionBaseGuards.length}곳 + 주단위/수요일달력 통과`);
