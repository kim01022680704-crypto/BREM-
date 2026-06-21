-- =============================================================================
-- BREM settlements_tables_migration.sql
-- 일정산/주정산/업로드기록/미매칭 → 전용 테이블 (settings JSON 이관)
-- settings 행은 삭제하지 않음 (운영 백업 유지)
-- =============================================================================

create or replace function public.brem_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- daily_settlements: 일정산 반영 내역
-- ---------------------------------------------------------------------------
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

alter table public.daily_settlements add column if not exists driver_id text not null default '';
alter table public.daily_settlements add column if not exists period date;
alter table public.daily_settlements add column if not exists platform text not null default 'coupang';
alter table public.daily_settlements add column if not exists rider_id text not null default '';
alter table public.daily_settlements add column if not exists order_count integer not null default 0;
alter table public.daily_settlements add column if not exists delivery_amount numeric not null default 0;
alter table public.daily_settlements add column if not exists settlement_amount numeric not null default 0;
alter table public.daily_settlements add column if not exists applied_at timestamptz not null default now();
alter table public.daily_settlements add column if not exists updated_at timestamptz not null default now();

create index if not exists daily_settlements_period_platform_idx
  on public.daily_settlements (period, platform);

create index if not exists daily_settlements_driver_period_idx
  on public.daily_settlements (driver_id, period, platform);

drop trigger if exists daily_settlements_set_updated_at on public.daily_settlements;
create trigger daily_settlements_set_updated_at
  before update on public.daily_settlements
  for each row execute function public.brem_set_updated_at();

-- ---------------------------------------------------------------------------
-- weekly_settlements: 주정산 저장 결과 (riders jsonb)
-- ---------------------------------------------------------------------------
create table if not exists public.weekly_settlements (
  id text primary key,
  platform text not null default 'coupang',
  region text not null default '',
  file_name text not null default '',
  base_settlement_date date,
  start_date date not null,
  end_date date not null,
  payment_date date,
  settlement_week_label text not null default '',
  matched_names_label text not null default '',
  summary jsonb not null default '{}'::jsonb,
  riders jsonb not null default '[]'::jsonb,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.weekly_settlements add column if not exists platform text not null default 'coupang';
alter table public.weekly_settlements add column if not exists region text not null default '';
alter table public.weekly_settlements add column if not exists file_name text not null default '';
alter table public.weekly_settlements add column if not exists base_settlement_date date;
alter table public.weekly_settlements add column if not exists start_date date;
alter table public.weekly_settlements add column if not exists end_date date;
alter table public.weekly_settlements add column if not exists payment_date date;
alter table public.weekly_settlements add column if not exists settlement_week_label text not null default '';
alter table public.weekly_settlements add column if not exists matched_names_label text not null default '';
alter table public.weekly_settlements add column if not exists summary jsonb not null default '{}'::jsonb;
alter table public.weekly_settlements add column if not exists riders jsonb not null default '[]'::jsonb;
alter table public.weekly_settlements add column if not exists uploaded_at timestamptz not null default now();
alter table public.weekly_settlements add column if not exists updated_at timestamptz not null default now();

create index if not exists weekly_settlements_dates_platform_idx
  on public.weekly_settlements (start_date, end_date, platform);

create index if not exists weekly_settlements_uploaded_idx
  on public.weekly_settlements (uploaded_at desc);

drop trigger if exists weekly_settlements_set_updated_at on public.weekly_settlements;
create trigger weekly_settlements_set_updated_at
  before update on public.weekly_settlements
  for each row execute function public.brem_set_updated_at();

-- ---------------------------------------------------------------------------
-- settlement_upload_logs: 일/주 정산 업로드 기록
-- ---------------------------------------------------------------------------
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

create index if not exists settlement_upload_logs_week_kind_idx
  on public.settlement_upload_logs (week_start, platform, kind);

create index if not exists settlement_upload_logs_uploaded_idx
  on public.settlement_upload_logs (uploaded_at desc);

drop trigger if exists settlement_upload_logs_set_updated_at on public.settlement_upload_logs;
create trigger settlement_upload_logs_set_updated_at
  before update on public.settlement_upload_logs
  for each row execute function public.brem_set_updated_at();

-- ---------------------------------------------------------------------------
-- settlement_unmatched: 일/주 미매칭 기사
-- ---------------------------------------------------------------------------
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

create index if not exists settlement_unmatched_week_platform_kind_idx
  on public.settlement_unmatched (week_start, platform, kind);

drop trigger if exists settlement_unmatched_set_updated_at on public.settlement_unmatched;
create trigger settlement_unmatched_set_updated_at
  before update on public.settlement_unmatched
  for each row execute function public.brem_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS (관리자 전용)
-- ---------------------------------------------------------------------------
alter table public.daily_settlements enable row level security;
alter table public.weekly_settlements enable row level security;
alter table public.settlement_upload_logs enable row level security;
alter table public.settlement_unmatched enable row level security;

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

drop policy if exists "settlement_upload_logs admin all" on public.settlement_upload_logs;
create policy "settlement_upload_logs admin all"
  on public.settlement_upload_logs for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

drop policy if exists "settlement_unmatched admin all" on public.settlement_unmatched;
create policy "settlement_unmatched admin all"
  on public.settlement_unmatched for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

-- ---------------------------------------------------------------------------
-- 레거시 weekly_settlement_riders → weekly_settlements (있을 때만)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.weekly_settlement_riders') is not null
     and to_regclass('public.weekly_settlements') is not null then
    insert into public.weekly_settlements (
      id, platform, region, file_name, base_settlement_date, start_date, end_date,
      payment_date, settlement_week_label, matched_names_label, summary, riders, uploaded_at, updated_at
    )
    select
      h.id,
      coalesce(h.platform, 'coupang'),
      coalesce(h.region_name, ''),
      coalesce(h.file_name, ''),
      h.base_settlement_date,
      h.start_date,
      h.end_date,
      h.payment_date,
      coalesce(h.settlement_week_label, ''),
      coalesce(h.matched_names_label, ''),
      coalesce(h.summary, '{}'::jsonb),
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'originalName', r.original_name,
              'riderName', r.rider_name,
              'driverName', r.driver_name,
              'matchedRiderId', r.rider_id,
              'matched', r.matched,
              'weeklyOrderCount', r.weekly_order_count,
              'systemCallCount', r.system_call_count,
              'callCountMatched', r.call_count_matched,
              'coupangLoginKey', r.coupang_login_key,
              'baeminUserId', r.baemin_user_id,
              'warnings', coalesce(r.warnings, '[]'::jsonb)
            ) order by r.sort_order
          )
          from public.weekly_settlement_riders r
          where r.weekly_settlement_id = h.id
        ),
        '[]'::jsonb
      ),
      coalesce(h.uploaded_at, now()),
      coalesce(h.updated_at, now())
    from public.weekly_settlements h
    where false; -- placeholder: legacy header table name may differ
    raise notice 'Legacy weekly_settlement_riders detected — manual merge if needed';
  end if;
