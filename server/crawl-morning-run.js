/**
 * 출근 원버튼 오케스트레이터
 * 배민/쿠팡 로컬 세션서버 HTTP + ERP sync + 라이더 publish
 */
const http = require('http');
const { settlementWeekStart, todayKST, latestQueryableDate } = require('./baemin-settlement-week');
const { computeCrawlWeekRangeFromLatest } = require('./crawl-session-auth');
const { syncBaeminCallsAndRejections } = require('./baemin-erp-sync');
const { syncCoupangRejections } = require('./coupang-erp-sync');

const BAEMIN_PORT = Number(process.env.BAEMIN_SESSION_LOCAL_PORT || 3939);
const COUPANG_PORT = Number(process.env.COUPANG_SESSION_LOCAL_PORT || 3940);

function localGet(port, pathName, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      timeout: timeoutMs
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode, json: JSON.parse(text || '{}') });
        } catch (error) {
          reject(new Error(`Invalid JSON from :${port}${pathName}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout :${port}${pathName}`));
    });
    req.on('error', reject);
  });
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

async function waitBaeminBootstrap(timeoutMs = 25 * 60 * 1000) {
  const started = Date.now();
  let last = null;
  let authWaitingLogged = false;
  while (Date.now() - started < timeoutMs) {
    const health = await localGet(BAEMIN_PORT, '/health', 5000).catch(error => ({ json: { error: error.message } }));
    last = health.json;
    const loop = last?.statusLoop || {};
    const authState = last?.session?.authState || last?.authState;
    // 휴대폰 인증은 사람이 한 번 해야 함 — 즉시 실패하지 말고 대기
    if (authState === 'authRequired' || authState === 'recovering') {
      if (!authWaitingLogged) {
        authWaitingLogged = true;
        console.log('[crawl-morning] 배민 로그인/휴대폰 인증 대기 중…');
      }
      await sleep(5000);
      continue;
    }
    const phase = String(loop.phase || '');
    // bootstrap 이후 round>=1 이고 waiting/rider_sync 이거나 2회차 collecting이면 1회차 완료
    if (Number(loop.round || 0) >= 1) {
      if (phase === 'waiting' || phase === 'rider_sync' || phase === 'idle') {
        return { ok: true, statusLoop: loop, health: last };
      }
      if (phase === 'collecting' && Number(loop.round) >= 2) {
        return { ok: true, statusLoop: loop, health: last };
      }
      if (/부트스트랩 완료|저장/.test(String(loop.message || '')) && phaseIsDone(phase)) {
        return { ok: true, statusLoop: loop, health: last };
      }
    }
    await sleep(5000);
  }
  const authState = last?.session?.authState || last?.authState;
  if (authState === 'authRequired') {
    return { ok: false, authRequired: true, message: '배민 로그인/휴대폰 인증 대기 시간 초과', health: last };
  }
  return { ok: false, message: '배민 1회차(bootstrap) 대기 시간 초과', health: last };
}

function phaseIsDone(phase) {
  return ['waiting', 'idle', 'rider_sync'].includes(String(phase || ''));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 쿠팡 자동순회 1회차(주단위)가 끝날 때까지 대기 */
async function waitCoupangFirstRound(timeoutMs = 25 * 60 * 1000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const health = await localGet(COUPANG_PORT, '/health', 5000).catch(error => ({ json: { error: error.message } }));
    last = health.json;
    const loop = last?.statusLoop || {};
    const authState = last?.authState;
    if (authState === 'authRequired' || authState === 'recovering') {
      await sleep(5000);
      continue;
    }
    if (!loop.active && Number(loop.round || 0) === 0) {
      await sleep(2000);
      continue;
    }
    const phase = String(loop.phase || '');
    const round = Number(loop.round || 0);
    if (round >= 1 && (phase === 'waiting' || phase === 'idle')) {
      return { ok: true, statusLoop: loop, health: last };
    }
    if (round >= 2) {
      return { ok: true, statusLoop: loop, health: last };
    }
    await sleep(3000);
  }
  return { ok: false, message: '쿠팡 1회차(주단위) 대기 시간 초과', health: last };
}

async function publishRiderView() {
  const riderPublish = require('./rider-publish-admin');
  return riderPublish.publishRiderViewWithServiceRole({
    publishedBy: 'morning-crawl'
  });
}

/**
 * @param {{ skipBaemin?: boolean, skipCoupang?: boolean, skipPublish?: boolean }} options
 */
