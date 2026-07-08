#!/usr/bin/env node
/**
 * 라이더별 배달내역 파이프라인 진단 (수집 → 저장 → 조회)
 * Usage: node scripts/diagnose-rider-pipeline.js [partnerId] [fromDate] [toDate]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const {
  getBaeminStorageDiagnosticsForAdmin,
  getRiderHistoryRangeForAdmin,
  readAppliedBaeminDelivery
} = require('../server/baemin-collect-pipeline');
const { getServiceClient } = require('../server/admin-bootstrap');

async function main() {
  const partnerId = String(process.argv[2] || 'DP2605040667').trim().toUpperCase();
  const fromDate = String(process.argv[3] || '2026-07-01').slice(0, 10);
  const toDate = String(process.argv[4] || '2026-07-07').slice(0, 10);

  const supabase = getServiceClient();
  if (!supabase) {
    console.error('SUPABASE_SERVICE_ROLE_KEY 없음 — .env 확인');
    process.exit(1);
  }

  const applied = await readAppliedBaeminDelivery();
  const batchId = applied?.batchId || '';
  console.log('=== 배민 라이더 파이프라인 진단 ===');
  console.log(`partnerId: ${partnerId}`);
  console.log(`조회기간: ${fromDate} ~ ${toDate}`);
  console.log(`applied batchId: ${batchId || '(없음)'}`);
  console.log('');

  const diagnostics = await getBaeminStorageDiagnosticsForAdmin({ skipScopeCheck: true });
  if (diagnostics.ok) {
    console.log('--- 저장 현황 ---');
    console.log(JSON.stringify({
      bizCollect: diagnostics.bizCollect,
      appliedSnapshot: diagnostics.appliedSnapshot,
      riderBusinessDates: diagnostics.riderBusinessDates,
      hints: (diagnostics.hints || []).map(h => h.message)
    }, null, 2));
    console.log('');
  }

  const [{ data: bizRows }, { data: appliedRows }] = await Promise.all([
    supabase
      .from('baemin_biz_collect_items')
      .select('dedupe_key, parsed_json, collect_date, rider_name, rider_user_id')
      .eq('source_menu', 'rider_history')
      .like('dedupe_key', `${partnerId}:%`)
      .limit(5000),
    batchId
      ? supabase
        .from('baemin_delivery_applied_items')
        .select('dedupe_key, parsed_json, collect_date, rider_name, rider_user_id')
        .eq('batch_id', batchId)
        .eq('source_menu', 'rider_history')
        .like('dedupe_key', `${partnerId}:%`)
        .limit(5000)
      : Promise.resolve({ data: [] })
  ]);

  function summarizeDates(rows) {
    const dates = new Set();
    (rows || []).forEach(row => {
      const d = String(row.parsed_json?.businessDate || row.parsed_json?.deliveryDate || '').slice(0, 10)
        || String(row.dedupe_key || '').split(':')[1];
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.add(d);
    });
    return Array.from(dates).sort();
  }

  console.log('--- BIZ 수집 (baemin_biz_collect_items) ---');
  console.log(`건수: ${(bizRows || []).length}`);
  console.log(`배달일: ${summarizeDates(bizRows).join(', ') || '(없음)'}`);
  const bizActive = (bizRows || []).filter(r => Number(r.parsed_json?.totalComplete || 0) > 0).length;
  console.log(`완료>0: ${bizActive}건`);
  console.log('');

  console.log('--- 배민현황 저장 (baemin_delivery_applied_items) ---');
  console.log(`건수: ${(appliedRows || []).length}`);
  console.log(`배달일: ${summarizeDates(appliedRows).join(', ') || '(없음)'}`);
  const appliedActive = (appliedRows || []).filter(r => Number(r.parsed_json?.totalComplete || 0) > 0).length;
  console.log(`완료>0: ${appliedActive}건`);
  console.log('');

  const view = await getRiderHistoryRangeForAdmin({
    partnerId,
    fromDate,
    toDate,
    skipScopeCheck: true
  });
  console.log('--- 조회 API (getRiderHistoryRangeForAdmin) ---');
  console.log(`ok: ${view.ok} · notApplied: ${Boolean(view.notApplied)}`);
  console.log(`일별 raw: ${view.count}건 · 기사별 집계: ${view.riderCount}명`);
  console.log(`운행(완료>0): ${(view.riders || []).filter(r => Number(r.parsed_json?.totalComplete || 0) > 0).length}명`);
  console.log(`완료 합계: ${view.totals?.completeTotal || 0}`);
  if (view.hint) console.log(`hint: ${view.hint}`);
  if (view.message) console.log(`message: ${view.message}`);

  const sample = (view.riders || [])
    .filter(r => Number(r.parsed_json?.totalComplete || 0) > 0)
    .slice(0, 5)
    .map(r => `${r.rider_name}(${r.rider_user_id}): ${r.parsed_json?.totalComplete}`);
  if (sample.length) {
    console.log('샘플:', sample.join(' | '));
  }

  if ((bizRows || []).length > 0 && (appliedRows || []).length === 0) {
    console.log('\n⚠ 수집은 됐으나 [배민현황 저장]이 안 된 상태입니다.');
  } else if ((bizRows || []).length > (appliedRows || []).length * 1.1) {
    console.log('\n⚠ BIZ 수집 건수가 저장 건수보다 많습니다. [배민현황 저장]을 다시 실행하세요.');
  } else if (view.count === 0 && (appliedRows || []).length > 0) {
    console.log('\n⚠ 저장 데이터는 있으나 선택 기간과 맞지 않습니다. 시작일·종료일을 저장된 배달일 범위로 맞춰 보세요.');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
