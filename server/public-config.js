function resolvePayrollStorageMode() {
  const isProduction = process.env.NODE_ENV === 'production'
    || process.env.BREM_MODE === 'production';
  if (isProduction) return 'supabase';
  const backend = String(process.env.BREM_BACKEND || 'supabase').trim().toLowerCase();
  return backend === 'local' ? 'local' : 'supabase';
}

const { isWriteBlocked, WRITE_BLOCK_MESSAGE, isDevSupabaseConfigured, isProductionSupabaseUrl } = require('./write-guard');
const { getErpLocalSessionConfig } = require('./baemin-session-local-config');

/** DB/설정 조회가 느릴 때 이름 로그인이 끊기지 않도록 쓰는 비상 매핑 (삭제가 아닌 조회용) */
const DEFAULT_ADMIN_LOGIN_HINTS = Object.freeze({
  관리자: 'kim01022680704@gmail.com',
  김형진: 'admin.g7yfepgm@gmail.com',
  김형진2: '2.35urtxd8@gmail.com',
  방준길: 'admin.fszu0d19@gmail.com',
  이동주: 'admin.grb0145t@gmail.com',
  박재현: 'admin.gik1wkeq@gmail.com',
  장승표: 'admin.ikk1dv0r@gmail.com',
  한승훈: 'admin.8od1nnsw@gmail.com',
  신명화: 'admin.6cdhmwe6@gmail.com',
  테스트01: '01.j4rpq9cs@gmail.com'
});

function parseAdminLoginHints(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const hints = {};
    Object.entries(parsed).forEach(([name, email]) => {
      const loginName = String(name || '').trim();
      const loginEmail = String(email || '').trim();
      if (loginName && loginEmail.includes('@')) {
        hints[loginName] = loginEmail;
      }
    });
    return hints;
  } catch {
    return {};
  }
}

function getAdminLoginHints() {
  return {
    ...DEFAULT_ADMIN_LOGIN_HINTS,
    ...parseAdminLoginHints(process.env.BREM_ADMIN_LOGIN_MAP)
  };
}

function getPublicConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const isProduction = process.env.NODE_ENV === 'production'
    || process.env.BREM_MODE === 'production';
  const payrollStorageMode = resolvePayrollStorageMode();
  const writeBlocked = isWriteBlocked();
  const devSupabase = !isProduction && isDevSupabaseConfigured();

  return {
    url,
    anonKey,
    mode: process.env.BREM_MODE || (isProduction ? 'production' : 'development'),
    nodeEnv: process.env.NODE_ENV || 'development',
    backend: isProduction ? 'supabase' : (process.env.BREM_BACKEND || 'supabase'),
    allowLocalFallback: isProduction ? false : process.env.BREM_ALLOW_LOCAL_FALLBACK === 'true',
    isConfigured: Boolean(url && anonKey),
    functionsUrl: String(process.env.SUPABASE_FUNCTIONS_URL || '').trim()
      || (url ? `${url.replace(/\/$/, '')}/functions/v1` : ''),
    initialAdmin: {
      loginName: String(process.env.BREM_ADMIN_LOGIN_NAME || '관리자').trim(),
      email: String(process.env.BREM_ADMIN_EMAIL || 'admin@brem.kr').trim()
    },
    adminLoginHints: getAdminLoginHints(),
    payrollProductionRiders: {
      enabled: false,
      configured: false,
      readOnly: true,
      authMode: 'disabled-local-dev'
    },
    payrollStorage: {
      mode: payrollStorageMode,
      label: payrollStorageMode === 'local' ? '로컬' : 'Supabase',
      migrationFile: 'supabase/payroll_slips_migration.sql'
    },
    supabaseReadOnly: writeBlocked,
    writeBlocked,
    writeBlockMessage: writeBlocked ? WRITE_BLOCK_MESSAGE : '',
    devSupabase,
    productionSupabaseForbidden: !isProduction && isProductionSupabaseUrl(url),
    inquiryStorage: writeBlocked ? 'file' : (process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'file'),
    baeminSessionLocal: getErpLocalSessionConfig()
  };
}

function isSupabaseConfigured() {
  const config = getPublicConfig();
  return Boolean(config.url && config.anonKey);
}

module.exports = {
  getPublicConfig,
  isSupabaseConfigured
};
