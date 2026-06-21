-- =============================================================================
-- riders 테이블 스키마 동기화 (코드 ↔ Supabase 컬럼 일치)
-- =============================================================================
-- 증상: column riders.long_event_platform does not exist
-- 원인: 운영 DB에 장기근속 플랫폼 컬럼(또는 미션 컬럼)이 아직 추가되지 않음
--
-- 실행: Supabase Dashboard → SQL Editor → 전체 붙여넣기 → Run
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) riders 기본·장기근속·프로모션 컬럼 (schema.sql 과 동일)
-- ---------------------------------------------------------------------------
alter table public.riders add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table public.riders add column if not exists resident_number text not null default '';
alter table public.riders add column if not exists bank_name text not null default '';
alter table public.riders add column if not exists account_holder text not null default '';
alter table public.riders add column if not exists account_number text not null default '';
alter table public.riders add column if not exists baemin_id text not null default '';
alter table public.riders add column if not exists platform_coupang boolean not null default true;
alter table public.riders add column if not exists platform_baemin boolean not null default false;
alter table public.riders add column if not exists long_event_item_id text not null default '';
alter table public.riders add column if not exists long_event_item text not null default '';
alter table public.riders add column if not exists long_event_start_date date;
alter table public.riders add column if not exists long_event_platform text not null default 'coupang';
alter table public.riders add column if not exists join_date date;
alter table public.riders add column if not exists status text not null default '근무중';
alter table public.riders add column if not exists memo text not null default '';
alter table public.riders add column if not exists hidden_fields jsonb not null default '{}'::jsonb;
alter table public.riders add column if not exists promotion_selector_coupang text not null default '';
alter table public.riders add column if not exists promotion_selector_baemin text not null default '';
alter table public.riders add column if not exists promotion_rule_id_coupang text not null default '';
alter table public.riders add column if not exists promotion_rule_id_baemin text not null default '';
alter table public.riders add column if not exists raw_data jsonb not null default '{}'::jsonb;
alter table public.riders add column if not exists created_at timestamptz not null default now();
alter table public.riders add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- 2) 미션 연결 컬럼 (missions_migration.sql)
-- ---------------------------------------------------------------------------
alter table public.riders add column if not exists selected_mission_id text not null default '';
alter table public.riders add column if not exists selected_mission_id_baemin text not null default '';
alter table public.riders add column if not exists selected_mission_id_coupang text not null default '';

create index if not exists idx_brem_riders_selected_mission on public.riders (selected_mission_id);
create index if not exists idx_brem_riders_mission_baemin on public.riders (selected_mission_id_baemin);
create index if not exists idx_brem_riders_mission_coupang on public.riders (selected_mission_id_coupang);

-- ---------------------------------------------------------------------------
-- 3) 기존 행 기본값 보정 (null 방지)
-- ---------------------------------------------------------------------------
update public.riders
set long_event_platform = 'coupang'
where long_event_platform is null or btrim(long_event_platform) = '';

-- ---------------------------------------------------------------------------
-- 4) 스키마 점검 (누락 컬럼 확인 — 결과 0행이면 OK)
-- ---------------------------------------------------------------------------
with expected(column_name) as (
  values
    ('id'),
    ('auth_user_id'),
    ('name'),
    ('phone'),
    ('resident_number'),
    ('bank_name'),
    ('account_holder'),
    ('account_number'),
    ('baemin_id'),
    ('platform_coupang'),
    ('platform_baemin'),
    ('long_event_item_id'),
    ('long_event_item'),
    ('long_event_start_date'),
    ('long_event_platform'),
    ('join_date'),
    ('status'),
    ('memo'),
    ('hidden_fields'),
    ('promotion_selector_coupang'),
    ('promotion_selector_baemin'),
    ('promotion_rule_id_coupang'),
    ('promotion_rule_id_baemin'),
    ('selected_mission_id'),
    ('selected_mission_id_baemin'),
    ('selected_mission_id_coupang'),
    ('raw_data'),
    ('created_at'),
    ('updated_at')
)
select e.column_name as missing_column
from expected e
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = 'riders'
 and c.column_name = e.column_name
where c.column_name is null
order by e.column_name;

-- ---------------------------------------------------------------------------
-- 5) PostgREST / Supabase API 스키마 캐시 새로고침 (필수 — ALTER 후 마지막에 실행)
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- 확인용 (선택):
-- select column_name, data_type, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'riders'
-- order by ordinal_position;
