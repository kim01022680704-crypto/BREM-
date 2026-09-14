chcp 65001 >nul
title BREM-baemin-3939
cd /d E:\BREM
set PLAYWRIGHT_BROWSERS_PATH=E:\BREM\.playwright-browsers
set BAEMIN_PLAYWRIGHT_PROFILE=E:\BREM\_live-baemin-profile
set BAEMIN_AUTO_OPEN_BROWSER=1
set BAEMIN_AUTO_RESUME_STATUS_LOOP=1
echo starting baemin from E:\BREM
echo profile=%BAEMIN_PLAYWRIGHT_PROFILE%
npm.cmd run baemin:session-server
echo baemin exited %ERRORLEVEL%
pause
