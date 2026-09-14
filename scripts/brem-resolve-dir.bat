@echo off
rem Prefer this scripts folder's repo, then E:\BREM, then E:\*\BREM. Never Desktop.
set "BREM_DIR="

if exist "%~dp0..\package.json" for %%I in ("%~dp0..") do set "BREM_DIR=%%~fI"

if not defined BREM_DIR if exist "E:\BREM\package.json" set "BREM_DIR=E:\BREM"

if not defined BREM_DIR (
  for /f "delims=" %%D in ('dir /b /ad "E:\" 2^>nul') do (
    if not defined BREM_DIR if exist "E:\%%D\BREM\package.json" set "BREM_DIR=E:\%%D\BREM"
  )
)

exit /b 0
