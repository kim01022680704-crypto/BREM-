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

if not exist "%BREM_DIR%\scripts\배민세션서버-원클릭.bat" (
  echo [ERROR] Baemin one-click bat missing.
  echo         Run git pull in %BREM_DIR% first.
  pause
  exit /b 1
)

if not exist "%BREM_DIR%\scripts\쿠팡세션서버-원클릭.bat" (
  echo [ERROR] Coupang one-click bat missing.
  echo         Run git pull in %BREM_DIR% first.
  pause
  exit /b 1
)

cd /d "%BREM_DIR%"
set "PLAYWRIGHT_BROWSERS_PATH=%BREM_DIR%\.playwright-browsers"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  pause
  exit /b 1
)

echo [1/3] git pull ...
git pull
if errorlevel 1 (
  echo.
  echo ================================================================
  echo  [STOP] git pull failed - code was NOT updated.
  echo ================================================================
  echo  Starting the servers now would keep running the OLD code,
  echo  so anything deployed to the admin site is ignored.
  echo.
  echo  --- locally modified files ---
  git -c core.quotepath=false status --short
  echo  -----------------------------
  echo.
  echo  If files are listed above, they are blocking the pull.
  echo  To discard them:
  echo     cd /d "%BREM_DIR%"
  echo     git reset --hard origin/main
  echo.
  echo  If the list is empty it is a network problem. Check internet.
  echo.
  pause
  exit /b 1
)
echo   code up to date.
echo.

echo [2/3] free ports 3939 / 3940 ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3939" ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3940" ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
ping -n 3 127.0.0.1 >nul
echo.

echo [3/3] opening Baemin + Coupang session server windows ...
start "BREM-baemin-3939" "%BREM_DIR%\scripts\배민세션서버-원클릭.bat"
start "BREM-coupang-3940" "%BREM_DIR%\scripts\쿠팡세션서버-원클릭.bat"

echo.
echo ========================================
echo  Two session server windows should open.
echo   - Baemin 3939 : Admin [Baemin session] then BIZ login
echo   - Coupang 3940: Coupang Eats login + open dashboard once
echo  Do not close those two windows.
echo  This launcher window can be closed after confirm.
echo ========================================
echo.
pause
