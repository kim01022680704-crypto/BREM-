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
      // persistent context 가 이미 닫혔는데 pages() 만 보면 [] 로 살아 있는 것처럼 보임
      const pages = sharedContext.pages();
      const browser = typeof sharedContext.browser === 'function' ? sharedContext.browser() : null;
      const connected = browser ? browser.isConnected() !== false : true;
      if (connected && Array.isArray(pages)) return sharedContext;
      sharedContext = null;
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
  // 다른 프로세스가 같은 프로필을 잡으면 newPage 가 "browser has been closed" 로 터짐
  for (const name of ['SingletonLock', 'SingletonCookie', 'lockfile']) {
    const lockPath = path.join(profileDir, name);
    if (!fs.existsSync(lockPath)) continue;
    try {
      const stale = Date.now() - fs.statSync(lockPath).mtimeMs > 90 * 1000;
      if (stale) fs.unlinkSync(lockPath);
    } catch { /* ignore */ }
  }
  const headless = options.headless === true;
  const launchOptions = {
    headless,
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    chromiumSandbox: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--hide-crash-restore-bubble',
      '--disable-session-crashed-bubble',
      '--no-first-run'
    ]
  };
  try {
    sharedContext = await playwright.chromium.launchPersistentContext(profileDir, {
      ...launchOptions,
      channel: 'chrome'
    });
    console.log('[NAVER] 브라우저: 설치된 Chrome ·', profileDir);
  } catch (error) {
    console.warn('[NAVER] 설치된 Chrome 실행 실패 — Chromium으로 재시도:', error?.message || error);
    try {
      sharedContext = await playwright.chromium.launchPersistentContext(profileDir, launchOptions);
    } catch (launchErr) {
      const msg = String(launchErr?.message || launchErr);
      if (/ProcessSingleton|profile|lock|already|in use/i.test(msg)) {
        throw new Error(`네이버 프로필이 다른 창에서 사용 중입니다. 119 네이버 창을 모두 닫고 다시 시도하세요. (${profileDir})`);
      }
      throw launchErr;
    }
  }
  sharedContext.on('close', () => {
    if (sharedContext) sharedContext = null;
  });
  await sharedContext.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  }).catch(() => {});
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

/** 기존 값이 남아 있으면 아이디가 두 번 붙는 문제 → 완전히 비운 뒤 입력 */
async function clearInputCompletely(page, loc) {
  await loc.click({ timeout: 5000, force: true }).catch(() => {});
  // 이 칸이 속한 줄의 X만 누른다. 페이지 전역 .first()면 비밀번호 입력 때
  // 아이디 X가 눌려 아이디가 비고, 로그인 버튼이 먹히지 않는다.
  await loc.evaluate((el) => {
    const parent = el.parentElement;
    if (!parent) return;
    const btn = parent.querySelector(
      '.input_delete, button.btn_delete, .btn_delete, [class*="delete"][role="button"], a.btn_delete, [id*="clear"]'
    );
    if (btn) btn.click();
  }).catch(() => {});
  await loc.click({ timeout: 3000, force: true }).catch(() => {});
  await page.keyboard.press('Control+A').catch(() => {});
  await page.keyboard.press('Delete').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await loc.evaluate((el) => {
    el.focus();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }).catch(() => {});
  await loc.click({ clickCount: 3, force: true }).catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await page.waitForTimeout(80).catch(() => {});
}

async function typeNaverValue(page, loc, want) {
  if (typeof loc.pressSequentially === 'function') {
    await loc.pressSequentially(want, { delay: 35 }).catch(async () => {
      await page.keyboard.type(want, { delay: 35 }).catch(() => {});
    });
  } else {
    await page.keyboard.type(want, { delay: 35 }).catch(() => {});
  }
}

async function typeIntoNaverField(page, selectors, value) {
  const want = String(value || '');
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if (!(await loc.count().catch(() => 0))) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;

    await clearInputCompletely(page, loc);
    // 네이버는 value= 대입이 무시되는 경우가 많아 실제 타이핑 필요
    await typeNaverValue(page, loc, want);

    let got = String(await loc.inputValue().catch(() => '') || '');
    // 이미 있던 값에 덧붙여진 경우(아이디 중복) → 비우고 재입력
    if (got !== want) {
      await clearInputCompletely(page, loc);
      await typeNaverValue(page, loc, want);
      got = String(await loc.inputValue().catch(() => '') || '');
      if (got !== want && got.includes(want) && got.length > want.length) {
        await clearInputCompletely(page, loc);
        await page.keyboard.type(want, { delay: 25 }).catch(() => {});
      }
    }
    return true;
  }
  return false;
}

async function readNaverIdValue(page) {
  return String(await page.locator('#id, input[name="id"]').first().inputValue().catch(() => '') || '');
}

