/**
 * Supabase 연결 설정
 *
 * 1. Supabase Dashboard → Project Settings → API
 * 2. Project URL  → url 에 입력
 * 3. anon public  → anonKey 에 입력 (service_role 키는 사용하지 마세요)
 * 4. backend: 'local' (기본) | 'supabase' (Supabase 모드)
 *
 * 설정 후 admin → 데이터 백업 → localStorage → Supabase 이전 실행
 */
window.BREM_SUPABASE_CONFIG = {
  // 예: 'https://abcdefghijklmnop.supabase.co'
  url: '',

  // 예: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  anonKey: '',

  // 'local' = localStorage (기본) | 'supabase' = Supabase 사용
  backend: 'local'
};
