/* eslint-disable no-console */
require('dotenv').config();

async function main() {
  const base = process.env.BREM_TEST_BASE || 'https://brem.kr';
  const login = process.env.BREM_TEST_LOGIN || process.env.BREM_ADMIN_LOGIN;
  const password = process.env.BREM_TEST_PASSWORD || process.env.BREM_ADMIN_PASSWORD;
  const dryRun = process.argv.includes('--dry-run');

  if (!login || !password) {
    console.error('Set BREM_TEST_LOGIN and BREM_TEST_PASSWORD (or BREM_ADMIN_LOGIN / BREM_ADMIN_PASSWORD).');
    process.exit(1);
  }

  const signInRes = await fetch(`${base}/api/admin/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  const signIn = await signInRes.json().catch(() => ({}));
  const token = signIn.session?.access_token;
  if (!token) {
    console.error('sign-in failed', signInRes.status, signIn.error || signIn);
    process.exit(1);
  }

  const mergeRes = await fetch(`${base}/api/admin/riders/merge-duplicates`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ dryRun })
  });
  const body = await mergeRes.json().catch(() => ({}));
  console.log(JSON.stringify(body, null, 2));

  if (!mergeRes.ok || body.ok === false) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
