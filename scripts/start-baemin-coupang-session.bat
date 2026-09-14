@echo off
setlocal EnableExtensions
title BREM Baemin+Coupang Session Servers

rem ASCII launcher — desktop / Korean-named bats should call THIS file.
rem Nested quotes + Korean filenames make `start "title" "....bat"` fail.

set "BREM_DIR=E:\BREM"

if not exist "%BREM_DIR%\package.json" (
  echo [ERROR] package.json not found in %BREM_DIR%
  pause
  exit /b 1
)

cd /d "%BREM_DIR%"

where node >nul 2>&1
if errorlevel 1 (
  for /d %%D in (E:\*) do if exist "%%D\node.exe" set "PATH=%%D;%PATH%"
)
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  pause
  exit /b 1
)

set "PLAYWRIGHT_BROWSERS_PATH=%BREM_DIR%\.playwright-browsers"
set "NAVER_PLAYWRIGHT_PROFILE=%BREM_DIR%\.naver-playwright-profile"
if exist "%BREM_DIR%\_live-baemin-profile" set "BAEMIN_PLAYWRIGHT_PROFILE=%BREM_DIR%\_live-baemin-profile"
if exist "%BREM_DIR%\_live-coupang-profile" set "COUPANG_PLAYWRIGHT_PROFILE=%BREM_DIR%\_live-coupang-profile"
if exist "%BREM_DIR%\_live-naver-profile" set "NAVER_PLAYWRIGHT_PROFILE=%BREM_DIR%\_live-naver-profile"

echo.
echo ========================================
echo   BREM session servers
echo   %BREM_DIR%
echo ========================================
echo [1/3] node + profiles ready
echo [2/3] free ports 3939 / 3940 ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3939" ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3940" ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
ping -n 3 127.0.0.1 >nul
echo.

echo [3/3] opening Baemin + Coupang windows ...
start "BREM-baemin-3939" /D "%BREM_DIR%" cmd /k "set PLAYWRIGHT_BROWSERS_PATH=%PLAYWRIGHT_BROWSERS_PATH%&& set BAEMIN_PLAYWRIGHT_PROFILE=%BAEMIN_PLAYWRIGHT_PROFILE%&& set BAEMIN_AUTO_OPEN_BROWSER=1&& set BAEMIN_AUTO_RESUME_STATUS_LOOP=1&& npm.cmd run baemin:session-server"
timeout /t 2 /nobreak >nul
start "BREM-coupang-3940" /D "%BREM_DIR%" cmd /k "set PLAYWRIGHT_BROWSERS_PATH=%PLAYWRIGHT_BROWSERS_PATH%&& set COUPANG_PLAYWRIGHT_PROFILE=%COUPANG_PLAYWRIGHT_PROFILE%&& set NAVER_PLAYWRIGHT_PROFILE=%NAVER_PLAYWRIGHT_PROFILE%&& set COUPANG_AUTO_RESUME_STATUS_LOOP=1&& npm.cmd run coupang:session-server"

echo waiting for browser open API ...
ping -n 10 127.0.0.1 >nul
curl -s -o nul -X POST "http://127.0.0.1:3939/browser/open" >nul 2>&1
curl -s -o nul -X POST "http://127.0.0.1:3940/browser/open" >nul 2>&1

echo.
echo ========================================
echo  Keep these two windows open:
echo   - BREM-baemin-3939
echo   - BREM-coupang-3940
echo  If Baemin shows login, type ID/password in that window.
echo  Then check brem.kr top bar crawl status.
echo ========================================
echo.
pause
exit /b 0
