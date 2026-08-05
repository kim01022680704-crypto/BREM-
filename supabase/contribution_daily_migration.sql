-- BREM 일별 기여도 스냅샷
-- 배민: delivery_status 콜수(totalComplete)
-- 쿠팡: rider_daily completeCount (0.8/1 단위)
-- 서버 service role 전용, deny-all RLS.

create table if not exists public.contribution_daily (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  platform text not null,
  region text not null default '',
  rider_id text not null default '',
  rider_name text not null default '',
  score numeric not null default 0,
  source text not null default '',
  match_key text not null default '',
  vendor_or_partner text not null default '',
  raw_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint contribution_daily_platform_chk check (platform in ('baemin', 'coupang')),
  constraint contribution_daily_uniq unique (date, platform, rider_id)
);

create index if not exists idx_contribution_daily_date_platform
  on public.contribution_daily (date desc, platform);

create index if not exists idx_contribution_daily_region
  on public.contribution_daily (date, platform, region);

alter table public.contribution_daily enable row level security;

drop policy if exists brem_service_contribution_daily on public.contribution_daily;
create policy brem_service_contribution_daily on public.contribution_daily
  for all using (false) with check (false);

comment on table public.contribution_daily is
  '일별 기여도 스냅샷. 배민=콜수, 쿠팡=소수 콜. 서버 service role만 접근.';

notify pgrst, 'reload schema';
