/* eslint-disable no-console */
/**
 * Supabase 운영 테이블 전체 점검
 * Run: node scripts/verify-all-storage-tables.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.production') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createClient } = require('@supabase/supabase-js');

const TABLES = [
  { name: 'riders', label: '기사' },
  { name: 'notices', label: '공지' },
  { name: 'missions', label: '미션' },
  { name: 'promotions', label: '프로모션' },
  { name: 'admin_schedules', label: '스케줄' },
  { name: 'admin_calls', label: '콜수' },
  { name: 'admin_rejection_rates', label: '거절/수락율' },
  { name: 'admin_targets', label: '월간목표' },
  { name: 'settings', label: 'settings' },
  { name: 'rider_inquiries', label: '문의' }
];

const LEGACY_SETTINGS_KEYS = [
  'brem_admin_schedules',
  'brem_admin_calls',
  'brem_admin_rejection_rates',
  'brem_admin_targets'
];

function isMissingTableError(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('does not exist')
    || text.includes('schema cache')
    || (text.includes('relation') && text.includes('does not exist'));
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('FAIL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 없음 (.env.production 확인)');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  let failed = 0;

  console.log('=== BREM Supabase storage tables verify ===\n');

  for (const table of TABLES) {
    const { count, error } = await supabase
      .from(table.name)
      .select('*', { count: 'exact', head: true });

    if (error) {
      failed += 1;
      const kind = isMissingTableError(error.message) ? 'TABLE MISSING' : 'ERROR';
      console.log(`✗ ${table.name.padEnd(22)} ${kind}: ${error.message}`);
    } else {
      console.log(`✓ ${table.name.padEnd(22)} OK  rows=${count ?? 0}  (${table.label})`);
    }
  }

  console.log('\n--- legacy settings JSON (백업, 삭제 안 함) ---');
  const { data: settingsRows, error: settingsError } = await supabase
    .from('settings')
    .select('key,value')
    .in('key', LEGACY_SETTINGS_KEYS);

  if (settingsError) {
    failed += 1;
    console.log(`✗ settings query: ${settingsError.message}`);
  } else {
    const map = new Map((settingsRows || []).map(row => [row.key, row.value]));
    LEGACY_SETTINGS_KEYS.forEach(key => {
      const value = map.get(key);
      if (value == null) {
        console.log(`  · ${key}: (없음)`);
        return;
      }
      const len = Array.isArray(value) ? value.length : (typeof value === 'object' ? Object.keys(value).length : 1);
      console.log(`  · ${key}: ${Array.isArray(value) ? `array ${len}건` : typeof value}`);
    });
  }

  console.log('\n--- brem_is_admin() via profiles ---');
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('user_id,role,active')
    .eq('role', 'admin')
    .eq('active', true)
    .limit(3);

  if (profileError) {
    console.log(`  profiles: ${profileError.message}`);
  } else {
    console.log(`  active admin profiles: ${(profiles || []).length}`);
  }

  console.log('\n--- result ---');
  if (failed) {
    console.log(`FAIL: ${failed} table(s) — supabase/MIGRATION_ORDER.md 순서대로 migration 재실행`);
    process.exit(1);
  }
  console.log('PASS: 모든 운영 테이블 접근 가능');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
