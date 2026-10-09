/* eslint-disable no-console */
/**
 * 쿠팡이츠 로컬 세션 서버 (배민 세션 서버의 쿠팡판, 축소·독립)
 * - Playwright 헤드풀로 partner.coupangeats.com 로그인(2차인증 수동)
 * - 브라우저 요청에서 Bearer JWT 토큰을 캡처해 Supabase(settings)에 저장
 * - /collect 호출 시 캡처한 토큰으로 대시보드 API를 호출해 coupang_collect_items 에 저장
 *
 * 실행: node scripts/coupang-session-local-server.js   (E:\브램로컬\BREM 에서)
 * 포트: 3940 (127.0.0.1)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
// .env.production 을 먼저 읽되(부가 변수용), 실제 로컬 .env 값이 우선하도록 override.
// (.env.production 의 SUPABASE_SERVICE_ROLE_KEY 가 비어 있어도 .env 의 실제 키가 이김)
require('dotenv').config({ path: path.join(process.cwd(), '.env.production') });
require('dotenv').config({ path: path.join(process.cwd(), '.env'), override: true });

const coupangAccounts = require('../server/coupang-accounts');
const ACCOUNT = coupangAccounts.applyCoupangAccountEnv();
// 기본은 네이버 수동 + 쿠팡 자동(일 2회). 완전 수동은 COUPANG_FORCE_MANUAL_LOGIN=1
if (String(process.env.COUPANG_FORCE_MANUAL_LOGIN || '').trim() !== '1') {
  delete process.env.COUPANG_MANUAL_LOGIN;
}

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.cwd(), '.playwright-browsers');
}

const { chromium } = require('playwright');
const sources = require('../server/coupang-collect-sources');
const pipeline = require('../server/coupang-collect-pipeline');
const sessionStore = require('../server/coupang-session');

const PORT = Number(process.env.COUPANG_SESSION_LOCAL_PORT || 3940);
const ORIGIN = sources.COUPANG_ORIGIN;
const API = sources.COUPANG_API_BASE;
const MANUAL_LOGIN = String(process.env.COUPANG_MANUAL_LOGIN || '').trim() === '1';
const PROFILE_DIR = String(process.env.COUPANG_PLAYWRIGHT_PROFILE || '').trim()
  || path.join(process.cwd(), '.coupang-playwright-profile');

let context = null;
let latestToken = '';
let latestTokenAt = 0;
let latestRefreshToken = '';
let latestCookie = '';
const seenVendorIds = new Set();
const seenApiPaths = new Set();   // 브라우저가 실제로 호출한 대시보드 API 경로(진단용)
let collecting = false;
// 토큰 포착 진단: 어떤 경로로 잡혔는지/한 번이라도 Bearer를 본 적 있는지
let seenAnyAuthHeader = false;
let lastTokenSource = '';
let lastAuthSeenAt = 0;
let lastAutoLoginAttemptAt = 0;
let authRecovering = false;
let skipNaverRecoverUntil = 0;

function shouldSkipNaverRecover() {
  return Date.now() < skipNaverRecoverUntil;
}

function markNaverRecoverOutcome(result) {
  const err = String(result?.error || '');
  const msg = String(result?.message || '');
  if (err === 'NAVER_BAD_CREDENTIALS' || /비밀번호가 올바르지/.test(msg)) {
    skipNaverRecoverUntil = Date.now() + 30 * 60 * 1000;
    console.log('[COUPANG] 네이버 자격 오류 — 30분간 OTP 재시도 안 함 (세션 스캔만)');
  }
}

const LOGIN_COOLDOWN_MS = 2 * 60 * 1000;
let recoverPromise = null;

/**
 * 로그인 화면/토큰 만료 시 아이디·비번 + 열린 네이버 메일 OTP로 복구.
 * 연속 실패 2회면 정지, 실패 후 2분 대기.
 */
function startAuthRecoverWatchdog() {
  if (MANUAL_LOGIN) {
    console.log(`[COUPANG] ${ACCOUNT.label} 자동 로그인 감시 중지 — COUPANG_MANUAL_LOGIN=1`);
    return;
  }
  setInterval(async () => {
    try {
      const auth = require('../server/crawl-session-auth');
      const onLogin = auth.isCoupangLoginLikeUrl(getCurrentUrlSafe());
      if (isTokenUsable(latestToken) && !onLogin) return;
      if (authRecovering) return;
      if (shouldSkipNaverRecover()) return;
      const creds = require('../server/coupang-auto-login').getCoupangCredentials();
      if (!creds.configured) return;
      await ensureBrowser().catch(() => null);
      const budget = require('../server/coupang-login-budget').inspect();
      if (!budget.canLogin) {
        authRequiredReason = `연속 로그인 실패 ${budget.loginFailures}회 — 자동 시도 정지`;
        return;
      }
      if (lastAutoLoginAttemptAt && Date.now() - lastAutoLoginAttemptAt < LOGIN_COOLDOWN_MS) return;
      console.log(`[COUPANG] ${ACCOUNT.label} — 쿠팡 자동로그인 시도 (아이디/비번 + 열린 메일 OTP)`);
      const recovered = await tryRecoverCoupangAuthWithNaverOtp();
      console.log(recovered.ok
        ? `[COUPANG] ${ACCOUNT.label} 복구 성공 (${recovered.via || 'recover'})`
        : `[COUPANG] ${ACCOUNT.label} 복구 보류: ${recovered.message}`);
    } catch { /* ignore */ }
  }, 20000);
}
let authRequired = false;
let authRequiredReason = '';
const AUTO_RESUME_STATUS_LOOP = String(process.env.COUPANG_AUTO_RESUME_STATUS_LOOP || '').trim() === '1';

/** JWT 형태(header.payload.signature, payload에 exp) 검증 */
function looksLikeJwt(tok) {
  const t = String(tok || '').trim();
  if (!/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(t)) return false;
  try {
    const payload = JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString('utf8'));
    return payload && typeof payload === 'object';
  } catch { return false; }
}

