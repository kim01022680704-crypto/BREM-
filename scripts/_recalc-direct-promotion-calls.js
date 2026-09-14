#!/usr/bin/env node
/**
 * 직계약 프로모션 저장본 — 주정산서 콜수 기준으로 건당 미션 금액 재계산
 * (배민 단가보장 등 배달처리비 파일 의존 건은 건드리지 않음)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

const ROOT = path.join(__dirname, '..');
const WEEK = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || '2026-08-19';
const APPLY = process.argv.includes('--apply');

function addDays(dateValue, days) {
  const date = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

function makeSandbox(extra = {}) {
  const sandbox = {
    console,
    Math, Number, String, Array, Object, Boolean, Date, JSON, Set, Map,
    isNaN, parseFloat, parseInt,
    document: { readyState: 'complete', addEventListener: () => {}, getElementById: () => null },
    ...extra
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

function loadModules(files, extra = {}, exportNames = []) {
  const sandbox = makeSandbox(extra);
  const context = vm.createContext(sandbox);
  files.forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  });
  exportNames.forEach(name => {
    vm.runInContext(`globalThis.${name} = typeof ${name} !== 'undefined' ? ${name} : undefined;`, context);
  });
  return sandbox;
}

async function readSetting(key) {
  const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  let v = data?.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) {} }
  return v;
}

function promotionRowToRule(row) {
  const p = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...p,
    id: row.id,
    name: row.name || p.name,
    platform: row.platform || p.platform,
    enabled: row.enabled !== false,
    startDate: String(row.start_date || p.startDate || '').slice(0, 10),
    endDate: String(row.end_date || p.endDate || '').slice(0, 10),
    type: p.type || row.type
  };
}

function buildRiderIndex(settlements) {
  const map = new Map();
  for (const s of settlements) {
    const plat = String(s.platform || 'coupang') === 'baemin' ? 'baemin' : 'coupang';
    for (const r of s.riders || []) {
      const id = String(r.matchedRiderId || '').trim();
      if (!id) continue;
      map.set(`${id}:${plat}:${s.id}`, {
        driverId: id,
        platform: plat,
        settlementId: s.id,
        region: s.region,
        weeklyOrderCount: Number(r.weeklyOrderCount || 0),
        deliveryFee: Number(r.amounts?.deliveryFee || 0),
        rider: r
      });
    }
  }
  return map;
}

function findSheetRider(index, driverId, platform, settlementIds = []) {
  const p = platform === 'baemin' ? 'baemin' : 'coupang';
  for (const sid of settlementIds) {
    if (!sid) continue;
    const hit = index.get(`${driverId}:${p}:${sid}`);
    if (hit) return hit;
  }
  for (const [key, val] of index.entries()) {
    if (val.driverId === driverId && val.platform === p) return val;
  }
  return null;
}

function isCountPerOrderRule(rule) {
  if (!rule) return false;
  const type = rule.type || 'count_per_order';
  return type === 'count_per_order';
}

function recalcRowAmount(row, rule, engine, settings, rejections, sheet, platform) {
  if (!isCountPerOrderRule(rule)) return null;
  const weeklyCalls = Number(sheet.weeklyOrderCount || 0);
  if (weeklyCalls <= 0) return null;

  const storedCalls = platform === 'coupang'
    ? Number(row.coupangCallCount ?? row.callCount ?? 0)
    : platform === 'baemin'
      ? Number(row.baeminCallCount ?? row.callCount ?? 0)
      : Number(row.callCount ?? 0);

  if (storedCalls === weeklyCalls) return null;

  const rate = rejections.getRateForWeek(sheet.driverId, WEEK, platform);
  const riderData = {
    driverId: sheet.driverId,
    name: row.driverName || row.riderName || '',
    platform,
    totalOrders: weeklyCalls,
    platformRate: rate === null || rate === undefined ? null : Number(rate),
    rateLabel: platform === 'baemin' ? '수락률' : '거절율',
    dailyOrders: {},
    deliveryAmount: sheet.deliveryFee,
    deliveryFees: [],
    selectedPromotionRuleId: rule.id,
    selectedPromotionName: rule.name,
    uploadDays: 0,
    weekStart: WEEK,
    weekEnd: addDays(WEEK, 6),
    ignoreMissingRates: false
  };

  const result = engine.calculatePromotionForRider(rule, riderData, settings);
  const total = Number(result.totalBonus || 0);
  const base = Number(result.basePay || result.perCallBonus || 0);
  const extra = Number(result.bonusPay || 0);

  return {
    weeklyCalls,
    storedCalls,
    total,
    base,
    extra,
    failureReasons: result.failureReasons || [],
    appliedConditions: [
      ...(result.appliedBlockConditions || []).map(i => i.name),
      ...(result.appliedBonusConditions || []).map(i => i.name)
    ].filter(Boolean)
  };
}

(async () => {
  const env = loadModules(
    ['js/platforms.js', 'js/promotion-conditions.js', 'js/promotion-engine.js'],
    {},
    ['BremPromotionConditions', 'BremPromotionEngine', 'BremPlatforms']
  );
  const engine = env.BremPromotionEngine;
  const migrate = env.BremPromotionConditions.migrateLegacyRule;

  const { data: promoRows } = await sb.from('promotions').select('*');
  const rulesById = new Map();
  (promoRows || []).forEach(row => {
    const raw = promotionRowToRule(row);
    const migrated = migrate(raw);
    rulesById.set(row.id, {
      ...raw,
      base: migrated.base,
      blockConditions: migrated.blockConditions,
      bonusConditions: migrated.bonusConditions,
      referenceConditions: migrated.referenceConditions,
      payStartCallCount: migrated.base.payStartCallCount,
      payPerCall: migrated.base.payPerCall,
      type: raw.type || 'count_per_order'
    });
  });

  const settingsRaw = await readSetting('brem_admin_promotion_settings');
  const settings = {
    globalBlockEnabled: settingsRaw?.globalBlockEnabled === true,
    globalMinAcceptRate: Number(settingsRaw?.globalMinAcceptRate ?? 85),
    globalMaxRejectRate: Number(settingsRaw?.globalMaxRejectRate ?? 15),
    globalBlockPlatform: settingsRaw?.globalBlockPlatform || 'all',
    globalBlockApplyTo: settingsRaw?.globalBlockApplyTo || 'all'
  };

  const direct = await readSetting('brem_admin_weekly_settlements_direct');
  const weekSettlements = (Array.isArray(direct) ? direct : [])
    .filter(s => String(s.startDate || '').slice(0, 10) === WEEK);
  const riderIndex = buildRiderIndex(weekSettlements);

  const { data: rejectRows } = await sb.from('admin_rejection_rates')
    .select('driver_id,platform,rate,week_start')
    .eq('week_start', WEEK);
  const rejections = {
    getRateForWeek(driverId, weekStart, platform) {
      const hit = (rejectRows || []).find(r => r.driver_id === driverId
        && String(r.week_start).slice(0, 10) === String(weekStart).slice(0, 10)
        && String(r.platform) === String(platform));
      return hit ? Number(hit.rate) : null;
    }
  };

  const { data: saved } = await sb.from('promotion_apply_results')
    .select('*')
    .eq('week_start', WEEK);

  const directSaved = (saved || []).filter(r => r.meta?.channel === 'direct');
  const changes = [];
  const updatedRecords = [];

  for (const record of directSaved) {
    const settlementIds = [
      record.settlement_id,
      record.coupang_settlement_id,
      record.baemin_settlement_id
    ].filter(Boolean);
    const rows = Array.isArray(record.rows) ? record.rows.map(r => ({ ...r })) : [];
    let recordChanged = false;

    for (const row of rows) {
      const driverId = String(row.matchedRiderId || '').trim();
      if (!driverId) continue;
      const ruleId = String(row.ruleId || '').trim();
      let rule = ruleId ? rulesById.get(ruleId) : null;
      if (!rule && row.ruleName) {
        rule = [...rulesById.values()].find(r => String(r.name || '') === String(row.ruleName || '')) || null;
      }
      if (!rule || !isCountPerOrderRule(rule)) continue;

      const applied = String(row.appliedPlatform || record.platform || '').toLowerCase();
      const side = applied === 'baemin' ? 'baemin' : (applied === 'coupang' ? 'coupang' : null);
      if (!side) continue;

      const sheet = findSheetRider(riderIndex, driverId, side, settlementIds);
      if (!sheet) continue;

      const fix = recalcRowAmount(row, rule, engine, settings, rejections, sheet, side);
      if (!fix) continue;

      const before = Number(row.totalPromotionAmount || 0);
      row.callCount = side === 'coupang'
        ? fix.weeklyCalls
        : (side === 'baemin' ? fix.weeklyCalls : row.callCount);
      if (side === 'coupang') row.coupangCallCount = fix.weeklyCalls;
      if (side === 'baemin') row.baeminCallCount = fix.weeklyCalls;
      row.basePromotionAmount = fix.base;
      row.extraPromotionAmount = fix.extra;
      row.totalPromotionAmount = fix.total;
      row.deliveryAmountTotal = sheet.deliveryFee;
      if (fix.appliedConditions.length) row.appliedConditions = fix.appliedConditions;
      row.failureReasons = fix.failureReasons;

      recordChanged = true;
      changes.push({
        name: row.driverName || row.riderName,
        platform: side,
        region: record.region?.slice(0, 30),
        calls: `${fix.storedCalls} → ${fix.weeklyCalls}`,
        amount: `${before.toLocaleString('ko-KR')} → ${fix.total.toLocaleString('ko-KR')}`
      });
    }

    if (recordChanged) {
      const summary = { ...(record.summary || {}) };
      summary.totalPromotionAmount = rows.reduce((s, r) => s + Number(r.totalPromotionAmount || 0), 0);
      summary.riderCount = rows.length;
      updatedRecords.push({ id: record.id, rows, summary });
    }
  }

  console.log(`=== ${WEEK} 직계약 프로모션 콜수 재계산 ===`);
  console.log(`대상 저장 ${directSaved.length}건 · 수정 행 ${changes.length}건\n`);
  changes.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  changes.forEach(c => {
    console.log(`${c.name} (${c.platform}) ${c.region}`);
    console.log(`  콜수 ${c.calls} · 프로모션 ${c.amount}`);
  });

  const choi = changes.filter(c => c.name.includes('최찬희'));
  if (choi.length) console.log('\n[최찬희]', choi.map(c => c.amount).join(', '));

  if (!APPLY) {
    console.log(`\n(dry-run) 반영: node scripts/_recalc-direct-promotion-calls.js ${WEEK} --apply`);
    console.log(`저장 건 ${updatedRecords.length}건 업데이트 예정`);
    return;
  }

  for (const rec of updatedRecords) {
    const { error } = await sb.from('promotion_apply_results').update({
      rows: rec.rows,
      summary: rec.summary,
      updated_at: new Date().toISOString()
    }).eq('id', rec.id);
    if (error) throw new Error(`${rec.id}: ${error.message}`);
    console.log(`✓ ${rec.id.slice(0, 8)}… total ${Number(rec.summary.totalPromotionAmount).toLocaleString('ko-KR')}원`);
  }
  console.log(`\n완료 ${updatedRecords.length}건. 프로모션정산등록에서 BREM프로모션 재적용이 필요할 수 있습니다.`);
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
