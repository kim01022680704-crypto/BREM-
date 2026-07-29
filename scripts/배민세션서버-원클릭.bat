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
if errorlevel 1 (
  echo.
  echo ================================================================
  echo  [중단] git pull 실패 - 코드를 갱신하지 못했습니다.
  echo ================================================================
  echo  이대로 서버를 띄우면 옛 코드가 계속 돌아갑니다.
  echo  관리자 화면에 아무리 배포해도 수집에는 반영되지 않습니다.
  echo.
  echo  --- 이 폴더에서 수정된 파일 ---
  git -c core.quotepath=false status --short
  echo  -------------------------------
  echo.
  echo  위에 파일이 보이면 그게 pull 을 막고 있습니다.
  echo  수정 내용을 버려도 되면 아래를 실행하세요.
  echo     cd /d "%BREM_DIR%"
  echo     git reset --hard origin/main
  echo.
  echo  목록이 비어 있으면 네트워크 문제입니다. 인터넷 확인 후 다시 실행하세요.
  echo.
  pause
  exit /b 1
)
echo   코드 최신화 완료.
echo.

echo [2/3] 포트 3939 정리 ...
set "KILLED=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3939" ^| findstr LISTENING') do (
  taskkill /F /PID %%a >nul 2>&1
  set "KILLED=1"
)
if "%KILLED%"=="1" (
  echo   기존 서버 종료됨 - 2초 대기...
  ping -n 3 127.0.0.1 >nul
) else (
  echo   실행 중인 서버 없음.
)
echo.

echo [3/3] 세션 서버 시작 ...
echo   ▶ 준비되면 관리자 화면에서 [배민 세션 갱신]을 누르고,
echo     새로 뜨는 Playwright 창에서 배민 BIZ 로그인 -^> /delivery/history 진입
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
