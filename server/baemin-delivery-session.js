const crypto = require('crypto');
const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');
const baeminAutoCollect = require('./baemin-auto-collect');
const {
  getErpLocalSessionConfig,
  buildStartUrl
} = require('./baemin-session-local-config');
const { formatError, stringifyErrorValue } = require('./baemin-error-format');

const SESSION_SETTINGS_KEY = 'brem_baemin_biz_session';
const SETUP_SETTINGS_KEY = 'brem_baemin_session_setup';
const SETUP_TTL_MS = 15 * 60 * 1000;

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

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
  if (error) {
    return { ok: false, status: 500, error: error.message || '설정 저장에 실패했습니다.' };
  }
  return { ok: true };
}

async function getStoredSessionRecord() {
  const raw = await readSettingsValue(SESSION_SETTINGS_KEY);
  if (!raw || typeof raw !== 'object') return null;
  const cookie = String(raw.cookie || '').trim();
  if (!cookie) return null;
  return {
    cookie,
    updatedAt: raw.updatedAt || null,
    updatedBy: raw.updatedBy || '',
    source: raw.source || 'unknown',
    lastValidatedAt: raw.lastValidatedAt || null,
    lastError: raw.lastError || ''
  };
}

async function saveStoredSession(cookie, meta = {}) {
  const record = {
    cookie: String(cookie || '').trim(),
    updatedAt: new Date().toISOString(),
    updatedBy: String(meta.updatedBy || '').trim(),
    source: String(meta.source || 'playwright_local').trim(),
    lastValidatedAt: meta.lastValidatedAt || null,
    lastError: ''
  };
  if (!record.cookie) {
    return { ok: false, status: 400, error: '쿠키가 비어 있습니다.' };
  }
  return writeSettingsValue(
    SESSION_SETTINGS_KEY,
    record,
    'Baemin Biz session cookie (server-only, do not expose to client)'
  );
}

async function markSessionError(message) {
  const current = await getStoredSessionRecord();
  if (!current) return;
  await writeSettingsValue(SESSION_SETTINGS_KEY, {
    ...current,
    lastError: String(message || '배민 로그인 만료'),
    lastValidatedAt: new Date().toISOString()
  }, 'Baemin Biz session cookie (server-only, do not expose to client)');
}

async function markSessionValidated() {
  const current = await getStoredSessionRecord();
  if (!current) return;
  await writeSettingsValue(SESSION_SETTINGS_KEY, {
    ...current,
    lastError: '',
    lastValidatedAt: new Date().toISOString()
  }, 'Baemin Biz session cookie (server-only, do not expose to client)');
}

async function resolveStoredSessionCookie(options = {}) {
  const fromBody = String(options.sessionCookie || '').trim();
  if (fromBody) return fromBody;

  const stored = await getStoredSessionRecord();
  if (stored?.cookie) return stored.cookie;

  return String(process.env.BAEMIN_BIZ_SESSION_COOKIE || '').trim();
}

async function getSessionStatus(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const stored = await getStoredSessionRecord();
  const envCookie = Boolean(String(process.env.BAEMIN_BIZ_SESSION_COOKIE || '').trim());
  const pendingSetup = await readSettingsValue(SETUP_SETTINGS_KEY);

  const localSession = getErpLocalSessionConfig();

  return {
    ok: true,
    sessionConfigured: Boolean(stored?.cookie),
    updatedAt: stored?.updatedAt || null,
    updatedBy: stored?.updatedBy || '',
    source: stored?.source || (envCookie ? 'env' : ''),
    lastValidatedAt: stored?.lastValidatedAt || null,
    lastError: stored?.lastError || '',
    envCookieConfigured: envCookie,
    setupPending: pendingSetup?.status === 'pending',
    setupStatus: pendingSetup?.status || null,
    localSessionPort: localSession.port,
    localSessionUrl: localSession.localSessionUrl,
    localHealthUrl: localSession.localHealthUrl,
    localHealthUrls: localSession.localHealthUrls,
    collectMode: stored?.cookie ? 'supabase_session' : (envCookie ? 'env_cookie' : 'none')
  };
}

async function createSessionSetup(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const setupId = crypto.randomUUID();
  const setupSecret = randomToken(24);
  const now = Date.now();
  const setup = {
    setupId,
    setupSecret,
    status: 'pending',
    adminUserId: caller.userId,
    adminEmail: caller.email || '',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SETUP_TTL_MS).toISOString(),
    message: '로컬 브라우저에서 배민Biz 로그인을 완료하세요.'
  };

  const saved = await writeSettingsValue(
    SETUP_SETTINGS_KEY,
    setup,
    'Temporary Baemin session setup token'
  );
  if (!saved.ok) return saved;

  const apiBase = String(
    process.env.BREM_PUBLIC_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
    || 'https://brem.kr'
  ).trim();

  const localSession = getErpLocalSessionConfig();
  const startUrl = buildStartUrl({
    setupId,
    setupSecret,
    apiBase,
    port: localSession.port
  });

  return {
    ok: true,
    setupId,
    setupSecret,
    expiresAt: setup.expiresAt,
    localSessionPort: localSession.port,
    localSessionUrl: localSession.localSessionUrl,
    localHealthUrl: localSession.localHealthUrl,
    localHealthUrls: localSession.localHealthUrls,
    startUrl,
    cliCommand: `npm run baemin:session-refresh -- --setup-id=${setupId} --setup-secret=${setupSecret}`
  };
}

