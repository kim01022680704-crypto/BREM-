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

function tally(rows, keys) {
  const map = {};
  (rows || []).forEach(r => {
    const k = keys.map(x => r[x]).join('|');
    map[k] = (map[k] || 0) + 1;
  });
  return map;
}

(async () => {
  for (const date of ['2026-09-08', '2026-09-09']) {
    const { data: states, error } = await sb.from('contribution_slot_states')
      .select('date,platform,region,slot_key,frozen,assigned_target,region_complete,updated_at,last_capture_key')
      .eq('date', date)
      .limit(5000);
    if (error) { console.log(date, 'states', error.message); continue; }
    console.log('\n==== STATES', date, 'n=', (states || []).length);
    console.log(JSON.stringify(tally(states, ['platform', 'slot_key', 'frozen']), null, 2));
  }

  const { data: events, error: ee } = await sb.from('contribution_ledger_events')
    .select('date,platform,slot_key,captured_at,points')
    .eq('date', '2026-09-09')
    .order('captured_at', { ascending: false })
    .limit(3000);
  if (ee) console.log('events', ee.message);
  console.log('\n==== EVENTS 9/9 n=', (events || []).length);
  console.log(JSON.stringify(tally(events, ['platform', 'slot_key']), null, 2));
  const latest = {};
  (events || []).forEach(r => {
    const k = `${r.platform}|${r.slot_key}`;
    if (!latest[k]) latest[k] = r.captured_at;
  });
  console.log('latest captured', latest);

  const { data: b } = await sb.from('baemin_biz_collect_items')
    .select('collect_date,collected_at,source_menu,partner_id')
    .eq('collect_date', '2026-09-09')
    .order('collected_at', { ascending: false })
    .limit(8);
  const { count: bc } = await sb.from('baemin_biz_collect_items').select('*', { count: 'exact', head: true }).eq('collect_date', '2026-09-09');
  console.log('\n==== BAEMIN CRAWL today', bc);
  (b || []).forEach(x => console.log(x.collected_at, x.source_menu, x.partner_id));

  const { data: c } = await sb.from('coupang_collect_items')
    .select('collected_at,source_menu')
    .eq('collect_date', '2026-09-09')
    .order('collected_at', { ascending: false })
    .limit(3);
  console.log('\ncoupang latest', c?.[0]?.collected_at, 'menu', c?.[0]?.source_menu);
})().catch(e => { console.error(e); process.exit(1); });
