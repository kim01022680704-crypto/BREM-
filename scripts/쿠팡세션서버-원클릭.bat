@echo off
setlocal EnableExtensions
chcp 65001 >nul
title 쿠팡이츠 세션 서버 (E드라이브)

rem ================================================================
rem  더블클릭: git pull -> 포트 3940 정리 -> 쿠팡 세션 서버 시작
rem  브라우저에서 로그인/2차인증 후 대시보드를 한 번 열면 토큰이 캡처됩니다.
rem  수집: 관리자 화면 '쿠팡 현황' 또는 POST http://127.0.0.1:3940/collect
rem ================================================================
set "BREM_DIR=E:\브램로컬\BREM"

if not exist "%BREM_DIR%\scripts\coupang-session-local-server.js" (
  echo [오류] %BREM_DIR%\scripts\coupang-session-local-server.js 를 찾지 못했습니다.
  echo        먼저 git pull 로 최신 코드를 받으세요.
  pause
  exit /b 1
)

cd /d "%BREM_DIR%"
set "PLAYWRIGHT_BROWSERS_PATH=%BREM_DIR%\.playwright-browsers"
set "NAVER_PLAYWRIGHT_PROFILE=%BREM_DIR%\.naver-playwright-profile"

echo [1/3] git pull ...
git pull
if errorlevel 1 (
  echo.
  echo ================================================================
  echo  [중단] git pull 실패 - 코드를 갱신하지 못했습니다.
  echo ================================================================
  echo  이대로 서버를 띄우면 옛 코드가 계속 돌아갑니다.
  echo.
  echo  --- 이 폴더에서 수정된 파일 ---
  git -c core.quotepath=false status --short
  echo  -------------------------------
  echo.
  echo  위에 파일이 보이면 그게 pull 을 막고 있습니다.
  echo  수정 내용을 버려도 되면 아래를 실행하세요.
  echo     cd /d "%BREM_DIR%"
  echo     git reset --hard origin/main
  echo.
  echo  목록이 비어 있으면 네트워크 문제입니다. 인터넷 확인 후 다시 실행하세요.
  echo.
  pause
  exit /b 1
)
echo   코드 최신화 완료.
echo.

echo [2/3] 포트 3940 정리 ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3940" ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
ping -n 2 127.0.0.1 >nul
echo.

echo [3/3] 쿠팡 세션 서버 시작 (http://127.0.0.1:3940) ...
echo   브라우저에서 쿠팡이츠 로그인 + 2차 인증 -^> 대시보드 한 번 열기
echo   이 창은 닫지 마세요.
echo.
node scripts\coupang-session-local-server.js

echo.
echo [정보] 세션 서버가 종료되었습니다.
pause
