#!/usr/bin/env node
/** 콜수 vs 일정산 플랫폼별 커버리지 (읽기 전용) */
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
  const calls = await fetchAll('admin_calls', 'driver_id,date,platform,count',
    q => q.gte('date', FROM).lte('date', TO));
  const daily = await fetchAll('daily_settlements', 'driver_id,period,platform,order_count,settlement_amount',
    q => q.gte('period', FROM).lte('period', TO));

  const byPlatform = key => rows => rows.reduce((m, r) => {
    const p = String(r.platform || '').toLowerCase() || '(빈값)';
    m[p] = (m[p] || 0) + 1;
    return m;
  }, {});
  console.log(`기간 ${FROM} ~ ${TO}`);
  console.log('콜수 플랫폼별   :', byPlatform()(calls));
  console.log('일정산 플랫폼별 :', byPlatform()(daily));

  // 날짜별 커버리지
  const dailyKey = new Set(daily.map(d => `${d.driver_id}|${String(d.period).slice(0, 10)}|${String(d.platform || '').toLowerCase()}`));
  const perDate = new Map();
  calls.forEach(c => {
    if (!(Number(c.count) > 0)) return;
    const date = String(c.date).slice(0, 10);
    const p = String(c.platform || '').toLowerCase();
    const k = `${date}|${p}`;
    const cur = perDate.get(k) || { total: 0, missing: 0 };
    cur.total += 1;
    if (!dailyKey.has(`${c.driver_id}|${date}|${p}`)) cur.missing += 1;
    perDate.set(k, cur);
  });
  console.log('\n날짜·플랫폼별 (콜수 있는 기사 수 / 그중 일정산 없는 수)');
  [...perDate.entries()].sort().forEach(([k, v]) => {
    const flag = v.missing === v.total ? '  ← 그날 그 플랫폼 일정산 자체가 통째로 없음' : (v.missing ? '  ←★일부 누락' : '');
    console.log(`  ${k.padEnd(18)} ${String(v.total).padStart(4)} / 누락 ${String(v.missing).padStart(4)}${flag}`);
  });

  // 배민 일정산이 존재하는 날짜
  const baeminDates = [...new Set(daily.filter(d => String(d.platform).toLowerCase() === 'baemin')
    .map(d => String(d.period).slice(0, 10)))].sort();
  const coupangDates = [...new Set(daily.filter(d => String(d.platform).toLowerCase() === 'coupang')
    .map(d => String(d.period).slice(0, 10)))].sort();
  console.log('\n배민 일정산이 있는 날짜 :', baeminDates.join(', ') || '(없음)');
  console.log('쿠팡 일정산이 있는 날짜 :', coupangDates.join(', ') || '(없음)');
})().catch(e => { console.error(e.message || e); process.exit(1); });
