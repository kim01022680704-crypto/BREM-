-- BREM 급여 일정산 · 출금 조회 최적화 인덱스 (Supabase SQL Editor 에서 실행)
-- performance_indexes.sql / query_optimization_indexes.sql 이후 추가 실행 권장.
-- DROP / TRUNCATE / DELETE 없음 — 인덱스만 추가합니다. 데이터는 절대 삭제되지 않습니다.

-- daily_settlements: 출금 계산의 핫패스.
--   기사별 + 정산주 기간(period) 범위 조회 → (driver_id, period) 복합 인덱스
create index if not exists idx_brem_daily_settlements_driver_period
  on public.daily_settlements (driver_id, period);
-- 기간(period)만으로 조회하는 관리자 화면용
create index if not exists idx_brem_daily_settlements_period
  on public.daily_settlements (period desc);
-- 플랫폼별 필터
create index if not exists idx_brem_daily_settlements_driver_platform_period
  on public.daily_settlements (driver_id, platform, period);

-- settlement_upload_logs: 업로드 이력 조회
create index if not exists idx_brem_settlement_upload_logs_uploaded_at
  on public.settlement_upload_logs (uploaded_at desc);
create index if not exists idx_brem_settlement_upload_logs_kind_platform
  on public.settlement_upload_logs (kind, platform, uploaded_at desc);

-- settlement_unmatched: 미매칭 조회
create index if not exists idx_brem_settlement_unmatched_week
  on public.settlement_unmatched (week_start desc, platform);

-- lease_contracts / lease_arrears: 출금 시 리스 차감 매칭
create index if not exists idx_brem_lease_contracts_status
  on public.lease_contracts (status);
create index if not exists idx_brem_lease_arrears_contract
  on public.lease_arrears (contract_id);

notify pgrst, 'reload schema';
