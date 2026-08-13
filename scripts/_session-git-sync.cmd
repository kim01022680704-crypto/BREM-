@echo off
rem ================================================================
rem  세션서버 원클릭용: origin/main 동기화
rem  - stale index.lock 제거
rem  - 로컬 수정이 있어도 pull 막히면 reset --hard 로 맞춤
rem  - 프로필 폴더(.naver / .coupang)는 유지
rem  - 네트워크 실패여도 exit 0 → 서버 기동은 계속
rem ================================================================
setlocal EnableExtensions

if not exist ".git" (
  echo   [경고] .git 없음 - 동기화 건너뜀
  exit /b 0
)

if exist ".git\index.lock" (
  echo   stale .git\index.lock 제거...
  del /f /q ".git\index.lock" >nul 2>&1
)

echo   git fetch origin main ...
git fetch origin main
if errorlevel 1 (
  echo   [경고] fetch 실패(네트워크). 현재 폴더 코드로 서버를 계속 띄웁니다.
  exit /b 0
)

echo   origin/main 으로 맞춤 (로컬 수정 덮어씀, 로그인 프로필은 유지)...
git reset --hard origin/main
if errorlevel 1 (
  echo   [경고] reset 실패. 현재 폴더 코드로 서버를 계속 띄웁니다.
  exit /b 0
)

echo   코드 동기화 완료.
exit /b 0
