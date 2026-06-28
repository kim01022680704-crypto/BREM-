-- =============================================================================
-- BREM 배민Biz 수집 테이블 — Supabase SQL Editor에 전체 복사 후 Run
-- (파일 경로 supabase/... 를 입력하면 안 됩니다. 이 파일 내용 전체를 붙여넣으세요)
-- 기존 기사 / 정산 / 운영 데이터는 변경하지 않습니다.
-- =============================================================================

-- ── 1) 공통 updated_at 트리거 ──────────────────────────────────────────────
create or replace function public.brem_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ── 2) baemin_delivery_status (배달현황 레거시) ─────────────────────────────
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
  for all using (false) with check (false);

comment on table public.baemin_delivery_status is
  '배민Biz delivery-status API 수집 데이터. 서버 service role만 접근.';

-- ── 3) baemin_biz_collect_runs (메뉴별 수집 로그) ───────────────────────────
create table if not exists public.baemin_biz_collect_runs (
  id uuid primary key default gen_random_uuid(),
  collect_date date not null,
  collected_at timestamptz not null default now(),
  source_menu text not null,
  source_url text not null default '',
  status text not null default 'failed',
  error_message text not null default '',
  row_count integer not null default 0,
  meta_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_baemin_biz_collect_runs_date_menu
  on public.baemin_biz_collect_runs (collect_date desc, source_menu);

create index if not exists idx_baemin_biz_collect_runs_collected_at
  on public.baemin_biz_collect_runs (collected_at desc);

-- ── 4) baemin_biz_collect_items (통합 수집 데이터) ──────────────────────────
create table if not exists public.baemin_biz_collect_items (
  id uuid primary key default gen_random_uuid(),
  collect_date date not null,
  collected_at timestamptz not null default now(),
  source_menu text not null,
  source_url text not null default '',
  dedupe_key text not null default '',
  rider_name text not null default '',
  rider_user_id text not null default '',
  phone_number text not null default '',
  parsed_json jsonb not null default '{}'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint baemin_biz_collect_items_dedupe unique (collect_date, source_menu, dedupe_key)
);

create index if not exists idx_baemin_biz_collect_items_date_menu
  on public.baemin_biz_collect_items (collect_date desc, source_menu);

create index if not exists idx_baemin_biz_collect_items_rider
  on public.baemin_biz_collect_items (rider_user_id);

drop trigger if exists trg_baemin_biz_collect_items_updated_at on public.baemin_biz_collect_items;
create trigger trg_baemin_biz_collect_items_updated_at
before update on public.baemin_biz_collect_items
for each row execute function public.brem_set_updated_at();

alter table public.baemin_biz_collect_runs enable row level security;
alter table public.baemin_biz_collect_items enable row level security;

drop policy if exists brem_service_baemin_biz_collect_runs on public.baemin_biz_collect_runs;
create policy brem_service_baemin_biz_collect_runs on public.baemin_biz_collect_runs
  for all using (false) with check (false);

drop policy if exists brem_service_baemin_biz_collect_items on public.baemin_biz_collect_items;
create policy brem_service_baemin_biz_collect_items on public.baemin_biz_collect_items
  for all using (false) with check (false);

comment on table public.baemin_biz_collect_runs is
  '배민Biz 메뉴별 수집 실행 로그. 서버 service role만 접근.';

comment on table public.baemin_biz_collect_items is
  '배민Biz API 수집 원본/파싱 데이터. 서버 service role만 접근.';

-- ── 5) baemin_raw_api_logs (API 원본 JSON — 실행마다 append) ───────────────
create table if not exists public.baemin_raw_api_logs (
  id bigserial primary key,
  collect_date date not null,
  collected_at timestamptz not null default now(),
  source_menu text not null default '',
  source_url text not null default '',
  http_status integer not null default 0,
  run_id uuid,
  page_index integer,
  raw_json jsonb not null default '{}'::jsonb
);

create index if not exists idx_baemin_raw_api_logs_date_menu
  on public.baemin_raw_api_logs (collect_date desc, source_menu);

create index if not exists idx_baemin_raw_api_logs_run_id
  on public.baemin_raw_api_logs (run_id);

create index if not exists idx_baemin_raw_api_logs_collected_at
  on public.baemin_raw_api_logs (collected_at desc);

alter table public.baemin_raw_api_logs enable row level security;

drop policy if exists brem_service_baemin_raw_api_logs on public.baemin_raw_api_logs;
create policy brem_service_baemin_raw_api_logs on public.baemin_raw_api_logs
  for all using (false) with check (false);

comment on table public.baemin_raw_api_logs is
  '배민Biz API 원본 JSON 로그. 매 수집 실행마다 append. 서버 service role만 접근.';
