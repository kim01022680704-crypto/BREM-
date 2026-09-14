#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
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
const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const EMP_RATE = 0.008;
const INDUSTRIAL_RATE = 0.0088;
const WITHHOLDING_RATE = 0.033;
const TARGETS = [
  { id: 'c34a8987-34d6-42b3-b8a0-8b5346dde016', name: '김유곤' },
  { id: 'b467aa1f-d46d-4e3e-a698-0d8f6e75b455', name: '이유근' }
];

function weekStartWed(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return '';
  const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(d);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = map[dow] ?? 3;
  d.setUTCDate(d.getUTCDate() - ((day - 3 + 7) % 7));
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}
function payout(row) {
  const n = v => Math.round(Number(v || 0));
  const settlementAmount = Math.max(0, n(row.settlement_amount ?? row.delivery_amount));
  const hourlyInsurance = Math.abs(n(row.hourly_insurance));
  const orderCount = Math.max(0, n(row.order_count));
  const deductionBase = Math.max(0, n(row.deduction_base)) || settlementAmount;
  const employmentInsurance = Math.floor(deductionBase * EMP_RATE);
  const industrialAccidentInsurance = Math.floor(deductionBase * INDUSTRIAL_RATE);
  const withholdingTax = Math.floor(deductionBase * WITHHOLDING_RATE);
  const storedFee = row.call_fee == null || row.call_fee === '' ? null : Math.max(0, n(row.call_fee));
  const unit = row.call_fee_unit == null || row.call_fee_unit === '' ? null : Math.max(0, n(row.call_fee_unit));
  const callFee = storedFee != null ? storedFee : (unit == null ? 0 : orderCount * unit);
  return {
    settlementAmount, hourlyInsurance, orderCount, deductionBase,
    employmentInsurance, industrialAccidentInsurance, withholdingTax,
    callFee, unit,
    netPay: settlementAmount - employmentInsurance - industrialAccidentInsurance - withholdingTax - callFee - hourlyInsurance
  };
}
async function readSetting(key) {
  const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  let v = data?.value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) {}
  }
  return v;
}

