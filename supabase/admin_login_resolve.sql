-- BREM 관리자 아이디(이름) → 이메일 빠른 조회
-- settings JSON 대신 소형 테이블 + RPC 로 로그인 이름 해석 (Supabase SQL Editor에서 실행)

create table if not exists public.admin_login_directory (
  login_name text primary key,
  email text not null,
  user_id uuid references auth.users (id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index if not exists admin_login_directory_name_idx
  on public.admin_login_directory (login_name);

insert into public.admin_login_directory (login_name, email, user_id)
select
  trim(p.display_name) as login_name,
  lower(trim(u.email)) as email,
  p.user_id
from public.profiles p
join auth.users u on u.id = p.user_id
where p.role = 'admin'
  and p.active = true
  and coalesce(trim(p.display_name), '') <> ''
on conflict (login_name) do update
set
  email = excluded.email,
  user_id = excluded.user_id,
  updated_at = now();

create or replace function public.resolve_admin_login_email(login_name text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select email
  from public.admin_login_directory
  where login_name = trim(login_name)
  limit 1;
$$;

revoke all on function public.resolve_admin_login_email(text) from public;
grant execute on function public.resolve_admin_login_email(text) to anon, authenticated;
