const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');
const riderPush = require('./rider-push');

const SETTINGS_KEY = 'brem_admin_app_push_tokens';
const MAX_TOKENS_PER_ADMIN = 4;

function nowIso() {
  return new Date().toISOString();
}

function emptyStore() {
  return { version: 1, admins: {} };
}

function normalizeTokenList(list) {
  return (Array.isArray(list) ? list : [])
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
}

function normalizeAdminEntry(value) {
  if (Array.isArray(value)) return { tokens: normalizeTokenList(value) };
  if (value && typeof value === 'object') {
    return { tokens: normalizeTokenList(value.tokens) };
  }
  return { tokens: [] };
}

function normalizeStore(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const admins = raw.admins && typeof raw.admins === 'object' ? raw.admins : {};
  const next = {};
  Object.entries(admins).forEach(([adminId, entry]) => {
    const id = String(adminId || '').trim();
    if (!id) return;
    next[id] = normalizeAdminEntry(entry);
  });
  return { version: 1, admins: next };
}

function tokensOf(store, adminId) {
  return store?.admins?.[adminId]?.tokens || [];
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
      admins: store.admins || {}
    },
    description: 'BREM admin-app FCM tokens',
    updated_at: nowIso()
  }, { onConflict: 'key' });
  if (error) throw error;
}

function detachToken(store, token, keepAdminId) {
  Object.entries(store.admins || {}).forEach(([id, entry]) => {
    if (id === keepAdminId || !entry) return;
    entry.tokens = (entry.tokens || []).filter(item => item.token !== token);
  });
}

function upsertAdminToken(store, adminId, token) {
  const current = store.admins[adminId] || { tokens: [] };
  current.tokens = [
    { token, updatedAt: nowIso(), platform: 'android' },
    ...(current.tokens || []).filter(item => item.token !== token)
  ].slice(0, MAX_TOKENS_PER_ADMIN);
  store.admins[adminId] = current;
  detachToken(store, token, adminId);
  return current;
}

function allTokens(store) {
  const tokens = [];
  Object.values(store.admins || {}).forEach((entry) => {
    (entry?.tokens || []).forEach((item) => {
      if (item.token) tokens.push(item.token);
    });
  });
  return [...new Set(tokens)];
}

async function saveAdminToken(accessToken, body = {}) {
  const fcmToken = String(body.token || '').trim();
  if (!fcmToken) return { ok: false, status: 400, error: '푸시 토큰이 없습니다.' };

  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const store = await readStore(supabase);
  upsertAdminToken(store, caller.userId, fcmToken);
  await writeStore(supabase, store);
  return { ok: true, adminId: caller.userId };
}

async function sendToAdmins(payload = {}) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: true, skipped: true, reason: 'no-supabase' };

  const store = await readStore(supabase);
  const tokens = allTokens(store);
  if (!tokens.length) {
    console.warn('[BREM] admin push skipped: no tokens');
    return { ok: true, sent: 0, reason: 'no-tokens' };
  }
  return riderPush.sendToTokens(tokens, payload);
}

async function notifyInquiry(inquiry) {
  if (!inquiry) return { ok: true, skipped: true };
  const name = String(inquiry.name || '').trim() || '라이더';
  const type = String(inquiry.inquiryType || '문의').trim();
  const message = String(inquiry.message || '').trim();
  return sendToAdmins({
    title: '새 문의',
    body: [name, type, message].filter(Boolean).join(' · ').slice(0, 180),
    channelId: 'brem_inquiry',
    data: {
      type: 'admin-inquiry',
      inquiryId: inquiry.id || ''
    }
  });
}

function notifyInquiryLater(inquiry) {
  Promise.resolve()
    .then(() => notifyInquiry(inquiry))
    .catch((error) => {
      console.warn('[BREM] admin inquiry push failed:', error.message || error);
    });
}

module.exports = {
  saveAdminToken,
  sendToAdmins,
  notifyInquiry,
  notifyInquiryLater
};
