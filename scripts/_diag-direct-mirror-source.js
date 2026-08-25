#!/usr/bin/env node
/** 직계약 정산서가 어디에 저장되는지 + manualAdjustments 미러 실태 (읽기 전용) */
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

(async () => {
  console.log('='.repeat(88));
  console.log(' 직계약 정산서 저장 위치 · manualAdjustments 미러 실태 (읽기 전용)');
  console.log('='.repeat(88));

  // 1) settings JSON 쪽
  const { data: setRow } = await supabase.from('settings')
    .select('value,updated_at').eq('key', 'brem_admin_weekly_settlements_direct').maybeSingle();
  let setList = setRow?.value ?? null;
  if (typeof setList === 'string') { try { setList = JSON.parse(setList); } catch (_) {} }
  const setArr = Array.isArray(setList) ? setList : [];
  console.log(`\n[settings] brem_admin_weekly_settlements_direct`);
  console.log(`  ${setArr.length}건 · 최종수정 ${setRow?.updated_at || '(없음)'}`);

  // 2) weekly_settlements 테이블 쪽
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('weekly_settlements')
      .select('id,platform,region,start_date,end_date,summary,riders,uploaded_at')
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const direct = rows.filter(r => (r.summary && typeof r.summary === 'object' ? r.summary.channel : '') === 'direct');
  console.log(`\n[table] weekly_settlements`);
  console.log(`  전체 ${rows.length}건 · summary.channel='direct' ${direct.length}건`);

  function countMirror(list, label) {
    let settlements = 0;
    let riders = 0;
    let mirrored = 0;
    const samples = [];
    (list || []).forEach(s => {
      const rs = Array.isArray(s.riders) ? s.riders : [];
      if (!rs.length) return;
      settlements += 1;
      riders += rs.length;
      rs.forEach(r => {
        if (r?.manualAdjustments && typeof r.manualAdjustments === 'object') {
          mirrored += 1;
          if (samples.length < 8) {
            samples.push({ id: s.id, name: r.driverName || r.riderName || '', m: r.manualAdjustments });
          }
        }
      });
    });
    console.log(`\n  [${label}] 정산서 ${settlements}건 · 라이더행 ${riders}건 · manualAdjustments ${mirrored}건`);
    samples.forEach(s => {
      console.log(`    "${s.name}" ${JSON.stringify(s.m)} (정산서 ${String(s.id).slice(0, 34)})`);
    });
    return mirrored;
  }

  const mSet = countMirror(setArr, 'settings JSON');
  const mTbl = countMirror(direct.length ? direct : rows, 'weekly_settlements 테이블');

  // 3) 최근 반영 주차의 정산서가 어느 쪽에 있는지
  console.log('\n[최근 주차 정산서 존재 여부]');
  ['2026-08-19', '2026-08-12', '2026-08-05'].forEach(week => {
    const inSet = setArr.filter(s => String(s.startDate || s.start_date || '').slice(0, 10) === week).length;
    const inTbl = rows.filter(s => String(s.start_date || '').slice(0, 10) === week).length;
    console.log(`  ${week}  settings ${inSet}건 · table ${inTbl}건`);
  });

  console.log('\n[결론]');
  const src = setArr.length >= direct.length ? 'settings JSON' : 'weekly_settlements 테이블';
  console.log(`  직계약 정산서 주 저장소로 보이는 곳: ${src}`);
  if (mSet + mTbl === 0) {
    console.log('  → 어느 쪽에도 manualAdjustments 미러가 하나도 없다.');
    console.log('     8/22 에 넣은 미러 백업이 실제로는 한 번도 저장되지 않았다는 뜻이다.');
  } else {
    console.log(`  → 미러 총 ${mSet + mTbl}건 존재 (settings ${mSet} · table ${mTbl})`);
  }
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});
