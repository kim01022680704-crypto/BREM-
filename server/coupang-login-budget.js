/**
 * 쿠팡 자동로그인 실패 제한.
 * 하루 횟수 한도가 아니다. 로그아웃 후 자동로그인은 하고,
 * 연속 실패가 2회면 보안 잠김을 막기 위해 멈춘다.
 * 성공하면 실패 카운트는 0으로 돌아간다. KST 날짜가 바뀌면 리셋.
 */
const fs = require('fs');
const path = require('path');

const MAX_FAILURES = 2;

function kstDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function filePath() {
  const dir = String(process.env.COUPANG_PLAYWRIGHT_PROFILE || '').trim()
    || path.join(process.cwd(), '.coupang-playwright-profile');
  return path.join(dir, '.brem-login-budget.json');
}

function emptyState() {
  return {
    day: kstDay(),
    loginFailures: 0,
    emailFailures: 0,
    lastEmailSentAt: 0,
    lastLoginAt: 0,
    lastError: ''
  };
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    if (!raw || raw.day !== kstDay()) return emptyState();
    return {
      ...emptyState(),
      lastEmailSentAt: Number(raw.lastEmailSentAt || 0),
      lastLoginAt: Number(raw.lastLoginAt || 0),
      lastError: String(raw.lastError || ''),
      loginFailures: Number(raw.loginFailures || 0),
      emailFailures: Number(raw.emailFailures || 0)
    };
  } catch {
    return emptyState();
  }
}

function save(state) {
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch { /* ignore */ }
  return state;
}

function inspect() {
  const state = load();
  const loginFailures = Number(state.loginFailures || 0);
  const emailFailures = Number(state.emailFailures || 0);
  return {
    ...state,
    loginFailures,
    emailFailures,
    maxLogin: MAX_FAILURES,
    maxEmail: MAX_FAILURES,
    canLogin: loginFailures < MAX_FAILURES,
    canEmail: emailFailures < MAX_FAILURES,
    remainingLogin: Math.max(0, MAX_FAILURES - loginFailures),
    remainingEmail: Math.max(0, MAX_FAILURES - emailFailures),
    // 예전 health 필드. 값은 실패 횟수다.
    loginAttempts: loginFailures,
    emailSendAttempts: emailFailures
  };
}

function canAttemptLogin() {
  const state = inspect();
  if (!state.canLogin) {
    return {
      ok: false,
      error: 'LOGIN_BUDGET_EXHAUSTED',
      message: `연속 로그인 실패 ${state.loginFailures}회 — 보안 잠김 방지를 위해 자동 시도를 멈춥니다.`
    };
  }
  return { ok: true, state };
}

function canAttemptEmailSend() {
  const state = inspect();
  if (!state.canEmail) {
    return {
      ok: false,
      error: 'EMAIL_BUDGET_EXHAUSTED',
      message: `연속 이메일 인증 실패 ${state.emailFailures}회 — 추가 전송하지 않습니다.`
    };
  }
  return { ok: true, state };
}

function recordFailure(message = '') {
  const state = load();
  state.loginFailures = Number(state.loginFailures || 0) + 1;
  state.lastError = String(message || '').slice(0, 240);
  return save(state);
}

function recordEmailFailure(message = '') {
  const state = load();
  state.emailFailures = Number(state.emailFailures || 0) + 1;
  state.lastError = String(message || '').slice(0, 240);
  return save(state);
}

function recordSuccess() {
  const state = load();
  state.loginFailures = 0;
  state.emailFailures = 0;
  state.lastLoginAt = Date.now();
  state.lastError = '';
  return save(state);
}

function recordEmailSend(at = Date.now()) {
  const state = load();
  state.lastEmailSentAt = Number(at) || Date.now();
  return save(state);
}

function lastEmailSentAt() {
  return Number(load().lastEmailSentAt || 0);
}

function markError(message) {
  const state = load();
  state.lastError = String(message || '').slice(0, 240);
  return save(state);
}

module.exports = {
  inspect,
  canAttemptLogin,
  canAttemptEmailSend,
  recordFailure,
  recordEmailFailure,
  recordSuccess,
  recordLoginAttempt: recordFailure,
  recordEmailSend,
  lastEmailSentAt,
  markError
};
