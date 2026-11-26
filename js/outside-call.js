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

  // 권외는 울산 남구 쿠팡만 센다. 파일은 119컴퍼니, 배달연합(이글스)이다.
  function outsideCallTargetFile(fileName) {
    const region = parseDailyFileRegion(fileName);
    if (!region) return false;
    const city = String(region.city || '').replace(/\s+/g, '');
    const area = String(region.region || '').replace(/\s+/g, '');
    if (city !== '울산' || !area.includes('남구')) return false;
    const head = String(fileName || '').split('_')[0].replace(/\s+/g, '');
    return head.includes('119') || head.includes('배달연합') || head.includes('이글스');
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

  const KAKAO_MAP_KEY = '7767a9f4bbb17e3c1c905caecc533cef';
  const SIDO_ALIAS = {
    경남: '경상남',
    경북: '경상북',
    전남: '전라남',
    전북: '전라북',
    충남: '충청남',
    충북: '충청북'
  };
  let kakaoPromise = null;
  let dongBoundsPromise = null;
  let geoMemory = null;

  function addressIsDetailed(text) {
    const raw = compactText(text);
    if (!raw || raw === 'set') return false;
    return /(?:로|길)/.test(raw) || /\d/.test(raw);
  }

  function pointInRing(lat, lng, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][0];
      const xi = ring[i][1];
      const yj = ring[j][0];
      const xj = ring[j][1];
      const denom = yj - yi || 1e-12;
      const crosses = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / denom + xi;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function pointInRings(lat, lng, rings) {
    return (Array.isArray(rings) ? rings : []).some(ring => Array.isArray(ring) && ring.length >= 3 && pointInRing(lat, lng, ring));
  }

  function segmentDistance(lat, lng, start, end) {
    const ay = start[0];
    const ax = start[1];
    const by = end[0];
    const bx = end[1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((lng - ax) * dx + (lat - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = lng - (ax + dx * t);
    const ey = lat - (ay + dy * t);
    return Math.sqrt(ex * ex + ey * ey);
  }

  function clearlyInside(lat, lng, rings) {
    if (!pointInRings(lat, lng, rings)) return false;
    let nearest = Infinity;
    (rings || []).forEach(ring => {
      for (let index = 0; index < ring.length; index += 1) {
        const next = ring[(index + 1) % ring.length];
        nearest = Math.min(nearest, segmentDistance(lat, lng, ring[index], next));
      }
    });
    return nearest > 0.00015;
  }

  function ringCentroid(ring) {
    let lat = 0;
    let lng = 0;
    ring.forEach(point => {
      lat += point[0];
      lng += point[1];
    });
    return [lat / ring.length, lng / ring.length];
  }

  function savedRings(keywords) {
    const source = Array.isArray(keywords?.rings) ? keywords.rings : [];
    return source.filter(ring => Array.isArray(ring) && ring.length >= 3);
  }

  function sidoMatches(sidonm, cities) {
    const hay = String(sidonm || '');
    return (Array.isArray(cities) ? cities : []).some(city => {
      const raw = String(city || '').trim();
      if (!raw) return false;
      if (hay.includes(raw)) return true;
      const stem = raw.replace(/(특별자치도|특별자치시|특별시|광역시|시|도)$/, '');
      if (stem && hay.includes(stem)) return true;
      return SIDO_ALIAS[stem] ? hay.includes(SIDO_ALIAS[stem]) : false;
    });
  }

  function emdMatches(emd, keyword) {
    const name = String(emd || '').replace(/\s+/g, '');
    const key = String(keyword || '').replace(/\s+/g, '');
    if (!name || !key || /(?:로|길)$/.test(key)) return false;
    if (name === key) return true;
    const full = /(?:동|읍|면)$/.test(key) ? key : `${key}동`;
    if (name === full) return true;
    return key.length >= 2 && name.startsWith(key) && /(?:동|읍|면)$/.test(name);
  }

  function guMatches(sgg, gus) {
    return (Array.isArray(gus) ? gus : []).some(gu => {
      const name = String(gu || '').replace(/\s+/g, '');
      const hay = String(sgg || '').replace(/\s+/g, '');
      return !!name && (hay === name || hay.includes(name));
    });
  }

  function findMatchedDongs(bounds, region, spec) {
    const cities = [...(spec?.large || []), region?.city];
    const gus = spec?.gu || [];
    const keywords = (spec?.dong || []).filter(keyword => !/(?:로|길)$/.test(String(keyword || '').replace(/\s+/g, '')));
    const matched = [];
    const seen = new Set();
    keywords.forEach(keyword => {
      (bounds?.items || []).forEach(item => {
        if (!sidoMatches(item.sido, cities)) return;
        if (gus.length && !guMatches(item.sgg, gus)) return;
        if (!emdMatches(item.emd, keyword)) return;
        const id = `${item.sido}\t${item.sgg}\t${item.emd}`;
        if (seen.has(id)) return;
        seen.add(id);
        matched.push(item);
      });
    });
    return matched;
  }

  function ringsFromDong(item) {
    return (item?.rings || []).map(ring => (
      Array.isArray(ring) ? ring.map(([lng, lat]) => [lat, lng]).filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1])) : []
    )).filter(ring => ring.length >= 3);
  }

  function ringContains(lat, lng, ring) {
    return pointInRing(lat, lng, ring);
  }

  function solidOuterRings(rings) {
    const source = (Array.isArray(rings) ? rings : []).filter(ring => Array.isArray(ring) && ring.length >= 3);
    if (!source.length) return [];
    const boxes = source.map(ring => {
      let minLat = Infinity;
      let maxLat = -Infinity;
      let minLng = Infinity;
      let maxLng = -Infinity;
      ring.forEach(point => {
        minLat = Math.min(minLat, point[0]);
        maxLat = Math.max(maxLat, point[0]);
        minLng = Math.min(minLng, point[1]);
        maxLng = Math.max(maxLng, point[1]);
      });
      return { ring, minLat, maxLat, minLng, maxLng };
    });
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    boxes.forEach(box => {
      minLat = Math.min(minLat, box.minLat);
      maxLat = Math.max(maxLat, box.maxLat);
      minLng = Math.min(minLng, box.minLng);
      maxLng = Math.max(maxLng, box.maxLng);
    });
    const padLat = Math.max((maxLat - minLat) * 0.03, 0.001);
    const padLng = Math.max((maxLng - minLng) * 0.03, 0.001);
    minLat -= padLat;
    maxLat += padLat;
    minLng -= padLng;
    maxLng += padLng;
    const cols = 160;
    const rows = 160;
    const inside = new Uint8Array(cols * rows);
    const latOf = row => minLat + ((row + 0.5) / rows) * (maxLat - minLat);
    const lngOf = col => minLng + ((col + 0.5) / cols) * (maxLng - minLng);
    for (let row = 0; row < rows; row += 1) {
      const lat = latOf(row);
      for (let col = 0; col < cols; col += 1) {
        const lng = lngOf(col);
        const hit = boxes.some(box => (
          lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng && ringContains(lat, lng, box.ring)
        ));
        if (hit) inside[row * cols + col] = 1;
      }
    }
    const sealed = inside.slice();
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (inside[row * cols + col]) continue;
        let touch = 0;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dc, dr]) => {
          const nextCol = col + dc;
          const nextRow = row + dr;
          if (nextCol < 0 || nextRow < 0 || nextCol >= cols || nextRow >= rows) return;
          if (inside[nextRow * cols + nextCol]) touch += 1;
        });
        if (touch >= 2) sealed[row * cols + col] = 1;
      }
    }
    const outside = new Uint8Array(cols * rows);
    const stack = [];
    const pushOutside = (col, row) => {
      if (col < 0 || row < 0 || col >= cols || row >= rows) return;
      const id = row * cols + col;
      if (outside[id] || sealed[id]) return;
      outside[id] = 1;
      stack.push(id);
    };
    for (let col = 0; col < cols; col += 1) {
      pushOutside(col, 0);
      pushOutside(col, rows - 1);
    }
    for (let row = 0; row < rows; row += 1) {
      pushOutside(0, row);
      pushOutside(cols - 1, row);
    }
    while (stack.length) {
      const id = stack.pop();
      const col = id % cols;
      const row = (id - col) / cols;
      pushOutside(col + 1, row);
      pushOutside(col - 1, row);
      pushOutside(col, row + 1);
      pushOutside(col, row - 1);
    }
    const solid = new Uint8Array(cols * rows);
    for (let index = 0; index < solid.length; index += 1) {
      if (!outside[index]) solid[index] = 1;
    }
    const on = (col, row) => col >= 0 && row >= 0 && col < cols && row < rows && solid[row * cols + col] === 1;
    const moore = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const used = new Uint8Array(cols * rows);
    const paths = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (!on(col, row) || on(col - 1, row) || used[row * cols + col]) continue;
        let cursorCol = col;
        let cursorRow = row;
        let dir = 4;
        const cells = [];
        for (let step = 0; step < cols * rows * 2; step += 1) {
          cells.push([cursorCol, cursorRow]);
          used[cursorRow * cols + cursorCol] = 1;
          let found = false;
          for (let turn = 0; turn < 8; turn += 1) {
            const nextDir = (dir + 1 + turn) % 8;
            const nextCol = cursorCol + moore[nextDir][0];
            const nextRow = cursorRow + moore[nextDir][1];
            if (!on(nextCol, nextRow)) continue;
            cursorCol = nextCol;
            cursorRow = nextRow;
            dir = (nextDir + 4) % 8;
            found = true;
            break;
          }
          if (!found || (cursorCol === col && cursorRow === row)) break;
        }
        if (cells.length < 12) continue;
        const points = cells.map(([cellCol, cellRow]) => [latOf(cellRow), lngOf(cellCol)]);
        const simplified = simplifyClosedRing(points, 42);
        if (simplified.length >= 3) paths.push(simplified);
      }
    }
    return paths.length ? paths : source;
  }

  function simplifyClosedRing(points, maxPoints) {
    const raw = points.slice();
    if (raw.length <= maxPoints) return raw;
    let epsilon = 0.0004;
    let simplified = raw;
    for (let attempt = 0; attempt < 16 && simplified.length > maxPoints; attempt += 1) {
      simplified = douglasOpen(raw, epsilon);
      epsilon *= 1.55;
    }
    if (simplified.length > maxPoints) {
      const step = simplified.length / maxPoints;
      const sampled = [];
      for (let index = 0; index < maxPoints; index += 1) sampled.push(simplified[Math.floor(index * step)]);
      simplified = sampled;
    }
    return simplified.length >= 3 ? simplified : raw.slice(0, maxPoints);
  }

  function lineDistancePair(point, start, end) {
    const dx = end[1] - start[1];
    const dy = end[0] - start[0];
    const len2 = dx * dx + dy * dy;
    if (!len2) return Math.hypot(point[1] - start[1], point[0] - start[0]);
    const t = Math.max(0, Math.min(1, ((point[1] - start[1]) * dx + (point[0] - start[0]) * dy) / len2));
    return Math.hypot(point[1] - (start[1] + t * dx), point[0] - (start[0] + t * dy));
  }

  function douglasOpen(points, epsilon) {
    if (points.length <= 3) return points.slice();
    let maxDist = 0;
    let index = 0;
    const start = points[0];
    const end = points[points.length - 1];
    for (let cursor = 1; cursor < points.length - 1; cursor += 1) {
      const dist = lineDistancePair(points[cursor], start, end);
      if (dist > maxDist) {
        maxDist = dist;
        index = cursor;
      }
    }
    if (maxDist <= epsilon) return [start, end];
    const left = douglasOpen(points.slice(0, index + 1), epsilon);
    const right = douglasOpen(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }

  function officialBorder(bounds, region, spec) {
    const rings = [];
    findMatchedDongs(bounds, region, spec).forEach(item => {
      ringsFromDong(item).forEach(ring => rings.push(ring));
    });
    const outer = solidOuterRings(rings);
    return outer.length ? outer : rings;
  }

  function dongOverlapsBorder(text, border, bounds, region, spec) {
    if (!border.length || !bounds?.items) return false;
    const parts = adminParts(text);
    const dongs = parts.filter(part => part.kind === 'dong' && !part.name.endsWith('리'));
    if (!dongs.length) return false;
    const cities = [...parts.filter(part => part.kind === 'city').map(part => part.name), ...(spec.large || []), region?.city];
    const addressGus = parts.filter(part => part.kind === 'gu').map(part => part.name);
    const gus = addressGus.length ? addressGus : (spec.gu || []);
    return dongs.some(part => bounds.items.some(item => {
      if (!sidoMatches(item.sido, cities)) return false;
      if (gus.length && !guMatches(item.sgg, gus)) return false;
      if (!emdMatches(item.emd, part.name)) return false;
      const rings = ringsFromDong(item);
      const samples = [];
      rings.forEach(ring => {
        const step = Math.max(1, Math.ceil(ring.length / 24));
        for (let index = 0; index < ring.length; index += step) samples.push(ring[index]);
        samples.push(ringCentroid(ring));
      });
      const inside = samples.filter(point => clearlyInside(point[0], point[1], border));
      return inside.length >= 2;
    }));
  }

  function loadDongBounds() {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    if (!dongBoundsPromise) {
      dongBoundsPromise = fetch('js/admin-dong-bounds.json?v=20261119region10')
        .then(response => {
          if (!response.ok) throw new Error('동 경계를 불러오지 못했습니다.');
          return response.json();
        })
        .catch(error => {
          dongBoundsPromise = null;
          throw error;
        });
    }
    return dongBoundsPromise;
  }

  function loadKakaoMaps() {
    if (typeof document === 'undefined') return Promise.reject(new Error('지도 없음'));
    if (window.kakao?.maps?.services && window.kakao.maps.Map) return Promise.resolve();
    if (!kakaoPromise) {
      kakaoPromise = new Promise((resolve, reject) => {
        const ready = () => {
          if (window.kakao?.maps?.load && !window.kakao.maps.services) {
            window.kakao.maps.load(() => resolve());
            return;
          }
          resolve();
        };
        if (window.kakao?.maps?.load && !window.kakao.maps.services) {
          ready();
          return;
        }
        const script = document.createElement('script');
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_MAP_KEY}&autoload=false&libraries=services`;
        script.onload = ready;
        script.onerror = () => {
          kakaoPromise = null;
          reject(new Error('카카오맵을 불러오지 못했습니다.'));
        };
        document.head.appendChild(script);
      });
    }
    return kakaoPromise;
  }

  function geoCache() {
    if (geoMemory) return geoMemory;
    geoMemory = {};
    try {
      const raw = window.localStorage?.getItem('brem_kakao_geocode_v1');
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object') geoMemory = parsed;
    } catch (error) {
      geoMemory = {};
    }
    return geoMemory;
  }

  function rememberGeo(key, point) {
    const cache = geoCache();
    cache[key] = point;
    try {
      const keys = Object.keys(cache);
      if (keys.length > 3000) delete cache[keys[0]];
      window.localStorage?.setItem('brem_kakao_geocode_v1', JSON.stringify(cache));
    } catch (error) {
      /* 저장 한도를 넘으면 이번 계산만 메모리에 둔다. */
    }
  }

  function searchKakaoAddress(geocoder, places, query) {
    const ok = window.kakao.maps.services.Status.OK;
    return new Promise(resolve => {
      let done = false;
      const finish = point => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve(point);
      };
      const timer = window.setTimeout(() => finish(null), 8000);
      const take = item => {
        const lat = Number(item?.y);
        const lng = Number(item?.x);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { lat, lng };
      };
      geocoder.addressSearch(query, (result, status) => {
        if (status === ok && result?.[0]) {
          finish(take(result[0]));
          return;
        }
        places.keywordSearch(query, (list, placeStatus) => {
          finish(placeStatus === ok ? take(list?.[0]) : null);
        }, { size: 1 });
      });
    });
  }

  async function geocodeMany(queries) {
    await loadKakaoMaps();
    const cache = geoCache();
    const result = new Map();
    const pending = [];
    (Array.isArray(queries) ? queries : []).forEach(query => {
      const key = String(query || '').replace(/\s+/g, ' ').trim();
      if (!key) return;
      if (cache[key] && Number.isFinite(cache[key].lat) && Number.isFinite(cache[key].lng)) {
        result.set(key, cache[key]);
        return;
      }
      if (!pending.includes(key)) pending.push(key);
    });
    const queue = pending.slice();
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const query = queue.shift();
        try {
          const point = await searchKakaoAddress(
            new window.kakao.maps.services.Geocoder(),
            new window.kakao.maps.services.Places(),
            query
          );
          result.set(query, point);
          if (point) rememberGeo(query, point);
        } catch (error) {
          result.set(query, null);
        }
      }
    });
    await Promise.all(workers);
    return result;
  }

  function judgeAddress(text, spec, border, bounds, region, points) {
    if (!addressIsDetailed(text)) {
      if (isInsideAddress(text, spec)) return true;
      return dongOverlapsBorder(text, border, bounds, region, spec);
    }
    const key = String(text || '').replace(/\s+/g, ' ').trim();
    const point = points.get(key);
    // 좌표가 없으면 권역 키워드로 판단한다. 안으로 두면 나중에 좌표가 생겼을 때 주정산만 권외로 바뀐다.
    if (!point) return isInsideAddress(text, spec);
    return pointInRings(point.lat, point.lng, border);
  }

  async function sumFromSheetRowsAsync(rows, options) {
    const opts = options || {};
    if (!opts.keywordMode) return sumFromSheetRows(rows, opts);
    const keywords = opts.keywords || {};
    const sync = sumByKeywords(rows, keywords);
    if (!sync?.ready) return sync;
    const spec = keywordSpec(keywords);
    const region = {
      city: keywords.city || opts.region?.city || '',
      region: keywords.region || opts.region?.region || ''
    };
    let bounds = null;
    try {
      bounds = await loadDongBounds();
    } catch (error) {
      return sync;
    }
    const custom = savedRings(keywords);
    const border = custom.length ? custom : officialBorder(bounds, region, spec);
    if (!border.length) return sync;
    let points = new Map();
    const valid = collectValidRows(rows) || [];
    const queries = [];
    valid.forEach(row => {
      if (addressIsDetailed(row.pickup)) queries.push(row.pickup);
      if (addressIsDetailed(row.delivery)) queries.push(row.delivery);
    });
    if (queries.length) {
      try {
        points = await geocodeMany(queries);
      } catch (error) {
        return sync;
      }
    }
    const byName = new Map();
    valid.forEach(row => {
      const pickupIn = judgeAddress(row.pickup, spec, border, bounds, region, points);
      const deliveryIn = judgeAddress(row.delivery, spec, border, bounds, region, points);
      if (pickupIn && deliveryIn) return;
      byName.set(row.name, (byName.get(row.name) || 0) + 1);
    });
    return {
      byName,
      ready: true,
      validCount: valid.length,
      homeDistrict: '',
      mode: custom.length ? 'border' : 'dong-border'
    };
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
    outsideCallTargetFile,
    normalizeKeywordList,
    keywordSpec,
    keywordsReady,
    isInsideAddress,
    listOrderAreas,
    keywordsFromAddresses,
    addressAlreadyRegistered,
    sumFromSheetRows,
    sumFromSheetRowsAsync,
    addressIsDetailed,
    pointInRings,
    solidOuterRings,
    payAmount
  };
});
