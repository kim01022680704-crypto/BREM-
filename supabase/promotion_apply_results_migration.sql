-- 프로모션 적용 계산 결과 전용 테이블 (기존 settings JSON 유지 · 데이터 삭제 없음)
-- SQL Editor에서 1회 실행

create table if not exists public.promotion_apply_results (
  id text primary key,
  platform text not null default '',
  region text not null default '',
  settlement_kind text not null default 'weekly',
  week_start date,
  week_end date,
  settlement_label text not null default '',
  settlement_id text not null default '',
  coupang_settlement_id text not null default '',
  baemin_settlement_id text not null default '',
  selected_rule_ids jsonb not null default '[]'::jsonb,
  selected_rule_names jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.promotion_apply_results add column if not exists platform text not null default '';
alter table public.promotion_apply_results add column if not exists region text not null default '';
alter table public.promotion_apply_results add column if not exists settlement_kind text not null default 'weekly';
alter table public.promotion_apply_results add column if not exists week_start date;
alter table public.promotion_apply_results add column if not exists week_end date;
alter table public.promotion_apply_results add column if not exists settlement_label text not null default '';
alter table public.promotion_apply_results add column if not exists settlement_id text not null default '';
alter table public.promotion_apply_results add column if not exists coupang_settlement_id text not null default '';
alter table public.promotion_apply_results add column if not exists baemin_settlement_id text not null default '';
alter table public.promotion_apply_results add column if not exists selected_rule_ids jsonb not null default '[]'::jsonb;
alter table public.promotion_apply_results add column if not exists selected_rule_names jsonb not null default '[]'::jsonb;
alter table public.promotion_apply_results add column if not exists summary jsonb not null default '{}'::jsonb;
alter table public.promotion_apply_results add column if not exists rows jsonb not null default '[]'::jsonb;
alter table public.promotion_apply_results add column if not exists meta jsonb not null default '{}'::jsonb;
alter table public.promotion_apply_results add column if not exists published boolean not null default false;
alter table public.promotion_apply_results add column if not exists created_at timestamptz not null default now();
alter table public.promotion_apply_results add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_brem_promotion_apply_results_platform on public.promotion_apply_results (platform);
create index if not exists idx_brem_promotion_apply_results_region on public.promotion_apply_results (region);
create index if not exists idx_brem_promotion_apply_results_week on public.promotion_apply_results (week_start desc, week_end desc);
create index if not exists idx_brem_promotion_apply_results_created on public.promotion_apply_results (created_at desc);

alter table public.promotion_apply_results enable row level security;

drop policy if exists "promotion_apply_results admin all" on public.promotion_apply_results;
create policy "promotion_apply_results admin all"
  on public.promotion_apply_results for all
  using (public.brem_is_admin())
  with check (public.brem_is_admin());

notify pgrst, 'reload schema';
