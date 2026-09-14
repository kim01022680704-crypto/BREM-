#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
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
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const ID = 'b467aa1f-d46d-4e3e-a698-0d8f6e75b455';

function hit(obj) {
  const j = JSON.stringify(obj || '');
  return j.includes(ID) || j.includes('이유근') || j.includes('이유근9662');
}

async function readSetting(key) {
  const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  let v = data?.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) {} }
  return v;
}

(async () => {
  const list = await readSetting('brem_admin_weekly_settlements_direct') || [];
  const arr = Array.isArray(list) ? list : [];
  const starts = [...new Set(arr.map(s => String(s.startDate || s.weekStart || '').slice(0, 10)))].sort();
  console.log('direct startDates', starts.join(', '));
  console.log('count', arr.length);

  console.log('\n=== 이유근 in direct weekly ===');
  for (const s of arr) {
    for (const r of s.riders || []) {
      if (!hit(r) && r.matchedRiderId !== ID && r.driverId !== ID) continue;
      const weekly = Number(r.weeklyOrderCount || 0);
      const system = Number(r.systemCallCount || 0);
      console.log(JSON.stringify({
        start: s.startDate, end: s.endDate, region: s.region, platform: s.platform,
        file: s.fileName || s.sourceFileName,
        name: r.riderName || r.driverName || r.originalName,
        weekly, system, delta: system - weekly,
        matched: r.callCountMatched,
        matchedRiderId: r.matchedRiderId || r.driverId
      }));
    }
  }

  const bro = await readSetting('brem_admin_weekly_settlements') || [];
  const broArr = Array.isArray(bro) ? list === bro ? [] : bro : [];
  console.log('\nbro count', Array.isArray(bro) ? bro.length : typeof bro);
  if (Array.isArray(bro)) {
    const broStarts = [...new Set(bro.map(s => String(s.startDate || '').slice(0, 10)))].sort();
    console.log('bro startDates', broStarts.join(', '));
    for (const s of bro) {
      for (const r of s.riders || []) {
        if (!hit(r) && r.matchedRiderId !== ID && r.driverId !== ID) continue;
        console.log('BRO', JSON.stringify({
          start: s.startDate, region: s.region, platform: s.platform,
          weekly: r.weeklyOrderCount, system: r.systemCallCount, matched: r.callCountMatched
        }));
      }
    }
  }

  console.log('\n=== weekly_settlements columns/sample ===');
  const { data: ws, error } = await sb.from('weekly_settlements').select('*').limit(1);
  if (error) console.log(error.message);
  else console.log(Object.keys(ws?.[0] || {}), JSON.stringify(ws?.[0] || {}).slice(0, 500));

  const { data: ws2 } = await sb.from('weekly_settlements').select('*').ilike('driver_name', '%이유근%');
  console.log('by name', (ws2 || []).length);
  (ws2 || []).forEach(r => console.log(JSON.stringify(r).slice(0, 400)));

  console.log('\n=== promotion / mission ===');
  for (const table of ['promotion_results', 'promotion_assignments', 'rider_promotions', 'mission_results']) {
    const { data, error: e } = await sb.from(table).select('*').limit(1);
    if (e) { console.log(table, e.message); continue; }
    console.log(table, 'ok keys', Object.keys(data?.[0] || {}));
  }

  const { data: dailyAll } = await sb.from('daily_settlements')
    .select('period,order_count,settlement_amount')
    .eq('driver_id', ID)
    .eq('platform', 'coupang')
    .gte('period', '2026-08-19')
    .order('period');
  const byWeek = {};
  (dailyAll || []).forEach(r => {
    const d = new Date(r.period + 'T00:00:00+09:00');
    const day = d.getDay();
    const wedOffset = (day + 4) % 7; // Wed=0
    const start = new Date(d);
    start.setDate(d.getDate() - wedOffset);
    const key = start.toISOString().slice(0, 10);
    if (!byWeek[key]) byWeek[key] = { days: 0, calls: 0 };
    byWeek[key].days += 1;
    byWeek[key].calls += Number(r.order_count || 0);
  });
  console.log('\n=== daily by week ===', byWeek);
})().catch(e => { console.error(e); process.exit(1); });
