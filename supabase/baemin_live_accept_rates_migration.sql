-- =============================================================================
-- BREM baemin_live_accept_rates_migration.sql
-- 배민 BIZ 수집 기반 실시간 수락율 저장 + 거절율(수락율) 안전 반영
--
-- Supabase SQL Editor에서 1회 실행
-- 선행: operations_tables_migration.sql (권장: rejection_stats_migration.sql)
--
-- 안전 규칙:
--   · 로그인 / profiles / riders 스키마 / admin_login* 절대 변경 없음
--   · 기존 admin_rejection_rates 행 DELETE 없음
--   · source = manual / erp-bulk 등 수동·ERP 행은 덮어쓰지 않음
--   · source = baemin_biz_live 이거나 행이 없을 때만 upsert
--   · admin_calls(콜수)는 이번 마이그레이션에서 건드리지 않음
-- =============================================================================

-- 거절율 반영에 필요한 컬럼만 안전하게 보강 (없으면 추가, 있으면 없음)
alter table public.admin_rejection_rates
  add column if not exists stats jsonb not null default '{}'::jsonb;

alter table public.admin_rejection_rates
  add column if not exists source text not null default 'manual';

create or replace function public.brem_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 수락율 계산 (푸드만)
-- 100 - (거절푸드+배차취소푸드+배달취소라이더귀책푸드)
--     / (완료+거절푸드+배차취소푸드+배달취소라이더귀책푸드) * 100
-- ---------------------------------------------------------------------------
create or replace function public.brem_calc_baemin_food_accept_rate(
  p_complete numeric,
  p_food_reject numeric,
  p_food_cancel numeric,
  p_food_rider_fault numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_complete, 0) + coalesce(p_food_reject, 0)
       + coalesce(p_food_cancel, 0) + coalesce(p_food_rider_fault, 0) <= 0
      then null
    else round(
      (
        100
        - (
          (coalesce(p_food_reject, 0) + coalesce(p_food_cancel, 0) + coalesce(p_food_rider_fault, 0))
          / (
            coalesce(p_complete, 0) + coalesce(p_food_reject, 0)
            + coalesce(p_food_cancel, 0) + coalesce(p_food_rider_fault, 0)
          )
          * 100
        )
      )::numeric
    , 1)
  end;
$$;

comment on function public.brem_calc_baemin_food_accept_rate(numeric, numeric, numeric, numeric) is
  '배민 푸드 기준 수락율(%). 분모 0이면 null.';

-- ---------------------------------------------------------------------------
-- 실시간 수락율 스냅샷 테이블
-- ---------------------------------------------------------------------------
create table if not exists public.baemin_live_accept_rates (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  partner_id text not null default '',
  rider_user_id text not null default '',
  rider_name text not null default '',
  phone_number text not null default '',
  driver_id text not null default '',

  past_from date,
  past_to date,
  past_complete integer not null default 0,
  past_food_reject integer not null default 0,
  past_food_cancel integer not null default 0,
  past_food_rider_fault integer not null default 0,
  past_accept_rate numeric,

  live_complete integer not null default 0,
  live_food_reject integer not null default 0,
  live_food_cancel integer not null default 0,
  live_food_rider_fault integer not null default 0,

  current_complete integer not null default 0,
  current_food_reject integer not null default 0,
  current_food_cancel integer not null default 0,
  current_food_rider_fault integer not null default 0,
  current_accept_rate numeric,

  source_capture_date date,
  synced_to_rejection_at timestamptz,
  meta_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint baemin_live_accept_rates_uniq
    unique (week_start, partner_id, rider_user_id)
);

alter table public.baemin_live_accept_rates
  add column if not exists week_start date;
alter table public.baemin_live_accept_rates
  add column if not exists partner_id text not null default '';
alter table public.baemin_live_accept_rates
  add column if not exists rider_user_id text not null default '';
alter table public.baemin_live_accept_rates
  add column if not exists rider_name text not null default '';
alter table public.baemin_live_accept_rates
  add column if not exists phone_number text not null default '';
alter table public.baemin_live_accept_rates
  add column if not exists driver_id text not null default '';
alter table public.baemin_live_accept_rates
  add column if not exists past_from date;
alter table public.baemin_live_accept_rates
  add column if not exists past_to date;
alter table public.baemin_live_accept_rates
  add column if not exists past_complete integer not null default 0;
alter table public.baemin_live_accept_rates
  add column if not exists past_food_reject integer not null default 0;
