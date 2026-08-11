/**
 * 라이더앱 반영(ERP publish) 30분 전 주단위 재수집
 * - 배민: 배달현황 + 일별 + 라이더별(하루씩) 정산주 범위
 * - 쿠팡: fullWeek + 라이더
 * - ERP 콜수/거절율 동기화까지 (라이더앱 반영은 기존 4회 스케줄)
 *
 * 기본 슬롯 = CRAWL_ERP_PUBLISH_SLOTS − 30분
 *   → 06:30 / 11:00 / 13:30 / 21:30 (KST)
 */
const http = require('http');
const { settlementWeekStart, todayKST, latestQueryableDate } = require('./baemin-settlement-week');
const { computeCrawlWeekRangeFromLatest } = require('./crawl-session-auth');
const { syncBaeminCallsAndRejections } = require('./baemin-erp-sync');
const { syncCoupangRejections } = require('./coupang-erp-sync');

const BAEMIN_PORT = Number(process.env.BAEMIN_SESSION_LOCAL_PORT || 3939);
const COUPANG_PORT = Number(process.env.COUPANG_SESSION_LOCAL_PORT || 3940);
const DEFAULT_PUBLISH_SLOTS = Object.freeze(['07:00', '11:30', '14:00', '22:00']);
const DEFAULT_OFFSET_MIN = 30;

