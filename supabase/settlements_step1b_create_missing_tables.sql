-- =============================================================================
-- STEP 1-B — 없는 테이블 3개만 만들기 (FK 수정 후 Run)
-- Supabase SQL Editor → 전체 복사 → Run without RLS
-- =============================================================================

create or replace function public.brem_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.daily_settlements (
  id text primary key,
  driver_id text not null default '',
  period date not null,
  platform text not null default 'coupang',
  rider_id text not null default '',
  order_count integer not null default 0,
  delivery_amount numeric not null default 0,
  settlement_amount numeric not null default 0,
  applied_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settlement_upload_logs (
  id text primary key,
  kind text not null default 'daily',
  platform text not null default 'coupang',
  file_name text not null default '',
  period date,
  week_start date,
  week_end date,
  region text not null default '',
  start_date date,
  end_date date,
  status text not null default 'uploaded',
  matched_count integer not null default 0,
  unmatched_count integer not null default 0,
  total_delivery_amount numeric not null default 0,
  total_order_count integer not null default 0,
  content_hash text not null default '',
  matched_records jsonb not null default '[]'::jsonb,
  unmatched_records jsonb not null default '[]'::jsonb,
  applied_records jsonb not null default '[]'::jsonb,
  duplicate_of_log_id text not null default '',
  skip_reason text not null default '',
  linked_record_id text not null default '',
  uploaded_at timestamptz not null default now(),
  applied_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.settlement_unmatched (
  id text primary key,
  kind text not null default 'daily',
  platform text not null default 'coupang',
  week_start date not null,
  period date not null,
  end_date date,
  region text not null default '',
  raw_name text not null default '',
  name text not null default '',
  rider_id text not null default '',
  order_count integer not null default 0,
  delivery_amount numeric not null default 0,
  settlement_amount numeric not null default 0,
  coupang_login_key text not null default '',
  baemin_user_id text not null default '',
  match_payload jsonb not null default '{}'::jsonb,
  source_file_name text not null default '',
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.weekly_settlements add column if not exists region text not null default '';
alter table public.weekly_settlements add column if not exists file_name text not null default '';
alter table public.weekly_settlements add column if not exists riders jsonb not null default '[]'::jsonb;
alter table public.weekly_settlements add column if not exists summary jsonb not null default '{}'::jsonb;

-- 확인: 4개 모두 true
select
  to_regclass('public.daily_settlements') is not null as daily_ok,
  to_regclass('public.weekly_settlements') is not null as weekly_ok,
  to_regclass('public.settlement_upload_logs') is not null as logs_ok,
  to_regclass('public.settlement_unmatched') is not null as unmatched_ok;

notify pgrst, 'reload schema';
