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

async function publishRiderView() {
  try {
    const riderPublish = require('./rider-publish-admin');
    // accessToken 없이 service role 경로가 없으면 내부 publishTable만 직접
    if (typeof riderPublish.publishRiderViewWithServiceRole === 'function') {
      return riderPublish.publishRiderViewWithServiceRole();
    }
  } catch {
    // fall through
  }
  const { getServiceClient } = require('./admin-bootstrap');
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, message: 'publish: no supabase' };
  const now = new Date().toISOString();
  const [calls, rejections] = await Promise.all([
    supabase.from('admin_calls').update({ rider_published_at: now, updated_at: now }).is('rider_published_at', null).select('id'),
    supabase.from('admin_rejection_rates').update({ rider_published_at: now, updated_at: now }).is('rider_published_at', null).select('id')
  ]);
  return {
    ok: true,
    callsPublished: Array.isArray(calls.data) ? calls.data.length : 0,
    rejectionsPublished: Array.isArray(rejections.data) ? rejections.data.length : 0,
    publishedAt: now
  };
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

  // 1) Baemin status-loop restart for bootstrap
  if (!options.skipBaemin) {
    try {
      await localPost(BAEMIN_PORT, '/status-loop/stop', {}).catch(() => null);
      await sleep(800);
      const start = await localPost(BAEMIN_PORT, '/status-loop/start', {});
      if (!start.json?.ok && start.status >= 400) {
        push('baemin_loop_start', { ok: false, message: start.json?.message || '배민 자동수집 시작 실패', authState: start.json?.authState });
        return { ok: false, weekRange, steps };
      }
      push('baemin_loop_start', { ok: true, statusLoop: start.json?.statusLoop });

      const boot = await waitBaeminBootstrap(options.baeminTimeoutMs || 25 * 60 * 1000);
      push('baemin_bootstrap', boot);
      if (!boot.ok) return { ok: false, weekRange, steps };

      const baeminSync = await syncBaeminCallsAndRejections({
        fromDate: weekRange.fromDate,
        toDate: weekRange.toDate,
        mode: 'all'
      });
      push('baemin_erp_sync', baeminSync);
      if (!baeminSync.ok) return { ok: false, weekRange, steps };
    } catch (error) {
      push('baemin', { ok: false, message: error.message || String(error) });
      return { ok: false, weekRange, steps };
    }
  }

  // 2) Coupang full week collect + rejection sync + start loop
  if (!options.skipCoupang) {
    try {
      // 토큰 없으면 자동로그인(+네이버 OTP) 먼저
      const health = await localGet(COUPANG_PORT, '/health', 5000).catch(() => ({ json: {} }));
      if (!health.json?.hasToken) {
        const recover = await localPost(COUPANG_PORT, '/auth/recover', {}, 180000);
        push('coupang_auth_recover', {
          ok: Boolean(recover.json?.ok),
          message: recover.json?.message,
          via: recover.json?.via
        });
        if (!recover.json?.ok) {
          return { ok: false, weekRange, steps };
        }
      }

      const collect = await localPost(COUPANG_PORT, '/collect', {
        weekStartDate: weekRange.fromDate,
        fullWeek: true,
        includeRider: true
      }, 20 * 60 * 1000);
      push('coupang_collect', {
        ok: Boolean(collect.json?.ok),
        status: collect.status,
        message: collect.json?.message || collect.json?.error,
        summary: collect.json?.summary || null,
        authState: collect.json?.authState
      });
      if (!collect.json?.ok) {
        return { ok: false, weekRange, steps };
      }

      const coupangSync = await syncCoupangRejections({
        weekStart: weekRange.fromDate,
        weekEnd: weekRange.toDate
      });
      push('coupang_erp_sync', coupangSync);
      if (!coupangSync.ok) return { ok: false, weekRange, steps };

      await localPost(COUPANG_PORT, '/status-loop/stop', {}).catch(() => null);
      await sleep(500);
      const loop = await localPost(COUPANG_PORT, '/status-loop/start', {});
      push('coupang_loop_start', {
        ok: Boolean(loop.json?.ok),
        message: loop.json?.message,
        statusLoop: loop.json?.statusLoop
      });
    } catch (error) {
      push('coupang', { ok: false, message: error.message || String(error) });
      return { ok: false, weekRange, steps };
    }
  }

  // 3) Rider publish — 기본은 스케줄(07:00/11:30/14:00/22:00)에서만 수행
  //    원버튼에서 즉시 반영하려면 { publish: true }
  const shouldPublish = options.publish === true || options.skipPublish === false;
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
      message: '스케줄 반영(07:00/11:30/14:00/22:00)으로 예약 — 원버튼에서는 생략'
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
  localGet,
  localPost,
  BAEMIN_PORT,
  COUPANG_PORT
};
