# BREM 라이더 Android 앱 (Capacitor)

Google Play용 라이더 앱. WebView가 `https://brem.kr/driver.html` 을 로드합니다.  
웹(brem.kr)을 고치면 대부분 앱에도 바로 반영됩니다.

## 요구 사항

- Node.js 18+
- [Android Studio](https://developer.android.com/studio) (SDK, 에뮬레이터 또는 실기)
- Google Play Console 계정 (스토어 배포 시)

## 로컬 실행

```bat
cd mobile\rider-app
npm install
npx cap sync android
npx cap open android
```

Android Studio에서 **Run** → 에뮬레이터/실기.

## 설정 요약

| 항목 | 값 |
|------|-----|
| applicationId | `kr.brem.rider` |
| 앱 이름 | BREM 기사앱 |
| 서버 URL | `https://brem.kr/driver.html` |
| 버전 | `versionName` / `versionCode` → `android/app/build.gradle` |

설정 파일: [capacitor.config.json](capacitor.config.json)

## 아이콘·스플래시 다시 생성

`assets/icon.png`, `splash.png` 등을 교체한 뒤:

```bat
npm run assets
npx cap sync android
```

## Release AAB (Play 업로드용)

### 1) 키스토어 생성 (최초 1회 — 백업 필수)

```bat
keytool -genkey -v -keystore brem-rider-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias brem-rider
```

`brem-rider-release.jks` 와 비밀번호는 **절대 git에 올리지 마세요.**

### 2) `android/key.properties` (로컬만, gitignore됨)

```properties
storePassword=YOUR_STORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=brem-rider
storeFile=C:/path/to/brem-rider-release.jks
```

### 3) 서명 빌드

Android Studio: **Build → Generate Signed Bundle / APK → Android App Bundle**

또는:

```bat
cd android
gradlew.bat bundleRelease
```

결과물: `android/app/build/outputs/bundle/release/app-release.aab`

## Play Console

1. 새 앱 만들기 → 앱 이름 **BREM 기사앱**
2. 패키지명 `kr.brem.rider` (AAB와 일치)
3. **내부 테스트** 트랙에 AAB 업로드
4. 테스터(라이더) 이메일 추가 후 링크 공유
5. 개인정보처리방침 URL 등록 (필수)  
   → `https://brem.kr/privacy-rider.html`
6. 내부 테스트 OK 후 프로덕션 출시

## Java / Android Studio

이 PC에 `JAVA_HOME`이 없으면 `gradlew` CLI 빌드는 실패할 수 있습니다.  
**Android Studio에서 Open `mobile/rider-app/android`** 후 IDE가 내장 JDK로 빌드하는 방식을 권장합니다.
## 스모크 체크리스트

- [ ] 앱 실행 → 로그인 화면
- [ ] 라이더 로그인 성공
- [ ] 앱을 완전히 종료했다가 다시 켜도 로그인 유지
- [ ] 대시보드·주간콜·명세서 등 주요 메뉴
- [ ] 뒤로가기 버튼 (이전 화면 / 앱 종료)
- [ ] 비행기모드에서 오프라인 안내 → 다시 시도
- [ ] PWA “앱 설치” 버튼이 보이지 않음

## 주의

- iOS는 별도 단계 (Mac 또는 CI 필요)
- 푸시 알림(FCM)은 Firebase 프로젝트 + `google-services.json` 이 필요함 (아직 미연결)
- `node_modules/`, `android/app/build/`, 키스토어는 커밋하지 않음
