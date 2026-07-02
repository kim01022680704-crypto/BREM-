-- BREM: admin_rejection_rates — ERP 일괄등록 상세 통계 (거절/취소/완료 건수)
-- Supabase SQL Editor에서 operations_tables_migration.sql 이후 실행

alter table public.admin_rejection_rates
  add column if not exists stats jsonb not null default '{}'::jsonb;

alter table public.admin_rejection_rates
  add column if not exists source text not null default 'manual';

comment on column public.admin_rejection_rates.stats is
  'coupang: rejectCount,cancelCount,completeCount,unmeasured | baemin: completeTotal,rejectCount,dispatchCancelCount,riderCancelCount,rejectByService,dispatchCancelByService,riderFaultByService,unmeasured';

-- 라이더 본인 주간 거절/수락율 조회 (기사앱)
drop policy if exists "admin_rejection_rates rider read own" on public.admin_rejection_rates;
create policy "admin_rejection_rates rider read own"
  on public.admin_rejection_rates for select
  using (
    public.brem_is_admin()
    or driver_id = public.brem_current_rider_id()
  );
