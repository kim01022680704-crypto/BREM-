@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title BREM 배민 세션 서버

rem 이 bat 파일 기준으로 프로젝트 루트 (scripts\..)
set "PROJECT_DIR=%~dp0.."
for %%I in ("%PROJECT_DIR%") do set "PROJECT_DIR=%%~fI"

if not exist "%PROJECT_DIR%\package.json" (
  echo [오류] BREM 프로젝트를 찾지 못했습니다: %PROJECT_DIR%
  pause
  exit /b 1
)

cd /d "%PROJECT_DIR%"
set "PLAYWRIGHT_BROWSERS_PATH=%PROJECT_DIR%\.playwright-browsers"

where node >nul 2>&1
if errorlevel 1 (
  echo [오류] Node.js가 없거나 PATH에 등록되지 않았습니다.
  echo https://nodejs.org 에서 설치 후 다시 시도하세요.
  pause
  exit /b 1
)

echo.
echo ========================================
echo   BREM 배민 세션 서버
echo   폴더: %PROJECT_DIR%
echo   확인: http://127.0.0.1:3939/health
echo ========================================
echo   이 창을 닫으면 서버가 꺼집니다.
echo ========================================
echo.

echo [업데이트] git pull 실행 중...
git pull
if errorlevel 1 (
  echo [경고] git pull 실패 — 수동으로 pull 하세요.
) else (
  echo [업데이트] 완료
)
echo.

call npm.cmd run baemin:session-server

echo.
if errorlevel 1 (
  echo [오류] 서버가 비정상 종료되었습니다.
) else (
  echo [안내] 서버가 종료되었습니다.
)
pause
