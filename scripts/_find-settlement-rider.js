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
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const NEEDLES = ['박형진', 'wblxlqld', 'wlslxl', '김영광'];

async function readSetting(key) {
  const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  let v = data?.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) {} }
  return v;
}

(async () => {
  const direct = await readSetting('brem_admin_weekly_settlements_direct');
  const list = Array.isArray(direct) ? direct : (direct?.records || []);
  console.log('direct settlements count', list.length);
  for (const s of list) {
    for (const r of s.riders || []) {
      const j = JSON.stringify(r);
      if (NEEDLES.some(n => j.includes(n))) {
        console.log('---', s.startDate, s.platform, s.region, '---');
        console.log(JSON.stringify({
          riderName: r.riderName,
          driverName: r.driverName,
          originalName: r.originalName,
          baeminUserId: r.baeminUserId,
          matchedRiderId: r.matchedRiderId
        }, null, 2));
      }
    }
  }

  const mappings = await readSetting('brem_admin_manual_name_mappings');
  console.log('\nmanual mappings hits:');
  for (const m of Array.isArray(mappings) ? mappings : []) {
    const j = JSON.stringify(m);
    if (NEEDLES.some(n => j.includes(n))) console.log(JSON.stringify(m, null, 2));
  }

  const { data: riders } = await sb.from('riders').select('id,name,baemin_id,phone').or('name.eq.김영광,name.eq.박형진');
  console.log('\nriders:');
  for (const r of riders || []) console.log(JSON.stringify(r));
})().catch(e => { console.error(e.message || e); process.exit(1); });
