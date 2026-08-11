# Windows 로그온 시 크롤링 세션서버 자동 기동 등록
# 실행(관리자 PowerShell): powershell -ExecutionPolicy Bypass -File scripts\register-crawl-startup-task.ps1

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$bat = Join-Path $PSScriptRoot 'start-crawl-always-on.bat'
if (-not (Test-Path $bat)) { throw "Missing $bat" }

$taskName = 'BREM-Crawl-AlwaysOn'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$bat`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Registered scheduled task: $taskName"
Write-Host "Repo: $repo"
Write-Host "At logon this will start Baemin(:3939) + Coupang(:3940) with AUTO_RESUME_STATUS_LOOP=1"
