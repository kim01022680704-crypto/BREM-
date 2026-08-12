/**
 * 배민Biz 자동 로그인 (아이디/비번) — env 자격증명이 있을 때만 사용
 * 없으면 세션 서버가 수동 대기(페이지 미변경)
 * 휴대폰 인증은 항상 수동 — needsPhoneAuth 로 반환
 * env: BAEMIN_BIZ_LOGIN_ID, BAEMIN_BIZ_LOGIN_PASSWORD
 */
const { isBaeminLoginLikeUrl, isBaeminPhoneAuthLikeUrl, isBaeminAppWorkingUrl } = require('./crawl-session-auth');

const BAEMIN_DELIVERY_ORIGIN = 'https://deliverycenter.baemin.com';
// 실제 로그인 호스트는 biz-member (하이픈). bizmember 도메인은 쓰지 않음.
const BAEMIN_BIZ_LOGIN_URL = 'https://biz-member.baemin.com/login';

function getBaeminBizCredentials() {
  const id = String(
    process.env.BAEMIN_BIZ_LOGIN_ID
    || process.env.BAEMIN_LOGIN_ID
    || process.env.BAEMIN_USER_ID
    || ''
  ).trim();
  const password = String(
    process.env.BAEMIN_BIZ_LOGIN_PASSWORD
    || process.env.BAEMIN_LOGIN_PASSWORD
    || process.env.BAEMIN_PASSWORD
    || ''
  );
  return { id, password, configured: Boolean(id && password) };
}

async function clearThenFill(page, loc, value) {
  const want = String(value || '');
  await loc.click({ timeout: 5000, force: true }).catch(() => {});
  await page.keyboard.press('Control+A').catch(() => {});
  await page.keyboard.press('Delete').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await loc.fill('').catch(() => {});
  await loc.evaluate((el) => {
    el.focus();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }).catch(() => {});
  await loc.click({ clickCount: 3, force: true }).catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await loc.fill(want).catch(async () => {
    await loc.click({ force: true }).catch(() => {});
    await page.keyboard.type(want, { delay: 25 }).catch(() => {});
  });
  let got = String(await loc.inputValue().catch(() => '') || '');
  if (got !== want) {
    await loc.click({ clickCount: 3, force: true }).catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await loc.fill('').catch(() => {});
    await loc.fill(want).catch(async () => {
      await page.keyboard.type(want, { delay: 20 }).catch(() => {});
    });
  }
}

async function fillBaeminLoginForm(page, id, password) {
  const idSelectors = [
    'input[name="id"]',
    'input[name="username"]',
    'input[name="email"]',
    'input[type="email"]',
    'input[placeholder*="아이디"]',
    'input[placeholder*="이메일"]',
    'input[autocomplete="username"]',
    'input[type="text"]'
  ];
  const pwSelectors = [
    'input[name="password"]',
    'input[type="password"]',
    'input[placeholder*="비밀번호"]',
    'input[autocomplete="current-password"]'
  ];

  await page.waitForTimeout(800).catch(() => {});
  let filledId = false;
  for (const selector of idSelectors) {
    const loc = page.locator(selector).first();
    if (!(await loc.count().catch(() => 0))) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    const typ = String(await loc.getAttribute('type').catch(() => '') || '').toLowerCase();
    if (typ === 'password') continue;
    await clearThenFill(page, loc, id);
    filledId = true;
    break;
  }
  let filledPw = false;
  for (const selector of pwSelectors) {
    const loc = page.locator(selector).first();
    if (!(await loc.count().catch(() => 0))) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await clearThenFill(page, loc, password);
    filledPw = true;
    break;
  }
  if (!filledId || !filledPw) {
    return { ok: false, message: '배민 로그인 입력칸을 찾지 못했습니다.' };
  }

  const submit = page.locator(
    'button[type="submit"], button:has-text("로그인"), input[type="submit"]'
  ).first();
  if (await submit.count().catch(() => 0)) {
    await submit.click({ timeout: 8000 }).catch(() => {});
  } else {
    await page.keyboard.press('Enter').catch(() => {});
  }
  return { ok: true };
}

/**
 * @param {import('playwright').Page} page
 * @param {{ origin?: string }} [options]
 */
async function autoLoginBaeminBiz(page, options = {}) {
  const creds = getBaeminBizCredentials();
  if (!creds.configured) {
    return {
      ok: false,
      error: 'CREDENTIALS_MISSING',
      message: 'BAEMIN_BIZ_LOGIN_ID / BAEMIN_BIZ_LOGIN_PASSWORD 를 PC .env 에 설정하세요.'
    };
  }
  if (!page) {
    return { ok: false, message: '배민 브라우저 페이지가 없습니다.' };
  }

  try {
    let url = String(page.url() || '');
    if (isBaeminAppWorkingUrl(url)) {
      return { ok: true, alreadyLoggedIn: true };
    }
    if (isBaeminPhoneAuthLikeUrl(url)) {
      return { ok: true, needsPhoneAuth: true, message: '휴대폰 인증 대기 중' };
    }

    // 최소 경로: 지금 떠 있는 비즈 로그인 화면을 우선 사용.
    // 로그인 폼이 아니면 bizmember 로그인만 연다 (deliverycenter 우회 없음).
    const onBizLogin = /biz-?member\.baemin\.com/i.test(url)
      || isBaeminLoginLikeUrl(url)
      || Boolean(await page.locator('input[type="password"]').count().catch(() => 0));
    if (!onBizLogin) {
      await page.goto(BAEMIN_BIZ_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
      await page.waitForTimeout(1500);
      url = String(page.url() || '');
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500).catch(() => {});

    // 아이디/비번만 채우고 로그인 클릭 → 이후 휴대폰은 수동
    let filled = await fillBaeminLoginForm(page, creds.id, creds.password);
    if (!filled.ok) {
      await page.goto(BAEMIN_BIZ_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
      await page.waitForTimeout(1500);
      filled = await fillBaeminLoginForm(page, creds.id, creds.password);
      if (!filled.ok) return filled;
    }

    await page.waitForTimeout(3000);
    url = String(page.url() || '');
    const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');

    if (
      isBaeminPhoneAuthLikeUrl(url)
      || /휴대폰|인증번호|인증\s*코드|SMS/i.test(bodyText)
    ) {
      return {
        ok: true,
        needsPhoneAuth: true,
        via: 'password',
        message: '아이디/비번 로그인 완료 — 휴대폰 인증번호를 직접 입력해 주세요',
        currentUrl: url
      };
    }
    if (isBaeminAppWorkingUrl(url)) {
      return { ok: true, via: 'password', alreadyLoggedIn: false, currentUrl: url };
    }
    // 로그인 직후 화면 전환 중이면 휴대폰/업무 화면 대기 (추가 네비게이션 없음)
    return {
      ok: true,
      needsPhoneAuth: true,
      via: 'password',
      message: '아이디/비번 제출 완료 — 휴대폰 인증이 뜨면 직접 입력해 주세요',
      currentUrl: url
    };
  } catch (error) {
    return { ok: false, message: error?.message || String(error) };
  }
}

module.exports = {
  getBaeminBizCredentials,
  autoLoginBaeminBiz,
  fillBaeminLoginForm,
  BAEMIN_BIZ_LOGIN_URL,
  BAEMIN_DELIVERY_ORIGIN
};
