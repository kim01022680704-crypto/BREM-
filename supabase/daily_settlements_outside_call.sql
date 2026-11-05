-- 쿠팡 일정산 오더별 상세내역의 권외콜 수. 기사·날짜 한 행에 콜수와 같이 둔다.
alter table public.daily_settlements
  add column if not exists outside_call_count integer not null default 0;
