/* eslint-disable no-console */
/**
 * 쿠팡이츠 파트너포털 API 디스커버리 (읽기 전용 관찰 도구)
 * - Playwright 헤드풀 브라우저를 띄우고 사용자가 직접 로그인/2차인증
 * - 이후 화면 이동 시 잡히는 coupangeats.com API 요청/응답을 실시간 콘솔 출력 + 파일 저장
 * - 기존 배민 코드/DB는 전혀 건드리지 않음. 캡처는 coupang-discovery/ 폴더에만 기록.
 *
 * 실행: node scripts/coupang-discovery.js   (E:\브램로컬\BREM 에서 실행 권장)
 * 종료: 브라우저 창을 닫거나 이 콘솔에서 Ctrl+C
 */
const path = require('path');
const fs = require('fs');

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.cwd(), '.playwright-browsers');
}

const { chromium } = require('playwright');

const START_URL = 'https://partner.coupangeats.com/';
const PROFILE_DIR = path.join(process.cwd(), '.coupang-playwright-profile');
const OUT_DIR = path.join(process.cwd(), 'coupang-discovery');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const CAPTURE_FILE = path.join(OUT_DIR, `capture-${STAMP}.jsonl`);
const SUMMARY_FILE = path.join(OUT_DIR, `endpoints-${STAMP}.json`);

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const endpoints = new Map(); // key: METHOD pathname -> summary
let captureCount = 0;

function isCoupangApi(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('coupangeats.com')) return false;
    if (/\.(js|css|png|jpe?g|gif|svg|webp|woff2?|ico|map)$/i.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

function summarizeBody(body) {
  if (body == null) return { kind: 'empty' };
  if (Array.isArray(body)) {
    return { kind: 'array', count: body.length, sampleKeys: body[0] && typeof body[0] === 'object' ? Object.keys(body[0]).slice(0, 30) : [] };
  }
  if (typeof body === 'object') {
    const keys = Object.keys(body);
    const inner = {};
    for (const k of ['data', 'list', 'content', 'items', 'result', 'rows']) {
      if (Array.isArray(body[k])) {
        inner[k] = { count: body[k].length, sampleKeys: body[k][0] && typeof body[k][0] === 'object' ? Object.keys(body[k][0]).slice(0, 30) : [] };
      }
    }
    return { kind: 'object', keys: keys.slice(0, 40), inner };
  }
  return { kind: typeof body };
}

async function main() {
  console.log('========================================');
  console.log('[COUPANG-DISCOVERY] start');
  console.log('[COUPANG-DISCOVERY] capture:', CAPTURE_FILE);
  console.log('[COUPANG-DISCOVERY] summary:', SUMMARY_FILE);
  console.log('========================================');
  console.log('[안내] 브라우저가 뜨면 파트너포털에 로그인 + 2차 인증을 완료하세요.');
  console.log('[안내] 그 다음 보고 싶은 화면(라이더/운행/일별/정산 등)으로 하나씩 이동하세요.');
  console.log('[안내] 이동할 때마다 잡히는 API가 아래에 실시간으로 찍힙니다.');
  console.log('');

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1360, height: 900 },
    args: ['--start-maximized']
  });

  context.on('response', async (response) => {
    try {
      const req = response.request();
      const url = response.url();
      if (!isCoupangApi(url)) return;
      const method = req.method();
      const status = response.status();
      const ct = String(response.headers()['content-type'] || '');
      const u = new URL(url);
      const isJson = ct.includes('application/json') || ct.includes('text/json');

      const resType = req.resourceType();
      if (resType === 'document' || resType === 'stylesheet' || resType === 'image' || resType === 'font' || resType === 'media') return;

      let bodySummary = null;
      let bodyPreview = '';
      if (isJson && status >= 200 && status < 400) {
        try {
          const json = await response.json();
          bodySummary = summarizeBody(json);
          bodyPreview = JSON.stringify(json).slice(0, 4000);
        } catch {
          bodySummary = { kind: 'json-parse-failed' };
        }
      }

      // 요청 본문(POST payload) + 인증/헤더 캡처 (쿠키 값은 길이만 기록)
      let requestBody = null;
      if (method === 'POST' || method === 'PUT') {
        try { requestBody = req.postData(); } catch { /* ignore */ }
      }
      const rawReqHeaders = (() => { try { return req.headers(); } catch { return {}; } })();
      const reqHeaders = {};
      for (const k of Object.keys(rawReqHeaders)) {
        const lk = k.toLowerCase();
        if (lk === 'cookie') { reqHeaders.cookie = `(present:${String(rawReqHeaders[k]).length}chars)`; continue; }
        if (/^(content-type|authorization|x-|referer|origin|accept)/i.test(lk)) reqHeaders[k] = rawReqHeaders[k];
      }

      captureCount += 1;
      const line = {
        ts: new Date().toISOString(),
        method,
        status,
        host: u.hostname,
        pathname: u.pathname,
        query: u.search,
        resourceType: resType,
        contentType: ct,
        requestBody: requestBody ? String(requestBody).slice(0, 2000) : null,
        requestHeaders: reqHeaders,
        bodySummary,
        bodyPreview
      };
      fs.appendFileSync(CAPTURE_FILE, JSON.stringify(line) + '\n');

      const key = `${method} ${u.hostname}${u.pathname}`;
      if (!endpoints.has(key)) endpoints.set(key, { method, host: u.hostname, pathname: u.pathname, sampleQuery: u.search, hits: 0, lastStatus: status, bodySummary });
      const e = endpoints.get(key);
      e.hits += 1;
      e.lastStatus = status;
      if (bodySummary) e.bodySummary = bodySummary;

      if (isJson) {
        const cnt = bodySummary?.count ?? bodySummary?.inner?.data?.count ?? bodySummary?.inner?.list?.count ?? '';
        console.log(`[API] ${method} ${status} ${u.hostname}${u.pathname}${u.search ? ' ?' + u.search.slice(1, 120) : ''}  ${cnt !== '' ? '· rows=' + cnt : ''}`);
      }
    } catch {
      /* ignore */
    }
  });

  function writeSummary() {
    const arr = [...endpoints.values()].sort((a, b) => a.pathname.localeCompare(b.pathname));
    fs.writeFileSync(SUMMARY_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), captureCount, endpointCount: arr.length, endpoints: arr }, null, 2));
  }
  const summaryTimer = setInterval(writeSummary, 5000);

  const page = context.pages()[0] || await context.newPage();
  try {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  } catch (e) {
    console.log('[안내] 초기 이동 경고:', e.message);
  }

  async function shutdown() {
    clearInterval(summaryTimer);
    writeSummary();
    console.log('');
    console.log('========================================');
    console.log(`[COUPANG-DISCOVERY] end. captures=${captureCount}, endpoints=${endpoints.size}`);
    console.log('[COUPANG-DISCOVERY] summary:', SUMMARY_FILE);
    console.log('========================================');
    try { await context.close(); } catch { /* ignore */ }
    process.exit(0);
  }

  context.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  setInterval(() => {}, 1 << 30);
}

main().catch(err => {
  console.error('[COUPANG-DISCOVERY] 실행 실패:', err?.stack || err?.message || err);
  process.exit(1);
});
