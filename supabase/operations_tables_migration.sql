-- =============================================================================
-- BREM operations_tables_migration.sql (점검/복구 통합)
-- admin_schedules_migration.sql 실행 후 SQL Editor에서 1회 실행
--
-- 생성 테이블 (앱이 사용하는 공식 이름):
--   admin_calls            ← settings.brem_admin_calls
--   admin_rejection_rates  ← settings.brem_admin_rejection_rates
--   admin_targets          ← settings.brem_admin_targets
--
-- 레거시 테이블명(admin_call_records 등)이 있으면 데이터만 병합 (삭제 안 함)
-- riders / missions / settings 행 절대 DELETE 하지 않음
-- =============================================================================

create or replace function public.brem_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- admin_calls: 일별 콜수
-- ---------------------------------------------------------------------------
create table if not exists public.admin_calls (
  id text primary key,
  driver_id text not null default '',
  date date not null,
  platform text not null default 'coupang',
  count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_calls add column if not exists driver_id text not null default '';
alter table public.admin_calls add column if not exists date date;
alter table public.admin_calls add column if not exists platform text not null default 'coupang';
alter table public.admin_calls add column if not exists count integer not null default 0;
alter table public.admin_calls add column if not exists created_at timestamptz not null default now();
alter table public.admin_calls add column if not exists updated_at timestamptz not null default now();

create index if not exists admin_calls_driver_date_idx
  on public.admin_calls (driver_id, date, platform);

drop trigger if exists admin_calls_set_updated_at on public.admin_calls;
create trigger admin_calls_set_updated_at
  before update on public.admin_calls
  for each row execute function public.brem_set_updated_at();

-- ---------------------------------------------------------------------------
-- admin_rejection_rates: 주간 거절율/수락율
-- platform=coupang → 거절율, platform=baemin → 수락율
-- ---------------------------------------------------------------------------
create table if not exists public.admin_rejection_rates (
  id text primary key,
  driver_id text not null default '',
  week_start date not null,
  platform text not null default 'coupang',
  rate numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.admin_rejection_rates add column if not exists driver_id text not null default '';
alter table public.admin_rejection_rates add column if not exists week_start date;
alter table public.admin_rejection_rates add column if not exists platform text not null default 'coupang';
alter table public.admin_rejection_rates add column if not exists rate numeric not null default 0;
alter table public.admin_rejection_rates add column if not exists updated_at timestamptz not null default now();

create index if not exists admin_rejection_rates_driver_week_idx
  on public.admin_rejection_rates (driver_id, week_start, platform);

-- ---------------------------------------------------------------------------
-- admin_targets: 월간 목표 콜수
-- ---------------------------------------------------------------------------
create table if not exists public.admin_targets (
  id text primary key,
  driver_id text not null default '',
  month text not null default '',
  count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.admin_targets add column if not exists driver_id text not null default '';
alter table public.admin_targets add column if not exists month text not null default '';
alter table public.admin_targets add column if not exists count integer not null default 0;
alter table public.admin_targets add column if not exists updated_at timestamptz not null default now();

create index if not exists admin_targets_driver_month_idx
  on public.admin_targets (driver_id, month);

-- ---------------------------------------------------------------------------
-- RLS
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
-- 레거시 테이블명 → 공식 테이블명 병합 (있을 때만, 삭제 없음)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.admin_call_records') is not null then
    insert into public.admin_calls (id, driver_id, date, platform, count, created_at, updated_at)
    select id, driver_id, date, platform, count,
      coalesce(created_at, now()), coalesce(updated_at, now())
    from public.admin_call_records
    on conflict (id) do update set
      driver_id = excluded.driver_id,
      date = excluded.date,
      platform = excluded.platform,
      count = excluded.count,
      updated_at = excluded.updated_at;
    raise notice 'Merged admin_call_records → admin_calls';
  end if;

  if to_regclass('public.admin_weekly_rates') is not null then
    insert into public.admin_rejection_rates (id, driver_id, week_start, platform, rate, updated_at)
    select id, driver_id, week_start, platform, rate, coalesce(updated_at, now())
    from public.admin_weekly_rates
    on conflict (id) do update set
      driver_id = excluded.driver_id,
      week_start = excluded.week_start,
      platform = excluded.platform,
      rate = excluded.rate,
      updated_at = excluded.updated_at;
    raise notice 'Merged admin_weekly_rates → admin_rejection_rates';
  end if;

  if to_regclass('public.admin_monthly_targets') is not null then
    insert into public.admin_targets (id, driver_id, month, count, updated_at)
    select id, driver_id, month, count, coalesce(updated_at, now())
    from public.admin_monthly_targets
    on conflict (id) do update set
      driver_id = excluded.driver_id,
      month = excluded.month,
      count = excluded.count,
      updated_at = excluded.updated_at;
    raise notice 'Merged admin_monthly_targets → admin_targets';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- settings JSON → 공식 테이블 (settings 행 삭제 안 함)
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
      if coalesce(item->>'id', '') = '' then continue; end if;
      insert into public.admin_calls (id, driver_id, date, platform, count, updated_at)
      values (
        item->>'id',
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
    raise notice 'Migrated settings.brem_admin_calls → admin_calls';
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
      if coalesce(item->>'id', '') = '' then continue; end if;
      ws := coalesce(
        nullif(item->>'weekStart', '')::date,
        nullif(item->>'date', '')::date
      );
      if ws is null then continue; end if;
      insert into public.admin_rejection_rates (id, driver_id, week_start, platform, rate, updated_at)
      values (
        item->>'id',
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
    raise notice 'Migrated settings.brem_admin_rejection_rates → admin_rejection_rates';
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
      if coalesce(item->>'id', '') = '' then continue; end if;
      insert into public.admin_targets (id, driver_id, month, count, updated_at)
      values (
        item->>'id',
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
    raise notice 'Migrated settings.brem_admin_targets → admin_targets';
  end if;
end $$;

-- admin_schedules: settings → table (중복 id는 테이블 값 우선, 빈 칸만 settings로 보강)
do $$
declare
  raw jsonb;
  item jsonb;
begin
  if to_regclass('public.admin_schedules') is null then
    raise notice 'admin_schedules table missing — run admin_schedules_migration.sql first';
    return;
  end if;

  select value into raw from public.settings where key = 'brem_admin_schedules';
  if raw is not null and jsonb_typeof(raw) = 'array' then
    for item in select * from jsonb_array_elements(raw)
    loop
      if coalesce(item->>'id', '') = '' then continue; end if;
      insert into public.admin_schedules (
        id, date, title, memo, created_by, created_by_id, raw_data, created_at, updated_at
      )
      values (
        item->>'id',
        nullif(item->>'date', '')::date,
        coalesce(item->>'title', ''),
        coalesce(item->>'memo', ''),
        coalesce(item->>'createdBy', ''),
        coalesce(item->>'createdById', ''),
        '{}'::jsonb,
        coalesce(nullif(item->>'createdAt', '')::timestamptz, now()),
        coalesce(nullif(item->>'updatedAt', '')::timestamptz, now())
      )
      on conflict (id) do update set
        title = case when coalesce(admin_schedules.title, '') = '' then excluded.title else admin_schedules.title end,
        memo = case when coalesce(admin_schedules.memo, '') = '' then excluded.memo else admin_schedules.memo end,
        created_by = case when coalesce(admin_schedules.created_by, '') = '' then excluded.created_by else admin_schedules.created_by end,
        updated_at = greatest(admin_schedules.updated_at, excluded.updated_at);
    end loop;
    raise notice 'Merged settings.brem_admin_schedules → admin_schedules';
  end if;
end $$;

notify pgrst, 'reload schema';
