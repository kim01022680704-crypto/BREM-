-- admin_rejection_rates: 기사앱 공개 시각 (ERP 저장 후 관리자 「라이더 조회 반영」 전까지 NULL)
alter table public.admin_rejection_rates add column if not exists rider_published_at timestamptz;

update public.admin_rejection_rates
set rider_published_at = coalesce(rider_published_at, updated_at, now())
where rider_published_at is null;
