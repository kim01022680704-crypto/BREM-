@echo off
setlocal EnableExtensions
title BREM 배민 세션서버 (git pull + 재시작)

set "BREM_DIR=E:\브램로컬\BREM"

if not exist "%BREM_DIR%\package.json" (
  echo [ERROR] BREM 폴더를 찾을 수 없습니다.
  echo   %BREM_DIR%
  echo.
  echo Desktop\BREM 또는 E:\브램로컬\BREM 경로를 확인하세요.
  pause
  exit /b 1
)

echo ========================================
echo   BREM 배민 세션서버
echo   %BREM_DIR%
echo ========================================
echo.

cd /d "%BREM_DIR%"
echo [UPDATE] git pull ...
git pull
if errorlevel 1 (
  echo [WARN] git pull 실패 — 로컬 수정 충돌 시 stash 후 다시 실행하세요.
  echo.
)

call "%BREM_DIR%\scripts\restart-baemin-session-server.bat"
