-- BREM 관리자 Auth + profiles 연결 검증
-- bootstrap_initial_admin.sql 실행 후 SQL Editor에서 순서대로 실행

-- 1) Auth 사용자 존재 + 이메일 확인 (BREM_ADMIN_EMAIL 과 일치해야 함)
select
  id as auth_user_id,
  email,
  email_confirmed_at,
  created_at
from auth.users
where email = 'kim01022680704@gmail.com';  -- Vercel BREM_ADMIN_EMAIL 과 동일

-- 2) profiles 에 admin 역할 부여 여부
select
  p.user_id,
  u.email,
  p.role,
  p.display_name,
  p.active,
  p.created_at,
  p.updated_at
from public.profiles p
join auth.users u on u.id = p.user_id
where p.role = 'admin';

-- 3) brem_is_admin() — 관리자 JWT 로 로그인한 세션에서만 true
--    (SQL Editor 단독 실행 시 auth.uid() = null → false 가 정상)
select
  auth.uid() as current_auth_uid,
  public.brem_current_role() as current_role,
  public.brem_is_admin() as is_admin;

-- 4) admin RLS 정책 존재 확인
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'riders', 'notices', 'promotions', 'settings', 'rider_inquiries')
order by tablename, policyname;

-- 5) rider_inquiries 테이블 (문의 API Supabase 저장)
select count(*) as inquiry_count from public.rider_inquiries;

-- 기대 결과 요약
-- [1] auth.users 1행, email_confirmed_at NOT NULL
-- [2] profiles role = 'admin', active = true
-- [3] SQL Editor 단독: is_admin = false (정상). admin.html 로그인 후 앱에서 true
-- [4] brem_* 정책 다수 존재
-- [5] 테이블 접근 OK
