const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');
const riderAuth = require('./rider-auth');
const riderPush = require('./rider-push');

const SETTINGS_KEY = 'brem_urgent_missions';
const PLATFORMS = new Set(['baemin', 'coupang']);

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePlatforms(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map(item => String(item || '').trim()).filter(item => PLATFORMS.has(item)))];
}

function normalizeAmount(value) {
  const amount = Math.round(Number(String(value ?? '').replace(/[^\d.-]/g, '')));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function normalizeAccept(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const riderId = String(raw.riderId || '').trim();
  if (!id || !riderId) return null;
  return {
    id,
    riderId,
    riderName: String(raw.riderName || '').trim(),
    riderPhone: String(raw.riderPhone || '').trim(),
    acceptedAt: raw.acceptedAt || nowIso(),
    setupDone: raw.setupDone === true,
    setupDoneAt: raw.setupDone ? (raw.setupDoneAt || nowIso()) : null
  };
}

function normalizeTarget(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const riderId = String(raw.riderId || raw.id || '').trim();
  if (!riderId) return null;
  const platform = raw.platform === 'coupang' ? 'coupang' : (raw.platform === 'baemin' ? 'baemin' : '');
  return {
    riderId,
    riderName: String(raw.riderName || raw.name || '').trim(),
    riderPhone: String(raw.riderPhone || raw.phone || '').trim(),
    regionKey: String(raw.regionKey || '').trim(),
    regionLabel: String(raw.regionLabel || '').trim(),
    platform,
    addedAt: raw.addedAt || nowIso()
  };
}

function normalizeMission(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const status = raw.status === 'closed' ? 'closed' : 'open';
  return {
    id,
    content: String(raw.content || '').trim(),
    amount: normalizeAmount(raw.amount),
    missionTime: String(raw.missionTime || '').trim(),
    platforms: normalizePlatforms(raw.platforms),
    status,
    publishedAt: raw.publishedAt || raw.createdAt || nowIso(),
    closedAt: status === 'closed' ? (raw.closedAt || nowIso()) : null,
    targets: (Array.isArray(raw.targets) ? raw.targets : []).map(normalizeTarget).filter(Boolean),
    accepts: (Array.isArray(raw.accepts) ? raw.accepts : []).map(normalizeAccept).filter(Boolean),
    createdAt: raw.createdAt || nowIso(),
    updatedAt: raw.updatedAt || nowIso()
  };
}

function emptyStore() {
  return { version: 0, missions: [] };
}

function normalizeStore(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const missions = (Array.isArray(raw.missions) ? raw.missions : [])
    .map(normalizeMission)
    .filter(Boolean)
    .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  return {
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 0,
    missions
  };
}

async function readStore(supabase) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle();
  if (error) throw error;
  return normalizeStore(data?.value);
}

async function writeStore(supabase, store) {
  const payload = {
    key: SETTINGS_KEY,
    value: {
      version: Number(store.version || 0),
      missions: store.missions || []
    },
    description: 'BREM urgent missions',
    updated_at: nowIso()
  };
  const { error } = await supabase.from('settings').upsert(payload, { onConflict: 'key' });
  if (error) throw error;
}

async function mutateStore(fn) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const store = await readStore(supabase);
    const result = fn(store);
    if (!result || result.ok === false) return result;
    const next = {
      version: (store.version || 0) + 1,
      missions: result.missions
    };
    try {
      await writeStore(supabase, next);
      return {
        ok: true,
        missions: next.missions,
        mission: result.mission || null,
        addedIds: result.addedIds || []
      };
    } catch (error) {
      lastError = error;
    }
  }
  return { ok: false, status: 409, error: lastError?.message || '저장이 겹쳤습니다. 다시 시도하세요.' };
}

function publicMissionForRider(mission, riderId) {
  const myAccept = (mission.accepts || []).find(item => item.riderId === riderId) || null;
  return {
    id: mission.id,
    content: mission.content,
    amount: mission.amount,
    missionTime: mission.missionTime,
    platforms: mission.platforms,
    status: mission.status,
    publishedAt: mission.publishedAt,
    closedAt: mission.closedAt,
    accepted: Boolean(myAccept),
    setupDone: Boolean(myAccept?.setupDone),
    acceptedAt: myAccept?.acceptedAt || null
  };
}

function isTargeted(mission, riderId) {
  return (mission.targets || []).some(item => item.riderId === riderId);
}