function getPublishSlots() {
  const raw = String(process.env.CRAWL_ERP_PUBLISH_SLOTS || '').trim();
  if (!raw) return [...DEFAULT_PUBLISH_SLOTS];
  return raw.split(/[,;\s]+/).map(s => s.trim()).filter(s => /^\d{1,2}:\d{2}$/.test(s));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function subtractMinutesHm(hm, mins) {
  const parts = String(hm || '').split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  let total = h * 60 + m - Number(mins || 0);
  while (total < 0) total += 24 * 60;
  total %= 24 * 60;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

function getSlots() {
  const raw = String(process.env.CRAWL_WEEKLY_REFRESH_SLOTS || '').trim();
  if (raw) {
    return raw.split(/[,;\s]+/).map(s => s.trim()).filter(s => /^\d{1,2}:\d{2}$/.test(s));
  }
  const offset = Number(process.env.CRAWL_WEEKLY_REFRESH_OFFSET_MIN || DEFAULT_OFFSET_MIN);
  const mins = Number.isFinite(offset) && offset >= 0 ? offset : DEFAULT_OFFSET_MIN;
  return getPublishSlots()
    .map(slot => subtractMinutesHm(slot, mins))
    .filter(Boolean);
}

function nowKst() {
  return new Date(Date.now() + 9 * 3600 * 1000);
}

function kstDateKey(d = nowKst()) {
  return d.toISOString().slice(0, 10);
}

function kstHm(d = nowKst()) {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function matchCurrentSlot(slots = getSlots(), d = nowKst()) {
  const hm = kstHm(d);
  return slots.includes(hm) ? hm : '';
}

function nextSlotInfo(slots = getSlots(), d = nowKst()) {
  const list = [...slots].sort();
  const hm = kstHm(d);
  const today = kstDateKey(d);
  for (const slot of list) {
    if (slot > hm) return { date: today, slot, at: `${today}T${slot}:00+09:00` };
  }
  const tomorrow = new Date(d.getTime() + 24 * 3600 * 1000);
  const nextDate = kstDateKey(tomorrow);
  const slot = list[0] || '06:30';
  return { date: nextDate, slot, at: `${nextDate}T${slot}:00+09:00` };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function localPost(port, pathName, body = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body || {});
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = {};
        try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout :${port}${pathName}`));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * @param {{
 *   runBaeminWeekCollect?: Function,
 *   skipBaemin?: boolean,
 *   skipCoupang?: boolean,
 *   slot?: string,
 *   onLog?: Function
 * }} options
 */
async function runWeeklyRefreshPipeline(options = {}) {
  const log = typeof options.onLog === 'function' ? options.onLog : console.log;
  const steps = [];
  const push = (name, result) => {
    steps.push({ name, ...(result && typeof result === 'object' ? result : { result }) });
  };

  const today = todayKST();
  const latest = latestQueryableDate(today) || today;
  const weekRange = computeCrawlWeekRangeFromLatest(latest, settlementWeekStart);

  // 1) Baemin week collect (prefer in-process hook from session server)
  if (!options.skipBaemin) {
    try {
      if (typeof options.runBaeminWeekCollect === 'function') {
        const baemin = await options.runBaeminWeekCollect({ weekRange });
        push('baemin_week_collect', baemin);
      } else {
        const collect = await localPost(BAEMIN_PORT, '/weekly-refresh/run-baemin', {
          fromDate: weekRange.fromDate,
          toDate: weekRange.toDate
        }, 40 * 60 * 1000);
        push('baemin_week_collect', {
          ok: Boolean(collect.json?.ok),
          status: collect.status,
          message: collect.json?.message,
          ...(collect.json || {})
        });
      }
    } catch (error) {
      push('baemin_week_collect', { ok: false, message: error.message || String(error) });
    }
  }

  // 2) Coupang full-week
  if (!options.skipCoupang) {
    try {
      const health = await new Promise((resolve) => {
        http.get({ hostname: '127.0.0.1', port: COUPANG_PORT, path: '/health', timeout: 5000 }, res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
            catch { resolve({}); }
          });
        }).on('error', () => resolve({}));
      });

      if (!health.hasToken) {
        const recover = await localPost(COUPANG_PORT, '/auth/recover', {}, 180000);
        push('coupang_auth_recover', {
          ok: Boolean(recover.json?.ok),
          message: recover.json?.message
        });
      }

      // 자동순회와 충돌 피하려고 잠시 중지 → 주단위 → 재개(부트스트랩 생략은 쿠팡 1회차가 다시 주단위를 돌 수 있음)
      await localPost(COUPANG_PORT, '/status-loop/stop', {}).catch(() => null);
      await sleep(800);

      const collect = await localPost(COUPANG_PORT, '/collect', {
        weekStartDate: weekRange.fromDate,
        fullWeek: true,
        includeRider: true
      }, 25 * 60 * 1000);
      push('coupang_week_collect', {
        ok: Boolean(collect.json?.ok),
        status: collect.status,
        message: collect.json?.message || collect.json?.error,
        summary: collect.json?.summary || null
      });

      if (collect.json?.ok) {
        const sync = await syncCoupangRejections({
          weekStart: weekRange.fromDate,
          weekEnd: weekRange.toDate
        });
        push('coupang_erp_sync', sync);
      }

      await localPost(COUPANG_PORT, '/status-loop/start', {}).catch(() => null);
    } catch (error) {
      push('coupang_week_collect', { ok: false, message: error.message || String(error) });
    }
  }

  // 3) Baemin ERP sync (콜수/거절) — 반영은 30분 뒤 publish 스케줄
  if (!options.skipBaemin) {
    try {
      const baeminSync = await syncBaeminCallsAndRejections({
        fromDate: weekRange.fromDate,
        toDate: weekRange.toDate,
        mode: 'all'
      });
      push('baemin_erp_sync', baeminSync);
    } catch (error) {
      push('baemin_erp_sync', { ok: false, message: error.message || String(error) });
    }
  }

  const failed = steps.some(step => step.ok === false);
  log(`[WEEKLY-REFRESH] 완료 ${failed ? 'PARTIAL/FAIL' : 'OK'} · ${weekRange.label || ''} · slot=${options.slot || ''}`);
  return {
    ok: !failed,
    weekRange,
    steps,
    slot: options.slot || '',
    finishedAt: new Date().toISOString()
  };
}

function startWeeklyRefreshScheduler(options = {}) {
  const slots = getSlots();
  const enabled = String(process.env.CRAWL_WEEKLY_REFRESH_SCHEDULE || '1').trim() !== '0';
  let lastSlotKey = '';
  let running = false;
  let lastResult = null;
  const log = typeof options.onLog === 'function' ? options.onLog : console.log;

  if (!enabled) {
    log('[WEEKLY-REFRESH] 스케줄 비활성 (CRAWL_WEEKLY_REFRESH_SCHEDULE=0)');
    return {
      getStatus: () => ({ enabled: false, slots, lastSlotKey: '', lastResult: null, next: null })
    };
  }

  log(`[WEEKLY-REFRESH] 스케줄 시작 — KST ${slots.join(', ')} (라이더반영 30분 전 주단위·라이더별)`);

  const timer = setInterval(async () => {
    const slot = matchCurrentSlot(slots);
    if (!slot || running) return;
    const key = `${kstDateKey()}:${slot}`;
    if (key === lastSlotKey) return;
    lastSlotKey = key;
    running = true;
    log(`[WEEKLY-REFRESH] ▶ ${key} 주단위 재수집 시작 (배민 일별/라이더별 + 쿠팡 fullWeek)`);
    try {
      lastResult = await runWeeklyRefreshPipeline({
        slot,
        onLog: log,
        runBaeminWeekCollect: options.runBaeminWeekCollect
      });
      const okLabel = lastResult.ok ? 'OK' : 'PARTIAL/FAIL';
      log(`[WEEKLY-REFRESH] ■ ${key} 완료 ${okLabel} · ${lastResult.weekRange?.label || ''}`);
      if (typeof options.onDone === 'function') options.onDone(lastResult);
    } catch (error) {
      lastResult = { ok: false, message: error?.message || String(error), slot };
      log(`[WEEKLY-REFRESH] ■ ${key} 오류:`, lastResult.message);
    } finally {
      running = false;
    }
  }, 20 * 1000);

  if (typeof timer.unref === 'function') timer.unref();

  return {
    getStatus: () => ({
      enabled: true,
      slots,
      offsetMin: Number(process.env.CRAWL_WEEKLY_REFRESH_OFFSET_MIN || DEFAULT_OFFSET_MIN),
      publishSlots: getPublishSlots(),
      running,
      lastSlotKey,
      lastResult,
      next: nextSlotInfo(slots)
    }),
    runNow: () => runWeeklyRefreshPipeline({
      slot: 'manual',
      onLog: log,
      runBaeminWeekCollect: options.runBaeminWeekCollect
    })
  };
}

module.exports = {
  DEFAULT_OFFSET_MIN,
  getSlots,
  getPublishSlots,
  matchCurrentSlot,
  nextSlotInfo,
  subtractMinutesHm,
  runWeeklyRefreshPipeline,
  startWeeklyRefreshScheduler
};