function tokenExpiresAtMs(tok) {
  try {
    const payload = JSON.parse(Buffer.from(String(tok || '').split('.')[1], 'base64').toString('utf8'));
    const exp = Number(payload?.exp || 0);
    return exp > 0 ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** 만료 60초 전이면 사용 불가로 본다 */
function isTokenUsable(tok) {
  if (!looksLikeJwt(tok)) return false;
  const expMs = tokenExpiresAtMs(tok);
  return expMs > Date.now() + 60 * 1000;
}

function tokenTtlMs(tok) {
  const expMs = tokenExpiresAtMs(tok);
  return expMs > 0 ? expMs - Date.now() : 0;
}

function refreshTokenFilePath() {
  return path.join(PROFILE_DIR, '.brem-oidc-refresh');
}

function loadLocalRefreshToken() {
  try {
    const raw = fs.readFileSync(refreshTokenFilePath(), 'utf8').trim();
    if (raw && raw.length > 20) latestRefreshToken = raw;
  } catch { /* ignore */ }
  return latestRefreshToken;
}

function saveLocalRefreshToken(tok) {
  const t = String(tok || '').trim();
  if (!t || t.length < 20) return;
  latestRefreshToken = t;
  try {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    fs.writeFileSync(refreshTokenFilePath(), t, 'utf8');
  } catch { /* ignore */ }
}

function clearLocalRefreshToken() {
  latestRefreshToken = '';
  try { fs.unlinkSync(refreshTokenFilePath()); } catch { /* ignore */ }
}

function clearCoupangToken(reason = '') {
  latestToken = '';
  latestTokenAt = 0;
  authRequired = true;
  if (reason) authRequiredReason = reason;
  // refresh 는 유지 — access만 폐기. 로그인 화면이면 호출측에서 clearLocalRefreshToken
}

/** 토큰 갱신(더 새로운 것만 채택). source는 진단용. */
function adoptToken(tok, source) {
  const t = String(tok || '').replace(/^Bearer\s+/i, '').trim();
  if (!t || t === latestToken) return false;
  if (!looksLikeJwt(t)) return false;
  latestToken = t;
  latestTokenAt = Date.now();
  lastTokenSource = source || 'unknown';
  return true;
}

/** 요청/응답 헤더 객체에서 Authorization Bearer 추출 */
function captureAuthFromHeaders(h, source) {
  if (!h) return;
  const auth = h['authorization'] || h['Authorization'];
  if (auth && /^Bearer\s+/i.test(auth)) {
    seenAnyAuthHeader = true;
    lastAuthSeenAt = Date.now();
    adoptToken(auth, source || 'header');
  }
}

function nowKstIsoOffset() {
  // 현재 시각 KST(+09:00)
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().replace('Z', '+09:00');
}
function businessDateKst() {
  // 영업일: KST 06:00 기준. 06시 이전이면 전날.
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const h = kst.getUTCHours();
  if (h < 6) kst.setUTCDate(kst.getUTCDate() - 1);
  return kst.toISOString().slice(0, 10);
}
function businessDayStartOffset(dateStr) {
  return `${dateStr}T06:00:00+09:00`;
}
function thisWeekStartDateKst() {
  // 배민과 동일: “조회 가능 최신일(보통 어제)”이 속한 수~화 주.
  // 수요일에 today 기준으로 잡으면 전주 화요일이 빠져 마감 수집이 누락된다.
  try {
    const week = require('../server/baemin-settlement-week');
    const latest = week.latestQueryableDate(week.todayKST()) || week.todayKST();
    return week.settlementWeekStart(latest);
  } catch {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const h = kst.getUTCHours();
    if (h < 6) kst.setUTCDate(kst.getUTCDate() - 1);
    const dow = kst.getUTCDay();
    const diff = (dow - 3 + 7) % 7;
    kst.setUTCDate(kst.getUTCDate() - diff);
    return kst.toISOString().slice(0, 10);
  }
}
/** 특정 날짜가 속한 정산주 시작(수요일) 날짜 */
function weekStartForDate(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return thisWeekStartDateKst();
  const dow = d.getUTCDay(); // 0=일..3=수
  const diff = (dow - 3 + 7) % 7; // 수요일로 되돌리기
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}
function addDaysKeyUtc(dateStr, days) {
  const cur = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  cur.setUTCDate(cur.getUTCDate() + Number(days || 0));
  return cur.toISOString().slice(0, 10);
}

function datesFromTo(fromDate, toDate) {
  const today = businessDateKst();
  const from = String(fromDate || '').slice(0, 10);
  const to = String(toDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    return [];
  }
  const dates = [];
  let cursor = from;
  while (cursor <= to && cursor <= today) {
    dates.push(cursor);
    cursor = addDaysKeyUtc(cursor, 1);
  }
  return dates;
}

/** 오늘(영업일)을 끝으로 하는 연속 일수. 전날 포함, 수요일에도 어제 누락 없음. */
function lookbackDates(dayCount = 8) {
  const today = businessDateKst();
  const days = Math.max(1, Number(dayCount) || 8);
  return datesFromTo(addDaysKeyUtc(today, -(days - 1)), today);
}

/** 주 시작(수)~화 7일 중 오늘(영업일) 이하의 날짜 배열 (미래 제외) */
function weekDatesFrom(weekStart) {
  const today = businessDateKst();
  const dates = [];
  const cur = new Date(`${String(weekStart).slice(0, 10)}T00:00:00Z`);
  for (let i = 0; i < 7; i += 1) {
    const ds = cur.toISOString().slice(0, 10);
    if (ds <= today) dates.push(ds);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}
/** 이번 정산주 수요일 ~ 오늘(영업일)까지의 날짜 배열 (라이더 일별 백필용) */
function weekDatesUpToToday() {
  return weekDatesFrom(thisWeekStartDateKst());
}

function isContextAlive(ctx) {
  if (!ctx) return false;
  try {
    void ctx.pages();
    return true;
  } catch {
    return false;
  }
}

const pageRoles = new WeakMap();

function pageUrlOf(page) {
  try { return String(page.url() || ''); } catch { return ''; }
}

function isNaverPage(page) {
  return require('../server/coupang-naver-otp').isNaverUrl(pageUrlOf(page));
}

function isCoupangPage(page) {
  return /coupangeats\.com|xauth\.coupang\.com/i.test(pageUrlOf(page));
}

function listLivePages() {
  if (!isContextAlive(context)) return [];
  try {
    return context.pages().filter((page) => {
      try { return !page.isClosed(); } catch { return false; }
    });
  } catch {
    return [];
  }
}

function findCoupangPage() {
  const pages = listLivePages();
  return pages.find((page) => pageRoles.get(page) === 'coupang')
    || pages.find((page) => isCoupangPage(page))
    || pages.find((page) => !isNaverPage(page))
    || null;
}

function findNaverPage() {
  const pages = listLivePages();
  return pages.find((page) => pageRoles.get(page) === 'naver')
    || pages.find((page) => isNaverPage(page))
    || null;
}

async function ensureSessionTabs() {
  if (!isContextAlive(context)) return;
  const naverOtp = require('../server/coupang-naver-otp');
  let coupang = findCoupangPage();
  if (!coupang) {
    coupang = listLivePages().find((page) => !isNaverPage(page)) || await context.newPage();
  }
  pageRoles.set(coupang, 'coupang');
  const coupangUrl = pageUrlOf(coupang);
  if (!coupangUrl || coupangUrl === 'about:blank') {
    await coupang.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
  }
  let naver = findNaverPage();
  if (!naver) {
    naver = await context.newPage();
    pageRoles.set(naver, 'naver');
    await naver.goto('https://mail.naver.com', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
    console.log(`[COUPANG] ${ACCOUNT.label} — 같은 창에 네이버 탭을 열었습니다. 메일에서 직접 로그인하세요.`);
  } else {
    pageRoles.set(naver, 'naver');
    const naverUrl = pageUrlOf(naver);
    if (!naverUrl || naverUrl === 'about:blank') {
      await naver.goto('https://mail.naver.com', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
    }
  }
  naverOtp.bindSharedBrowserContext(context);
  await scanPageForToken(coupang).catch(() => {});
}

async function ensureBrowser() {
  if (isContextAlive(context)) {
    await ensureSessionTabs().catch(() => null);
    return context;
  }
  context = null;
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1360, height: 900 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      // 키클락 로그인 상태 iframe 이 서드파티 쿠키를 못 읽으면
      // 정상 세션도 로그아웃으로 오인한다.
      '--disable-features=ThirdPartyStoragePartitioning,TrackingProtection3pcd'
    ]
  });
  context.on('request', (req) => {
    try {
      const url = req.url();
      if (!url.includes('coupangeats.com')) return;
      // 1차: 동기 헤더에서 Bearer 포착(기존 경로)
      captureAuthFromHeaders(req.headers(), 'request');
      const m = url.match(/\/dashboard\/(\d+)\//);
      if (m) seenVendorIds.add(m[1]);
      try {
        const u = new URL(url);
        if (/\/bff\/api\//.test(u.pathname) || /dashboard|performance|vendor/i.test(u.pathname)) {
          if (seenApiPaths.size < 120) seenApiPaths.add(`${req.method()} ${u.pathname}${u.search}`);
        }
      } catch { /* ignore */ }
    } catch { /* ignore */ }
  });
  // 2차 폴백: 완료된 요청의 전체 헤더(allHeaders)에서 Bearer 포착.
  // 일부 헤더는 요청 시점 동기 headers()에 안 잡히고 완료 후에만 보이는 경우가 있음.
  context.on('requestfinished', async (req) => {
    try {
      const url = req.url();
      if (!url.includes('coupangeats.com')) return;
      if (latestToken && Date.now() - latestTokenAt < 60 * 1000) return; // 최근 토큰 있으면 skip
      const all = await req.allHeaders().catch(() => null);
      captureAuthFromHeaders(all, 'requestfinished');
    } catch { /* ignore */ }
  });
  context.on('response', async (res) => {
    try {
      const url = res.url();
      if (!url.includes('/protocol/openid-connect/token')) return;
      if (!res.ok()) return;
      const json = await res.json().catch(() => null);
      if (json && json.refresh_token) saveLocalRefreshToken(json.refresh_token);
      if (json && json.access_token && adoptToken(json.access_token, 'oidc_token')) {
        await persistToken('oidc_token').catch(() => {});
      }
    } catch { /* ignore */ }
  });
  context.on('close', () => { context = null; });
  try {
    const browser = context.browser();
    if (browser) {
      browser.on('disconnected', () => {
        context = null;
        console.warn('[COUPANG] 브라우저 연결 끊김 — 다음 복구 때 다시 실행합니다. 쿠팡 창을 닫지 마세요.');
      });
    }
  } catch { /* persistent context 에 browser() 없을 수 있음 */ }
  await ensureSessionTabs().catch((error) => {
    console.warn('[COUPANG] 탭 준비 실패:', error?.message || error);
  });
  return context;
}

/**
 * 3차 폴백: 페이지 localStorage/sessionStorage 안에서 JWT(access token)를 스캔.
 * SPA가 토큰을 헤더가 아니라 스토리지에 보관하고 fetch 시점에 주입하는 경우 대비.
 */
async function scanPageForToken(page) {
  if (!page) return false;
  try {
    const found = await page.evaluate(() => {
      const out = [];
      const scan = (store) => {
        try {
          for (let i = 0; i < store.length; i += 1) {
            const key = store.key(i);
            const val = store.getItem(key);
            if (!val) continue;
            // 값 자체가 JWT거나, JSON 안에 accessToken/token 필드가 있는 경우
            const push = (v) => { if (typeof v === 'string' && /^ey[\w-]+\.[\w-]+\.[\w-]*$/.test(v)) out.push(v); };
            push(val);
            try {
              const obj = JSON.parse(val);
              if (obj && typeof obj === 'object') {
                ['accessToken', 'access_token', 'token', 'idToken', 'jwt', 'authorization'].forEach(k => push(obj[k]));
              }
            } catch { /* not json */ }
          }
        } catch { /* ignore */ }
      };
      try { scan(window.localStorage); } catch { /* ignore */ }
      try { scan(window.sessionStorage); } catch { /* ignore */ }
      return out;
    }).catch(() => []);
    for (const tok of (found || [])) {
      if (adoptToken(tok, 'storage')) return true;
    }
  } catch { /* ignore */ }
  return false;
}

let lastPortalHoldAt = 0;
let portalHoldNote = '';
let portalHoldTimer = null;
let lastSoftReloadAt = 0;

/**
 * 쿠팡 파트너 포털은 키클락이다. access token TTL이 약 9~10분이다.
 * 페이지를 다시 열면 새 로그인으로 봐서 세션이 끊기므로,
 * 이동 없이 refresh_token / Keycloak.updateToken 으로만 갱신한다.
 */
async function holdCoupangPortalSession(opts = {}) {
  if (!isContextAlive(context)) return { ok: false, message: '브라우저 없음' };
  const page = findCoupangPage();
  if (!page) return { ok: false, message: '페이지 없음' };
  const url = String(page.url() || '');
  if (/xauth\.coupang\.com|openid-connect\/auth|login-actions/i.test(url)) {
    portalHoldNote = '로그인 화면 — 아이디/비번 자동 입력';
    clearLocalRefreshToken();
    if (MANUAL_LOGIN || opts.noRecover) {
      authRequired = true;
      authRequiredReason = MANUAL_LOGIN
        ? 'COUPANG_MANUAL_LOGIN=1 — 자동 로그인을 하지 않습니다.'
        : '로그인 화면 — 아이디/비번 자동 입력 대기';
      return { ok: false, onLogin: true, needsRelogin: !MANUAL_LOGIN };
    }
    console.log(`[COUPANG] ${ACCOUNT.label} — 로그인 화면 감지, 아이디/비번 자동 입력`);
    const recovered = await tryRecoverCoupangAuthWithNaverOtp();
    if (recovered?.ok && isTokenUsable(latestToken)) {
      portalHoldNote = `login-reauth ${recovered.via || 'auto'}`;
      return { ok: true, recovered: true, via: recovered.via };
    }
    authRequired = true;
    authRequiredReason = recovered?.message || '로그인 화면 — 아이디/비번 자동 입력 실패';
    return { ok: false, onLogin: true, needsRelogin: true, message: authRequiredReason };
  }
  if (!/partner\.coupangeats\.com/i.test(url)) return { ok: false, skipped: true };
  const ttl = tokenTtlMs(latestToken);
  const tokenAgeMs = latestTokenAt ? Date.now() - latestTokenAt : Number.POSITIVE_INFINITY;
  // 만료됐거나 헬스체크가 강제하면 45초 간격도 무시하고 바로 갱신
  const urgent = Boolean(opts.force) || !isTokenUsable(latestToken);
  const minGapMs = 45 * 1000;
  if (!urgent && Date.now() - lastPortalHoldAt < minGapMs) return { ok: true, skipped: true };
  // access 수명 ~10분. 발급 3분(4분 전) 또는 남은 TTL 6분 이하면 무조건 갱신
  const due = urgent
    || tokenAgeMs >= 3 * 60 * 1000
    || (isTokenUsable(latestToken) && ttl < 6 * 60 * 1000)
    || (Date.now() - lastPortalHoldAt > 3 * 60 * 1000);
  if (!due) return { ok: true, skipped: true };
  lastPortalHoldAt = Date.now();

  if (!latestRefreshToken) loadLocalRefreshToken();
  let result = null;
  try {
    result = await page.evaluate(async (storedRefresh) => {
      const notes = [];
      const TOKEN_URL = 'https://xauth.coupang.com/auth/realms/eats-partner/protocol/openid-connect/token';
      const CLIENT_ID = 'edp-vendor-portal';

      const looksJwt = (v) => typeof v === 'string' && /^ey[\w-]+\.[\w-]+\.[\w-]*$/.test(v);
      const pickTokens = (obj, out) => {
        if (!obj || typeof obj !== 'object') return;
        ['token', 'access_token', 'accessToken', 'id_token', 'idToken'].forEach((k) => {
          if (looksJwt(obj[k])) out.access = obj[k];
        });
        ['refresh_token', 'refreshToken'].forEach((k) => {
          if (typeof obj[k] === 'string' && obj[k].length > 20) out.refresh = obj[k];
        });
        ['clientId', 'client_id'].forEach((k) => {
          if (typeof obj[k] === 'string' && obj[k]) out.clientId = obj[k];
        });
      };
      const scanStore = (store) => {
        const found = { access: '', refresh: '', clientId: '', keys: [] };
        try {
          for (let i = 0; i < store.length; i += 1) {
            const key = store.key(i);
            const val = store.getItem(key);
            found.keys.push(key);
            if (!val) continue;
            if (looksJwt(val) && !found.access) found.access = val;
            const tryObj = (obj, depth) => {
              if (!obj || typeof obj !== 'object' || depth > 4) return;
              pickTokens(obj, found);
              Object.keys(obj).forEach((k) => {
                const v = obj[k];
                if (typeof v === 'string') {
                  if (looksJwt(v) && !found.access) found.access = v;
                  if (/refresh/i.test(k) && v.length > 20 && !found.refresh) found.refresh = v;
                } else if (v && typeof v === 'object') {
                  tryObj(v, depth + 1);
                }
              });
            };
            try {
              tryObj(JSON.parse(val), 0);
            } catch { /* not json */ }
            if (/refresh/i.test(key) && typeof val === 'string' && val.length > 20 && !found.refresh) {
              found.refresh = val;
            }
          }
        } catch { /* ignore */ }
        return found;
      };

      const fromLocal = scanStore(window.localStorage);
      const fromSession = scanStore(window.sessionStorage);
      let refresh = fromLocal.refresh || fromSession.refresh || '';
      const clientId = fromLocal.clientId || fromSession.clientId || CLIENT_ID;
      if (!refresh && window.__bremKeycloak && typeof window.__bremKeycloak.refreshToken === 'string') {
        refresh = window.__bremKeycloak.refreshToken;
        notes.push('refresh-from-kc-memory');
      }
      if (!refresh && storedRefresh) {
        refresh = storedRefresh;
        notes.push('refresh-from-node');
      }
      notes.push(refresh ? 'refresh-found' : 'refresh-missing');
      notes.push(`ls:${fromLocal.keys.length} ss:${fromSession.keys.length}`);
      if (!refresh) {
        const hintKeys = [...fromLocal.keys, ...fromSession.keys]
          .filter((k) => /token|auth|kc|oidc|keycloak|coupang|edp/i.test(k))
          .slice(0, 12);
        if (hintKeys.length) notes.push(`keys:${hintKeys.join(',')}`);
      }

      // 1) refresh_token 직접 갱신 (Keycloak 인스턴스 없어도 동작)
      if (refresh) {
        try {
          const body = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: refresh
          });
          const res = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
            credentials: 'include'
          });
          const json = await res.json().catch(() => null);
          if (res.ok && json && looksJwt(json.access_token)) {
            try {
              for (let i = 0; i < window.localStorage.length; i += 1) {
                const key = window.localStorage.key(i);
                const val = window.localStorage.getItem(key);
                if (!val || !val.includes(refresh)) continue;
                try {
                  const obj = JSON.parse(val);
                  if (obj && typeof obj === 'object') {
                    if (obj.refresh_token) obj.refresh_token = json.refresh_token || refresh;
                    if (obj.refreshToken) obj.refreshToken = json.refresh_token || refresh;
                    if (obj.access_token) obj.access_token = json.access_token;
                    if (obj.token) obj.token = json.access_token;
                    window.localStorage.setItem(key, JSON.stringify(obj));
                  }
                } catch { /* ignore */ }
              }
            } catch { /* ignore */ }
            notes.push('refresh-ok');
            return {
              ok: true,
              refreshed: true,
              note: notes.join(' '),
              token: json.access_token,
              refreshToken: json.refresh_token || refresh,
              exp: 0
            };
          }
          notes.push(`refresh-http-${res.status}`);
        } catch (error) {
          notes.push(`refresh-err ${error && error.message ? error.message : error}`);
        }
      }

      // 2) Keycloak 인스턴스가 있으면 updateToken
      const isKc = (obj) => !!(
        obj
        && typeof obj.updateToken === 'function'
        && typeof obj.login === 'function'
        && typeof obj.createLoginUrl === 'function'
      );
      const remember = (obj) => {
        if (!isKc(obj)) return false;
        window.__bremKeycloak = obj;
        return true;
      };
      if (!remember(window.__bremKeycloak)) {
        const chunkNames = Object.keys(window).filter((key) => /webpackChunk|webpackJsonp/i.test(key));
        notes.push(chunkNames.length ? `chunks:${chunkNames.length}` : 'no-webpack-chunk');
        for (const name of chunkNames) {
          const chunk = window[name];
          if (!chunk || typeof chunk.push !== 'function') continue;
          let req = null;
          try {
            chunk.push([[`brem-hold-${Date.now()}`], {}, (r) => { req = r; }]);
          } catch {
            continue;
          }
          const cache = req && req.c;
          if (!cache) continue;
          const ids = Object.keys(cache);
          for (let i = 0; i < ids.length; i += 1) {
            const exported = cache[ids[i]] && cache[ids[i]].exports;
            if (!exported) continue;
            if (remember(exported) || remember(exported.default) || remember(exported.keycloak)) break;
          }
          if (window.__bremKeycloak) break;
        }
      }
      const kc = window.__bremKeycloak;
      if (!kc) {
        const fallback = fromLocal.access || fromSession.access || '';
        if (looksJwt(fallback)) {
          let expMs = 0;
          try {
            const payload = JSON.parse(atob(fallback.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            expMs = Number(payload && payload.exp ? payload.exp : 0) * 1000;
          } catch { /* ignore */ }
          // refresh 없이 storage access만 있으면 곧 만료 — 성공으로 치지 않음(상위에서 soft-reload)
          if (!expMs || expMs < Date.now() + 4 * 60 * 1000) {
            notes.push('storage-token-near-expiry');
            return { ok: false, nearExpiry: true, note: notes.join(' '), token: fallback, exp: 0 };
          }
          notes.push('storage-token-only');
          return { ok: true, refreshed: false, note: notes.join(' '), token: fallback, exp: 0 };
        }
        return { ok: false, note: notes.join(' ') || 'keycloak-not-found' };
      }
      if (!kc.authenticated || !kc.token) return { ok: false, note: `${notes.join(' ')} not-authenticated` };
      try {
        const refreshed = await kc.updateToken(300);
        notes.push(refreshed ? 'kc-refreshed' : 'kc-valid');
        return {
          ok: true,
          refreshed: Boolean(refreshed),
          note: notes.join(' '),
          token: kc.token || '',
          refreshToken: kc.refreshToken || '',
          exp: kc.tokenParsed && kc.tokenParsed.exp ? kc.tokenParsed.exp : 0
        };
      } catch (error) {
        return { ok: false, note: `${notes.join(' ')} kc-fail ${error && error.message ? error.message : error}` };
      }
    }, latestRefreshToken || '');
  } catch (error) {
    portalHoldNote = error?.message || String(error);
    return { ok: false, message: portalHoldNote };
  }
  portalHoldNote = result?.note || '';
  if (result?.refreshToken) saveLocalRefreshToken(result.refreshToken);
  if (result?.token) {
    if (adoptToken(result.token, 'portal_hold')) {
      await persistToken('portal_hold').catch(() => {});
    }
  }
  // refresh 없이 access만 있으면 만료 전 SSO soft-reload로 재발급
  const needsSsoReload = !latestRefreshToken
    && /partner\.coupangeats\.com/i.test(url)
    && (
      !result?.ok
      || result?.nearExpiry
      || (isTokenUsable(latestToken) && tokenTtlMs(latestToken) < 4 * 60 * 1000)
      || /storage-token-only|refresh-missing/i.test(String(result?.note || ''))
    );
  if (
    !opts.noReload
    && needsSsoReload
    && (!isTokenUsable(latestToken) || tokenTtlMs(latestToken) < 4 * 60 * 1000 || result?.nearExpiry)
  ) {
    const reloadGap = latestRefreshToken ? 8 * 60 * 1000 : 5 * 60 * 1000;
    if (Date.now() - lastSoftReloadAt > reloadGap) {
      lastSoftReloadAt = Date.now();
      portalHoldNote = `${portalHoldNote || 'hold-fail'} → soft-reload`;
      console.log(`[COUPANG] 포털 soft-reload (토큰 복구 시도) · ${ACCOUNT.label}`);
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleepMs(2500);
        const after = String(page.url() || '');
        if (/xauth\.coupang\.com|openid-connect\/auth|login-actions/i.test(after)) {
          portalHoldNote = 'soft-reload → 로그인 화면, 아이디/비번 자동 입력';
          clearLocalRefreshToken();
          if (MANUAL_LOGIN || opts.noRecover) {
            authRequired = true;
            authRequiredReason = MANUAL_LOGIN
              ? 'COUPANG_MANUAL_LOGIN=1 — 자동 로그인을 하지 않습니다.'
              : '로그인 화면 — 아이디/비번 자동 입력 대기';
            return { ok: false, onLogin: true, needsRelogin: !MANUAL_LOGIN, note: portalHoldNote };
          }
          const recovered = await tryRecoverCoupangAuthWithNaverOtp();
          if (recovered?.ok && isTokenUsable(latestToken)) {
            portalHoldNote = `soft-reload-reauth ${recovered.via || 'auto'}`;
            return { ok: true, recovered: true, via: recovered.via, note: portalHoldNote };
          }
          authRequired = true;
          authRequiredReason = recovered?.message || '로그인 화면 — 아이디/비번 자동 입력 실패';
          return { ok: false, onLogin: true, needsRelogin: true, note: portalHoldNote };
        }
        await scanPageForToken(page).catch(() => {});
        if (isTokenUsable(latestToken)) {
          portalHoldNote = 'soft-reload-token-ok';
          return { ok: true, refreshed: true, note: portalHoldNote };
        }
        lastPortalHoldAt = 0;
        return holdCoupangPortalSession({ noReload: true });
      } catch (error) {
        portalHoldNote = `soft-reload-fail ${error?.message || error}`;
      }
    }
  }
  if (result?.ok) {
    console.log(`[COUPANG] 포털 세션 유지 ${result.refreshed ? '갱신' : '유효'} · ${portalHoldNote}`);
  } else if (result?.note || portalHoldNote) {
    console.log(`[COUPANG] 포털 세션 유지 보류: ${portalHoldNote || result?.note}`);
  }
  return result || { ok: false, note: portalHoldNote };
}

