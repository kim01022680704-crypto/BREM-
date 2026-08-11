param(
  [string]$LogPath = 'C:\Users\user\Desktop\BREM\logs\crawl-monitor.log',
  [string]$StatePath = 'C:\Users\user\Desktop\BREM\logs\crawl-monitor-state.json',
  [switch]$ResetArm
)

$ErrorActionPreference = 'Continue'
$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$alerts = @()

function Get-HealthSafe([string]$Url) {
  try {
    return Invoke-RestMethod -Uri $Url -TimeoutSec 10
  } catch {
    return $null
  }
}

function Read-ArmState {
  if (-not (Test-Path -LiteralPath $StatePath)) {
    return @{ armed = $false; armedAt = $null }
  }
  try {
    return (Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json)
  } catch {
    return @{ armed = $false; armedAt = $null }
  }
}

function Write-ArmState([bool]$Armed, $ArmedAt) {
  $dir = Split-Path -Parent $StatePath
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  @{
    armed = $Armed
    armedAt = $ArmedAt
    updatedAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  } | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
}

if ($ResetArm) {
  Write-ArmState -Armed $false -ArmedAt $null
}

$arm = Read-ArmState
$armed = [bool]$arm.armed

$b = Get-HealthSafe 'http://127.0.0.1:3939/health'
$c = Get-HealthSafe 'http://127.0.0.1:3940/health'

$bActive = [bool]$b.statusLoop.active
$cActive = [bool]$c.statusLoop.active
$bPhase = [string]$b.statusLoop.phase
$cPhase = [string]$c.statusLoop.phase
$bRound = [int]($b.statusLoop.round)
$cRound = [int]($c.statusLoop.round)
$bErr = [string]$b.statusLoop.lastError
$cErr = [string]$c.statusLoop.lastError
$bAuth = [string]($b.authState)
if (-not $bAuth) { $bAuth = [string]$b.session.authState }
$cAuth = [string]$c.authState
$cToken = [bool]$c.hasToken

# 사용자가 「크롤링 시작」으로 한 번이라도 돌린 뒤에만 자동 재기동
if ($bActive -or $cActive) {
  if (-not $armed) {
    $armed = $true
    Write-ArmState -Armed $true -ArmedAt $ts
    $alerts += 'ARMED'
  }
}

if (-not $b) { $alerts += 'BAEMIN_HEALTH_DOWN' }
elseif (-not $bActive) {
  if ($armed) {
    $alerts += 'BAEMIN_LOOP_STOPPED'
    try {
      Invoke-RestMethod 'http://127.0.0.1:3939/status-loop/start' -Method POST -ContentType 'application/json' -Body '{}' -TimeoutSec 60 | Out-Null
      $alerts += 'BAEMIN_RESTART_OK'
      $b = Get-HealthSafe 'http://127.0.0.1:3939/health'
      $bActive = [bool]$b.statusLoop.active
      $bPhase = [string]$b.statusLoop.phase
      $bRound = [int]($b.statusLoop.round)
    } catch {
      $alerts += 'BAEMIN_RESTART_FAIL'
    }
  } else {
    $alerts += 'BAEMIN_WAITING_START'
  }
}
if ($bAuth -match 'authRequired|recovering') { $alerts += 'BAEMIN_AUTH' }
if ($bErr) { $alerts += "BAEMIN_ERR:$bErr" }

if (-not $c) { $alerts += 'COUPANG_HEALTH_DOWN' }
elseif (-not $cActive) {
  if ($armed) {
    $alerts += 'COUPANG_LOOP_STOPPED'
    try {
      Invoke-RestMethod 'http://127.0.0.1:3940/status-loop/start' -Method POST -ContentType 'application/json' -Body '{}' -TimeoutSec 60 | Out-Null
      $alerts += 'COUPANG_RESTART_OK'
      $c = Get-HealthSafe 'http://127.0.0.1:3940/health'
      $cActive = [bool]$c.statusLoop.active
      $cPhase = [string]$c.statusLoop.phase
      $cRound = [int]($c.statusLoop.round)
    } catch {
      $alerts += 'COUPANG_RESTART_FAIL'
    }
  } else {
    $alerts += 'COUPANG_WAITING_START'
  }
}
if (-not $cToken -or $cAuth -match 'authRequired|recovering') { $alerts += 'COUPANG_AUTH' }
if ($cErr) { $alerts += "COUPANG_ERR:$cErr" }

$erp = $b.erpPublishSchedule
$weekly = $b.weeklyRefreshSchedule
$erpNext = if ($erp.next) { "$($erp.next.date) $($erp.next.slot)" } else { '-' }
$weekNext = if ($weekly.next) { "$($weekly.next.date) $($weekly.next.slot)" } else { '-' }
$erpLast = [string]$erp.lastSlotKey
$weekLast = [string]$weekly.lastSlotKey

$line = "[$ts] armed=$armed bActive=$bActive bPhase=$bPhase bRound=$bRound | cActive=$cActive cPhase=$cPhase cRound=$cRound token=$cToken | erpNext=$erpNext erpLast=$erpLast | weekNext=$weekNext weekLast=$weekLast | alerts=$([string]::Join(';', $alerts))"
$dir = Split-Path -Parent $LogPath
if (-not (Test-Path -LiteralPath $dir)) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}
Add-Content -Path $LogPath -Value $line -Encoding UTF8

$payload = @{
  prompt = 'crawl overnight monitor tick: read C:\Users\user\Desktop\BREM\logs\crawl-monitor.log last 8 lines; health 3939/3940; auto-restart ONLY after armed (user started crawl once); note erp/weekly next/last; continue until 2026-08-13 13:00 KST then summarize.'
  ts = $ts
  armed = $armed
  baemin = @{ active = $bActive; phase = $bPhase; round = $bRound; err = $bErr; auth = $bAuth }
  coupang = @{ active = $cActive; phase = $cPhase; round = $cRound; err = $cErr; auth = $cAuth; token = $cToken }
  erpNext = $erpNext
  weekNext = $weekNext
  alerts = $alerts
} | ConvertTo-Json -Compress

Write-Output "AGENT_LOOP_TICK_crawl_monitor $payload"
if ($alerts -match 'RESTART_FAIL|AUTH|_DOWN|LOOP_STOPPED') {
  Write-Output ("AGENT_LOOP_ALERT_crawl_monitor " + ($alerts -join ','))
}
