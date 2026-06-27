#!/usr/bin/env node
/** Production password regression tests for brem.kr */

const BASE = process.env.BREM_TEST_BASE || 'https://brem.kr';
const LOGIN = process.env.BREM_TEST_RIDER_LOGIN || '김형진0704';
const ADMIN_LOGIN = process.env.BREM_TEST_ADMIN_LOGIN || '김형진';
const ADMIN_PASSWORD = process.env.BREM_TEST_ADMIN_PASSWORD || '1850912';
const RIDER_PASSWORD = process.env.BREM_TEST_RIDER_PASSWORD || '123456';

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`[PASS] ${label}`);
  passed += 1;
}

function fail(label, detail = '') {
  console.error(`[FAIL] ${label}${detail ? ` - ${detail}` : ''}`);
  failed += 1;
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json, text };
}

async function riderLogin(password, label) {
  const r = await postJson(`${BASE}/api/rider/sign-in`, { login: LOGIN, password });
  if (r.ok && r.json?.session?.access_token) {
    pass(label);
    return r.json;
  }
  fail(label, `HTTP ${r.status} ${r.text?.slice(0, 160)}`);
  return null;
}

async function main() {
  console.log('\n=== 1. Rider baseline ===');
  const riderBefore = await riderLogin(RIDER_PASSWORD, `rider login ${RIDER_PASSWORD}`);
  const old1234 = await postJson(`${BASE}/api/rider/sign-in`, { login: LOGIN, password: '1234' });
  if (!old1234.ok) pass('rider login 1234 rejected (expected)');
  else fail('rider login 1234 should be rejected');

  const riderId = riderBefore?.riderId || riderBefore?.rider?.id;
  if (!riderId) {
    fail('rider id missing');
    process.exit(1);
  }
  console.log(`riderId=${riderId}`);

  console.log('\n=== 2. Admin login (김형진) ===');
  const admin = await postJson(`${BASE}/api/admin/sign-in`, {
    login: ADMIN_LOGIN,
    password: ADMIN_PASSWORD
  });
  if (!admin.ok || !admin.json?.session?.access_token) {
    fail('admin login', admin.text?.slice(0, 200));
    console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
    process.exit(1);
  }
  pass('admin login');
  const adminToken = admin.json.session.access_token;

  console.log('\n=== 3. Admin rider list ===');
  const listRes = await fetch(`${BASE}/api/admin/riders?limit=200&search=${encodeURIComponent('김형진')}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const list = await listRes.json().catch(() => ({}));
  if (!listRes.ok) fail('admin rider list', JSON.stringify(list).slice(0, 200));
  else pass(`admin rider list (${(list.riders || []).length} rows)`);

  const row = (list.riders || []).find(r => String(r.phone || '').endsWith('0704')) || (list.riders || [])[0];
  if (!row) fail('find rider row in admin list');
  else pass(`found rider row id=${row.id}`);

  console.log('\n=== 4. 기사관리 저장 시뮬레이션 (stale password=1234 포함) ===');
  const upsert = await postJson(`${BASE}/api/admin/riders`, {
    rider: {
      id: row?.id || riderId,
      name: row?.name || '김형진',
      phone: row?.phone || '01022680704',
      password: '1234',
      memo: `pw-regression-${Date.now()}`,
      platformCoupang: row?.platform_coupang !== false,
      platformBaemin: Boolean(row?.platform_baemin),
      baeminId: row?.baemin_id || '',
      status: row?.status || '근무중',
      joinDate: row?.join_date || '2024-01-01'
    }
  }, { Authorization: `Bearer ${adminToken}` });

  if (upsert.ok) pass('admin upsert with password=1234 in body (rider-manage simulation)');
  else fail('admin upsert simulation', upsert.text?.slice(0, 200));

  await new Promise(r => setTimeout(r, 1000));

  console.log('\n=== 5. Rider login after admin save ===');
  await riderLogin(RIDER_PASSWORD, `rider login ${RIDER_PASSWORD} after admin save (must work)`);
  const oldAfter = await postJson(`${BASE}/api/rider/sign-in`, { login: LOGIN, password: '1234' });
  if (!oldAfter.ok) pass('rider login 1234 still rejected after admin save');
  else fail('admin save reset password to 1234');

  console.log('\n=== 6. Bulk upsert simulation ===');
  const bulk = await postJson(`${BASE}/api/admin/riders/bulk`, {
    riders: [{
      id: row?.id || riderId,
      name: row?.name || '김형진',
      phone: row?.phone || '01022680704',
      password: '1234',
      memo: `pw-bulk-${Date.now()}`,
      platformCoupang: true,
      platformBaemin: false,
      status: '근무중'
    }],
    skipAuthProvision: true
  }, { Authorization: `Bearer ${adminToken}` });
  if (bulk.ok) pass('bulk upsert with password=1234');
  else fail('bulk upsert simulation', bulk.text?.slice(0, 200));

  await new Promise(r => setTimeout(r, 1000));
  await riderLogin(RIDER_PASSWORD, `rider login ${RIDER_PASSWORD} after bulk save (must work)`);

  console.log('\n=== 7. Deployed assets ===');
  const html = await (await fetch(`${BASE}/driver.html`)).text();
  const manageHtml = await (await fetch(`${BASE}/rider-manage.html?register=1`)).text();
  if (html.includes('storage.js?v=20260622q')) pass('driver.html hotfix storage.js v=20260622q');
  else fail('driver.html storage version', 'expected 20260622q');
  if (manageHtml.includes('app.js?v=20260622r')) pass('rider-manage app.js v=20260622r (password omit fix)');
  else console.log('[INFO] rider-manage app.js v=20260622r not deployed yet (pending push)');

  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
