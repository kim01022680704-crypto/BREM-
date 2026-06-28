/**
 * 로컬 Node 배민Biz 수집 → Supabase 저장
 * Run: npm run collect:baemin-local
 *
 * 환경변수: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
 * (관리자 JWT 없이 service role로 직접 저장 — 로컬 운영용)
 */
require('dotenv').config();

const baeminAutoCollect = require('../server/baemin-auto-collect');

async function main() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
    process.exit(1);
  }

  const captureDate = String(process.env.BAEMIN_CAPTURE_DATE || baeminAutoCollect.todayDateStringKST());
  const result = await baeminAutoCollect.runAutoCollectJob({
    captureDate,
    source: 'local_cli'
  });

  if (!result.ok) {
    console.error('Collect FAIL:', result.message || result.record?.lastError || 'unknown');
    if (result.results) {
      Object.entries(result.results).forEach(([id, row]) => {
        console.error(`  ${id}:`, row.ok ? `ok (${row.savedCount || 0})` : (row.message || row.error || 'fail'));
      });
    }
    process.exit(1);
  }

  console.log('Saved OK');
  console.log('  captureDate:', result.captureDate);
  console.log('  saved total:', result.savedCount);
  console.log('  totalComplete:', result.totalCompleteSum);
  if (result.results) {
    Object.entries(result.results).forEach(([id, row]) => {
      console.log(`  ${id}:`, row.ok ? `ok (${row.savedCount || 0})` : (row.message || 'fail'));
    });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
