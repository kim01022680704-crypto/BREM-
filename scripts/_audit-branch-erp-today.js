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

(async () => {
  const { data: wp } = await sb.from('coupang_collect_items')
    .select('vendor_name,collected_at,parsed_json,collect_date')
    .eq('source_menu', 'weekly_performance')
    .eq('collect_date', '2026-09-09')
    .limit(400);
  const byDate = {};
  (wp || []).forEach(r => {
    const p = r.parsed_json || {};
    const d = String(p.date || '').slice(0, 10);
    if (!byDate[d]) byDate[d] = { n: 0, completed: 0, goal: 0, peaks: {} };
    byDate[d].n += 1;
    byDate[d].completed += Number(p.completedCount || 0);
    byDate[d].goal += Number(p.goalCount || 0);
    const pk = p.peakType || '?';
    byDate[d].peaks[pk] = (byDate[d].peaks[pk] || 0) + Number(p.completedCount || 0);
  });
  console.log('=== weekly_performance week collect_date 9/9 === n rows', (wp || []).length);
  Object.keys(byDate).sort().forEach(d => console.log(d, JSON.stringify(byDate[d])));
  console.log('latest wp at', wp?.[0]?.collected_at);

  const { data: wpPrev } = await sb.from('coupang_collect_items')
    .select('collect_date,parsed_json')
    .eq('source_menu', 'weekly_performance')
    .eq('collect_date', '2026-09-02')
    .limit(50);
  const prevDates = {};
  (wpPrev || []).forEach(r => {
    const d = String(r.parsed_json?.date || '').slice(0, 10);
    prevDates[d] = (prevDates[d] || 0) + 1;
  });
  console.log('\n=== weekly_performance collect_date 9/2 parsed dates ===', prevDates);

  const { data: pr } = await sb.from('coupang_collect_items')
    .select('vendor_name,collected_at,parsed_json')
    .eq('source_menu', 'peak_realtime')
    .eq('collect_date', '2026-09-09')
    .order('collected_at', { ascending: false })
    .limit(40);
  console.log('\n=== peak_realtime today sample ===');
  const latestByVendorPeak = {};
  (pr || []).forEach(r => {
    const p = r.parsed_json || {};
    const k = `${r.vendor_name}|${p.peakType}`;
    if (!latestByVendorPeak[k]) latestByVendorPeak[k] = { at: r.collected_at, peak: p.peakType, goal: p.goalCount, done: p.completedCount };
  });
  Object.entries(latestByVendorPeak).slice(0, 15).forEach(([k, v]) => console.log(k, JSON.stringify(v)));
})().catch(e => { console.error(e); process.exit(1); });
