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

  function isDateToken(token) {
    const text = String(token || '').trim();
    if (!text) return false;
    if (/^\d{8}$/.test(text)) return true;
    if (/^\d{6}$/.test(text)) return true;
    if (/^\d{4}$/.test(text)) return true;
    if (/^\d{1,2}-\d{1,2}$/.test(text)) return true;
    return false;
  }

  // 배달연합_울산_남구중앙_20261108.xlsx → 시 울산, 지역 남구중앙.
  // 남구중앙만 보면 다른 시와 섞이므로 시 토큰을 같이 남긴다. (Z)는 지역 이름에 남긴다.
  function parseDailyFileRegion(fileName) {
    let base = String(fileName || '').replace(/\.(xlsx|xls)$/i, '').trim();
    base = base.replace(/(\s*-\s*복사본|\s*-\s*copy)+$/i, '');
    base = base.replace(/(\s*\(\d+\))+$/g, '').trim();
    const tokens = base.split('_').map(part => part.trim()).filter(Boolean);
    while (tokens.length && isDateToken(tokens[tokens.length - 1])) tokens.pop();
    if (tokens.length < 2) return null;
    const region = tokens[tokens.length - 1];
    const city = tokens[tokens.length - 2];
    if (!city || !region || isDateToken(city) || isDateToken(region)) return null;
    return {
      city,
      region,
      label: `${city} ${region}`,
      key: `${city}\t${region}`
    };
  }

  function normalizeKeywordList(value) {
    const source = Array.isArray(value)
      ? value
      : String(value || '').split(/[\n,，、]/);
    const seen = new Set();
    const out = [];
    source.forEach(item => {
      const text = String(item || '').replace(/\s+/g, ' ').trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      out.push(text);
    });
    return out;
  }

  function keywordSpec(keywords) {
    const source = keywords && typeof keywords === 'object' ? keywords : {};
    return {
      large: normalizeKeywordList(source.large),
      gu: normalizeKeywordList(source.gu),
      dong: normalizeKeywordList(source.dong)
    };
  }

  function keywordsReady(spec) {
    return !!(spec && spec.large.length && spec.gu.length && spec.dong.length);
  }

  function textHasKeyword(text, keyword) {
    const hay = String(text || '').replace(/\s+/g, '');
    const needle = String(keyword || '').replace(/\s+/g, '');
    if (!hay || !needle) return false;
    return hay.includes(needle);
  }

  function levelHit(text, list) {
    return (Array.isArray(list) ? list : []).some(keyword => textHasKeyword(text, keyword));
  }

  const ADMIN_SUFFIXES = ['특별자치도', '특별자치시', '특별시', '광역시', '시', '도', '구', '군', '읍', '면', '동', '리', '로', '길'];
  const METRO_CITIES = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종'];

  function compactText(text) {
    return String(text || '').replace(/\s+/g, '');
  }

  function stripAddressNumbers(text) {
    return compactText(text)
      .replace(/\d+번길/g, '')
      .replace(/\d+번지/g, '')
      .replace(/[0-9]+/g, '')
      .replace(/번길|번지/g, '');
  }

  function suffixKind(suffix) {
    if (suffix === '구' || suffix === '군') return 'gu';
    if (suffix === '읍' || suffix === '면' || suffix === '동' || suffix === '리') return 'dong';
    if (suffix === '로' || suffix === '길') return 'road';
    return 'city';
  }

  function adminParts(text) {
    const hay = stripAddressNumbers(text);
    const parts = [];
    let index = 0;
    let stem = '';
    while (index < hay.length) {
      if (hay.startsWith('길', index) && hay.startsWith('로', index + 1)) {
        stem += '길';
        index += 1;
        continue;
      }
      const suffix = ADMIN_SUFFIXES.find(item => hay.startsWith(item, index));
      if (suffix && stem) {
        const metro = suffixKind(suffix) === 'gu'
          ? METRO_CITIES.find(name => stem.startsWith(name) && stem.length > name.length)
          : '';
        if (metro) {
          parts.push({ name: metro, kind: 'city' });
          stem = stem.slice(metro.length);
        }
        if (stem && !(suffix === '리' && stem.length < 2)) {
          parts.push({ name: stem + suffix, kind: suffixKind(suffix) });
        }
        stem = '';
        index += suffix.length;
        continue;
      }
      const ch = hay.charAt(index);
      if (/[가-힣]/.test(ch)) stem += ch;
      else stem = '';
      index += 1;
    }
    METRO_CITIES.forEach(name => {
      if (!hay.includes(name)) return;
      if (parts.some(part => part.kind === 'city' && part.name.includes(name))) return;
      parts.push({ name, kind: 'city' });
    });
    return parts;
  }

  function partCovered(part, keywords) {
    return (Array.isArray(keywords) ? keywords : []).some(keyword => {
      const needle = String(keyword || '').replace(/\s+/g, '');
      if (!needle) return false;
      return part.name.includes(needle) || needle.includes(part.name);
    });
  }

  // 칸에 적힌 것만 본다. 숫자·번길은 빼고 시·구·동·로까지만 본다.
  // 시·구·동·로 중 하나만 있어도 그 키워드가 맞으면 권내.
  // 다른 시·구이거나 목록에 없는 동·로이면 권외.
  function isInsideAddress(text, spec) {
    if (!keywordsReady(spec)) return false;
    const hay = stripAddressNumbers(text);
    if (!hay) return false;
    if (!levelHit(hay, spec.large) && !levelHit(hay, spec.gu) && !levelHit(hay, spec.dong)) return false;
    const parts = adminParts(hay);
    const cityParts = parts.filter(part => part.kind === 'city');
    const guParts = parts.filter(part => part.kind === 'gu');
    const dongParts = parts.filter(part => part.kind === 'dong' && !part.name.endsWith('리'));
    const riParts = parts.filter(part => part.kind === 'dong' && part.name.endsWith('리'));
    const roadParts = parts.filter(part => part.kind === 'road');
    if (cityParts.length && !cityParts.every(part => partCovered(part, spec.large))) return false;
    if (guParts.length && !guParts.every(part => partCovered(part, spec.gu))) return false;
    if (dongParts.length && !dongParts.every(part => partCovered(part, spec.dong))) return false;
    if (!dongParts.length && riParts.length && !riParts.some(part => partCovered(part, spec.dong))) return false;
    if (roadParts.length && !roadParts.every(part => partCovered(part, spec.dong))) return false;
    return true;
  }

  function shortenOrderArea(text) {
    const parts = adminParts(text);
    const city = parts.find(part => part.kind === 'city');
    const gu = parts.find(part => part.kind === 'gu');
    const dong = parts.find(part => part.kind === 'dong' && !part.name.endsWith('리'));
    const road = parts.find(part => part.kind === 'road');
    const bits = [];
    if (city) {
      const metro = METRO_CITIES.find(name => city.name.startsWith(name));
      bits.push(metro || city.name);
    }
    if (gu) bits.push(gu.name);
    if (dong) bits.push(dong.name);
    if (road) bits.push(road.name);
    if (bits.length) return bits.join(' ');
    return stripAddressNumbers(text) || compactText(text);
  }

  function listOrderAreas(rows) {
    const header = findHeader(rows);
    if (!header) return null;
    const counts = new Map();
    const list = Array.isArray(rows) ? rows : [];
    for (let index = header.index + 1; index < list.length; index += 1) {
      const row = list[index] || [];
      [row[header.pickupIndex], row[header.deliveryIndex]].forEach(value => {
        const text = cellText(value);
        if (!text || text === 'set') return;
        const compact = text.replace(/\s+/g, '');
        if (!compact || compact === '픽업지역' || compact === '배달지역') return;
        const label = shortenOrderArea(text);
        if (!label) return;
        counts.set(label, (counts.get(label) || 0) + 1);
      });
    }
    return [...counts.entries()]
      .map(([text, count]) => ({ text, count }))
      .sort((a, b) => a.text.localeCompare(b.text, 'ko'));
  }

  function dongKeyword(name) {
    const suffix = ['읍', '면', '동', '리'].find(item => name.endsWith(item));
    if (!suffix) return name;
    const stem = name.slice(0, -suffix.length);
    return stem.length >= 2 ? stem : name;
  }

  function keywordsFromAddresses(addresses) {
    const large = [];
    const gu = [];
    const dong = [];
    (Array.isArray(addresses) ? addresses : []).forEach(text => {
      adminParts(text).forEach(part => {
        if (part.kind === 'city') {
          large.push(part.name);
          const metro = METRO_CITIES.find(name => part.name.startsWith(name));
          if (metro) large.push(metro);
          else if (/(시|도)$/.test(part.name)) {
            const stem = part.name.replace(/(특별자치도|특별자치시|특별시|광역시|시|도)$/, '');
            if (stem.length >= 2) large.push(stem);
          }
          return;
        }
        if (part.kind === 'gu') {
          gu.push(part.name);
          return;
        }
        if (part.kind === 'road') {
          dong.push(part.name);
          return;
        }
        dong.push(dongKeyword(part.name));
      });
    });
    return {
      large: normalizeKeywordList(large),
      gu: normalizeKeywordList(gu),
      dong: normalizeKeywordList(dong)
    };
  }

  function keywordCovered(name, saved) {
    const hay = String(name || '').replace(/\s+/g, '');
    if (!hay) return true;
    return (Array.isArray(saved) ? saved : []).some(keyword => {
      const needle = String(keyword || '').replace(/\s+/g, '');
      if (!needle) return false;
      return hay.includes(needle) || needle.includes(hay);
    });
  }

  function addressAlreadyRegistered(text, keywords) {
    const spec = keywordSpec(keywords);
    const extracted = keywordsFromAddresses([text]);
    const groups = [
      [extracted.large, spec.large],
      [extracted.gu, spec.gu],
      [extracted.dong, spec.dong]
    ];
    if (!groups.some(([list]) => list.length)) return false;
    return groups.every(([list, saved]) => list.every(name => keywordCovered(name, saved)));
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

  function collectValidRows(rows) {
    const header = findHeader(rows);
    if (!header) return null;
    const list = Array.isArray(rows) ? rows : [];
    const valid = [];
    for (let index = header.index + 1; index < list.length; index += 1) {
      const row = list[index] || [];
      const name = nameKey(row[header.nameIndex]);
      const pickup = cellText(row[header.pickupIndex]);
      const delivery = cellText(row[header.deliveryIndex]);
      const accept = cellText(row[header.acceptIndex]);
      if (!name || name === '성함' || name === '이름') continue;
      if (!pickup || pickup === 'set' || !delivery || delivery === 'set' || !accept) continue;
      valid.push({
        name,
        pickup,
        delivery,
        pickupDistrict: districtKey(pickup),
        deliveryDistrict: districtKey(delivery)
      });
    }
    return valid;
  }

  function sumByKeywords(rows, keywords) {
    const header = findHeader(rows);
    if (!header) return null;
    const valid = collectValidRows(rows) || [];
    const spec = keywordSpec(keywords);
    const ready = keywordsReady(spec);
    const byName = new Map();
    if (ready) {
      valid.forEach(row => {
        const inHome = isInsideAddress(row.pickup, spec) && isInsideAddress(row.delivery, spec);
        if (inHome) return;
        byName.set(row.name, (byName.get(row.name) || 0) + 1);
      });
    }
    return {
      byName,
      ready,
      validCount: valid.length,
      homeDistrict: '',
      mode: 'keyword'
    };
  }

  function sumFromSheetRows(rows, options) {
    const opts = options || {};
    if (opts.keywordMode) return sumByKeywords(rows, opts.keywords);
    const header = findHeader(rows);
    if (!header) return null;
    const valid = collectValidRows(rows) || [];
    const pickupCounts = new Map();
    valid.forEach(row => {
      const pickup = row.pickupDistrict;
      if (!pickup) return;
      pickupCounts.set(pickup, (pickupCounts.get(pickup) || 0) + 1);
    });
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
        if (!row.pickupDistrict || !row.deliveryDistrict) return;
        if (row.pickupDistrict === home && row.deliveryDistrict === home) return;
        byName.set(row.name, (byName.get(row.name) || 0) + 1);
      });
    }
    return { byName, homeDistrict: home, validCount: valid.length, ready: true, mode: 'auto' };
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
    parseDailyFileRegion,
    normalizeKeywordList,
    keywordSpec,
    keywordsReady,
    isInsideAddress,
    listOrderAreas,
    keywordsFromAddresses,
    addressAlreadyRegistered,
    sumFromSheetRows,
    payAmount
  };
});
