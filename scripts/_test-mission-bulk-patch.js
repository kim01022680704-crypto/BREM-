#!/usr/bin/env node
/**
 * 미션 일괄 저장이 기사마다 무거운 SELECT/후속 UPDATE 를 반복하지 않는지 확인.
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
if (!T?.applyMissionPatches) {
  console.error('applyMissionPatches 테스트 노출이 없습니다.');
  process.exit(2);
}

let failed = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${ok ? '' : `\n         기대=${expected}\n         실제=${actual}`}`);
}

function createMockSupabase(rows, options = {}) {
  const store = new Map(rows.map((row) => [row.id, { ...row, raw_data: { ...(row.raw_data || {}) } }]));
  const missing = new Set(options.missingColumns || []);
  const calls = { selectIn: 0, update: 0, fatSelect: 0 };
  return {
    calls,
    store,
    from() {
      return {
        select(cols) {
          if (String(cols).includes('auth_user_id') || String(cols).includes('resident_number')) {
            calls.fatSelect += 1;
          }
          return {
            in(field, ids) {
              calls.selectIn += 1;
              return Promise.resolve({
                data: ids.map((id) => store.get(id)).filter(Boolean).map((row) => ({
                  id: row.id,
                  raw_data: { ...row.raw_data }
                })),
                error: null
              });
            }
          };
        },
        update(payload) {
          calls.update += 1;
          const hit = Object.keys(payload).find((key) => missing.has(key));
          return {
            eq(field, id) {
              if (hit) {
                return Promise.resolve({
                  data: null,
                  error: { message: `column riders.${hit} does not exist` }
                });
              }
              const row = store.get(id);
              if (!row) {
                return Promise.resolve({ data: null, error: { message: 'not found' } });
              }
              Object.assign(row, payload);
              if (payload.raw_data) row.raw_data = { ...payload.raw_data };
              return Promise.resolve({ data: { id }, error: null });
            }
          };
        }
      };
    }
  };
}

async function main() {
  const riders = Array.from({ length: 12 }, (_, index) => ({
    id: `r${index + 1}`,
    raw_data: { name: `기사${index + 1}`, selectedMissionIdBaemin: 'old' }
  }));
  const supabase = createMockSupabase(riders);
  const result = await T.applyMissionPatches(supabase, riders.map((row) => ({
    id: row.id,
    selectedMissionIdBaemin: 'mission-b',
    selectedMissionIdCoupang: 'mission-c',
    selectedMissionIdCombined: ''
  })), { concurrency: 4 });

  check('일괄 성공', result.ok, true);
  check('12명 저장', result.updated, 12);
  check('raw_data 는 한 번에 조회', supabase.calls.selectIn <= 1, true);
  check('기사당 업데이트 1회', supabase.calls.update, 12);
  check('전체 기사 SELECT 없음', supabase.calls.fatSelect, 0);
  check('raw_data 미션 동기화', supabase.store.get('r1').raw_data.selectedMissionIdBaemin, 'mission-b');
  check('기존 raw 필드 유지', supabase.store.get('r1').raw_data.name, '기사1');

  const missingDb = createMockSupabase([
    { id: 'x1', raw_data: { keep: 'yes' } }
  ], { missingColumns: ['promotion_rule_id_baemin'] });
  const retry = await T.applyMissionPatches(missingDb, [{
    id: 'x1',
    selectedMissionIdBaemin: 'mission-b'
  }]);
  check('없는 컬럼은 빼고 재시도', retry.ok, true);
  check('재시도 후 raw 유지', missingDb.store.get('x1').raw_data.keep, 'yes');
  check('재시도 후 미션 저장', missingDb.store.get('x1').selected_mission_id_baemin, 'mission-b');

  if (failed) {
    console.error(`\n실패 ${failed}건`);
    process.exit(1);
  }
  console.log('\n미션 일괄 저장 검증 통과');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
