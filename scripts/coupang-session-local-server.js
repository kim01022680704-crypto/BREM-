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
const path = require('path');
// .env.production 을 먼저 읽되(부가 변수용), 실제 로컬 .env 값이 우선하도록 override.
// (.env.production 의 SUPABASE_SERVICE_ROLE_KEY 가 비어 있어도 .env 의 실제 키가 이김)
require('dotenv').config({ path: path.join(process.cwd(), '.env.production') });
require('dotenv').config({ path: path.join(process.cwd(), '.env'), override: true });

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
const PROFILE_DIR = path.join(process.cwd(), '.coupang-playwright-profile');

let context = null;
let latestToken = '';
let latestTokenAt = 0;
let latestCookie = '';
const seenVendorIds = new Set();
const seenApiPaths = new Set();   // 브라우저가 실제로 호출한 대시보드 API 경로(진단용)
let collecting = false;

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
  // 쿠팡 주: 수요일 시작. 이번 주 수요일 날짜(영업일 기준)
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const h = kst.getUTCHours();
  if (h < 6) kst.setUTCDate(kst.getUTCDate() - 1);
  const dow = kst.getUTCDay(); // 0=일..3=수
  const diff = (dow - 3 + 7) % 7; // 수요일로 되돌리기
  kst.setUTCDate(kst.getUTCDate() - diff);
  return kst.toISOString().slice(0, 10);
}
/** 이번 정산주 수요일 ~ 오늘(영업일)까지의 날짜 배열 (라이더 일별 백필용) */
function weekDatesUpToToday() {
  const start = thisWeekStartDateKst();
  const end = businessDateKst();
  const dates = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const endD = new Date(`${end}T00:00:00Z`);
  let guard = 0;
  while (cur <= endD && guard < 14) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard += 1;
  }
  return dates;
}

