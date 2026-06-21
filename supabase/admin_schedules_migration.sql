-- =============================================================================
-- BREM admin_schedules 테이블 (관리자 스케줄표 영구 저장)
-- settings JSON(brem_admin_schedules) 대비 전용 테이블 — 기존 settings 데이터는 유지
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
-- admin_schedules: 관리자 스케줄표
-- ---------------------------------------------------------------------------
create table if not exists public.admin_schedules (
  id text primary key,
  date date not null,
  title text not null default '',
  memo text not null default '',
  created_by text not null default '',
  created_by_id text not null default '',
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_schedules add column if not exists date date;
alter table public.admin_schedules add column if not exists title text not null default '';
alter table public.admin_schedules add column if not exists memo text not null default '';
alter table public.admin_schedules add column if not exists created_by text not null default '';
alter table public.admin_schedules add column if not exists created_by_id text not null default '';
alter table public.admin_schedules add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.admin_schedules add column if not exists created_at timestamptz not null default now();
alter table public.admin_schedules add column if not exists updated_at timestamptz not null default now();

create index if not exists admin_schedules_date_idx on public.admin_schedules (date);
create index if not exists admin_schedules_created_at_idx on public.admin_schedules (created_at desc);

drop trigger if exists admin_schedules_set_updated_at on public.admin_schedules;
create trigger admin_schedules_set_updated_at
  before update on public.admin_schedules
  for each row execute function public.brem_set_updated_at();

alter table public.admin_schedules enable row level security;

drop policy if exists "admin_schedules admin all" on public.admin_schedules;
create policy "admin_schedules admin all"
  on public.admin_schedules
  for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

notify pgrst, 'reload schema';
