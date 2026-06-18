-- BREM Supabase Schema
-- localStorage → Supabase 이전용
-- PostgreSQL / Supabase SQL Editor에서 실행

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 6. regions (지역 목록)
-- weekly_settlements / settlements 등에서 추출·등록
-- ---------------------------------------------------------------------------
create table if not exists public.regions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  platform text not null default 'all'
    check (platform in ('coupang', 'baemin', 'combined', 'all')),
  slug text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, platform)
);

create index if not exists idx_regions_name on public.regions (name);

-- ---------------------------------------------------------------------------
-- 1. riders (기사 정보) — localStorage: brem_driver_management_drivers
-- ---------------------------------------------------------------------------
create table if not exists public.riders (
  id uuid primary key,
  name text not null,
  phone text not null,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_riders_name on public.riders (name);
create index if not exists idx_riders_phone on public.riders (phone);
create index if not exists idx_riders_baemin_id on public.riders (baemin_id);

-- ---------------------------------------------------------------------------
-- 9. users (관리자 / 기사 로그인)
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('admin', 'rider')),
  rider_id uuid references public.riders(id) on delete cascade,
  login_id text not null,
  password_hash text not null,
  display_name text not null default '',
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (login_id)
);

create index if not exists idx_users_rider_id on public.users (rider_id);
create index if not exists idx_users_role on public.users (role);

