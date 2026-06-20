/**
 * Playwright 배민Biz 로그인 세션 테스트 (로컬 전용)
 * Run: npm install playwright && node scripts/test-baemin-playwright-login.js
 *
 * 환경변수:
 *   BAEMIN_BIZ_LOGIN_ID
 *   BAEMIN_BIZ_LOGIN_PASSWORD
 */
require('dotenv').config();

const {
  fetchAllDeliveryStatus,
  isPlaywrightFeasibleOnVercel
} = require('../server/baemin-delivery-collect');

async function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== Vercel Playwright feasibility ===');
  console.log(JSON.stringify(isPlaywrightFeasibleOnVercel(), null, 2));

  const loginId = String(process.env.BAEMIN_BIZ_LOGIN_ID || '').trim();
  const loginPassword = String(process.env.BAEMIN_BIZ_LOGIN_PASSWORD || '').trim();
  if (!loginId || !loginPassword) {
    console.error('\nSKIP: BAEMIN_BIZ_LOGIN_ID / BAEMIN_BIZ_LOGIN_PASSWORD 가 없습니다.');
    process.exit(0);
  }

  const playwright = await loadPlaywright();
  if (!playwright) {
    console.error('\nSKIP: playwright 패키지가 없습니다. npm install playwright 후 다시 실행하세요.');
    process.exit(0);
  }

  console.log('\n=== Playwright login test ===');
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://deliverycenter.baemin.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    const idSelector = 'input[type="text"], input[name="id"], input[name="username"], input[placeholder*="아이디"]';
    const pwSelector = 'input[type="password"]';
    await page.waitForSelector(idSelector, { timeout: 15000 });
    await page.fill(idSelector, loginId);
    await page.fill(pwSelector, loginPassword);

    const submit = page.locator('button[type="submit"], button:has-text("로그인")').first();
    await submit.click();
    await page.waitForTimeout(5000);

    const cookies = await context.cookies('https://deliverycenter.baemin.com');
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    if (!cookieHeader) {
      console.error('FAIL: 로그인 후 쿠키를 얻지 못했습니다. 배민 로그인 UI가 변경되었을 수 있습니다.');
      process.exit(1);
    }

    console.log('Login cookies obtained:', cookies.length, 'items');
    console.log('Set BAEMIN_BIZ_SESSION_COOKIE in Vercel with the cookie header value.\n');

    const apiResult = await fetchAllDeliveryStatus(cookieHeader);
    if (!apiResult.ok) {
      console.error('API after login FAIL:', apiResult.message || apiResult.error);
      process.exit(1);
    }

    console.log('API after login OK');
    console.log('  totalPage:', apiResult.meta?.totalPage);
    console.log('  unique riders:', apiResult.items.length);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
