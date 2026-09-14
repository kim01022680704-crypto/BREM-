#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  try { require('dotenv').config({ path: envPath }); return; } catch (_) {}
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
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
function parse(v) {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) { return v; } }
  return v;
}
(async () => {
  const day = '2026-09-01';
  const { data } = await sb.from('baemin_biz_collect_items')
    .select('dedupe_key')
    .eq('source_menu', 'rider_history')
    .eq('collect_date', day)
    .limit(5000);
  const map = {};
  (data || []).forEach(r => {
    const dp = String(r.dedupe_key || '').split(':')[0].toUpperCase();
    map[dp] = (map[dp] || 0) + 1;
  });
  console.log('9/1 rider_history by DP');
  Object.entries(map).sort((a, b) => b[1] - a[1]).forEach(([dp, n]) => console.log(dp, n));

  const { data: settings } = await sb.from('settings').select('value').eq('key', 'baemin_partner_region_map').maybeSingle();
  const regionMap = parse(settings?.value) || {};
  console.log('\ncurrent region map');
  Object.entries(regionMap).forEach(([dp, name]) => console.log(dp, name));
})().catch(e => { console.error(e); process.exit(1); });
