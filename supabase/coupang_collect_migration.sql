-- BREM 쿠팡이츠 수집 테이블 (partner.coupangeats.com)
-- 배민 스키마(baemin_biz_collect_*)를 미러. 서버 service role 전용, deny-all RLS.
-- 추가 전용: 기존 테이블 변경 없음.

-- 수집 실행 로그
create table if not exists public.coupang_collect_runs (
  id uuid primary key default gen_random_uuid(),
  collect_date date not null,
  source_menu text not null,
  status text not null default 'ok',
  item_count integer not null default 0,
  message text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_coupang_collect_runs_date
  on public.coupang_collect_runs (collect_date desc, source_menu);

-- 수집 아이템 (원본/파싱)
-- source_menu:
--   peak_realtime    : 오늘 피크타임별 현황 (매장별)
--   weekly_performance: 주간 요일x타임존 달성/거절 (매장별, week_start 기준)
--   vendor_info      : 지역(매장)별 요약 (운행중 인원/목표/완료/거절률)
--   rider_daily      : 라이더별 일 실적 (전체 매장 통합, courierId 기준)
create table if not exists public.coupang_collect_items (
  id uuid primary key default gen_random_uuid(),
  collect_date date not null,             -- 기준일(영업일). weekly는 week_start.
  collected_at timestamptz not null default now(),
  source_menu text not null,
  vendor_id text not null default '',     -- 쿠팡 매장 id (숫자 문자열)
  vendor_name text not null default '',
  courier_id text not null default '',    -- 라이더(쿠팡 courierId)
  rider_name text not null default '',
  phone_number text not null default '',
  match_key text not null default '',     -- ERP 매칭용: 이름+전화뒤4자리 (예: 고성재5595)
  dedupe_key text not null default '',
  parsed_json jsonb not null default '{}'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupang_collect_items_dedupe unique (collect_date, source_menu, dedupe_key)
);

create index if not exists idx_coupang_collect_items_menu
  on public.coupang_collect_items (collect_date, source_menu);
create index if not exists idx_coupang_collect_items_vendor
  on public.coupang_collect_items (source_menu, vendor_id, collect_date);
create index if not exists idx_coupang_collect_items_courier
  on public.coupang_collect_items (courier_id);
create index if not exists idx_coupang_collect_items_match
  on public.coupang_collect_items (match_key);

-- RLS: 서버 service role 전용 (클라이언트 직접 접근 차단)
alter table public.coupang_collect_runs enable row level security;
alter table public.coupang_collect_items enable row level security;

drop policy if exists brem_service_coupang_collect_runs on public.coupang_collect_runs;
create policy brem_service_coupang_collect_runs on public.coupang_collect_runs
  for all using (false) with check (false);

drop policy if exists brem_service_coupang_collect_items on public.coupang_collect_items;
create policy brem_service_coupang_collect_items on public.coupang_collect_items
  for all using (false) with check (false);

comment on table public.coupang_collect_items is
  '쿠팡이츠 파트너포털 수집 데이터. 서버 service role만 접근.';

notify pgrst, 'reload schema';
