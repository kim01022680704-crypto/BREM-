# BREM 배포 가이드 (최종)

## GitHub Push 전 자동 점검

```bash
npm install
npm run check-deploy
```

### 수동 점검 결과 (2026-06-18)

| 항목 | 결과 |
|------|------|
| `assets/brand/` 파일 존재 | ✅ 13개 (디스크) |
| `assets/brand/` Git 추적 | ⚠️ **2개만 추적** — Push 전 `git add assets/brand/` 필수 |
| `supabase-config.js` service_role | ✅ 없음 |
| `supabase-config.js` URL/키 하드코딩 | ✅ 제거됨 (env 로더) |
| `.env` gitignore | ✅ |
| `data/` gitignore | ✅ |
| `_restore_tmp/` gitignore | ✅ (.gitignore 등록) |
| `npm install / qa / start` | ⚠️ 로컬 Node 환경에서 실행 필요 |

---

## Supabase 관리자 1회 설정

**상세 가이드:** [`supabase/ADMIN_SETUP.md`](supabase/ADMIN_SETUP.md)

SQL 순서: `schema.sql` → `rider_inquiries_migration.sql` → `missions_migration.sql` → *(Auth User 생성)* → `bootstrap_initial_admin.sql` → `verify_admin_setup.sql`

## Supabase SQL (운영 DB)

`supabase/schema.sql` 실행 후:

```sql
-- supabase/rider_inquiries_migration.sql 전체 실행
-- supabase/missions_migration.sql 전체 실행 (미션 관리 + 기사 selected_mission_id)
```

필수 RLS:
- `anon` → INSERT만 허용
- `authenticated` + `brem_is_admin()` → 전체 CRUD

---

## Vercel 환경변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `NODE_ENV` | ✅ | `production` |
| `BREM_MODE` | ✅ | `production` |
| `BREM_BACKEND` | ✅ | `supabase` |
| `BREM_ALLOW_LOCAL_FALLBACK` | ✅ | `false` |
| `SUPABASE_URL` | ✅ | Project URL |
| `SUPABASE_ANON_KEY` | ✅ | anon public key (프론트 노출 OK) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | **서버 전용** — 문의 API Supabase CRUD |
| `SUPABASE_FUNCTIONS_URL` | ⬜ | `{SUPABASE_URL}/functions/v1` |
| `BREM_ADMIN_LOGIN_NAME` | ⬜ | `관리자` (화면 로그인 아이디) |
| `BREM_ADMIN_EMAIL` | ⬜ | `kim01022680704@gmail.com` |

---

## GitHub Push 전 명령어

```bash
# 1. 브랜드 이미지 포함 확인
git add assets/brand/
git add .gitignore vercel.json robots.txt sitemap.xml
git add server/ js/ css/ *.html portal-*.html
git add supabase/ package.json .env.example DEPLOYMENT.md

# 2. 민감정보 미포함 확인
git status
git diff --cached | findstr /i "service_role sb_publishable SUPABASE_SERVICE"

# 3. 자동 점검
npm run check-deploy

# 4. 커밋 (예시)
git commit -m "Prepare BREM for production deploy with Supabase inquiry storage"

# 5. Push
git push origin main
```

---

## Vercel 배포 순서

1. GitHub Push
2. Vercel → **Import Project** → 저장소 선택
3. Framework: **Other**
4. Build Command: *(비움)*
5. Output Directory: *(비움)*
6. Install Command: `npm install`
7. **Environment Variables** — 위 표 전부 입력
8. Deploy
9. Supabase SQL Editor에서 `schema.sql` + `rider_inquiries_migration.sql` 실행
10. Supabase Auth 관리자 계정 + `bootstrap_initial_admin.sql`
11. 배포 URL에서 확인:
    - `/` 홈
    - `/portal-rider.html` 문의 접수
    - `/api/public-config` JSON 응답
    - 관리자 → 라이더 문의 목록

---

## 문의 API (운영)

`SUPABASE_SERVICE_ROLE_KEY` 설정 시:

```
POST   /api/rider-inquiries  → Supabase rider_inquiries INSERT
GET    /api/rider-inquiries  → Supabase SELECT
PATCH  /api/rider-inquiries/:id
DELETE /api/rider-inquiries/:id
```

미설정 시 로컬 개발용 `data/rider_inquiries.json` 폴백.

---

## 프론트 Supabase 설정

`js/supabase-config.js`는 `/api/public-config`에서 env 기반 설정을 로드합니다.  
**Git에 URL/anonKey/service_role을 커밋하지 마세요.**
