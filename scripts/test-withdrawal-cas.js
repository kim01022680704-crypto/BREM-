#!/usr/bin/env node
/**
 * 출금신청 CAS(낙관적 잠금)·대량완료·아카이브 로직 검증 (읽기 전용, DB 미사용)
 * 실제 Supabase 대신 인메모리 페이크 settings 로 동시성/동치성을 확인한다.
 */
const assert = require('assert');
const { __audit } = require('../server/rider-withdrawal');

const {
  REQUESTS_ARCHIVE_KEY,
  mutateRequestsList,
  markWithdrawalCompleted,
  buildBulkCompleteResult,
  isArchivableRequest,
  archiveCutoffWeekStart
} = __audit;

const REQUESTS_KEY = 'brem_payroll_withdrawal_requests_v1';

// updated_at 기반 CAS 를 흉내내는 최소 페이크. update 는 expected updated_at 이 맞을 때만 성공.
function makeFakeSupabase(initial) {
  const store = new Map();
  store.set(REQUESTS_KEY, { value: initial, updated_at: new Date(Date.now() - 1000).toISOString() });

  return {
    from(table) {
      assert.strictEqual(table, 'settings');
      const ctx = { _key: null, _expectedUpdatedAt: undefined, _payload: null, _op: null };
      const api = {
        select() { ctx._op = ctx._op || 'select'; return api; },
        eq(col, val) {
          if (col === 'key') ctx._key = val;
          if (col === 'updated_at') ctx._expectedUpdatedAt = val;
          return api;
        },
        async maybeSingle() {
          const row = store.get(ctx._key);
          return { data: row ? { value: row.value, updated_at: row.updated_at } : null, error: null };
        },
        update(payload) { ctx._op = 'update'; ctx._payload = payload; return api; },
        upsert(payload) {
          const key = payload.key;
          store.set(key, { value: payload.value, updated_at: payload.updated_at || new Date().toISOString() });
          return Promise.resolve({ error: null });
        },
        async select2() { return { data: [], error: null }; }
      };
      // update(...).eq('key').eq('updated_at').select('key')
      api.select = function selectAfter() {
        if (ctx._op === 'update') {
          const row = store.get(ctx._key);
          const matches = row && row.updated_at === ctx._expectedUpdatedAt;
          if (matches) {
            store.set(ctx._key, { value: ctx._payload.value, updated_at: ctx._payload.updated_at });
            return Promise.resolve({ data: [{ key: ctx._key }], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        }
        return api;
      };
      return api;
    },
    __store: store
  };
}

function makeRequests(n, status = 'pending', weekStart = '2026-09-16') {
  return Array.from({ length: n }, (_, i) => ({
    id: `wd_${i}`,
    driverId: `d_${i}`,
    driverName: `기사${i}`,
    platform: i % 2 ? 'baemin' : 'coupang',
    amount: 10000 + i,
    weekStart,
    weekEnd: '2026-09-22',
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
}

(async () => {
  // 1) 단건 완료 == 대량 완료 결과 동치(금액 합계·건수)
  {
    const ids = ['wd_0', 'wd_1', 'wd_2'];
    const fakeA = makeFakeSupabase(makeRequests(5));
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      await mutateRequestsList(fakeA, (list) => {
        const r = markWithdrawalCompleted(list, id);
        if (!r.ok || r.alreadyCompleted) return { shortCircuit: true, result: r };
        return { shortCircuit: false, result: r };
      });
    }
    const afterSeq = fakeA.__store.get(REQUESTS_KEY).value.filter(x => x.status === 'completed');

    const fakeB = makeFakeSupabase(makeRequests(5));
    const bulk = await mutateRequestsList(fakeB, (list) => {
      const completed = [];
      const failed = [];
      let changed = false;
      ids.forEach(id => {
        const r = markWithdrawalCompleted(list, id);
        if (r.ok) { completed.push(r.request); if (!r.alreadyCompleted) changed = true; }
        else failed.push({ id, error: r.error });
      });
      const result = buildBulkCompleteResult(completed, failed);
      return changed ? { shortCircuit: false, result } : { shortCircuit: true, result };
    });
    const afterBulk = fakeB.__store.get(REQUESTS_KEY).value.filter(x => x.status === 'completed');

    assert.strictEqual(afterBulk.length, afterSeq.length, '대량/단건 완료 건수 불일치');
    assert.strictEqual(bulk.count, 3, 'bulk count 오류');
    assert.strictEqual(bulk.totalAmount, 10000 + 10001 + 10002, 'bulk 금액 합계 오류');
  }

  // 2) CAS: 커밋 직전 외부 변경이 끼어들면 재시도 후 두 변경 모두 보존(유실 없음)
  {
    const fake = makeFakeSupabase(makeRequests(3));
    let injected = false;
    // 첫 시도의 커밋 직전에 wd_2 를 외부에서 취소시켜 updated_at 을 바꾼다 → 첫 커밋 실패 → 재시도.
    const origFrom = fake.from.bind(fake);
    fake.from = function patched(table) {
      const api = origFrom(table);
      const origSelect = api.select;
      api.select = function selectHook() {
        const ret = origSelect();
        if (!injected && ret && typeof ret.then === 'function') {
          injected = true;
          const cur = fake.__store.get(REQUESTS_KEY);
          const next = cur.value.map(x => x.id === 'wd_2' ? { ...x, status: 'cancelled' } : x);
          fake.__store.set(REQUESTS_KEY, { value: next, updated_at: new Date(Date.now() + 5).toISOString() });
        }
        return ret;
      };
      return api;
    };

    const res = await mutateRequestsList(fake, (list) => {
      const r = markWithdrawalCompleted(list, 'wd_0');
      return { shortCircuit: false, result: r };
    });
    assert.ok(res.ok, 'CAS 재시도 실패');
    const finalList = fake.__store.get(REQUESTS_KEY).value;
    assert.strictEqual(finalList.find(x => x.id === 'wd_0').status, 'completed', 'wd_0 완료 유실');
    assert.strictEqual(finalList.find(x => x.id === 'wd_2').status, 'cancelled', '외부 취소 변경 유실(덮어쓰기)');
  }

  // 3) 취소된 건은 완료 불가, 없는 건은 404
  {
    const list = makeRequests(2);
    list[0].status = 'cancelled';
    const r1 = markWithdrawalCompleted(list, 'wd_0');
    assert.strictEqual(r1.ok, false, '취소건이 완료됨');
    const r2 = markWithdrawalCompleted(list, 'nope');
    assert.strictEqual(r2.status, 404, '없는 건 404 아님');
  }

  // 4) 아카이브 대상 판정: 오래된 완료/취소만, 최근·대기건은 제외
  {
    const cutoff = archiveCutoffWeekStart(new Date('2026-09-17T00:00:00+09:00'));
    assert.ok(isArchivableRequest({ status: 'completed', weekStart: '2026-06-10' }, cutoff), '오래된 완료 미아카이브');
    assert.ok(isArchivableRequest({ status: 'cancelled', weekStart: '2026-06-10' }, cutoff), '오래된 취소 미아카이브');
    assert.ok(!isArchivableRequest({ status: 'pending', weekStart: '2026-06-10' }, cutoff), '대기건이 아카이브됨');
    assert.ok(!isArchivableRequest({ status: 'completed', weekStart: '2026-09-16' }, cutoff), '최근 완료가 아카이브됨');
  }

  console.log('OK: 출금 CAS·대량완료 동치·아카이브 판정 통과');
})().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
