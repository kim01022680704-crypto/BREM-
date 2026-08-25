#!/usr/bin/env node
/** 배민 일정산이 항상 없는 139명이 어디서 정산되는지 확인 (읽기 전용) */
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
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);
async function fetchAll(table, columns, build) {
  const size = 1000; const out = [];
  for (let f = 0; ; f += size) {
    let q = supabase.from(table).select(columns).range(f, f + size - 1);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}
const FROM = '2026-08-12';
const TO = '2026-08-25';
(async () => {
  const riders = await fetchAll('riders', 'id,name,status');
  const riderById = new Map(riders.map(r => [r.id, r]));

  const calls = (await fetchAll('admin_calls', 'driver_id,date,count',
    q => q.eq('platform', 'baemin').gte('date', FROM).lte('date', TO)))
    .filter(c => Number(c.count) > 0);
  const daily = await fetchAll('daily_settlements', 'driver_id,period',
    q => q.eq('platform', 'baemin').gte('period', FROM).lte('period', TO));
  const dailyKey = new Set(daily.map(d => `${d.driver_id}|${String(d.period).slice(0, 10)}`));

  const per = new Map();
  calls.forEach(c => {
    const d = String(c.date).slice(0, 10);
    const cur = per.get(c.driver_id) || { days: 0, missing: 0 };
    cur.days += 1;
    if (!dailyKey.has(`${c.driver_id}|${d}`)) cur.missing += 1;
    per.set(c.driver_id, cur);
  });
  const alwaysMissing = [...per.entries()].filter(([, v]) => v.missing === v.days).map(([id]) => id);
  const alwaysPresent = [...per.entries()].filter(([, v]) => v.missing === 0).map(([id]) => id);

  // 주정산서(브로 채널 테이블)에서 이 기간을 덮는 배민 기록
  const weeklies = await fetchAll('weekly_settlements', 'id,platform,region,start_date,end_date,riders');
  const inWindow = weeklies.filter(w => {
    const s = String(w.start_date || '').slice(0, 10);
    const e = String(w.end_date || '').slice(0, 10);
    return String(w.platform || '').toLowerCase() === 'baemin' && s && e && e >= FROM && s <= TO;
  });

  console.log(`배민 주정산서 (기간 겹치는 것) ${inWindow.length}장`);
  inWindow.forEach(w => {
    const ids = new Set((Array.isArray(w.riders) ? w.riders : [])
      .map(r => String(r?.matchedRiderId || '').trim()).filter(Boolean));
    const hitMissing = alwaysMissing.filter(id => ids.has(id)).length;
    const hitPresent = alwaysPresent.filter(id => ids.has(id)).length;
    console.log(`  ${String(w.start_date).slice(0, 10)}~${String(w.end_date).slice(0, 10)}`
      + ` · ${String(w.region || '(지역없음)').padEnd(22)} 기사 ${String(ids.size).padStart(4)}`
      + ` │ 일정산없음집단 ${String(hitMissing).padStart(3)}명 포함`
      + ` · 일정산있음집단 ${String(hitPresent).padStart(3)}명 포함`);
  });

  const allWeeklyIds = new Set();
  inWindow.forEach(w => (Array.isArray(w.riders) ? w.riders : []).forEach(r => {
    const id = String(r?.matchedRiderId || '').trim();
    if (id) allWeeklyIds.add(id);
  }));

  const coveredByWeekly = alwaysMissing.filter(id => allWeeklyIds.has(id));
  const notCovered = alwaysMissing.filter(id => !allWeeklyIds.has(id));

  console.log(`\n일정산이 항상 없는 ${alwaysMissing.length}명 중`);
  console.log(`  ✔ 배민 주정산서에 들어있음 (돈은 주정산으로 나감) : ${coveredByWeekly.length}명`);
  console.log(`  ✗ 주정산서에도 없음 (확인 필요)                  : ${notCovered.length}명`);

  if (notCovered.length) {
    // 주정산서는 8/12~8/18 주만 올라와 있다. 8/19 이후 콜은 아직 정산서가 없는 게 정상.
    const daysByDriver = new Map();
    calls.forEach(c => {
      const d = String(c.date).slice(0, 10);
      daysByDriver.set(c.driver_id, [...(daysByDriver.get(c.driver_id) || []), d]);
    });
    const rows = notCovered.map(id => {
      const days = (daysByDriver.get(id) || []).sort();
      return {
        id,
        r: riderById.get(id),
        orphan: !riderById.has(id),
        prevWeek: days.filter(d => d <= '2026-08-18'),
        thisWeek: days.filter(d => d >= '2026-08-19')
      };
    });

    const orphans = rows.filter(e => e.orphan);
    const realGap = rows.filter(e => !e.orphan && e.prevWeek.length > 0);
    const pending = rows.filter(e => !e.orphan && e.prevWeek.length === 0);

    if (realGap.length) {
      console.log('\n  ★ 진짜 확인 필요 — 8/12~8/18 주는 주정산서가 올라왔는데 그 기사가 없다');
      realGap.sort((a, b) => b.prevWeek.length - a.prevWeek.length).forEach(e => {
        console.log(`    "${e.r?.name}" ${e.r?.status} · 8/12~8/18 콜 ${e.prevWeek.length}일 (${e.prevWeek.join(', ')})`);
      });
    }
    if (pending.length) {
      console.log('\n  [정상] 8/19 이후 콜만 있음 — 그 주 주정산서를 아직 안 올렸으니 당연히 없다');
      pending.forEach(e => console.log(`    "${e.r?.name}" ${e.r?.status} · ${e.thisWeek.join(', ')}`));
    }
    if (orphans.length) {
      console.log('\n  ★ 기사 레코드가 없는 driver_id 로 콜수가 쌓여 있다 (고아 데이터)');
      orphans.forEach(e => console.log(`    ${e.id} · 콜 있는 날 ${e.prevWeek.length + e.thisWeek.length}일`
        + ` (${[...e.prevWeek, ...e.thisWeek].join(', ')})`));
    }
  }
})().catch(e => { console.error(e.message || e); process.exit(1); });
