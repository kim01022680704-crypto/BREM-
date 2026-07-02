@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title BREM Baemin Session Server (Restart)

echo [RESTART] Stopping process on port 3939...
set "KILLED=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3939" ^| findstr LISTENING') do (
  echo   taskkill /F /PID %%a
  taskkill /F /PID %%a >nul 2>&1
  set "KILLED=1"
)

if "%KILLED%"=="0" (
  echo [RESTART] No listener on 3939.
) else (
  echo [RESTART] Waiting 2s...
  timeout /t 2 /nobreak >nul
)

call "%~dp0start-baemin-session-server.bat"
