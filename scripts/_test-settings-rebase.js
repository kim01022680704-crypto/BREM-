#!/usr/bin/env node
/**
 * settings JSON 동시 저장 테스트 (가짜 DB, 실제 DB 안 건드림)
 *
 * 탭 A·B 가 같은 기타지급 저장소를 오래된 캐시로 들고 있을 때,
 * 둘 다 저장해도 서로의 금액이 지워지지 않는지 확인한다.
 *   node scripts/_test-settings-rebase.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KEY = 'brem_admin_direct_settlement_adjustments_v1';

function createFakeDb(initial) {
  const rows = new Map();
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 4, 0, 0, 0, ++tick)).toISOString();
  if (initial !== undefined) rows.set(KEY, { value: JSON.parse(JSON.stringify(initial)), updated_at: stamp() });
  const hooks = { beforeUpdate: null };

  function from(table) {
    assert.strictEqual(table, 'settings');
    const filters = [];
    let mode = 'select';
    let payload = null;
    const matches = row => filters.every(([col, op, val]) => {
      const cur = col === 'key' ? row.key : row[col];
      return op === 'is' ? cur === val : cur === val;
    });
    const list = () => [...rows.entries()].map(([key, r]) => ({ key, ...r })).filter(matches);
    const api = {
      select() { return api; },
      eq(col, val) { filters.push([col, 'eq', val]); return api; },
      is(col, val) { filters.push([col, 'is', val]); return api; },
      update(next) { mode = 'update'; payload = next; return api; },
      async maybeSingle() {
        const found = list()[0];
        return { data: found ? { value: JSON.parse(JSON.stringify(found.value)), updated_at: found.updated_at } : null, error: null };
      },
      async insert(row) {
        if (rows.has(row.key)) return { error: { code: '23505', message: 'duplicate' } };
        rows.set(row.key, { value: JSON.parse(JSON.stringify(row.value)), updated_at: stamp() });
        return { error: null };
      },
      async upsert(row) {
        rows.set(row.key, { value: JSON.parse(JSON.stringify(row.value)), updated_at: stamp() });
        return { error: null };
      },
      then(resolve, reject) {
        (async () => {
          if (mode === 'update') {
            if (hooks.beforeUpdate) { const h = hooks.beforeUpdate; hooks.beforeUpdate = null; await h(); }
            const hit = list();
            hit.forEach(r => rows.set(r.key, { value: JSON.parse(JSON.stringify(payload.value)), updated_at: stamp() }));
            return { data: hit.map(r => ({ key: r.key })), error: null };
          }
          return { data: list(), error: null };
        })().then(resolve, reject);
      }
    };
    return api;
  }
  return { client: { from }, rows, hooks, read: () => JSON.parse(JSON.stringify(rows.get(KEY)?.value ?? null)) };
}

function loadAdapterFactory() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'storage-supabase-adapter.js'), 'utf8');
  const sandbox = {
    window: { BREM_SUPABASE_CONFIG: { mode: 'production' } },
    document: { dispatchEvent() {} },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    console, setTimeout, clearTimeout, Promise, Date, Math, JSON
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.BremSupabaseStorageAdapter.createSupabaseAdapter;
}

// storage.js applyEntries 와 같은 규칙의 변경 함수
function applyOp(kind, settlementId, entries, options = {}) {
  return raw => {
    const next = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const byKind = { ...(next[kind] || {}) };
    let existing = options.replace ? {} : { ...(byKind[settlementId] || {}) };
    if (typeof options.dropWhere === 'function') {
      existing = Object.fromEntries(Object.entries(existing).filter(([id, item]) => !options.dropWhere(item, id)));
    }
    entries.forEach(e => {
      const prev = existing[e.driverId];
      existing[e.driverId] = {
        amount: options.add ? Math.round(Number(prev?.amount || 0)) + e.amount : e.amount,
        source: e.source || prev?.source || 'excel'
      };
    });
    byKind[settlementId] = existing;
    next[kind] = byKind;
    return next;
  };
}

function removeOp(kind, settlementId, driverId) {
  return raw => {
    const next = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    if (next[kind]?.[settlementId]) delete next[kind][settlementId][driverId];
    return next;
  };
}

// 한 탭: 자기 캐시에 적용하고, 변경 함수와 함께 저장 큐에 넣는다.
function makeTab(createAdapter, db, keys, initialCache) {
  const adapter = createAdapter(db.client, keys);
  adapter.stage(KEY, JSON.parse(JSON.stringify(initialCache)));
  return {
    adapter,
    async commit(op, options = {}) {
      const next = op(adapter.read(KEY, {}));
      adapter.stage(KEY, next);
      await adapter.enqueuePersist(KEY, next, { ...options, rebaseOps: [op] });
    },
    async blind(value) {
      await adapter.enqueuePersist(KEY, value, {});
    }
  };
}

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(['ok', name]); } catch (error) { results.push(['FAIL', name, error]); }
}

(async () => {
  const createAdapter = loadAdapterFactory();
  const keys = { directSettlementAdjustments: KEY };
  const S = 'weekly_direct_baemin_test_20260923';
  const base = { other: { [S]: { d1: { amount: 1000, source: 'excel' } } } };

  await test('예전 방식(전체 덮어쓰기)은 다른 탭의 일괄등록을 지운다 — 재현', async () => {
    const db = createFakeDb(base);
    const a = makeTab(createAdapter, db, keys, base);
    const b = makeTab(createAdapter, db, keys, base);
    await a.commit(applyOp('other', S, [{ driverId: 'bulk1', amount: 50000 }, { driverId: 'bulk2', amount: 30000 }], { add: true }));
    const stale = applyOp('other', S, [{ driverId: 'neg1', amount: 777 }], { add: true })(JSON.parse(JSON.stringify(base)));
    await b.blind(stale);
    assert.strictEqual(db.read().other[S].bulk1, undefined, '재현 실패: 덮어쓰기가 일어나지 않음');
  });

  await test('일괄등록(탭 A) 후 오래된 탭 B의 마이너스 맞추기 → 둘 다 남는다', async () => {
    const db = createFakeDb(base);
    const a = makeTab(createAdapter, db, keys, base);
    const b = makeTab(createAdapter, db, keys, base);
    await a.commit(applyOp('other', S, [{ driverId: 'bulk1', amount: 50000 }, { driverId: 'bulk2', amount: 30000 }], { add: true }));
    await b.commit(applyOp('other', S, [{ driverId: 'neg1', amount: 777 }, { driverId: 'bulk1', amount: 123 }], { add: true }));
    const other = db.read().other[S];
    assert.strictEqual(other.d1.amount, 1000);
    assert.strictEqual(other.bulk2.amount, 30000);
    assert.strictEqual(other.neg1.amount, 777);
    assert.strictEqual(other.bulk1.amount, 50123, '마이너스 그로스업은 일괄등록 금액 위에 더해져야 함');
    assert.strictEqual(b.adapter.read(KEY).other[S].bulk2.amount, 30000, '저장 후 탭 B 캐시도 최신값이어야 함');
  });

  await test('읽기와 쓰기 사이에 다른 탭이 저장하면 다시 읽고 합친다', async () => {
    const db = createFakeDb(base);
    const a = makeTab(createAdapter, db, keys, base);
    const b = makeTab(createAdapter, db, keys, base);
    db.hooks.beforeUpdate = () => a.commit(applyOp('other', S, [{ driverId: 'bulkA', amount: 9000 }], { add: true }));
    await b.commit(applyOp('other', S, [{ driverId: 'popupB', amount: 4000 }]));
    const other = db.read().other[S];
    assert.strictEqual(other.bulkA.amount, 9000);
    assert.strictEqual(other.popupB.amount, 4000);
  });

  await test('삭제도 서버 최신값 기준 — 다른 기사 금액은 그대로', async () => {
    const db = createFakeDb(base);
    const a = makeTab(createAdapter, db, keys, base);
    const b = makeTab(createAdapter, db, keys, base);
    await a.commit(applyOp('other', S, [{ driverId: 'bulk1', amount: 50000 }], { add: true }));
    await b.commit(removeOp('other', S, 'd1'), { allowEmpty: true });
    const other = db.read().other[S];
    assert.strictEqual(other.d1, undefined);
    assert.strictEqual(other.bulk1.amount, 50000);
  });

  await test('ERP 적용(dropWhere)은 다른 탭이 넣은 엑셀 프로모션을 지우지 않는다', async () => {
    const promoBase = { promotion: { [S]: { oldErp: { amount: 100, source: 'erp' }, declined: { amount: 200, source: 'erp' } } } };
    const db = createFakeDb(promoBase);
    const a = makeTab(createAdapter, db, keys, promoBase);
    const b = makeTab(createAdapter, db, keys, promoBase);
    await a.commit(applyOp('promotion', S, [{ driverId: 'excelNew', amount: 7000, source: 'excel' }], { add: true }));
    const declined = new Set(['declined']);
    await b.commit(applyOp('promotion', S, [{ driverId: 'erpNew', amount: 300, source: 'erp' }], {
      dropWhere: (item, id) => item?.source === 'erp' && !declined.has(id)
    }));
    const promo = db.read().promotion[S];
    assert.strictEqual(promo.excelNew.amount, 7000);
    assert.strictEqual(promo.erpNew.amount, 300);
    assert.strictEqual(promo.declined.amount, 200);
    assert.strictEqual(promo.oldErp, undefined);
  });

  await test('같은 탭에서 연달아 저장(큐 합치기)해도 모든 변경이 들어간다', async () => {
    const db = createFakeDb(base);
    const a = makeTab(createAdapter, db, keys, base);
    const p1 = a.commit(applyOp('other', S, [{ driverId: 'x1', amount: 1 }], { add: true }));
    const p2 = a.commit(applyOp('other', S, [{ driverId: 'x2', amount: 2 }], { add: true }));
    const p3 = a.commit(applyOp('other', S, [{ driverId: 'x1', amount: 10 }], { add: true }));
    await Promise.all([p1, p2, p3]);
    const other = db.read().other[S];
    assert.strictEqual(other.x1.amount, 11);
    assert.strictEqual(other.x2.amount, 2);
  });

  await test('서버에 키가 아직 없으면 새로 만든다', async () => {
    const db = createFakeDb(undefined);
    const a = makeTab(createAdapter, db, keys, {});
    await a.commit(applyOp('other', S, [{ driverId: 'first', amount: 5 }], { add: true }));
    assert.strictEqual(db.read().other[S].first.amount, 5);
  });

  results.forEach(([status, name, error]) => {
    console.log(`${status === 'ok' ? '✔' : '✘'} ${name}${error ? `\n    ${error.message}` : ''}`);
  });
  if (results.some(([status]) => status !== 'ok')) process.exit(1);
})();
