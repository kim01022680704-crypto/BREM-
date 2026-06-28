/**
 * 로컬 배민Biz 세션 갱신 서버 (PC에서 실행)
 * Run: npm run baemin:session-server
 */
require('dotenv').config();

const http = require('http');
const path = require('path');
const { URL } = require('url');
const {
  getListenLocalSessionConfig,
  DEFAULT_BAEMIN_SESSION_LOCAL_PORT
} = require('../server/baemin-session-local-config');

const listenConfig = getListenLocalSessionConfig();
const PORT = listenConfig.port;
const PROFILE_DIR = path.join(__dirname, '..', '.baemin-playwright-profile');
const BAEMIN_ORIGIN = 'https://deliverycenter.baemin.com';
const LOGIN_WAIT_MS = 15 * 60 * 1000;
const POLL_MS = 2000;
const SERVER_VERSION = '20260628d';
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
  formatApiPayloadError,
  formatError,
  migrationHintForError
} = require('../server/baemin-error-format');

let activeJob = null;
let activeContext = null;
let activeRunToken = 0;
let refreshLoopRunning = false;
/** ERP 재요청 시 최신 setup 토큰으로 저장 (브라우저는 닫지 않음) */
let activeSetup = { setupId: '', setupSecret: '', apiBase: 'https://brem.kr' };

let sessionPaused = false;
let lastRunSlotKey = null;
let collectRunning = false;
let autoCollectRuntime = {
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
  nextScheduledAt: null,
  schedule: baeminAutoCollect.DEFAULT_SCHEDULE
};

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
  return Boolean(
    activeJob
    && ['opening_browser', 'waiting_login', 'saving'].includes(activeJob.status)
  );
}

function isContextAlive(context) {
  if (!context) return false;
  try {
    context.pages();
    return true;
  } catch {
    return false;
  }
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
    if (!parsed.hostname.includes('deliverycenter.baemin.com')) return false;
    const path = parsed.pathname.toLowerCase();
    return path.includes('delivery-history') || path.includes('/delivery/history');
  } catch {
    return false;
  }
}

function isLoggedInDeliveryPage(url) {
  if (urlIncludesDeliveryHistory(url) || urlIncludesDeliveryStatus(url)) return true;

  const lower = String(url || '').toLowerCase();
  if (!lower.includes('deliverycenter.baemin.com')) return false;
  if (isLoginLikeUrl(url)) return false;
  if (lower.includes('/delivery/')) return true;

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('deliverycenter.baemin.com')) return false;
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
  if (String(url).includes('deliverycenter.baemin.com')) return 10;
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
  const cookieUrls = [
    `${BAEMIN_ORIGIN}/`,
    'https://bizmember.baemin.com/',
    'https://member.baemin.com/'
  ];
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

async function postSessionToApi(apiBase, setupId, setupSecret, cookieHeader) {
  const url = `${apiBase.replace(/\/$/, '')}/api/admin/baemin-delivery/session`;
  const cookieLength = String(cookieHeader || '').length;
  console.log(`[BREM] [Supabase 저장] POST ${url}`);
  console.log(`[BREM] [Supabase 저장] setupId=${setupId} · cookieLength=${cookieLength}`);

  if (!cookieHeader || cookieLength < 8) {
    throw new Error('배민 쿠키 헤더가 비어 있습니다. 로그인 후 배달현황(/delivery/history) 화면에서 다시 시도하세요.');
  }

  let response;
  let responseText = '';
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    throw new Error(`Supabase 저장 API 응답 파싱 실패 (HTTP ${response.status})`);
  }

  console.log('[BREM] [Supabase 저장] status:', response.status);
  console.log('[BREM] [Supabase 저장] payload:', JSON.stringify(payload).slice(0, 1000));

  if (!response.ok) {
    const message = formatApiPayloadError(payload, response.status, responseText);
    const hint = migrationHintForError(message);
    console.error('[BREM] [Supabase 저장] 실패 |', message);
    if (message.includes('SETUP_NOT_FOUND') || message.includes('세션 갱신 요청을 찾을 수 없습니다')) {
      console.error('[BREM] [Supabase 저장] ERP에서 [배민 세션 갱신]을 다시 눌러 새 setupId/setupSecret을 받으세요.');
    }
    throw new Error(`${message}${hint}`);
  }

  console.log(`[BREM] [Supabase 저장] API 응답 성공 | ${payload.message || 'ok'}`);
  return payload;
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
  runToken
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
  await showBrowserBanner(context, '세션 저장 완료 — ERP로 돌아가세요', false);
  await delay(2000);
  await closeContextSafely(context);
  refreshLoopRunning = false;
  return true;
}

function getAutoCollectHealthPayload() {
  return {
    enabled: true,
    sessionPaused,
    collectRunning,
    schedule: autoCollectRuntime.schedule,
    lastRunAt: autoCollectRuntime.lastRunAt,
    lastStatus: autoCollectRuntime.lastStatus,
    lastError: autoCollectRuntime.lastError,
    nextScheduledAt: autoCollectRuntime.nextScheduledAt,
    lastRunSlotKey,
    port: PORT,
    defaultPort: DEFAULT_BAEMIN_SESSION_LOCAL_PORT
  };
}

