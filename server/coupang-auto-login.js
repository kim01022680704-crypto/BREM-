/**
 * 쿠팡 파트너 자동 로그인 + 이메일 2FA + 네이버 메일 OTP
 * env: COUPANG_LOGIN_ID, COUPANG_LOGIN_PASSWORD
 *      NAVER_LOGIN_ID, NAVER_LOGIN_PASSWORD
 */
const naverOtp = require('./coupang-naver-otp');
const { isCoupangLoginLikeUrl } = require('./crawl-session-auth');

function getCoupangCredentials() {
  const id = String(process.env.COUPANG_LOGIN_ID || process.env.COUPANG_USER_ID || '').trim();
  const password = String(process.env.COUPANG_LOGIN_PASSWORD || process.env.COUPANG_PASSWORD || '');
  return { id, password, configured: Boolean(id && password) };
}

async function pageLooksLoggedIn(page) {
  if (!page) return false;
  const url = String(page.url() || '').toLowerCase();
  if (/\/page\/|dashboard|rider-performance|peak-dashboard/.test(url) && !isCoupangLoginLikeUrl(url)) {
    return true;
  }
  try {
    const hasLogout = await page.locator('text=로그아웃, text=Logout, a[href*="logout"]').first().count();
    return hasLogout > 0;
  } catch {
    return false;
  }
}

async function fillLoginForm(page, id, password) {
  const idSelectors = [
    'input[name="email"]',
    'input[name="username"]',
    'input[name="id"]',
    'input[type="email"]',
    'input[placeholder*="아이디"]',
    'input[placeholder*="이메일"]',
    'input[placeholder*="ID"]',
    'input[autocomplete="username"]'
  ];
  const pwSelectors = [
    'input[name="password"]',
    'input[type="password"]',
    'input[placeholder*="비밀번호"]',
    'input[autocomplete="current-password"]'
  ];

  let filledId = false;
  for (const selector of idSelectors) {
    const loc = page.locator(selector).first();
    if (!(await loc.count().catch(() => 0))) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.fill('');
    await loc.fill(id);
    filledId = true;
    break;
  }
  let filledPw = false;
  for (const selector of pwSelectors) {
    const loc = page.locator(selector).first();
    if (!(await loc.count().catch(() => 0))) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.fill('');
    await loc.fill(password);
    filledPw = true;
    break;
  }
  if (!filledId || !filledPw) {
    return { ok: false, message: '쿠팡 로그인 입력칸을 찾지 못했습니다.' };
  }

  const submit = page.locator(
    'button[type="submit"], button:has-text("로그인"), button:has-text("Log in"), button:has-text("Sign in")'
  ).first();
  if (await submit.count().catch(() => 0)) {
    await submit.click().catch(() => {});
  } else {
    await page.keyboard.press('Enter').catch(() => {});
  }
  return { ok: true };
}

async function isTwoFactorPage(page) {
  if (!page) return false;
  const url = String(page.url() || '').toLowerCase();
  if (/authenticate|login-actions|otp|2fa|mfa|verify/.test(url)) return true;
  const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  return /2단계\s*인증|인증코드\s*전송|이메일로\s*인증|휴대전화로\s*인증/.test(text);
}

/**
 * 쿠팡 2FA: 이메일 탭 선택 → 인증코드 전송
 */
async function switchToEmailAuthAndSendCode(page) {
  if (!page) return { ok: false, message: '페이지 없음' };

  // 이미 OTP 입력칸이 있으면 전송 생략(재시도)
  const otpInputReady = await page.locator(
    'input[autocomplete="one-time-code"], input[name*="otp" i], input[placeholder*="인증"], input[placeholder*="코드"]'
  ).first().isVisible().catch(() => false);

  // 「이메일로 인증」 탭/버튼
  const emailTabCandidates = [
    'text=이메일로 인증',
    'button:has-text("이메일로 인증")',
    'a:has-text("이메일로 인증")',
    '[role="tab"]:has-text("이메일")',
    'label:has-text("이메일로 인증")',
    'li:has-text("이메일로 인증")'
  ];
  let switched = false;
  for (const selector of emailTabCandidates) {
    const loc = page.locator(selector).first();
    if (!(await loc.count().catch(() => 0))) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.click({ timeout: 5000 }).catch(() => {});
    switched = true;
    await page.waitForTimeout(800);
    break;
  }

  // 클릭이 안 되면 evaluate로 텍스트 노드 탐색
  if (!switched) {
    switched = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('button, a, li, span, div, label, [role="tab"]'));
      const target = nodes.find(el => /이메일로\s*인증/.test((el.textContent || '').trim()));
      if (!target) return false;
      target.click();
      return true;
    }).catch(() => false);
    if (switched) await page.waitForTimeout(800);
  }

  if (otpInputReady) {
    return { ok: true, skippedSend: true, switched };
  }

  // 「인증코드 전송」
  const sendCandidates = [
    'button:has-text("인증코드 전송")',
    'button:has-text("인증 코드 전송")',
    'button:has-text("코드 전송")',
    'button:has-text("전송")'
  ];
  let sent = false;
  for (const selector of sendCandidates) {
    const loc = page.locator(selector).first();
    if (!(await loc.count().catch(() => 0))) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.click({ timeout: 5000 }).catch(() => {});
    sent = true;
    await page.waitForTimeout(1500);
    break;
  }
  if (!sent) {
    sent = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
      const target = buttons.find(el => /인증\s*코드\s*전송|코드\s*전송/.test((el.textContent || el.value || '').trim()));
      if (!target) return false;
      target.click();
      return true;
    }).catch(() => false);
  }

  if (!sent && !switched) {
    return { ok: false, message: '이메일 인증 탭/코드 전송 버튼을 찾지 못했습니다.' };
  }
  return { ok: true, switched, sent };
}

