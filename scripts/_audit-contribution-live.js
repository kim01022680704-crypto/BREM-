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
  const now = new Date();
  console.log('NOW', now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));

  const { data: events, error } = await sb.from('contribution_ledger_events')
    .select('date,platform,slot_key,captured_at,points')
    .eq('date', '2026-09-09')
    .order('captured_at', { ascending: false })
    .limit(20);
  if (error) console.log('events err', error.message);
  console.log('\nlatest events');
  (events || []).slice(0, 8).forEach(r => console.log(r.captured_at, r.platform, r.slot_key, r.points));

  const { data: states } = await sb.from('contribution_slot_states')
    .select('platform,slot_key,frozen,updated_at,last_captured_at')
    .eq('date', '2026-09-09')
    .limit(5000);
  const tally = {};
  (states || []).forEach(r => {
    const k = `${r.platform}|${r.slot_key}|${r.frozen}`;
    tally[k] = (tally[k] || 0) + 1;
  });
  console.log('\nstates 9/9', JSON.stringify(tally, null, 2));
  const latestStates = [...(states || [])].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  console.log('\nlatest state updates');
  latestStates.slice(0, 6).forEach(r => {
    console.log(r.updated_at, r.last_captured_at, r.platform, r.slot_key, r.frozen);
  });

  const { data: b, error: be } = await sb.from('baemin_biz_collect_items')
    .select('collected_at,source_menu,dedupe_key')
    .eq('collect_date', '2026-09-09')
    .eq('source_menu', 'delivery_status')
    .order('collected_at', { ascending: false })
    .limit(3);
  console.log('\nbaemin delivery latest', be?.message || '');
  (b || []).forEach(x => console.log(x.collected_at, x.dedupe_key));

  const { data: c } = await sb.from('coupang_collect_items')
    .select('collected_at,source_menu')
    .eq('collect_date', '2026-09-09')
    .order('collected_at', { ascending: false })
    .limit(3);
  console.log('coupang latest', (c || []).map(x => `${x.collected_at} ${x.source_menu}`).join(' | '));
})().catch(e => { console.error(e); process.exit(1); });
