#!/usr/bin/env node
/**
 * 주차별 기타지급 추적 (읽기 전용)
 *
 * 사용: node scripts/_diag-week-other-trace.js 2026-09-23 [2026-09-16 ...]
 *
 * 한 주에 대해 세 군데를 기사 단위로 맞대본다.
 *   1) 조정값 저장소 other  (settings brem_admin_direct_settlement_adjustments_v1)
 *      - 일괄등록분과 마이너스 일괄맞추기분이 같은 칸에 섞여 있다.
 *   2) 소급분 기록         (settings brem_admin_direct_retro_adjustments_v1)
 *      - 마이너스 일괄맞추기가 얹은 그로스업 금액
 *   3) 반영된 급여명세서   (payroll_slip_lines raw_data.payslip.other)
 *      - 합산(주 전체) 반영은 정산서 id 가 combined-… 이므로 기사·플랫폼 단위로 합쳐 비교한다.
 *
 * 저장소 other − 소급분 그로스업 = 일괄등록·팝업으로 넣은 순수 기타지급.
 * 이 값이 0 인 기사뿐이면 일괄등록분이 저장소에 없다(저장 안 됐거나 덮어써짐).
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
const RETRO_KEY = 'brem_admin_direct_retro_adjustments_v1';
const WEEKLY_KEY = 'brem_admin_weekly_settlements_direct';

const n = v => Math.round(Number(v || 0)) || 0;
const fmt = v => n(v).toLocaleString('ko-KR');
const kst = iso => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');
};

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

// 부분2·3 정산서는 시작일이 주중이라, 시작일이 수~화 안에 들면 같은 주로 본다.
function inWeek(s, week) {
  const start = String(s.startDate || '').slice(0, 10);
  if (!start) return false;
  const end = new Date(`${week}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return start >= week && start <= end.toISOString().slice(0, 10);
}

(async () => {
  const weeks = process.argv.slice(2).filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (!weeks.length) weeks.push('2026-09-23', '2026-09-16');

  const [adj, retro, weekly] = await Promise.all([
    readSetting(ADJ_KEY), readSetting(RETRO_KEY), readSetting(WEEKLY_KEY)
  ]);
  const blob = adj.value && typeof adj.value === 'object' ? adj.value : {};
  const retroAll = retro.value && typeof retro.value === 'object' ? retro.value : {};
  const settlements = Array.isArray(weekly.value) ? weekly.value : [];

  console.log('='.repeat(96));
  console.log(' 주차별 기타지급 추적 (읽기 전용)');
  console.log(`  조정값 저장소 최종수정 ${kst(adj.updatedAt)} KST · 소급분 최종수정 ${kst(retro.updatedAt)} KST`);
  console.log('='.repeat(96));

  // 기타지급이 붙어 있지만 현재 정산서 목록에 없는 id (재업로드/삭제로 고아가 된 것)
  const knownIds = new Set(settlements.map(s => String(s.id)));
  const orphan = Object.entries(blob.other || {})
    .filter(([id, m]) => !knownIds.has(id) && Object.keys(m || {}).length)
    .map(([id, m]) => {
      const list = Object.values(m || {});
      const last = list.map(e => e?.updatedAt || '').sort().pop();
      return { id, count: list.length, total: list.reduce((s, e) => s + n(e?.amount), 0), last };
    })
    .sort((a, b) => String(b.last).localeCompare(String(a.last)));

  for (const week of weeks) {
    console.log(`\n${'#'.repeat(96)}\n# 정산주 ${week}(수)\n${'#'.repeat(96)}`);
    const weekSettlements = settlements.filter(s => inWeek(s, week));
    const retroWeek = retroAll[week] && typeof retroAll[week] === 'object' ? retroAll[week] : {};
    const retroByDriver = new Map();
    Object.values(retroWeek).forEach(r => {
      const key = `${r.driverId}|${r.platform || ''}`;
      retroByDriver.set(key, (retroByDriver.get(key) || 0) + n(r.grossUpAmount || r.amount));
    });

    console.log(`\n[1] 정산서별 저장소 기타지급  (정산서 ${weekSettlements.length}건)`);
    const storeByDriver = new Map(); // `${driverId}|${platform}` → { total, pure, name }
    weekSettlements.forEach(s => {
      const platform = s.platform === 'coupang' ? 'coupang' : 'baemin';
      const other = (blob.other || {})[s.id] || {};
      const promo = (blob.promotion || {})[s.id] || {};
      const entries = Object.entries(other);
      const total = entries.reduce((sum, [, e]) => sum + n(e?.amount), 0);
      const times = entries.map(([, e]) => e?.updatedAt || '').filter(Boolean).sort();
      const byMinute = new Map();
      times.forEach(t => {
        const m = kst(t);
        byMinute.set(m, (byMinute.get(m) || 0) + 1);
      });
      let retroCount = 0;
      let pureCount = 0;
      let pureTotal = 0;
      entries.forEach(([driverId, e]) => {
        const key = `${driverId}|${platform}`;
        const gross = retroByDriver.get(key) || 0;
        const pure = Math.max(0, n(e?.amount) - gross);
        if (gross > 0) retroCount += 1;
        if (pure > 0) { pureCount += 1; pureTotal += pure; }
        const prev = storeByDriver.get(key) || { total: 0, pure: 0, name: e?.driverName || '' };
        prev.total += n(e?.amount);
        prev.pure += pure;
        storeByDriver.set(key, prev);
      });
      console.log(`  - ${platform.padEnd(7)} ${String(s.region || '').padEnd(10)} ${s.startDate}~${s.endDate} id=${String(s.id).slice(0, 36)}`);
      console.log(`      기타지급 ${entries.length}명 ${fmt(total)}원 · 그중 마이너스맞추기 대상 ${retroCount}명`
        + ` · 순수 기타지급(일괄/팝업) ${pureCount}명 ${fmt(pureTotal)}원 · 프로모션 ${Object.keys(promo).length}명`);
      if (byMinute.size) {
        const top = [...byMinute.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([m, c]) => `${m}(${c}명)`).join(', ');
        console.log(`      수정시각(KST) 몰린 순: ${top}`);
      }
    });

    const retroTotal = [...retroByDriver.values()].reduce((s, v) => s + v, 0);
    console.log(`\n[2] 소급분(마이너스 일괄맞추기) 기록 : ${retroByDriver.size}명 · 그로스업 합계 ${fmt(retroTotal)}원`);
    const retroTimes = Object.values(retroWeek).map(r => r.updatedAt || r.createdAt || '').filter(Boolean).sort();
    if (retroTimes.length) console.log(`    기록 시각(KST) ${kst(retroTimes[0])} ~ ${kst(retroTimes[retroTimes.length - 1])}`);

    const lines = await fetchAll(
      'payroll_slip_lines',
      'id,driver_id,rider_name,raw_data,updated_at',
      q => q.like('id', 'direct-%').eq('raw_data->>settlementWeekStart', week)
    );
    const pubByDriver = new Map();
    const pubTimes = new Map();
    lines.forEach(l => {
      const raw = l.raw_data || {};
      const ps = raw.payslip || {};
      const sid = String(raw.settlementId || '');
      const platform = raw.platform
        || (sid.startsWith('combined-coupang') ? 'coupang' : sid.startsWith('combined-baemin') ? 'baemin' : '')
        || (settlements.find(s => s.id === sid)?.platform === 'coupang' ? 'coupang' : 'baemin');
      const key = `${l.driver_id}|${platform}`;
      const prev = pubByDriver.get(key) || { other: 0, name: l.rider_name || '', lines: 0 };
      prev.other += n(ps.other);
      prev.lines += 1;
      pubByDriver.set(key, prev);
      const m = kst(l.updated_at).slice(0, 11);
      pubTimes.set(m, (pubTimes.get(m) || 0) + 1);
    });
    const pubOtherTotal = [...pubByDriver.values()].reduce((s, v) => s + v.other, 0);
    const pubOtherCount = [...pubByDriver.values()].filter(v => v.other > 0).length;
    console.log(`\n[3] 반영된 명세서 : ${lines.length}줄 · 기타지급 있는 기사 ${pubOtherCount}명 ${fmt(pubOtherTotal)}원`);
    console.log(`    반영 시각(KST, 시 단위): ${[...pubTimes.entries()].sort().map(([m, c]) => `${m}시(${c})`).join(', ')}`);

    // 반영본 기타지급 − 소급분 그로스업 = 반영 당시 들어있던 순수 기타지급
    let pubPureCount = 0;
    let pubPureTotal = 0;
    pubByDriver.forEach((v, key) => {
      const pure = Math.max(0, v.other - (retroByDriver.get(key) || 0));
      if (pure > 0) { pubPureCount += 1; pubPureTotal += pure; }
    });
    const storePureCount = [...storeByDriver.values()].filter(v => v.pure > 0).length;
    const storePureTotal = [...storeByDriver.values()].reduce((s, v) => s + v.pure, 0);

    console.log('\n[판정]');
    console.log(`  순수 기타지급(소급분 제외)  저장소 ${storePureCount}명 ${fmt(storePureTotal)}원  ↔  반영본 ${pubPureCount}명 ${fmt(pubPureTotal)}원`);

    const diffs = [];
    const keys = new Set([...storeByDriver.keys(), ...pubByDriver.keys()]);
    keys.forEach(key => {
      const s = storeByDriver.get(key);
      const p = pubByDriver.get(key);
      const st = s ? s.total : 0;
      const pt = p ? p.other : 0;
      if (st !== pt && (p || st > 0)) diffs.push({ key, name: s?.name || p?.name || '', st, pt, published: Boolean(p) });
    });
    if (diffs.length) {
      console.log(`  저장소 ≠ 반영본 기사 ${diffs.length}명 (최대 30)`);
      diffs.sort((a, b) => Math.abs(b.st - b.pt) - Math.abs(a.st - a.pt)).slice(0, 30).forEach(d => {
        console.log(`    "${d.name}" ${d.key.split('|')[1]} 저장소 ${fmt(d.st)} ↔ 반영본 ${d.published ? fmt(d.pt) : '(명세서 없음)'}`);
      });
    } else {
      console.log('  저장소와 반영본의 기타지급이 기사 단위로 모두 일치');
    }
  }

  console.log(`\n[참고] 현재 정산서 목록에 없는 정산서 id 에 붙은 기타지급 (재업로드·삭제로 고아가 된 것)`);
  if (!orphan.length) console.log('  없음');
  orphan.slice(0, 15).forEach(o => {
    console.log(`  ${o.id.slice(0, 44).padEnd(44)} ${String(o.count).padStart(4)}명 ${fmt(o.total).padStart(12)}원 · 마지막 수정 ${kst(o.last)}`);
  });
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});