function riderCanSee(mission, riderId) {
  if (isTargeted(mission, riderId)) {
    return mission.status === 'open' || (mission.accepts || []).some(item => item.riderId === riderId);
  }
  return (mission.accepts || []).some(item => item.riderId === riderId);
}

async function listAdminMissions(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  const store = await readStore(supabase);
  return { ok: true, missions: store.missions };
}

async function publishMission(accessToken, payload) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const content = String(payload?.content || '').trim();
  const amount = normalizeAmount(payload?.amount);
  const missionTime = String(payload?.missionTime || '').trim();
  const platforms = normalizePlatforms(payload?.platforms);

  if (!content) return { ok: false, status: 400, error: '미션 내용을 입력하세요.' };
  if (!amount) return { ok: false, status: 400, error: '미션 금액을 입력하세요.' };
  if (!missionTime) return { ok: false, status: 400, error: '미션 시간을 입력하세요.' };
  if (!platforms.length) return { ok: false, status: 400, error: '쿠팡 또는 배민 태그를 선택하세요.' };

  const targets = (Array.isArray(payload?.riders) ? payload.riders : payload?.targets || [])
    .map(normalizeTarget)
    .filter(Boolean);
  if (!targets.length) {
    return { ok: false, status: 400, error: '배포할 대상 기사를 선택하세요.' };
  }

  const now = nowIso();
  const mission = {
    id: createId('um'),
    content,
    amount,
    missionTime,
    platforms,
    status: 'open',
    publishedAt: now,
    closedAt: null,
    targets,
    accepts: [],
    createdAt: now,
    updatedAt: now
  };

  const result = await mutateStore((store) => ({
    ok: true,
    missions: [mission, ...store.missions],
    mission
  }));
  if (result.ok && result.mission) {
    try {
      result.push = await riderPush.notifyUrgentMission(result.mission);
    } catch (error) {
      console.warn('[BREM] urgent mission push:', error.message || error);
      result.push = { ok: false, error: error.message || 'push failed' };
    }
  }
  return result;
}

async function closeMission(accessToken, missionId) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  const id = String(missionId || '').trim();
  if (!id) return { ok: false, status: 400, error: '미션 ID가 없습니다.' };

  return mutateStore((store) => {
    const current = store.missions.find(item => item.id === id);
    if (!current) return { ok: false, status: 404, error: '미션을 찾을 수 없습니다.' };
    const now = nowIso();
    const mission = {
      ...current,
      status: 'closed',
      closedAt: current.closedAt || now,
      updatedAt: now
    };
    return {
      ok: true,
      missions: store.missions.map(item => (item.id === id ? mission : item)),
      mission
    };
  });
}

async function markSetupDone(accessToken, missionId, acceptIds) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  const id = String(missionId || '').trim();
  const ids = new Set((Array.isArray(acceptIds) ? acceptIds : []).map(item => String(item || '').trim()).filter(Boolean));
  if (!id) return { ok: false, status: 400, error: '미션 ID가 없습니다.' };
  if (!ids.size) return { ok: false, status: 400, error: '설정완료할 수락 기사를 선택하세요.' };

  return mutateStore((store) => {
    const current = store.missions.find(item => item.id === id);
    if (!current) return { ok: false, status: 404, error: '미션을 찾을 수 없습니다.' };
    const now = nowIso();
    const mission = {
      ...current,
      updatedAt: now,
      accepts: current.accepts.map((item) => (
        ids.has(item.id)
          ? { ...item, setupDone: true, setupDoneAt: item.setupDoneAt || now }
          : item
      ))
    };
    return {
      ok: true,
      missions: store.missions.map(item => (item.id === id ? mission : item)),
      mission
    };
  });
}

async function assignTargets(accessToken, missionId, riders) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  const id = String(missionId || '').trim();
  const incoming = (Array.isArray(riders) ? riders : []).map(normalizeTarget).filter(Boolean);
  if (!id) return { ok: false, status: 400, error: '미션 ID가 없습니다.' };
  if (!incoming.length) return { ok: false, status: 400, error: '미션에 넣을 기사를 선택하세요.' };

  const result = await mutateStore((store) => {
    const current = store.missions.find(item => item.id === id);
    if (!current) return { ok: false, status: 404, error: '미션을 찾을 수 없습니다.' };
    if (current.status !== 'open') {
      return { ok: false, status: 409, error: '마감된 미션에는 기사를 넣을 수 없습니다.' };
    }
    const now = nowIso();
    const byId = new Map((current.targets || []).map(item => [item.riderId, item]));
    const addedIds = [];
    incoming.forEach((item) => {
      const prev = byId.get(item.riderId);
      if (!prev) addedIds.push(item.riderId);
      byId.set(item.riderId, prev ? { ...prev, ...item, addedAt: prev.addedAt || now } : { ...item, addedAt: now });
    });
    const mission = {
      ...current,
      updatedAt: now,
      targets: [...byId.values()]
    };
    return {
      ok: true,
      missions: store.missions.map(item => (item.id === id ? mission : item)),
      mission,
      addedIds
    };
  });
  if (result.ok && result.mission && (result.addedIds || []).length) {
    try {
      result.push = await riderPush.notifyUrgentMission({
        ...result.mission,
        targets: (result.mission.targets || []).filter(item => result.addedIds.includes(item.riderId))
      });
    } catch (error) {
      console.warn('[BREM] urgent mission target push:', error.message || error);
      result.push = { ok: false, error: error.message || 'push failed' };
    }
  }
  return result;
}

