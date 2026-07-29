-- 쿠팡 일정산: 공제기준금액(AC열) 저장 컬럼
--
-- 배달료(AJ)는 콜수수료가 이미 빠진 금액이라 원천세·고용보험·산재보험의
-- 기준으로 쓰면 금액이 맞지 않는다. 그래서 공제 기준은 AC열 금액을 쓴다.
--
-- 이 값을 행마다 저장해두는 이유:
--   일정산 원천세·고용·산재는 저장하지 않고 화면에서 매번 다시 계산한다.
--   기준 열만 바꾸면 과거 주까지 전부 소급 재계산되어, 이미 출금이 끝난
--   주의 실지급액이 달라지고 초과출금이 생긴다.
--   기본값 0 = "AC 없음" 이므로 기존 행은 지금까지처럼 AJ 기준을 유지하고,
--   새로 업로드되는 행부터 AC 기준이 적용된다.
alter table public.daily_settlements
  add column if not exists deduction_base numeric not null default 0;

-- settlement_unmatched 는 별도 컬럼이 필요 없다.
-- 시간제보험과 같은 방식으로 match_payload(JSON) 안에 담아 재매칭 때 살린다.
