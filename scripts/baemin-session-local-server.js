/**
 * 로컬 배민Biz 세션 갱신 서버 (PC에서 실행)
 * Run: npm run baemin:session-server
 */
require('dotenv').config();

const path = require('path');

const PLAYWRIGHT_BROWSERS_DIR = path.join(__dirname, '..', '.playwright-browsers');
if (!String(process.env.PLAYWRIGHT_BROWSERS_PATH || '').trim()) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = PLAYWRIGHT_BROWSERS_DIR;
}

const http = require('http');
const { URL } = require('url');
const {
  getListenLocalSessionConfig,
  DEFAULT_BAEMIN_SESSION_LOCAL_PORT
} = require('../server/baemin-session-local-config');

const listenConfig = getListenLocalSessionConfig();
const PORT = listenConfig.port;
const PROFILE_DIR = path.join(__dirname, '..', '.baemin-playwright-profile');
const {
  BAEMIN_ORIGIN,
  isDeliveryCenterHost,
  isBetaDeliveryCenterHost
} = require('../server/baemin-delivery-hosts');
const LOGIN_WAIT_MS = 15 * 60 * 1000;
const POLL_MS = 2000;
const SERVER_VERSION = '20260811d';
const SCRIPT_PATH = __filename;
const SCHEDULER_TICK_MS = 30 * 1000;
const HEARTBEAT_MS = 30 * 1000;

const CORS_ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/brem\.kr$/i,
  /^https:\/\/www\.brem\.kr$/i,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i,
  /^http:\/\/localhost(?::\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/i
];

const baeminAutoCollect = require('../server/baemin-auto-collect');
const {
  createApiDiscoveryState,
  attachApiDiscovery,
  attachPageDiscovery,
  buildRegistryFromDiscovery
} = require('../server/baemin-playwright-discovery');
const { BAEMIN_ORIGIN: BAEMIN_COLLECT_ORIGIN } = require('../server/baemin-collect-sources');
const {
  formatApiPayloadError,
  formatError,
  migrationHintForError,
  safeJsonStringify,
  stringifyErrorValue
} = require('../server/baemin-error-format');
const { probeBaeminNetwork } = require('../server/baemin-network-probe');
const { buildBizMenuDateRanges, computeBizHistoryCollectRange } = require('../server/baemin-settlement-week');

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8').trim();
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

const PROBE_PAGE_PATHS = [
  '/delivery-status'
];

let activeJob = null;
let activeContext = null;
let activeRunToken = 0;
let refreshLoopRunning = false;
let refreshLaunchPromise = null;
/** ERP 재요청 시 최신 setup 토큰으로 저장 (브라우저는 닫지 않음) */
let activeSetup = { setupId: '', setupSecret: '', apiBase: 'https://brem.kr' };

let sessionPaused = false;
let authRecovering = false;
let authRequiredReason = '';
let lastRunSlotKey = null;
let collectRunning = false;
let shutdownRequested = false;
let morningRunRunning = false;
/** 부팅 후 status-loop 자동 재개 여부 (항상 켜진 운영용) */
const AUTO_RESUME_STATUS_LOOP = String(process.env.BAEMIN_AUTO_RESUME_STATUS_LOOP || '').trim() === '1';
/** 기동 시 Playwright 배민 창을 바로 연다 (기본 ON, 끄려면 BAEMIN_AUTO_OPEN_BROWSER=0) */
const AUTO_OPEN_BROWSER = String(process.env.BAEMIN_AUTO_OPEN_BROWSER || '1').trim() !== '0';
let lastCollectResult = {
  at: null,
  ok: null,
  message: '',
  savedTotal: 0,
  collectDate: null
};
let autoCollectRuntime = {
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
  lastSavedCount: 0,
  nextScheduledAt: null,
  schedule: baeminAutoCollect.DEFAULT_SCHEDULE
};

/** 배민현황 자동수집 루프 (브라우저 닫아도 세션 서버에서 계속) */
const STATUS_LOOP_WAIT_MS = 30 * 1000;
let statusLoop = {
  active: false,
  stopping: false,
  round: 0,
  phase: 'idle', // idle | bootstrap | collecting | applying | rider_sync | waiting
  message: '',
  waitEndsAt: 0,
  lastError: '',
  startedAt: null,
  updatedAt: null
};
let statusLoopPromise = null;
let riderLiveSyncRunning = false;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function isAllowedCorsOrigin(origin) {
  const value = String(origin || '').trim();
  if (!value) return false;
  return CORS_ALLOWED_ORIGIN_PATTERNS.some(pattern => pattern.test(value));
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function sendJsonWithCors(req, res, status, body) {
  applyCorsHeaders(req, res);
  sendJson(res, status, body);
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatPlaywrightLaunchError(error) {
  const text = formatError(error, 'Playwright browser launch failed');
  if (/executable doesn't exist|playwright install/i.test(text)) {
    return 'Playwright Chromium이 설치되지 않았습니다. 터미널에서 아래 명령을 1회 실행하세요:\n'
      + 'node node_modules/playwright/cli.js install chromium';
  }
  return text;
}

async function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return null;
  }
}

