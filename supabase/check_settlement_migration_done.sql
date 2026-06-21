-- =============================================================================
-- 정산 migration 실행 여부 — Supabase SQL Editor에 붙여넣고 Run
-- 결과만 보면 됩니다 (true = OK, false = migration 아직 안 함)
-- =============================================================================

-- 1) 테이블 존재 여부 (4개 모두 true 여야 정상)
select
  exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'daily_settlements'
  ) as "일정산테이블_daily_settlements",
  exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'weekly_settlements'
  ) as "주정산테이블_weekly_settlements",
  exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'settlement_upload_logs'
  ) as "업로드기록_settlement_upload_logs",
  exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'settlement_unmatched'
  ) as "미매칭_settlement_unmatched";

-- 2) 데이터 건수 (테이블이 있을 때만 의미 있음)
select 'daily_settlements' as 테이블, count(*)::bigint as 건수 from public.daily_settlements
union all select 'weekly_settlements', count(*) from public.weekly_settlements
union all select 'settlement_upload_logs', count(*) from public.settlement_upload_logs
union all select 'settlement_unmatched', count(*) from public.settlement_unmatched
order by 1;

-- 3) settings JSON 백업 잔존 (있어도 정상 — 삭제 안 함)
select key as settings키,
  case when jsonb_typeof(value) = 'array' then jsonb_array_length(value) else null end as json배열건수
from public.settings
where key in (
  'brem_admin_settlements',
  'brem_admin_weekly_settlements',
  'brem_admin_settlement_upload_logs',
  'brem_admin_settlement_unmatched'
)
order by key;
