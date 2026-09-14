#!/usr/bin/env node
/**
 * 직계약/주정산 matchedRiderId 를 쿠팡ID·배민ID 기준으로 교정한다.
 *
 *   node scripts/_remap-settlement-erp-ids.js           ← 미리보기
 *   node scripts/_remap-settlement-erp-ids.js --apply   ← 실제 반영
 *
 * 이름만 같고 전화/ERP 가 다른 동명이인에게 붙은 행을 되돌린다.
 * 이름-only 매칭은 쓰지 않는다.
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

const APPLY = process.argv.includes('--apply');
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) die('SUPABASE 환경변수가 없습니다.');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const money = n => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const digits = s => String(s || '').replace(/[^0-9]/g, '');
const loginKey = s => String(s || '').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim().replace(/\s+/g, '');
const baeminKey = s => {
  const v = String(s || '').trim().replace(/\s+/g, '');
  if (!v) return '';
  const cleaned = /^\d+\.0+$/.test(v) ? v.replace(/\.0+$/, '') : v;
  return /^\d+$/.test(cleaned) ? (cleaned.replace(/^0+/, '') || '0') : cleaned.toLowerCase();
};

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
async function writeSetting(key, value) {
  const { error } = await supabase.from('settings').upsert({
    key,
    value,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) die(`settings.${key} 저장 실패`, error.message);
}

function coupangKeysOf(rider) {
  const raw = rider.raw_data && typeof rider.raw_data === 'object' ? rider.raw_data : {};
  const keys = new Set();
  const custom = loginKey(raw.coupangId || raw.coupang_id || raw.coupangLoginKey || rider.coupang_id);
  if (custom) keys.add(custom);
  const name = String(rider.name || '').replace(/\s/g, '');
  const phone4 = digits(rider.phone).slice(-4);
  if (name && phone4.length === 4) keys.add(`${name}${phone4}`);
  return [...keys];
}

(async () => {
  console.log('='.repeat(76));
  console.log(` 정산서 ERP ID 교정 ${APPLY ? '### 실제 반영 ###' : '미리보기 (쓰기 없음)'}`);
  console.log('='.repeat(76));

  const riders = await fetchAll('riders', 'id,name,phone,baemin_id,status,raw_data');
  const byId = new Map(riders.map(r => [String(r.id), r]));
  const byCoupang = new Map();
  const coupangDup = new Set();
  const byBaemin = new Map();
  const baeminDup = new Set();

  riders.forEach(r => {
    coupangKeysOf(r).forEach(k => {
      if (byCoupang.has(k) && String(byCoupang.get(k).id) !== String(r.id)) coupangDup.add(k);
      else if (!byCoupang.has(k)) byCoupang.set(k, r);
    });
    const b = baeminKey(r.baemin_id);
    if (!b) return;
    if (byBaemin.has(b) && String(byBaemin.get(b).id) !== String(r.id)) baeminDup.add(b);
    else if (!byBaemin.has(b)) byBaemin.set(b, r);
  });
  coupangDup.forEach(k => byCoupang.delete(k));
  baeminDup.forEach(k => byBaemin.delete(k));
  console.log(`기사 ${riders.length}명 · 쿠팡ID 유일 ${byCoupang.size} · 배민ID 유일 ${byBaemin.size}`);

  function resolveTarget(item, platform) {
    const p = String(platform || '').toLowerCase() === 'baemin' ? 'baemin' : 'coupang';
    if (p === 'baemin') {
      const key = baeminKey(item.baeminUserId || item.baemin_user_id);
      if (!key || baeminDup.has(key)) return null;
      return byBaemin.get(key) || null;
    }
    const key = loginKey(item.coupangLoginKey || item.coupang_login_key || item.originalName);
    if (!key || coupangDup.has(key)) return null;
    return byCoupang.get(key) || null;
  }

  const changes = [];
  function inspectRow(source, file, start, platform, item) {
    const target = resolveTarget(item, platform);
    if (!target) return item;
    const fromId = String(item.matchedRiderId || item.matched_rider_id || '').trim();
    const toId = String(target.id);
    if (fromId === toId) return item;
    const from = fromId ? byId.get(fromId) : null;
    changes.push({
      source,
      file: file || '',
      start: String(start || '').slice(0, 10),
      platform,
      erp: loginKey(item.coupangLoginKey || item.originalName) || baeminKey(item.baeminUserId),
      name: item.driverName || item.riderName || item.originalName || '',
      fromId,
      fromName: from ? `${from.name} ${from.phone || ''}` : (fromId ? '삭제된ID' : '미매칭'),
      toId,
      toName: `${target.name} ${target.phone || ''}`,
      calls: Number(item.weeklyOrderCount || 0),
      amount: Number(item.amounts?.deliveryFee || item.settlementAmount || 0)
    });
    return { ...item, matchedRiderId: toId, matched: true, driverName: target.name || item.driverName };
  }

  const weekly = await fetchAll('weekly_settlements', 'id,platform,start_date,end_date,file_name,riders');
  const weeklyNext = [];
  weekly.forEach(row => {
    const list = Array.isArray(row.riders) ? row.riders : [];
    let changed = false;
    const next = list.map(item => {
      const before = String(item.matchedRiderId || '');
      const out = inspectRow('weekly_settlements', row.file_name, row.start_date, row.platform, item);
      if (String(out.matchedRiderId || '') !== before) changed = true;
      return out;
    });
    if (changed) weeklyNext.push({ id: row.id, riders: next });
  });

  const direct = await fetchSetting('brem_admin_weekly_settlements_direct');
  const directList = Array.isArray(direct) ? direct : [];
  let directChanged = false;
  const directNext = directList.map(row => {
    const list = Array.isArray(row.riders) ? row.riders : [];
    let rowChanged = false;
    const remapList = (items, label) => (Array.isArray(items) ? items : []).map(item => {
      const before = String(item.matchedRiderId || '');
      const out = inspectRow(
        label,
        row.fileName || row.file_name,
        row.startDate || row.start_date,
        row.platform,
        item
      );
      if (String(out.matchedRiderId || '') !== before) rowChanged = true;
      return out;
    });
    const nextRiders = remapList(list, 'direct');
    const nextParts = Array.isArray(row.sourceParts)
      ? row.sourceParts.map(part => ({
        ...part,
        riders: remapList(part.riders, 'direct-part')
      }))
      : row.sourceParts;
    if (!rowChanged) return row;
    directChanged = true;
    return { ...row, riders: nextRiders, sourceParts: nextParts };
  });

  const adj = await fetchSetting('brem_admin_direct_settlement_adjustments_v1');
  const adjBlob = adj && typeof adj === 'object' && !Array.isArray(adj) ? JSON.parse(JSON.stringify(adj)) : {};
  let adjMoves = 0;
  const bySettlement = new Map();
  changes.filter(c => c.source === 'direct').forEach(c => {
    const key = `${c.file}|${c.start}`;
    if (!bySettlement.has(key)) bySettlement.set(key, []);
    bySettlement.get(key).push(c);
  });
  const settlementIdByFile = new Map();
  directList.forEach(row => {
    settlementIdByFile.set(`${row.fileName || row.file_name}|${String(row.startDate || row.start_date || '').slice(0, 10)}`, row.id);
  });
  Object.keys(adjBlob).forEach(kind => {
    const byIdMap = adjBlob[kind];
    if (!byIdMap || typeof byIdMap !== 'object') return;
    directNext.forEach(row => {
      const sid = String(row.id || '').trim();
      const entry = byIdMap[sid];
      if (!entry || typeof entry !== 'object') return;
      const fileKey = `${row.fileName || row.file_name}|${String(row.startDate || row.start_date || '').slice(0, 10)}`;
      (bySettlement.get(fileKey) || []).forEach(c => {
        if (!entry[c.fromId]) return;
        const moving = entry[c.fromId];
        delete entry[c.fromId];
        const prev = entry[c.toId];
        entry[c.toId] = prev
          ? { ...prev, amount: Math.round(Number(prev.amount || 0) + Number(moving.amount || 0)), driverName: c.toName.split(' ')[0] }
          : { ...moving, driverName: c.toName.split(' ')[0] };
        adjMoves += 1;
      });
    });
  });

  console.log(`\n교정 대상 ${changes.length}행 · 직계약 파일 ${weeklyNext.length}건 주정산 테이블 / 직계약 JSON ${directChanged ? '변경' : '변경없음'} · 기타지급 키 이동 ${adjMoves}`);
  changes.forEach(c => {
    console.log(`  [${c.source}] ${c.start} ${c.platform} ${c.file}`);
    console.log(`      ${c.erp || '-'} ${c.calls}콜 ${c.amount ? money(c.amount) : ''}  ${c.fromName} → ${c.toName}`);
  });

  const outPath = path.join(__dirname, '..', 'logs', 'remap-settlement-erp-ids.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), apply: APPLY, changes }, null, 2));
  console.log(`\n상세: ${outPath}`);

  if (!APPLY) {
    if (!changes.length) {
      console.log('\n고칠 행이 없습니다.');
      process.exit(0);
    }
    console.log('\n맞으면 실행:');
    console.log('  node scripts/_remap-settlement-erp-ids.js --apply');
    process.exit(0);
  }

  for (const row of weeklyNext) {
    const { error } = await supabase.from('weekly_settlements').update({ riders: row.riders }).eq('id', row.id);
    if (error) die('weekly_settlements 갱신 실패', error.message);
  }
  if (directChanged) await writeSetting('brem_admin_weekly_settlements_direct', directNext);
  if (adjMoves) await writeSetting('brem_admin_direct_settlement_adjustments_v1', adjBlob);

  console.log('\n반영 완료. 최종입금·정산결과 화면을 새로고침 하세요.');
})().catch(e => die('실행 실패', e.message));
