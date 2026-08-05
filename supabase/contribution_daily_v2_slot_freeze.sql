-- 기여도 v2: 슬롯(할당 시간대) 단위 + 달성/종료 시 고정
-- 이미 contribution_daily_migration.sql 실행한 DB에 이어서 실행.

alter table public.contribution_daily
  add column if not exists slot_key text not null default '';

alter table public.contribution_daily
  add column if not exists frozen boolean not null default false;

alter table public.contribution_daily
  add column if not exists assigned_target numeric not null default 0;

alter table public.contribution_daily
  add column if not exists region_slot_complete numeric not null default 0;

alter table public.contribution_daily
  drop constraint if exists contribution_daily_uniq;

alter table public.contribution_daily
  add constraint contribution_daily_uniq unique (date, platform, rider_id, slot_key);

create index if not exists idx_contribution_daily_slot
  on public.contribution_daily (date, platform, slot_key, frozen);

comment on column public.contribution_daily.slot_key is
  '배민: morning/afternoon/evening/midnight. 쿠팡: peak 또는 day.';
comment on column public.contribution_daily.frozen is
  '할당 달성 또는 슬롯 종료 시 true. true면 점수 덮어쓰지 않음.';

notify pgrst, 'reload schema';
