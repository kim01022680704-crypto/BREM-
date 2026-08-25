#!/usr/bin/env node
/** 배민 일정산서 업로드 이력·커버리지 (읽기 전용) */
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
async function fetchAll(table, columns, build) {
  const size = 1000; const out = [];
  for (let f = 0; ; f += size) {
    let q = supabase.from(table).select(columns).range(f, f + size - 1);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}
const FROM = '2026-08-12';
const TO = '2026-08-25';
(async () => {
  const logs = await fetchAll('settlement_upload_logs',
    'id,kind,platform,file_name,period,region,status,matched_count,unmatched_count,total_order_count,uploaded_at',
    q => q.gte('period', FROM).lte('period', TO));

  const baemin = logs.filter(l => String(l.platform || '').toLowerCase() === 'baemin');
  const coupang = logs.filter(l => String(l.platform || '').toLowerCase() === 'coupang');
  console.log(`업로드 로그 ${logs.length}건 (배민 ${baemin.length} · 쿠팡 ${coupang.length})  ${FROM}~${TO}\n`);

  const group = rows => {
    const m = new Map();
    rows.forEach(l => {
      const d = String(l.period).slice(0, 10);
      m.set(d, [...(m.get(d) || []), l]);
    });
    return m;
  };

  console.log('[배민 일정산서 — 날짜별 업로드 파일]');
  [...group(baemin).entries()].sort().forEach(([d, list]) => {
    const total = list.reduce((a, l) => a + Number(l.matched_count || 0), 0);
    console.log(`  ${d}  파일 ${list.length}장 · 매칭 ${total}명`);
    list.forEach(l => console.log(`      · ${String(l.region || '(지역없음)').padEnd(10)} 매칭 ${String(l.matched_count ?? '?').padStart(4)}`
      + ` 미매칭 ${String(l.unmatched_count ?? '?').padStart(3)} 콜 ${String(l.total_order_count ?? '?').padStart(5)}`
      + ` [${l.status}] ${l.file_name || ''}`));
  });

  console.log('\n[쿠팡 일정산서 — 날짜별 업로드 파일]');
  [...group(coupang).entries()].sort().forEach(([d, list]) => {
    const total = list.reduce((a, l) => a + Number(l.matched_count || 0), 0);
    console.log(`  ${d}  파일 ${list.length}장 · 매칭 ${total}명`);
  });
})().catch(e => { console.error(e.message || e); process.exit(1); });
