-- BREM 기여도 비소급 v3 원장
-- 기존 contribution_daily 데이터는 보존하며 이 원장과 합산하지 않는다.

create table if not exists public.contribution_ledger_events (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  platform text not null check (platform in ('baemin', 'coupang')),
  region text not null default '',
  vendor_or_partner text not null,
  slot_key text not null,
  rider_id text not null,
  name text not null default '',
  weighted_delta numeric not null default 0 check (weighted_delta >= 0),
  count_08 integer not null default 0 check (count_08 >= 0),
  count_10 integer not null default 0 check (count_10 >= 0),
  credited_calls numeric not null default 0 check (credited_calls >= 0),
  points numeric not null default 0,
  assigned_target numeric not null default 0,
  region_complete_before numeric not null default 0,
  region_complete_after numeric not null default 0,
  capture_key text not null,
  captured_at timestamptz not null,
  rule_version integer not null,
  rule_snapshot jsonb not null default '{}'::jsonb,
  estimated boolean not null default false,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint contribution_ledger_events_capture_rider_uniq
    unique (date, platform, vendor_or_partner, slot_key, capture_key, rider_id)
);

create table if not exists public.contribution_slot_states (
  date date not null,
  platform text not null check (platform in ('baemin', 'coupang')),
  region text not null default '',
  vendor_or_partner text not null,
  slot_key text not null,
  rider_totals jsonb not null default '{}'::jsonb,
  last_capture_key text,
  last_captured_at timestamptz,
  region_complete numeric not null default 0,
  assigned_target numeric not null default 0,
  region_complete_reached boolean not null default false,
  frozen boolean not null default false,
  frozen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (date, platform, vendor_or_partner, slot_key)
);

create index if not exists idx_contribution_ledger_events_daily
  on public.contribution_ledger_events (date, platform, region, slot_key);
create index if not exists idx_contribution_ledger_events_rider
  on public.contribution_ledger_events (date, rider_id);
create index if not exists idx_contribution_ledger_events_capture
  on public.contribution_ledger_events (capture_key);
create index if not exists idx_contribution_slot_states_daily
  on public.contribution_slot_states (date, platform, region, slot_key, frozen);

alter table public.contribution_ledger_events enable row level security;
alter table public.contribution_slot_states enable row level security;

-- service_role은 RLS를 우회한다. anon/authenticated에는 정책을 만들지 않아 직접 접근을 차단한다.
drop policy if exists brem_service_contribution_ledger_events
  on public.contribution_ledger_events;
create policy brem_service_contribution_ledger_events
  on public.contribution_ledger_events for all using (false) with check (false);
drop policy if exists brem_service_contribution_slot_states
  on public.contribution_slot_states;
create policy brem_service_contribution_slot_states
  on public.contribution_slot_states for all using (false) with check (false);

revoke all on table public.contribution_ledger_events from anon, authenticated;
revoke all on table public.contribution_slot_states from anon, authenticated;
grant all on table public.contribution_ledger_events to service_role;
grant all on table public.contribution_slot_states to service_role;

-- 원장은 RPC만 쓰기 가능하게 한다. UPDATE/DELETE/TRUNCATE는 service_role에도 차단한다.
revoke update, delete, truncate on table public.contribution_ledger_events from service_role;

create or replace function public.brem_block_contribution_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'contribution_ledger_events is append-only';
end;
$$;

drop trigger if exists trg_contribution_events_append_only
  on public.contribution_ledger_events;
create trigger trg_contribution_events_append_only
before update or delete on public.contribution_ledger_events
for each row execute function public.brem_block_contribution_event_mutation();

