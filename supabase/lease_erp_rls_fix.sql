-- BREM 리스 ERP — RLS 정책 재적용 (차량 저장 오류 시)
-- SQL Editor에서 1회 실행

drop policy if exists "lease_vehicles admin all" on public.lease_vehicles;
create policy "lease_vehicles admin all" on public.lease_vehicles
  for all using (public.brem_is_admin()) with check (public.brem_is_admin());

drop policy if exists "lease_contracts admin all" on public.lease_contracts;
create policy "lease_contracts admin all" on public.lease_contracts
  for all using (public.brem_is_admin()) with check (public.brem_is_admin());

drop policy if exists "lease_payments admin all" on public.lease_payments;
create policy "lease_payments admin all" on public.lease_payments
  for all using (public.brem_is_admin()) with check (public.brem_is_admin());

drop policy if exists "lease_accidents admin all" on public.lease_accidents;
create policy "lease_accidents admin all" on public.lease_accidents
  for all using (public.brem_is_admin()) with check (public.brem_is_admin());

drop policy if exists "lease_maintenance admin all" on public.lease_maintenance;
create policy "lease_maintenance admin all" on public.lease_maintenance
  for all using (public.brem_is_admin()) with check (public.brem_is_admin());

drop policy if exists "lease_profit_logs admin all" on public.lease_profit_logs;
create policy "lease_profit_logs admin all" on public.lease_profit_logs
  for all using (public.brem_is_admin()) with check (public.brem_is_admin());

drop policy if exists "lease_arrears admin all" on public.lease_arrears;
create policy "lease_arrears admin all" on public.lease_arrears
  for all using (public.brem_is_admin()) with check (public.brem_is_admin());

notify pgrst, 'reload schema';
