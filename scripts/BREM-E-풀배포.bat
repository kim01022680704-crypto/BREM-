@echo off
setlocal EnableExtensions
title BREM Pull + Deploy + Session Restart (E drive)

set "BREM_DIR="
call "%~dp0brem-resolve-dir-e.bat"

if not defined BREM_DIR (
  echo [ERROR] E:\*\BREM folder not found.
  echo   Example: E:\브램로컬\BREM
  pause
  exit /b 1
)

cd /d "%BREM_DIR%"

echo ========================================
echo   BREM Pull + Vercel Deploy + Session
echo   %BREM_DIR%
echo ========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] git not found in PATH.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  pause
  exit /b 1
)

echo [STATUS] git status
git status --short
echo.

echo [PULL] git pull origin main ...
git pull origin main
if errorlevel 1 (
  echo [ERROR] git pull failed — fix conflicts then retry.
  pause
  exit /b 1
)

echo.
echo [DEPLOY] npx vercel --prod --yes ...
call npx.cmd vercel --prod --yes
if errorlevel 1 (
  echo [ERROR] vercel deploy failed.
  pause
  exit /b 1
)

echo.
echo [SESSION] restart baemin session server (port 3939) ...
call "%BREM_DIR%\scripts\restart-baemin-session-server-e.bat"

echo.
echo [DONE] Pull, deploy, and session restart finished.
echo   https://brem.kr
echo   Session health: http://127.0.0.1:3939/health
pause
