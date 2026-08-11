/**
 * 쿠팡 2차인증용 네이버 메일 OTP 자동 추출
 * env: NAVER_LOGIN_ID, NAVER_LOGIN_PASSWORD
 * 프로필: .naver-playwright-profile
 */
const path = require('path');
const fs = require('fs');

const NAVER_MAIL_URL = 'https://mail.naver.com';
/** 쿠팡 인증메일은 받은메일함이 아니라 전체메일(프로모션)에 옴 */
const NAVER_MAIL_ALL_URL = 'https://mail.naver.com/v2/folders/-1';
const NAVER_LOGIN_URL = 'https://nid.naver.com/nidlogin.login';
const DEFAULT_PROFILE = path.join(process.cwd(), '.naver-playwright-profile');
const OTP_PATTERNS = [
  /인증\s*번호\s*([0-9]{4,8})/i,
  /인증번호\s*([0-9]{4,8})/i,
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

async function typeIntoNaverField(page, selectors, value) {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if (!(await loc.count().catch(() => 0))) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.click({ timeout: 5000, force: true }).catch(() => {});
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    // 네이버는 value= 대입이 무시되는 경우가 많아 실제 타이핑 필요
    if (typeof loc.pressSequentially === 'function') {
      await loc.pressSequentially(value, { delay: 40 }).catch(async () => {
        await page.keyboard.type(value, { delay: 40 }).catch(() => {});
      });
    } else {
      await page.keyboard.type(value, { delay: 40 }).catch(() => {});
    }
    return true;
  }
  return false;
}

async function clickNaverLoginButton(page) {
  const candidates = [
    '#log\\.login',
    'button.btn_login',
    '.btn_login',
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("로그인")'
  ];
  for (const selector of candidates) {
    const loc = page.locator(selector).first();
    if (!(await loc.count().catch(() => 0))) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.click({ timeout: 5000, force: true }).catch(() => {});
    return true;
  }
  // DOM 직접
  const clicked = await page.evaluate(() => {
    const el = document.querySelector('#log\\.login, .btn_login, button.btn_login')
      || Array.from(document.querySelectorAll('button, input[type="submit"]'))
        .find(node => /로그인/.test((node.textContent || node.value || '').trim()));
    if (!el) return false;
    el.click();
    return true;
  }).catch(() => false);
  if (!clicked) await page.keyboard.press('Enter').catch(() => {});
  return clicked;
}

async function fillNaverLoginForm(page, id, password) {
  // 로그인 상태 유지 ON (세션 유지에 유리)
  const keep = page.locator('#keep, label[for="keep"], text=로그인 상태 유지').first();
  if (await keep.count().catch(() => 0)) {
    const checked = await page.locator('#keep').isChecked().catch(() => false);
    if (!checked) await keep.click({ force: true }).catch(() => {});
  }

  // IP 보안 OFF 시도 (자동화 차단 완화)
  const ipOn = page.locator('.switch_on, #switch, text=IP 보안').first();
  if (await page.locator('.switch_on').count().catch(() => 0)) {
    await page.locator('.switch_on').first().click({ force: true }).catch(() => {});
  } else if (await ipOn.count().catch(() => 0)) {
    await ipOn.click({ force: true }).catch(() => {});
  }

  const idOk = await typeIntoNaverField(page, ['#id', 'input[name="id"]', 'input[placeholder*="아이디"]'], id);
  const pwOk = await typeIntoNaverField(page, ['#pw', 'input[name="pw"]', 'input[type="password"]'], password);
  if (!idOk || !pwOk) {
    // fallback: 구방식 value 주입
    await page.evaluate(({ userId, userPw }) => {
      const idEl = document.querySelector('#id, input[name="id"]');
      const pwEl = document.querySelector('#pw, input[name="pw"], input[type="password"]');
      if (!idEl || !pwEl) return;
      const set = (el, val) => {
        el.focus();
        el.value = '';
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set(idEl, userId);
      set(pwEl, userPw);
    }, { userId: id, userPw: password }).catch(() => {});
  }

  await page.waitForTimeout(400);
  let clicked = await clickNaverLoginButton(page);
  await page.waitForTimeout(1500);
  // 아직 로그인 페이지면 한 번 더
  if (/nidlogin|nid\.naver\.com/.test(page.url())) {
    clicked = (await clickNaverLoginButton(page)) || clicked;
  }
  return { ok: true, clicked };
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

  console.log('[NAVER] 로그인 폼 입력 후 로그인 버튼 클릭 시도…');
  const filled = await fillNaverLoginForm(page, creds.id, creds.password);
  if (!filled.ok) return filled;

  // 자동 클릭은 최대 2회만. 이후에는 손을 대지 않고 사람 클릭을 기다린다.
  // (계속 자동 클릭/입력하면 사람이 버튼을 못 누르는 것처럼 보임)
  await page.waitForTimeout(1200);
  if (/nidlogin|nid\.naver\.com/.test(page.url())) {
    await clickNaverLoginButton(page).catch(() => {});
  }

  console.log('[NAVER] ========================================');
  console.log('[NAVER] 자동 클릭을 멈췄습니다.');
  console.log('[NAVER] 이 창에서 녹색 「로그인」 버튼을 직접 한 번 눌러 주세요.');
  console.log('[NAVER] (로그인 상태 유지 체크 추천)');
  console.log('[NAVER] ========================================');

  const waitMs = Math.max(30000, Number(options.manualWaitMs || 180000));
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    // 팝업만 정리 (로그인 폼은 건드리지 않음)
    for (const label of ['등록안함', '다음에', '닫기', '취소']) {
      const btn = page.locator(`button:has-text("${label}"), a:has-text("${label}")`).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(400);
      }
    }

    if (await pageLooksLoggedIntoNaver(page)) {
      console.log('[NAVER] 로그인 확인됨');
      return { ok: true, via: 'password+manual' };
    }

    // 로그인 성공 후 다른 페이지로 넘어간 경우 메일로 이동
    const url = String(page.url() || '');
    if (url && !/nidlogin|nid\.naver\.com/.test(url) && !/mail\.naver\.com/.test(url)) {
      await page.goto(NAVER_MAIL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }

    await page.waitForTimeout(2500);
  }

  return {
    ok: false,
    error: 'NAVER_LOGIN_FAILED',
    message: '네이버 녹색 「로그인」을 직접 눌러 주세요. 자동 입력이 버튼을 가로채지 않도록 대기만 합니다.'
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

async function openNaverAllMailFolder(page) {
  // 1) 전체메일 URL (folder -1)
  await page.goto(NAVER_MAIL_ALL_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1200);

  // 2) 사이드바 「전체메일」 클릭 (받은메일함만 보는 문제 방지)
  const allMailTab = page.getByText('전체메일', { exact: true }).first();
  if (await allMailTab.count().catch(() => 0)) {
    await allMailTab.click({ timeout: 5000, force: true }).catch(() => {});
    await page.waitForTimeout(1000);
  } else {
    await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('a, button, span, div, li'));
      const target = nodes.find(el => (el.textContent || '').replace(/\s+/g, ' ').trim() === '전체메일');
      if (target) target.click();
    }).catch(() => {});
    await page.waitForTimeout(800);
  }
}

