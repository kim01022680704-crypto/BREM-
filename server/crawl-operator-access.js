/**
 * 크롤링 원버튼 조작 가능 관리자 판별
 * env: CRAWL_OPERATOR_ADMIN_IDS=email1,email2,로그인명,uuid
 *      (비어 있어도 기본 운영자 김형진은 허용)
 */
function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

/** 기본 크롤 운영자 — 로그인명 + 매핑 이메일 */
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

  // 로그인명 → 이메일 힌트도 허용 목록에 합침 (김형진 → admin.g7yfepgm@...)
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

function accountMatchesOperator(account = {}) {
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

async function canOperateCrawl(accessToken) {
  const { verifyAdminCaller } = require('./admin-users');
  const auth = await verifyAdminCaller(accessToken);
  if (!auth.ok) return auth;

  const displayName = auth.profile?.display_name || '';
  const allowed = accountMatchesOperator({
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
    allowed,
    adminId: auth.userId || '',
    email: auth.email || '',
    displayName,
    allowedCount: getAllowedOperatorTokens().length
  };
}

module.exports = {
  DEFAULT_CRAWL_OPERATORS,
  getAllowedOperatorTokens,
  accountMatchesOperator,
  canOperateCrawl
};
