-- =============================================================================
-- BREM missions 테이블 생성 (운영 Supabase SQL Editor에서 1회 실행)
-- 오류: "Could not find the table 'public.missions' in the schema cache"
-- → 이 파일 전체를 복사해 SQL Editor에 붙여넣고 Run
-- =============================================================================

-- updated_at 트리거 함수 (schema.sql 미실행 환경 대비)
create or replace function public.brem_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- missions: 관리자 미션 관리 → Supabase 영구 저장
-- riders.selected_mission_id(_baemin/_coupang) 로 기사별 연결
-- ---------------------------------------------------------------------------
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

-- riders 미션 연결 컬럼 (플랫폼별 + 레거시 단일)
alter table public.riders add column if not exists selected_mission_id text not null default '';
alter table public.riders add column if not exists selected_mission_id_baemin text not null default '';
alter table public.riders add column if not exists selected_mission_id_coupang text not null default '';

create index if not exists idx_brem_missions_active on public.missions (is_active);
create index if not exists idx_brem_missions_created_at on public.missions (created_at desc);
create index if not exists idx_brem_riders_selected_mission on public.riders (selected_mission_id);
create index if not exists idx_brem_riders_mission_baemin on public.riders (selected_mission_id_baemin);
create index if not exists idx_brem_riders_mission_coupang on public.riders (selected_mission_id_coupang);

drop trigger if exists trg_brem_missions_updated_at on public.missions;
create trigger trg_brem_missions_updated_at
before update on public.missions
for each row execute function public.brem_set_updated_at();

-- ---------------------------------------------------------------------------
-- 기본 미션 seed (DB가 비어 있을 때만 — 기존 수정값 덮어쓰지 않음)
-- ---------------------------------------------------------------------------
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

-- 기존 단일 미션 값 → 플랫폼별 컬럼 복사 (1회, 빈 값만)
update public.riders
set
  selected_mission_id_baemin = case
    when coalesce(selected_mission_id_baemin, '') = '' then selected_mission_id
    else selected_mission_id_baemin
  end,
  selected_mission_id_coupang = case
    when coalesce(selected_mission_id_coupang, '') = '' then selected_mission_id
    else selected_mission_id_coupang
  end
where coalesce(selected_mission_id, '') <> '';

-- brem_is_admin() — RLS용 (profiles 테이블 필요)
create or replace function public.brem_current_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where user_id = auth.uid() and active = true
$$;

create or replace function public.brem_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.brem_current_role() = 'admin', false)
$$;

-- ---------------------------------------------------------------------------
-- RLS (관리자 CRUD + 기사/라이더 read)
-- ---------------------------------------------------------------------------
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
  or exists (
    select 1
    from public.riders r
    where r.auth_user_id = auth.uid()
      and (
        r.selected_mission_id = missions.id
        or r.selected_mission_id_baemin = missions.id
        or r.selected_mission_id_coupang = missions.id
      )
  )
);

-- PostgREST / Supabase API 스키마 캐시 새로고침 (필수)
notify pgrst, 'reload schema';

-- 확인용 (실행 후 Table Editor에서 missions 2행 이상 보이면 성공)
-- select id, title, is_active from public.missions order by created_at;
