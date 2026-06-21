-- =============================================================================
-- STEP 2 — RLS + settings JSON → 테이블 데이터 이관
-- STEP 1 (4개 true) 후 Supabase SQL Editor → 전체 복사 → Run
-- settings 행은 삭제하지 않음 (백업 유지)
-- =============================================================================

-- weekly_settlements 레거시 컬럼 보강 (region_name → region 등)
alter table public.weekly_settlements add column if not exists region text not null default '';
alter table public.weekly_settlements add column if not exists file_name text not null default '';
alter table public.weekly_settlements add column if not exists base_settlement_date date;
alter table public.weekly_settlements add column if not exists start_date date;
alter table public.weekly_settlements add column if not exists end_date date;
alter table public.weekly_settlements add column if not exists payment_date date;
alter table public.weekly_settlements add column if not exists settlement_week_label text not null default '';
alter table public.weekly_settlements add column if not exists matched_names_label text not null default '';
alter table public.weekly_settlements add column if not exists summary jsonb not null default '{}'::jsonb;
alter table public.weekly_settlements add column if not exists riders jsonb not null default '[]'::jsonb;
alter table public.weekly_settlements add column if not exists uploaded_at timestamptz not null default now();
alter table public.weekly_settlements add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_settlements'
      and column_name = 'region_name'
  ) then
    execute $sql$
      update public.weekly_settlements
      set region = region_name
      where coalesce(region, '') = '' and coalesce(region_name, '') <> ''
    $sql$;
  end if;
end $$;

alter table public.daily_settlements enable row level security;
alter table public.weekly_settlements enable row level security;
alter table public.settlement_upload_logs enable row level security;
alter table public.settlement_unmatched enable row level security;

drop policy if exists "daily_settlements admin all" on public.daily_settlements;
create policy "daily_settlements admin all"
  on public.daily_settlements for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

drop policy if exists "weekly_settlements admin all" on public.weekly_settlements;
create policy "weekly_settlements admin all"
  on public.weekly_settlements for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

drop policy if exists "settlement_upload_logs admin all" on public.settlement_upload_logs;
create policy "settlement_upload_logs admin all"
  on public.settlement_upload_logs for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

drop policy if exists "settlement_unmatched admin all" on public.settlement_unmatched;
create policy "settlement_unmatched admin all"
  on public.settlement_unmatched for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

-- settings JSON → daily_settlements
do $$
declare raw jsonb; item jsonb;
begin
  select value into raw from public.settings where key = 'brem_admin_settlements';
  if raw is not null and jsonb_typeof(raw) = 'array' then
    for item in select * from jsonb_array_elements(raw) loop
      if coalesce(item->>'id', '') = '' then continue; end if;
      insert into public.daily_settlements (
        id, driver_id, period, platform, rider_id,
        order_count, delivery_amount, settlement_amount, applied_at, updated_at
      ) values (
        item->>'id',
        coalesce(item->>'driverId', ''),
        nullif(item->>'period', '')::date,
        coalesce(nullif(item->>'platform', ''), 'coupang'),
        coalesce(item->>'riderId', ''),
        coalesce(nullif(item->>'orderCount', '')::integer, nullif(item->>'callCount', '')::integer, 0),
        coalesce(nullif(item->>'deliveryAmount', '')::numeric, nullif(item->>'settlementAmount', '')::numeric, 0),
        coalesce(nullif(item->>'settlementAmount', '')::numeric, nullif(item->>'deliveryAmount', '')::numeric, 0),
        coalesce(nullif(item->>'appliedAt', '')::timestamptz, now()),
        coalesce(nullif(item->>'appliedAt', '')::timestamptz, now())
      ) on conflict (id) do update set
        driver_id = excluded.driver_id, period = excluded.period, platform = excluded.platform,
        rider_id = excluded.rider_id, order_count = excluded.order_count,
        delivery_amount = excluded.delivery_amount, settlement_amount = excluded.settlement_amount,
        applied_at = excluded.applied_at, updated_at = excluded.updated_at;
    end loop;
  end if;
end $$;

