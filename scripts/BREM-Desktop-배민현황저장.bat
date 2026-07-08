@echo off
setlocal EnableExtensions
title BREM 배민현황 저장 (로컬)

set "BREM_DIR="
for /f "delims=" %%D in ('dir /b /ad "E:\" 2^>nul') do (
  if not defined BREM_DIR if exist "E:\%%D\BREM\package.json" set "BREM_DIR=E:\%%D\BREM"
)

if not defined BREM_DIR (
  echo [ERROR] E:\*\BREM folder not found.
  pause
  exit /b 1
)

cd /d "%BREM_DIR%"
echo ========================================
echo   BREM 배민현황 저장 (Supabase apply)
echo   %BREM_DIR%
echo ========================================
echo.

node scripts\reapply-baemin-delivery.js %*
echo.
pause
