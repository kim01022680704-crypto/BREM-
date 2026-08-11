@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

echo ========================================
echo BREM 크롤링 상시 기동 (배민+쿠팡)
echo - 세션서버 자동 실행
echo - AUTO_RESUME_STATUS_LOOP=1 로 순회 재개
echo ========================================

set BAEMIN_AUTO_RESUME_STATUS_LOOP=1
set COUPANG_AUTO_RESUME_STATUS_LOOP=1

start "BREM-Baemin-Session" cmd /k "cd /d "%cd%" && set BAEMIN_AUTO_RESUME_STATUS_LOOP=1 && npm run baemin:session-server"
timeout /t 3 /nobreak >nul
start "BREM-Coupang-Session" cmd /k "cd /d "%cd%" && set COUPANG_AUTO_RESUME_STATUS_LOOP=1 && npm run coupang:session-server"

echo.
echo 두 창을 닫지 마세요.
echo 최초 1회: 배민 휴대폰 인증 / .env 쿠팡 ID·PW / 네이버메일(쿠팡 OTP) 로그인
echo 관리자(지정 ID만): 탑바 → [크롤링 시작]
echo.
pause
