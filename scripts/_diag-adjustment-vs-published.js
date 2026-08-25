#!/usr/bin/env node
/**
 * 조정값(팝업 수정) → 급여명세서 반영 반영 여부 확인 (읽기 전용)
 *
 * 방향이 중요하다.
 *   저장소에 기타지급 185,000 이 있는데 반영된 명세서에는 0 이면
 *   → 「수정했는데 반영하니까 사라졌다」 의 정체다.
 *
 * 저장소 : settings brem_admin_direct_settlement_adjustments_v1
 * 반영본 : payroll_slip_lines (id = direct-{settlementId}-{driverId})
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

// 저장소 kind → 명세서 payslip 필드
const MAP = [
  ['other', 'other', '기타지급'],
  ['missionPay', 'missionPay', '추가지급(미션)'],
  ['leaseFee', 'leaseFee', '리스차감'],
  ['loanFee', 'loanFee', '대여차감'],
  ['promotion', 'promo', 'BREM프로모션']
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
  console.log('='.repeat(94));
  console.log(' 팝업 수정값이 급여명세서 반영에 들어갔는가 (읽기 전용)');
  console.log('='.repeat(94));

  const adj = await readSetting(ADJ_KEY);
  const blob = adj.value && typeof adj.value === 'object' ? adj.value : {};
  const weekly = await readSetting(WEEKLY_KEY);
  const settlements = Array.isArray(weekly.value) ? weekly.value : [];
  const settlementWeek = new Map();
  const settlementLabel = new Map();
  settlements.forEach(s => {
    settlementWeek.set(String(s.id), String(s.startDate || '').slice(0, 10));
    settlementLabel.set(String(s.id), `${s.platform || ''} ${s.region || ''}`.trim());
  });

  const lines = await fetchAll('payroll_slip_lines', 'id,driver_id,rider_name,raw_data,updated_at',
    q => q.like('id', 'direct-%'));
  const publishedById = new Map();
  lines.forEach(l => {
    const raw = l.raw_data && typeof l.raw_data === 'object' ? l.raw_data : {};
    const ps = raw.payslip && typeof raw.payslip === 'object' ? raw.payslip : {};
    publishedById.set(String(l.id), {
      name: l.rider_name || '',
      settlementId: String(raw.settlementId || ''),
      week: String(raw.settlementWeekStart || '').slice(0, 10),
      updatedAt: String(l.updated_at || '').slice(0, 16).replace('T', ' '),
      ps
    });
  });

  console.log(`\n조정값 저장소 최종수정 ${adj.updatedAt}`);
  console.log(`반영된 직계약 명세서 ${lines.length}건 · 직계약 정산서 ${settlements.length}건\n`);

  const notApplied = [];   // 저장소엔 있는데 반영본은 0
  const different = [];    // 둘 다 있는데 금액이 다름
  const noLine = [];       // 반영본 자체가 없음
  let matched = 0;
  let totalChecked = 0;

  MAP.forEach(([kind, psField, label]) => {
    const byKind = blob[kind] && typeof blob[kind] === 'object' ? blob[kind] : {};
    Object.entries(byKind).forEach(([settlementId, riders]) => {
      Object.entries(riders || {}).forEach(([driverId, entry]) => {
        const amount = Math.round(Number(entry?.amount || 0));
        if (amount <= 0) return;
        totalChecked += 1;
        const lineId = `direct-${settlementId}-${driverId}`;
        const line = publishedById.get(lineId);
        const week = settlementWeek.get(settlementId) || '';
        const base = {
          kind, label, settlementId, driverId, amount, week,
          name: entry?.driverName || line?.name || '',
          region: settlementLabel.get(settlementId) || '',
          source: entry?.source || '',
          updatedAt: String(entry?.updatedAt || '').slice(0, 16).replace('T', ' ')
        };
        if (!line) { noLine.push(base); return; }
        const publishedAmount = Math.round(Number(line.ps[psField] || 0));
        if (publishedAmount === amount) { matched += 1; return; }
        if (publishedAmount === 0) {
          notApplied.push({ ...base, publishedAt: line.updatedAt });
        } else {
          different.push({ ...base, publishedAmount, publishedAt: line.updatedAt });
        }
      });
    });
  });

  console.log('[결과]');
  console.log(`  검사한 조정값(금액>0)            : ${totalChecked}건`);
  console.log(`  ✔ 반영본과 금액 일치             : ${matched}건`);
  console.log(`  ★ 저장소엔 있는데 반영본은 0     : ${notApplied.length}건`);
  console.log(`  △ 둘 다 있는데 금액 다름         : ${different.length}건`);
  console.log(`  · 반영본 자체가 없음(미반영 주차) : ${noLine.length}건`);

  if (notApplied.length) {
    console.log('\n★ 저장소엔 있는데 반영본이 0 — 「수정했는데 반영하니 사라짐」 후보 ★');
    notApplied
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 40)
      .forEach(r => {
        console.log(`  ${r.week || '주차?'} ${r.label.padEnd(14)} "${r.name}" ${r.amount.toLocaleString('ko-KR')}원`
          + ` · 수정 ${r.updatedAt} · 반영 ${r.publishedAt} · ${r.region}`);
      });
    const byKind = {};
    notApplied.forEach(r => { byKind[r.label] = (byKind[r.label] || 0) + r.amount; });
    console.log('\n  종류별 합계');
    Object.entries(byKind).forEach(([k, v]) => console.log(`    ${k}: ${v.toLocaleString('ko-KR')}원`));
  }

  if (different.length) {
    console.log('\n△ 금액이 다른 건 (반영 후 수정했거나, 반영이 다른 값을 썼음)');
    different
      .sort((a, b) => Math.abs(b.amount - b.publishedAmount) - Math.abs(a.amount - a.publishedAmount))
      .slice(0, 30)
      .forEach(r => {
        console.log(`  ${r.week || '주차?'} ${r.label.padEnd(14)} "${r.name}" 저장소 ${r.amount.toLocaleString('ko-KR')}`
          + ` ↔ 반영본 ${r.publishedAmount.toLocaleString('ko-KR')} · 수정 ${r.updatedAt} · 반영 ${r.publishedAt}`);
      });
  }

  console.log('\n[해석]');
  if (!notApplied.length && !different.length) {
    console.log('  저장소의 모든 조정값이 반영본과 일치한다. 반영 과정에서 값이 빠진 흔적이 없다.');
  } else {
    console.log('  수정 시각(updatedAt)이 반영 시각보다 이르면서 반영본이 0이면,');
    console.log('  반영이 그 수정값을 못 읽고 지나간 것이다. → 반영 직전 로드 순서 문제.');
    console.log('  수정 시각이 반영보다 늦으면 정상 (반영 후 수정한 것).');
  }
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});
