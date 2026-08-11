/**
 * 쿠팡 2차인증용 네이버 메일 OTP 자동 추출
 * env: NAVER_LOGIN_ID, NAVER_LOGIN_PASSWORD
 * 프로필: .naver-playwright-profile
 */
const path = require('path');
const fs = require('fs');

const NAVER_MAIL_URL = 'https://mail.naver.com';
const NAVER_LOGIN_URL = 'https://nid.naver.com/nidlogin.login';
const DEFAULT_PROFILE = path.join(process.cwd(), '.naver-playwright-profile');
const OTP_PATTERNS = [
  /인증\s*번호[:\s]*([0-9]{4,8})/i,
  /인증번호[:\s]*([0-9]{4,8})/i,
  /verification\s*code[:\s]*([0-9]{4,8})/i,
  /OTP[:\s]*([0-9]{4,8})/i,
  /\b([0-9]{6})\b/
];

let sharedContext = null;
let recovering = false;

function getProfileDir() {
  return String(process.env.NAVER_PLAYWRIGHT_PROFILE || DEFAULT_PROFILE).trim() || DEFAULT_PROFILE;
}

function getNaverCredentials() {
  const id = String(process.env.NAVER_LOGIN_ID || process.env.NAVER_ID || '').trim();
  const password = String(process.env.NAVER_LOGIN_PASSWORD || process.env.NAVER_PASSWORD || '');
  return { id, password, configured: Boolean(id && password) };
}

async function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return null;
  }
}

function extractOtpFromText(text) {
  const body = String(text || '');
  for (const pattern of OTP_PATTERNS) {
    const match = body.match(pattern);
    if (match?.[1]) return String(match[1]).trim();
  }
  return '';
}

async function ensureNaverContext(options = {}) {
  if (sharedContext) {
    try {
      const pages = sharedContext.pages();
      if (pages) return sharedContext;
    } catch {
      sharedContext = null;
    }
  }
  const playwright = await loadPlaywright();
  if (!playwright) {
    throw new Error('playwright 패키지가 없습니다. npm install playwright 후 다시 시도하세요.');
  }
  const profileDir = getProfileDir();
  fs.mkdirSync(profileDir, { recursive: true });
  const headless = options.headless === true;
  sharedContext = await playwright.chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul'
  });
  return sharedContext;
}

async function pageLooksLoggedIntoNaver(page) {
  if (!page) return false;
  const url = String(page.url() || '').toLowerCase();
  if (/nid\.naver\.com\/nidlogin|nidlogin\.login/.test(url)) return false;
  try {
    const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (/아이디.*비밀번호|네이버\s*로그인|Sign in/.test(text) && /nid\.naver|login/.test(url)) {
      return false;
    }
    // 메일함 UI 단서
    if (/받은메일|메일쓰기|안읽음|Inbox|mail\.naver/.test(text) || /mail\.naver\.com/.test(url)) {
      if (!/nidlogin|로그인\s*필요/.test(text.slice(0, 400))) return true;
    }
  } catch {
    /* ignore */
  }
  return /mail\.naver\.com/.test(url) && !/nidlogin/.test(url);
}

async function fillNaverLoginForm(page, id, password) {
  // 네이버는 종종 일반 fill이 막혀 evaluate로 값을 넣는다
  const filled = await page.evaluate(({ userId, userPw }) => {
    const idEl = document.querySelector('#id, input[name="id"], input[placeholder*="아이디"]');
    const pwEl = document.querySelector('#pw, input[name="pw"], input[type="password"]');
    if (!idEl || !pwEl) return false;
    idEl.focus();
    idEl.value = userId;
    idEl.dispatchEvent(new Event('input', { bubbles: true }));
    pwEl.focus();
    pwEl.value = userPw;
    pwEl.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, { userId: id, userPw: password }).catch(() => false);

  if (!filled) {
    const idLoc = page.locator('#id, input[name="id"]').first();
    const pwLoc = page.locator('#pw, input[name="pw"], input[type="password"]').first();
    if (!(await idLoc.count().catch(() => 0)) || !(await pwLoc.count().catch(() => 0))) {
      return { ok: false, message: '네이버 로그인 입력칸을 찾지 못했습니다.' };
    }
    await idLoc.fill(id).catch(() => {});
    await pwLoc.fill(password).catch(() => {});
  }

  const submit = page.locator('#log\\.login, button[type="submit"], .btn_login, button:has-text("로그인")').first();
  if (await submit.count().catch(() => 0)) {
    await submit.click().catch(() => {});
  } else {
    await page.keyboard.press('Enter').catch(() => {});
  }
  return { ok: true };
}

/**
 * 네이버 메일 로그인 (env 자격증명). 이미 로그인이면 패스.
 */
async function ensureNaverLoggedIn(page, options = {}) {
  const creds = getNaverCredentials();
  await page.goto(NAVER_MAIL_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);

  if (await pageLooksLoggedIntoNaver(page)) {
    return { ok: true, alreadyLoggedIn: true };
  }

  if (!creds.configured) {
    return {
      ok: false,
      error: 'NAVER_CREDENTIALS_MISSING',
      message: 'NAVER_LOGIN_ID / NAVER_LOGIN_PASSWORD 를 PC .env 에 넣으세요.'
    };
  }

  // 로그인 페이지로
  if (!/nid\.naver\.com/.test(page.url())) {
    await page.goto(NAVER_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  const filled = await fillNaverLoginForm(page, creds.id, creds.password);
  if (!filled.ok) return filled;

  await page.waitForTimeout(2500);

  // 기기등록/보안 팝업 닫기 시도
  for (const label of ['등록안함', '다음에', '닫기', '취소']) {
    const btn = page.locator(`button:has-text("${label}"), a:has-text("${label}")`).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(800);
    }
  }

  await page.goto(NAVER_MAIL_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);

  if (await pageLooksLoggedIntoNaver(page)) {
    return { ok: true, via: 'password' };
  }

  // 추가 인증(캡차/기기확인) 필요할 수 있음 — 잠시 대기
  const waitMs = Math.max(10000, Number(options.manualWaitMs || 45000));
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await pageLooksLoggedIntoNaver(page)) {
      return { ok: true, via: 'password+wait' };
    }
    await page.waitForTimeout(2000);
  }

  return {
    ok: false,
    error: 'NAVER_LOGIN_FAILED',
    message: '네이버 자동로그인 실패 — 캡차/추가인증이면 브라우저에서 한 번만 완료해 주세요.'
  };
}

