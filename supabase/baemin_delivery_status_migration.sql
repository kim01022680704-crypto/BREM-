-- =============================================================================
-- BREM baemin_delivery_status 테이블 (배민Biz 배달 현황 수집)
-- Supabase SQL Editor에서 1회 실행
-- =============================================================================

create or replace function public.brem_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.baemin_delivery_status (
  id uuid primary key default gen_random_uuid(),
  capture_date date not null,
  dedupe_key text not null default '',
  rider_name text not null default '',
  phone_number text not null default '',
  user_id text not null default '',
  status_code text not null default '',
  status_desc text not null default '',
  food_complete integer not null default 0,
  bmart_complete integer not null default 0,
  store_complete integer not null default 0,
  total_complete integer not null default 0,
  food_reject integer not null default 0,
  cancel_count integer not null default 0,
  rider_fault integer not null default 0,
  morning_count integer not null default 0,
  afternoon_count integer not null default 0,
  evening_count integer not null default 0,
  midnight_count integer not null default 0,
  hourly_completed jsonb not null default '[]'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint baemin_delivery_status_dedupe unique (capture_date, dedupe_key)
);

create index if not exists idx_baemin_delivery_status_capture_date
  on public.baemin_delivery_status (capture_date desc);

create index if not exists idx_baemin_delivery_status_user_id
  on public.baemin_delivery_status (user_id);

create index if not exists idx_baemin_delivery_status_phone
  on public.baemin_delivery_status (phone_number);

drop trigger if exists trg_baemin_delivery_status_updated_at on public.baemin_delivery_status;
create trigger trg_baemin_delivery_status_updated_at
before update on public.baemin_delivery_status
for each row execute function public.brem_set_updated_at();

alter table public.baemin_delivery_status enable row level security;

drop policy if exists brem_service_baemin_delivery_status on public.baemin_delivery_status;
create policy brem_service_baemin_delivery_status on public.baemin_delivery_status
  for all
  using (false)
  with check (false);

comment on table public.baemin_delivery_status is
  '배민Biz delivery-status API 수집 데이터. 서버 service role만 접근.';
