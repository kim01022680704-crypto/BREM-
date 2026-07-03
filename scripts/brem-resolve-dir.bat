@echo off
rem Prefer the repo that contains this scripts folder, then Desktop, then E:\*\BREM
set "BREM_DIR="

if exist "%~dp0..\package.json" for %%I in ("%~dp0..") do set "BREM_DIR=%%~fI"

if not defined BREM_DIR if exist "%USERPROFILE%\Desktop\BREM\package.json" set "BREM_DIR=%USERPROFILE%\Desktop\BREM"

if not defined BREM_DIR (
  for /f "delims=" %%D in ('dir /b /ad "E:\" 2^>nul') do (
    if not defined BREM_DIR if exist "E:\%%D\BREM\package.json" set "BREM_DIR=E:\%%D\BREM"
  )
)

exit /b 0
