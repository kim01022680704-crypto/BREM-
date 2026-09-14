#!/usr/bin/env node
/**
 * 김상훈 동명이인 / 중복등록 / 선정산 미반영 출금 검수 (읽기 전용)
 */
const path = require('path');
const fs = require('fs');

function die(msg, detail) {
  console.error(`\n[중단] ${msg}`);
  if (detail) console.error(`       ${detail}`);
  process.exit(2);
}
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

const NAME = '김상훈';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) die('SUPABASE 환경변수가 없습니다.');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const money = n => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const norm = s => String(s || '').replace(/\s+/g, '').trim();
const digits = s => String(s || '').replace(/[^0-9]/g, '');
const lower = s => norm(s).toLowerCase();

async function fetchAll(table, columns) {
  const size = 1000;
  const out = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + size - 1);
    if (error) die(`${table} 조회 실패`, error.message);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}
async function fetchSetting(key) {
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) die(`settings.${key} 조회 실패`, error.message);
  let value = data?.value ?? null;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (_) {}
  }
  return value;
}
function coupangOf(r) {
  const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
  const explicit = String(raw.coupangId || raw.coupang_id || '').trim();
  if (explicit) return explicit;
  const name = String(r.name || '').replace(/\s/g, '');
  const phone4 = digits(r.phone).slice(-4);
  return name && phone4.length === 4 ? `${name}${phone4}` : '';
}

