-- =============================================================================
-- BREM 운영 데이터 전용 테이블 (콜수 · 주간 거절/수락율 · 월간 목표)
-- settings JSON → 전용 테이블 이전 (기존 settings 행은 삭제하지 않음)
-- SQL Editor에서 admin_schedules_migration.sql 이후 1회 실행
-- =============================================================================

create or replace function public.brem_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- admin_call_records: 일별 콜수 (brem_admin_calls)
-- ---------------------------------------------------------------------------
create table if not exists public.admin_call_records (
  id text primary key,
  driver_id text not null default '',
  date date not null,
  platform text not null default 'coupang',
  count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_call_records add column if not exists driver_id text not null default '';
alter table public.admin_call_records add column if not exists date date;
alter table public.admin_call_records add column if not exists platform text not null default 'coupang';
alter table public.admin_call_records add column if not exists count integer not null default 0;
alter table public.admin_call_records add column if not exists created_at timestamptz not null default now();
alter table public.admin_call_records add column if not exists updated_at timestamptz not null default now();

create index if not exists admin_call_records_driver_date_idx
  on public.admin_call_records (driver_id, date, platform);

-- ---------------------------------------------------------------------------
-- admin_weekly_rates: 주간 거절율/수락율 (brem_admin_rejection_rates)
-- platform=coupang → 거절율, platform=baemin → 수락율
-- ---------------------------------------------------------------------------
create table if not exists public.admin_weekly_rates (
  id text primary key,
  driver_id text not null default '',
  week_start date not null,
  platform text not null default 'coupang',
  rate numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.admin_weekly_rates add column if not exists driver_id text not null default '';
alter table public.admin_weekly_rates add column if not exists week_start date;
alter table public.admin_weekly_rates add column if not exists platform text not null default 'coupang';
alter table public.admin_weekly_rates add column if not exists rate numeric not null default 0;
alter table public.admin_weekly_rates add column if not exists updated_at timestamptz not null default now();

create index if not exists admin_weekly_rates_driver_week_idx
  on public.admin_weekly_rates (driver_id, week_start, platform);

-- ---------------------------------------------------------------------------
-- admin_monthly_targets: 월간 목표 콜수 (brem_admin_targets)
-- ---------------------------------------------------------------------------
create table if not exists public.admin_monthly_targets (
  id text primary key,
  driver_id text not null default '',
  month text not null default '',
  count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.admin_monthly_targets add column if not exists driver_id text not null default '';
alter table public.admin_monthly_targets add column if not exists month text not null default '';
alter table public.admin_monthly_targets add column if not exists count integer not null default 0;
alter table public.admin_monthly_targets add column if not exists updated_at timestamptz not null default now();

create index if not exists admin_monthly_targets_driver_month_idx
  on public.admin_monthly_targets (driver_id, month);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
drop trigger if exists admin_call_records_set_updated_at on public.admin_call_records;
create trigger admin_call_records_set_updated_at
  before update on public.admin_call_records
  for each row execute function public.brem_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.admin_call_records enable row level security;
alter table public.admin_weekly_rates enable row level security;
alter table public.admin_monthly_targets enable row level security;

drop policy if exists "admin_call_records admin all" on public.admin_call_records;
create policy "admin_call_records admin all"
  on public.admin_call_records for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

drop policy if exists "admin_weekly_rates admin all" on public.admin_weekly_rates;
create policy "admin_weekly_rates admin all"
  on public.admin_weekly_rates for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

drop policy if exists "admin_monthly_targets admin all" on public.admin_monthly_targets;
create policy "admin_monthly_targets admin all"
  on public.admin_monthly_targets for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

-- ---------------------------------------------------------------------------
-- settings JSON → 테이블 1회 이전 (기존 settings 행 유지)
-- ---------------------------------------------------------------------------
do $$
declare
  raw jsonb;
  item jsonb;
begin
  select value into raw from public.settings where key = 'brem_admin_calls';
  if raw is not null and jsonb_typeof(raw) = 'array' then
    for item in select * from jsonb_array_elements(raw)
    loop
      insert into public.admin_call_records (id, driver_id, date, platform, count, updated_at)
      values (
        coalesce(item->>'id', ''),
        coalesce(item->>'driverId', ''),
        nullif(item->>'date', '')::date,
        coalesce(nullif(item->>'platform', ''), 'coupang'),
        coalesce(nullif(item->>'count', '')::integer, 0),
        coalesce(nullif(item->>'updatedAt', '')::timestamptz, now())
      )
      on conflict (id) do update set
        driver_id = excluded.driver_id,
        date = excluded.date,
        platform = excluded.platform,
        count = excluded.count,
        updated_at = excluded.updated_at;
    end loop;
    raise notice 'Migrated brem_admin_calls → admin_call_records';
  end if;
end $$;

do $$
declare
  raw jsonb;
  item jsonb;
  ws date;
begin
  select value into raw from public.settings where key = 'brem_admin_rejection_rates';
  if raw is not null and jsonb_typeof(raw) = 'array' then
    for item in select * from jsonb_array_elements(raw)
    loop
      ws := coalesce(
        nullif(item->>'weekStart', '')::date,
        nullif(item->>'date', '')::date
      );
      if ws is null then
        continue;
      end if;
      insert into public.admin_weekly_rates (id, driver_id, week_start, platform, rate, updated_at)
      values (
        coalesce(item->>'id', ''),
        coalesce(item->>'driverId', ''),
        ws,
        coalesce(nullif(item->>'platform', ''), 'coupang'),
        coalesce(nullif(item->>'rate', '')::numeric, 0),
        coalesce(nullif(item->>'updatedAt', '')::timestamptz, now())
      )
      on conflict (id) do update set
        driver_id = excluded.driver_id,
        week_start = excluded.week_start,
        platform = excluded.platform,
        rate = excluded.rate,
        updated_at = excluded.updated_at;
    end loop;
    raise notice 'Migrated brem_admin_rejection_rates → admin_weekly_rates';
  end if;
end $$;

do $$
declare
  raw jsonb;
  item jsonb;
begin
  select value into raw from public.settings where key = 'brem_admin_targets';
  if raw is not null and jsonb_typeof(raw) = 'array' then
    for item in select * from jsonb_array_elements(raw)
    loop
      insert into public.admin_monthly_targets (id, driver_id, month, count, updated_at)
      values (
        coalesce(item->>'id', ''),
        coalesce(item->>'driverId', ''),
        coalesce(item->>'month', ''),
        coalesce(nullif(item->>'count', '')::integer, 0),
        now()
      )
      on conflict (id) do update set
        driver_id = excluded.driver_id,
        month = excluded.month,
        count = excluded.count,
        updated_at = excluded.updated_at;
    end loop;
    raise notice 'Migrated brem_admin_targets → admin_monthly_targets';
  end if;
end $$;

-- admin_schedules settings → table (테이블이 이미 있을 때만)
do $$
declare
  raw jsonb;
  item jsonb;
begin
  if to_regclass('public.admin_schedules') is null then
    return;
  end if;
  select value into raw from public.settings where key = 'brem_admin_schedules';
  if raw is not null and jsonb_typeof(raw) = 'array' then
    for item in select * from jsonb_array_elements(raw)
    loop
      insert into public.admin_schedules (
        id, date, title, memo, created_by, created_by_id, raw_data, created_at, updated_at
      )
      values (
        coalesce(item->>'id', ''),
        nullif(item->>'date', '')::date,
        coalesce(item->>'title', ''),
        coalesce(item->>'memo', ''),
        coalesce(item->>'createdBy', ''),
        coalesce(item->>'createdById', ''),
        '{}'::jsonb,
        coalesce(nullif(item->>'createdAt', '')::timestamptz, now()),
        coalesce(nullif(item->>'updatedAt', '')::timestamptz, now())
      )
      on conflict (id) do nothing;
    end loop;
    raise notice 'Merged brem_admin_schedules → admin_schedules (existing rows kept)';
  end if;
end $$;

notify pgrst, 'reload schema';
