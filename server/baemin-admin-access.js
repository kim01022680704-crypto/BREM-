const { ADMIN_ROLES } = require('./admin-registry');

function normalizePartnerIdList(list) {
  return [...new Set((Array.isArray(list) ? list : [])
    .map(id => String(id || '').trim().toUpperCase())
    .filter(id => /^DP\d{6,}$/i.test(id)))];
}

function canManageBaeminRegions(account) {
  const role = String(account?.role || '').toLowerCase();
  return role === ADMIN_ROLES.CEO || role === ADMIN_ROLES.DIRECTOR;
}

/**
 * 배민 지역 스코프
 * - viewPartnerIds: 대시보드·배민현황
 *   · 대표/총괄 → 등록된 전체 지역
 *   · 그 외 → 관리자계정에 배정된 지역만
 * - allowedPartnerIds: BIZ 수집 미리보기 등 (동일 규칙)
 * - 지역 등록(DP) / 계정 지역 배정 UI는 대표·총괄만 (canManageRegions)
 */
function resolveBaeminPartnerScope(account, regionMap = {}) {
  const registered = Object.keys(regionMap || {})
    .map(key => String(key || '').trim().toUpperCase())
    .filter(id => /^DP\d{6,}$/i.test(id));
  const assigned = normalizePartnerIdList(account?.baeminPartnerIds);
  const canManageRegions = canManageBaeminRegions(account);

  let viewPartnerIds;
  if (canManageRegions) {
    viewPartnerIds = registered.slice();
  } else {
    viewPartnerIds = assigned.filter(id => registered.includes(id));
  }

  const allowedPartnerIds = viewPartnerIds.slice();

  return {
    canManageRegions,
    allowedPartnerIds,
    viewPartnerIds,
    isRegionalScoped: !canManageRegions
  };
}

/** 대시보드·배민현황·적용 데이터 조회용 스코프 */
function scopeForView(scope) {
  const viewIds = Array.isArray(scope?.viewPartnerIds)
    ? scope.viewPartnerIds
    : (scope?.allowedPartnerIds || []);
  return {
    ...(scope || {}),
    allowedPartnerIds: normalizePartnerIdList(viewIds),
    viewPartnerIds: normalizePartnerIdList(viewIds),
    isRegionalScoped: scope?.isRegionalScoped !== false
  };
}

function filterPartnersByScope(partners, scope) {
  const allowed = new Set((scope?.allowedPartnerIds || []).map(id => String(id).toUpperCase()));
  return (partners || []).filter(partner => allowed.has(String(partner.partnerId || '').toUpperCase()));
}

function filterRegionItemsByScope(items, scope) {
  const allowed = new Set((scope?.allowedPartnerIds || []).map(id => String(id).toUpperCase()));
  return (items || []).filter(item => allowed.has(String(item.partnerId || '').toUpperCase()));
}

module.exports = {
  normalizePartnerIdList,
  canManageBaeminRegions,
  resolveBaeminPartnerScope,
  scopeForView,
  filterPartnersByScope,
  filterRegionItemsByScope
};