async function openLatestCoupangVerifyMail(page) {
  // 제목: [프로모션] [쿠팡] 이메일 인증번호가 도착하였습니다.
  const selectors = [
    'text=[쿠팡] 이메일 인증번호가 도착하였습니다',
    'text=이메일 인증번호가 도착하였습니다',
    'a:has-text("이메일 인증번호")',
    'a:has-text("[쿠팡]")',
    '[class*="mail"]:has-text("인증번호")',
    '[class*="subject"]:has-text("쿠팡")',
    'span:has-text("이메일 인증번호")',
    'div:has-text("[쿠팡] 이메일 인증번호")'
  ];
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if (!(await loc.count().catch(() => 0))) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.click({ timeout: 5000, force: true }).catch(() => {});
    await page.waitForTimeout(1200);
    return true;
  }

  // 목록에서 쿠팡+인증번호 행 클릭
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('a, tr, li, div[role="row"], .mail_item, [class*="mail"]'));
    const target = rows.find((el) => {
      const t = (el.textContent || '').replace(/\s+/g, ' ');
      return /쿠팡/.test(t) && /인증번호|인증\s*번호/.test(t);
    });
    if (!target) return false;
    target.click();
    return true;
  }).catch(() => false);
}

/**
 * 전체메일에서 쿠팡 인증 OTP를 찾는다.
 * (받은메일함에는 안 오고 [프로모션] 전체메일에만 오는 경우가 많음)
 * @param {{ timeoutMs?: number, sinceMs?: number, headless?: boolean }} options
 */
async function waitForCoupangOtp(options = {}) {
  const timeoutMs = Math.max(15000, Number(options.timeoutMs || 120000));
  const sinceMs = Number(options.sinceMs || Date.now() - 10 * 60 * 1000);
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

    console.log('[NAVER] 전체메일에서 쿠팡 인증번호 메일 검색…');
    const deadline = Date.now() + timeoutMs;
    let lastError = '';
    while (Date.now() < deadline) {
      try {
        await openNaverAllMailFolder(page);
        const opened = await openLatestCoupangVerifyMail(page);
        await page.waitForTimeout(800);

        // 읽기 화면 URL이면 본문 우선
        const text = await page.evaluate(() => document.body?.innerText || '');
        const looksRelevant = /쿠팡|coupang|인증번호|인증\s*번호|판매자\s*2단계|이메일\s*인증\s*코드/i.test(text);
        if (looksRelevant || opened) {
          const otp = extractOtpFromText(text);
          if (otp) {
            console.log(`[NAVER] 전체메일에서 OTP 추출 성공 (${String(otp).length}자리)`);
            return { ok: true, otp, source: 'naver_all_mail', sinceMs };
          }
        }

        // 검색창이 있으면 제목 검색
        const search = page.locator('input[placeholder*="메일검색"], input[placeholder*="검색"], input[type="search"]').first();
        if (await search.isVisible().catch(() => false)) {
          await search.fill('').catch(() => {});
          await search.fill('쿠팡 인증번호').catch(() => {});
          await page.keyboard.press('Enter').catch(() => {});
          await page.waitForTimeout(1500);
          await openLatestCoupangVerifyMail(page);
          const searchedText = await page.evaluate(() => document.body?.innerText || '');
          const otp = extractOtpFromText(searchedText);
          if (otp) {
            return { ok: true, otp, source: 'naver_all_mail_search', sinceMs };
          }
        }
      } catch (error) {
        lastError = error?.message || String(error);
      }
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
    return {
      ok: false,
      error: 'OTP_TIMEOUT',
      message: lastError
        ? `전체메일에서 쿠팡 인증번호를 찾지 못했습니다. (${lastError})`
        : '전체메일([프로모션] 쿠팡 인증번호)에서 OTP를 찾지 못했습니다. 받은메일함이 아니라 전체메일을 확인하세요.'
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
