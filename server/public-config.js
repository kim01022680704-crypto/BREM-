function resolvePayrollStorageMode() {
  const isProduction = process.env.NODE_ENV === 'production'
    || process.env.BREM_MODE === 'production';
  if (isProduction) return 'supabase';
  const backend = String(process.env.BREM_BACKEND || 'supabase').trim().toLowerCase();
  return backend === 'local' ? 'local' : 'supabase';
}

const { isWriteBlocked, WRITE_BLOCK_MESSAGE, isDevSupabaseConfigured, isProductionSupabaseUrl } = require('./write-guard');

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
    inquiryStorage: writeBlocked ? 'file' : (process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'file')
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
