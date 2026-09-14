#!/usr/bin/env node
/** 직계약 8/19주: 주정산서 콜수 vs 저장된 프로모션 결과 콜수 대조 */
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
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const WEEK = process.argv[2] || '2026-08-19';

async function readSetting(key) {
  const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  let v = data?.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) {} }
  return v;
}

function riderIndex(settlements) {
  const map = new Map();
  for (const s of settlements) {
    const plat = String(s.platform || 'coupang');
    for (const r of s.riders || []) {
      const id = String(r.matchedRiderId || '').trim();
      if (!id) continue;
      const key = `${id}:${plat}`;
      map.set(key, {
        driverId: id,
        platform: plat,
        region: s.region,
        weeklyOrderCount: Number(r.weeklyOrderCount || 0),
        deliveryFee: Number(r.amounts?.deliveryFee || 0),
        name: r.driverName || r.riderName || r.originalName
      });
    }
  }
  return map;
}

(async () => {
  const direct = await readSetting('brem_admin_weekly_settlements_direct');
  const weekSettlements = (Array.isArray(direct) ? direct : [])
    .filter(s => String(s.startDate || '').slice(0, 10) === WEEK);
  const idx = riderIndex(weekSettlements);

  const { data: promos } = await sb.from('promotion_apply_results')
    .select('id,platform,region,week_start,rows,meta,selected_rule_names,updated_at')
    .eq('week_start', WEEK)
    .order('updated_at', { ascending: false });

  const mismatches = [];
  const seen = new Set();

  for (const p of promos || []) {
    const channel = p.meta?.channel || '';
    if (channel !== 'direct') continue;
    const rows = Array.isArray(p.rows) ? p.rows : [];
    for (const row of rows) {
      const id = String(row.matchedRiderId || '').trim();
      if (!id) continue;
      const plat = String(row.appliedPlatform || p.platform || '').toLowerCase();
      const normPlat = plat === 'combined' ? 'coupang' : (plat.includes('baemin') ? 'baemin' : 'coupang');
      const promoCalls = Number(row.callCount || row.coupangCallCount || row.baeminCallCount || 0);
      const keys = plat === 'combined'
        ? [`${id}:coupang`, `${id}:baemin`]
        : [`${id}:${normPlat}`];
      for (const key of keys) {
        const sheet = idx.get(key);
        if (!sheet || sheet.weeklyOrderCount <= 0) continue;
        const dedupe = `${p.id}:${id}:${key}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const side = key.split(':')[1];
        const sideKey = side === 'coupang' ? 'coupangCallCount' : 'baeminCallCount';
        const compareCalls = plat === 'combined'
          ? Number(row[sideKey] || 0)
          : promoCalls;
        if (compareCalls === sheet.weeklyOrderCount) continue;
        mismatches.push({
          name: row.driverName || sheet.name,
          driverId: id.slice(0, 8),
          platform: key.split(':')[1],
          region: p.region,
          promoId: p.id.slice(0, 8),
          promoPlatform: p.platform,
          sheetCalls: sheet.weeklyOrderCount,
          promoCalls: compareCalls,
          diff: sheet.weeklyOrderCount - compareCalls,
          promoAmount: Number(row.totalPromotionAmount || 0),
          rules: (p.selected_rule_names || []).slice(0, 2).join(', ')
        });
      }
    }
  }

  console.log(`=== ${WEEK} 직계약 프로모션 vs 주정산서 콜수 ===`);
  console.log(`정산서 ${weekSettlements.length}건 · 프로모션 저장 ${(promos || []).filter(p => p.meta?.channel === 'direct').length}건`);
  console.log(`불일치 ${mismatches.length}건\n`);

  mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  mismatches.slice(0, 40).forEach(m => {
    console.log(
      `${m.name} (${m.platform}) ${m.region?.slice(0, 20) || ''}`
      + `\n  주간서 ${m.sheetCalls} vs 프로모션 ${m.promoCalls} (Δ${m.diff})`
      + ` · 저장금액 ${m.promoAmount.toLocaleString('ko-KR')}원 · ${m.rules}`
    );
  });

  const choi = mismatches.find(m => m.name.includes('최찬희'));
  if (choi) {
    const expected = (239 - 150) * 2000;
    console.log(`\n[최찬희] 수정 후 예상(150건 2천, 239콜): ${expected.toLocaleString('ko-KR')}원 (현재 ${choi.promoAmount.toLocaleString('ko-KR')}원)`);
  }
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
