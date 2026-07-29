/**
 * AC 기준 전환이 과거 데이터를 소급 변경하지 않았는지 확인 (읽기 전용).
 *
 * 확인할 것:
 *   1) 기존 daily_settlements 행의 deduction_base 가 전부 0 인가
 *      (0 = "AC 없음" 이므로 계산이 종전 AJ 기준으로 유지된다)
 *   2) 그 행들의 공제·실지급액이 전환 전 값과 한 원도 다르지 않은가
 *
 * 실제 서버 계산 함수를 그대로 떼어와 쓴다. 검증용으로 식을 다시 적으면
 * 서버가 틀렸을 때 검증도 같이 틀려서 아무것도 못 잡는다.
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
    const eq = t.indexOf('='); if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const EMP_RATE = 0.008;
const INDUSTRIAL_RATE = 0.0088;
const WITHHOLDING_RATE = 0.033;

// 전환 전 계산: 세 공제가 모두 정산금액(AJ) 기준이었다.
function payoutBefore(row) {
  const settlementAmount = Math.max(0, Math.round(Number(row.settlement_amount || 0)));
  const hourlyInsurance = Math.max(0, Math.round(Number(row.hourly_insurance || 0)));
  const employmentInsurance = Math.floor(settlementAmount * EMP_RATE);
  const industrialAccidentInsurance = Math.floor(settlementAmount * INDUSTRIAL_RATE);
  const withholdingTax = Math.floor(settlementAmount * WITHHOLDING_RATE);
  const deductionTotal = employmentInsurance + industrialAccidentInsurance + withholdingTax + hourlyInsurance;
  return { withholdingTax, employmentInsurance, industrialAccidentInsurance, netPay: settlementAmount - deductionTotal };
}

// 전환 후 계산: AC(deduction_base)가 있으면 그 기준, 없으면(0) 정산금액 기준.
function payoutAfter(row) {
  const settlementAmount = Math.max(0, Math.round(Number(row.settlement_amount || 0)));
  const hourlyInsurance = Math.max(0, Math.round(Number(row.hourly_insurance || 0)));
  const deductionBase = Math.max(0, Math.round(Number(row.deduction_base || 0))) || settlementAmount;
  const employmentInsurance = Math.floor(deductionBase * EMP_RATE);
  const industrialAccidentInsurance = Math.floor(deductionBase * INDUSTRIAL_RATE);
  const withholdingTax = Math.floor(deductionBase * WITHHOLDING_RATE);
  const deductionTotal = employmentInsurance + industrialAccidentInsurance + withholdingTax + hourlyInsurance;
  return { withholdingTax, employmentInsurance, industrialAccidentInsurance, netPay: settlementAmount - deductionTotal };
}

async function fetchAll(table, select) {
  const size = 1000;
  const out = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + size - 1);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

(async () => {
  const rows = await fetchAll(
    'daily_settlements',
    'id,driver_id,period,platform,settlement_amount,deduction_base,hourly_insurance'
  );
  console.log(`\n일정산 행 ${rows.length.toLocaleString()}건 검사\n`);

  const withAc = rows.filter(r => Math.max(0, Math.round(Number(r.deduction_base || 0))) > 0);
  console.log(`  AC(deduction_base) 들어간 행 : ${withAc.length.toLocaleString()}건`);
  console.log(`  AC 없는 기존 행              : ${(rows.length - withAc.length).toLocaleString()}건`);

  let changed = 0;
  let diffSum = 0;
  const samples = [];
  for (const row of rows) {
    const before = payoutBefore(row);
    const after = payoutAfter(row);
    if (before.netPay !== after.netPay) {
      changed += 1;
      diffSum += after.netPay - before.netPay;
      if (samples.length < 10) samples.push({ row, before, after });
    }
  }

  console.log(`\n실지급액이 달라진 행         : ${changed.toLocaleString()}건`);
  if (changed) {
    console.log(`금액 변동 합계               : ${diffSum.toLocaleString()}원`);
    console.log('\n달라진 예시:');
    for (const s of samples) {
      console.log(`  ${s.row.period} ${s.row.platform} driver=${s.row.driver_id}`);
      console.log(`    정산금액 ${Number(s.row.settlement_amount).toLocaleString()} / AC ${Number(s.row.deduction_base).toLocaleString()}`);
      console.log(`    실지급 ${s.before.netPay.toLocaleString()} → ${s.after.netPay.toLocaleString()}`);
    }
  }

  const weeks = [...new Set(rows.map(r => String(r.period).slice(0, 10)))].sort();
  console.log(`\n검사 기간: ${weeks[0]} ~ ${weeks[weeks.length - 1]}`);

  if (changed === 0) {
    console.log('\n과거 데이터 소급 변경 없음 — 기존 행 금액 전부 그대로\n');
  } else {
    console.log('\n소급 변경 발생 — 확인 필요\n');
    process.exitCode = 1;
  }
})().catch(err => {
  console.error('\n검사 실패:', err.message, '\n');
  process.exitCode = 1;
});
