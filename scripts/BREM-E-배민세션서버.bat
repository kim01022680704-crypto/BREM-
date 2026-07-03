@echo off
setlocal EnableExtensions
title BREM Baemin Session — E drive (git pull + restart)

set "BREM_DIR="
call "%~dp0brem-resolve-dir-e.bat"

if not defined BREM_DIR (
  echo [ERROR] E:\*\BREM folder not found.
  echo   Put BREM at E:\브램로컬\BREM or E:\something\BREM
  pause
  exit /b 1
)

echo ========================================
echo   BREM Baemin Session Server [E drive]
echo   %BREM_DIR%
echo ========================================
echo.

cd /d "%BREM_DIR%"
echo [UPDATE] git pull ...
git pull
if errorlevel 1 (
  echo [WARN] git pull failed — fix conflicts or stash, then retry.
  echo.
)

call "%BREM_DIR%\scripts\restart-baemin-session-server-e.bat"
