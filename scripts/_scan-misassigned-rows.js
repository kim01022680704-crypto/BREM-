#!/usr/bin/env node
/**
 * 정산서에 적힌 키와 실제로 붙은 기사가 다른 건 전수 조사 (읽기 전용)
 *
 *   node scripts/_scan-misassigned-rows.js
 *
 * 이상호 케이스의 지문을 그대로 쓴다.
 *   쿠팡: 정산서 rawName("이름+전화뒤4")과 배정된 기사의 키가 다르면 의심.
 *         그 rawName 이 "다른 등록 기사"와 정확히 일치하면 확정 오배정.
 *   배민: 정산서 riderId(배민 User ID)와 배정된 기사의 등록 배민ID가 다르면 의심.
 *
 * 원인은 기사 등록이 늦어 키 매칭이 실패하고 이름 백업 매칭으로 동명이인에게 붙는 것이다.
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

const digits = v => String(v || '').replace(/[^0-9]/g, '');
const strip = v => String(v || '').replace(/\s+/g, '');
const nameKey = v => strip(v).toLowerCase();
const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');

function autoCoupangKey(r) {
  const n = strip(r.name);
  const t = digits(r.phone).slice(-4);
  return n && t ? `${n}${t}` : '';
}
function customCoupangKey(r) {
  const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
  return strip(raw.coupangId || raw.coupangLoginKey || raw.coupangLoginId || '');
}
function baeminKey(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d+)\.0+$/);
  const v = (m ? m[1] : raw).replace(/\s+/g, '');
  if (!v) return '';
  return /^\d+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v.toLowerCase();
}

async function fetchAll(table, columns, build) {
  const size = 300;
  const out = [];
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

(async () => {
  console.log('='.repeat(104));
  console.log(' 정산서 키와 배정된 기사가 다른 건 전수 조사 (읽기 전용)');
  console.log('='.repeat(104));

  const riders = await fetchAll('riders', 'id,name,phone,baemin_id,status,created_at,raw_data');
  const byId = new Map(riders.map(r => [r.id, r]));

  // 등록 기사 키 인덱스
  const coupangKeyOwner = new Map(); // key(lower) → [rider]
  const baeminKeyOwner = new Map();
  const byName = new Map();
  riders.forEach(r => {
    [autoCoupangKey(r), customCoupangKey(r)].filter(Boolean).forEach(k => {
      const kk = nameKey(k);
      coupangKeyOwner.set(kk, [...(coupangKeyOwner.get(kk) || []), r]);
    });
    const bk = baeminKey(r.baemin_id);
    if (bk) baeminKeyOwner.set(bk, [...(baeminKeyOwner.get(bk) || []), r]);
    const nk = nameKey(r.name);
    if (nk) byName.set(nk, [...(byName.get(nk) || []), r]);
  });

  const logs = await fetchAll('settlement_upload_logs',
    'id,platform,kind,period,file_name,status,applied_records',
    q => q.eq('kind', 'daily'));
  console.log(`\n기사 ${riders.length}명 · 일정산 업로드 로그 ${logs.length}건`);

  const daily = await fetchAll('daily_settlements', 'id,driver_id,period,platform,order_count,settlement_amount');
  const dailyById = new Map(daily.map(d => [d.id, d]));

  const confirmed = [];  // rawName 키가 다른 등록 기사와 정확히 일치 = 확정
  const suspect = [];    // 키가 다르지만 주인을 특정 못 함
  const nameOnly = [];   // 정산서에 키가 없어 이름으로만 붙음 + 동명이인 존재

  logs.forEach(log => {
    const platform = String(log.platform || '').toLowerCase();
    const period = String(log.period || '').slice(0, 10);
    (Array.isArray(log.applied_records) ? log.applied_records : []).forEach(rec => {
      const assignedId = String(rec?.driverId || '').trim();
      if (!assignedId) return;
      const assigned = byId.get(assignedId);
      if (!assigned) return; // 기사 레코드 없음은 별도 이슈
      const amount = Number(rec?.settlementAmount ?? rec?.deliveryAmount ?? 0);
      const orderCount = Number(rec?.orderCount || 0);
      const base = { period, platform, file: log.file_name, assigned, amount, orderCount, rec };

      if (platform === 'coupang') {
        const sheetKey = nameKey(rec?.rawName || rec?.name || '');
        if (!sheetKey) return;
        const mine = [autoCoupangKey(assigned), customCoupangKey(assigned)].filter(Boolean).map(nameKey);
        if (mine.includes(sheetKey)) return; // 정상

        const owners = (coupangKeyOwner.get(sheetKey) || []).filter(r => r.id !== assignedId);
        if (owners.length === 1) {
          confirmed.push({ ...base, sheetKey, realOwner: owners[0] });
        } else if (/\d{4}$/.test(sheetKey)) {
          suspect.push({ ...base, sheetKey, owners });
        } else {
          const sameName = byName.get(sheetKey) || [];
          if (sameName.length > 1) nameOnly.push({ ...base, sheetKey, sameName });
        }
      } else {
        const sheetId = baeminKey(rec?.riderId || rec?.baeminUserId || '');
        if (!sheetId) return;
        const mine = baeminKey(assigned.baemin_id);
        if (mine && mine === sheetId) return; // 정상

        const owners = (baeminKeyOwner.get(sheetId) || []).filter(r => r.id !== assignedId);
        if (owners.length === 1) {
          confirmed.push({ ...base, sheetKey: sheetId, realOwner: owners[0] });
        } else {
          suspect.push({ ...base, sheetKey: sheetId, owners });
        }
      }
    });
  });

  const show = e => {
    const dId = `${e.assigned.id}-${e.period}-${e.platform}`;
    const alive = dailyById.has(dId);
    return `  ${e.period} ${e.platform.padEnd(7)} 정산서키="${e.rec.rawName || e.rec.name}${e.platform === 'baemin' ? `/${e.rec.riderId || ''}` : ''}"`
      + ` → 붙은기사 "${e.assigned.name}"(${digits(e.assigned.phone).slice(-4)})`
      + ` · ${e.orderCount}콜 · ${won(e.amount)}원${alive ? '' : '  [일정산 행 없음]'}`;
  };

  console.log('\n' + '='.repeat(104));
  console.log(` ★★ 확정 오배정 — 정산서 키의 주인이 다른 기사로 특정됨 : ${confirmed.length}건`);
  console.log('='.repeat(104));
  if (!confirmed.length) console.log('  없음');
  confirmed
    .sort((a, b) => b.amount - a.amount)
    .forEach(e => {
      console.log(show(e));
      console.log(`      실제 주인: "${e.realOwner.name}"(${digits(e.realOwner.phone).slice(-4)})`
        + ` · 등록 ${String(e.realOwner.created_at).slice(0, 10)} · ${e.realOwner.status}`
        + `  ← 이 기사에게 가야 함`);
    });
  if (confirmed.length) {
    console.log(`\n  합계 ${won(confirmed.reduce((a, e) => a + e.amount, 0))}원`
      + ` · ${confirmed.reduce((a, e) => a + e.orderCount, 0)}콜`);
  }

  console.log('\n' + '='.repeat(104));
  console.log(` ★ 의심 — 정산서 키가 붙은 기사와 다르지만 주인을 특정 못 함 : ${suspect.length}건`);
  console.log('='.repeat(104));
  if (!suspect.length) console.log('  없음');
  suspect.sort((a, b) => b.amount - a.amount).slice(0, 40).forEach(e => console.log(show(e)));
  if (suspect.length > 40) console.log(`  … 외 ${suspect.length - 40}건`);

  console.log('\n' + '='.repeat(104));
  console.log(` 참고 — 정산서에 키가 없어 이름으로만 붙었고 동명이인이 있는 건 : ${nameOnly.length}건`);
  console.log('='.repeat(104));
  if (!nameOnly.length) console.log('  없음');
  nameOnly.sort((a, b) => b.amount - a.amount).slice(0, 30).forEach(e => {
    console.log(show(e));
    console.log(`      같은 이름 기사 ${e.sameName.length}명: `
      + e.sameName.map(r => `${r.name}(${digits(r.phone).slice(-4)}/${r.status})`).join(', '));
  });
  if (nameOnly.length > 30) console.log(`  … 외 ${nameOnly.length - 30}건`);
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});
