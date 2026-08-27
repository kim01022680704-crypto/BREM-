-- 기사별 합산 미션 배정
alter table public.riders add column if not exists selected_mission_id_combined text not null default '';
create index if not exists idx_brem_riders_mission_combined on public.riders (selected_mission_id_combined);
