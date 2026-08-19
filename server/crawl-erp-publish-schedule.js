/**
 * 크롤링(수집)과 분리된 ERP 확인사살 스케줄
 * - 콜수입력(배민) + 거절율입력(배민/쿠팡) + 라이더 앱 반영
 * - KST 07:00 / 11:30 / 14:00 / 22:00 (하루 4회)
 */
const { settlementWeekStart, todayKST, latestQueryableDate } = require('./baemin-settlement-week');
const { computeCrawlWeekRangeFromLatest } = require('./crawl-session-auth');
const { syncBaeminCallsAndRejections } = require('./baemin-erp-sync');
const { syncCoupangRejections } = require('./coupang-erp-sync');
const {
  setErpPublishRunning,
  waitForWeeklyRefreshIdle
} = require('./crawl-schedule-coord');

const DEFAULT_SLOTS = Object.freeze(['07:00', '11:30', '14:00', '22:00']);

function getSlots() {
  const raw = String(process.env.CRAWL_ERP_PUBLISH_SLOTS || '').trim();
  if (!raw) return [...DEFAULT_SLOTS];
  return raw.split(/[,;\s]+/).map(s => s.trim()).filter(s => /^\d{1,2}:\d{2}$/.test(s));
}

function nowKst() {
  return new Date(Date.now() + 9 * 3600 * 1000);
}

function kstDateKey(d = nowKst()) {
  return d.toISOString().slice(0, 10);
}

function kstHm(d = nowKst()) {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
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
  // 내일 첫 슬롯
  const tomorrow = new Date(d.getTime() + 24 * 3600 * 1000);
  const nextDate = kstDateKey(tomorrow);
  const slot = list[0] || '07:00';
  return { date: nextDate, slot, at: `${nextDate}T${slot}:00+09:00` };
}

async function publishRiderView() {
  const riderPublish = require('./rider-publish-admin');
  return riderPublish.publishRiderViewWithServiceRole({
    publishedBy: 'erp-publish-schedule'
  });
}

/**
 * 콜수/거절율 동기화 + 라이더 앱 반영 (수집은 하지 않음)
 * 배민·쿠팡 ERP는 순차 반영 후, 라이더앱은 한 번만 공개 (한쪽만 반영되는 일 방지)
 */
async function runErpAndPublishPipeline(options = {}) {
  const steps = [];
  const push = (name, result) => {
    steps.push({ name, ...(result && typeof result === 'object' ? result : { result }) });
  };

  setErpPublishRunning(true);
  try {
    const wait = await waitForWeeklyRefreshIdle({
      timeoutMs: options.waitWeeklyTimeoutMs || 45 * 60 * 1000,
      onLog: options.onLog
    });
    if (wait.waitedMs > 0) {
      push('wait_weekly_refresh', wait);
    }

    const today = todayKST();
    const latest = latestQueryableDate(today) || today;
    const weekRange = computeCrawlWeekRangeFromLatest(latest, settlementWeekStart);

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

    if (!options.skipCoupang) {
      try {
        const coupangSync = await syncCoupangRejections({
          weekStart: weekRange.weekStart || weekRange.fromDate
        });
        push('coupang_erp_sync', coupangSync);
      } catch (error) {
        push('coupang_erp_sync', { ok: false, message: error.message || String(error) });
      }
    }

    if (!options.skipPublish) {
      try {
        const pub = await publishRiderView();
        push('rider_publish', pub);
      } catch (error) {
        push('rider_publish', { ok: false, message: error.message || String(error) });
      }
    }

    const failed = steps.some(step => step.ok === false && step.name !== 'wait_weekly_refresh');
    return {
      ok: !failed,
      weekRange,
      steps,
      slot: options.slot || '',
      finishedAt: new Date().toISOString()
    };
  } finally {
    setErpPublishRunning(false);
  }
}

function startErpPublishScheduler(options = {}) {
  const slots = getSlots();
  const enabled = String(process.env.CRAWL_ERP_PUBLISH_SCHEDULE || '1').trim() !== '0';
  let lastSlotKey = '';
  let running = false;
  let lastResult = null;
  const log = typeof options.onLog === 'function' ? options.onLog : console.log;

  if (!enabled) {
    log('[ERP-PUBLISH] 스케줄 비활성 (CRAWL_ERP_PUBLISH_SCHEDULE=0)');
    return {
      getStatus: () => ({ enabled: false, slots, lastSlotKey: '', lastResult: null, next: null })
    };
  }

  log(`[ERP-PUBLISH] 스케줄 시작 — KST ${slots.join(', ')} (콜수/거절율/라이더반영)`);

  const timer = setInterval(async () => {
    const slot = matchCurrentSlot(slots);
    if (!slot || running) return;
    const key = `${kstDateKey()}:${slot}`;
    if (key === lastSlotKey) return;
    lastSlotKey = key;
    running = true;
    log(`[ERP-PUBLISH] ▶ ${key} 확인사살 시작 (콜수·거절율/라이더반영 · 주단위 끝나면)`);
    try {
      lastResult = await runErpAndPublishPipeline({ slot, onLog: log });
      const okLabel = lastResult.ok ? 'OK' : 'PARTIAL/FAIL';
      log(`[ERP-PUBLISH] ■ ${key} 완료 ${okLabel} · ${lastResult.weekRange?.label || ''}`);
      if (typeof options.onDone === 'function') options.onDone(lastResult);
    } catch (error) {
      lastResult = { ok: false, message: error?.message || String(error), slot };
      log(`[ERP-PUBLISH] ■ ${key} 오류:`, lastResult.message);
    } finally {
      running = false;
    }
  }, 20 * 1000);

  if (typeof timer.unref === 'function') timer.unref();

  return {
    getStatus: () => ({
      enabled: true,
      slots,
      running,
      lastSlotKey,
      lastResult,
      next: nextSlotInfo(slots)
    }),
    runNow: () => runErpAndPublishPipeline({ slot: 'manual' })
  };
}

module.exports = {
  DEFAULT_SLOTS,
  getSlots,
  matchCurrentSlot,
  nextSlotInfo,
  runErpAndPublishPipeline,
  startErpPublishScheduler,
  publishRiderView
};
