-- =============================================================================
-- BREM migration 점검/복구 — 실행 후 확인용 SQL
-- operations_tables_migration.sql 실행 직후 붙여넣기
-- =============================================================================

-- 1) 테이블 존재 여부
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'admin_schedules',
    'admin_calls',
    'admin_rejection_rates',
    'admin_targets',
    'operations',
    'operation_logs',
    'operation_tasks',
    'baemin_delivery_status',
    'admin_call_records',
    'admin_weekly_rates',
    'admin_monthly_targets'
  )
order by table_name;

-- 2) 공식 테이블 row count (한 번에)
select 'admin_schedules' as table_name, count(*)::bigint as row_count from public.admin_schedules
union all select 'admin_calls', count(*) from public.admin_calls
union all select 'admin_rejection_rates', count(*) from public.admin_rejection_rates
union all select 'admin_targets', count(*) from public.admin_targets
union all select 'riders', count(*) from public.riders
union all select 'missions', count(*) from public.missions
union all select 'promotions', count(*) from public.promotions
union all select 'notices', count(*) from public.notices
order by table_name;

-- 2b) 선택/레거시 테이블 (있을 때만)
do $$
declare
  t text;
  c bigint;
begin
  foreach t in array array[
    'baemin_delivery_status',
    'admin_call_records',
    'admin_weekly_rates',
    'admin_monthly_targets',
    'operations',
    'operation_logs',
    'operation_tasks'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into c;
      raise notice '% : % rows', t, c;
    else
      raise notice '% : (table missing)', t;
    end if;
  end loop;
end $$;

-- 3) settings JSON 레거시 백업 (삭제하지 않음)
select
  key,
  jsonb_typeof(value) as value_type,
  case when jsonb_typeof(value) = 'array' then jsonb_array_length(value) else null end as array_len
from public.settings
where key in (
  'brem_admin_schedules',
  'brem_admin_calls',
  'brem_admin_rejection_rates',
  'brem_admin_targets',
  'brem_admin_settlements',
  'brem_admin_weekly_settlements',
  'brem_admin_settlement_upload_logs',
  'brem_admin_settlement_unmatched'
)
order by key;

-- 4) 이관 검증: settings 건수 vs 공식 테이블 건수
with legacy as (
  select key, jsonb_array_length(value) as cnt
  from public.settings
  where key in (
    'brem_admin_schedules',
    'brem_admin_calls',
    'brem_admin_rejection_rates',
    'brem_admin_targets',
    'brem_admin_settlements',
    'brem_admin_weekly_settlements',
    'brem_admin_settlement_upload_logs',
    'brem_admin_settlement_unmatched'
  )
  and jsonb_typeof(value) = 'array'
)
select
  l.key as settings_key,
  l.cnt as settings_array_len,
  case l.key
    when 'brem_admin_schedules' then (select count(*) from public.admin_schedules)
    when 'brem_admin_calls' then (select count(*) from public.admin_calls)
    when 'brem_admin_rejection_rates' then (select count(*) from public.admin_rejection_rates)
    when 'brem_admin_targets' then (select count(*) from public.admin_targets)
    when 'brem_admin_settlements' then (select count(*) from public.daily_settlements)
    when 'brem_admin_weekly_settlements' then (select count(*) from public.weekly_settlements)
    when 'brem_admin_settlement_upload_logs' then (select count(*) from public.settlement_upload_logs)
    when 'brem_admin_settlement_unmatched' then (select count(*) from public.settlement_unmatched)
  end as table_row_count,
  case
    when l.cnt <= case l.key
      when 'brem_admin_schedules' then (select count(*)::int from public.admin_schedules)
      when 'brem_admin_calls' then (select count(*)::int from public.admin_calls)
      when 'brem_admin_rejection_rates' then (select count(*)::int from public.admin_rejection_rates)
      when 'brem_admin_targets' then (select count(*)::int from public.admin_targets)
      when 'brem_admin_settlements' then (select count(*)::int from public.daily_settlements)
      when 'brem_admin_weekly_settlements' then (select count(*)::int from public.weekly_settlements)
      when 'brem_admin_settlement_upload_logs' then (select count(*)::int from public.settlement_upload_logs)
      when 'brem_admin_settlement_unmatched' then (select count(*)::int from public.settlement_unmatched)
    end then 'OK'
    else 'CHECK'
  end as status
from legacy l
order by l.key;

-- 5) sample
select 'admin_calls' as src, id, driver_id, date::text, platform, count from public.admin_calls limit 5;
select 'admin_rejection_rates' as src, id, driver_id, week_start::text, platform, rate from public.admin_rejection_rates limit 5;
select 'admin_targets' as src, id, driver_id, month, count from public.admin_targets limit 5;
select 'admin_schedules' as src, id, date::text, title from public.admin_schedules limit 5;
select 'daily_settlements' as src, id, driver_id, period::text, platform from public.daily_settlements limit 5;
select 'weekly_settlements' as src, id, platform, start_date::text, end_date::text from public.weekly_settlements limit 5;
