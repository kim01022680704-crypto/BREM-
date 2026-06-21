-- =============================================================================
-- BREM 정산 migration — 단계별 실행용 (짧은 버전)
-- Supabase SQL Editor 에서 위에서부터 순서대로 Run
-- =============================================================================

-- [0] 지금 상태 확인 (참고용)
select
  to_regclass('public.daily_settlements') is not null as daily_ok,
  to_regclass('public.weekly_settlements') is not null as weekly_ok,
  to_regclass('public.settlement_upload_logs') is not null as logs_ok,
  to_regclass('public.settlement_unmatched') is not null as unmatched_ok;

-- =============================================================================
-- [1] STEP 1 — 없는 테이블 3개 만들기 (여기만 먼저 Run 해도 됨)
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

-- weekly_settlements 컬럼 보강 (이미 있으면 컬럼만 추가)
alter table public.weekly_settlements add column if not exists region text not null default '';
alter table public.weekly_settlements add column if not exists file_name text not null default '';
alter table public.weekly_settlements add column if not exists riders jsonb not null default '[]'::jsonb;
alter table public.weekly_settlements add column if not exists summary jsonb not null default '{}'::jsonb;

-- =============================================================================
-- [2] STEP 2 — weekly_settlements id 가 uuid 이면 text 로 변환
--         (weekly_settlement_riders FK 가 있으면 먼저 제거)
-- =============================================================================

do $$
declare
  col_type text;
begin
  -- 자식 테이블 FK 컬럼 먼저 text 로 (uuid → text)
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_settlement_riders'
      and column_name = 'weekly_settlement_id'
      and data_type = 'uuid'
  ) then
    alter table public.weekly_settlement_riders
      drop constraint if exists weekly_settlement_riders_weekly_settlement_id_fkey;
    alter table public.weekly_settlement_riders
      alter column weekly_settlement_id type text using weekly_settlement_id::text;
    raise notice 'weekly_settlement_riders.weekly_settlement_id uuid -> text 완료';
  end if;

  -- 부모 테이블 id 변환
  select c.data_type into col_type
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'weekly_settlements'
    and c.column_name = 'id';

  if col_type = 'uuid' then
    alter table public.weekly_settlements alter column id drop default;
    alter table public.weekly_settlements
      alter column id type text using id::text;
    raise notice 'weekly_settlements.id uuid -> text 완료';
  else
    raise notice 'weekly_settlements.id 이미 text (또는 테이블 없음)';
  end if;
exception when others then
  raise notice 'uuid 변환 오류: %', sqlerrm;
  raise;
end $$;

-- =============================================================================
-- [3] STEP 3 — settings JSON → 테이블 이관 (데이터 복사, settings 는 삭제 안 함)
--     전체 migration 과 동일. settlements_tables_migration.sql 의 이관 블록.
--     → STEP 1·2 성공 후 settlements_tables_migration.sql [RLS] 아래부터 Run 해도 됩니다.
-- =============================================================================

-- STEP 1·2 후 확인:
select
  to_regclass('public.daily_settlements') is not null as daily_ok,
  to_regclass('public.weekly_settlements') is not null as weekly_ok,
  to_regclass('public.settlement_upload_logs') is not null as logs_ok,
  to_regclass('public.settlement_unmatched') is not null as unmatched_ok;

-- 4개가 모두 true 면 STEP 1·2 성공.
-- 그 다음 settlements_tables_migration.sql 파일에서
-- "-- settings JSON → daily_settlements" 부터 끝까지 Run

notify pgrst, 'reload schema';
