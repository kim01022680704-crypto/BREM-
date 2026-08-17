const { ADMIN_ROLES } = require('./admin-registry');

function normalizeVendorIdList(list) {
  return [...new Set((Array.isArray(list) ? list : [])
    .map(id => String(id || '').trim())
    .filter(Boolean))];
}

function canManageCoupangRegions(account) {
  const role = String(account?.role || '').toLowerCase();
  return role === ADMIN_ROLES.CEO || role === ADMIN_ROLES.DIRECTOR;
}

/**
 * 쿠팡 지역(매장) 스코프
 * - viewVendorIds: 대시보드·쿠팡현황 (역할과 무관하게 배정 목록이 있으면 그 지역만)
 *   · 계정에 배정된 지역이 있으면 → 그 목록
 *   · 배정이 비어 있고 대표/총괄 → 카탈로그 전체
 *   · 배정이 비어 있고 그 외 → 없음
 * - 계정 지역 배정 UI는 대표·총괄만 (canManageRegions)
 */
function resolveCoupangVendorScope(account, catalogIds = []) {
  const registered = normalizeVendorIdList(catalogIds);
  const assigned = normalizeVendorIdList(account?.coupangVendorIds);
  const canManageRegions = canManageCoupangRegions(account);

  let viewVendorIds;
  if (assigned.length) {
    viewVendorIds = assigned.slice();
  } else if (canManageRegions) {
    viewVendorIds = registered.slice();
  } else {
    viewVendorIds = [];
  }

  return {
    canManageRegions,
    allowedVendorIds: viewVendorIds.slice(),
    viewVendorIds,
    isRegionalScoped: assigned.length > 0 || !canManageRegions
  };
}

function filterItemsByVendorScope(items, scope) {
  const allowed = new Set(normalizeVendorIdList(scope?.allowedVendorIds || scope?.viewVendorIds));
  if (!allowed.size) return [];
  return (items || []).filter(item => {
    const vid = String(item?.vendor_id || item?.parsed_json?.vendorId || '').trim();
    return vid && allowed.has(vid);
  });
}

module.exports = {
  normalizeVendorIdList,
  canManageCoupangRegions,
  resolveCoupangVendorScope,
  filterItemsByVendorScope
};
