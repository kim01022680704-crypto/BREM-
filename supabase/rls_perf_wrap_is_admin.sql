-- =============================================================================
-- RLS 성능 개선 — brem_is_admin() 을 (select ...) 로 감싸 행당 1회 → 쿼리당 1회
-- =============================================================================
--
-- ■ 왜 필요한가 (2026-08-24 운영 DB 실측)
--
--   테이블                   행 수     RLS 적용   RLS 우회   손해
--   admin_calls              14,371     25.2초     1.5초    23.7초
--   daily_settlements         9,796     24.4초     1.1초    23.3초
--   admin_rejection_rates     3,819      3.6초     0.4초     3.2초
--   payroll_slip_lines        2,102      1.6초     0.3초     1.3초
--   settlement_upload_logs    1,133      1.1초     0.7초     0.4초
--   ------------------------------------------------------------
--   합계                                 56.5초     4.5초    52.0초
--
--   정책이 using (public.brem_is_admin()) 이면 PostgreSQL 이 행마다 함수를 부른다.
--   admin_calls 14,371행이면 14,371번. (select public.brem_is_admin()) 으로 감싸면
--   InitPlan 으로 승격돼 쿼리당 1번만 평가된다.
--
-- ■ 정확성이 보장되는 이유 (실측 검증 포함)
--
--   이 정책들의 조건식은 행의 내용을 전혀 참조하지 않는다. brem_is_admin() 은
--   세션만 보고 참/거짓을 낸다. 즉 "관리자면 전체 행, 아니면 0행" 이고 중간이 없다.
--   (select ...) 로 감싸는 것은 그 참/거짓을 "언제" 계산하는지만 바꾼다.
--   값이 같으므로 보이는 행 집합도 반드시 같다.
--
--   실측 확인: scripts/_verify-rls-equivalence.js 로 관리자 세션(RLS 적용)과
--   service_role(RLS 우회)이 보는 PK 전체를 정렬해 SHA-256 비교 → 10개 테이블 전부 동일.
--
--   유일하게 행을 참조하는 항이 있는 정책은 admin_rejection_rates 의
--   "rider read own" (driver_id = brem_current_rider_id()) 이다.
--   여기서도 감싸는 대상은 함수 호출뿐이고 driver_id 비교는 그대로 둔다.
--
-- ■ 무엇이 바뀌고 무엇이 안 바뀌나
--   바뀜   : 조건식 평가 횟수 (행당 → 쿼리당)
--   안 바뀜 : 정책 이름 / 대상 명령(FOR ALL·SELECT) / 대상 역할(TO) / 허용 조건
--            → ALTER POLICY 는 명령과 역할을 아예 변경할 수 없다. 구조적으로 안전.
--
-- ■ 왜 ALTER POLICY 인가 (DROP+CREATE 아님)
--   DROP POLICY 는 정책이 존재하지 않는 순간을 만들고 ACCESS EXCLUSIVE 락을 길게 잡는다.
--   ALTER POLICY 는 조건식만 교체하므로 TO 절·명령을 옮겨 적다 틀릴 여지가 없다.
--
-- ■ 대상 범위 (측정으로 이득이 확인된 5개만)
--   포함: admin_calls, daily_settlements, admin_rejection_rates,
--         payroll_slip_lines, settlement_upload_logs
--   제외: riders, settings, weekly_settlements, admin_targets, settlement_unmatched
--         → RLS 손해가 0.1초 수준(측정 오차). 손댈 이유가 없어 건드리지 않는다.
--         → 나중에 행이 늘면 _verify-rls-equivalence.js 가 다시 잡아준다.
--
-- ■ 안전장치
--   1) 전체가 하나의 트랜잭션 — 에러 시 아무것도 바뀌지 않는다.
--   2) 정책 이름을 못 찾으면 [없음] 경고에 이름을 찍는다 (조용한 실패 없음).
--   3) [4] 가 행당 평가로 남은 정책을 [남음] 경고로 전부 출력한다.
--   4) 여러 번 실행해도 안전하다 (같은 식으로 다시 ALTER 할 뿐).
--   5) 일부만 적용돼도 무해하다. 정책끼리 의존이 없다.
--
-- ■ 실행 순서
--   1단계 (드라이런)  아래 [커밋 선택] 의 commit; → rollback; 으로 바꿔 Run.
--                     문법 오류·정책 이름 불일치가 여기서 다 드러난다. DB 는 안 바뀐다.
--                     ※ 드라이런에서는 [5] 표가 되돌려진 상태로 보이는 게 정상.
--                       판단은 [ok]/[없음]/[남음] 메시지로 한다.
--   2단계 (실제 적용)  경고가 없으면 rollback; → commit; 으로 되돌려 Run.
--                     [5] 표의 eval_mode 가 "OK (쿼리당 1회)" 여야 한다.
--   3단계 (사후 검증)  node scripts/_verify-rls-equivalence.js
--                     → 행 집합 해시가 적용 전과 같아야 하고, 시간은 줄어야 한다.
--
-- ■ 되돌리기  맨 아래 [ROLLBACK] 블록만 따로 실행
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- [1] 실행 전 상태 — 지금 행당 평가되는 정책 (대상 외 테이블도 함께 보여준다)
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
  n int := 0;
