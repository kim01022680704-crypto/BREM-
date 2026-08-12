/**
 * 배민/쿠팡 크롤 세션 authState 공통 헬퍼
 * authState: ok | authRequired | recovering
 */

const AUTH_OK = 'ok';
const AUTH_REQUIRED = 'authRequired';
const AUTH_RECOVERING = 'recovering';

/** 배달현황 등 실제 업무 화면 — 인증 화면이 아님 */
function isBaeminAppWorkingUrl(url) {
  const value = String(url || '').toLowerCase();
  return /deliverycenter\.baemin\.com\/(delivery|rider|store|mission|partner)/.test(value);
}

function isBaeminLoginLikeUrl(url) {
  const value = String(url || '').toLowerCase();
  // history?phoneNumber= 같은 쿼리에 phone 이 들어가도 로그인 화면으로 오판하지 않음
  if (isBaeminAppWorkingUrl(value)) return false;
  return /\/login|signin|sign-in|oauth|member\.baemin|biz-?member|passport|nid\.naver/.test(value);
}

function isBaeminPhoneAuthLikeUrl(url) {
  const value = String(url || '').toLowerCase();
  if (isBaeminAppWorkingUrl(value)) return false;
  // ?phoneNumber= 필터 파라미터는 휴대폰 인증이 아님
  if (/[?&]phonenumber=/.test(value)) return false;
  return /휴대폰|인증번호|\/sms(?:\/|$)|\/otp(?:\/|$)|phone-auth|phoneauth|2fa|mfa|certification/.test(value)
    && /baemin|bizmember|passport/.test(value);
}

function isCoupangLoginLikeUrl(url) {
  const value = String(url || '').toLowerCase();
  return /login|signin|sign-in|auth|oauth|otp|verify|2fa|mfa|cert/.test(value)
    && (/coupang|partner\.coupangeats|xauth\.coupang/.test(value) || !value.includes('http'));
}

function resolveBaeminAuthState({
  sessionPaused = false,
  sessionLoggedIn = false,
  currentUrl = '',
  recovering = false,
  jobStatus = '',
  configured = false,
  lastError = ''
} = {}) {
  if (recovering) return AUTH_RECOVERING;
  // 배달현황 등 업무 화면에 로그인돼 있으면 정상 (pause 잔상 무시)
  if (sessionLoggedIn && isBaeminAppWorkingUrl(currentUrl)) return AUTH_OK;
  if (jobStatus === 'waiting_login' || jobStatus === 'waiting_phone_auth') return AUTH_REQUIRED;
  if (isBaeminLoginLikeUrl(currentUrl) || isBaeminPhoneAuthLikeUrl(currentUrl)) return AUTH_REQUIRED;
  if (sessionPaused) return AUTH_REQUIRED;
  if (lastError && !sessionLoggedIn) return AUTH_REQUIRED;
  if (sessionLoggedIn || configured) return AUTH_OK;
  return AUTH_REQUIRED;
}

function resolveCoupangAuthState({
  hasToken = false,
  recovering = false,
  currentUrl = '',
  authRequired = false,
  tokenExpired = false
} = {}) {
  if (recovering) return AUTH_RECOVERING;
  if (authRequired) return AUTH_REQUIRED;
  // 로그인/OTP URL이면 토큰이 남아 있어도 재로그인 필요 (만료 토큰 잔상)
  if (isCoupangLoginLikeUrl(currentUrl)) return AUTH_REQUIRED;
  if (tokenExpired) return AUTH_REQUIRED;
  if (hasToken) return AUTH_OK;
  return AUTH_REQUIRED;
}

function authStateLabel(authState) {
  if (authState === AUTH_OK) return '정상';
  if (authState === AUTH_RECOVERING) return '복구 중';
  if (authState === AUTH_REQUIRED) return '로그인 필요';
  return String(authState || '-');
}

/**
 * 수~화 정산주: “조회 가능 최신일(보통 어제)”이 속한 주.
 * 수요일에 전주 화요일이 빠지지 않도록 today가 아니라 latest 기준으로 잡는다.
 */
function computeCrawlWeekRangeFromLatest(latestDate, settlementWeekStartFn) {
  const latest = String(latestDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latest)) {
    return { fromDate: '', toDate: '', label: '' };
  }
  const fromDate = typeof settlementWeekStartFn === 'function'
    ? settlementWeekStartFn(latest)
    : latest;
  return {
    fromDate: String(fromDate || latest).slice(0, 10),
    toDate: latest,
    label: `${String(fromDate || latest).slice(0, 10)} ~ ${latest}`
  };
}

module.exports = {
  AUTH_OK,
  AUTH_REQUIRED,
  AUTH_RECOVERING,
  isBaeminAppWorkingUrl,
  isBaeminLoginLikeUrl,
  isBaeminPhoneAuthLikeUrl,
  isCoupangLoginLikeUrl,
  resolveBaeminAuthState,
  resolveCoupangAuthState,
  authStateLabel,
  computeCrawlWeekRangeFromLatest
};
