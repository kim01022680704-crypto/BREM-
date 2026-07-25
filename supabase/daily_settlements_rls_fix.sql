-- BREM 일정산/운영 테이블 — RLS 정책 재적용
-- 증상: 콜수-거절율 동기화(배민 BIZ 연동) 등에서
--   new row violates row-level security policy for table "daily_settlements"
-- 원인: 테이블 재생성/정책 유실로 "admin all" 정책이 사라졌거나,
--   brem_is_admin() 판정에 필요한 함수가 없을 때 발생.
-- 조치: Supabase SQL Editor에서 이 파일 전체를 1회 실행.
--   (관리자 JWT로 로그인한 세션에서만 쓰기가 허용됩니다. 익명 세션은 계속 거부됨.)

-- ---------------------------------------------------------------------------
-- 0) 판정 함수 보장 (profiles.role = 'admin' 인 로그인 세션만 admin 으로 인식)
-- ---------------------------------------------------------------------------
create or replace function public.brem_current_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where user_id = auth.uid() and active = true
$$;

create or replace function public.brem_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.brem_current_role() = 'admin', false)
$$;

-- ---------------------------------------------------------------------------
-- 1) 정산 테이블 RLS + "admin all" 정책 재적용
-- ---------------------------------------------------------------------------
alter table public.daily_settlements enable row level security;
alter table public.weekly_settlements enable row level security;

do $$
begin
  if to_regclass('public.settlement_upload_logs') is not null then
    execute 'alter table public.settlement_upload_logs enable row level security';
  end if;
  if to_regclass('public.settlement_unmatched') is not null then
    execute 'alter table public.settlement_unmatched enable row level security';
  end if;
end $$;

drop policy if exists "daily_settlements admin all" on public.daily_settlements;
create policy "daily_settlements admin all"
  on public.daily_settlements for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

drop policy if exists "weekly_settlements admin all" on public.weekly_settlements;
create policy "weekly_settlements admin all"
  on public.weekly_settlements for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

do $$
begin
  if to_regclass('public.settlement_upload_logs') is not null then
    execute 'drop policy if exists "settlement_upload_logs admin all" on public.settlement_upload_logs';
    execute 'create policy "settlement_upload_logs admin all" on public.settlement_upload_logs for all using (public.brem_is_admin()) with check (public.brem_is_admin())';
  end if;
  if to_regclass('public.settlement_unmatched') is not null then
    execute 'drop policy if exists "settlement_unmatched admin all" on public.settlement_unmatched';
    execute 'create policy "settlement_unmatched admin all" on public.settlement_unmatched for all using (public.brem_is_admin()) with check (public.brem_is_admin())';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) 운영 테이블(콜수/거절율/목표) RLS + "admin all" 정책 재적용
--    (같은 동기화 화면에서 함께 쓰이므로 예방적으로 같이 재적용)
-- ---------------------------------------------------------------------------
alter table public.admin_calls enable row level security;
alter table public.admin_rejection_rates enable row level security;
alter table public.admin_targets enable row level security;

drop policy if exists "admin_calls admin all" on public.admin_calls;
create policy "admin_calls admin all"
  on public.admin_calls for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

drop policy if exists "admin_rejection_rates admin all" on public.admin_rejection_rates;
create policy "admin_rejection_rates admin all"
  on public.admin_rejection_rates for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

drop policy if exists "admin_targets admin all" on public.admin_targets;
create policy "admin_targets admin all"
  on public.admin_targets for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

-- ---------------------------------------------------------------------------
-- 3) 진단: 현재 세션이 admin 으로 보이는지 + 정책 존재 확인
--    (SQL Editor 단독 실행 시 auth.uid()=null → is_admin=false 가 정상.
--     실제 앱 로그인 세션에서만 true 여야 함)
-- ---------------------------------------------------------------------------
select
  auth.uid()               as current_auth_uid,
  public.brem_current_role() as current_role,
  public.brem_is_admin()   as is_admin_in_sql_editor;

select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'daily_settlements','weekly_settlements','settlement_upload_logs',
    'settlement_unmatched','admin_calls','admin_rejection_rates','admin_targets'
  )
order by tablename, policyname;

-- PostgREST/Supabase REST 스키마 캐시 새로고침
notify pgrst, 'reload schema';
