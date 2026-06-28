-- =============================================================================
-- BREM baemin_biz_collect_* 테이블 (배민Biz 통합 자동 수집)
-- Supabase SQL Editor에서 1회 실행
-- 기존 baemin_delivery_status / 기사 / 정산 데이터는 변경하지 않습니다.
-- =============================================================================

create or replace function public.brem_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

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
