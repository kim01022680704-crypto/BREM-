#!/usr/bin/env node
/**
 * 박준혁 동명이인 분리 (읽기 전용 기본 / --apply 시 반영)
 *
 * 박준혁4453(쿠팡, 010-5885-4453) 데이터가
 * 박준혁8013(배민, 010-7638-8013)에 붙어 있는 것을 되돌린다.
 *
 *   node scripts/_fix-park-junhyuk-split.js
 *   node scripts/_fix-park-junhyuk-split.js --apply
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

const APPLY = process.argv.includes('--apply');
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const WRONG = '16e8d369-a177-4d0b-b5f3-7501ef07dc81'; // 8013 배민
const RIGHT = '2957c8ca-6543-4922-bb3e-44abca893d77'; // 4453 쿠팡
const ERP = '박준혁4453';
const NAME = '박준혁';

const money = n => `${Math.round(Number(n || 0)).toLocaleString('ko-KR')}원`;
const norm = s => String(s || '').replace(/\s+/g, '');
const digits = s => String(s || '').replace(/[^0-9]/g, '');

function is4453Key(v) {
  const s = norm(v);
  return s === ERP || s.endsWith('4453');
}

async function fetchAll(table, columns, build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(columns).range(from, from + 999);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function readSetting(key) {
  const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw new Error(`settings ${key}: ${error.message}`);
  let v = data?.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) {} }
  return v;
}
async function writeSetting(key, value) {
  const { error } = await sb.from('settings').upsert({
    key, value, updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) throw new Error(`settings ${key} 저장 실패: ${error.message}`);
}

(async () => {
  console.log('='.repeat(88));
  console.log(` 박준혁 동명이인 분리  ${APPLY ? '### 실제 반영 ###' : '미리보기 (쓰기 없음)'}`);
  console.log(`  ${ERP}  →  010-5885-4453 (${RIGHT.slice(0, 8)})`);
  console.log(`  배민 qkrwnsgurok 는 010-7638-8013 에 그대로`);
  console.log('='.repeat(88));

  const plan = {
    at: new Date().toISOString(),
    apply: APPLY,
    mapping: null,
    directHits: [],
    weeklyHits: [],
    withdrawals: [],
    daily: [],
    calls: [],
    slips: [],
    adjMoves: [],
    crawl: [],
    rider8013: null
  };

  const { data: riders, error: rErr } = await sb.from('riders')
    .select('id,name,phone,baemin_id,status,platform_coupang,platform_baemin,raw_data')
    .in('id', [WRONG, RIGHT]);
  if (rErr) throw rErr;
  riders.forEach(r => {
    console.log(`  ${r.phone} ${r.id.slice(0, 8)} 쿠팡=${r.platform_coupang} 배민=${r.platform_baemin} 배민ID=${r.baemin_id || '-'}`);
  });
  const rider8013 = riders.find(r => r.id === WRONG);
  plan.rider8013 = rider8013;

  // ---- 수동 매핑 ----
  const mappings = await readSetting('brem_admin_manual_name_mappings');
  const mapList = Array.isArray(mappings) ? mappings : [];
  const mapHits = mapList.filter(m => is4453Key(m.originalName) || (norm(m.driverName) === NAME && String(m.driverId) === WRONG && String(m.platform) === 'coupang'));
  console.log(`\n[1] 수동 매핑 ${mapHits.length}건`);
  mapHits.forEach(m => console.log(`  ${m.originalName} → ${m.driverName} ${String(m.driverId).slice(0, 8)} ${m.platform}`));
  plan.mapping = mapHits;

  // ---- 직계약 정산서 ----
  const direct = await readSetting('brem_admin_weekly_settlements_direct');
  const directList = Array.isArray(direct) ? direct : [];
  directList.forEach(row => {
    (Array.isArray(row.riders) ? row.riders : []).forEach((item, idx) => {
      const erp = norm(item.coupangLoginKey || item.originalName);
      const matched = String(item.matchedRiderId || '');
      if (erp === ERP || (matched === WRONG && String(row.platform) === 'coupang' && norm(item.originalName).startsWith(NAME))) {
        const rec = {
          settlementId: row.id,
          start: String(row.startDate || '').slice(0, 10),
          platform: row.platform,
          file: row.fileName || row.file_name,
          region: row.region,
          idx,
          erp,
          originalName: item.originalName,
          matched,
          calls: Number(item.weeklyOrderCount || 0),
          deliveryFee: Number(item.amounts?.deliveryFee || 0)
        };
        plan.directHits.push(rec);
      }
    });
  });
  console.log(`\n[2] 직계약 정산서 행 ${plan.directHits.length}건`);
  plan.directHits.forEach(h => {
    console.log(`  ${h.start} ${h.platform} ${h.region} ${h.erp} 콜=${h.calls} ${money(h.deliveryFee)} 매칭=${h.matched.slice(0, 8)}`);
  });

  // ---- 브로커 주정산 (건드리면 안 됨, 확인만) ----
  const weekly = await fetchAll('weekly_settlements', 'id,platform,start_date,file_name,region,riders');
  weekly.forEach(row => {
    (Array.isArray(row.riders) ? row.riders : []).forEach(item => {
      const matched = String(item.matchedRiderId || '');
      const erp = norm(item.coupangLoginKey || item.originalName || item.baeminUserId);
      if (matched === WRONG || matched === RIGHT || erp === ERP || erp.toLowerCase() === 'qkrwnsgurok') {
        plan.weeklyHits.push({
          id: row.id,
          start: row.start_date,
          platform: row.platform,
          region: row.region,
          file: row.file_name,
          erp,
          baemin: item.baeminUserId,
          matched,
          calls: item.weeklyOrderCount
        });
      }
    });
  });
  console.log(`\n[3] 브로커 주정산 ${plan.weeklyHits.length}건 (배민은 8013 유지)`);
  plan.weeklyHits.forEach(h => {
    console.log(`  ${String(h.start).slice(0, 10)} ${h.platform} ${h.region || '-'} ${h.baemin || h.erp} 콜=${h.calls} 매칭=${String(h.matched).slice(0, 8)}`);
  });

  // ---- 출금 ----
  const wdBlob = await readSetting('brem_payroll_withdrawal_requests_v1');
  const allWd = Array.isArray(wdBlob) ? wdBlob : (Array.isArray(wdBlob?.requests) ? wdBlob.requests : []);
  allWd.forEach((x, i) => {
    const id = String(x.driverId || '');
    const key = norm(x.coupangId || x.coupangLoginKey);
    if (id === WRONG || id === RIGHT || key === ERP || (norm(x.driverName) === NAME && String(x.platform) === 'coupang')) {
      plan.withdrawals.push({
        index: i,
        weekStart: x.weekStart,
        platform: x.platform,
        status: x.status,
        amount: x.amount,
        fee: x.feeAmount || x.fee,
        driverId: id,
        name: x.driverName,
        createdAt: x.createdAt
      });
    }
  });
  console.log(`\n[4] 출금 ${plan.withdrawals.length}건`);
  plan.withdrawals.forEach(w => {
    console.log(`  ${w.weekStart} ${w.platform} ${w.status} ${money(w.amount)} fee=${money(w.fee)} driver=${String(w.driverId).slice(0, 8)}`);
  });

  // ---- 일정산 / 콜 (8013 쿠팡만 이동 대상) ----
  const daily = await fetchAll(
    'daily_settlements',
    'id,driver_id,period,platform,order_count,settlement_amount,delivery_amount,applied_at',
    q => q.in('driver_id', [WRONG, RIGHT])
  );
  const calls = await fetchAll(
    'admin_calls',
    'id,driver_id,date,platform,count,created_at',
    q => q.in('driver_id', [WRONG, RIGHT])
  );
  // 6월 쿠팡(박준혁8013, 브로커 남구중앙 57콜)은 8013 본인 건. 4453 정산주만 옮긴다.
  const moveWeeks = new Set(plan.directHits.filter(h => h.erp === ERP).map(h => h.start));
  function inMoveWeek(dateStr) {
    const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return false;
    d.setDate(d.getDate() - ((d.getDay() - 3 + 7) % 7));
    const wk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return moveWeeks.has(wk);
  }
  const allCoupangDaily8013 = daily.filter(d => d.driver_id === WRONG && d.platform === 'coupang');
  const allCoupangCalls8013 = calls.filter(c => c.driver_id === WRONG && c.platform === 'coupang');
  plan.daily = allCoupangDaily8013.filter(d => inMoveWeek(d.period));
  plan.calls = allCoupangCalls8013.filter(c => inMoveWeek(c.date));
  const keepDaily = allCoupangDaily8013.filter(d => !inMoveWeek(d.period));
  const keepCalls = allCoupangCalls8013.filter(c => !inMoveWeek(c.date));
  console.log(`  (유지) 8013 본인 쿠팡 일정산 ${keepDaily.length} · 콜 ${keepCalls.length} — 박준혁8013`);
  const daily4453 = daily.filter(d => d.driver_id === RIGHT);
  const calls4453 = calls.filter(c => c.driver_id === RIGHT);
  console.log(`\n[5] 일정산 8013쿠팡 ${plan.daily.length}건 / 4453 ${daily4453.length}건`);
  plan.daily.forEach(d => console.log(`  ${String(d.period).slice(0, 10)} ${d.order_count}콜 ${money(d.settlement_amount)} id=${d.id}`));
  console.log(`  콜수 8013쿠팡 ${plan.calls.length}건 / 4453 ${calls4453.length}건`);
  plan.calls.forEach(c => console.log(`  ${String(c.date).slice(0, 10)} ${c.count}콜 id=${c.id}`));

  const baeminDaily8013 = daily.filter(d => d.driver_id === WRONG && d.platform === 'baemin');
  const baeminCalls8013 = calls.filter(c => c.driver_id === WRONG && c.platform === 'baemin');
  console.log(`  (유지) 8013 배민 일정산 ${baeminDaily8013.length} · 콜 ${baeminCalls8013.length}`);

  // ---- 급여줄 ----
  const slips = await fetchAll(
    'payroll_slip_lines',
    'id,driver_id,rider_name,gross_pay,net_pay,total_deduction,raw_data,created_at',
    q => q.in('driver_id', [WRONG, RIGHT])
  );
  plan.slips = slips.filter(l => {
    const raw = l.raw_data || {};
    const ps = raw.payslip || {};
    const coupangId = norm(ps.coupangId || raw.coupangId);
    return coupangId === ERP || (l.driver_id === WRONG && String(raw.platform || ps.platform) === 'coupang');
  });
  console.log(`\n[6] 급여줄 이동 대상 ${plan.slips.length}건 (8013 전체 ${slips.filter(s => s.driver_id === WRONG).length}건)`);
  plan.slips.forEach(l => {
    const raw = l.raw_data || {};
    console.log(`  ${raw.settlementWeekStart || '-'} ${raw.platform} ${money(l.gross_pay)} → ${money(l.net_pay)} coupangId=${raw.coupangId || raw.payslip?.coupangId} id=${l.id}`);
  });

  // ---- 조정값 ----
  const adj = await readSetting('brem_admin_direct_settlement_adjustments_v1') || {};
  Object.keys(adj).forEach(kind => {
    const bySid = adj[kind];
    if (!bySid || typeof bySid !== 'object') return;
    plan.directHits.forEach(h => {
      const entry = bySid[h.settlementId];
      if (entry && entry[WRONG]) {
        plan.adjMoves.push({ kind, settlementId: h.settlementId, from: WRONG, amount: entry[WRONG] });
      }
    });
  });
  console.log(`\n[7] 조정값(기타/프로모션 등) 이동 ${plan.adjMoves.length}건`);
  plan.adjMoves.forEach(a => console.log(`  ${a.kind} ${a.settlementId} ${JSON.stringify(a.amount)}`));

  // ---- 크롤로 4453 확인 ----
  const { data: crawl, error: cErr } = await sb.from('coupang_collect_items')
    .select('rider_name,phone_number,collect_date,match_key,source_menu')
    .or(`match_key.eq.${ERP},phone_number.ilike.%4453`)
    .order('collect_date', { ascending: false })
    .limit(20);
  if (cErr) console.log(`  크롤 조회 실패: ${cErr.message}`);
  plan.crawl = crawl || [];
  console.log(`\n[8] 쿠팡 크롤 ${plan.crawl.length}건`);
  plan.crawl.slice(0, 8).forEach(c => {
    console.log(`  ${String(c.collect_date).slice(0, 10)} ${c.match_key} ${c.rider_name} ${c.phone_number} ${c.source_menu}`);
  });

  const out = path.join(__dirname, '..', 'logs', 'fix-park-junhyuk-split.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(plan, null, 2));

  const moveDirect = plan.directHits.filter(h => h.matched === WRONG && h.erp === ERP);
  const moveWd = plan.withdrawals.filter(w => w.driverId === WRONG && String(w.platform) === 'coupang' && moveWeeks.has(String(w.weekStart || '').slice(0, 10)));
  console.log('\n' + '─'.repeat(88));
  console.log(' 이동 계획');
  console.log(`  매핑 ${ERP} → 4453`);
  console.log(`  직계약 정산서 ${moveDirect.length}행`);
  console.log(`  출금 ${moveWd.length}건`);
  console.log(`  일정산(쿠팡) ${plan.daily.length}건`);
  console.log(`  콜수(쿠팡) ${plan.calls.length}건`);
  console.log(`  급여줄 ${plan.slips.length}건`);
  console.log(`  조정값 ${plan.adjMoves.length}건`);
  console.log(`  브로커/배민은 이동하지 않음`);
  console.log(`상세: ${out}`);

  if (!APPLY) {
    console.log('\n맞으면 실행: node scripts/_fix-park-junhyuk-split.js --apply');
    return;
  }

  const now = new Date().toISOString();

  // 1) 매핑
  const nextMaps = mapList.map(m => {
    if (!is4453Key(m.originalName)) return m;
    return { ...m, driverId: RIGHT, driverName: NAME, updatedAt: now, note: 'split-from-8013' };
  });
  const has4453 = nextMaps.some(m => is4453Key(m.originalName) && m.driverId === RIGHT);
  if (!has4453) {
    nextMaps.unshift({
      id: `map-split-park-junhyuk-4453`,
      platform: 'coupang',
      originalName: ERP,
      driverId: RIGHT,
      driverName: NAME,
      updatedAt: now
    });
  }
  await writeSetting('brem_admin_manual_name_mappings', nextMaps);
  console.log('\n✓ 수동 매핑 갱신');

  // 2) 직계약 정산서
  let directChanged = 0;
  const directNext = directList.map(row => {
    let changed = false;
    const ridersNext = (Array.isArray(row.riders) ? row.riders : []).map(item => {
      const erp = norm(item.coupangLoginKey || item.originalName);
      if (erp !== ERP || String(item.matchedRiderId) === RIGHT) return item;
      changed = true;
      directChanged += 1;
      return { ...item, matchedRiderId: RIGHT, matched: true, driverName: NAME };
    });
    const partsNext = Array.isArray(row.sourceParts)
      ? row.sourceParts.map(part => ({
        ...part,
        riders: (Array.isArray(part.riders) ? part.riders : []).map(item => {
          const erp = norm(item.coupangLoginKey || item.originalName);
          if (erp !== ERP || String(item.matchedRiderId) === RIGHT) return item;
          changed = true;
          return { ...item, matchedRiderId: RIGHT, matched: true, driverName: NAME };
        })
      }))
      : row.sourceParts;
    return changed ? { ...row, riders: ridersNext, sourceParts: partsNext } : row;
  });
  if (directChanged) await writeSetting('brem_admin_weekly_settlements_direct', directNext);
  console.log(`✓ 직계약 정산서 ${directChanged}행`);

  // 3) 출금
  let wdChanged = 0;
  const wdNext = allWd.map(x => {
    if (String(x.driverId) !== WRONG || String(x.platform) !== 'coupang') return x;
    if (!moveWeeks.has(String(x.weekStart || '').slice(0, 10))) return x;
    wdChanged += 1;
    return { ...x, driverId: RIGHT, driverName: NAME, phone: '010-5885-4453', remappedAt: now, remappedFrom: WRONG };
  });
  if (wdChanged) {
    if (Array.isArray(wdBlob)) await writeSetting('brem_payroll_withdrawal_requests_v1', wdNext);
    else await writeSetting('brem_payroll_withdrawal_requests_v1', { ...wdBlob, requests: wdNext });
  }
  console.log(`✓ 출금 ${wdChanged}건`);

  // 4) 일정산 — id 가 driverId 를 포함하므로 삭제 후 삽입
  for (const d of plan.daily) {
    const newId = `${RIGHT}-${String(d.period).slice(0, 10)}-coupang`;
    const { data: dup } = await sb.from('daily_settlements').select('id').eq('id', newId).maybeSingle();
    if (dup) {
      console.log(`  skip daily ${d.period} (이미 4453에 있음)`);
      const { error } = await sb.from('daily_settlements').delete().eq('id', d.id);
      if (error) throw new Error(`daily delete ${d.id}: ${error.message}`);
      continue;
    }
    const { data: full, error: gErr } = await sb.from('daily_settlements').select('*').eq('id', d.id).maybeSingle();
    if (gErr) throw gErr;
    const row = { ...full, id: newId, driver_id: RIGHT, updated_at: now };
    const { error: iErr } = await sb.from('daily_settlements').insert(row);
    if (iErr) throw new Error(`daily insert ${newId}: ${iErr.message}`);
    const { error: dErr } = await sb.from('daily_settlements').delete().eq('id', d.id);
    if (dErr) throw new Error(`daily delete ${d.id}: ${dErr.message}`);
    console.log(`  daily ${String(d.period).slice(0, 10)} → ${newId}`);
  }
  console.log(`✓ 일정산 ${plan.daily.length}건`);

  // 5) 콜수
  for (const c of plan.calls) {
    const date = String(c.date).slice(0, 10);
    const newId = `${RIGHT}-${date}-coupang`;
    const { data: dup } = await sb.from('admin_calls').select('id').eq('id', newId).maybeSingle();
    if (dup) {
      console.log(`  skip call ${date} (이미 4453에 있음)`);
      const { error } = await sb.from('admin_calls').delete().eq('id', c.id);
      if (error) throw new Error(`call delete ${c.id}: ${error.message}`);
      continue;
    }
    const { data: full, error: gErr } = await sb.from('admin_calls').select('*').eq('id', c.id).maybeSingle();
    if (gErr) throw gErr;
    const row = { ...full, id: newId, driver_id: RIGHT, updated_at: now };
    const { error: iErr } = await sb.from('admin_calls').insert(row);
    if (iErr) throw new Error(`call insert ${newId}: ${iErr.message}`);
    const { error: dErr } = await sb.from('admin_calls').delete().eq('id', c.id);
    if (dErr) throw new Error(`call delete ${c.id}: ${dErr.message}`);
    console.log(`  call ${date} ${c.count} → ${newId}`);
  }
  console.log(`✓ 콜수 ${plan.calls.length}건`);

  // 6) 급여줄 — id 가 driver 를 포함할 수 있음
  for (const l of plan.slips) {
    const raw = l.raw_data && typeof l.raw_data === 'object' ? { ...l.raw_data } : {};
    const ps = raw.payslip && typeof raw.payslip === 'object' ? { ...raw.payslip } : {};
    raw.payslip = ps;
    const settlementId = String(raw.settlementId || '').trim();
    const newId = settlementId ? `direct-${settlementId}-${RIGHT}` : l.id;
    const { data: full, error: gErr } = await sb.from('payroll_slip_lines').select('*').eq('id', l.id).maybeSingle();
    if (gErr) throw gErr;
    const next = {
      ...full,
      id: newId,
      driver_id: RIGHT,
      rider_name: NAME,
      raw_data: raw,
      updated_at: now
    };
    if (newId !== l.id) {
      const { data: dup } = await sb.from('payroll_slip_lines').select('id').eq('id', newId).maybeSingle();
      if (dup) {
        await sb.from('payroll_slip_lines').delete().eq('id', l.id);
        console.log(`  slip skip/delete ${l.id} (이미 ${newId})`);
        continue;
      }
      const { error: iErr } = await sb.from('payroll_slip_lines').insert(next);
      if (iErr) throw new Error(`slip insert ${newId}: ${iErr.message}`);
      const { error: dErr } = await sb.from('payroll_slip_lines').delete().eq('id', l.id);
      if (dErr) throw new Error(`slip delete ${l.id}: ${dErr.message}`);
    } else {
      const { error: uErr } = await sb.from('payroll_slip_lines').update({
        driver_id: RIGHT,
        rider_name: NAME,
        raw_data: raw,
        updated_at: now
      }).eq('id', l.id);
      if (uErr) throw new Error(`slip update ${l.id}: ${uErr.message}`);
    }
    console.log(`  slip ${l.id} → ${newId}`);
  }
  console.log(`✓ 급여줄 ${plan.slips.length}건`);

  // 7) 조정값
  let adjMoved = 0;
  const adjNext = JSON.parse(JSON.stringify(adj || {}));
  Object.keys(adjNext).forEach(kind => {
    const bySid = adjNext[kind];
    if (!bySid || typeof bySid !== 'object') return;
    plan.directHits.forEach(h => {
      const entry = bySid[h.settlementId];
      if (!entry || !entry[WRONG]) return;
      const moving = entry[WRONG];
      delete entry[WRONG];
      entry[RIGHT] = entry[RIGHT]
        ? { ...entry[RIGHT], amount: Math.round(Number(entry[RIGHT].amount || 0) + Number(moving.amount || 0)), driverName: NAME }
        : { ...moving, driverName: NAME };
      adjMoved += 1;
    });
  });
  if (adjMoved) await writeSetting('brem_admin_direct_settlement_adjustments_v1', adjNext);
  console.log(`✓ 조정값 ${adjMoved}건`);

  // 8) 8013 쿠팡 플래그 — 쿠팡 데이터가 더 없으면 끔
  const { data: leftCoupangDaily } = await sb.from('daily_settlements')
    .select('id').eq('driver_id', WRONG).eq('platform', 'coupang').limit(1);
  const { data: leftCoupangCalls } = await sb.from('admin_calls')
    .select('id').eq('driver_id', WRONG).eq('platform', 'coupang').limit(1);
  const stillHasCoupang = (leftCoupangDaily || []).length || (leftCoupangCalls || []).length;
  if (!stillHasCoupang && rider8013) {
    const raw = rider8013.raw_data && typeof rider8013.raw_data === 'object' ? { ...rider8013.raw_data } : {};
    raw.platformCoupang = false;
    raw.regionCoupang = '';
    raw.updatedAt = now;
    const { error: uErr } = await sb.from('riders').update({
      platform_coupang: false,
      raw_data: raw,
      updated_at: now
    }).eq('id', WRONG);
    if (uErr) throw new Error(`rider 8013 쿠팡 플래그: ${uErr.message}`);
    console.log('✓ 8013 쿠팡 플랫폼 해제 (배민만 유지)');
  } else {
    console.log(`  8013에 쿠팡 잔여 데이터 있음 — 플랫폼 플래그는 그대로`);
  }

  console.log('\n반영 완료. 관리자 화면은 새로고침해야 합니다.');
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});
