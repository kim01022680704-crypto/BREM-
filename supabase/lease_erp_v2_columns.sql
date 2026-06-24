-- 리스 ERP v2 — 엑셀 기준 필드 추가 (lease_erp_migration.sql 실행 후 1회)
alter table public.lease_vehicles add column if not exists unpaid_days integer not null default 0;
alter table public.lease_vehicles add column if not exists payment_check text not null default '';
alter table public.lease_vehicles add column if not exists unpaid_collection_method text not null default '';
alter table public.lease_vehicles add column if not exists acquisition_tax_rate numeric not null default 0;
alter table public.lease_vehicles add column if not exists acquisition_tax_amount numeric not null default 0;
alter table public.lease_vehicles add column if not exists other_acquisition_cost numeric not null default 0;
alter table public.lease_vehicles add column if not exists total_acquisition_cost numeric not null default 0;

notify pgrst, 'reload schema';