async function openNaverMailForLogin() {
  const context = await ensureNaverContext({ headless: false });
  const page = context.pages()[0] || await context.newPage();
  const login = await ensureNaverLoggedIn(page);
  return {
    ok: login.ok,
    message: login.ok
      ? (login.alreadyLoggedIn ? '네이버 메일 로그인 상태입니다.' : '네이버 메일 자동로그인 완료')
      : (login.message || '네이버 메일 로그인 필요'),
    profileDir: getProfileDir(),
    ...login
  };
}

/**
 * 최근 수신 메일에서 쿠팡/인증 OTP를 찾는다.
 * @param {{ timeoutMs?: number, sinceMs?: number, headless?: boolean }} options
 */
async function waitForCoupangOtp(options = {}) {
  const timeoutMs = Math.max(15000, Number(options.timeoutMs || 120000));
  const sinceMs = Number(options.sinceMs || Date.now() - 5 * 60 * 1000);
  recovering = true;
  try {
    const context = await ensureNaverContext({ headless: options.headless === true });
    const page = context.pages()[0] || await context.newPage();

    const login = await ensureNaverLoggedIn(page, { manualWaitMs: 20000 });
    if (!login.ok) {
      return {
        ok: false,
        error: login.error || 'NAVER_LOGIN_FAILED',
        message: login.message || '네이버 메일 로그인이 필요합니다.'
      };
    }

    const deadline = Date.now() + timeoutMs;
    let lastError = '';
    while (Date.now() < deadline) {
      try {
        await page.goto(NAVER_MAIL_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
        await page.waitForTimeout(1200);

        // 최신 메일 클릭 시도 (쿠팡/인증 키워드)
        const mailLink = page.locator(
          'a:has-text("쿠팡"), a:has-text("Coupang"), a:has-text("인증"), [class*="mail_title"]:has-text("쿠팡"), [class*="mail_title"]:has-text("인증")'
        ).first();
        if (await mailLink.count().catch(() => 0)) {
          await mailLink.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(1000);
        }

        const text = await page.evaluate(() => document.body?.innerText || '');
        const lower = text.toLowerCase();
        const looksRelevant = /coupang|쿠팡|인증|otp|verification|eats/.test(lower);
        if (looksRelevant) {
          const otp = extractOtpFromText(text);
          if (otp) {
            return { ok: true, otp, source: 'naver_mail_dom', sinceMs };
          }
        }

        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      } catch (error) {
        lastError = error?.message || String(error);
      }
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
    return {
      ok: false,
      error: 'OTP_TIMEOUT',
      message: lastError
        ? `네이버 메일에서 인증번호를 찾지 못했습니다. (${lastError})`
        : '네이버 메일에서 인증번호를 찾지 못했습니다. 이메일 인증코드 전송 여부를 확인하세요.'
    };
  } finally {
    recovering = false;
  }
}

function isRecovering() {
  return recovering;
}

/**
 * 쿠팡 페이지에서 OTP 입력 필드를 찾아 값을 넣고 제출을 시도한다.
 */
async function fillCoupangOtpOnPage(page, otp) {
  const code = String(otp || '').trim();
  if (!page || !code) return { ok: false, message: 'OTP 또는 페이지가 없습니다.' };

  const selectors = [
    'input[name*="otp" i]',
    'input[name*="code" i]',
    'input[id*="otp" i]',
    'input[id*="code" i]',
    'input[type="tel"]',
    'input[type="text"]',
    'input[autocomplete="one-time-code"]',
    'input[placeholder*="인증"]',
    'input[placeholder*="코드"]'
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    await locator.fill('').catch(() => {});
    await locator.fill(code);
    const submit = page.locator(
      'button[type="submit"], button:has-text("확인"), button:has-text("인증"), button:has-text("로그인"), button:has-text("다음")'
    ).first();
    if (await submit.count().catch(() => 0)) {
      await submit.click().catch(() => {});
    } else {
      await locator.press('Enter').catch(() => {});
    }
    return { ok: true, selector };
  }
  return { ok: false, message: 'OTP 입력 필드를 찾지 못했습니다.' };
}

module.exports = {
  openNaverMailForLogin,
  waitForCoupangOtp,
  fillCoupangOtpOnPage,
  extractOtpFromText,
  isRecovering,
  getProfileDir,
  getNaverCredentials,
  ensureNaverLoggedIn
};
