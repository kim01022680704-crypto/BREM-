#!/usr/bin/env node
/**
 * 일정산서 업로드 화면 로딩 진단 (읽기 전용)
 * 어떤 테이블이 얼마나 큰지, 전송량이 얼마인지만 잰다. 아무것도 쓰지 않는다.
 */
const path = require('path');
const fs = require('fs');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  try { require('dotenv').config({ path: envPath }); return; } catch (_) {}
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE env missing');
  process.exit(2);
}
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const DAILY_SETTLEMENT_SELECT = 'id,driver_id,period,platform,rider_id,order_count,hourly_insurance,deduction_base,delivery_amount,settlement_amount,applied_at';
const SETTLEMENT_UPLOAD_LOG_SELECT = 'id,kind,platform,file_name,period,week_start,week_end,region,start_date,end_date,status,matched_count,unmatched_count,total_delivery_amount,total_order_count,content_hash,matched_records,unmatched_records,applied_records,duplicate_of_log_id,skip_reason,linked_record_id,uploaded_at,applied_at';
const SETTLEMENT_UNMATCHED_SELECT = 'id,kind,platform,week_start,period,end_date,region,raw_name,name,rider_id,order_count,delivery_amount,settlement_amount,coupang_login_key,baemin_user_id,match_payload,source_file_name,saved_at';

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function countRows(table, build) {
  let q = supabase.from(table).select('id', { count: 'exact', head: true });
  if (build) q = build(q);
  const { count, error } = await q;
  if (error) return { error: error.message };
  return { count: count || 0 };
}

/** 실제 화면과 같은 select 로 전부 받아 전송 바이트를 잰다 (1000행 페이지네이션) */
async function measureFullFetch(table, select, build, label) {
  const started = Date.now();
  let offset = 0;
  let rows = 0;
  let bytes = 0;
  let pages = 0;
  for (;;) {
    let q = supabase.from(table).select(select);
    if (build) q = build(q);
    const { data, error } = await q.range(offset, offset + 999);
    if (error) {
      return { label, error: error.message, elapsedMs: Date.now() - started, rows, bytes, pages };
    }
    const batch = data || [];
    rows += batch.length;
    bytes += Buffer.byteLength(JSON.stringify(batch), 'utf8');
    pages += 1;
    if (batch.length < 1000) break;
    offset += 1000;
    if (pages > 400) break;
  }
  return { label, rows, bytes, pages, elapsedMs: Date.now() - started };
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

(async () => {
  console.log('='.repeat(78));
  console.log(' 일정산서 업로드 화면 로딩 진단 (읽기 전용)');
  console.log('='.repeat(78));

  console.log('\n[1] 행 수');
  const targets = [
    ['riders', null, '기사'],
    ['daily_settlements', null, '일정산 전체'],
    ['daily_settlements', q => q.gte('period', daysAgo(14)), '일정산 최근 14일'],
    ['admin_calls', null, '콜수 전체'],
    ['admin_calls', q => q.gte('date', daysAgo(730)), '콜수 최근 730일(기본 로드)'],
    ['admin_calls', q => q.gte('date', daysAgo(14)), '콜수 최근 14일'],
    ['settlement_upload_logs', null, '업로드로그 전체'],
    ['settlement_upload_logs', q => q.eq('kind', 'daily'), '업로드로그 daily'],
    ['settlement_unmatched', null, '미매칭 전체']
  ];
  for (const [table, build, label] of targets) {
    const r = await countRows(table, build);
    console.log(`  ${label.padEnd(28)} ${r.error ? `조회실패: ${r.error}` : `${r.count.toLocaleString('ko-KR')} 행`}`);
  }

  console.log('\n[2] 화면과 동일한 select 로 전량 수신 (전송량·소요시간)');
  const measures = [
    await measureFullFetch('settlement_upload_logs', SETTLEMENT_UPLOAD_LOG_SELECT, null, 'settlement_upload_logs (날짜 필터 없음)'),
    await measureFullFetch('daily_settlements', DAILY_SETTLEMENT_SELECT, null, 'daily_settlements (날짜 필터 없음)'),
    await measureFullFetch('admin_calls', '*', q => q.gte('date', daysAgo(730)), 'admin_calls (최근 730일)'),
    await measureFullFetch('settlement_unmatched', SETTLEMENT_UNMATCHED_SELECT, null, 'settlement_unmatched (필터 없음)')
  ];
  let total = 0;
  measures.forEach(m => {
    if (m.error) {
      console.log(`  ${m.label}\n    실패: ${m.error} (${m.elapsedMs}ms, ${m.rows}행까지)`);
      return;
    }
    total += m.bytes;
    console.log(`  ${m.label}`);
    console.log(`    ${m.rows.toLocaleString('ko-KR')}행 · ${mb(m.bytes)} · ${m.pages}페이지 · ${(m.elapsedMs / 1000).toFixed(1)}초`);
  });
  console.log(`\n  합계 전송량 ≈ ${mb(total)}`);

  console.log('\n[3] 업로드로그 1건당 payload 크기 (matched/unmatched/applied_records)');
  const { data: logs, error: logErr } = await supabase
    .from('settlement_upload_logs')
    .select('id,platform,period,matched_count,unmatched_count,matched_records,unmatched_records,applied_records')
    .eq('kind', 'daily')
    .order('uploaded_at', { ascending: false })
    .limit(5);
  if (logErr) {
    console.log(`  조회 실패: ${logErr.message}`);
  } else {
    (logs || []).forEach(row => {
      const m = Buffer.byteLength(JSON.stringify(row.matched_records || []), 'utf8');
      const u = Buffer.byteLength(JSON.stringify(row.unmatched_records || []), 'utf8');
      const a = Buffer.byteLength(JSON.stringify(row.applied_records || []), 'utf8');
      console.log(`  ${row.period} ${row.platform} · matched ${row.matched_count} / unmatched ${row.unmatched_count}`);
      console.log(`    matched_records ${(m / 1024).toFixed(0)}KB · unmatched ${(u / 1024).toFixed(0)}KB · applied ${(a / 1024).toFixed(0)}KB`);
    });
  }

  console.log('\n[4] 업로드에 실제로 필요한 최소 데이터');
  const riders = await countRows('riders', null);
  console.log(`  매칭에 필요한 것: riders ${riders.count?.toLocaleString('ko-KR')}행 (이름·전화·배민ID·쿠팡ID)`);
  console.log('  그 외 daily_settlements / admin_calls / settlement_upload_logs 는 매칭에 쓰이지 않음');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
