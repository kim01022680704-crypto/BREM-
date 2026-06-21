#!/usr/bin/env node
/**
 * BREM 기사앱 ↔ ERP 연동 점검 스크립트
 *
 * 사용법 (로컬 서버 실행 중):
 *   node scripts/test-rider-integration.js --base http://localhost:3000 --login 아이디 --password 비밀번호
 *
 * 운영:
 *   node scripts/test-rider-integration.js --base https://brem.kr --login ... --password ...
 */

const args = process.argv.slice(2);

function readArg(name, fallback = '') {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return String(args[index + 1] || '').trim();
}

const base = readArg('--base', 'http://localhost:3000').replace(/\/$/, '');
const login = readArg('--login');
const password = readArg('--password');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(label, detail = '') {
  console.log(`OK  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function main() {
  if (!login || !password) {
    fail(' --login 과 --password 가 필요합니다.');
    return;
  }

  console.log(`\nBREM rider integration test @ ${base}\n`);

  const signIn = await request('/api/rider/sign-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });

  if (!signIn.response.ok || !signIn.body.session?.access_token) {
    fail(`sign-in (${signIn.response.status}): ${signIn.body.error || 'unknown'}`);
    return;
  }
  pass('sign-in', signIn.body.riderId || '');

  const token = signIn.body.session.access_token;
  const auth = { Authorization: `Bearer ${token}` };

  const me = await request('/api/rider/me', { headers: auth });
  if (!me.response.ok) {
    fail(`/api/rider/me (${me.response.status}): ${me.body.error}`);
    return;
  }
  const rider = me.body.rider || {};
  pass('/api/rider/me', rider.name || rider.id);

  const missions = await request('/api/rider/missions', { headers: auth });
  if (!missions.response.ok) {
    fail(`/api/rider/missions (${missions.response.status}): ${missions.body.error}`);
  } else {
    const baemin = missions.body.missions?.baemin?.title || '(없음)';
    const coupang = missions.body.missions?.coupang?.title || '(없음)';
    pass('/api/rider/missions', `배민=${baemin}, 쿠팡=${coupang}`);
  }

  const dashboard = await request('/api/rider/dashboard', { headers: auth });
  if (!dashboard.response.ok) {
    fail(`/api/rider/dashboard (${dashboard.response.status}): ${dashboard.body.error}`);
    return;
  }

  const calls = dashboard.body.calls || [];
  const rejections = dashboard.body.rejections || [];
  const targets = dashboard.body.targets || [];
  const weeklyTargets = dashboard.body.weeklyTargets || [];
  const dashboardNotices = dashboard.body.notices || [];
  pass('/api/rider/dashboard', `calls=${calls.length}, rejections=${rejections.length}, targets=${targets.length}, weeklyTargets=${weeklyTargets.length}, notices=${dashboardNotices.length}`);

  const riderNotices = await request('/api/rider/notices', { headers: auth });
  if (!riderNotices.response.ok) {
    fail(`/api/rider/notices (${riderNotices.response.status}): ${riderNotices.body.error}`);
  } else {
    const count = (riderNotices.body.notices || []).length;
    pass('/api/rider/notices', `${count}건`);
    if (count !== dashboardNotices.length) {
      fail(`notice count mismatch dashboard=${dashboardNotices.length} rider=${count}`);
    }
    if (count > 0) {
      const sample = riderNotices.body.notices[0];
      pass('sample notice', sample.title || sample.id);
    } else {
      console.log('WARN notices=0 — ERP 공지사항 등록 후 다시 테스트하세요.');
    }
  }

  if (calls.length) {
    const sample = calls[0];
    pass('sample call', `${sample.date} ${sample.platform} ${sample.count}콜`);
  } else {
    console.log('WARN calls=0 — ERP 콜수입력 후 다시 테스트하세요.');
  }

  const missionBaemin = rider.selected_mission_id_baemin || rider.selected_mission_id || '';
  const missionCoupang = rider.selected_mission_id_coupang || rider.selected_mission_id || '';
  if (missionBaemin || missionCoupang) {
    pass('rider mission ids', `baemin=${missionBaemin || '-'}, coupang=${missionCoupang || '-'}`);
  } else {
    console.log('WARN rider mission ids empty — ERP 미션관리에서 배정 후 테스트하세요.');
  }

  if (rider.long_event_start_date) {
    pass('long event', `start=${rider.long_event_start_date}, item=${rider.long_event_item_id || rider.long_event_item || '-'}, platform=${rider.long_event_platform || 'coupang'}`);
  } else {
    console.log('WARN long event not configured on rider row.');
  }

  if (dashboard.body.longEvent) {
    const progress = dashboard.body.longEvent;
    pass('long event progress', `${progress.platform || '-'} ${progress.total}/${progress.target} (${progress.rate}%)`);
  } else {
    console.log('WARN dashboard.longEvent missing — deploy latest server.');
  }

  const testMonth = new Date().toISOString().slice(0, 7);
  const testWeek = (() => {
    const date = new Date();
    const day = date.getDay();
    const diff = (day - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return date.toISOString().slice(0, 10);
  })();
  const monthlyCount = 123;
  const weeklyCount = 45;

  const saveTargets = await request('/api/rider/targets', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      monthly: { month: testMonth, count: monthlyCount },
      weekly: { weekStart: testWeek, count: weeklyCount }
    })
  });

  if (!saveTargets.response.ok) {
    fail(`POST /api/rider/targets (${saveTargets.response.status}): ${saveTargets.body.error}`);
  } else {
    pass('POST /api/rider/targets', `month=${testMonth} ${monthlyCount}콜, week=${testWeek} ${weeklyCount}콜`);
  }

  const dashboardAfter = await request('/api/rider/dashboard', { headers: auth });
  if (!dashboardAfter.response.ok) {
    fail(`dashboard after targets (${dashboardAfter.response.status}): ${dashboardAfter.body.error}`);
  } else {
    const monthRow = (dashboardAfter.body.targets || []).find(row => String(row.month || '').startsWith(testMonth));
    const weekRow = (dashboardAfter.body.weeklyTargets || []).find(row => row.weekStart === testWeek);
    if (monthRow && Number(monthRow.count) === monthlyCount) {
      pass('monthly target persisted', `${testMonth} → ${monthRow.count}콜`);
    } else {
      fail(`monthly target not found after save (expected ${monthlyCount})`);
    }
    if (weekRow && Number(weekRow.count) === weeklyCount) {
      pass('weekly target persisted', `${testWeek} → ${weekRow.count}콜`);
    } else {
      fail(`weekly target not found after save (expected ${weeklyCount})`);
    }
  }

  console.log('\nDone.\n');
}

main().catch(error => {
  fail(error.message || String(error));
});
