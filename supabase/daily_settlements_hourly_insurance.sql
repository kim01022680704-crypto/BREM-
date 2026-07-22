-- 쿠팡 일정산: 시간제보험(AH열) 저장 컬럼
alter table public.daily_settlements
  add column if not exists hourly_insurance numeric not null default 0;
