#!/usr/bin/env node
/**
 * 박형진(wlslxlqlalzl) 남A 일정산이 김영광(glory8922)에게 붙은 행을 되돌린다.
 *
 *   node scripts/_fix-park-hyungjin-daily.js
 *   node scripts/_fix-park-hyungjin-daily.js --apply
 *
 * 8/27 수동매핑 수정 이전 반영분: 8/21, 8/22, 8/23, 8/24, 8/26
 * admin_calls 는 이미 박형진에게 있으므로 건드리지 않는다.
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

const withdrawal = require('../server/rider-withdrawal');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const APPLY = process.argv.includes('--apply');
const FROM_ID = '4806c5aa-c9ed-4228-8e1a-40f679a6a76f'; // 김영광 북B
const TO_ID = 'b98e9f5b-92f8-4be2-ba21-63e6053c3ad8';   // 박형진 남A1
const BAEMIN = 'wlslxlqlalzl';
const PLATFORM = 'baemin';
const DATES = [
  { date: '2026-08-21', order: 18, amount: 98520 },
  { date: '2026-08-22', order: 10, amount: 37940 },
  { date: '2026-08-23', order: 54, amount: 212910 },
  { date: '2026-08-24', order: 55, amount: 190270 },
  { date: '2026-08-26', order: 58, amount: 196710 }
];
const WEEKS = ['2026-08-19', '2026-08-26'];

const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');

(async () => {
  console.log('='.repeat(88));
  console.log(` 박형진 일정산 오배정 보정 — ${APPLY ? '### 실제 반영 ###' : '미리보기 (쓰기 없음)'}`);
  console.log('='.repeat(88));

  const { data: riders, error: rErr } = await supabase
    .from('riders').select('id,name,phone,baemin_id').in('id', [FROM_ID, TO_ID]);
  if (rErr) die('riders 조회 실패', rErr.message);
  const from = (riders || []).find(r => r.id === FROM_ID);
  const to = (riders || []).find(r => r.id === TO_ID);
  if (!from || !to) die('대상 기사를 찾지 못했습니다.');
  if (String(to.baemin_id || '').toLowerCase() !== BAEMIN) {
    die('박형진 baemin_id 가 기대와 다릅니다.', to.baemin_id);
  }
  console.log(`\n  보내는 쪽: ${from.name} ${from.phone} (${from.baemin_id})`);
  console.log(`  받는 쪽  : ${to.name} ${to.phone} (${to.baemin_id})`);

  const moves = [];
  for (const spec of DATES) {
    const srcId = `${FROM_ID}-${spec.date}-${PLATFORM}`;
    const dstId = `${TO_ID}-${spec.date}-${PLATFORM}`;
    const { data: src, error: sErr } = await supabase
      .from('daily_settlements').select('*').eq('id', srcId).maybeSingle();
    if (sErr) die('daily_settlements 조회 실패', sErr.message);
    if (!src) die(`원본 일정산 행이 없습니다: ${srcId}`);
    if (String(src.rider_id || '').toLowerCase() !== BAEMIN) {
      die(`${spec.date} rider_id 가 wlslxlqlalzl 이 아닙니다.`, src.rider_id);
    }
    if (Number(src.order_count) !== spec.order || Math.round(Number(src.settlement_amount)) !== spec.amount) {
      die(`${spec.date} 값이 기대와 다릅니다.`,
        `콜 ${src.order_count}(기대 ${spec.order}) · 금액 ${src.settlement_amount}(기대 ${spec.amount})`);
    }
    const { data: dst } = await supabase.from('daily_settlements').select('id').eq('id', dstId).maybeSingle();
    if (dst) die(`받는 쪽에 이미 같은 날 행이 있습니다: ${dstId}`);
    moves.push({ spec, srcId, dstId, src });
    console.log(`  [일정산] ${spec.date}  ${src.order_count}콜  ${won(src.settlement_amount)}원`);
    console.log(`           ${srcId}`);
    console.log(`        → ${dstId}`);
  }

  const { data: setRow, error: wErr } = await supabase
    .from('settings').select('value').eq('key', withdrawal.REQUESTS_KEY).maybeSingle();
  if (wErr) die('출금신청 조회 실패', wErr.message);
  let wv = setRow?.value;
  if (typeof wv === 'string') { try { wv = JSON.parse(wv); } catch (_) { wv = []; } }
  const live = withdrawal.__audit.normalizeRequestList(wv)
    .filter(x => (x.status === 'pending' || x.status === 'completed')
      && [FROM_ID, TO_ID].includes(String(x.driverId))
      && WEEKS.includes(String(x.weekStart).slice(0, 10)));
  if (live.length) {
    live.forEach(x => console.log(`    ${x.driverId === FROM_ID ? from.name : to.name}`
      + ` ${x.weekStart} ${won(x.amount)}원 · ${x.status}`));
    die('해당 주에 출금이 이미 나갔습니다.', '한도가 소급 재계산되므로 사람이 판단해야 합니다.');
  }
  console.log('\n  출금 확인: 8/19·8/26 주 두 기사 모두 출금 없음');

  const periods = DATES.map(d => d.date);
  const { data: logs, error: lErr } = await supabase
    .from('settlement_upload_logs')
    .select('id,file_name,period,applied_records,matched_records')
    .eq('platform', PLATFORM).eq('kind', 'daily').in('period', periods);
  if (lErr) die('업로드 로그 조회 실패', lErr.message);
  const logPatches = [];
  (logs || []).forEach(l => {
    const fix = arr => {
      if (!Array.isArray(arr)) return { changed: 0, next: arr };
      let changed = 0;
      const next = arr.map(rec => {
        const samePerson = String(rec?.riderId || '').toLowerCase() === BAEMIN
          || String(rec?.rawName || rec?.name || '') === '박형진';
        if (String(rec?.driverId || '') === FROM_ID && samePerson) {
          changed += 1;
          return { ...rec, driverId: TO_ID, driverName: '박형진' };
        }
        return rec;
      });
      return { changed, next };
    };
    const a = fix(l.applied_records);
    const m = fix(l.matched_records);
    if (a.changed || m.changed) {
      logPatches.push({
        id: l.id,
        fileName: l.file_name,
        period: l.period,
        applied: a.next,
        matched: m.next,
        count: a.changed + m.changed
      });
    }
  });
  if (logPatches.length) {
    logPatches.forEach(p => console.log(`  [업로드로그] ${p.period} ${p.fileName} · ${p.count}곳`));
  } else {
    die('교체할 업로드 로그가 없습니다.');
  }

  if (!APPLY) {
    console.log('\n' + '='.repeat(88));
    console.log(' 미리보기입니다. 실제로 옮기려면 --apply 를 붙여 다시 실행하세요.');
    console.log('='.repeat(88));
    return;
  }

  console.log('\n' + '='.repeat(88));
  console.log(' 반영 시작');

  for (const move of moves) {
    const nextRow = {
      ...move.src,
      id: move.dstId,
      driver_id: TO_ID,
      updated_at: new Date().toISOString()
    };
    const ins = await supabase.from('daily_settlements').insert(nextRow);
    if (ins.error) die(`일정산 이동(insert) 실패 ${move.spec.date}`, ins.error.message);
    const del = await supabase.from('daily_settlements').delete().eq('id', move.srcId);
    if (del.error) {
      die(`일정산 원본 삭제 실패 ${move.spec.date} — 같은 금액이 두 명에게 있습니다.`, del.error.message);
    }
    console.log(`  이동 완료 ${move.spec.date}: ${move.src.order_count}콜`);
  }

  for (const p of logPatches) {
    const up = await supabase.from('settlement_upload_logs')
      .update({
        applied_records: p.applied,
        matched_records: p.matched,
        updated_at: new Date().toISOString()
      })
      .eq('id', p.id);
    if (up.error) die('업로드 로그 갱신 실패 (일정산은 이미 이동됨)', up.error.message);
    console.log(`  업로드로그 갱신: ${p.fileName}`);
  }

  const { data: after } = await supabase.from('daily_settlements')
    .select('id,driver_id,period,rider_id,order_count,settlement_amount')
    .in('driver_id', [FROM_ID, TO_ID])
    .eq('platform', PLATFORM)
    .in('period', periods)
    .order('period');
  console.log('\n  반영 후:');
  (after || []).forEach(r => {
    const who = r.driver_id === TO_ID ? '박형진' : '김영광';
    console.log(`    ${r.period} ${who} rider=${r.rider_id} ${r.order_count}콜 ${won(r.settlement_amount)}원`);
  });

  const sum = (rows, id, start, end) => (rows || [])
    .filter(r => r.driver_id === id && r.period >= start && r.period <= end)
    .reduce((n, r) => n + Number(r.order_count || 0), 0);

  const { data: weekRows } = await supabase.from('daily_settlements')
    .select('driver_id,period,order_count')
    .in('driver_id', [FROM_ID, TO_ID])
    .eq('platform', PLATFORM)
    .gte('period', '2026-08-19')
    .lte('period', '2026-08-31');
  console.log('\n  주간 콜수 확인:');
  console.log(`    박형진 8/19~25 일정산 ${sum(weekRows, TO_ID, '2026-08-19', '2026-08-25')} (주정산서 137)`);
  console.log(`    박형진 8/26~31 일정산 ${sum(weekRows, TO_ID, '2026-08-26', '2026-08-31')} (주정산서 257)`);
  console.log(`    김영광 8/26~31 일정산 ${sum(weekRows, FROM_ID, '2026-08-26', '2026-08-31')} (주정산서 140)`);
  console.log('\n 완료. 관리자 화면은 새로고침해야 반영됩니다.');
})().catch(err => die('예상치 못한 오류', err.stack || err.message));
