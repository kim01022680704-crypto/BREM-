/**
 * missions 테이블 생성 후 기본 미션/기사 연결 확인
 * 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Run: node scripts/apply-missions-bootstrap.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_MISSIONS = [
  {
    id: 'brem_mission_count_140',
    title: '140건 1,500원 미션',
    description: '주간 140건 이상 달성 시 건당 1,500원 리워드가 지급되는 미션입니다.',
    type: 'count_reward',
    conditions: '주간 140건 이상 콜수 달성 · 쿠팡·배민 합산 기준',
    is_active: true
  },
  {
    id: 'brem_mission_unit_guarantee_bike',
    title: '단가보장 + 오토바이 미션',
    description: '단가보장 프로그램과 오토바이 리스·렌탈 연계 혜택이 적용되는 미션입니다.',
    type: 'unit_guarantee_motorcycle',
    conditions: '단가보장 조건 충족 · 오토바이 리스/렌탈 이용 기사',
    is_active: true
  }
];

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
    console.error('Run supabase/missions_migration.sql in Supabase SQL Editor first if missions table is missing.');
    process.exit(1);
  }

  const client = createClient(url, key, { auth: { persistSession: false } });

  const probe = await client.from('missions').select('id').limit(1);
  if (probe.error) {
    console.error('missions table not ready:', probe.error.message);
    console.error('Apply supabase/missions_migration.sql in Supabase SQL Editor, then rerun this script.');
    process.exit(1);
  }

  const { error: upsertError } = await client.from('missions').upsert(
    DEFAULT_MISSIONS.map(item => ({
      ...item,
      raw_data: item,
      updated_at: new Date().toISOString()
    })),
    { onConflict: 'id' }
  );
  if (upsertError) throw upsertError;

  const { error: riderError } = await client
    .from('riders')
    .update({ selected_mission_id: 'brem_mission_count_140' })
    .eq('selected_mission_id', '');
  if (riderError) throw riderError;

  const { count } = await client.from('missions').select('*', { count: 'exact', head: true });
  console.log(`Missions bootstrap OK (${count ?? DEFAULT_MISSIONS.length} missions).`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
