/* 쿠팡 일정산 업로드 기록으로 권외 권역 목록을 만들고, 시·구·동 키워드를 저장한다. */
(function () {
  'use strict';

  const BODY_ID = 'outsideCallRegionsBody';
  const KAKAO_MAP_KEY = '7767a9f4bbb17e3c1c905caecc533cef';
  let bound = false;
  let active = null;
  let fileRegion = null;
  let keywordDirty = false;
  let loadedAreas = [];
  let kakaoMapPromise = null;
  let dongBoundsPromise = null;
  let mapRegion = null;
  let mapSession = null;

  function store() {
    return window.BremStorage?.outsideCallRegions || null;
  }

  function parser() {
    return window.BremOutsideCall || null;
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function keywordText(list) {
    return (Array.isArray(list) ? list : []).join('\n');
  }

  function preview(list) {
    const items = Array.isArray(list) ? list : [];
    if (!items.length) return '<span class="form-help">없음</span>';
    return items.map(item => `<span class="settlement-call-fee-log-badge">${escapeHtml(item)}</span>`).join(' ');
  }

  function fixedRegions() {
    const parse = parser()?.parseDailyFileRegion;
    const map = new Map();
    const saved = store()?.getAll?.() || {};
    Object.keys(saved).forEach(key => {
      const entry = saved[key] || {};
      const parts = String(key).split('\t');
      const city = String(entry.city || parts[0] || '').trim();
      const region = String(entry.region || parts[1] || '').trim();
      if (!city || !region || entry.closed === true) return;
      const stableKey = `${city}\t${region}`;
      map.set(stableKey, { city, region, label: `${city} ${region}`, key: stableKey });
    });
    const logs = window.BremStorage?.settlementUploadLogs?.getFiltered?.({
      kind: 'daily',
      platform: 'coupang'
    }) || [];
    const fresh = [];
    if (typeof parse === 'function') {
      logs.forEach(log => {
        const region = parse(log.fileName || '');
        if (!region?.city || !region.region || map.has(region.key)) return;
        if (saved[region.key]?.closed === true) return;
        map.set(region.key, {
          city: region.city,
          region: region.region,
          label: region.label,
          key: region.key
        });
        fresh.push(region);
      });
    }
    if (fresh.length) {
      try { store()?.rememberAll?.(fresh); } catch (error) { console.warn('[BREM] 권역 목록 고정 실패', error); }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  }

  function regionChoices() {
    const map = new Map();
    fixedRegions().forEach(region => map.set(region.key, region));
    if (fileRegion?.key && !map.has(fileRegion.key)) map.set(fileRegion.key, fileRegion);
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  }

  function optionValue(region) {
    return encodeURIComponent(region?.key || '');
  }

  function selectedRegion() {
    const raw = document.getElementById('outsideWeeklyRegion')?.value || '';
    let key = raw;
    try { key = decodeURIComponent(raw); } catch (error) { key = raw; }
    return regionChoices().find(region => region.key === key) || null;
  }

  function fillRegionSelect() {
    const select = document.getElementById('outsideWeeklyRegion');
    if (!select) return;
    const current = select.value;
    const regions = regionChoices();
    if (!regions.length) {
      select.innerHTML = '<option value="">권역이 없습니다. 주정산서 파일 이름으로 만듭니다.</option>';
      return;
    }
    select.innerHTML = regions.map(region => (
      `<option value="${optionValue(region)}">${escapeHtml(region.label)}</option>`
    )).join('');
    const preferred = regions.some(region => optionValue(region) === current)
      ? current
      : optionValue(
        (fileRegion?.key && regions.find(region => region.key === fileRegion.key))
        || regions[0]
      );
    select.value = preferred;
  }

  function writeKeywordFields(spec) {
    const large = document.getElementById('outsideWeeklyLarge');
    const gu = document.getElementById('outsideWeeklyGu');
    const dong = document.getElementById('outsideWeeklyDong');
    if (large) large.value = keywordText(spec?.large);
    if (gu) gu.value = keywordText(spec?.gu);
    if (dong) dong.value = keywordText(spec?.dong);
  }

  function syncKeywordFields(force) {
    if (keywordDirty && !force) return;
    const region = selectedRegion();
    if (!region) {
      writeKeywordFields({ large: [], gu: [], dong: [] });
      keywordDirty = false;
      return;
    }
    const entry = store()?.get?.(region.city, region.region) || { large: [], gu: [], dong: [] };
    writeKeywordFields(entry);
    keywordDirty = false;
  }

  function checkedAddresses() {
    return [...document.querySelectorAll('[data-outside-area]:checked')].map(input => input.value).filter(Boolean);
  }

  function savedKeywords() {
    const region = selectedRegion();
    if (!region) return { large: [], gu: [], dong: [] };
    return store()?.get?.(region.city, region.region) || { large: [], gu: [], dong: [] };
  }

  function renderAreas(areas) {
    const box = document.getElementById('outsideWeeklyAreaResult');
    if (!box) return;
    const list = Array.isArray(areas) ? areas : [];
    loadedAreas = list;
    if (!list.length) {
      box.innerHTML = '<p class="form-help outside-area-panel">오더별 상세내역에서 지역이 비어 있습니다.</p>';
      return;
    }
    const saved = savedKeywords();
    const registeredCount = list.filter(area => parser()?.addressAlreadyRegistered?.(area.text, saved)).length;
    box.innerHTML = `<div class="outside-area-panel">
      <p class="form-help">지역 ${list.length}개. 권내인 것만 체크하세요.${registeredCount ? ` 이미 등록된 키워드 ${registeredCount}개는 등록됨으로 표시됩니다.` : ''}</p>
      <div class="outside-area-actions">
        <button type="button" class="small-btn" id="outsideWeeklyCheckAll">모두 체크</button>
        <button type="button" class="small-btn" id="outsideWeeklyCheckNone">체크 해제</button>
      </div>
      <div class="outside-area-list">
        ${list.map(area => {
          const registered = parser()?.addressAlreadyRegistered?.(area.text, saved);
          return `<label class="outside-area-list__item">
          <input type="checkbox" data-outside-area value="${escapeHtml(area.text)}">
          <span>${escapeHtml(area.text)}${registered ? '<span class="outside-area-registered">등록됨</span>' : ''}</span>
          <span class="form-help">${area.count}건</span>
        </label>`;
        }).join('')}
      </div>
    </div>`;
    box.querySelector('#outsideWeeklyCheckAll')?.addEventListener('click', () => {
      box.querySelectorAll('[data-outside-area]').forEach(input => { input.checked = true; });
    });
    box.querySelector('#outsideWeeklyCheckNone')?.addEventListener('click', () => {
      box.querySelectorAll('[data-outside-area]').forEach(input => { input.checked = false; });
    });
  }

  async function loadWeeklyFile(event) {
    event.preventDefault();
    const file = document.getElementById('outsideWeeklyFile')?.files?.[0];
    const password = document.getElementById('outsideWeeklyPassword')?.value || '';
    if (!file) {
      showToast('주정산서 파일을 선택하세요.');
      return;
    }
    if (!String(password).trim()) {
      showToast('엑셀 비밀번호를 입력하세요.');
      return;
    }
    const parsed = parser()?.parseDailyFileRegion?.(file.name) || null;
    if (parsed?.city && parsed?.region) {
      fileRegion = parsed;
      fillRegionSelect();
      const select = document.getElementById('outsideWeeklyRegion');
      if (select) select.value = optionValue(parsed);
      syncKeywordFields(true);
    }
    const button = document.getElementById('outsideWeeklyLoadBtn');
    if (button) button.disabled = true;
    try {
      if (typeof BremSettlementParser?.openWorkbookSheetRows !== 'function') {
        throw new Error('정산서 읽기 준비가 되지 않았습니다. 새로고침 후 다시 시도하세요.');
      }
      const buffer = new Uint8Array(await file.arrayBuffer());
      const rows = await BremSettlementParser.openWorkbookSheetRows(
        buffer,
        BremSettlementParser.normalizePassword(password),
        {
          sheetMatcher: name => {
            const text = String(name || '');
            return text.includes('오더별') && text.includes('상세');
          }
        }
      );
      const areas = parser()?.listOrderAreas?.(rows);
      if (!areas) {
        const box = document.getElementById('outsideWeeklyAreaResult');
        if (box) box.innerHTML = '<p class="form-help outside-area-panel">오더별 상세내역에서 픽업지역·배달지역 칸을 찾지 못했습니다.</p>';
        showToast('오더별 상세내역에서 지역 칸을 찾지 못했습니다.');
        return;
      }
      renderAreas(areas);
      const meta = document.getElementById('outsideWeeklyFileMeta');
      if (meta) {
        meta.textContent = parsed?.label
          ? `${file.name} → ${parsed.label}. 권내 지역을 체크한 뒤 키워드를 채우세요.`
          : `${file.name}에서 시·지역을 읽지 못했습니다. 저장할 권역을 고르세요.`;
      }
      showToast(`지역 ${areas.length}개를 불러왔습니다.`);
    } catch (error) {
      showToast(error?.message || '주정산서를 읽지 못했습니다.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function fillKeywordsFromChecks() {
    const checked = checkedAddresses();
    if (!checked.length) {
      showToast('권내 지역을 체크하세요.');
      return;
    }
    const spec = parser()?.keywordsFromAddresses?.(checked) || { large: [], gu: [], dong: [] };
    const normalize = parser()?.normalizeKeywordList
      || (value => String(value || '').split(/[\n,，]/).map(item => item.trim()).filter(Boolean));
    const saved = savedKeywords();
    writeKeywordFields({
      large: normalize([...(saved.large || []), ...normalize(document.getElementById('outsideWeeklyLarge')?.value), ...spec.large]),
      gu: normalize([...(saved.gu || []), ...normalize(document.getElementById('outsideWeeklyGu')?.value), ...spec.gu]),
      dong: normalize([...(saved.dong || []), ...normalize(document.getElementById('outsideWeeklyDong')?.value), ...spec.dong])
    });
    keywordDirty = true;
    showToast(`시 ${spec.large.length}개, 구 ${spec.gu.length}개, 동 ${spec.dong.length}개를 기존 키워드에 더했습니다. 고친 뒤 저장하세요.`);
  }

  function saveWeeklyKeywords() {
    const region = selectedRegion();
    if (!region) {
      showToast('저장할 권역을 고르세요.');
      return;
    }
    const normalize = parser()?.normalizeKeywordList
      || (value => String(value || '').split(/[\n,，]/).map(item => item.trim()).filter(Boolean));
    try {
      store()?.save?.(region.city, region.region, {
        large: normalize(document.getElementById('outsideWeeklyLarge')?.value),
        gu: normalize(document.getElementById('outsideWeeklyGu')?.value),
        dong: normalize(document.getElementById('outsideWeeklyDong')?.value)
      });
      keywordDirty = false;
      fileRegion = null;
      showToast(`${region.label} 권역 키워드를 저장했습니다.`);
      render();
      if (loadedAreas.length) renderAreas(loadedAreas);
    } catch (error) {
      showToast(error?.message || '권역 키워드를 저장하지 못했습니다.');
    }
  }

  function render() {
    fillRegionSelect();
    syncKeywordFields(false);
    const body = document.getElementById(BODY_ID);
    if (!body) return;
    const regions = fixedRegions();
    const saved = store();
    if (!regions.length) {
      body.innerHTML = '<p class="form-help">표시할 권역이 없습니다. 새 시·지역 일정산을 올리면 줄이 생깁니다.</p>';
      return;
    }
    body.innerHTML = `<div class="table-wrap"><table class="settlement-preview-table">
      <thead><tr><th>지역</th><th>큰 키워드</th><th>구 키워드</th><th>동 키워드</th><th></th></tr></thead>
      <tbody>
        ${regions.map(region => {
          const entry = saved?.get?.(region.city, region.region) || { large: [], gu: [], dong: [] };
          return `<tr>
            <td><strong>${escapeHtml(region.label)}</strong></td>
            <td>${preview(entry.large)}</td>
            <td>${preview(entry.gu)}</td>
            <td>${preview(entry.dong)}</td>
            <td>
              <button type="button" class="small-btn" data-outside-map data-outside-city="${escapeHtml(region.city)}" data-outside-region="${escapeHtml(region.region)}">지도</button>
              <button type="button" class="small-btn" data-outside-edit data-outside-city="${escapeHtml(region.city)}" data-outside-region="${escapeHtml(region.region)}">키워드 설정</button>
              <button type="button" class="small-btn danger-btn" data-outside-delete data-outside-city="${escapeHtml(region.city)}" data-outside-region="${escapeHtml(region.region)}">삭제</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  }

  function closeDialog() {
    const dialog = document.getElementById('outsideRegionKeywordDialog');
    if (dialog) dialog.hidden = true;
    active = null;
  }

  function openDialog(region) {
    active = region;
    const dialog = document.getElementById('outsideRegionKeywordDialog');
    const title = document.getElementById('outsideRegionKeywordMeta');
    const entry = store()?.get?.(region.city, region.region) || { large: [], gu: [], dong: [] };
    if (title) title.textContent = region.label;
    const large = document.getElementById('outsideRegionKeywordLarge');
    const gu = document.getElementById('outsideRegionKeywordGu');
    const dong = document.getElementById('outsideRegionKeywordDong');
    if (large) large.value = keywordText(entry.large);
    if (gu) gu.value = keywordText(entry.gu);
    if (dong) dong.value = keywordText(entry.dong);
    if (dialog) dialog.hidden = false;
    large?.focus?.();
  }

  function loadKakaoMaps() {
    if (window.kakao?.maps?.services && window.kakao.maps.Map) return Promise.resolve();
    if (!kakaoMapPromise) {
      kakaoMapPromise = new Promise((resolve, reject) => {
        const ready = () => {
          if (window.kakao?.maps?.load && !window.kakao.maps.Map) {
            window.kakao.maps.load(() => resolve());
            return;
          }
          resolve();
        };
        if (window.kakao?.maps?.load && !window.kakao.maps.Map) {
          ready();
          return;
        }
        const script = document.createElement('script');
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_MAP_KEY}&autoload=false&libraries=services`;
        script.onload = ready;
        script.onerror = () => {
          kakaoMapPromise = null;
          reject(new Error('카카오맵을 불러오지 못했습니다.'));
        };
        document.head.appendChild(script);
      });
    }
    return kakaoMapPromise;
  }

  function mapQueries(region, entry) {
    const large = Array.isArray(entry?.large) ? entry.large : [];
    const city = large.find(item => /(?:광역시|특별시|시|도)$/.test(item)) || large[0] || region.city;
    const gu = (Array.isArray(entry?.gu) ? entry.gu : [])[0] || '';
    const places = Array.isArray(entry?.dong) ? entry.dong : [];
    const prefix = [city, gu].filter(Boolean).join(' ');
    if (!places.length) return prefix ? [{ label: prefix, query: prefix }] : [];
    return places.map(place => ({
      label: place,
      query: [prefix, place].filter(Boolean).join(' ')
    }));
  }

  function searchKakaoPlace(query) {
    const geocoder = new window.kakao.maps.services.Geocoder();
    const places = new window.kakao.maps.services.Places();
    const ok = window.kakao.maps.services.Status.OK;
    return new Promise(resolve => {
      geocoder.addressSearch(query, (result, status) => {
        if (status === ok && result?.[0]) {
          resolve({ x: result[0].x, y: result[0].y });
          return;
        }
        places.keywordSearch(query, (list, placeStatus) => {
          if (placeStatus === ok && list?.[0]) {
            resolve({ x: list[0].x, y: list[0].y });
            return;
          }
          resolve(null);
        }, { size: 1 });
      });
    });
  }

  async function searchMapQueries(items) {
    const found = [];
    const missed = [];
    const queue = items.slice();
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const item = queue.shift();
        const point = await searchKakaoPlace(item.query);
        if (point) found.push({ ...item, ...point });
        else missed.push(item.label);
      }
    });
    await Promise.all(workers);
    return { found, missed };
  }

  function loadDongBounds() {
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

  function sidoMatches(sidonm, cities) {
    const hay = String(sidonm || '');
    const alias = {
      경남: '경상남',
      경북: '경상북',
      전남: '전라남',
      전북: '전라북',
      충남: '충청남',
      충북: '충청북'
    };
    return (Array.isArray(cities) ? cities : []).some(city => {
      const raw = String(city || '').trim();
      if (!raw) return false;
      if (hay.includes(raw)) return true;
      const stem = raw.replace(/(특별자치도|특별자치시|특별시|광역시|시|도)$/, '');
      if (stem && hay.includes(stem)) return true;
      return alias[stem] ? hay.includes(alias[stem]) : false;
    });
  }

  function isRoadKeyword(keyword) {
    return /(?:로|길)$/.test(String(keyword || '').replace(/\s+/g, ''));
  }

  function emdMatches(emd, keyword) {
    const name = String(emd || '').replace(/\s+/g, '');
    const key = String(keyword || '').replace(/\s+/g, '');
    if (!name || !key || isRoadKeyword(key)) return false;
    if (name === key) return true;
    const full = /(?:동|읍|면)$/.test(key) ? key : `${key}동`;
    if (name === full) return true;
    return key.length >= 2 && name.startsWith(key) && /(?:동|읍|면)$/.test(name);
  }

  function findDongPolygons(bounds, region, entry) {
    const cities = [...(entry.large || []), region.city];
    const gus = entry.gu || [];
    const keywords = (entry.dong || []).filter(keyword => !isRoadKeyword(keyword));
    const matched = [];
    const seen = new Set();
    const covered = new Set();
    keywords.forEach(keyword => {
      (bounds?.items || []).forEach(item => {
        if (!sidoMatches(item.sido, cities)) return;
        if (gus.length && !gus.some(gu => item.sgg === gu || String(item.sgg || '').includes(gu))) return;
        if (!emdMatches(item.emd, keyword)) return;
        covered.add(keyword);
        const id = `${item.sido}\t${item.sgg}\t${item.emd}`;
        if (seen.has(id)) return;
        seen.add(id);
        matched.push(item);
      });
    });
    const pins = (entry.dong || []).filter(keyword => !covered.has(keyword));
    return { matched, pins };
  }

  function circleImage(fill, size) {
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${(size / 2) - 1}" fill="${fill}" stroke="#111" stroke-width="1"/></svg>`;
      return new window.kakao.maps.MarkerImage(
        `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
        new window.kakao.maps.Size(size, size),
        { offset: new window.kakao.maps.Point(size / 2, size / 2) }
      );
    } catch (error) {
      return null;
    }
  }

  function pathCentroid(path) {
    let lat = 0;
    let lng = 0;
    path.forEach(point => {
      lat += point.getLat();
      lng += point.getLng();
    });
    return new window.kakao.maps.LatLng(lat / path.length, lng / path.length);
  }

  function midpoint(start, end) {
    return new window.kakao.maps.LatLng(
      (start.getLat() + end.getLat()) / 2,
      (start.getLng() + end.getLng()) / 2
    );
  }

  function clearHandles(shape) {
    (shape.handles || []).forEach(marker => marker.setMap(null));
    (shape.mids || []).forEach(marker => marker.setMap(null));
    shape.handles = [];
    shape.mids = [];
  }

  function showHandles(session, shape) {
    clearHandles(shape);
    shape.path.forEach((position, index) => {
      const marker = new window.kakao.maps.Marker({
        position,
        map: session.map,
        draggable: true,
        zIndex: 4,
        ...(session.vertexImage ? { image: session.vertexImage } : {})
      });
      window.kakao.maps.event.addListener(marker, 'drag', () => {
        shape.path[index] = marker.getPosition();
        shape.polygon.setPath(shape.path);
        shape.badge?.setPosition(pathCentroid(shape.path));
      });
      window.kakao.maps.event.addListener(marker, 'dragend', () => {
        shape.path[index] = marker.getPosition();
        shape.polygon.setPath(shape.path);
        selectShape(session, shape);
      });
      window.kakao.maps.event.addListener(marker, 'rightclick', () => {
        if (shape.path.length <= 3) return;
        shape.path.splice(index, 1);
        shape.polygon.setPath(shape.path);
        shape.badge?.setPosition(pathCentroid(shape.path));
        selectShape(session, shape);
      });
      shape.handles.push(marker);
    });
    shape.path.forEach((position, index) => {
      const next = shape.path[(index + 1) % shape.path.length];
      const marker = new window.kakao.maps.Marker({
        position: midpoint(position, next),
        map: session.map,
        zIndex: 3,
        ...(session.midImage ? { image: session.midImage } : {})
      });
      window.kakao.maps.event.addListener(marker, 'click', () => {
        const inserted = midpoint(shape.path[index], shape.path[(index + 1) % shape.path.length]);
        shape.path.splice(index + 1, 0, inserted);
        shape.polygon.setPath(shape.path);
        selectShape(session, shape);
      });
      shape.mids.push(marker);
    });
  }

  function selectShape(session, shape) {
    session.shapes.forEach(clearHandles);
    session.selected = shape;
    if (!shape) return;
    showHandles(session, shape);
    const meta = document.getElementById('outsideRegionMapMeta');
    if (meta) {
      meta.textContent = `${shape.label} 테두리를 고치는 중입니다. 노란 점을 끌고, 흰 점을 누르면 점이 생기고, 노란 점을 우클릭하면 지워집니다. 테두리 저장을 눌러야 권외 계산에 반영됩니다.`;
    }
  }

  function addShape(session, label, path) {
    const polygon = new window.kakao.maps.Polygon({
      map: session.map,
      path,
      strokeWeight: 3,
      strokeColor: '#ffd400',
      strokeOpacity: 0.95,
      fillColor: '#ffd400',
      fillOpacity: 0.18
    });
    const shape = { label, path, polygon, handles: [], mids: [], badge: null };
    shape.badge = new window.kakao.maps.CustomOverlay({
      map: session.map,
      position: pathCentroid(path),
      content: `<div class="outside-map-pin">${escapeHtml(label)} · 권내</div>`,
      yAnchor: 1.3,
      zIndex: 2
    });
    window.kakao.maps.event.addListener(polygon, 'click', () => {
      if (session.drawing) return;
      selectShape(session, shape);
    });
    session.shapes.push(shape);
    path.forEach(point => session.bounds.extend(point));
    return shape;
  }

  function paintDraft(session) {
    if (session.draftLine) session.draftLine.setMap(null);
    if (session.draft.length < 2) {
      session.draftLine = null;
      return;
    }
    session.draftLine = new window.kakao.maps.Polyline({
      map: session.map,
      path: session.draft,
      strokeWeight: 3,
      strokeColor: '#ffd400',
      strokeOpacity: 0.95
    });
  }

  function drawEditableMap(pins, polygons, savedRings) {
    const canvas = document.getElementById('outsideRegionMapCanvas');
    const saved = (Array.isArray(savedRings) ? savedRings : []).filter(ring => Array.isArray(ring) && ring.length >= 3);
    if (!canvas || (!pins.length && !polygons.length && !saved.length)) return;
    canvas.innerHTML = '';
    const bounds = new window.kakao.maps.LatLngBounds();
    const seedPoint = saved[0]?.[0]
      ? [saved[0][0][0], saved[0][0][1]]
      : pins[0]
        ? [Number(pins[0].y), Number(pins[0].x)]
        : [polygons[0].rings[0][0][1], polygons[0].rings[0][0][0]];
    const seed = new window.kakao.maps.LatLng(seedPoint[0], seedPoint[1]);
    const map = new window.kakao.maps.Map(canvas, { center: seed, level: 6 });
    const session = {
      map,
      bounds,
      shapes: [],
      selected: null,
      drawing: false,
      draft: [],
      draftLine: null,
      vertexImage: circleImage('#ffd400', 14),
      midImage: circleImage('#ffffff', 10)
    };
    mapSession = session;
    window.kakao.maps.event.addListener(map, 'click', mouse => {
      if (!session.drawing || !mouse?.latLng) return;
      session.draft.push(mouse.latLng);
      paintDraft(session);
    });
    if (saved.length) {
      saved.forEach((ring, index) => {
        const path = ring
          .map(([lat, lng]) => new window.kakao.maps.LatLng(Number(lat), Number(lng)))
          .filter(point => Number.isFinite(point.getLat()) && Number.isFinite(point.getLng()));
        if (path.length >= 3) addShape(session, `테두리 ${index + 1}`, path);
      });
    } else {
      polygons.forEach(item => {
        (item.rings || []).forEach(ring => {
          const path = ring.map(([lng, lat]) => new window.kakao.maps.LatLng(lat, lng));
          if (path.length >= 3) addShape(session, item.emd || '동', path);
        });
      });
    }
    const info = new window.kakao.maps.InfoWindow({ removable: true });
    pins.forEach(item => {
      const position = new window.kakao.maps.LatLng(Number(item.y), Number(item.x));
      bounds.extend(position);
      const marker = new window.kakao.maps.Marker({ position, map });
      window.kakao.maps.event.addListener(marker, 'click', () => {
        info.setContent(`<div style="padding:6px 8px;font-size:13px;">${escapeHtml(item.label)}</div>`);
        info.open(map, marker);
      });
    });
    window.setTimeout(() => {
      map.relayout();
      try {
        map.setBounds(bounds);
      } catch (error) {
        map.setCenter(seed);
      }
    }, 80);
  }

  function closeRegionMap() {
    mapSession = null;
    mapRegion = null;
    const drawButton = document.getElementById('outsideRegionMapDraw');
    if (drawButton) drawButton.textContent = '테두리 추가';
    const dialog = document.getElementById('outsideRegionMapDialog');
    if (dialog) dialog.hidden = true;
    const canvas = document.getElementById('outsideRegionMapCanvas');
    if (canvas) canvas.innerHTML = '';
  }

  function keywordPatch(region, rings) {
    const entry = store()?.get?.(region.city, region.region) || {};
    return {
      large: entry.large || [],
      gu: entry.gu || [],
      dong: entry.dong || [],
      rings
    };
  }

  function toggleMapDraw() {
    const session = mapSession;
    const button = document.getElementById('outsideRegionMapDraw');
    if (!session) {
      showToast('지도를 먼저 여세요.');
      return;
    }
    if (session.drawing) {
      if (session.draft.length >= 3) {
        const shape = addShape(session, `테두리 ${session.shapes.length + 1}`, session.draft.slice());
        selectShape(session, shape);
      } else if (session.draft.length) {
        showToast('테두리는 점을 3개 이상 찍어야 닫힙니다.');
      }
      session.drawing = false;
      session.draft = [];
      if (session.draftLine) session.draftLine.setMap(null);
      session.draftLine = null;
      if (button) button.textContent = '테두리 추가';
      return;
    }
    session.shapes.forEach(clearHandles);
    session.selected = null;
    session.drawing = true;
    session.draft = [];
    if (button) button.textContent = '테두리 닫기';
    showToast('지도를 눌러 점을 찍고, 테두리 닫기를 누르세요.');
  }

  function saveMapBorder() {
    if (!mapRegion || !mapSession?.shapes?.length) {
      showToast('저장할 테두리가 없습니다.');
      return;
    }
    const rings = mapSession.shapes.map(shape => shape.path.map(point => [
      Math.round(point.getLat() * 1e5) / 1e5,
      Math.round(point.getLng() * 1e5) / 1e5
    ])).filter(ring => ring.length >= 3);
    try {
      store()?.save?.(mapRegion.city, mapRegion.region, keywordPatch(mapRegion, rings));
      showToast(`${mapRegion.label} 테두리를 저장했습니다. 다음 일정산부터 이 테두리로 권외를 셉니다.`);
    } catch (error) {
      showToast(error?.message || '테두리를 저장하지 못했습니다.');
    }
  }

  function resetMapBorder() {
    if (!mapRegion) {
      showToast('지도를 먼저 여세요.');
      return;
    }
    if (!window.confirm('저장한 테두리를 지우고 행정동 테두리로 되돌릴까요?')) return;
    const region = mapRegion;
    try {
      store()?.save?.(region.city, region.region, keywordPatch(region, []));
      showToast(`${region.label} 테두리를 행정동 경계로 되돌렸습니다.`);
      openRegionMap(region);
    } catch (error) {
      showToast(error?.message || '테두리를 되돌리지 못했습니다.');
    }
  }

  async function openRegionMap(region) {
    const entry = store()?.get?.(region.city, region.region) || { large: [], gu: [], dong: [], rings: [] };
    const queries = mapQueries(region, entry);
    const saved = Array.isArray(entry.rings) ? entry.rings : [];
    if (!queries.length && !saved.length) {
      showToast('키워드가 없어 지도에 찍을 곳이 없습니다.');
      return;
    }
    mapRegion = region;
    const dialog = document.getElementById('outsideRegionMapDialog');
    const title = document.getElementById('outsideRegionMapTitle');
    const meta = document.getElementById('outsideRegionMapMeta');
    const drawButton = document.getElementById('outsideRegionMapDraw');
    if (drawButton) drawButton.textContent = '테두리 추가';
    if (title) title.textContent = region.label;
    if (meta) meta.textContent = '동 경계와 키워드 위치를 찾는 중입니다.';
    if (dialog) dialog.hidden = false;
    try {
      const [bounds] = await Promise.all([loadDongBounds(), loadKakaoMaps()]);
      const { matched, pins: pinKeywords } = findDongPolygons(bounds, region, entry);
      const pinQueries = pinKeywords.length
        ? mapQueries(region, { ...entry, dong: pinKeywords })
        : [];
      const { found, missed } = pinQueries.length
        ? await searchMapQueries(pinQueries)
        : { found: [], missed: [] };
      if (!matched.length && !found.length && !saved.length) {
        if (meta) meta.textContent = '키워드 위치를 찾지 못했습니다.';
        return;
      }
      drawEditableMap(found, matched, saved);
      const missedText = missed.length ? ` 못 찾은 키워드: ${missed.join(', ')}` : '';
      const borderText = saved.length
        ? `저장된 테두리 ${saved.length}개를 불러왔습니다.`
        : `동 테두리 ${matched.length}곳.`;
      if (meta) {
        meta.textContent = `${borderText} 도로 핀 ${found.length}곳.${missedText} 동 가운데 핀은 권내입니다. 동을 누르면 테두리를 고칠 수 있고, 저장해야 다음 집계에 반영됩니다.`;
      }
    } catch (error) {
      if (meta) meta.textContent = error?.message || '지도를 열지 못했습니다.';
    }
  }

  function findRegion(key) {
    return fixedRegions().find(region => region.key === key) || null;
  }

  function bind() {
    if (bound) return;
    bound = true;
    const body = document.getElementById(BODY_ID);
    body?.addEventListener('click', event => {
      const removeButton = event.target.closest('[data-outside-delete]');
      if (removeButton) {
        const city = removeButton.getAttribute('data-outside-city') || '';
        const regionName = removeButton.getAttribute('data-outside-region') || '';
        const label = `${city} ${regionName}`.trim();
        if (!city || !regionName) return;
        if (!window.confirm(`${label} 권역을 목록에서 뺄까요?\n접은 지역은 예전 일정산이 있어도 다시 나오지 않습니다.`)) return;
        try {
          store()?.remove?.(city, regionName);
          showToast(`${label} 권역을 목록에서 뺐습니다.`);
          render();
        } catch (error) {
          showToast(error?.message || '권역을 빼지 못했습니다.');
        }
        return;
      }
      const mapButton = event.target.closest('[data-outside-map]');
      if (mapButton) {
        const region = findRegion(
          `${mapButton.getAttribute('data-outside-city') || ''}\t${mapButton.getAttribute('data-outside-region') || ''}`
        );
        if (region) openRegionMap(region);
        return;
      }
      const button = event.target.closest('[data-outside-edit]');
      if (!button) return;
      const region = findRegion(
        `${button.getAttribute('data-outside-city') || ''}\t${button.getAttribute('data-outside-region') || ''}`
      );
      if (region) openDialog(region);
    });
    document.querySelectorAll('[data-outside-region-tab]').forEach(button => {
      button.addEventListener('click', () => {
        const tab = button.getAttribute('data-outside-region-tab');
        document.querySelectorAll('[data-outside-region-tab]').forEach(item => {
          item.classList.toggle('active', item === button);
        });
        const coupang = document.getElementById('outsideCallRegionsCoupang');
        const baemin = document.getElementById('outsideCallRegionsBaemin');
        if (coupang) coupang.hidden = tab !== 'coupang';
        if (baemin) baemin.hidden = tab !== 'baemin';
      });
    });
    document.querySelectorAll('[data-close-outside-region-dialog]').forEach(button => {
      button.addEventListener('click', closeDialog);
    });
    document.querySelectorAll('[data-close-outside-region-map]').forEach(button => {
      button.addEventListener('click', closeRegionMap);
    });
    document.getElementById('outsideRegionMapDraw')?.addEventListener('click', toggleMapDraw);
    document.getElementById('outsideRegionMapSave')?.addEventListener('click', saveMapBorder);
    document.getElementById('outsideRegionMapReset')?.addEventListener('click', resetMapBorder);
    document.getElementById('outsideWeeklyAreaForm')?.addEventListener('submit', event => {
      loadWeeklyFile(event);
    });
    document.getElementById('outsideWeeklyRegion')?.addEventListener('change', () => {
      syncKeywordFields(true);
      if (loadedAreas.length) renderAreas(loadedAreas);
    });
    ['outsideWeeklyLarge', 'outsideWeeklyGu', 'outsideWeeklyDong'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => {
        keywordDirty = true;
      });
    });
    document.getElementById('outsideWeeklyFillBtn')?.addEventListener('click', fillKeywordsFromChecks);
    document.getElementById('outsideWeeklySaveBtn')?.addEventListener('click', saveWeeklyKeywords);
    document.getElementById('outsideRegionKeywordForm')?.addEventListener('submit', event => {
      event.preventDefault();
      if (!active) return;
      const normalize = parser()?.normalizeKeywordList || (value => String(value || '').split(/[\n,，]/).map(item => item.trim()).filter(Boolean));
      try {
        store()?.save?.(active.city, active.region, {
          large: normalize(document.getElementById('outsideRegionKeywordLarge')?.value),
          gu: normalize(document.getElementById('outsideRegionKeywordGu')?.value),
          dong: normalize(document.getElementById('outsideRegionKeywordDong')?.value)
        });
        showToast(`${active.label} 권역 키워드를 저장했습니다.`);
        closeDialog();
        render();
        if (loadedAreas.length) renderAreas(loadedAreas);
      } catch (error) {
        showToast(error?.message || '권역 키워드를 저장하지 못했습니다.');
      }
    });
  }

  function refresh() {
    bind();
    render();
  }

  window.BremOutsideCallRegionsAdmin = { refresh };
})();
