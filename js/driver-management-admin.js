// 기사관리 — 조직도 / 기사지역관리 / 지역 일괄등록
const BremDriverManagementAdmin = (function () {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const state = {
    tab: 'org',
    org: { nodes: [] },
    selectedNodeId: '',
    memberSearch: '',
    regionPlatform: 'baemin',
    selectedRegionKey: '',
    baeminRegions: [],
    coupangRegions: [],
    bulkRows: []
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function createId() {
    return window.BremStorage?.createId?.() || `id_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeDriverLoginId(driver) {
    const make = window.BremDriverUtils?.makeDriverLoginId;
    if (typeof make === 'function') return make(driver);
    const name = String(driver?.name || '').replace(/\s/g, '');
    const phone = String(driver?.phone || '').replace(/[^0-9]/g, '').slice(-4);
    return phone ? `${name}${phone}` : name;
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

  function setTab(tab) {
    state.tab = tab === 'region' ? 'region' : 'org';
    $$('[data-driver-mgmt-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.driverMgmtTab === state.tab);
    });
    $$('[data-driver-mgmt-panel]').forEach(panel => {
      panel.hidden = panel.dataset.driverMgmtPanel !== state.tab;
    });
    if (state.tab === 'org') renderOrg();
    else void refreshRegions();
  }

  function loadOrg() {
    state.org = window.BremStorage?.driverOrgChart?.get?.() || { nodes: [] };
  }

  function roots() {
    return state.org.nodes
      .filter(node => !node.parentId || !state.org.nodes.some(n => n.id === node.parentId))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'ko'));
  }

  function childrenOf(parentId) {
    return state.org.nodes
      .filter(node => node.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'ko'));
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function driverCallAndFee(driverId) {
    const id = String(driverId || '').trim();
    if (!id) return { callCount: 0, deliveryFee: 0 };
    const callCount = (window.BremStorage?.calls?.getAll?.() || [])
      .filter(call => String(call.driverId || '') === id)
      .reduce((sum, call) => sum + Number(call.count || call.orderCount || 0), 0);
    const deliveryFee = (window.BremStorage?.settlements?.getAll?.() || [])
      .filter(row => String(row.driverId || '') === id)
      .reduce((sum, row) => sum + Number(row.deliveryAmount ?? row.settlementAmount ?? 0), 0);
    return { callCount, deliveryFee };
  }

  function memberSummary(node) {
    const n = (node.memberRefs || []).length;
    const c = childrenOf(node.id).length;
    return `인원 ${n} · 하위 ${c}`;
  }

  function renderOrgTreeHtml(nodes, isRoot = false) {
    if (!nodes.length) return '';
    const cls = isRoot ? ' class="driver-org-tree"' : '';
    return `<ul${cls}>${nodes.map(node => `
      <li>
        <button type="button" class="driver-org-node${state.selectedNodeId === node.id ? ' is-selected' : ''}" data-org-node="${escapeHtml(node.id)}">
          <span class="driver-org-node-label">${escapeHtml(node.label || '이름 없음')}</span>
          <small>${escapeHtml(memberSummary(node))}</small>
        </button>
        ${renderOrgTreeHtml(childrenOf(node.id), false)}
      </li>`).join('')}</ul>`;
  }

  function renderOrgMemberPanel() {
    const panel = $('#driverOrgMemberPanel');
    const rows = $('#driverOrgMemberRows');
    const title = $('#driverOrgMemberPanelTitle');
    const summary = $('#driverOrgMemberPanelSummary');
    if (!panel || !rows) return;

    const node = selectedNode();
    if (!node) {
      panel.hidden = true;
      rows.innerHTML = '';
      return;
    }

    panel.hidden = false;
    if (title) title.textContent = `「${node.label}」 소속 목록`;

    const refs = Array.isArray(node.memberRefs) ? node.memberRefs : [];
    const people = refs.map(ref => {
      if (ref.kind === 'admin') {
        const account = window.BremStorage?.auth?.getAdminAccountById?.(ref.id)
          || (window.BremStorage?.auth?.getAdminAccounts?.() || []).find(item => item.id === ref.id);
        return {
          kind: '관리자',
          name: account?.name || account?.loginId || ref.id,
          callCount: '-',
          deliveryFee: '-'
        };
      }
      const driver = window.BremStorage?.drivers?.getById?.(ref.id);
      const stats = driverCallAndFee(ref.id);
      return {
        kind: '기사',
        name: driver?.name || ref.id,
        callCount: formatNumber(stats.callCount),
        deliveryFee: `${formatNumber(stats.deliveryFee)}원`
      };
    });

    if (summary) {
      const driverCount = refs.filter(ref => ref.kind !== 'admin').length;
      const adminCount = refs.length - driverCount;
      summary.textContent = `기사 ${driverCount}명 · 관리자 ${adminCount}명`;
    }

    rows.innerHTML = people.length
      ? people.map(person => `
        <tr>
          <td>${escapeHtml(person.kind)}</td>
          <td><strong>${escapeHtml(person.name)}</strong></td>
          <td class="weekly-amount-cell">${escapeHtml(person.callCount)}</td>
          <td class="weekly-amount-cell">${escapeHtml(person.deliveryFee)}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="empty">소속된 인원이 없습니다. 오른쪽에서 기사·관리자를 체크하세요.</td></tr>';
  }

  function renderOrg() {
    const canvas = $('#driverOrgCanvas');
    if (!canvas) return;
    const top = roots();
    if (!top.length) {
      canvas.innerHTML = '<p class="empty">박스가 없습니다. 「루트 박스 추가」로 시작하세요.</p>';
    } else {
      canvas.innerHTML = renderOrgTreeHtml(top, true);
    }
    renderOrgEditor();
    renderOrgMemberPanel();
  }

  function selectedNode() {
    return state.org.nodes.find(node => node.id === state.selectedNodeId) || null;
  }

  function allPeople() {
    const drivers = (window.BremStorage?.drivers?.getAll?.() || []).map(driver => ({
      kind: 'driver',
      id: driver.id,
      label: `${driver.name} · ${makeDriverLoginId(driver)}${driver.baeminId ? ` · 배민 ${driver.baeminId}` : ''}`,
      search: `${driver.name} ${makeDriverLoginId(driver)} ${driver.baeminId || ''} ${driver.phone || ''}`
    }));
    const admins = (window.BremStorage?.auth?.getAdminAccounts?.() || []).map(account => ({
      kind: 'admin',
      id: account.id,
      label: `${account.name || account.loginId || account.id} · 관리자${account.role ? ` (${account.role})` : ''}`,
      search: `${account.name || ''} ${account.loginId || ''} ${account.id}`
    }));
    return [...admins, ...drivers];
  }

  function renderOrgEditor() {
    const editor = $('#driverOrgEditor');
    const node = selectedNode();
    if (!editor) return;
    if (!node) {
      editor.hidden = true;
      return;
    }
    editor.hidden = false;
    const title = $('#driverOrgEditorTitle');
    const labelInput = $('#driverOrgNodeLabel');
    if (title) title.textContent = `박스 편집 · ${node.label}`;
    if (labelInput && document.activeElement !== labelInput) labelInput.value = node.label;

    const q = String(state.memberSearch || '').trim().toLowerCase();
    const selected = new Set((node.memberRefs || []).map(ref => `${ref.kind}:${ref.id}`));
    const list = $('#driverOrgMemberList');
    if (list) {
      list.innerHTML = allPeople()
        .filter(person => !q || person.search.toLowerCase().includes(q))
        .slice(0, 200)
        .map(person => {
          const key = `${person.kind}:${person.id}`;
          return `<label>
            <input type="checkbox" data-org-member-kind="${person.kind}" data-org-member-id="${escapeHtml(person.id)}"${selected.has(key) ? ' checked' : ''}>
            <span>${escapeHtml(person.label)}</span>
          </label>`;
        }).join('') || '<p class="empty">검색 결과가 없습니다.</p>';
    }

    const childList = $('#driverOrgChildList');
    if (childList) {
      const kids = childrenOf(node.id);
      childList.innerHTML = kids.length
        ? kids.map(child => `<li><button type="button" class="small-btn" data-org-select-child="${escapeHtml(child.id)}">${escapeHtml(child.label)}</button></li>`).join('')
        : '<li class="empty">하위 박스 없음</li>';
    }
  }

  function addNode(parentId = '') {
    const node = {
      id: createId(),
      label: parentId ? '하위 박스' : '루트',
      parentId: parentId || '',
      memberRefs: [],
      sortOrder: state.org.nodes.length
    };
    state.org.nodes.push(node);
    state.selectedNodeId = node.id;
    renderOrg();
  }

  function deleteSelectedNode() {
    const node = selectedNode();
    if (!node) return;
    if (!window.confirm(`「${node.label}」박스를 삭제할까요? 하위 박스는 루트로 올라갑니다.`)) return;
    state.org.nodes.forEach(item => {
      if (item.parentId === node.id) item.parentId = node.parentId || '';
    });
    state.org.nodes = state.org.nodes.filter(item => item.id !== node.id);
    state.selectedNodeId = '';
    renderOrg();
  }

  async function saveOrg() {
    try {
      await window.BremStorage.driverOrgChart.save(state.org);
      showToast('조직도를 저장했습니다.');
      loadOrg();
      renderOrg();
    } catch (error) {
      showToast(error.message || '조직도 저장에 실패했습니다.');
    }
  }

  async function fetchBaeminRegions() {
    try {
      const token = await window.BremStorage?.resolveAdminAccessToken?.();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/api/admin/baemin-delivery/partner-regions', { headers, credentials: 'same-origin' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '배민 지역을 불러오지 못했습니다.');
      const items = payload.allItems || payload.items || [];
      state.baeminRegions = items.map(item => ({
        key: String(item.partnerId || '').trim(),
        partnerId: String(item.partnerId || '').trim(),
        label: String(item.regionName || '').trim(),
        platform: 'baemin'
      })).filter(item => item.key && item.label);
    } catch (error) {
      console.warn('[BREM] baemin regions:', error);
      state.baeminRegions = [];
      showToast(error.message || '배민 지역 목록을 불러오지 못했습니다.');
    }
  }

  async function fetchCoupangRegions() {
    try {
      const token = await window.BremStorage?.resolveAdminAccessToken?.();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/api/admin/coupang/vendor-regions', { headers, credentials: 'same-origin' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '쿠팡 지역을 불러오지 못했습니다.');
      const items = payload.allItems || payload.items || [];
      const byShort = new Map();
      items.forEach(item => {
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
      state.coupangRegions = [...byShort.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
    } catch (error) {
      console.warn('[BREM] coupang regions:', error);
      state.coupangRegions = [];
      showToast(error.message || '쿠팡 지역 목록을 불러오지 못했습니다.');
    }
  }

  function regionCatalog() {
    return state.regionPlatform === 'coupang' ? state.coupangRegions : state.baeminRegions;
  }

  function selectedRegion() {
    return regionCatalog().find(item => item.key === state.selectedRegionKey) || null;
  }

  function driverRegionValue(driver, platform) {
    return platform === 'coupang'
      ? String(driver?.regionCoupang || '').trim()
      : String(driver?.regionBaemin || '').trim();
  }

  function driversInRegion(region) {
    if (!region) return [];
    const platform = state.regionPlatform;
    return (window.BremStorage?.drivers?.getAll?.() || []).filter(driver => {
      const value = driverRegionValue(driver, platform);
      if (!value) return false;
      if (platform === 'baemin') {
        return value === region.label || value === region.partnerId || value === region.key;
      }
      return shortCoupangRegion(value) === region.key || value === region.vendorName;
    });
  }

  function renderRegionCatalog() {
    const el = $('#driverRegionCatalog');
    if (!el) return;
    const list = regionCatalog();
    if (!list.length) {
      el.innerHTML = '<p class="empty">등록·수집된 지역이 없습니다.</p>';
      return;
    }
    el.innerHTML = list.map(region => {
      const count = driversInRegion(region).length;
      const active = state.selectedRegionKey === region.key;
      const sub = region.platform === 'baemin' ? region.partnerId : (region.vendorName || '');
      const name = region.label || region.key || '이름 없음';
      return `<button type="button" class="driver-region-item${active ? ' is-active' : ''}" data-region-key="${escapeHtml(region.key)}" title="${escapeHtml(sub || name)}">
        <span class="driver-region-item-name">${escapeHtml(name)}</span>
        <span class="driver-region-item-meta">${escapeHtml(sub && sub !== name ? sub : '')}</span>
        <span class="driver-region-item-count">${count}명</span>
      </button>`;
    }).join('');
  }

  function renderRegionDetail() {
    const region = selectedRegion();
    const title = $('#driverRegionDetailTitle');
    const rows = $('#driverRegionRows');
    const select = $('#driverRegionAddSelect');
    if (title) {
      title.textContent = region
        ? `${region.label}${region.platform === 'baemin' ? ` (${region.partnerId})` : ''}`
        : '지역을 선택하세요';
    }
    if (!rows) return;
    if (!region) {
      rows.innerHTML = '<tr><td colspan="4" class="empty">왼쪽에서 지역을 선택하세요.</td></tr>';
      if (select) select.innerHTML = '<option value="">지역 선택 후 추가</option>';
      return;
    }
    const inRegion = driversInRegion(region);
    rows.innerHTML = inRegion.length
      ? inRegion.map(driver => {
        const stats = driverCallAndFee(driver.id);
        return `<tr>
          <td><strong>${escapeHtml(driver.name)}</strong></td>
          <td class="weekly-amount-cell">${formatNumber(stats.callCount)}</td>
          <td class="weekly-amount-cell">${formatNumber(stats.deliveryFee)}원</td>
          <td><button type="button" class="small-btn danger" data-region-remove="${escapeHtml(driver.id)}">해제</button></td>
        </tr>`;
      }).join('')
      : '<tr><td colspan="4" class="empty">이 지역에 배정된 기사가 없습니다.</td></tr>';

    if (select) {
      const assigned = new Set(inRegion.map(d => d.id));
      const candidates = (window.BremStorage?.drivers?.getAll?.() || [])
        .filter(driver => !assigned.has(driver.id))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
      select.innerHTML = '<option value="">기사 선택</option>'
        + candidates.map(driver => {
          const idLabel = state.regionPlatform === 'baemin'
            ? (driver.baeminId || makeDriverLoginId(driver))
            : makeDriverLoginId(driver);
          return `<option value="${escapeHtml(driver.id)}">${escapeHtml(driver.name)} · ${escapeHtml(idLabel)}</option>`;
        }).join('');
    }
  }

  async function assignDriverToRegion(driverId, region = selectedRegion()) {
    if (!driverId || !region) return;
    const patch = state.regionPlatform === 'coupang'
      ? { regionCoupang: region.label }
      : { regionBaemin: region.label };
    await window.BremStorage.drivers.update(driverId, patch);
  }

  async function clearDriverRegion(driverId) {
    const patch = state.regionPlatform === 'coupang'
      ? { regionCoupang: '' }
      : { regionBaemin: '' };
    await window.BremStorage.drivers.update(driverId, patch);
  }

  async function refreshRegions() {
    const hint = $('#driverRegionHint');
    if (hint) {
      hint.textContent = state.regionPlatform === 'coupang'
        ? '쿠팡: 크롤링된 지역을 4글자로 표시합니다. 선택형으로 기사를 배정하세요.'
        : '배민: 등록한 크롤링 지역(DP→지역명)을 선택합니다.';
    }
    if (state.regionPlatform === 'coupang') await fetchCoupangRegions();
    else await fetchBaeminRegions();
    if (!selectedRegion() && regionCatalog()[0]) {
      state.selectedRegionKey = regionCatalog()[0].key;
    }
    renderRegionCatalog();
    renderRegionDetail();
  }

  function matchBaeminRegion(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const upper = raw.toUpperCase();
    return state.baeminRegions.find(item => (
      item.partnerId.toUpperCase() === upper
      || item.label === raw
      || item.key.toUpperCase() === upper
    )) || null;
  }

  function matchCoupangRegion(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const short = shortCoupangRegion(raw);
    return state.coupangRegions.find(item => (
      item.key === short
      || item.label === short
      || shortCoupangRegion(item.vendorName) === short
      || item.vendorName === raw
    )) || null;
  }

  function findDriverByPlatformId(platform, idValue) {
    const id = String(idValue || '').trim();
    if (!id) return null;
    const drivers = window.BremStorage?.drivers?.getAll?.() || [];
    if (platform === 'baemin') {
      const norm = id.toUpperCase();
      return drivers.find(driver => String(driver.baeminId || '').trim().toUpperCase() === norm) || null;
    }
    const compact = id.replace(/\s/g, '');
    return drivers.find(driver => makeDriverLoginId(driver) === compact) || null;
  }

  function renderBulkPreview() {
    const body = $('#driverRegionBulkRows');
    const summary = $('#driverRegionBulkSummary');
    const applyBtn = $('#driverRegionBulkApplyBtn');
    if (!body) return;
    if (!state.bulkRows.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">엑셀을 선택하세요.</td></tr>';
      if (summary) summary.textContent = '';
      if (applyBtn) applyBtn.disabled = true;
      return;
    }
    const ok = state.bulkRows.filter(row => row.status === 'ok').length;
    const fail = state.bulkRows.length - ok;
    if (summary) summary.innerHTML = `총 ${state.bulkRows.length}행 · 매칭성공 <strong>${ok}</strong> · 실패 <strong>${fail}</strong>`;
    if (applyBtn) applyBtn.disabled = ok === 0;
    body.innerHTML = state.bulkRows.map((row, index) => `
      <tr>
        <td class="${row.status === 'ok' ? 'driver-region-bulk-ok' : 'driver-region-bulk-fail'}">${row.status === 'ok' ? '성공' : '실패'}</td>
        <td><input type="text" data-bulk-id="${index}" value="${escapeHtml(row.idValue)}"></td>
        <td><input type="text" data-bulk-region="${index}" value="${escapeHtml(row.regionInput)}"></td>
        <td>${escapeHtml(row.matchLabel || '-')}</td>
        <td>${escapeHtml(row.driverName || '-')}</td>
        <td><button type="button" class="small-btn" data-bulk-recheck="${index}">다시매칭</button></td>
      </tr>`).join('');
  }

  function recheckBulkRow(row, platform) {
    const driver = findDriverByPlatformId(platform, row.idValue);
    const region = platform === 'coupang'
      ? matchCoupangRegion(row.regionInput)
      : matchBaeminRegion(row.regionInput);
    row.driverId = driver?.id || '';
    row.driverName = driver?.name || '';
    row.regionKey = region?.key || '';
    row.matchLabel = region
      ? (platform === 'baemin' ? `${region.label} (${region.partnerId})` : region.label)
      : '';
    if (!driver && !region) row.error = '기사·지역 모두 매칭 실패';
    else if (!driver) row.error = '기사 매칭 실패';
    else if (!region) row.error = '지역 매칭 실패';
    else row.error = '';
    row.status = (!row.error && driver && region) ? 'ok' : 'fail';
    if (row.error) row.matchLabel = row.error;
  }

  async function parseBulkFile(file) {
    if (!window.XLSX) throw new Error('엑셀 모듈을 불러오지 못했습니다.');
    const platform = $('#driverRegionBulkPlatform')?.value === 'coupang' ? 'coupang' : 'baemin';
    if (platform === 'coupang' && !state.coupangRegions.length) await fetchCoupangRegions();
    if (platform === 'baemin' && !state.baeminRegions.length) await fetchBaeminRegions();

    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const dataRows = rows.slice(1).filter(row => String(row[0] || '').trim() || String(row[1] || '').trim());
    state.bulkRows = dataRows.map(row => {
      const item = {
        idValue: String(row[0] ?? '').trim(),
        regionInput: String(row[1] ?? '').trim(),
        status: 'fail',
        error: '',
        driverId: '',
        driverName: '',
        regionKey: '',
        matchLabel: ''
      };
      recheckBulkRow(item, platform);
      return item;
    });
    renderBulkPreview();
  }

  async function applyBulk() {
    const platform = $('#driverRegionBulkPlatform')?.value === 'coupang' ? 'coupang' : 'baemin';
    const targets = state.bulkRows.filter(row => row.status === 'ok');
    if (!targets.length) {
      showToast('적용할 매칭 성공 행이 없습니다.');
      return;
    }
    let saved = 0;
    for (const row of targets) {
      const region = platform === 'coupang'
        ? state.coupangRegions.find(item => item.key === row.regionKey)
        : state.baeminRegions.find(item => item.key === row.regionKey);
      if (!region || !row.driverId) continue;
      const patch = platform === 'coupang'
        ? { regionCoupang: region.label }
        : { regionBaemin: region.label };
      await window.BremStorage.drivers.update(row.driverId, patch);
      saved += 1;
    }
    showToast(`${saved}명 지역을 반영했습니다.`);
    state.regionPlatform = platform;
    $$('[data-driver-region-platform]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.driverRegionPlatform === platform);
    });
    await refreshRegions();
  }

  function downloadBulkTemplate() {
    if (!window.XLSX) {
      showToast('엑셀 모듈을 불러오지 못했습니다.');
      return;
    }
    const platform = $('#driverRegionBulkPlatform')?.value === 'coupang' ? 'coupang' : 'baemin';
    const header = platform === 'coupang'
      ? [['쿠팡ID', '지역(4글자)'], ['홍길동1234', '양산동부']]
      : [['배민ID', 'DP코드'], ['BC000001', 'DP2603096926']];
    const ws = window.XLSX.utils.aoa_to_sheet(header);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, '지역일괄');
    window.XLSX.writeFile(wb, platform === 'coupang' ? 'BREM_쿠팡지역일괄.xlsx' : 'BREM_배민지역일괄.xlsx');
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    document.addEventListener('click', event => {
      const tabBtn = event.target.closest('[data-driver-mgmt-tab]');
      if (tabBtn) {
        setTab(tabBtn.dataset.driverMgmtTab);
        return;
      }

      const orgNode = event.target.closest('[data-org-node]');
      if (orgNode) {
        state.selectedNodeId = orgNode.dataset.orgNode;
        renderOrg();
        return;
      }

      const childBtn = event.target.closest('[data-org-select-child]');
      if (childBtn) {
        state.selectedNodeId = childBtn.dataset.orgSelectChild;
        renderOrg();
        return;
      }

      const regionBtn = event.target.closest('[data-region-key]');
      if (regionBtn) {
        state.selectedRegionKey = regionBtn.dataset.regionKey;
        renderRegionCatalog();
        renderRegionDetail();
        return;
      }

      const platformBtn = event.target.closest('[data-driver-region-platform]');
      if (platformBtn) {
        state.regionPlatform = platformBtn.dataset.driverRegionPlatform === 'coupang' ? 'coupang' : 'baemin';
        state.selectedRegionKey = '';
        $$('[data-driver-region-platform]').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.driverRegionPlatform === state.regionPlatform);
        });
        void refreshRegions();
        return;
      }

      const removeBtn = event.target.closest('[data-region-remove]');
      if (removeBtn) {
        void clearDriverRegion(removeBtn.dataset.regionRemove).then(() => {
          renderRegionCatalog();
          renderRegionDetail();
          showToast('지역 배정을 해제했습니다.');
        }).catch(error => showToast(error.message || '해제 실패'));
        return;
      }

      const recheckBtn = event.target.closest('[data-bulk-recheck]');
      if (recheckBtn) {
        const index = Number(recheckBtn.dataset.bulkRecheck);
        const row = state.bulkRows[index];
        if (!row) return;
        const idInput = document.querySelector(`[data-bulk-id="${index}"]`);
        const regionInput = document.querySelector(`[data-bulk-region="${index}"]`);
        row.idValue = idInput?.value?.trim() || row.idValue;
        row.regionInput = regionInput?.value?.trim() || row.regionInput;
        const platform = $('#driverRegionBulkPlatform')?.value === 'coupang' ? 'coupang' : 'baemin';
        recheckBulkRow(row, platform);
        renderBulkPreview();
      }
    });

    document.addEventListener('change', event => {
      const member = event.target.closest('[data-org-member-id]');
      if (member) {
        const node = selectedNode();
        if (!node) return;
        const kind = member.dataset.orgMemberKind === 'admin' ? 'admin' : 'driver';
        const id = member.dataset.orgMemberId;
        const next = new Map((node.memberRefs || []).map(ref => [`${ref.kind}:${ref.id}`, ref]));
        const key = `${kind}:${id}`;
        if (member.checked) next.set(key, { kind, id });
        else next.delete(key);
        node.memberRefs = [...next.values()];
        renderOrg();
      }
    });

    $('#driverOrgAddRootBtn')?.addEventListener('click', () => addNode(''));
    $('#driverOrgAddChildBtn')?.addEventListener('click', () => {
      if (!state.selectedNodeId) {
        showToast('상위 박스를 먼저 선택하세요.');
        return;
      }
      addNode(state.selectedNodeId);
    });
    $('#driverOrgDeleteBtn')?.addEventListener('click', () => deleteSelectedNode());
    $('#driverOrgCloseBtn')?.addEventListener('click', () => {
      state.selectedNodeId = '';
      renderOrg();
    });
    $('#driverOrgSaveBtn')?.addEventListener('click', () => { void saveOrg(); });
    $('#driverOrgNodeLabel')?.addEventListener('input', event => {
      const node = selectedNode();
      if (!node) return;
      node.label = String(event.target.value || '').trim() || node.label;
      renderOrg();
    });
    $('#driverOrgMemberSearch')?.addEventListener('input', event => {
      state.memberSearch = event.target.value || '';
      renderOrgEditor();
    });

    $('#driverRegionReloadBtn')?.addEventListener('click', () => { void refreshRegions(); });
    $('#driverRegionAddBtn')?.addEventListener('click', () => {
      const id = $('#driverRegionAddSelect')?.value;
      if (!id) {
        showToast('기사를 선택하세요.');
        return;
      }
      void assignDriverToRegion(id).then(() => {
        renderRegionCatalog();
        renderRegionDetail();
        showToast('지역에 추가했습니다.');
      }).catch(error => showToast(error.message || '추가 실패'));
    });

    $('#driverRegionBulkFile')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;
      void parseBulkFile(file).catch(error => showToast(error.message || '엑셀 파싱 실패'));
    });
    $('#driverRegionBulkTemplateBtn')?.addEventListener('click', () => downloadBulkTemplate());
    $('#driverRegionBulkApplyBtn')?.addEventListener('click', () => { void applyBulk(); });
    $('#driverRegionBulkPlatform')?.addEventListener('change', () => {
      state.bulkRows = [];
      renderBulkPreview();
      const file = $('#driverRegionBulkFile');
      if (file) file.value = '';
    });
  }

  async function refresh() {
    bindEvents();
    loadOrg();
    setTab(state.tab);
    if (state.tab === 'region') await refreshRegions();
  }

  return {
    refresh,
    shortCoupangRegion,
    async loadRegionOptions() {
      await Promise.all([fetchBaeminRegions(), fetchCoupangRegions()]);
      return {
        baemin: state.baeminRegions.map(item => ({ value: item.label, label: `${item.label} (${item.partnerId})`, partnerId: item.partnerId })),
        coupang: state.coupangRegions.map(item => ({ value: item.label, label: item.label, vendorName: item.vendorName }))
      };
    }
  };
})();

window.BremDriverManagementAdmin = BremDriverManagementAdmin;
