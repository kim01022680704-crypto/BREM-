(function () {
  const section = document.getElementById('urgent-missions');
  if (!section) return;

  const form = document.getElementById('urgentMissionForm');
  const contentEl = document.getElementById('urgentMissionContent');
  const amountEl = document.getElementById('urgentMissionAmount');
  const timeEl = document.getElementById('urgentMissionTime');
  const listEl = document.getElementById('urgentMissionList');
  const emptyEl = document.getElementById('urgentMissionEmpty');
  const publishBtn = document.getElementById('urgentMissionPublishBtn');
  const regionListEl = document.getElementById('urgentMissionRegionList');
  const riderListEl = document.getElementById('urgentMissionRiderList');
  const riderCountEl = document.getElementById('urgentMissionRiderCount');
  const regionTitleEl = document.getElementById('urgentMissionRegionTitle');
  const checkAllEl = document.getElementById('urgentMissionRiderCheckAll');
  const searchEl = document.getElementById('urgentMissionRiderSearch');

  const state = {
    missions: [],
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
    showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMoney(value) {
    return `${Number(value || 0).toLocaleString('ko-KR')}원`;
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

  function selectedPlatforms() {
    return Array.from(section.querySelectorAll('input[name="urgentMissionPlatform"]:checked'))
      .map(input => input.value);
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
    const platforms = new Set(selectedPlatforms());
    const list = [];
    if (platforms.has('baemin')) list.push(...state.baeminRegions);
    if (platforms.has('coupang')) list.push(...state.coupangRegions);
    return list;
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
  }

  function renderRegionList() {
    if (!regionListEl) return;
    const regions = visibleRegions();
    if (!selectedPlatforms().length) {
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
        <button type="button" class="urgent-mission-region-item${active ? ' is-active' : ''}" data-um-region="${escapeHtml(region.key)}" data-um-platform="${escapeHtml(region.platform)}">
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
          <input type="checkbox" data-um-rider="${escapeHtml(driver.id)}" data-um-platform="${escapeHtml(region.platform)}" ${checked ? 'checked' : ''}>
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
      console.warn('[BREM] urgent mission regions:', error);
    }
    renderRegionList();
  }

  function platformTags(platforms) {
    return (platforms || []).map((platform) => (
      platform === 'baemin'
        ? '<span class="urgent-mission-tag urgent-mission-tag--baemin">배민</span>'
        : '<span class="urgent-mission-tag urgent-mission-tag--coupang">쿠팡</span>'
    )).join('');
  }

  function selectedAcceptIds(missionId) {
    return Array.from(section.querySelectorAll(`[data-accept-mission="${missionId}"]:checked`))
      .map(input => input.value);
  }

  function renderTargets(mission) {
    const targets = mission.targets || [];
    if (!targets.length) {
      return '<p class="form-help">대상 기사가 없습니다.</p>';
    }
    return `
      <ul class="urgent-mission-target-list">
        ${targets.map((item) => `
          <li>
            <span>${escapeHtml(item.riderName || '-')}${item.regionLabel ? ` · ${escapeHtml(item.regionLabel)}` : ''}${item.platform === 'baemin' ? ' · 배민' : item.platform === 'coupang' ? ' · 쿠팡' : ''}</span>
            <button type="button" class="small-btn" data-remove-target="${escapeHtml(mission.id)}" data-remove-rider="${escapeHtml(item.riderId)}">제외</button>
          </li>
        `).join('')}
      </ul>
    `;
  }

  function renderAccepts(mission) {
    const accepts = mission.accepts || [];
    if (!accepts.length) {
      return '<p class="form-help">아직 수락한 기사가 없습니다.</p>';
    }
    const rows = accepts.map((item) => `
      <tr>
        <td>
          <input type="checkbox" data-accept-mission="${escapeHtml(mission.id)}" value="${escapeHtml(item.id)}">
        </td>
        <td>${escapeHtml(item.riderName || '-')}</td>
        <td>${escapeHtml(item.riderPhone || '-')}</td>
        <td>${escapeHtml(formatDateTime(item.acceptedAt))}</td>
        <td>${item.setupDone ? '<span class="urgent-mission-status is-done">설정완료</span>' : '<span class="urgent-mission-status">수락</span>'}</td>
      </tr>
    `).join('');
    return `
      <div class="urgent-mission-accept-toolbar">
        <label class="check-label">
          <input type="checkbox" data-accept-all="${escapeHtml(mission.id)}">
          전체선택
        </label>
        <button type="button" class="primary-btn" data-setup-done="${escapeHtml(mission.id)}">미션설정완료</button>
      </div>
      <div class="table-wrap">
        <table class="data-table urgent-mission-accept-table">
          <thead>
            <tr>
              <th></th>
              <th>기사</th>
              <th>연락처</th>
              <th>수락시각</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function render() {
    if (!listEl) return;
    if (!state.missions.length) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.innerHTML = state.missions.map((mission) => {
      const closed = mission.status === 'closed';
      return `
        <article class="urgent-mission-card ${closed ? 'is-closed' : ''}" data-mission-id="${escapeHtml(mission.id)}">
          <div class="urgent-mission-card__head">
            <div class="urgent-mission-card__tags">
              ${platformTags(mission.platforms)}
              <span class="urgent-mission-status ${closed ? 'is-closed' : 'is-open'}">${closed ? '마감' : '모집중'}</span>
            </div>
            <div class="urgent-mission-card__meta">
              <strong>${escapeHtml(formatMoney(mission.amount))}</strong>
              <span>${escapeHtml(mission.missionTime || '-')}</span>
              <span>배포 ${escapeHtml(formatDateTime(mission.publishedAt))}</span>
            </div>
          </div>
          <p class="urgent-mission-card__content">${escapeHtml(mission.content)}</p>
          <div class="urgent-mission-card__actions">
            <button type="button" class="small-btn" data-close-mission="${escapeHtml(mission.id)}" ${closed ? 'disabled' : ''}>미션 마감</button>
            <button type="button" class="small-btn danger-btn" data-delete-mission="${escapeHtml(mission.id)}">정리</button>
          </div>
          <h3 class="urgent-mission-accept-title">대상 기사 <span>${(mission.targets || []).length}명</span></h3>
          ${renderTargets(mission)}
          <h3 class="urgent-mission-accept-title">수락 리스트 <span>${(mission.accepts || []).length}명</span></h3>
          ${renderAccepts(mission)}
        </article>
      `;
    }).join('');
  }

  function resetPicker() {
    state.selectedRiders = new Map();
    state.riderSearch = '';
    if (searchEl) searchEl.value = '';
    updateRiderCount();
    renderRegionList();
  }

  async function load() {
    if (!window.BremStorage?.fetchAdminUrgentMissionsFromServer) return;
    state.loading = true;
    try {
      await window.BremStorage.ensureSectionLoaded?.('urgent-missions');
    } catch {
      // ignore
    }
    const result = await window.BremStorage.fetchAdminUrgentMissionsFromServer();
    state.loading = false;
    if (!result.ok) {
      showToast(result.message || result.error || '긴급미션을 불러오지 못했습니다.');
      return;
    }
    state.missions = result.missions || [];
    render();
    void loadRegions();
  }

  async function publish(event) {
    event.preventDefault();
    if (!window.BremStorage?.publishAdminUrgentMission) return;
    const content = String(contentEl?.value || '').trim();
    const amount = Number(amountEl?.value || 0);
    const missionTime = String(timeEl?.value || '').trim();
    const platforms = selectedPlatforms();
    const riders = selectedRiderPayloads();
    if (!content || !amount || !missionTime || !platforms.length) {
      showToast('내용, 금액, 시간, 쿠팡/배민 태그를 모두 입력하세요.');
      return;
    }
    if (!riders.length) {
      showToast('배포할 대상 기사를 선택하세요.');
      return;
    }
    if (publishBtn) publishBtn.disabled = true;
    const result = await window.BremStorage.publishAdminUrgentMission({
      content,
      amount,
      missionTime,
      platforms,
      riders
    });
    if (publishBtn) publishBtn.disabled = false;
    if (!result.ok) {
      showToast(result.message || result.error || '배포에 실패했습니다.');
      return;
    }
    form?.reset();
    resetPicker();
    state.missions = result.missions || [];
    render();
    showToast(`긴급미션을 배포했습니다. 대상 ${riders.length}명`);
  }

  async function closeMission(missionId) {
    if (!window.confirm('이 미션을 마감할까요? 이후 수락은 할 수 없습니다.')) return;
    const result = await window.BremStorage.closeAdminUrgentMission(missionId);
    if (!result.ok) {
      showToast(result.message || result.error || '마감에 실패했습니다.');
      return;
    }
    state.missions = result.missions || [];
    render();
    showToast('미션을 마감했습니다.');
  }

  async function setupDone(missionId) {
    const acceptIds = selectedAcceptIds(missionId);
    if (!acceptIds.length) {
      showToast('설정완료할 기사를 선택하세요.');
      return;
    }
    const result = await window.BremStorage.setupDoneAdminUrgentMission(missionId, acceptIds);
    if (!result.ok) {
      showToast(result.message || result.error || '설정완료 처리에 실패했습니다.');
      return;
    }
    state.missions = result.missions || [];
    render();
    showToast('선택한 기사를 미션설정완료 했습니다.');
  }

  async function removeTarget(missionId, riderId) {
    const result = await window.BremStorage.removeAdminUrgentMissionTargets(missionId, [riderId]);
    if (!result.ok) {
      showToast(result.message || result.error || '대상 제외에 실패했습니다.');
      return;
    }
    state.missions = result.missions || [];
    render();
    showToast('대상 기사에서 제외했습니다.');
  }

  async function deleteMission(missionId) {
    if (!window.confirm('이 미션 기록을 정리할까요? 기사앱에서도 바로 사라집니다.')) return;
    const result = await window.BremStorage.deleteAdminUrgentMission(missionId);
    if (!result.ok) {
      showToast(result.message || result.error || '정리에 실패했습니다.');
      return;
    }
    state.missions = result.missions || [];
    render();
    showToast('미션 기록을 정리했습니다.');
  }

  document.getElementById('urgentMissionRefreshBtn')?.addEventListener('click', () => {
    void load();
  });

  form?.addEventListener('submit', publish);

  section.addEventListener('click', (event) => {
    const regionBtn = event.target.closest('[data-um-region]');
    if (regionBtn) {
      state.selectedRegionKey = regionBtn.dataset.umRegion;
      state.selectedRegionPlatform = regionBtn.dataset.umPlatform;
      renderRegionList();
      return;
    }
    const closeBtn = event.target.closest('[data-close-mission]');
    if (closeBtn) {
      void closeMission(closeBtn.dataset.closeMission);
      return;
    }
    const deleteBtn = event.target.closest('[data-delete-mission]');
    if (deleteBtn) {
      void deleteMission(deleteBtn.dataset.deleteMission);
      return;
    }
    const setupBtn = event.target.closest('[data-setup-done]');
    if (setupBtn) {
      void setupDone(setupBtn.dataset.setupDone);
      return;
    }
    const removeBtn = event.target.closest('[data-remove-target]');
    if (removeBtn) {
      void removeTarget(removeBtn.dataset.removeTarget, removeBtn.dataset.removeRider);
    }
  });

  section.addEventListener('change', (event) => {
    if (event.target?.name === 'urgentMissionPlatform') {
      renderRegionList();
      return;
    }
    if (event.target?.id === 'urgentMissionRiderCheckAll') {
      const region = selectedRegion();
      if (!region) return;
      const on = event.target.checked;
      driversInRegion(region).forEach(driver => toggleRider(driver, region, on));
      renderRiderList();
      return;
    }
    const riderBox = event.target.closest('[data-um-rider]');
    if (riderBox) {
      const region = selectedRegion();
      const driver = allDrivers().find(item => item.id === riderBox.dataset.umRider);
      if (region && driver) toggleRider(driver, region, riderBox.checked);
      if (checkAllEl && region) {
        checkAllEl.checked = driversInRegion(region).every(item => state.selectedRiders.has(riderKey(region.platform, item.id)));
      }
      updateRiderCount();
      return;
    }
    const all = event.target.closest('[data-accept-all]');
    if (!all) return;
    const missionId = all.dataset.acceptAll;
    section.querySelectorAll(`[data-accept-mission="${missionId}"]`).forEach((input) => {
      input.checked = all.checked;
    });
  });

  searchEl?.addEventListener('input', () => {
    state.riderSearch = searchEl.value;
    renderRiderList();
  });

  window.BremAdminUrgentMissions = {
    refresh: load
  };
})();
