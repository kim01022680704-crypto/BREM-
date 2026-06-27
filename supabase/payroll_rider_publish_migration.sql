-- =============================================================================
-- BREM 급여명세서 라이더 반영 + 급여관련공지
-- SQL Editor에서 1회 실행
-- =============================================================================

alter table public.payroll_slip_lines
  add column if not exists rider_published_at timestamptz;

create index if not exists payroll_slip_lines_rider_published_idx
  on public.payroll_slip_lines (rider_published_at desc);

-- ---------------------------------------------------------------------------
-- payroll_notices: 급여관련공지 (반영하기 전까지 라이더 미노출)
-- ---------------------------------------------------------------------------
create table if not exists public.payroll_notices (
  id text primary key,
  title text not null default '',
  body text not null default '',
  label text not null default 'notice',
  settlement_week_start text not null default '',
  sort_order integer not null default 0,
  rider_published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payroll_notices add column if not exists title text not null default '';
alter table public.payroll_notices add column if not exists body text not null default '';
alter table public.payroll_notices add column if not exists label text not null default 'notice';
alter table public.payroll_notices add column if not exists settlement_week_start text not null default '';
alter table public.payroll_notices add column if not exists sort_order integer not null default 0;
alter table public.payroll_notices add column if not exists rider_published_at timestamptz;
alter table public.payroll_notices add column if not exists created_at timestamptz not null default now();
alter table public.payroll_notices add column if not exists updated_at timestamptz not null default now();

create index if not exists payroll_notices_week_idx
  on public.payroll_notices (settlement_week_start, sort_order desc, updated_at desc);

create index if not exists payroll_notices_published_idx
  on public.payroll_notices (rider_published_at desc);

drop trigger if exists payroll_notices_set_updated_at on public.payroll_notices;
create trigger payroll_notices_set_updated_at
  before update on public.payroll_notices
  for each row execute function public.brem_set_updated_at();

alter table public.payroll_notices enable row level security;

drop policy if exists "payroll_notices admin all" on public.payroll_notices;
create policy "payroll_notices admin all"
  on public.payroll_notices
  for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

notify pgrst, 'reload schema';
