const BremPlatforms = (function () {
  const DEFAULT = 'coupang';

  const items = {
    coupang: { id: 'coupang', label: '쿠팡', rateLabel: '거절율', settlementFormatId: 'brem-standard' },
    baemin: { id: 'baemin', label: '배민', rateLabel: '수락율', settlementFormatId: 'brem-baemin' },
    combined: { id: 'combined', label: '합산', rateLabel: '수락/거절율', settlementFormatId: 'brem-standard' }
  };

  function normalize(value) {
    if (value === 'combined') return 'combined';
    return value === 'baemin' ? 'baemin' : 'coupang';
  }

  function label(value) {
    const key = normalize(value);
    return items[key]?.label || items[DEFAULT].label;
  }

  function rateLabel(value) {
    const key = normalize(value);
    if (key === 'combined') return '수락/거절율';
    return items[key]?.rateLabel || items[DEFAULT].rateLabel;
  }

  function settlementFormatId(value) {
    const key = normalize(value);
    if (key === 'combined') return items[DEFAULT].settlementFormatId;
    return items[key]?.settlementFormatId || items[DEFAULT].settlementFormatId;
  }

  function isCombined(value) {
    return normalize(value) === 'combined';
  }

  function all() {
    return Object.values(items);
  }

  return {
    DEFAULT,
    items,
    normalize,
    label,
    rateLabel,
    settlementFormatId,
    isCombined,
    all
  };
})();
