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

function resolveBaeminPartnerScope(account, regionMap = {}) {
  const registered = Object.keys(regionMap || {})
    .map(key => String(key || '').trim().toUpperCase())
    .filter(id => /^DP\d{6,}$/i.test(id));
  const assigned = normalizePartnerIdList(account?.baeminPartnerIds);
  const canManageRegions = canManageBaeminRegions(account);

  let allowedPartnerIds;
  if (assigned.length) {
    allowedPartnerIds = assigned.filter(id => registered.includes(id));
  } else if (canManageRegions) {
    allowedPartnerIds = registered;
  } else {
    allowedPartnerIds = [];
  }

  return {
    canManageRegions,
    allowedPartnerIds,
    isRegionalScoped: assigned.length > 0 || !canManageRegions
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
  filterPartnersByScope,
  filterRegionItemsByScope
};
