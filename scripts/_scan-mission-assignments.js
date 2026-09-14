#!/usr/bin/env node
/** Mission assignment audit — read only */
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

function normalizePlatform(platform) {
  const p = String(platform || '').trim().toLowerCase();
  if (p === 'baemin') return 'baemin';
  if (p === 'combined' || p === 'both' || p === 'all') return 'combined';
  return 'coupang';
}

function validForPlatform(id, expected, byId) {
  const key = String(id || '').trim();
  if (!key) return true;
  const rule = byId.get(key);
  if (!rule || rule.enabled === false) return false;
  return normalizePlatform(rule.platform) === expected;
}

async function main() {
  const { data: promos } = await supabase.from('promotions').select('id,platform,enabled,name');
  const byId = new Map((promos || []).map(item => [item.id, item]));

  const { data: riders, error } = await supabase
    .from('riders')
    .select('id,name,baemin_id,platform_baemin,platform_coupang,selected_mission_id_baemin,selected_mission_id_coupang,selected_mission_id_combined,status');
  if (error) throw error;

  const stats = {
    total: 0,
    active: 0,
    dual: 0,
    none: 0,
    combined: 0,
    bothSeparate: 0,
    baeminOnly: 0,
    coupangOnly: 0,
    invalidBaemin: 0,
    invalidCoupang: 0,
    invalidCombined: 0
  };
  const samples = { baeminOnly: [], coupangOnly: [], none: [], invalid: [] };

  for (const r of riders || []) {
    stats.total += 1;
    if (r.status && r.status !== '근무중') continue;
    stats.active += 1;

    const dual = Boolean(r.platform_baemin) && r.platform_coupang !== false;
    if (dual) stats.dual += 1;

    const baemin = String(r.selected_mission_id_baemin || '').trim();
    const coupang = String(r.selected_mission_id_coupang || '').trim();
    const combined = String(r.selected_mission_id_combined || '').trim();

    const badB = baemin && !validForPlatform(baemin, 'baemin', byId);
    const badC = coupang && !validForPlatform(coupang, 'coupang', byId);
    const badX = combined && !validForPlatform(combined, 'combined', byId);
    if (badB) stats.invalidBaemin += 1;
    if (badC) stats.invalidCoupang += 1;
    if (badX) stats.invalidCombined += 1;
    if (badB || badC || badX) {
      if (samples.invalid.length < 8) samples.invalid.push(`${r.name} (${r.baemin_id || '-'})`);
      continue;
    }

    if (combined) { stats.combined += 1; continue; }
    if (baemin && coupang) { stats.bothSeparate += 1; continue; }
    if (baemin && !coupang) {
      stats.baeminOnly += 1;
      if (dual && samples.baeminOnly.length < 5) samples.baeminOnly.push(`${r.name} (${r.baemin_id || '-'})`);
      continue;
    }
    if (!baemin && coupang) {
      stats.coupangOnly += 1;
      if (dual && samples.coupangOnly.length < 5) samples.coupangOnly.push(`${r.name} (${r.baemin_id || '-'})`);
      continue;
    }
    stats.none += 1;
    if (samples.none.length < 5) samples.none.push(`${r.name} (${r.baemin_id || '-'})`);
  }

  console.log(JSON.stringify({ stats, samples }, null, 2));
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