(async () => {
  const ids = TARGETS.map(t => t.id);
  const { data: riders } = await sb.from('riders')
    .select('id,name,phone,baemin_id,status,raw_data')
    .in('id', ids);
  const riderMap = new Map((riders || []).map(r => [r.id, r]));

  const rosterRaw = await readSetting('brem_payroll_daily_settlement_roster_v1');
  const rosterList = Array.isArray(rosterRaw) ? rosterRaw : (rosterRaw?.items || rosterRaw?.list || []);
  const fees = await readSetting('brem_payroll_daily_settlement_fees_v1');

  const { data: daily, error: dErr } = await sb.from('daily_settlements')
    .select('id,driver_id,period,platform,rider_id,order_count,hourly_insurance,deduction_base,delivery_amount,settlement_amount,call_fee,call_fee_unit,applied_at')
    .in('driver_id', ids)
    .gte('period', '2026-08-19')
    .order('period', { ascending: true });
  if (dErr) throw dErr;

  const { data: logs } = await sb.from('settlement_upload_logs')
    .select('id,kind,platform,file_name,period,region,status,call_fee_unit,matched_records,unmatched_records,applied_records,total_order_count,total_delivery_amount,uploaded_at')
    .eq('kind', 'daily')
    .gte('period', '2026-08-19')
    .order('period', { ascending: true })
    .limit(250);

  const result = {
    generatedAt: new Date().toISOString(),
    note: 'ERP에 이유곤 없음. 유곤=김유곤, 유사명=이유근 검수',
    fees,
    riders: TARGETS.map(t => {
      const r = riderMap.get(t.id) || {};
      const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
      const phone4 = String(r.phone || '').replace(/\D/g, '').slice(-4);
      const enrolled = (Array.isArray(rosterList) ? rosterList : []).filter(item => String(item.driverId || item.driver_id) === t.id);
      return {
        id: t.id,
        name: r.name || t.name,
        phone: r.phone || '',
        status: r.status || '',
        baeminId: r.baemin_id || raw.baeminId || '',
        coupangId: raw.coupangId || raw.coupangLoginKey || (r.name && phone4 ? `${String(r.name).replace(/\s+/g, '')}${phone4}` : ''),
        regionBaemin: raw.regionBaemin || '',
        regionCoupang: raw.regionCoupang || '',
        enrolled: enrolled.map(item => ({
          driverName: item.driverName,
          platformBaemin: item.platformBaemin !== false,
          platformCoupang: item.platformCoupang !== false,
          region: item.region || item.regionName || ''
        }))
      };
    }),
    days: [],
    missing: [],
    issues: []
  };

  const byDriver = new Map(ids.map(id => [id, []]));
  (daily || []).forEach(row => {
    const p = payout(row);
    const rec = {
      id: row.id,
      driverId: row.driver_id,
      name: riderMap.get(row.driver_id)?.name,
      period: String(row.period).slice(0, 10),
      platform: row.platform,
      riderId: row.rider_id || '',
      weekStart: weekStartWed(row.period),
      appliedAt: row.applied_at,
      ...p
    };
    const issues = [];
    if (rec.netPay < 0) issues.push('실지급 마이너스');
    if (rec.settlementAmount === 0 && rec.orderCount > 0) issues.push('콜수는 있는데 정산금액 0');
    if (rec.orderCount === 0 && rec.settlementAmount > 0) issues.push('정산금액은 있는데 콜수 0');
    if (rec.unit != null && rec.callFee !== rec.orderCount * rec.unit) {
      issues.push(`콜수수료 저장 ${rec.callFee} ≠ 콜수×단가 ${rec.orderCount * rec.unit}`);
    }
    rec.issues = issues;
    byDriver.get(row.driver_id).push(rec);
    result.days.push(rec);
    issues.forEach(text => result.issues.push({ name: rec.name, period: rec.period, platform: rec.platform, text }));
  });

  const logHits = [];
  (logs || []).forEach(log => {
    const buckets = [
      ...(log.applied_records || []).map(r => ({ ...r, bucket: 'applied' })),
      ...(log.matched_records || []).map(r => ({ ...r, bucket: 'matched' })),
      ...(log.unmatched_records || []).map(r => ({ ...r, bucket: 'unmatched' }))
    ];
    buckets.forEach(rec => {
      const driverId = String(rec.driverId || rec.matchedRiderId || '');
      if (!ids.includes(driverId) && !['김유곤', '이유근', '이유곤'].some(n => JSON.stringify(rec).includes(n))) return;
      logHits.push({
        period: String(log.period || '').slice(0, 10),
        platform: log.platform,
        fileName: log.file_name,
        region: log.region || '',
        status: log.status,
        bucket: rec.bucket,
        name: rec.driverName || rec.name || rec.rawName || '',
        driverId,
        orderCount: rec.orderCount,
        settlementAmount: rec.settlementAmount ?? rec.deliveryAmount,
        hourlyInsurance: rec.hourlyInsurance,
        callFeeUnit: rec.callFeeUnit ?? log.call_fee_unit
      });
    });
  });
  result.uploadHits = logHits;

  const dates = [];
  for (let i = 0; i < 22; i += 1) {
    const d = new Date('2026-08-19T12:00:00+09:00');
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }));
  }
  TARGETS.forEach(t => {
    ['coupang', 'baemin'].forEach(platform => {
      const have = new Set((byDriver.get(t.id) || []).filter(r => r.platform === platform).map(r => r.period));
      dates.filter(date => date <= '2026-09-08').forEach(date => {
        if (!have.has(date)) {
          const logHit = logHits.find(h => h.period === date && h.platform === platform && (h.driverId === t.id || h.name === t.name));
          result.missing.push({
            name: t.name,
            period: date,
            platform,
            weekStart: weekStartWed(date),
            inUploadLog: Boolean(logHit)
          });
        }
      });
    });
  });

  const weekMap = new Map();
  result.days.forEach(row => {
    const key = `${row.name}|${row.weekStart}|${row.platform}`;
    const cur = weekMap.get(key) || {
      name: row.name, weekStart: row.weekStart, platform: row.platform,
      days: 0, calls: 0, settlement: 0, callFee: 0, hourly: 0, insuranceTax: 0, net: 0, minusDays: 0
    };
    cur.days += 1;
    cur.calls += row.orderCount;
    cur.settlement += row.settlementAmount;
    cur.callFee += row.callFee;
    cur.hourly += row.hourlyInsurance;
    cur.insuranceTax += row.employmentInsurance + row.industrialAccidentInsurance + row.withholdingTax;
    cur.net += row.netPay;
    if (row.netPay < 0) cur.minusDays += 1;
    weekMap.set(key, cur);
  });
  result.weekSummary = [...weekMap.values()].sort((a, b) => String(b.weekStart).localeCompare(a.weekStart) || a.name.localeCompare(b.name, 'ko'));

  const dest = path.join(__dirname, '..', 'logs', 'audit-lee-yugon-daily.json');
  fs.writeFileSync(dest, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    riders: result.riders,
    fees,
    weekSummary: result.weekSummary,
    issueCount: result.issues.length,
    missingRecent: result.missing.filter(m => m.period >= '2026-09-02'),
    dayCount: result.days.length
  }, null, 2));
  console.log('\n--- days ---');
  result.days.filter(d => d.period >= '2026-09-02').forEach(d => {
    console.log(`${d.name} ${d.period} ${d.platform} 콜${d.orderCount} 정산${d.settlementAmount} 수수료${d.callFee}(${d.unit}) 시간제${d.hourlyInsurance} 실지급${d.netPay} ${d.issues.join(',')}`);
  });
})().catch(e => {
  console.error(e);
  process.exit(1);
});