alter table public.baemin_live_accept_rates
  add column if not exists past_food_cancel integer not null default 0;
alter table public.baemin_live_accept_rates
  add column if not exists past_food_rider_fault integer not null default 0;
alter table public.baemin_live_accept_rates
  add column if not exists past_accept_rate numeric;
alter table public.baemin_live_accept_rates
  add column if not exists live_complete integer not null default 0;
alter table public.baemin_live_accept_rates
  add column if not exists live_food_reject integer not null default 0;
alter table public.baemin_live_accept_rates
  add column if not exists live_food_cancel integer not null default 0;
alter table public.baemin_live_accept_rates
  add column if not exists live_food_rider_fault integer not null default 0;
alter table public.baemin_live_accept_rates
  add column if not exists current_complete integer not null default 0;
alter table public.baemin_live_accept_rates
  add column if not exists current_food_reject integer not null default 0;
alter table public.baemin_live_accept_rates
  add column if not exists current_food_cancel integer not null default 0;
alter table public.baemin_live_accept_rates
  add column if not exists current_food_rider_fault integer not null default 0;
alter table public.baemin_live_accept_rates
  add column if not exists current_accept_rate numeric;
alter table public.baemin_live_accept_rates
  add column if not exists source_capture_date date;
alter table public.baemin_live_accept_rates
  add column if not exists synced_to_rejection_at timestamptz;
alter table public.baemin_live_accept_rates
  add column if not exists meta_json jsonb not null default '{}'::jsonb;
alter table public.baemin_live_accept_rates
  add column if not exists created_at timestamptz not null default now();
alter table public.baemin_live_accept_rates
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_baemin_live_accept_rates_week
  on public.baemin_live_accept_rates (week_start desc);

create index if not exists idx_baemin_live_accept_rates_rider
  on public.baemin_live_accept_rates (rider_user_id);

create index if not exists idx_baemin_live_accept_rates_driver
  on public.baemin_live_accept_rates (driver_id);

create index if not exists idx_baemin_live_accept_rates_partner_week
  on public.baemin_live_accept_rates (partner_id, week_start desc);

drop trigger if exists trg_baemin_live_accept_rates_updated_at
  on public.baemin_live_accept_rates;
create trigger trg_baemin_live_accept_rates_updated_at
before update on public.baemin_live_accept_rates
for each row execute function public.brem_set_updated_at();

alter table public.baemin_live_accept_rates enable row level security;

drop policy if exists brem_service_baemin_live_accept_rates
  on public.baemin_live_accept_rates;
create policy brem_service_baemin_live_accept_rates
  on public.baemin_live_accept_rates
  for all
  using (false)
  with check (false);

comment on table public.baemin_live_accept_rates is
  '배민 BIZ 수집 기반 실시간 수락율(과거=수~전일, 현재=과거+배달현황 최신). 서버 service role만 접근.';

