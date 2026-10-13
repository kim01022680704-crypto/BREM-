/**
 * 쿠팡 권역 라벨/매칭 — 포항중앙 vs 포항중앙(Z) 를 구분한다.
 * 브라우저(기사지역관리)와 Node 테스트에서 같이 쓴다.
 */
(function (root) {
  function shortCoupangRegionLabel(name) {
    let raw = String(name || '').replace(/\s+/g, '').trim();
    if (!raw) return '';
    raw = raw.replace(/\(\d+\)$/g, '');
    const hangul = raw.replace(/[^가-힣]/g, '');
    const base = hangul || raw;
    if (!base) return '';
    return base.length <= 4 ? base : base.slice(-4);
  }

  function coupangRegionIsZ(name) {
    return /\(Z\)/i.test(String(name || ''));
  }

  function displayCoupangRegionLabel(name) {
    const raw = String(name || '').replace(/\s+/g, '').trim();
    if (!raw) return '';
    const short = shortCoupangRegionLabel(raw);
    if (coupangRegionIsZ(raw) && short && !coupangRegionIsZ(short)) return `${short}(Z)`;
    return short || raw;
  }

  function coupangRegionLooksZ(region) {
    return coupangRegionIsZ(`${region?.label || ''} ${region?.vendorName || ''}`);
  }

  function coupangZBases(regions) {
    const set = new Set();
    (regions || []).forEach(region => {
      if (!coupangRegionLooksZ(region)) return;
      const base = shortCoupangRegionLabel(region.label || region.vendorName);
      if (base) set.add(base);
    });
    return set;
  }

  function collapseCoupangZTwins(regions) {
    const list = Array.isArray(regions) ? regions : [];
    const zBases = coupangZBases(list);
    if (!zBases.size) return list;
    return list.filter(region => {
      const base = shortCoupangRegionLabel(region.label || region.vendorName);
      if (!base || !zBases.has(base)) return true;
      return coupangRegionLooksZ(region);
    });
  }

  function riderMatchesCoupangRegion(value, region, zBases) {
    const raw = String(value || '').trim();
    if (!region || !raw) return false;
    if (raw === region.vendorId || raw === region.key) return true;
    if (region.vendorName && raw === region.vendorName) return true;
    const valueShort = shortCoupangRegionLabel(raw);
    const regionShort = shortCoupangRegionLabel(region.label || region.vendorName || '');
    if (!valueShort || !regionShort || valueShort !== regionShort) return false;
    if (coupangRegionLooksZ(region)) return true;
    if (coupangRegionIsZ(raw)) return false;
    return !(zBases && zBases.has(regionShort));
  }

  function pickCoupangCatalogRegion(catalog, value) {
    const list = Array.isArray(catalog) ? catalog : [];
    const zBases = coupangZBases(list);
    const hits = list.filter(region => riderMatchesCoupangRegion(value, region, zBases));
    if (!hits.length) return null;
    return hits.find(region => coupangRegionLooksZ(region)) || hits[0];
  }

  const api = {
    shortCoupangRegionLabel,
    displayCoupangRegionLabel,
    coupangRegionIsZ,
    coupangRegionLooksZ,
    coupangZBases,
    collapseCoupangZTwins,
    riderMatchesCoupangRegion,
    pickCoupangCatalogRegion
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) root.BremCoupangRegion = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
