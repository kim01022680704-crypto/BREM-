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
    'input[name="login"]',
    'input[name="id"]',
    'input#username',
    'input#email',
    'input[type="email"]',
    'input[type="text"]',
    'input[placeholder*="아이디"]',
    'input[placeholder*="이메일"]',
    'input[placeholder*="ID"]',
    'input[autocomplete="username"]'
  ];
  const pwSelectors = [
    'input[name="password"]',
    'input#password',
    'input[type="password"]',
    'input[placeholder*="비밀번호"]',
    'input[autocomplete="current-password"]'
  ];

  // xauth 폼 렌더 대기 (iframe 포함)
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    let ready = false;
    for (const ctx of [page, ...page.frames()]) {
      const n = await ctx.locator('input[type="password"], input[name="password"], input#password').count().catch(() => 0);
      if (n > 0) { ready = true; break; }
    }
    if (ready) break;
    await page.waitForTimeout(500).catch(() => {});
  }

  async function clearThenFill(loc, value) {
    const want = String(value || '');
    await loc.click({ timeout: 3000, force: true }).catch(() => {});
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
    await loc.fill(want).catch(async () => {
      await loc.click({ force: true }).catch(() => {});
      await page.keyboard.type(want, { delay: 25 }).catch(() => {});
    });
    let got = String(await loc.inputValue().catch(() => '') || '');
    // 기존 값에 덧붙여진 경우 한 번 더 비우고 재입력
    if (got !== want) {
      await loc.click({ clickCount: 3, force: true }).catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await loc.fill('').catch(() => {});
      await loc.fill(want).catch(async () => {
        await page.keyboard.type(want, { delay: 20 }).catch(() => {});
      });
    }
  }

  async function fillInContext(ctx) {
    let filledId = false;
    let filledPw = false;
    for (const selector of idSelectors) {
      const loc = ctx.locator(selector).first();
      if (!(await loc.count().catch(() => 0))) continue;
      if (!(await loc.isVisible().catch(() => false))) continue;
      // 비밀번호 칸을 아이디로 오인하지 않음
      const typ = String(await loc.getAttribute('type').catch(() => '') || '').toLowerCase();
      if (typ === 'password') continue;
      await clearThenFill(loc, id);
      filledId = true;
      break;
    }
    for (const selector of pwSelectors) {
      const loc = ctx.locator(selector).first();
      if (!(await loc.count().catch(() => 0))) continue;
      if (!(await loc.isVisible().catch(() => false))) continue;
      await clearThenFill(loc, password);
      filledPw = true;
      break;
    }
    if (!filledId || !filledPw) return { ok: false };
    const submit = ctx.locator(
      'button[type="submit"], input[type="submit"], button:has-text("로그인"), button:has-text("Log in"), button:has-text("Sign in")'
    ).first();
    if (await submit.count().catch(() => 0)) {
      await submit.click({ timeout: 5000 }).catch(() => {});
    } else {
      await page.keyboard.press('Enter').catch(() => {});
    }
    return { ok: true };
  }

  for (const ctx of [page, ...page.frames()]) {
    const r = await fillInContext(ctx);
    if (r.ok) return { ok: true };
  }

  // 최후: DOM에서 visible input 직접 채우기
  const forced = await page.evaluate(({ loginId, loginPw }) => {
    const visible = (el) => {
      if (!el) return false;
      const st = window.getComputedStyle(el);
      return st && st.visibility !== 'hidden' && st.display !== 'none' && el.offsetParent !== null;
    };
    const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
    const pw = inputs.find((el) => el.type === 'password' || /password/i.test(el.name || el.id || ''));
    const idInput = inputs.find((el) => el !== pw && el.type !== 'hidden' && el.type !== 'submit');
    if (!idInput || !pw) return false;
    const setVal = (el, val) => {
      el.focus();
      el.select?.();
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.value = String(val || '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setVal(idInput, loginId);
    setVal(pw, loginPw);
    const btn = document.querySelector('button[type="submit"], input[type="submit"]')
      || Array.from(document.querySelectorAll('button')).find((b) => /로그인|log\s*in|sign\s*in/i.test(b.textContent || ''));
    if (btn) btn.click();
    return true;
  }, { loginId: id, loginPw: password }).catch(() => false);

  if (forced) return { ok: true };
  return { ok: false, message: '쿠팡 로그인 입력칸을 찾지 못했습니다.' };
}

async function isTwoFactorPage(page) {
  if (!page) return false;
  const url = String(page.url() || '').toLowerCase();
  if (/authenticate|login-actions|otp|2fa|mfa|verify/.test(url)) return true;
  const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  return /2단계\s*인증|인증코드\s*전송|이메일로\s*인증|휴대전화로\s*인증/.test(text);
}

async function readTwoFactorMode(page) {
  const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  const placeholder = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder*="인증"], input[placeholder*="코드"], input[type="tel"], input[type="text"]');
    return String(input?.placeholder || '');
  }).catch(() => '');
  const blob = `${text}\n${placeholder}`;
  const emailMode = /이메일로\s*발송|이메일\s*주소|이메일로\s*발송된|메일로\s*발송|@/.test(blob)
    && !/핸드폰으로\s*발송|휴대폰\s*번호/.test(placeholder);
  const phoneMode = /핸드폰으로\s*발송|휴대폰\s*번호|휴대전화로\s*인증/.test(blob)
    && /핸드폰|휴대폰|휴대전화/.test(placeholder || text);
  return {
    emailMode: Boolean(emailMode) || (/이메일로\s*발송된|이메일\s*주소/.test(blob)),
    phoneMode: Boolean(phoneMode),
    placeholder,
    textSample: text.slice(0, 240)
  };
}

