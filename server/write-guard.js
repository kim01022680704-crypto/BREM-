/**
 * BREM Supabase 환경 분리 가드
 * - 운영(brem.kr): Vercel production 전용
 * - 로컬: brem-dev 개발 프로젝트만 (운영 URL/Service Role 금지)
 */

const WRITE_BLOCK_MESSAGE = '로컬 개발환경에서는 운영 DB 저장이 차단됩니다';
const PRODUCTION_FORBIDDEN_MESSAGE =
  '로컬 서버는 운영 Supabase(brem.kr)에 연결할 수 없습니다. brem-dev 개발 프로젝트 URL만 .env 의 SUPABASE_URL 에 설정하세요.';

function normalizeSupabaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '').toLowerCase();
}

function extractProjectRef(url) {
  const match = String(url || '').match(/https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return match ? match[1].toLowerCase() : '';
}

function getProductionSupabaseUrl() {
  return normalizeSupabaseUrl(process.env.BREM_PRODUCTION_SUPABASE_URL);
}

function getKnownProductionProjectRef() {
  const fromEnv = String(process.env.BREM_PRODUCTION_SUPABASE_PROJECT_REF || '').trim().toLowerCase();
  if (fromEnv) return fromEnv;
  const fromUrl = extractProjectRef(process.env.BREM_PRODUCTION_SUPABASE_URL);
  if (fromUrl) return fromUrl;
  return 'gvzehykprawnojpdtqtw';
}

function isProductionRuntime() {
  return process.env.NODE_ENV === 'production'
    || process.env.BREM_MODE === 'production';
}

function isLocalDevelopmentRuntime() {
  return !isProductionRuntime();
}

function isLocalDevBackend() {
  if (isProductionRuntime()) return false;
  return String(process.env.BREM_BACKEND || '').trim().toLowerCase() === 'local';
}

function getConfiguredSupabaseUrl() {
  return normalizeSupabaseUrl(process.env.SUPABASE_URL);
}

function isProductionSupabaseUrl(url) {
  const normalized = normalizeSupabaseUrl(url);
  if (!normalized) return false;

  const productionUrl = getProductionSupabaseUrl();
  if (productionUrl && normalized === productionUrl) return true;

  const ref = extractProjectRef(url);
  return ref === getKnownProductionProjectRef();
}

function isConfiguredForProductionSupabase() {
  return isProductionSupabaseUrl(process.env.SUPABASE_URL);
}

function isDevSupabaseConfigured() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) return false;
  if (isProductionSupabaseUrl(url)) return false;
  if (/YOUR_BREM_DEV|YOUR_PROJECT|placeholder/i.test(url)) return false;
  return true;
}

function validateLocalSupabaseConfig() {
  if (!isLocalDevelopmentRuntime()) {
    return { ok: true, environment: 'production-server' };
  }

  const url = String(process.env.SUPABASE_URL || '').trim();
  const backend = String(process.env.BREM_BACKEND || 'supabase').trim().toLowerCase();

  if (url && isProductionSupabaseUrl(url)) {
    return {
      ok: false,
      fatal: true,
      code: 'PRODUCTION_SUPABASE_FORBIDDEN',
      error: PRODUCTION_FORBIDDEN_MESSAGE
    };
  }

  if (backend === 'supabase') {
    if (!url) {
      return {
        ok: false,
        fatal: true,
        code: 'DEV_SUPABASE_URL_REQUIRED',
        error: 'BREM_BACKEND=supabase 인데 SUPABASE_URL 이 없습니다. supabase/DEV_PROJECT_SETUP.md 를 참고해 brem-dev URL을 설정하세요.'
      };
    }
    if (/YOUR_BREM_DEV|YOUR_PROJECT/i.test(url)) {
      return {
        ok: false,
        fatal: true,
        code: 'DEV_SUPABASE_PLACEHOLDER',
        error: 'SUPABASE_URL 이 placeholder 입니다. Supabase Dashboard에서 brem-dev 프로젝트 URL을 넣으세요.'
      };
    }
    if (!String(process.env.SUPABASE_ANON_KEY || '').trim()) {
      return {
        ok: false,
        fatal: true,
        code: 'DEV_SUPABASE_ANON_REQUIRED',
        error: 'SUPABASE_ANON_KEY 가 없습니다. brem-dev 프로젝트 anon key를 .env 에 설정하세요.'
      };
    }
  }

  return {
    ok: true,
    environment: backend === 'local' ? 'local-storage' : 'dev-supabase',
    devSupabase: isDevSupabaseConfigured()
  };
}

function assertLocalSupabaseSafeOnBoot() {
  const result = validateLocalSupabaseConfig();
  if (result.ok) return result;
  if (result.fatal) {
    console.error('\n[BREM FATAL]', result.error);
    console.error('       → supabase/DEV_PROJECT_SETUP.md');
    process.exit(1);
  }
  return result;
}

function isPointingAtProductionSupabase() {
  return isConfiguredForProductionSupabase();
}

function isWriteBlocked() {
  if (isProductionRuntime()) return false;
  if (isLocalDevBackend()) return true;
  if (isConfiguredForProductionSupabase()) return true;
  return false;
}

function isLocalServiceRoleForbidden() {
  if (isProductionRuntime()) return false;
  if (isConfiguredForProductionSupabase()) return true;
  if (isLocalDevBackend()) return true;
  return false;
}

function assertWriteAllowed(context = '') {
  if (!isWriteBlocked()) return;
  const error = new Error(WRITE_BLOCK_MESSAGE);
  error.code = 'WRITE_BLOCKED';
  error.context = context;
  throw error;
}

function createWriteBlockedResponse() {
  return {
    ok: false,
    status: 403,
    error: WRITE_BLOCK_MESSAGE,
    writeBlocked: true
  };
}

function warnLocalServiceRoleKey() {
  if (!isLocalDevelopmentRuntime()) return;
  if (isLocalDevBackend()) {
    console.log('[BREM] BREM_BACKEND=local — Supabase 미사용, 브라우저 localStorage 개발 모드');
    return;
  }
  if (isConfiguredForProductionSupabase()) return;

  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!key) {
    console.warn(
      '[BREM] BREM_BACKEND=supabase: SUPABASE_SERVICE_ROLE_KEY 미설정 — brem-dev service role 필요'
    );
  }
}

function applyWriteBlockedEnvFlag() {
  if (isWriteBlocked()) {
    process.env.WRITE_BLOCKED = 'true';
  } else {
    delete process.env.WRITE_BLOCKED;
  }
}

module.exports = {
  WRITE_BLOCK_MESSAGE,
  PRODUCTION_FORBIDDEN_MESSAGE,
  isProductionRuntime,
  isLocalDevelopmentRuntime,
  isLocalDevBackend,
  extractProjectRef,
  getKnownProductionProjectRef,
  isProductionSupabaseUrl,
  isConfiguredForProductionSupabase,
  isDevSupabaseConfigured,
  isPointingAtProductionSupabase,
  validateLocalSupabaseConfig,
  assertLocalSupabaseSafeOnBoot,
  isWriteBlocked,
  isLocalServiceRoleForbidden,
  assertWriteAllowed,
  createWriteBlockedResponse,
  warnLocalServiceRoleKey,
  applyWriteBlockedEnvFlag
};