(async () => {
  console.log('='.repeat(76));
  console.log(' 김상훈 동명이인 · 출금 · 직계약 정산서 검수 (읽기 전용)');
  console.log('='.repeat(76));

  const riders = await fetchAll('riders', 'id,name,phone,baemin_id,status,platform_coupang,platform_baemin,created_at,updated_at,raw_data');
  const living = riders.filter(r => norm(r.name) === NAME);
  console.log(`\n[1] 현재 등록된 "${NAME}" ${living.length}명`);
  living.forEach((r, i) => {
    const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
    console.log(`  (${i + 1}) ${r.id}`);
    console.log(`      전화=${r.phone || '-'} 배민=${r.baemin_id || '-'} 쿠팡=${coupangOf(r) || '-'} 상태=${r.status || '-'}`);
    console.log(`      쿠팡플랫폼=${r.platform_coupang !== false} 배민플랫폼=${Boolean(r.platform_baemin)} 생성=${String(r.created_at || '').slice(0, 10)}`);
    console.log(`      계좌=${raw.bankName || r.bank_name || '-'} ${raw.accountNumber || r.account_number || '-'} 예금주=${raw.accountHolder || r.account_holder || '-'}`);
  });

  const livingIds = new Set(living.map(r => String(r.id)));
  const phoneGroups = new Map();
  living.forEach(r => {
    const p = digits(r.phone) || '(번호없음)';
    if (!phoneGroups.has(p)) phoneGroups.set(p, []);
    phoneGroups.get(p).push(r);
  });
  console.log('\n[1b] 전화 기준 묶음 (진짜 동명이인 vs 중복등록)');
  phoneGroups.forEach((list, phone) => {
    console.log(`  ${phone} → ${list.length}명  ${list.map(r => r.id.slice(0, 8)).join(', ')}  배민=${list.map(r => r.baemin_id || '-').join('/')}`);
  });

  const reqBlob = await fetchSetting('brem_payroll_withdrawal_requests_v1');
  const requests = Array.isArray(reqBlob) ? reqBlob : (Array.isArray(reqBlob?.requests) ? reqBlob.requests : []);
  const myReq = requests.filter(r =>
    livingIds.has(String(r.driverId || '')) || norm(r.driverName) === NAME
  );
  console.log(`\n[2] 출금 신청 (전체 ${requests.length}건 중 김상훈 ${myReq.length}건)`);
  const byWeek = new Map();
  myReq.sort((a, b) => String(b.weekStart || '').localeCompare(String(a.weekStart || '')) || Number(b.amount || 0) - Number(a.amount || 0));
  myReq.forEach(r => {
    const week = String(r.weekStart || '').slice(0, 10);
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push(r);
    const alive = livingIds.has(String(r.driverId || ''));
    const hit = living.find(d => d.id === String(r.driverId || ''));
    console.log(`  ${week || '-'} ${(r.platform || '-').padEnd(8)} ${String(r.status || '-').padEnd(12)} ${money(r.amount).padStart(12)}  driver=${String(r.driverId || '').slice(0, 8) || '-'} ${alive ? `생존(${hit?.phone || ''} ${hit?.baemin_id || '-'})` : '삭제된ID'}  ${r.driverName || ''}`);
  });

  console.log('\n[2b] 정산주별 처리완료 출금 합계');
  byWeek.forEach((list, week) => {
    const done = list.filter(r => String(r.status) === 'completed');
    const sum = done.reduce((s, r) => s + Math.round(Number(r.amount || 0)), 0);
    const ids = [...new Set(done.map(r => String(r.driverId || '')))];
    console.log(`  ${week || '(주없음)'} 완료 ${done.length}건 ${money(sum)}  driverId ${ids.length}개: ${ids.map(id => `${id.slice(0, 8)}${livingIds.has(id) ? '' : '(삭제)'}`).join(', ')}`);
  });

  const screenshot = [153166, 101083, 61188, 43307, 3322];
  console.log('\n[2c] 화면 금액과 같은 출금');
  screenshot.forEach(amt => {
    const hits = myReq.filter(r => Math.round(Number(r.amount || 0)) === amt);
    if (!hits.length) {
      console.log(`  ${money(amt)} → 없음`);
      return;
    }
    hits.forEach(r => {
      const alive = livingIds.has(String(r.driverId || ''));
      const hit = living.find(d => d.id === String(r.driverId || ''));
      console.log(`  ${money(amt)} 주=${r.weekStart} ${r.platform} ${r.status} id=${String(r.driverId || '').slice(0, 8)} ${alive ? `생존 ${hit?.phone} ${hit?.baemin_id || '-'}` : '삭제된ID'}`);
    });
  });

  const weekly = await fetchAll('weekly_settlements', 'id,platform,start_date,end_date,file_name,riders,settlement_week_label');
  console.log(`\n[3] 배민/쿠팡 주정산서 안 김상훈`);
  weekly.forEach(row => {
    const list = Array.isArray(row.riders) ? row.riders : [];
    const hits = list.filter(item => {
      const n = norm(item.driverName || item.riderName || item.originalName);
      const id = String(item.matchedRiderId || '');
      return n === NAME || livingIds.has(id);
    });
    if (!hits.length) return;
    console.log(`  ${row.start_date}~${row.end_date} ${row.platform} ${row.file_name || ''} (${hits.length}행)`);
    hits.forEach(item => {
      const mid = String(item.matchedRiderId || '');
      console.log(`      이름=${item.driverName || item.riderName || item.originalName} 매칭=${mid ? mid.slice(0, 8) + (livingIds.has(mid) ? '(생존)' : '(삭제)') : '미매칭'} 배민=${item.baeminUserId || '-'} 쿠팡=${item.coupangLoginKey || '-'}`);
    });
  });

  const direct = await fetchSetting('brem_admin_weekly_settlements_direct');
  const directList = Array.isArray(direct) ? direct : [];
  console.log(`\n[4] 직계약 정산서 ${directList.length}건 안 김상훈`);
  if (!directList.length) console.log('  직계약 정산서 저장 없음');
  directList.forEach(row => {
    const list = Array.isArray(row.riders) ? row.riders : [];
    const hits = list.filter(item => {
      const n = norm(item.driverName || item.riderName || item.originalName || item.name);
      const id = String(item.matchedRiderId || item.driverId || '');
      return n === NAME || livingIds.has(id);
    });
    if (!hits.length) return;
    console.log(`  ${row.startDate || row.start_date || '-'} ${row.platform || '-'} ${row.fileName || row.file_name || ''} week=${row.settlementWeekLabel || row.weekStart || ''} (${hits.length}행)`);
    hits.forEach(item => {
      const mid = String(item.matchedRiderId || item.driverId || '');
      const amt = item.amounts || {};
      console.log(`      이름=${item.driverName || item.riderName || item.originalName} 매칭=${mid ? mid.slice(0, 8) + (livingIds.has(mid) ? '(생존)' : '(삭제)') : '미매칭'} 콜=${item.weeklyOrderCount || item.orderCount || '-'} 배달비=${money(amt.deliveryFee || 0)}`);
    });
  });

  const settlements = await fetchAll('daily_settlements', 'id,driver_id,period,platform,rider_id,order_count,settlement_amount');
  console.log('\n[5] 일정산 (생존 김상훈 ID 기준, 최근 요약)');
  living.forEach(r => {
    const rows = settlements.filter(s => s.driver_id === r.id);
    const byP = { baemin: 0, coupang: 0 };
    const amt = { baemin: 0, coupang: 0 };
    rows.forEach(s => {
      const p = String(s.platform) === 'baemin' ? 'baemin' : 'coupang';
      byP[p] += 1;
      amt[p] += Number(s.settlement_amount || 0);
    });
    console.log(`  ${r.phone || '-'} ${r.baemin_id || '-'}  배민 ${byP.baemin}건 ${money(amt.baemin)} / 쿠팡 ${byP.coupang}건 ${money(amt.coupang)}`);
  });

  const orphanSettle = settlements.filter(s => !riders.some(r => r.id === s.driver_id) && living.some(() => false));
  const nameOnWeeklyOrphan = [];
  weekly.forEach(row => {
    (Array.isArray(row.riders) ? row.riders : []).forEach(item => {
      const n = norm(item.driverName || item.riderName || item.originalName);
      const id = String(item.matchedRiderId || '');
      if (n === NAME && id && !livingIds.has(id) && !riders.some(r => r.id === id)) {
        nameOnWeeklyOrphan.push({ id, week: row.start_date, platform: row.platform, baemin: item.baeminUserId, coupang: item.coupangLoginKey });
      }
    });
  });
  console.log(`\n[6] 주정산에 김상훈인데 매칭 ID가 삭제된 행 ${nameOnWeeklyOrphan.length}건`);
  nameOnWeeklyOrphan.slice(0, 20).forEach(x => {
    console.log(`  ${x.week} ${x.platform} 삭제ID=${x.id.slice(0, 8)} 배민=${x.baemin || '-'} 쿠팡=${x.coupang || '-'}`);
  });

  const orphanWithdrawals = myReq.filter(r => {
    const id = String(r.driverId || '');
    return id && !riders.some(d => d.id === id);
  });
  console.log(`\n[7] 출금 driverId 가 기사 목록에 없는 김상훈 ${orphanWithdrawals.length}건`);
  orphanWithdrawals.forEach(r => {
    console.log(`  ${r.weekStart} ${r.platform} ${r.status} ${money(r.amount)} 삭제ID=${String(r.driverId || '').slice(0, 8)}`);
  });

  const outPath = path.join(__dirname, '..', 'logs', 'audit-kim-sanghoon.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    at: new Date().toISOString(),
    living: living.map(r => ({
      id: r.id, phone: r.phone, baemin: r.baemin_id, coupang: coupangOf(r),
      status: r.status, platformCoupang: r.platform_coupang !== false, platformBaemin: Boolean(r.platform_baemin),
      created: r.created_at
    })),
    withdrawals: myReq,
    screenshotHits: screenshot
  }, null, 2));
  console.log(`\n상세: ${outPath}`);
})().catch(e => die('실행 실패', e.message));
