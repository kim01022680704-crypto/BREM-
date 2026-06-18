# BREM Production Deploy Checklist

정식 운영 배포 전 아래 항목을 모두 완료해야 합니다.

## Supabase

- [ ] `supabase/schema.sql` 실행
- [ ] `profiles` 테이블에 최초 관리자 Auth user 등록
- [ ] `riders.auth_user_id`와 기사 Auth user 연결
- [ ] `admin-upsert-user` Edge Function 배포
- [ ] Edge Function 환경 변수 확인
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

## Authentication

- [ ] `js/supabase-config.js` → `initialAdmin` 확인
  - `loginName: '관리자'` (로그인 화면 아이디, 개발/운영 동일)
  - `email: 'admin@brem.kr'` (Supabase Auth에 등록할 이메일, 배포 시 본인 이메일로 변경 가능)
- [ ] Supabase Auth에 `initialAdmin.email` 계정 생성
- [ ] `supabase/bootstrap_initial_admin.sql` 실행 → `profiles.role = admin` 연결
- [ ] 운영 로그인: **아이디 `관리자` + Supabase에 등록한 비밀번호**
- [ ] 최초 로그인 후 비밀번호 변경 권장
- [ ] 기사 로그인은 Supabase Auth 이메일/비밀번호만 사용
- [ ] 기사 비밀번호 평문 저장 금지
- [ ] 신규 계정은 Edge Function으로만 생성

## Storage

- [ ] 운영 모드 `backend: 'supabase'`
- [ ] 운영 모드 `allowLocalFallback: false`
- [ ] localStorage 폴백 저장 비활성화 확인

## RLS

- [ ] anon 사용자 CRUD 불가 확인
- [ ] admin role 전체 관리 가능 확인
- [ ] rider role 본인 rider 데이터만 조회 가능 확인
- [ ] `using (true) with check (true)` 개발 정책 미사용 확인

## Final QA

- [ ] 관리자 로그인
- [ ] 기사 로그인
- [ ] 기사 등록/수정/삭제
- [ ] 공지 등록/수정/삭제
- [ ] 프로모션 등록/수정/삭제
- [ ] 기사 페이지 본인 데이터 조회
- [ ] 새로고침 후 Supabase 데이터 유지