async function removeTargets(accessToken, missionId, riderIds) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  const id = String(missionId || '').trim();
  const ids = new Set((Array.isArray(riderIds) ? riderIds : []).map(item => String(item || '').trim()).filter(Boolean));
  if (!id) return { ok: false, status: 400, error: '미션 ID가 없습니다.' };
  if (!ids.size) return { ok: false, status: 400, error: '제외할 기사를 선택하세요.' };

  return mutateStore((store) => {
    const current = store.missions.find(item => item.id === id);
    if (!current) return { ok: false, status: 404, error: '미션을 찾을 수 없습니다.' };
    const now = nowIso();
    const mission = {
      ...current,
      updatedAt: now,
      targets: (current.targets || []).filter(item => !ids.has(item.riderId))
    };
    return {
      ok: true,
      missions: store.missions.map(item => (item.id === id ? mission : item)),
      mission
    };
  });
}

async function deleteMission(accessToken, missionId) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  const id = String(missionId || '').trim();
  if (!id) return { ok: false, status: 400, error: '미션 ID가 없습니다.' };

  return mutateStore((store) => {
    if (!store.missions.some(item => item.id === id)) {
      return { ok: false, status: 404, error: '미션을 찾을 수 없습니다.' };
    }
    return {
      ok: true,
      missions: store.missions.filter(item => item.id !== id),
      mission: null
    };
  });
}

async function listRiderMissions(accessToken) {
  const me = await riderAuth.getRiderMe(accessToken);
  if (!me.ok) return me;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  const store = await readStore(supabase);
  const missions = store.missions
    .filter(mission => riderCanSee(mission, me.riderId))
    .map(mission => publicMissionForRider(mission, me.riderId));
  return { ok: true, riderId: me.riderId, missions };
}

async function acceptMission(accessToken, missionId) {
  const me = await riderAuth.getRiderMe(accessToken);
  if (!me.ok) return me;
  const id = String(missionId || '').trim();
  if (!id) return { ok: false, status: 400, error: '미션 ID가 없습니다.' };

  const riderName = String(me.rider?.name || me.profile?.display_name || '').trim();
  const riderPhone = String(me.rider?.phone || '').trim();

  const result = await mutateStore((store) => {
    const current = store.missions.find(item => item.id === id);
    if (!current) return { ok: false, status: 404, error: '미션을 찾을 수 없습니다.' };
    if (current.status !== 'open') {
      return { ok: false, status: 409, error: '마감된 미션은 수락할 수 없습니다.' };
    }
    if (!isTargeted(current, me.riderId)) {
      return { ok: false, status: 403, error: '이 미션 대상 기사가 아닙니다.' };
    }
    if (current.accepts.some(item => item.riderId === me.riderId)) {
      return { ok: true, missions: store.missions, mission: current };
    }
    const now = nowIso();
    const accept = {
      id: createId('ua'),
      riderId: me.riderId,
      riderName,
      riderPhone,
      acceptedAt: now,
      setupDone: false,
      setupDoneAt: null
    };
    const mission = {
      ...current,
      updatedAt: now,
      accepts: [accept, ...current.accepts]
    };
    return {
      ok: true,
      missions: store.missions.map(item => (item.id === id ? mission : item)),
      mission
    };
  });

  if (!result.ok) return result;
  return {
    ok: true,
    riderId: me.riderId,
    mission: publicMissionForRider(result.mission, me.riderId)
  };
}

module.exports = {
  listAdminMissions,
  publishMission,
  closeMission,
  markSetupDone,
  assignTargets,
  removeTargets,
  deleteMission,
  listRiderMissions,
  acceptMission
};
