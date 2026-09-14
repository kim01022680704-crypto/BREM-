#!/usr/bin/env node
/**
 * 삭제된 기사 ID 에 묶인 콜/정산을, 남은 기사에 ERP ID 로 다시 붙인다.
 *
 *   node scripts/_remap-orphan-driver-ids.js            ← 미리보기
 *   node scripts/_remap-orphan-driver-ids.js --apply    ← 실제 반영
 *
 * 원칙
 *  1) 기본은 미리보기. --apply 없이는 쓰지 않는다.
 *  2) 배민ID / 쿠팡로그인키(이름+전화뒤4) 가 남은 기사 1명과만 일치할 때만 붙인다.
 *  3) 같은 날·같은 플랫폼 행이 양쪽 다 있으면 합산하지 않는다. (이중정산 방지)
 *     값이 같으면 고아행만 지우고, 다르면 충돌로 건너뛴다.
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
  try {
    require('dotenv').config({ path: envPath });
    return;
  } catch (_) { /* 수동 파싱 */ }
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
if (!SUPABASE_URL) die('SUPABASE_URL 이 없습니다.');
if (!SERVICE_KEY) die('SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');

let createClient;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch (error) {
  die('@supabase/supabase-js 로드 실패', error.message);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const money = n => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const lower = s => String(s || '').replace(/\s+/g, '').trim().toLowerCase();
const digits = s => String(s || '').replace(/[^0-9]/g, '');
const platformOf = p => (String(p || '').toLowerCase() === 'baemin' ? 'baemin' : 'coupang');

async function fetchAll(table, columns, tweak) {
  const size = 1000;
  const out = [];
  for (let from = 0; ; from += size) {
    let q = supabase.from(table).select(columns).range(from, from + size - 1);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) die(`${table} 조회 실패`, error.message);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

async function fetchSetting(key) {
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) die(`settings.${key} 조회 실패`, error.message);
  let value = data?.value ?? null;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (_) { /* keep string */ }
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

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }
  return value;
}

function coupangLoginOf(rider) {
  const raw = rider.raw_data && typeof rider.raw_data === 'object' ? rider.raw_data : {};
  const explicit = lower(raw.coupangId || raw.coupang_id || rider.coupang_id || '');
  if (explicit) return explicit;
  const name = String(rider.name || '').replace(/\s/g, '');
  const phone4 = digits(rider.phone).slice(-4);
  if (!name || phone4.length !== 4) return '';
  return lower(`${name}${phone4}`);
}

function collectErpKeys(rider) {
  const keys = new Set();
  const baemin = lower(rider.baemin_id);
  if (baemin) keys.add(`baemin:${baemin}`);
  const coupang = coupangLoginOf(rider);
  if (coupang) keys.add(`coupang:${coupang}`);
  const phone = digits(rider.phone);
  if (phone.length >= 10) keys.add(`phone:${phone}`);
  return keys;
}

function addIdCounts(map, driverId, extra = 1) {
  const id = String(driverId || '').trim();
  if (!id) return;
  map.set(id, (map.get(id) || 0) + extra);
}

function uniqueNonEmpty(list) {
  return [...new Set((list || []).map(v => String(v || '').trim()).filter(Boolean))];
}

