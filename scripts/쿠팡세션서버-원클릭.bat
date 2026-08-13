@echo off
setlocal EnableExtensions
chcp 65001 >nul
title 쿠팡이츠 세션 서버 (E드라이브)

rem ================================================================
rem  더블클릭: 코드동기화 -> 포트 3940 정리 -> 쿠팡 세션 서버 시작
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

echo [1/3] code sync (origin/main) ...
if exist "%BREM_DIR%\scripts\_session-git-sync.cmd" (
  call "%BREM_DIR%\scripts\_session-git-sync.cmd"
) else (
  echo   [경고] _session-git-sync.cmd 없음 - sync 건너뛰고 서버만 기동
)
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