begin
  raise notice '=== 실행 전: 행당 평가되는 정책 ===';
  for r in
    select tablename, policyname, cmd
    from pg_policies
    where schemaname = 'public'
      -- qual 과 with_check 를 각각 본다. 이어붙이면 한쪽만 감싸진 경우를 놓친다.
      and (
        (qual is not null
          and upper(qual) like '%BREM_IS_ADMIN%'
          and upper(qual) not like '%SELECT BREM_IS_ADMIN%')
        or (with_check is not null
          and upper(with_check) like '%BREM_IS_ADMIN%'
          and upper(with_check) not like '%SELECT BREM_IS_ADMIN%')
      )
    order by tablename, policyname
  loop
    n := n + 1;
    raise notice '  % / % (%)', r.tablename, r.policyname, r.cmd;
  end loop;
  raise notice '=== 합계 % 건 ===', n;
end $$;

-- -----------------------------------------------------------------------------
-- [2] FOR ALL + brem_is_admin() 단독 조건 정책
--     정책 이름은 supabase/*.sql 에서 확인한 실제 이름을 명시한다.
--     (조건식 문자열을 정규식으로 추측하지 않는다 — pg_get_expr 렌더링 의존은 위험)
-- -----------------------------------------------------------------------------
do $$
declare
  changed int := 0;
  missing int := 0;
  pairs text[][] := array[
    ['admin_calls',            'admin_calls admin all'],
    ['daily_settlements',      'daily_settlements admin all'],
    ['admin_rejection_rates',  'admin_rejection_rates admin all'],
    ['payroll_slip_lines',     'payroll_slip_lines admin all'],
    ['settlement_upload_logs', 'settlement_upload_logs admin all']
  ];
  i int;
  tbl text;
  pol text;
  has_check boolean;
begin
  raise notice '=== FOR ALL 정책 수정 ===';
  for i in 1 .. array_length(pairs, 1) loop
    tbl := pairs[i][1];
    pol := pairs[i][2];

    if to_regclass('public.' || tbl) is null then
      raise notice '  [skip] %: 테이블 없음', tbl;
      continue;
    end if;

    select (with_check is not null) into has_check
    from pg_policies
    where schemaname = 'public' and tablename = tbl and policyname = pol;

    if not found then
      missing := missing + 1;
      raise warning '  [없음] % / % — 라이브 정책 이름이 다를 수 있음. [4]·[5] 에서 다시 잡힌다.', tbl, pol;
      continue;
    end if;

    if has_check then
      execute format(
        'alter policy %I on public.%I '
        || 'using ((select public.brem_is_admin())) '
        || 'with check ((select public.brem_is_admin()))',
        pol, tbl
      );
    else
      execute format(
        'alter policy %I on public.%I using ((select public.brem_is_admin()))',
        pol, tbl
      );
    end if;

    changed := changed + 1;
    raise notice '  [ok] % / %', tbl, pol;
  end loop;
  raise notice '=== 수정 % 건 · 이름 불일치 % 건 ===', changed, missing;
end $$;

-- -----------------------------------------------------------------------------
-- [3] 복합 조건 정책 — 조건은 그대로, 함수 호출만 감싼다
--
--     admin_rejection_rates 에는 정책이 둘 있다 (허용 정책은 OR 로 합쳐진다).
--     "admin all" 만 감싸고 이걸 남겨두면, 이 정책이 행마다 평가되어
--     3.6초가 그대로 남을 수 있다. 그래서 둘 다 감싼다.
--
--     FOR SELECT 정책이므로 WITH CHECK 를 주면 에러난다. USING 만 바꾼다.
--     driver_id 비교는 손대지 않는다 (행을 참조하는 유일한 항).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_rejection_rates'
      and policyname = 'admin_rejection_rates rider read own'
  ) then
    alter policy "admin_rejection_rates rider read own"
      on public.admin_rejection_rates
      using (
        (select public.brem_is_admin())
        or driver_id = (select public.brem_current_rider_id())
      );
    raise notice '[ok] admin_rejection_rates / rider read own';
  else
    raise notice '[skip] admin_rejection_rates / rider read own: 없음';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- [4] 검증 — 대상 5개 테이블에 행당 평가가 남았으면 [남음] 으로 전부 출력
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
  leftover int := 0;
  targets text[] := array[
    'admin_calls',
    'daily_settlements',
    'admin_rejection_rates',
    'payroll_slip_lines',
    'settlement_upload_logs'
  ];
begin
  for r in
    select tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename = any(targets)
      and (
        (qual is not null
          and upper(qual) like '%BREM_IS_ADMIN%'
          and upper(qual) not like '%SELECT BREM_IS_ADMIN%')
        or (with_check is not null
          and upper(with_check) like '%BREM_IS_ADMIN%'
          and upper(with_check) not like '%SELECT BREM_IS_ADMIN%')
      )
    order by tablename, policyname
  loop
    leftover := leftover + 1;
    raise warning '[남음] % / % (%) using=% check=%',
      r.tablename, r.policyname, r.cmd, r.qual, r.with_check;
  end loop;

  if leftover > 0 then
    raise warning '=== 행당 평가가 남은 정책 %건 — 위 [남음] 줄을 그대로 알려주세요 ===', leftover;
  else
    raise notice '=== 검증 통과: 대상 5개 테이블 모두 쿼리당 1회 평가 ===';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- [커밋 선택]
--   드라이런: 아래를 rollback;  으로 바꿔서 Run  (DB 안 바뀜, 검사만)
--   실제적용: 아래를 commit;    으로 두고 Run
-- -----------------------------------------------------------------------------
commit;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- [5] 최종 확인
--   - 대상 5개 테이블은 eval_mode = "OK (쿼리당 1회)" 여야 한다
--   - 그 외 테이블이 "CHECK (행당 평가)" 로 남는 것은 정상 (이번 범위 아님)
-- -----------------------------------------------------------------------------
select
  tablename,
  policyname,
  cmd,
  case
    when tablename in ('admin_calls', 'daily_settlements', 'admin_rejection_rates',
                       'payroll_slip_lines', 'settlement_upload_logs')
      then '★대상'
    else '범위밖'
  end as scope,
  case
    when (qual is not null
           and upper(qual) like '%BREM_IS_ADMIN%'
           and upper(qual) not like '%SELECT BREM_IS_ADMIN%')
      or (with_check is not null
           and upper(with_check) like '%BREM_IS_ADMIN%'
           and upper(with_check) not like '%SELECT BREM_IS_ADMIN%')
      then 'CHECK (행당 평가)'
    else 'OK (쿼리당 1회)'
  end as eval_mode,
  qual
from pg_policies
where schemaname = 'public'
  and (upper(coalesce(qual, '')) like '%BREM_IS_ADMIN%'
    or upper(coalesce(with_check, '')) like '%BREM_IS_ADMIN%')
order by scope, eval_mode, tablename, policyname;

-- =============================================================================
-- [ROLLBACK] 원래대로 되돌리기 — 필요할 때만 아래 블록만 따로 실행
-- =============================================================================
-- begin;
--
-- do $$
-- declare
--   i int;
--   tbl text;
--   pol text;
--   has_check boolean;
--   pairs text[][] := array[
--     ['admin_calls',            'admin_calls admin all'],
--     ['daily_settlements',      'daily_settlements admin all'],
--     ['admin_rejection_rates',  'admin_rejection_rates admin all'],
--     ['payroll_slip_lines',     'payroll_slip_lines admin all'],
--     ['settlement_upload_logs', 'settlement_upload_logs admin all']
--   ];
-- begin
--   for i in 1 .. array_length(pairs, 1) loop
--     tbl := pairs[i][1];
--     pol := pairs[i][2];
--     if to_regclass('public.' || tbl) is null then continue; end if;
--     select (with_check is not null) into has_check
--     from pg_policies
--     where schemaname = 'public' and tablename = tbl and policyname = pol;
--     if not found then continue; end if;
--     if has_check then
--       execute format('alter policy %I on public.%I using (public.brem_is_admin()) with check (public.brem_is_admin())', pol, tbl);
--     else
--       execute format('alter policy %I on public.%I using (public.brem_is_admin())', pol, tbl);
--     end if;
--   end loop;
-- end $$;
--
-- do $$
-- begin
--   if exists (
--     select 1 from pg_policies
--     where schemaname = 'public' and tablename = 'admin_rejection_rates'
--       and policyname = 'admin_rejection_rates rider read own'
--   ) then
--     alter policy "admin_rejection_rates rider read own"
--       on public.admin_rejection_rates
--       using (public.brem_is_admin() or driver_id = public.brem_current_rider_id());
--   end if;
-- end $$;
--
-- commit;
-- notify pgrst, 'reload schema';
