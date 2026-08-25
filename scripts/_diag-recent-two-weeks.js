#!/usr/bin/env node
/**
 * 저번주·이번주(수~화)만 본다 — 매칭·정산 이상 점검 (읽기 전용)
 *
 * 1) 쿠팡 크롤링이 안 붙는 기사(전화 불일치)가 이 두 주에 실제로 실적을 남겼는가
 *    → 크롤링은 실적·거절률 경로다. 돈(일정산)과는 별개다.
 * 2) 이 두 주의 미매칭(settlement_unmatched) 중 등록기사인 건이 있는가
 * 3) 이 두 주에 콜수는 있는데 일정산이 없는 건이 있는가 (= 돈 누락)
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

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const normalizePhone = v => String(v || '').replace(/[^0-9]/g, '');
const stripSpaces = v => String(v || '').replace(/\s+/g, '');
const nameKey = v => stripSpaces(v).toLowerCase();
const autoId = r => {
  const n = stripSpaces(r.name);
  const t = normalizePhone(r.phone).slice(-4);
  return n && t ? `${n}${t}` : '';
};
const customId = r => {
  const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
  return stripSpaces(raw.coupangId || raw.coupangLoginKey || raw.coupangLoginId || '');
};
function baeminKey(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d+)\.0+$/);
  const v = (m ? m[1] : raw).replace(/\s+/g, '');
  if (!v) return '';
  return /^\d+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v.toLowerCase();
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

// 정산 주차는 수요일 시작
function weekStartOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const shift = (d.getUTCDay() - 3 + 7) % 7; // 3 = 수
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const today = new Date().toISOString().slice(0, 10);
const thisWeek = weekStartOf(today);
const lastWeek = addDays(thisWeek, -7);
const from = lastWeek;
const to = addDays(thisWeek, 6);

(async () => {
  console.log('='.repeat(88));
  console.log(` 저번주·이번주만 점검 (읽기 전용) — 오늘 ${today}`);
  console.log('='.repeat(88));
  console.log(`  저번주 ${lastWeek} ~ ${addDays(lastWeek, 6)}`);
  console.log(`  이번주 ${thisWeek} ~ ${addDays(thisWeek, 6)}`);

  const riders = await fetchAll('riders', 'id,name,phone,baemin_id,status,raw_data,created_at');
  const byKey = new Map();
  const byPhone = new Map();
  const byName = new Map();
  const byBaemin = new Map();
  riders.forEach(r => {
    [autoId(r), customId(r)].forEach(k => {
      const key = nameKey(k);
      if (key && !byKey.has(key)) byKey.set(key, r);
    });
    const p = normalizePhone(r.phone);
    if (p) byPhone.set(p, [...(byPhone.get(p) || []), r]);
    const nk = nameKey(r.name);
    if (nk) byName.set(nk, [...(byName.get(nk) || []), r]);
    const bk = baeminKey(r.baemin_id);
    if (bk && !byBaemin.has(bk)) byBaemin.set(bk, r);
  });

  // ---- 1) 쿠팡 크롤링 미매칭 (이 두 주에 실적이 있는 사람만) ----
  console.log('\n' + '-'.repeat(88));
  console.log('[1] 쿠팡 크롤링이 기사에 안 붙는 건 — 실적·거절률 경로 (돈 아님)');
  console.log('-'.repeat(88));

  const crawl = await fetchAll(
    'coupang_collect_items',
    'collect_date,match_key,rider_name,phone_number,parsed_json',
    q => q.eq('source_menu', 'rider_daily').gte('collect_date', from).lte('collect_date', to)
  );

  const identities = new Map();
  crawl.forEach(row => {
    const mk = nameKey(row.match_key || '');
    const phone = normalizePhone(row.phone_number || row.parsed_json?.phone || '');
    const id = mk || (phone ? `phone:${phone}` : '');
    if (!id) return;
    const prev = identities.get(id)
      || { matchKey: mk, name: row.rider_name || '', phone, rows: 0, dates: new Set() };
    if (row.rider_name) prev.name = row.rider_name;
    if (phone) prev.phone = phone;
    prev.rows += 1;
    prev.dates.add(String(row.collect_date).slice(0, 10));
    identities.set(id, prev);
  });

  const unmatched = [...identities.values()].filter(e => {
    if (e.matchKey && byKey.has(e.matchKey)) return false;
    return (byPhone.get(normalizePhone(e.phone)) || []).length !== 1;
  });
  const registeredKeyMismatch = unmatched.filter(e => (byName.get(nameKey(e.name)) || []).length > 0);
  const trulyUnregistered = unmatched.filter(e => (byName.get(nameKey(e.name)) || []).length === 0);

  console.log(`  크롤링 행 ${crawl.length} · 미매칭 인물 ${unmatched.length}명`);
  console.log(`  ├ 등록돼 있는데 전화가 달라 안 붙음 : ${registeredKeyMismatch.length}명 ★`);
  console.log(`  └ 진짜 미등록                       : ${trulyUnregistered.length}명`);

  const settlements = await fetchAll(
    'daily_settlements',
    'driver_id,period,platform,order_count,settlement_amount',
    q => q.gte('period', from).lte('period', to)
  );
  const settleByDriver = new Map();
  settlements.forEach(s => {
    settleByDriver.set(s.driver_id, [...(settleByDriver.get(s.driver_id) || []), s]);
  });

  if (registeredKeyMismatch.length) {
    console.log('\n  ★ 등록기사인데 쿠팡 전화가 달라 실적이 안 붙는 기사');
    console.log('    (돈은 일정산서로 들어가므로, 아래 「일정산」 칸이 핵심이다)');
    registeredKeyMismatch.forEach(e => {
      const cands = byName.get(nameKey(e.name)) || [];
      const dates = [...e.dates].sort();
      console.log(`\n    "${e.name}" 크롤키=${e.matchKey} 크롤전화=${e.phone}`);
      console.log(`      실적 있는 날 ${dates.length}일 (${dates[0]} ~ ${dates[dates.length - 1]}) · ${e.rows}행`);
      cands.forEach(r => {
        const rows = settleByDriver.get(r.id) || [];
        const calls = rows.reduce((a, s) => a + Number(s.order_count || 0), 0);
        const amount = rows.reduce((a, s) => a + Number(s.settlement_amount || 0), 0);
        console.log(`      등록: 전화=${r.phone} 자동키=${nameKey(autoId(r))} ${r.status}`);
        console.log(`      일정산(이 두 주): ${rows.length}건 · 콜 ${calls} · ${Math.round(amount).toLocaleString('ko-KR')}원`
          + `${rows.length ? '  → 돈은 정상 반영' : '  ← 돈도 없음 ★확인필요'}`);
      });
    });
  }

  if (trulyUnregistered.length) {
    console.log('\n  진짜 미등록 (기사 등록 필요)');
    trulyUnregistered
      .sort((a, b) => b.rows - a.rows)
      .forEach(e => console.log(`    "${e.name}" key=${e.matchKey} 전화=${e.phone} · ${e.dates.size}일 ${e.rows}행`));
  }

  // ---- 2) 이 두 주의 미매칭 정산 기록 ----
  console.log('\n' + '-'.repeat(88));
  console.log('[2] 이 두 주 정산서 미매칭 — 등록기사인데 안 붙은 건 (돈 경로)');
  console.log('-'.repeat(88));

  const um = await fetchAll(
    'settlement_unmatched',
    'kind,platform,period,week_start,raw_name,name,rider_id,order_count,coupang_login_key,baemin_user_id,saved_at',
    q => q.gte('period', from).lte('period', to)
  );
  console.log(`  이 두 주 미매칭 기록 ${um.length}건`);

  const flagged = [];
  um.forEach(row => {
    const isBaemin = String(row.platform || '').toLowerCase() === 'baemin';
    let hit = null;
    if (isBaemin) {
      const bk = baeminKey(row.rider_id || row.baemin_user_id);
      if (bk && byBaemin.has(bk)) hit = byBaemin.get(bk);
    } else {
      const ck = nameKey(row.raw_name || row.name || row.coupang_login_key);
      if (ck && byKey.has(ck)) hit = byKey.get(ck);
    }
    if (!hit) {
      const list = byName.get(nameKey(row.name || row.raw_name)) || [];
      if (list.length === 1) hit = list[0];
    }
    if (hit) flagged.push({ row, hit });
  });

  if (!flagged.length) {
    console.log('  등록기사인데 미매칭으로 남은 건: 없음');
  } else {
    console.log(`  ★ 등록기사인데 미매칭으로 남은 건 ${flagged.length}건`);
    flagged
      .sort((a, b) => Number(b.row.order_count || 0) - Number(a.row.order_count || 0))
      .forEach(({ row, hit }) => {
        const period = String(row.period).slice(0, 10);
        const platform = String(row.platform || '').toLowerCase();
        const has = (settleByDriver.get(hit.id) || []).some(
          s => String(s.period).slice(0, 10) === period && String(s.platform || '').toLowerCase() === platform
        );
        console.log(`    ${period} ${platform.padEnd(7)} "${hit.name}" 콜 ${row.order_count}`
          + ` · 정산서표기="${row.raw_name || row.name}" · 일정산 ${has ? '있음' : '없음 ★'}`);
      });
  }

  // ---- 3) 이 두 주 콜수-일정산 불일치 ----
  console.log('\n' + '-'.repeat(88));
  console.log('[3] 이 두 주 콜수는 있는데 일정산이 없는 건 (돈 누락)');
  console.log('-'.repeat(88));

  const calls = await fetchAll(
    'admin_calls',
    'driver_id,date,platform,count',
    q => q.gte('date', from).lte('date', to)
  );
  const settleKey = new Set(settlements.map(
    s => `${s.driver_id}|${String(s.period).slice(0, 10)}|${String(s.platform || '').toLowerCase()}`
  ));
  const riderById = new Map(riders.map(r => [r.id, r]));
  const gaps = calls.filter(c =>
    Number(c.count || 0) > 0
    && !settleKey.has(`${c.driver_id}|${String(c.date).slice(0, 10)}|${String(c.platform || '').toLowerCase()}`)
  );

  console.log(`  콜수 기록 ${calls.length}건 · 일정산 ${settlements.length}건`);
  if (!gaps.length) {
    console.log('  콜수가 있는데 일정산이 없는 건: 없음');
  } else {
    console.log(`  ★ ${gaps.length}건`);
    gaps
      .sort((a, b) => Number(b.count) - Number(a.count))
      .slice(0, 40)
      .forEach(c => {
        const r = riderById.get(c.driver_id);
        console.log(`    ${String(c.date).slice(0, 10)} ${String(c.platform).padEnd(7)}`
          + ` "${r?.name || '(기사없음)'}" 콜 ${String(c.count).padStart(4)}`);
      });
    if (gaps.length > 40) console.log(`    … 외 ${gaps.length - 40}건`);
  }
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});