/** 네이버 비밀번호칸은 value가 비어 보여도 점(•)과 X 버튼이 있으면 입력된 상태 */
async function naverPasswordLooksFilled(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#pw, input[name="pw"], input[type="password"]');
    if (!el) return false;
    if (String(el.value || '').trim()) return true;
    const parent = el.parentElement;
    const del = parent?.querySelector('.btn_delete, .input_delete, [id*="clear"]');
    if (del) {
      const st = window.getComputedStyle(del);
      if (st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) > 0) return true;
    }
    return false;
  }).catch(() => false);
}

async function clickNaverLoginButton(page) {
  const candidates = [
    '#log\\.login',
    'button#log\\.login',
    'input#log\\.login',
    'button.btn_login',
    '.btn_login',
    '#log\\.login.btn_login',
    'button[type="submit"]',
    'input[type="submit"][value*="로그인"]',
    'button:has-text("로그인")'
  ];
  for (const selector of candidates) {
    const loc = page.locator(selector).first();
    if (!(await loc.count().catch(() => 0))) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const box = await loc.boundingBox().catch(() => null);
    if (box && box.width > 8 && box.height > 8) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    } else {
      await loc.click({ timeout: 5000 }).catch(async () => {
        await loc.click({ timeout: 3000, force: true }).catch(() => {});
      });
    }
    return true;
  }
  // DOM 직접 + 마우스 이벤트
  const clicked = await page.evaluate(() => {
    const el = document.querySelector('#log\\.login, #log.login, .btn_login, button.btn_login')
      || Array.from(document.querySelectorAll('button, input[type="submit"], a'))
        .find(node => /로그인/.test((node.textContent || node.value || '').trim()));
    if (!el) return false;
    el.focus?.();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    if (typeof el.click === 'function') el.click();
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
  await page.waitForTimeout(200);
  // Tab으로 비밀번호칸 이동 — 클릭하면 아이디 X가 맞을 수 있음
  await page.keyboard.press('Tab').catch(() => {});
  await page.waitForTimeout(120);
  const pwFocused = await page.evaluate(() => {
    const el = document.activeElement;
    return Boolean(el && (el.id === 'pw' || el.name === 'pw' || el.type === 'password'));
  }).catch(() => false);
  let pwOk = false;
  if (pwFocused) {
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Delete').catch(() => {});
    await page.keyboard.type(password, { delay: 35 }).catch(() => {});
    pwOk = true;
  } else {
    pwOk = await typeIntoNaverField(page, ['#pw', 'input[name="pw"]', 'input[type="password"]'], password);
  }

  // 비밀번호 입력 과정에서 아이디가 지워졌으면 아이디만 다시
  let idNow = await readNaverIdValue(page);
  if (idNow !== id) {
    console.log('[NAVER] 아이디가 비어 있거나 불일치 — 아이디만 재입력');
    await typeIntoNaverField(page, ['#id', 'input[name="id"]'], id);
    idNow = await readNaverIdValue(page);
  }
  if (!idOk || !pwOk || idNow !== id) {
    // fallback: 구방식 value 주입 (기존 값 완전 삭제 후)
    await page.evaluate(({ userId, userPw }) => {
      const idEl = document.querySelector('#id, input[name="id"]');
      const pwEl = document.querySelector('#pw, input[name="pw"], input[type="password"]');
      if (!idEl || !pwEl) return;
      const set = (el, val) => {
        el.focus();
        el.select?.();
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set(idEl, userId);
      set(pwEl, userPw);
    }, { userId: id, userPw: password }).catch(() => {});
  }

  const idLen = (await readNaverIdValue(page)).length;
  const pwFilled = await naverPasswordLooksFilled(page);
  console.log(`[NAVER] 입력 확인 idLen=${idLen} pwFilled=${pwFilled}`);

  await page.waitForTimeout(400);
  await page.locator('#pw, input[name="pw"], input[type="password"]').first().click({ timeout: 3000 }).catch(() => {});
  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(1200);
  let clicked = true;
  if (/nidlogin|nid\.naver\.com/.test(page.url())) {
    clicked = await clickNaverLoginButton(page);
  }
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

  console.log('[NAVER] 로그인 폼 입력 + 녹색 로그인 자동 클릭…');
  const filled = await fillNaverLoginForm(page, creds.id, creds.password);
  if (!filled.ok) return filled;

  // 사람 클릭 대기 없이 자동으로 로그인 버튼을 반복 클릭
  const waitMs = Math.max(45000, Number(options.autoLoginWaitMs || 180000));
  let deadline = Date.now() + waitMs;
  let clickRound = 0;
  while (Date.now() < deadline) {
    for (const label of ['등록안함', '다음에', '닫기', '취소']) {
      const btn = page.locator(`button:has-text("${label}"), a:has-text("${label}")`).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
      }
    }

    if (await pageLooksLoggedIntoNaver(page)) {
      console.log('[NAVER] 자동 로그인 확인됨');
      return { ok: true, via: 'password+auto' };
    }

    const bodyHint = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ')).catch(() => '');
    if (/아이디 또는 비밀번호가 올바르지 않습니다/.test(String(bodyHint || ''))) {
      console.log('[NAVER] 아이디/비밀번호 오류 — 자동 재시도를 중단합니다.');
      return {
        ok: false,
        error: 'NAVER_BAD_CREDENTIALS',
        message: '네이버 아이디 또는 비밀번호가 올바르지 않습니다.'
      };
    }

    const url = String(page.url() || '');
    const protectBtn = page.locator('button:has-text("보호조치 해제"), a:has-text("보호조치 해제")').first();
    if (/idSafetyRelease|idsafety/i.test(url) || await protectBtn.isVisible().catch(() => false)) {
      if (await protectBtn.isVisible().catch(() => false)) {
        await protectBtn.click({ timeout: 5000 }).catch(() => {});
        console.log('[NAVER] 보호조치 화면 — 녹색 「보호조치 해제」를 눌렀습니다. 본인확인을 창에서 완료해 주세요.');
      } else {
        console.log('[NAVER] 보호조치 화면입니다. 네이버 창에서 본인확인을 완료해 주세요.');
      }
      if (deadline < Date.now() + 120000) deadline = Date.now() + 180000;
      await page.waitForTimeout(4000);
      continue;
    }
    if (/nidlogin|nid\.naver\.com/.test(url)) {
      clickRound += 1;
      const idVal = await readNaverIdValue(page);
      if (!idVal.trim()) {
        console.log('[NAVER] 재시도: 아이디가 비어 아이디만 다시 입력');
        await typeIntoNaverField(page, ['#id', 'input[name="id"]'], creds.id).catch(() => {});
      }
      if (clickRound <= 4) {
        await clickNaverLoginButton(page).catch(() => {});
      } else if (clickRound === 5) {
        console.log('[NAVER] 자동 클릭이 막혔습니다. 네이버 창에서 녹색 로그인을 직접 눌러주세요.');
      }
      if (clickRound % 6 === 0) {
        console.log(`[NAVER] 로그인 대기 중 (${clickRound}) — 창이 열려 있으면 녹색 로그인을 눌러주세요`);
        const hint = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 180)).catch(() => '');
        if (hint) console.log('[NAVER] 화면:', hint);
      }
    } else if (url && !/mail\.naver\.com/.test(url)) {
      await page.goto(NAVER_MAIL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }

    await page.waitForTimeout(3500);
  }

  return {
    ok: false,
    error: 'NAVER_LOGIN_FAILED',
    message: '네이버 자동 로그인 실패 — 아이디/비밀번호(.env) 또는 추가 인증(캡차/기기확인)을 확인하세요.'
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
  const sinceMs = Number(options.sinceMs || Date.now() - 2 * 60 * 1000);
  const excludeOtp = String(options.excludeOtp || '').trim();
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
    let staleOtp = excludeOtp;
    while (Date.now() < deadline) {
      try {
        await openNaverAllMailFolder(page);
        const opened = await openLatestCoupangVerifyMail(page);
        await page.waitForTimeout(800);

        const text = await page.evaluate(() => document.body?.innerText || '');
        const looksRelevant = /쿠팡|coupang|인증번호|인증\s*번호|판매자\s*2단계|이메일\s*인증\s*코드/i.test(text);
        if (looksRelevant || opened) {
          const otp = extractOtpFromText(text);
          if (otp) {
            const age = Date.now() - sinceMs;
            if (staleOtp && otp === staleOtp) {
              lastError = '이전 인증메일';
            } else if (!staleOtp && age < 10000) {
              staleOtp = otp;
              console.log('[NAVER] 이전 인증메일로 보여 새 메일 대기…');
            } else {
              console.log(`[NAVER] 전체메일에서 OTP 추출 성공 (${String(otp).length}자리)`);
              return { ok: true, otp, source: 'naver_all_mail', sinceMs };
            }
          }
        }

        const search = page.locator('input[placeholder*="메일검색"], input[placeholder*="검색"], input[type="search"]').first();
        if (await search.isVisible().catch(() => false)) {
          await search.fill('').catch(() => {});
          await search.fill('쿠팡 인증번호').catch(() => {});
          await page.keyboard.press('Enter').catch(() => {});
          await page.waitForTimeout(1500);
          await openLatestCoupangVerifyMail(page);
          const searchedText = await page.evaluate(() => document.body?.innerText || '');
          const otp = extractOtpFromText(searchedText);
          if (otp && otp !== staleOtp && Date.now() - sinceMs >= 8000) {
            console.log(`[NAVER] 검색에서 OTP 추출 성공 (${String(otp).length}자리)`);
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
 * 주의: 아이디 칸(disabled input[type=text])에 넣으면 타임아웃 남 — 반드시 활성 인증번호 칸만
 */
async function fillCoupangOtpOnPage(page, otp) {
  const code = String(otp || '').trim();
  if (!page || !code) return { ok: false, message: 'OTP 또는 페이지가 없습니다.' };

  // 우선순위: placeholder/name 이 인증번호인 활성 input
  const preferred = [
    'input[placeholder*="인증번호"]',
    'input[placeholder*="인증 번호"]',
    'input[placeholder*="발송된 인증"]',
    'input[placeholder*="인증코드"]',
    'input[placeholder*="인증 코드"]',
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[name*="code" i]',
    'input[id*="otp" i]',
    'input[id*="code" i]',
    'input[type="tel"]',
    'input[type="number"]'
  ];

  async function tryFillLocator(locator, selector) {
    const count = await locator.count().catch(() => 0);
    if (!count) return false;
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) return false;
    const disabled = await locator.isDisabled().catch(() => true);
    if (disabled) return false;
    const editable = await locator.isEditable().catch(() => false);
    if (!editable) return false;

    // 아이디 표시칸 등 value 가 이미 긴 문자열인 disabled 아닌 칸도 스킵
    const current = String(await locator.inputValue().catch(() => '') || '');
    const placeholder = String(await locator.getAttribute('placeholder').catch(() => '') || '');
    const name = String(await locator.getAttribute('name').catch(() => '') || '');
    const idAttr = String(await locator.getAttribute('id').catch(() => '') || '');
    if (/username|userName|loginId|email/i.test(`${name} ${idAttr}`) && !/otp|code|인증/i.test(placeholder)) {
      return false;
    }
    if (current && !/^\d*$/.test(current) && current.length >= 3 && !/인증|코드|otp/i.test(placeholder)) {
      return false;
    }

    await locator.click({ force: true }).catch(() => {});
    await locator.fill('').catch(() => {});
    await locator.fill(code).catch(async () => {
      await page.keyboard.type(code, { delay: 30 }).catch(() => {});
    });

    const submit = page.locator(
      'button[type="submit"]:not([disabled]), button:has-text("확인"), button:has-text("인증"), button:has-text("다음"), button:has-text("로그인")'
    ).first();
    if (await submit.count().catch(() => 0) && await submit.isEnabled().catch(() => false)) {
      await submit.click({ force: true }).catch(() => {});
    } else {
      await locator.press('Enter').catch(() => {});
    }
    return { ok: true, selector, placeholder };
  }

  for (const selector of preferred) {
    const locator = page.locator(selector).first();
    const filled = await tryFillLocator(locator, selector);
    if (filled && filled.ok) return filled;
  }

  // 모든 input 중 editable + placeholder/근처 라벨에 인증 키워드
  const picked = await page.evaluate((otpCode) => {
    const inputs = Array.from(document.querySelectorAll('input'));
    const score = (el) => {
      if (el.disabled || el.readOnly) return -1;
      if (el.type === 'hidden' || el.type === 'password') return -1;
      const ph = String(el.placeholder || '');
      const name = String(el.name || '');
      const id = String(el.id || '');
      const aria = String(el.getAttribute('aria-label') || '');
      const blob = `${ph} ${name} ${id} ${aria}`;
      let s = 0;
      if (/인증번호|인증\s*번호|otp|one-time|코드/.test(blob)) s += 10;
      if (/email|메일/.test(blob) && /인증|코드/.test(blob)) s += 8;
      if (el.type === 'tel' || el.type === 'number') s += 3;
      if (el.type === 'text') s += 1;
      if (/아이디|username|user/.test(blob)) s -= 20;
      return s;
    };
    const ranked = inputs
      .map(el => ({ el, s: score(el) }))
      .filter(row => row.s > 0)
      .sort((a, b) => b.s - a.s);
    const best = ranked[0]?.el;
    if (!best) return { ok: false };
    best.focus();
    best.value = '';
    best.value = otpCode;
    best.dispatchEvent(new Event('input', { bubbles: true }));
    best.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, placeholder: best.placeholder || '' };
  }, code).catch(() => ({ ok: false }));

  if (picked?.ok) {
    const submit = page.locator(
      'button[type="submit"]:not([disabled]), button:has-text("확인"), button:has-text("인증"), button:has-text("다음")'
    ).first();
    if (await submit.count().catch(() => 0)) {
      await submit.click({ force: true }).catch(() => {});
    } else {
      await page.keyboard.press('Enter').catch(() => {});
    }
    return { ok: true, selector: 'evaluate-best-input', placeholder: picked.placeholder };
  }

  return { ok: false, message: '활성 인증번호 입력칸을 찾지 못했습니다. (아이디 칸은 제외)' };
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