function startPortalHoldLoop() {
  if (portalHoldTimer) return;
  portalHoldTimer = setInterval(() => {
    holdCoupangPortalSession().catch(() => null);
  }, 90 * 1000);
  console.log('[COUPANG] 포털 세션 유지 루프 시작 (90초마다, 발급 3분 안에 갱신)');
}

async function waitForUsableToken(page, timeoutMs = 20000) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 20000);
  while (Date.now() < deadline) {
    if (isTokenUsable(latestToken)) return true;
    if (page) await scanPageForToken(page).catch(() => {});
    if (isTokenUsable(latestToken)) return true;
    await sleepMs(1000);
  }
  return isTokenUsable(latestToken);
}

/** 쿠키 세션이 살아 있으면 대시보드 재진입만으로 JWT를 다시 받는다. 네이버 OTP는 안 탄다. */
async function trySoftRefreshCoupangToken() {
  const auth = require('../server/crawl-session-auth');
  const autoLogin = require('../server/coupang-auto-login');
  await ensureBrowser().catch(() => null);
  const page = await getActivePage();
  if (!page) return { ok: false, message: '쿠팡 브라우저 페이지가 없습니다.' };
  const held = await holdCoupangPortalSession({ noRecover: true }).catch(() => null);
  if (isTokenUsable(latestToken)) {
    return { ok: true, via: held?.refreshed ? 'manual_refresh' : 'manual_hold' };
  }
  const url = String(page.url() || '');
  const loggedIn = await autoLogin.pageLooksLoggedIn(page).catch(() => false);
  if (auth.isCoupangLoginLikeUrl(url) && !loggedIn) {
    return { ok: false, needOtp: true };
  }
  if (isTokenUsable(latestToken)) return { ok: true, via: 'soft_refresh' };
  return { ok: false, needOtp: auth.isCoupangLoginLikeUrl(page.url()) };
}

