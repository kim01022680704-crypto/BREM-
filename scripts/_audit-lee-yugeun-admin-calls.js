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

(async () => {
  const { data: calls, error } = await sb.from('admin_calls')
    .select('id,driver_id,date,platform,count,updated_at,rider_published_at')
    .eq('driver_id', ID)
    .gte('date', '2026-09-01')
    .lte('date', '2026-09-09')
    .order('date');
  if (error) console.log('admin_calls err', error);
  console.log('=== admin_calls ===');
  (calls || []).forEach(r => console.log(JSON.stringify(r)));
  const week = (calls || []).filter(r => r.date >= '2026-09-02' && r.date <= '2026-09-08');
  const sum = week.reduce((s, r) => s + Number(r.count || 0), 0);
  console.log('week sum', sum, 'rows', week.length);

  const { data: daily } = await sb.from('daily_settlements')
    .select('period,platform,order_count,settlement_amount')
    .eq('driver_id', ID)
    .gte('period', '2026-09-02')
    .lte('period', '2026-09-08')
    .order('period');
  console.log('\n=== daily vs calls ===');
  const callMap = new Map((calls || []).map(c => [`${c.date}|${c.platform}`, r.count]));
  // fix
  const cmap = {};
  (calls || []).forEach(c => { cmap[`${c.date}|${c.platform}`] = Number(c.count || 0); });
  (daily || []).forEach(d => {
    const cc = cmap[`${d.period}|${d.platform}`];
    console.log(d.period, d.platform, 'settle', d.order_count, 'admin_calls', cc, 'delta', (cc ?? null) === null ? 'NO CALL ROW' : (Number(cc) - Number(d.order_count)));
  });

  const { data: promo, error: pe } = await sb.from('promotion_apply_results')
    .select('*')
    .eq('driver_id', ID)
    .gte('week_start', '2026-08-19');
  if (pe) console.log('promo err', pe.message);
  else {
    console.log('\n=== promo ===', (promo || []).length);
    (promo || []).forEach(r => console.log(JSON.stringify({
      week: r.week_start, platform: r.platform, calls: r.call_count || r.total_orders, matched: r.call_count_matched, raw: Object.keys(r)
    })));
  }
})().catch(e => { console.error(e); process.exit(1); });
