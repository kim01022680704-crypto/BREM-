/**
 * Supabase 연결 설정 (템플릿)
 *
 * 실제 값은 .env / Vercel 환경변수에 넣고,
 * 런타임에 /api/public-config 가 js/supabase-config.js 로 주입합니다.
 *
 * service_role 키는 서버(SUPABASE_SERVICE_ROLE_KEY)에만 설정하세요.
 */
window.BREM_SUPABASE_CONFIG = {
  url: '',
  anonKey: '',
  mode: 'production',
  backend: 'supabase',
  allowLocalFallback: false,
  functionsUrl: '',
  inquiryStorage: 'supabase',
  initialAdmin: {
    loginName: '관리자',
    email: 'admin@brem.kr'
  }
};
