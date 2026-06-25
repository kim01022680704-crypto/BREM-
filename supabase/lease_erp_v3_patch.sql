-- BREM 리스 ERP v3 — v2 컬럼 · 계약 확장 · 미납(lease_arrears) · 손익 스냅샷
-- SQL Editor에서 1회 실행 (lease_erp_migration.sql 실행 후)

-- v2: 미납일 · 취득세 · 회사소유리스 계산 필드 (없으면 차량 저장 오류)
alter table public.lease_vehicles add column if not exists unpaid_days integer not null default 0;
alter table public.lease_vehicles add column if not exists payment_check text not null default '';
alter table public.lease_vehicles add column if not exists unpaid_collection_method text not null default '';
alter table public.lease_vehicles add column if not exists acquisition_tax_rate numeric not null default 0;
alter table public.lease_vehicles add column if not exists acquisition_tax_amount numeric not null default 0;
alter table public.lease_vehicles add column if not exists other_acquisition_cost numeric not null default 0;
alter table public.lease_vehicles add column if not exists total_acquisition_cost numeric not null default 0;

create table if not exists public.lease_arrears (  id text primary key,
  vehicle_id text references public.lease_vehicles(id) on delete set null,
  contract_id text,
  unpaid_days integer not null default 0,
  unpaid_amount numeric not null default 0,
  paid_amount numeric not null default 0,
  recovered_amount numeric not null default 0,
  collection_methods jsonb not null default '[]'::jsonb,
  collection_status text not null default 'unpaid',
  processed_date date,
  memo text not null default '',
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lease_arrears add column if not exists vehicle_id text;
alter table public.lease_arrears add column if not exists contract_id text;
alter table public.lease_arrears add column if not exists unpaid_days integer not null default 0;
alter table public.lease_arrears add column if not exists unpaid_amount numeric not null default 0;
alter table public.lease_arrears add column if not exists paid_amount numeric not null default 0;
alter table public.lease_arrears add column if not exists recovered_amount numeric not null default 0;
alter table public.lease_arrears add column if not exists collection_methods jsonb not null default '[]'::jsonb;
alter table public.lease_arrears add column if not exists collection_status text not null default 'unpaid';
alter table public.lease_arrears add column if not exists processed_date date;
alter table public.lease_arrears add column if not exists memo text not null default '';
alter table public.lease_arrears add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.lease_arrears add column if not exists created_at timestamptz not null default now();
alter table public.lease_arrears add column if not exists updated_at timestamptz not null default now();

create index if not exists lease_arrears_vehicle_id_idx on public.lease_arrears (vehicle_id);
create index if not exists lease_arrears_status_idx on public.lease_arrears (collection_status);

-- lease_contracts: vehicle_id FK는 유지, 상세는 raw_data에 저장
alter table public.lease_contracts alter column vehicle_id drop not null;

drop trigger if exists lease_arrears_set_updated_at on public.lease_arrears;
create trigger lease_arrears_set_updated_at before update on public.lease_arrears
  for each row execute function public.brem_set_updated_at();

alter table public.lease_arrears enable row level security;
drop policy if exists "lease_arrears admin all" on public.lease_arrears;
create policy "lease_arrears admin all" on public.lease_arrears
  for all using (public.brem_is_admin()) with check (public.brem_is_admin());

notify pgrst, 'reload schema';
