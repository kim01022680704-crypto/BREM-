-- BREM 라이더/제휴 문의 — 운영 Supabase 저장
-- Supabase SQL Editor에서 실행 (schema.sql 적용 후)
--
-- API 서버(Vercel)는 SUPABASE_SERVICE_ROLE_KEY 로 이 테이블에 CRUD
-- 포털 anon insert 정책은 RLS 로 보호 (서버 service role 은 RLS 우회)

create table if not exists public.rider_inquiries (  id text primary key,
  name text not null default '',
  phone text not null default '',
  area text not null default '',
  inquiry_type text not null default '라이더 지원',
  message text not null default '',
  status text not null default 'new',
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_brem_rider_inquiries_status_created
  on public.rider_inquiries (status, created_at desc);

alter table public.rider_inquiries enable row level security;

drop policy if exists "brem_rider_inquiries_anon_insert" on public.rider_inquiries;
create policy "brem_rider_inquiries_anon_insert"
on public.rider_inquiries for insert to anon, authenticated
with check (true);

drop policy if exists "brem_rider_inquiries_admin_all" on public.rider_inquiries;
create policy "brem_rider_inquiries_admin_all"
on public.rider_inquiries for all to authenticated
using (public.brem_is_admin())
with check (public.brem_is_admin());

notify pgrst, 'reload schema';