async function ensureBrowser() {
  if (context) {
    try { if (context.pages().length >= 0) return context; } catch { /* recreate */ }
  }
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1360, height: 900 },
    args: ['--start-maximized']
  });
  context.on('request', (req) => {
    try {
      const url = req.url();
      if (!url.includes('coupangeats.com')) return;
      const h = req.headers();
      const auth = h['authorization'] || h['Authorization'];
      if (auth && /^Bearer /.test(auth)) {
        latestToken = auth.replace(/^Bearer\s+/, '').trim();
        latestTokenAt = Date.now();
      }
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
  context.on('close', () => { context = null; });
  const page = context.pages()[0] || await context.newPage();
  try { await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 120000 }); } catch { /* ignore */ }
  return context;
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

async function apiGet(pathAndQuery) {
  const res = await fetch(`${ORIGIN}${pathAndQuery}`, { method: 'GET', headers: authHeaders() });
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch { /* non-json */ }
  return { ok: res.ok, status: res.status, json };
}
async function apiPost(pathAndQuery, body) {
  const res = await fetch(`${ORIGIN}${pathAndQuery}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch { /* non-json */ }
  return { ok: res.ok, status: res.status, json };
}

async function persistToken(source) {
  if (!latestToken) return;
  await captureCookieHeader();
  await sessionStore.saveStoredCoupangSession({
    token: latestToken,
    cookie: latestCookie,
    source: source || 'playwright_local'
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
        if (r.ok) summary.rider_daily += r.saved; else pushErr(`rider ${dateStr} 저장:` + (r.error || r.message));
      }
    } else {
      pushErr(httpInfo(`rider ${dateStr}`, rider));
    }
  } catch (e) { pushErr(`rider ${dateStr}: ${e.message}`); }
}

/**
 * 전체 수집: vendor_info(전 매장) → 매장별 realtime/weekly → 라이더(best-effort)
 * options: { date, weekStartDate, includeRider, skipWeekly, riderDates }
 */
async function runCollect(options = {}) {
  if (collecting) return { ok: false, message: '이미 수집 중입니다.' };
  if (!latestToken) return { ok: false, status: 401, message: '쿠팡 로그인 토큰이 없습니다. 브라우저에서 로그인 후 대시보드를 한 번 열어주세요.' };
  collecting = true;
  const summary = { peak_realtime: 0, weekly_performance: 0, vendor_info: 0, rider_daily: 0, errors: [], diag: [] };
  const pushErr = (msg) => { if (summary.errors.length < 12) summary.errors.push(String(msg)); };
  const httpInfo = (label, r) => {
    const extra = r.json && (r.json.message || r.json.error) ? ` ${r.json.message || r.json.error}` : (r.json ? '' : ' (non-JSON 응답)');
    return `${label}: HTTP ${r.status}${extra}`;
  };
  try {
    await captureCookieHeader();
    const collectDate = String(options.date || businessDateKst());
    const dtNow = nowKstIsoOffset();
    const dayStart = businessDayStartOffset(collectDate);
    const weekStart = String(options.weekStartDate || thisWeekStartDateKst());

    if (!latestCookie) pushErr('쿠키를 캡처하지 못했습니다(브라우저 세션 확인).');

    // 1) 매장 목록 확보: 캡처된 vendorId 중 하나로 daily-vendor-info 호출
    let seed = [...seenVendorIds][0];
    let vendors = [];
    if (!seed) pushErr('감지된 매장 vendorId가 없습니다. 브라우저에서 쿠팡 대시보드를 한 번 여세요.');
    if (seed) {
      const info = await apiGet(`/bff/api/v2/vendor/dashboard/${seed}/daily-vendor-info?dateTime=${encodeURIComponent(dayStart)}`);
      summary.diag.push(httpInfo('vendor_info GET', info));
      if (info.ok && info.json) {
        const items = sources.mapVendorInfoToItems(collectDate, info.json);
        if (items.length) {
          const r = await pipeline.upsertCollectItems(items);
          if (r.ok) summary.vendor_info += r.saved; else pushErr('vendor_info 저장:' + (r.error || r.message));
        } else {
          pushErr('vendor_info: 응답에 childVendorRecordDtos 없음(엔드포인트/응답형태 상이 가능)');
        }
        vendors = (info.json.data?.childVendorRecordDtos || []).map(c => ({
          id: String(c.vendorId), name: String(c.totalCumulativeStatus?.vendorName || '')
        }));
      } else {
        pushErr(httpInfo('vendor_info', info));
      }
    }
    if (!vendors.length) {
      vendors = [...seenVendorIds].map(id => ({ id, name: '' }));
    }

    // 2) 매장별 realtime + weekly
    for (const v of vendors) {
      try {
        const rt = await apiGet(`/bff/api/v2/vendor/dashboard/${v.id}/realtime-performance?dateTime=${encodeURIComponent(dtNow)}`);
        if (rt.ok && rt.json) {
          const items = sources.mapRealtimeToItems(v.id, v.name, collectDate, rt.json);
          const r = await pipeline.upsertCollectItems(items);
          if (r.ok) summary.peak_realtime += r.saved;
          if (!items.length) pushErr(`realtime ${v.id}: 응답에 peakTimePerformance 없음`);
        } else {
          pushErr(httpInfo(`realtime ${v.id}`, rt));
        }
      } catch (e) { pushErr(`realtime ${v.id}: ${e.message}`); }
      if (!options.skipWeekly) {
        try {
          const wk = await apiGet(`/bff/api/v2/vendor/dashboard/${v.id}/weekly-performance?startDate=${encodeURIComponent(weekStart + 'T06:00:00')}`);
          if (wk.ok && wk.json) {
            const items = sources.mapWeeklyToItems(v.id, v.name, weekStart, wk.json);
            const r = await pipeline.upsertCollectItems(items);
            if (r.ok) summary.weekly_performance += r.saved;
          } else {
            pushErr(httpInfo(`weekly ${v.id}`, wk));
          }
        } catch (e) { pushErr(`weekly ${v.id}: ${e.message}`); }
      }
    }

    // 3) 라이더별(전체) — 오늘 + (옵션) 이번 정산주 날짜별 백필. best-effort.
    if (options.includeRider !== false) {
      const riderDates = Array.from(new Set([collectDate, ...((Array.isArray(options.riderDates) ? options.riderDates : []))]))
        .filter(Boolean);
      for (const d of riderDates) {
        await collectRiderForDate(d, summary, pushErr, httpInfo);
      }
    }

    for (const menu of ['peak_realtime', 'weekly_performance', 'vendor_info', 'rider_daily']) {
      await pipeline.saveRun(menu === 'weekly_performance' ? weekStart : collectDate, menu, summary.errors.length ? 'partial' : 'ok', summary[menu], summary.errors.join(' | ').slice(0, 500));
    }
    await persistToken('collect');
    return {
      ok: true,
      collectDate,
      weekStart,
      summary,
      vendorCount: vendors.length,
      apiSamples: [...seenApiPaths].slice(0, 60)
    };
  } finally {
    collecting = false;
  }
}

// ── 30초 자동수집 루프(배민 status-loop 미러). PC 켜진 동안만 동작. ──
const STATUS_LOOP_WAIT_MS = 30 * 1000;
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
  lastSummary: null
};

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
    lastSummary: statusLoop.lastSummary
  };
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

async function runStatusAutoLoopInner() {
  while (statusLoop.active && !statusLoop.stopping) {
    statusLoop.round += 1;
    const first = statusLoop.round === 1;
    statusLoop.phase = 'collecting';
    statusLoop.message = first ? '첫 회차 전체 수집 중…' : `실시간 수집 중… (${statusLoop.round}회차)`;
    statusLoop.updatedAt = nowKstIsoOffset();
    try {
      // 1회차: 전체 + 이번 정산주 라이더 일별 백필 / 2회차+: 주간 제외(실시간 위주)
      const result = first
        ? await runCollect({ riderDates: weekDatesUpToToday() })
        : await runCollect({ skipWeekly: true });
      statusLoop.lastSummary = result && result.summary ? result.summary : null;
      statusLoop.lastError = '';
    } catch (e) {
      statusLoop.lastError = e && e.message ? e.message : String(e);
    }
    if (!statusLoop.active || statusLoop.stopping) break;
    statusLoop.phase = 'waiting';
    statusLoop.waitEndsAt = Date.now() + STATUS_LOOP_WAIT_MS;
    statusLoop.message = `다음 회차 대기 중… (${statusLoop.round}회차 완료)`;
    statusLoop.updatedAt = nowKstIsoOffset();
    await waitLoop(STATUS_LOOP_WAIT_MS);
  }
  statusLoop.active = false;
  statusLoop.stopping = false;
  statusLoop.phase = 'idle';
  statusLoop.message = statusLoop.round ? `중지됨 (${statusLoop.round}회차까지 수집)` : '중지됨';
  statusLoop.waitEndsAt = 0;
  statusLoop.updatedAt = nowKstIsoOffset();
}

function startStatusAutoLoop() {
  if (statusLoop.active) return { ok: false, message: '이미 자동수집 중입니다.', statusLoop: getStatusLoopPayload() };
  if (!latestToken) return { ok: false, status: 401, message: '쿠팡 로그인 토큰이 없습니다. 브라우저에서 로그인 후 대시보드를 한 번 여세요.' };
  statusLoop.active = true;
  statusLoop.stopping = false;
  statusLoop.round = 0;
  statusLoop.startedAt = nowKstIsoOffset();
  statusLoop.updatedAt = statusLoop.startedAt;
  statusLoop.lastError = '';
  statusLoop.message = '자동수집 시작…';
  void runStatusAutoLoopInner();
  return { ok: true, statusLoop: getStatusLoopPayload() };
}

function stopStatusAutoLoop() {
  if (!statusLoop.active) return { ok: true, alreadyStopped: true, statusLoop: getStatusLoopPayload() };
  statusLoop.stopping = true;
  statusLoop.active = false;
  statusLoop.message = '중지 요청됨…';
  statusLoop.updatedAt = nowKstIsoOffset();
  return { ok: true, statusLoop: getStatusLoopPayload() };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS'
  });
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
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  if (u.pathname === '/health' && req.method === 'GET') {
    const tokenAgeSec = latestToken ? Math.round((Date.now() - latestTokenAt) / 1000) : null;
    let tokenExp = null;
    try { if (latestToken) tokenExp = new Date(JSON.parse(Buffer.from(latestToken.split('.')[1], 'base64').toString('utf8')).exp * 1000).toISOString(); } catch { /* ignore */ }
    return sendJson(res, 200, {
      ok: true, port: PORT, browserOpen: Boolean(context),
      hasToken: Boolean(latestToken), tokenAgeSec, tokenExpiresAt: tokenExp,
      vendorCount: seenVendorIds.size, collecting,
      statusLoop: getStatusLoopPayload(),
      apiSamples: [...seenApiPaths].slice(0, 60)
    });
  }

  if (u.pathname === '/status-loop/start' && req.method === 'POST') {
    const r = startStatusAutoLoop();
    return sendJson(res, r.ok ? 202 : (r.status || 400), r);
  }

  if (u.pathname === '/status-loop/stop' && req.method === 'POST') {
    return sendJson(res, 200, stopStatusAutoLoop());
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

server.listen(PORT, '127.0.0.1', async () => {
  console.log('========================================');
  console.log(`[COUPANG] 세션 서버 http://127.0.0.1:${PORT}`);
  console.log('[COUPANG] 브라우저를 띄웁니다. 로그인 + 2차 인증 후 대시보드를 한 번 여세요.');
  console.log('[COUPANG] 수집: POST /collect  · 상태: GET /health');
  console.log('========================================');
  try { await ensureBrowser(); } catch (e) { console.error('[COUPANG] 브라우저 실행 실패:', e.message); }
});
