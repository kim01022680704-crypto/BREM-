#!/usr/bin/env node
/**
 * "콜수는 있는데 일정산이 없는 건"이 실제로 급여에서 빠졌는가 (읽기 전용)
 *
 * _diag-unmatched-vs-registered.js 가 찾아낸 건들을 그대로 재현한 뒤,
 * 각 건을 주정산서·콜수·급여명세서와 교차 대조해서 돈이 실제로 빠졌는지 가른다.
 *
 * 판정
 *   [지급됨]   그 주 주정산서에 그 기사가 들어가 있다 → 주급은 나갔고 일정산 상세만 없다
 *   [미지급]   주정산서에도 없다 → 그 날 일한 대가가 어디에도 안 들어갔다
 *
 * 금액은 같은 날·같은 플랫폼 일정산의 건당 평균으로 추정한다(정확한 청구액이 아님).
 *
 * 쓰기 없음.
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

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE env 필요');
  process.exit(2);
}
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ---- 매칭 키 규칙 (js/driver-utils.js · js/settlement-client.js 와 동일) ----
const normalizePhone = v => String(v || '').replace(/[^0-9]/g, '');
const stripSpaces = v => String(v || '').trim().replace(/\s+/g, '');
const coupangKey = v => stripSpaces(v);
const nameKey = v => String(v || '').replace(/\s+/g, '').toLowerCase();

function makeLoginId(row) {
  return `${String(row?.name || '').replace(/\s/g, '')}${normalizePhone(row?.phone).slice(-4)}`;
}
function erpCoupangId(row) {
  const raw = row?.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  const custom = String(raw.coupangLoginKey || raw.coupangId || raw.coupangLoginId || '').trim().replace(/\s/g, '');
  return custom || makeLoginId(row);
}
function baeminKey(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d+)\.0+$/);
  const v = (m ? m[1] : raw).replace(/\s+/g, '');
  if (!v) return '';
  return /^\d+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v.toLowerCase();
}

async function fetchAll(table, columns) {
  const size = 1000;
  const out = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');

(async () => {
  console.log('='.repeat(90));
  console.log(' 콜수는 있는데 일정산이 없는 건 — 급여까지 빠졌는가 (읽기 전용)');
  console.log('='.repeat(90));

  const riders = await fetchAll('riders', 'id,name,phone,baemin_id,status,raw_data,created_at');
  const unmatched = await fetchAll(
    'settlement_unmatched',
    'id,kind,platform,period,week_start,raw_name,name,rider_id,order_count,coupang_login_key,baemin_user_id,saved_at'
  );
  const settlements = await fetchAll('daily_settlements', 'id,driver_id,period,platform,order_count,delivery_amount,settlement_amount');
  const weeklies = await fetchAll('weekly_settlements', 'id,platform,region,start_date,end_date,riders');
  const calls = await fetchAll('admin_calls', 'id,driver_id,date,platform,count');
  const slipLines = await fetchAll('payroll_slip_lines', 'id,driver_id,rider_name,pay_month,gross_pay,net_pay,raw_data');

  console.log(`\n기사 ${riders.length} · 미매칭 ${unmatched.length} · 일정산 ${settlements.length}`
    + ` · 주정산서 ${weeklies.length} · 콜수 ${calls.length} · 급여줄 ${slipLines.length}\n`);

  // ---- 1단계: 34건 재현 ----
  const byCoupang = new Map();
  const byBaemin = new Map();
  const byName = new Map();
  riders.forEach(r => {
    const ck = coupangKey(erpCoupangId(r));
    if (ck && !byCoupang.has(ck)) byCoupang.set(ck, r);
    const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
    const stored = coupangKey(raw.coupangId || raw.coupangLoginId || raw.loginId);
    if (stored && !byCoupang.has(stored)) byCoupang.set(stored, r);
    const bk = baeminKey(r.baemin_id);
    if (bk && !byBaemin.has(bk)) byBaemin.set(bk, r);
    const nk = nameKey(r.name);
    if (nk) byName.set(nk, [...(byName.get(nk) || []), r]);
  });

  const suspects = [];
  unmatched.forEach(row => {
    const isBaemin = String(row.platform || '').toLowerCase() === 'baemin';
    let hit = null;
    if (isBaemin) {
      const bk = baeminKey(row.rider_id || row.baemin_user_id);
      if (bk && byBaemin.has(bk)) hit = byBaemin.get(bk);
    } else {
      const ck = coupangKey(row.raw_name || row.name || row.coupang_login_key);
      if (ck && byCoupang.has(ck)) hit = byCoupang.get(ck);
    }
    if (!hit) {
      const nk = nameKey(row.name || row.raw_name);
      const list = nk ? (byName.get(nk) || []) : [];
      if (list.length === 1) hit = list[0];
    }
    if (!hit) return;
    // 미매칭 기록 당시 이미 등록돼 있었던 건만 (이후 가입은 당시 진짜 미가입)
    const savedAt = String(row.saved_at || '');
    const createdAt = String(hit.created_at || '');
    if (!savedAt || !createdAt || createdAt > savedAt) return;
    suspects.push({ row, hit });
  });

  const settledKey = new Set(settlements.map(
    s => `${s.driver_id}|${String(s.period).slice(0, 10)}|${String(s.platform || '').toLowerCase()}`
  ));
  const riderById = new Map(riders.map(r => [r.id, r]));
  const settleByDatePlatform = new Map();
  settlements.forEach(s => {
    const k = `${String(s.period).slice(0, 10)}|${String(s.platform || '').toLowerCase()}`;
    settleByDatePlatform.set(k, [...(settleByDatePlatform.get(k) || []), s]);
  });

  const targets = [];
  suspects.forEach(({ row, hit }) => {
    const period = String(row.period || '').slice(0, 10);
    const platform = String(row.platform || '').toLowerCase();
    const callCount = Number(row.order_count || 0);
    if (!period || callCount <= 0) return;
    if (settledKey.has(`${hit.id}|${period}|${platform}`)) return;
    // 동명이인·중복등록으로 다른 레코드에 들어간 건은 제외 (돈 빠짐 아님)
    const sameDay = settleByDatePlatform.get(`${period}|${platform}`) || [];
    const nk = nameKey(hit.name);
    const dup = sameDay.find(s => {
      const r = riderById.get(s.driver_id);
      return r && r.id !== hit.id && nameKey(r.name) === nk;
    });
    if (dup) return;
    targets.push({ row, hit, period, platform, callCount });
  });

  console.log(`대상: 콜수 있는데 일정산 없는 건 ${targets.length}건\n`);
  if (!targets.length) {
    console.log('해당 건이 없습니다.');
    return;
  }

  // ---- 2단계: 교차 대조용 색인 ----
  // 주정산서: 기간이 그 날짜를 덮고 플랫폼이 같은 것 중, riders[] 에 기사가 있는지
  const weeklyIndex = weeklies.map(w => ({
    id: w.id,
    platform: String(w.platform || '').toLowerCase(),
    region: w.region || '',
    start: String(w.start_date || '').slice(0, 10),
    end: String(w.end_date || '').slice(0, 10),
    riderIds: new Set(
      (Array.isArray(w.riders) ? w.riders : [])
        .map(r => String(r?.matchedRiderId || '').trim())
        .filter(Boolean)
    ),
    riderNames: new Set(
      (Array.isArray(w.riders) ? w.riders : [])
        .map(r => nameKey(r?.driverName || r?.riderName || r?.originalName))
        .filter(Boolean)
    )
  }));

  const callKey = new Set(calls.map(
    c => `${c.driver_id}|${String(c.date).slice(0, 10)}|${String(c.platform || '').toLowerCase()}`
  ));

  const slipsByDriver = new Map();
  slipLines.forEach(l => {
    const id = String(l.driver_id || '').trim();
    if (!id) return;
    slipsByDriver.set(id, [...(slipsByDriver.get(id) || []), l]);
  });

  // 같은 날·같은 플랫폼 건당 평균 정산액 (금액 규모 추정용)
  function perCallAverage(period, platform) {
    const rows = (settleByDatePlatform.get(`${period}|${platform}`) || [])
      .filter(s => Number(s.order_count) > 0 && Number(s.settlement_amount) > 0);
    if (!rows.length) return 0;
    const totalAmount = rows.reduce((a, s) => a + Number(s.settlement_amount || 0), 0);
    const totalCalls = rows.reduce((a, s) => a + Number(s.order_count || 0), 0);
    return totalCalls > 0 ? totalAmount / totalCalls : 0;
  }

  // ---- 3단계: 건별 판정 ----
  const results = targets.map(t => {
    const covering = weeklyIndex.filter(w =>
      w.platform === t.platform && w.start && w.end && w.start <= t.period && t.period <= w.end
    );
    const inWeeklyById = covering.filter(w => w.riderIds.has(t.hit.id));
    const inWeeklyByName = covering.filter(w => w.riderNames.has(nameKey(t.hit.name)));
    const callsApplied = callKey.has(`${t.hit.id}|${t.period}|${t.platform}`);
    const month = t.period.slice(0, 7);
    const slips = (slipsByDriver.get(t.hit.id) || []).filter(l => {
      const raw = l.raw_data && typeof l.raw_data === 'object' ? l.raw_data : {};
      const ws = String(raw.settlementWeekStart || '').slice(0, 10);
      if (ws) return ws <= t.period && t.period <= ws.slice(0, 8) + String(Number(ws.slice(8)) + 6).padStart(2, '0');
      return String(l.pay_month || '').slice(0, 7) === month;
    });
    const avg = perCallAverage(t.period, t.platform);
    return {
      ...t,
      coveringWeeklies: covering.length,
      inWeeklyById: inWeeklyById.length,
      inWeeklyByName: inWeeklyByName.length,
      callsApplied,
      slipCount: slips.length,
      estimate: Math.round(avg * t.callCount)
    };
  });

  const paidViaWeekly = results.filter(r => r.inWeeklyById > 0 || r.inWeeklyByName > 0);
  const noWeeklyAtAll = results.filter(r => r.coveringWeeklies === 0);
  const missingInWeekly = results.filter(r => r.coveringWeeklies > 0 && r.inWeeklyById === 0 && r.inWeeklyByName === 0);

  console.log('[판정 요약]');
  console.log(`  ✔ 그 주 주정산서에 기사가 들어가 있음 (주급 지급됨)   : ${paidViaWeekly.length}건`);
  console.log(`  ✗ 주정산서는 있는데 그 기사가 없음 (미지급 의심)      : ${missingInWeekly.length}건`);
  console.log(`  ? 그 날짜를 덮는 주정산서 자체가 없음 (판정 불가)     : ${noWeeklyAtAll.length}건`);

  const fmt = r => `    ${r.period} ${String(r.platform).padEnd(7)} "${r.hit.name}" (${r.hit.status})`
    + ` · 콜 ${String(r.callCount).padStart(4)}`
    + ` · 추정 ${won(r.estimate).padStart(9)}원`
    + ` · 콜수반영 ${r.callsApplied ? 'O' : 'X'}`
    + ` · 급여줄 ${r.slipCount}`
    + ` · 정산서표기="${r.row.raw_name || r.row.name}"`;

  if (missingInWeekly.length) {
    console.log('\n★★ 미지급 의심 — 주정산서에도 그 기사가 없다 ★★');
    missingInWeekly.sort((a, b) => b.estimate - a.estimate).forEach(r => console.log(fmt(r)));
    console.log(`\n  추정 합계: ${won(missingInWeekly.reduce((a, r) => a + r.estimate, 0))}원`
      + ` · 콜수 합계 ${missingInWeekly.reduce((a, r) => a + r.callCount, 0)}`);
  }

  if (noWeeklyAtAll.length) {
    console.log('\n[판정 불가] 그 날짜를 덮는 주정산서가 DB에 없다');
    noWeeklyAtAll.sort((a, b) => b.callCount - a.callCount).forEach(r => console.log(fmt(r)));
  }

  if (paidViaWeekly.length) {
    console.log('\n[지급됨] 주정산서에 포함 — 일정산 상세만 빠졌다');
    paidViaWeekly.sort((a, b) => b.callCount - a.callCount).forEach(r => console.log(fmt(r)));
  }

  console.log('\n[결론]');
  if (!missingInWeekly.length && !noWeeklyAtAll.length) {
    console.log('  전부 주정산서에 포함돼 있다. 돈은 나갔고, 일정산 상세(콜수·배달료)만 누락이다.');
  } else {
    console.log(`  실제 확인이 필요한 건: 미지급 의심 ${missingInWeekly.length}건`
      + ` + 판정 불가 ${noWeeklyAtAll.length}건`);
    console.log('  ※ 추정액은 같은 날 건당 평균 × 콜수이며, 정확한 청구액이 아니다.');
  }
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});
