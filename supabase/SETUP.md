# Supabase 연동 설정 가이드

schema.sql 실행 완료 후 아래 순서대로 진행하세요.

## 1. Supabase URL 연결

1. [Supabase Dashboard](https://supabase.com/dashboard) 접속
2. 프로젝트 선택
3. **Project Settings** (왼쪽 하단 톱니) → **API**
4. **Project URL** 복사  
   형식: `https://xxxxxxxx.supabase.co`

## 2. anon key 연결

같은 **API** 화면에서:

1. **Project API keys** 섹션
2. **`anon` `public`** 키 복사
3. ⚠️ **`service_role` 키는 브라우저/프론트에 넣지 마세요**

## 3. js/supabase-config.js 설정

파일: `js/supabase-config.js`

```javascript
window.BREM_SUPABASE_CONFIG = {
  url: 'https://YOUR_PROJECT.supabase.co',
  anonKey: 'YOUR_ANON_PUBLIC_KEY',
  backend: 'local'   // 이전 완료 후 'supabase' 로 변경 가능
};
```

저장 후 브라우저 **새로고침**.

## 4. localStorage → Supabase 이전

1. **JSON 백업** (권장): admin → 데이터 백업 → **전체 데이터 백업**
2. admin 로그인 → **데이터 백업** 메뉴
3. **Supabase 이전** 카드
   - URL / anon key 확인 (config 파일 값 자동 반영)
4. **localStorage → Supabase 이전** 클릭
5. 완료 메시지에서 기사·프로모션·정산 건수 확인
6. Supabase **Table Editor**에서 `riders`, `promotions` 등 데이터 확인

## 5. 저장 모드 확인

### admin 화면
**데이터 백업** → **저장 데이터 현황**
- **현재 저장 모드**: `local` 또는 `supabase`
- **Supabase 설정**: `완료` / `미설정`

### 브라우저 콘솔 (F12)
```javascript
BremStorage.getStorageStatus()
// { backend: 'local'|'supabase', preference, supabaseConfigured, supabaseHydrated }
```

### 모드 전환
| 버튼 | 동작 |
|------|------|
| Supabase 모드 연결 | Supabase에서 읽기/쓰기 |
| localStorage 모드 | 기존 localStorage 사용 |

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `js/supabase-config.js` | URL, anon key, backend (**직접 수정**) |
| `js/storage.js` | adapter 전환, initStorage |
| `js/storage-supabase-adapter.js` | Supabase read/write |
| `js/storage-migrate-supabase.js` | localStorage → Supabase 이전 |
| `js/data-backup-admin.js` | admin UI (이전/연결 버튼) |
| `admin.html` | Supabase SDK + 스크립트 로드 |

`index.html`, `driver.html`은 기본 **localStorage** 모드입니다.  
admin에서 Supabase 모드로 연결해도 **같은 탭/페이지**에서만 적용됩니다.
