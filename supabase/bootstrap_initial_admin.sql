-- BREM 최초 관리자 계정 연결 (운영 배포 1회)
--
-- 선행 조건:
--   1) supabase/schema.sql 실행 완료
--   2) supabase/rider_inquiries_migration.sql 실행 완료 (또는 schema에 포함)
--   3) Supabase Dashboard → Authentication → Users → Add user
--      - Email: kim01022680704@gmail.com (Vercel BREM_ADMIN_EMAIL)
--      - Password: 임시 강력 비밀번호
--      - Auto Confirm User: 체크
--
-- 4) 아래 이메일을 실제 관리자 이메일로 수정 후 실행
-- 5) supabase/verify_admin_setup.sql 로 검증

-- ★ Vercel BREM_ADMIN_EMAIL 과 동일 (kim01022680704@gmail.com) ★

insert into public.profiles (user_id, role, display_name, active)
select
  id,
  'admin',
  '관리자',
  true
from auth.users
where email = 'kim01022680704@gmail.com'
on conflict (user_id) do update
set
  role = 'admin',
  display_name = '관리자',
  active = true,
  updated_at = now();

-- 확인: 1행 이상, role = admin
select
  p.user_id,
  u.email,
  p.role,
  p.display_name,
  p.active,
  public.brem_is_admin() as is_admin_in_sql_editor
from public.profiles p
join auth.users u on u.id = p.user_id
where p.role = 'admin';