async function waitForOtpOrLoggedIn(page, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await pageLooksLoggedIn(page)) return { state: 'logged_in' };
    if (await isTwoFactorPage(page)) return { state: 'otp' };
    const otpVisible = await page.locator(
      'input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="code" i], input[placeholder*="인증"]'
    ).first().isVisible().catch(() => false);
    if (otpVisible) return { state: 'otp' };
    const url = String(page.url() || '').toLowerCase();
    if (/otp|verify|인증|2fa|mfa|authenticate/.test(url)) return { state: 'otp' };
    await page.waitForTimeout(1000);
  }
  if (await pageLooksLoggedIn(page)) return { state: 'logged_in' };
  if (await isTwoFactorPage(page)) return { state: 'otp' };
  return { state: 'unknown' };
}

/**
 * @param {import('playwright').Page} page
 * @param {{ onTokenScan?: Function, origin?: string }} options
 */
async function autoLoginCoupang(page, options = {}) {
  const creds = getCoupangCredentials();
  if (!creds.configured) {
    return {
      ok: false,
      error: 'CREDENTIALS_MISSING',
      message: 'COUPANG_LOGIN_ID / COUPANG_LOGIN_PASSWORD 를 PC .env 에 설정하세요.'
    };
  }
  if (!page) {
    return { ok: false, message: '쿠팡 브라우저 페이지가 없습니다.' };
  }

  const origin = options.origin || 'https://partner.coupangeats.com';
  try {
    if (await pageLooksLoggedIn(page)) {
      if (typeof options.onTokenScan === 'function') await options.onTokenScan(page);
      return { ok: true, alreadyLoggedIn: true };
    }

    // 이미 2FA 화면이면 비밀번호 로그인 생략
    let needPasswordLogin = !(await isTwoFactorPage(page));

    if (needPasswordLogin) {
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
      await page.waitForTimeout(1500);

      if (await pageLooksLoggedIn(page)) {
        if (typeof options.onTokenScan === 'function') await options.onTokenScan(page);
        return { ok: true, alreadyLoggedIn: true };
      }

      if (!(await isTwoFactorPage(page))) {
        if (!isCoupangLoginLikeUrl(page.url())) {
          await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
          await page.waitForTimeout(1000);
        }
        if (!(await isTwoFactorPage(page))) {
          const filled = await fillLoginForm(page, creds.id, creds.password);
          if (!filled.ok) return filled;
        }
      }
    }

    const afterLogin = await waitForOtpOrLoggedIn(page, 25000);
    if (afterLogin.state === 'logged_in') {
      if (typeof options.onTokenScan === 'function') await options.onTokenScan(page);
      await page.goto(`${origin}/page/rider-performance`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
      if (typeof options.onTokenScan === 'function') await options.onTokenScan(page);
      return { ok: true, via: 'password' };
    }

    // 2FA: 이메일 인증으로 전환 + 코드 전송
    const emailAuth = await switchToEmailAuthAndSendCode(page);
    if (!emailAuth.ok) {
      return {
        ok: false,
        error: 'EMAIL_AUTH_SWITCH_FAILED',
        message: emailAuth.message || '이메일 인증으로 전환하지 못했습니다.'
      };
    }

    // 메일 도착 약간 대기 후 네이버에서 OTP
    await page.waitForTimeout(3000);
    const otpResult = await naverOtp.waitForCoupangOtp({ timeoutMs: 150000, headless: false });
    if (!otpResult.ok) {
      return {
        ok: false,
        error: otpResult.error || 'OTP_TIMEOUT',
        message: otpResult.message || '네이버 메일에서 쿠팡 인증번호를 찾지 못했습니다.'
      };
    }

    const otpFilled = await naverOtp.fillCoupangOtpOnPage(page, otpResult.otp);
    if (!otpFilled.ok) {
      return { ok: false, message: otpFilled.message || 'OTP 입력 실패', otpFound: true };
    }

    await page.waitForTimeout(2500);
    await page.goto(`${origin}/page/rider-performance`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
    if (typeof options.onTokenScan === 'function') await options.onTokenScan(page);

    if (await pageLooksLoggedIn(page)) {
      return { ok: true, via: 'password+email-otp', otp: true };
    }
    return {
      ok: false,
      message: 'OTP 입력 후에도 로그인 상태를 확인하지 못했습니다. 브라우저를 확인하세요.',
      otpFound: true
    };
  } catch (error) {
    return { ok: false, message: error?.message || String(error) };
  }
}

module.exports = {
  getCoupangCredentials,
  autoLoginCoupang,
  pageLooksLoggedIn,
  switchToEmailAuthAndSendCode,
  isTwoFactorPage
};
