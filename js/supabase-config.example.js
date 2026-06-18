/**
 * Supabase 연결 설정
 * 이 파일을 supabase-config.js 로 복사한 뒤 값을 입력하세요.
 * 연결 실패 시 localStorage로 자동 폴백됩니다.
 */
window.BREM_SUPABASE_CONFIG = {
  url: 'https://YOUR_PROJECT.supabase.co',
  anonKey: 'YOUR_SUPABASE_ANON_KEY',
  // 'local' = localStorage only | 'supabase' = Supabase first, local fallback
  backend: 'local'
};
