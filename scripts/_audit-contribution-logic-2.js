#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
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
  const { data: morning } = await sb.from('contribution_slot_states')
    .select('platform,region,slot_key,frozen,assigned_target,region_complete,last_captured_at,region_complete_reached')
    .eq('date', '2026-09-09')
    .eq('platform', 'baemin')
    .eq('slot_key', 'morning');
  console.log('BAEMIN MORNING STATES');
  (morning || []).forEach(s => {
    console.log(`${s.region} complete=${s.region_complete} target=${s.assigned_target} frozen=${s.frozen} reached=${s.region_complete_reached} at=${s.last_captured_at}`);
  });

  const { count: morningEvents } = await sb.from('contribution_ledger_events')
    .select('*', { count: 'exact', head: true })
    .eq('date', '2026-09-09')
    .eq('platform', 'baemin')
    .eq('slot_key', 'morning');
  console.log('morning events', morningEvents);

  const { data: unmatched } = await sb.from('contribution_ledger_events')
    .select('platform,slot_key,rider_id,name,region,points')
    .eq('date', '2026-09-09')
    .like('rider_id', 'crawl:%');
  console.log('\nUNMATCHED', unmatched);

  const { data: live } = await sb.from('contribution_slot_states')
    .select('platform,region,slot_key,frozen,assigned_target,region_complete,last_captured_at')
    .eq('date', '2026-09-09')
    .eq('frozen', false);
  console.log('\nLIVE STATES');
  (live || []).forEach(s => console.log(`${s.platform}|${s.slot_key}|${s.region} ${s.region_complete}/${s.assigned_target} ${s.last_captured_at}`));
})().catch(e => { console.error(e); process.exit(1); });
