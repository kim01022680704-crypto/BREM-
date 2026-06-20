/**
 * 로컬 배민Biz 세션 갱신 서버 (PC에서 실행)
 * Run: npm run baemin:session-server
 *
 * 관리자 ERP [배민 세션 갱신] 버튼 → http://127.0.0.1:3939/start?... 열림
 * Playwright 브라우저에서 직접 로그인/휴대폰 인증 후 쿠키를 brem.kr API로 전송
 */
require('dotenv').config();

const http = require('http');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.BAEMIN_SESSION_LOCAL_PORT || 3939);
const PROFILE_DIR = path.join(__dirname, '..', '.baemin-playwright-profile');
const BAEMIN_ORIGIN = 'https://deliverycenter.baemin.com';
const LOGIN_WAIT_MS = 15 * 60 * 1000;
const POLL_MS = 3000;

/** 로그인 완료로 인정하는 deliverycenter 경로 */
const LOGGED_IN_PATH_HINTS = [
  '/delivery-status',
  '/delivery/history',
  '/delivery/'
];

let activeJob = null;
let activeContext = null;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
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
    .filter(cookie => String(cookie.domain || '').includes('baemin.com'))
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ');
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

async function safePageUrl(page) {
  try {
    if (!page || page.isClosed()) return '(page closed)';
    return page.url();
  } catch {
    return '(url unavailable)';
  }
}

function pickActivePage(context) {
  if (!isContextAlive(context)) return null;
  try {
    const pages = context.pages().filter(page => !page.isClosed());
    const deliveryPage = pages.find(page => {
      try {
        return page.url().includes('deliverycenter.baemin.com');
      } catch {
        return false;
      }
    });
    return deliveryPage || pages[0] || null;
  } catch {
    return null;
  }
}

function isLoginLikeUrl(url) {
  const value = String(url || '').toLowerCase();
  return /login|signin|sign-in|auth|oauth|member\.baemin|bizmember|passport/.test(value);
}

function isOnDeliveryHistoryPage(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('deliverycenter.baemin.com')
      && parsed.pathname.includes('/delivery/history');
  } catch {
    return false;
  }
}

function isLoggedInDeliveryPage(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('deliverycenter.baemin.com')) return false;
    if (isLoginLikeUrl(url)) return false;

    return LOGGED_IN_PATH_HINTS.some(hint => parsed.pathname.includes(hint))
      || parsed.pathname.startsWith('/delivery');
  } catch {
    return false;
  }
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
    return { ok: false, reason: `HTTP ${response.status} (세션 없음 또는 만료)` };
  }

  const text = await response.text();
  if (text.trim().startsWith('<')) {
    return { ok: false, reason: `HTML 응답 (HTTP ${response.status}) — 로그인 페이지로 리다이렉트된 것으로 보입니다` };
  }

  try {
    const json = JSON.parse(text);
    return isValidBaeminApiJson(json)
      ? { ok: true, reason: `JSON 응답 정상 (HTTP ${response.status})` }
      : { ok: false, reason: `JSON 형식이 예상과 다릅니다 (HTTP ${response.status})` };
  } catch {
    return { ok: false, reason: `JSON 파싱 실패 (HTTP ${response.status})` };
  }
}

async function verifySessionCookie(cookieHeader, pageUrl) {
  const attempts = [];

  if (isOnDeliveryHistoryPage(pageUrl)) {
    attempts.push({
      label: 'delivery/history API',
      path: '/delivery/history?page=0&size=1'
    });
  }

  attempts.push({
    label: 'delivery-status API',
    path: '/delivery-status?page=0&size=1'
  });

  let lastReason = '';
  for (const attempt of attempts) {
    const result = await fetchBaeminApi(attempt.path, cookieHeader);
    lastReason = `${attempt.label}: ${result.reason}`;
    if (result.ok) {
      return { ok: true, reason: lastReason, via: attempt.label };
    }
  }

  if (isOnDeliveryHistoryPage(pageUrl) && cookieHeader) {
    return {
      ok: true,
      reason: 'delivery/history 페이지 로그인 확인 (브라우저 페이지 진입)',
      via: 'delivery/history page'
    };
  }

  if (isLoggedInDeliveryPage(pageUrl) && cookieHeader) {
    return {
      ok: true,
      reason: '배민Biz 배달 페이지 로그인 확인 (브라우저 페이지 진입)',
      via: 'delivery page'
    };
  }

  return { ok: false, reason: lastReason || '쿠키 검증 실패' };
}

async function extractBaeminCookies(context) {
  const cookies = await context.cookies();
  return cookiesToHeader(cookies);
}

async function postSessionToApi(apiBase, setupId, setupSecret, cookieHeader) {
  const url = `${apiBase.replace(/\/$/, '')}/api/admin/baemin-delivery/session`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setupId, setupSecret, cookie: cookieHeader })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `API 저장 실패 (${response.status})`);
  }
  return payload;
}

