'use strict';
/**
 * 쿠팡 이름 백업 매칭의 전화 뒤4자리 검증 + 키 충돌 방어 검증
 *
 *   npm run test:settlement-tail
 *
 * 실제로 발생했던 사고를 그대로 케이스로 넣는다.
 *   - 이상호5518 정산이 등록 전이라 이상호8127 에게 붙었다 (2026-08-19, 282,355원)
 *   - 김지훈5394 정산이 김지훈6004 에게 붙었다 (2026-06~07, 331,397원)
 * 동시에 기존에 정상 동작했던 경로가 깨지지 않는지도 같이 고정한다.
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
const coupang = SettlementFormats.getFormatForPlatform('coupang');
const baemin = SettlementFormats.getFormatForPlatform('baemin');

const failures = [];
const check = (label, actual, expected) => {
  if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const match = (rows, drivers, format, manualMappings = []) =>
  BremSettlementParser.matchDrivers(rows, drivers, format, { manualMappings });

// ── 1) 키가 정확히 맞으면 붙는다 (전체의 97.6% 경로 — 회귀 방지) ──────────
{
  const drivers = [{ id: 'a', name: '이상호', phone: '010-3355-5518', baeminId: 'tkddj345' }];
  const out = match([{ rawName: '이상호5518', name: '이상호', riderId: '' }], drivers, coupang);
  check('키 일치 → 매칭', out.matched.length, 1);
  check('키 일치 대상', out.matched[0]?.driverId, 'a');
}

// ── 2) 이상호 사고 재현: 뒤4가 다르면 이름이 같아도 붙지 않는다 ───────────
{
  const drivers = [{ id: 'wrong', name: '이상호', phone: '010-8973-8127', baeminId: 'aa8127' }];
  const out = match([{ rawName: '이상호5518', name: '이상호', riderId: '' }], drivers, coupang);
  check('뒤4 불일치 → 매칭 안 됨', out.matched.length, 0);
  check('뒤4 불일치 → 미매칭', out.unmatched.length, 1);
  const reason = String(out.unmatched[0]?.reason || '');
  check('미매칭 사유에 정산서 뒤4', reason.includes('5518'), true);
  check('미매칭 사유에 등록 뒤4', reason.includes('8127'), true);
}

// ── 3) 김지훈 사고 재현: 동명이인 3명 중 뒤4가 없는 사람에게 붙지 않는다 ──
{
  const drivers = [
    { id: 'k6004', name: '김지훈', phone: '010-1111-6004', baeminId: '' },
    { id: 'k1006', name: '김지훈', phone: '010-2222-1006', baeminId: '' }
  ];
  const out = match([{ rawName: '김지훈5394', name: '김지훈', riderId: '' }], drivers, coupang);
  check('김지훈 오배정 차단', out.matched.length, 0);
  check('김지훈 미매칭', out.unmatched.length, 1);
}

// ── 4) 진짜 주인이 등록되면 그때 붙는다 (자동 재매칭이 성립하는 조건) ─────
{
  const drivers = [
    { id: 'wrong', name: '이상호', phone: '010-8973-8127', baeminId: 'aa8127' },
    { id: 'right', name: '이상호', phone: '010-3355-5518', baeminId: 'tkddj345' }
  ];
  const out = match([{ rawName: '이상호5518', name: '이상호', riderId: '' }], drivers, coupang);
  check('등록 후 매칭', out.matched.length, 1);
  check('등록 후 올바른 대상', out.matched[0]?.driverId, 'right');
}

// ── 5) 전화가 등록되지 않은 기사는 예전처럼 이름으로 붙는다 ───────────────
{
  const drivers = [{ id: 'nophone', name: '무전화', phone: '', baeminId: '' }];
  const out = match([{ rawName: '무전화1234', name: '무전화', riderId: '' }], drivers, coupang);
  check('전화 미등록 → 이름 매칭 유지', out.matched.length, 1);
  check('전화 미등록 대상', out.matched[0]?.driverId, 'nophone');
}

// ── 6) 정산서 성함칸에 뒤4가 없으면 예전처럼 이름으로 붙는다 ──────────────
{
  const drivers = [{ id: 'only', name: '홍길동', phone: '010-1234-5678', baeminId: '' }];
  const out = match([{ rawName: '홍길동', name: '홍길동', riderId: '' }], drivers, coupang);
  check('뒤4 없는 정산서 → 이름 매칭 유지', out.matched.length, 1);
  check('뒤4 없는 정산서 대상', out.matched[0]?.driverId, 'only');
}

// ── 7) 이름+뒤4가 완전히 같은 기사가 둘이면 아무에게도 붙이지 않는다 ──────
{
  const drivers = [
    { id: 'dup1', name: '동일인', phone: '010-1111-4444', baeminId: '' },
    { id: 'dup2', name: '동일인', phone: '010-2222-4444', baeminId: '' }
  ];
  const out = match([{ rawName: '동일인4444', name: '동일인', riderId: '' }], drivers, coupang);
  check('쿠팡 키 충돌 → 매칭 안 됨', out.matched.length, 0);
  check('쿠팡 키 충돌 → 미매칭', out.unmatched.length, 1);
  check('쿠팡 키 충돌 사유', String(out.unmatched[0]?.reason || '').includes('여러 기사'), true);
}

// ── 8) 뒤4만 같고 이름이 다르면 서로 섞이지 않는다 (실제 41조합 존재) ─────
{
  const drivers = [
    { id: 'x', name: '최영철', phone: '010-1111-1407', baeminId: '' },
    { id: 'y', name: '박대성', phone: '010-2222-1407', baeminId: '' }
  ];
  const out = match([{ rawName: '최영철1407', name: '최영철', riderId: '' }], drivers, coupang);
  check('뒤4 공유 → 이름으로 정확히 구분', out.matched.length, 1);
  check('뒤4 공유 → 올바른 대상', out.matched[0]?.driverId, 'x');
}

// ── 9) 수동 매핑은 뒤4 불일치를 이긴다 (정의현·김인섭 처리 경로) ───────────
{
  const drivers = [{ id: 'same', name: '정의현', phone: '010-3344-3269', baeminId: '' }];
  const out = match(
    [{ rawName: '정의현8833', name: '정의현', riderId: '' }],
    drivers,
    coupang,
    [{ platform: 'coupang', originalName: '정의현8833', driverId: 'same' }]
  );
  check('수동 매핑이 뒤4 검증보다 우선', out.matched.length, 1);
  check('수동 매핑 대상', out.matched[0]?.driverId, 'same');
}

// ── 10) 배민은 User ID 로만 붙는다 ───────────────────────────────────────
{
  const drivers = [{ id: 'b1', name: '이상호', phone: '010-3355-5518', baeminId: 'tkddj345' }];
  let out = match([{ rawName: '이상호', name: '이상호', riderId: 'tkddj345' }], drivers, baemin);
  check('배민ID 일치 → 매칭', out.matched.length, 1);
  check('배민ID 일치 대상', out.matched[0]?.driverId, 'b1');

  // 등록되지 않은 배민ID 는 이름이 같아도 붙지 않는다
  out = match([{ rawName: '이상호', name: '이상호', riderId: 'other999' }], drivers, baemin);
  check('배민 미등록ID → 미매칭', out.unmatched.length, 1);
  check('배민 미등록ID → 매칭 안 됨', out.matched.length, 0);
}

// ── 11) 배민ID 가 두 기사에 중복 등록되면 붙이지 않는다 ──────────────────
{
  const drivers = [
    { id: 'p', name: '가기사', phone: '010-1111-1111', baeminId: 'sharedid' },
    { id: 'q', name: '나기사', phone: '010-2222-2222', baeminId: 'sharedid' }
  ];
  const out = match([{ rawName: '가기사', name: '가기사', riderId: 'sharedid' }], drivers, baemin);
  check('배민ID 충돌 → 매칭 안 됨', out.matched.length, 0);
  check('배민ID 충돌 사유', String(out.unmatched[0]?.reason || '').includes('여러 기사'), true);
}

if (failures.length) {
  console.error('실패:');
  failures.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log('OK: 뒤4 검증 + 키 충돌 방어 11개 케이스 통과 (사고 재현 2건 차단 확인)');
