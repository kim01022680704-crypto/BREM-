-- 플랫폼별 미션 배정 (배민 / 쿠팡 분리)
-- Supabase SQL Editor에서 1회 실행

alter table public.riders add column if not exists selected_mission_id_baemin text not null default '';
alter table public.riders add column if not exists selected_mission_id_coupang text not null default '';

create index if not exists idx_brem_riders_mission_baemin on public.riders (selected_mission_id_baemin);
create index if not exists idx_brem_riders_mission_coupang on public.riders (selected_mission_id_coupang);

-- 기존 단일 미션 값이 있으면 양쪽에 복사 (1회)
update public.riders
set
  selected_mission_id_baemin = case when selected_mission_id_baemin = '' then selected_mission_id else selected_mission_id_baemin end,
  selected_mission_id_coupang = case when selected_mission_id_coupang = '' then selected_mission_id else selected_mission_id_coupang end
where coalesce(selected_mission_id, '') <> '';
