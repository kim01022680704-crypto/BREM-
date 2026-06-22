-- BREM query optimization indexes (SQL Editor에서 실행)
-- 기존 performance_indexes.sql 이후 추가 실행 권장.
-- DROP / TRUNCATE / DELETE 없음 — 인덱스만 추가합니다.

-- riders: 목록·검색·매칭
create index if not exists idx_brem_riders_name on public.riders (name);
create index if not exists idx_brem_riders_phone on public.riders (phone);
create index if not exists idx_brem_riders_baemin_id on public.riders (baemin_id);
-- platform_coupang / platform_baemin 은 performance_indexes.sql 에 이미 있음

-- admin_calls: 기사별·일자별·플랫폼별 조회
create index if not exists idx_brem_admin_calls_driver_date on public.admin_calls (driver_id, date desc);
create index if not exists idx_brem_admin_calls_driver_platform_date on public.admin_calls (driver_id, platform, date desc);
create index if not exists idx_brem_admin_calls_date on public.admin_calls (date desc);

-- admin_rejection_rates: 주간·플랫폼별
create index if not exists idx_brem_admin_rejection_rates_driver_week on public.admin_rejection_rates (driver_id, week_start desc);
create index if not exists idx_brem_admin_rejection_rates_driver_platform_week on public.admin_rejection_rates (driver_id, platform, week_start desc);

-- admin_targets: 월별 목표 (driver_id+month 는 operations_tables_migration 에 이미 있음)
-- 추가 인덱스 없음

-- admin_schedules: 날짜 (admin_schedules_date_idx 는 migration 에 이미 있음)
-- 추가 인덱스 없음

-- missions: 활성 미션 필터
create index if not exists idx_brem_missions_is_active on public.missions (is_active);

notify pgrst, 'reload schema';
