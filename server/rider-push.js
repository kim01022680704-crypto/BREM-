const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const { getServiceClient } = require('./admin-bootstrap');
const riderAuth = require('./rider-auth');

const SETTINGS_KEY = 'brem_rider_push_tokens';
const MAX_TOKENS_PER_RIDER = 4;

let firebaseReady = false;

function nowIso() {
  return new Date().toISOString();
}

function emptyStore() {
  return { version: 1, riders: {} };
}

function normalizeStore(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const riders = raw.riders && typeof raw.riders === 'object' ? raw.riders : {};
  const next = {};
  Object.entries(riders).forEach(([riderId, list]) => {
    const id = String(riderId || '').trim();
    if (!id) return;
    next[id] = (Array.isArray(list) ? list : [])
      .map((item) => {
        const token = String(item?.token || item || '').trim();
        if (!token) return null;
        return {
          token,
          updatedAt: item?.updatedAt || nowIso(),
          platform: String(item?.platform || 'android').trim() || 'android'
        };
      })
      .filter(Boolean);
  });
  return { version: 1, riders: next };
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
      riders: store.riders || {}
    },
    description: 'BREM rider FCM tokens',
    updated_at: nowIso()
  }, { onConflict: 'key' });
  if (error) throw error;
}

function parseServiceAccount(raw) {
  let text = String(raw || '').trim().replace(/^\uFEFF/, '');
  if (!text) return null;
  let parsed = JSON.parse(text);
  if (typeof parsed === 'string') parsed = JSON.parse(parsed);
  if (!parsed || typeof parsed !== 'object' || !parsed.private_key) {
    throw new Error('service account JSON is incomplete');
  }
  return parsed;
}

function ensureFirebase() {
  if (firebaseReady) return true;
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) {
    console.warn('[BREM] FIREBASE_SERVICE_ACCOUNT_JSON is empty');
    return false;
  }
  try {
    const cred = parseServiceAccount(raw);
    if (!getApps().length) {
      initializeApp({ credential: cert(cred) });
    }
    firebaseReady = true;
    return true;
  } catch (error) {
    console.warn('[BREM] firebase-admin init failed:', error.message || error);
    return false;
  }
}

function tokensForRiders(store, riderIds) {
  const ids = [...new Set((Array.isArray(riderIds) ? riderIds : []).map(id => String(id || '').trim()).filter(Boolean))];
  const tokens = [];
  ids.forEach((id) => {
    (store.riders[id] || []).forEach((item) => {
      if (item.token) tokens.push(item.token);
    });
  });
  return [...new Set(tokens)];
}

async function saveRiderToken(accessToken, body = {}) {
  const me = await riderAuth.getRiderMe(accessToken);
  if (!me.ok) return me;
  const token = String(body.token || '').trim();
  if (!token) return { ok: false, status: 400, error: '푸시 토큰이 없습니다.' };

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const store = await readStore(supabase);
  const riderId = String(me.riderId || '').trim();
  const current = store.riders[riderId] || [];
  const next = [
    { token, updatedAt: nowIso(), platform: 'android' },
    ...current.filter(item => item.token !== token)
  ].slice(0, MAX_TOKENS_PER_RIDER);
  store.riders[riderId] = next;
  await writeStore(supabase, store);
  return { ok: true };
}

async function sendToRiders(riderIds, payload = {}) {
  if (!ensureFirebase()) {
    return { ok: true, skipped: true, reason: 'no-firebase' };
  }
  const supabase = getServiceClient();
  if (!supabase) return { ok: true, skipped: true, reason: 'no-supabase' };

  const store = await readStore(supabase);
  const tokens = tokensForRiders(store, riderIds);
  if (!tokens.length) {
    console.warn('[BREM] push skipped: no tokens for', riderIds);
    return { ok: true, sent: 0, reason: 'no-tokens', riders: (riderIds || []).length };
  }

  const title = String(payload.title || 'BREM').trim() || 'BREM';
  const body = String(payload.body || '').trim();
  const data = payload.data && typeof payload.data === 'object'
    ? Object.fromEntries(Object.entries(payload.data).map(([key, value]) => [key, String(value ?? '')]))
    : {};

  const result = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data,
    android: {
      priority: 'high',
      notification: {
        sound: 'default'
      }
    }
  });
  const failed = Number(result.failureCount || 0);
  if (failed) {
    console.warn('[BREM] push failures:', failed, result.responses?.filter(item => !item.success).map(item => item.error?.message));
  }
  return { ok: true, sent: result.successCount || 0, failed };
}

async function notifyUrgentMission(mission) {
  if (!mission || mission.status === 'closed') return { ok: true, skipped: true };
  const riderIds = (mission.targets || []).map(item => item.riderId);
  const amount = Number(mission.amount || 0);
  const pay = Number.isFinite(amount) && amount > 0
    ? `${amount.toLocaleString('ko-KR')}원`
    : '';
  return sendToRiders(riderIds, {
    title: '긴급미션',
    body: [mission.content, mission.missionTime, pay].filter(Boolean).join(' · '),
    data: {
      type: 'urgent-mission',
      missionId: mission.id || ''
    }
  });
}

module.exports = {
  saveRiderToken,
  sendToRiders,
  notifyUrgentMission
};