-- ---------------------------------------------------------------------------
-- 2. promotions (프로모션 조건 헤더)
-- localStorage: brem_admin_promotion_rules (헤더 + base JSON)
-- ---------------------------------------------------------------------------
create table if not exists public.promotions (
  id uuid primary key,
  name text not null,
  type text not null default 'count_per_order',
  platform text not null default 'coupang'
    check (platform in ('coupang', 'baemin', 'combined')),
  enabled boolean not null default true,
  selector_key text not null default '',
  start_date date,
  end_date date,
  base jsonb not null default '{}'::jsonb,
  priority integer not null default 100,
  allow_duplicate boolean not null default false,
  duplicate_strategy text not null default 'highest_priority',
  apply_global_accept_block boolean not null default true,
  no_pay_conditions text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_promotions_platform on public.promotions (platform);
create index if not exists idx_promotions_enabled on public.promotions (enabled);
create index if not exists idx_promotions_dates on public.promotions (start_date, end_date);

-- ---------------------------------------------------------------------------
-- 3. promotion_rules (프로모션 세부 조건)
-- blockConditions / bonusConditions / referenceConditions 분리 저장
-- ---------------------------------------------------------------------------
create table if not exists public.promotion_rules (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  kind text not null check (kind in ('block', 'bonus', 'reference')),
  condition_name text not null default '',
  condition_type text not null default '',
  processing_mode text not null default '',
  payload jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_promotion_rules_promotion_id on public.promotion_rules (promotion_id);
create index if not exists idx_promotion_rules_kind on public.promotion_rules (kind);

-- ---------------------------------------------------------------------------
-- 4. weekly_settlements (주간정산 헤더)
-- localStorage: brem_admin_weekly_settlements (riders 배열 제외)
-- ---------------------------------------------------------------------------
create table if not exists public.weekly_settlements (
  id uuid primary key,
  platform text not null default 'coupang'
    check (platform in ('coupang', 'baemin', 'combined')),
  region_id uuid references public.regions(id) on delete set null,
  region_name text not null default '',
  file_name text not null default '',
  base_settlement_date date,
  start_date date,
  end_date date,
  payment_date date,
  settlement_week_label text not null default '',
  matched_names_label text not null default '',
  summary jsonb not null default '{}'::jsonb,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_weekly_settlements_platform on public.weekly_settlements (platform);
create index if not exists idx_weekly_settlements_region on public.weekly_settlements (region_name);
create index if not exists idx_weekly_settlements_dates on public.weekly_settlements (start_date, end_date);

-- ---------------------------------------------------------------------------
-- 5. weekly_settlement_riders (주간정산 기사별 결과)
-- ---------------------------------------------------------------------------
create table if not exists public.weekly_settlement_riders (
  id uuid primary key default gen_random_uuid(),
  weekly_settlement_id uuid not null references public.weekly_settlements(id) on delete cascade,
  rider_id uuid references public.riders(id) on delete set null,
  original_name text not null default '',
  rider_name text not null default '',
  driver_name text not null default '',
  matched boolean not null default false,
  weekly_order_count integer not null default 0,
  system_call_count integer not null default 0,
  call_count_matched boolean not null default true,
  coupang_login_key text not null default '',
  baemin_user_id text not null default '',
  warnings jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_weekly_settlement_riders_settlement
  on public.weekly_settlement_riders (weekly_settlement_id);
create index if not exists idx_weekly_settlement_riders_rider
  on public.weekly_settlement_riders (rider_id);

-- ---------------------------------------------------------------------------
-- 7. rider_name_mappings (수동 매칭)
-- localStorage: brem_admin_manual_name_mappings
-- ---------------------------------------------------------------------------
create table if not exists public.rider_name_mappings (
  id uuid primary key,
  platform text not null default 'coupang'
    check (platform in ('coupang', 'baemin', 'combined')),
  original_name text not null,
  rider_id uuid references public.riders(id) on delete set null,
  driver_name text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (platform, original_name)
);

create index if not exists idx_rider_name_mappings_rider on public.rider_name_mappings (rider_id);

-- ---------------------------------------------------------------------------
-- 8. notices (공지사항)
-- localStorage: brem_admin_notices
-- ---------------------------------------------------------------------------
create table if not exists public.notices (
  id uuid primary key,
  title text not null,
  content text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_notices_pinned on public.notices (pinned desc, created_at desc);

-- ---------------------------------------------------------------------------
-- 보조: localStorage 나머지 키 보존 (콜수, 목표, 프로모션 설정 등)
-- 마이그레이션 시 데이터 유실 방지
-- ---------------------------------------------------------------------------
create table if not exists public.system_kv_store (
  storage_key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at 자동 갱신
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  foreach t in array array[
    'regions', 'users', 'riders', 'promotions', 'promotion_rules',
    'weekly_settlements', 'weekly_settlement_riders',
    'rider_name_mappings', 'notices'
  ]
  loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    execute format(
      'create trigger trg_%I_updated_at before update on public.%I
       for each row execute function public.set_updated_at()',
      t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS (초기: 서비스 롤 / anon 정책은 프로젝트 설정 후 활성화 권장)
-- ---------------------------------------------------------------------------
alter table public.regions enable row level security;
alter table public.users enable row level security;
alter table public.riders enable row level security;
alter table public.promotions enable row level security;
alter table public.promotion_rules enable row level security;
alter table public.weekly_settlements enable row level security;
alter table public.weekly_settlement_riders enable row level security;
alter table public.rider_name_mappings enable row level security;
alter table public.notices enable row level security;
alter table public.system_kv_store enable row level security;

-- 개발 초기: authenticated 전체 접근 (운영 시 세분화 필요)
create policy "brem_auth_all_regions" on public.regions for all using (true) with check (true);
create policy "brem_auth_all_users" on public.users for all using (true) with check (true);
create policy "brem_auth_all_riders" on public.riders for all using (true) with check (true);
create policy "brem_auth_all_promotions" on public.promotions for all using (true) with check (true);
create policy "brem_auth_all_promotion_rules" on public.promotion_rules for all using (true) with check (true);
create policy "brem_auth_all_weekly_settlements" on public.weekly_settlements for all using (true) with check (true);
create policy "brem_auth_all_weekly_settlement_riders" on public.weekly_settlement_riders for all using (true) with check (true);
create policy "brem_auth_all_rider_name_mappings" on public.rider_name_mappings for all using (true) with check (true);
create policy "brem_auth_all_notices" on public.notices for all using (true) with check (true);
create policy "brem_auth_all_system_kv_store" on public.system_kv_store for all using (true) with check (true);
