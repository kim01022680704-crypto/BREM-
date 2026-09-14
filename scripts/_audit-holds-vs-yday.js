#!/usr/bin/env node
/**
 * 홀딩 vs 어제(8/29)·오늘(8/30) 출금신청 대조 (읽기 전용)
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
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('SUPABASE 환경변수가 없습니다.');
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const YDAY = '2026-08-29';
const TODAY = '2026-08-30';

function money(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;
}
function dateKey(item) {
  return String(item.requestDate || item.createdAt || '').slice(0, 10);
}
function completedKey(item) {
  return String(item.completedAt || item.updatedAt || '').slice(0, 10);
}
async function setting(key) {
  const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  let value = data?.value ?? null;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (_) {}
  }
  return value;
}

(async () => {
  const [holdsRaw, requestsRaw] = await Promise.all([
    setting('brem_payroll_daily_settlement_holds_v1'),
    setting('brem_payroll_withdrawal_requests_v1')
  ]);
  const holds = (Array.isArray(holdsRaw) ? holdsRaw : []).filter(h => Number(h.amount) > 0);
  const requests = Array.isArray(requestsRaw) ? requestsRaw : [];

  const holdIds = new Set(holds.map(h => String(h.driverId)));
  const ydayReqs = requests.filter(r => dateKey(r) === YDAY && r.status !== 'cancelled');
  const todayReqs = requests.filter(r => dateKey(r) === TODAY && r.status !== 'cancelled');

  function sumByDriver(list, pred) {
    const map = new Map();
    list.filter(pred || (() => true)).forEach(item => {
      const id = String(item.driverId || '');
      const cur = map.get(id) || { amount: 0, count: 0, names: item.driverName, status: [] };
      cur.amount += Math.round(Number(item.amount || 0));
      cur.count += 1;
      cur.names = item.driverName || cur.names;
      cur.status.push(item.status);
      map.set(id, cur);
    });
    return map;
  }

  const ydayAll = sumByDriver(ydayReqs);
  const ydayDone = sumByDriver(ydayReqs, r => r.status === 'completed');
  const todayAll = sumByDriver(todayReqs);
  const todayDone = sumByDriver(todayReqs, r => r.status === 'completed');
  const todayPending = sumByDriver(todayReqs, r => r.status === 'pending');

  const ids = new Set([
    ...holdIds,
    ...ydayAll.keys(),
    ...todayAll.keys()
  ]);

  const { data: riders } = await sb
    .from('riders')
    .select('id,name,phone')
    .in('id', [...ids]);
  const riderMap = new Map((riders || []).map(r => [String(r.id), r]));

  const rows = [...ids].map(id => {
    const hold = holds.find(h => String(h.driverId) === id);
    const rider = riderMap.get(id);
    const y = ydayAll.get(id) || { amount: 0, count: 0 };
    const yd = ydayDone.get(id) || { amount: 0, count: 0 };
    const t = todayAll.get(id) || { amount: 0, count: 0 };
    const td = todayDone.get(id) || { amount: 0, count: 0 };
    const tp = todayPending.get(id) || { amount: 0, count: 0 };
    const holdAmt = Math.round(Number(hold?.amount || 0));
    const vsYday = holdAmt - y.amount;
    let bucket = '홀딩없음';
    if (holdAmt > 0 && y.amount <= 0) bucket = '어제신청없음';
    else if (holdAmt > 0 && vsYday === 0) bucket = '어제금액일치';
    else if (holdAmt > 0 && vsYday !== 0) bucket = '어제금액불일치';
    let todayTag = '오늘신청없음';
    if (t.amount > 0) {
      if (holdAmt === 0) todayTag = '오늘만있음';
      else if (holdAmt > t.amount) todayTag = '홀딩>오늘신청';
      else if (holdAmt < t.amount) todayTag = '홀딩<오늘신청';
      else todayTag = '홀딩=오늘신청';
    }
    return {
      driverId: id,
      name: hold?.driverName || y.names || t.names || rider?.name || '',
      phone: rider?.phone || '',
      hold: holdAmt,
      yday: y.amount,
      ydayDone: yd.amount,
      ydayCount: y.count,
      today: t.amount,
      todayDone: td.amount,
      todayPending: tp.amount,
      todayCount: t.count,
      vsYday,
      bucket,
      todayTag
    };
  }).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));

  const held = rows.filter(r => r.hold > 0);
  const summary = {
    holdCount: held.length,
    holdTotal: held.reduce((s, r) => s + r.hold, 0),
    ydayMatch: held.filter(r => r.bucket === '어제금액일치').length,
    ydayMismatch: held.filter(r => r.bucket === '어제금액불일치'),
    ydayMissing: held.filter(r => r.bucket === '어제신청없음'),
    noToday: held.filter(r => r.today === 0),
    holdGtToday: held.filter(r => r.today > 0 && r.hold > r.today),
    holdLtToday: held.filter(r => r.today > 0 && r.hold < r.today),
    holdEqToday: held.filter(r => r.today > 0 && r.hold === r.today),
    ydayNoHold: rows.filter(r => r.hold === 0 && r.yday > 0)
  };

  const out = { YDAY, TODAY, summary: {
    holdCount: summary.holdCount,
    holdTotal: summary.holdTotal,
    ydayMatch: summary.ydayMatch,
    ydayMismatch: summary.ydayMismatch.length,
    ydayMissing: summary.ydayMissing.length,
    noToday: summary.noToday.length,
    holdGtToday: summary.holdGtToday.length,
    holdLtToday: summary.holdLtToday.length,
    holdEqToday: summary.holdEqToday.length,
    ydayNoHold: summary.ydayNoHold.length
  }, rows: held, ydayNoHold: summary.ydayNoHold };
  fs.writeFileSync(path.join(__dirname, '..', 'logs', 'audit-holds-vs-yday.json'), JSON.stringify(out, null, 2));

  console.log('=== 요약 ===');
  console.log(JSON.stringify(out.summary, null, 2));
  console.log('\n=== 홀딩 vs 어제신청 ===');
  held.forEach(r => {
    console.log([
      r.name,
      `홀딩 ${money(r.hold)}`,
      `어제신청 ${money(r.yday)}(${r.ydayCount}건)`,
      `차이 ${money(r.vsYday)}`,
      r.bucket,
      `오늘신청 ${money(r.today)} /완료 ${money(r.todayDone)}`,
      r.todayTag
    ].join(' | '));
  });
  if (summary.ydayNoHold.length) {
    console.log('\n=== 어제 신청 있는데 홀딩 없음 ===');
    summary.ydayNoHold.forEach(r => {
      console.log(`${r.name} | 어제 ${money(r.yday)} | 오늘 ${money(r.today)}`);
    });
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
