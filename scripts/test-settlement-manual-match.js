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

// 5) 수동 매핑이 자동 키보다 우선한다 (잘못된 자동매칭 교정)
out = BremSettlementParser.matchDrivers(
  [{ rawName: '정우성8281', name: '정우성', riderId: '' }],
  drivers,
  coupangFormat,
  { manualMappings: [{ platform: 'coupang', originalName: '정우성8281', driverId: 'd2' }] }
);
check('수동 매핑 우선', out.matched[0]?.driverId, 'd2');

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
const css = fs.readFileSync(path.join(root, 'css', 'admin.css'), 'utf8');

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

if (failures.length) {
  failures.forEach(msg => console.log('FAIL:', msg));
  process.exit(1);
}
console.log(`OK: 수동 매핑 8개 케이스 + 모달 DOM(id ${modalIds.length}개) 통과`);
