/**
 * 쿠팡이츠 관리자 조회 핸들러 (brem서버 /api/admin/coupang/*)
 * 인증: verifyAdminCaller (admin 계정). 데이터는 coupang_collect_items 에서 읽음.
 * 지역 스코프: 대표/총괄=전체, 팀장=계정에 배정된 coupangVendorIds 만.
 */
const { verifyAdminCaller, resolveActorAccount } = require('./admin-users');
const { loadAdminRegistry } = require('./admin-registry');
const { getServiceClient } = require('./admin-bootstrap');
const pipeline = require('./coupang-collect-pipeline');
const sessionStore = require('./coupang-session');
const {
  resolveCoupangVendorScope,
  filterItemsByVendorScope,
  normalizeVendorIdList
} = require('./coupang-admin-access');

const MENUS = ['peak_realtime', 'weekly_performance', 'vendor_info', 'rider_daily'];

async function resolveCallerScope(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const catalog = await pipeline.listKnownVendors();
  const catalogItems = catalog.ok ? (catalog.items || []) : [];
  const catalogIds = catalogItems.map(item => item.vendorId);

  const supabase = getServiceClient();
  let account = null;
  if (supabase) {
    const accounts = await loadAdminRegistry(supabase, caller).catch(() => []);
    account = resolveActorAccount(accounts || [], caller);
  }
  const scope = resolveCoupangVendorScope(account, catalogIds);
  return {
    ok: true,
    caller,
    account,
    catalogItems,
    scope
  };
}

async function getConfig(accessToken) {
  const scoped = await resolveCallerScope(accessToken);
  if (!scoped.ok) return scoped;

  const session = await sessionStore.getStoredCoupangSession().catch(() => null);
  // 메뉴별 최신 수집일은 서로 독립적이다 → 순차 대기 대신 한 번에 조회
  const latest = {};
  const latestDates = await Promise.all(
    MENUS.map(m => pipeline.getLatestCollectDate(m).catch(() => null))
  );
  MENUS.forEach((m, index) => {
    latest[m] = latestDates[index];
  });
  return {
    ok: true,
    session: session ? {
      hasToken: Boolean(session.token),
      updatedAt: session.updatedAt,
      tokenExpiresAt: session.tokenExpiresAt,
      expired: sessionStore.isTokenExpired(session)
    } : { hasToken: false },
    latest,
    viewVendorIds: scoped.scope.viewVendorIds || [],
    canManageRegions: Boolean(scoped.scope.canManageRegions)
  };
}

async function getVendorRegions(accessToken) {
  const scoped = await resolveCallerScope(accessToken);
  if (!scoped.ok) return scoped;

  const allItems = scoped.catalogItems || [];
  const allowed = new Set(normalizeVendorIdList(scoped.scope.viewVendorIds));
  const items = allItems.filter(item => allowed.has(item.vendorId));

  return {
    ok: true,
    items,
    map: Object.fromEntries(items.map(item => [item.vendorId, item.vendorName])),
    viewVendorIds: scoped.scope.viewVendorIds || [],
    canManageRegions: Boolean(scoped.scope.canManageRegions),
    // 대표·총괄 계정 메뉴의 지역 배정 UI용 전체 목록
    allItems,
    allMap: Object.fromEntries(allItems.map(item => [item.vendorId, item.vendorName]))
  };
}

async function getItems(accessToken, options = {}) {
  const scoped = await resolveCallerScope(accessToken);
  if (!scoped.ok) return scoped;

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
  if (!result.ok) return result;

  const items = filterItemsByVendorScope(result.items || [], scoped.scope);
  return {
    ...result,
    items,
    viewVendorIds: scoped.scope.viewVendorIds || [],
    canManageRegions: Boolean(scoped.scope.canManageRegions)
  };
}

module.exports = { getConfig, getItems, getVendorRegions, MENUS };
