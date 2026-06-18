# BREM Supabase 관리자 계정 설정 (운영 1회)

> **원칙:** service_role 키는 Vercel 서버 env에만. Git/프론트 코드에 넣지 않습니다.

---

## 1. SQL 실행 순서 (반드시 이 순서)

| 순서 | 파일 | 목적 | 비고 |
|------|------|------|------|
| **1** | `supabase/schema.sql` | 전체 스키마, RLS, `brem_is_admin()` | 최초 1회. 재실행 시 `IF NOT EXISTS` / `DROP POLICY IF EXISTS` 로 안전 |
| **2** | `supabase/rider_inquiries_migration.sql` | 홈페이지 문의 테이블 + RLS | schema.sql에 포함되어 있으면 **중복 실행해도 무해** |
| **3** | *(Dashboard)* Auth 사용자 생성 | `auth.users` 행 추가 | SQL **아님** — 아래 2절 |
| **4** | `supabase/bootstrap_initial_admin.sql` | `profiles.role = 'admin'` 연결 | **3번 이후** 실행 |
| **5** | `supabase/verify_admin_setup.sql` | 연결·권한 검증 | 선택 (권장) |

### 1번 schema.sql 이 만드는 것 (관리자 관련)

| 객체 | 설명 |
|------|------|
| `public.profiles` | Auth `user_id` ↔ 역할(`admin`/`rider`) |
| `public.brem_is_admin()` | `profiles.role = 'admin'` 이고 `active = true` |
| `public.brem_current_role()` | 현재 JWT 사용자 역할 |
| RLS 정책 | `brem_is_admin()` 기준 admin 전체 CRUD |

**별도 `admins` / `users` 테이블은 없습니다.**  
관리자 = `auth.users` + `public.profiles(role='admin')`.

---

## 2. 관리자 Auth 계정 생성 (Dashboard)

1. [Supabase Dashboard](https://supabase.com/dashboard) → 프로젝트 선택  
2. **Authentication** → **Users** → **Add user** → **Create new user**  
3. 입력값:

| 필드 | 값 |
|------|-----|
| **Email** | Vercel `BREM_ADMIN_EMAIL` 과 **완전히 동일** (`kim01022680704@gmail.com`) |
| **Password** | 임시 **강력 비밀번호** (16자+, 대소문자·숫자·기호) |
| **Auto Confirm User?** | ✅ **체크** (Email Confirm 완료 처리) |

4. **Create user** 클릭  
5. 생성된 사용자 **UUID** 확인 (Users 목록에서 복사 가능)

> 로그인 화면 아이디는 **`BREM_ADMIN_LOGIN_NAME`** (기본 `관리자`).  
> 앱이 `관리자` 입력 → `BREM_ADMIN_EMAIL` 로 변환 후 Supabase Auth 로그인합니다.

---

## 3. bootstrap_initial_admin.sql 이 하는 일

```sql
-- auth.users (이메일 일치) → public.profiles UPSERT
-- role = 'admin', display_name = '관리자', active = true
```

**실행 전:** SQL `WHERE email` 값이 **`kim01022680704@gmail.com`** (Vercel `BREM_ADMIN_EMAIL`) 과 일치하는지 확인.

부여 권한:
- `profiles.role = 'admin'` → `brem_is_admin()` = **true**
- RLS: `riders`, `notices`, `promotions`, `settings`, `rider_inquiries` 등 **admin 전체 CRUD**
- `rider_inquiries`: anon INSERT + admin ALL (schema/migration 정책)

검증: `supabase/verify_admin_setup.sql` 실행.

---

## 4. Vercel 환경변수 ↔ Supabase 일치 확인

| Vercel 변수 | Supabase 위치 | 일치 조건 |
|-------------|---------------|-----------|
| `SUPABASE_URL` | Settings → API → Project URL | 동일 URL |
| `SUPABASE_ANON_KEY` | Settings → API → anon **public** | 동일 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → service_role | **서버만**, Git 금지 |
| `BREM_ADMIN_EMAIL` | Auth → Users → Email | bootstrap SQL 이메일과 **동일** |
| `BREM_ADMIN_LOGIN_NAME` | *(앱 UI)* | admin 로그인 화면 아이디 (기본 `관리자`) |
| `BREM_MODE` | — | `production` |
| `BREM_BACKEND` | — | `supabase` |
| `BREM_ALLOW_LOCAL_FALLBACK` | — | `false` |

### 배포 후 공개 설정 확인

브라우저 또는 curl:

```bash
curl https://YOUR-DOMAIN.vercel.app/api/public-config
```

기대 JSON:

```json
{
  "url": "https://xxxx.supabase.co",
  "anonKey": "eyJ...",
  "mode": "production",
  "backend": "supabase",
  "allowLocalFallback": false,
  "initialAdmin": {
    "loginName": "관리자",
    "email": "kim01022680704@gmail.com"
  },
  "inquiryStorage": "supabase"
}
```

`initialAdmin.email` ≠ Auth Users 이메일 → **로그인 실패**.

---

## 5. 관리자 로그인 테스트 (배포 후)

1. `https://YOUR-DOMAIN/admin.html`  
2. 아이디: `관리자` (또는 `BREM_ADMIN_LOGIN_NAME`)  
3. 비밀번호: Dashboard에서 설정한 임시 비밀번호  
4. 성공 시 → 대시보드 진입  
5. **라이더 문의** 메뉴 → Supabase `rider_inquiries` 데이터 표시  
6. F12 콘솔: `BremStorage.getStorageStatus()` → `backend: "supabase"`

---

## 6. 문제 해결

| 증상 | 원인 | 조치 |
|------|------|------|
| 접근 권한 없음 | profiles 없음 / role ≠ admin | bootstrap SQL 재실행 |
| Invalid login | 이메일·비밀번호 불일치 | Auth Users 확인 |
| 운영 로그인 설정 필요 | `initialAdmin.email` 비어 있음 | Vercel `BREM_ADMIN_EMAIL` |
| 문의 저장 안 됨 | `SUPABASE_SERVICE_ROLE_KEY` 미설정 | Vercel env 추가 후 재배포 |