async function clickEmailAuthTab(page) {
  // 1) Playwright getByText
  try {
    const byText = page.getByText('이메일로 인증', { exact: true }).first();
    if (await byText.count().catch(() => 0)) {
      await byText.click({ timeout: 5000, force: true });
      await page.waitForTimeout(1000);
      return true;
    }
  } catch { /* continue */ }

  const emailTabCandidates = [
    'text=이메일로 인증',
    'button:has-text("이메일로 인증")',
    'a:has-text("이메일로 인증")',
    '[role="tab"]:has-text("이메일로 인증")',
    '[role="tab"]:has-text("이메일")',
    'label:has-text("이메일로 인증")',
    'li:has-text("이메일로 인증")',
    'span:has-text("이메일로 인증")',
    'div:has-text("이메일로 인증")'
  ];
  for (const selector of emailTabCandidates) {
    const loc = page.locator(selector).first();
    if (!(await loc.count().catch(() => 0))) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.click({ timeout: 5000, force: true }).catch(() => {});
    await page.waitForTimeout(1000);
    return true;
  }

  // 2) DOM 탐색: 텍스트가 정확히 "이메일로 인증" 인 가장 안쪽 요소 클릭
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button, a, li, span, div, label, p, [role="tab"]'));
    const exact = all.find(el => (el.textContent || '').replace(/\s+/g, ' ').trim() === '이메일로 인증');
    const loose = all.find(el => /^이메일로\s*인증$/.test((el.textContent || '').replace(/\s+/g, ' ').trim()));
    const target = exact || loose;
    if (!target) return false;
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    target.click();
    return true;
  }).catch(() => false);
}

/**
 * 쿠팡 2FA: 반드시 이메일 탭 선택 → (확인 후) 인증코드 전송
 * 주의: 휴대폰 탭에도 인증번호 input이 있어서 "input 있으면 skip" 하면 안 됨
 */
async function switchToEmailAuthAndSendCode(page) {
  if (!page) return { ok: false, message: '페이지 없음' };

  let switched = false;
  let emailReady = false;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const modeBefore = await readTwoFactorMode(page);
    if (modeBefore.emailMode && !/핸드폰으로\s*발송/.test(modeBefore.placeholder || '')) {
      emailReady = true;
      switched = true;
      break;
    }
    const clicked = await clickEmailAuthTab(page);
    switched = switched || clicked;
    await page.waitForTimeout(900);
    const modeAfter = await readTwoFactorMode(page);
    if (modeAfter.emailMode || /이메일/.test(modeAfter.placeholder || '')) {
      emailReady = true;
      break;
    }
  }

  if (!emailReady) {
    // 최후: 탭 클릭 후에도 휴대폰 placeholder면 실패로 알림 (수동 클릭 유도)
    const mode = await readTwoFactorMode(page);
    if (/핸드폰|휴대폰/.test(mode.placeholder || '')) {
      return {
        ok: false,
        switched,
        message: '이메일 인증 탭 전환 실패 — 화면에서 「이메일로 인증」을 한 번 눌러 주세요.'
      };
    }
  }

  // 이메일 탭에서 전송/재요청
  const sendCandidates = [
    'button:has-text("인증코드 전송")',
    'button:has-text("인증 코드 전송")',
    'button:has-text("인증 재요청")',
    'button:has-text("재요청")',
    'button:has-text("코드 전송")'
  ];
  let sent = false;
  for (const selector of sendCandidates) {
    const loc = page.locator(selector).first();
    if (!(await loc.count().catch(() => 0))) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    // 타이머 중 재요청 비활성일 수 있음
    const disabled = await loc.isDisabled().catch(() => false);
    if (disabled) continue;
    await loc.click({ timeout: 5000, force: true }).catch(() => {});
    sent = true;
    await page.waitForTimeout(1500);
    break;
  }
  if (!sent) {
    sent = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
      const target = buttons.find((el) => {
        const label = (el.textContent || el.value || '').replace(/\s+/g, ' ').trim();
        return /인증\s*코드\s*전송|인증\s*재요청|코드\s*전송|재요청/.test(label)
          && !el.disabled
          && el.offsetParent !== null;
      });
      if (!target) return false;
      target.click();
      return true;
    }).catch(() => false);
  }

  const modeFinal = await readTwoFactorMode(page);
  if (/핸드폰으로\s*발송|휴대폰\s*번호/.test(modeFinal.placeholder || '')) {
    return {
      ok: false,
      switched,
      sent,
      message: '아직 휴대전화 인증 화면입니다. 「이메일로 인증」 탭을 눌러 주세요.'
    };
  }

  return { ok: true, switched: true, sent, emailMode: modeFinal.emailMode };
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
          await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
          await page.waitForTimeout(1500);
        }
        // 로그인 화면으로 튕긴 뒤 폼이 늦게 뜨는 경우 대비
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1000);
        if (!(await isTwoFactorPage(page))) {
          const filled = await fillLoginForm(page, creds.id, creds.password);
          if (!filled.ok) {
            // 한 번 더: SSO URL 직접 진입 후 재시도
            await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
            await page.waitForTimeout(2500);
            const retry = await fillLoginForm(page, creds.id, creds.password);
            if (!retry.ok) return filled;
          }
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
