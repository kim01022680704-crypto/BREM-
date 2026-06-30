-- BREM baemin_delivery_applied_* (배민현황 ERP 적용 스냅샷)
-- 적용하기 클릭 시 baemin_biz_collect_items → 스냅샷 복사

create table if not exists public.baemin_delivery_applied_batches (
  id uuid primary key default gen_random_uuid(),
  collect_date date not null,
  applied_at timestamptz not null default now(),
  applied_by text not null default '',
  item_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_baemin_delivery_applied_batches_applied_at
  on public.baemin_delivery_applied_batches (applied_at desc);

create table if not exists public.baemin_delivery_applied_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.baemin_delivery_applied_batches (id) on delete cascade,
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
  constraint baemin_delivery_applied_items_dedupe unique (batch_id, source_menu, dedupe_key)
);

create index if not exists idx_baemin_delivery_applied_items_batch_menu
  on public.baemin_delivery_applied_items (batch_id, source_menu);

create index if not exists idx_baemin_delivery_applied_items_rider
  on public.baemin_delivery_applied_items (rider_user_id);

alter table public.baemin_delivery_applied_batches enable row level security;
alter table public.baemin_delivery_applied_items enable row level security;

drop policy if exists brem_service_baemin_delivery_applied_batches on public.baemin_delivery_applied_batches;
create policy brem_service_baemin_delivery_applied_batches on public.baemin_delivery_applied_batches
  for all using (false) with check (false);

drop policy if exists brem_service_baemin_delivery_applied_items on public.baemin_delivery_applied_items;
create policy brem_service_baemin_delivery_applied_items on public.baemin_delivery_applied_items
  for all using (false) with check (false);

comment on table public.baemin_delivery_applied_batches is
  '배민현황 ERP 적용 배치(스냅샷 시각). 서버 service role만 접근.';

comment on table public.baemin_delivery_applied_items is
  '배민현황 ERP 적용 스냅샷 데이터. 서버 service role만 접근.';
