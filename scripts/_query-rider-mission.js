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
const NAME = process.argv[2] || '허지연';
(async () => {
  const { data, error } = await supabase
    .from('riders')
    .select('id,name,baemin_id,platform_baemin,platform_coupang,selected_mission_id_baemin,selected_mission_id_coupang,selected_mission_id_combined,selected_mission_id,raw_data')
    .eq('name', NAME);
  if (error) throw error;
  const { data: promos } = await supabase.from('promotions').select('id,name,platform,enabled');
  const byId = new Map((promos || []).map(p => [p.id, p]));
  const show = (id) => {
    const k = String(id || '').trim();
    if (!k) return '(empty)';
    const p = byId.get(k);
    return p ? `${p.name} [${p.platform}]` : `${k} (missing)`;
  };
  for (const r of data || []) {
    console.log('---', r.name, r.baemin_id, '---');
    console.log('baemin col:', show(r.selected_mission_id_baemin));
    console.log('coupang col:', show(r.selected_mission_id_coupang));
    console.log('combined col:', show(r.selected_mission_id_combined));
    console.log('legacy:', show(r.selected_mission_id));
    const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
    console.log('raw baemin:', show(raw.selectedMissionIdBaemin));
    console.log('raw coupang:', show(raw.selectedMissionIdCoupang));
    console.log('raw combined:', show(raw.selectedMissionIdCombined));
  }
})().catch(e => { console.error(e.message || e); process.exit(1); });
