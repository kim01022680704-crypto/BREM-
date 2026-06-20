/**
 * 로컬 Node 배민Biz 수집 → Supabase 저장
 * Run: node scripts/collect-baemin-delivery-local.js
 *
 * 환경변수: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, BAEMIN_BIZ_SESSION_COOKIE
 * (관리자 JWT 없이 service role로 직접 저장 — 로컬 운영용)
 */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const {
  fetchAllDeliveryStatus,
  resolveSessionCookie,
  mapItemToRow
} = require('../server/baemin-delivery-collect');

async function main() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
    process.exit(1);
  }

  const cookie = resolveSessionCookie({});
  if (!cookie) {
    console.error('BAEMIN_BIZ_SESSION_COOKIE 가 필요합니다.');
    process.exit(1);
  }

  const captureDate = String(process.env.BAEMIN_CAPTURE_DATE || new Date().toISOString().slice(0, 10));
  const fetched = await fetchAllDeliveryStatus(cookie);
  if (!fetched.ok) {
    console.error('Fetch FAIL:', fetched.message || fetched.error);
    process.exit(1);
  }

  const rows = fetched.items.map(item => mapItemToRow(item, captureDate)).filter(row => row.dedupe_key);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await supabase
    .from('baemin_delivery_status')
    .upsert(rows, { onConflict: 'capture_date,dedupe_key' });

  if (error) {
    console.error('Supabase FAIL:', error.message);
    process.exit(1);
  }

  const totalComplete = rows.reduce((sum, row) => sum + Number(row.total_complete || 0), 0);
  console.log('Saved OK');
  console.log('  captureDate:', captureDate);
  console.log('  saved riders:', rows.length);
  console.log('  totalComplete:', totalComplete);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
