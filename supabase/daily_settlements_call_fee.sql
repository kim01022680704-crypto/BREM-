-- 일정산서 업로드 시 콜수수료(콜수 × 단가)를 행에 저장한다.
--
-- 단가를 나중에 바꿔도 이미 업로드된 주의 실지급이 소급되지 않게 하려고
-- 업로드 시점 값을 보관한다. NULL = 옛 행(지금까지처럼 현재 단가로 계산).
-- 일정산수수료(출금 시 2%)는 이 컬럼과 무관하다.
alter table public.daily_settlements
  add column if not exists call_fee numeric,
  add column if not exists call_fee_unit numeric;