-- settings JSON → weekly_settlements
do $$
declare raw jsonb; item jsonb;
begin
  select value into raw from public.settings where key = 'brem_admin_weekly_settlements';
  if raw is not null and jsonb_typeof(raw) = 'array' then
    for item in select * from jsonb_array_elements(raw) loop
      if coalesce(item->>'id', '') = '' then continue; end if;
      insert into public.weekly_settlements (
        id, platform, region, file_name, base_settlement_date, start_date, end_date,
        payment_date, settlement_week_label, matched_names_label, summary, riders,
        uploaded_at, updated_at
      ) values (
        item->>'id',
        coalesce(nullif(item->>'platform', ''), 'coupang'),
        coalesce(item->>'region', ''),
        coalesce(item->>'fileName', ''),
        nullif(item->>'baseSettlementDate', '')::date,
        nullif(item->>'startDate', '')::date,
        nullif(item->>'endDate', '')::date,
        nullif(item->>'paymentDate', '')::date,
        coalesce(item->>'settlementWeekLabel', ''),
        coalesce(item->>'matchedNamesLabel', ''),
        coalesce(item->'summary', '{}'::jsonb),
        coalesce(item->'riders', '[]'::jsonb),
        coalesce(nullif(item->>'uploadedAt', '')::timestamptz, now()),
        coalesce(nullif(item->>'uploadedAt', '')::timestamptz, now())
      ) on conflict (id) do update set
        platform = excluded.platform, region = excluded.region, file_name = excluded.file_name,
        base_settlement_date = excluded.base_settlement_date, start_date = excluded.start_date,
        end_date = excluded.end_date, payment_date = excluded.payment_date,
        settlement_week_label = excluded.settlement_week_label,
        matched_names_label = excluded.matched_names_label, summary = excluded.summary,
        riders = excluded.riders, uploaded_at = excluded.uploaded_at, updated_at = excluded.updated_at;
    end loop;
  end if;
end $$;

-- settings JSON → settlement_upload_logs
do $$
declare raw jsonb; item jsonb;
begin
  select value into raw from public.settings where key = 'brem_admin_settlement_upload_logs';
  if raw is not null and jsonb_typeof(raw) = 'array' then
    for item in select * from jsonb_array_elements(raw) loop
      if coalesce(item->>'id', '') = '' then continue; end if;
      insert into public.settlement_upload_logs (
        id, kind, platform, file_name, period, week_start, week_end, region,
        start_date, end_date, status, matched_count, unmatched_count,
        total_delivery_amount, total_order_count, content_hash,
        matched_records, unmatched_records, applied_records,
        duplicate_of_log_id, skip_reason, linked_record_id,
        uploaded_at, applied_at, updated_at
      ) values (
        item->>'id',
        coalesce(nullif(item->>'kind', ''), 'daily'),
        coalesce(nullif(item->>'platform', ''), 'coupang'),
        coalesce(item->>'fileName', ''),
        nullif(item->>'period', '')::date,
        nullif(item->>'weekStart', '')::date,
        nullif(item->>'weekEnd', '')::date,
        coalesce(item->>'region', ''),
        nullif(item->>'startDate', '')::date,
        nullif(item->>'endDate', '')::date,
        coalesce(item->>'status', 'uploaded'),
        coalesce(nullif(item->>'matchedCount', '')::integer, 0),
        coalesce(nullif(item->>'unmatchedCount', '')::integer, 0),
        coalesce(nullif(item->>'totalDeliveryAmount', '')::numeric, 0),
        coalesce(nullif(item->>'totalOrderCount', '')::integer, 0),
        coalesce(item->>'contentHash', ''),
        coalesce(item->'matchedRecords', '[]'::jsonb),
        coalesce(item->'unmatchedRecords', '[]'::jsonb),
        coalesce(item->'appliedRecords', '[]'::jsonb),
        coalesce(item->>'duplicateOfLogId', ''),
        coalesce(item->>'skipReason', ''),
        coalesce(item->>'linkedRecordId', ''),
        coalesce(nullif(item->>'uploadedAt', '')::timestamptz, now()),
        nullif(item->>'appliedAt', '')::timestamptz,
        coalesce(nullif(item->>'updatedAt', '')::timestamptz, nullif(item->>'uploadedAt', '')::timestamptz, now())
      ) on conflict (id) do update set
        kind = excluded.kind, platform = excluded.platform, file_name = excluded.file_name,
        period = excluded.period, week_start = excluded.week_start, week_end = excluded.week_end,
        region = excluded.region, start_date = excluded.start_date, end_date = excluded.end_date,
        status = excluded.status, matched_count = excluded.matched_count,
        unmatched_count = excluded.unmatched_count, total_delivery_amount = excluded.total_delivery_amount,
        total_order_count = excluded.total_order_count, content_hash = excluded.content_hash,
        matched_records = excluded.matched_records, unmatched_records = excluded.unmatched_records,
        applied_records = excluded.applied_records, duplicate_of_log_id = excluded.duplicate_of_log_id,
        skip_reason = excluded.skip_reason, linked_record_id = excluded.linked_record_id,
        uploaded_at = excluded.uploaded_at, applied_at = excluded.applied_at, updated_at = excluded.updated_at;
    end loop;
  end if;
