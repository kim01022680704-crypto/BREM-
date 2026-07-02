@echo off
rem Find E:\*\BREM without hardcoding Korean folder names in this file.
set "BREM_DIR="

for /f "delims=" %%D in ('dir /b /ad "E:\" 2^>nul') do (
  if not defined BREM_DIR if exist "E:\%%D\BREM\package.json" set "BREM_DIR=E:\%%D\BREM"
)

if not defined BREM_DIR (
  if exist "%USERPROFILE%\Desktop\BREM\package.json" set "BREM_DIR=%USERPROFILE%\Desktop\BREM"
)

if not defined BREM_DIR (
  if exist "%~dp0..\package.json" for %%I in ("%~dp0..") do set "BREM_DIR=%%~fI"
)

exit /b 0
