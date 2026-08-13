@echo off
setlocal EnableExtensions
chcp 65001 >nul
title BREM Baemin+Coupang Session Servers

rem ================================================================
rem  Double-click: start Baemin(3939) + Coupang(3940) session servers
rem  Change BREM_DIR below if the local folder path is different.
rem ================================================================
set "BREM_DIR=E:\브램로컬\BREM"

if not exist "%BREM_DIR%\package.json" (
  echo [ERROR] package.json not found in %BREM_DIR%
  echo         Check BREM_DIR path in this bat file.
  pause
  exit /b 1
)

cd /d "%BREM_DIR%"
set "PLAYWRIGHT_BROWSERS_PATH=%BREM_DIR%\.playwright-browsers"
set "NAVER_PLAYWRIGHT_PROFILE=%BREM_DIR%\.naver-playwright-profile"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  pause
  exit /b 1
)

echo [1/3] code sync (origin/main) ...
if exist "%BREM_DIR%\scripts\_session-git-sync.cmd" (
  call "%BREM_DIR%\scripts\_session-git-sync.cmd"
) else (
  echo   [경고] _session-git-sync.cmd 없음 - sync 건너뛰고 서버만 기동
)
echo.

echo [2/3] free ports 3939 / 3940 ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3939" ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3940" ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
ping -n 3 127.0.0.1 >nul
echo.

echo [3/3] opening Baemin + Coupang session server windows ...
set "BAEMIN_AUTO_OPEN_BROWSER=1"
set "COUPANG_AUTO_RESUME_STATUS_LOOP=0"
start "BREM-baemin-3939" cmd /k "cd /d "%BREM_DIR%" && set PLAYWRIGHT_BROWSERS_PATH=%BREM_DIR%\.playwright-browsers&& set BAEMIN_AUTO_OPEN_BROWSER=1&& npm.cmd run baemin:session-server"
timeout /t 2 /nobreak >nul
start "BREM-coupang-3940" cmd /k "cd /d "%BREM_DIR%" && set PLAYWRIGHT_BROWSERS_PATH=%BREM_DIR%\.playwright-browsers&& set NAVER_PLAYWRIGHT_PROFILE=%BREM_DIR%\.naver-playwright-profile&& npm.cmd run coupang:session-server"

echo.
echo waiting for browser open API ...
ping -n 8 127.0.0.1 >nul
curl -s -X POST "http://127.0.0.1:3939/browser/open" >nul 2>&1
curl -s -X POST "http://127.0.0.1:3940/browser/open" >nul 2>&1

echo.
echo ========================================
echo  Two session server windows should open.
echo   - Baemin 3939 : Playwright 배민 창 자동 오픈
echo   - Coupang 3940: Playwright 쿠팡 창 자동 오픈
echo  로그인/인증 확인 후 brem.kr 탑바 [크롤링 시작]
echo  Do not close those two windows.
echo  (배민/쿠팡 원클릭 bat 를 따로 동시에 누르지 마세요)
echo ========================================
echo.
pause
