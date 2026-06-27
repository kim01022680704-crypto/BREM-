#!/usr/bin/env node
/**
 * Full ERP password regression — brem.kr
 * Admin: 김형진 / 1850912
 * Rider: 김형진0704 / 123456
 */

const BASE = 'https://brem.kr';
const ADMIN = { login: '김형진', password: '1850912' };
const RIDER = { login: '김형진0704', password: '123456', badPassword: '1234' };

let passed = 0;
let failed = 0;
let riderId = '';
let adminToken = '';

function pass(label) {
  console.log(`  [PASS] ${label}`);
  passed += 1;
}

function fail(label, detail = '') {
  console.error(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
  failed += 1;
}

async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { ok: res.ok, status: res.status, json, text };
}

async function get(url, headers = {}) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { ok: res.ok, status: res.status, json, text };
}

async function assertRiderPassword(label) {
  const good = await post(`${BASE}/api/rider/sign-in`, {
    login: RIDER.login,
    password: RIDER.password
  });
  const bad = await post(`${BASE}/api/rider/sign-in`, {
    login: RIDER.login,
    password: RIDER.badPassword
  });
  if (good.ok && good.json?.session) pass(`${label}: ${RIDER.password} login OK`);
  else fail(`${label}: ${RIDER.password} login`, good.text?.slice(0, 120));
  if (!bad.ok) pass(`${label}: ${RIDER.badPassword} rejected`);
  else fail(`${label}: ${RIDER.badPassword} must stay rejected`);
}

async function adminLogin() {
  const r = await post(`${BASE}/api/admin/sign-in`, ADMIN);
  if (!r.ok || !r.json?.session?.access_token) {
    fail('admin login', r.text?.slice(0, 160));
    return false;
  }
  adminToken = r.json.session.access_token;
  pass('admin login');
  return true;
}

function auth() {
  return { Authorization: `Bearer ${adminToken}` };
}

async function fetchRiderRow() {
  const r = await get(`${BASE}/api/admin/riders?limit=50&search=${encodeURIComponent('김형진')}`, auth());
  if (!r.ok) {
    fail('fetch rider row', r.text?.slice(0, 120));
    return null;
  }
  const row = (r.json?.riders || []).find(item => String(item.phone || '').endsWith('0704'))
    || (r.json?.riders || [])[0];
  if (!row?.id) {
    fail('find rider row');
    return null;
  }
  riderId = row.id;
  return row;
}

async function runScenario(name, fn) {
  console.log(`\n▶ ${name}`);
  try {
    await fn();
    await assertRiderPassword(`after ${name}`);
  } catch (err) {
    fail(name, err.message || String(err));
    await assertRiderPassword(`after ${name} (error path)`);
  }
}

