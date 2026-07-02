@echo off
setlocal EnableExtensions
title BREM Baemin Session (git pull + restart)

set "BREM_DIR="
call "%~dp0brem-resolve-dir.bat"

if not defined BREM_DIR (
  echo [ERROR] BREM folder not found.
  echo   Checked E:\*\BREM and Desktop\BREM
  pause
  exit /b 1
)

echo ========================================
echo   BREM Baemin Session Server
echo   %BREM_DIR%
echo ========================================
echo.

cd /d "%BREM_DIR%"
echo [UPDATE] git pull ...
git pull
if errorlevel 1 (
  echo [WARN] git pull failed - stash local changes and try again.
  echo.
)

call "%BREM_DIR%\scripts\restart-baemin-session-server.bat"
