/**
 * 쿠팡이츠 관리자 조회 핸들러 (brem.kr /api/admin/coupang/*)
 * 인증: verifyAdminCaller (admin 계정). 데이터는 coupang_collect_items 에서 읽음.
 */
const { verifyAdminCaller } = require('./admin-users');
const pipeline = require('./coupang-collect-pipeline');
const sessionStore = require('./coupang-session');

const MENUS = ['peak_realtime', 'weekly_performance', 'vendor_info', 'rider_daily'];

async function getConfig(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const session = await sessionStore.getStoredCoupangSession().catch(() => null);
  const latest = {};
  for (const m of MENUS) {
    latest[m] = await pipeline.getLatestCollectDate(m).catch(() => null);
  }
  return {
    ok: true,
    session: session ? {
      hasToken: Boolean(session.token),
      updatedAt: session.updatedAt,
      tokenExpiresAt: session.tokenExpiresAt,
      expired: sessionStore.isTokenExpired(session)
    } : { hasToken: false },
    latest
  };
}

async function getItems(accessToken, options = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const sourceMenu = String(options.sourceMenu || '').trim();
  if (!MENUS.includes(sourceMenu)) {
    return { ok: false, status: 400, error: 'sourceMenu 가 올바르지 않습니다.', allowed: MENUS };
  }
  const collectDate = String(options.collectDate || '').slice(0, 10);
  const fromDate = String(options.fromDate || '').slice(0, 10);
  const toDate = String(options.toDate || '').slice(0, 10);
  const result = await pipeline.readCollectItems(sourceMenu, collectDate || null, {
    vendorId: options.vendorId || '',
    fromDate: fromDate || '',
    toDate: toDate || '',
    limit: 20000
  });
  return result;
}

module.exports = { getConfig, getItems, MENUS };
