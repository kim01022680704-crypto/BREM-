@echo off
setlocal EnableExtensions
chcp 65001 >nul
title BREM 배민+쿠팡 통합 세션 서버

rem ================================================================
rem  더블클릭 한 번으로 배민(3939) + 쿠팡(3940) 세션서버를
rem  각각 별도 창으로 동시에 실행합니다.
rem  각 창에서 개별적으로 git pull / 포트정리 / 서버시작이 진행됩니다.
rem  폴더가 다르면 아래 BREM_DIR 값만 바꾸세요.
rem ================================================================
set "BREM_DIR=E:\브램로컬\BREM"

if not exist "%BREM_DIR%\scripts\배민세션서버-원클릭.bat" (
  echo [오류] %BREM_DIR%\scripts\배민세션서버-원클릭.bat 를 찾지 못했습니다.
  echo        먼저 쿠팡/배민 세션서버 bat 중 하나로 git pull 을 한 번 받으세요.
  pause
  exit /b 1
)
if not exist "%BREM_DIR%\scripts\쿠팡세션서버-원클릭.bat" (
  echo [오류] %BREM_DIR%\scripts\쿠팡세션서버-원클릭.bat 를 찾지 못했습니다.
  echo        먼저 git pull 로 최신 코드를 받으세요.
  pause
  exit /b 1
)

echo [1/2] 배민 세션서버(3939) 창을 엽니다 ...
start "" "%BREM_DIR%\scripts\배민세션서버-원클릭.bat"

echo [2/2] 쿠팡 세션서버(3940) 창을 엽니다 ...
start "" "%BREM_DIR%\scripts\쿠팡세션서버-원클릭.bat"

echo.
echo ========================================
echo  배민/쿠팡 세션서버 창 2개가 열렸습니다.
echo   - 배민 : 관리자 화면 [배민 세션 갱신] 후 Playwright 창에서 BIZ 로그인
echo   - 쿠팡 : Playwright 창에서 쿠팡이츠 로그인 + 대시보드 한 번 열기
echo   두 창은 닫지 마세요. (이 창은 닫아도 됩니다)
echo.
echo  쿠팡 로그인 후 데이터 수집은
echo   scripts\쿠팡수집-실행.bat 을 더블클릭하세요.
echo ========================================
echo.
timeout /t 6 /nobreak >nul
