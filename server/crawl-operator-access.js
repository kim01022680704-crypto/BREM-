/**
 * 크롤링 원버튼 조작 가능 관리자 판별
 * 1) 관리자 계정 레지스트리 canOperateCrawl === true (ERP 설정)
 * 2) 미설정(undefined)이면 레거시 env/기본 운영자 허용
 * 3) canOperateCrawl === false 이면 명시적 거부 (env로도 못 켬 — 계정 설정 우선)
 *
 * env(레거시): CRAWL_OPERATOR_ADMIN_IDS=email1,email2,로그인명,uuid
 */
function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

/** 기본 크롤 운영자 — 로그인명 + 매핑 이메일 (플래그 미설정 계정용 폴백) */
const DEFAULT_CRAWL_OPERATORS = Object.freeze([
  '김형진',
  'admin.g7yfepgm@gmail.com',
  '관리자'
]);

function getAllowedOperatorTokens() {
  const raw = String(process.env.CRAWL_OPERATOR_ADMIN_IDS || '').trim();
  const fromEnv = raw
    ? raw.split(/[,;\s]+/).map(normalizeToken).filter(Boolean)
    : [];
  const bootstrapEmail = normalizeToken(process.env.BREM_ADMIN_EMAIL || '');
  const set = new Set([
    ...DEFAULT_CRAWL_OPERATORS.map(normalizeToken),
    ...fromEnv
  ]);
  if (bootstrapEmail) set.add(bootstrapEmail);

  try {
    const { getAdminLoginHints } = require('./public-config');
    const hints = getAdminLoginHints() || {};
    Object.entries(hints).forEach(([loginName, email]) => {
      const nameToken = normalizeToken(loginName);
      const emailToken = normalizeToken(email);
      if (set.has(nameToken) && emailToken) set.add(emailToken);
      if (set.has(emailToken) && nameToken) set.add(nameToken);
    });
  } catch {
    /* ignore */
  }

  return [...set];
}

function accountMatchesLegacyOperator(account = {}) {
  const allowed = getAllowedOperatorTokens();
  if (!allowed.length) return false;
  const candidates = [
    account.id,
    account.email,
    account.loginEmail,
    account.loginName,
    account.displayName,
    account.name,
    account.user_id
  ].map(normalizeToken).filter(Boolean);
  return candidates.some(token => allowed.includes(token));
}

function resolveCrawlAllowed(registryAccount, identity = {}) {
  if (registryAccount && typeof registryAccount.canOperateCrawl === 'boolean') {
    return {
      allowed: registryAccount.canOperateCrawl === true,
      source: registryAccount.canOperateCrawl ? 'account' : 'account-denied'
    };
  }
  const legacy = accountMatchesLegacyOperator({
    ...identity,
    id: identity.id || registryAccount?.id,
    email: identity.email || registryAccount?.email,
    name: identity.name || registryAccount?.name,
    displayName: identity.displayName || registryAccount?.name
  });
  return {
    allowed: legacy,
    source: legacy ? 'legacy' : 'none'
  };
}

async function canOperateCrawl(accessToken) {
  const { verifyAdminCaller, resolveActorAccount } = require('./admin-users');
  const { getServiceClient } = require('./admin-bootstrap');
  const { loadAdminRegistry } = require('./admin-registry');

  const auth = await verifyAdminCaller(accessToken);
  if (!auth.ok) return auth;

  const displayName = auth.profile?.display_name || '';
  let registryAccount = null;
  try {
    const supabase = getServiceClient();
    if (supabase) {
      const accounts = await loadAdminRegistry(supabase, auth);
      registryAccount = resolveActorAccount(accounts, auth);
    }
  } catch {
    registryAccount = null;
  }

  const resolved = resolveCrawlAllowed(registryAccount, {
    id: auth.userId,
    email: auth.email,
    loginEmail: auth.email,
    loginName: displayName,
    displayName,
    name: displayName,
    user_id: auth.userId
  });

  return {
    ok: true,
    allowed: resolved.allowed,
    source: resolved.source,
    canOperateCrawl: registryAccount?.canOperateCrawl === true,
    adminId: auth.userId || '',
    email: auth.email || '',
    displayName,
    allowedCount: getAllowedOperatorTokens().length
  };
}

module.exports = {
  DEFAULT_CRAWL_OPERATORS,
  getAllowedOperatorTokens,
  accountMatchesOperator: accountMatchesLegacyOperator,
  accountMatchesLegacyOperator,
  resolveCrawlAllowed,
  canOperateCrawl
};
