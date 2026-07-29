#!/usr/bin/env node
/**
 * 기사 일괄등록 보호 검증 (서버 접속 없음)
 *
 * 과거 사고: 계좌번호만 채우는 일괄등록에서 미션 배정과 장기근속이벤트가 통째로
 * 날아갔다. 지금 코드가 정말 막고 있는지, 그리고 읽기 실패 같은 예외 상황에서
 * 조용히 덮어쓰지 않는지 확인한다.
 *
 * 방법: server/riders-admin.js 의 실제 보호 함수를 그대로 불러와, 가짜 supabase
 *      클라이언트를 주입해 동작을 관찰한다. (보호 로직을 다시 구현하지 않는다)
 */
const path = require('path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost/stub';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub-key';

let mod;
try {
  mod = require(path.join(__dirname, '..', 'server', 'riders-admin.js'));
} catch (error) {
  console.error('riders-admin.js 로드 실패:', error.message);
  process.exit(2);
}
const T = mod.__test;
if (!T) {
  console.error('__test 노출이 없습니다. server/riders-admin.js 확인이 필요합니다.');
  process.exit(2);
}

let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${ok ? '' : `\n         기대=${expected}\n         실제=${actual}`}`);
}
async function expectThrow(label, fn) {
  try {
    await fn();
    failed += 1;
    console.log(` FAIL  ${label}\n         기대=중단(예외)  실제=그냥 진행됨 (덮어쓸 위험)`);
    return null;
  } catch (error) {
    const guard = Boolean(error?.isBulkGuard);
    if (!guard) failed += 1;
    console.log(`${guard ? '  OK  ' : ' FAIL '} ${label}${guard ? '' : `\n         기대=BulkRiderGuardError  실제=${error?.name}: ${error?.message}`}`);
    return error;
  }
}

// 미션·장기이벤트가 모두 설정된 기존 기사 (DB 행 형태)
function existingRow(overrides = {}) {
  return {
    id: 'd-1',
    auth_user_id: 'auth-1',
    name: '홍길동',
    phone: '010-1111-2222',
    resident_number: '900101-1234567',
    bank_name: '국민',
    account_holder: '홍길동',
    account_number: '',
    baemin_id: 'hong123',
    platform_coupang: true,
    platform_baemin: true,
    status: '근무중',
    join_date: '2026-06-01',
    memo: '기존메모',
    selected_mission_id: 'M-100',
    selected_mission_id_baemin: 'M-100B',
    selected_mission_id_coupang: 'M-100C',
    promotion_rule_id_baemin: 'PR-B',
    promotion_rule_id_coupang: 'PR-C',
    promotion_selector_baemin: 'PS-B',
    promotion_selector_coupang: 'PS-C',
    long_event_item: '장기근속 3개월',
    long_event_item_id: 'LE-3',
    long_event_platform: 'baemin',
    long_event_start_date: '2026-06-15',
    raw_data: { selectedMissionId: 'M-100', longEventItemId: 'LE-3' },
    ...overrides
  };
}

// 가짜 supabase — select().eq().maybeSingle() 과 select().in() 지원
function fakeSupabase({ rows = [], failRead = false } = {}) {
  const api = {
    from() { return api; },
    select() { return api; },
    eq(_col, value) { api._id = String(value); return api; },
    in(_col, values) { api._ids = values.map(String); return api; },
    async maybeSingle() {
      if (failRead) return { data: null, error: { message: '네트워크 오류(모의)' } };
      const hit = rows.find(r => String(r.id) === api._id) || null;
      return { data: hit, error: null };
    },
    then(resolve) {
      // select().in() 은 await 로 바로 소비된다
      if (failRead) return resolve({ data: null, error: { message: '네트워크 오류(모의)' } });
      const list = rows.filter(r => (api._ids || []).includes(String(r.id)));
      return resolve({ data: list, error: null });
    }
  };
  return api;
}

(async () => {
  console.log('='.repeat(72));
  console.log(' 기사 일괄등록 보호 검증');
  console.log('='.repeat(72));

  // ── 1. 보호 대상 목록이 실제로 미션/프로모션/장기이벤트 전부를 덮는가 ──
  console.log('\n[1] 보호 대상 컬럼 완전성 — riderToRow 가 쓰는 민감 컬럼이 빠짐없이 보호되나');
  const emitted = Object.keys(T.riderToRow({ id: 'x' }));
  const sensitive = emitted.filter(c => /mission|promotion|long_event/.test(c));
  const protectedSet = new Set(T.PROTECTED_RIDER_COLUMNS);
  const unprotected = sensitive.filter(c => !protectedSet.has(c));
  console.log(`      riderToRow 가 쓰는 민감 컬럼 ${sensitive.length}개: ${sensitive.join(', ')}`);
  check('보호 목록에서 빠진 컬럼 0개', unprotected.length, 0);
  if (unprotected.length) console.log(`         빠짐: ${unprotected.join(', ')}`);

  // ── 2. 정상: 계좌만 채우는 patch → 미션·장기이벤트 보존 ──
  console.log('\n[2] 정상 경로 — 계좌번호만 채우는 일괄등록');
  const sb2 = fakeSupabase({ rows: [existingRow()] });
  const expanded = await T.expandBulkFillPatches(sb2, [
    { id: 'd-1', bulkFillPatch: true, accountNumber: '123-456-789' }
  ]);
  const row2 = T.riderToRow(expanded[0]);
  check('계좌번호 채워짐', row2.account_number, '123-456-789');
  check('이름 보존', row2.name, '홍길동');
  check('배민ID 보존', row2.baemin_id, 'hong123');
  const [kept2] = await T.preserveProtectedFieldsOnBulkUpsert(fakeSupabase({ rows: [existingRow()] }), [row2]);
  check('미션(공통) 보존', kept2.selected_mission_id, 'M-100');
  check('미션(배민) 보존', kept2.selected_mission_id_baemin, 'M-100B');
  check('미션(쿠팡) 보존', kept2.selected_mission_id_coupang, 'M-100C');
  check('프로모션룰(배민) 보존', kept2.promotion_rule_id_baemin, 'PR-B');
  check('프로모션선택(쿠팡) 보존', kept2.promotion_selector_coupang, 'PS-C');
  check('장기이벤트 이름 보존', kept2.long_event_item, '장기근속 3개월');
  check('장기이벤트 ID 보존', kept2.long_event_item_id, 'LE-3');
  check('장기이벤트 플랫폼 보존', kept2.long_event_platform, 'baemin');
  check('장기이벤트 시작일 보존', String(kept2.long_event_start_date).slice(0, 10), '2026-06-15');

  // ── 3. 빈 payload 가 직접 들어와도 보존되는가 (patch 아닌 전체 행 업로드) ──
  console.log('\n[3] 미션이 빈 값인 전체 행이 들어와도 기존 값 보존');
  const bare = T.riderToRow({ id: 'd-1', name: '홍길동', phone: '010-1111-2222', accountNumber: '999' });
  check('변환 결과의 미션은 빈 문자열', bare.selected_mission_id, '');
  const [kept3] = await T.preserveProtectedFieldsOnBulkUpsert(fakeSupabase({ rows: [existingRow()] }), [bare]);
  check('미션 되살림', kept3.selected_mission_id, 'M-100');
  check('장기이벤트 되살림', kept3.long_event_item_id, 'LE-3');
  check('raw_data 미션 보존', kept3.raw_data.selectedMissionId, 'M-100');

  // ── 4. 실제 변경은 막지 않아야 한다 (보호가 과보호가 되면 안 됨) ──
  console.log('\n[4] 과보호 아님 — 새 미션을 넣으면 새 값이 유지되어야 한다');
  const changed = T.riderToRow({ id: 'd-1', name: '홍길동', selectedMissionIdBaemin: 'M-999B' });
  const [kept4] = await T.preserveProtectedFieldsOnBulkUpsert(fakeSupabase({ rows: [existingRow()] }), [changed]);
  check('새 미션(배민) 유지', kept4.selected_mission_id_baemin, 'M-999B');
  check('빈 쿠팡 미션은 기존값 보존', kept4.selected_mission_id_coupang, 'M-100C');

  // ── 5. 읽기 실패 시 조용히 덮어쓰지 않는가 (핵심) ──
  console.log('\n[5] 읽기 실패 — 조용히 덮어쓰지 말고 중단해야 한다');
  await expectThrow('preserve 읽기 실패 → 중단', () =>
    T.preserveProtectedFieldsOnBulkUpsert(fakeSupabase({ failRead: true }), [bare]));
  await expectThrow('patch 확장 읽기 실패 → 중단', () =>
    T.expandBulkFillPatches(fakeSupabase({ failRead: true }), [
      { id: 'd-1', bulkFillPatch: true, accountNumber: '123' }
    ]));
  await expectThrow('patch 대상 기사 없음 → 중단', () =>
    T.expandBulkFillPatches(fakeSupabase({ rows: [] }), [
      { id: 'nope', bulkFillPatch: true, accountNumber: '123' }
    ]));

  // ── 6. 신규 기사는 막히지 않아야 한다 ──
  console.log('\n[6] 신규 기사 등록은 정상 통과');
  const newOnes = await T.expandBulkFillPatches(fakeSupabase({ rows: [] }), [
    { name: '신규기사', phone: '010-3333-4444' }
  ]);
  check('신규 행 통과', newOnes[0].name, '신규기사');
  const [newRow] = await T.preserveProtectedFieldsOnBulkUpsert(
    fakeSupabase({ rows: [] }),
    [T.riderToRow({ id: 'new-1', name: '신규기사' })]
  );
  check('신규는 미션 컬럼 자체가 빠짐(덮어쓰지 않음)', 'selected_mission_id' in newRow, 'false');

  // ── 7. 이름+전화 매칭 병합도 미션을 보존하는가 (1차 보호막) ──
  console.log('\n[7] 이름+전화 매칭 병합(1차 보호막)');
  const merged = T.mergeIncomingRiderWithExisting(
    { name: '홍길동', phone: '010-1111-2222', accountNumber: '777' },
    existingRow()
  );
  check('미션 보존', merged.selectedMissionId, 'M-100');
  check('장기이벤트 보존', merged.longEventItemId, 'LE-3');
  check('프로모션 보존', merged.promotionRuleIdBaemin, 'PR-B');
  check('계좌는 새 값', merged.accountNumber, '777');

  // ── 8. 컬럼 없는 DB 대체 경로도 미션을 안 건드리나 ──
  console.log('\n[8] 컬럼 누락 대체 경로 — 미션 컬럼을 payload 에서 제거');
  const strip = T.riderToRow({ id: 'd-1', name: '홍길동', selectedMissionId: 'M-1' });
  T.stripOptionalRiderColumns(strip);
  check('미션 컬럼 제거됨', 'selected_mission_id' in strip, 'false');

  // ── 9. 클라이언트 캐시가 부분 patch 로 벗겨지지 않는가 ──
  // 캐시가 벗겨지면 그 기사를 개별 저장할 때 빈 값이 DB 로 올라간다.
  // (개별 저장 경로에는 일괄등록용 미션 보호가 없다)
  console.log('\n[9] 클라이언트 캐시 병합 — 부분 patch 가 기존 값을 지우지 않아야 한다');
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8');
  const bulkFn = src.slice(src.indexOf('    bulkUpsert(riderList, options = {}) {'));
  const body = bulkFn.slice(0, bulkFn.indexOf('\n    batchPatch('));
  check('캐시를 통째로 교체하지 않음', /merged\.set\(item\.id, item\)\)/.test(body), 'false');
  check('기존 객체 위에 덮어씀', /\{ \.\.\.prev, \.\.\.item \}/.test(body), 'true');
  check('bulkFillPatch 표식 제거', /delete next\.bulkFillPatch/.test(body), 'true');

  // 실제 병합 동작 재현 (storage.js 는 브라우저 전역이라 여기서는 같은 식으로 확인)
  const cache = new Map([['d-1', { id: 'd-1', name: '홍길동', selectedMissionId: 'M-100', longEventItemId: 'LE-3' }]]);
  [{ id: 'd-1', bulkFillPatch: true, accountNumber: '123' }].forEach(item => {
    const prev = cache.get(item.id);
    const next = prev ? { ...prev, ...item } : { ...item };
    delete next.bulkFillPatch;
    cache.set(item.id, next);
  });
  const cached = cache.get('d-1');
  check('캐시 이름 보존', cached.name, '홍길동');
  check('캐시 미션 보존', cached.selectedMissionId, 'M-100');
  check('캐시 장기이벤트 보존', cached.longEventItemId, 'LE-3');
  check('캐시 계좌 반영', cached.accountNumber, '123');
  check('patch 표식 제거됨', 'bulkFillPatch' in cached, 'false');

  console.log('\n' + '='.repeat(72));
  if (failed) {
    console.log(` 실패 ${failed}건`);
    process.exit(1);
  }
  console.log(' 전체 통과');
})().catch(error => {
  console.error('\n예상치 못한 오류:', error.stack || error.message);
  process.exit(2);
});
