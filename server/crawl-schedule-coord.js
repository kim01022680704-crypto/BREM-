/**
 * 주단위 재수집 ↔ ERP 확인사살 충돌 방지용 공유 플래그
 * (배민/쿠팡 수집 속도가 달라도 확인사살이 수집 중간에 끼어들지 않게)
 */
let weeklyRefreshRunning = false;
let weeklyRefreshStartedAt = '';
let erpPublishRunning = false;

function setWeeklyRefreshRunning(on) {
  weeklyRefreshRunning = Boolean(on);
  weeklyRefreshStartedAt = on ? new Date().toISOString() : '';
}

function isWeeklyRefreshRunning() {
  return weeklyRefreshRunning;
}

function getWeeklyRefreshStartedAt() {
  return weeklyRefreshStartedAt;
}

function setErpPublishRunning(on) {
  erpPublishRunning = Boolean(on);
}

function isErpPublishRunning() {
  return erpPublishRunning;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 주단위 재수집이 끝날 때까지 대기 (타임아웃 시 확인사살 계속 진행)
 */
async function waitForWeeklyRefreshIdle(options = {}) {
  const timeoutMs = Number(options.timeoutMs || 45 * 60 * 1000);
  const pollMs = Number(options.pollMs || 5000);
  const log = typeof options.onLog === 'function' ? options.onLog : null;
  if (!weeklyRefreshRunning) {
    return { ok: true, waitedMs: 0, timedOut: false };
  }
  const started = Date.now();
  if (log) log('[ERP-PUBLISH] 주단위 재수집 진행 중 — 끝날 때까지 대기…');
  while (weeklyRefreshRunning) {
    if (Date.now() - started > timeoutMs) {
      if (log) log('[ERP-PUBLISH] 주단위 대기 시간 초과 — 확인사살 진행');
      return { ok: false, waitedMs: Date.now() - started, timedOut: true };
    }
    await sleep(pollMs);
  }
  return { ok: true, waitedMs: Date.now() - started, timedOut: false };
}

module.exports = {
  setWeeklyRefreshRunning,
  isWeeklyRefreshRunning,
  getWeeklyRefreshStartedAt,
  setErpPublishRunning,
  isErpPublishRunning,
  waitForWeeklyRefreshIdle
};