async function showBrowserError(context, message) {
  const page = pickActivePage(context);
  if (!page) return;
  try {
    await page.evaluate((text) => {
      const id = 'brem-session-error-banner';
      let banner = document.getElementById(id);
      if (!banner) {
        banner = document.createElement('div');
        banner.id = id;
        banner.style.cssText = [
          'position:fixed',
          'top:16px',
          'left:16px',
          'right:16px',
          'z-index:2147483647',
          'background:#7f1d1d',
          'color:#fff',
          'padding:14px 16px',
          'border-radius:8px',
          'font:14px/1.5 sans-serif',
          'box-shadow:0 8px 24px rgba(0,0,0,.25)'
        ].join(';');
        document.body.appendChild(banner);
      }
      banner.textContent = `[BREM] ${text}`;
    }, message);
  } catch {
    // evaluate 불가 페이지
  }
}

function logJob(message, extra = {}) {
  const parts = [`[BREM] ${message}`];
  if (extra.url) parts.push(`배민 페이지 URL: ${extra.url}`);
  if (extra.reason) parts.push(`원인: ${extra.reason}`);
  if (extra.via) parts.push(`검증: ${extra.via}`);
  console.log(parts.join(' | '));
}

function logSaveResult(success, url, reason) {
  if (success) {
    console.log(`[BREM] 쿠키 저장 성공 | 배민 페이지 URL: ${url || '(unknown)'}${reason ? ` | ${reason}` : ''}`);
  } else {
    console.error(`[BREM] 쿠키 저장 실패 | 배민 페이지 URL: ${url || '(unknown)'} | 원인: ${reason || '알 수 없음'}`);
  }
}

