-- 콜수·월간목표: 기사앱 공개 시각 (관리자 「라이더 앱 반영」 전까지 null)
alter table public.admin_calls add column if not exists rider_published_at timestamptz;
alter table public.admin_targets add column if not exists rider_published_at timestamptz;

create index if not exists admin_calls_rider_published_idx
  on public.admin_calls (rider_published_at);

create index if not exists admin_targets_rider_published_idx
  on public.admin_targets (rider_published_at);

-- 기존 데이터는 현재 공개 상태로 1회 백필 (이후 수정분만 반영 대기)
update public.admin_calls
set rider_published_at = coalesce(rider_published_at, updated_at, now())
where rider_published_at is null;

update public.admin_targets
set rider_published_at = coalesce(rider_published_at, updated_at, now())
where rider_published_at is null;

notify pgrst, 'reload schema';