create or replace function public.brem_record_contribution_capture_v3(
  p_state jsonb,
  p_events jsonb default '[]'::jsonb,
  p_expected_previous_capture_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.contribution_slot_states%rowtype;
  v_event jsonb;
  v_actual_previous text;
begin
  if coalesce(p_state->>'date', '') = ''
     or coalesce(p_state->>'platform', '') = ''
     or coalesce(p_state->>'vendor_or_partner', '') = ''
     or coalesce(p_state->>'slot_key', '') = '' then
    raise exception 'invalid contribution state identity';
  end if;

  -- 아직 state 행이 없는 첫 capture끼리도 직렬화해 lost update를 막는다.
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|',
      p_state->>'date',
      p_state->>'platform',
      p_state->>'vendor_or_partner',
      p_state->>'slot_key'
    ),
    0
  ));

  select *
    into v_existing
    from public.contribution_slot_states
   where date = (p_state->>'date')::date
     and platform = p_state->>'platform'
     and vendor_or_partner = p_state->>'vendor_or_partner'
     and slot_key = p_state->>'slot_key'
   for update;

  if found then
    v_actual_previous := v_existing.last_capture_key;
    if v_existing.frozen then
      return jsonb_build_object(
        'ok', true, 'recorded', 0, 'skipped', 'frozen',
        'lastCaptureKey', v_existing.last_capture_key
      );
    end if;
  else
    v_actual_previous := null;
  end if;

  if v_actual_previous is distinct from p_expected_previous_capture_key then
    return jsonb_build_object(
      'ok', false, 'conflict', true,
      'expectedPreviousCaptureKey', p_expected_previous_capture_key,
      'actualPreviousCaptureKey', v_actual_previous
    );
  end if;

  if found and v_existing.last_captured_at is not null
     and (p_state->>'last_captured_at')::timestamptz <= v_existing.last_captured_at then
    return jsonb_build_object(
      'ok', true, 'recorded', 0, 'skipped', 'duplicate_or_reverse',
      'lastCaptureKey', v_existing.last_capture_key
    );
  end if;

  for v_event in select value from jsonb_array_elements(coalesce(p_events, '[]'::jsonb))
  loop
    insert into public.contribution_ledger_events (
      date, platform, region, vendor_or_partner, slot_key, rider_id, name,
      weighted_delta, count_08, count_10, credited_calls, points,
      assigned_target, region_complete_before, region_complete_after,
      capture_key, captured_at, rule_version, rule_snapshot, estimated, raw_json
    ) values (
      (v_event->>'date')::date,
      v_event->>'platform',
      coalesce(v_event->>'region', ''),
      v_event->>'vendor_or_partner',
      v_event->>'slot_key',
      v_event->>'rider_id',
      coalesce(v_event->>'name', ''),
      coalesce((v_event->>'weighted_delta')::numeric, 0),
      coalesce((v_event->>'count_08')::integer, 0),
      coalesce((v_event->>'count_10')::integer, 0),
      coalesce((v_event->>'credited_calls')::numeric, 0),
      coalesce((v_event->>'points')::numeric, 0),
      coalesce((v_event->>'assigned_target')::numeric, 0),
      coalesce((v_event->>'region_complete_before')::numeric, 0),
      coalesce((v_event->>'region_complete_after')::numeric, 0),
      v_event->>'capture_key',
      (v_event->>'captured_at')::timestamptz,
      (v_event->>'rule_version')::integer,
      coalesce(v_event->'rule_snapshot', '{}'::jsonb),
      coalesce((v_event->>'estimated')::boolean, false),
      coalesce(v_event->'raw_json', '{}'::jsonb)
    ) on conflict do nothing;
  end loop;

  insert into public.contribution_slot_states (
    date, platform, region, vendor_or_partner, slot_key, rider_totals,
    last_capture_key, last_captured_at, region_complete, assigned_target,
    region_complete_reached, frozen, frozen_at, updated_at
  ) values (
    (p_state->>'date')::date,
    p_state->>'platform',
    coalesce(p_state->>'region', ''),
    p_state->>'vendor_or_partner',
    p_state->>'slot_key',
    coalesce(p_state->'rider_totals', '{}'::jsonb),
    p_state->>'last_capture_key',
    (p_state->>'last_captured_at')::timestamptz,
    coalesce((p_state->>'region_complete')::numeric, 0),
    coalesce((p_state->>'assigned_target')::numeric, 0),
    coalesce((p_state->>'region_complete_reached')::boolean, false),
    coalesce((p_state->>'frozen')::boolean, false),
    case when coalesce((p_state->>'frozen')::boolean, false)
      then coalesce((p_state->>'frozen_at')::timestamptz, (p_state->>'last_captured_at')::timestamptz)
      else null
    end,
    now()
  )
  on conflict (date, platform, vendor_or_partner, slot_key) do update set
    region = excluded.region,
    rider_totals = excluded.rider_totals,
    last_capture_key = excluded.last_capture_key,
    last_captured_at = excluded.last_captured_at,
    region_complete = excluded.region_complete,
    assigned_target = excluded.assigned_target,
    region_complete_reached = excluded.region_complete_reached,
    frozen = contribution_slot_states.frozen or excluded.frozen,
    frozen_at = coalesce(contribution_slot_states.frozen_at, excluded.frozen_at),
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'recorded', jsonb_array_length(coalesce(p_events, '[]'::jsonb)),
    'frozen', coalesce((p_state->>'frozen')::boolean, false),
    'lastCaptureKey', p_state->>'last_capture_key'
  );
end;
$$;

revoke all on function public.brem_record_contribution_capture_v3(jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.brem_record_contribution_capture_v3(jsonb, jsonb, text)
  to service_role;

comment on table public.contribution_ledger_events is
  '비소급 기여도 v3 append-only 이벤트 원장. contribution_daily와 합산하지 않는다.';
comment on table public.contribution_slot_states is
  '기여도 v3 지역+슬롯 캡처 상태 및 영구 동결 상태.';

notify pgrst, 'reload schema';
