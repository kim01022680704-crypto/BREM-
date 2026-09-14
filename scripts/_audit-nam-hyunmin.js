#!/usr/bin/env node
/**
 * 남현민9346 최종결과 로스 분해 (읽기 전용)
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

const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) die('SUPABASE 환경변수가 없습니다.');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const money = n => `${Math.round(Number(n || 0)).toLocaleString('ko-KR')}원`;
const digits = s => String(s || '').replace(/[^0-9]/g, '');
const loginKey = s => String(s || '').replace(/\s+/g, '');
const NAME = '남현민';
const ERP = '남현민9346';

async function fetchAll(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) die(`${table} 조회 실패`, error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
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
  const custom = String(raw.coupangId || raw.coupangLoginKey || '').replace(/\s/g, '');
  if (custom) return custom;
  const name = String(r.name || '').replace(/\s/g, '');
  const phone4 = digits(r.phone).slice(-4);
  return name && phone4.length === 4 ? `${name}${phone4}` : '';
}
function weekStart(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() - ((d.getDay() - 3 + 7) % 7));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

(async () => {
  console.log('='.repeat(76));
  console.log(' 남현민9346 최종결과 로스 분해 (읽기 전용)');
  console.log('='.repeat(76));

  const riders = await fetchAll('riders', 'id,name,phone,baemin_id,status,platform_coupang,platform_baemin,created_at,raw_data');
  const living = riders.filter(r =>
    String(r.name || '').replace(/\s/g, '') === NAME
    || coupangOf(r) === ERP
    || loginKey(r.baemin_id).toLowerCase() === ERP.toLowerCase()
  );
  console.log(`\n[1] 기사 ${living.length}명`);
  living.forEach(r => {
    const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
    console.log(`  ${r.id}`);
    console.log(`    ${r.name} ${r.phone} 쿠팡=${coupangOf(r)} 배민=${r.baemin_id || '-'} 상태=${r.status}`);
    console.log(`    계좌=${raw.bankName || '-'} ${raw.accountNumber || '-'} 생성=${String(r.created_at || '').slice(0, 10)}`);
  });
  const ids = new Set(living.map(r => String(r.id)));
  const phones = new Set(living.map(r => digits(r.phone)));

  const fees = await fetchSetting('brem_payroll_daily_settlement_fees_v1') || {};
  const callFeeCoupang = Math.round(Number(fees.coupang?.callFee || fees.callFee || 0));
  const callFeeBaemin = Math.round(Number(fees.baemin?.callFee || 0));
  console.log(`\n[2] 콜수수료 단가 쿠팡=${money(callFeeCoupang)} 배민=${money(callFeeBaemin)}`);
  console.log('    fees keys', Object.keys(fees));
  console.log('    coupang', JSON.stringify(fees.coupang || fees).slice(0, 400));

  const direct = await fetchSetting('brem_admin_weekly_settlements_direct');
  const directList = Array.isArray(direct) ? direct : [];
  const adj = await fetchSetting('brem_admin_direct_settlement_adjustments_v1') || {};
  const reqBlob = await fetchSetting('brem_payroll_withdrawal_requests_v1');
  const requests = Array.isArray(reqBlob) ? reqBlob : (Array.isArray(reqBlob?.requests) ? reqBlob.requests : []);

  function isMineRider(item) {
    const id = String(item.matchedRiderId || item.driverId || '');
    const erp = loginKey(item.coupangLoginKey || item.originalName);
    const name = String(item.driverName || item.riderName || item.originalName || '').replace(/\s/g, '');
    return ids.has(id) || erp === ERP || (name === NAME && (erp.includes('9346') || !erp));
  }

  console.log('\n[3] 직계약 정산서 행');
  const hits = [];
  directList.forEach(row => {
    const list = Array.isArray(row.riders) ? row.riders : [];
    list.filter(isMineRider).forEach(item => {
      const a = item.amounts || {};
      const rec = {
        start: String(row.startDate || row.start_date || '').slice(0, 10),
        week: weekStart(row.startDate || row.start_date),
        platform: row.platform,
        file: row.fileName || row.file_name,
        id: row.id,
        matched: String(item.matchedRiderId || ''),
        erp: item.coupangLoginKey || item.originalName,
        calls: Number(item.weeklyOrderCount || 0),
        deliveryFee: Number(a.deliveryFee || 0),
        missionPay: Number(a.missionPay || 0),
        deductionDetail: Number(a.deductionDetail || 0),
        employmentInsurance: Number(a.employmentInsurance || 0),
        accidentInsurance: Number(a.accidentInsurance || 0),
        hourlyInsurance: Number(a.hourlyInsurance || 0),
        withholdingTax: Number(a.withholdingTax || 0),
        sheetPayout: Number(a.sheetPayout || 0),
        useSheetPayout: a.useSheetPayout === true,
        payoutOverride: Number(a.payoutOverride || 0)
      };
      hits.push(rec);
      const callFee = rec.calls * (rec.platform === 'baemin' ? callFeeBaemin : callFeeCoupang);
      const other = Number(adj.other?.[row.id]?.[rec.matched]?.amount || 0);
      const promo = Number(adj.promotion?.[row.id]?.[rec.matched]?.amount || 0);
      const promoTax = Math.floor((promo + other) * 0.033);
      const gross = rec.deliveryFee + rec.missionPay + other + promo;
      const baseDeduct = rec.deductionDetail + rec.employmentInsurance + rec.accidentInsurance
        + rec.hourlyInsurance + rec.withholdingTax + promoTax + callFee;
      console.log(`  ${rec.start} ${rec.platform} ${rec.file}`);
      console.log(`    ERP=${rec.erp} 매칭=${rec.matched.slice(0, 8) || '-'} 콜=${rec.calls}`);
      console.log(`    배달비 ${money(rec.deliveryFee)} 추가지급 ${money(rec.missionPay)} 시트지급 ${money(rec.sheetPayout)} useZ=${rec.useSheetPayout}`);
      console.log(`    차감내역 ${money(rec.deductionDetail)} 고용 ${money(rec.employmentInsurance)} 산재 ${money(rec.accidentInsurance)} 시간제 ${money(rec.hourlyInsurance)} 원천세 ${money(rec.withholdingTax)}`);
      console.log(`    콜수수료 ${rec.calls}×${money(callFeeCoupang)}=${money(callFee)} 기타지급 ${money(other)} 프로모션 ${money(promo)}`);
      console.log(`    지급합계 ${money(gross)} 기본공제 ${money(baseDeduct)} 잔액(선정산 전) ${money(gross - baseDeduct)}`);
    });
  });

  const myReq = requests.filter(r =>
    ids.has(String(r.driverId || ''))
    || String(r.driverName || '').replace(/\s/g, '') === NAME
    || loginKey(r.coupangId || r.coupangLoginKey) === ERP
  );
  console.log(`\n[4] 출금 ${myReq.length}건`);
  myReq.sort((a, b) => String(b.weekStart || '').localeCompare(String(a.weekStart || '')));
  myReq.forEach(r => {
    console.log(`  ${r.weekStart} ${(r.platform || '-').padEnd(8)} ${String(r.status || '-').padEnd(12)} ${money(r.amount)} fee=${money(r.feeAmount || r.fee)} driver=${String(r.driverId || '').slice(0, 8)}`);
  });

  console.log('\n[5] 주차별 선정산 vs 정산 잔액');
  const byWeek = new Map();
  hits.forEach(h => {
    const w = h.week || weekStart(h.start);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(h);
  });
  [...byWeek.keys()].sort().reverse().forEach(week => {
    const rows = byWeek.get(week);
    const done = myReq.filter(r => String(r.weekStart).slice(0, 10) === week && String(r.status) === 'completed');
    const prepaid = done.reduce((s, r) => s + Math.round(Number(r.amount || 0)), 0);
    const fee = done.reduce((s, r) => s + Math.round(Number(r.feeAmount || r.fee || 0)), 0);
    let cap = 0;
    rows.forEach(rec => {
      const callFee = rec.calls * (rec.platform === 'baemin' ? callFeeBaemin : callFeeCoupang);
      const other = Number(adj.other?.[rec.id]?.[rec.matched]?.amount || 0);
      const promo = Number(adj.promotion?.[rec.id]?.[rec.matched]?.amount || 0);
      const promoTax = Math.floor((promo + other) * 0.033);
      const gross = rec.deliveryFee + rec.missionPay + other + promo;
      const baseDeduct = rec.deductionDetail + rec.employmentInsurance + rec.accidentInsurance
        + rec.hourlyInsurance + rec.withholdingTax + promoTax + callFee;
      cap += Math.max(0, gross - baseDeduct);
    });
    const netIfAllOnThis = cap - prepaid - fee;
    console.log(`  ${week} 정산잔액(한도) ${money(cap)} 처리완료출금 ${done.length}건 ${money(prepaid)} 수수료 ${money(fee)} → 총지급 대략 ${money(netIfAllOnThis)}`);
  });

  const settlements = await fetchAll('daily_settlements', 'driver_id,period,platform,order_count,settlement_amount');
  console.log('\n[6] 일정산 요약');
  living.forEach(r => {
    const rows = settlements.filter(s => s.driver_id === r.id);
    const sum = rows.reduce((s, x) => s + Number(x.settlement_amount || 0), 0);
    console.log(`  ${r.phone} ${rows.length}건 ${money(sum)}`);
  });

  const weekly = await fetchAll('weekly_settlements', 'platform,start_date,file_name,riders');
  console.log('\n[7] 배민/쿠팡 주정산서');
  weekly.forEach(row => {
    const list = (row.riders || []).filter(isMineRider);
    if (!list.length) return;
    list.forEach(item => {
      console.log(`  ${row.start_date} ${row.platform} ${row.file_name} 매칭=${String(item.matchedRiderId || '').slice(0, 8)} 배민=${item.baeminUserId || '-'} 쿠팡=${item.coupangLoginKey || item.originalName} 콜=${item.weeklyOrderCount}`);
    });
  });

  const out = path.join(__dirname, '..', 'logs', 'audit-nam-hyunmin.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ living, hits, withdrawals: myReq, fees }, null, 2));
  console.log(`\n상세: ${out}`);
})().catch(e => die('실행 실패', e.message));