async function runScheduledCollect(trigger = 'schedule') {
  if (collectRunning || isJobRunning()) return null;
  collectRunning = true;
  console.log(`[BREM] [자동수집] 시작 (${trigger})`);

  try {
    const result = await baeminAutoCollect.runAutoCollectJob({ source: 'local_scheduler' });
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
      console.log(`[BREM] [자동수집] 완료 | ${result.savedCount}명 | 완료건 ${result.totalCompleteSum}`);
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
  if (sessionPaused || collectRunning || isJobRunning()) return;

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

async function runSessionRefresh() {
  if (refreshLoopRunning) {
    console.log('[BREM] [시작] 이미 갱신 루프 실행 중 — 브라우저 유지');
    return;
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
    if (isContextAlive(activeContext)) {
      context = activeContext;
      console.log('[BREM] [브라우저] 기존 Playwright 창 재사용');
    } else {
      context = await playwright.chromium.launchPersistentContext(PROFILE_DIR, {
        headless: false,
        viewport: { width: 1280, height: 900 }
      });
      activeContext = context;
      console.log('[BREM] [브라우저] 새 Playwright 창 실행');
    }

    context.on('page', (newPage) => {
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
      tabs = { ...scanBrowserTabs(context), page, url: safePageUrlSync(page) };
    }

    if (!tabs.allUrls.some(url => url.includes('deliverycenter.baemin.com'))) {
      try {
        await tabs.page.goto(`${BAEMIN_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        console.log(`[BREM] [초기 이동] ${safePageUrlSync(tabs.page)}`);
      } catch (error) {
        console.log(`[BREM] [초기 이동 경고] ${error.message}`);
      }
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
      if (runToken !== activeRunToken) return;

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
                runToken
              });
              if (saved) return;
            } catch (saveError) {
              const reason = formatError(saveError);
              console.error('[BREM] [저장 단계 실패] error.message:', saveError?.message || '-');
              console.error('[BREM] [저장 단계 실패] error.stack:', saveError?.stack || '-');
              console.error('[BREM] [저장 단계 실패] formatted:', reason);
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
    const reason = formatError(error);
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
<div id="doneBox"><p class="done">세션 저장 완료</p><p>관리자 ERP 탭으로 돌아가 <strong>[배민 자동 수집]</strong>을 사용하세요.</p></div>
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
    return sendJsonWithCors(req, res, 200, {
      ok: true,
      port: PORT,
      version: SERVER_VERSION,
      jobRunning: isJobRunning(),
      autoCollect: getAutoCollectHealthPayload()
    });
  }

  if (url.pathname === '/auto-collect/run' && req.method === 'POST') {
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

  if (url.pathname === '/job') {
    return sendJson(res, 200, activeJob || { status: 'idle', message: '대기 중' });
  }

  if (url.pathname === '/start' && req.method === 'GET') {
    const setupId = url.searchParams.get('setupId') || '';
    const setupSecret = url.searchParams.get('setupSecret') || '';
    const apiBase = url.searchParams.get('apiBase') || 'https://brem.kr';

    if (!setupId || !setupSecret) {
      return sendHtml(res, renderStartPage('', 'setupId/setupSecret 필요 — ERP에서 [배민 세션 갱신]을 다시 누르세요.'));
    }

    updateActiveSetup(setupId, setupSecret, apiBase);

    if (isJobRunning() || refreshLoopRunning) {
      console.log(`[BREM] [start] 브라우저 유지 — setupId만 갱신 | ${setupId}`);
      return sendHtml(res, renderStartPage(setupId));
    }

    sendHtml(res, renderStartPage(setupId));
    console.log(`[BREM] [start] 세션 갱신 시작 | setupId=${setupId} | v=${SERVER_VERSION}`);

    void runSessionRefresh().catch(error => {
      refreshLoopRunning = false;
      const reason = formatError(error);
      failJob(setupId, '세션 갱신 실패', '', reason);
      console.error('[BREM] [오류]', error?.stack || reason);
    });
    return;
  }

  sendJsonWithCors(req, res, 404, { ok: false, message: 'Not found' });
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log('========================================');
  console.log(`[BREM] Baemin session server v${SERVER_VERSION}`);
  console.log(`[BREM] URL: http://127.0.0.1:${PORT}`);
  console.log(`[BREM] ERP 기본 포트: ${DEFAULT_BAEMIN_SESSION_LOCAL_PORT} (listen=${PORT})`);
  console.log(`[BREM] Script: ${SCRIPT_PATH}`);
  console.log('[BREM] 구버전이면 git pull 후 서버를 재시작하세요.');
  console.log('========================================');
  const playwright = await loadPlaywright();
  if (!playwright) {
    console.warn('[BREM] playwright 미설치 — npm install playwright && npx playwright install chromium');
  }

  try {
    const record = await baeminAutoCollect.getAutoCollectRecord();
    autoCollectRuntime.schedule = record.schedule;
    sessionPaused = Boolean(record.sessionPaused);
    autoCollectRuntime.lastRunAt = record.lastRunAt;
    autoCollectRuntime.lastStatus = record.lastStatus;
    autoCollectRuntime.lastError = record.lastError;
    autoCollectRuntime.nextScheduledAt = record.nextScheduledAt;
    if (sessionPaused) {
      console.warn('[BREM] [자동수집] 세션 pause 상태 — [배민 세션 갱신] 후 재개됩니다.');
    }
  } catch (error) {
    console.warn('[BREM] [자동수집] 상태 로드 실패:', error.message);
  }

  startAutoCollectScheduler();
});
