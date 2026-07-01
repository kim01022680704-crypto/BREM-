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
echo   BREM Baemin Session Server
echo   Folder: %PROJECT_DIR%
echo   Health: http://127.0.0.1:3939/health
echo ========================================
echo.

echo [UPDATE] git pull ...
git pull
if errorlevel 1 (
  echo [WARN] git pull failed
) else (
  echo [UPDATE] done
)
echo.

call npm.cmd run baemin:session-server

echo.
if errorlevel 1 (
  echo [ERROR] Server exited with error.
  echo   - Port 3939 may already be in use
  echo   - Check .env SUPABASE settings
  echo   - Run: node node_modules\playwright\cli.js install chromium
) else (
  echo [INFO] Server stopped.
)
pause