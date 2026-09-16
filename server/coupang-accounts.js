/**
 * 쿠팡 파트너 포털 계정 레지스트리.
 * 크롤 구조는 동일하고, 로그인/OTP/브라우저 프로필/세션키/포트만 계정별로 분리한다.
 */
const path = require('path');
try {
  require('dotenv').config({ path: path.join(process.cwd(), '.env') });
} catch { /* optional */ }

const DEFAULT_ID = 'default';
const ACCOUNT_DEDUPE_PREFIX = 'acct:';

function firstEnv(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function parseArgAccountId() {
  const flag = (process.argv || []).find(arg => String(arg).startsWith('--account='));
  return flag ? String(flag.split('=').slice(1).join('=') || '').trim() : '';
}

function defaultAccount() {
  const loginId = firstEnv('COUPANG_LOGIN_ID', 'COUPANG_USER_ID');
  const loginPassword = String(process.env.COUPANG_LOGIN_PASSWORD || process.env.COUPANG_PASSWORD || '');
  return {
    id: DEFAULT_ID,
    label: loginId || '기본',
    loginId,
    loginPassword,
    naverId: firstEnv('NAVER_LOGIN_ID', 'NAVER_ID'),
    naverPassword: String(process.env.NAVER_LOGIN_PASSWORD || process.env.NAVER_PASSWORD || ''),
    port: Number(process.env.COUPANG_SESSION_LOCAL_PORT || 3940) || 3940,
    profileDir: firstEnv('COUPANG_PLAYWRIGHT_PROFILE')
      || path.join(process.cwd(), '.coupang-playwright-profile'),
    naverProfileDir: firstEnv('NAVER_PLAYWRIGHT_PROFILE')
      || path.join(process.cwd(), '.naver-playwright-profile'),
    sessionKey: 'brem_coupang_session',
    configured: Boolean(loginId && loginPassword)
  };
}

function secondAccount() {
  const id = firstEnv('COUPANG_2_ACCOUNT_ID') || 'cmp119';
  const loginId = firstEnv('COUPANG_2_LOGIN_ID');
  const loginPassword = String(process.env.COUPANG_2_LOGIN_PASSWORD || '');
  if (!loginId || !loginPassword) return null;
  return {
    id,
    label: loginId,
    loginId,
    loginPassword,
    naverId: firstEnv('COUPANG_2_NAVER_LOGIN_ID', 'COUPANG_2_NAVER_ID'),
    naverPassword: String(process.env.COUPANG_2_NAVER_LOGIN_PASSWORD || process.env.COUPANG_2_NAVER_PASSWORD || ''),
    port: Number(process.env.COUPANG_2_SESSION_PORT || 3941) || 3941,
    profileDir: firstEnv('COUPANG_2_PLAYWRIGHT_PROFILE')
      || path.join(process.cwd(), `.coupang-playwright-profile-${id}`),
    naverProfileDir: firstEnv('COUPANG_2_NAVER_PLAYWRIGHT_PROFILE')
      || path.join(process.cwd(), `.naver-playwright-profile-${id}`),
    sessionKey: `brem_coupang_session_${id}`,
    configured: true
  };
}

function listCoupangAccounts() {
  const accounts = [defaultAccount()];
  const extra = secondAccount();
  if (extra) accounts.push(extra);
  return accounts;
}

function getCoupangAccount(accountId) {
  const id = String(accountId || DEFAULT_ID).trim() || DEFAULT_ID;
  return listCoupangAccounts().find(account => account.id === id) || null;
}

function resolveRequestedAccountId() {
  return firstEnv('COUPANG_ACCOUNT_ID') || parseArgAccountId() || DEFAULT_ID;
}

/** 세션 서버 기동 시 해당 계정 env 를 프로세스에 입힌다. default 는 기존 env 유지. */
function applyCoupangAccountEnv(accountId = resolveRequestedAccountId()) {
  const account = getCoupangAccount(accountId);
  if (!account) {
    throw new Error(`쿠팡 계정 '${accountId}' 설정이 없습니다. COUPANG_2_LOGIN_ID 를 확인하세요.`);
  }
  process.env.COUPANG_ACCOUNT_ID = account.id;
  if (account.id === DEFAULT_ID) return account;

  process.env.COUPANG_LOGIN_ID = account.loginId;
  process.env.COUPANG_LOGIN_PASSWORD = account.loginPassword;
  process.env.NAVER_LOGIN_ID = account.naverId;
  process.env.NAVER_LOGIN_PASSWORD = account.naverPassword;
  process.env.COUPANG_SESSION_LOCAL_PORT = String(account.port);
  process.env.COUPANG_PLAYWRIGHT_PROFILE = account.profileDir;
  process.env.NAVER_PLAYWRIGHT_PROFILE = account.naverProfileDir;
  if (String(process.env.COUPANG_2_NAVER_MANUAL_LOGIN || '').trim() === '1') {
    process.env.NAVER_MANUAL_LOGIN = '1';
  }
  return account;
}

function currentCoupangAccountId() {
  return firstEnv('COUPANG_ACCOUNT_ID') || DEFAULT_ID;
}

function sessionKeyFor(accountId = currentCoupangAccountId()) {
  const account = getCoupangAccount(accountId);
  return account?.sessionKey || 'brem_coupang_session';
}

function accountDedupePrefix(accountId = currentCoupangAccountId()) {
  const id = String(accountId || DEFAULT_ID).trim() || DEFAULT_ID;
  if (id === DEFAULT_ID) return '';
  return `${ACCOUNT_DEDUPE_PREFIX}${id}|`;
}

function withAccountDedupeKey(dedupeKey, accountId = currentCoupangAccountId()) {
  const raw = String(dedupeKey || '').trim();
  const prefix = accountDedupePrefix(accountId);
  if (!raw || !prefix) return raw;
  return raw.startsWith(prefix) ? raw : `${prefix}${raw}`;
}

function listCoupangAccountPorts() {
  return [...new Set(listCoupangAccounts().filter(account => account.configured).map(account => account.port))];
}

module.exports = {
  DEFAULT_ID,
  ACCOUNT_DEDUPE_PREFIX,
  listCoupangAccounts,
  getCoupangAccount,
  resolveRequestedAccountId,
  applyCoupangAccountEnv,
  currentCoupangAccountId,
  sessionKeyFor,
  accountDedupePrefix,
  withAccountDedupeKey,
  listCoupangAccountPorts
};