async function main() {
  console.log('=== ERP password regression (production) ===');
  console.log(`Base: ${BASE}`);

  console.log('\n▶ Baseline');
  if (!(await adminLogin())) process.exit(1);
  const row = await fetchRiderRow();
  if (!row) process.exit(1);
  pass(`rider row ${riderId}`);
  await assertRiderPassword('baseline');

  await runScenario('라이더 반영 (POST /api/admin/rider-view/publish)', async () => {
    const r = await post(`${BASE}/api/admin/rider-view/publish`, { publishedBy: 'pw-test' }, auth());
    if (r.ok) pass('rider-view publish API');
    else fail('rider-view publish', r.text?.slice(0, 160));
  });

  await runScenario('실시간 미션 관리 (POST /api/admin/riders/missions/bulk)', async () => {
    const missions = await get(`${BASE}/api/admin/missions/status`, auth());
    let missionId = '';
    if (missions.ok && missions.json?.missions?.length) {
      missionId = missions.json.missions[0].id;
    }
    const r = await post(`${BASE}/api/admin/riders/missions/bulk`, {
      patches: [{
        id: riderId,
        selectedMissionIdCoupang: missionId || '',
        selectedMissionIdBaemin: ''
      }]
    }, auth());
    if (r.ok) pass(`missions bulk updated=${r.json?.updated ?? '?'}`);
    else fail('missions bulk', r.text?.slice(0, 160));
  });

  await runScenario('장기이벤트 등록 (POST /api/admin/riders/long-events/bulk)', async () => {
    const r = await post(`${BASE}/api/admin/riders/long-events/bulk`, {
      patches: [{
        id: riderId,
        longEventItemId: row.long_event_item_id || '',
        longEventItem: row.long_event_item || 'pw-test-event',
        longEventStartDate: row.long_event_start_date || '2024-06-01',
        longEventPlatform: row.long_event_platform || 'coupang'
      }]
    }, auth());
    if (r.ok) pass(`long-events bulk updated=${r.json?.updated ?? '?'}`);
    else fail('long-events bulk', r.text?.slice(0, 160));
  });

  await runScenario('기사관리 단건 저장 (stale password=1234)', async () => {
    const r = await post(`${BASE}/api/admin/riders`, {
      rider: {
        id: riderId,
        name: row.name || '김형진',
        phone: row.phone,
        password: '1234',
        memo: `pw-manage-${Date.now()}`,
        platformCoupang: row.platform_coupang !== false,
        platformBaemin: Boolean(row.platform_baemin),
        baeminId: row.baemin_id || '',
        status: row.status || '근무중'
      }
    }, auth());
    if (r.ok) pass('rider-manage upsert');
    else fail('rider-manage upsert', r.text?.slice(0, 160));
  });

  await runScenario('기사 일괄 저장 (bulk, stale password=1234)', async () => {
    const r = await post(`${BASE}/api/admin/riders/bulk`, {
      riders: [{
        id: riderId,
        name: row.name || '김형진',
        phone: row.phone,
        password: '1234',
        memo: `pw-bulk-${Date.now()}`,
        platformCoupang: true,
        platformBaemin: false,
        status: '근무중'
      }],
      skipAuthProvision: true
    }, auth());
    if (r.ok) pass(`bulk upsert succeeded=${r.json?.succeeded ?? '?'}`);
    else fail('bulk upsert', r.text?.slice(0, 160));
  });

  await runScenario('프로모션 선택 저장 시뮬 (promotion_selector + stale password)', async () => {
    const r = await post(`${BASE}/api/admin/riders`, {
      rider: {
        id: riderId,
        name: row.name || '김형진',
        phone: row.phone,
        password: '1234',
        promotionSelectorCoupang: row.promotion_selector_coupang || 'default',
        platformCoupang: true,
        platformBaemin: Boolean(row.platform_baemin),
        status: row.status || '근무중'
      }
    }, auth());
    if (r.ok) pass('promotion selector upsert');
    else fail('promotion selector upsert', r.text?.slice(0, 160));
  });

  await runScenario('기사관리 수정 저장 (password 필드 없음 — 패치 후 클라이언트)', async () => {
    const r = await post(`${BASE}/api/admin/riders`, {
      rider: {
        id: riderId,
        name: row.name || '김형진',
        phone: row.phone,
        memo: `pw-no-password-field-${Date.now()}`,
        bankName: row.bank_name || '',
        platformCoupang: true,
        platformBaemin: Boolean(row.platform_baemin),
        status: row.status || '근무중'
      }
    }, auth());
    if (r.ok) pass('edit save without password field');
    else fail('edit save without password', r.text?.slice(0, 160));
  });

  await runScenario('주민번호 가리기 저장 시뮬 (hiddenFields + stale password)', async () => {
    const r = await post(`${BASE}/api/admin/riders`, {
      rider: {
        id: riderId,
        name: row.name || '김형진',
        phone: row.phone,
        password: '1234',
        hiddenFields: { ...(row.hidden_fields || {}), accountNumber: true },
        platformCoupang: true,
        status: row.status || '근무중'
      }
    }, auth());
    if (r.ok) pass('hiddenFields upsert');
    else fail('hiddenFields upsert', r.text?.slice(0, 160));
  });

  await runScenario('라이더 반영 2회 연속 (재반영)', async () => {
    for (let i = 0; i < 2; i += 1) {
      const r = await post(`${BASE}/api/admin/rider-view/publish`, {}, auth());
      if (!r.ok) {
        fail(`rider-view publish #${i + 1}`, r.text?.slice(0, 120));
        return;
      }
    }
    pass('rider-view publish x2');
  });

  console.log('\n=== Deployed assets ===');
  const driverHtml = await (await fetch(`${BASE}/driver.html`)).text();
  const manageHtml = await (await fetch(`${BASE}/rider-manage.html?register=1`)).text();
  if (driverHtml.includes('storage.js?v=20260622q')) pass('driver.html storage v=20260622q');
  else fail('driver.html storage version');
  if (manageHtml.includes('app.js?v=20260627a') || manageHtml.includes('app.js?v=20260622r')) {
    pass('rider-manage app.js deployed');
  } else fail('rider-manage app.js version');

  console.log(`\n========================================`);
  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  console.log(`========================================`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
