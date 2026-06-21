/* eslint-disable no-console */
/**
 * Supabase riders 테이블 컬럼 점검
 * Run: node scripts/verify-riders-schema.js
 *
 * 필요 env (.env):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const EXPECTED_COLUMNS = [
  'id',
  'auth_user_id',
  'name',
  'phone',
  'resident_number',
  'bank_name',
  'account_holder',
  'account_number',
  'baemin_id',
  'platform_coupang',
  'platform_baemin',
  'long_event_item_id',
  'long_event_item',
  'long_event_start_date',
  'long_event_platform',
  'join_date',
  'status',
  'memo',
  'hidden_fields',
  'promotion_selector_coupang',
  'promotion_selector_baemin',
  'promotion_rule_id_coupang',
  'promotion_rule_id_baemin',
  'selected_mission_id',
  'selected_mission_id_baemin',
  'selected_mission_id_coupang',
  'raw_data',
  'created_at',
  'updated_at'
];

const CODE_SELECT_COLUMNS = EXPECTED_COLUMNS.filter(name => name !== 'raw_data');

function parseMissingColumn(errorMessage) {
  const match = String(errorMessage || '').match(/column riders\.([a-z0-9_]+) does not exist/i);
  return match ? match[1] : '';
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const selectAll = CODE_SELECT_COLUMNS.join(',');

  console.log('=== riders schema verify ===');
  console.log('select probe:', selectAll);

  const { data, error } = await supabase.from('riders').select(selectAll).limit(1);
  if (error) {
    const missing = parseMissingColumn(error.message);
    console.error('FAIL:', error.message);
    if (missing) {
      console.error('missing column:', missing);
      console.error('→ Supabase SQL Editor에서 supabase/riders_schema_sync_migration.sql 실행');
    }
    process.exit(1);
  }

  console.log('OK: code select columns exist');
  console.log('sample rows:', Array.isArray(data) ? data.length : 0);

  const critical = ['long_event_platform', 'selected_mission_id', 'selected_mission_id_baemin', 'selected_mission_id_coupang'];
  critical.forEach(column => {
    const present = CODE_SELECT_COLUMNS.includes(column);
    console.log(`${present ? '✓' : '?'} ${column}`);
  });

  console.log('\nIf long_event_platform was missing before migration, run:');
  console.log('  supabase/riders_schema_sync_migration.sql');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
