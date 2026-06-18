# BREM Supabase 운영 구조

## 테이블

| 테이블 | 용도 |
| --- | --- |
| `profiles` | Supabase Auth 사용자 역할(`admin`, `rider`) |
| `riders` | 기사 데이터, `auth_user_id`로 기사 Auth user 연결 |
| `notices` | 공지사항 |
| `promotions` | 프로모션 설정/조건 원본 JSON |
| `settings` | 관리자 설정 및 기타 BREM 데이터 |

## 인증/권한

- 로그인은 Supabase Auth 이메일/비밀번호를 사용합니다.
- `anon` 사용자는 테이블 CRUD가 불가능합니다.
- `profiles.role = 'admin'` 사용자만 `riders`, `notices`, `promotions`, `settings` 전체 관리가 가능합니다.
- `profiles.role = 'rider'` 사용자는 본인 `riders` 데이터만 조회할 수 있습니다.

## 계정 생성

프론트엔드 publishable key로는 Auth 계정 생성/권한 부여를 하지 않습니다.

관리자/기사 Auth 계정 생성은 다음 Edge Function을 사용합니다.

```text
supabase/functions/admin-upsert-user
```

필수 환경 변수:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

## 배포 순서

1. Supabase SQL Editor에서 `supabase/schema.sql` 실행
2. 최초 관리자 Auth user 생성
3. `profiles`에 최초 관리자 row 등록
4. `admin-upsert-user` Edge Function 배포
5. `js/supabase-config.js`를 production/supabase/fallback false로 유지
6. 관리자 로그인 후 기사/공지/프로모션 CRUD 테스트

## 보안 원칙

- 관리자 기본 비밀번호 `1234`를 운영 로그인에 사용하지 않습니다.
- 기사 비밀번호를 `riders` 테이블에 저장하지 않습니다.
- 운영 모드에서는 localStorage 폴백을 허용하지 않습니다.
