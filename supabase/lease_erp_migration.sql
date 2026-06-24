-- =============================================================================
-- BREM 리스/렌탈 ERP 테이블 (settings JSON brem_admin_leases 대비 전용 테이블)
-- 기존 settings 데이터는 삭제하지 않음 — 클라이언트 1회 이관 지원
-- SQL Editor에서 1회 실행
-- =============================================================================

create or replace function public.brem_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- lease_vehicles: 차량 마스터
-- ---------------------------------------------------------------------------
create table if not exists public.lease_vehicles (
  id text primary key,
  vehicle_category text not null default 'external_lease',
  operation_type text not null default 'lease',
  model text not null default '',
  chassis_number text not null default '',
  vehicle_number text not null default '',
  lease_company text not null default '',
  daily_lease_cost numeric not null default 0,
  insurance_company text not null default '',
  insurance_age text not null default '',
  insurance_type text not null default '',
  daily_insurance_cost numeric not null default 0,
  contract_start_date date,
  contract_end_date date,
  return_date date,
  renter text not null default '',
  lessor text not null default '',
  daily_charge_amount numeric not null default 0,
  unpaid_amount numeric not null default 0,
  balance_diff numeric not null default 0,
  memo text not null default '',
  vehicle_status text not null default 'operating',
  empty_start_date date,
  expected_daily_rent numeric not null default 0,
  daily_other_cost numeric not null default 0,
  purchase_price numeric not null default 0,
  acquisition_date date,
  rental_assignment jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lease_vehicles add column if not exists vehicle_category text not null default 'external_lease';
alter table public.lease_vehicles add column if not exists operation_type text not null default 'lease';
alter table public.lease_vehicles add column if not exists model text not null default '';
alter table public.lease_vehicles add column if not exists chassis_number text not null default '';
alter table public.lease_vehicles add column if not exists vehicle_number text not null default '';
alter table public.lease_vehicles add column if not exists lease_company text not null default '';
alter table public.lease_vehicles add column if not exists daily_lease_cost numeric not null default 0;
alter table public.lease_vehicles add column if not exists insurance_company text not null default '';
alter table public.lease_vehicles add column if not exists insurance_age text not null default '';
alter table public.lease_vehicles add column if not exists insurance_type text not null default '';
alter table public.lease_vehicles add column if not exists daily_insurance_cost numeric not null default 0;
alter table public.lease_vehicles add column if not exists contract_start_date date;
alter table public.lease_vehicles add column if not exists contract_end_date date;
alter table public.lease_vehicles add column if not exists return_date date;
alter table public.lease_vehicles add column if not exists renter text not null default '';
alter table public.lease_vehicles add column if not exists lessor text not null default '';
alter table public.lease_vehicles add column if not exists daily_charge_amount numeric not null default 0;
alter table public.lease_vehicles add column if not exists unpaid_amount numeric not null default 0;
alter table public.lease_vehicles add column if not exists balance_diff numeric not null default 0;
alter table public.lease_vehicles add column if not exists memo text not null default '';
alter table public.lease_vehicles add column if not exists vehicle_status text not null default 'operating';
alter table public.lease_vehicles add column if not exists empty_start_date date;
alter table public.lease_vehicles add column if not exists expected_daily_rent numeric not null default 0;
alter table public.lease_vehicles add column if not exists daily_other_cost numeric not null default 0;
alter table public.lease_vehicles add column if not exists purchase_price numeric not null default 0;
alter table public.lease_vehicles add column if not exists acquisition_date date;
alter table public.lease_vehicles add column if not exists rental_assignment jsonb;
alter table public.lease_vehicles add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.lease_vehicles add column if not exists created_at timestamptz not null default now();
alter table public.lease_vehicles add column if not exists updated_at timestamptz not null default now();

create index if not exists lease_vehicles_vehicle_number_idx on public.lease_vehicles (vehicle_number);
create index if not exists lease_vehicles_status_idx on public.lease_vehicles (vehicle_status);
create index if not exists lease_vehicles_category_idx on public.lease_vehicles (vehicle_category);
create index if not exists lease_vehicles_lease_company_idx on public.lease_vehicles (lease_company);
create index if not exists lease_vehicles_contract_end_idx on public.lease_vehicles (contract_end_date);

-- ---------------------------------------------------------------------------
-- lease_contracts: 계약 이력
-- ---------------------------------------------------------------------------
create table if not exists public.lease_contracts (
  id text primary key,
  vehicle_id text not null references public.lease_vehicles(id) on delete cascade,
  contract_type text not null default 'lease',
  start_date date,
  end_date date,
  daily_charge numeric not null default 0,
  daily_cost numeric not null default 0,
  status text not null default 'active',
  memo text not null default '',
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lease_contracts add column if not exists vehicle_id text;
alter table public.lease_contracts add column if not exists contract_type text not null default 'lease';
alter table public.lease_contracts add column if not exists start_date date;
alter table public.lease_contracts add column if not exists end_date date;
alter table public.lease_contracts add column if not exists daily_charge numeric not null default 0;
alter table public.lease_contracts add column if not exists daily_cost numeric not null default 0;
alter table public.lease_contracts add column if not exists status text not null default 'active';
alter table public.lease_contracts add column if not exists memo text not null default '';
alter table public.lease_contracts add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.lease_contracts add column if not exists created_at timestamptz not null default now();
alter table public.lease_contracts add column if not exists updated_at timestamptz not null default now();

create index if not exists lease_contracts_vehicle_id_idx on public.lease_contracts (vehicle_id);

-- ---------------------------------------------------------------------------
-- lease_payments: 납부/미납
-- ---------------------------------------------------------------------------
create table if not exists public.lease_payments (
  id text primary key,
  vehicle_id text not null references public.lease_vehicles(id) on delete cascade,
  due_date date,
  paid_date date,
  charge_amount numeric not null default 0,
  paid_amount numeric not null default 0,
  unpaid_amount numeric not null default 0,
  overdue_days integer not null default 0,
  payment_status text not null default 'normal',
  memo text not null default '',
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lease_payments add column if not exists vehicle_id text;
alter table public.lease_payments add column if not exists due_date date;
alter table public.lease_payments add column if not exists paid_date date;
alter table public.lease_payments add column if not exists charge_amount numeric not null default 0;
alter table public.lease_payments add column if not exists paid_amount numeric not null default 0;
alter table public.lease_payments add column if not exists unpaid_amount numeric not null default 0;
alter table public.lease_payments add column if not exists overdue_days integer not null default 0;
alter table public.lease_payments add column if not exists payment_status text not null default 'normal';
alter table public.lease_payments add column if not exists memo text not null default '';
alter table public.lease_payments add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.lease_payments add column if not exists created_at timestamptz not null default now();
alter table public.lease_payments add column if not exists updated_at timestamptz not null default now();

create index if not exists lease_payments_vehicle_id_idx on public.lease_payments (vehicle_id);
create index if not exists lease_payments_due_date_idx on public.lease_payments (due_date);
create index if not exists lease_payments_status_idx on public.lease_payments (payment_status);

-- ---------------------------------------------------------------------------
-- lease_accidents: 사고
-- ---------------------------------------------------------------------------
create table if not exists public.lease_accidents (
  id text primary key,
  vehicle_id text not null references public.lease_vehicles(id) on delete cascade,
  accident_date date,
  driver_name text not null default '',
  vehicle_number text not null default '',
  repair_cost numeric not null default 0,
  insurance_payout numeric not null default 0,
  self_pay numeric not null default 0,
  actual_loss numeric not null default 0,
  memo text not null default '',
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lease_accidents add column if not exists vehicle_id text;
alter table public.lease_accidents add column if not exists accident_date date;
alter table public.lease_accidents add column if not exists driver_name text not null default '';
alter table public.lease_accidents add column if not exists vehicle_number text not null default '';
alter table public.lease_accidents add column if not exists repair_cost numeric not null default 0;
alter table public.lease_accidents add column if not exists insurance_payout numeric not null default 0;
alter table public.lease_accidents add column if not exists self_pay numeric not null default 0;
alter table public.lease_accidents add column if not exists actual_loss numeric not null default 0;
alter table public.lease_accidents add column if not exists memo text not null default '';
alter table public.lease_accidents add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.lease_accidents add column if not exists created_at timestamptz not null default now();
alter table public.lease_accidents add column if not exists updated_at timestamptz not null default now();

create index if not exists lease_accidents_vehicle_id_idx on public.lease_accidents (vehicle_id);
create index if not exists lease_accidents_date_idx on public.lease_accidents (accident_date);

-- ---------------------------------------------------------------------------
-- lease_maintenance: 정비
-- ---------------------------------------------------------------------------
create table if not exists public.lease_maintenance (
  id text primary key,
  vehicle_id text not null references public.lease_vehicles(id) on delete cascade,
  maintenance_date date,
  vehicle_number text not null default '',
  description text not null default '',
  maintenance_cost numeric not null default 0,
  parts_cost numeric not null default 0,
  memo text not null default '',
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lease_maintenance add column if not exists vehicle_id text;
alter table public.lease_maintenance add column if not exists maintenance_date date;
alter table public.lease_maintenance add column if not exists vehicle_number text not null default '';
alter table public.lease_maintenance add column if not exists description text not null default '';
alter table public.lease_maintenance add column if not exists maintenance_cost numeric not null default 0;
alter table public.lease_maintenance add column if not exists parts_cost numeric not null default 0;
alter table public.lease_maintenance add column if not exists memo text not null default '';
alter table public.lease_maintenance add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.lease_maintenance add column if not exists created_at timestamptz not null default now();
alter table public.lease_maintenance add column if not exists updated_at timestamptz not null default now();

create index if not exists lease_maintenance_vehicle_id_idx on public.lease_maintenance (vehicle_id);
create index if not exists lease_maintenance_date_idx on public.lease_maintenance (maintenance_date);

-- ---------------------------------------------------------------------------
-- lease_profit_logs: 손익 스냅샷
-- ---------------------------------------------------------------------------
create table if not exists public.lease_profit_logs (
  id text primary key,
  vehicle_id text references public.lease_vehicles(id) on delete set null,
  period_type text not null default 'daily',
  period_start date,
  period_end date,
  rental_revenue numeric not null default 0,
  lease_cost numeric not null default 0,
  insurance_cost numeric not null default 0,
  other_cost numeric not null default 0,
  maintenance_cost numeric not null default 0,
  accident_loss numeric not null default 0,
  unpaid_amount numeric not null default 0,
  empty_loss numeric not null default 0,
  empty_opportunity numeric not null default 0,
  net_profit numeric not null default 0,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lease_profit_logs add column if not exists vehicle_id text;
alter table public.lease_profit_logs add column if not exists period_type text not null default 'daily';
alter table public.lease_profit_logs add column if not exists period_start date;
alter table public.lease_profit_logs add column if not exists period_end date;
alter table public.lease_profit_logs add column if not exists rental_revenue numeric not null default 0;
alter table public.lease_profit_logs add column if not exists lease_cost numeric not null default 0;
alter table public.lease_profit_logs add column if not exists insurance_cost numeric not null default 0;
alter table public.lease_profit_logs add column if not exists other_cost numeric not null default 0;
alter table public.lease_profit_logs add column if not exists maintenance_cost numeric not null default 0;
alter table public.lease_profit_logs add column if not exists accident_loss numeric not null default 0;
alter table public.lease_profit_logs add column if not exists unpaid_amount numeric not null default 0;
alter table public.lease_profit_logs add column if not exists empty_loss numeric not null default 0;
alter table public.lease_profit_logs add column if not exists empty_opportunity numeric not null default 0;
alter table public.lease_profit_logs add column if not exists net_profit numeric not null default 0;
alter table public.lease_profit_logs add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.lease_profit_logs add column if not exists created_at timestamptz not null default now();
alter table public.lease_profit_logs add column if not exists updated_at timestamptz not null default now();

create index if not exists lease_profit_logs_vehicle_id_idx on public.lease_profit_logs (vehicle_id);
create index if not exists lease_profit_logs_period_idx on public.lease_profit_logs (period_type, period_start);

-- ---------------------------------------------------------------------------
-- Triggers + RLS
-- ---------------------------------------------------------------------------
drop trigger if exists lease_vehicles_set_updated_at on public.lease_vehicles;
create trigger lease_vehicles_set_updated_at before update on public.lease_vehicles
  for each row execute function public.brem_set_updated_at();

drop trigger if exists lease_contracts_set_updated_at on public.lease_contracts;
create trigger lease_contracts_set_updated_at before update on public.lease_contracts
  for each row execute function public.brem_set_updated_at();

drop trigger if exists lease_payments_set_updated_at on public.lease_payments;
create trigger lease_payments_set_updated_at before update on public.lease_payments
  for each row execute function public.brem_set_updated_at();

drop trigger if exists lease_accidents_set_updated_at on public.lease_accidents;
create trigger lease_accidents_set_updated_at before update on public.lease_accidents
  for each row execute function public.brem_set_updated_at();

drop trigger if exists lease_maintenance_set_updated_at on public.lease_maintenance;
create trigger lease_maintenance_set_updated_at before update on public.lease_maintenance
  for each row execute function public.brem_set_updated_at();

drop trigger if exists lease_profit_logs_set_updated_at on public.lease_profit_logs;
create trigger lease_profit_logs_set_updated_at before update on public.lease_profit_logs
  for each row execute function public.brem_set_updated_at();

alter table public.lease_vehicles enable row level security;
alter table public.lease_contracts enable row level security;
alter table public.lease_payments enable row level security;
alter table public.lease_accidents enable row level security;
alter table public.lease_maintenance enable row level security;
alter table public.lease_profit_logs enable row level security;

drop policy if exists "lease_vehicles admin all" on public.lease_vehicles;
create policy "lease_vehicles admin all" on public.lease_vehicles
  for all using (public.brem_is_admin()) with check (public.brem_is_admin());

drop policy if exists "lease_contracts admin all" on public.lease_contracts;
create policy "lease_contracts admin all" on public.lease_contracts
  for all using (public.brem_is_admin()) with check (public.brem_is_admin());

drop policy if exists "lease_payments admin all" on public.lease_payments;
create policy "lease_payments admin all" on public.lease_payments
  for all using (public.brem_is_admin()) with check (public.brem_is_admin());

drop policy if exists "lease_accidents admin all" on public.lease_accidents;
create policy "lease_accidents admin all" on public.lease_accidents
  for all using (public.brem_is_admin()) with check (public.brem_is_admin());

drop policy if exists "lease_maintenance admin all" on public.lease_maintenance;
create policy "lease_maintenance admin all" on public.lease_maintenance
  for all using (public.brem_is_admin()) with check (public.brem_is_admin());

drop policy if exists "lease_profit_logs admin all" on public.lease_profit_logs;
create policy "lease_profit_logs admin all" on public.lease_profit_logs
  for all using (public.brem_is_admin()) with check (public.brem_is_admin());

notify pgrst, 'reload schema';
