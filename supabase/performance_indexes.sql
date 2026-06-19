-- BREM performance indexes (SQL Editor에서 실행)
-- schema.sql 적용 후 이 파일을 추가 실행하세요.

create index if not exists idx_brem_riders_created_at on public.riders (created_at desc);
create index if not exists idx_brem_riders_platform_coupang on public.riders (platform_coupang);
create index if not exists idx_brem_riders_platform_baemin on public.riders (platform_baemin);
create index if not exists idx_brem_riders_status_created on public.riders (status, created_at desc);

create index if not exists idx_brem_notices_created_at on public.notices (created_at desc);
create index if not exists idx_brem_notices_pinned_active on public.notices (pinned desc, created_at desc);

create index if not exists idx_brem_promotions_created_at on public.promotions (created_at desc);
create index if not exists idx_brem_promotions_platform_created on public.promotions (platform, created_at desc);

create index if not exists idx_brem_settings_key on public.settings (key);

create index if not exists idx_brem_rider_inquiries_created_at on public.rider_inquiries (created_at desc);
