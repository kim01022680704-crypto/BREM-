#!/usr/bin/env node
/**
 * 금액 홀딩 점검 (읽기 전용)
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

const HOLDS_KEY = 'brem_payroll_daily_settlement_holds_v1';
const FEES_KEY = 'brem_payroll_daily_settlement_fees_v1';
const REQUESTS_KEY = 'brem_payroll_withdrawal_requests_v1';
const FINALIZED_KEY = 'brem_payroll_week_finalized_v1';
const EMP = 0.008;
const IND = 0.0088;
const TAX = 0.033;

function money(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;
}
function weekStartOf(dateValue) {
  const seed = String(dateValue || '').slice(0, 10);
  const date = new Date(`${seed || new Date().toISOString().slice(0, 10)}T00:00:00`);
  const day = date.getDay();
  if (day === 2) date.setDate(date.getDate() + 1);
  else date.setDate(date.getDate() - ((day - 3 + 7) % 7));
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}
function weekEndOf(weekStart) {
  const date = new Date(`${weekStart}T00:00:00`);
  date.setDate(date.getDate() + 6);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}
function erpId(rider) {
  const name = String(rider?.name || '').replace(/\s/g, '');
  const tail = String(rider?.phone || '').replace(/\D/g, '').slice(-4);
  return name && tail ? `${name}${tail}` : '';
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
function netPay(row, fees) {
  const platform = String(row.platform || '').toLowerCase() === 'baemin' ? 'baemin' : 'coupang';
  const fee = fees?.[platform] || fees?.coupang || {};
  const settlement = Math.max(0, Math.round(Number(row.settlement_amount ?? row.delivery_amount ?? 0)));
  const orders = Math.max(0, Math.round(Number(row.order_count || 0)));
  const hourly = Math.abs(Math.round(Number(row.hourly_insurance || 0)));
  const base = Math.max(0, Math.round(Number(row.deduction_base || 0))) || settlement;
  const callFee = orders * Math.max(0, Math.round(Number(fee.callFee || 0)));
  return settlement
    - Math.floor(base * EMP)
    - Math.floor(base * IND)
    - Math.floor(base * TAX)
    - callFee
    - hourly;
}

(async () => {
  const thisWeek = weekStartOf(new Date().toISOString().slice(0, 10));
  const thisEnd = weekEndOf(thisWeek);
  const [holdsRaw, feesRaw, requestsRaw, finalizedRaw] = await Promise.all([
    setting(HOLDS_KEY),
    setting(FEES_KEY),
    setting(REQUESTS_KEY),
    setting(FINALIZED_KEY)
  ]);
  const holds = (Array.isArray(holdsRaw) ? holdsRaw : [])
    .map(item => ({
      id: String(item.id || ''),
      driverId: String(item.driverId || '').trim(),
      driverName: String(item.driverName || '').trim(),
      weekStart: weekStartOf(item.weekStart || ''),
      weekEnd: String(item.weekEnd || weekEndOf(weekStartOf(item.weekStart || ''))).slice(0, 10),
      amount: Math.max(0, Math.round(Number(item.amount || 0))),
      note: String(item.note || '').trim(),
      createdAt: String(item.createdAt || item.updatedAt || ''),
      createdBy: String(item.createdBy || '')
    }))
    .filter(item => item.driverId && item.amount > 0)
    .sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart))
      || String(a.driverName).localeCompare(String(b.driverName), 'ko'));

  const ids = [...new Set(holds.map(h => h.driverId))];
  let riders = [];
  if (ids.length) {
    const { data, error } = await sb.from('riders').select('id,name,phone,baemin_id,raw_data').in('id', ids);
    if (error) throw error;
    riders = data || [];
  }
  const riderMap = new Map(riders.map(r => [String(r.id), r]));

  const weekKeys = [...new Set(holds.map(h => h.weekStart))];
  const settlements = [];
  for (const week of weekKeys) {
    const end = weekEndOf(week);
    const { data, error } = await sb
      .from('daily_settlements')
      .select('driver_id,period,platform,order_count,hourly_insurance,deduction_base,delivery_amount,settlement_amount')
      .in('driver_id', ids.length ? ids : ['__none__'])
      .gte('period', week)
      .lte('period', end);
    if (error) throw error;
    settlements.push(...(data || []));
  }

  const requests = (Array.isArray(requestsRaw) ? requestsRaw : []).filter(item => ids.includes(String(item.driverId || '')));
  const finalized = new Set(
    (Array.isArray(finalizedRaw) ? finalizedRaw : []).map(item => String(item.weekStart || item).slice(0, 10))
  );

  const rows = holds.map(hold => {
    const rider = riderMap.get(hold.driverId);
    const days = settlements.filter(row => (
      String(row.driver_id) === hold.driverId
      && String(row.period).slice(0, 10) >= hold.weekStart
      && String(row.period).slice(0, 10) <= hold.weekEnd
    ));
    const netBy = { coupang: 0, baemin: 0 };
    days.forEach(row => {
      const key = String(row.platform || '').toLowerCase() === 'baemin' ? 'baemin' : 'coupang';
      netBy[key] += Math.max(0, netPay(row, feesRaw));
    });
    const net = netBy.coupang + netBy.baemin;
    const weekReq = requests.filter(item => (
      String(item.driverId) === hold.driverId && weekStartOf(item.weekStart) === hold.weekStart
    ));
    const pending = weekReq.filter(item => item.status === 'pending').reduce((s, i) => s + Number(i.amount || 0), 0);
    const done = weekReq.filter(item => item.status === 'completed').reduce((s, i) => s + Number(i.amount || 0), 0);
    const beforeHold = net - pending - done;
    const afterHold = beforeHold - hold.amount;
    const issues = [];
    if (!rider) issues.push('기사 없음');
    if (rider && hold.driverName && rider.name && hold.driverName !== rider.name) issues.push('이름 불일치');
    if (hold.weekStart !== thisWeek) issues.push(hold.weekStart < thisWeek ? '지난주' : '다음주');
    if (finalized.has(hold.weekStart)) issues.push('주마무리됨(출금가능 0원)');
    if (!days.length) issues.push('이번주 일정산 없음');
    if (afterHold < 0) issues.push('마이너스');
    if (afterHold >= 0 && hold.amount > 0 && afterHold === beforeHold) issues.push('차감 안 됨');
    return {
      ...hold,
      phone: rider?.phone || '',
      erpId: rider ? erpId(rider) : '',
      baeminId: rider?.baemin_id || '',
      net,
      pending,
      done,
      beforeHold,
      afterHold,
      days: days.length,
      issues
    };
  });

  const out = {
    thisWeek,
    thisEnd,
    holdCount: holds.length,
    weekCount: rows.filter(r => r.weekStart === thisWeek).length,
    totalHold: rows.reduce((s, r) => s + r.amount, 0),
    thisWeekHold: rows.filter(r => r.weekStart === thisWeek).reduce((s, r) => s + r.amount, 0),
    missingRider: rows.filter(r => r.issues.includes('기사 없음')).length,
    negative: rows.filter(r => r.afterHold < 0).length,
    noSettlement: rows.filter(r => r.issues.includes('이번주 일정산 없음')).length,
    rows
  };
  const dest = path.join(__dirname, '..', 'logs', 'audit-holds.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    thisWeek: `${thisWeek} ~ ${thisEnd}`,
    holdCount: out.holdCount,
    weekCount: out.weekCount,
    totalHold: out.totalHold,
    thisWeekHold: out.thisWeekHold,
    missingRider: out.missingRider,
    negative: out.negative,
    noSettlement: out.noSettlement,
    dest
  }, null, 2));
  rows.forEach(r => {
    console.log([
      r.weekStart,
      r.driverName || '-',
      r.erpId || '-',
      r.phone || '-',
      money(r.amount),
      `실지급 ${money(r.net)}`,
      `출금 ${money(r.done)}/${money(r.pending)}`,
      `홀딩전 ${money(r.beforeHold)}`,
      `홀딩후 ${money(r.afterHold)}`,
      r.issues.join(',') || 'OK'
    ].join(' | '));
  });
})().catch(error => {
  console.error(error);
  process.exit(1);
});
