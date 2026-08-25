#!/usr/bin/env node
/** 박현우 — 매칭됐는데 일정산이 없는 4일 추적 (읽기 전용) */
const path = require('path');
const fs = require('fs');
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  try { require('dotenv').config({ path: envPath }); return; } catch (_) {}
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);
const DATES = ['2026-08-12', '2026-08-14', '2026-08-15', '2026-08-18'];
(async () => {
  // 1) 박현우 기사 레코드가 몇 개인가
  const { data: named } = await supabase.from('riders')
    .select('id,name,phone,baemin_id,status,created_at').ilike('name', '%박현우%');
  console.log('[1] 이름에 "박현우"가 들어가는 기사 레코드');
  (named || []).forEach(r => console.log(`  ${r.id} · "${r.name}" 전화=${r.phone} 배민ID=${r.baemin_id}`
    + ` ${r.status} 등록=${String(r.created_at).slice(0, 10)}`));

  const { data: byBaemin } = await supabase.from('riders')
    .select('id,name,phone,baemin_id,status').ilike('baemin_id', '%hyunwoo1o%');
  console.log('\n[2] 배민ID 가 hyunwoo1o 인 기사 레코드');
  (byBaemin || []).forEach(r => console.log(`  ${r.id} · "${r.name}" 배민ID=${r.baemin_id} ${r.status}`));

  const ids = [...new Set([...(named || []), ...(byBaemin || [])].map(r => r.id))];

  // 3) 그 날짜의 일정산 행 (박현우 관련 id 전부)
  console.log('\n[3] 그 4일의 배민 일정산 행 (박현우 관련 id 전부)');
  for (const id of ids) {
    const { data } = await supabase.from('daily_settlements')
      .select('id,driver_id,period,platform,order_count,delivery_amount,settlement_amount')
      .eq('driver_id', id).eq('platform', 'baemin').in('period', DATES);
    console.log(`  ${id}: ${(data || []).length}건`);
    (data || []).forEach(d => console.log(`      ${String(d.period).slice(0, 10)} 콜 ${d.order_count}`
      + ` 배달료 ${Number(d.delivery_amount).toLocaleString('ko-KR')} 정산 ${Number(d.settlement_amount).toLocaleString('ko-KR')}`));
  }

  // 4) 그 날짜 남A 파일의 matched_records 중 박현우 레코드 원문
  console.log('\n[4] 남A 배달처리비 파일 안의 박현우 레코드 원문');
  const { data: logs } = await supabase.from('settlement_upload_logs')
    .select('id,file_name,period,status,matched_count,matched_records,applied_records')
    .eq('platform', 'baemin').in('period', DATES);
  (logs || [])
    .filter(l => /배달처리비_표준울산남A/.test(l.file_name || ''))
    .sort((a, b) => String(a.period).localeCompare(String(b.period)))
    .forEach(l => {
      const matched = Array.isArray(l.matched_records) ? l.matched_records : [];
      const applied = Array.isArray(l.applied_records) ? l.applied_records : [];
      const find = arr => arr.filter(r => JSON.stringify(r || {}).includes('hyunwoo1o')
        || JSON.stringify(r || {}).includes('박현우'));
      const m = find(matched);
      const a = find(applied);
      console.log(`\n  ${String(l.period).slice(0, 10)} ${l.file_name} [${l.status}]`
        + ` matched=${matched.length} applied=${applied.length}`);
      console.log(`    matched_records 안 박현우: ${m.length}건`);
      m.forEach(r => console.log('      ' + JSON.stringify(r)));
      console.log(`    applied_records 안 박현우: ${a.length}건`);
      a.forEach(r => console.log('      ' + JSON.stringify(r)));
    });

  // 5) 그 4일 남A 파일이 실제로 만든 일정산 행 수 vs matched_count
  console.log('\n[5] 남A 파일의 matched_count vs 그날 실제 생성된 일정산 행 수');
  for (const d of DATES) {
    const { data: rows } = await supabase.from('daily_settlements')
      .select('driver_id').eq('platform', 'baemin').eq('period', d);
    const log = (logs || []).find(l => String(l.period).slice(0, 10) === d && /남A/.test(l.file_name || ''));
    const allLogs = (logs || []).filter(l => String(l.period).slice(0, 10) === d && /배달처리비/.test(l.file_name || ''));
    const sumMatched = allLogs.reduce((a, l) => a + Number(l.matched_count || 0), 0);
    console.log(`  ${d} · 그날 배달처리비 파일 matched 합 ${sumMatched} · 실제 일정산 행 ${(rows || []).length}`
      + `${sumMatched !== (rows || []).length ? '  ←★ 불일치' : ''}`
      + `  (남A matched=${log?.matched_count ?? '?'})`);
  }
})().catch(e => { console.error(e.message || e); process.exit(1); });
