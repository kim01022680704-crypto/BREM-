-- BREM ERP Supabase Schema
-- Supabase SQL Editor에서 실행하세요.
--
-- 저장 구조:
--   riders      : 기사 데이터
--   notices     : 공지사항
--   promotions  : 프로모션 설정/조건
--   settings    : 관리자 설정 및 기타 localStorage 백업 데이터

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- riders: 기사 데이터
-- localStorage key: brem_driver_management_drivers
-- ---------------------------------------------------------------------------
create table if not exists public.riders (
  id text primary key,
  name text not null default '',
  phone text not null default '',
  resident_number text not null default '',
  password text not null default '1234',
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

create index if not exists idx_brem_settings_updated on public.settings (updated_at desc);

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

-- ---------------------------------------------------------------------------
-- RLS
-- 현재 앱은 anon key 기반 클라이언트에서 직접 읽기/쓰기를 합니다.
-- 운영 전에는 Supabase Auth 기반 정책으로 좁히는 것을 권장합니다.
-- ---------------------------------------------------------------------------
alter table public.riders enable row level security;
alter table public.notices enable row level security;
alter table public.promotions enable row level security;
alter table public.settings enable row level security;

drop policy if exists "brem_riders_all" on public.riders;
create policy "brem_riders_all" on public.riders for all using (true) with check (true);

drop policy if exists "brem_notices_all" on public.notices;
create policy "brem_notices_all" on public.notices for all using (true) with check (true);

drop policy if exists "brem_promotions_all" on public.promotions;
create policy "brem_promotions_all" on public.promotions for all using (true) with check (true);

drop policy if exists "brem_settings_all" on public.settings;
create policy "brem_settings_all" on public.settings for all using (true) with check (true);
