@echo off
setlocal EnableExtensions
chcp 65001 >nul
title 쿠팡 데이터 수집 실행

rem ================================================================
rem  쿠팡 세션서버(3940)가 켜져 있고, 브라우저에서 로그인 + 대시보드를
rem  한 번 연 상태에서 실행하세요.
rem  POST http://127.0.0.1:3940/collect 를 호출해 오늘/이번주 데이터를 수집합니다.
rem ================================================================

echo 쿠팡 세션서버 상태 확인 ...
powershell -NoProfile -Command "try { $h = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3940/health' -TimeoutSec 10; if (-not $h.hasToken) { Write-Host '[안내] 아직 로그인 토큰이 없습니다. 쿠팡 브라우저에서 로그인 후 대시보드를 한 번 여세요.'; exit 1 } else { Write-Host ('[확인] 토큰 OK · 매장 ' + $h.vendorCount + '개 감지됨') } } catch { Write-Host '[오류] 세션서버(3940)에 연결할 수 없습니다. 통합 세션서버 bat을 먼저 실행하세요.'; exit 1 }"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

echo.
echo 데이터 수집 중 ... (최대 몇 분 소요)
powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3940/collect' -TimeoutSec 300 -ContentType 'application/json' -Body '{}'; Write-Host ''; Write-Host '[수집 결과]'; Write-Host (' 피크(오늘)   : ' + $r.summary.peak_realtime); Write-Host (' 주간 달성    : ' + $r.summary.weekly_performance); Write-Host (' 지역별 요약  : ' + $r.summary.vendor_info); Write-Host (' 라이더별     : ' + $r.summary.rider_daily); if ($r.summary.errors.Count -gt 0) { Write-Host ''; Write-Host '[경고]'; $r.summary.errors | ForEach-Object { Write-Host ('  - ' + $_) } } } catch { Write-Host '[오류]' $_.Exception.Message }"

echo.
echo 완료되면 관리자 화면 '쿠팡 현황' / 대시보드 쿠팡 카드를 새로고침(Ctrl+F5) 하세요.
echo.
pause
