(function () {
  const section = document.getElementById('rider-push');
  if (!section) return;

  const form = document.getElementById('riderPushForm');
  const titleEl = document.getElementById('riderPushTitle');
  const bodyEl = document.getElementById('riderPushBody');
  const listEl = document.getElementById('riderPushList');
  const emptyEl = document.getElementById('riderPushEmpty');
  const sendBtn = document.getElementById('riderPushSendBtn');
  const regionListEl = document.getElementById('riderPushRegionList');
  const riderListEl = document.getElementById('riderPushRiderList');
  const riderCountEl = document.getElementById('riderPushRiderCount');
  const regionTitleEl = document.getElementById('riderPushRegionTitle');
  const checkAllEl = document.getElementById('riderPushRiderCheckAll');
  const searchEl = document.getElementById('riderPushRiderSearch');

  const state = {
    logs: [],
    loading: false,
    baeminRegions: [],
    coupangRegions: [],
    selectedRegionKey: '',
    selectedRegionPlatform: '',
    selectedRiders: new Map(),
    riderSearch: ''
  };

  function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function shortCoupangRegion(name) {
    const helper = window.BremDriverManagementAdmin?.shortCoupangRegion;
    if (typeof helper === 'function') return helper(name);
    let raw = String(name || '').replace(/\s+/g, '').trim();
    if (!raw) return '';
    raw = raw.replace(/\(\d+\)$/g, '');
    const hangul = raw.replace(/[^가-힣]/g, '');
    const base = hangul || raw;
    if (!base) return '';
    return base.length <= 4 ? base : base.slice(-4);
  }

  function selectedPlatform() {
    return section.querySelector('input[name="riderPushPlatform"]:checked')?.value || '';
  }

  function riderKey(platform, riderId) {
    return `${platform}:${riderId}`;
  }

  function allDrivers() {
    if (typeof window.BremStorage?.drivers?.getAllKnownById === 'function') {
      return window.BremStorage.drivers.getAllKnownById() || [];
    }
    return window.BremStorage?.drivers?.getAll?.() || [];
  }

  function driverRegionValue(driver, platform) {
    return platform === 'coupang'
      ? String(driver?.regionCoupang || '').trim()
      : String(driver?.regionBaemin || '').trim();
  }

  function driversInRegion(region) {
    if (!region) return [];
    return allDrivers().filter((driver) => {
      const value = driverRegionValue(driver, region.platform);
      if (!value) return false;
      if (region.platform === 'baemin') {
        return value === region.label
          || value === region.partnerId
          || value === region.key
          || (region.partnerId && region.partnerId.length >= 6 && value.includes(region.partnerId));
      }
      return shortCoupangRegion(value) === region.key
        || shortCoupangRegion(value) === shortCoupangRegion(region.label)
        || value === region.vendorName
        || value === region.vendorId;
    }).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
  }

  function visibleRegions() {
    const platform = selectedPlatform();
    if (platform === 'baemin') return state.baeminRegions;
    if (platform === 'coupang') return state.coupangRegions;
    return [];
  }

  function selectedRegion() {
    return visibleRegions().find(item => (
      item.key === state.selectedRegionKey && item.platform === state.selectedRegionPlatform
    )) || null;
  }

  function selectedRiderPayloads() {
    return [...state.selectedRiders.values()];
  }

  function updateRiderCount() {
    if (riderCountEl) riderCountEl.textContent = `${state.selectedRiders.size}명 선택`;
    const chips = document.getElementById('riderPushSelectedChips');
    if (!chips) return;
    const riders = selectedRiderPayloads();
    chips.hidden = riders.length === 0;
    chips.innerHTML = riders.map((item) => (
      `<span>${escapeHtml(item.riderName || '-')}<small>${escapeHtml(item.regionLabel || '')}</small></span>`
    )).join('');
  }

  function renderRegionList() {
    if (!regionListEl) return;
    const regions = visibleRegions();
    if (!selectedPlatform()) {
      regionListEl.innerHTML = '<p class="form-help">배민/쿠팡 태그를 먼저 선택하세요.</p>';
      if (riderListEl) riderListEl.innerHTML = '';
      if (regionTitleEl) regionTitleEl.textContent = '지역을 선택하세요';
      return;
    }
    if (!regions.length) {
      regionListEl.innerHTML = '<p class="form-help">지역 목록을 불러오는 중이거나, 등록된 지역이 없습니다.</p>';
      return;
    }
    if (!selectedRegion() && regions[0]) {
      state.selectedRegionKey = regions[0].key;
      state.selectedRegionPlatform = regions[0].platform;
    }
    regionListEl.innerHTML = regions.map((region) => {
      const count = driversInRegion(region).length;
      const active = region.key === state.selectedRegionKey && region.platform === state.selectedRegionPlatform;
      const tag = region.platform === 'baemin' ? '배민' : '쿠팡';
      return `
        <button type="button" class="urgent-mission-region-item${active ? ' is-active' : ''}" data-rp-region="${escapeHtml(region.key)}" data-rp-platform="${escapeHtml(region.platform)}">
          <span>${escapeHtml(region.label || region.key)} <small>${tag}</small></span>
          <strong>${count}명</strong>
        </button>
      `;
    }).join('');
    renderRiderList();
  }

  function renderRiderList() {
    if (!riderListEl) return;
    const region = selectedRegion();
    if (!region) {
      riderListEl.innerHTML = '<p class="form-help">지역을 선택하세요.</p>';
      if (regionTitleEl) regionTitleEl.textContent = '지역을 선택하세요';
      if (checkAllEl) checkAllEl.checked = false;
      return;
    }
    if (regionTitleEl) {
      regionTitleEl.textContent = `${region.label || region.key} · ${region.platform === 'baemin' ? '배민' : '쿠팡'}`;
    }
    const search = String(state.riderSearch || '').replace(/\s+/g, '').toLowerCase();
    const drivers = driversInRegion(region).filter((driver) => {
      if (!search) return true;
      const hay = [driver.name, driver.phone, driver.baeminId]
        .map(value => String(value || '').replace(/\s+/g, '').toLowerCase())
        .join('|');
      return hay.includes(search);
    });
    if (!drivers.length) {
      riderListEl.innerHTML = `<p class="form-help">${search ? '검색 결과가 없습니다.' : '이 지역에 배정된 기사가 없습니다.'}</p>`;
      if (checkAllEl) checkAllEl.checked = false;
      return;
    }
    riderListEl.innerHTML = drivers.map((driver) => {
      const key = riderKey(region.platform, driver.id);
      const checked = state.selectedRiders.has(key);
      return `
        <label class="urgent-mission-rider-item">
          <input type="checkbox" data-rp-rider="${escapeHtml(driver.id)}" data-rp-platform="${escapeHtml(region.platform)}" ${checked ? 'checked' : ''}>
          <span>${escapeHtml(driver.name || '-')}</span>
          <small>${escapeHtml(driver.phone || '')}</small>
        </label>
      `;
    }).join('');
    if (checkAllEl) {
      checkAllEl.checked = drivers.every(driver => state.selectedRiders.has(riderKey(region.platform, driver.id)));
    }
    updateRiderCount();
  }

  function toggleRider(driver, region, on) {
    const key = riderKey(region.platform, driver.id);
    if (on) {
      state.selectedRiders.set(key, {
        riderId: driver.id,
        riderName: driver.name || '',
        riderPhone: driver.phone || '',
        regionKey: region.key,
        regionLabel: region.label || region.key,
        platform: region.platform
      });
    } else {
      state.selectedRiders.delete(key);
    }
    updateRiderCount();
  }

  async function fetchRegions(platform) {
    const token = await window.BremStorage?.resolveAdminAccessToken?.();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (platform === 'baemin') {
      const res = await fetch('/api/admin/baemin-delivery/partner-regions', { headers, credentials: 'same-origin' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '배민 지역을 불러오지 못했습니다.');
      return (payload.allItems || payload.items || []).map(item => ({
        key: String(item.partnerId || '').trim(),
        partnerId: String(item.partnerId || '').trim(),
        label: String(item.regionName || '').trim(),
        platform: 'baemin'
      })).filter(item => item.key && item.label);
    }
    const res = await fetch('/api/admin/coupang/vendor-regions', { headers, credentials: 'same-origin' });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || '쿠팡 지역을 불러오지 못했습니다.');
    const byShort = new Map();
    (payload.allItems || payload.items || []).forEach((item) => {
      const vendorId = String(item.vendorId || '').trim();
      const vendorName = String(item.vendorName || '').trim();
      const short = shortCoupangRegion(vendorName);
      if (!vendorId || !short) return;
      if (!byShort.has(short)) {
        byShort.set(short, {
          key: short,
          vendorId,
          vendorName,
          label: short,
          platform: 'coupang'
        });
      }
    });
    return [...byShort.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  }

  async function loadRegions() {
    try {
      const [baemin, coupang] = await Promise.all([
        fetchRegions('baemin').catch(() => []),
        fetchRegions('coupang').catch(() => [])
      ]);
      state.baeminRegions = baemin;
      state.coupangRegions = coupang;
    } catch (error) {
      console.warn('[BREM] rider push regions:', error);
    }
    renderRegionList();
  }

  function pushNote(push) {
    if (!push) return '';
    if (push.skipped) return '서버키/토큰 확인';
    const sent = Number(push.sent || 0);
    const missing = Number(push.missing || 0);
    const failed = Number(push.failed || 0);
    const parts = [`앱알림 ${sent}건`];
    if (missing) parts.push(`앱미실행 ${missing}명`);
    if (failed) parts.push(`실패 ${failed}건`);
    return parts.join(' · ');
  }

  function render() {
    if (!listEl) return;
    if (!state.logs.length) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.innerHTML = state.logs.map((item) => {
      const riders = item.riders || [];
      const names = riders.slice(0, 8).map(rider => rider.riderName || '-').join(', ');
      const more = riders.length > 8 ? ` 외 ${riders.length - 8}명` : '';
      return `
        <article class="urgent-mission-card">
          <div class="urgent-mission-card__top">
            <div class="urgent-mission-card__title-row">
              <label class="check-label">
                <input type="checkbox" data-rp-log="${escapeHtml(item.id)}" value="${escapeHtml(item.id)}">
              </label>
              <strong>${escapeHtml(item.title || 'BREM')}</strong>
              <span class="urgent-mission-status is-open">${escapeHtml(pushNote(item.push) || '전송')}</span>
            </div>
            <p class="urgent-mission-card__content">${escapeHtml(item.body)}</p>
            <div class="urgent-mission-card__meta">
              <span>${escapeHtml(formatDateTime(item.sentAt))}</span>
              <span>대상 ${riders.length}명</span>
              ${item.sentBy ? `<span>${escapeHtml(item.sentBy)}</span>` : ''}
            </div>
            <p class="form-help">${escapeHtml(names)}${escapeHtml(more)}</p>
          </div>
        </article>
      `;
    }).join('');
    const checkAll = document.getElementById('riderPushLogCheckAll');
    if (checkAll) checkAll.checked = false;
  }

  function selectedLogIds() {
    return Array.from(section.querySelectorAll('[data-rp-log]:checked')).map(input => input.value || input.dataset.rpLog);
  }

  async function deleteLogs(payload, confirmText) {
    if (!window.BremStorage?.deleteAdminRiderPushLogs) return;
    if (!window.confirm(confirmText)) return;
    const result = await window.BremStorage.deleteAdminRiderPushLogs(payload);
    if (!result.ok) {
      showToast(result.message || result.error || '기록 삭제에 실패했습니다.');
      return;
    }
    state.logs = result.logs || [];
    render();
    showToast('전송 기록을 삭제했습니다.');
  }

  async function load() {
    if (!window.BremStorage?.fetchAdminRiderPushLogsFromServer) return;
    state.loading = true;
    try {
      await window.BremStorage.ensureSectionLoaded?.('rider-push');
    } catch {
      // ignore
    }
    const result = await window.BremStorage.fetchAdminRiderPushLogsFromServer();
    state.loading = false;
    if (!result.ok) {
      showToast(result.message || result.error || '앱푸쉬 기록을 불러오지 못했습니다.');
      return;
    }
    state.logs = result.logs || [];
    render();
    void loadRegions();
  }

  async function send(event) {
    event.preventDefault();
    if (!window.BremStorage?.sendAdminRiderPush) return;
    const title = String(titleEl?.value || '').trim();
    const body = String(bodyEl?.value || '').trim();
    const riders = selectedRiderPayloads();
    if (!body) {
      showToast('푸시 내용을 입력하세요.');
      return;
    }
    if (!riders.length) {
      showToast('보낼 대상 기사를 선택하세요.');
      return;
    }
    if (!window.confirm(`선택한 ${riders.length}명에게 앱 알림을 보낼까요?`)) return;
    if (sendBtn) sendBtn.disabled = true;
    const result = await window.BremStorage.sendAdminRiderPush({ title, body, riders });
    if (sendBtn) sendBtn.disabled = false;
    if (!result.ok) {
      showToast(result.message || result.error || '앱푸쉬 전송에 실패했습니다.');
      return;
    }
    if (bodyEl) bodyEl.value = '';
    state.logs = result.logs || [];
    render();
    const note = pushNote(result.push);
    showToast(note ? `앱푸쉬를 보냈습니다. ${note}` : '앱푸쉬를 보냈습니다.');
  }

  document.getElementById('riderPushRefreshBtn')?.addEventListener('click', () => {
    void load();
  });

  document.getElementById('riderPushDeleteSelectedBtn')?.addEventListener('click', () => {
    const ids = selectedLogIds();
    if (!ids.length) {
      showToast('삭제할 기록을 선택하세요.');
      return;
    }
    void deleteLogs({ ids }, `선택한 ${ids.length}건을 삭제할까요?`);
  });

  document.getElementById('riderPushDeleteAllBtn')?.addEventListener('click', () => {
    if (!state.logs.length) {
      showToast('삭제할 기록이 없습니다.');
      return;
    }
    void deleteLogs({ all: true }, `전송 기록 ${state.logs.length}건을 모두 삭제할까요?`);
  });

  document.getElementById('riderPushLogCheckAll')?.addEventListener('change', (event) => {
    const on = Boolean(event.target?.checked);
    section.querySelectorAll('[data-rp-log]').forEach((input) => {
      input.checked = on;
    });
  });

  form?.addEventListener('submit', send);

  section.addEventListener('click', (event) => {
    const regionBtn = event.target.closest('[data-rp-region]');
    if (!regionBtn) return;
    state.selectedRegionKey = regionBtn.dataset.rpRegion;
    state.selectedRegionPlatform = regionBtn.dataset.rpPlatform;
    renderRegionList();
  });

  section.addEventListener('change', (event) => {
    if (event.target?.name === 'riderPushPlatform') {
      state.selectedRiders = new Map();
      state.selectedRegionKey = '';
      state.selectedRegionPlatform = event.target.value || '';
      updateRiderCount();
      renderRegionList();
      return;
    }
    if (event.target?.id === 'riderPushRiderCheckAll') {
      const region = selectedRegion();
      if (!region) return;
      const on = event.target.checked;
      driversInRegion(region).forEach(driver => toggleRider(driver, region, on));
      renderRiderList();
      return;
    }
    const riderBox = event.target.closest('[data-rp-rider]');
    if (riderBox) {
      const region = selectedRegion();
      const driver = allDrivers().find(item => item.id === riderBox.dataset.rpRider);
      if (region && driver) toggleRider(driver, region, riderBox.checked);
      if (checkAllEl && region) {
        checkAllEl.checked = driversInRegion(region).every(item => state.selectedRiders.has(riderKey(region.platform, item.id)));
      }
      updateRiderCount();
    }
  });

  searchEl?.addEventListener('input', () => {
    state.riderSearch = searchEl.value;
    renderRiderList();
  });

  window.BremAdminRiderPush = {
    refresh: load
  };
})();
