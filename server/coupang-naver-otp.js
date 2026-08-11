/**
 * 쿠팡 2차인증용 네이버 메일 OTP 자동 추출
 * - 별도 Playwright 프로필(.naver-playwright-profile) 유지
 * - 최초 1회 네이버 로그인은 사람, 이후 OTP 메일만 자동 조회
 */
const path = require('path');
const fs = require('fs');

const NAVER_MAIL_URL = 'https://mail.naver.com';
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

async function openNaverMailForLogin() {
  const context = await ensureNaverContext({ headless: false });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(NAVER_MAIL_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  return {
    ok: true,
    message: '네이버 메일 창을 열었습니다. 최초 1회 로그인(필요 시 2차인증)을 완료하세요.',
    profileDir: getProfileDir()
  };
}

/**
 * 최근 수신 메일에서 쿠팡/인증 OTP를 찾는다.
 * @param {{ timeoutMs?: number, sinceMs?: number }} options
 */
async function waitForCoupangOtp(options = {}) {
  const timeoutMs = Math.max(15000, Number(options.timeoutMs || 120000));
  const sinceMs = Number(options.sinceMs || Date.now() - 5 * 60 * 1000);
  recovering = true;
  try {
    const context = await ensureNaverContext({ headless: options.headless !== false ? false : true });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(NAVER_MAIL_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });

    const deadline = Date.now() + timeoutMs;
    let lastError = '';
    while (Date.now() < deadline) {
      try {
        // 메일 목록/본문 텍스트에서 OTP 후보 추출
        const text = await page.evaluate(() => document.body?.innerText || '');
        const lower = text.toLowerCase();
        const looksRelevant = /coupang|쿠팡|인증|otp|verification/.test(lower);
        if (looksRelevant) {
          const otp = extractOtpFromText(text);
          if (otp) {
            return { ok: true, otp, source: 'naver_mail_dom', sinceMs };
          }
        }

        // 새로고침으로 최신 메일 유도
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
        : '네이버 메일에서 인증번호를 찾지 못했습니다. 메일함 로그인 상태를 확인하세요.'
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
    'input[autocomplete="one-time-code"]'
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    await locator.fill('').catch(() => {});
    await locator.fill(code);
    // 제출 버튼 시도
    const submit = page.locator('button[type="submit"], button:has-text("확인"), button:has-text("인증"), button:has-text("로그인")').first();
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
  getProfileDir
};
