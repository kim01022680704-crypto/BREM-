#!/usr/bin/env node
/**
 * "지금 일정산서를 올리면 미매칭이 뜰 기사" 사전 점검 (읽기 전용)
 *
 * 원칙: 등록된 기사는 미매칭이 뜨면 안 된다.
 * 매칭 규칙 (js/settlement-client.js matchDrivers 와 동일)
 *   쿠팡 : 정산서 성함칸("이름+전화뒤4") → 기사 쿠팡ID(커스텀 or 이름+전화뒤4)
 *          실패 시 이름이 정확히 1명일 때만 이름 백업
 *   배민 : 정산서 라이더ID → 기사 배민ID  (이름 백업 없음!)
 *
 * 따라서 아래 상태면 업로드 시 반드시/거의 미매칭이 된다.
 *   [배민] 배민 플랫폼인데 배민ID 미등록        → 100% 미매칭
 *   [쿠팡] 전화번호가 없거나 4자리 미만          → 키 생성 불가
 *   [공통] 두 기사가 같은 키를 만든다            → 뒤쪽 1명은 영구 미매칭
 *   [공통] 동명이인 + 키 불완전                  → 이름 백업도 못 씀
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

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE env 필요');
  process.exit(2);
}
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const ACTIVE_STATUS = new Set(['근무중', '재직', '활동중']);

function normalizePhone(v) { return String(v || '').replace(/[^0-9]/g, ''); }
function stripSpaces(v) { return String(v || '').trim().replace(/\s+/g, ''); }
function nameKey(v) { return String(v || '').replace(/\s+/g, '').toLowerCase(); }

function customCoupangId(row) {
  const raw = row?.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  return String(raw.coupangLoginKey || raw.coupangId || raw.coupangLoginId || '').trim().replace(/\s/g, '');
}
function autoCoupangId(row) {
  return `${String(row?.name || '').replace(/\s/g, '')}${normalizePhone(row?.phone).slice(-4)}`;
}
function erpCoupangId(row) {
  return customCoupangId(row) || autoCoupangId(row);
}
function baeminMatchKey(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d+)\.0+$/);
  const s = (m ? m[1] : raw).replace(/\s+/g, '');
  if (!s) return '';
  return /^\d+$/.test(s) ? (s.replace(/^0+/, '') || '0') : s.toLowerCase();
}

async function fetchAll(table, columns) {
  const size = 1000;
  const out = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

(async () => {
  console.log('='.repeat(86));
  console.log(' 지금 일정산서를 올리면 미매칭이 뜰 기사 (읽기 전용)');
  console.log('='.repeat(86));

  const all = await fetchAll('riders', 'id,name,phone,baemin_id,status,platform_coupang,platform_baemin,raw_data');
  const active = all.filter(r => ACTIVE_STATUS.has(String(r.status || '').trim()));
  console.log(`\n전체 ${all.length}명 · 활동중 ${active.length}명 (판정 대상은 활동중)\n`);

  // ---- 1) 배민: 배민ID 미등록 ----
  const baeminRiders = active.filter(r => r.platform_baemin === true);
  const baeminNoId = baeminRiders.filter(r => !baeminMatchKey(r.baemin_id));

  // ---- 2) 쿠팡: 키 생성 불가 (커스텀 없고 전화 4자리 미만) ----
  const coupangRiders = active.filter(r => r.platform_coupang !== false);
  const coupangNoKey = coupangRiders.filter(r => {
    if (customCoupangId(r)) return false;
    return normalizePhone(r.phone).length < 4 || !String(r.name || '').trim();
  });

  // ---- 3) 키 중복: 같은 키를 만드는 기사 2명 이상 → 뒤쪽은 영구 미매칭 ----
  const coupangKeyMap = new Map();
  coupangRiders.forEach(r => {
    const k = stripSpaces(erpCoupangId(r));
    if (!k) return;
    const list = coupangKeyMap.get(k) || [];
    list.push(r);
    coupangKeyMap.set(k, list);
  });
  const coupangDupKeys = [...coupangKeyMap.entries()].filter(([, list]) => list.length > 1);

  const baeminKeyMap = new Map();
  baeminRiders.forEach(r => {
    const k = baeminMatchKey(r.baemin_id);
    if (!k) return;
    const list = baeminKeyMap.get(k) || [];
    list.push(r);
    baeminKeyMap.set(k, list);
  });
  const baeminDupKeys = [...baeminKeyMap.entries()].filter(([, list]) => list.length > 1);

  // ---- 4) 동명이인: 이름 백업 매칭이 불가능한 그룹 ----
  const nameMap = new Map();
  active.forEach(r => {
    const k = nameKey(r.name);
    if (!k) return;
    const list = nameMap.get(k) || [];
    list.push(r);
    nameMap.set(k, list);
  });
  const sameNameGroups = [...nameMap.entries()].filter(([, list]) => list.length > 1);

  console.log('[요약]');
  console.log(`  ① 배민 기사인데 배민ID 미등록      : ${baeminNoId.length}명  → 배민 정산서에서 100% 미매칭`);
  console.log(`  ② 쿠팡 키 생성 불가(전화/이름 결손) : ${coupangNoKey.length}명`);
  console.log(`  ③ 쿠팡 키 중복 (한 명만 붙음)       : ${coupangDupKeys.length}쌍`);
  console.log(`  ④ 배민ID 중복 (한 명만 붙음)        : ${baeminDupKeys.length}쌍`);
  console.log(`  ⑤ 동명이인 그룹 (이름 백업 불가)    : ${sameNameGroups.length}그룹`);

  if (baeminNoId.length) {
    console.log('\n① 배민ID 미등록 — 배민 일정산서 올리면 반드시 미매칭됩니다');
    baeminNoId.forEach(r => {
      console.log(`   "${r.name}" · 전화 ${r.phone || '없음'} · 상태 ${r.status}`
        + ` · 쿠팡=${r.platform_coupang !== false ? 'O' : 'X'}`);
    });
  }

  if (coupangNoKey.length) {
    console.log('\n② 쿠팡 키를 만들 수 없는 기사');
    coupangNoKey.forEach(r => {
      console.log(`   "${r.name}" · 전화 ${r.phone || '없음'} · 커스텀쿠팡ID ${customCoupangId(r) || '없음'}`);
    });
  }

  if (coupangDupKeys.length) {
    console.log('\n③ 쿠팡 키가 겹치는 기사 (먼저 등록된 1명만 매칭됨)');
    coupangDupKeys.forEach(([key, list]) => {
      console.log(`   키 "${key}"`);
      list.forEach(r => console.log(`     - "${r.name}" 전화 ${r.phone || '없음'} 상태 ${r.status} id=${String(r.id).slice(0, 8)}…`));
    });
  }

  if (baeminDupKeys.length) {
    console.log('\n④ 배민ID가 겹치는 기사 (먼저 등록된 1명만 매칭됨)');
    baeminDupKeys.forEach(([key, list]) => {
      console.log(`   배민ID "${key}"`);
      list.forEach(r => console.log(`     - "${r.name}" 전화 ${r.phone || '없음'} 상태 ${r.status} id=${String(r.id).slice(0, 8)}…`));
    });
  }

  if (sameNameGroups.length) {
    console.log('\n⑤ 동명이인 — ID가 정확해야 붙습니다 (이름 백업 매칭 불가)');
    sameNameGroups.forEach(([, list]) => {
      console.log(`   "${list[0].name}" ${list.length}명`);
      list.forEach(r => {
        const ck = stripSpaces(erpCoupangId(r));
        console.log(`     - 전화 ${r.phone || '없음'} · 쿠팡키 ${ck || '없음'} · 배민ID ${r.baemin_id || '없음'}`);
      });
    });
  }

  const risky = new Set([
    ...baeminNoId.map(r => r.id),
    ...coupangNoKey.map(r => r.id),
    ...coupangDupKeys.flatMap(([, l]) => l.slice(1).map(r => r.id)),
    ...baeminDupKeys.flatMap(([, l]) => l.slice(1).map(r => r.id))
  ]);

  console.log('\n' + '='.repeat(86));
  console.log(` 결론: 활동중 ${active.length}명 중 ${risky.size}명이 지금 상태로는 미매칭 위험`);
  console.log('='.repeat(86));
  if (!risky.size) {
    console.log(' 등록 정보만으로는 모든 활동중 기사가 매칭 가능하다.');
    console.log(' (정산서에 적힌 ID 자체가 등록값과 다르면 그건 별개 문제다)');
  } else {
    console.log(' 위 목록의 기사 정보를 기사관리에서 채우면 미매칭이 사라진다.');
    console.log(' 특히 ①(배민ID 미등록)은 배민 정산서에서 예외 없이 미매칭된다.');
  }
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});
