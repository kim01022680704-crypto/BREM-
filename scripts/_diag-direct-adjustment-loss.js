#!/usr/bin/env node
/**
 * 정산결과 팝업에서 넣은 기타지급·추가지급·리스·대여차감이 사라졌는지 확인 (읽기 전용)
 *
 * 비교 3중
 *   A) payroll_slip_lines (급여명세서 반영 결과) raw_data.payslip  ← 반영 당시 금액
 *   B) settings brem_admin_direct_settlement_adjustments_v1        ← 조정값 원본 저장소
 *   C) weekly_settlements[].riders[].manualAdjustments             ← 미러(백업)
 *
 * A 에 금액이 있는데 B·C 둘 다 없으면 → 반영 후 사라진 것.
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

const ADJ_KEY = 'brem_admin_direct_settlement_adjustments_v1';
const WEEKLY_KEY = 'brem_admin_weekly_settlements_direct';
const KINDS = [
  ['other', '기타지급'],
  ['missionPay', '추가지급(미션)'],
  ['leaseFee', '리스차감'],
  ['loanFee', '대여차감'],
  ['promotion', 'BREM프로모션']
];

async function readSetting(key) {
  const { data, error } = await supabase.from('settings').select('value,updated_at').eq('key', key).maybeSingle();
  if (error) throw error;
  let v = data?.value ?? null;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) {} }
  return { value: v, updatedAt: data?.updated_at || '' };
}

async function fetchAll(table, columns, build) {
  const size = 1000;
  const out = [];
  for (let from = 0; ; from += size) {
    let q = supabase.from(table).select(columns).range(from, from + size - 1);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

(async () => {
  console.log('='.repeat(90));
  console.log(' 정산결과 조정값(기타지급·차감) 소실 여부 확인 (읽기 전용)');
  console.log('='.repeat(90));

  const adj = await readSetting(ADJ_KEY);
  const blob = adj.value && typeof adj.value === 'object' ? adj.value : {};
  console.log(`\n[B] 조정값 저장소 (settings) — 최종 수정 ${adj.updatedAt || '(없음)'}`);
  KINDS.forEach(([k, label]) => {
    const byKind = blob[k] && typeof blob[k] === 'object' ? blob[k] : {};
    const settlements = Object.keys(byKind).length;
    const drivers = Object.values(byKind).reduce((s, m) => s + Object.keys(m || {}).length, 0);
    console.log(`  ${label.padEnd(16)} 정산서 ${String(settlements).padStart(3)}건 · 기사 ${String(drivers).padStart(4)}명`);
  });

  // 직계약 주정산서는 settings JSON 또는 weekly_settlements 테이블에 있다. 둘 다 본다.
  let weeklyList = [];
  const weeklySetting = await readSetting(WEEKLY_KEY);
  if (Array.isArray(weeklySetting.value)) weeklyList = weeklySetting.value;
  if (!weeklyList.length) {
    const rows = await fetchAll('weekly_settlements', 'id,platform,region,start_date,end_date,riders,summary');
    weeklyList = rows.filter(r => {
      const ch = r.summary && typeof r.summary === 'object' ? r.summary.channel : '';
      return ch === 'direct';
    });
    if (!weeklyList.length) weeklyList = rows;
  }

  const mirror = new Map(); // `${settlementId}|${driverId}` → manualAdjustments
  let mirrorCount = 0;
  weeklyList.forEach(s => {
    const riders = Array.isArray(s.riders) ? s.riders : [];
    riders.forEach(r => {
      const m = r?.manualAdjustments;
      if (!m || typeof m !== 'object') return;
      const did = String(r.matchedRiderId || '').trim();
      if (!did) return;
      mirror.set(`${s.id}|${did}`, m);
      mirrorCount += 1;
    });
  });
  console.log(`\n[C] 미러(정산서 riders.manualAdjustments) : ${mirrorCount}건 · 정산서 ${weeklyList.length}건 검사`);

  // A) 반영된 급여명세서
  const lines = await fetchAll(
    'payroll_slip_lines',
    'id,driver_id,rider_name,pay_month,raw_data,updated_at',
    q => q.like('id', 'direct-%')
  );
  console.log(`\n[A] 반영된 직계약 급여명세서 : ${lines.length}건`);

  const byWeek = new Map();
  const losses = [];
  lines.forEach(line => {
    const raw = line.raw_data && typeof line.raw_data === 'object' ? line.raw_data : {};
    const ps = raw.payslip && typeof raw.payslip === 'object' ? raw.payslip : {};
    const week = String(raw.settlementWeekStart || '').slice(0, 10);
    const settlementId = String(raw.settlementId || '').trim();
    const driverId = String(line.driver_id || '').trim();
    if (!week) return;
    if (!byWeek.has(week)) byWeek.set(week, { lines: 0, withAdj: 0 });
    const bucket = byWeek.get(week);
    bucket.lines += 1;

    const published = {
      other: Math.round(Number(ps.other || 0)),
      missionPay: Math.round(Number(ps.missionPay || 0)),
      leaseFee: Math.round(Number(ps.leaseFee || 0)),
      loanFee: Math.round(Number(ps.loanFee || 0))
    };
    const hasAny = published.other > 0 || published.leaseFee > 0 || published.loanFee > 0;
    if (hasAny) bucket.withAdj += 1;

    // 조정값이 지금도 남아 있는가
    const mirrored = mirror.get(`${settlementId}|${driverId}`) || null;
    ['other', 'leaseFee', 'loanFee'].forEach(kind => {
      const amount = published[kind];
      if (amount <= 0) return;
      const store = blob[kind]?.[settlementId]?.[driverId];
      const inStore = store && Math.round(Number(store.amount || 0)) === amount;
      const inMirror = mirrored && Object.prototype.hasOwnProperty.call(mirrored, kind)
        && Math.round(Number(mirrored[kind] || 0)) === amount;
      // 리스·대여는 ERP 자동값일 수도 있어 "조정값이 없어도 정상"인 경우가 있다.
      // 기타지급(other)은 자동 계산 경로가 없어 조정값이 유일한 출처다 → 사라지면 확실한 손실.
      if (!inStore && !inMirror) {
        losses.push({
          week,
          settlementId,
          driverId,
          name: line.rider_name || '',
          kind,
          amount,
          publishedAt: String(line.updated_at || '').slice(0, 10),
          certain: kind === 'other'
        });
      }
    });
  });

  console.log('\n[주차별 반영 현황]');
  [...byWeek.keys()].sort().slice(-8).forEach(w => {
    const b = byWeek.get(w);
    console.log(`  ${w}  명세서 ${String(b.lines).padStart(4)}건 · 기타지급/차감 있는 줄 ${String(b.withAdj).padStart(4)}건`);
  });

  const certain = losses.filter(l => l.certain);
  const maybe = losses.filter(l => !l.certain);

  console.log('\n' + '='.repeat(90));
  console.log(' 판정');
  console.log('='.repeat(90));
  console.log(`  ★ 기타지급이 반영엔 있는데 조정값이 사라진 건 : ${certain.length}건  (자동 계산 경로가 없어 확실한 소실)`);
  console.log(`    리스·대여가 조정값에 없는 건               : ${maybe.length}건  (ERP 자동값일 수 있어 소실 아닐 수도)`);

  if (certain.length) {
    console.log('\n  ★ 사라진 기타지급 (최대 40건) ★');
    certain
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 40)
      .forEach(l => {
        console.log(`    ${l.week} "${l.name}" ${l.amount.toLocaleString('ko-KR')}원 · 반영일 ${l.publishedAt} · 정산서 ${l.settlementId.slice(0, 28)}`);
      });
    const total = certain.reduce((s, l) => s + l.amount, 0);
    console.log(`\n    합계 ${total.toLocaleString('ko-KR')}원 / ${certain.length}건`);
  }

  if (maybe.length) {
    const byKind = {};
    maybe.forEach(l => { byKind[l.kind] = (byKind[l.kind] || 0) + 1; });
    console.log('\n  리스·대여 (참고)');
    Object.entries(byKind).forEach(([k, n]) => console.log(`    ${k}: ${n}건`));
  }

  console.log('\n[해석]');
  if (!certain.length) {
    console.log('  반영된 기타지급은 모두 조정값 또는 미러에 남아 있다. 소실 흔적 없음.');
  } else {
    console.log('  반영 시점엔 금액이 있었지만 지금은 조정값·미러 둘 다 없다.');
    console.log('  → 반영 후 어느 시점에 조정값이 지워졌다는 뜻이다.');
    console.log('  ※ 반영을 다시 하면 이 금액들이 0으로 덮인다. 재반영 전에 복구가 필요하다.');
  }
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});
