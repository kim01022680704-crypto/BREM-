-- STEP 2 보완 — weekly_settlements 컬럼 없을 때 먼저 Run
-- 성공 후 settlements_step2_migrate_data.sql 전체 다시 Run

alter table public.weekly_settlements add column if not exists region text not null default '';
alter table public.weekly_settlements add column if not exists file_name text not null default '';
alter table public.weekly_settlements add column if not exists base_settlement_date date;
alter table public.weekly_settlements add column if not exists start_date date;
alter table public.weekly_settlements add column if not exists end_date date;
alter table public.weekly_settlements add column if not exists payment_date date;
alter table public.weekly_settlements add column if not exists settlement_week_label text not null default '';
alter table public.weekly_settlements add column if not exists matched_names_label text not null default '';
alter table public.weekly_settlements add column if not exists summary jsonb not null default '{}'::jsonb;
alter table public.weekly_settlements add column if not exists riders jsonb not null default '[]'::jsonb;
alter table public.weekly_settlements add column if not exists uploaded_at timestamptz not null default now();
alter table public.weekly_settlements add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_settlements'
      and column_name = 'region_name'
  ) then
    update public.weekly_settlements
    set region = region_name
    where coalesce(region, '') = '' and coalesce(region_name, '') <> '';
  end if;
end $$;

-- region 컬럼 생겼는지 확인 (true 여야 함)
select exists (
  select 1 from information_schema.columns
  where table_schema = 'public'
    and table_name = 'weekly_settlements'
    and column_name = 'region'
) as region_column_ok;
