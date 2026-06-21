/* eslint-disable no-console */
/**
 * 정산 Supabase migration 실행 여부 확인
 * 사용: node scripts/check-settlement-migration.js
 * (.env 에 SUPABASE_URL, SUPABASE_ANON_KEY 필요)
 */
require('dotenv').config();

const url = String(process.env.SUPABASE_URL || '').trim();
const key = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const TABLES = [
  { table: 'daily_settlements', label: '일정산 (daily_settlements)' },
  { table: 'weekly_settlements', label: '주정산 (weekly_settlements)' },
  { table: 'settlement_upload_logs', label: '업로드 기록' },
  { table: 'settlement_unmatched', label: '미매칭 기사' }
];

async function probeTable(table) {
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/${table}?select=id&limit=1`;
  const preferCount = `${url.replace(/\/$/, '')}/rest/v1/${table}?select=id`;
  try {
    const head = await fetch(preferCount, {
      method: 'HEAD',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'count=exact'
      }
    });
    if (head.status === 404) {
      return { ok: false, reason: '테이블 없음 (404)' };
    }
    const range = head.headers.get('content-range') || '';
    const match = range.match(/\/(\d+|\*)/);
    const count = match && match[1] !== '*' ? Number(match[1]) : null;
    if (!head.ok && head.status !== 206) {
      const body = await fetch(endpoint, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
      }).then(r => r.text()).catch(() => '');
      if (/does not exist|relation/i.test(body)) {
        return { ok: false, reason: '테이블 없음' };
      }
      return { ok: false, reason: `HTTP ${head.status}` };
    }
    return { ok: true, count: Number.isFinite(count) ? count : '?' };
  } catch (error) {
    return { ok: false, reason: error.message || String(error) };
  }
}

async function main() {
  console.log('\n=== BREM 정산 migration 확인 ===\n');

  if (!url || !key) {
    console.log('❌ SUPABASE_URL / SUPABASE_ANON_KEY 가 .env 에 없습니다.');
    console.log('   → Supabase 대시보드에서 SQL 로 확인하세요:');
    console.log('     supabase/check_settlement_migration_done.sql\n');
    process.exit(1);
  }

  let allOk = true;
  for (const item of TABLES) {
    const result = await probeTable(item.table);
    if (result.ok) {
      console.log(`✅ ${item.label} — 테이블 있음, 데이터 ${result.count}건`);
    } else {
      allOk = false;
      console.log(`❌ ${item.label} — ${result.reason}`);
    }
  }

  console.log('');
  if (allOk) {
    console.log('🎉 정산 테이블 migration 이 적용된 상태입니다.');
    console.log('   관리자 페이지에서 일정산/주정산 데이터가 보이면 정상입니다.\n');
    process.exit(0);
  }

  console.log('⚠️  migration 이 아직 안 된 것 같습니다.');
  console.log('   Supabase → SQL Editor → 아래 파일 전체 붙여넣기 → Run:');
  console.log('   supabase/settlements_tables_migration.sql\n');
  process.exit(2);
}

main();