-- ---------------------------------------------------------------------------
-- 스냅샷 upsert (서버에서 계산 결과 JSON 배열 저장)
-- 기존 행 삭제 없이 on conflict update
-- ---------------------------------------------------------------------------
create or replace function public.brem_upsert_baemin_live_accept_rates(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  upserted integer := 0;
  skipped integer := 0;
  v_week date;
  v_partner text;
  v_rider text;
  v_past_rate numeric;
  v_current_rate numeric;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'message', 'p_rows must be a JSON array');
  end if;

  for item in select * from jsonb_array_elements(p_rows)
  loop
    v_week := nullif(item->>'weekStart', '')::date;
    v_partner := coalesce(nullif(trim(item->>'partnerId'), ''), '');
    v_rider := coalesce(nullif(trim(item->>'riderUserId'), ''), '');

    if v_week is null or v_rider = '' then
      skipped := skipped + 1;
      continue;
    end if;

    v_past_rate := coalesce(
      nullif(item->>'pastAcceptRate', '')::numeric,
      public.brem_calc_baemin_food_accept_rate(
        coalesce(nullif(item->>'pastComplete', '')::numeric, 0),
        coalesce(nullif(item->>'pastFoodReject', '')::numeric, 0),
        coalesce(nullif(item->>'pastFoodCancel', '')::numeric, 0),
        coalesce(nullif(item->>'pastFoodRiderFault', '')::numeric, 0)
      )
    );

    v_current_rate := coalesce(
      nullif(item->>'currentAcceptRate', '')::numeric,
      public.brem_calc_baemin_food_accept_rate(
        coalesce(nullif(item->>'currentComplete', '')::numeric, 0),
        coalesce(nullif(item->>'currentFoodReject', '')::numeric, 0),
        coalesce(nullif(item->>'currentFoodCancel', '')::numeric, 0),
        coalesce(nullif(item->>'currentFoodRiderFault', '')::numeric, 0)
      )
    );

    insert into public.baemin_live_accept_rates (
      week_start, partner_id, rider_user_id, rider_name, phone_number, driver_id,
      past_from, past_to,
      past_complete, past_food_reject, past_food_cancel, past_food_rider_fault, past_accept_rate,
      live_complete, live_food_reject, live_food_cancel, live_food_rider_fault,
      current_complete, current_food_reject, current_food_cancel, current_food_rider_fault, current_accept_rate,
      source_capture_date, meta_json, updated_at
    ) values (
      v_week,
      v_partner,
      v_rider,
      coalesce(nullif(trim(item->>'riderName'), ''), ''),
      coalesce(nullif(trim(item->>'phoneNumber'), ''), ''),
      coalesce(nullif(trim(item->>'driverId'), ''), ''),
      nullif(item->>'pastFrom', '')::date,
      nullif(item->>'pastTo', '')::date,
      greatest(0, coalesce(nullif(item->>'pastComplete', '')::integer, 0)),
      greatest(0, coalesce(nullif(item->>'pastFoodReject', '')::integer, 0)),
      greatest(0, coalesce(nullif(item->>'pastFoodCancel', '')::integer, 0)),
      greatest(0, coalesce(nullif(item->>'pastFoodRiderFault', '')::integer, 0)),
      v_past_rate,
      greatest(0, coalesce(nullif(item->>'liveComplete', '')::integer, 0)),
      greatest(0, coalesce(nullif(item->>'liveFoodReject', '')::integer, 0)),
      greatest(0, coalesce(nullif(item->>'liveFoodCancel', '')::integer, 0)),
      greatest(0, coalesce(nullif(item->>'liveFoodRiderFault', '')::integer, 0)),
      greatest(0, coalesce(nullif(item->>'currentComplete', '')::integer, 0)),
      greatest(0, coalesce(nullif(item->>'currentFoodReject', '')::integer, 0)),
      greatest(0, coalesce(nullif(item->>'currentFoodCancel', '')::integer, 0)),
      greatest(0, coalesce(nullif(item->>'currentFoodRiderFault', '')::integer, 0)),
      v_current_rate,
      nullif(item->>'sourceCaptureDate', '')::date,
      case
        when item->'meta' is not null and jsonb_typeof(item->'meta') = 'object' then item->'meta'
        else '{}'::jsonb
      end,
      now()
    )
    on conflict (week_start, partner_id, rider_user_id) do update set
      rider_name = excluded.rider_name,
      phone_number = excluded.phone_number,
      driver_id = case
        when excluded.driver_id <> '' then excluded.driver_id
        else public.baemin_live_accept_rates.driver_id
      end,
      past_from = excluded.past_from,
      past_to = excluded.past_to,
      past_complete = excluded.past_complete,
      past_food_reject = excluded.past_food_reject,
      past_food_cancel = excluded.past_food_cancel,
      past_food_rider_fault = excluded.past_food_rider_fault,
      past_accept_rate = excluded.past_accept_rate,
      live_complete = excluded.live_complete,
      live_food_reject = excluded.live_food_reject,
      live_food_cancel = excluded.live_food_cancel,
      live_food_rider_fault = excluded.live_food_rider_fault,
      current_complete = excluded.current_complete,
      current_food_reject = excluded.current_food_reject,
      current_food_cancel = excluded.current_food_cancel,
      current_food_rider_fault = excluded.current_food_rider_fault,
      current_accept_rate = excluded.current_accept_rate,
      source_capture_date = excluded.source_capture_date,
      meta_json = excluded.meta_json,
      updated_at = now();

    upserted := upserted + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'upserted', upserted,
    'skipped', skipped
  );
end;
$$;

revoke all on function public.brem_upsert_baemin_live_accept_rates(jsonb) from public;
grant execute on function public.brem_upsert_baemin_live_accept_rates(jsonb) to service_role;

comment on function public.brem_upsert_baemin_live_accept_rates(jsonb) is
  '배민 실시간 수락율 스냅샷 upsert. service_role 전용. 기존 행 삭제 없음.';

