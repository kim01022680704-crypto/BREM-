-- BREM missions table + rider mission assignment
-- Supabase SQL Editor에서 실행하세요.

create table if not exists public.missions (
  id text primary key,
  title text not null default '',
  description text not null default '',
  type text not null default '',
  conditions text not null default '',
  is_active boolean not null default true,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.missions add column if not exists title text not null default '';
alter table public.missions add column if not exists description text not null default '';
alter table public.missions add column if not exists type text not null default '';
alter table public.missions add column if not exists conditions text not null default '';
alter table public.missions add column if not exists is_active boolean not null default true;
alter table public.missions add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.missions add column if not exists created_at timestamptz not null default now();
alter table public.missions add column if not exists updated_at timestamptz not null default now();

alter table public.riders add column if not exists selected_mission_id text not null default '';

create index if not exists idx_brem_missions_active on public.missions (is_active);
create index if not exists idx_brem_missions_created_at on public.missions (created_at desc);
create index if not exists idx_brem_riders_selected_mission on public.riders (selected_mission_id);

drop trigger if exists trg_brem_missions_updated_at on public.missions;
create trigger trg_brem_missions_updated_at
before update on public.missions
for each row execute function public.brem_set_updated_at();

-- 기본 미션 2개 (없을 때만)
insert into public.missions (id, title, description, type, conditions, is_active)
select
  'brem_mission_count_140',
  '140건 1,500원 미션',
  '주간 140건 이상 달성 시 건당 1,500원 리워드가 지급되는 미션입니다.',
  'count_reward',
  '주간 140건 이상 콜수 달성 · 쿠팡·배민 합산 기준',
  true
where not exists (select 1 from public.missions where id = 'brem_mission_count_140');

insert into public.missions (id, title, description, type, conditions, is_active)
select
  'brem_mission_unit_guarantee_bike',
  '단가보장 + 오토바이 미션',
  '단가보장 프로그램과 오토바이 리스·렌탈 연계 혜택이 적용되는 미션입니다.',
  'unit_guarantee_motorcycle',
  '단가보장 조건 충족 · 오토바이 리스/렌탈 이용 기사',
  true
where not exists (select 1 from public.missions where id = 'brem_mission_unit_guarantee_bike');

-- 기존 기사 기본 미션 연결
update public.riders
set selected_mission_id = 'brem_mission_count_140'
where coalesce(selected_mission_id, '') = '';

alter table public.missions enable row level security;

drop policy if exists "brem_missions_admin_all" on public.missions;
create policy "brem_missions_admin_all"
on public.missions for all to authenticated
using (public.brem_is_admin())
with check (public.brem_is_admin());

drop policy if exists "brem_missions_select_rider" on public.missions;
create policy "brem_missions_select_rider"
on public.missions for select to authenticated
using (
  public.brem_is_admin()
  or is_active = true
  or id = (
    select r.selected_mission_id
    from public.riders r
    where r.auth_user_id = auth.uid()
    limit 1
  )
);

notify pgrst, 'reload schema';
