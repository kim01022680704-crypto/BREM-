-- BREM 운영 데이터 테이블 전체 확인 (Supabase SQL Editor)

select
  t.table_name,
  exists (
    select 1 from information_schema.tables i
    where i.table_schema = 'public' and i.table_name = t.table_name
  ) as exists
from (
  values
    ('riders'),
    ('notices'),
    ('missions'),
    ('promotions'),
    ('admin_schedules'),
    ('admin_call_records'),
    ('admin_weekly_rates'),
    ('admin_monthly_targets'),
    ('settings'),
    ('rider_inquiries')
) as t(table_name)
order by t.table_name;

-- 행 수 요약
select 'riders' as source, count(*)::bigint as rows from public.riders
union all select 'notices', count(*) from public.notices
union all select 'missions', count(*) from public.missions
union all select 'promotions', count(*) from public.promotions
union all select 'admin_schedules', count(*) from public.admin_schedules
union all select 'admin_call_records', count(*) from public.admin_call_records
union all select 'admin_weekly_rates', count(*) from public.admin_weekly_rates
union all select 'admin_monthly_targets', count(*) from public.admin_monthly_targets
order by 1;

-- settings JSON 레거시 잔존 (삭제하지 않음 — 참고용)
select key, jsonb_typeof(value) as value_type,
  case when jsonb_typeof(value) = 'array' then jsonb_array_length(value) else null end as array_len
from public.settings
where key in (
  'brem_admin_schedules',
  'brem_admin_calls',
  'brem_admin_rejection_rates',
  'brem_admin_targets'
)
order by key;
