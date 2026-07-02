@echo off
setlocal EnableExtensions
title BREM Baemin Session Server

set "PROJECT_DIR="
call "%~dp0brem-resolve-dir.bat"
set "PROJECT_DIR=%BREM_DIR%"

if not defined PROJECT_DIR (
  if exist "%~dp0package.json" set "PROJECT_DIR=%~dp0"
)

if not defined PROJECT_DIR (
  echo [ERROR] BREM folder not found.
  echo   Checked E:\*\BREM and Desktop\BREM
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
echo   BREM Baemin Session Server
echo   %PROJECT_DIR%
echo ========================================
echo.

echo [UPDATE] git pull ...
git pull
if errorlevel 1 echo [WARN] git pull failed
echo.

set "LOCAL_VERSION="
for /f "delims=" %%v in ('node "%~dp0brem-print-version.js"') do set "LOCAL_VERSION=%%v"
if defined LOCAL_VERSION (
  echo [VERSION] This folder code: %LOCAL_VERSION%
) else (
  echo [WARN] Could not read SERVER_VERSION
)
echo.

echo [CHECK] http://127.0.0.1:3939/health ...
node "%~dp0brem-check-health.js" "%LOCAL_VERSION%"
if not errorlevel 1 (
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
