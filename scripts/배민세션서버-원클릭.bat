@echo off
setlocal EnableExtensions
chcp 65001 >nul
title BREM 배민 세션서버 (원클릭 - E드라이브)

rem ================================================================
rem  더블클릭 한 번으로: git pull -> 포트 3939 정리 -> 세션서버 시작
rem  로컬 폴더가 다르면 아래 BREM_DIR 값만 바꾸세요.
rem ================================================================
set "BREM_DIR=E:\브램로컬\BREM"

if not exist "%BREM_DIR%\package.json" (
  echo [오류] %BREM_DIR% 에서 package.json 을 찾지 못했습니다.
  echo        폴더 위치가 다르면 이 파일의 BREM_DIR 값을 수정하세요.
  pause
  exit /b 1
)

cd /d "%BREM_DIR%"
set "PLAYWRIGHT_BROWSERS_PATH=%BREM_DIR%\.playwright-browsers"

echo.
echo ========================================
echo   BREM 배민 세션서버 (E드라이브)
echo   %BREM_DIR%
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [오류] Node.js 가 설치되어 있지 않거나 PATH 에 없습니다.
  pause
  exit /b 1
)

echo [1/3] git pull ...
git pull
if errorlevel 1 echo [경고] git pull 실패 - 무시하고 계속합니다.
echo.

echo [2/3] 포트 3939 정리 ...
set "KILLED=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3939" ^| findstr LISTENING') do (
  taskkill /F /PID %%a >nul 2>&1
  set "KILLED=1"
)
if "%KILLED%"=="1" (
  echo   기존 서버 종료됨 - 2초 대기...
  timeout /t 2 /nobreak >nul
) else (
  echo   실행 중인 서버 없음.
)
echo.

echo [3/3] 세션 서버 시작 ...
echo   ▶ 준비되면 관리자 화면에서 [배민 세션 갱신]을 누르고,
echo     새로 뜨는 Playwright 창에서 배민 BIZ 로그인 -> /delivery/history 진입
echo   ▶ 이 창은 닫지 마세요.
echo.
call npm.cmd run baemin:session-server

echo.
if errorlevel 1 (
  echo [오류] 서버가 오류로 종료되었습니다.
  echo   - 포트 3939 사용 중이면 이 bat 을 다시 실행하세요.
  echo   - Chromium 미설치 시: node node_modules\playwright\cli.js install chromium
) else (
  echo [정보] 서버가 종료되었습니다.
)
pause