end $$;

-- settings JSON → settlement_unmatched
do $$
declare raw jsonb; item jsonb;
begin
  select value into raw from public.settings where key = 'brem_admin_settlement_unmatched';
  if raw is not null and jsonb_typeof(raw) = 'array' then
    for item in select * from jsonb_array_elements(raw) loop
      if coalesce(item->>'id', '') = '' then continue; end if;
      insert into public.settlement_unmatched (
        id, kind, platform, week_start, period, end_date, region,
        raw_name, name, rider_id, order_count, delivery_amount, settlement_amount,
        coupang_login_key, baemin_user_id, match_payload, source_file_name, saved_at, updated_at
      ) values (
        item->>'id',
        coalesce(nullif(item->>'kind', ''), 'daily'),
        coalesce(nullif(item->>'platform', ''), 'coupang'),
        coalesce(nullif(item->>'weekStart', '')::date, nullif(item->>'period', '')::date, current_date),
        coalesce(nullif(item->>'period', '')::date, current_date),
        nullif(item->>'endDate', '')::date,
        coalesce(item->>'region', ''),
        coalesce(item->>'rawName', item->>'name', ''),
        coalesce(item->>'name', item->>'rawName', ''),
        coalesce(item->>'riderId', ''),
        coalesce(nullif(item->>'orderCount', '')::integer, 0),
        coalesce(nullif(item->>'deliveryAmount', '')::numeric, 0),
        coalesce(nullif(item->>'settlementAmount', '')::numeric, 0),
        coalesce(item->>'coupangLoginKey', ''),
        coalesce(item->>'baeminUserId', ''),
        coalesce(item->'matchPayload', '{}'::jsonb),
        coalesce(item->>'sourceFileName', ''),
        coalesce(nullif(item->>'savedAt', '')::timestamptz, now()),
        coalesce(nullif(item->>'savedAt', '')::timestamptz, now())
      ) on conflict (id) do update set
        kind = excluded.kind, platform = excluded.platform, week_start = excluded.week_start,
        period = excluded.period, end_date = excluded.end_date, region = excluded.region,
        raw_name = excluded.raw_name, name = excluded.name, rider_id = excluded.rider_id,
        order_count = excluded.order_count, delivery_amount = excluded.delivery_amount,
        settlement_amount = excluded.settlement_amount, coupang_login_key = excluded.coupang_login_key,
        baemin_user_id = excluded.baemin_user_id, match_payload = excluded.match_payload,
        source_file_name = excluded.source_file_name, saved_at = excluded.saved_at,
        updated_at = excluded.updated_at;
    end loop;
  end if;
end $$;

-- 이관 결과 확인 (건수 0이어도 에러는 아님 — settings에 데이터 없으면 0)
select 'daily_settlements' as 테이블, count(*)::bigint as 건수 from public.daily_settlements
union all select 'weekly_settlements', count(*) from public.weekly_settlements
union all select 'settlement_upload_logs', count(*) from public.settlement_upload_logs
union all select 'settlement_unmatched', count(*) from public.settlement_unmatched
order by 1;

notify pgrst, 'reload schema';
