@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title BREM Baemin Session Server

set "PROJECT_DIR="

if exist "E:\브램로컬\BREM\package.json" (
  set "PROJECT_DIR=E:\브램로컬\BREM"
)

if not defined PROJECT_DIR if exist "%USERPROFILE%\Desktop\BREM\package.json" (
  set "PROJECT_DIR=%USERPROFILE%\Desktop\BREM"
)

if not defined PROJECT_DIR if exist "%~dp0..\package.json" (
  for %%I in ("%~dp0..") do set "PROJECT_DIR=%%~fI"
)

if not defined PROJECT_DIR if exist "%~dp0package.json" (
  set "PROJECT_DIR=%~dp0"
)

if not defined PROJECT_DIR (
  echo [ERROR] BREM folder not found.
  echo   E:\브램로컬\BREM
  echo   %USERPROFILE%\Desktop\BREM
  pause
  exit /b 1
)

cd /d "%PROJECT_DIR%"
set "PLAYWRIGHT_BROWSERS_PATH=%PROJECT_DIR%\.playwright-browsers"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Starting BREM Baemin Session Server
echo   %PROJECT_DIR%
echo ========================================
echo.

echo [UPDATE] git pull ...
git pull
if errorlevel 1 (
  echo [WARN] git pull failed
)
echo.

for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "$m = Select-String -Path '%PROJECT_DIR%\scripts\baemin-session-local-server.js' -Pattern \"SERVER_VERSION = '([^']+)'\"; if ($m) { $m.Matches[0].Groups[1].Value }"`) do set "LOCAL_VERSION=%%v"
if defined LOCAL_VERSION (
  echo [VERSION] This folder code: %LOCAL_VERSION%
) else (
  echo [WARN] Could not read SERVER_VERSION from scripts\baemin-session-local-server.js
)
echo.

echo [CHECK] http://127.0.0.1:3939/health ...
powershell -NoProfile -Command "try { $r = Invoke-RestMethod 'http://127.0.0.1:3939/health' -TimeoutSec 3; $local = '%LOCAL_VERSION%'; Write-Host ('[INFO] Server already running — version ' + $r.version); if ($local -and $r.version -ne $local) { Write-Host ('[WARN] Running version differs from folder! folder=' + $local + ' running=' + $r.version); Write-Host '[WARN] Run scripts\restart-baemin-session-server.bat to apply updates.' } else { Write-Host '[INFO] Restart: scripts\restart-baemin-session-server.bat' }; exit 0 } catch { exit 1 }"
if %ERRORLEVEL% EQU 0 (
  echo.
  pause
  exit /b 0
)

call npm.cmd run baemin:session-server

echo.
if errorlevel 1 (
  echo [ERROR] Server exited with error.
  echo   - Port 3939 in use: run scripts\restart-baemin-session-server.bat
  echo   - Check .env SUPABASE settings
  echo   - Run: node node_modules\playwright\cli.js install chromium
) else (
  echo [INFO] Server stopped.
)
pause
