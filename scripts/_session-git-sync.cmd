@echo off
rem ================================================================
rem  Session-server one-click: sync to origin/main
rem  - remove stale index.lock
rem  - reset --hard if local edits block pull
rem  - keep login profile folders (.naver / .coupang)
rem  - network failure => exit 0 so servers still start
rem ================================================================
setlocal EnableExtensions

if not exist ".git" (
  echo   [WARN] .git missing - skip sync
  exit /b 0
)

if exist ".git\index.lock" (
  echo   removing stale .git\index.lock ...
  del /f /q ".git\index.lock" >nul 2>&1
)

echo   git fetch origin main ...
git fetch origin main
if errorlevel 1 (
  echo   [WARN] fetch failed - starting with current local code
  exit /b 0
)

echo   reset --hard origin/main (keeps login profiles) ...
git reset --hard origin/main
if errorlevel 1 (
  echo   [WARN] reset failed - starting with current local code
  exit /b 0
)

echo   code sync OK
exit /b 0
