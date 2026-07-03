@echo off
setlocal EnableExtensions
title BREM Baemin Session Server Restart (E drive)

echo [RESTART-E] Stopping process on port 3939...
set "KILLED=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3939" ^| findstr LISTENING') do (
  echo   taskkill /F /PID %%a
  taskkill /F /PID %%a >nul 2>&1
  set "KILLED=1"
)

if "%KILLED%"=="0" (
  echo [RESTART-E] No listener on 3939.
) else (
  echo [RESTART-E] Waiting 2s...
  timeout /t 2 /nobreak >nul
)

call "%~dp0start-baemin-session-server-e.bat"