async function getSessionSetupStatus(accessToken, setupId) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const setup = await readSettingsValue(SETUP_SETTINGS_KEY);
  if (!setup || setup.setupId !== setupId) {
    return { ok: true, status: 'unknown', message: '세션 갱신 요청을 찾을 수 없습니다.' };
  }

  if (setup.status === 'pending' && setup.expiresAt && Date.parse(setup.expiresAt) < Date.now()) {
    await writeSettingsValue(SETUP_SETTINGS_KEY, {
      ...setup,
      status: 'expired',
      message: '세션 갱신 시간이 만료되었습니다. 다시 시도하세요.'
    }, 'Temporary Baemin session setup token');
    return { ok: true, status: 'expired', message: '세션 갱신 시간이 만료되었습니다.' };
  }

  return {
    ok: true,
    status: setup.status,
    message: setup.message || '',
    completedAt: setup.completedAt || null
  };
}

async function completeSessionSetup(setupId, setupSecret, cookie, meta = {}) {
  const normalizedSetupId = String(setupId || '').trim();
  const normalizedSecret = String(setupSecret || '').trim();
  const cookieText = String(cookie || '').trim();

  console.log('[BREM][session-setup] complete start', {
    setupId: normalizedSetupId,
    cookieLength: cookieText.length,
    source: meta.source || 'playwright_local'
  });

  if (!cookieText) {
    console.warn('[BREM][session-setup] empty cookie');
    return { ok: false, status: 400, error: 'EMPTY_COOKIE', message: '배민 세션 쿠키가 비어 있습니다.' };
  }

  const setup = await readSettingsValue(SETUP_SETTINGS_KEY);
  if (!setup || setup.setupId !== normalizedSetupId) {
    console.warn('[BREM][session-setup] setup not found', {
      requestedSetupId: normalizedSetupId,
      storedSetupId: setup?.setupId || null,
      storedStatus: setup?.status || null
    });
    return {
      ok: false,
      status: 404,
      error: 'SETUP_NOT_FOUND',
      message: '세션 갱신 요청을 찾을 수 없습니다. ERP에서 [배민 세션 갱신]을 다시 눌러주세요.'
    };
  }
  if (setup.setupSecret !== normalizedSecret) {
    console.warn('[BREM][session-setup] invalid setup secret', { setupId: normalizedSetupId });
    return { ok: false, status: 403, error: 'SETUP_SECRET_INVALID', message: '세션 갱신 토큰이 올바르지 않습니다.' };
  }
  if (setup.status !== 'pending') {
    console.warn('[BREM][session-setup] setup not pending', { setupId: normalizedSetupId, status: setup.status });
    return { ok: false, status: 409, error: 'SETUP_NOT_PENDING', message: '이미 처리된 세션 갱신 요청입니다. ERP에서 [배민 세션 갱신]을 다시 눌러주세요.' };
  }
  if (setup.expiresAt && Date.parse(setup.expiresAt) < Date.now()) {
    console.warn('[BREM][session-setup] setup expired', { setupId: normalizedSetupId, expiresAt: setup.expiresAt });
    return { ok: false, status: 410, error: 'SETUP_EXPIRED', message: '세션 갱신 시간이 만료되었습니다. ERP에서 [배민 세션 갱신]을 다시 눌러주세요.' };
  }

  const saved = await saveStoredSession(cookieText, {
    updatedBy: meta.updatedBy || setup.adminEmail || setup.adminUserId || 'local_playwright',
    source: meta.source || 'playwright_local',
    lastValidatedAt: new Date().toISOString()
  });
  if (!saved.ok) {
    console.error('[BREM][session-setup] saveStoredSession failed', saved);
    return {
      ...saved,
      error: stringifyErrorValue(saved.error || saved.message || 'SESSION_SAVE_FAILED'),
      message: stringifyErrorValue(saved.message || saved.error || '배민 세션 저장에 실패했습니다.')
    };
  }

  console.log('[BREM][session-setup] cookie saved to settings', {
    setupId: normalizedSetupId,
    cookieLength: cookieText.length
  });

  await baeminAutoCollect.clearSessionPause().catch(error => {
    console.warn('[BREM][session-setup] clearSessionPause failed:', formatError(error));
  });

  await writeSettingsValue(SETUP_SETTINGS_KEY, {
    ...setup,
    status: 'completed',
    completedAt: new Date().toISOString(),
    message: '배민Biz 세션이 저장되었습니다.'
  }, 'Temporary Baemin session setup token');

  console.log('[BREM][session-setup] complete success', { setupId: normalizedSetupId });
  return { ok: true, message: '배민Biz 세션이 저장되었습니다.' };
}

async function saveSessionViaAdmin(accessToken, cookie, source = 'manual_admin') {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  const saved = await saveStoredSession(cookie, {
    updatedBy: caller.email || caller.userId,
    source,
    lastValidatedAt: new Date().toISOString()
  });
  if (!saved.ok) return saved;
  await baeminAutoCollect.clearSessionPause().catch(() => {});
  return { ok: true, message: '배민Biz 세션이 저장되었습니다.' };
}

module.exports = {
  SESSION_SETTINGS_KEY,
  getStoredSessionRecord,
  resolveStoredSessionCookie,
  getSessionStatus,
  createSessionSetup,
  getSessionSetupStatus,
  completeSessionSetup,
  saveSessionViaAdmin,
  markSessionError,
  markSessionValidated
};
