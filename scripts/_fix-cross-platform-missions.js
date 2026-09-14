#!/usr/bin/env node
/**
 * riders 테이블에 다른 플랫폼 미션 ID가 섞인 칸을 비운다.
 *
 *   node scripts/_fix-cross-platform-missions.js --dry-run
 *   node scripts/_fix-cross-platform-missions.js
 */
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
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const DRY_RUN = process.argv.includes('--dry-run');
const FIELDS = [
  ['selected_mission_id_baemin', 'promotion_rule_id_baemin', 'promotion_selector_baemin', 'baemin'],
  ['selected_mission_id_coupang', 'promotion_rule_id_coupang', 'promotion_selector_coupang', 'coupang'],
  ['selected_mission_id_combined', null, null, 'combined']
];

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
  const { data: promos, error: promoError } = await supabase.from('promotions').select('id,platform,enabled,name');
  if (promoError) throw new Error(promoError.message);
  const byId = new Map((promos || []).map(item => [item.id, item]));

  const { data: riders, error } = await supabase
    .from('riders')
    .select('id,name,selected_mission_id,selected_mission_id_baemin,selected_mission_id_coupang,selected_mission_id_combined,promotion_rule_id_baemin,promotion_rule_id_coupang,promotion_selector_baemin,promotion_selector_coupang,raw_data');
  if (error) throw new Error(error.message);

  const fixes = [];
  for (const rider of riders || []) {
    const patch = {};
    const raw = rider.raw_data && typeof rider.raw_data === 'object' ? { ...rider.raw_data } : {};
    let rawChanged = false;

    for (const [selectedField, ruleField, selectorField, platform] of FIELDS) {
      const current = String(rider[selectedField] || '').trim();
      if (!current) continue;
      if (validForPlatform(current, platform, byId)) continue;

      patch[selectedField] = '';
      if (ruleField) patch[ruleField] = '';
      if (selectorField) patch[selectorField] = '';

      const rule = byId.get(current);
      const reason = !rule
        ? 'deleted rule'
        : rule.enabled === false
          ? 'disabled rule'
          : `platform mismatch (${rule.platform})`;
      fixes.push({ id: rider.id, name: rider.name, field: selectedField, missionId: current, reason, ruleName: rule?.name || '' });

      const camel = selectedField.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (raw[camel] !== undefined) {
        raw[camel] = '';
        rawChanged = true;
      }
      if (ruleField) {
        const camelRule = ruleField.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        if (raw[camelRule] !== undefined) {
          raw[camelRule] = '';
          rawChanged = true;
        }
      }
      if (selectorField) {
        const camelSel = selectorField.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        if (raw[camelSel] !== undefined) {
          raw[camelSel] = '';
          rawChanged = true;
        }
      }
    }

    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString();
      if (rawChanged) patch.raw_data = raw;

      const legacy = String(rider.selected_mission_id || '').trim();
      const nextBaemin = patch.selected_mission_id_baemin ?? rider.selected_mission_id_baemin;
      const nextCoupang = patch.selected_mission_id_coupang ?? rider.selected_mission_id_coupang;
      const nextCombined = patch.selected_mission_id_combined ?? rider.selected_mission_id_combined;
      if (legacy && !validForPlatform(legacy, 'baemin', byId) && !validForPlatform(legacy, 'coupang', byId) && !validForPlatform(legacy, 'combined', byId)) {
        patch.selected_mission_id = nextCombined || nextBaemin || nextCoupang || '';
      } else if (nextCombined) patch.selected_mission_id = nextCombined;
      else if (nextBaemin && nextCoupang && nextBaemin === nextCoupang) patch.selected_mission_id = nextBaemin;
      else if (nextBaemin && !nextCoupang) patch.selected_mission_id = nextBaemin;
      else if (!nextBaemin && nextCoupang) patch.selected_mission_id = nextCoupang;
      else if (!nextBaemin && !nextCoupang && !nextCombined) patch.selected_mission_id = '';

      if (DRY_RUN) continue;
      const { error: updateError } = await supabase.from('riders').update(patch).eq('id', rider.id);
      if (updateError) throw new Error(`${rider.name}: ${updateError.message}`);
    }
  }

  console.log(`${DRY_RUN ? '[dry-run] ' : ''}invalid mission fields: ${fixes.length}`);
  fixes.slice(0, 30).forEach(item => {
    console.log(`  ${item.name} · ${item.field} · ${item.ruleName || item.missionId} · ${item.reason}`);
  });
  if (fixes.length > 30) console.log(`  ... and ${fixes.length - 30} more`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
