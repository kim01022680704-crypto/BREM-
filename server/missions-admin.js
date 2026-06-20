const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');

const MAX_ADMIN_MISSIONS = 4;

const MISSION_SELECT = [
  'id', 'title', 'description', 'type', 'conditions', 'is_active',
  'raw_data', 'created_at', 'updated_at'
].join(',');

function isMissingTableError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('could not find the table')
    || message.includes('relation')
    && message.includes('missions')
    && message.includes('does not exist');
}

function missionToRow(mission) {
  const now = new Date().toISOString();
  return {
    id: String(mission.id || ''),
    title: String(mission.title || ''),
    description: String(mission.description || ''),
    type: String(mission.type || ''),
    conditions: String(mission.conditions || ''),
    is_active: mission.isActive !== false,
    raw_data: mission || {},
    created_at: mission.createdAt || now,
    updated_at: now
  };
}

async function listMissions(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const { data, error } = await supabase
    .from('missions')
    .select(MISSION_SELECT)
    .order('created_at', { ascending: true });

  if (error) {
    if (isMissingTableError(error)) {
      return {
        ok: false,
        status: 503,
        error: 'TABLE_MISSING',
        message: 'public.missions 테이블이 없습니다. Supabase SQL Editor에서 supabase/missions_migration.sql 을 실행하세요.'
      };
    }
    return { ok: false, status: 500, error: error.message || '미션 목록을 불러오지 못했습니다.' };
  }

  return { ok: true, missions: data || [] };
}

async function upsertMission(accessToken, mission) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const row = missionToRow(mission);
  if (!row.id) {
    return { ok: false, status: 400, error: '미션 ID가 없습니다.' };
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const { data: existing } = await supabase
    .from('missions')
    .select('id')
    .eq('id', row.id)
    .maybeSingle();

  if (!existing) {
    const { count, error: countError } = await supabase
      .from('missions')
      .select('id', { count: 'exact', head: true });
    if (countError) {
      if (isMissingTableError(countError)) {
        return {
          ok: false,
          status: 503,
          error: 'TABLE_MISSING',
          message: 'public.missions 테이블이 없습니다. Supabase SQL Editor에서 supabase/missions_migration.sql 을 실행하세요.'
        };
      }
      return { ok: false, status: 500, error: countError.message || '미션 개수를 확인하지 못했습니다.' };
    }
    if ((count ?? 0) >= MAX_ADMIN_MISSIONS) {
      return { ok: false, status: 400, error: `미션은 최대 ${MAX_ADMIN_MISSIONS}개까지 등록할 수 있습니다.` };
    }
  }

  const { error } = await supabase.from('missions').upsert(row, { onConflict: 'id' });
  if (error) {
    if (isMissingTableError(error)) {
      return {
        ok: false,
        status: 503,
        error: 'TABLE_MISSING',
        message: 'public.missions 테이블이 없습니다. Supabase SQL Editor에서 supabase/missions_migration.sql 을 실행하세요.'
      };
    }
    return { ok: false, status: 400, error: error.message || '미션 저장에 실패했습니다.' };
  }

  const { data, error: readError } = await supabase
    .from('missions')
    .select(MISSION_SELECT)
    .eq('id', row.id)
    .maybeSingle();

  if (readError) {
    return { ok: false, status: 500, error: readError.message || '저장된 미션을 확인하지 못했습니다.' };
  }

  return { ok: true, mission: data };
}

async function getMissionsStatus(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const { count, error } = await supabase
    .from('missions')
    .select('id', { count: 'exact', head: true });

  if (error) {
    if (isMissingTableError(error)) {
      return { ok: true, tableExists: false, count: 0 };
    }
    return { ok: false, status: 500, error: error.message || '미션 테이블 상태를 확인하지 못했습니다.' };
  }

  return { ok: true, tableExists: true, count: count ?? 0 };
}

module.exports = {
  listMissions,
  upsertMission,
  getMissionsStatus
};