function failJob(setupId, message, url, reason) {
  const fullMessage = reason ? `${message} (${reason})` : message;
  activeJob = {
    status: 'failed',
    message: url ? `${fullMessage} — URL: ${url}` : fullMessage,
    setupId,
    currentUrl: url || '',
    reason: reason || message
  };
  logSaveResult(false, url, reason || message);
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

async function runSessionRefresh(setupId, setupSecret, apiBase) {
  const playwright = await loadPlaywright();
  if (!playwright) {
    throw new Error('playwright 패키지가 없습니다. npm install playwright 후 다시 시도하세요.');
  }

  activeJob = { status: 'opening_browser', message: '브라우저를 여는 중…', setupId };
  logJob('브라우저 시작', { reason: `setupId=${setupId}` });

  let context = null;
  let page = null;

  try {
    context = await playwright.chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: { width: 1280, height: 900 }
    });
    activeContext = context;

    page = pickActivePage(context) || await context.newPage();
    activeJob = {
      status: 'waiting_login',
      message: '배민Biz 로그인 후 배달현황·배달이력 페이지로 이동하세요. 브라우저는 로그인 완료 전까지 닫지 마세요.',
      setupId
    };

    try {
      await page.goto(`${BAEMIN_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    } catch (error) {
      logJob('초기 페이지 이동 경고', { reason: error.message, url: await safePageUrl(page) });
    }

    const started = Date.now();
    let cookieHeader = '';
    let lastUrl = await safePageUrl(page);
    let lastVerifyReason = '';

    while (Date.now() - started < LOGIN_WAIT_MS) {
      if (!isContextAlive(context)) {
        failJob(setupId, '브라우저가 닫혔습니다', lastUrl, '사용자가 창을 닫았거나 브라우저가 종료되었습니다');
        return;
      }

      page = pickActivePage(context) || page;
      lastUrl = await safePageUrl(page);
      const loggedInPage = isLoggedInDeliveryPage(lastUrl);
      const onHistoryPage = isOnDeliveryHistoryPage(lastUrl);

      activeJob = {
        status: 'waiting_login',
        message: loggedInPage
          ? (onHistoryPage
            ? '배달이력 페이지 감지 — 쿠키 추출·검증 중…'
            : '배달 페이지 감지 — 쿠키 추출·검증 중…')
          : '배민Biz 로그인·휴대폰 인증 후 배달현황 또는 배달이력(/delivery/history) 페이지로 이동하세요.',
        setupId,
        currentUrl: lastUrl
      };

      logJob(loggedInPage ? '로그인 완료 페이지 감지' : '로그인 대기 중', { url: lastUrl });

      if (loggedInPage) {
        cookieHeader = await extractBaeminCookies(context);

        if (!cookieHeader) {
          lastVerifyReason = 'baemin.com 쿠키가 아직 없습니다';
          logJob('쿠키 대기', { url: lastUrl, reason: lastVerifyReason });
        } else {
          logJob('context.cookies() 추출 완료', {
            url: lastUrl,
            reason: `쿠키 ${cookieHeader.split(';').length}개`
          });

          const verify = await verifySessionCookie(cookieHeader, lastUrl);
          lastVerifyReason = verify.reason;
          logJob('쿠키 검증', { url: lastUrl, reason: verify.reason, via: verify.via });

          if (verify.ok) {
            activeJob = {
              status: 'saving',
              message: '세션 쿠키를 Supabase에 저장하는 중…',
              setupId,
              currentUrl: lastUrl
            };

            try {
              await postSessionToApi(apiBase, setupId, setupSecret, cookieHeader);
              activeJob = {
                status: 'completed',
                message: '세션 저장 완료',
                setupId,
                currentUrl: lastUrl
              };
              logSaveResult(true, lastUrl, verify.reason);
              await closeContextSafely(context);
              return;
            } catch (saveError) {
              const saveReason = saveError.message || 'Supabase 저장 API 실패';
              failJob(setupId, '쿠키 저장 실패', lastUrl, saveReason);
              await showBrowserError(context, activeJob.message);
              return;
            }
          }

          cookieHeader = '';
        }
      }

      await delay(POLL_MS);
    }

    const reason = lastVerifyReason
      || '로그인 시간이 초과되었거나 배달 페이지 진입·쿠키 검증에 실패했습니다';
    failJob(setupId, '세션 갱신 실패', lastUrl, reason);
    await showBrowserError(context, activeJob.message);
  } catch (error) {
    const url = page ? await safePageUrl(page) : '(no page)';
    const reason = error.message || '알 수 없는 오류';
    failJob(setupId, '세션 갱신 중 오류', url, reason);
    if (context && isContextAlive(context)) {
      await showBrowserError(context, activeJob.message);
    }
  }
}

function renderStartPage(setupId, errorMessage) {
  const safeError = errorMessage ? `<p style="color:#b91c1c">${errorMessage}</p>` : '';
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>BREM 배민 세션 갱신</title>
<style>
body{font-family:sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.6}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px}
.fail{color:#b91c1c}
.done{color:#15803d;font-size:1.25rem;font-weight:700}
#doneBox{display:none;margin:16px 0;padding:16px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px}
</style>
</head><body>
<h1>배민Biz 세션 갱신</h1>
<p id="status">브라우저에서 배민Biz 로그인을 진행하세요…</p>
<p id="url" style="font-size:13px;color:#6b7280"></p>
<p id="error" class="fail"></p>
<div id="doneBox"><p class="done">세션 저장 완료</p><p>관리자 ERP 탭으로 돌아가 <strong>[배민 자동 수집]</strong>을 사용하세요.</p></div>
${safeError}
<p>로그인·휴대폰 인증 후 <strong>배달현황</strong> 또는 <strong>배달이력(/delivery/history)</strong> 페이지까지 이동하면 자동으로 완료됩니다.</p>
<p>실패해도 브라우저는 바로 닫히지 않습니다. CMD 창 로그를 확인하세요.</p>
<script>
let doneShown=false;
async function poll(){try{const r=await fetch('/job');const j=await r.json();
if(j.status!=='completed'&&j.status!=='failed'){document.getElementById('status').textContent=j.message||j.status||'';}
if(j.currentUrl){document.getElementById('url').textContent='현재 배민 페이지 URL: '+j.currentUrl;}
if(j.status==='completed'&&!doneShown){
  doneShown=true;
  document.getElementById('status').textContent='';
  document.getElementById('error').textContent='';
  document.getElementById('doneBox').style.display='block';
  return;
}
if(j.status==='failed'){document.getElementById('error').textContent=j.message||'세션 갱신 실패';return;}
}catch(e){}setTimeout(poll,1500);}
poll();
</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, port: PORT, jobRunning: isJobRunning() });
  }

  if (url.pathname === '/job') {
    return sendJson(res, 200, activeJob || { status: 'idle', message: '대기 중' });
  }

  if (url.pathname === '/start' && req.method === 'GET') {
    const setupId = url.searchParams.get('setupId') || '';
    const setupSecret = url.searchParams.get('setupSecret') || '';
    const apiBase = url.searchParams.get('apiBase') || 'https://brem.kr';

    if (!setupId || !setupSecret) {
      return sendHtml(res, renderStartPage('', 'setupId / setupSecret 가 필요합니다. ERP에서 [배민 세션 갱신]을 다시 눌러주세요.'));
    }

    if (isJobRunning()) {
      return sendHtml(res, renderStartPage(setupId, '이미 세션 갱신이 진행 중입니다. 열린 브라우저에서 로그인을 완료하세요.'));
    }

    sendHtml(res, renderStartPage(setupId));

    void runSessionRefresh(setupId, setupSecret, apiBase).catch(error => {
      const message = error.message || '세션 갱신 실패';
      failJob(setupId, '세션 갱신 실패', '', message);
    });
    return;
  }

  sendJson(res, 404, { ok: false, message: 'Not found' });
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`[BREM] Baemin session local server: http://127.0.0.1:${PORT}`);
  console.log('ERP [배민 세션 갱신] 버튼을 사용하거나 /start URL을 열어주세요.');
  const playwright = await loadPlaywright();
  if (!playwright) {
    console.warn('[BREM] playwright 미설치 — 세션 갱신 전에 다음을 실행하세요:');
    console.warn('  npm install playwright');
    console.warn('  npx playwright install chromium');
  }
});
