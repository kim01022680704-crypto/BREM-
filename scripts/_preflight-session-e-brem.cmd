@echo off
setlocal EnableExtensions
cd /d E:\BREM
echo === preflight ===
if exist E:\BREM\package.json (echo [OK] package.json) else (echo [FAIL] package.json & exit /b 1)
if exist E:\BREM\scripts\baemin-session-local-server.js (echo [OK] baemin session script) else (echo [FAIL] baemin session script & exit /b 1)
if exist E:\BREM\scripts\coupang-session-local-server.js (echo [OK] coupang session script) else (echo [FAIL] coupang session script & exit /b 1)
if exist E:\BREM\server\contribution-admin.js (echo [OK] contribution-admin) else (echo [FAIL] contribution-admin & exit /b 1)
if exist "E:\브램로컬\BREM\.playwright-browsers" (echo [OK] playwright browsers) else (echo [FAIL] playwright browsers & exit /b 1)
findstr /C:"ensureContributionHeartbeat" E:\BREM\server\contribution-admin.js >nul
if errorlevel 1 (echo [FAIL] contribution heartbeat missing & exit /b 1) else echo [OK] contribution heartbeat
findstr /C:"BREM_DIR=E:\BREM" E:\BREM\scripts\배민세션서버-원클릭.bat >nul
if errorlevel 1 (echo [FAIL] baemin bat dir & exit /b 1) else echo [OK] baemin bat -> E:\BREM
findstr /C:"BREM_DIR=E:\BREM" E:\BREM\scripts\쿠팡세션서버-원클릭.bat >nul
if errorlevel 1 (echo [FAIL] coupang bat dir & exit /b 1) else echo [OK] coupang bat -> E:\BREM
findstr /C:"BREM_DIR=E:\BREM" "%USERPROFILE%\Desktop\BREM-배민쿠팡-통합세션서버.bat" >nul
if errorlevel 1 (echo [FAIL] desktop bat dir & exit /b 1) else echo [OK] desktop bat -> E:\BREM
echo [check] node syntax
node --check server\contribution-admin.js
if errorlevel 1 exit /b 1
node --check server\baemin-collect-pipeline.js
if errorlevel 1 exit /b 1
node --check server\coupang-collect-pipeline.js
if errorlevel 1 exit /b 1
node --check scripts\baemin-session-local-server.js
if errorlevel 1 exit /b 1
node --check scripts\coupang-session-local-server.js
if errorlevel 1 exit /b 1
echo [check] contribution tests
node scripts\_test-contribution-ledger-v3.js
if errorlevel 1 exit /b 1
echo === preflight OK ===
exit /b 0