exception when others then
  raise notice 'Legacy weekly settlement merge skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- settings JSON → daily_settlements
-- ---------------------------------------------------------------------------
do $$
declare
  raw jsonb;
  item jsonb;
begin
  select value into raw from public.settings where key = 'brem_admin_settlements';
  if raw is not null and jsonb_typeof(raw) = 'array' then
    for item in select * from jsonb_array_elements(raw)
    loop
      if coalesce(item->>'id', '') = '' then continue; end if;
      insert into public.daily_settlements (
        id, driver_id, period, platform, rider_id,
        order_count, delivery_amount, settlement_amount, applied_at, updated_at
      )
      values (
        item->>'id',
        coalesce(item->>'driverId', ''),
        nullif(item->>'period', '')::date,
        coalesce(nullif(item->>'platform', ''), 'coupang'),
        coalesce(item->>'riderId', ''),
        coalesce(nullif(item->>'orderCount', '')::integer, nullif(item->>'callCount', '')::integer, 0),
        coalesce(nullif(item->>'deliveryAmount', '')::numeric, nullif(item->>'settlementAmount', '')::numeric, 0),
        coalesce(nullif(item->>'settlementAmount', '')::numeric, nullif(item->>'deliveryAmount', '')::numeric, 0),
        coalesce(nullif(item->>'appliedAt', '')::timestamptz, now()),
        coalesce(nullif(item->>'appliedAt', '')::timestamptz, now())
      )
      on conflict (id) do update set
        driver_id = excluded.driver_id,
        period = excluded.period,
        platform = excluded.platform,
        rider_id = excluded.rider_id,
        order_count = excluded.order_count,
        delivery_amount = excluded.delivery_amount,
        settlement_amount = excluded.settlement_amount,
        applied_at = excluded.applied_at,
        updated_at = excluded.updated_at;
    end loop;
    raise notice 'Migrated settings.brem_admin_settlements → daily_settlements';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- settings JSON → weekly_settlements
