#!/usr/bin/env node
/**
 * 이름+전화뒤4 형태(윤다훈4558) → 실명만(윤다훈)으로 보정
 *
 *   node scripts/_fix-name-id-pattern.js            ← 미리보기
 *   node scripts/_fix-name-id-pattern.js --apply    ← 실제 반영
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
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const APPLY = process.argv.includes('--apply');
const dg = v => String(v || '').replace(/[^0-9]/g, '');

async function fetchAll(table, columns) {
  const size = 1000;
  const out = [];
  for (let f = 0; ; f += size) {
    const { data, error } = await supabase.from(table).select(columns).range(f, f + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

function stripNameIdPattern(name) {
  const n = String(name || '').trim();
  const m = n.match(/^(.+?)(\d{4})$/);
  return m ? m[1] : n;
}

(async () => {
  const riders = await fetchAll('riders', 'id,name,phone,status,raw_data,updated_at');
  const byName = new Map();
  for (const r of riders) {
    const key = String(r.name || '').trim();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(r);
  }

  const targets = [];
  for (const r of riders) {
    const name = String(r.name || '').trim();
    const m = name.match(/^(.+?)(\d{4})$/);
    if (!m) continue;
    const tail = m[2];
    const phoneTail = dg(r.phone).slice(-4);
    if (tail !== phoneTail || phoneTail.length !== 4) continue;
    const newName = m[1];
    targets.push({ ...r, oldName: name, newName, tail });
  }

  if (!targets.length) {
    console.log('보정 대상 없음.');
    return;
  }

  console.log(`=== 이름 보정 대상 ${targets.length}명 ===\n`);
  const plans = [];
  for (const t of targets) {
    const existing = (byName.get(t.newName) || []).filter(r => r.id !== t.id);
    const conflict = existing.length > 0;
    console.log(`${t.oldName} → ${t.newName}  (${t.phone})  ${t.status}${conflict ? '  ⚠ 동명이인 ' + existing.length + '명 존재' : ''}`);
    if (conflict) {
      for (const e of existing) {
        console.log(`     기존: ${e.name}  ${e.phone}  id=${e.id}`);
      }
    }
    plans.push({ ...t, conflict, existing });
  }

  const blocked = plans.filter(p => p.conflict);
  const allowed = plans.filter(p => !p.conflict);
  if (blocked.length) {
    console.log(`\n⚠ 동명이인 충돌로 제외 ${blocked.length}명:`);
    for (const p of blocked) {
      console.log(`  ${p.oldName} → ${p.newName} (기존 ${p.existing.map(e => `${e.name} ${e.phone}`).join(', ')})`);
    }
  }

  if (!allowed.length) {
    die('반영 가능한 대상이 없습니다.');
  }

  if (!APPLY) {
    console.log(`\n미리보기: 반영 가능 ${allowed.length}명. 실제 반영하려면 --apply 를 붙이세요.`);
    return;
  }

  let ok = 0;
  for (const p of allowed) {
    const raw = p.raw_data && typeof p.raw_data === 'object' ? { ...p.raw_data } : {};
    raw.name = p.newName;
    const patch = {
      name: p.newName,
      raw_data: raw,
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase.from('riders').update(patch).eq('id', p.id);
    if (error) die(`업데이트 실패 (${p.oldName})`, error.message);
    console.log(`✓ ${p.oldName} → ${p.newName}`);
    ok += 1;
  }

  console.log(`\n완료: ${ok}명 이름 변경`);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
