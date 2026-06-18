-- BREM ERP Supabase Schema - PRODUCTION
-- Supabase SQL Editor에서 그대로 실행하세요.
--
-- 저장 구조:
--   riders      : 기사 데이터
--   notices     : 공지사항
--   promotions  : 프로모션 설정/조건
--   settings    : 관리자 설정 및 기타 localStorage 백업 데이터
--
-- 운영 기준:
--   - Supabase Auth 필수
--   - anon CRUD 불가
--   - admin 역할만 전체 관리 가능
--   - rider 역할은 본인 rider 데이터만 조회 가능

-- ---------------------------------------------------------------------------
-- RLS 정책 idempotent 정리 (schema.sql 전체 재실행 안전)
-- public 스키마의 brem_* 정책을 모두 제거한 뒤 아래에서 다시 생성합니다.
-- ---------------------------------------------------------------------------
do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname ~ '^brem_'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end $$;

-- 이전 9-table schema 잔존 테이블 정책 (테이블이 있을 때만 명시 제거)
do $$
begin
  if to_regclass('public.regions') is not null then
    drop policy if exists "brem_auth_all_regions" on public.regions;
  end if;
  if to_regclass('public.users') is not null then
    drop policy if exists "brem_auth_all_users" on public.users;
  end if;
  if to_regclass('public.promotion_rules') is not null then
    drop policy if exists "brem_auth_all_promotion_rules" on public.promotion_rules;
  end if;
  if to_regclass('public.weekly_settlements') is not null then
    drop policy if exists "brem_auth_all_weekly_settlements" on public.weekly_settlements;
  end if;
  if to_regclass('public.weekly_settlement_riders') is not null then
    drop policy if exists "brem_auth_all_weekly_settlement_riders" on public.weekly_settlement_riders;
  end if;
  if to_regclass('public.rider_name_mappings') is not null then
    drop policy if exists "brem_auth_all_rider_name_mappings" on public.rider_name_mappings;
  end if;
  if to_regclass('public.system_kv_store') is not null then
    drop policy if exists "brem_auth_all_system_kv_store" on public.system_kv_store;
  end if;
end $$;

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles: Supabase Auth 사용자 역할
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'rider')),
  rider_id text,
  display_name text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_brem_profiles_role on public.profiles (role);
create index if not exists idx_brem_profiles_rider_id on public.profiles (rider_id);

create or replace function public.brem_current_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where user_id = auth.uid() and active = true
$$;

create or replace function public.brem_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.brem_current_role() = 'admin', false)
$$;

create or replace function public.brem_current_rider_id()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select rider_id from public.profiles where user_id = auth.uid() and active = true
$$;

