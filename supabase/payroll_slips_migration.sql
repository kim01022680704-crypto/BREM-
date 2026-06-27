-- =============================================================================
-- BREM payroll_slips 테이블 (급여명세서 업로드·조회)
-- SQL Editor에서 1회 실행 — 기존 settings/운영 데이터는 변경하지 않음
-- =============================================================================

create or replace function public.brem_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- payroll_slip_uploads: 급여명세서 업로드 배치
-- ---------------------------------------------------------------------------
create table if not exists public.payroll_slip_uploads (
  id text primary key,
  pay_month text not null default '',
  file_name text not null default '',
  uploaded_by text not null default '',
  uploaded_by_id text not null default '',
  status text not null default 'applied',
  content_hash text not null default '',
  row_count integer not null default 0,
  total_gross numeric not null default 0,
  total_deduction numeric not null default 0,
  total_net numeric not null default 0,
  raw_summary jsonb not null default '{}'::jsonb,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payroll_slip_uploads add column if not exists pay_month text not null default '';
alter table public.payroll_slip_uploads add column if not exists file_name text not null default '';
alter table public.payroll_slip_uploads add column if not exists uploaded_by text not null default '';
alter table public.payroll_slip_uploads add column if not exists uploaded_by_id text not null default '';
alter table public.payroll_slip_uploads add column if not exists status text not null default 'applied';
alter table public.payroll_slip_uploads add column if not exists content_hash text not null default '';
alter table public.payroll_slip_uploads add column if not exists row_count integer not null default 0;
alter table public.payroll_slip_uploads add column if not exists total_gross numeric not null default 0;
alter table public.payroll_slip_uploads add column if not exists total_deduction numeric not null default 0;
alter table public.payroll_slip_uploads add column if not exists total_net numeric not null default 0;
alter table public.payroll_slip_uploads add column if not exists raw_summary jsonb not null default '{}'::jsonb;
alter table public.payroll_slip_uploads add column if not exists uploaded_at timestamptz not null default now();
alter table public.payroll_slip_uploads add column if not exists updated_at timestamptz not null default now();

create index if not exists payroll_slip_uploads_pay_month_idx
  on public.payroll_slip_uploads (pay_month, uploaded_at desc);

create index if not exists payroll_slip_uploads_uploaded_idx
  on public.payroll_slip_uploads (uploaded_at desc);

drop trigger if exists payroll_slip_uploads_set_updated_at on public.payroll_slip_uploads;
create trigger payroll_slip_uploads_set_updated_at
  before update on public.payroll_slip_uploads
  for each row execute function public.brem_set_updated_at();

-- ---------------------------------------------------------------------------
-- payroll_slip_lines: 급여명세서 라인 (라이더별)
-- ---------------------------------------------------------------------------
create table if not exists public.payroll_slip_lines (
  id text primary key,
  upload_id text not null default '',
  pay_month text not null default '',
  driver_id text not null default '',
  rider_name text not null default '',
  employee_no text not null default '',
  department text not null default '',
  base_pay numeric not null default 0,
  allowance numeric not null default 0,
  gross_pay numeric not null default 0,
  income_tax numeric not null default 0,
  local_tax numeric not null default 0,
  insurance numeric not null default 0,
  other_deduction numeric not null default 0,
  total_deduction numeric not null default 0,
  net_pay numeric not null default 0,
  memo text not null default '',
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payroll_slip_lines add column if not exists upload_id text not null default '';
alter table public.payroll_slip_lines add column if not exists pay_month text not null default '';
alter table public.payroll_slip_lines add column if not exists driver_id text not null default '';
alter table public.payroll_slip_lines add column if not exists rider_name text not null default '';
alter table public.payroll_slip_lines add column if not exists employee_no text not null default '';
alter table public.payroll_slip_lines add column if not exists department text not null default '';
alter table public.payroll_slip_lines add column if not exists base_pay numeric not null default 0;
alter table public.payroll_slip_lines add column if not exists allowance numeric not null default 0;
alter table public.payroll_slip_lines add column if not exists gross_pay numeric not null default 0;
alter table public.payroll_slip_lines add column if not exists income_tax numeric not null default 0;
alter table public.payroll_slip_lines add column if not exists local_tax numeric not null default 0;
alter table public.payroll_slip_lines add column if not exists insurance numeric not null default 0;
alter table public.payroll_slip_lines add column if not exists other_deduction numeric not null default 0;
alter table public.payroll_slip_lines add column if not exists total_deduction numeric not null default 0;
alter table public.payroll_slip_lines add column if not exists net_pay numeric not null default 0;
alter table public.payroll_slip_lines add column if not exists memo text not null default '';
alter table public.payroll_slip_lines add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.payroll_slip_lines add column if not exists created_at timestamptz not null default now();
alter table public.payroll_slip_lines add column if not exists updated_at timestamptz not null default now();

create index if not exists payroll_slip_lines_pay_month_idx
  on public.payroll_slip_lines (pay_month, rider_name);

create index if not exists payroll_slip_lines_upload_idx
  on public.payroll_slip_lines (upload_id);

create index if not exists payroll_slip_lines_driver_idx
  on public.payroll_slip_lines (driver_id, pay_month);

drop trigger if exists payroll_slip_lines_set_updated_at on public.payroll_slip_lines;
create trigger payroll_slip_lines_set_updated_at
  before update on public.payroll_slip_lines
  for each row execute function public.brem_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.payroll_slip_uploads enable row level security;
alter table public.payroll_slip_lines enable row level security;

drop policy if exists "payroll_slip_uploads admin all" on public.payroll_slip_uploads;
create policy "payroll_slip_uploads admin all"
  on public.payroll_slip_uploads
  for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

drop policy if exists "payroll_slip_lines admin all" on public.payroll_slip_lines;
create policy "payroll_slip_lines admin all"
  on public.payroll_slip_lines
  for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

notify pgrst, 'reload schema';
