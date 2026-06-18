/**
 * Supabase 연결 설정
 *
 * 1. Supabase Dashboard → Project Settings → API
 * 2. Project URL  → url 에 입력
 * 3. anon public  → anonKey 에 입력 (service_role 키는 사용하지 마세요)
 * 4. backend: 'local' (백업용 localStorage) | 'supabase' (Supabase 우선)
 *
 * Supabase 연결 실패 시 앱은 자동으로 localStorage 모드로 폴백합니다.
 * 설정 후 admin → 데이터 백업 → localStorage → Supabase 이전 실행
 */
window.BREM_SUPABASE_CONFIG = {
  // 예: 'https://abcdefghijklmnop.supabase.co'
  url: '',

  // Supabase Project Settings → API → anon public key
  anonKey: '',

  // 'local' = localStorage만 사용 | 'supabase' = Supabase 저장 우선 + 실패 시 localStorage
  backend: 'local'
};
