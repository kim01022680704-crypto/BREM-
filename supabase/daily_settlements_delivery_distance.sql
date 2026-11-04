-- 쿠팡 일정산 오더별 상세내역 L열 합(m). 기사·날짜 한 행에 콜수와 같이 둔다.
alter table public.daily_settlements
  add column if not exists delivery_distance_m integer not null default 0;
