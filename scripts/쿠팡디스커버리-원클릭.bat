@echo off
setlocal EnableExtensions
chcp 65001 >nul
title 쿠팡이츠 API 디스커버리 (E드라이브)

rem ================================================================
rem  더블클릭: 포트/프로필 정리 -> Playwright 브라우저 띄워 쿠팡 API 캡처
rem  브라우저에서 로그인/2차인증 완료 후 원하는 화면으로 이동하면 캡처됩니다.
rem  캡처 결과: coupang-discovery\ 폴더 (Supabase/기존코드 무변경)
rem  폴더가 다르면 아래 BREM_DIR 값만 수정하세요.
rem ================================================================
set "BREM_DIR=E:\브램로컬\BREM"

if not exist "%BREM_DIR%\scripts\coupang-discovery.js" (
  echo [오류] %BREM_DIR%\scripts\coupang-discovery.js 를 찾지 못했습니다.
  echo        BREM_DIR 경로를 확인하세요.
  pause
  exit /b 1
)

cd /d "%BREM_DIR%"
set "PLAYWRIGHT_BROWSERS_PATH=%BREM_DIR%\.playwright-browsers"

echo.
echo ========================================
echo   쿠팡이츠 API 디스커버리
echo   %BREM_DIR%
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [오류] Node.js 가 설치되어 있지 않거나 PATH 에 없습니다.
  pause
  exit /b 1
)

echo [1/2] 이전 쿠팡 디스커버리 크롬 정리 ...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*coupang-discovery.js*' } | ForEach-Object { taskkill /PID $_.ProcessId /F /T 2>$null | Out-Null }"
if exist "%BREM_DIR%\.coupang-playwright-profile\SingletonLock" del /f /q "%BREM_DIR%\.coupang-playwright-profile\SingletonLock" >nul 2>&1
echo.

echo [2/2] 디스커버리 시작 ...
echo   브라우저가 뜨면 쿠팡이츠 파트너포털 로그인 + 2차 인증을 완료하세요.
echo   이 창은 닫지 마세요. (종료: 브라우저 창 닫기 또는 Ctrl+C)
echo.
node scripts\coupang-discovery.js

echo.
echo [정보] 디스커버리가 종료되었습니다. 결과: %BREM_DIR%\coupang-discovery\
pause