(async () => {
  console.log('='.repeat(76));
  console.log(` 삭제 기사 ID → 남은 기사 ERP 매칭 ${APPLY ? '### 실제 반영 ###' : '미리보기 (쓰기 없음)'}`);
  console.log('='.repeat(76));

  const riders = await fetchAll('riders', 'id,name,phone,baemin_id,status,raw_data');
  const riderById = new Map(riders.map(r => [String(r.id), r]));
  const livingIds = new Set(riderById.keys());

  const byBaemin = new Map();
  const baeminDupes = new Set();
  const byCoupang = new Map();
  const coupangDupes = new Set();
  const byPhone = new Map();
  const phoneDupes = new Set();

  riders.forEach(r => {
    const baemin = lower(r.baemin_id);
    if (baemin) {
      if (byBaemin.has(baemin)) baeminDupes.add(baemin);
      byBaemin.set(baemin, r);
    }
    const coupang = coupangLoginOf(r);
    if (coupang) {
      if (byCoupang.has(coupang)) coupangDupes.add(coupang);
      byCoupang.set(coupang, r);
    }
    const phone = digits(r.phone);
    if (phone.length >= 10) {
      if (byPhone.has(phone)) phoneDupes.add(phone);
      byPhone.set(phone, r);
    }
  });

  console.log(`\n현재 기사 ${riders.length}명 · 배민ID 중복 ${baeminDupes.size} · 전화 중복 ${phoneDupes.size}`);

  const calls = await fetchAll('admin_calls', 'id,driver_id,date,platform,count');
  const settlements = await fetchAll('daily_settlements', 'id,driver_id,period,platform,rider_id,order_count,delivery_amount,settlement_amount,hourly_insurance,deduction_base,applied_at');
  const rejections = await fetchAll('admin_rejection_rates', 'id,driver_id,week_start,platform,rate');
  const targets = await fetchAll('admin_targets', 'id,driver_id,month,count');
  const weekly = await fetchAll('weekly_settlements', 'id,platform,start_date,end_date,riders,file_name');
  const slips = await fetchAll('payroll_slip_lines', 'id,driver_id,pay_month');

  const idCounts = new Map();
  calls.forEach(r => addIdCounts(idCounts, r.driver_id));
  settlements.forEach(r => addIdCounts(idCounts, r.driver_id));
  rejections.forEach(r => addIdCounts(idCounts, r.driver_id));
  targets.forEach(r => addIdCounts(idCounts, r.driver_id));
  slips.forEach(r => addIdCounts(idCounts, r.driver_id));
  weekly.forEach(row => {
    const list = Array.isArray(row.riders) ? row.riders : [];
    list.forEach(item => addIdCounts(idCounts, item.matchedRiderId || item.matched_rider_id));
  });

  const orphanIds = [...idCounts.keys()].filter(id => !livingIds.has(id)).sort();
  console.log(`콜 ${calls.length} · 일정산 ${settlements.length} · 주정산 ${weekly.length} · 고아 driver_id ${orphanIds.length}개`);

  if (!orphanIds.length) {
    console.log('\n고아 driver_id 가 없습니다. 기사 삭제 때문에 정산 행이 지워진 것은 아닙니다.');
    console.log('화면에서 안 보이면, 남은 기사 ID 로 조회되도록 주정산 matchedRiderId 만 안 바뀐 경우일 수 있습니다.');
  }

  const orphanErp = new Map();
  function rememberErp(driverId, kind, value) {
    const id = String(driverId || '').trim();
    const key = String(value || '').trim();
    if (!id || !key) return;
    if (!orphanErp.has(id)) orphanErp.set(id, { baemin: new Set(), coupang: new Set(), names: new Set() });
    orphanErp.get(id)[kind].add(key);
  }

  settlements.forEach(row => {
    const id = String(row.driver_id || '').trim();
    if (!orphanIds.includes(id)) return;
    const erp = String(row.rider_id || '').trim();
    if (!erp) return;
    if (platformOf(row.platform) === 'baemin') rememberErp(id, 'baemin', lower(erp));
    else rememberErp(id, 'coupang', lower(erp));
  });

  weekly.forEach(row => {
    const list = Array.isArray(row.riders) ? row.riders : [];
    list.forEach(item => {
      const id = String(item.matchedRiderId || item.matched_rider_id || '').trim();
      if (!orphanIds.includes(id)) return;
      const baemin = lower(item.baeminUserId || item.baemin_user_id);
      const coupang = lower(item.coupangLoginKey || item.coupang_login_key);
      const name = String(item.driverName || item.riderName || item.originalName || '').trim();
      if (baemin) rememberErp(id, 'baemin', baemin);
      if (coupang) rememberErp(id, 'coupang', coupang);
      if (name) rememberErp(id, 'names', name);
    });
  });

  const remap = new Map();
  const skipped = [];
  const unmatched = [];

  orphanIds.forEach(fromId => {
    const hits = new Map();
    const reasons = [];
    const erp = orphanErp.get(fromId) || { baemin: new Set(), coupang: new Set(), names: new Set() };

    erp.baemin.forEach(key => {
      if (baeminDupes.has(key)) {
        reasons.push(`배민ID ${key} 가 남은 기사에 중복`);
        return;
      }
      const rider = byBaemin.get(key);
      if (rider) {
        hits.set(String(rider.id), rider);
        reasons.push(`배민ID ${key} → ${rider.name}`);
      }
    });
    erp.coupang.forEach(key => {
      if (coupangDupes.has(key)) {
        reasons.push(`쿠팡ID ${key} 가 남은 기사에 중복`);
        return;
      }
      const rider = byCoupang.get(key);
      if (rider) {
        hits.set(String(rider.id), rider);
        reasons.push(`쿠팡ID ${key} → ${rider.name}`);
      }
    });

    const callCount = calls.filter(r => r.driver_id === fromId).length;
    const settleCount = settlements.filter(r => r.driver_id === fromId).length;
    const settleSum = settlements
      .filter(r => r.driver_id === fromId)
      .reduce((s, r) => s + Number(r.settlement_amount || 0), 0);

    if (hits.size === 1) {
      const toRider = [...hits.values()][0];
      remap.set(fromId, {
        fromId,
        toId: String(toRider.id),
        toName: toRider.name,
        toPhone: toRider.phone,
        toBaemin: toRider.baemin_id || '',
        reasons,
        names: [...erp.names],
        baeminKeys: [...erp.baemin],
        coupangKeys: [...erp.coupang],
        callCount,
        settleCount,
        settleSum
      });
      return;
    }
    if (hits.size > 1) {
      skipped.push({
        fromId,
        reason: `ERP가 남은 기사 ${hits.size}명과 맞음: ${[...hits.values()].map(r => r.name).join(', ')}`,
        callCount,
        settleCount,
        settleSum,
        reasons
      });
      return;
    }
    unmatched.push({
      fromId,
      reason: erp.baemin.size || erp.coupang.size
        ? `ERP(${[...erp.baemin, ...erp.coupang].join(', ') || '-'}) 가 남은 기사와 안 맞음`
        : '행에 배민/쿠팡 ID 가 없음',
      names: [...erp.names],
      callCount,
      settleCount,
      settleSum
    });
  });

  console.log(`\n매칭 성공 ${remap.size} · 애매해서 건너뜀 ${skipped.length} · ERP 없음/불일치 ${unmatched.length}`);

  const report = [];
  remap.forEach(item => {
    const line = `${item.fromId.slice(0, 8)}… → ${item.toName} (${item.toId.slice(0, 8)}…)  콜 ${item.callCount}건 / 일정산 ${item.settleCount}건 ${money(item.settleSum)}  [${item.reasons[0] || 'ERP'}]`;
    report.push(line);
    console.log(`  OK  ${line}`);
  });
  skipped.forEach(item => {
    console.log(`  SKIP ${item.fromId.slice(0, 8)}… ${item.reason}  콜 ${item.callCount} / 정산 ${item.settleCount} ${money(item.settleSum)}`);
  });
  unmatched.slice(0, 30).forEach(item => {
    const names = item.names.length ? ` (${item.names.join(', ')})` : '';
    console.log(`  NO   ${item.fromId.slice(0, 8)}…${names} ${item.reason}  콜 ${item.callCount} / 정산 ${item.settleCount}`);
  });
  if (unmatched.length > 30) console.log(`  … 외 ${unmatched.length - 30}건`);

  function conflictKey(kind, a, b) {
    if (kind === 'calls') return `${a}-${String(b.date).slice(0, 10)}-${platformOf(b.platform)}`;
    if (kind === 'settlements') return `${a}-${String(b.period).slice(0, 10)}-${platformOf(b.platform)}`;
    if (kind === 'rejections') return `${a}-${String(b.week_start).slice(0, 10)}-${platformOf(b.platform)}`;
    if (kind === 'targets') return `${a}-${String(b.month || '')}`;
    return '';
  }

  const callByNewId = new Map(calls.map(r => [r.id, r]));
  const settleByNewId = new Map(settlements.map(r => [r.id, r]));
  const rejByNewId = new Map(rejections.map(r => [r.id, r]));
  const tgtByNewId = new Map(targets.map(r => [r.id, r]));

  const plan = {
    callsMove: 0,
    callsDropDup: 0,
    callsConflict: [],
    settleMove: 0,
    settleDropDup: 0,
    settleConflict: [],
    rejMove: 0,
    tgtMove: 0,
    weeklyRows: 0,
    slipsMove: 0
  };

  const callOps = [];
  calls.forEach(row => {
    const map = remap.get(String(row.driver_id));
    if (!map) return;
    const newId = `${map.toId}-${String(row.date).slice(0, 10)}-${platformOf(row.platform)}`;
    const existing = callByNewId.get(newId);
    if (!existing || existing.id === row.id) {
      callOps.push({ type: 'move', row, newId, toId: map.toId });
      plan.callsMove += 1;
      return;
    }
    const oldCount = Number(row.count || 0);
    const newCount = Number(existing.count || 0);
    if (oldCount === newCount || oldCount === 0) {
      callOps.push({ type: 'drop', row });
      plan.callsDropDup += 1;
      return;
    }
    if (newCount === 0) {
      callOps.push({ type: 'take', row, existing, newCount: oldCount });
      plan.callsMove += 1;
      return;
    }
    plan.callsConflict.push(`${map.toName} ${String(row.date).slice(0, 10)} ${platformOf(row.platform)} 고아 ${oldCount} / 남은 ${newCount}`);
  });

  const settleOps = [];
  settlements.forEach(row => {
    const map = remap.get(String(row.driver_id));
    if (!map) return;
    const newId = `${map.toId}-${String(row.period).slice(0, 10)}-${platformOf(row.platform)}`;
    const existing = settleByNewId.get(newId);
    if (!existing || existing.id === row.id) {
      settleOps.push({ type: 'move', row, newId, toId: map.toId });
      plan.settleMove += 1;
      return;
    }
    const same = Number(existing.settlement_amount || 0) === Number(row.settlement_amount || 0)
      && Number(existing.order_count || 0) === Number(row.order_count || 0);
    if (same) {
      settleOps.push({ type: 'drop', row });
      plan.settleDropDup += 1;
      return;
    }
    if (Number(existing.settlement_amount || 0) === 0 && Number(row.settlement_amount || 0) !== 0) {
      settleOps.push({ type: 'take', row, existing });
      plan.settleMove += 1;
      return;
    }
    plan.settleConflict.push(`${map.toName} ${String(row.period).slice(0, 10)} ${platformOf(row.platform)} 고아 ${money(row.settlement_amount)} / 남은 ${money(existing.settlement_amount)}`);
  });

  const rejOps = [];
  rejections.forEach(row => {
    const map = remap.get(String(row.driver_id));
    if (!map) return;
    const newId = `${map.toId}-${String(row.week_start).slice(0, 10)}-${platformOf(row.platform)}`;
    const existing = rejByNewId.get(newId);
    if (!existing || existing.id === row.id) {
      rejOps.push({ type: 'move', row, newId, toId: map.toId });
      plan.rejMove += 1;
    } else {
      rejOps.push({ type: 'drop', row });
    }
  });

  const tgtOps = [];
  targets.forEach(row => {
    const map = remap.get(String(row.driver_id));
    if (!map) return;
    const newId = `${map.toId}-${String(row.month || '')}`;
    const existing = tgtByNewId.get(newId);
    if (!existing || existing.id === row.id) {
      tgtOps.push({ type: 'move', row, newId, toId: map.toId });
      plan.tgtMove += 1;
    } else {
      tgtOps.push({ type: 'drop', row });
    }
  });

  const weeklyUpdates = [];
  weekly.forEach(row => {
    const list = Array.isArray(row.riders) ? row.riders : [];
    let changed = false;
    const next = list.map(item => {
      const id = String(item.matchedRiderId || item.matched_rider_id || '').trim();
      const map = remap.get(id);
      if (!map) return item;
      changed = true;
      plan.weeklyRows += 1;
      return { ...item, matchedRiderId: map.toId, matched: true };
    });
    if (changed) weeklyUpdates.push({ id: row.id, riders: next });
  });

  const slipOps = slips.filter(row => remap.has(String(row.driver_id)));
  plan.slipsMove = slipOps.length;

  const settingKeys = [
    'brem_payroll_withdrawal_requests_v1',
    'brem_payroll_daily_settlement_roster_v1',
    'brem_payroll_daily_settlement_fees_v1',
    'brem_payroll_daily_excluded_settlements_v1',
    'brem_admin_direct_settlement_adjustments_v1',
    'brem_admin_direct_other_payments_v1',
    'brem_admin_direct_brem_promotions_v1',
    'brem_admin_direct_retro_adjustments_v1',
    'brem_admin_weekly_settlements_direct',
    'brem_admin_long_event_items',
    'brem_payroll_week_finalized_v1'
  ];

  function remapDeep(value, changedRef) {
    if (Array.isArray(value)) return value.map(item => remapDeep(item, changedRef));
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string' && remap.has(value)) {
        changedRef.count += 1;
        return remap.get(value).toId;
      }
      return value;
    }
    const out = Array.isArray(value) ? [] : { ...value };
    Object.keys(value).forEach(key => {
      const child = value[key];
      if ((key === 'driverId' || key === 'driver_id' || key === 'matchedRiderId' || key === 'riderId')
        && typeof child === 'string' && remap.has(child)) {
        out[key] = remap.get(child).toId;
        changedRef.count += 1;
        return;
      }
      if (remap.has(key) && (value[key] && typeof value[key] === 'object')) {
        const toId = remap.get(key).toId;
        if (!out[toId]) out[toId] = remapDeep(value[key], changedRef);
        delete out[key];
        changedRef.count += 1;
        return;
      }
      out[key] = remapDeep(child, changedRef);
    });
    return out;
  }

  const settingPlans = [];
  for (const key of settingKeys) {
    const value = await fetchSetting(key);
    if (value == null) continue;
    const changedRef = { count: 0 };
    const next = remapDeep(value, changedRef);
    if (changedRef.count) settingPlans.push({ key, count: changedRef.count, next });
  }

  console.log('\n반영 예정');
  console.log(`  콜 이동 ${plan.callsMove} / 중복삭제 ${plan.callsDropDup} / 충돌 ${plan.callsConflict.length}`);
  console.log(`  일정산 이동 ${plan.settleMove} / 중복삭제 ${plan.settleDropDup} / 충돌 ${plan.settleConflict.length}`);
  console.log(`  거절율 이동 ${plan.rejMove} · 목표 이동 ${plan.tgtMove} · 주정산 기사행 ${plan.weeklyRows} · 명세서 ${plan.slipsMove}`);
  settingPlans.forEach(item => console.log(`  settings.${item.key} ${item.count}곳`));
  if (plan.callsConflict.length) {
    console.log('\n콜 충돌 (자동 안 함)');
    plan.callsConflict.slice(0, 20).forEach(line => console.log(`  ${line}`));
  }
  if (plan.settleConflict.length) {
    console.log('\n일정산 충돌 (자동 안 함 · 이중정산 방지)');
    plan.settleConflict.slice(0, 20).forEach(line => console.log(`  ${line}`));
  }

  const outPath = path.join(__dirname, '..', 'logs', 'remap-orphan-driver-ids.json');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({
      at: new Date().toISOString(),
      apply: APPLY,
      remap: [...remap.values()],
      skipped,
      unmatched,
      plan: {
        ...plan,
        settings: settingPlans.map(s => ({ key: s.key, count: s.count }))
      }
    }, null, 2));
    console.log(`\n상세: ${outPath}`);
  } catch (error) {
    console.log(`\n로그 파일은 못 남김: ${error.message}`);
  }

  if (!APPLY) {
    if (!remap.size) {
      console.log('\n지금은 자동으로 붙일 건이 없습니다. 이름/전화/배민ID 알려주시면 그 기준으로 다시 찾겠습니다.');
      process.exit(0);
    }
    console.log('\n이 매칭이 맞으면 아래를 실행하세요.');
    console.log('  node scripts/_remap-orphan-driver-ids.js --apply');
    process.exit(0);
  }

  if (!remap.size) die('적용할 매칭이 없습니다.');

  async function chunked(list, size, fn) {
    for (let i = 0; i < list.length; i += size) {
      await fn(list.slice(i, i + size));
    }
  }

  async function deleteByIds(table, ids) {
    await chunked(ids, 200, async chunk => {
      const { error } = await supabase.from(table).delete().in('id', chunk);
      if (error) die(`${table} 삭제 실패`, error.message);
    });
  }

  console.log('\n적용 시작…');

  for (const op of callOps) {
    if (op.type === 'drop') {
      const { error } = await supabase.from('admin_calls').delete().eq('id', op.row.id);
      if (error) die('admin_calls 중복 삭제 실패', error.message);
      continue;
    }
    if (op.type === 'take') {
      const { error } = await supabase.from('admin_calls').update({ count: Number(op.row.count || 0) }).eq('id', op.existing.id);
      if (error) die('admin_calls 채우기 실패', error.message);
      const { error: delErr } = await supabase.from('admin_calls').delete().eq('id', op.row.id);
      if (delErr) die('admin_calls 원본 삭제 실패', delErr.message);
      continue;
    }
    const payload = {
      ...op.row,
      id: op.newId,
      driver_id: op.toId,
      platform: platformOf(op.row.platform)
    };
    const { error: insErr } = await supabase.from('admin_calls').insert(payload);
    if (insErr) die('admin_calls 이동 실패', insErr.message);
    const { error: delErr } = await supabase.from('admin_calls').delete().eq('id', op.row.id);
    if (delErr) die('admin_calls 원본 삭제 실패', delErr.message);
  }

  for (const op of settleOps) {
    if (op.type === 'drop') {
      const { error } = await supabase.from('daily_settlements').delete().eq('id', op.row.id);
      if (error) die('daily_settlements 중복 삭제 실패', error.message);
      continue;
    }
    if (op.type === 'take') {
      const { error } = await supabase.from('daily_settlements').update({
        rider_id: op.row.rider_id,
        order_count: op.row.order_count,
        delivery_amount: op.row.delivery_amount,
        settlement_amount: op.row.settlement_amount,
        hourly_insurance: op.row.hourly_insurance,
        deduction_base: op.row.deduction_base,
        applied_at: op.row.applied_at
      }).eq('id', op.existing.id);
      if (error) die('daily_settlements 채우기 실패', error.message);
      const { error: delErr } = await supabase.from('daily_settlements').delete().eq('id', op.row.id);
      if (delErr) die('daily_settlements 원본 삭제 실패', delErr.message);
      continue;
    }
    const payload = {
      ...op.row,
      id: op.newId,
      driver_id: op.toId,
      platform: platformOf(op.row.platform)
    };
    const { error: insErr } = await supabase.from('daily_settlements').insert(payload);
    if (insErr) die('daily_settlements 이동 실패', insErr.message);
    const { error: delErr } = await supabase.from('daily_settlements').delete().eq('id', op.row.id);
    if (delErr) die('daily_settlements 원본 삭제 실패', delErr.message);
  }

  for (const op of rejOps) {
    if (op.type === 'drop') {
      const { error } = await supabase.from('admin_rejection_rates').delete().eq('id', op.row.id);
      if (error) die('admin_rejection_rates 중복 삭제 실패', error.message);
      continue;
    }
    const payload = { ...op.row, id: op.newId, driver_id: op.toId, platform: platformOf(op.row.platform) };
    const { error: insErr } = await supabase.from('admin_rejection_rates').insert(payload);
    if (insErr) die('admin_rejection_rates 이동 실패', insErr.message);
    const { error: delErr } = await supabase.from('admin_rejection_rates').delete().eq('id', op.row.id);
    if (delErr) die('admin_rejection_rates 원본 삭제 실패', delErr.message);
  }

  for (const op of tgtOps) {
    if (op.type === 'drop') {
      const { error } = await supabase.from('admin_targets').delete().eq('id', op.row.id);
      if (error) die('admin_targets 중복 삭제 실패', error.message);
      continue;
    }
    const payload = { ...op.row, id: op.newId, driver_id: op.toId };
    const { error: insErr } = await supabase.from('admin_targets').insert(payload);
    if (insErr) die('admin_targets 이동 실패', insErr.message);
    const { error: delErr } = await supabase.from('admin_targets').delete().eq('id', op.row.id);
    if (delErr) die('admin_targets 원본 삭제 실패', delErr.message);
  }

  for (const row of weeklyUpdates) {
    const { error } = await supabase.from('weekly_settlements').update({ riders: row.riders }).eq('id', row.id);
    if (error) die('weekly_settlements 갱신 실패', error.message);
  }

  for (const row of slipOps) {
    const map = remap.get(String(row.driver_id));
    const { error } = await supabase.from('payroll_slip_lines').update({ driver_id: map.toId }).eq('id', row.id);
    if (error) die('payroll_slip_lines 갱신 실패', error.message);
  }

  for (const item of settingPlans) {
    await writeSetting(item.key, item.next);
  }

  console.log('\n반영 완료. 관리자 화면을 새로고침 하면 남은 기사에게 예전 콜/정산이 붙어 있어야 합니다.');
})().catch(error => die('실행 실패', error.message || String(error)));
