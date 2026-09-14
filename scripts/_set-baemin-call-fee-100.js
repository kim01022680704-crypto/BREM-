#!/usr/bin/env node
/** 배민 콜수수료 100원/콜 설정 + 이번 주 직계약 배민 영향 미리보기 */
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
const FEES_KEY = 'brem_payroll_daily_settlement_fees_v1';
const DIRECT_KEY = 'brem_admin_weekly_settlements_direct';
const APPLY = process.argv.includes('--apply');
const TARGET_WEEK = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || '2026-08-19';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

async function readSetting(key) {
  const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  let v = data?.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) {} }
  return v;
}

(async () => {
  const fees = (await readSetting(FEES_KEY)) || {};
  console.log('현재 설정:', JSON.stringify(fees, null, 2));

  const direct = await readSetting(DIRECT_KEY);
  const list = Array.isArray(direct) ? direct : [];
  const weekSettlements = list.filter(s => String(s.startDate || '').slice(0, 10) === TARGET_WEEK);
  const baeminSettlements = weekSettlements.filter(s => String(s.platform || '') !== 'coupang');

  let totalCalls = 0;
  let riderCount = 0;
  baeminSettlements.forEach(s => {
    (s.riders || []).forEach(r => {
      const calls = Number(r.weeklyOrderCount || r.systemCallCount || 0);
      if (calls > 0) { totalCalls += calls; riderCount += 1; }
    });
  });

  const callFeeTotal = totalCalls * 100;
  console.log(`\n${TARGET_WEEK} 주 직계약 배민:`);
  console.log(`  정산서 ${baeminSettlements.length}건 · 기사 ${riderCount}명 · 총 콜수 ${totalCalls.toLocaleString('ko-KR')}`);
  console.log(`  콜수수료 100원 적용 시 차감 합계: ${callFeeTotal.toLocaleString('ko-KR')}원`);

  if (!APPLY) {
    console.log('\n(dry-run) 반영하려면: node scripts/_set-baemin-call-fee-100.js --apply');
    return;
  }

  const next = {
    ...fees,
    showCallFee: fees.showCallFee !== false,
    baemin: {
      ...(fees.baemin || {}),
      callFee: 100
    }
  };
  const { error } = await sb.from('settings').upsert({
    key: FEES_KEY,
    value: next,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) throw error;
  console.log('\n✓ 배민 콜수수료 100원/콜 저장 완료');
  console.log('  → 정산결과(직계약) 화면 Ctrl+F5 새로고침');
  console.log('  → 급여명세서 반영을 이미 하셨다면 다시 「급여명세서 반영」 필요');
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