async function runMorningCrawlPipeline(options = {}) {
  const steps = [];
  const push = (name, result) => {
    steps.push({ name, ...(result && typeof result === 'object' ? result : { result }) });
  };

  const today = todayKST();
  const latest = latestQueryableDate(today) || today;
  const weekRange = computeCrawlWeekRangeFromLatest(latest, settlementWeekStart);

  // 배민 부트스트랩 기다리는 동안 쿠팡이 "정지"로 보이지 않도록 병렬 진행
  const baeminTask = (async () => {
    if (options.skipBaemin) return;
    await localPost(BAEMIN_PORT, '/status-loop/stop', {}).catch(() => null);
    await sleep(800);
    const start = await localPost(BAEMIN_PORT, '/status-loop/start', {});
    if (!start.json?.ok && start.status >= 400) {
      push('baemin_loop_start', {
        ok: false,
        message: start.json?.message || '배민 자동수집 시작 실패',
        authState: start.json?.authState
      });
      throw new Error(start.json?.message || '배민 자동수집 시작 실패');
    }
    push('baemin_loop_start', { ok: true, statusLoop: start.json?.statusLoop });

    const boot = await waitBaeminBootstrap(options.baeminTimeoutMs || 25 * 60 * 1000);
    push('baemin_bootstrap', boot);
    if (!boot.ok) throw new Error(boot.message || '배민 부트스트랩 실패');

    const baeminSync = await syncBaeminCallsAndRejections({
      fromDate: weekRange.fromDate,
      toDate: weekRange.toDate,
      mode: 'all'
    });
    push('baemin_erp_sync', baeminSync);
    if (!baeminSync.ok) throw new Error(baeminSync.message || '배민 ERP 동기화 실패');
  })();

  const coupangTask = (async () => {
    if (options.skipCoupang) return;
    const health = await localGet(COUPANG_PORT, '/health', 5000).catch(() => ({ json: {} }));
    if (!health.json?.hasToken) {
      const recover = await localPost(COUPANG_PORT, '/auth/recover', {}, 180000);
      push('coupang_auth_recover', {
        ok: Boolean(recover.json?.ok),
        message: recover.json?.message,
        via: recover.json?.via
      });
      if (!recover.json?.ok) throw new Error(recover.json?.message || '쿠팡 인증 복구 실패');
    }

    // 자동순회 1회차가 곧 주단위 수집이다. 별도 /collect 를 또 돌리면
    // "이미 수집 중" 충돌로 순회가 빈 회차만 돌거나 멈춘 것처럼 보인다.
    await localPost(COUPANG_PORT, '/status-loop/stop', {}).catch(() => null);
    await sleep(500);
    const loop = await localPost(COUPANG_PORT, '/status-loop/start', {});
    push('coupang_loop_start', {
      ok: Boolean(loop.json?.ok) || Boolean(loop.json?.alreadyRunning),
      message: loop.json?.message,
      statusLoop: loop.json?.statusLoop
    });
    if (!loop.json?.ok && !loop.json?.alreadyRunning && loop.status >= 400) {
      throw new Error(loop.json?.message || '쿠팡 자동순회 시작 실패');
    }

    const first = await waitCoupangFirstRound(options.coupangTimeoutMs || 25 * 60 * 1000);
    push('coupang_first_round', first);
    if (!first.ok) throw new Error(first.message || '쿠팡 1회차 실패');

    const coupangSync = await syncCoupangRejections({
      weekStart: weekRange.fromDate,
      weekEnd: weekRange.toDate
    });
    push('coupang_erp_sync', coupangSync);
    if (!coupangSync.ok) throw new Error(coupangSync.message || '쿠팡 거절율 동기화 실패');

    const after = await localGet(COUPANG_PORT, '/health', 5000).catch(() => ({ json: {} }));
    if (!after.json?.statusLoop?.active) {
      const restart = await localPost(COUPANG_PORT, '/status-loop/start', {
        skipFirstFullWeek: true
      }).catch(() => null);
      push('coupang_loop_restart', {
        ok: Boolean(restart?.json?.ok) || Boolean(restart?.json?.alreadyRunning),
        statusLoop: restart?.json?.statusLoop
      });
    }
  })();

  const settled = await Promise.allSettled([baeminTask, coupangTask]);
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      const name = index === 0 ? 'baemin' : 'coupang';
      push(name, { ok: false, message: result.reason?.message || String(result.reason) });
    }
  });

  // 한쪽이 실패해도 성공한 쪽 ERP는 이미 저장된 상태 → 라이더앱은 둘 다 공개 시도
  // (미반영 행만 rider_published_at 찍음)
  const shouldPublish = options.publish !== false && options.skipPublish !== true;
  if (shouldPublish) {
    try {
      const pub = await publishRiderView();
      push('rider_publish', pub);
    } catch (error) {
      push('rider_publish', { ok: false, message: error.message || String(error) });
    }
  } else {
    push('rider_publish', {
      ok: true,
      skipped: true,
      message: '라이더앱 반영 생략 — 스케줄(07:00/11:30/14:00/22:00)에서 확인사살'
    });
  }

  const failed = steps.some(step => step.ok === false);
  return {
    ok: !failed,
    weekRange,
    steps,
    finishedAt: new Date().toISOString()
  };
}

module.exports = {
  runMorningCrawlPipeline,
  waitBaeminBootstrap,
  waitCoupangFirstRound,
  localGet,
  localPost,
  BAEMIN_PORT,
  COUPANG_PORT
};
