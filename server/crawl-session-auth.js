/**
 * 배민/쿠팡 크롤 세션 authState 공통 헬퍼
 * authState: ok | authRequired | recovering
 */

const AUTH_OK = 'ok';
const AUTH_REQUIRED = 'authRequired';
const AUTH_RECOVERING = 'recovering';

function isBaeminLoginLikeUrl(url) {
  const value = String(url || '').toLowerCase();
  return /login|signin|sign-in|auth|oauth|member\.baemin|bizmember|passport|sms|otp|phone|인증|verify/.test(value);
}

function isBaeminPhoneAuthLikeUrl(url) {
  const value = String(url || '').toLowerCase();
  return /sms|otp|phone|휴대폰|인증번호|verify|cert|2fa|mfa/.test(value)
    && /baemin|bizmember|passport|delivery/.test(value);
}

function isCoupangLoginLikeUrl(url) {
  const value = String(url || '').toLowerCase();
  return /login|signin|sign-in|auth|oauth|otp|verify|2fa|mfa|cert/.test(value)
    && (/coupang|partner\.coupangeats/.test(value) || !value.includes('http'));
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
  authRequired = false
} = {}) {
  if (recovering) return AUTH_RECOVERING;
  if (authRequired) return AUTH_REQUIRED;
  if (isCoupangLoginLikeUrl(currentUrl) && !hasToken) return AUTH_REQUIRED;
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
  isBaeminLoginLikeUrl,
  isBaeminPhoneAuthLikeUrl,
  isCoupangLoginLikeUrl,
  resolveBaeminAuthState,
  resolveCoupangAuthState,
  authStateLabel,
  computeCrawlWeekRangeFromLatest
};
