/**
 * 배민Biz delivery-status API 수집 가능 여부 점검 (쿠키 기반)
 * Run: node scripts/test-baemin-delivery-feasibility.js
 *
 * 환경변수:
 *   BAEMIN_BIZ_SESSION_COOKIE — 배민Biz 로그인 후 복사한 Cookie 헤더 값
 */
require('dotenv').config();

const {
  fetchAllDeliveryStatus,
  resolveSessionCookieAsync,
  isPlaywrightFeasibleOnVercel
} = require('../server/baemin-delivery-collect');

async function main() {
  console.log('=== Playwright on Vercel ===');
  console.log(JSON.stringify(isPlaywrightFeasibleOnVercel(), null, 2));

  const cookie = await resolveSessionCookieAsync({});
  if (!cookie) {
    console.error('\nFAIL: 배민 세션이 없습니다.');
    console.error('ERP [배민 세션 갱신] 또는 BAEMIN_BIZ_SESSION_COOKIE / Supabase settings 를 설정하세요.');
    process.exit(1);
  }

  console.log('\n=== Cookie fetch test (page=0) ===');
  const result = await fetchAllDeliveryStatus(cookie);
  if (!result.ok) {
    console.error('FAIL:', result.message || result.error);
    process.exit(1);
  }

  console.log('OK');
  console.log('  totalPage:', result.meta?.totalPage);
  console.log('  raw riders:', result.meta?.rawCount);
  console.log('  unique riders:', result.items.length);
  console.log('  duplicates skipped:', result.meta?.duplicateCount);
  if (result.items[0]) {
    console.log('  sample:', {
      name: result.items[0].name,
      userId: result.items[0].userId,
      totalComplete: result.items[0].deliveryAcceptanceCount?.totalComplete
    });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
