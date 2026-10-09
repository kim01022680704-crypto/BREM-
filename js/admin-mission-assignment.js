(function () {
  const catalog = () => window.BremMissionPromotionCatalog;
  if (!catalog()) return;

  const $ = (id) => document.getElementById(id);

  const HEADER_MARKERS = ['배민', '쿠팡', 'baemin', 'coupang', 'erp', 'id', '아이디', '아이디', '이름'];
  const CLEAR = '__clear__';

  const state = {
    source: 'region',
    platform: 'baemin',
    regionKey: '',
    lockFilter: 'all',
    baeminRegions: [],
    coupangRegions: [],
    preview: [],
    pool: [],
    unmatched: [],
    selected: new Set(),
    busy: false
  };

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function allDrivers() {
    if (typeof BremStorage.drivers.getAllKnownById === 'function') {
      return BremStorage.drivers.getAllKnownById() || [];
    }
    return BremStorage.drivers.getAll() || [];
  }

  function erpIdOf(driver) {
    if (window.BremDriverUtils?.makeDriverLoginId) {
      return String(window.BremDriverUtils.makeDriverLoginId(driver) || '').replace(/\s/g, '');
    }
    const name = String(driver?.name || '').replace(/\s/g, '');
    const phone = String(driver?.phone || '').replace(/\D/g, '').slice(-4);
    return name && phone ? `${name}${phone}` : '';
  }

  function coupangIdOf(driver) {
    return String(
      window.BremDriverUtils?.getErpCoupangId?.(driver)
      || driver?.coupangLoginKey
      || driver?.coupangId
      || erpIdOf(driver)
      || ''
    ).replace(/\s/g, '');
  }

  function isLocked(driver) {
    return catalog().isAssignmentLocked?.(driver) || Boolean(driver?.missionAssignmentLocked);
  }

  function missionTitle(id) {
    const key = String(id || '').trim();
    if (!key) return '미배정';
    return catalog().getById(key)?.title || key;
  }

  function assignmentLabel(driver) {
    const assigned = catalog().getDriverAssignment(driver) || {};
    if (assigned.combined) return `합산 ${missionTitle(assigned.combined)}`;
    const parts = [];
    if (assigned.baemin) parts.push(`배민 ${missionTitle(assigned.baemin)}`);
    if (assigned.coupang) parts.push(`쿠팡 ${missionTitle(assigned.coupang)}`);
    return parts.join(' · ') || '미배정';
  }

  function shortCoupangRegion(name) {
    let raw = String(name || '').replace(/\s+/g, '').trim();
    if (!raw) return '';
    raw = raw.replace(/\(\d+\)$/g, '');
    const hangul = raw.replace(/[^가-힣]/g, '');
    const base = hangul || raw;
    if (!base) return '';
    return base.length <= 4 ? base : base.slice(-4);
  }

  function driverRegionValue(driver, platform) {
    return platform === 'coupang'
      ? String(driver?.regionCoupang || '').trim()
      : String(driver?.regionBaemin || '').trim();
  }

  function regionList() {
    return state.platform === 'coupang' ? state.coupangRegions : state.baeminRegions;
  }

  function selectedRegion() {
    return regionList().find((item) => item.key === state.regionKey) || null;
  }

  function driversMatchingRegion(region) {
    if (!region) return [];
    const platform = region.platform === 'coupang' ? 'coupang' : 'baemin';
    return allDrivers().filter((driver) => {
      const value = driverRegionValue(driver, platform);
      if (!value) return false;
      if (platform === 'baemin') {
        return value === region.label
          || value === region.partnerId
          || value === region.key
          || (region.partnerId && String(region.partnerId).length >= 6 && value.includes(region.partnerId));
      }
      return value === region.vendorId
        || value === region.key
        || value === region.vendorName
        || shortCoupangRegion(value) === region.label
        || shortCoupangRegion(value) === shortCoupangRegion(region.vendorName);
    });
  }

  function normalizeLookup(value) {
    return String(value || '').trim().replace(/\s/g, '').toLowerCase();
  }

  function baeminKey(value) {
    if (window.BremDriverUtils?.baeminIdMatchKey) {
      return window.BremDriverUtils.baeminIdMatchKey(value);
    }
    const raw = String(value || '').trim().replace(/\s+/g, '');
    if (!raw) return '';
    return /^\d+$/.test(raw) ? (raw.replace(/^0+/, '') || '0') : raw.toLowerCase();
  }

  function isHeaderId(value) {
    const id = normalizeLookup(value);
    if (!id) return false;
    return HEADER_MARKERS.some((marker) => id === marker || id.includes(marker));
  }

  function firstColumnIds(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => String(line || '').replace(/\u00a0/g, ' ').trim())
      .filter(Boolean)
      .map((line) => {
        if (line.includes('\t')) return line.split('\t')[0].trim();
        if (line.includes(',')) return line.split(',')[0].trim();
        return line.split(/\s+/)[0].trim();
      })
      .filter((id) => id && !isHeaderId(id));
  }

  function buildLookupIndexes(drivers) {
    const byKey = new Map();
    const push = (key, driver) => {
      const k = normalizeLookup(key);
      if (!k) return;
      const list = byKey.get(k) || [];
      if (!list.some((item) => item.id === driver.id)) list.push(driver);
      byKey.set(k, list);
    };
    drivers.forEach((driver) => {
      push(driver.id, driver);
      push(driver.baeminId, driver);
      push(baeminKey(driver.baeminId), driver);
      push(erpIdOf(driver), driver);
      push(coupangIdOf(driver), driver);
    });
    return byKey;
  }

  function matchDriversByIds(ids) {
    const drivers = allDrivers();
    const index = buildLookupIndexes(drivers);
    const matched = [];
    const unmatched = [];
    const seen = new Set();
    ids.forEach((rawId) => {
      const keys = [normalizeLookup(rawId), baeminKey(rawId)].filter(Boolean);
      let found = [];
      keys.forEach((key) => {
        const list = index.get(key) || [];
        list.forEach((driver) => {
          if (seen.has(driver.id)) return;
          seen.add(driver.id);
          found.push(driver);
        });
      });
      if (found.length) {
        found.forEach((driver) => matched.push({ driver, rawId }));
      } else {
        unmatched.push(rawId);
      }
    });
    return { matched, unmatched: [...new Set(unmatched)] };
  }

  function applyLockFilter(drivers) {
    if (state.lockFilter === 'locked') return drivers.filter(isLocked);
    if (state.lockFilter === 'unlocked') return drivers.filter((driver) => !isLocked(driver));
    return drivers;
  }

  function missionSelectHtml(id, platform, placeholder) {
    const items = catalog().getForPlatform(platform) || [];
    const options = [
      `<option value="">${escapeHtml(placeholder)}</option>`,
      `<option value="${CLEAR}">미배정으로 비우기</option>`,
      ...items.map((item) => {
        const inactive = item.isActive === false ? ' (중지)' : '';
        return `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}${inactive}</option>`;
      })
    ];
    return `<select id="${id}" class="inline-select">${options.join('')}</select>`;
  }

  function fillMissionSelects() {
    const fill = (id, platform, placeholder) => {
      const el = $(id);
      if (!el) return;
      const current = el.value;
      el.outerHTML = missionSelectHtml(id, platform, placeholder);
      const next = $(id);
      if (next && [...next.options].some((option) => option.value === current)) {
        next.value = current;
      }
    };
    fill('missionBulkBaemin', 'baemin', '배민 미션 · 변경 안 함');
    fill('missionBulkCoupang', 'coupang', '쿠팡 미션 · 변경 안 함');
    fill('missionBulkCombined', 'combined', '합산 미션 · 변경 안 함');
  }

  function fillRegionSelect() {
    const select = $('missionBulkRegion');
    if (!select) return;
    const list = regionList();
    const current = state.regionKey;
    select.innerHTML = ['<option value="">지역 선택</option>']
      .concat(list.map((region) => `<option value="${escapeHtml(region.key)}">${escapeHtml(region.label)}${region.partnerId ? ` (${escapeHtml(region.partnerId)})` : ''}</option>`))
      .join('');
    if (list.some((item) => item.key === current)) select.value = current;
    else {
      select.value = '';
      state.regionKey = '';
    }
  }

  async function fetchRegions() {
    const token = await window.BremStorage?.resolveAdminAccessToken?.();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const res = await fetch('/api/admin/baemin-delivery/partner-regions', { headers, credentials: 'same-origin' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '배민 지역을 불러오지 못했습니다.');
      state.baeminRegions = (payload.allItems || payload.items || []).map((item) => ({
        key: String(item.partnerId || '').trim(),
        partnerId: String(item.partnerId || '').trim(),
        label: String(item.regionName || '').trim(),
        platform: 'baemin'
      })).filter((item) => item.key && item.label);
    } catch (error) {
      console.warn('[BREM] mission assignment baemin regions:', error);
      state.baeminRegions = [];
    }
    try {
      const res = await fetch('/api/admin/coupang/vendor-regions', { headers, credentials: 'same-origin' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '쿠팡 지역을 불러오지 못했습니다.');
      const seen = new Set();
      state.coupangRegions = (payload.allItems || payload.items || []).map((item) => {
        const vendorId = String(item.vendorId || '').trim();
        const vendorName = String(item.vendorName || '').trim();
        if (!vendorId || seen.has(vendorId)) return null;
        seen.add(vendorId);
        return {
          key: vendorId,
          vendorId,
          vendorName,
          label: shortCoupangRegion(vendorName) || vendorId,
          platform: 'coupang'
        };
      }).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
    } catch (error) {
      console.warn('[BREM] mission assignment coupang regions:', error);
      state.coupangRegions = [];
    }
    fillRegionSelect();
  }

  function setSource(source) {
    state.source = source === 'paste' ? 'paste' : 'region';
    const regionBox = $('missionBulkRegionBox');
    const pasteBox = $('missionBulkPasteBox');
    if (regionBox) regionBox.hidden = state.source !== 'region';
    if (pasteBox) pasteBox.hidden = state.source !== 'paste';
    $$('.mission-bulk-source-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.missionBulkSource === state.source);
    });
  }

  function $$(selector) {
    return [...document.querySelectorAll(selector)];
  }

  function selectedDrivers() {
    return state.preview
      .map((row) => row.driver)
      .filter((driver) => state.selected.has(driver.id));
  }

  function updateSummary() {
    const el = $('missionBulkSummary');
    if (!el) return;
    const locked = state.preview.filter((row) => isLocked(row.driver)).length;
    const selected = selectedDrivers();
    const selectedLocked = selected.filter(isLocked).length;
    const applyCount = selected.length - selectedLocked;
    el.textContent = state.preview.length
      ? `검색 ${state.preview.length}명 · 선택 ${selected.length}명 · 적용 대상 ${applyCount}명 · 잠금 ${locked}명`
        + (state.unmatched.length ? ` · 미매칭 ${state.unmatched.length}건` : '')
      : '지역을 고르거나 엑셀 1열 ID를 붙여넣은 뒤 검색하세요.';
  }

  function renderUnmatched() {
    const box = $('missionBulkUnmatchedBox');
    const rowsEl = $('missionBulkUnmatchedRows');
    if (!box || !rowsEl) return;
    if (!state.unmatched.length) {
      box.hidden = true;
      rowsEl.innerHTML = '';
      return;
    }
    box.hidden = false;
    rowsEl.innerHTML = state.unmatched.map((id) => (
      `<tr><td><code>${escapeHtml(id)}</code></td><td class="promotion-status-no">ERP에서 배민ID/쿠팡ID를 찾지 못했습니다</td></tr>`
    )).join('');
  }

  function renderPreview() {
    const rowsEl = $('missionBulkRows');
    if (!rowsEl) return;
    if (!state.preview.length) {
      rowsEl.innerHTML = '<tr><td colspan="8" class="empty">검색된 기사가 없습니다.</td></tr>';
      updateSummary();
      renderUnmatched();
      return;
    }
    rowsEl.innerHTML = state.preview.map((row) => {
      const driver = row.driver;
      const locked = isLocked(driver);
      const checked = state.selected.has(driver.id) ? ' checked' : '';
      return `<tr data-bulk-driver-id="${escapeHtml(driver.id)}" class="${locked ? 'is-mission-locked' : ''}">
        <td><input type="checkbox" data-bulk-select="${escapeHtml(driver.id)}"${checked}${locked ? ' title="잠금된 기사는 일괄 적용에서 빠집니다"' : ''}></td>
        <td>
          <strong>${escapeHtml(driver.name || '-')}</strong>
          ${locked ? ' <span class="mission-lock-tag">잠금</span>' : ''}
        </td>
        <td><code>${escapeHtml(erpIdOf(driver) || '-')}</code></td>
        <td><code>${escapeHtml(driver.baeminId || '-')}</code></td>
        <td><code>${escapeHtml(coupangIdOf(driver) || '-')}</code></td>
        <td>${escapeHtml(assignmentLabel(driver))}</td>
        <td>${escapeHtml(row.rawId || selectedRegion()?.label || '-')}</td>
        <td>
          <button type="button" class="small-btn ${locked ? 'primary-btn' : ''}" data-bulk-lock="${escapeHtml(driver.id)}">
            ${locked ? '잠금 해제' : '잠금'}
          </button>
        </td>
      </tr>`;
    }).join('');
    const all = $('missionBulkSelectAll');
    if (all) {
      const unlocked = state.preview.filter((row) => !isLocked(row.driver));
      all.checked = unlocked.length > 0 && unlocked.every((row) => state.selected.has(row.driver.id));
    }
    updateSummary();
    renderUnmatched();
  }

  function setPreview(drivers, unmatched = [], rawIdByDriver = new Map()) {
    state.pool = drivers.slice();
    const rows = applyLockFilter(drivers)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'))
      .map((driver) => ({ driver, rawId: rawIdByDriver.get(driver.id) || '' }));
    state.preview = rows;
    state.unmatched = unmatched;
    state.selected = new Set(rows.filter((row) => !isLocked(row.driver)).map((row) => row.driver.id));
    renderPreview();
  }

  function refreshFilteredPreview() {
    const rawIdByDriver = new Map(state.preview.map((row) => [row.driver.id, row.rawId]));
    state.pool.forEach((driver) => {
      if (!rawIdByDriver.has(driver.id)) rawIdByDriver.set(driver.id, '');
    });
    const rows = applyLockFilter(state.pool)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'))
      .map((driver) => ({
        driver: BremStorage.drivers.getById(driver.id) || driver,
        rawId: rawIdByDriver.get(driver.id) || ''
      }));
    state.preview = rows;
    state.selected = new Set(rows.filter((row) => !isLocked(row.driver)).map((row) => row.driver.id));
    renderPreview();
  }

  function loadRegionPreview() {
    const region = selectedRegion();
    if (!region) {
      setPreview([]);
      showToast('지역을 선택하세요.');
      return;
    }
    setPreview(driversMatchingRegion(region));
  }

  async function searchPaste() {
    const ids = firstColumnIds($('missionBulkPaste')?.value || '');
    if (!ids.length) {
      showToast('엑셀에서 배민ID 또는 쿠팡ID 1열을 붙여넣으세요.');
      return;
    }
    try {
      await BremStorage.awaitDriversFullyLoaded?.();
    } catch (error) {
      console.warn('[BREM] mission assignment paste wait:', error?.message || error);
    }
    const { matched, unmatched } = matchDriversByIds(ids);
    const rawIdByDriver = new Map(matched.map((row) => [row.driver.id, row.rawId]));
    setPreview(matched.map((row) => row.driver), unmatched, rawIdByDriver);
    showToast(`${matched.length}명 검색 · 미매칭 ${unmatched.length}건`);
  }

  function nextAssignment(driver, picks) {
    const current = catalog().getDriverAssignment(driver);
    const pick = (value, fallback) => {
      if (value === CLEAR) return '';
      if (value) return value;
      return fallback;
    };
    return catalog().normalizeAssignmentDraft({
      baemin: pick(picks.baemin, current.baemin),
      coupang: pick(picks.coupang, current.coupang),
      combined: pick(picks.combined, current.combined)
    });
  }

  async function applyBulk() {
    const picks = {
      baemin: $('missionBulkBaemin')?.value || '',
      coupang: $('missionBulkCoupang')?.value || '',
      combined: $('missionBulkCombined')?.value || ''
    };
    if (!picks.baemin && !picks.coupang && !picks.combined) {
      showToast('바꿀 미션을 하나 이상 선택하세요.');
      return;
    }
    const targets = selectedDrivers();
    const locked = targets.filter(isLocked);
    const unlocked = targets.filter((driver) => !isLocked(driver));
    if (!unlocked.length) {
      showToast(locked.length ? '선택한 기사가 모두 잠겨 있습니다.' : '적용할 기사를 선택하세요.');
      return;
    }
    if (state.busy) return;
    state.busy = true;
    const btn = $('missionBulkApplyBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '적용 중…';
    }
    try {
      const patches = unlocked.map((driver) => ({
        id: driver.id,
        changes: catalog().buildAssignmentPatch(nextAssignment(driver, picks))
      }));
      const result = await BremStorage.drivers.batchPatch(patches);
      if (result?.warning) showToast(result.warning);
      else {
        showToast(`${patches.length}명 미션을 일괄 배정했습니다.`
          + (locked.length ? ` 잠금 ${locked.length}명은 건너뛰었습니다.` : ''));
      }
      state.preview = state.preview.map((row) => ({
        ...row,
        driver: BremStorage.drivers.getById(row.driver.id) || row.driver
      }));
      renderPreview();
    } catch (error) {
      showToast(error.message || '일괄 배정에 실패했습니다.');
    } finally {
      state.busy = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = '선택 기사 일괄 적용';
      }
    }
  }

  async function toggleLock(driverId) {
    const driver = BremStorage.drivers.getById(driverId);
    if (!driver) return;
    const next = !isLocked(driver);
    try {
      await BremStorage.drivers.batchPatch([{
        id: driverId,
        changes: { missionAssignmentLocked: next }
      }]);
      state.preview = state.preview.map((row) => (
        row.driver.id === driverId
          ? { ...row, driver: BremStorage.drivers.getById(driverId) || { ...row.driver, missionAssignmentLocked: next } }
          : row
      ));
      if (next) state.selected.delete(driverId);
      else state.selected.add(driverId);
      renderPreview();
      showToast(next ? `${driver.name} 미션을 잠갔습니다.` : `${driver.name} 잠금을 해제했습니다.`);
    } catch (error) {
      showToast(error.message || '잠금 저장에 실패했습니다.');
    }
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    $$('.mission-bulk-source-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        setSource(btn.dataset.missionBulkSource);
      });
    });

    $('missionBulkPlatform')?.addEventListener('change', (event) => {
      state.platform = event.target.value === 'coupang' ? 'coupang' : 'baemin';
      state.regionKey = '';
      fillRegionSelect();
    });

    $('missionBulkRegion')?.addEventListener('change', (event) => {
      state.regionKey = event.target.value || '';
    });

    $('missionBulkLockFilter')?.addEventListener('change', (event) => {
      state.lockFilter = event.target.value || 'all';
      refreshFilteredPreview();
    });

    $('missionBulkRegionSearchBtn')?.addEventListener('click', () => {
      loadRegionPreview();
    });

    $('missionBulkPasteSearchBtn')?.addEventListener('click', () => {
      void searchPaste();
    });

    $('missionBulkApplyBtn')?.addEventListener('click', () => {
      void applyBulk();
    });

    $('missionBulkSelectAll')?.addEventListener('change', (event) => {
      const checked = event.target.checked;
      state.preview.forEach((row) => {
        if (isLocked(row.driver)) return;
        if (checked) state.selected.add(row.driver.id);
        else state.selected.delete(row.driver.id);
      });
      renderPreview();
    });

    $('missionBulkRows')?.addEventListener('change', (event) => {
      const input = event.target.closest('[data-bulk-select]');
      if (!input) return;
      const id = input.dataset.bulkSelect;
      if (input.checked) state.selected.add(id);
      else state.selected.delete(id);
      updateSummary();
    });

    $('missionBulkRows')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-bulk-lock]');
      if (!btn) return;
      void toggleLock(btn.dataset.bulkLock);
    });
  }

  function render() {
    fillMissionSelects();
    fillRegionSelect();
    setSource(state.source);
    renderPreview();
  }

  async function refresh() {
    bindEvents();
    try {
      await BremStorage.ensureSectionLoaded?.('mission-assignment', { force: false, forceDrivers: false });
    } catch (error) {
      console.warn('[BREM] mission assignment refresh:', error?.message || error);
    }
    await fetchRegions();
    render();
    if (state.source === 'region' && state.regionKey) loadRegionPreview();
  }

  window.BremAdminMissionAssignment = { refresh, render };
})();
