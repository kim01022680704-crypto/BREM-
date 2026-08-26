# BREM + Android 를 E 드라이브로 옮긴 뒤

## 새 위치
- 프로젝트: `E:\BREM`
- Android SDK: `E:\Android`
- 에뮬레이터(AVD): `E:\Android\avd`

## 꼭 할 일
1. **Cursor**에서 `E:\BREM` 폴더를 다시 연다 (File → Open Folder).
2. **새 터미널**을 연다 (환경변수 반영).
3. Android Studio → **File → Open** → `E:\BREM\mobile\rider-app\android`
4. Android Studio → **Settings → Languages & Frameworks → Android SDK**  
   → **Android SDK Location** 을 `E:\Android` 로 맞춘다.

## C 드라이브 정리 (확인 후)
아래가 E에서 정상 동작한 뒤에만 삭제하세요.
- `C:\Users\user\Desktop\BREM` (예전 프로젝트 복사본)
- `C:\Users\user\AppData\Local\Android\Sdk` (예전 SDK, 거의 비어 있음)

삭제 전 Desktop의 BREM을 휴지통이 아니라 **이름만 `BREM-OLD`로 바꿔** 며칠 두어도 됩니다.

## 참고
- `local.properties` 의 `sdk.dir=E:\\Android` 는 git에 올리지 마세요 (이미 gitignore).
- Gradle/에뮬레이터를 쓰면 C의 `.gradle` 캐시가 다시 커질 수 있습니다. 필요하면 나중에  
  `GRADLE_USER_HOME=E:\Android\gradle-home` 로도 옮길 수 있습니다.