function cookiesToHeader(cookies) {
  return cookies
    .filter(isBaeminRelatedCookie)
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function isBaeminRelatedCookie(cookie) {
  const domain = String(cookie?.domain || '').toLowerCase();
  const name = String(cookie?.name || '').toLowerCase();
  return domain.includes('baemin.com')
    || domain.includes('woowahan.com')
    || domain.includes('deliverycenter')
    || name.includes('session')
    || name.includes('bm_');
}

function dedupeCookies(cookies) {
  const seen = new Set();
  const unique = [];
  (cookies || []).forEach(cookie => {
    const key = `${cookie.name}@${cookie.domain || ''}@${cookie.path || '/'}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(cookie);
  });
  return unique;
}

function summarizeCookies(cookies) {
  return (cookies || []).map(cookie => ({
    name: cookie.name,
    domain: cookie.domain || '',
    path: cookie.path || '/',
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly)
  }));
}

function isJobRunning() {
  // refreshLoopRunning 없이 waiting_login만 남은 좀비 job은 수집/갱신을 막지 않음
  return Boolean(
    refreshLoopRunning
    && activeJob
    && ['opening_browser', 'waiting_login', 'saving'].includes(activeJob.status)
  );
}

function isContextAlive(context) {
  if (!context) return false;
  try {
    const pages = context.pages();
    if (!pages.length) {
      const browser = context.browser();
      if (browser && typeof browser.isConnected === 'function' && !browser.isConnected()) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function isPlaywrightClosedError(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return text.includes('has been closed') || text.includes('target page, context or browser');
}

function clearActiveContextIfDead() {
  if (!isContextAlive(activeContext)) {
    activeContext = null;
    return true;
  }
  return false;
}

function resolveCollectPlaywrightPage() {
  clearActiveContextIfDead();
  if (!activeContext) return null;
  const tabs = scanBrowserTabs(activeContext);
  if (!tabs.page || tabs.page.isClosed()) {
    clearActiveContextIfDead();
    return null;
  }
  return tabs.page;
}

function shouldReuseRefreshLoop() {
  // 실제 갱신 루프가 돌 때만 재사용. 좀비 waiting_login 때문에 갱신이 스킵되면 안 됨
  return refreshLoopRunning && isContextAlive(activeContext);
}

function resetRefreshLoopState(reason) {
  console.log(`[BREM] [start] 갱신 루프 초기화 | ${reason || 'unknown'}`);
  refreshLoopRunning = false;
  activeRunToken += 1;
  activeJob = { status: 'idle', message: '대기 중', updatedAt: Date.now() };
}

function safePageUrlSync(page) {
  try {
    if (!page || page.isClosed()) return '(page closed)';
    return page.url();
  } catch {
    return '(url unavailable)';
  }
}

function isLoginLikeUrl(url) {
  const value = String(url || '').toLowerCase();
  return /login|signin|sign-in|auth|oauth|member\.baemin|bizmember|passport/.test(value);
}

/** 문자열 기반 — URL 파싱 실패·SPA 대비 (구/신 배민Biz 경로 모두) */
function urlIncludesDeliveryHistory(url) {
  const lower = String(url || '').toLowerCase();
  return lower.includes('delivery/delivery-history')
    || lower.includes('delivery-history')
    || lower.includes('delivery/history');
}

function urlIncludesDeliveryStatus(url) {
  return String(url || '').toLowerCase().includes('delivery-status');
}

function isOnDeliveryHistoryPage(url) {
  if (urlIncludesDeliveryHistory(url)) return true;
  try {
    const parsed = new URL(url);
    if (!isDeliveryCenterHost(parsed.hostname)) return false;
    const path = parsed.pathname.toLowerCase();
    return path.includes('delivery-history') || path.includes('/delivery/history');
  } catch {
    return false;
  }
}

function isLoggedInDeliveryPage(url) {
  if (urlIncludesDeliveryHistory(url) || urlIncludesDeliveryStatus(url)) return true;

  const lower = String(url || '').toLowerCase();
  if (!isDeliveryCenterHost(lower)) return false;
  if (isLoginLikeUrl(url)) return false;
  if (lower.includes('/delivery/')) return true;

  try {
    const parsed = new URL(url);
    if (!isDeliveryCenterHost(parsed.hostname)) return false;
    if (isLoginLikeUrl(url)) return false;
    return parsed.pathname.startsWith('/delivery')
      || parsed.pathname.includes('delivery-status');
  } catch {
    return false;
  }
}

function scorePageUrl(url) {
  if (!url || url.startsWith('(')) return -1;
  if (isLoginLikeUrl(url)) return 0;
  if (isOnDeliveryHistoryPage(url)) return 100;
  if (urlIncludesDeliveryStatus(url)) return 90;
  if (isLoggedInDeliveryPage(url)) return 80;
  if (isDeliveryCenterHost(url)) return 10;
  if (isBetaDeliveryCenterHost(url)) return 5;
  return 1;
}

function scanBrowserTabs(context) {
  if (!isContextAlive(context)) {
    return { page: null, url: '', allUrls: [], bestScore: -1, anyHistory: false, anyLoggedIn: false };
  }

  const pages = context.pages().filter(page => !page.isClosed());
  const allUrls = pages.map(page => safePageUrlSync(page));

  let best = { page: pages[0] || null, url: allUrls[0] || '', score: -1 };

  pages.forEach((page, index) => {
    const url = allUrls[index];
    const score = scorePageUrl(url);
    if (score > best.score) {
      best = { page, url, score };
    }
  });

  const anyHistory = allUrls.some(url => isOnDeliveryHistoryPage(url));
  const anyLoggedIn = allUrls.some(url => isLoggedInDeliveryPage(url));

  return {
    page: best.page,
    url: best.url,
    allUrls,
    bestScore: best.score,
    anyHistory,
    anyLoggedIn
  };
}

function isValidBaeminApiJson(json) {
  if (!json || typeof json !== 'object') return false;
  if (Array.isArray(json.data)) return true;
  if (Array.isArray(json.content)) return true;
  if (Number.isFinite(json.totalPage)) return true;
  if (Number.isFinite(json.totalElements)) return true;
  if (Number.isFinite(json.total)) return true;
  return false;
}

async function fetchBaeminApi(apiPath, cookieHeader) {
  const response = await fetch(`${BAEMIN_ORIGIN}${apiPath}`, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      Cookie: cookieHeader,
      'User-Agent': 'BREM-Baemin-Session/1.0',
      Referer: `${BAEMIN_ORIGIN}/`
    },
    redirect: 'manual'
  });

  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: `HTTP ${response.status}` };
  }

  const text = await response.text();
  if (text.trim().startsWith('<')) {
    return { ok: false, reason: `HTML 응답 HTTP ${response.status}` };
  }

  try {
    const json = JSON.parse(text);
    return isValidBaeminApiJson(json)
      ? { ok: true, reason: `JSON 정상 HTTP ${response.status}` }
      : { ok: false, reason: `JSON 형식 불일치 HTTP ${response.status}` };
  } catch {
    return { ok: false, reason: `JSON 파싱 실패 HTTP ${response.status}` };
  }
}

async function verifySessionCookie(cookieHeader, pageUrl, anyHistory) {
  if (anyHistory || isOnDeliveryHistoryPage(pageUrl)) {
    const historyApi = await fetchBaeminApi('/delivery/history?page=0&size=1', cookieHeader);
    console.log(`[BREM] [검증] delivery/history API | ${historyApi.ok ? '성공' : '실패'} | ${historyApi.reason}`);
    if (historyApi.ok) {
      return { ok: true, reason: historyApi.reason, via: 'delivery/history API' };
    }
  }

  const statusApi = await fetchBaeminApi('/delivery-status?page=0&size=1', cookieHeader);
  console.log(`[BREM] [검증] delivery-status API | ${statusApi.ok ? '성공' : '실패'} | ${statusApi.reason}`);
  if (statusApi.ok) {
    return { ok: true, reason: statusApi.reason, via: 'delivery-status API' };
  }

  if ((anyHistory || isOnDeliveryHistoryPage(pageUrl)) && cookieHeader) {
    return {
      ok: true,
      reason: '/delivery/history 페이지 진입 확인',
      via: 'delivery/history page'
    };
  }

  if (isLoggedInDeliveryPage(pageUrl) && cookieHeader) {
    return {
      ok: true,
      reason: '배달 페이지 진입 확인',
      via: 'delivery page'
    };
  }

  return { ok: false, reason: 'API·페이지 검증 모두 실패' };
}

async function extractBaeminCookies(context) {
  const cookieUrls = new Set([
    `${BAEMIN_ORIGIN}/`,
    `${BAEMIN_ORIGIN}/delivery/history`,
    `${BAEMIN_ORIGIN}/delivery-status`,
    'https://bizmember.baemin.com/',
    'https://member.baemin.com/'
  ]);

  if (isContextAlive(context)) {
    context.pages().filter(page => !page.isClosed()).forEach(page => {
      try {
        const pageUrl = page.url();
        if (pageUrl && pageUrl.startsWith('http')) cookieUrls.add(pageUrl);
      } catch {
        // ignore
      }
    });
  }

  let cookies = [];

  for (const url of cookieUrls) {
    try {
      const scoped = await context.cookies(url);
      cookies = cookies.concat(scoped);
      console.log(`[BREM] [쿠키 추출] context.cookies(${url}) → ${scoped.length}개`);
    } catch (error) {
      console.warn(`[BREM] [쿠키 추출] ${url} 실패 | ${formatError(error)}`);
    }
  }

  if (!cookies.length) {
    cookies = await context.cookies();
    console.log(`[BREM] [쿠키 추출] context.cookies() 전체 → ${cookies.length}개`);
  }

  cookies = dedupeCookies(cookies);
  const summary = summarizeCookies(cookies);
  const baeminCookies = cookies.filter(isBaeminRelatedCookie);
  console.log(`[BREM] [쿠키 추출] 전체 ${cookies.length}개 · 배민 관련 ${baeminCookies.length}개`);
  console.log(`[BREM] [쿠키 추출] 이름/도메인: ${JSON.stringify(summary.slice(0, 20))}${summary.length > 20 ? ' …' : ''}`);

  const header = cookiesToHeader(baeminCookies.length ? baeminCookies : cookies);
  console.log(`[BREM] [쿠키 추출] 헤더 길이 ${header.length} · 항목 ${header ? header.split(';').length : 0}개`);
  return header;
}

function isProtectedDeploymentResponse(status, responseText) {
  const text = String(responseText || '').toLowerCase();
  return status === 401
    || status === 403
    || text.includes('protected deployment')
    || text.includes('authentication required')
    || text.includes('vercel authentication');
}

function hasLocalSupabaseCredentials() {
  return Boolean(
    String(process.env.SUPABASE_URL || '').trim()
    && String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  );
}

async function saveSessionDirectToSupabase(setupId, setupSecret, cookieHeader) {
  if (!hasLocalSupabaseCredentials()) {
    return {
      ok: false,
      skipped: true,
      reason: 'SUPABASE_SERVICE_ROLE_KEY 없음'
    };
  }

  console.log('[BREM] [Supabase 저장] service role 직접 저장 시도');
  const baeminDeliverySession = require('../server/baemin-delivery-session');
  const result = await baeminDeliverySession.completeSessionSetup(
    setupId,
    setupSecret,
    cookieHeader,
    { source: 'playwright_local' }
  );

  if (result.ok) {
    console.log('[BREM] [Supabase 저장] 직접 저장 성공');
    return result;
  }

  console.error('[BREM] [Supabase 저장] 직접 저장 실패', {
    status: result.status,
    error: result.error,
    message: result.message
  });
  return result;
}

async function postSessionToApi(apiBase, setupId, setupSecret, cookieHeader) {
  const cookieLength = String(cookieHeader || '').length;
  console.log(`[BREM] [Supabase 저장] setupId=${setupId} · cookieLength=${cookieLength}`);

  if (!cookieHeader || cookieLength < 8) {
    throw new Error('배민 쿠키 헤더가 비어 있습니다. 로그인 후 배달현황(/delivery/history) 화면에서 다시 시도하세요.');
  }

  const direct = await saveSessionDirectToSupabase(setupId, setupSecret, cookieHeader);
  if (direct.ok) return direct;

  if (hasLocalSupabaseCredentials()) {
    const detail = stringifyErrorValue(direct.message || direct.error || direct.reason || '알 수 없는 오류');
    console.error('[BREM] [Supabase 저장] 직접 저장만 사용 (HTTP fallback 생략)');
    if (detail.includes('SETUP_NOT_FOUND') || detail.includes('세션 갱신 요청')) {
      throw new Error(`${detail} ERP에서 [배민 세션 갱신]을 다시 눌러 새 setupId를 받으세요.`);
    }
    if (detail.includes('SETUP_EXPIRED') || detail.includes('만료')) {
      throw new Error(`${detail} ERP에서 [배민 세션 갱신]을 다시 눌러주세요.`);
    }
    if (detail.includes('SETUP_NOT_PENDING') || detail.includes('이미 처리')) {
      throw new Error(`${detail} ERP에서 [배민 세션 갱신]을 다시 눌러주세요.`);
    }
    throw new Error(`Supabase 직접 저장 실패: ${detail}`);
  }

  const url = `${String(apiBase || 'https://brem.kr').replace(/\/$/, '')}/api/admin/baemin-delivery/session`;
  console.log(`[BREM] [Supabase 저장] HTTP POST ${url}`);

  const headers = { 'Content-Type': 'application/json' };
  const bypassSecret = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '').trim();
  if (bypassSecret) {
    headers['x-vercel-protection-bypass'] = bypassSecret;
    console.log('[BREM] [Supabase 저장] Vercel bypass 헤더 사용');
  }

  let response;
  let responseText = '';
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ setupId, setupSecret, cookie: cookieHeader })
    });
    responseText = await response.text();
  } catch (error) {
    console.error('[BREM] [Supabase 저장] 네트워크 오류');
    console.error('[BREM] [Supabase 저장] error.message:', formatError(error));
    console.error('[BREM] [Supabase 저장] error.stack:', error?.stack || '-');
    throw new Error(`Supabase 저장 API 네트워크 오류: ${formatError(error)}`);
  }

  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    console.error('[BREM] [Supabase 저장] JSON 파싱 실패');
    console.error('[BREM] [Supabase 저장] status:', response.status);
    console.error('[BREM] [Supabase 저장] response.text():', responseText.slice(0, 800));
    console.error('[BREM] [Supabase 저장] parse error:', formatError(error));
    if (isProtectedDeploymentResponse(response.status, responseText)) {
      throw new Error(buildProtectedDeploymentHelp(direct));
    }
    throw new Error(`Supabase 저장 API 응답 파싱 실패 (HTTP ${response.status})`);
  }

  console.log('[BREM] [Supabase 저장] status:', response.status);
  console.log('[BREM] [Supabase 저장] response.text():', responseText.slice(0, 800));
  console.log('[BREM] [Supabase 저장] payload:', JSON.stringify(payload).slice(0, 1000));

  if (!response.ok) {
    if (isProtectedDeploymentResponse(response.status, responseText)) {
      throw new Error(buildProtectedDeploymentHelp(direct));
    }
    const message = formatApiPayloadError(payload, response.status, responseText);
    const hint = migrationHintForError(message);
    console.error('[BREM] [Supabase 저장] 실패 |', message);
    if (message.includes('SETUP_NOT_FOUND') || message.includes('세션 갱신 요청을 찾을 수 없습니다')) {
      console.error('[BREM] [Supabase 저장] ERP에서 [배민 세션 갱신]을 다시 눌러 새 setupId/setupSecret을 받으세요.');
    }
    throw new Error(`${message}${hint}`);
  }

  console.log(`[BREM] [Supabase 저장] HTTP 저장 성공 | message=${payload.message || 'ok'}`);
  return payload;
}

function buildProtectedDeploymentHelp(directResult) {
  if (!hasLocalSupabaseCredentials()) {
    return 'Vercel 배포 보호(Protected deployment)로 brem.kr API 호출이 차단되었습니다. '
      + 'PC 프로젝트 .env 에 SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 를 넣고 세션 서버를 재시작하세요. '
      + '(Supabase Dashboard → Project Settings → API → service_role key)';
  }
  const detail = stringifyErrorValue(directResult?.message || directResult?.error || '');
  if (detail) {
    return `Supabase 직접 저장 실패: ${detail}. ERP에서 [배민 세션 갱신]을 다시 누른 뒤 재시도하세요.`;
  }
  return 'Supabase 직접 저장과 brem.kr API 호출 모두 실패했습니다. ERP에서 [배민 세션 갱신]을 다시 시도하세요.';
}

async function showBrowserBanner(context, message, isError) {
  const text = formatError(message, '알 수 없는 오류');
  const { page } = scanBrowserTabs(context);
  if (!page) return;
  try {
    await page.evaluate(({ bannerText, error }) => {
      const id = 'brem-session-banner';
      let banner = document.getElementById(id);
      if (!banner) {
        banner = document.createElement('div');
        banner.id = id;
        document.body.appendChild(banner);
      }
      banner.style.cssText = [
        'position:fixed', 'top:16px', 'left:16px', 'right:16px', 'z-index:2147483647',
        `background:${error ? '#7f1d1d' : '#14532d'}`,
        'color:#fff', 'padding:14px 16px', 'border-radius:8px',
        'font:14px/1.5 sans-serif', 'box-shadow:0 8px 24px rgba(0,0,0,.25)'
      ].join(';');
      banner.textContent = `[BREM] ${bannerText}`;
    }, { bannerText: text, error: isError });
  } catch {
    // ignore
  }
}

function failJob(setupId, message, url, reason) {
  const reasonText = formatError(reason, String(reason || message || 'unknown'));
  activeJob = {
    status: 'failed',
    message: reasonText ? `${message}: ${reasonText}` : message,
    setupId,
    currentUrl: url || '',
    reason: reasonText || message,
    updatedAt: Date.now()
  };
  console.error(`[BREM] [실패] ${message} | URL: ${url || '-'} | 원인: ${reasonText || '-'}`);
}

async function closeContextSafely(context) {
  if (!context) return;
  try {
    await context.close();
  } catch {
    // ignore
  }
  if (activeContext === context) {
    activeContext = null;
  }
}

function getBrowserHealth() {
  // 좀비 waiting_login이 UI/상태에 남지 않게 정리
  if (
    activeJob
    && ['opening_browser', 'waiting_login', 'waiting_phone_auth', 'saving'].includes(activeJob.status)
    && !refreshLoopRunning
  ) {
    activeJob = { status: 'idle', message: '대기 중', updatedAt: Date.now() };
  }
  const alive = isContextAlive(activeContext);
  const tabs = alive ? scanBrowserTabs(activeContext) : null;
  return {
    browserOpen: alive,
    browserAlive: alive,
    tabCount: tabs?.allUrls?.length || 0,
    currentUrl: tabs?.url || '',
    sessionLoggedIn: Boolean(tabs?.anyLoggedIn || tabs?.anyHistory),
    refreshLoopRunning,
    jobRunning: isJobRunning(),
    jobStatus: activeJob?.status || 'idle'
  };
}

function getAuthStatePayload(browser = null) {
  const auth = require('../server/crawl-session-auth');
  const b = browser || getBrowserHealth();
  const authState = auth.resolveBaeminAuthState({
    sessionPaused,
    sessionLoggedIn: b.sessionLoggedIn,
    currentUrl: b.currentUrl,
    recovering: authRecovering,
    jobStatus: b.jobStatus,
    configured: true,
    lastError: authRequiredReason || ''
  });
  return {
    authState,
    authStateLabel: auth.authStateLabel(authState),
    authRequiredReason: authRequiredReason || '',
    recovering: authRecovering,
    phoneAuthLikely: auth.isBaeminPhoneAuthLikeUrl(b.currentUrl)
  };
}

async function detectAndMarkAuthRequired() {
  const auth = require('../server/crawl-session-auth');
  const browser = getBrowserHealth();
  // 배달현황 등 업무 화면 + 로그인됨 → pause 강제 해제
  // (URL에 phoneNumber= 쿼리가 있어도 휴대폰 인증으로 오판하지 않음)
  if (
    browser.sessionLoggedIn
    && auth.isBaeminAppWorkingUrl(browser.currentUrl)
  ) {
    if (sessionPaused || authRequiredReason) {
      console.log('[BREM] 배민 업무 화면 확인 — 인증대기 해제:', browser.currentUrl.slice(0, 80));
    }
    sessionPaused = false;
    authRequiredReason = '';
    authRecovering = false;
    return false;
  }
  if (auth.isBaeminPhoneAuthLikeUrl(browser.currentUrl) || auth.isBaeminLoginLikeUrl(browser.currentUrl)) {
    sessionPaused = true;
    authRequiredReason = auth.isBaeminPhoneAuthLikeUrl(browser.currentUrl)
      ? '휴대폰 인증 화면 — 인증번호 입력 후 자동 재개됩니다'
      : '로그인 화면 — 배민 로그인 후 자동 재개됩니다';
    if (activeJob && ['waiting_login', 'idle', 'opening_browser'].includes(activeJob.status)) {
      activeJob = {
        status: auth.isBaeminPhoneAuthLikeUrl(browser.currentUrl) ? 'waiting_phone_auth' : 'waiting_login',
        message: authRequiredReason,
        updatedAt: Date.now()
      };
    }
    return true;
  }
  if (browser.sessionLoggedIn && sessionPaused) {
    sessionPaused = false;
    authRequiredReason = '';
    authRecovering = false;
  }
  return false;
}

/** 로그인/휴대폰 인증 완료될 때까지 대기 후 재개 */
async function waitForBaeminAuthResume(timeoutMs = 30 * 60 * 1000) {
  const started = Date.now();
  authRecovering = false;
  while (Date.now() - started < timeoutMs && !shutdownRequested) {
    await detectAndMarkAuthRequired();
    const browser = getBrowserHealth();
    if (browser.sessionLoggedIn && !require('../server/crawl-session-auth').isBaeminLoginLikeUrl(browser.currentUrl)) {
      sessionPaused = false;
      authRequiredReason = '';
      authRecovering = false;
      return { ok: true, browser };
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  return { ok: false, message: '배민 인증 대기 시간 초과' };
}

let detachSpaGuard = () => {};

async function ensurePlaywrightBrowser() {
  clearActiveContextIfDead();
  if (isContextAlive(activeContext)) {
    console.log('[BREM] [browser/open] 기존 Playwright 창 재사용');
    const { attachSafeSpaGuard, recoverAllBrowserTabs } = require('../server/baemin-page-capture');
    detachSpaGuard = await attachSafeSpaGuard(activeContext);
    await recoverAllBrowserTabs(activeContext);
    return { ok: true, reused: true };
  }

  const playwright = await loadPlaywright();
  if (!playwright) {
    throw new Error('playwright 패키지가 없습니다. npm install playwright 후 다시 시도하세요.');
  }

  const context = await playwright.chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 }
  });
  activeContext = context;
  const { attachSafeSpaGuard, recoverAllBrowserTabs } = require('../server/baemin-page-capture');
  detachSpaGuard = await attachSafeSpaGuard(context);
  await recoverAllBrowserTabs(context);
  console.log('[BREM] [browser/open] 새 Playwright 창 실행');

  let tabs = scanBrowserTabs(context);
  if (!tabs.page) {
    const page = await context.newPage();
    tabs = { ...scanBrowserTabs(context), page, url: safePageUrlSync(page) };
  }

  if (!tabs.allUrls.some(url => url.includes('deliverycenter.baemin.com'))) {
    try {
      await tabs.page.goto(`${BAEMIN_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      console.log(`[BREM] [browser/open] 초기 이동 ${safePageUrlSync(tabs.page)}`);
    } catch (error) {
      console.warn(`[BREM] [browser/open] 초기 이동 경고 | ${formatError(error)}`);
    }
  }

  if (tabs.page) {
    const { recoverAllBrowserTabs } = require('../server/baemin-page-capture');
    await recoverAllBrowserTabs(context).catch(() => {});
  }

  return { ok: true, reused: false };
}

async function syncBrowserCookiesToSupabase() {
  if (!hasLocalSupabaseCredentials() || !isContextAlive(activeContext)) {
    return { ok: false, skipped: true };
  }

  const cookieHeader = await extractBaeminCookies(activeContext);
  if (!cookieHeader) {
    return { ok: false, message: '배민 쿠키 없음' };
  }

  const baeminDeliverySession = require('../server/baemin-delivery-session');
  return baeminDeliverySession.saveStoredSession(cookieHeader, {
    updatedBy: 'local_browser',
    source: 'playwright_local',
    lastValidatedAt: new Date().toISOString()
  });
}

function updateActiveSetup(setupId, setupSecret, apiBase) {
  activeSetup = {
    setupId: String(setupId || '').trim(),
    setupSecret: String(setupSecret || '').trim(),
    apiBase: String(apiBase || 'https://brem.kr').trim()
  };
}

async function saveSessionAndComplete({
  context,
  cookieHeader,
  pageUrl,
  verifyReason,
  runToken,
  closeOnComplete = false
}) {
  if (runToken !== activeRunToken) return false;

  const { setupId, setupSecret, apiBase } = activeSetup;
  if (!setupId || !setupSecret) {
    throw new Error('setupId/setupSecret 없음 — ERP에서 [배민 세션 갱신]을 다시 누르세요');
  }

  activeJob = {
    status: 'saving',
    message: '세션 쿠키를 Supabase에 저장하는 중…',
    setupId,
    currentUrl: pageUrl,
    updatedAt: Date.now()
  };
  console.log(`[BREM] [저장 시작] Supabase settings | URL: ${pageUrl} | setupId=${setupId}`);

  await postSessionToApi(apiBase, setupId, setupSecret, cookieHeader);

  if (runToken !== activeRunToken) return false;

  activeJob = {
    status: 'completed',
    message: '세션 저장 완료',
    setupId,
    currentUrl: pageUrl,
    updatedAt: Date.now()
  };
  console.log(`[BREM] [완료] 세션 저장 완료 | URL: ${pageUrl} | ${verifyReason || ''}`);
  await showBrowserBanner(context, '세션 저장 완료 — 브라우저를 유지합니다. ERP에서 [배민 전체 데이터 수집]을 사용하세요.', false);
  await delay(2000);
  if (closeOnComplete) {
    await closeContextSafely(context);
    refreshLoopRunning = false;
  }
  return true;
}

function getAutoCollectHealthPayload() {
  const { getCollectProgress } = require('../server/baemin-collect-progress');
  return {
    enabled: true,
    sessionPaused,
    collectRunning,
    collectProgress: getCollectProgress(),
    schedule: autoCollectRuntime.schedule,
    lastRunAt: autoCollectRuntime.lastRunAt,
    lastStatus: autoCollectRuntime.lastStatus,
    lastError: autoCollectRuntime.lastError,
    lastSavedCount: autoCollectRuntime.lastSavedCount || 0,
    nextScheduledAt: autoCollectRuntime.nextScheduledAt,
    lastRunSlotKey,
    lastCollectResult,
    statusLoop: getStatusLoopPayload(),
    port: PORT,
    defaultPort: DEFAULT_BAEMIN_SESSION_LOCAL_PORT
  };
}

function getStatusLoopPayload() {
  return {
    active: Boolean(statusLoop.active),
    stopping: Boolean(statusLoop.stopping),
    round: Number(statusLoop.round || 0),
    phase: statusLoop.phase || 'idle',
    message: statusLoop.message || '',
    waitEndsAt: statusLoop.waitEndsAt || 0,
    lastError: statusLoop.lastError || '',
    startedAt: statusLoop.startedAt,
    updatedAt: statusLoop.updatedAt
  };
}

function setStatusLoopPhase(phase, message = '') {
  statusLoop.phase = phase;
  if (message !== undefined) statusLoop.message = message;
  statusLoop.updatedAt = new Date().toISOString();
}

function computeThisWeekRangeForLoop() {
  const { todayKST, settlementWeekStart, latestQueryableDate } = require('../server/baemin-settlement-week');
  const today = todayKST();
  // 일별/라이더는 배민에서 오늘 데이터가 없음 → 조회 가능 최신일(보통 전일)이 기준.
  const latest = latestQueryableDate(today);
  if (!latest) {
    const fallback = settlementWeekStart(today);
    return { fromDate: fallback, toDate: fallback, label: `${fallback} ~ ${fallback}` };
  }
  // 어제가 속한 정산주를 기준으로 돈다. 오늘 기준으로 잡으면 수요일마다
  // 어제(지난 정산주 화요일)가 범위 밖으로 밀려나 지난주 마감이 빠진다.
  const fromDate = settlementWeekStart(latest);
  return {
    fromDate,
    toDate: latest,
    label: `${fromDate} ~ ${latest}`
  };
}

async function applyStatusLoopToErp(collectDate) {
  if (!hasLocalSupabaseCredentials()) {
    return { ok: false, message: '로컬 .env에 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.' };
  }
  const { applyBaeminDelivery } = require('../server/baemin-collect-pipeline');
  const result = await applyBaeminDelivery(collectDate, { appliedBy: 'status_auto_loop' });
  if (!result.ok) {
    return {
      ok: false,
      message: result.message || result.error || '배민현황 저장 실패',
      error: result.error || result.message
    };
  }
  return { ok: true, ...result };
}

async function rebuildLiveAcceptRatesAfterApply(label = 'status_auto_loop') {
  if (!hasLocalSupabaseCredentials()) {
    return { ok: false, message: '로컬 .env에 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.' };
  }
  try {
    const { rebuildLiveAcceptRatesForAppliedWeek } = require('../server/baemin-collect-pipeline');
    const result = await rebuildLiveAcceptRatesForAppliedWeek({});
    if (!result.ok) {
      console.warn(`[BREM] [수락율스냅샷][${label}] 실패:`, result.message || result.error);
      return {
        ok: false,
        message: result.message || result.error || '수락율 스냅샷 실패'
      };
    }
    console.log(
      `[BREM] [수락율스냅샷][${label}] ${result.message || `${result.upserted || 0}명`}`
    );
    return { ok: true, ...result };
  } catch (error) {
    console.warn(`[BREM] [수락율스냅샷][${label}] 오류:`, error.message || error);
    return { ok: false, message: formatError(error, '수락율 스냅샷 오류') };
  }
}

async function waitStatusLoop(ms) {
  const started = Date.now();
  statusLoop.waitEndsAt = started + ms;
  setStatusLoopPhase('waiting', statusLoop.message);
  while (statusLoop.active && !statusLoop.stopping) {
    const left = ms - (Date.now() - started);
    if (left <= 0) return true;
    statusLoop.waitEndsAt = started + ms;
    statusLoop.updatedAt = new Date().toISOString();
    await delay(Math.min(1000, left));
  }
  return false;
}

/** 장시간 대기 시 BIZ 세션 만료 방지: 배달현황 ↔ 일별(히스토리) 왕복 + 쿠키 저장 */
function getKeepAlivePages() {
  let historyUrl = `${BAEMIN_ORIGIN}/delivery/history`;
  try {
    historyUrl = require('../server/baemin-page-capture').SAFE_LANDING_URL || historyUrl;
  } catch {
    // ignore
  }
  return [
    { url: `${BAEMIN_ORIGIN}/delivery-status`, label: '배달현황' },
    { url: historyUrl, label: '일별히스토리' }
  ];
}

async function getStatusLoopPage() {
  if (!isContextAlive(activeContext)) {
    try {
      await ensurePlaywrightBrowser().catch(() => null);
    } catch {
      return null;
    }
  }
  if (!isContextAlive(activeContext)) return null;
  const pages = activeContext.pages().filter(page => !page.isClosed());
  if (pages.length) return pages[0];
  try {
    return await activeContext.newPage();
  } catch {
    return null;
  }
}

/** Playwright가 이미 BIZ 로그인 상태인데 pause/만료 플래그만 남은 경우 복구 */
async function tryRecoverSessionFromOpenBrowser() {
  clearActiveContextIfDead();
  if (!isContextAlive(activeContext)) {
    return { ok: false, message: 'Playwright 브라우저가 없습니다.' };
  }

  const tabs = scanBrowserTabs(activeContext);
  if (!tabs.anyLoggedIn && !tabs.anyHistory) {
    return {
      ok: false,
      message: '로그인된 배민Biz 탭이 없습니다. [배민 세션 갱신] 후 로그인하세요.',
      browser: getBrowserHealth()
    };
  }

  const synced = await syncBrowserCookiesToSupabase().catch(error => ({
    ok: false,
    message: formatError(error, '쿠키 저장 실패')
  }));
  if (!synced?.ok) {
    return {
      ok: false,
      message: synced?.message || synced?.reason || '쿠키 저장 실패',
      browser: getBrowserHealth()
    };
  }

  sessionPaused = false;
  await baeminAutoCollect.clearSessionPause().catch(() => {});
  await require('../server/baemin-delivery-session').markSessionValidated().catch(() => {});
  console.log('[BREM] [세션복구] 열린 브라우저 쿠키로 pause 해제 · 세션 재저장 완료');
  return {
    ok: true,
    message: '세션 복구 완료 — 만료 플래그를 해제했습니다.',
    browser: getBrowserHealth()
  };
}

async function keepAliveDuringStatusWait(ms) {
  const started = Date.now();
  statusLoop.waitEndsAt = started + ms;
  const pages = getKeepAlivePages();
  if (!statusLoop.active || statusLoop.stopping) return false;

  // 대기당 keep-alive 1회. 세션 만료/오류/5회차마다만 SPA 이동, 아니면 쿠키 동기화만.
  const needHop = Boolean(sessionPaused || statusLoop.lastError)
    || (statusLoop.round > 0 && statusLoop.round % 5 === 0);
  const target = pages[statusLoop.round % pages.length] || pages[0];
  setStatusLoopPhase(
    'waiting',
    needHop
      ? `세션 유지 · ${target.label} 1회 확인 후 대기 (${Math.ceil(ms / 1000)}초)`
      : `다음 회차 대기 · 세션 유지 중 (${Math.ceil(ms / 1000)}초)`
  );

  try {
    const page = await getStatusLoopPage();
    if (page && needHop) {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const landed = safePageUrlSync(page);
      if (isLoginLikeUrl(landed) || !isLoggedInDeliveryPage(landed)) {
        sessionPaused = true;
        statusLoop.lastError = `세션 만료 감지 · ${landed}`;
        console.warn(`[BREM] [세션유지] 로그인 페이지로 이동됨 — ${landed}`);
      } else {
        const synced = await syncBrowserCookiesToSupabase().catch(() => ({ ok: false }));
        if (synced?.ok) {
          sessionPaused = false;
          console.log(`[BREM] [세션유지] ${target.label} 쿠키 갱신 완료`);
        } else {
          console.warn(`[BREM] [세션유지] ${target.label} 이동은 됐지만 쿠키 저장 실패`);
        }
      }
    } else if (page) {
      const landed = safePageUrlSync(page);
      if (isLoginLikeUrl(landed) || !isLoggedInDeliveryPage(landed)) {
        sessionPaused = true;
        statusLoop.lastError = `세션 만료 감지 · ${landed}`;
        console.warn(`[BREM] [세션유지] 현재 탭이 로그인 페이지 — ${landed}`);
      } else {
        const synced = await syncBrowserCookiesToSupabase().catch(() => ({ ok: false }));
        if (synced?.ok) {
          sessionPaused = false;
          console.log('[BREM] [세션유지] 페이지 이동 없이 쿠키 동기화');
        }
      }
    } else {
      console.warn('[BREM] [세션유지] 브라우저 탭 없음 — 대기만 진행');
    }
  } catch (error) {
    statusLoop.lastError = formatError(error, '세션 유지 이동 실패');
    console.warn('[BREM] [세션유지] 오류:', statusLoop.lastError);
  }

  const remaining = ms - (Date.now() - started);
  if (remaining > 500) {
    const continued = await waitStatusLoop(remaining);
    if (!continued) return false;
  }
  return statusLoop.active && !statusLoop.stopping;
}

async function runStatusAutoLoopInner() {
  console.log('[BREM] [현황자동수집] 시작 — 종료 API 호출 전까지 세션 서버에서 반복');
  let isFirstRound = true;

  while (statusLoop.active && !statusLoop.stopping) {
    await detectAndMarkAuthRequired().catch(() => false);
    if (sessionPaused) {
      setStatusLoopPhase('waiting', authRequiredReason || '로그인/휴대폰 인증 대기 중…');
      const resumed = await waitForBaeminAuthResume(30 * 60 * 1000);
      if (!resumed.ok) {
        statusLoop.lastError = resumed.message || '인증 대기 시간 초과';
        break;
      }
      setStatusLoopPhase('bootstrap', '인증 완료 — 수집 재개');
    }
    statusLoop.round += 1;
    statusLoop.lastError = '';
    const round = statusLoop.round;
    const weekRange = computeThisWeekRangeForLoop();
    const collectDate = baeminAutoCollect.todayDateStringKST();

    if (isFirstRound) {
      setStatusLoopPhase('bootstrap', `1회차 부트스트랩 · 배달현황+일별(${weekRange.label})+라이더(${weekRange.label})`);
      console.log(`[BREM] [현황자동수집] ${round}회차 부트스트랩 수집 시작 | ${weekRange.label}`);
      const collect = await runLocalFullCollect({
        collectDate,
        sourceMenus: ['delivery_status', 'daily_history', 'rider_history'],
        dailyCollectRange: {
          fromDate: weekRange.fromDate,
          toDate: weekRange.toDate
        },
        riderCollectRange: {
          fromDate: weekRange.fromDate,
          toDate: weekRange.toDate
        },
        source: 'status_auto_loop_bootstrap'
      });
      if (!statusLoop.active || statusLoop.stopping) break;
      if (!collect.ok) {
        statusLoop.lastError = collect.message || '부트스트랩 수집 실패';
        setStatusLoopPhase('waiting', `${round}회차 실패 — ${statusLoop.lastError}`);
        console.warn(`[BREM] [현황자동수집] ${round}회차 실패:`, statusLoop.lastError);
        const continued = await keepAliveDuringStatusWait(STATUS_LOOP_WAIT_MS);
        if (!continued) break;
        continue;
      }
      setStatusLoopPhase('applying', `${round}회차 · 배민현황 저장 중`);
      const apply = await applyStatusLoopToErp(collect.collectDate || collectDate);
      if (!statusLoop.active || statusLoop.stopping) break;
      if (!apply.ok) {
        statusLoop.lastError = apply.message || '배민현황 저장 실패';
        setStatusLoopPhase('waiting', `${round}회차 저장 실패 — ${statusLoop.lastError}`);
        console.warn(`[BREM] [현황자동수집] ${round}회차 저장 실패:`, statusLoop.lastError);
      } else {
        setStatusLoopPhase('rider_sync', `${round}회차 · 기사앱 수락율 반영 중`);
        const rates = await rebuildLiveAcceptRatesAfterApply('status_auto_loop_bootstrap');
        if (!statusLoop.active || statusLoop.stopping) break;
        const rateNote = rates.ok
          ? ` · 수락율 ${Number(rates.upserted || rates.riderCount || 0)}명`
          : ` · 수락율 실패(${rates.message || '오류'})`;
        let erpNote = '';
        try {
          const { syncBaeminCallsAndRejections } = require('../server/baemin-erp-sync');
          const erp = await syncBaeminCallsAndRejections({
            fromDate: weekRange.fromDate,
            toDate: weekRange.toDate,
            mode: 'all'
          });
          erpNote = erp.ok
            ? ` · 콜/거절 동기화 OK`
            : ` · 콜/거절 동기화 실패(${erp.message || '오류'})`;
        } catch (erpErr) {
          erpNote = ` · 콜/거절 동기화 오류(${erpErr?.message || erpErr})`;
        }
        setStatusLoopPhase(
          'waiting',
          `${round}회차 부트스트랩 완료 · 수집 ${Number(collect.savedCount || 0)}건 · 저장 ${Number(apply.itemCount || apply.savedCount || 0)}건${rateNote}${erpNote}`
        );
        console.log(`[BREM] [현황자동수집] ${round}회차 부트스트랩 완료`);
        isFirstRound = false;
      }
    } else {
      setStatusLoopPhase('collecting', `${round}회차 · 배달현황 수집 중`);
      console.log(`[BREM] [현황자동수집] ${round}회차 배달현황 수집`);
      const collect = await runLocalFullCollect({
        collectDate,
        sourceMenus: ['delivery_status'],
        source: 'status_auto_loop'
      });
      if (!statusLoop.active || statusLoop.stopping) break;
      if (!collect.ok) {
        statusLoop.lastError = collect.message || '배달현황 수집 실패';
        setStatusLoopPhase('waiting', `${round}회차 실패 — ${statusLoop.lastError}`);
        console.warn(`[BREM] [현황자동수집] ${round}회차 실패:`, statusLoop.lastError);
      } else {
        setStatusLoopPhase('applying', `${round}회차 · 배민현황 저장 중`);
        const apply = await applyStatusLoopToErp(collect.collectDate || collectDate);
        if (!statusLoop.active || statusLoop.stopping) break;
        if (!apply.ok) {
          statusLoop.lastError = apply.message || '배민현황 저장 실패';
          setStatusLoopPhase('waiting', `${round}회차 저장 실패 — ${statusLoop.lastError}`);
          console.warn(`[BREM] [현황자동수집] ${round}회차 저장 실패:`, statusLoop.lastError);
        } else {
          setStatusLoopPhase('rider_sync', `${round}회차 · 기사앱 수락율 반영 중`);
          const rates = await rebuildLiveAcceptRatesAfterApply('status_auto_loop');
          if (!statusLoop.active || statusLoop.stopping) break;
          const rateNote = rates.ok
            ? ` · 수락율 ${Number(rates.upserted || rates.riderCount || 0)}명`
            : ` · 수락율 실패(${rates.message || '오류'})`;
          setStatusLoopPhase(
            'waiting',
            `${round}회차 완료 · 수집 ${Number(collect.savedCount || 0)}건 · 저장 ${Number(apply.itemCount || apply.savedCount || 0)}건${rateNote}`
          );
          console.log(`[BREM] [현황자동수집] ${round}회차 완료`);
        }
      }
    }

    if (!statusLoop.active || statusLoop.stopping) break;
    const continued = await keepAliveDuringStatusWait(STATUS_LOOP_WAIT_MS);
    if (!continued) break;
  }

  statusLoop.active = false;
  statusLoop.stopping = false;
  setStatusLoopPhase('idle', statusLoop.lastError ? `중지됨 — ${statusLoop.lastError}` : '중지됨');
  console.log('[BREM] [현황자동수집] 종료');
}

function startStatusAutoLoop() {
  if (statusLoop.active || statusLoopPromise) {
    return { ok: true, alreadyRunning: true, statusLoop: getStatusLoopPayload() };
  }
  if (collectRunning) {
    return { ok: false, message: '다른 수집이 진행 중입니다. 끝난 뒤 시작해 주세요.' };
  }
  if (sessionPaused) {
    const auth = getAuthStatePayload();
    return {
      ok: false,
      message: authRequiredReason || '세션 만료 — 배민 로그인/휴대폰 인증 후 다시 시작하세요.',
      sessionExpired: true,
      authState: auth.authState,
      authRequired: true
    };
  }

  statusLoop.active = true;
  statusLoop.stopping = false;
  statusLoop.round = 0;
  statusLoop.lastError = '';
  statusLoop.startedAt = new Date().toISOString();
  setStatusLoopPhase('bootstrap', '부트스트랩 준비 중…');

  statusLoopPromise = runStatusAutoLoopInner()
    .catch(error => {
      statusLoop.lastError = formatError(error, '현황 자동수집 오류');
      console.error('[BREM] [현황자동수집] 오류', error);
    })
    .finally(() => {
      statusLoopPromise = null;
      statusLoop.active = false;
      statusLoop.stopping = false;
      if (statusLoop.phase !== 'idle') {
        setStatusLoopPhase('idle', statusLoop.lastError ? `중지됨 — ${statusLoop.lastError}` : '중지됨');
      }
    });

  return { ok: true, started: true, statusLoop: getStatusLoopPayload() };
}

function stopStatusAutoLoop() {
  if (!statusLoop.active && !statusLoopPromise) {
    return { ok: true, stopped: true, statusLoop: getStatusLoopPayload() };
  }
  statusLoop.stopping = true;
  statusLoop.active = false;
  setStatusLoopPhase('idle', '사용자가 종료함');
  console.log('[BREM] [현황자동수집] 종료 요청');
  return { ok: true, stopped: true, statusLoop: getStatusLoopPayload() };
}

/**
 * 1회: 배달현황 수집 → 배민현황 저장 → 수락율 스냅샷 (기사앱 실시간 운행현황)
 */
async function runRiderLiveSyncOnce(options = {}) {
  if (riderLiveSyncRunning) {
    return { ok: false, message: '기사앱 실시간 반영이 이미 진행 중입니다.' };
  }
  if (statusLoop.active || statusLoopPromise) {
    return { ok: false, message: '배민현황 자동수집이 실행 중입니다. 종료 후 다시 시도하세요.' };
  }
  if (collectRunning) {
    return { ok: false, message: '다른 수집이 진행 중입니다. 끝난 뒤 다시 시도하세요.' };
  }
  if (sessionPaused) {
    return { ok: false, message: '세션 만료 — 배민 세션 갱신 후 다시 시도하세요.', sessionExpired: true };
  }
  if (!hasLocalSupabaseCredentials()) {
    return { ok: false, message: '로컬 .env에 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.' };
  }

  riderLiveSyncRunning = true;
  const collectDate = baeminAutoCollect.todayDateStringKST();
  const steps = [];
  try {
    console.log('[BREM] [기사앱실시간반영] 시작 — 배달현황 수집');
    const collect = await runLocalFullCollect({
      collectDate: options.collectDate || collectDate,
      sourceMenus: ['delivery_status'],
      source: 'rider_live_sync'
    });
    steps.push({
      step: 'collect',
      ok: Boolean(collect?.ok),
      savedCount: Number(collect?.savedCount || 0),
      message: collect?.message || collect?.error || ''
    });
    if (!collect?.ok) {
      return {
        ok: false,
        phase: 'collect',
        message: collect?.message || '배달현황 수집 실패',
        steps
      };
    }

    console.log('[BREM] [기사앱실시간반영] 배민현황 저장');
    const { applyBaeminDelivery } = require('../server/baemin-collect-pipeline');
    const apply = await applyBaeminDelivery(collect.collectDate || collectDate, {
      appliedBy: 'rider_live_sync'
    });
    steps.push({
      step: 'apply',
      ok: Boolean(apply?.ok),
      itemCount: Number(apply?.itemCount || apply?.savedCount || 0),
      message: apply?.message || apply?.error || ''
    });
    if (!apply?.ok) {
      return {
        ok: false,
        phase: 'apply',
        message: apply?.message || apply?.error || '배민현황 저장 실패',
        steps
      };
    }

    console.log('[BREM] [기사앱실시간반영] 수락율 스냅샷');
    const rates = await rebuildLiveAcceptRatesAfterApply('rider_live_sync');
    steps.push({
      step: 'rates',
      ok: Boolean(rates?.ok),
      riderCount: Number(rates?.riderCount || rates?.upserted || 0),
      matchedDriverCount: Number(rates?.matchedDriverCount || 0),
      message: rates?.message || ''
    });
    if (!rates?.ok && !rates?.skipped) {
      return {
        ok: false,
        phase: 'rates',
        message: rates?.message || '수락율 스냅샷 실패',
        steps,
        apply
      };
    }

    const message = `기사앱 반영 완료 · 저장 ${Number(apply.itemCount || apply.savedCount || 0)}건 · 수락율 ${Number(rates.riderCount || rates.upserted || 0)}명`;
    console.log(`[BREM] [기사앱실시간반영] ${message}`);
    return {
      ok: true,
      phase: 'done',
      message,
      collectDate: collect.collectDate || collectDate,
      collect,
      apply,
      rates,
      steps
    };
  } catch (error) {
    return { ok: false, message: formatError(error, '기사앱 실시간 반영 오류'), steps };
  } finally {
    riderLiveSyncRunning = false;
  }
}

async function resolveCollectRangeOptions(collectDate, body = {}) {
  const {
    readDailyCollectRange,
    resolveDailyCollectRangeFromBody
  } = require('../server/baemin-daily-collect-range');
  const {
    readRiderCollectRange,
    resolveRiderCollectRangeFromBody
  } = require('../server/baemin-rider-collect-range');

  const dailyCollectRange = body.dailyCollectRange
    || resolveDailyCollectRangeFromBody(body, collectDate)
    || await readDailyCollectRange(collectDate).catch(() => null);
  const riderCollectRange = body.riderCollectRange
    || resolveRiderCollectRangeFromBody(body, collectDate)
    || await readRiderCollectRange(collectDate).catch(() => null);

  return { dailyCollectRange, riderCollectRange };
}

async function runLocalFullCollect(options = {}) {
  if (collectRunning) {
    return { ok: false, conflict: true, message: '이미 수집 중입니다.' };
  }
  if (sessionPaused) {
    // DB pause가 이미 해제됐는데 로컬 변수만 남은 경우 수집을 막지 않음
    try {
      const record = await baeminAutoCollect.getAutoCollectRecord();
      if (!record.sessionPaused) {
        sessionPaused = false;
        console.log('[BREM] [전체수집] DB pause 해제 감지 — 로컬 pause 동기화');
      }
    } catch {
      // ignore
    }
  }
  if (sessionPaused) {
    return { ok: false, message: '세션 만료 — 배민 세션 갱신 필요', sessionExpired: true };
  }

  collectRunning = true;
  const collectDate = String(
    options.collectDate || baeminAutoCollect.todayDateStringKST()
  ).slice(0, 10);
  const sourceMenus = Array.isArray(options.sourceMenus) && options.sourceMenus.length
    ? options.sourceMenus
    : null;
  const { dailyCollectRange, riderCollectRange } = await resolveCollectRangeOptions(collectDate, options);
  const menuDateRanges = buildBizMenuDateRanges(collectDate, new Date(), {
    dailyCollectRange,
    riderCollectRange
  });
  const collectLabel = sourceMenus?.length === 1 && sourceMenus[0] === 'delivery_status'
    ? '배달현황'
    : '전체수집';
  console.log(`[BREM] [${collectLabel}] 시작 | date=${collectDate}`);
  console.log(`[BREM] [${collectLabel}] 배달현황: 오늘 기준`);
  console.log(`[BREM] [${collectLabel}] 일별 배달내역: ${menuDateRanges.daily_history.label}`);
  console.log(`[BREM] [${collectLabel}] 라이더별 배달내역: ${menuDateRanges.rider_history.label}`);
  if (sourceMenus) {
    console.log(`[BREM] [${collectLabel}] 수집 메뉴: ${sourceMenus.join(', ')}`);
  }

  try {
    if (!isContextAlive(activeContext)) {
      await ensurePlaywrightBrowser();
    }

    let sessionCookie = isContextAlive(activeContext)
      ? await extractBaeminCookies(activeContext)
      : '';

    if (!sessionCookie) {
      const baeminDeliverySession = require('../server/baemin-delivery-session');
      sessionCookie = await baeminDeliverySession.resolveStoredSessionCookie({});
    }

    if (!sessionCookie) {
      const message = '배민 세션 쿠키가 없습니다. [브라우저 열기/세션 유지] 후 로그인하세요.';
      lastCollectResult = { at: new Date().toISOString(), ok: false, message, savedTotal: 0, collectDate };
      return { ok: false, message };
    }

    if (isContextAlive(activeContext)) {
      await refreshApiDiscoveryBeforeCollect(activeContext, collectDate).catch(error => {
        console.warn('[BREM] [전체수집] API 탐색 실패:', formatError(error));
        if (isPlaywrightClosedError(error)) {
          clearActiveContextIfDead();
        }
      });
    }

    const collectPage = resolveCollectPlaywrightPage();
    if (!collectPage) {
      const message = 'Playwright 브라우저가 닫혀 있습니다. [브라우저 열기/세션 유지]를 누른 뒤 배민에 로그인하고 다시 수집하세요.';
      lastCollectResult = { at: new Date().toISOString(), ok: false, message, savedTotal: 0, collectDate, browserClosed: true };
      return { ok: false, message, browserClosed: true };
    }

    await syncBrowserCookiesToSupabase().catch(error => {
      console.warn('[BREM] [전체수집] 쿠키 동기화 실패:', formatError(error));
      if (isPlaywrightClosedError(error)) clearActiveContextIfDead();
    });

    const result = await baeminAutoCollect.runAutoCollectJob({
      captureDate: collectDate,
      source: options.source || 'local_manual',
      sessionCookie,
      playwrightContext: isContextAlive(activeContext) ? activeContext : null,
      playwrightPage: collectPage,
      dailyCollectRange,
      riderCollectRange,
      sourceMenus
    });

    autoCollectRuntime = {
      ...autoCollectRuntime,
      lastRunAt: result.record?.lastRunAt || new Date().toISOString(),
      lastStatus: result.ok ? 'success' : 'failed',
      lastError: result.ok ? '' : (result.message || result.record?.lastError || '수집 실패'),
      lastSavedCount: Number(result.savedCount || 0),
      nextScheduledAt: result.record?.nextScheduledAt || autoCollectRuntime.nextScheduledAt
    };

    const browserStillLoggedIn = isContextAlive(activeContext)
      && (() => {
        const tabs = scanBrowserTabs(activeContext);
        return Boolean(tabs.anyLoggedIn || tabs.anyHistory);
      })();

    if (browserStillLoggedIn) {
      sessionPaused = false;
      await baeminAutoCollect.clearSessionPause().catch(() => {});
      await require('../server/baemin-delivery-session').markSessionValidated().catch(() => {});
      if (result.sessionExpired) {
        console.warn('[BREM] [전체수집] API 실패 — 브라우저 로그인 유지, 세션 만료 표시 안 함');
      }
    } else if (result.sessionExpired) {
      sessionPaused = true;
    } else if (result.ok) {
      sessionPaused = false;
    }

    lastCollectResult = {
      at: autoCollectRuntime.lastRunAt,
      ok: result.ok,
      message: result.ok
        ? `저장 ${Number(result.savedCount || 0)}건`
        : (result.message || autoCollectRuntime.lastError || '수집 실패'),
      savedTotal: Number(result.savedCount || 0),
      collectDate
    };

    if (result.ok) {
      const menuSummary = result.results
        ? Object.entries(result.results).map(([id, row]) => `${id}:${row.ok ? row.savedCount || 0 : 'fail'}`).join(' ')
        : '';
      console.log(`[BREM] [전체수집] 완료 | ${result.savedCount}건 | ${menuSummary}`);
    } else {
      console.warn(`[BREM] [전체수집] 실패 | ${lastCollectResult.message}`);
    }

    return {
      ok: result.ok,
      message: result.ok ? '수집 완료' : (result.message || '수집 실패'),
      collectDate,
      savedCount: result.savedCount,
      totalCompleteSum: result.totalCompleteSum,
      results: result.results,
      dateRange: result.dateRange,
      menuDateRanges: result.menuDateRanges,
      summaryTotals: result.summaryTotals,
      sessionExpired: Boolean(result.sessionExpired && !browserStillLoggedIn)
    };
  } catch (error) {
    const message = formatError(error, '전체 수집 오류');
    autoCollectRuntime = {
      ...autoCollectRuntime,
      lastRunAt: new Date().toISOString(),
      lastStatus: 'failed',
      lastError: message
    };
    lastCollectResult = {
      at: autoCollectRuntime.lastRunAt,
      ok: false,
      message,
      savedTotal: 0,
      collectDate
    };
    console.error('[BREM] [전체수집] 오류', error);
    return { ok: false, message };
  } finally {
    collectRunning = false;
    if (isContextAlive(activeContext)) {
      await navigateToSafeLandingPage(activeContext).catch(() => {});
    }
  }
}

async function shutdownSessionServer() {
  if (shutdownRequested) {
    return { ok: true, message: '이미 종료 중입니다.' };
  }
  shutdownRequested = true;
  console.log('[BREM] [shutdown] 자동수집 서버 종료 요청');

  resetRefreshLoopState('서버 종료');
  if (isContextAlive(activeContext)) {
    await closeContextSafely(activeContext);
  }

  return new Promise(resolve => {
    server.close(() => {
      console.log('[BREM] [shutdown] HTTP 서버 종료');
      resolve({ ok: true, message: '자동수집 서버가 종료되었습니다.' });
      setTimeout(() => process.exit(0), 250);
    });
  });
}

async function runScheduledCollect(trigger = 'schedule') {
  if (collectRunning || isJobRunning()) return null;
  collectRunning = true;
  console.log(`[BREM] [자동수집] 시작 (${trigger})`);

  try {
    let sessionCookie = '';
    if (isContextAlive(activeContext)) {
      sessionCookie = await extractBaeminCookies(activeContext) || '';
    }

    const tabs = isContextAlive(activeContext) ? scanBrowserTabs(activeContext) : null;
    const result = await baeminAutoCollect.runAutoCollectJob({
      source: trigger === 'manual' ? 'local_manual' : 'local_scheduler',
      sessionCookie: sessionCookie || undefined,
      playwrightContext: isContextAlive(activeContext) ? activeContext : null,
      playwrightPage: tabs?.page || null
    });
    autoCollectRuntime = {
      ...autoCollectRuntime,
      lastRunAt: result.record?.lastRunAt || new Date().toISOString(),
      lastStatus: result.ok ? 'success' : 'failed',
      lastError: result.ok ? '' : (result.message || result.record?.lastError || '자동 수집 실패'),
      nextScheduledAt: result.record?.nextScheduledAt || baeminAutoCollect.computeNextScheduledAt(autoCollectRuntime.schedule)
    };

    if (result.sessionExpired) {
      sessionPaused = true;
      console.warn('[BREM] [자동수집] 세션 만료 — 배민 세션 갱신 필요 (재시도 중단)');
    } else if (result.ok) {
      sessionPaused = false;
      const menuSummary = result.results
        ? Object.entries(result.results).map(([id, row]) => `${id}:${row.ok ? row.savedCount || 0 : 'fail'}`).join(' ')
        : '';
      console.log(`[BREM] [자동수집] 완료 | ${result.savedCount}건 | ${menuSummary}`);
    } else {
      console.warn(`[BREM] [자동수집] 실패 | ${autoCollectRuntime.lastError}`);
    }

    return result;
  } catch (error) {
    autoCollectRuntime = {
      ...autoCollectRuntime,
      lastRunAt: new Date().toISOString(),
      lastStatus: 'failed',
      lastError: error.message || '자동 수집 오류'
    };
    console.error('[BREM] [자동수집] 오류', error);
    return null;
  } finally {
    collectRunning = false;
  }
}

async function tickScheduler() {
  if (sessionPaused || collectRunning || isJobRunning() || statusLoop.active) return;

  const slotKey = baeminAutoCollect.getCurrentKSTSlot(autoCollectRuntime.schedule);
  if (!slotKey || slotKey === lastRunSlotKey) return;

  lastRunSlotKey = slotKey;
  await runScheduledCollect('schedule');
}

async function heartbeat() {
  try {
    const nextScheduledAt = baeminAutoCollect.computeNextScheduledAt(autoCollectRuntime.schedule);
    autoCollectRuntime.nextScheduledAt = nextScheduledAt;
    await baeminAutoCollect.touchLocalServerHeartbeat({
      schedule: autoCollectRuntime.schedule,
      nextScheduledAt
    });

    if (isContextAlive(activeContext)) {
      const { recoverAllBrowserTabs } = require('../server/baemin-page-capture');
      await recoverAllBrowserTabs(activeContext).catch(() => {});
    }

    if (sessionPaused) {
      const session = await baeminAutoCollect.getAutoCollectRecord();
      if (!session.sessionPaused && !session.lastError) {
        sessionPaused = false;
        console.log('[BREM] [자동수집] 세션 pause 해제됨');
      }
    }
  } catch (error) {
    console.warn('[BREM] [heartbeat] 실패:', error.message);
  }
}

function startAutoCollectScheduler() {
  const scheduleText = autoCollectRuntime.schedule.join(', ');
  console.log(`[BREM] [자동수집] 스케줄 활성 | KST ${scheduleText}`);
  console.log('[BREM] [자동수집] PC에서 npm run baemin:session-server 실행 중일 때만 동작합니다.');

  autoCollectRuntime.nextScheduledAt = baeminAutoCollect.computeNextScheduledAt(autoCollectRuntime.schedule);
  void heartbeat();
  setInterval(() => {
    void heartbeat();
  }, HEARTBEAT_MS);
  setInterval(() => {
    void tickScheduler();
  }, SCHEDULER_TICK_MS);
}

async function refreshApiDiscoveryBeforeCollect(context, collectDate) {
  if (!isContextAlive(context)) return;

  const menuDateRanges = buildBizMenuDateRanges(collectDate);
  const tabs = scanBrowserTabs(context);
  const page = tabs.page || await context.newPage();
  const {
    SAFE_LANDING_URL,
    isDeliveryStatusSpaUrl,
    ensureProductionDeliveryPage
  } = require('../server/baemin-page-capture');

  await ensureProductionDeliveryPage(page).catch(error => {
    console.warn('[BREM] [수집 준비] 운영 도메인 전환 실패:', formatError(error));
  });

  try {
    const { resolveCenterContextViaPage } = require('../server/baemin-center-context');
    const center = await resolveCenterContextViaPage(page);
    if (center?.centerId || center?.managementId || center?.partnerId) {
      console.log(`[BREM] [수집 준비] centerId=${center.centerId} partnerId=${center.partnerId}`);
    }
  } catch (error) {
    console.warn('[BREM] [수집 준비] center context 실패:', formatError(error));
  }

  try {
    console.log('[BREM] [수집 준비] 배달현황: 오늘 기준');
    console.log(`[BREM] [수집 준비] 일별 배달내역: ${menuDateRanges.daily_history.label}`);
    console.log(`[BREM] [수집 준비] 라이더별 배달내역: ${menuDateRanges.rider_history.label}`);
    if (!isDeliveryStatusSpaUrl(page.url())) {
      await page.goto(SAFE_LANDING_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await delay(400);
    }
  } catch (error) {
    console.warn('[BREM] [수집 준비] 배달현황 이동 실패:', formatError(error));
  }
}

async function navigateToSafeLandingPage(context) {
  if (!isContextAlive(context)) return;
  const tabs = scanBrowserTabs(context);
  const page = tabs.page;
  if (!page || page.isClosed()) return;
  try {
    const { SAFE_LANDING_URL } = require('../server/baemin-page-capture');
    await page.goto(SAFE_LANDING_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    console.log(`[BREM] [세션 완료] 배달현황 화면 ${safePageUrlSync(page)}`);
  } catch (error) {
    console.warn(`[BREM] [세션 완료] 배달현황 이동 실패 | ${formatError(error)}`);
  }
}

async function probeCollectPages(context, collectDate) {
  const pages = context.pages().filter(page => !page.isClosed());
  const page = pages[0] || await context.newPage();
  const { ensureSafeBrowserTab } = require('../server/baemin-page-capture');
  await ensureSafeBrowserTab(page).catch(() => {});
  return page;
}

async function persistDiscoveredApis(discoveryState) {
  const registry = buildRegistryFromDiscovery(discoveryState);
  try {
    const pipeline = require('../server/baemin-collect-pipeline');
    const saved = await pipeline.saveApiRegistry(registry);
    if (!saved.ok) {
      console.warn('[BREM] [API 탐색] registry 저장 실패:', saved.error || saved.message || 'unknown');
      return;
    }
    console.log(`[BREM] [API 탐색] registry 저장 완료 | endpoints=${Object.keys(registry.endpoints || {}).join(', ') || '(없음)'}`);
  } catch (error) {
    console.warn('[BREM] [API 탐색] registry 저장 오류:', formatError(error));
  }
}

async function runSessionRefresh() {
  if (refreshLaunchPromise) {
    return refreshLaunchPromise;
  }
  refreshLaunchPromise = runSessionRefreshInner().finally(() => {
    refreshLaunchPromise = null;
  });
  return refreshLaunchPromise;
}

async function runSessionRefreshInner() {
  if (refreshLoopRunning && isContextAlive(activeContext)) {
    console.log('[BREM] [시작] 이미 갱신 루프 실행 중 — 브라우저 유지');
    return;
  }
  if (refreshLoopRunning && !isContextAlive(activeContext)) {
    resetRefreshLoopState('브라우저 닫힘 — 갱신 재시작');
  }
  refreshLoopRunning = true;

  const runToken = activeRunToken;
  const playwright = await loadPlaywright();
  if (!playwright) {
    refreshLoopRunning = false;
    throw new Error('playwright 패키지가 없습니다. npm install playwright 후 다시 시도하세요.');
  }

  const setupId = activeSetup.setupId;
  activeJob = {
    status: 'opening_browser',
    message: '브라우저를 여는 중…',
    setupId,
    updatedAt: Date.now()
  };
  console.log(`[BREM] [시작] 세션 갱신 | setupId=${setupId} | server=${SERVER_VERSION}`);
  console.log(`[BREM] [시작] script=${SCRIPT_PATH}`);

  let context = null;

  try {
    clearActiveContextIfDead();
    const { attachSafeSpaGuard, recoverAllBrowserTabs } = require('../server/baemin-page-capture');
    if (isContextAlive(activeContext)) {
      context = activeContext;
      detachSpaGuard = await attachSafeSpaGuard(context);
      await recoverAllBrowserTabs(context).catch(() => {});
      console.log('[BREM] [브라우저] 기존 Playwright 창 재사용');
    } else {
      activeContext = null;
      context = await playwright.chromium.launchPersistentContext(PROFILE_DIR, {
        headless: false,
        viewport: { width: 1280, height: 900 }
      });
      activeContext = context;
      detachSpaGuard = await attachSafeSpaGuard(context);
      await recoverAllBrowserTabs(context).catch(() => {});
      console.log('[BREM] [브라우저] 새 Playwright 창 실행');
    }

    const discoveryState = createApiDiscoveryState();
    const detachDiscovery = attachApiDiscovery(context, discoveryState);

    context.on('page', (newPage) => {
      attachPageDiscovery(newPage, discoveryState);
      console.log(`[BREM] [탭 열림] ${safePageUrlSync(newPage)}`);
      newPage.on('framenavigated', (frame) => {
        if (frame === newPage.mainFrame()) {
          console.log(`[BREM] [탭 이동] ${safePageUrlSync(newPage)}`);
        }
      });
    });

    let tabs = scanBrowserTabs(context);
    if (!tabs.page) {
      const page = await context.newPage();
      attachPageDiscovery(page, discoveryState);
      tabs = { ...scanBrowserTabs(context), page, url: safePageUrlSync(page) };
    } else {
      attachPageDiscovery(tabs.page, discoveryState);
    }

    if (tabs.page) {
      const { ensureSafeBrowserTab } = require('../server/baemin-page-capture');
      await ensureSafeBrowserTab(tabs.page).catch(() => {});
    }

    if (!tabs.allUrls.some(url => isDeliveryCenterHost(url))) {
      try {
        await tabs.page.goto(`${BAEMIN_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        console.log(`[BREM] [초기 이동] ${safePageUrlSync(tabs.page)}`);
      } catch (error) {
        console.log(`[BREM] [초기 이동 경고] ${error.message}`);
      }
    }

    // 브라우저 준비 await 중 토큰이 바뀌었으면 waiting_login 좀비를 남기지 않음
    if (runToken !== activeRunToken) {
      console.log('[BREM] [시작] 갱신 토큰 변경 — 브라우저 준비 중 이전 루프 종료');
      return;
    }

    activeJob = {
      status: 'waiting_login',
      message: '배민Biz 로그인 후 배달이력(/delivery/history) 페이지로 이동하세요.',
      setupId,
      updatedAt: Date.now()
    };

    const started = Date.now();
    let lastVerifyReason = '';

    while (Date.now() - started < LOGIN_WAIT_MS) {
      if (runToken !== activeRunToken) {
        console.log('[BREM] [시작] 갱신 토큰 변경 — 로그인 대기 루프 종료');
        return;
      }

      if (!isContextAlive(context)) {
        failJob(setupId, '브라우저가 닫혔습니다', tabs.url, '창이 닫혔습니다');
        return;
      }

      tabs = scanBrowserTabs(context);
      const pageUrl = tabs.url;
      const loggedIn = tabs.anyLoggedIn || tabs.anyHistory || isLoggedInDeliveryPage(pageUrl);
      const onHistory = tabs.anyHistory || isOnDeliveryHistoryPage(pageUrl);

      activeJob = {
        status: 'waiting_login',
        message: onHistory
          ? '배달이력(/delivery/history) 감지 — 쿠키 추출 중…'
          : loggedIn
            ? '배달 페이지 감지 — 쿠키 추출 중…'
            : '배민Biz 로그인 후 배달이력(/delivery/history) 페이지로 이동하세요.',
        setupId,
        currentUrl: pageUrl,
        allUrls: tabs.allUrls,
        updatedAt: Date.now()
      };

      console.log(
        `[BREM] [heartbeat] 탭 ${tabs.allUrls.length}개`
        + ` | history=${onHistory} loggedIn=${loggedIn}`
        + ` | URLs: ${tabs.allUrls.join(' | ') || '(없음)'}`
      );

      if (loggedIn || onHistory) {
        console.log(`[BREM] [로그인 감지] /delivery/history=${onHistory} | 대표 URL: ${pageUrl}`);

        const cookieHeader = await extractBaeminCookies(context);
        if (!cookieHeader) {
          lastVerifyReason = 'baemin.com 쿠키 없음';
          console.log(`[BREM] [쿠키 추출] 실패 — baemin.com 쿠키 없음`);
        } else {
          const verify = await verifySessionCookie(cookieHeader, pageUrl, onHistory);
          lastVerifyReason = verify.reason;
          console.log(`[BREM] [쿠키 검증] ${verify.ok ? '성공' : '실패'} | ${verify.reason} | via=${verify.via || '-'}`);

          if (verify.ok) {
            try {
              const saved = await saveSessionAndComplete({
                context,
                cookieHeader,
                pageUrl,
                verifyReason: verify.reason,
                runToken,
                closeOnComplete: false
              });
              if (saved) {
                sessionPaused = false;
                await baeminAutoCollect.clearSessionPause().catch(() => {});
                try {
                  await persistDiscoveredApis(discoveryState);
                } catch (probeError) {
                  console.warn('[BREM] [API 탐색] 저장 후 registry 저장 실패 (세션은 저장됨):', formatError(probeError));
                }
                await navigateToSafeLandingPage(context);
                detachDiscovery();
                activeJob = {
                  status: 'completed',
                  message: '세션 저장 완료 — 브라우저 유지 중',
                  setupId,
                  currentUrl: pageUrl,
                  updatedAt: Date.now()
                };
                await showBrowserBanner(
                  context,
                  '세션 저장 완료 — 브라우저를 유지합니다. ERP에서 [배민 전체 데이터 수집]을 사용하세요.',
                  false
                );
                refreshLoopRunning = false;
                return;
              }
            } catch (saveError) {
              const reason = formatError(saveError, saveError?.message || '세션 저장 실패');
              console.error('[BREM] [저장 단계 실패] error.message:', saveError?.message || '-');
              console.error('[BREM] [저장 단계 실패] error.stack:', saveError?.stack || '-');
              console.error('[BREM] [저장 단계 실패] formatted:', reason);
              console.error('[BREM] [저장 단계 실패] raw:', safeJsonStringify(saveError));
              failJob(setupId, '세션 저장 실패', pageUrl, reason);
              await showBrowserBanner(context, reason, true);
              refreshLoopRunning = false;
              return;
            }
          }
        }
      } else {
        console.log(`[BREM] [로그인 대기] /delivery/history 미감지`);
      }

      await delay(POLL_MS);
    }

    failJob(
      activeSetup.setupId,
      '세션 갱신 시간 초과',
      tabs.url,
      lastVerifyReason || '배달이력 페이지 진입 또는 쿠키 검증 실패'
    );
    await showBrowserBanner(context, activeJob.message, true);
    refreshLoopRunning = false;
  } catch (error) {
    const tabs = context ? scanBrowserTabs(context) : { url: '' };
    const reason = formatPlaywrightLaunchError(error);
    console.error('[BREM] [세션 갱신 오류] error.message:', error?.message || '-');
    console.error('[BREM] [세션 갱신 오류] error.stack:', error?.stack || '-');
    console.error('[BREM] [세션 갱신 오류] formatted:', reason);
    failJob(activeSetup.setupId, '세션 갱신 오류', tabs.url, reason);
    if (context && isContextAlive(context)) {
      await showBrowserBanner(context, reason, true);
    }
    refreshLoopRunning = false;
  }
}

function renderStartPage(setupId, notice) {
  const safeNotice = notice ? `<p style="color:#b45309">${notice}</p>` : '';
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>BREM 배민 세션 갱신</title>
<style>
body{font-family:sans-serif;max-width:600px;margin:40px auto;padding:0 16px;line-height:1.6}
.fail{color:#b91c1c}.done{color:#15803d;font-size:1.35rem;font-weight:700;margin:0}
#doneBox{display:none;margin:16px 0;padding:20px;background:#f0fdf4;border:2px solid #22c55e;border-radius:8px}
#url{font-size:13px;color:#6b7280;word-break:break-all}
</style></head><body>
<h1>배민Biz 세션 갱신</h1>
<p id="status">브라우저에서 배민Biz 로그인을 진행하세요…</p>
<p id="url"></p>
<p id="error" class="fail"></p>
<div id="doneBox"><p class="done">세션 저장 완료</p><p>브라우저는 유지됩니다. ERP에서 <strong>[배민 전체 데이터 수집]</strong>을 사용하세요.</p></div>
${safeNotice}
<p>로그인 후 <strong>/delivery/history</strong> 화면까지 이동하면 자동 완료됩니다.</p>
<p style="font-size:12px;color:#9ca3af">server ${SERVER_VERSION}</p>
<script>
(function(){
  var done=false;
  function showDone(){
    if(done)return; done=true;
    document.getElementById('status').textContent='';
    document.getElementById('error').textContent='';
    document.getElementById('doneBox').style.display='block';
    document.title='세션 저장 완료 — BREM';
  }
  async function poll(){
    try{
      var r=await fetch('/job?t='+Date.now(),{cache:'no-store'});
      var j=await r.json();
      if(j.status==='completed'){ showDone(); return; }
      if(j.status==='failed'){
        document.getElementById('error').textContent=j.message||'세션 갱신 실패';
        document.getElementById('status').textContent='';
        return;
      }
      document.getElementById('status').textContent=j.message||j.status||'대기 중…';
      if(j.currentUrl){ document.getElementById('url').textContent='감지 URL: '+j.currentUrl; }
      else if(j.allUrls&&j.allUrls.length){ document.getElementById('url').textContent='탭: '+j.allUrls.join(' | '); }
    }catch(e){
      document.getElementById('error').textContent='로컬 서버 연결 실패 — npm run baemin:session-server 확인';
    }
    setTimeout(poll, 1000);
  }
  poll();
})();
</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  applyCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/health') {
    let sessionStatus = { configured: false, lastError: '', lastValidatedAt: null };
    if (hasLocalSupabaseCredentials()) {
      try {
        const baeminDeliverySession = require('../server/baemin-delivery-session');
        const stored = await Promise.race([
          baeminDeliverySession.getStoredSessionRecord(),
          new Promise(resolve => setTimeout(() => resolve(null), 2000))
        ]);
        sessionStatus = {
          configured: Boolean(stored?.cookie),
          lastError: stored?.lastError || '',
          lastValidatedAt: stored?.lastValidatedAt || null,
          updatedAt: stored?.updatedAt || null
        };
      } catch {
        // ignore
      }
    }

    const browser = getBrowserHealth();
    await detectAndMarkAuthRequired().catch(() => false);
    const authPayload = getAuthStatePayload(browser);
    return sendJsonWithCors(req, res, 200, {
      ok: true,
      port: PORT,
      version: SERVER_VERSION,
      features: {
        collectDaily: true,
        collectRider: true,
        collectDelivery: true,
        sessionRefresh: true,
        applyErp: true,
        statusLoop: true,
        morningRun: true,
        authState: true
      },
      supabaseConfigured: hasLocalSupabaseCredentials(),
      jobRunning: isJobRunning(),
      browser,
      authState: authPayload.authState,
      session: {
        ...sessionStatus,
        paused: sessionPaused,
        state: sessionPaused || sessionStatus.lastError
          ? 'expired'
          : (sessionStatus.configured ? 'ok' : 'missing'),
        ...authPayload
      },
      statusLoop: getStatusLoopPayload(),
      autoCollect: getAutoCollectHealthPayload()
    });
  }

  if (url.pathname === '/browser/open' && req.method === 'POST') {
    try {
      const opened = await ensurePlaywrightBrowser();
      return sendJsonWithCors(req, res, 200, {
        ok: true,
        message: opened.reused ? '기존 Playwright 브라우저를 재사용합니다.' : 'Playwright 브라우저를 열었습니다.',
        browser: getBrowserHealth()
      });
    } catch (error) {
      return sendJsonWithCors(req, res, 500, {
        ok: false,
        message: formatPlaywrightLaunchError(error),
        browser: getBrowserHealth()
      });
    }
  }

  if (url.pathname === '/browser/recover' && req.method === 'POST') {
    try {
      if (!isContextAlive(activeContext)) {
        return sendJsonWithCors(req, res, 409, {
          ok: false,
          message: 'Playwright 브라우저가 없습니다.'
        });
      }
      const { attachSafeSpaGuard, recoverAllBrowserTabs } = require('../server/baemin-page-capture');
      detachSpaGuard = await attachSafeSpaGuard(activeContext);
      await recoverAllBrowserTabs(activeContext);
      return sendJsonWithCors(req, res, 200, {
        ok: true,
        message: '배달현황 화면으로 복구했습니다.',
        browser: getBrowserHealth()
      });
    } catch (error) {
      return sendJsonWithCors(req, res, 500, {
        ok: false,
        message: formatError(error)
      });
    }
  }

  if (url.pathname === '/session/resync' && req.method === 'POST') {
    try {
      const result = await tryRecoverSessionFromOpenBrowser();
      return sendJsonWithCors(req, res, result.ok ? 200 : 409, result);
    } catch (error) {
      return sendJsonWithCors(req, res, 500, {
        ok: false,
        message: formatError(error)
      });
    }
  }

  if (url.pathname === '/probe/network' && req.method === 'POST') {
    if (!isContextAlive(activeContext)) {
      return sendJsonWithCors(req, res, 409, {
        ok: false,
        message: 'Playwright 브라우저가 없습니다. [브라우저 열기/세션 유지] 후 다시 시도하세요.'
      });
    }
    try {
      const body = await readJsonBody(req);
      const result = await probeBaeminNetwork(activeContext, {
        referenceDate: body?.referenceDate
      });
      return sendJsonWithCors(req, res, 200, result);
    } catch (error) {
      return sendJsonWithCors(req, res, 500, {
        ok: false,
        message: formatError(error)
      });
    }
  }

  if (url.pathname === '/debug/partner-probe' && req.method === 'POST') {
    if (!isContextAlive(activeContext)) {
      return sendJsonWithCors(req, res, 409, {
        ok: false,
        message: 'Playwright 브라우저가 없습니다.'
      });
    }
    try {
      const pages = activeContext.pages().filter(page => !page.isClosed());
      const page = pages[0];
      const {
        listPartnerCentersViaPage,
        resolveCenterContextViaPage
      } = require('../server/baemin-center-context');
      const active = await resolveCenterContextViaPage(page);
      const partners = await listPartnerCentersViaPage(page);
      return sendJsonWithCors(req, res, 200, {
        ok: true,
        version: SERVER_VERSION,
        active,
        partners,
        pageUrl: page.url()
      });
    } catch (error) {
      return sendJsonWithCors(req, res, 500, {
        ok: false,
        message: formatError(error)
      });
    }
  }

  if (url.pathname === '/debug/partner-api-compare' && req.method === 'POST') {
    if (!isContextAlive(activeContext)) {
      return sendJsonWithCors(req, res, 409, { ok: false, message: 'Playwright 브라우저가 없습니다.' });
    }
    try {
      const body = await readJsonBody(req);
      const ids = Array.isArray(body?.partnerIds) && body.partnerIds.length
        ? body.partnerIds
        : ['DP2603096926', 'DP2605040667', 'DP2604132767'];
      const page = activeContext.pages().filter(p => !p.isClosed())[0];
      const active = await require('../server/baemin-center-context').resolveCenterContextViaPage(page);
      const rows = await page.evaluate(async ({ partnerIds, fromDate, toDate }) => {
        const results = [];
        for (const id of partnerIds) {
          const qs = new URLSearchParams({
            page: '0',
            size: '5',
            fromDate,
            toDate,
            partnerId: id,
            cooperationId: id,
            managementId: id,
            centerId: id
          });
          const url = `https://api-deliverycenter.baemin.com/v4/management/daily-delivery-status?${qs}`;
          const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
          const json = await res.json().catch(() => ({}));
          const data = Array.isArray(json?.data) ? json.data : [];
          results.push({
            partnerId: id,
            status: res.status,
            sample: data.slice(0, 3).map(row => ({
              date: row.deliveryDate || row.date,
              complete: row.totalComplete ?? row.completeCount
            }))
          });
        }
        return results;
      }, { partnerIds: ids, fromDate: '2026-06-24', toDate: '2026-06-28' });
      const first = JSON.stringify(rows[0]?.sample || []);
      const allSame = rows.every(row => JSON.stringify(row.sample || []) === first);
      return sendJsonWithCors(req, res, 200, { ok: true, active, rows, allSame });
    } catch (error) {
      return sendJsonWithCors(req, res, 500, { ok: false, message: formatError(error) });
    }
  }

  if (url.pathname === '/debug/partner-dom' && req.method === 'POST') {
    if (!isContextAlive(activeContext)) {
      return sendJsonWithCors(req, res, 409, { ok: false, message: 'Playwright 브라우저가 없습니다.' });
    }
    try {
      const pages = activeContext.pages().filter(page => !page.isClosed());
      const page = pages[0];
      const { BAEMIN_CENTER_CHANGE_URL } = require('../server/baemin-center-context');
      await page.goto(BAEMIN_CENTER_CHANGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      const dom = await page.evaluate(() => ({
        url: location.href,
        buttons: [...document.querySelectorAll('button')].map(btn => btn.textContent?.trim()).filter(Boolean).slice(0, 30),
        options: [...document.querySelectorAll('[role="option"], li')].map(el => el.textContent?.trim()).filter(Boolean).slice(0, 30),
        combobox: [...document.querySelectorAll('[role="combobox"]')].map(el => el.textContent?.trim()).filter(Boolean)
      }));
      return sendJsonWithCors(req, res, 200, { ok: true, dom });
    } catch (error) {
      return sendJsonWithCors(req, res, 500, { ok: false, message: formatError(error) });
    }
  }

  if (url.pathname === '/debug/partner-switch' && req.method === 'POST') {
    if (!isContextAlive(activeContext)) {
      return sendJsonWithCors(req, res, 409, { ok: false, message: 'Playwright 브라우저가 없습니다.' });
    }
    try {
      const body = await readJsonBody(req);
      const pages = activeContext.pages().filter(page => !page.isClosed());
      const page = pages[0];
      const { selectPartnerCenter, resolveCenterContextViaPage } = require('../server/baemin-center-context');
      const captured = [];
      const onRequest = request => {
        const url = request.url();
        if (!url.includes('api-deliverycenter')) return;
        if (!/\/center/i.test(url)) return;
        captured.push({
          method: request.method(),
          url,
          postData: request.postData() || ''
        });
      };
      page.on('request', onRequest);
      let result;
      try {
        result = await selectPartnerCenter(page, {
          partnerId: body?.partnerId,
          partnerName: body?.partnerName || ''
        });
      } finally {
        page.off('request', onRequest);
      }
      const active = await resolveCenterContextViaPage(page);
      return sendJsonWithCors(req, res, 200, {
        ok: true,
        result,
        active,
        requests: captured,
        pageUrl: page.url()
      });
    } catch (error) {
      return sendJsonWithCors(req, res, 500, { ok: false, message: formatError(error) });
    }
  }

  if (url.pathname === '/collect/full' && req.method === 'POST') {
    if (collectRunning) {
      return sendJsonWithCors(req, res, 409, {
        ok: false,
        message: '이미 수집 중입니다.',
        autoCollect: getAutoCollectHealthPayload(),
        browser: getBrowserHealth()
      });
    }

    let body = {};
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text) body = JSON.parse(text);
    } catch {
      body = {};
    }

    const result = await runLocalFullCollect({ collectDate: body.collectDate, ...body });
    const status = result.conflict ? 409 : (result.ok ? 200 : (result.sessionExpired ? 409 : 502));
    return sendJsonWithCors(req, res, status, {
      ...result,
      autoCollect: getAutoCollectHealthPayload(),
      browser: getBrowserHealth()
    });
  }

  if (url.pathname === '/collect/delivery' && req.method === 'POST') {
    if (collectRunning) {
      return sendJsonWithCors(req, res, 409, {
        ok: false,
        message: '이미 수집 중입니다.',
        autoCollect: getAutoCollectHealthPayload(),
        browser: getBrowserHealth()
      });
    }

    let body = {};
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text) body = JSON.parse(text);
    } catch {
      body = {};
    }

    const result = await runLocalFullCollect({
      collectDate: body.collectDate,
      sourceMenus: ['delivery_status'],
      source: 'local_delivery_only',
      ...body
    });
    const status = result.conflict ? 409 : (result.ok ? 200 : (result.sessionExpired ? 409 : 502));
    return sendJsonWithCors(req, res, status, {
      ...result,
      autoCollect: getAutoCollectHealthPayload(),
      browser: getBrowserHealth()
    });
  }

  if (url.pathname === '/collect/daily' && req.method === 'POST') {
    if (collectRunning) {
      return sendJsonWithCors(req, res, 409, {
        ok: false,
        message: '이미 수집 중입니다.',
        autoCollect: getAutoCollectHealthPayload(),
        browser: getBrowserHealth()
      });
    }

    let body = {};
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text) body = JSON.parse(text);
    } catch {
      body = {};
    }

    const result = await runLocalFullCollect({
      collectDate: body.collectDate,
      sourceMenus: ['daily_history'],
      source: 'local_daily_only',
      ...body
    });
    const status = result.conflict ? 409 : (result.ok ? 200 : (result.sessionExpired ? 409 : 502));
    return sendJsonWithCors(req, res, status, {
      ...result,
      autoCollect: getAutoCollectHealthPayload(),
      browser: getBrowserHealth()
    });
  }

  if (url.pathname === '/collect/rider' && req.method === 'POST') {
    if (collectRunning) {
      return sendJsonWithCors(req, res, 409, {
        ok: false,
        message: '이미 수집 중입니다.',
        autoCollect: getAutoCollectHealthPayload(),
        browser: getBrowserHealth()
      });
    }

    let body = {};
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text) body = JSON.parse(text);
    } catch {
      body = {};
    }

    const result = await runLocalFullCollect({
      collectDate: body.collectDate,
      sourceMenus: ['rider_history'],
      source: 'local_rider_only',
      ...body
    });
    const status = result.conflict ? 409 : (result.ok ? 200 : (result.sessionExpired ? 409 : 502));
    return sendJsonWithCors(req, res, status, {
      ...result,
      autoCollect: getAutoCollectHealthPayload(),
      browser: getBrowserHealth()
    });
  }

  if (url.pathname === '/shutdown' && req.method === 'POST') {
    void shutdownSessionServer();
    return sendJsonWithCors(req, res, 202, {
      ok: true,
      message: '자동수집 서버 종료 중…'
    });
  }

  if (url.pathname === '/auto-collect/run' && req.method === 'POST') {
    if (collectRunning) {
      return sendJsonWithCors(req, res, 409, {
        ok: false,
        message: '이미 수집 중입니다.',
        autoCollect: getAutoCollectHealthPayload(),
        browser: getBrowserHealth()
      });
    }
    if (sessionPaused) {
      return sendJsonWithCors(req, res, 409, {
        ok: false,
        message: '세션 만료 — 배민 세션 갱신 필요',
        autoCollect: getAutoCollectHealthPayload()
      });
    }
    void runScheduledCollect('manual').then(result => {
      if (!result) return;
    });
    return sendJsonWithCors(req, res, 202, {
      ok: true,
      message: '자동 수집을 시작했습니다.',
      autoCollect: getAutoCollectHealthPayload()
    });
  }

  if (url.pathname === '/auto-collect/status') {
    return sendJsonWithCors(req, res, 200, { ok: true, autoCollect: getAutoCollectHealthPayload() });
  }

  if (url.pathname === '/status-loop/start' && req.method === 'POST') {
    const result = startStatusAutoLoop();
    const status = result.ok ? 202 : (result.sessionExpired ? 409 : 409);
    return sendJsonWithCors(req, res, status, {
      ...result,
      autoCollect: getAutoCollectHealthPayload(),
      browser: getBrowserHealth()
    });
  }

  if (url.pathname === '/status-loop/stop' && req.method === 'POST') {
    const result = stopStatusAutoLoop();
    return sendJsonWithCors(req, res, 200, {
      ...result,
      autoCollect: getAutoCollectHealthPayload(),
      browser: getBrowserHealth()
    });
  }

  if (url.pathname === '/status-loop/status') {
    return sendJsonWithCors(req, res, 200, {
      ok: true,
      statusLoop: getStatusLoopPayload(),
      autoCollect: getAutoCollectHealthPayload()
    });
  }

  if (url.pathname === '/rider-live-sync' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      const result = await runRiderLiveSyncOnce(body || {});
      const status = result.ok ? 200 : (result.sessionExpired ? 409 : 400);
      return sendJsonWithCors(req, res, status, {
        ...result,
        autoCollect: getAutoCollectHealthPayload(),
        browser: getBrowserHealth()
      });
    } catch (error) {
      return sendJsonWithCors(req, res, 500, {
        ok: false,
        message: formatError(error, '기사앱 실시간 반영 오류')
      });
    }
  }

  if (url.pathname === '/apply/erp' && req.method === 'POST') {
    if (!hasLocalSupabaseCredentials()) {
      return sendJsonWithCors(req, res, 503, {
        ok: false,
        message: '로컬 .env에 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.'
      });
    }
    try {
      const body = await readJsonBody(req);
      const collectDate = String(body.collectDate || body.captureDate || '').slice(0, 10);
      const { applyBaeminDelivery } = require('../server/baemin-collect-pipeline');
      const result = await applyBaeminDelivery(collectDate, { appliedBy: 'local-session-server' });
      if (!result.ok) {
        return sendJsonWithCors(req, res, result.status || 400, {
          ok: false,
          message: result.message || result.error,
          error: result.error || result.message
        });
      }
      return sendJsonWithCors(req, res, 200, { ok: true, ...result });
    } catch (error) {
      return sendJsonWithCors(req, res, 500, { ok: false, message: formatError(error) });
    }
  }

  if (url.pathname === '/job') {
    return sendJson(res, 200, activeJob || { status: 'idle', message: '대기 중' });
  }

  if (url.pathname === '/session/refresh' && req.method === 'POST') {
    let body = {};
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text) body = JSON.parse(text);
    } catch {
      body = {};
    }

    const setupId = String(body.setupId || '').trim();
    const setupSecret = String(body.setupSecret || '').trim();
    const apiBase = String(body.apiBase || 'https://brem.kr').trim();
    if (!setupId || !setupSecret) {
      return sendJsonWithCors(req, res, 400, {
        ok: false,
        message: 'setupId/setupSecret 이 필요합니다. ERP에서 [배민 세션 갱신]을 다시 누르세요.'
      });
    }

    updateActiveSetup(setupId, setupSecret, apiBase);

    if (shouldReuseRefreshLoop()) {
      return sendJsonWithCors(req, res, 200, {
        ok: true,
        message: '기존 브라우저에서 세션 갱신을 계속합니다.',
        browser: getBrowserHealth(),
        job: activeJob || null
      });
    }

    if (refreshLoopRunning || isJobRunning()) {
      resetRefreshLoopState('브라우저 없음 — 새 갱신 시작');
    }

    void runSessionRefresh().catch(error => {
      refreshLoopRunning = false;
      const reason = formatPlaywrightLaunchError(error);
      failJob(setupId, '세션 갱신 실패', '', reason);
      console.error('[BREM] [오류]', error?.stack || reason);
    });

    return sendJsonWithCors(req, res, 202, {
      ok: true,
      message: '세션 갱신을 시작했습니다. Playwright 브라우저를 확인하세요.',
      browser: getBrowserHealth(),
      job: activeJob || null
    });
  }

  if (url.pathname === '/start' && req.method === 'GET') {
    const setupId = url.searchParams.get('setupId') || '';
    const setupSecret = url.searchParams.get('setupSecret') || '';
    const apiBase = url.searchParams.get('apiBase') || 'https://brem.kr';

    if (!setupId || !setupSecret) {
      return sendHtml(res, renderStartPage('', 'setupId/setupSecret 필요 — ERP에서 [배민 세션 갱신]을 다시 누르세요.'));
    }

    updateActiveSetup(setupId, setupSecret, apiBase);

    if (shouldReuseRefreshLoop()) {
      console.log(`[BREM] [start] 브라우저 유지 — setupId만 갱신 | ${setupId}`);
      return sendHtml(res, renderStartPage(setupId));
    }

    if (refreshLoopRunning || isJobRunning()) {
      resetRefreshLoopState('브라우저 없음 — 새 갱신 시작');
    }

    sendHtml(res, renderStartPage(setupId));
    console.log(`[BREM] [start] 세션 갱신 시작 | setupId=${setupId} | v=${SERVER_VERSION}`);

    void runSessionRefresh().catch(error => {
      refreshLoopRunning = false;
      const reason = formatPlaywrightLaunchError(error);
      failJob(setupId, '세션 갱신 실패', '', reason);
      console.error('[BREM] [오류]', error?.stack || reason);
    });
    return;
  }

  if (url.pathname === '/morning-run' && req.method === 'POST') {
    if (morningRunRunning) {
      return sendJsonWithCors(req, res, 409, { ok: false, message: '출근 원버튼이 이미 실행 중입니다.' });
    }
    morningRunRunning = true;
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      const { runMorningCrawlPipeline } = require('../server/crawl-morning-run');
      const result = await runMorningCrawlPipeline(body || {});
      return sendJsonWithCors(req, res, result.ok ? 200 : 500, result);
    } catch (error) {
      return sendJsonWithCors(req, res, 500, {
        ok: false,
        message: formatError(error, '출근 원버튼 실패')
      });
    } finally {
      morningRunRunning = false;
    }
  }

  if (url.pathname === '/auth/wait' && req.method === 'POST') {
    const result = await waitForBaeminAuthResume();
    return sendJsonWithCors(req, res, result.ok ? 200 : 408, result);
  }

  if (url.pathname === '/erp-sync' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      const { syncBaeminCallsAndRejections } = require('../server/baemin-erp-sync');
      const weekRange = computeThisWeekRangeForLoop();
      const result = await syncBaeminCallsAndRejections({
        fromDate: body.fromDate || weekRange.fromDate,
        toDate: body.toDate || weekRange.toDate,
        mode: body.mode || 'all'
      });
      return sendJsonWithCors(req, res, result.ok ? 200 : 500, result);
    } catch (error) {
      return sendJsonWithCors(req, res, 500, { ok: false, message: formatError(error) });
    }
  }

  sendJsonWithCors(req, res, 404, { ok: false, message: 'Not found' });
});