-- 이전 버전 보조 테이블이 riders(id)를 uuid FK로 참조하면 id 타입 보정이 실패할 수 있어
-- 해당 FK 제약만 먼저 제거합니다. 데이터 삭제는 하지 않습니다.
do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select
      con.conname as constraint_name,
      rel_ns.nspname as table_schema,
      rel.relname as table_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace rel_ns on rel_ns.oid = rel.relnamespace
    join pg_class ref on ref.oid = con.confrelid
    join pg_namespace ref_ns on ref_ns.oid = ref.relnamespace
    where con.contype = 'f'
      and ref_ns.nspname = 'public'
      and ref.relname = 'riders'
  loop
    execute format(
      'alter table %I.%I drop constraint if exists %I',
      constraint_record.table_schema,
      constraint_record.table_name,
      constraint_record.constraint_name
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- riders: 기사 데이터
-- localStorage key: brem_driver_management_drivers
-- ---------------------------------------------------------------------------
create table if not exists public.riders (
  id text primary key,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null default '',
  phone text not null default '',
  resident_number text not null default '',
  bank_name text not null default '',
  account_holder text not null default '',
  account_number text not null default '',
  baemin_id text not null default '',
  platform_coupang boolean not null default true,
  platform_baemin boolean not null default false,
  long_event_item_id text not null default '',
  long_event_item text not null default '',
  long_event_start_date date,
  join_date date,
  status text not null default '근무중',
  memo text not null default '',
  hidden_fields jsonb not null default '{}'::jsonb,
  promotion_selector_coupang text not null default '',
  promotion_selector_baemin text not null default '',
  promotion_rule_id_coupang text not null default '',
  promotion_rule_id_baemin text not null default '',
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.riders add column if not exists name text not null default '';
alter table public.riders add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;
alter table public.riders add column if not exists phone text not null default '';
alter table public.riders add column if not exists resident_number text not null default '';
alter table public.riders drop column if exists password;
alter table public.riders add column if not exists bank_name text not null default '';
alter table public.riders add column if not exists account_holder text not null default '';
alter table public.riders add column if not exists account_number text not null default '';
alter table public.riders add column if not exists baemin_id text not null default '';
alter table public.riders add column if not exists platform_coupang boolean not null default true;
alter table public.riders add column if not exists platform_baemin boolean not null default false;
alter table public.riders add column if not exists long_event_item_id text not null default '';
alter table public.riders add column if not exists long_event_item text not null default '';
alter table public.riders add column if not exists long_event_start_date date;
alter table public.riders add column if not exists join_date date;
alter table public.riders add column if not exists status text not null default '근무중';
alter table public.riders add column if not exists memo text not null default '';
alter table public.riders add column if not exists hidden_fields jsonb not null default '{}'::jsonb;
alter table public.riders add column if not exists promotion_selector_coupang text not null default '';
alter table public.riders add column if not exists promotion_selector_baemin text not null default '';
alter table public.riders add column if not exists promotion_rule_id_coupang text not null default '';
alter table public.riders add column if not exists promotion_rule_id_baemin text not null default '';
alter table public.riders add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.riders add column if not exists created_at timestamptz not null default now();
alter table public.riders add column if not exists updated_at timestamptz not null default now();

-- 기존 예전 schema에서 riders.id가 uuid였던 경우 앱의 문자열 ID와 맞도록 text로 보정합니다.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'riders'
      and column_name = 'id'
      and data_type = 'uuid'
  ) then
    alter table public.riders alter column id type text using id::text;
  end if;
end $$;

create index if not exists idx_brem_riders_name on public.riders (name);
create index if not exists idx_brem_riders_phone on public.riders (phone);
create index if not exists idx_brem_riders_status on public.riders (status);
create index if not exists idx_brem_riders_baemin_id on public.riders (baemin_id);

-- ---------------------------------------------------------------------------
-- notices: 공지사항
-- localStorage key: brem_admin_notices
-- ---------------------------------------------------------------------------
create table if not exists public.notices (
  id text primary key,
  title text not null default '',
  content text not null default '',
  pinned boolean not null default false,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notices add column if not exists title text not null default '';
alter table public.notices add column if not exists content text not null default '';
alter table public.notices add column if not exists pinned boolean not null default false;
alter table public.notices add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.notices add column if not exists created_at timestamptz not null default now();
alter table public.notices add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notices'
      and column_name = 'id'
      and data_type = 'uuid'
  ) then
    alter table public.notices alter column id type text using id::text;
  end if;
end $$;

create index if not exists idx_brem_notices_pinned_created
  on public.notices (pinned desc, created_at desc);

-- ---------------------------------------------------------------------------
-- promotions: 프로모션
-- localStorage key: brem_admin_promotion_rules
-- 전체 조건 구조는 payload jsonb에 원본 그대로 보존합니다.
-- ---------------------------------------------------------------------------
create table if not exists public.promotions (
  id text primary key,
  name text not null default '',
  platform text not null default 'coupang',
  type text not null default '',
  enabled boolean not null default true,
  selector_key text not null default '',
  start_date date,
  end_date date,
  priority integer not null default 100,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.promotions add column if not exists name text not null default '';
alter table public.promotions add column if not exists platform text not null default 'coupang';
alter table public.promotions add column if not exists type text not null default '';
alter table public.promotions add column if not exists enabled boolean not null default true;
alter table public.promotions add column if not exists selector_key text not null default '';
alter table public.promotions add column if not exists start_date date;
alter table public.promotions add column if not exists end_date date;
alter table public.promotions add column if not exists priority integer not null default 100;
alter table public.promotions add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.promotions add column if not exists created_at timestamptz not null default now();
alter table public.promotions add column if not exists updated_at timestamptz not null default now();

-- 이전 버전 보조 테이블이 promotions(id)를 uuid FK로 참조하면 id 타입 보정이 실패할 수 있어
-- 해당 FK 제약만 먼저 제거합니다. 데이터 삭제는 하지 않습니다.
do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select
      con.conname as constraint_name,
      rel_ns.nspname as table_schema,
      rel.relname as table_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace rel_ns on rel_ns.oid = rel.relnamespace
    join pg_class ref on ref.oid = con.confrelid
    join pg_namespace ref_ns on ref_ns.oid = ref.relnamespace
    where con.contype = 'f'
      and ref_ns.nspname = 'public'
      and ref.relname = 'promotions'
  loop
    execute format(
      'alter table %I.%I drop constraint if exists %I',
      constraint_record.table_schema,
      constraint_record.table_name,
      constraint_record.constraint_name
    );
  end loop;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'promotions'
      and column_name = 'id'
      and data_type = 'uuid'
  ) then
    alter table public.promotions alter column id type text using id::text;
  end if;
end $$;

create index if not exists idx_brem_promotions_platform on public.promotions (platform);
create index if not exists idx_brem_promotions_enabled on public.promotions (enabled);
create index if not exists idx_brem_promotions_dates on public.promotions (start_date, end_date);

-- ---------------------------------------------------------------------------
-- settings: 관리자 설정 + 나머지 localStorage 백업 데이터
-- 예: 관리자 계정, 콜수, 리스, 수익관리, 프로모션 공통설정 등
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  description text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.settings add column if not exists value jsonb not null default 'null'::jsonb;
alter table public.settings add column if not exists description text not null default '';
alter table public.settings add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_brem_settings_updated on public.settings (updated_at desc);

-- ---------------------------------------------------------------------------
-- rider_inquiries: 홈페이지 라이더/제휴 문의
-- localStorage key: brem_rider_inquiries
-- 공개 포털(anon)은 insert만, admin은 전체 관리
-- ---------------------------------------------------------------------------
create table if not exists public.rider_inquiries (
  id text primary key,
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

alter table public.rider_inquiries add column if not exists name text not null default '';
alter table public.rider_inquiries add column if not exists phone text not null default '';
alter table public.rider_inquiries add column if not exists area text not null default '';
alter table public.rider_inquiries add column if not exists inquiry_type text not null default '라이더 지원';
alter table public.rider_inquiries add column if not exists message text not null default '';
alter table public.rider_inquiries add column if not exists status text not null default 'new';
alter table public.rider_inquiries add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.rider_inquiries add column if not exists created_at timestamptz not null default now();
alter table public.rider_inquiries add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rider_inquiries'
      and column_name = 'id'
      and data_type = 'uuid'
  ) then
    alter table public.rider_inquiries alter column id type text using id::text;
  end if;
end $$;

create index if not exists idx_brem_rider_inquiries_status_created
  on public.rider_inquiries (status, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at 자동 갱신
-- ---------------------------------------------------------------------------
create or replace function public.brem_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_brem_profiles_updated_at on public.profiles;
create trigger trg_brem_profiles_updated_at
before update on public.profiles
for each row execute function public.brem_set_updated_at();

drop trigger if exists trg_brem_riders_updated_at on public.riders;
create trigger trg_brem_riders_updated_at
before update on public.riders
for each row execute function public.brem_set_updated_at();

drop trigger if exists trg_brem_notices_updated_at on public.notices;
create trigger trg_brem_notices_updated_at
before update on public.notices
for each row execute function public.brem_set_updated_at();

drop trigger if exists trg_brem_promotions_updated_at on public.promotions;
create trigger trg_brem_promotions_updated_at
before update on public.promotions
for each row execute function public.brem_set_updated_at();

drop trigger if exists trg_brem_settings_updated_at on public.settings;
create trigger trg_brem_settings_updated_at
before update on public.settings
for each row execute function public.brem_set_updated_at();

drop trigger if exists trg_brem_rider_inquiries_updated_at on public.rider_inquiries;
create trigger trg_brem_rider_inquiries_updated_at
before update on public.rider_inquiries
for each row execute function public.brem_set_updated_at();

-- ---------------------------------------------------------------------------
-- PRODUCTION RLS
-- anon CRUD 불가. authenticated 사용자 중 profiles.role 기준으로 허용.
-- 각 create policy 직전에 drop policy if exists 로 재실행 안전.
-- ---------------------------------------------------------------------------
do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname ~ '^brem_'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.riders enable row level security;
alter table public.notices enable row level security;
alter table public.promotions enable row level security;
alter table public.settings enable row level security;
alter table public.rider_inquiries enable row level security;

drop policy if exists "brem_profiles_select_self_or_admin" on public.profiles;
create policy "brem_profiles_select_self_or_admin"
on public.profiles for select to authenticated
using (user_id = auth.uid() or public.brem_is_admin());

drop policy if exists "brem_profiles_admin_all" on public.profiles;
create policy "brem_profiles_admin_all"
on public.profiles for all to authenticated
using (public.brem_is_admin())
with check (public.brem_is_admin());

drop policy if exists "brem_riders_select_admin_or_self" on public.riders;
create policy "brem_riders_select_admin_or_self"
on public.riders for select to authenticated
using (
  public.brem_is_admin()
  or auth_user_id = auth.uid()
  or id = public.brem_current_rider_id()
);

drop policy if exists "brem_riders_admin_insert" on public.riders;
create policy "brem_riders_admin_insert"
on public.riders for insert to authenticated
with check (public.brem_is_admin());

drop policy if exists "brem_riders_admin_update" on public.riders;
create policy "brem_riders_admin_update"
on public.riders for update to authenticated
using (public.brem_is_admin())
with check (public.brem_is_admin());

drop policy if exists "brem_riders_admin_delete" on public.riders;
create policy "brem_riders_admin_delete"
on public.riders for delete to authenticated
using (public.brem_is_admin());

drop policy if exists "brem_notices_admin_all" on public.notices;
create policy "brem_notices_admin_all"
on public.notices for all to authenticated
using (public.brem_is_admin())
with check (public.brem_is_admin());

drop policy if exists "brem_promotions_admin_all" on public.promotions;
create policy "brem_promotions_admin_all"
on public.promotions for all to authenticated
using (public.brem_is_admin())
with check (public.brem_is_admin());

drop policy if exists "brem_settings_admin_all" on public.settings;
create policy "brem_settings_admin_all"
on public.settings for all to authenticated
using (public.brem_is_admin())
with check (public.brem_is_admin());

drop policy if exists "brem_rider_inquiries_anon_insert" on public.rider_inquiries;
create policy "brem_rider_inquiries_anon_insert"
on public.rider_inquiries for insert to anon, authenticated
with check (true);

drop policy if exists "brem_rider_inquiries_admin_all" on public.rider_inquiries;
create policy "brem_rider_inquiries_admin_all"
on public.rider_inquiries for all to authenticated
using (public.brem_is_admin())
with check (public.brem_is_admin());

-- PostgREST/Supabase REST 스키마 캐시 새로고침
notify pgrst, 'reload schema';
