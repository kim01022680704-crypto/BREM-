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
// 토큰 포착 진단: 어떤 경로로 잡혔는지/한 번이라도 Bearer를 본 적 있는지
let seenAnyAuthHeader = false;
let lastTokenSource = '';
let lastAuthSeenAt = 0;
let lastAutoLoginAttemptAt = 0;
let authRecovering = false;
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
  context.on('close', () => { context = null; });
  const page = context.pages()[0] || await context.newPage();
  try { await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 120000 }); } catch { /* ignore */ }
  await scanPageForToken(page).catch(() => {});
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
 *   fullWeek      true면 정산주(수~화, 오늘 이하) 전체 날짜의 vendor_info/rider 수집
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
    if (options.fullWeek) {
      dates = weekDatesFrom(weekStart);
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

function getCurrentUrlSafe() {
  try {
    if (!context) return '';
    const page = context.pages()[0];
    return page ? String(page.url() || '') : '';
  } catch {
    return '';
  }
}

function getAuthPayload() {
  const auth = require('../server/crawl-session-auth');
  const currentUrl = getCurrentUrlSafe();
  const authState = auth.resolveCoupangAuthState({
    hasToken: Boolean(latestToken),
    recovering: authRecovering || require('../server/coupang-naver-otp').isRecovering(),
    currentUrl,
    authRequired: authRequired || (!latestToken && Boolean(currentUrl))
  });
  return {
    authState,
    authStateLabel: auth.authStateLabel(authState),
    authRequired,
    authRequiredReason,
    recovering: authRecovering,
    currentUrl
  };
}

async function tryRecoverCoupangAuthWithNaverOtp() {
  const autoLogin = require('../server/coupang-auto-login');
  if (authRecovering) {
    return { ok: false, message: '이미 자동로그인/OTP 복구 중입니다.' };
  }
  lastAutoLoginAttemptAt = Date.now();
  authRecovering = true;
  authRequired = true;
  authRequiredReason = '쿠팡 자동로그인 + 네이버 OTP 시도 중';
  try {
    await ensureBrowser();
    const page = await getActivePage();
    if (!page) return { ok: false, message: '쿠팡 브라우저 페이지가 없습니다.' };

    const result = await autoLogin.autoLoginCoupang(page, {
      origin: ORIGIN,
      onTokenScan: async (p) => {
        await scanPageForToken(p).catch(() => {});
      }
    });

    await scanPageForToken(page).catch(() => {});
    await persistToken(result.ok ? 'auto_login' : 'auto_login_failed').catch(() => {});

    if (result.ok && latestToken) {
      authRequired = false;
      authRequiredReason = '';
      return { ok: true, hasToken: true, via: result.via || 'auto_login', alreadyLoggedIn: result.alreadyLoggedIn };
    }
    if (result.ok && !latestToken) {
      // 로그인은 됐는데 JWT 미캡처 → 대시보드 재진입
      await page.goto(`${ORIGIN}/page/rider-performance`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
      await scanPageForToken(page).catch(() => {});
      await persistToken('auto_login_rescan').catch(() => {});
      if (latestToken) {
        authRequired = false;
        authRequiredReason = '';
        return { ok: true, hasToken: true, via: 'auto_login_rescan' };
      }
    }
    authRequiredReason = result.message || '쿠팡 자동로그인 실패';
    return { ok: false, message: authRequiredReason, error: result.error };
  } catch (error) {
    authRequiredReason = error?.message || String(error);
    return { ok: false, message: authRequiredReason };
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
  if (!context) return null;
  const pages = context.pages();
  return pages[0] || (await context.newPage().catch(() => null));
}

async function keepAliveDuringWait(ms) {
  const started = Date.now();
  // 대기 구간당 keep-alive 최대 1회. 토큰 없음/오류/5회차마다만 페이지 터치.
  if (!statusLoop.active || statusLoop.stopping) return;
  const needHop = !latestToken || Boolean(statusLoop.lastError) || (statusLoop.round > 0 && statusLoop.round % 5 === 0);
  const url = KEEP_ALIVE_PAGES[statusLoop.round % KEEP_ALIVE_PAGES.length];
  const label = url.includes('rider-performance') ? '라이더퍼포먼스' : '피크대시보드';
  statusLoop.phase = 'waiting';
  statusLoop.message = needHop
    ? `세션 유지 · ${label} 1회 확인 후 대기 (${Math.ceil(ms / 1000)}초)`
    : `다음 회차 대기 · 토큰 유지 중 (${Math.ceil(ms / 1000)}초)`;
  statusLoop.updatedAt = nowKstIsoOffset();

  if (needHop) {
    try {
      const page = await getActivePage();
      if (page) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await scanPageForToken(page).catch(() => {});
        await persistToken('keepalive').catch(() => {});
      }
    } catch (e) {
      statusLoop.lastError = e && e.message ? e.message : String(e);
    }
  } else {
    // 가벼운 토큰 재저장만 (페이지 이동 없음)
    await persistToken('keepalive-light').catch(() => {});
  }

  const remaining = ms - (Date.now() - started);
  if (remaining > 500 && statusLoop.active && !statusLoop.stopping) {
    await waitLoop(remaining);
  }
}

async function runStatusAutoLoopInner() {
  while (statusLoop.active && !statusLoop.stopping) {
    if (!latestToken) {
      statusLoop.phase = 'waiting';
      statusLoop.message = '토큰 없음 — 네이버 OTP 자동 복구 시도…';
      statusLoop.updatedAt = nowKstIsoOffset();
      const recovered = await tryRecoverCoupangAuthWithNaverOtp();
      if (!recovered.ok || !latestToken) {
        statusLoop.lastError = recovered.message || '쿠팡 인증 복구 실패';
        await keepAliveDuringWait(STATUS_LOOP_WAIT_MS);
        continue;
      }
    }
    statusLoop.round += 1;
    const first = statusLoop.round === 1;
    statusLoop.phase = 'collecting';
    // 자동순회: 매 회차 라이더 퍼포먼스(rider_daily) 포함 — 기여도(0.8/1 단위 콜) 연속 반영
    statusLoop.message = first
      ? '첫 회차: 대시보드 + 라이더 퍼포먼스(정산주 전체) 수집 중…'
      : `대시보드 + 라이더 퍼포먼스(오늘) 수집 중… (${statusLoop.round}회차)`;
    statusLoop.updatedAt = nowKstIsoOffset();
    try {
      // 1회차: 정산주 수~오늘 전체 / 2회차+: 주간 생략·오늘은 라이더까지 계속
      const result = first
        ? await runCollect({ fullWeek: true, includeRider: true })
        : await runCollect({ skipWeekly: true, includeRider: true });
      statusLoop.lastSummary = result && result.summary ? result.summary : null;
      statusLoop.lastError = '';
      if (result && result.status === 401) {
        latestToken = '';
        authRequired = true;
      } else if (first && result?.ok) {
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
    } catch (e) {
      statusLoop.lastError = e && e.message ? e.message : String(e);
      if (/401|unauthorized|login|토큰/i.test(statusLoop.lastError)) {
        latestToken = '';
        authRequired = true;
      }
    }
    if (!statusLoop.active || statusLoop.stopping) break;
    statusLoop.phase = 'waiting';
    statusLoop.waitEndsAt = Date.now() + STATUS_LOOP_WAIT_MS;
    statusLoop.message = `다음 회차 대기 · 세션 유지 + 라이더 연속수집 (${statusLoop.round}회차 완료)`;
    statusLoop.updatedAt = nowKstIsoOffset();
    await keepAliveDuringWait(STATUS_LOOP_WAIT_MS);
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
  // 토큰 없어도 루프 시작 → 내부에서 자동로그인/OTP 복구
  statusLoop.active = true;
  statusLoop.stopping = false;
  statusLoop.round = 0;
  statusLoop.startedAt = nowKstIsoOffset();
  statusLoop.updatedAt = statusLoop.startedAt;
  statusLoop.lastError = '';
  statusLoop.message = latestToken
    ? '자동수집 시작…'
    : '토큰 없음 — 자동로그인 후 수집 시작…';
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
    if (!latestToken) {
      authRequired = true;
      if (!authRequiredReason) authRequiredReason = '쿠팡 로그인 토큰 없음 — 로그인 또는 네이버 OTP 복구 필요';
    } else {
      authRequired = false;
      authRequiredReason = '';
    }
    const authPayload = getAuthPayload();
    return sendJson(res, 200, {
      ok: true, port: PORT, browserOpen: Boolean(context),
      hasToken: Boolean(latestToken), tokenAgeSec, tokenExpiresAt: tokenExp,
      vendorCount: seenVendorIds.size, collecting,
      statusLoop: getStatusLoopPayload(),
      tokenSource: lastTokenSource || null,
      seenAnyAuthHeader,
      lastAuthSeenAgoSec: lastAuthSeenAt ? Math.round((Date.now() - lastAuthSeenAt) / 1000) : null,
      apiSamples: [...seenApiPaths].slice(0, 60),
      weekStart: thisWeekStartDateKst(),
      ...authPayload
    });
  }

  if (u.pathname === '/auth/recover' && req.method === 'POST') {
    const result = await tryRecoverCoupangAuthWithNaverOtp();
    return sendJson(res, result.ok ? 200 : 400, { ...result, ...getAuthPayload(), hasToken: Boolean(latestToken) });
  }

  if (u.pathname === '/naver/open' && req.method === 'POST') {
    try {
      const naverOtp = require('../server/coupang-naver-otp');
      const result = await naverOtp.openNaverMailForLogin();
      return sendJson(res, 200, result);
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
  console.log('[COUPANG] 기동 시 자동로그인(아이디/비번+.env) + 네이버 OTP 시도');
  console.log('[COUPANG] 수집: POST /collect  · 상태: GET /health  · 복구: POST /auth/recover');
  console.log('========================================');
  try { await ensureBrowser(); } catch (e) { console.error('[COUPANG] 브라우저 실행 실패:', e.message); }

  // 기동 직후: 토큰 없으면 자동로그인
  try {
    const creds = require('../server/coupang-auto-login').getCoupangCredentials();
    if (!latestToken) {
      if (creds.configured) {
        console.log('[COUPANG] 토큰 없음 — 자동로그인 시작…');
        const recovered = await tryRecoverCoupangAuthWithNaverOtp();
        console.log(recovered.ok
          ? `[COUPANG] 자동로그인 성공 (${recovered.via || 'auto'})`
          : `[COUPANG] 자동로그인 실패: ${recovered.message}`);
      } else {
        console.warn('[COUPANG] COUPANG_LOGIN_ID / COUPANG_LOGIN_PASSWORD 미설정 — 수동 로그인 필요');
      }
    } else {
      console.log('[COUPANG] 기존 토큰 유지 중');
    }
  } catch (e) {
    console.error('[COUPANG] 자동로그인 오류:', e.message || e);
  }

  // 수동 로그인 후에도(자동순회 미실행) 토큰이 잡히도록 20초마다 활성 페이지 스토리지 스캔.
  setInterval(async () => {
    try {
      if (!context) return;
      if (latestToken && Date.now() - latestTokenAt < 60 * 1000) return;
      const page = context.pages()[0];
      if (page) await scanPageForToken(page).catch(() => {});
      // 토큰 없고 자격증명 있으면 3분마다 자동로그인 재시도
      if (!latestToken && !authRecovering && require('../server/coupang-auto-login').getCoupangCredentials().configured) {
        if (Date.now() - lastAutoLoginAttemptAt > 3 * 60 * 1000) {
          void tryRecoverCoupangAuthWithNaverOtp().catch(() => {});
        }
      }
    } catch { /* ignore */ }
  }, 20 * 1000);

  if (AUTO_RESUME_STATUS_LOOP) {
    console.log('[COUPANG] COUPANG_AUTO_RESUME_STATUS_LOOP=1 — 자동순회를 이어서 시작합니다.');
    setTimeout(() => {
      const started = startStatusAutoLoop();
      if (!started.ok) console.warn('[COUPANG] 자동 재개 보류:', started.message);
    }, 12000);
  }
});
