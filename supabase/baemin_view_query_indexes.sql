-- BREM 배민현황 조회 성능 인덱스 (SQL Editor에서 실행)
-- 추가 전용: DROP / DELETE / TRUNCATE 없음. 인덱스만 생성하므로 조회 결과는 변하지 않고 속도만 개선됩니다.
-- 관련 병목: view-daily-range / view-rider-range / /items / view-full-bundle 가
--   baemin_delivery_applied_items 를 (batch_id, source_menu) + dedupe_key 접두(LIKE 'DPxxxxxx:%')로 조회.

-- 1) /items 의 order('collected_at' desc) + (batch_id, source_menu) 필터를 한 인덱스로 커버
create index if not exists idx_baemin_applied_batch_menu_collected
  on public.baemin_delivery_applied_items (batch_id, source_menu, collected_at desc);

-- 2) 지역 접두 LIKE 'DPxxxxxx:%' 가 btree 인덱스를 타도록 text_pattern_ops 인덱스 추가
--    (기본 콜레이션에서는 일반 btree 로는 LIKE 접두 스캔이 인덱스를 못 타는 경우가 있음)
create index if not exists idx_baemin_applied_batch_menu_dedupe_pattern
  on public.baemin_delivery_applied_items (batch_id, source_menu, dedupe_key text_pattern_ops);

-- 3) 일별/라이더 통계 테이블 주간 조회 보강 (이미 있으면 무시)
create index if not exists idx_baemin_daily_stats_week
  on public.baemin_daily_delivery_stats (week_start);
create index if not exists idx_baemin_rider_stats_week
  on public.baemin_rider_delivery_stats (week_start);

notify pgrst, 'reload schema';
