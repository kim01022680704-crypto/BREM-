#!/usr/bin/env node
/**
 * 기사지역관리 노출 모드 현황 (읽기 전용)
 *
 * 기본값을 full(올노출) → hidden(미노출) 로 바꾸면
 * "명시 설정이 없는 기사"가 전부 뒤집힌다. 그 규모를 먼저 잰다.
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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE env 필요');
  process.exit(2);
}
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const EXPOSURE_KEY = 'brem_rider_dashboard_region_exposure_v1';

function normalizeMode(value) {
  const mode = String(value || '').toLowerCase();
  if (mode === 'dashboard' || mode === 'view' || mode === '전체열람') return 'dashboard';
  if (mode === 'metrics' || mode === 'quota' || mode === '할당만') return 'metrics';
  if (mode === 'leader' || mode === 'team_leader' || mode === '팀장') return 'leader';
  if (mode === 'hidden' || mode === 'off' || mode === 'none' || mode === '미노출') return 'hidden';
  return 'full';
}

(async () => {
  console.log('='.repeat(80));
  console.log(' 기사지역관리 노출 모드 현황 (읽기 전용)');
  console.log('='.repeat(80));

  const { data, error } = await supabase
    .from('settings')
    .select('value,updated_at')
    .eq('key', EXPOSURE_KEY)
    .maybeSingle();
  if (error) throw error;

  const exposure = data?.value && typeof data.value === 'object' ? data.value : {};
  console.log(`\n설정 최종 수정: ${data?.updated_at || '(없음)'}`);

  const riders = [];
  for (let from = 0; ; from += 1000) {
    const r = await supabase.from('riders')
      .select('id,name,status,platform_baemin,platform_coupang')
      .range(from, from + 999);
    if (r.error) throw r.error;
    riders.push(...(r.data || []));
    if (!r.data || r.data.length < 1000) break;
  }
  const riderById = new Map(riders.map(r => [r.id, r]));

  // 플랫폼·지역별로 노출 여부와 기사별 모드 집계
  const summary = { platforms: {}, explicitRiderIds: new Set(), modeCount: {} };
  ['baemin', 'coupang'].forEach(platform => {
    const side = exposure[platform] && typeof exposure[platform] === 'object' ? exposure[platform] : {};
    const regionKeys = Object.keys(side);
    let exposedRegions = 0;
    let riderEntries = 0;
    regionKeys.forEach(key => {
      const entry = side[key] || {};
      if (entry.exposed === true) exposedRegions += 1;
      const ridersMap = entry.riders && typeof entry.riders === 'object' ? entry.riders : {};
      Object.entries(ridersMap).forEach(([riderId, cfg]) => {
        const raw = cfg?.mode;
        if (raw == null || String(raw).trim() === '') return;
        riderEntries += 1;
        const m = normalizeMode(raw);
        summary.modeCount[m] = (summary.modeCount[m] || 0) + 1;
        summary.explicitRiderIds.add(riderId);
      });
    });
    summary.platforms[platform] = { regionKeys: regionKeys.length, exposedRegions, riderEntries };
  });

  console.log('\n[플랫폼별 지역 설정]');
  Object.entries(summary.platforms).forEach(([platform, s]) => {
    console.log(`  ${platform.padEnd(8)} 지역 ${s.regionKeys}개 · 라이더노출 ON ${s.exposedRegions}개 · 기사별 모드 지정 ${s.riderEntries}건`);
  });

  console.log('\n[명시 지정된 모드 분포] (지역×기사 조합 기준)');
  const labels = { full: '올노출', dashboard: '전체열람', metrics: '할당만', leader: '팀장', hidden: '미노출' };
  Object.entries(summary.modeCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([mode, n]) => console.log(`  ${(labels[mode] || mode).padEnd(8)} ${n}건`));

  const activeRiders = riders.filter(r => String(r.status || '').trim() === '근무중');
  const explicitActive = activeRiders.filter(r => summary.explicitRiderIds.has(r.id));
  const implicitActive = activeRiders.filter(r => !summary.explicitRiderIds.has(r.id));

  console.log('\n' + '='.repeat(80));
  console.log(' 기본값을 미노출로 바꾸면 영향받는 인원');
  console.log('='.repeat(80));
  console.log(`  활동중 기사                       : ${activeRiders.length}명`);
  console.log(`  ├ 어딘가에 모드가 명시돼 있음      : ${explicitActive.length}명 (영향 없음)`);
  console.log(`  └ 명시 없음 → 지금 올노출로 동작   : ${implicitActive.length}명 ★ 이 인원이 미노출로 뒤집힌다`);

  if (implicitActive.length) {
    console.log('\n  명시 설정이 없는 기사 예시 (최대 20명)');
    implicitActive.slice(0, 20).forEach(r => {
      console.log(`    "${r.name}" · 배민=${r.platform_baemin ? 'O' : 'X'} 쿠팡=${r.platform_coupang !== false ? 'O' : 'X'}`);
    });
  }

  console.log('\n[판단]');
  if (implicitActive.length === 0) {
    console.log('  전원이 명시 설정을 갖고 있다. 기본값을 바꿔도 기존 기사는 영향이 없다.');
  } else {
    console.log(`  기본값만 바꾸면 ${implicitActive.length}명이 갑자기 기사앱 대시보드를 못 보게 된다.`);
    console.log('  → "신규 기사만 미노출" 을 원한다면 기본값 변경이 아니라');
    console.log('     기사 등록 시점에 hidden 을 명시 저장하는 방식이 맞다.');
  }
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});
