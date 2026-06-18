function getPublicConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const isProduction = process.env.NODE_ENV === 'production'
    || process.env.BREM_MODE === 'production';

  return {
    url,
    anonKey,
    mode: process.env.BREM_MODE || (isProduction ? 'production' : 'development'),
    backend: process.env.BREM_BACKEND || 'supabase',
    allowLocalFallback: process.env.BREM_ALLOW_LOCAL_FALLBACK === 'true',
    isConfigured: Boolean(url && anonKey),
    functionsUrl: String(process.env.SUPABASE_FUNCTIONS_URL || '').trim()
      || (url ? `${url.replace(/\/$/, '')}/functions/v1` : ''),
    initialAdmin: {
      loginName: String(process.env.BREM_ADMIN_LOGIN_NAME || '관리자').trim(),
      email: String(process.env.BREM_ADMIN_EMAIL || 'admin@brem.kr').trim()
    },
    inquiryStorage: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'file'
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
