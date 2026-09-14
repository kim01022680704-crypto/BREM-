#!/usr/bin/env node
/**
 * 이글스 예전 DP 6곳 · 저번주(수~화) 라이더별 배달내역 1회 수집
 * Usage:
 *   node scripts/collect-eagles-rider-week.js
 *   node scripts/collect-eagles-rider-week.js 2026-08-26
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const EAGLES_DPS = [
  { partnerId: 'DP2607289309', label: '남A' },
  { partnerId: 'DP2607213175', label: '동A' },
  { partnerId: 'DP2608183325', label: '북필드A' },
  { partnerId: 'DP2607217024', label: '북필드B' },
  { partnerId: 'DP2607212158', label: '울주A' },
  { partnerId: 'DP2607285101', label: '중필드B' }
];

function weekRangeFromWednesday(weekStart) {
  const start = String(weekStart || '').slice(0, 10);
  const date = new Date(`${start}T00:00:00`);
  const end = new Date(date);
  end.setDate(end.getDate() + 6);
  const y = end.getFullYear();
  const m = String(end.getMonth() + 1).padStart(2, '0');
  const d = String(end.getDate()).padStart(2, '0');
  return { fromDate: start, toDate: `${y}-${m}-${d}` };
}

async function main() {
  const weekStart = String(process.argv[2] || '2026-08-26').slice(0, 10);
  const { fromDate, toDate } = weekRangeFromWednesday(weekStart);
  const partnerIds = EAGLES_DPS.map(x => x.partnerId);

  console.log('[EAGLES] week', fromDate, '~', toDate);
  console.log('[EAGLES] DPs', partnerIds.join(', '));

  const health = await fetch('http://127.0.0.1:3939/health').then(r => r.json()).catch(e => ({ ok: false, message: e.message }));
  if (!health?.ok) {
    console.error('[EAGLES] 로컬 세션 서버(3939)가 없습니다. npm run baemin:session-server 후 로그인하세요.');
    process.exit(1);
  }
  console.log('[EAGLES] server', health.version, 'loggedIn=', health.browser?.sessionLoggedIn);

  if (!health.browser?.sessionLoggedIn) {
    console.error('[EAGLES] 배민 로그인 필요 — ERP에서 브라우저 열고 로그인하세요.');
    process.exit(1);
  }

  const body = {
    collectDate: toDate,
    sourceMenus: ['rider_history'],
    riderFromDate: fromDate,
    riderToDate: toDate,
    partnerIds,
    source: 'eagles_week_backfill'
  };
  console.log('[EAGLES] POST /collect/rider ... (수 분 소요)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45 * 60 * 1000);
  let result;
  try {
    const res = await fetch('http://127.0.0.1:3939/collect/rider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    result = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
    result.status = res.status;
  } catch (error) {
    result = { ok: false, message: error.message };
  } finally {
    clearTimeout(timer);
  }

  console.log(JSON.stringify({
    ok: result.ok,
    status: result.status,
    message: result.message,
    savedCount: result.savedCount,
    partnerSummaries: result.partnerSummaries || result.results
      ? Object.keys(result.results || {}).slice(0, 20)
      : []
  }, null, 2));

  if (result.results) {
    Object.entries(result.results).forEach(([key, row]) => {
      console.log(`  ${key}: ok=${row.ok} saved=${row.savedCount || 0} ${row.message || ''}`);
    });
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
