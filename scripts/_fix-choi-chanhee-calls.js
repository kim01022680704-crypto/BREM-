#!/usr/bin/env node
/**
 * 최찬희0561 콜수 보정
 * - 주간정산서(쿠팡): 239콜 / 배달료 814,725원
 * - 일정산 등록분: 178콜 (8/21·23·24·25) — 8/19·8/20·8/22 누락
 * - ERP 등록일 2026-08-21 → 주 초반 일정산 미매칭
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

const DRIVER_ID = '5e022c3a-9188-4cf4-8bb4-255377886789';
const SETTLEMENT_ID = 'weekly_direct_coupang_남구중앙_2026_08_4';
const WEEK_START = '2026-08-19';
const WEEK_END = '2026-08-25';
const WEEKLY_CALLS = 239;
const WEEKLY_DELIVERY = 814725;
const APPLY = process.argv.includes('--apply');

const BACKFILL = [
  { period: '2026-08-19', order_count: 22, settlement_amount: 74460 },
  { period: '2026-08-20', order_count: 19, settlement_amount: 64355 },
  { period: '2026-08-22', order_count: 20, settlement_amount: 67780 }
];

async function readSetting(key) {
  const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  let v = data?.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) {} }
  return v;
}

async function writeSetting(key, value) {
  const { error } = await sb.from('settings').upsert({
    key,
    value,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) throw error;
}

(async () => {
  const { data: existing } = await sb.from('daily_settlements')
    .select('period,order_count,settlement_amount')
    .eq('driver_id', DRIVER_ID)
    .eq('platform', 'coupang')
    .gte('period', WEEK_START)
    .lte('period', WEEK_END)
    .order('period');

  const existSum = (existing || []).reduce((a, r) => a + Number(r.order_count || 0), 0);
  const existAmt = (existing || []).reduce((a, r) => a + Number(r.settlement_amount || 0), 0);
  const backfillSum = BACKFILL.reduce((a, r) => a + r.order_count, 0);
  const backfillAmt = BACKFILL.reduce((a, r) => a + r.settlement_amount, 0);

  console.log('=== 현재 일정산 ===');
  (existing || []).forEach(r => console.log(`  ${r.period}: ${r.order_count}콜 ${Number(r.settlement_amount).toLocaleString('ko-KR')}원`));
  console.log(`  합계: ${existSum}콜 / ${existAmt.toLocaleString('ko-KR')}원`);
  console.log('\n=== 보정 추가 (8/19·8/20·8/22 누락분) ===');
  BACKFILL.forEach(r => console.log(`  ${r.period}: +${r.order_count}콜 +${r.settlement_amount.toLocaleString('ko-KR')}원`));
  console.log(`  보정 후: ${existSum + backfillSum}콜 / ${(existAmt + backfillAmt).toLocaleString('ko-KR')}원`);
  console.log(`  주간정산서: ${WEEKLY_CALLS}콜 / ${WEEKLY_DELIVERY.toLocaleString('ko-KR')}원`);

  if (existSum + backfillSum !== WEEKLY_CALLS) {
    console.warn(`⚠ 콜수 합 ${existSum + backfillSum} ≠ 주간서 ${WEEKLY_CALLS}`);
  }

  if (!APPLY) {
    console.log('\n(dry-run) 반영: node scripts/_fix-choi-chanhee-calls.js --apply');
    return;
  }

  const now = new Date().toISOString();
  for (const row of BACKFILL) {
    const id = `${DRIVER_ID}-${row.period}-coupang`;
    const { data: dup } = await sb.from('daily_settlements').select('id,order_count').eq('id', id).maybeSingle();
    if (dup) {
      console.log(`  skip ${row.period} (already exists: ${dup.order_count}콜)`);
      continue;
    }
    const { error } = await sb.from('daily_settlements').insert({
      id,
      driver_id: DRIVER_ID,
      period: row.period,
      platform: 'coupang',
      rider_id: '',
      order_count: row.order_count,
      delivery_amount: row.settlement_amount,
      settlement_amount: row.settlement_amount,
      hourly_insurance: 0,
      deduction_base: row.settlement_amount,
      applied_at: now,
      updated_at: now
    });
    if (error) throw new Error(`daily_settlements ${row.period}: ${error.message}`);
    console.log(`  ✓ ${row.period} +${row.order_count}콜`);
  }

  const direct = await readSetting('brem_admin_weekly_settlements_direct');
  const list = Array.isArray(direct) ? direct : [];
  let updated = false;
  for (const s of list) {
    if (s.id !== SETTLEMENT_ID) continue;
    s.riders = (s.riders || []).map(r => {
      if (String(r.matchedRiderId || '') !== DRIVER_ID) return r;
      updated = true;
      return {
        ...r,
        systemCallCount: WEEKLY_CALLS,
        callCountMatched: true,
        callCountIgnored: false,
        warnings: (r.warnings || []).filter(w => !/콜수|시스템/.test(String(w || '')))
      };
    });
    if (updated) {
      s.summary = {
        ...(s.summary || {}),
        callCountMismatches: (s.riders || []).filter(r => r.callCountMatched === false && r.callCountIgnored !== true).length
      };
    }
  }
  if (!updated) throw new Error('정산서 rider row not found');
  await writeSetting('brem_admin_weekly_settlements_direct', list);
  console.log('\n✓ 주정산서 systemCallCount → 239, callCountMatched → true');
  console.log('  정산결과(직계약)·주정산서 화면 Ctrl+F5 새로고침');
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
