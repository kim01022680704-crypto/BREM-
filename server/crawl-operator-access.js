/**
 * 크롤링 원버튼 조작 가능 관리자 판별
 * env: CRAWL_OPERATOR_ADMIN_IDS=email1,email2,uuid1
 *      (비어 있으면 BREM_ADMIN_EMAIL 만 허용)
 */
function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function getAllowedOperatorTokens() {
  const raw = String(process.env.CRAWL_OPERATOR_ADMIN_IDS || '').trim();
  const fromEnv = raw
    ? raw.split(/[,;\s]+/).map(normalizeToken).filter(Boolean)
    : [];
  const bootstrapEmail = normalizeToken(process.env.BREM_ADMIN_EMAIL || '');
  const set = new Set(fromEnv);
  if (bootstrapEmail) set.add(bootstrapEmail);
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
    account.user_id
  ].map(normalizeToken).filter(Boolean);
  return candidates.some(token => allowed.includes(token));
}

async function canOperateCrawl(accessToken) {
  const { verifyAdminCaller } = require('./admin-users');
  const auth = await verifyAdminCaller(accessToken);
  if (!auth.ok) return auth;

  const allowed = accountMatchesOperator({
    id: auth.userId,
    email: auth.email,
    loginEmail: auth.email,
    loginName: auth.profile?.display_name,
    user_id: auth.userId
  });

  return {
    ok: true,
    allowed,
    adminId: auth.userId || '',
    email: auth.email || '',
    allowedCount: getAllowedOperatorTokens().length
  };
}

module.exports = {
  getAllowedOperatorTokens,
  accountMatchesOperator,
  canOperateCrawl
};
