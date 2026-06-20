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

let activeJob = null;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
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

async function verifyCookieWorks(cookieHeader) {
  const response = await fetch(`${BAEMIN_ORIGIN}/delivery-status?page=0&size=1`, {
    headers: {
      Accept: 'application/json',
      Cookie: cookieHeader,
      'User-Agent': 'BREM-Baemin-Session/1.0'
    },
    redirect: 'manual'
  });
  if (response.status === 401 || response.status === 403) return false;
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return Array.isArray(json.data) || Number.isFinite(json.totalPage);
  } catch {
    return false;
  }
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

async function runSessionRefresh(setupId, setupSecret, apiBase) {
  const playwright = await loadPlaywright();
  if (!playwright) {
    throw new Error('playwright 패키지가 없습니다. npm install playwright 후 다시 시도하세요.');
  }

  activeJob = { status: 'opening_browser', message: '브라우저를 여는 중…', setupId };

  const context = await playwright.chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 }
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    activeJob = { status: 'waiting_login', message: '배민Biz에서 로그인·휴대폰 인증을 완료하세요.', setupId };
    await page.goto(`${BAEMIN_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });

    const started = Date.now();
    let cookieHeader = '';
    while (Date.now() - started < LOGIN_WAIT_MS) {
      await page.waitForTimeout(3000);
      const cookies = await context.cookies(BAEMIN_ORIGIN);
      cookieHeader = cookiesToHeader(cookies);
      if (cookieHeader && await verifyCookieWorks(cookieHeader)) {
        break;
      }
      cookieHeader = '';
    }

    if (!cookieHeader) {
      throw new Error('로그인 시간이 초과되었거나 delivery-status API 확인에 실패했습니다.');
    }

    activeJob = { status: 'saving', message: '세션 쿠키를 서버에 저장하는 중…', setupId };
    await postSessionToApi(apiBase, setupId, setupSecret, cookieHeader);
    activeJob = { status: 'completed', message: '배민Biz 세션이 저장되었습니다. ERP 화면으로 돌아가세요.', setupId };
  } finally {
    await context.close().catch(() => {});
  }
}

function renderStartPage(setupId, errorMessage) {
  const safeError = errorMessage ? `<p style="color:#b91c1c">${errorMessage}</p>` : '';
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>BREM 배민 세션 갱신</title>
<style>body{font-family:sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.6}code{background:#f3f4f6;padding:2px 6px;border-radius:4px}</style>
</head><body>
<h1>배민Biz 세션 갱신</h1>
<p id="status">브라우저에서 배민Biz 로그인을 진행하세요…</p>
${safeError}
<p>로그인·휴대폰 인증이 끝나면 이 페이지가 자동으로 완료 상태를 표시합니다.</p>
<script>
async function poll(){try{const r=await fetch('/job');const j=await r.json();document.getElementById('status').textContent=j.message||j.status;if(j.status==='completed'){document.body.insertAdjacentHTML('beforeend','<p><strong>완료!</strong> 관리자 ERP 탭으로 돌아가 [배민 자동 수집]을 사용하세요.</p>');return;}if(j.status==='failed'){return;}}catch(e){}setTimeout(poll,2000);}
poll();
</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, port: PORT });
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

    if (activeJob && activeJob.status !== 'completed' && activeJob.status !== 'failed' && activeJob.setupId === setupId) {
      return sendHtml(res, renderStartPage(setupId));
    }

    sendHtml(res, renderStartPage(setupId));

    void runSessionRefresh(setupId, setupSecret, apiBase).catch(error => {
      activeJob = { status: 'failed', message: error.message || '세션 갱신 실패', setupId };
      console.error('[BREM] Baemin session refresh failed:', error);
    });
    return;
  }

  sendJson(res, 404, { ok: false, message: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[BREM] Baemin session local server: http://127.0.0.1:${PORT}`);
  console.log('ERP [배민 세션 갱신] 버튼을 사용하거나 /start URL을 열어주세요.');
});
