const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');
const riderPush = require('./rider-push');

const SETTINGS_KEY = 'brem_admin_rider_push_logs';
const MAX_LOGS = 80;
const MAX_TITLE = 40;
const MAX_BODY = 400;

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeRider(raw) {
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
    platform
  };
}

function normalizeLog(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const body = String(raw.body || '').trim();
  if (!id || !body) return null;
  return {
    id,
    title: String(raw.title || 'BREM').trim() || 'BREM',
    body,
    sentAt: raw.sentAt || nowIso(),
    sentBy: String(raw.sentBy || '').trim(),
    riders: (Array.isArray(raw.riders) ? raw.riders : []).map(normalizeRider).filter(Boolean),
    push: raw.push && typeof raw.push === 'object' ? raw.push : null
  };
}

function emptyStore() {
  return { version: 1, logs: [] };
}

function normalizeStore(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    version: 1,
    logs: (Array.isArray(raw.logs) ? raw.logs : []).map(normalizeLog).filter(Boolean).slice(0, MAX_LOGS)
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
  const { error } = await supabase.from('settings').upsert({
    key: SETTINGS_KEY,
    value: {
      version: 1,
      logs: store.logs || []
    },
    description: 'BREM admin custom rider push logs',
    updated_at: nowIso()
  }, { onConflict: 'key' });
  if (error) throw error;
}

async function listLogs(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  const store = await readStore(supabase);
  return { ok: true, logs: store.logs };
}

async function sendPush(accessToken, payload = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const title = String(payload.title || 'BREM').trim().slice(0, MAX_TITLE) || 'BREM';
  const body = String(payload.body || '').trim().slice(0, MAX_BODY);
  const riders = (Array.isArray(payload.riders) ? payload.riders : [])
    .map(normalizeRider)
    .filter(Boolean);
  const unique = [];
  const seen = new Set();
  riders.forEach((item) => {
    if (seen.has(item.riderId)) return;
    seen.add(item.riderId);
    unique.push(item);
  });

  if (!body) return { ok: false, status: 400, error: '푸시 내용을 입력하세요.' };
  if (!unique.length) return { ok: false, status: 400, error: '보낼 대상 기사를 선택하세요.' };

  let push;
  try {
    push = await riderPush.sendToRiders(unique.map(item => item.riderId), {
      title,
      body,
      data: { type: 'admin-push' }
    });
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '앱 알림 전송에 실패했습니다.' };
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const log = {
    id: createId('ap'),
    title,
    body,
    sentAt: nowIso(),
    sentBy: String(caller.profile?.display_name || caller.email || '').trim(),
    riders: unique,
    push: push || null
  };

  const store = await readStore(supabase);
  store.logs = [log, ...store.logs].slice(0, MAX_LOGS);
  await writeStore(supabase, store);
  return { ok: true, log, logs: store.logs, push };
}

async function deleteLogs(accessToken, payload = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const all = payload.all === true;
  const ids = new Set((Array.isArray(payload.ids) ? payload.ids : [])
    .map(item => String(item || '').trim())
    .filter(Boolean));
  if (!all && !ids.size) {
    return { ok: false, status: 400, error: '삭제할 기록을 선택하세요.' };
  }

  const store = await readStore(supabase);
  store.logs = all ? [] : store.logs.filter(item => !ids.has(item.id));
  await writeStore(supabase, store);
  return { ok: true, logs: store.logs };
}

module.exports = {
  listLogs,
  sendPush,
  deleteLogs
};
