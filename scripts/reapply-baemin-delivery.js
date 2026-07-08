#!/usr/bin/env node
/**
 * 로컬에서 [배민현황 저장] 실행 (Supabase service role 필요)
 * Usage: node scripts/reapply-baemin-delivery.js [collectDate]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { applyBaeminDelivery, getBaeminStorageDiagnosticsForAdmin, getRiderHistoryRangeForAdmin } = require('../server/baemin-collect-pipeline');

async function main() {
  const collectDate = String(process.argv[2] || '').slice(0, 10) || undefined;
  console.log('=== 배민현황 저장 (reapply) ===');
  if (collectDate) console.log('preferred collectDate:', collectDate);

  const before = await getBaeminStorageDiagnosticsForAdmin();
  if (before.ok) {
    console.log('저장 전 BIZ 라이더:', before.biz?.byMenu?.rider_history, '/ applied:', before.appliedSnapshot?.byMenu?.rider_history);
    (before.issues || []).forEach(issue => console.log('!', issue.message));
  }

  const started = Date.now();
  const result = await applyBaeminDelivery(collectDate || '', { appliedBy: 'reapply-script' });
  if (!result.ok) {
    console.error('FAILED:', result.message || result.error);
    process.exit(1);
  }

  console.log(`저장 완료 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log('batchId:', result.batchId);
  console.log('savedCount:', result.savedCount, 'byMenu:', result.byMenu);

  const after = await getBaeminStorageDiagnosticsForAdmin();
  if (after.ok) {
    console.log('저장 후 applied 라이더:', after.appliedSnapshot?.byMenu?.rider_history);
  }

  const view = await getRiderHistoryRangeForAdmin({
    partnerId: 'DP2605040667',
    fromDate: '2026-07-01',
    toDate: '2026-07-07',
    skipScopeCheck: true
  });
  const hwang = (view.riders || []).find(row => row.rider_user_id === 'dmschd072');
  console.log('울산남구 7/1~7/7 황은총:', hwang
    ? `완료 ${hwang.parsed_json?.totalComplete} (${hwang.activeDays}일)`
    : '없음');
  console.log('전체 완료 합계:', view.totals?.completeTotal, '/ 라이더', view.riderCount, '명');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