-- ---------------------------------------------------------------------------
-- admin_rejection_rates 안전 반영
-- · driver_id 매칭된 행만
-- · current_accept_rate 사용 (수~현재)
-- · manual / erp-bulk 등 보호, baemin_biz_live 만 갱신
-- · DELETE 없음, rider_published_at 은 신규 insert 시 null
-- ---------------------------------------------------------------------------
create or replace function public.brem_sync_baemin_live_accept_to_rejection_rates(
  p_week_start date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_id text;
  v_synced integer := 0;
  v_skipped_no_driver integer := 0;
  v_skipped_protected integer := 0;
  v_skipped_null_rate integer := 0;
  v_existing_source text;
  v_stats jsonb;
begin
  if to_regclass('public.admin_rejection_rates') is null then
    return jsonb_build_object(
      'ok', false,
      'message', 'admin_rejection_rates table missing — run operations_tables_migration.sql first'
    );
  end if;

  for r in
    select *
    from public.baemin_live_accept_rates
    where (p_week_start is null or week_start = p_week_start)
  loop
    if coalesce(nullif(trim(r.driver_id), ''), '') = '' then
      v_skipped_no_driver := v_skipped_no_driver + 1;
      continue;
    end if;

    if r.current_accept_rate is null then
      v_skipped_null_rate := v_skipped_null_rate + 1;
      continue;
    end if;

    v_id := r.driver_id || '-' || r.week_start::text || '-baemin';

    v_existing_source := null;
    select coalesce(nullif(trim(arr.source), ''), 'manual')
      into v_existing_source
    from public.admin_rejection_rates arr
    where arr.id = v_id;

    -- 행이 있고 source 가 baemin_biz_live 가 아니면 보호 (manual / erp-bulk 등)
    if v_existing_source is not null and v_existing_source is distinct from 'baemin_biz_live' then
      v_skipped_protected := v_skipped_protected + 1;
      continue;
    end if;

    v_stats := jsonb_build_object(
      'completeTotal', r.current_complete,
      'rejectCount', r.current_food_reject,
      'dispatchCancelCount', r.current_food_cancel,
      'riderCancelCount', r.current_food_rider_fault,
      'rejectByService', jsonb_build_object('food', r.current_food_reject),
      'dispatchCancelByService', jsonb_build_object('food', r.current_food_cancel),
      'riderFaultByService', jsonb_build_object('food', r.current_food_rider_fault),
      'pastAcceptRate', r.past_accept_rate,
      'currentAcceptRate', r.current_accept_rate,
      'pastComplete', r.past_complete,
      'liveComplete', r.live_complete,
      'pastFrom', r.past_from,
      'pastTo', r.past_to,
      'partnerId', r.partner_id,
      'riderUserId', r.rider_user_id,
      'sourceCaptureDate', r.source_capture_date,
      'unmeasured', false
    );

    if v_existing_source is null then
      -- 신규만 insert (rider_published_at 컬럼이 있어도 기본 null → 앱 미공개)
      insert into public.admin_rejection_rates (
        id, driver_id, week_start, platform, rate, stats, source, updated_at
      ) values (
        v_id,
        r.driver_id,
        r.week_start,
        'baemin',
        r.current_accept_rate,
        v_stats,
        'baemin_biz_live',
        now()
      );
    else
      -- baemin_biz_live 만 갱신. rider_published_at / 기타 컬럼 유지
      update public.admin_rejection_rates
      set
        driver_id = r.driver_id,
        week_start = r.week_start,
        platform = 'baemin',
        rate = r.current_accept_rate,
        stats = v_stats,
        source = 'baemin_biz_live',
        updated_at = now()
      where id = v_id
        and source = 'baemin_biz_live';
    end if;

    update public.baemin_live_accept_rates
    set synced_to_rejection_at = now(),
        updated_at = now()
    where id = r.id;

    v_synced := v_synced + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'synced', v_synced,
    'skippedNoDriver', v_skipped_no_driver,
    'skippedProtected', v_skipped_protected,
    'skippedNullRate', v_skipped_null_rate,
    'weekStart', p_week_start
  );
end;
$$;

revoke all on function public.brem_sync_baemin_live_accept_to_rejection_rates(date) from public;
grant execute on function public.brem_sync_baemin_live_accept_to_rejection_rates(date) to service_role;

comment on function public.brem_sync_baemin_live_accept_to_rejection_rates(date) is
  '실시간 수락율 → admin_rejection_rates 안전 반영. manual/erp-bulk 보호. DELETE 없음. service_role 전용.';

notify pgrst, 'reload schema';
