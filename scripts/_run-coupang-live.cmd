chcp 65001 >nul
title BREM-coupang-3940
cd /d E:\BREM
set PLAYWRIGHT_BROWSERS_PATH=E:\BREM\.playwright-browsers
set COUPANG_PLAYWRIGHT_PROFILE=E:\BREM\_live-coupang-profile
set NAVER_PLAYWRIGHT_PROFILE=E:\BREM\_live-naver-profile
set COUPANG_AUTO_RESUME_STATUS_LOOP=1
echo starting coupang from E:\BREM
echo profile=%COUPANG_PLAYWRIGHT_PROFILE%
node scripts\coupang-session-local-server.js
echo coupang exited %ERRORLEVEL%
pause
