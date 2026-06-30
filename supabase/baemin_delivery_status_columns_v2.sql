-- BREM baemin_delivery_status — 누락 컬럼 추가 (Supabase SQL Editor 1회 실행)
alter table public.baemin_delivery_status
  add column if not exists bmart_reject integer not null default 0,
  add column if not exists store_reject integer not null default 0,
  add column if not exists total_reject integer not null default 0,
  add column if not exists food_cancel integer not null default 0,
  add column if not exists bmart_cancel integer not null default 0,
  add column if not exists store_cancel integer not null default 0,
  add column if not exists food_rider_fault integer not null default 0,
  add column if not exists bmart_rider_fault integer not null default 0,
  add column if not exists store_rider_fault integer not null default 0;
