/**
 * 쿠팡이츠 세션 저장/조회 (Bearer JWT + 쿠키)
 * settings 키: brem_coupang_session. 서버 service role 전용.
 */
const { getServiceClient } = require('./admin-bootstrap');

const COUPANG_SESSION_KEY = 'brem_coupang_session';

async function readSettingsValue(key) {
  const supabase = getServiceClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(error.message || '설정을 불러오지 못했습니다.');
  return data?.value ?? null;
}

async function writeSettingsValue(key, value, description) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  const { error } = await supabase.from('settings').upsert({
    key,
    value,
    description: description || key,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) return { ok: false, status: 500, error: error.message || '설정 저장에 실패했습니다.' };
  return { ok: true };
}

/** 저장된 쿠팡 세션(토큰/쿠키) */
async function getStoredCoupangSession() {
  const raw = await readSettingsValue(COUPANG_SESSION_KEY);
  if (!raw || typeof raw !== 'object') return null;
  const token = String(raw.token || '').trim();
  if (!token && !raw.cookie) return null;
  return {
    token,
    cookie: String(raw.cookie || '').trim(),
    updatedAt: raw.updatedAt || null,
    updatedBy: raw.updatedBy || '',
    source: raw.source || 'unknown',
    tokenExpiresAt: raw.tokenExpiresAt || null,
    lastValidatedAt: raw.lastValidatedAt || null,
    lastError: raw.lastError || ''
  };
}

/** 쿠팡 세션 저장 (Bearer 토큰 필수, 쿠키 선택) */
async function saveStoredCoupangSession(record = {}) {
  const token = String(record.token || '').trim();
  if (!token) return { ok: false, status: 400, error: 'Bearer 토큰이 비어 있습니다.' };

  let tokenExpiresAt = record.tokenExpiresAt || null;
  if (!tokenExpiresAt) {
    // JWT exp 파싱 시도
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
      if (payload?.exp) tokenExpiresAt = new Date(payload.exp * 1000).toISOString();
    } catch { /* ignore */ }
  }

  const value = {
    token,
    cookie: String(record.cookie || '').trim(),
    updatedAt: new Date().toISOString(),
    updatedBy: String(record.updatedBy || '').trim(),
    source: String(record.source || 'playwright_local').trim(),
    tokenExpiresAt,
    lastValidatedAt: record.lastValidatedAt || new Date().toISOString(),
    lastError: ''
  };
  return writeSettingsValue(value.token ? COUPANG_SESSION_KEY : COUPANG_SESSION_KEY, value, 'Coupang Eats session (server-only)');
}

function isTokenExpired(session) {
  if (!session?.tokenExpiresAt) return false;
  return Date.parse(session.tokenExpiresAt) <= Date.now();
}

module.exports = {
  COUPANG_SESSION_KEY,
  getStoredCoupangSession,
  saveStoredCoupangSession,
  isTokenExpired
};
