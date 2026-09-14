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
  const { data: menus } = await sb.from('baemin_biz_collect_items')
    .select('source_menu')
    .eq('collect_date', '2026-09-09')
    .limit(5000);
  const tally = {};
  (menus || []).forEach(r => { tally[r.source_menu] = (tally[r.source_menu] || 0) + 1; });
  console.log('baemin menus', tally, 'n', (menus || []).length);

  const { data: latest, error } = await sb.from('baemin_biz_collect_items')
    .select('collected_at,source_menu,dedupe_key,parsed_json')
    .eq('collect_date', '2026-09-09')
    .eq('source_menu', 'delivery_status')
    .order('collected_at', { ascending: false })
    .limit(8);
  console.log('latest err', error && error.message);
  console.log('sample n', (latest || []).length);
  (latest || []).forEach(x => {
    const p = x.parsed_json || {};
    console.log({
      collected_at: x.collected_at,
      key: x.dedupe_key,
      morning: p.morningCount ?? p.completeMorning,
      afternoon: p.afternoonCount ?? p.completeAfternoon,
      evening: p.eveningCount ?? p.completeEvening,
      midnight: p.midnightCount ?? p.completeMidnight
    });
  });

  const { count } = await sb.from('baemin_biz_collect_items')
    .select('*', { count: 'exact', head: true })
    .eq('collect_date', '2026-09-09')
    .eq('source_menu', 'delivery_status');
  console.log('delivery_status count', count);

  const { data: cfg } = await sb.from('settings').select('value').eq('key', 'brem_contribution_ledger_v3_config').maybeSingle();
  console.log('config', JSON.stringify(cfg?.value));
})().catch(e => { console.error(e); process.exit(1); });