async function captureCookieHeader() {
  if (!context) return '';
  try {
    const cookies = await context.cookies(ORIGIN + '/');
    latestCookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  } catch { /* ignore */ }
  return latestCookie;
}

function authHeaders() {
  const h = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'ko-KR',
    'origin': ORIGIN,
    'referer': `${ORIGIN}/`
  };
  if (latestToken) h['authorization'] = `Bearer ${latestToken}`;
  if (latestCookie) h['cookie'] = latestCookie;
  return h;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 동시 N개 제한 풀 실행 */
async function mapPool(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length || 1));
  const results = new Array(list.length);
  let next = 0;
  async function runOne() {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await worker(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => runOne()));
  return results;
}

async function apiGet(pathAndQuery, options = {}) {
  const maxAttempts = Math.max(1, Number(options.retries) || 3);
  let last = { ok: false, status: 0, json: null };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(`${ORIGIN}${pathAndQuery}`, { method: 'GET', headers: authHeaders() });
    const txt = await res.text();
    let json = null;
    try { json = JSON.parse(txt); } catch { /* non-json */ }
    last = { ok: res.ok, status: res.status, json };
    if (res.ok) return last;
    if (res.status === 401) return last;
    if (res.status === 429 || res.status >= 500) {
      const backoff = Math.min(8000, 400 * (2 ** (attempt - 1)));
      console.warn(`[BREM][coupang] GET retry ${attempt}/${maxAttempts} status=${res.status} wait=${backoff}ms`);
      await sleep(backoff);
      continue;
    }
    return last;
  }
  return last;
}
async function apiPost(pathAndQuery, body, options = {}) {
  const maxAttempts = Math.max(1, Number(options.retries) || 3);
  let last = { ok: false, status: 0, json: null };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(`${ORIGIN}${pathAndQuery}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const txt = await res.text();
    let json = null;
    try { json = JSON.parse(txt); } catch { /* non-json */ }
    last = { ok: res.ok, status: res.status, json };
    if (res.ok) return last;
    if (res.status === 401) return last;
    if (res.status === 429 || res.status >= 500) {
      const backoff = Math.min(8000, 400 * (2 ** (attempt - 1)));
      console.warn(`[BREM][coupang] POST retry ${attempt}/${maxAttempts} status=${res.status} wait=${backoff}ms`);
      await sleep(backoff);
      continue;
    }
    return last;
  }
  return last;
}

async function persistToken(source) {
  if (!latestToken) return;
  await captureCookieHeader();
  await sessionStore.saveStoredCoupangSession({
    token: latestToken,
    cookie: latestCookie,
    source: source || 'playwright_local',
    accountId: ACCOUNT.id
  }).catch(() => {});
}

/** 라이더별 일 실적 수집(특정 날짜). daily-vendor-performance POST. */
async function collectRiderForDate(dateStr, summary, pushErr, httpInfo) {
  const dayStart = businessDayStartOffset(dateStr);
  try {
    const body = { targetDate: dayStart, date: dateStr, pageNum: 0, pageSize: 1000 };
    const rider = await apiPost('/bff/api/v1/vendor/dashboard/daily-vendor-performance', body);
    summary.diag.push(httpInfo(`rider POST ${dateStr}`, rider));
    if (rider.ok && rider.json) {
      const items = sources.mapRiderToItems(dateStr, rider.json);
      if (items.length) {
        const r = await pipeline.upsertCollectItems(items);
        if (r.ok) return Number(r.saved || 0);
        pushErr(`rider ${dateStr} 저장:` + (r.error || r.message));
      }
    } else {
      pushErr(httpInfo(`rider ${dateStr}`, rider));
    }
  } catch (e) { pushErr(`rider ${dateStr}: ${e.message}`); }
  return 0;
}

/** 특정 날짜의 지역(매장)별 요약 수집. 첫 호출 응답에서 매장 목록도 반환. */
async function collectVendorInfoForDate(seed, dateStr, summary, pushErr, httpInfo, verbose) {
  const dayStart = businessDayStartOffset(dateStr);
  const info = await apiGet(`/bff/api/v2/vendor/dashboard/${seed}/daily-vendor-info?dateTime=${encodeURIComponent(dayStart)}`);
  if (verbose) summary.diag.push(httpInfo(`vendor_info GET ${dateStr}`, info));
  let vendors = [];
  let saved = 0;
  if (info.ok && info.json) {
    const items = sources.mapVendorInfoToItems(dateStr, info.json);
    if (items.length) {
      const r = await pipeline.upsertCollectItems(items);
      if (r.ok) saved = Number(r.saved || 0);
      else pushErr('vendor_info 저장:' + (r.error || r.message));
    } else if (verbose) {
      pushErr(`vendor_info ${dateStr}: 응답에 childVendorRecordDtos 없음`);
    }
    vendors = (info.json.data?.childVendorRecordDtos || []).map(c => ({
      id: String(c.vendorId), name: String(c.totalCumulativeStatus?.vendorName || '')
    }));
  } else if (verbose) {
    pushErr(httpInfo(`vendor_info ${dateStr}`, info));
  }
  return { vendors, saved };
}

/**
 * 전체 수집: vendor_info(전 매장, 날짜별) → 매장별 realtime(오늘)/weekly(주1회) → 라이더(날짜별)
 * options:
 *   date          기준 수집일 (기본 오늘)
 *   weekStartDate 정산주 시작(수). 미지정 시 date 기준 계산
 *   fullWeek      true면 정산주(수~화) 또는 lookbackDays. weekStartDate 있으면 그 주만
 *   lookbackDays  오늘 포함 N일 (기본 주기 수집 8일). fullWeek보다 우선
 *   fromDate/toDate 직접 기간
 *   riderDates    추가로 수집할 라이더 날짜 배열
 *   includeRider  false면 라이더 생략 (대시보드만)
 *   skipWeekly    true면 주간 생략
 *   includeRealtime false면 실시간(오늘) 생략
 */
async function runCollect(options = {}) {
  if (collecting) return { ok: false, message: '이미 수집 중입니다.' };
  if (!latestToken) {
    const recovered = await tryRecoverCoupangAuthWithNaverOtp();
    if (!recovered.ok || !latestToken) {
      return {
        ok: false,
        status: 401,
        message: recovered.message || '쿠팡 로그인 토큰이 없습니다. 자동로그인(.env) 또는 네이버 OTP를 확인하세요.',
        authState: 'authRequired'
      };
    }
  }

  const fromStatusLoop = options.waitForSharedSlot === true || options.sharedSlotGeneration != null;
  const slot = await acquireCollectMutexOrWait({
    wait: true,
    timeoutMs: fromStatusLoop ? 0 : (Number(options.sharedSlotTimeoutMs) || 10 * 60 * 1000),
    generation: options.sharedSlotGeneration,
    onWaiting: (holder) => {
      if (!fromStatusLoop) return;
      statusLoop.phase = 'waiting';
      statusLoop.message = `다른 쿠팡(${holder?.label || holder?.accountId || '?'}) 수집 끝날 때까지 대기 · 겹침 방지`;
      statusLoop.updatedAt = nowKstIsoOffset();
    }
  });
  if (!slot.ok) {
    return {
      ok: false,
      message: slot.message || '다른 쿠팡 세션이 수집 중입니다.',
      cancelled: Boolean(slot.cancelled)
    };
  }

  collecting = true;
  const summary = { peak_realtime: 0, weekly_performance: 0, vendor_info: 0, rider_daily: 0, errors: [], diag: [] };
  const pushErr = (msg) => { if (summary.errors.length < 12) summary.errors.push(String(msg)); };
  const httpInfo = (label, r) => {
    const extra = r.json && (r.json.message || r.json.error) ? ` ${r.json.message || r.json.error}` : (r.json ? '' : ' (non-JSON 응답)');
    return `${label}: HTTP ${r.status}${extra}`;
  };
  try {
    await captureCookieHeader();
    const today = businessDateKst();
    const collectDate = String(options.date || today);
    const weekStart = String(options.weekStartDate || weekStartForDate(collectDate));
    const dtNow = nowKstIsoOffset();

    // 수집 대상 날짜(vendor_info + rider). 미래 제외.
    let dates;
    const lookbackDays = Number(options.lookbackDays || 0);
    if (options.fromDate && options.toDate) {
      dates = datesFromTo(options.fromDate, options.toDate);
    } else if (lookbackDays > 0) {
      dates = lookbackDates(lookbackDays);
    } else if (options.fullWeek) {
      dates = options.weekStartDate
        ? weekDatesFrom(weekStart)
        : lookbackDates(8);
    } else {
      dates = Array.from(new Set([collectDate, ...((Array.isArray(options.riderDates) ? options.riderDates : []))]));
    }
    dates = dates.filter(d => d && d <= today).sort();
    if (!dates.length) dates = [collectDate];
    const refDate = dates[dates.length - 1];

    if (!latestCookie) pushErr('쿠키를 캡처하지 못했습니다(브라우저 세션 확인).');

    const seed = [...seenVendorIds][0];
    if (!seed) pushErr('감지된 매장 vendorId가 없습니다. 브라우저에서 쿠팡 대시보드를 한 번 여세요.');

    // 1) vendor 목록은 참조일 1회로 seed → 나머지 날짜는 병렬 backfill
    const VENDOR_POOL = 3;
    const DASHBOARD_POOL = 4;
    let vendors = [];
    if (seed) {
      summary.diag.push(`dates: ${dates.join(',')} · vendorPool=${VENDOR_POOL} dashboardPool=${DASHBOARD_POOL}`);
      const seedDate = refDate;
      const seeded = await collectVendorInfoForDate(seed, seedDate, summary, pushErr, httpInfo, true);
      if (seeded.vendors.length) vendors = seeded.vendors;
      summary.vendor_info += Number(seeded.saved || 0);
      const otherDates = dates.filter(d => d !== seedDate);
      if (otherDates.length) {
        const backfill = await mapPool(otherDates, VENDOR_POOL, async (d) => (
          collectVendorInfoForDate(seed, d, summary, pushErr, httpInfo, false)
        ));
        summary.vendor_info += backfill.reduce((sum, row) => sum + Number(row?.saved || 0), 0);
      }
    }
    if (!vendors.length) vendors = [...seenVendorIds].map(id => ({ id, name: '' }));

    // 2) 매장별 realtime(오늘만) + weekly(정산주 1회) — 소규모 병렬
    const wantRealtime = options.includeRealtime !== false && dates.includes(today);
    const wantWeekly = !options.skipWeekly;
    const dashResults = await mapPool(vendors, DASHBOARD_POOL, async (v) => {
      let realtimeSaved = 0;
      let weeklySaved = 0;
      if (wantRealtime) {
        try {
          const rt = await apiGet(`/bff/api/v2/vendor/dashboard/${v.id}/realtime-performance?dateTime=${encodeURIComponent(dtNow)}`);
          if (rt.ok && rt.json) {
            const items = sources.mapRealtimeToItems(v.id, v.name, today, rt.json);
            const r = await pipeline.upsertCollectItems(items);
            if (r.ok) realtimeSaved = Number(r.saved || 0);
            if (!items.length) pushErr(`realtime ${v.id}: 응답에 peakTimePerformance 없음`);
          } else {
            pushErr(httpInfo(`realtime ${v.id}`, rt));
          }
        } catch (e) { pushErr(`realtime ${v.id}: ${e.message}`); }
      }
      if (wantWeekly) {
        try {
          const wk = await apiGet(`/bff/api/v2/vendor/dashboard/${v.id}/weekly-performance?startDate=${encodeURIComponent(weekStart + 'T06:00:00')}`);
          if (wk.ok && wk.json) {
            const items = sources.mapWeeklyToItems(v.id, v.name, weekStart, wk.json);
            const r = await pipeline.upsertCollectItems(items);
            if (r.ok) weeklySaved = Number(r.saved || 0);
          } else {
            pushErr(httpInfo(`weekly ${v.id}`, wk));
          }
        } catch (e) { pushErr(`weekly ${v.id}: ${e.message}`); }
      }
      return { realtimeSaved, weeklySaved };
    });
    summary.peak_realtime += dashResults.reduce((sum, row) => sum + Number(row?.realtimeSaved || 0), 0);
    summary.weekly_performance += dashResults.reduce((sum, row) => sum + Number(row?.weeklySaved || 0), 0);

    // 3) 라이더별(전체) — 날짜별 소규모 병렬
    if (options.includeRider !== false) {
      const riderSaved = await mapPool(dates, VENDOR_POOL, async (d) => (
        collectRiderForDate(d, summary, pushErr, httpInfo)
      ));
      summary.rider_daily += riderSaved.reduce((sum, n) => sum + Number(n || 0), 0);
    }

    for (const menu of ['peak_realtime', 'weekly_performance', 'vendor_info', 'rider_daily']) {
      await pipeline.saveRun(menu === 'weekly_performance' ? weekStart : refDate, menu, summary.errors.length ? 'partial' : 'ok', summary[menu], summary.errors.join(' | ').slice(0, 500));
    }
    const authFailed = summary.errors.some((msg) => /HTTP 401|unauthorized/i.test(String(msg || '')));
    if (authFailed) {
      clearCoupangToken('API 401 — 토큰/세션 만료');
      await holdCoupangPortalSession().catch(() => null);
      return {
        ok: false,
        status: 401,
        message: '쿠팡 API 401 — 세션 만료. 네이버 로그인 확인 후 제한된 복구만 합니다.',
        collectDate,
        weekStart,
        dates,
        summary,
        vendorCount: vendors.length,
        apiSamples: [...seenApiPaths].slice(0, 60)
      };
    }
    await persistToken('collect');
    return {
      ok: true,
      collectDate,
      weekStart,
      dates,
      summary,
      vendorCount: vendors.length,
      apiSamples: [...seenApiPaths].slice(0, 60)
    };
  } finally {
    collecting = false;
    releaseCollectMutex();
  }
}

// ── 자동수집 루프: 1회 수집 끝나면 30초 대기. 2계정은 파일 락으로 동시 수집 금지. ──
const STATUS_LOOP_WAIT_MS = 30 * 1000;
const COLLECT_MUTEX_PATH = path.join(process.cwd(), '.coupang-collect-mutex.json');
const COLLECT_MUTEX_STALE_MS = 12 * 60 * 1000;
const statusLoop = {
  active: false,
  stopping: false,
  round: 0,
  phase: 'idle',
  message: '',
  lastError: '',
  startedAt: null,
  updatedAt: null,
  waitEndsAt: 0,
  lastSummary: null,
  /** 재시작 시 겹친 루프 방지 */
  generation: 0,
  /** true면 1회차도 fullWeek 대신 오늘(순회)만 — 직전에 주단위를 이미 돌린 경우 */
  skipFirstFullWeek: false
};
let statusLoopPromise = null;

function getStatusLoopPayload() {
  return {
    active: statusLoop.active,
    round: statusLoop.round,
    phase: statusLoop.phase,
    message: statusLoop.message,
    lastError: statusLoop.lastError,
    startedAt: statusLoop.startedAt,
    updatedAt: statusLoop.updatedAt,
    waitEndsAt: statusLoop.waitEndsAt,
    waitMs: STATUS_LOOP_WAIT_MS,
    lastSummary: statusLoop.lastSummary,
    accountId: ACCOUNT?.id || null,
    accountLabel: ACCOUNT?.label || null
  };
}

function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isProcessAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

function readCollectMutex() {
  try {
    return JSON.parse(fs.readFileSync(COLLECT_MUTEX_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function isCollectMutexHeld(cur) {
  if (!cur || typeof cur !== 'object') return false;
  const age = Date.now() - Number(cur.since || 0);
  if (!Number.isFinite(age) || age < 0 || age > COLLECT_MUTEX_STALE_MS) return false;
  if (Number(cur.pid) === process.pid) return true;
  return isProcessAlive(cur.pid);
}

function tryAcquireCollectMutex() {
  const accountId = String(ACCOUNT?.id || 'default');
  const cur = readCollectMutex();
  if (isCollectMutexHeld(cur) && Number(cur.pid) !== process.pid) {
    return { ok: false, holder: cur };
  }
  if (cur && !isCollectMutexHeld(cur)) {
    try { fs.unlinkSync(COLLECT_MUTEX_PATH); } catch { /* ignore */ }
  }
  const payload = {
    accountId,
    label: ACCOUNT?.label || accountId,
    pid: process.pid,
    port: PORT,
    since: Date.now()
  };
  try {
    const fd = fs.openSync(COLLECT_MUTEX_PATH, 'wx');
    try {
      fs.writeFileSync(fd, JSON.stringify(payload));
    } finally {
      fs.closeSync(fd);
    }
    return { ok: true, holder: payload };
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      const holder = readCollectMutex();
      if (holder && Number(holder.pid) === process.pid) return { ok: true, holder };
      if (!isCollectMutexHeld(holder)) {
        try { fs.unlinkSync(COLLECT_MUTEX_PATH); } catch { /* ignore */ }
        try {
          const fd = fs.openSync(COLLECT_MUTEX_PATH, 'wx');
          try {
            fs.writeFileSync(fd, JSON.stringify(payload));
          } finally {
            fs.closeSync(fd);
          }
          return { ok: true, holder: payload };
        } catch {
          return { ok: false, holder: readCollectMutex() };
        }
      }
      return { ok: false, holder };
    }
    try {
      fs.writeFileSync(COLLECT_MUTEX_PATH, JSON.stringify(payload));
      return { ok: true, holder: payload };
    } catch (writeErr) {
      return { ok: false, holder: null, error: writeErr.message };
    }
  }
}

function releaseCollectMutex() {
  const cur = readCollectMutex();
  if (!cur) return;
  if (Number(cur.pid) !== process.pid) return;
  try { fs.unlinkSync(COLLECT_MUTEX_PATH); } catch { /* ignore */ }
}

/** 3940/3941 이 DB 쓰기를 동시에 하지 않도록 공유 슬롯 확보 */
async function acquireCollectMutexOrWait(options = {}) {
  const wait = options.wait !== false;
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || 0);
  const generation = options.generation;
  const started = Date.now();
  while (true) {
    if (
      generation != null
      && (statusLoop.generation !== generation || !statusLoop.active || statusLoop.stopping)
    ) {
      return { ok: false, cancelled: true, message: '수집 슬롯 대기 중 중지됨' };
    }
    const got = tryAcquireCollectMutex();
    if (got.ok) return got;
    if (!wait) {
      const h = got.holder;
      return {
        ok: false,
        message: `다른 쿠팡 세션이 수집 중입니다 (${h?.label || h?.accountId || '?'}:${h?.port || '?'})`
      };
    }
    if (timeoutMs > 0 && Date.now() - started > timeoutMs) {
      return { ok: false, message: '다른 쿠팡 세션 수집 대기 시간이 초과되었습니다.' };
    }
    if (typeof options.onWaiting === 'function') {
      options.onWaiting(got.holder || null);
    }
    await sleepMs(1500);
  }
}

function getCurrentUrlSafe() {
  try {
    const page = findCoupangPage();
    return page ? pageUrlOf(page) : '';
  } catch {
    return '';
  }
}

function getAuthPayload() {
  const auth = require('../server/crawl-session-auth');
  const currentUrl = getCurrentUrlSafe();
  const tokenExpired = Boolean(latestToken) && !isTokenUsable(latestToken);
  const authState = auth.resolveCoupangAuthState({
    hasToken: Boolean(latestToken) && !tokenExpired,
    recovering: authRecovering || require('../server/coupang-naver-otp').isRecovering(),
    currentUrl,
    authRequired: authRequired || tokenExpired || (!latestToken && Boolean(currentUrl)),
    tokenExpired
  });
  return {
    authState,
    authStateLabel: auth.authStateLabel(authState),
    authRequired: authState === 'authRequired' || authRequired || tokenExpired,
    authRequiredReason: authRequiredReason || (tokenExpired ? '쿠팡 토큰 만료 — 재로그인/OTP 복구 필요' : ''),
    recovering: authRecovering,
    currentUrl,
    tokenExpired
  };
}

async function tryRecoverCoupangAuthWithNaverOtp(options = {}) {
  if (MANUAL_LOGIN) {
    await ensureBrowser().catch(() => null);
    authRequired = true;
    authRequiredReason = 'COUPANG_MANUAL_LOGIN=1 — 자동 로그인을 하지 않습니다.';
    return {
      ok: false,
      error: 'COUPANG_MANUAL_LOGIN_REQUIRED',
      manual: true,
      message: authRequiredReason
    };
  }
  if (recoverPromise) {
    const waited = await Promise.race([
      recoverPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 180000))
    ]);
    if (isTokenUsable(latestToken)) {
      return { ok: true, hasToken: true, via: 'waited_inflight' };
    }
    if (waited) return waited;
    return { ok: false, message: '이미 자동로그인/OTP 복구 중입니다.' };
  }
  recoverPromise = recoverCoupangAuthNow(options).finally(() => {
    recoverPromise = null;
  });
  return recoverPromise;
}

async function recoverCoupangAuthNow(options = {}) {
  await ensureBrowser().catch(() => null);
  const autoLogin = require('../server/coupang-auto-login');
  if (shouldSkipNaverRecover()) {
    return { ok: false, error: 'NAVER_RECOVER_SKIPPED', message: '네이버 자격 오류 후 재시도 대기 중' };
  }
  authRecovering = true;
  authRequired = true;
  authRequiredReason = '쿠팡 아이디/비번 입력 + 열린 메일 OTP 시도 중';
  try {
    // 만료 토큰이 남아 있으면 복구 성공으로 오판함 → 먼저 비움
    if (latestToken && !isTokenUsable(latestToken)) {
      clearCoupangToken('만료 토큰 폐기 후 재로그인');
    }

    await ensureBrowser();
    const soft = await trySoftRefreshCoupangToken();
    if (soft.ok && isTokenUsable(latestToken)) {
      require('../server/coupang-login-budget').recordSuccess();
      lastAutoLoginAttemptAt = 0;
      authRequired = false;
      authRequiredReason = '';
      return { ok: true, hasToken: true, via: soft.via || 'soft_refresh' };
    }
    if (!options.knownOtp && lastAutoLoginAttemptAt && Date.now() - lastAutoLoginAttemptAt < LOGIN_COOLDOWN_MS) {
      authRequiredReason = '직전 로그인 실패 후 2분간 재시도하지 않습니다.';
      return { ok: false, error: 'LOGIN_COOLDOWN', message: authRequiredReason };
    }

    const page = await getActivePage();
    if (!page) return { ok: false, message: '쿠팡 브라우저 페이지가 없습니다.' };

    const result = await autoLogin.autoLoginCoupang(page, {
      origin: ORIGIN,
      knownOtp: options.knownOtp || '',
      onTokenScan: async (p) => {
        await scanPageForToken(p).catch(() => {});
      }
    });

    await waitForUsableToken(page, 25000);
    await persistToken(result.ok ? 'auto_login' : 'auto_login_failed').catch(() => {});

    if (isTokenUsable(latestToken)) {
      require('../server/coupang-login-budget').recordSuccess();
      lastAutoLoginAttemptAt = 0;
      authRequired = false;
      authRequiredReason = '';
      return { ok: true, hasToken: true, via: result.via || 'auto_login', alreadyLoggedIn: result.alreadyLoggedIn };
    }
    if (result.ok) {
      if (latestToken && !isTokenUsable(latestToken)) clearCoupangToken('복구 후 만료 토큰 잔상');
      await page.goto(`${ORIGIN}/page/rider-performance`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
      await waitForUsableToken(page, 15000);
      await persistToken('auto_login_rescan').catch(() => {});
      if (isTokenUsable(latestToken)) {
        require('../server/coupang-login-budget').recordSuccess();
        lastAutoLoginAttemptAt = 0;
        authRequired = false;
        authRequiredReason = '';
        return { ok: true, hasToken: true, via: 'auto_login_rescan' };
      }
    }
    const skipFailCount = /NAVER_NOT_LOGGED_IN|LOGIN_COOLDOWN|LOGIN_BUDGET_EXHAUSTED|EMAIL_BUDGET_EXHAUSTED|NAVER_RECOVER_SKIPPED|CREDENTIALS_MISSING/.test(String(result.error || ''));
    if (!skipFailCount) lastAutoLoginAttemptAt = Date.now();
    authRequiredReason = result.message || '쿠팡 자동로그인 실패 — 유효 토큰을 못 받음';
    const fail = { ok: false, message: authRequiredReason, error: result.error };
    markNaverRecoverOutcome(fail);
    return fail;
  } catch (error) {
    authRequiredReason = error?.message || String(error);
    const fail = { ok: false, message: authRequiredReason };
    markNaverRecoverOutcome(fail);
    return fail;
  } finally {
    authRecovering = false;
  }
}

function waitLoop(ms) {
  return new Promise((resolve) => {
    const step = 1000;
    let waited = 0;
    const t = setInterval(() => {
      waited += step;
      if (!statusLoop.active || statusLoop.stopping || waited >= ms) {
        clearInterval(t);
        resolve();
      }
    }, step);
  });
}

/** 장시간 대기 시 세션 로그아웃 방지: 라이더 퍼포먼스 ↔ 피크 대시보드 왕복 */
const KEEP_ALIVE_PAGES = [
  `${ORIGIN}/page/rider-performance`,
  `${ORIGIN}/page/peak-dashboard`
];

async function getActivePage() {
  await ensureBrowser().catch(() => null);
  if (!isContextAlive(context)) return null;
  const existing = findCoupangPage();
  if (existing) return existing;
  try {
    const page = await context.newPage();
    pageRoles.set(page, 'coupang');
    return page;
  } catch {
    context = null;
    await ensureBrowser().catch(() => null);
    return findCoupangPage();
  }
}

async function keepAliveDuringWait(ms, generation) {
  const started = Date.now();
  const waitMs = Math.max(1000, Number(ms) || STATUS_LOOP_WAIT_MS);
  if (!statusLoop.active || statusLoop.stopping || statusLoop.generation !== generation) return;
  const auth = require('../server/crawl-session-auth');
  const urlNow = getCurrentUrlSafe();
  const loginScreen = auth.isCoupangLoginLikeUrl(urlNow);
  // OTP/로그인 중에는 페이지를 건드리지 않는다. 창을 빼앗기면 인증이 멈춘다.
  const allowHop = false;
  const url = KEEP_ALIVE_PAGES[statusLoop.round % KEEP_ALIVE_PAGES.length];
  const label = url.includes('rider-performance') ? '라이더퍼포먼스' : '피크대시보드';
  statusLoop.phase = 'waiting';
  statusLoop.waitEndsAt = started + waitMs;
  statusLoop.message = allowHop
    ? `세션 유지 · ${label} 후 대기 (${Math.ceil(waitMs / 1000)}초) · ${statusLoop.round}회차`
    : `다음 회차 대기 (${Math.ceil(waitMs / 1000)}초) · ${statusLoop.round}회차 완료`;
  statusLoop.updatedAt = nowKstIsoOffset();

  if (allowHop) {
    try {
      const page = await getActivePage();
      if (page) {
        // goto가 永久 대기하지 않도록 상한
        await Promise.race([
          page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }),
          sleepMs(28000)
        ]);
        await scanPageForToken(page).catch(() => {});
        await Promise.race([
          persistToken('keepalive').catch(() => {}),
          sleepMs(5000)
        ]);
      }
    } catch (e) {
      statusLoop.lastError = e && e.message ? e.message : String(e);
    }
  } else {
    if (!loginScreen) {
      await Promise.race([
        holdCoupangPortalSession().catch(() => null),
        sleepMs(15000)
      ]);
    }
    await Promise.race([
      persistToken('keepalive-light').catch(() => {}),
      sleepMs(3000)
    ]);
  }

  if (!statusLoop.active || statusLoop.stopping || statusLoop.generation !== generation) return;
  const remaining = waitMs - (Date.now() - started);
  if (remaining > 500) {
    await waitLoop(remaining);
  }
}

async function runStatusAutoLoopInner(generation) {
  while (
    statusLoop.active
    && !statusLoop.stopping
    && statusLoop.generation === generation
  ) {
    if (!isTokenUsable(latestToken)) {
      const page = await getActivePage();
      if (page) await scanPageForToken(page).catch(() => {});
      await holdCoupangPortalSession({ force: true, noReload: true }).catch(() => null);
      if (isTokenUsable(latestToken)) continue;
      if (shouldSkipNaverRecover()) {
        statusLoop.phase = 'waiting';
        statusLoop.message = '네이버 자격 오류 — OTP 재시도 생략, 세션 유지만';
        statusLoop.updatedAt = nowKstIsoOffset();
        await keepAliveDuringWait(STATUS_LOOP_WAIT_MS, generation);
        continue;
      }
      if (latestToken) clearCoupangToken('만료 토큰 — 순회 중 복구');
      statusLoop.phase = 'waiting';
      statusLoop.waitEndsAt = Date.now() + 120000;
      statusLoop.message = '네이버 확인됨 — 쿠팡 이메일인증 1회 시도…';
      statusLoop.updatedAt = nowKstIsoOffset();
      const recovered = await tryRecoverCoupangAuthWithNaverOtp();
      if (statusLoop.generation !== generation) break;
      if (!recovered.ok || !isTokenUsable(latestToken)) {
        statusLoop.lastError = recovered.message || '쿠팡 인증 복구 실패';
        await keepAliveDuringWait(STATUS_LOOP_WAIT_MS, generation);
        continue;
      }
    } else if (
      tokenTtlMs(latestToken) < 6 * 60 * 1000
      || (latestTokenAt && Date.now() - latestTokenAt >= 3 * 60 * 1000)
    ) {
      statusLoop.phase = 'waiting';
      statusLoop.message = '토큰 선제 갱신 — refresh 유지 (페이지 이동 없음)';
      statusLoop.updatedAt = nowKstIsoOffset();
      await holdCoupangPortalSession().catch(() => null);
    }
    statusLoop.round += 1;
    const first = statusLoop.round === 1;
    const doFullWeek = first && !statusLoop.skipFirstFullWeek;
    if (first) statusLoop.skipFirstFullWeek = false;
    statusLoop.phase = 'collecting';
    statusLoop.waitEndsAt = 0;
    // 자동순회: 매 회차 라이더 퍼포먼스(rider_daily) 포함 — 기여도(0.8/1 단위 콜) 연속 반영
    statusLoop.message = doFullWeek
      ? '첫 회차: 대시보드 + 라이더 퍼포먼스(전날 포함 8일) 수집 중…'
      : `대시보드 + 라이더 퍼포먼스(오늘) 수집 중… (${statusLoop.round}회차)`;
    statusLoop.updatedAt = nowKstIsoOffset();
    try {
      // 1회차: 오늘 포함 8일 / 2회차+: 주간 생략·오늘은 라이더까지 계속
      // 2계정 동시 쓰기 방지: 다른 세션이 끝날 때까지 기다린 뒤 수집
      const result = doFullWeek
        ? await runCollect({
          lookbackDays: 8,
          includeRider: true,
          waitForSharedSlot: true,
          sharedSlotGeneration: generation
        })
        : await runCollect({
          skipWeekly: true,
          includeRider: true,
          waitForSharedSlot: true,
          sharedSlotGeneration: generation
        });
      if (statusLoop.generation !== generation) break;
      if (result?.cancelled) break;
      if (!result?.ok) {
        statusLoop.lastError = result?.message || '쿠팡 수집 실패';
        // 외부 /collect 와 충돌 시 같은 회차 재시도
        if (/이미 수집|다른 쿠팡 세션/i.test(statusLoop.lastError)) {
          statusLoop.round = Math.max(0, statusLoop.round - 1);
          statusLoop.message = '다른 수집과 충돌 — 5초 후 재시도';
          statusLoop.updatedAt = nowKstIsoOffset();
          await keepAliveDuringWait(5000, generation);
          continue;
        }
        if (!MANUAL_LOGIN && (result?.status === 401 || /401|unauthorized|login|토큰/i.test(statusLoop.lastError))) {
          clearCoupangToken('수집 401 — 즉시 자동 로그인');
          statusLoop.round = Math.max(0, statusLoop.round - 1);
          statusLoop.phase = 'waiting';
          statusLoop.message = '세션 만료(401) — 네이버 OTP 자동 로그인 중…';
          statusLoop.updatedAt = nowKstIsoOffset();
          const recovered = await tryRecoverCoupangAuthWithNaverOtp();
          if (statusLoop.generation !== generation) break;
          if (!recovered.ok || !isTokenUsable(latestToken)) {
            statusLoop.lastError = recovered.message || '쿠팡 자동 로그인 실패';
            await keepAliveDuringWait(STATUS_LOOP_WAIT_MS, generation);
          } else {
            statusLoop.lastError = '';
            statusLoop.message = '자동 로그인 복구 완료 — 수집 재개';
            statusLoop.updatedAt = nowKstIsoOffset();
          }
          continue;
        }
      } else {
        statusLoop.lastSummary = result.summary || null;
        statusLoop.lastError = '';
        if (doFullWeek) {
          try {
            const { syncCoupangRejections } = require('../server/coupang-erp-sync');
            const weekStart = thisWeekStartDateKst();
            const sync = await syncCoupangRejections({ weekStart });
            statusLoop.message = sync.ok
              ? `1회차 완료 · 거절율 동기화 ${Number(sync.rejectionsUpserted || 0)}건`
              : `1회차 완료 · 거절율 동기화 실패(${sync.message || '오류'})`;
          } catch (syncErr) {
            statusLoop.lastError = syncErr?.message || String(syncErr);
          }
        }
      }
    } catch (e) {
      statusLoop.lastError = e && e.message ? e.message : String(e);
      if (!MANUAL_LOGIN && /401|unauthorized|login|토큰/i.test(statusLoop.lastError)) {
        clearCoupangToken('예외 401 — 즉시 자동 로그인');
        statusLoop.round = Math.max(0, statusLoop.round - 1);
        statusLoop.message = '세션 오류 — 네이버 OTP 자동 로그인 중…';
        statusLoop.updatedAt = nowKstIsoOffset();
        const recovered = await tryRecoverCoupangAuthWithNaverOtp();
        if (statusLoop.generation !== generation) break;
        if (!recovered.ok || !isTokenUsable(latestToken)) {
          statusLoop.lastError = recovered.message || statusLoop.lastError;
        } else {
          statusLoop.lastError = '';
        }
        continue;
      }
    }
    if (!statusLoop.active || statusLoop.stopping || statusLoop.generation !== generation) break;
    // 대기 중 로그인 페이지로 튕겼으면 즉시 복구
    const urlNow = getCurrentUrlSafe();
    const auth = require('../server/crawl-session-auth');
    if (!MANUAL_LOGIN && (auth.isCoupangLoginLikeUrl(urlNow) || !isTokenUsable(latestToken))) {
      clearCoupangToken('대기 중 로그아웃 감지');
      statusLoop.message = '로그아웃 감지 — 네이버 OTP 자동 로그인 중…';
      statusLoop.updatedAt = nowKstIsoOffset();
      const recovered = await tryRecoverCoupangAuthWithNaverOtp();
      if (statusLoop.generation !== generation) break;
      if (!recovered.ok || !isTokenUsable(latestToken)) {
        statusLoop.lastError = recovered.message || '쿠팡 자동 로그인 실패';
      } else {
        statusLoop.lastError = '';
        statusLoop.message = '자동 로그인 복구 완료';
      }
    }
    // 이번 회차 수집이 끝난 뒤에만 30초 쉼 (다른 세션과 겹치지 않게 한 뒤)
    statusLoop.phase = 'waiting';
    statusLoop.message = `수집 완료 · ${Math.ceil(STATUS_LOOP_WAIT_MS / 1000)}초 후 다음 회차 (${statusLoop.round}회차)`;
    statusLoop.updatedAt = nowKstIsoOffset();
    await keepAliveDuringWait(STATUS_LOOP_WAIT_MS, generation);
  }
  if (statusLoop.generation === generation) {
    statusLoop.active = false;
    statusLoop.stopping = false;
    statusLoop.phase = 'idle';
    statusLoop.message = statusLoop.round ? `중지됨 (${statusLoop.round}회차까지 수집)` : '중지됨';
    statusLoop.waitEndsAt = 0;
    statusLoop.updatedAt = nowKstIsoOffset();
  }
}

async function stopStatusAutoLoopAndWait(timeoutMs = 90000) {
  const wasActive = Boolean(statusLoop.active || statusLoopPromise);
  stopStatusAutoLoop();
  const started = Date.now();
  while (statusLoopPromise && Date.now() - started < timeoutMs) {
    await sleepMs(200);
  }
  return { ok: !statusLoopPromise, wasActive };
}

function startStatusAutoLoop(options = {}) {
  if (statusLoop.active && statusLoopPromise) {
    return { ok: true, alreadyRunning: true, statusLoop: getStatusLoopPayload() };
  }
  // 좀비 루프가 남아 있으면 세대만 올려 무효화 후 재시작
  statusLoop.generation += 1;
  const generation = statusLoop.generation;
  statusLoop.active = true;
  statusLoop.stopping = false;
  statusLoop.round = 0;
  statusLoop.skipFirstFullWeek = Boolean(options.skipFirstFullWeek);
  statusLoop.startedAt = nowKstIsoOffset();
  statusLoop.updatedAt = statusLoop.startedAt;
  statusLoop.lastError = '';
  statusLoop.waitEndsAt = 0;
  statusLoop.phase = 'collecting';
  statusLoop.message = latestToken
    ? (statusLoop.skipFirstFullWeek ? '자동순회 재개…' : '자동수집 시작…')
    : '토큰 없음 — 자동로그인 후 수집 시작…';
  statusLoopPromise = Promise.resolve()
    .then(() => runStatusAutoLoopInner(generation))
    .catch((error) => {
      statusLoop.lastError = error?.message || String(error);
      console.warn('[COUPANG] status-loop 오류:', statusLoop.lastError);
    })
    .finally(() => {
      if (statusLoop.generation === generation) {
        statusLoopPromise = null;
      }
    });
  return { ok: true, statusLoop: getStatusLoopPayload() };
}

function stopStatusAutoLoop() {
  if (!statusLoop.active && !statusLoopPromise) {
    return { ok: true, alreadyStopped: true, statusLoop: getStatusLoopPayload() };
  }
  statusLoop.stopping = true;
  statusLoop.active = false;
  statusLoop.generation += 1; // 진행 중 keep-alive/수집 루프 무효화
  statusLoop.message = '중지 요청됨…';
  statusLoop.waitEndsAt = 0;
  statusLoop.updatedAt = nowKstIsoOffset();
  return { ok: true, statusLoop: getStatusLoopPayload() };
}

function coupangCorsHeaders(extra = {}) {
  return {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'Content-Type, Access-Control-Request-Private-Network',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    // https://brem.kr → http://127.0.0.1 태그/헬스 조회용 (Chrome Private Network Access)
    'access-control-allow-private-network': 'true',
    ...extra
  };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, coupangCorsHeaders());
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const t = Buffer.concat(chunks).toString('utf8').trim();
  if (!t) return {};
  try { return JSON.parse(t); } catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, coupangCorsHeaders());
    res.end();
    return;
  }

  if (u.pathname === '/health' && req.method === 'GET') {
    if (!isTokenUsable(latestToken)) {
      // 1) 만료로 지우기 전에 refresh 먼저. 페이지는 다시 열지 않음.
      if (isContextAlive(context)) {
        if (!latestRefreshToken) loadLocalRefreshToken();
        await holdCoupangPortalSession({ force: true, noReload: true }).catch(() => null);
      }
      if (!isTokenUsable(latestToken)) {
        if (latestToken) clearCoupangToken('헬스체크: 만료 토큰');
        authRequired = true;
        if (!authRequiredReason) authRequiredReason = '쿠팡 로그인 토큰 없음/만료 — 로그인 또는 네이버 OTP 복구 필요';
      } else if (!authRecovering) {
        authRequired = false;
        authRequiredReason = '';
      }
    } else if (!authRecovering) {
      authRequired = false;
      authRequiredReason = '';
      // 2) 아직 유효해도 발급 3분이 지나면 백그라운드로 미리 갱신
      if (latestTokenAt && Date.now() - latestTokenAt >= 3 * 60 * 1000) {
        holdCoupangPortalSession().catch(() => null);
      }
    }
    const tokenAgeSec = latestToken ? Math.round((Date.now() - latestTokenAt) / 1000) : null;
    let tokenExp = null;
    try { if (latestToken) tokenExp = new Date(JSON.parse(Buffer.from(latestToken.split('.')[1], 'base64').toString('utf8')).exp * 1000).toISOString(); } catch { /* ignore */ }
    const authPayload = getAuthPayload();
    const naverLoggedIn = await require('../server/coupang-naver-otp').isBoundNaverLoggedIn().catch(() => false);
    return sendJson(res, 200, {
      ok: true, port: PORT, browserOpen: Boolean(context),
      accountId: ACCOUNT.id,
      accountLabel: ACCOUNT.label,
      hasToken: Boolean(latestToken), tokenAgeSec, tokenExpiresAt: tokenExp,
      vendorCount: seenVendorIds.size, collecting,
      statusLoop: getStatusLoopPayload(),
      tokenSource: lastTokenSource || null,
      seenAnyAuthHeader,
      lastAuthSeenAgoSec: lastAuthSeenAt ? Math.round((Date.now() - lastAuthSeenAt) / 1000) : null,
      apiSamples: [...seenApiPaths].slice(0, 60),
      weekStart: thisWeekStartDateKst(),
      portalHoldNote: portalHoldNote || '',
      hasRefreshToken: Boolean(latestRefreshToken),
      naverLoggedIn,
      loginBudget: require('../server/coupang-login-budget').inspect(),
      ...authPayload
    });
  }

  if (u.pathname === '/portal-hold' && req.method === 'POST') {
    const result = await holdCoupangPortalSession().catch((error) => ({
      ok: false,
      message: error?.message || String(error)
    }));
    return sendJson(res, result?.ok ? 200 : 400, {
      ...result,
      portalHoldNote,
      ...getAuthPayload(),
      hasToken: Boolean(latestToken) && isTokenUsable(latestToken)
    });
  }

  if (u.pathname === '/auth/recover' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    if (body.force === true || body.force === '1' || body.force === 1) {
      skipNaverRecoverUntil = 0;
    }
    const result = await tryRecoverCoupangAuthWithNaverOtp({
      knownOtp: String(body.otp || body.code || '').trim()
    });
    return sendJson(res, result.ok ? 200 : 400, { ...result, ...getAuthPayload(), hasToken: Boolean(latestToken) });
  }

  // 메일에서 읽은 OTP를 쿠팡 2FA 화면에 직접 입력
  if (u.pathname === '/auth/otp' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const otp = String(body.otp || body.code || '').trim();
      if (!/^\d{4,8}$/.test(otp)) {
        return sendJson(res, 400, { ok: false, message: 'otp 숫자(4~8자리)가 필요합니다.' });
      }
      await ensureBrowser();
      const page = await getActivePage();
      if (!page) return sendJson(res, 400, { ok: false, message: '쿠팡 브라우저 페이지가 없습니다.' });
      const autoLogin = require('../server/coupang-auto-login');
      for (let i = 0; i < 3; i += 1) {
        await autoLogin.clickEmailAuthTab(page).catch(() => false);
        await page.waitForTimeout(700).catch(() => {});
      }
      const naverOtp = require('../server/coupang-naver-otp');
      const filled = await naverOtp.fillCoupangOtpOnPage(page, otp);
      await scanPageForToken(page).catch(() => {});
      await persistToken(filled.ok ? 'otp_manual' : 'otp_manual_failed').catch(() => {});
      if (filled.ok && latestToken) {
        authRequired = false;
        authRequiredReason = '';
      } else if (filled.ok) {
        authRequiredReason = 'OTP 입력 완료 — 토큰 캡처 대기 중';
      } else {
        authRequiredReason = filled.message || 'OTP 입력 실패';
      }
      return sendJson(res, filled.ok ? 200 : 400, {
        ...filled,
        hasToken: Boolean(latestToken),
        ...getAuthPayload()
      });
    } catch (error) {
      return sendJson(res, 500, { ok: false, message: error?.message || String(error) });
    }
  }

  if (u.pathname === '/auth/snapshot' && req.method === 'GET') {
    try {
      await ensureBrowser();
      const page = await getActivePage();
      if (!page) return sendJson(res, 400, { ok: false, message: '쿠팡 페이지 없음' });
      const autoLogin = require('../server/coupang-auto-login');
      const mode = await autoLogin.readTwoFactorMode(page).catch(() => ({}));
      const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 800)).catch(() => '');
      return sendJson(res, 200, {
        ok: true,
        url: page.url(),
        twoFactor: await autoLogin.isTwoFactorPage(page).catch(() => false),
        mode,
        text
      });
    } catch (error) {
      return sendJson(res, 500, { ok: false, message: error?.message || String(error) });
    }
  }

  if (u.pathname === '/naver/open' && req.method === 'POST') {
    try {
      await ensureBrowser();
      const naverOtp = require('../server/coupang-naver-otp');
      const page = await naverOtp.ensureNaverTabInContext(context);
      if (page) await page.bringToFront().catch(() => {});
      const loggedIn = page ? await naverOtp.pageLooksLoggedIntoNaver(page) : false;
      return sendJson(res, 200, {
        ok: true,
        sameWindow: true,
        loggedIn,
        url: page ? pageUrlOf(page) : '',
        message: loggedIn
          ? '같은 창 네이버 탭이 로그인 상태입니다.'
          : '같은 창 네이버 탭에서 직접 로그인하세요. 자동 입력은 하지 않습니다.'
      });
    } catch (error) {
      return sendJson(res, 500, { ok: false, message: error?.message || String(error) });
    }
  }

  if (u.pathname === '/erp-sync' && req.method === 'POST') {
    try {
      const { syncCoupangRejections } = require('../server/coupang-erp-sync');
      const result = await syncCoupangRejections({ weekStart: thisWeekStartDateKst() });
      return sendJson(res, result.ok ? 200 : 500, result);
    } catch (error) {
      return sendJson(res, 500, { ok: false, message: error?.message || String(error) });
    }
  }

  if (u.pathname === '/status-loop/start' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    // 이전 루프가 중지 중이면 짧게만 기다린다. 60초 대기는 119가 정지 상태로 남는 원인이 됨.
    if (statusLoop.active || statusLoopPromise) {
      stopStatusAutoLoop();
      const startedWait = Date.now();
      while (statusLoopPromise && Date.now() - startedWait < 8000) {
        await sleepMs(200);
      }
      statusLoopPromise = null;
    }
    const r = startStatusAutoLoop({
      skipFirstFullWeek: Boolean(body?.skipFirstFullWeek)
    });
    return sendJson(res, r.ok ? 202 : (r.status || 400), r);
  }

  if (u.pathname === '/status-loop/stop' && req.method === 'POST') {
    const r = await stopStatusAutoLoopAndWait(60000);
    return sendJson(res, 200, { ...r, statusLoop: getStatusLoopPayload() });
  }

  if (u.pathname === '/status-loop/status' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, statusLoop: getStatusLoopPayload() });
  }

  if (u.pathname === '/browser/open' && req.method === 'POST') {
    await ensureBrowser();
    return sendJson(res, 200, { ok: true, browserOpen: Boolean(context), hasToken: Boolean(latestToken) });
  }

  if (u.pathname === '/session/save' && req.method === 'POST') {
    if (!latestToken) return sendJson(res, 400, { ok: false, message: '토큰이 아직 캡처되지 않았습니다. 로그인 후 대시보드를 여세요.' });
    await persistToken('manual_save');
    return sendJson(res, 200, { ok: true });
  }

  if (u.pathname === '/collect' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await runCollect(body);
    return sendJson(res, result.ok ? 200 : (result.status || 400), result);
  }

  return sendJson(res, 404, { ok: false, error: 'not found' });
});

process.on('exit', () => {
  try { releaseCollectMutex(); } catch { /* ignore */ }
});
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => {
  process.on(sig, () => {
    try { releaseCollectMutex(); } catch { /* ignore */ }
    process.exit(0);
  });
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log('========================================');
  console.log(`[COUPANG] 세션 서버 http://127.0.0.1:${PORT} · 계정 ${ACCOUNT.id} (${ACCOUNT.label})`);
  console.log(MANUAL_LOGIN
    ? '[COUPANG] 완전 수동 로그인 모드 — 자동 아이디/비밀번호 입력·OTP 복구를 시도하지 않음'
    : '[COUPANG] 같은 창 쿠팡+네이버 탭 · 로그인 화면이면 아이디/비번 자동입력 · 열린 메일 OTP, 연속 실패 2회면 정지');
  console.log('[COUPANG] 수집: POST /collect  · 상태: GET /health  · 복구: POST /auth/recover');
  console.log('[COUPANG] 2계정 동시수집 금지(공유락) · 회차 끝난 뒤 30초 대기');
  console.log('========================================');
  try { await ensureBrowser(); } catch (e) { console.error('[COUPANG] 브라우저 실행 실패:', e.message); }

  try {
    const stored = await sessionStore.getStoredCoupangSession();
    if (stored?.token && isTokenUsable(stored.token)) {
      adoptToken(stored.token, 'stored');
      if (stored.cookie) latestCookie = stored.cookie;
      console.log('[COUPANG] 저장된 토큰 복원');
    }
  } catch (e) {
    console.warn('[COUPANG] 저장 토큰 복원 실패:', e.message || e);
  }
  loadLocalRefreshToken();
  if (latestRefreshToken) console.log('[COUPANG] 로컬 refresh_token 복원');

  if (String(process.env.COUPANG_SKIP_STARTUP_LOGIN || '').trim() === '1') {
    skipNaverRecoverUntil = Date.now() + 12 * 60 * 60 * 1000;
    console.log('[COUPANG] COUPANG_SKIP_STARTUP_LOGIN=1 — 기동 OTP 생략, 12시간 네이버 재시도 안 함');
  }

  // 기동 직후: 네이버가 이미 로그인돼 있을 때만 쿠팡 1회
  try {
    const creds = require('../server/coupang-auto-login').getCoupangCredentials();
    if (!isTokenUsable(latestToken)) {
      if (MANUAL_LOGIN) {
        authRequired = true;
        authRequiredReason = 'COUPANG_MANUAL_LOGIN=1 — 자동 로그인을 하지 않습니다.';
        console.log(`[COUPANG] ${ACCOUNT.label} 수동 로그인 대기`);
      } else if (creds.configured && !shouldSkipNaverRecover()) {
        console.log(`[COUPANG] ${ACCOUNT.label} — 쿠팡 자동로그인 시도 (아이디/비번 + 열린 메일 OTP)`);
        const recovered = await tryRecoverCoupangAuthWithNaverOtp();
        console.log(recovered.ok
          ? `[COUPANG] 자동로그인 성공 (${recovered.via || 'auto'})`
          : `[COUPANG] 자동로그인 보류: ${recovered.message}`);
      } else {
        console.warn('[COUPANG] 쿠팡 아이디/비밀번호 없음 — .coupang-local-accounts.json 또는 .env 확인');
      }
    } else {
      console.log('[COUPANG] 기존 토큰 유지 중');
      const soft = await trySoftRefreshCoupangToken();
      console.log(soft.ok
        ? `[COUPANG] 기동 세션 갱신 성공 (${soft.via})`
        : '[COUPANG] 기동 세션 갱신 생략 — 기존 토큰 유지');
    }
  } catch (e) {
    console.error('[COUPANG] 자동로그인 오류:', e.message || e);
  }

  // 토큰 스캔 + 로그인 튕김 감지 → auth recover watchdog
  setInterval(async () => {
    try {
      if (!isContextAlive(context)) return;
      if (latestToken && Date.now() - latestTokenAt < 60 * 1000) return;
      const page = findCoupangPage();
      if (page) {
        await scanPageForToken(page).catch(() => {});
        const url = pageUrlOf(page).toLowerCase();
        if (!isTokenUsable(latestToken) && /xauth\.coupang|openid-connect\/auth|login/.test(url)) {
          authRequired = true;
          if (!authRequiredReason) {
            authRequiredReason = '쿠팡 로그인 화면 — 아이디/비번 자동 입력 대기';
          }
        } else if (/partner\.coupangeats\.com/.test(url)) {
          await holdCoupangPortalSession().catch(() => null);
        }
      }
    } catch { /* ignore */ }
  }, 20 * 1000);
  startAuthRecoverWatchdog();
  startPortalHoldLoop();

  if (AUTO_RESUME_STATUS_LOOP) {
    console.log('[COUPANG] COUPANG_AUTO_RESUME_STATUS_LOOP=1 — 자동순회를 이어서 시작합니다.');
    setTimeout(() => {
      const started = startStatusAutoLoop();
      if (!started.ok) console.warn('[COUPANG] 자동 재개 보류:', started.message);
    }, 12000);
  }
});