-- ---------------------------------------------------------------------------
do $$
declare
  raw jsonb;
  item jsonb;
begin
  select value into raw from public.settings where key = 'brem_admin_weekly_settlements';
  if raw is not null and jsonb_typeof(raw) = 'array' then
    for item in select * from jsonb_array_elements(raw)
    loop
      if coalesce(item->>'id', '') = '' then continue; end if;
      insert into public.weekly_settlements (
        id, platform, region, file_name, base_settlement_date, start_date, end_date,
        payment_date, settlement_week_label, matched_names_label, summary, riders,
        uploaded_at, updated_at
      )
      values (
        item->>'id',
        coalesce(nullif(item->>'platform', ''), 'coupang'),
        coalesce(item->>'region', ''),
        coalesce(item->>'fileName', ''),
        nullif(item->>'baseSettlementDate', '')::date,
        nullif(item->>'startDate', '')::date,
        nullif(item->>'endDate', '')::date,
        nullif(item->>'paymentDate', '')::date,
        coalesce(item->>'settlementWeekLabel', ''),
        coalesce(item->>'matchedNamesLabel', ''),
        coalesce(item->'summary', '{}'::jsonb),
        coalesce(item->'riders', '[]'::jsonb),
        coalesce(nullif(item->>'uploadedAt', '')::timestamptz, now()),
        coalesce(nullif(item->>'uploadedAt', '')::timestamptz, now())
      )
      on conflict (id) do update set
        platform = excluded.platform,
        region = excluded.region,
        file_name = excluded.file_name,
        base_settlement_date = excluded.base_settlement_date,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        payment_date = excluded.payment_date,
        settlement_week_label = excluded.settlement_week_label,
        matched_names_label = excluded.matched_names_label,
        summary = excluded.summary,
        riders = excluded.riders,
        uploaded_at = excluded.uploaded_at,
        updated_at = excluded.updated_at;
    end loop;
    raise notice 'Migrated settings.brem_admin_weekly_settlements → weekly_settlements';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- settings JSON → settlement_upload_logs
-- ---------------------------------------------------------------------------
do $$
declare
  raw jsonb;
  item jsonb;
begin
  select value into raw from public.settings where key = 'brem_admin_settlement_upload_logs';
  if raw is not null and jsonb_typeof(raw) = 'array' then
    for item in select * from jsonb_array_elements(raw)
    loop
      if coalesce(item->>'id', '') = '' then continue; end if;
      insert into public.settlement_upload_logs (
        id, kind, platform, file_name, period, week_start, week_end, region,
        start_date, end_date, status, matched_count, unmatched_count,
        total_delivery_amount, total_order_count, content_hash,
        matched_records, unmatched_records, applied_records,
        duplicate_of_log_id, skip_reason, linked_record_id,
        uploaded_at, applied_at, updated_at
      )
      values (
        item->>'id',
        coalesce(nullif(item->>'kind', ''), 'daily'),
        coalesce(nullif(item->>'platform', ''), 'coupang'),
        coalesce(item->>'fileName', ''),
        nullif(item->>'period', '')::date,
        nullif(item->>'weekStart', '')::date,
        nullif(item->>'weekEnd', '')::date,
        coalesce(item->>'region', ''),
        nullif(item->>'startDate', '')::date,
        nullif(item->>'endDate', '')::date,
        coalesce(item->>'status', 'uploaded'),
        coalesce(nullif(item->>'matchedCount', '')::integer, 0),
        coalesce(nullif(item->>'unmatchedCount', '')::integer, 0),
        coalesce(nullif(item->>'totalDeliveryAmount', '')::numeric, 0),
        coalesce(nullif(item->>'totalOrderCount', '')::integer, 0),
        coalesce(item->>'contentHash', ''),
        coalesce(item->'matchedRecords', '[]'::jsonb),
        coalesce(item->'unmatchedRecords', '[]'::jsonb),
        coalesce(item->'appliedRecords', '[]'::jsonb),
        coalesce(item->>'duplicateOfLogId', ''),
        coalesce(item->>'skipReason', ''),
        coalesce(item->>'linkedRecordId', ''),
        coalesce(nullif(item->>'uploadedAt', '')::timestamptz, now()),
        nullif(item->>'appliedAt', '')::timestamptz,
        coalesce(nullif(item->>'updatedAt', '')::timestamptz, nullif(item->>'uploadedAt', '')::timestamptz, now())
      )
      on conflict (id) do update set
        kind = excluded.kind,
        platform = excluded.platform,
        file_name = excluded.file_name,
        period = excluded.period,
        week_start = excluded.week_start,
        week_end = excluded.week_end,
        region = excluded.region,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        status = excluded.status,
        matched_count = excluded.matched_count,
        unmatched_count = excluded.unmatched_count,
        total_delivery_amount = excluded.total_delivery_amount,
        total_order_count = excluded.total_order_count,
        content_hash = excluded.content_hash,
        matched_records = excluded.matched_records,
        unmatched_records = excluded.unmatched_records,
        applied_records = excluded.applied_records,
        duplicate_of_log_id = excluded.duplicate_of_log_id,
        skip_reason = excluded.skip_reason,
        linked_record_id = excluded.linked_record_id,
        uploaded_at = excluded.uploaded_at,
        applied_at = excluded.applied_at,
        updated_at = excluded.updated_at;
    end loop;
    raise notice 'Migrated settings.brem_admin_settlement_upload_logs → settlement_upload_logs';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- settings JSON → settlement_unmatched
