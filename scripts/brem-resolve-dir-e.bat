@echo off
rem E:\*\BREM only (original local copy — e.g. E:\브램로컬\BREM)
set "BREM_DIR="

for /f "delims=" %%D in ('dir /b /ad "E:\" 2^>nul') do (
  if not defined BREM_DIR if exist "E:\%%D\BREM\package.json" set "BREM_DIR=E:\%%D\BREM"
)

exit /b 0
