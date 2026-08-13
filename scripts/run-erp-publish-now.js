/**
 * 배민/쿠팡 ERP 콜수·거절율 동기화 + 라이더반영 (로컬에서 즉시 실행)
 * 기준: 배민 총배달완료(allDayComplete)
 *
 *   node scripts/run-erp-publish-now.js
 *   node scripts/run-erp-publish-now.js 2026-08-05 2026-08-13
 */
require('dotenv').config();
const { syncBaeminCallsAndRejections } = require('../server/baemin-erp-sync');
const { syncCoupangRejections } = require('../server/coupang-erp-sync');
const { getServiceClient } = require('../server/admin-bootstrap');
const {
  todayKST,
  latestQueryableDate,
  settlementWeekStart,
  settlementWeekEnd
} = require('../server/baemin-settlement-week');

async function forcePublishCalls(fromDate, toDate) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, message: 'no supabase' };
  const now = new Date().toISOString();
  const [calls, rejections] = await Promise.all([
    supabase
      .from('admin_calls')
      .update({ rider_published_at: now, updated_at: now })
      .gte('date', fromDate)
      .lte('date', toDate)
      .select('id'),
    supabase
      .from('admin_rejection_rates')
      .update({ rider_published_at: now, updated_at: now })
      .gte('week_start', settlementWeekStart(fromDate))
      .lte('week_start', settlementWeekStart(toDate))
      .select('id')
  ]);
  return {
    ok: true,
    callsPublished: Array.isArray(calls.data) ? calls.data.length : 0,
    rejectionsPublished: Array.isArray(rejections.data) ? rejections.data.length : 0,
    callsError: calls.error?.message || '',
    rejectionsError: rejections.error?.message || '',
    publishedAt: now
  };
}

async function syncOneRange(fromDate, toDate) {
  console.log(`\n=== ERP sync ${fromDate} ~ ${toDate} ===`);
  const baemin = await syncBaeminCallsAndRejections({
    fromDate,
    toDate,
    mode: 'all'
  });
  console.log('[baemin]', JSON.stringify(baemin));

  const coupang = await syncCoupangRejections({
    weekStart: settlementWeekStart(fromDate),
    weekEnd: toDate
  });
  console.log('[coupang]', JSON.stringify(coupang));

  const pub = await forcePublishCalls(fromDate, toDate);
  console.log('[rider_publish]', JSON.stringify(pub));

  return { baemin, coupang, pub };
}

async function main() {
  const today = todayKST();
  const latest = latestQueryableDate(today) || today;
  const argFrom = String(process.argv[2] || '').slice(0, 10);
  const argTo = String(process.argv[3] || '').slice(0, 10);

  const ranges = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(argFrom) && /^\d{4}-\d{2}-\d{2}$/.test(argTo)) {
    ranges.push({ fromDate: argFrom, toDate: argTo });
  } else {
    // 이번 주(수~조회가능일) + 지난 주 전체
    const thisWeekStart = settlementWeekStart(latest);
    ranges.push({ fromDate: thisWeekStart, toDate: latest });
    // 지난주: 이번주 시작 하루 전(=화)이 속한 주
    const prevAnchor = latest; // fallback
    const parts = thisWeekStart.split('-').map(Number);
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    d.setUTCDate(d.getUTCDate() - 1);
    const prevDay = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const prevStart = settlementWeekStart(prevDay || prevAnchor);
    const prevWeekEnd = settlementWeekEnd(prevStart);
    if (prevStart && prevWeekEnd && prevStart < thisWeekStart) {
      ranges.push({ fromDate: prevStart, toDate: prevWeekEnd });
    }
  }

  console.log('[run-erp-publish-now]', { today, latest, ranges });
  const results = [];
  for (const range of ranges) {
    results.push(await syncOneRange(range.fromDate, range.toDate));
  }
  console.log('\n[done]', JSON.stringify(results, null, 2));
  const failed = results.some(r => r.baemin?.ok === false || r.coupang?.ok === false);
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
