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
const contribution = require('../server/contribution-admin');
const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

function digitsOnly(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

(async () => {
  const date = contribution.currentContributionDate();
  const now = new Date();
  console.log(JSON.stringify({
    nowKst: now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
    bizDate: date,
    baeminSlot: contribution.startedBaeminSlotKeys(now),
    coupangSlot: contribution.startedCoupangPeakKeys(now),
    currentCoupang: contribution.currentCoupangPeakKey(now)
  }, null, 2));

  const { data: riders } = await sb.from('riders')
    .select('id,name,baemin_id,raw_data,status')
    .limit(20000);
  const liveRiders = (riders || []).filter(r => String(r.status || '').toLowerCase() !== 'deleted');
  let alphaBaemin = 0;
  let digitBaemin = 0;
  let emptyBaemin = 0;
  liveRiders.forEach(r => {
    const id = String(r.baemin_id || r.raw_data?.baeminId || '').trim();
    if (!id) emptyBaemin += 1;
    else if (digitsOnly(id) === id) digitBaemin += 1;
    else alphaBaemin += 1;
  });
  console.log('\n[riders baemin_id]', { total: liveRiders.length, digitBaemin, alphaBaemin, emptyBaemin });

  const { data: events, error: ee } = await sb.from('contribution_ledger_events')
    .select('date,platform,region,slot_key,rider_id,name,points,credited_calls,weighted_delta,count_08,count_10,assigned_target,raw_json,captured_at')
    .eq('date', date)
    .limit(20000);
  if (ee) throw ee;
  const crawlIds = (events || []).filter(e => String(e.rider_id).startsWith('crawl:'));
  const uniqueCrawl = new Set(crawlIds.map(e => e.rider_id));
  const uniqueAll = new Set((events || []).map(e => e.rider_id));
  const nameOnly = (events || []).filter(e => e.raw_json?.source?.matched && !e.raw_json?.source?.crawlUserId && !e.raw_json?.source?.courierId);
  console.log('\n[events]', {
    n: (events || []).length,
    people: uniqueAll.size,
    unmatchedPeople: uniqueCrawl.size,
    unmatchedEvents: crawlIds.length,
    matchRate: uniqueAll.size ? Math.round((1 - uniqueCrawl.size / uniqueAll.size) * 1000) / 10 : 0
  });

  const bySlot = {};
  (events || []).forEach(e => {
    const k = `${e.platform}|${e.slot_key}`;
    if (!bySlot[k]) bySlot[k] = { events: 0, points: 0, credited: 0 };
    bySlot[k].events += 1;
    bySlot[k].points += Number(e.points || 0);
    bySlot[k].credited += Number(e.credited_calls || 0);
  });
  console.log('\n[points by slot]');
  Object.entries(bySlot).sort().forEach(([k, v]) => {
    console.log(k, 'events', v.events, 'points', Math.round(v.points * 10) / 10, 'credited', Math.round(v.credited * 10) / 10);
  });

  const baeminPts = (events || []).filter(e => e.platform === 'baemin');
  const baeminMismatch = baeminPts.filter(e => Math.abs(Number(e.points) - Number(e.credited_calls) * 10) > 0.15);
  console.log('\n[baemin 1콜=10점 mismatch]', baeminMismatch.length);

  const { data: states } = await sb.from('contribution_slot_states')
    .select('platform,region,vendor_or_partner,slot_key,frozen,assigned_target,region_complete,last_captured_at,region_complete_reached')
    .eq('date', date)
    .limit(5000);
  const zeroTarget = (states || []).filter(s => Number(s.assigned_target || 0) <= 0);
  const reached = (states || []).filter(s => s.region_complete_reached || (Number(s.assigned_target) > 0 && Number(s.region_complete) >= Number(s.assigned_target)));
  const over = (states || []).filter(s => Number(s.assigned_target) > 0 && Number(s.region_complete) > Number(s.assigned_target) + 0.05);
  console.log('\n[states]', {
    n: (states || []).length,
    frozen: (states || []).filter(s => s.frozen).length,
    zeroTarget: zeroTarget.length,
    reached: reached.length,
    completeOverTarget: over.length
  });
  if (zeroTarget.length) {
    console.log('zero target sample', zeroTarget.slice(0, 8).map(s => `${s.platform}|${s.region}|${s.slot_key}`));
  }

  const { data: delivery } = await sb.from('baemin_biz_collect_items')
    .select('collected_at,dedupe_key,rider_user_id,rider_name,parsed_json')
    .eq('collect_date', date)
    .eq('source_menu', 'delivery_status')
    .order('collected_at', { ascending: false })
    .limit(20);
  const sampleIds = (delivery || []).slice(0, 8).map(x => ({
    rider_user_id: x.rider_user_id,
    parsedUser: x.parsed_json?.userId || x.parsed_json?.riderId,
    name: x.rider_name,
    digits: digitsOnly(x.rider_user_id || x.parsed_json?.userId || '')
  }));
  console.log('\n[baemin crawl id sample]', sampleIds);

  const { data: coupang } = await sb.from('coupang_collect_items')
    .select('collected_at,source_menu,parsed_json,vendor_id')
    .eq('collect_date', date)
    .in('source_menu', ['rider_daily', 'peak_realtime'])
    .order('collected_at', { ascending: false })
    .limit(6);
  console.log('\n[coupang latest]', (coupang || []).map(x => `${x.collected_at} ${x.source_menu} ${x.vendor_id}`));

  const slotSet = new Set((states || []).map(s => `${s.platform}|${s.slot_key}`));
  console.log('\n[present slots]', [...slotSet].sort());
  console.log('missing expected coupang LUNCH?', !slotSet.has('coupang|LUNCH'));
  console.log('missing expected coupang POST_LUNCH?', !slotSet.has('coupang|POST_LUNCH'));
  console.log('startedCoupangPeakKeys used in builder?', false);

  const latestState = [...(states || [])].sort((a, b) => String(b.last_captured_at).localeCompare(String(a.last_captured_at)))[0];
  const latestEvent = [...(events || [])].sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)))[0];
  console.log('\n[freshness]', {
    latestState: latestState && `${latestState.last_captured_at} ${latestState.platform} ${latestState.slot_key} ${latestState.region}`,
    latestEvent: latestEvent && `${latestEvent.captured_at} ${latestEvent.platform} ${latestEvent.slot_key}`
  });
})().catch(e => {
  console.error(e);
  process.exit(1);
});
