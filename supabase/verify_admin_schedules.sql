-- =============================================================================
-- admin_schedules 테이블 생성 확인 (Supabase SQL Editor)
-- admin_schedules_migration.sql 실행 후 이 파일로 검증
-- =============================================================================

-- 1) 테이블 존재 여부
select exists (
  select 1
  from information_schema.tables
  where table_schema = 'public'
    and table_name = 'admin_schedules'
) as admin_schedules_table_exists;

-- 2) 컬럼 목록
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'admin_schedules'
order by ordinal_position;

-- 3) RLS · 정책
select relname, relrowsecurity
from pg_class
where relname = 'admin_schedules';

select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'admin_schedules';

-- 4) brem_is_admin() (RLS 전제)
select exists (
  select 1
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'brem_is_admin'
) as brem_is_admin_exists;

-- 5) 저장된 일정 샘플 (앱에서 저장 후)
select id, date, title, memo, created_by, created_at, updated_at
from public.admin_schedules
order by date desc, created_at desc
limit 20;
