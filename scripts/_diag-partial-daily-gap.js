#!/usr/bin/env node
/**
 * 일부 날만 일정산이 없는 기사 — 어느 단계에서 빠졌는지 (읽기 전용)
 *
 * 각 누락 날짜에 대해 그날 올라온 배민 배달처리비 파일들을 뒤져서 가른다.
 *   (a) 파일에 아예 없음        → 배민이 안 줬거나 그 권역 파일을 안 올림
 *   (b) 파일에 있는데 미매칭     → 매칭 실패
 *   (c) 매칭됐는데 일정산이 없음 → 반영 실패 ★ (코드 문제)
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
  const size = 500; const out = [];
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
const nameKey = v => String(v || '').replace(/\s+/g, '').toLowerCase();
function baeminKey(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d+)\.0+$/);
  const v = (m ? m[1] : raw).replace(/\s+/g, '');
  if (!v) return '';
  return /^\d+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v.toLowerCase();
}
const FROM = '2026-08-12';
const TO = '2026-08-25';

(async () => {
  const riders = await fetchAll('riders', 'id,name,phone,baemin_id,status');
  const riderById = new Map(riders.map(r => [r.id, r]));

  const calls = (await fetchAll('admin_calls', 'driver_id,date,count',
    q => q.eq('platform', 'baemin').gte('date', FROM).lte('date', TO)))
    .filter(c => Number(c.count) > 0);
  const daily = await fetchAll('daily_settlements', 'driver_id,period,order_count,delivery_amount,settlement_amount',
    q => q.eq('platform', 'baemin').gte('period', FROM).lte('period', TO));
  const dailyKey = new Set(daily.map(d => `${d.driver_id}|${String(d.period).slice(0, 10)}`));

  const per = new Map();
  calls.forEach(c => {
    const d = String(c.date).slice(0, 10);
    const cur = per.get(c.driver_id) || { present: [], missing: [], counts: {} };
    cur.counts[d] = Number(c.count);
    (dailyKey.has(`${c.driver_id}|${d}`) ? cur.present : cur.missing).push(d);
    per.set(c.driver_id, cur);
  });
  const mixed = [...per.entries()]
    .filter(([, v]) => v.missing.length > 0 && v.present.length > 0)
    .map(([id, v]) => ({ id, r: riderById.get(id), ...v }));

  console.log('='.repeat(88));
  console.log(` 일부 날만 일정산이 없는 기사 — 어느 단계에서 빠졌나 (${FROM} ~ ${TO})`);
  console.log('='.repeat(88));
  console.log(`\n대상 ${mixed.length}명\n`);

  const missingDates = [...new Set(mixed.flatMap(m => m.missing))].sort();
  const logs = await fetchAll('settlement_upload_logs',
    'id,kind,platform,file_name,period,status,matched_count,unmatched_count,matched_records,unmatched_records',
    q => q.eq('platform', 'baemin').in('period', missingDates));

  const logsByDate = new Map();
  logs.forEach(l => {
    const d = String(l.period).slice(0, 10);
    logsByDate.set(d, [...(logsByDate.get(d) || []), l]);
  });

  // 레코드에서 이름·배민ID 를 최대한 뽑는다 (필드명이 파일마다 다를 수 있어 넓게 훑는다)
  function recordIdentity(rec) {
    if (!rec || typeof rec !== 'object') return { names: [], ids: [] };
    const names = [];
    const ids = [];
    ['driverName', 'riderName', 'originalName', 'name', 'raw_name', 'rawName'].forEach(k => {
      if (rec[k]) names.push(nameKey(rec[k]));
    });
    ['baeminUserId', 'baeminId', 'riderId', 'rider_id', 'userId', 'id'].forEach(k => {
      if (rec[k]) ids.push(baeminKey(rec[k]));
    });
    return { names: names.filter(Boolean), ids: ids.filter(Boolean) };
  }

  mixed.sort((a, b) => b.missing.length - a.missing.length).forEach(m => {
    const nk = nameKey(m.r?.name);
    const bk = baeminKey(m.r?.baemin_id);
    console.log('-'.repeat(88));
    console.log(`"${m.r?.name || m.id}" ${m.r?.status || ''} · 배민ID=${m.r?.baemin_id || '없음'}`);
    console.log(`  일정산 있는 날 ${m.present.length}일: ${m.present.join(', ')}`);
    console.log(`  일정산 없는 날 ${m.missing.length}일:`);

    m.missing.forEach(date => {
      const dayLogs = (logsByDate.get(date) || []).filter(l => /배달처리비/.test(l.file_name || ''));
      let foundIn = null;
      let foundAs = '';
      dayLogs.forEach(l => {
        const matched = Array.isArray(l.matched_records) ? l.matched_records : [];
        const unmatched = Array.isArray(l.unmatched_records) ? l.unmatched_records : [];
        matched.forEach(rec => {
          const { names, ids } = recordIdentity(rec);
          if ((bk && ids.includes(bk)) || (nk && names.includes(nk))) {
            foundIn = l; foundAs = 'matched';
          }
        });
        if (!foundIn) unmatched.forEach(rec => {
          const { names, ids } = recordIdentity(rec);
          if ((bk && ids.includes(bk)) || (nk && names.includes(nk))) {
            foundIn = l; foundAs = 'unmatched';
          }
        });
      });

      const files = dayLogs.map(l => (l.file_name || '').replace(/^배달처리비_|_\d{8}_\d{8}\.xlsx$/g, '')).join(', ');
      if (!dayLogs.length) {
        console.log(`    ${date} 콜 ${String(m.counts[date]).padStart(3)} · 그날 배달처리비 파일이 아예 없음`);
      } else if (!foundIn) {
        console.log(`    ${date} 콜 ${String(m.counts[date]).padStart(3)} · (a) 그날 파일 ${dayLogs.length}장 어디에도 이름/ID 없음`);
        console.log(`             파일: ${files}`);
      } else if (foundAs === 'unmatched') {
        console.log(`    ${date} 콜 ${String(m.counts[date]).padStart(3)} · (b) 파일엔 있는데 미매칭 → ${foundIn.file_name}`);
      } else {
        console.log(`    ${date} 콜 ${String(m.counts[date]).padStart(3)} · ★(c) 매칭됐는데 일정산이 없음 → ${foundIn.file_name} [${foundIn.status}]`);
      }
    });
  });

  console.log('\n' + '='.repeat(88));
  console.log(' 참고: 그날 올라온 배달처리비 파일 목록');
  console.log('='.repeat(88));
  missingDates.forEach(d => {
    const dayLogs = (logsByDate.get(d) || []).filter(l => /배달처리비/.test(l.file_name || ''));
    console.log(`  ${d} · ${dayLogs.length}장 · `
      + dayLogs.map(l => `${(l.file_name || '').replace(/^배달처리비_표준|_\d{8}_\d{8}\.xlsx$/g, '')}(${l.matched_count}/${l.unmatched_count})`).join(' '));
  });
})().catch(e => { console.error(e.message || e); process.exit(1); });
