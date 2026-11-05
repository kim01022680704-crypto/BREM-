/* 쿠팡 오더별 상세내역에서 권외콜을 센다.
 * 유효 행은 이름·픽업·배달·수락시간이 모두 있는 행이다.
 * 권외콜은 픽업 또는 배달의 구/군이 그 파일에서 가장 많은 픽업 구/군과 다른 주문이다.
 * 울산광역시 남구, 울산 남구, 울산시 남구는 같은 남구로 본다.
 * 한 주 지급은 시작 건수부터 건당 금액이다. 15건·1,000원이면 15번째부터 1,000원. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BremOutsideCall = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function outsideCallFactory() {
  function blank(value) {
    return value == null || String(value).trim() === '';
  }

  function cellText(value) {
    if (value == null) return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) return 'set';
    return String(value).replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim();
  }

  function nameKey(value) {
    return cellText(value).replace(/\s+/g, '');
  }

  function districtKey(value) {
    let text = cellText(value);
    if (!text || text === 'set') return '';
    text = text.replace(/특별자치도|특별자치시|특별시|광역시/g, '');
    text = text.replace(/시(?=\s*[가-힣]{1,8}(?:구|군))/g, '');
    const match = text.match(/([가-힣]{2,10})\s*([가-힣]{1,8}(?:구|군))/);
    if (!match) return '';
    return `${match[1]} ${match[2]}`;
  }

  function findHeader(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const scan = Math.min(list.length, 30);
    for (let index = 0; index < scan; index += 1) {
      const row = list[index] || [];
      const labels = row.map(cell => cellText(cell).replace(/\s+/g, ''));
      const nameIndex = labels.findIndex(label => label === '성함' || label === '이름');
      const pickupIndex = labels.findIndex(label => label.includes('픽업지역'));
      const deliveryIndex = labels.findIndex(label => label.includes('배달지역'));
      const acceptIndex = labels.findIndex(label => label.includes('수락시간'));
      if (nameIndex >= 0 && pickupIndex >= 0 && deliveryIndex >= 0 && acceptIndex >= 0) {
        return { index, nameIndex, pickupIndex, deliveryIndex, acceptIndex };
      }
    }
    return null;
  }

  function sumFromSheetRows(rows) {
    const header = findHeader(rows);
    if (!header) return null;
    const list = Array.isArray(rows) ? rows : [];
    const valid = [];
    for (let index = header.index + 1; index < list.length; index += 1) {
      const row = list[index] || [];
      const name = nameKey(row[header.nameIndex]);
      const pickup = districtKey(row[header.pickupIndex]);
      const delivery = districtKey(row[header.deliveryIndex]);
      const accept = cellText(row[header.acceptIndex]);
      if (!name || name === '성함' || name === '이름') continue;
      if (!pickup || !delivery || !accept) continue;
      valid.push({ name, pickup, delivery });
    }
    const pickupCounts = new Map();
    valid.forEach(row => pickupCounts.set(row.pickup, (pickupCounts.get(row.pickup) || 0) + 1));
    let home = '';
    let homeCount = 0;
    pickupCounts.forEach((count, key) => {
      if (count > homeCount) {
        home = key;
        homeCount = count;
      }
    });
    const byName = new Map();
    if (home) {
      valid.forEach(row => {
        if (row.pickup === home && row.delivery === home) return;
        byName.set(row.name, (byName.get(row.name) || 0) + 1);
      });
    }
    return { byName, homeDistrict: home, validCount: valid.length };
  }

  function payAmount(count, startCount, amountPerCall) {
    const calls = Math.max(0, Math.round(Number(count) || 0));
    const start = Math.round(Number(startCount) || 0);
    const unit = Math.round(Number(amountPerCall) || 0);
    if (!(start > 0 && unit > 0) || calls < start) {
      return { amount: 0, paidCount: 0 };
    }
    const paidCount = calls - start + 1;
    return { amount: paidCount * unit, paidCount };
  }

  return {
    blank,
    districtKey,
    nameKey,
    findHeader,
    sumFromSheetRows,
    payAmount
  };
});
