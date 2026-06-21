-- =============================================================================
-- STEP 1 보완 — FK 때문에 uuid 변환 실패했을 때 이것만 Run
-- (테이블 3개는 이미 만들어졌을 수 있음 — 다시 Run 해도 안전)
-- =============================================================================

-- 1) FK 제거 + 자식 컬럼 text 변환
alter table public.weekly_settlement_riders
  drop constraint if exists weekly_settlement_riders_weekly_settlement_id_fkey;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_settlement_riders'
      and column_name = 'weekly_settlement_id'
      and data_type = 'uuid'
  ) then
    alter table public.weekly_settlement_riders
      alter column weekly_settlement_id type text using weekly_settlement_id::text;
  end if;
end $$;

-- 2) weekly_settlements.id text 변환
do $$
declare col_type text;
begin
  select c.data_type into col_type
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'weekly_settlements'
    and c.column_name = 'id';

  if col_type = 'uuid' then
    alter table public.weekly_settlements alter column id drop default;
    alter table public.weekly_settlements
      alter column id type text using id::text;
  end if;
end $$;

-- 3) 확인 — 4개 모두 true 여야 함
select
  to_regclass('public.daily_settlements') is not null as daily_ok,
  to_regclass('public.weekly_settlements') is not null as weekly_ok,
  to_regclass('public.settlement_upload_logs') is not null as logs_ok,
  to_regclass('public.settlement_unmatched') is not null as unmatched_ok;

notify pgrst, 'reload schema';
