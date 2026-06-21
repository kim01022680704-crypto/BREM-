/* eslint-disable no-console */
require('dotenv').config();

async function api(base, token, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function main() {
  const base = process.env.BREM_TEST_BASE || 'https://brem.kr';
  const login = process.env.BREM_TEST_LOGIN || '김형진';
  const password = process.env.BREM_TEST_PASSWORD || '123456';

  const signInRes = await fetch(`${base}/api/admin/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  const signIn = await signInRes.json().catch(() => ({}));
  console.log('sign-in', signInRes.status, signIn.error || 'ok');
  const token = signIn.session?.access_token;
  if (!token) process.exit(1);

  const countBefore = await api(base, token, '/api/admin/riders/count');
  console.log('count before', countBefore.status, countBefore.body);

  const listRes = await api(base, token, '/api/admin/riders?limit=200&offset=0');
  const riders = listRes.body.riders || [];
  console.log('list page', listRes.status, 'rows=', riders.length, 'total=', listRes.body.total, 'hasMore=', listRes.body.hasMore);

  const riderId = `test-${Date.now()}`;
  const rider = {
    id: riderId,
    name: 'API테스트기사',
    phone: '01055554444',
    password: '1234',
    joinDate: '2026-06-19',
    status: '근무중',
    platformCoupang: true,
    platformBaemin: false,
    hiddenFields: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const postRes = await api(base, token, '/api/admin/riders', {
    method: 'POST',
    body: JSON.stringify({ rider })
  });
  console.log('post rider', postRes.status, postRes.body.error || postRes.body.rider?.id || postRes.body);

  const bulkRes = await api(base, token, '/api/admin/riders/bulk', {
    method: 'POST',
    body: JSON.stringify({
      riders: [{
        ...rider,
        id: riderId,
        phone: '010-5555-4444',
        baeminId: 'test-baemin-001'
      }],
      skipAuthProvision: true,
      maxBatch: 150
    })
  });
  console.log('bulk upsert same name+phone', bulkRes.status, bulkRes.body);

  const countAfter = await api(base, token, '/api/admin/riders/count');
  console.log('count after upsert', countAfter.status, countAfter.body);

  const delRes = await api(base, token, `/api/admin/riders/${encodeURIComponent(riderId)}`, {
    method: 'DELETE'
  });
  console.log('delete one', delRes.status, delRes.body.error || 'ok');

  const countFinal = await api(base, token, '/api/admin/riders/count');
  console.log('count after delete one', countFinal.status, countFinal.body);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