-- ---------------------------------------------------------------------------
do $$
declare
  raw jsonb;
  item jsonb;
begin
  select value into raw from public.settings where key = 'brem_admin_settlement_unmatched';
  if raw is not null and jsonb_typeof(raw) = 'array' then
    for item in select * from jsonb_array_elements(raw)
    loop
      if coalesce(item->>'id', '') = '' then continue; end if;
      insert into public.settlement_unmatched (
        id, kind, platform, week_start, period, end_date, region,
        raw_name, name, rider_id, order_count, delivery_amount, settlement_amount,
        coupang_login_key, baemin_user_id, match_payload, source_file_name, saved_at, updated_at
      )
      values (
        item->>'id',
        coalesce(nullif(item->>'kind', ''), 'daily'),
        coalesce(nullif(item->>'platform', ''), 'coupang'),
        coalesce(
          nullif(item->>'weekStart', '')::date,
          nullif(item->>'period', '')::date,
          current_date
        ),
        coalesce(nullif(item->>'period', '')::date, current_date),
        nullif(item->>'endDate', '')::date,
        coalesce(item->>'region', ''),
        coalesce(item->>'rawName', item->>'name', ''),
        coalesce(item->>'name', item->>'rawName', ''),
        coalesce(item->>'riderId', ''),
        coalesce(nullif(item->>'orderCount', '')::integer, 0),
        coalesce(nullif(item->>'deliveryAmount', '')::numeric, 0),
        coalesce(nullif(item->>'settlementAmount', '')::numeric, 0),
        coalesce(item->>'coupangLoginKey', ''),
        coalesce(item->>'baeminUserId', ''),
        coalesce(item->'matchPayload', '{}'::jsonb),
        coalesce(item->>'sourceFileName', ''),
        coalesce(nullif(item->>'savedAt', '')::timestamptz, now()),
        coalesce(nullif(item->>'savedAt', '')::timestamptz, now())
      )
      on conflict (id) do update set
        kind = excluded.kind,
        platform = excluded.platform,
        week_start = excluded.week_start,
        period = excluded.period,
        end_date = excluded.end_date,
        region = excluded.region,
        raw_name = excluded.raw_name,
        name = excluded.name,
        rider_id = excluded.rider_id,
        order_count = excluded.order_count,
        delivery_amount = excluded.delivery_amount,
        settlement_amount = excluded.settlement_amount,
        coupang_login_key = excluded.coupang_login_key,
        baemin_user_id = excluded.baemin_user_id,
        match_payload = excluded.match_payload,
        source_file_name = excluded.source_file_name,
        saved_at = excluded.saved_at,
        updated_at = excluded.updated_at;
    end loop;
    raise notice 'Migrated settings.brem_admin_settlement_unmatched → settlement_unmatched';
  end if;
end $$;

notify pgrst, 'reload schema';
