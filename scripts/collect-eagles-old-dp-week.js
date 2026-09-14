#!/usr/bin/env node
/**
 * 이글스 예전 DP만 지역맵에 잠시 넣고 저번주 라이더별 수집 → 맵 복원
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
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const KEY = 'baemin_partner_region_map';
const EAGLES = {
  DP2607289309: '이글스남A',
  DP2607213175: '이글스동A',
  DP2608183325: '이글스북필드A',
  DP2607217024: '이글스북필드B',
  DP2607212158: '이글스울주A',
  DP2607285101: '이글스중필드B'
};

function parse(v) {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) { return v; } }
  return v;
}

async function writeMap(map) {
  const { error } = await sb.from('settings').upsert({
    key: KEY,
    value: map,
    description: '배민현황 DP코드 → 지역명 매핑',
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) throw error;
}

async function main() {
  const weekStart = String(process.argv[2] || '2026-08-26').slice(0, 10);
  const fromDate = weekStart;
  const end = new Date(`${weekStart}T00:00:00`);
  end.setDate(end.getDate() + 6);
  const toDate = [
    end.getFullYear(),
    String(end.getMonth() + 1).padStart(2, '0'),
    String(end.getDate()).padStart(2, '0')
  ].join('-');

  const { data } = await sb.from('settings').select('value').eq('key', KEY).maybeSingle();
  const original = parse(data?.value) || {};
  const backupPath = path.join(__dirname, '..', 'logs', `partner-region-map-backup-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(original, null, 2));
  console.log('[backup]', backupPath);

  const health = await fetch('http://127.0.0.1:3939/health').then(r => r.json()).catch(e => ({ ok: false, message: e.message }));
  if (!health?.ok || !health.browser?.sessionLoggedIn) {
    console.error('세션 서버/로그인 필요', health?.message || health);
    process.exit(1);
  }

  let collectResult = { ok: false, message: 'not started' };
  try {
    console.log('[map] 이글스 예전 DP만으로 임시 교체');
    await writeMap(EAGLES);

    const body = {
      collectDate: toDate,
      sourceMenus: ['rider_history'],
      riderFromDate: fromDate,
      riderToDate: toDate,
      source: 'eagles_old_dp_week_backfill'
    };
    console.log('[collect]', fromDate, '~', toDate, 'DPs', Object.keys(EAGLES).join(','));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55 * 60 * 1000);
    try {
      const res = await fetch('http://127.0.0.1:3939/collect/rider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      collectResult = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
      collectResult._status = res.status;
    } finally {
      clearTimeout(timer);
    }
    console.log('[collect result]', JSON.stringify({
      ok: collectResult.ok,
      status: collectResult._status,
      message: collectResult.message,
      savedCount: collectResult.savedCount
    }));
    (collectResult.partnerSummaries || []).forEach(p => {
      console.log(`  ${p.partnerId} ${p.partnerName || ''} ok=${p.ok} saved=${p.savedCount}`);
    });
    if (collectResult.results) {
      Object.entries(collectResult.results).forEach(([k, row]) => {
        console.log(`  ${k}: ok=${row.ok} saved=${row.savedCount || 0} ${row.message || ''}`);
      });
    }
  } finally {
    console.log('[map] 원래 지역맵 복원');
    await writeMap(original);
  }

  console.log('[verify] 이글스 rider_history 건수');
  for (const day of ['2026-08-31', '2026-09-01']) {
    for (const dp of Object.keys(EAGLES)) {
      const { count } = await sb.from('baemin_biz_collect_items')
        .select('*', { count: 'exact', head: true })
        .eq('source_menu', 'rider_history')
        .eq('collect_date', day)
        .like('dedupe_key', `${dp}:%`);
      console.log(`  ${day} ${dp} = ${count}`);
    }
  }

  process.exit(collectResult.ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
