/**
 * 쿠팡 권역 라벨/매칭 — 포항중앙 vs 포항중앙(Z) 를 구분한다.
 * 브라우저(기사지역관리)와 Node 테스트에서 같이 쓴다.
 */
(function (root) {
  function stripCoupangBranchSuffix(name) {
    return String(name || '')
      .replace(/\s*·\s*(119|이글스)\s*$/u, '')
      .replace(/\s+(119|이글스)\s*$/u, '')
      .trim();
  }

  function shortCoupangRegionLabel(name) {
    let raw = stripCoupangBranchSuffix(name).replace(/\s+/g, '').trim();
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
    const raw = stripCoupangBranchSuffix(name).replace(/\s+/g, '').trim();
    if (!raw) return '';
    const short = shortCoupangRegionLabel(raw);
    if (coupangRegionIsZ(raw) && short && !coupangRegionIsZ(short)) return `${short}(Z)`;
    return short || raw;
  }

  /** 119컴퍼니 / 그 외(이글스). 붙인 태그 「 119」도 119로 본다. */
  function coupangRegionBranchTag(name) {
    const original = String(name || '').trim();
    const raw = original.replace(/\s+/g, '');
    if (!raw) return '';
    if (raw.includes('119컴퍼니') || raw.startsWith('119') || /(?:·|\s)119\s*$/.test(original)) return '119';
    return '이글스';
  }

  function coupangValueBranchTag(value) {
    const original = String(value || '').trim();
    const raw = original.replace(/\s+/g, '');
    if (!raw) return '';
    if (raw.includes('119컴퍼니') || raw.startsWith('119') || /(?:·|\s)119\s*$/.test(original)) return '119';
    if (original.includes('이글스')) return '이글스';
    return '';
  }

  function coupangRegionTagOf(region) {
    return coupangRegionBranchTag(region?.vendorName || region?.label || '');
  }

  function coupangTagsMatch(value, region) {
    const regionTag = coupangRegionTagOf(region);
    if (!regionTag) return true;
    const valueTag = coupangValueBranchTag(value);
    if (!valueTag) return regionTag === '이글스';
    return valueTag === regionTag;
  }

  /** 선택 목록 표기. 값은 지역명(+Z)만 두고, 화면에는 태그를 붙인다. */
  function coupangRegionSelectLabel(name) {
    const display = displayCoupangRegionLabel(name);
    if (!display) return '';
    const tag = coupangRegionBranchTag(name);
    return tag ? `${display} · ${tag}` : display;
  }

  function coupangRegionLooksZ(region) {
    return coupangRegionIsZ(`${region?.label || ''} ${region?.vendorName || ''}`);
  }

  function coupangZKey(region) {
    const base = shortCoupangRegionLabel(region?.vendorName || region?.label || '');
    if (!base) return '';
    return `${coupangRegionTagOf(region)}|${base}`;
  }

  function coupangZBases(regions) {
    const set = new Set();
    (regions || []).forEach(region => {
      if (!coupangRegionLooksZ(region)) return;
      const key = coupangZKey(region);
      if (key) set.add(key);
    });
    return set;
  }

  function collapseCoupangZTwins(regions) {
    const list = Array.isArray(regions) ? regions : [];
    const zBases = coupangZBases(list);
    if (!zBases.size) return list;
    return list.filter(region => {
      const key = coupangZKey(region);
      if (!key || !zBases.has(key)) return true;
      return coupangRegionLooksZ(region);
    });
  }

  function riderMatchesCoupangRegion(value, region) {
    const raw = String(value || '').trim();
    if (!region || !raw) return false;
    if (raw === region.vendorId || raw === region.key) return true;
    if (region.vendorName && raw === region.vendorName) return true;
    const valueShort = shortCoupangRegionLabel(raw);
    const regionShort = shortCoupangRegionLabel(region.vendorName || region.label || '');
    if (!valueShort || !regionShort || valueShort !== regionShort) return false;
    if (!coupangTagsMatch(raw, region)) return false;
    return coupangRegionIsZ(raw) === coupangRegionLooksZ(region);
  }

  function pickCoupangCatalogRegion(catalog, value) {
    const list = Array.isArray(catalog) ? catalog : [];
    const hits = list.filter(region => riderMatchesCoupangRegion(value, region));
    if (!hits.length) return null;
    return hits.find(region => coupangRegionLooksZ(region) === coupangRegionIsZ(value)) || hits[0];
  }

  const api = {
    shortCoupangRegionLabel,
    displayCoupangRegionLabel,
    coupangRegionBranchTag,
    coupangRegionSelectLabel,
    coupangValueBranchTag,
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
