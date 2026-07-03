@echo off
setlocal EnableExtensions
title BREM Push + Deploy (E drive)

set "BREM_DIR="
call "%~dp0brem-resolve-dir-e.bat"

if not defined BREM_DIR (
  echo [ERROR] E:\*\BREM folder not found.
  pause
  exit /b 1
)

cd /d "%BREM_DIR%"

echo ========================================
echo   BREM Git Push + Vercel Deploy [E drive]
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

set /p CONFIRM=Push origin/main and deploy to brem.kr? (y/N): 
if /i not "%CONFIRM%"=="y" (
  echo [CANCEL] Aborted.
  pause
  exit /b 0
)

echo.
echo [PUSH] git push origin main ...
git push origin main
if errorlevel 1 (
  echo [ERROR] git push failed.
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
echo [DONE] Push and deploy finished from E drive.
echo   https://brem.kr
echo   Session server: run BREM-E-배민세션서버.bat
pause
