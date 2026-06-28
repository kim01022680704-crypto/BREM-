-- Baemin Biz stats tables (정산주 기준 집계)
-- Note: baemin_delivery_status 는 기존 migration 유지. 일별/라이더 집계 테이블만 추가.

create table if not exists public.baemin_daily_delivery_stats (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  delivery_date date not null,
  collected_at timestamptz not null default now(),
  source_url text not null default '',
  dedupe_key text not null,
  complete_total integer not null default 0,
  reject_total integer not null default 0,
  cancel_total integer not null default 0,
  complete_morning integer not null default 0,
  complete_afternoon integer not null default 0,
  complete_evening integer not null default 0,
  complete_midnight integer not null default 0,
  reject_morning integer not null default 0,
  reject_afternoon integer not null default 0,
  reject_evening integer not null default 0,
  reject_midnight integer not null default 0,
  cancel_morning integer not null default 0,
  cancel_afternoon integer not null default 0,
  cancel_evening integer not null default 0,
  cancel_midnight integer not null default 0,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (week_start, delivery_date, dedupe_key)
);

create table if not exists public.baemin_rider_delivery_stats (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  collected_at timestamptz not null default now(),
  source_url text not null default '',
  dedupe_key text not null,
  rider_name text not null default '',
  rider_user_id text not null default '',
  phone_number text not null default '',
  complete_total integer not null default 0,
  reject_total integer not null default 0,
  cancel_total integer not null default 0,
  complete_morning integer not null default 0,
  complete_afternoon integer not null default 0,
  complete_evening integer not null default 0,
  complete_midnight integer not null default 0,
  reject_morning integer not null default 0,
  reject_afternoon integer not null default 0,
  reject_evening integer not null default 0,
  reject_midnight integer not null default 0,
  cancel_morning integer not null default 0,
  cancel_afternoon integer not null default 0,
  cancel_evening integer not null default 0,
  cancel_midnight integer not null default 0,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (week_start, dedupe_key)
);

create index if not exists idx_baemin_daily_delivery_stats_week on public.baemin_daily_delivery_stats (week_start, delivery_date);
create index if not exists idx_baemin_rider_delivery_stats_week on public.baemin_rider_delivery_stats (week_start);

alter table public.baemin_daily_delivery_stats enable row level security;
alter table public.baemin_rider_delivery_stats enable row level security;

do $$ begin
  create policy baemin_daily_delivery_stats_deny_all on public.baemin_daily_delivery_stats for all using (false);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy baemin_rider_delivery_stats_deny_all on public.baemin_rider_delivery_stats for all using (false);
exception when duplicate_object then null; end $$;