server.on('error', error => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`[BREM] 포트 ${PORT} 사용 중 — 이미 세션 서버가 실행 중입니다.`);
    console.error('[BREM] 재시작: scripts\\restart-baemin-session-server.bat');
    console.error(`[BREM] 상태 확인: http://127.0.0.1:${PORT}/health`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log('========================================');
  console.log(`[BREM] Baemin session server v${SERVER_VERSION}`);
  console.log(`[BREM] URL: http://127.0.0.1:${PORT}`);
  console.log(`[BREM] ERP 기본 포트: ${DEFAULT_BAEMIN_SESSION_LOCAL_PORT} (listen=${PORT})`);
  console.log(`[BREM] Script: ${SCRIPT_PATH}`);
  console.log(`[BREM] health: http://127.0.0.1:${PORT}/health  (version=${SERVER_VERSION})`);
  console.log('[BREM] ✅ 서버 준비 완료 — 이 창을 닫지 마세요.');
  console.log('[BREM] 다음: brem.kr 관리자 → 배민Biz → [브라우저 열기] → [전체수집]');
  console.log(`[BREM] Playwright browsers: ${PLAYWRIGHT_BROWSERS_DIR}`);
  if (!hasLocalSupabaseCredentials()) {
    console.warn('[BREM] ⚠ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 .env 에 없습니다.');
    console.warn('[BREM]   → Vercel 배포 보호 때문에 brem.kr API 저장이 차단될 수 있습니다.');
    console.warn('[BREM]   → PC .env 에 Supabase service_role 키를 넣으면 직접 저장됩니다.');
  } else {
    console.log('[BREM] Supabase service role 설정됨 — 세션은 brem.kr API 없이 직접 저장합니다.');
  }
  console.log('========================================');
  const playwright = await loadPlaywright();
  if (!playwright) {
    console.warn('[BREM] playwright 미설치 — npm install playwright');
  } else {
    console.log('[BREM] Chromium 미설치 시: node node_modules/playwright/cli.js install chromium');
  }

  try {
    const record = await baeminAutoCollect.getAutoCollectRecord();
    autoCollectRuntime.schedule = record.schedule;
    sessionPaused = Boolean(record.sessionPaused);
    autoCollectRuntime.lastRunAt = record.lastRunAt;
    autoCollectRuntime.lastStatus = record.lastStatus;
    autoCollectRuntime.lastError = record.lastError;
    autoCollectRuntime.nextScheduledAt = record.nextScheduledAt;
  } catch (error) {
    console.warn('[BREM] [자동수집] 상태 로드 실패:', error.message);
  }

  // 쿠팡과 같이 기동 직후 Playwright 배민 창을 연다 (통합 bat / 크롤링 시작 전 준비)
  if (AUTO_OPEN_BROWSER) {
    console.log('[BREM] BAEMIN_AUTO_OPEN_BROWSER — Playwright 배민 창을 엽니다…');
    void (async () => {
      try {
        await ensurePlaywrightBrowser();
        console.log('[BREM] Playwright 배민 창 준비됨 — 로그인/배달현황 확인 후 「크롤링 시작」');
        const recovered = await tryRecoverSessionFromOpenBrowser().catch(() => ({ ok: false }));
        if (recovered?.ok) {
          console.log('[BREM] 열린 브라우저에서 세션 쿠키 동기화 완료');
        } else if (sessionPaused) {
          console.warn('[BREM] 세션 pause — Playwright 창에서 배민 로그인/휴대폰 인증을 완료하세요.');
        }
      } catch (error) {
        console.warn('[BREM] Playwright 배민 창 열기 실패:', formatError(error));
      }
    })();
  } else if (sessionPaused) {
    console.warn('[BREM] [자동수집] 세션 pause 상태 — BAEMIN_AUTO_OPEN_BROWSER=1 로 창을 열 수 있습니다.');
  }

  startAutoCollectScheduler();

  if (AUTO_RESUME_STATUS_LOOP) {
    console.log('[BREM] BAEMIN_AUTO_RESUME_STATUS_LOOP=1 — 현황 자동수집을 이어서 시작합니다.');
    setTimeout(() => {
      const started = startStatusAutoLoop();
      if (!started.ok) {
        console.warn('[BREM] 자동 재개 보류:', started.message);
      }
    }, 8000);
  }
});
