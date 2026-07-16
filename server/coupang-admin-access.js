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
 * - viewVendorIds: 대시보드·쿠팡현황
 *   · 대표/총괄 → 수집된(카탈로그) 전체 지역
 *   · 그 외 → 관리자계정에 배정된 지역만
 * - 계정 지역 배정 UI는 대표·총괄만 (canManageRegions)
 */
function resolveCoupangVendorScope(account, catalogIds = []) {
  const registered = normalizeVendorIdList(catalogIds);
  const assigned = normalizeVendorIdList(account?.coupangVendorIds);
  const canManageRegions = canManageCoupangRegions(account);

  let viewVendorIds;
  if (canManageRegions) {
    viewVendorIds = registered.slice();
  } else {
    // 팀장: 계정 배정 지역만 (카탈로그에 없어도 배정 ID 유지)
    viewVendorIds = assigned.slice();
  }

  return {
    canManageRegions,
    allowedVendorIds: viewVendorIds.slice(),
    viewVendorIds,
    isRegionalScoped: !canManageRegions
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
