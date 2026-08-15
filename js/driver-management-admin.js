// 기사관리 — 조직도 / 기사지역관리 / 지역 일괄등록
const BremDriverManagementAdmin = (function () {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const state = {
    tab: 'org',
    org: { nodes: [] },
    selectedNodeId: '',
    memberSearch: '',
    weekStart: '',
    regionPlatform: 'baemin',
    selectedRegionKey: '',
    baeminRegions: [],
    coupangRegions: [],
    regionExposure: { baemin: {}, coupang: {} },
    regionRanking: null,
    regionRankingKey: '',
    regionRankingCache: new Map(),
    regionRankingRequestSeq: 0,
    regionRankingBusy: false,
    regionRankingPollTimer: null,
    regionAdd: { open: false, highlight: -1, candidates: [] },
    bulkRows: [],
    bulkCreateIndex: -1,
    bulkCreateBusy: false,
    bulkCreateSource: 'bulk',
    crawlMatch: { rows: [], partnerId: '', label: '', busy: false },
    statsLoadPromise: null,
    regionRefreshSeq: 0,
    regionDetailSyncTimer: null,
    regionDetailDriverCount: -1,
    regionListFilter: '',
    regionListFilterTimer: null
  };

  const REGION_RANKING_POLL_MS = 60 * 1000;

  function localDateKey(date = new Date()) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  // 정산주는 무조건 수~화. 오늘(토·일 등)이 들어오면 그 주의 수요일로 당긴다.
  // BremDatePicker 미로딩·UTC 날짜(toISOString)로 수요일이 아닌 값이 남는 걸 막는다.
  function weekStartKey(dateValue) {
    const picker = window.BremDatePicker;
    if (picker?.weekStartKey) {
      const picked = String(picker.weekStartKey(dateValue || picker.today?.() || localDateKey()) || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(picked)) return picked;
    }
    const seed = String(dateValue || localDateKey()).slice(0, 10);
    const date = new Date(`${/^\d{4}-\d{2}-\d{2}$/.test(seed) ? seed : localDateKey()}T00:00:00`);
    if (Number.isNaN(date.getTime())) return localDateKey();
    const diff = (date.getDay() - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return localDateKey(date);
  }

  function weekEndKey(weekStart) {
    const picker = window.BremDatePicker;
    if (picker?.weekEndKey) return picker.weekEndKey(weekStartKey(weekStart));
    const date = new Date(`${weekStartKey(weekStart)}T00:00:00`);
    date.setDate(date.getDate() + 6);
    return localDateKey(date);
  }

  function formatWeekRange(weekStart) {
    const picker = window.BremDatePicker;
    if (picker?.formatWednesdayWeekRange) return picker.formatWednesdayWeekRange(weekStartKey(weekStart));
    return `${weekStartKey(weekStart)} ~ ${weekEndKey(weekStart)}`;
  }

  function formatDateShort(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(`${String(value).slice(0, 10)}T00:00:00`));
  }

  function ensureWeek() {
    // 이미 값이 있어도 수요일이 아니면 그 주의 수요일로 보정한다.
    state.weekStart = weekStartKey(state.weekStart || localDateKey());
    return state.weekStart;
  }

  function setWeek(value) {
    const next = weekStartKey(value || localDateKey());
    if (next === state.weekStart) {
      renderWeekControls();
      return;
    }
    state.weekStart = next;
    renderWeekControls();
    if (state.tab === 'org') void refreshOrgMemberPanel();
    else renderRegionDetail();
  }

  function shiftWeek(deltaWeeks) {
    const base = ensureWeek();
    const date = new Date(`${base}T00:00:00`);
    date.setDate(date.getDate() + deltaWeeks * 7);
    setWeek(localDateKey(date));
  }

  function renderWeekControls() {
    const week = ensureWeek();
    const label = `${formatDateShort(week)}(수) 주`;
    const rangeText = formatWeekRange(week);
    const orgBtn = $('#driverOrgWeekBtn');
    if (orgBtn) orgBtn.textContent = label;
    const regionBtn = $('#driverRegionWeekBtn');
    if (regionBtn) regionBtn.textContent = label;
    const orgHidden = $('#driverOrgWeek');
    if (orgHidden) orgHidden.value = week;
    const regionHidden = $('#driverRegionWeek');
    if (regionHidden) regionHidden.value = week;
    const orgRange = $('#driverOrgWeekRange');
    if (orgRange) orgRange.textContent = rangeText;
    const regionRange = $('#driverRegionWeekRange');
    if (regionRange) regionRange.textContent = rangeText;
  }

  // 하위 호환 별칭
  function renderOrgWeekControls() {
    renderWeekControls();
  }

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

  function isDriverManagementSectionActive() {
    return Boolean(document.getElementById('driver-management')?.classList.contains('active'));
  }

  function stopRegionRankingPoll() {
    if (state.regionRankingPollTimer) {
      clearInterval(state.regionRankingPollTimer);
      state.regionRankingPollTimer = null;
    }
  }

  function startRegionRankingPoll() {
    stopRegionRankingPoll();
    state.regionRankingPollTimer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (!isDriverManagementSectionActive()) return;
      if (state.tab !== 'region') return;
      if (!selectedRegion()) return;
      if (state.regionRankingBusy) return;
      void loadRegionRanking();
    }, REGION_RANKING_POLL_MS);
  }

  function setTab(tab, options = {}) {
    const next = String(tab || 'org');
    state.tab = next === 'region' || next === 'org-list' ? next : 'org';
    $$('[data-driver-mgmt-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.driverMgmtTab === state.tab);
    });
    $$('[data-driver-mgmt-panel]').forEach(panel => {
      panel.hidden = panel.dataset.driverMgmtPanel !== state.tab;
    });
    if (state.tab === 'org') {
      stopRegionRankingPoll();
      void (async () => {
        await ensureDriverMgmtStatsLoaded();
        renderOrg();
      })();
      return;
    }
    if (state.tab === 'org-list') {
      stopRegionRankingPoll();
      renderOrgList();
      return;
    }
    // refresh() 경로에서는 skipRegionLoad 로 이중 refreshRegions 를 막는다.
    if (!options.skipRegionLoad) void refreshRegions();
    startRegionRankingPoll();
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

  /**
   * 기사지역관리 수치 출처
   * - 콜수: 콜수 입력(admin_calls) 우선. 없으면 일정산 orderCount 로 주간 콜수 표시
   * - 배달료: 일정산 업로드(settlements)의 deliveryAmount만
   */
  function driverCallAndFee(driverId, weekStart = ensureWeek(), platformFilter = '') {
    const id = String(driverId || '').trim();
    if (!id) return { callCount: 0, deliveryFee: 0 };
    const start = weekStartKey(weekStart);
    const end = weekEndKey(start);
    const platformOk = (platform) => {
      const p = String(platform || '').toLowerCase();
      if (platformFilter === 'coupang' || platformFilter === 'baemin') return p === platformFilter;
      return p === 'coupang' || p === 'baemin';
    };

    let callCount = (window.BremStorage?.calls?.getAll?.() || [])
      .filter(call => {
        if (String(call.driverId || '') !== id) return false;
        if (!platformOk(call.platform)) return false;
        const day = String(call.date || '').slice(0, 10);
        return day >= start && day <= end;
      })
      .reduce((sum, call) => sum + Math.max(0, Number(call.count || call.orderCount || 0)), 0);

    // 같은 날·같은 플랫폼 중복 반영은 최신 appliedAt만. 플랫폼끼리 덮어쓰지 않음.
    const feeByDayPlatform = new Map();
    const orderByDayPlatform = new Map();
    (window.BremStorage?.settlements?.getAll?.() || []).forEach(row => {
      if (String(row.driverId || '') !== id) return;
      if (!platformOk(row.platform)) return;
      const day = String(row.period || row.date || '').slice(0, 10);
      if (!day || day < start || day > end) return;
      const platform = String(row.platform || '').toLowerCase() || 'coupang';
      const feeKey = `${platform}|${day}`;
      const appliedAt = String(row.appliedAt || '');
      const prevFee = feeByDayPlatform.get(feeKey);
      if (!prevFee || appliedAt >= prevFee.appliedAt) {
        feeByDayPlatform.set(feeKey, {
          deliveryFee: Math.max(0, Number(row.deliveryAmount ?? row.settlementAmount ?? 0)),
          appliedAt
        });
      }
      const prevOrder = orderByDayPlatform.get(feeKey);
      if (!prevOrder || appliedAt >= prevOrder.appliedAt) {
        orderByDayPlatform.set(feeKey, {
          orderCount: Math.max(0, Math.round(Number(row.orderCount ?? row.callCount ?? 0))),
          appliedAt
        });
      }
    });
    let deliveryFee = 0;
    feeByDayPlatform.forEach(day => {
      deliveryFee += day.deliveryFee;
    });
    // 콜수입력이 비어 있으면 일정산 주문수(주간콜)로 채운다 — 배민은 일정산만 올리는 경우가 많음
    if (callCount <= 0) {
      let fromSettlement = 0;
      orderByDayPlatform.forEach(day => {
        fromSettlement += day.orderCount;
      });
      callCount = fromSettlement;
    }

    return { callCount, deliveryFee };
  }

  async function ensureDriverMgmtStatsLoaded() {
    if (state.statsLoadPromise) return state.statsLoadPromise;
    state.statsLoadPromise = (async () => {
      try {
        await window.BremStorage?.ensureSectionLoaded?.('driver-management');
        // 빈 배열이 캐시에 굳으면 콜수·배달료가 계속 0 → 강제 재조회
        const calls = window.BremStorage?.calls?.getAll?.() || [];
        const settlements = window.BremStorage?.settlements?.getAll?.() || [];
        if (!calls.length) {
          await window.BremStorage?.ensureSectionLoaded?.('calls', { force: true });
        }
        if (!settlements.length) {
          await window.BremStorage?.ensureSectionLoaded?.('settlements', { force: true });
        }
      } catch (error) {
        console.warn('[driver-mgmt] calls/settlements load failed:', error);
      }
    })();
    try {
      await state.statsLoadPromise;
    } finally {
      state.statsLoadPromise = null;
    }
  }

  async function refreshOrgMemberPanel() {
    await ensureDriverMgmtStatsLoaded();
    renderOrgMemberPanel();
  }

  function buildLocalWeeklyRanking(region, weekStart, platform) {
    if (!region) return [];
    return driversInRegion(region)
      .map(driver => {
        const stats = driverCallAndFee(driver.id, weekStart, platform);
        return {
          driverId: driver.id,
          name: driver.name || '-',
          callCount: Number(stats.callCount || 0)
        };
      })
      .filter(row => row.callCount > 0)
      .sort((a, b) => b.callCount - a.callCount || String(a.name).localeCompare(String(b.name), 'ko'))
      .slice(0, 10)
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }

  function descendantNodeIds(rootId) {
    const ids = [];
    const queue = [rootId];
    const seen = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      childrenOf(id).forEach(child => queue.push(child.id));
    }
    return ids;
  }

  function collectSubtreeMemberEntries(rootNode) {
    if (!rootNode) return [];
    const entries = [];
    descendantNodeIds(rootNode.id).forEach(nodeId => {
      const node = state.org.nodes.find(item => item.id === nodeId);
      if (!node) return;
      (node.memberRefs || []).forEach(ref => {
        entries.push({
          kind: ref.kind === 'admin' ? 'admin' : 'driver',
          id: ref.id,
          nodeId: node.id,
          boxLabel: node.label || '이름 없음',
          isDirect: node.id === rootNode.id
        });
      });
    });
    return entries;
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
    const foot = $('#driverOrgMemberFoot');
    const title = $('#driverOrgMemberPanelTitle');
    const summary = $('#driverOrgMemberPanelSummary');
    const totalsEl = $('#driverOrgWeekTotals');
    if (!panel || !rows) return;

    const node = selectedNode();
    if (!node) {
      panel.hidden = true;
      rows.innerHTML = '';
      if (foot) foot.innerHTML = '';
      if (totalsEl) totalsEl.textContent = '';
      return;
    }

    panel.hidden = false;
    renderOrgWeekControls();
    if (title) title.textContent = `「${node.label}」 소속 목록 (하위 포함)`;

    const entries = collectSubtreeMemberEntries(node);
    let totalCoupangCalls = 0;
    let totalBaeminCalls = 0;
    let totalFee = 0;
    const countedDrivers = new Set();
    const people = entries.map(entry => {
      if (entry.kind === 'admin') {
        const resolved = resolveOrgMemberName(entry);
        return {
          kind: '관리자',
          name: resolved?.name || '관리자',
          boxLabel: entry.boxLabel,
          coupangCalls: '-',
          baeminCalls: '-',
          deliveryFee: '-',
          nodeId: entry.nodeId,
          memberKind: 'admin',
          memberId: entry.id
        };
      }
      const resolved = resolveOrgMemberName(entry);
      const coupang = driverCallAndFee(entry.id, ensureWeek(), 'coupang');
      const baemin = driverCallAndFee(entry.id, ensureWeek(), 'baemin');
      const deliveryFee = coupang.deliveryFee + baemin.deliveryFee;
      if (!countedDrivers.has(entry.id)) {
        countedDrivers.add(entry.id);
        totalCoupangCalls += coupang.callCount;
        totalBaeminCalls += baemin.callCount;
        totalFee += deliveryFee;
      }
      return {
        kind: '기사',
        name: resolved?.name || '이름 없음',
        boxLabel: entry.boxLabel,
        coupangCalls: formatNumber(coupang.callCount),
        baeminCalls: formatNumber(baemin.callCount),
        deliveryFee: `${formatNumber(deliveryFee)}원`,
        nodeId: entry.nodeId,
        memberKind: 'driver',
        memberId: entry.id
      };
    });

    if (summary) {
      const driverCount = entries.filter(ref => ref.kind !== 'admin').length;
      const adminCount = entries.length - driverCount;
      const directCount = entries.filter(ref => ref.isDirect).length;
      summary.textContent = `기사 ${driverCount}명 · 관리자 ${adminCount}명 · 직속 ${directCount}명 (하위 포함)`;
    }

    if (totalsEl) {
      const totalCalls = totalCoupangCalls + totalBaeminCalls;
      const settlementCount = (window.BremStorage?.settlements?.getAll?.() || []).length;
      totalsEl.textContent = settlementCount
        ? `쿠팡콜 ${formatNumber(totalCoupangCalls)} · 배민콜 ${formatNumber(totalBaeminCalls)} · 콜수합계 ${formatNumber(totalCalls)} · 배달료합계 ${formatNumber(totalFee)}원`
        : `쿠팡콜 ${formatNumber(totalCoupangCalls)} · 배민콜 ${formatNumber(totalBaeminCalls)} · 콜수합계 ${formatNumber(totalCalls)} · 배달료합계 0원 (일정산 데이터 로딩 중/없음)`;
    }

    rows.innerHTML = people.length
      ? people.map(person => `
        <tr>
          <td>${escapeHtml(person.kind)}</td>
          <td><strong>${escapeHtml(person.name)}</strong></td>
          <td>${escapeHtml(person.boxLabel)}</td>
          <td class="weekly-amount-cell">${escapeHtml(person.coupangCalls)}</td>
          <td class="weekly-amount-cell">${escapeHtml(person.baeminCalls)}</td>
          <td class="weekly-amount-cell">${escapeHtml(person.deliveryFee)}</td>
          <td>
            <button type="button" class="small-btn danger"
              data-org-unassign-node="${escapeHtml(person.nodeId)}"
              data-org-unassign-kind="${escapeHtml(person.memberKind)}"
              data-org-unassign-id="${escapeHtml(person.memberId)}">체크해제</button>
          </td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="empty">소속된 인원이 없습니다. 오른쪽에서 기사·관리자를 체크하세요.</td></tr>';

    if (foot) {
      foot.innerHTML = people.length
        ? `<tr class="driver-org-total-row">
            <td></td>
            <td class="driver-org-total-label">총합계</td>
            <td></td>
            <td class="weekly-amount-cell">${formatNumber(totalCoupangCalls)}</td>
            <td class="weekly-amount-cell">${formatNumber(totalBaeminCalls)}</td>
            <td class="weekly-amount-cell">${formatNumber(totalFee)}원</td>
            <td></td>
          </tr>`
        : '';
    }
  }

  async function unassignOrgMember(nodeId, kind, memberId) {
    const node = state.org.nodes.find(item => item.id === nodeId);
    if (!node) return;
    const nextKind = kind === 'admin' ? 'admin' : 'driver';
    const before = (node.memberRefs || []).length;
    node.memberRefs = (node.memberRefs || []).filter(ref => !(ref.kind === nextKind && ref.id === memberId));
    if (node.memberRefs.length === before) return;
    try {
      await window.BremStorage.driverOrgChart.save(state.org);
      showToast('박스에서 제외했습니다.');
      loadOrg();
      renderOrg();
    } catch (error) {
      showToast(error.message || '제외에 실패했습니다.');
    }
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
    if (state.tab === 'org-list') renderOrgList();
  }

  const missingOrgDriverHydrate = new Set();
  const missingOrgDriverFailed = new Set();
  const missingOrgDriverNames = new Map();

  function resolveOrgMemberName(ref) {
    if (!ref?.id) return null;
    if (ref.kind === 'admin') {
      const account = window.BremStorage?.auth?.getAdminAccountById?.(ref.id)
        || (window.BremStorage?.auth?.getAdminAccounts?.() || []).find(item => item.id === ref.id);
      return {
        kind: 'admin',
        name: account?.name || account?.loginId || '관리자'
      };
    }
    const id = String(ref.id || '').trim();
    const driver = window.BremStorage?.drivers?.getById?.(id);
    if (driver?.name) {
      return { kind: 'driver', name: driver.name };
    }
    if (driver) {
      return { kind: 'driver', name: makeDriverLoginId(driver) || '이름 없음' };
    }
    if (missingOrgDriverNames.has(id)) {
      return { kind: 'driver', name: missingOrgDriverNames.get(id) };
    }
    // 일정산에 남은 이름 (중복제거로 drivers 목록에서 빠졌거나 세션 캐시에 없을 때)
    const settlementRow = (window.BremStorage?.settlements?.getAll?.() || [])
      .find(row => String(row.driverId || '').trim() === id);
    const settlementName = String(
      settlementRow?.driverName || settlementRow?.rawData?.driverName || ''
    ).trim();
    if (settlementName) {
      missingOrgDriverNames.set(id, settlementName);
      return { kind: 'driver', name: settlementName };
    }
    if (missingOrgDriverFailed.has(id)) {
      return { kind: 'driver', name: '삭제된 기사' };
    }
    void hydrateMissingOrgDriverName(id);
    return { kind: 'driver', name: '이름 불러오는 중…' };
  }

  async function hydrateMissingOrgDriverName(driverId) {
    const id = String(driverId || '').trim();
    if (!id || missingOrgDriverHydrate.has(id) || missingOrgDriverFailed.has(id) || missingOrgDriverNames.has(id)) {
      return;
    }
    missingOrgDriverHydrate.add(id);
    try {
      const driver = await window.BremStorage?.drivers?.fetchById?.(id, { force: true });
      const name = String(driver?.name || '').trim()
        || (driver ? (makeDriverLoginId(driver) || '') : '');
      if (name) {
        // getById 가 중복제거로 비어도 이름은 캐시에 고정 — 재조회 루프 방지
        missingOrgDriverNames.set(id, name);
      } else {
        missingOrgDriverFailed.add(id);
        missingOrgDriverNames.set(id, '삭제된 기사');
      }
      if (state.tab === 'org' || state.tab === 'org-list') {
        renderOrgMemberPanel();
        if (state.tab === 'org-list') renderOrgList();
      }
    } catch (error) {
      missingOrgDriverFailed.add(id);
      missingOrgDriverNames.set(id, '삭제된 기사');
      console.warn('[driver-mgmt] org driver name hydrate failed:', id, error);
      if (state.tab === 'org' || state.tab === 'org-list') renderOrgMemberPanel();
    } finally {
      missingOrgDriverHydrate.delete(id);
    }
  }

  function renderOrgListNodeHtml(node) {
    const members = (node.memberRefs || [])
      .map(resolveOrgMemberName)
      .filter(item => item?.name)
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'admin' ? -1 : 1;
        return String(a.name).localeCompare(String(b.name), 'ko');
      });
    const kids = childrenOf(node.id);
    const peopleHtml = members.length
      ? `<ul class="driver-org-list-node__people">${members.map(person => `
          <li class="driver-org-list-chip${person.kind === 'admin' ? ' driver-org-list-chip--admin' : ''}">
            ${person.kind === 'admin' ? '<span class="driver-org-list-chip__kind">관리</span>' : ''}
            <span>${escapeHtml(person.name)}</span>
          </li>`).join('')}</ul>`
      : '<p class="driver-org-list-node__empty-people">소속 인원 없음</p>';
    const childrenHtml = kids.length
      ? `<div class="driver-org-list-node__children">${kids.map(renderOrgListNodeHtml).join('')}</div>`
      : '';
    return `
      <section class="driver-org-list-node">
        <div class="driver-org-list-node__head">
          <h3 class="driver-org-list-node__title">${escapeHtml(node.label || '이름 없음')}</h3>
          <span class="driver-org-list-node__meta">인원 ${members.length} · 하위 ${kids.length}</span>
        </div>
        <div class="driver-org-list-node__body">
          ${peopleHtml}
          ${childrenHtml}
        </div>
      </section>`;
  }

  function renderOrgList() {
    const root = $('#driverOrgListRoot');
    const summary = $('#driverOrgListSummary');
    if (!root) return;
    loadOrg();
    const top = roots();
    if (!top.length) {
      root.innerHTML = '<p class="driver-org-list__empty">조직도 박스가 없습니다. 「조직도」에서 루트 박스를 추가하세요.</p>';
      if (summary) summary.textContent = '박스 0 · 배정 인원 0명';
      return;
    }

    let boxCount = 0;
    let memberCount = 0;
    const seenMembers = new Set();
    state.org.nodes.forEach(node => {
      boxCount += 1;
      (node.memberRefs || []).forEach(ref => {
        const key = `${ref.kind}:${ref.id}`;
        if (seenMembers.has(key)) return;
        seenMembers.add(key);
        memberCount += 1;
      });
    });
    if (summary) {
      summary.textContent = `박스 ${formatNumber(boxCount)} · 배정 인원 ${formatNumber(memberCount)}명 · 루트 ${formatNumber(top.length)}`;
    }
    root.innerHTML = `<div class="driver-org-list">${top.map(renderOrgListNodeHtml).join('')}</div>`;
  }

  function selectedNode() {
    return state.org.nodes.find(node => node.id === state.selectedNodeId) || null;
  }

  function allPeople() {
    const utils = window.BremDriverUtils;
    const drivers = (window.BremStorage?.drivers?.getAll?.() || []).map(driver => {
      const loginId = makeDriverLoginId(driver);
      const coupangErp = utils?.getErpCoupangId?.(driver) || loginId;
      const baeminId = String(driver.baeminId || '').trim();
      return {
        kind: 'driver',
        id: driver.id,
        label: `${driver.name} · ${loginId}${baeminId ? ` · 배민 ${baeminId}` : ''}${coupangErp && coupangErp !== loginId ? ` · 쿠팡 ${coupangErp}` : ''}`,
        search: `${driver.name} ${loginId} ${baeminId} ${coupangErp} ${driver.phone || ''}`
      };
    });
    const admins = (window.BremStorage?.auth?.getAdminAccounts?.() || []).map(account => ({
      kind: 'admin',
      id: account.id,
      label: `${account.name || account.loginId || account.id} · 관리자${account.role ? ` (${account.role})` : ''}`,
      search: `${account.name || ''} ${account.loginId || ''} ${account.id}`
    }));
    return [...admins, ...drivers];
  }

  function normalizeOrgErpCell(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
    let raw = String(value).trim().replace(/\s+/g, '');
    if (!raw) return '';
    if (/^\d+\.0+$/.test(raw)) raw = raw.replace(/\.0+$/, '');
    return raw;
  }

  function normalizeOrgHeaderKey(value) {
    return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  }

  function isOrgErpHeader(value) {
    const h = normalizeOrgHeaderKey(value);
    if (!h) return false;
    return /^(erpid|erp아이디|비고|배민id|쿠팡id|로그인id|아이디|id)$/.test(h)
      || h.includes('erpid')
      || h === 'erp'
      || h.includes('배민아이디')
      || h.includes('쿠팡아이디');
  }

  /**
   * BREM ERP ID 매칭 (일정산/최종입금 비고와 동일 우선순위)
   * 1) 이름+전화뒤4 (makeDriverLoginId)
   * 2) 쿠팡 ERP ID (getErpCoupangId / 이름+전체전화 셀)
   * 3) 배민 ID
   * 4) 관리자 로그인ID
   */
  function matchPersonByErpId(rawId, drivers, admins) {
    const raw = normalizeOrgErpCell(rawId);
    if (!raw) return null;
    const utils = window.BremDriverUtils;
    const loginKey = raw.toLowerCase();

    const byErpLogin = (drivers || []).find(driver => {
      const loginId = String(makeDriverLoginId(driver) || '').replace(/\s/g, '').toLowerCase();
      return loginId && loginId === loginKey;
    });
    if (byErpLogin?.id) return { kind: 'driver', id: byErpLogin.id, via: 'erp' };

    const byCoupang = utils?.matchDriverByCoupangErpId?.(raw, drivers);
    if (byCoupang?.id) return { kind: 'driver', id: byCoupang.id, via: 'coupang' };

    const parsed = utils?.buildCoupangErpIdFromCell?.(raw);
    const loginIds = Array.isArray(parsed?.loginIds) ? parsed.loginIds : [];
    for (const lid of loginIds) {
      const key = normalizeOrgErpCell(lid).toLowerCase();
      if (!key) continue;
      const hit = utils?.matchDriverByCoupangErpId?.(lid, drivers)
        || (drivers || []).find(driver => {
          const loginId = String(makeDriverLoginId(driver) || '').replace(/\s/g, '').toLowerCase();
          const erp = String(utils?.getErpCoupangId?.(driver) || '').replace(/\s/g, '').toLowerCase();
          return loginId === key || erp === key;
        });
      if (hit?.id) return { kind: 'driver', id: hit.id, via: 'coupang' };
    }

    const byErpCi = (drivers || []).find(driver => {
      const erp = String(utils?.getErpCoupangId?.(driver) || '').replace(/\s/g, '').toLowerCase();
      return erp && erp === loginKey;
    });
    if (byErpCi?.id) return { kind: 'driver', id: byErpCi.id, via: 'coupang' };

    const byBaemin = utils?.matchDriverByBaeminErpId?.(raw, drivers);
    if (byBaemin?.id) return { kind: 'driver', id: byBaemin.id, via: 'baemin' };

    const admin = (admins || []).find(account => {
      const adminLogin = String(account.loginId || '').replace(/\s/g, '').toLowerCase();
      return adminLogin === loginKey || String(account.id || '') === raw;
    });
    if (admin?.id) return { kind: 'admin', id: admin.id, via: 'admin' };
    return null;
  }

  function extractOrgErpIdsFromRows(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];
    const header = rows[0] || [];
    let col = 0;
    let start = 0;
    let headerHit = -1;
    for (let i = 0; i < header.length; i += 1) {
      if (isOrgErpHeader(header[i])) {
        headerHit = i;
        break;
      }
    }
    if (headerHit >= 0) {
      col = headerHit;
      start = 1;
    } else if (isOrgErpHeader(rows[0]?.[0])) {
      start = 1;
    }

    const ids = [];
    const seen = new Set();
    for (const row of rows.slice(start)) {
      const id = normalizeOrgErpCell(row?.[col]);
      if (!id || isOrgErpHeader(id)) continue;
      const key = id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(id);
    }
    return ids;
  }

  function downloadOrgMemberTemplate() {
    if (!window.XLSX) {
      showToast('엑셀 모듈을 불러오지 못했습니다.');
      return;
    }
    const ws = window.XLSX.utils.aoa_to_sheet([
      ['ERP ID'],
      ['홍길동1234'],
      ['BC000001']
    ]);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, '조직도일괄');
    window.XLSX.writeFile(wb, 'BREM_조직도_ERP_ID_일괄등록.xlsx');
  }

  function isOrgExcelFile(file) {
    if (!file) return false;
    const name = String(file.name || '').toLowerCase();
    return /\.(xlsx|xls|csv)$/.test(name)
      || /sheet|excel|csv/.test(String(file.type || '').toLowerCase());
  }

  async function applyOrgMemberBulkExcel(file, options = {}) {
    const targetId = String(options.nodeId || state.selectedNodeId || '').trim();
    if (targetId && targetId !== state.selectedNodeId) {
      state.selectedNodeId = targetId;
      renderOrg();
    }
    const node = selectedNode();
    if (!node) {
      showToast('조직도 박스를 선택하거나, 박스 위에 엑셀을 놓으세요.');
      return;
    }
    if (!window.XLSX) throw new Error('엑셀 모듈을 불러오지 못했습니다.');
    if (!isOrgExcelFile(file)) {
      showToast('xlsx / xls / csv 파일만 올릴 수 있습니다.');
      return;
    }

    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    if (!rows.length) {
      showToast('엑셀에 데이터가 없습니다.');
      return;
    }

    const ids = extractOrgErpIdsFromRows(rows);
    if (!ids.length) {
      showToast('ERP ID 열을 찾지 못했습니다. A열 ERP ID 또는 「비고」열을 확인하세요.');
      return;
    }

    const drivers = window.BremStorage?.drivers?.getAll?.() || [];
    const admins = window.BremStorage?.auth?.getAdminAccounts?.() || [];
    const next = new Map((node.memberRefs || []).map(ref => [`${ref.kind}:${ref.id}`, ref]));
    let matched = 0;
    let already = 0;
    const missing = [];
    ids.forEach(id => {
      const hit = matchPersonByErpId(id, drivers, admins);
      if (!hit) {
        missing.push(id);
        return;
      }
      const key = `${hit.kind}:${hit.id}`;
      if (next.has(key)) {
        already += 1;
        return;
      }
      next.set(key, { kind: hit.kind, id: hit.id });
      matched += 1;
    });

    node.memberRefs = [...next.values()];
    state.memberSearch = '';
    const searchInput = $('#driverOrgMemberSearch');
    if (searchInput) searchInput.value = '';
    const summary = $('#driverOrgMemberBulkSummary');
    const summaryText = `체크 ${matched}명 · 이미선택 ${already}명 · 미매칭 ${missing.length}명 / 총 ${ids.length}건`;
    if (summary) summary.textContent = summaryText;
    renderOrg();
    if (missing.length && missing.length <= 8) {
      showToast(`${summaryText} · 미매칭: ${missing.join(', ')}`);
    } else {
      showToast(`${summaryText}. 저장하려면 「조직도 저장」을 누르세요.`);
    }
  }

  function clearOrgFileDragStyles() {
    $('#driverOrgCanvasWrap')?.classList.remove('is-file-dragover');
    $$('.driver-org-node.is-file-dragover').forEach(el => el.classList.remove('is-file-dragover'));
  }

  /** 조직도 캔버스·박스 위에 엑셀 드롭 → 그 박스에 ERP ID 일괄 체크 */
  function bindOrgChartExcelDrop() {
    const wrap = $('#driverOrgCanvasWrap');
    if (!wrap || wrap.dataset.excelDropBound === '1') return;
    wrap.dataset.excelDropBound = '1';

    wrap.addEventListener('dragenter', event => {
      if (![...event.dataTransfer?.types || []].includes('Files')) return;
      event.preventDefault();
      wrap.classList.add('is-file-dragover');
    });
    wrap.addEventListener('dragover', event => {
      if (![...event.dataTransfer?.types || []].includes('Files')) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      wrap.classList.add('is-file-dragover');
      const nodeBtn = event.target.closest?.('[data-org-node]');
      $$('.driver-org-node.is-file-dragover').forEach(el => {
        if (el !== nodeBtn) el.classList.remove('is-file-dragover');
      });
      nodeBtn?.classList.add('is-file-dragover');
    });
    wrap.addEventListener('dragleave', event => {
      if (!wrap.contains(event.relatedTarget)) clearOrgFileDragStyles();
    });
    wrap.addEventListener('drop', event => {
      if (![...event.dataTransfer?.types || []].includes('Files')) return;
      event.preventDefault();
      const nodeBtn = event.target.closest?.('[data-org-node]');
      const nodeId = nodeBtn?.dataset?.orgNode || state.selectedNodeId || '';
      clearOrgFileDragStyles();
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      void applyOrgMemberBulkExcel(file, { nodeId })
        .catch(error => showToast(error.message || '엑셀 일괄등록 실패'));
    });
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
      // 체크된 인원을 위로 — 일괄등록 직후 바로 보이게
      const people = allPeople()
        .filter(person => !q || person.search.toLowerCase().includes(q))
        .sort((a, b) => {
          const ak = selected.has(`${a.kind}:${a.id}`) ? 0 : 1;
          const bk = selected.has(`${b.kind}:${b.id}`) ? 0 : 1;
          if (ak !== bk) return ak - bk;
          return String(a.label).localeCompare(String(b.label), 'ko');
        });
      const selectedPeople = people.filter(person => selected.has(`${person.kind}:${person.id}`));
      const rest = people.filter(person => !selected.has(`${person.kind}:${person.id}`)).slice(0, 200);
      const visible = [...selectedPeople, ...rest];
      list.innerHTML = visible
        .map(person => {
          const key = `${person.kind}:${person.id}`;
          const checked = selected.has(key);
          return `<label class="${checked ? 'is-org-checked' : ''}">
            <input type="checkbox" data-org-member-kind="${person.kind}" data-org-member-id="${escapeHtml(person.id)}"${checked ? ' checked' : ''}>
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
    const parent = String(parentId || '').trim();
    const siblings = parent
      ? childrenOf(parent)
      : roots();
    const node = {
      id: createId(),
      label: parent ? `하위 ${siblings.length + 1}` : (siblings.length ? `루트 ${siblings.length + 1}` : '루트'),
      parentId: parent,
      memberRefs: [],
      sortOrder: state.org.nodes.length
    };
    state.org.nodes.push(node);
    // 하위 추가 후에도 부모를 선택 유지 → 연속 추가 시 옆으로(형제) 붙는다.
    // (새 박스를 선택하면 그다음 추가가 또 그 아래로만 깊어졌다.)
    state.selectedNodeId = parent || node.id;
    renderOrg();
  }

  /** 선택 박스 위에 새 상위 박스를 끼워 넣음 (선택 박스는 그 하위가 됨) */
  function addParentAboveSelected() {
    const node = selectedNode();
    if (!node) {
      showToast('박스를 먼저 선택하세요.');
      return;
    }
    const oldParentId = String(node.parentId || '').trim();
    const parent = {
      id: createId(),
      label: '상위',
      parentId: oldParentId,
      memberRefs: [],
      sortOrder: Number.isFinite(Number(node.sortOrder)) ? Number(node.sortOrder) : state.org.nodes.length
    };
    state.org.nodes.push(parent);
    node.parentId = parent.id;
    state.selectedNodeId = parent.id;
    renderOrg();
    showToast('상위 박스를 추가했습니다. 이름을 바꾼 뒤 「조직도 저장」하세요.');
  }

  /** 선택 박스를 부모와 같은 단계(한 단계 위)로 올림 */
  function moveSelectedNodeUp() {
    const node = selectedNode();
    if (!node) {
      showToast('박스를 먼저 선택하세요.');
      return;
    }
    const parentId = String(node.parentId || '').trim();
    if (!parentId) {
      showToast('이미 최상위 박스입니다.');
      return;
    }
    const parent = state.org.nodes.find(item => item.id === parentId);
    if (!parent) {
      node.parentId = '';
      renderOrg();
      return;
    }
    node.parentId = String(parent.parentId || '').trim();
    node.sortOrder = Number.isFinite(Number(parent.sortOrder))
      ? Number(parent.sortOrder) + 0.001
      : state.org.nodes.length;
    renderOrg();
    showToast(`「${node.label}」을(를) 한 단계 올렸습니다. 저장하려면 「조직도 저장」을 누르세요.`);
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

  function isRegionExposed(platform, key) {
    const side = state.regionExposure?.[platform] || {};
    return Boolean(side[key]?.exposed);
  }

  /** 기사별 옵션: full=올노출, dashboard=전체열람, metrics=할당만, leader=팀장, hidden=미노출 */
  function normalizeDriverRegionMode(value) {
    const mode = String(value || '').toLowerCase();
    if (mode === 'dashboard' || mode === 'view' || mode === '전체열람') return 'dashboard';
    if (mode === 'metrics' || mode === 'quota' || mode === '할당만') return 'metrics';
    if (mode === 'leader' || mode === 'team_leader' || mode === '팀장') return 'leader';
    if (mode === 'hidden' || mode === 'off' || mode === 'none' || mode === '미노출') return 'hidden';
    return 'full';
  }

  function getDriverRegionMode(platform, regionKey, driverId) {
    return normalizeDriverRegionMode(
      state.regionExposure?.[platform]?.[regionKey]?.riders?.[driverId]?.mode
    );
  }

  async function loadRegionExposure() {
    try {
      const token = await window.BremStorage?.resolveAdminAccessToken?.();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/api/admin/rider-dashboard/region-exposure', {
        headers,
        credentials: 'same-origin'
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '노출 설정을 불러오지 못했습니다.');
      state.regionExposure = {
        baemin: payload.exposure?.baemin || {},
        coupang: payload.exposure?.coupang || {}
      };
    } catch (error) {
      console.warn('[BREM] region exposure:', error);
      state.regionExposure = { baemin: {}, coupang: {} };
    }
  }

  async function postRegionExposure(body) {
    const token = await window.BremStorage?.resolveAdminAccessToken?.();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
    const res = await fetch('/api/admin/rider-dashboard/region-exposure', {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || '노출 설정 저장에 실패했습니다.');
    state.regionExposure = {
      baemin: payload.exposure?.baemin || {},
      coupang: payload.exposure?.coupang || {}
    };
    return payload;
  }

  async function setRegionExposure(region, exposed) {
    if (!region) return;
    await postRegionExposure({
      platform: region.platform,
      key: region.key,
      exposed: exposed === true,
      label: region.label,
      partnerId: region.partnerId || '',
      vendorId: region.vendorId || ''
    });
  }

  async function setDriverRegionMode(region, driverId, mode) {
    if (!region || !driverId) return;
    await postRegionExposure({
      platform: region.platform,
      key: region.key,
      driverId,
      mode: normalizeDriverRegionMode(mode),
      exposed: isRegionExposed(region.platform, region.key),
      label: region.label,
      partnerId: region.partnerId || '',
      vendorId: region.vendorId || ''
    });
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
        return value === region.label
          || value === region.partnerId
          || value === region.key
          || (region.partnerId && value.includes(region.partnerId));
      }
      return shortCoupangRegion(value) === region.key
        || shortCoupangRegion(value) === shortCoupangRegion(region.label)
        || value === region.vendorName
        || value === region.vendorId;
    });
  }

  /** 서버 메모의 「지역등록 N명」을 로컬(사이드바) 집계와 같은 숫자로 맞춘다. */
  function alignRegionRegisteredNote(sourceNote, region) {
    const localN = region ? driversInRegion(region).length : 0;
    const base = String(sourceNote || '');
    if (!base) return localN ? `지역등록 ${localN}명` : '';
    if (/지역등록\s*\d+명/.test(base)) {
      return base.replace(/지역등록\s*\d+명/, `지역등록 ${localN}명`);
    }
    return `${base} · 지역등록 ${localN}명`;
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
      const exposed = isRegionExposed(region.platform, region.key);
      const sub = region.platform === 'baemin' ? region.partnerId : (region.vendorName || '');
      const name = region.label || region.key || '이름 없음';
      return `<div class="driver-region-item${active ? ' is-active' : ''}${exposed ? ' is-exposed' : ''}" data-region-key="${escapeHtml(region.key)}">
        <button type="button" class="driver-region-item-main" data-region-select="${escapeHtml(region.key)}" title="${escapeHtml(sub || name)}">
          <span class="driver-region-item-name">${escapeHtml(name)}</span>
          <span class="driver-region-item-meta">${escapeHtml(sub && sub !== name ? sub : '')}</span>
          <span class="driver-region-item-count">${count}명</span>
        </button>
        <label class="driver-region-expose" title="기사앱 기사대시보드 노출">
          <input type="checkbox" data-region-expose="${escapeHtml(region.key)}" ${exposed ? 'checked' : ''}>
          <span>라이더 노출</span>
        </label>
      </div>`;
    }).join('');
  }

  /** 기사 sync 중에는 표 전체를 다시 그리지 않고 인원 수만 갱신한다. */
  function updateRegionCatalogCounts() {
    $$('#driverRegionCatalog .driver-region-item').forEach(el => {
      const key = el.dataset.regionKey;
      const region = regionCatalog().find(item => item.key === key);
      if (!region) return;
      const countEl = el.querySelector('.driver-region-item-count');
      if (countEl) countEl.textContent = `${driversInRegion(region).length}명`;
    });
  }

  function scheduleRegionDetailSoftRefresh() {
    if (state.regionDetailSyncTimer) clearTimeout(state.regionDetailSyncTimer);
    state.regionDetailSyncTimer = setTimeout(() => {
      state.regionDetailSyncTimer = null;
      if (state.tab !== 'region') return;
      if (!selectedRegion()) return;
      if (!isDriverManagementSectionActive()) return;
      // 노출 옵션·추가 입력 중이면 표 재생성 보류
      const active = document.activeElement;
      if (active?.matches?.('[data-region-rider-mode], [data-region-expose], #driverRegionAddInput, #driverRegionListFilter')) {
        scheduleRegionDetailSoftRefresh();
        return;
      }
      renderRegionDetail();
    }, 900);
  }

  function clearRegionRankingUi(message = '') {
    const panels = $('#driverRegionRankPanels');
    if (panels) panels.hidden = true;
    const realtimeList = $('#driverRegionRealtimeList');
    const weeklyList = $('#driverRegionWeeklyList');
    const realtimeFirst = $('#driverRegionRealtimeFirst');
    const weeklyFirst = $('#driverRegionWeeklyFirst');
    const realtimeNote = $('#driverRegionRealtimeNote');
    const weeklyNote = $('#driverRegionWeeklyNote');
    const metricsEl = $('#driverRegionLiveMetrics');
    const metricsNote = $('#driverRegionMetricsNote');
    if (realtimeList) realtimeList.innerHTML = '';
    if (weeklyList) weeklyList.innerHTML = '';
    if (realtimeFirst) realtimeFirst.textContent = '—';
    if (weeklyFirst) weeklyFirst.textContent = '—';
    if (realtimeNote) realtimeNote.textContent = message || '';
    if (weeklyNote) weeklyNote.textContent = '';
    if (metricsEl) metricsEl.hidden = true;
    if (metricsNote) metricsNote.textContent = '';
    ['driverRegionMetricAssigned', 'driverRegionMetricOperating', 'driverRegionMetricRemaining']
      .forEach(id => {
        const el = $(`#${id}`);
        if (el) el.textContent = '-';
      });
    state.regionRanking = null;
    state.regionRankingKey = '';
  }

  function renderRankList(el, rows, emptyText = '집계된 순위가 없습니다.') {
    if (!el) return;
    if (!rows?.length) {
      el.innerHTML = `<li class="empty">${escapeHtml(emptyText)}</li>`;
      return;
    }
    el.innerHTML = rows.map(row => {
      const rank = Number(row.rank || 0) || 0;
      const top = rank === 1 ? ' is-top' : '';
      return `<li class="${top.trim()}">
        <span class="driver-region-rank__n">${rank || '-'}</span>
        <span class="driver-region-rank__name">${escapeHtml(row.name || '-')}</span>
        <span class="driver-region-rank__count">${formatNumber(row.callCount || 0)}콜</span>
      </li>`;
    }).join('');
  }

  function renderRegionRankingUi(payload) {
    const panels = $('#driverRegionRankPanels');
    if (!panels) return;
    panels.hidden = false;
    const metrics = payload?.metrics || {};
    const metricsEl = $('#driverRegionLiveMetrics');
    const metricsNote = $('#driverRegionMetricsNote');
    const hasMetrics = Number(metrics.assigned || 0) > 0
      || Number(metrics.operating || 0) > 0
      || Number(metrics.remaining || 0) > 0
      || Boolean(metrics.sourceNote)
      || typeof metrics.progressLabel === 'string';
    if (metricsEl) {
      metricsEl.hidden = !hasMetrics;
      const a = $('#driverRegionMetricAssigned');
      const o = $('#driverRegionMetricOperating');
      const r = $('#driverRegionMetricRemaining');
      // 배민: 콜달성과 동일하게 완료/할당. 쿠팡 등은 assigned 숫자만.
      const assignedLabel = $('#driverRegionMetricAssignedLabel');
      const hasProgress = typeof metrics.progressLabel === 'string';
      if (assignedLabel) assignedLabel.textContent = hasProgress ? '완료/할당' : '할당';
      if (a) a.textContent = hasProgress ? metrics.progressLabel : formatNumber(metrics.assigned);
      if (o) o.textContent = formatNumber(metrics.operating);
      if (r) r.textContent = formatNumber(metrics.remaining);
    }
    if (metricsNote) {
      metricsNote.textContent = alignRegionRegisteredNote(metrics.sourceNote || '', selectedRegion());
    }

    const realtimeDisabled = payload?.realtimeRankingDisabled === true;
    const realtime = realtimeDisabled ? [] : (payload?.realtimeRanking || []);
    const weekly = payload?.weeklyRanking || [];
    renderRankList(
      $('#driverRegionRealtimeList'),
      realtime,
      realtimeDisabled
        ? (payload.realtimeRankingReason || '쿠팡은 실시간 기사별 순위를 집계하지 않습니다.')
        : '집계된 순위가 없습니다.'
    );
    renderRankList($('#driverRegionWeeklyList'), weekly);
    const rf = payload?.realtimeFirst || realtime[0] || null;
    const wf = payload?.weeklyFirst || weekly[0] || null;
    const realtimeFirst = $('#driverRegionRealtimeFirst');
    const weeklyFirst = $('#driverRegionWeeklyFirst');
    if (realtimeFirst) {
      realtimeFirst.textContent = realtimeDisabled
        ? '해당없음'
        : (rf ? `1등 ${rf.name} · ${formatNumber(rf.callCount || 0)}콜` : '1등 —');
    }
    if (weeklyFirst) {
      weeklyFirst.textContent = wf
        ? `1등 ${wf.name} · ${formatNumber(wf.callCount || 0)}콜`
        : '1등 —';
    }
    const realtimeNote = $('#driverRegionRealtimeNote');
    const weeklyNote = $('#driverRegionWeeklyNote');
    if (realtimeNote) {
      if (realtimeDisabled) {
        realtimeNote.textContent = payload.realtimeRankingReason
          || '쿠팡 실시간 콜수는 0.8 가중치라 기사별 순위가 불가합니다.';
      } else {
        const note = alignRegionRegisteredNote(metrics.sourceNote || '', selectedRegion());
        realtimeNote.textContent = realtime.length
          ? `오늘(${payload.today || ''}) 크롤링 · 지역 등록 기사만 · ${note}`
          : `오늘(${payload.today || ''}) · 지역 등록 기사와 매칭된 실시간 콜이 없습니다. 운행현황 수집·지역 등록을 확인하세요.`;
      }
    }
    if (weeklyNote) {
      weeklyNote.textContent = weekly.length
        ? `${formatWeekRange(payload.weekStart)} · 지역 등록 기사 · 콜수 입력 기준`
        : `${formatWeekRange(payload.weekStart)} · 이 지역 등록 기사의 콜수 입력이 없으면 주간 순위가 비어 있습니다.`;
    }
  }

  async function loadRegionRanking() {
    const region = selectedRegion();
    if (!region) {
      clearRegionRankingUi();
      return;
    }
    const week = ensureWeek();
    const platform = state.regionPlatform === 'coupang' ? 'coupang' : 'baemin';
    const cacheKey = `${region.platform}|${region.key}|${week}`;
    const requestSeq = ++state.regionRankingRequestSeq;
    state.regionRankingBusy = true;
    const panels = $('#driverRegionRankPanels');
    if (panels) panels.hidden = false;

    // 주간 순위: 콜수 입력(로컬 calls) — 표의 콜수·1등과 동일 출처
    const weeklyRanking = buildLocalWeeklyRanking(region, week, platform);
    const today = localDateKey(new Date());
    const cached = state.regionRankingCache.get(cacheKey) || null;
    const basePayload = {
      today,
      weekStart: week,
      weekEnd: weekEndKey(week),
      metrics: cached?.metrics || {},
      realtimeRanking: cached?.realtimeRanking || [],
      realtimeRankingDisabled: platform === 'coupang'
        || cached?.realtimeRankingDisabled === true,
      realtimeRankingReason: platform === 'coupang'
        ? '쿠팡 실시간 콜수는 피크 가중치(0.8 단위)라 기사별 순위 집계가 불가합니다. 할당·운행중·남은할당만 표시합니다.'
        : (cached?.realtimeRankingReason || ''),
      weeklyRanking,
      realtimeFirst: cached?.realtimeFirst || null,
      weeklyFirst: weeklyRanking[0] || null
    };
    // 직전 실시간 값이 있으면 바로 그리고, 없으면 주간만이라도 먼저 그린다.
    renderRegionRankingUi(basePayload);

    const realtimeNote = $('#driverRegionRealtimeNote');
    const hadCachedRealtime = Boolean(cached?.metrics || cached?.realtimeRanking?.length);
    if (realtimeNote && platform !== 'coupang' && !hadCachedRealtime) {
      realtimeNote.textContent = '실시간 크롤링 순위 불러오는 중…';
    }

    try {
      const token = await window.BremStorage?.resolveAdminAccessToken?.();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const params = new URLSearchParams({
        platform: region.platform,
        regionKey: region.key,
        label: region.label || '',
        partnerId: region.partnerId || '',
        vendorId: region.vendorId || '',
        weekStart: week
      });
      const res = await fetch(`/api/admin/rider-dashboard/region-ranking?${params}`, {
        headers,
        credentials: 'same-origin'
      });
      const payload = await res.json().catch(() => ({}));
      if (requestSeq !== state.regionRankingRequestSeq) return;
      if (!res.ok) throw new Error(payload.error || '실시간 순위를 불러오지 못했습니다.');
      const merged = {
        ...basePayload,
        today: payload.today || today,
        metrics: payload.metrics || {},
        realtimeRanking: payload.realtimeRankingDisabled ? [] : (payload.realtimeRanking || []),
        realtimeRankingDisabled: payload.realtimeRankingDisabled === true || platform === 'coupang',
        realtimeRankingReason: payload.realtimeRankingReason || basePayload.realtimeRankingReason,
        realtimeFirst: payload.realtimeRankingDisabled
          ? null
          : (payload.realtimeFirst || (payload.realtimeRanking || [])[0] || null),
        weeklyRanking,
        weeklyFirst: weeklyRanking[0] || null
      };
      state.regionRanking = merged;
      state.regionRankingKey = cacheKey;
      state.regionRankingCache.set(cacheKey, merged);
      if (state.regionRankingCache.size > 40) {
        const oldest = state.regionRankingCache.keys().next().value;
        state.regionRankingCache.delete(oldest);
      }
      renderRegionRankingUi(merged);
    } catch (error) {
      if (requestSeq !== state.regionRankingRequestSeq) return;
      console.warn('[BREM] region ranking realtime:', error);
      if (realtimeNote && platform !== 'coupang' && !hadCachedRealtime) {
        realtimeNote.textContent = error.message || '실시간 순위를 불러오지 못했습니다.';
      } else if (realtimeNote && hadCachedRealtime) {
        // 이전 숫자는 유지하고 갱신 실패만 짧게 알린다.
        const prev = realtimeNote.textContent || '';
        if (!/이전 데이터/.test(prev)) {
          realtimeNote.textContent = `${prev || '이전 데이터 표시 중'} · 갱신 실패`;
        }
      }
      state.regionRanking = basePayload;
      state.regionRankingKey = cacheKey;
    } finally {
      // 더 새 요청이 이미 돌고 있으면 busy는 그쪽 finally가 내린다.
      if (requestSeq === state.regionRankingRequestSeq) {
        state.regionRankingBusy = false;
      }
    }
  }

  function renderRegionDetail() {
    const region = selectedRegion();
    const title = $('#driverRegionDetailTitle');
    const rows = $('#driverRegionRows');
    const totalsEl = $('#driverRegionWeekTotals');
    const crawlBtn = $('#driverRegionCrawlMatchBtn');
    const platform = state.regionPlatform === 'coupang' ? 'coupang' : 'baemin';
    const platformLabel = platform === 'coupang' ? '쿠팡' : '배민';
    if (crawlBtn) crawlBtn.hidden = platform !== 'baemin';
    renderWeekControls();
    if (title) {
      title.textContent = region
        ? `${region.label}${region.platform === 'baemin' ? ` (${region.partnerId})` : ''}`
        : '지역을 선택하세요';
    }
    if (!rows) return;
    if (!region) {
      rows.innerHTML = '<tr><td colspan="5" class="empty">왼쪽에서 지역을 선택하세요.</td></tr>';
      state.regionAdd.candidates = [];
      state.regionDetailDriverCount = -1;
      state.regionListFilter = '';
      resetRegionAddCombo();
      const filterInput = $('#driverRegionListFilter');
      if (filterInput) {
        filterInput.value = '';
        filterInput.disabled = true;
      }
      const filterMeta = $('#driverRegionListFilterMeta');
      if (filterMeta) filterMeta.textContent = '';
      if (totalsEl) totalsEl.textContent = '';
      clearRegionRankingUi();
      return;
    }
    const week = ensureWeek();
    const inRegion = driversInRegion(region);
    state.regionDetailDriverCount = inRegion.length;
    // 주간 콜수 기준 로컬 1등 표시(표 상단 합계와 함께)
    const ranked = inRegion.map(driver => {
      const stats = driverCallAndFee(driver.id, week, platform);
      return { driver, ...stats };
    }).sort((a, b) => b.callCount - a.callCount || String(a.driver.name || '').localeCompare(String(b.driver.name || ''), 'ko'));
    const weeklyLocalFirst = ranked.find(row => row.callCount > 0) || null;
    let totalCalls = 0;
    let totalFee = 0;
    ranked.forEach(row => {
      totalCalls += row.callCount;
      totalFee += row.deliveryFee;
    });

    const filterKey = String(state.regionListFilter || '').replace(/\s+/g, '').toLowerCase();
    const filtered = filterKey
      ? ranked.filter(row => regionAddSearchKey(row.driver).includes(filterKey))
      : ranked;
    const filterMeta = $('#driverRegionListFilterMeta');
    if (filterMeta) {
      filterMeta.textContent = ranked.length
        ? (filterKey
          ? `검색 ${filtered.length}명 / 전체 ${ranked.length}명`
          : `배정 ${ranked.length}명`)
        : '';
    }
    const filterInput = $('#driverRegionListFilter');
    if (filterInput) {
      if (document.activeElement !== filterInput && filterInput.value !== state.regionListFilter) {
        filterInput.value = state.regionListFilter;
      }
      filterInput.disabled = false;
    }

    rows.innerHTML = filtered.length
      ? filtered.map(row => {
        const isFirst = weeklyLocalFirst && row.driver.id === weeklyLocalFirst.driver.id;
        const mode = getDriverRegionMode(platform, region.key, row.driver.id);
        const rowClass = [
          isFirst ? 'is-week-first' : '',
          mode === 'dashboard' ? 'is-dashboard-only' : '',
          mode === 'metrics' ? 'is-metrics-only' : '',
          mode === 'hidden' ? 'is-dashboard-hidden' : '',
          mode === 'leader' ? 'is-region-leader' : ''
        ].filter(Boolean).join(' ');
        return `<tr${rowClass ? ` class="${rowClass}"` : ''}>
          <td><strong>${escapeHtml(row.driver.name)}</strong>${isFirst ? ' <span class="driver-region-week-crown" title="주간 콜수 1등">1등</span>' : ''}${mode === 'leader' ? ' <span class="driver-region-leader-badge" title="팀장 — 기사앱에서 할당·실시간·주간 전원 표시">팀장</span>' : ''}${mode === 'dashboard' ? ' <span class="driver-region-dash-badge" title="자기 순위 비노출 · 남 순위+할당 열람">전체열람</span>' : ''}${mode === 'metrics' ? ' <span class="driver-region-metrics-badge" title="순위 노출 · 본인 보드엔 할당만">할당만</span>' : ''}${mode === 'hidden' ? ' <span class="driver-region-hidden-badge" title="기사앱 기사대시보드 숨김">미노출</span>' : ''}</td>
          <td class="weekly-amount-cell">${formatNumber(row.callCount)}</td>
          <td class="weekly-amount-cell">${formatNumber(row.deliveryFee)}원</td>
          <td>
            <div class="driver-region-mode-group" role="group" aria-label="기사앱 노출">
              <label class="driver-region-mode${mode === 'full' ? ' is-on' : ''}" title="대시보드(할당+순위) + 본인 순위 노출">
                <input type="radio" name="region-rider-mode-${escapeHtml(row.driver.id)}" data-region-rider-mode="${escapeHtml(row.driver.id)}" value="full" ${mode === 'full' ? 'checked' : ''}>
                <span>올노출</span>
              </label>
              <label class="driver-region-mode driver-region-mode--dash${mode === 'dashboard' ? ' is-on' : ''}" title="자기 순위는 안 나오고 · 남 순위+할당은 봄 (대시보드 전체열람)">
                <input type="radio" name="region-rider-mode-${escapeHtml(row.driver.id)}" data-region-rider-mode="${escapeHtml(row.driver.id)}" value="dashboard" ${mode === 'dashboard' ? 'checked' : ''}>
                <span>전체열람</span>
              </label>
              <label class="driver-region-mode driver-region-mode--metrics${mode === 'metrics' ? ' is-on' : ''}" title="순위는 노출 · 본인 기사대시보드엔 할당만">
                <input type="radio" name="region-rider-mode-${escapeHtml(row.driver.id)}" data-region-rider-mode="${escapeHtml(row.driver.id)}" value="metrics" ${mode === 'metrics' ? 'checked' : ''}>
                <span>할당만</span>
              </label>
              <label class="driver-region-mode driver-region-mode--hidden${mode === 'hidden' ? ' is-on' : ''}" title="기사앱에서 기사대시보드 버튼을 숨깁니다">
                <input type="radio" name="region-rider-mode-${escapeHtml(row.driver.id)}" data-region-rider-mode="${escapeHtml(row.driver.id)}" value="hidden" ${mode === 'hidden' ? 'checked' : ''}>
                <span>미노출</span>
              </label>
              <button type="button" class="small-btn driver-region-leader-btn${mode === 'leader' ? ' is-on' : ''}" data-region-rider-leader="${escapeHtml(row.driver.id)}" title="${mode === 'leader' ? '팀장 해제 후 올노출로 되돌립니다' : '팀장: 기사앱에서 할당·실시간·주간콜수를 전원 기준으로 봄 (본인은 순위에 안 나옴)'}">
                ${mode === 'leader' ? '팀장해제' : '팀장임명'}
              </button>
            </div>
          </td>
          <td><button type="button" class="small-btn danger" data-region-remove="${escapeHtml(row.driver.id)}">해제</button></td>
        </tr>`;
      }).join('')
      : `<tr><td colspan="5" class="empty">${ranked.length ? '검색 결과가 없습니다.' : '이 지역에 배정된 기사가 없습니다.'}</td></tr>`;

    if (totalsEl) {
      const firstText = weeklyLocalFirst
        ? ` · 주간1등 ${weeklyLocalFirst.driver.name}(${formatNumber(weeklyLocalFirst.callCount)}콜)`
        : '';
      totalsEl.textContent = inRegion.length
        ? `${platformLabel} · ${formatWeekRange(week)} · 콜수합계 ${formatNumber(totalCalls)} · 배달료합계 ${formatNumber(totalFee)}원${firstText}`
          + (totalCalls === 0 && totalFee === 0
            ? ' · 콜수입력·일정산이 없으면 0입니다'
            : '')
        : '';
    }

    refreshRegionAddCandidates(inRegion);

    void loadRegionRanking();
  }

  // ===== 기사 추가 — 선택칸에 바로 입력해 검색하는 콤보박스 =====
  // 별도 검색칸을 만들지 않고, 「기사 선택」 칸에 이름·ID·연락처를 입력하면 후보가 좁혀진다.
  function regionAddIdLabel(driver) {
    return state.regionPlatform === 'baemin'
      ? (driver.baeminId || makeDriverLoginId(driver))
      : makeDriverLoginId(driver);
  }

  function regionAddSearchKey(driver) {
    return [
      driver.name,
      driver.baeminId,
      driver.coupangId,
      makeDriverLoginId(driver),
      String(driver.phone || '').replace(/[^0-9]/g, '')
    ].map(value => String(value || '').replace(/\s+/g, '').toLowerCase()).join('|');
  }

  function refreshRegionAddCandidates(inRegion = []) {
    const assigned = new Set(inRegion.map(driver => driver.id));
    state.regionAdd.candidates = (window.BremStorage?.drivers?.getAll?.() || [])
      .filter(driver => !assigned.has(driver.id))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
    resetRegionAddCombo();
  }

  function resetRegionAddCombo() {
    const input = $('#driverRegionAddInput');
    const hidden = $('#driverRegionAddSelect');
    const hasRegion = Boolean(selectedRegion());
    if (hidden) hidden.value = '';
    if (input) {
      input.value = '';
      input.classList.remove('is-picked');
      input.disabled = !hasRegion;
      input.placeholder = hasRegion ? '기사 선택 · 이름·ID·연락처 입력' : '지역 선택 후 추가';
    }
    closeRegionAddList();
  }

  function filterRegionAddCandidates(query) {
    const key = String(query || '').replace(/\s+/g, '').toLowerCase();
    const list = state.regionAdd.candidates;
    if (!key) return list.slice(0, 50);
    return list.filter(driver => regionAddSearchKey(driver).includes(key)).slice(0, 50);
  }

  function renderRegionAddList() {
    const listEl = $('#driverRegionAddOptions');
    const input = $('#driverRegionAddInput');
    if (!listEl || !input) return;
    const rows = filterRegionAddCandidates(input.value);
    if (!rows.length) {
      listEl.innerHTML = state.regionAdd.candidates.length
        ? '<li class="empty">검색 결과가 없습니다.</li>'
        : '<li class="empty">추가할 수 있는 기사가 없습니다.</li>';
      state.regionAdd.highlight = -1;
      return;
    }
    if (state.regionAdd.highlight >= rows.length) state.regionAdd.highlight = rows.length - 1;
    listEl.innerHTML = rows.map((driver, index) => `
      <li role="option" class="${index === state.regionAdd.highlight ? 'is-active' : ''}"
        data-region-add-option="${escapeHtml(driver.id)}"
        aria-selected="${index === state.regionAdd.highlight ? 'true' : 'false'}">
        ${escapeHtml(driver.name || '-')} <span class="muted">· ${escapeHtml(regionAddIdLabel(driver))}</span>
      </li>
    `).join('');
  }

  function openRegionAddList() {
    if (!selectedRegion()) return;
    const listEl = $('#driverRegionAddOptions');
    const input = $('#driverRegionAddInput');
    state.regionAdd.open = true;
    renderRegionAddList();
    if (listEl) listEl.hidden = false;
    if (input) input.setAttribute('aria-expanded', 'true');
  }

  function closeRegionAddList() {
    const listEl = $('#driverRegionAddOptions');
    const input = $('#driverRegionAddInput');
    state.regionAdd.open = false;
    state.regionAdd.highlight = -1;
    if (listEl) listEl.hidden = true;
    if (input) input.setAttribute('aria-expanded', 'false');
  }

  function pickRegionAddDriver(driverId) {
    const driver = state.regionAdd.candidates.find(item => item.id === driverId);
    if (!driver) return;
    const input = $('#driverRegionAddInput');
    const hidden = $('#driverRegionAddSelect');
    if (hidden) hidden.value = driver.id;
    if (input) {
      input.value = `${driver.name} · ${regionAddIdLabel(driver)}`;
      input.classList.add('is-picked');
    }
    closeRegionAddList();
  }

  function moveRegionAddHighlight(step) {
    const rows = filterRegionAddCandidates($('#driverRegionAddInput')?.value);
    if (!rows.length) return;
    const next = state.regionAdd.highlight + step;
    state.regionAdd.highlight = next < 0 ? rows.length - 1 : (next >= rows.length ? 0 : next);
    renderRegionAddList();
    $('#driverRegionAddOptions')?.querySelector('li.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  function bindRegionAddCombo() {
    const input = $('#driverRegionAddInput');
    const listEl = $('#driverRegionAddOptions');
    if (!input || !listEl) return;

    input.addEventListener('input', () => {
      // 직접 입력하면 이전 선택은 무효 — 목록에서 다시 골라야 추가된다.
      const hidden = $('#driverRegionAddSelect');
      if (hidden) hidden.value = '';
      input.classList.remove('is-picked');
      state.regionAdd.highlight = -1;
      openRegionAddList();
    });
    input.addEventListener('focus', () => openRegionAddList());
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!state.regionAdd.open) openRegionAddList();
        moveRegionAddHighlight(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.key === 'Enter') {
        const rows = filterRegionAddCandidates(input.value);
        const target = rows[state.regionAdd.highlight] || (rows.length === 1 ? rows[0] : null);
        if (target) {
          event.preventDefault();
          pickRegionAddDriver(target.id);
        }
        return;
      }
      if (event.key === 'Escape' && state.regionAdd.open) {
        event.preventDefault();
        closeRegionAddList();
      }
    });

    // mousedown 으로 처리해야 input blur 보다 먼저 선택된다.
    listEl.addEventListener('mousedown', event => {
      const option = event.target.closest('[data-region-add-option]');
      if (!option) return;
      event.preventDefault();
      pickRegionAddDriver(option.dataset.regionAddOption);
    });

    document.addEventListener('click', event => {
      if (!state.regionAdd.open) return;
      if (event.target.closest('.driver-region-combo')) return;
      closeRegionAddList();
    });
  }

  async function assignDriverToRegion(driverId, region = selectedRegion()) {
    if (!driverId || !region) return;
    // 기사등록프로그램과 동일 필드(regionBaemin/regionCoupang)에 저장한다.
    const patch = state.regionPlatform === 'coupang'
      ? { regionCoupang: region.label, platformCoupang: true }
      : { regionBaemin: region.label, platformBaemin: true };
    await window.BremStorage.drivers.update(driverId, patch);
  }

  async function clearDriverRegion(driverId) {
    const patch = state.regionPlatform === 'coupang'
      ? { regionCoupang: '' }
      : { regionBaemin: '' };
    await window.BremStorage.drivers.update(driverId, patch);
  }

  async function refreshRegions() {
    const seq = ++state.regionRefreshSeq;
    const hint = $('#driverRegionHint');
    if (hint) {
      hint.textContent = state.regionPlatform === 'coupang'
        ? '쿠팡: 「라이더 노출」켜면 등록 기사가 기사앱 대시보드를 봅니다. 「올노출」/「전체열람」/「할당만」/「미노출」(기사앱 대시보드 숨김)/「팀장임명」.'
        : '배민: 「라이더 노출」켜면 등록 기사가 기사앱 대시보드를 봅니다. 「올노출」/「전체열람」/「할당만」/「미노출」(기사앱 대시보드 숨김)/「팀장임명」.';
    }

    // 지역 목록·노출은 기사 전체 로드를 기다리지 않고 먼저 그린다.
    // (예전엔 awaitDriversFullyLoaded 동안 sync 이벤트마다 빈 목록이 깜빡였다.)
    await loadRegionExposure();
    if (seq !== state.regionRefreshSeq) return;
    if (state.regionPlatform === 'coupang') await fetchCoupangRegions();
    else await fetchBaeminRegions();
    if (seq !== state.regionRefreshSeq) return;
    if (!selectedRegion() && regionCatalog()[0]) {
      state.selectedRegionKey = regionCatalog()[0].key;
    }
    renderRegionCatalog();
    renderRegionDetail();

    try {
      await ensureDriverMgmtStatsLoaded();
      await window.BremStorage?.ensureSectionLoaded?.('driver-management');
      if (typeof window.BremStorage?.awaitDriversFullyLoaded === 'function') {
        await window.BremStorage.awaitDriversFullyLoaded();
      }
    } catch (error) {
      console.warn('[driver-mgmt] calls/settlements/drivers load failed:', error);
    }
    if (seq !== state.regionRefreshSeq) return;
    // 기사·콜수·일정산 로드 후 표·인원 한 번 확정
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
      const key = window.BremDriverUtils?.baeminIdMatchKey?.(id)
        || window.BremWeeklySettlement?.baeminIdMatchKey?.(id)
        || id.toUpperCase();
      return drivers.find(driver => {
        const driverKey = window.BremDriverUtils?.baeminIdMatchKey?.(driver.baeminId)
          || window.BremWeeklySettlement?.baeminIdMatchKey?.(driver.baeminId)
          || String(driver.baeminId || '').trim().toUpperCase();
        return driverKey && driverKey === key;
      }) || null;
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
    body.innerHTML = state.bulkRows.map((row, index) => {
      const driverFail = row.status !== 'ok' && (!row.driverId || /기사/.test(row.error || ''));
      const createBtn = driverFail
        ? `<button type="button" class="small-btn primary-btn" data-bulk-quick-create="${index}">간이등록</button>`
        : '';
      return `<tr>
        <td class="${row.status === 'ok' ? 'driver-region-bulk-ok' : 'driver-region-bulk-fail'}">${row.status === 'ok' ? '성공' : '실패'}</td>
        <td><input type="text" data-bulk-id="${index}" value="${escapeHtml(row.idValue)}"></td>
        <td><input type="text" data-bulk-region="${index}" value="${escapeHtml(row.regionInput)}"></td>
        <td>${escapeHtml(row.matchLabel || '-')}</td>
        <td>${escapeHtml(row.driverName || '-')}</td>
        <td class="driver-region-bulk-actions">
          <button type="button" class="small-btn" data-bulk-recheck="${index}">다시매칭</button>
          ${createBtn}
        </td>
      </tr>`;
    }).join('');
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
        ? { regionCoupang: region.label, platformCoupang: true }
        : { regionBaemin: region.label, platformBaemin: true };
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

  function bulkCreatePlatform() {
    return $('#driverRegionBulkPlatform')?.value === 'coupang' ? 'coupang' : 'baemin';
  }

  function fillBulkCreateRegionSelects() {
    const baeminSelect = $('#driverRegionBulkCreateRegionBaemin');
    const coupangSelect = $('#driverRegionBulkCreateRegionCoupang');
    if (baeminSelect) {
      const options = state.baeminRegions
        .map(item => String(item.label || '').trim())
        .filter(Boolean);
      const current = baeminSelect.value;
      baeminSelect.innerHTML = '<option value="">미선택</option>'
        + [...new Set(options)].map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
      if (current) baeminSelect.value = current;
    }
    if (coupangSelect) {
      const options = state.coupangRegions
        .map(item => String(item.label || item.key || '').trim())
        .filter(Boolean);
      const current = coupangSelect.value;
      coupangSelect.innerHTML = '<option value="">미선택</option>'
        + [...new Set(options)].map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
      if (current) coupangSelect.value = current;
    }
  }

  function closeBulkCreateModal() {
    const modal = $('#driverRegionBulkCreateModal');
    if (modal) modal.hidden = true;
    state.bulkCreateIndex = -1;
    state.bulkCreateBusy = false;
    state.bulkCreateSource = 'bulk';
    const btn = $('#driverRegionBulkCreateBtn');
    if (btn) btn.disabled = false;
  }

  function prefillBulkCreateForm({
    platform = 'baemin',
    idValue = '',
    regionLabel = '',
    crawlName = '',
    recordHtml = ''
  } = {}) {
    fillBulkCreateRegionSelects();
    const recordEl = $('#driverRegionBulkCreateRecord');
    if (recordEl) recordEl.innerHTML = recordHtml;

    const nameEl = $('#driverRegionBulkCreateName');
    const phoneEl = $('#driverRegionBulkCreatePhone');
    const baeminEl = $('#driverRegionBulkCreateBaeminId');
    const joinEl = $('#driverRegionBulkCreateJoinDate');
    const statusEl = $('#driverRegionBulkCreateStatus');
    const bankEl = $('#driverRegionBulkCreateBankName');
    const accountEl = $('#driverRegionBulkCreateAccountNumber');
    const regionBaeminEl = $('#driverRegionBulkCreateRegionBaemin');
    const regionCoupangEl = $('#driverRegionBulkCreateRegionCoupang');
    const platformCoupangEl = $('#driverRegionBulkCreatePlatformCoupang');
    const platformBaeminEl = $('#driverRegionBulkCreatePlatformBaemin');
    const memoEl = $('#driverRegionBulkCreateMemo');
    const hintEl = $('#driverRegionBulkCreateHint');

    if (nameEl) nameEl.value = crawlName && crawlName !== '-' ? crawlName : '';
    if (phoneEl) phoneEl.value = '';
    if (baeminEl) baeminEl.value = platform === 'baemin' ? (idValue || '') : '';
    if (joinEl) joinEl.value = localDateKey(new Date());
    if (statusEl) statusEl.value = '근무중';
    if (bankEl) bankEl.value = '';
    if (accountEl) accountEl.value = '';
    if (memoEl) {
      memoEl.value = state.bulkCreateSource === 'crawl'
        ? '크롤링 지역등록에서 등록'
        : '지역 일괄등록에서 등록';
    }
    if (platformBaeminEl) platformBaeminEl.checked = platform === 'baemin';
    if (platformCoupangEl) platformCoupangEl.checked = platform === 'coupang';
    if (regionBaeminEl) regionBaeminEl.value = platform === 'baemin' ? (regionLabel || '') : '';
    if (regionCoupangEl) regionCoupangEl.value = platform === 'coupang' ? (regionLabel || '') : '';
    if (hintEl) {
      hintEl.textContent = platform === 'baemin'
        ? '배민 ID는 채워 둡니다. 이름·연락처를 입력하면 기사등록프로그램에 등록되고 이 지역에 배정됩니다.'
        : '쿠팡은 이름·연락처로 로그인 ID가 만들어집니다.';
    }
  }

  function openBulkCreateModal(index) {
    const row = state.bulkRows[index];
    if (!row) return;
    const platform = bulkCreatePlatform();
    state.bulkCreateIndex = index;
    state.bulkCreateSource = 'bulk';
    const region = platform === 'coupang'
      ? matchCoupangRegion(row.regionInput)
      : matchBaeminRegion(row.regionInput);
    prefillBulkCreateForm({
      platform,
      idValue: row.idValue,
      regionLabel: region?.label || '',
      recordHtml: `
        <div><dt>플랫폼</dt><dd>${platform === 'coupang' ? '쿠팡' : '배민'}</dd></div>
        <div><dt>엑셀 ID</dt><dd>${escapeHtml(row.idValue || '-')}</dd></div>
        <div><dt>지역 입력</dt><dd>${escapeHtml(row.regionInput || '-')}</dd></div>
        <div><dt>지역 매칭</dt><dd>${escapeHtml(region ? (platform === 'baemin' ? `${region.label} (${region.partnerId})` : region.label) : '미매칭')}</dd></div>
      `
    });
    const modal = $('#driverRegionBulkCreateModal');
    if (modal) modal.hidden = false;
    $('#driverRegionBulkCreateName')?.focus();
  }

  function openBulkCreateFromCrawl(row) {
    const region = selectedRegion();
    if (!region || region.platform !== 'baemin') {
      showToast('배민 지역에서만 간이등록할 수 있습니다.');
      return;
    }
    state.bulkCreateIndex = -1;
    state.bulkCreateSource = 'crawl';
    prefillBulkCreateForm({
      platform: 'baemin',
      idValue: row.baeminId || '',
      regionLabel: region.label,
      crawlName: row.crawlName || '',
      recordHtml: `
        <div><dt>플랫폼</dt><dd>배민</dd></div>
        <div><dt>크롤 배민ID</dt><dd>${escapeHtml(row.baeminId || '-')}</dd></div>
        <div><dt>크롤 이름</dt><dd>${escapeHtml(row.crawlName || '-')}</dd></div>
        <div><dt>등록 지역</dt><dd>${escapeHtml(`${region.label} (${region.partnerId})`)}</dd></div>
      `
    });
    const modal = $('#driverRegionBulkCreateModal');
    if (modal) modal.hidden = false;
    const nameEl = $('#driverRegionBulkCreateName');
    if (nameEl?.value) $('#driverRegionBulkCreatePhone')?.focus();
    else nameEl?.focus();
  }

  function crawlStatusLabel(status) {
    if (status === 'already') return '이미 등록';
    if (status === 'assignable') return '반영 가능';
    if (status === 'unregistered') return '미등록';
    return status || '-';
  }

  function closeCrawlMatchModal() {
    const modal = $('#driverRegionCrawlMatchModal');
    if (modal) modal.hidden = true;
    state.crawlMatch = { rows: [], partnerId: '', label: '', busy: false };
  }

  function renderCrawlMatchRows() {
    const body = $('#driverRegionCrawlMatchRows');
    const summary = $('#driverRegionCrawlMatchSummary');
    const applyBtn = $('#driverRegionCrawlMatchApplyBtn');
    const checkAll = $('#driverRegionCrawlMatchCheckAll');
    const rows = state.crawlMatch.rows || [];
    const s = state.crawlMatch.summary || {};
    if (summary) {
      const snap = state.crawlMatch.snapshotDate
        ? ` · 스냅샷 ${state.crawlMatch.snapshotDate}`
        : '';
      summary.innerHTML = `총 <strong>${s.total || 0}</strong> · 이미등록 <strong>${s.already || 0}</strong> · 반영가능 <strong>${s.assignable || 0}</strong> · 미등록 <strong>${s.unregistered || 0}</strong>${snap}`;
    }
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty">크롤링된 기사가 없습니다. 배민현황 수집 후 다시 시도하세요.</td></tr>';
      if (applyBtn) applyBtn.disabled = true;
      if (checkAll) {
        checkAll.checked = false;
        checkAll.disabled = true;
      }
      return;
    }
    const region = selectedRegion();
    body.innerHTML = rows.map((row, index) => {
      const checked = row.status === 'assignable' ? ' checked' : '';
      const disabled = row.status !== 'assignable' ? ' disabled' : '';
      const statusClass = `driver-region-crawl-status--${row.status}`;
      let statusText = crawlStatusLabel(row.status);
      if (row.status === 'assignable' && row.currentRegion) {
        statusText = `${row.currentRegion} → ${region?.label || row.targetRegion || ''}`;
      }
      const action = row.status === 'unregistered'
        ? `<button type="button" class="small-btn primary-btn" data-crawl-quick-create="${index}">간이등록</button>`
        : '—';
      return `<tr>
        <td><input type="checkbox" data-crawl-check="${index}"${checked}${disabled}></td>
        <td>${escapeHtml(row.crawlName || '-')}</td>
        <td>${escapeHtml(row.baeminId || '-')}</td>
        <td>${escapeHtml(row.driverName || '-')}</td>
        <td>${escapeHtml(row.currentRegion || (row.status === 'unregistered' ? '-' : '미배정'))}</td>
        <td class="${statusClass}">${escapeHtml(statusText)}</td>
        <td>${action}</td>
      </tr>`;
    }).join('');
    const selectable = rows.filter(r => r.status === 'assignable').length;
    if (applyBtn) applyBtn.disabled = selectable === 0;
    if (checkAll) {
      checkAll.checked = selectable > 0;
      checkAll.disabled = selectable === 0;
    }
  }

  async function openCrawlMatchModal() {
    const region = selectedRegion();
    if (!region) {
      showToast('지역을 먼저 선택하세요.');
      return;
    }
    if (region.platform !== 'baemin') {
      showToast('크롤링 지역등록은 배민 지역만 지원합니다.');
      return;
    }
    const modal = $('#driverRegionCrawlMatchModal');
    if (!modal) return;
    modal.hidden = false;
    const body = $('#driverRegionCrawlMatchRows');
    if (body) body.innerHTML = '<tr><td colspan="7" class="empty">불러오는 중…</td></tr>';
    const applyBtn = $('#driverRegionCrawlMatchApplyBtn');
    if (applyBtn) applyBtn.disabled = true;
    state.crawlMatch.busy = true;
    try {
      const token = await window.BremStorage?.resolveAdminAccessToken?.();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const params = new URLSearchParams({
        partnerId: region.partnerId || region.key,
        regionKey: region.key,
        label: region.label || ''
      });
      const res = await fetch(`/api/admin/rider-dashboard/region-crawl-match?${params}`, {
        headers,
        credentials: 'same-origin'
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '크롤링 매칭을 불러오지 못했습니다.');
      state.crawlMatch = {
        rows: payload.rows || [],
        summary: payload.summary || {},
        partnerId: payload.partnerId || region.partnerId,
        label: payload.label || region.label,
        snapshotDate: payload.snapshotDate || '',
        busy: false
      };
      renderCrawlMatchRows();
    } catch (error) {
      state.crawlMatch.busy = false;
      if (body) {
        body.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message || '불러오기 실패')}</td></tr>`;
      }
      showToast(error.message || '크롤링 매칭을 불러오지 못했습니다.');
    }
  }

  async function applyCrawlMatchSelection() {
    const region = selectedRegion();
    if (!region || region.platform !== 'baemin') return;
    const checks = [...document.querySelectorAll('[data-crawl-check]:checked')];
    const targets = checks
      .map(el => state.crawlMatch.rows[Number(el.dataset.crawlCheck)])
      .filter(row => row && row.status === 'assignable' && row.driverId);
    if (!targets.length) {
      showToast('반영할 기사를 선택하세요.');
      return;
    }
    const applyBtn = $('#driverRegionCrawlMatchApplyBtn');
    if (applyBtn) applyBtn.disabled = true;
    let saved = 0;
    try {
      for (const row of targets) {
        await assignDriverToRegion(row.driverId, region);
        saved += 1;
      }
      showToast(`${saved}명을 «${region.label}»에 등록했습니다.`);
      closeCrawlMatchModal();
      renderRegionCatalog();
      renderRegionDetail();
    } catch (error) {
      showToast(error.message || '지역 반영에 실패했습니다.');
      if (applyBtn) applyBtn.disabled = false;
    }
  }

  async function submitBulkCreate(event) {
    event?.preventDefault();
    if (state.bulkCreateBusy) return;
    const fromCrawl = state.bulkCreateSource === 'crawl';
    const index = state.bulkCreateIndex;
    const row = fromCrawl ? null : state.bulkRows[index];
    if (!fromCrawl && !row) {
      closeBulkCreateModal();
      return;
    }

    const platform = fromCrawl ? 'baemin' : bulkCreatePlatform();
    const name = String($('#driverRegionBulkCreateName')?.value || '').trim();
    const phone = String($('#driverRegionBulkCreatePhone')?.value || '').trim();
    const baeminId = String($('#driverRegionBulkCreateBaeminId')?.value || '').trim();
    const joinDate = String($('#driverRegionBulkCreateJoinDate')?.value || '').slice(0, 10);
    const platformCoupang = Boolean($('#driverRegionBulkCreatePlatformCoupang')?.checked);
    const platformBaemin = Boolean($('#driverRegionBulkCreatePlatformBaemin')?.checked);
    const regionBaemin = String($('#driverRegionBulkCreateRegionBaemin')?.value || '').trim();
    const regionCoupang = String($('#driverRegionBulkCreateRegionCoupang')?.value || '').trim();

    if (!name || !phone || !joinDate) {
      showToast('이름·연락처·가입일은 필수입니다.');
      return;
    }
    if (!platformCoupang && !platformBaemin) {
      showToast('플랫폼을 최소 1개 선택하세요.');
      return;
    }
    if (platformBaemin && !baeminId) {
      showToast('배민 기사는 배민 라이더 ID가 필요합니다.');
      return;
    }

    const duplicate = window.BremDriverUtils?.findDuplicateDriver?.({ name, phone, baeminId });
    if (duplicate?.driver) {
      if (fromCrawl) {
        const region = selectedRegion();
        if (region) {
          try {
            const existingBaemin = String(duplicate.driver.baeminId || '').trim();
            const matchKey = window.BremDriverUtils?.baeminIdMatchKey;
            const sameBaemin = existingBaemin && baeminId && matchKey
              ? matchKey(existingBaemin) === matchKey(baeminId)
              : (existingBaemin && baeminId && existingBaemin === baeminId);
            const patch = {};
            // 기존 기사에 배민ID가 비어 있으면 크롤/폼 값으로 채운다. (공성호 케이스)
            if (baeminId && !existingBaemin) {
              patch.baeminId = baeminId;
              patch.platformBaemin = true;
            } else if (baeminId && existingBaemin && !sameBaemin) {
              showToast(`기존 «${duplicate.driver.name}»에 다른 배민ID(${existingBaemin})가 있습니다. 수동으로 확인하세요.`);
              return;
            }
            if (platformBaemin && !duplicate.driver.platformBaemin) {
              patch.platformBaemin = true;
            }
            if (Object.keys(patch).length) {
              await window.BremStorage.drivers.update(duplicate.driver.id, patch);
            }
            await assignDriverToRegion(duplicate.driver.id, region);
            const filled = patch.baeminId ? ' · 배민ID 반영' : '';
            showToast(`기존 «${duplicate.driver.name}»을 이 지역에 반영했습니다.${filled}`);
            closeBulkCreateModal();
            void openCrawlMatchModal();
            renderRegionCatalog();
            renderRegionDetail();
          } catch (error) {
            showToast(error.message || '지역 반영에 실패했습니다.');
          }
          return;
        }
      }
      showToast(`${duplicate.reason}: 이미 «${duplicate.driver.name}» 기사가 있습니다. ID를 맞춘 뒤 다시매칭하세요.`);
      if (row) {
        row.idValue = platform === 'baemin'
          ? (duplicate.driver.baeminId || baeminId || row.idValue)
          : (makeDriverLoginId(duplicate.driver) || row.idValue);
        recheckBulkRow(row, platform);
        renderBulkPreview();
      }
      closeBulkCreateModal();
      return;
    }

    state.bulkCreateBusy = true;
    const btn = $('#driverRegionBulkCreateBtn');
    if (btn) btn.disabled = true;
    try {
      const created = await window.BremStorage.drivers.create({
        name,
        phone,
        baeminId,
        platformCoupang,
        platformBaemin,
        regionBaemin,
        regionCoupang,
        bankName: String($('#driverRegionBulkCreateBankName')?.value || '').trim(),
        accountNumber: String($('#driverRegionBulkCreateAccountNumber')?.value || '').trim(),
        accountHolder: name,
        joinDate,
        status: String($('#driverRegionBulkCreateStatus')?.value || '근무중'),
        memo: String($('#driverRegionBulkCreateMemo')?.value || '').trim()
      });
      if (!created?.id) throw new Error('기사 등록 결과를 확인할 수 없습니다.');

      if (fromCrawl) {
        const region = selectedRegion();
        if (region) await assignDriverToRegion(created.id, region);
        closeBulkCreateModal();
        showToast(`${created.name} 기사를 등록하고 «${region?.label || ''}»에 반영했습니다.`);
        void openCrawlMatchModal();
        renderRegionCatalog();
        renderRegionDetail();
        return;
      }

      if (platform === 'baemin' && created.baeminId) {
        row.idValue = created.baeminId;
      } else {
        row.idValue = makeDriverLoginId(created) || row.idValue;
      }
      recheckBulkRow(row, platform);

      if (row.status === 'ok' && row.driverId) {
        const region = platform === 'coupang'
          ? state.coupangRegions.find(item => item.key === row.regionKey)
          : state.baeminRegions.find(item => item.key === row.regionKey);
        if (region) await assignDriverToRegion(created.id, region);
      }

      renderBulkPreview();
      closeBulkCreateModal();
      showToast(
        row.status === 'ok'
          ? `${created.name} 기사를 등록하고 지역까지 반영했습니다.`
          : `${created.name} 기사를 등록했습니다. 지역 입력을 확인한 뒤 다시매칭하세요.`
      );
      if (row.status === 'ok') {
        renderRegionCatalog();
        renderRegionDetail();
      }
    } catch (error) {
      console.error('[BREM] region bulk create failed:', error);
      showToast(error.message || '기사 등록에 실패했습니다.');
    } finally {
      state.bulkCreateBusy = false;
      if (btn) btn.disabled = false;
    }
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    // 기사 목록이 백그라운드로 더 채워지면 인원 수만 갱신한다.
    // 표 전체 재생성은 "인원이 늘었을 때" 또는 "최종 완료"만 (디바운스).
    document.addEventListener('brem-drivers-sync-ready', event => {
      if (state.tab !== 'region') return;
      if (!isDriverManagementSectionActive()) return;
      updateRegionCatalogCounts();
      const region = selectedRegion();
      if (!region) return;
      const n = driversInRegion(region).length;
      const complete = event.detail?.complete === true;
      const grew = n > state.regionDetailDriverCount;
      if (!grew && !complete) return;
      if (!grew && complete && n === state.regionDetailDriverCount && state.regionDetailDriverCount >= 0) {
        return;
      }
      state.regionDetailDriverCount = n;
      scheduleRegionDetailSoftRefresh();
    });

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

      const regionBtn = event.target.closest('[data-region-select]');
      if (regionBtn) {
        state.selectedRegionKey = regionBtn.dataset.regionSelect;
        state.regionListFilter = '';
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

      const leaderBtn = event.target.closest('[data-region-rider-leader]');
      if (leaderBtn) {
        const region = selectedRegion();
        const driverId = leaderBtn.dataset.regionRiderLeader;
        if (!region || !driverId) return;
        const prev = getDriverRegionMode(region.platform, region.key, driverId);
        const next = prev === 'leader' ? 'full' : 'leader';
        leaderBtn.disabled = true;
        void setDriverRegionMode(region, driverId, next)
          .then(() => {
            renderRegionDetail();
            showToast(next === 'leader'
              ? '팀장임명 — 기사앱에서 할당·실시간·주간을 전원 기준으로 봅니다 (본인 순위 비노출)'
              : '팀장해제 — 올노출로 되돌렸습니다');
          })
          .catch(error => {
            showToast(error.message || '팀장 설정 저장 실패');
          })
          .finally(() => {
            leaderBtn.disabled = false;
          });
        return;
      }

      const unassignBtn = event.target.closest('[data-org-unassign-id]');
      if (unassignBtn) {
        void unassignOrgMember(
          unassignBtn.dataset.orgUnassignNode,
          unassignBtn.dataset.orgUnassignKind,
          unassignBtn.dataset.orgUnassignId
        );
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
        return;
      }

      const createBtn = event.target.closest('[data-bulk-quick-create]');
      if (createBtn) {
        const index = Number(createBtn.dataset.bulkQuickCreate);
        const row = state.bulkRows[index];
        if (!row) return;
        const idInput = document.querySelector(`[data-bulk-id="${index}"]`);
        const regionInput = document.querySelector(`[data-bulk-region="${index}"]`);
        row.idValue = idInput?.value?.trim() || row.idValue;
        row.regionInput = regionInput?.value?.trim() || row.regionInput;
        openBulkCreateModal(index);
        return;
      }

      if (event.target.closest('[data-close-region-bulk-create]')) {
        closeBulkCreateModal();
        return;
      }

      if (event.target.closest('[data-close-region-crawl-match]')) {
        closeCrawlMatchModal();
        return;
      }

      const crawlQuick = event.target.closest('[data-crawl-quick-create]');
      if (crawlQuick) {
        const index = Number(crawlQuick.dataset.crawlQuickCreate);
        const row = state.crawlMatch.rows[index];
        if (row) openBulkCreateFromCrawl(row);
      }
    });

    document.addEventListener('change', event => {
      if (event.target?.id === 'driverRegionCrawlMatchCheckAll') {
        const on = Boolean(event.target.checked);
        document.querySelectorAll('[data-crawl-check]:not(:disabled)').forEach(el => {
          el.checked = on;
        });
        return;
      }
      const expose = event.target.closest('[data-region-expose]');
      if (expose) {
        const key = expose.dataset.regionExpose;
        const region = regionCatalog().find(item => item.key === key);
        if (!region) return;
        const checked = expose.checked === true;
        void setRegionExposure(region, checked)
          .then(() => {
            renderRegionCatalog();
            showToast(checked
              ? `「${region.label}」 라이더 노출 ON`
              : `「${region.label}」 라이더 노출 OFF`);
          })
          .catch(error => {
            expose.checked = !checked;
            showToast(error.message || '노출 설정 저장 실패');
          });
        return;
      }

      const riderMode = event.target.closest('[data-region-rider-mode]');
      if (riderMode) {
        const region = selectedRegion();
        const driverId = riderMode.dataset.regionRiderMode;
        if (!region || !driverId) return;
        const mode = normalizeDriverRegionMode(riderMode.value);
        const prev = getDriverRegionMode(region.platform, region.key, driverId);
        if (mode === prev) return;
        void setDriverRegionMode(region, driverId, mode)
          .then(() => {
            // 표 전체 재생성 없이 해당 행만 반영 — 스크롤·깜빡임 방지
            const tr = riderMode.closest('tr');
            if (tr) {
              tr.classList.toggle('is-dashboard-only', mode === 'dashboard');
              tr.classList.toggle('is-metrics-only', mode === 'metrics');
              tr.classList.toggle('is-dashboard-hidden', mode === 'hidden');
              tr.classList.remove('is-region-leader');
              tr.querySelector('.driver-region-leader-badge')?.remove();
              tr.querySelector('.driver-region-metrics-badge')?.remove();
              tr.querySelector('.driver-region-dash-badge')?.remove();
              tr.querySelector('.driver-region-hidden-badge')?.remove();
              const nameCell = tr.querySelector('td strong');
              if (mode === 'metrics' && nameCell && !tr.querySelector('.driver-region-metrics-badge')) {
                nameCell.insertAdjacentHTML('afterend', ' <span class="driver-region-metrics-badge" title="순위 노출 · 본인 보드엔 할당만">할당만</span>');
              }
              if (mode === 'dashboard' && nameCell && !tr.querySelector('.driver-region-dash-badge')) {
                nameCell.insertAdjacentHTML('afterend', ' <span class="driver-region-dash-badge" title="자기 순위 비노출 · 남 순위+할당 열람">전체열람</span>');
              }
              if (mode === 'hidden' && nameCell && !tr.querySelector('.driver-region-hidden-badge')) {
                nameCell.insertAdjacentHTML('afterend', ' <span class="driver-region-hidden-badge" title="기사앱 기사대시보드 숨김">미노출</span>');
              }
              const leaderBtn = tr.querySelector('[data-region-rider-leader]');
              if (leaderBtn) {
                leaderBtn.classList.remove('is-on');
                leaderBtn.textContent = '팀장임명';
                leaderBtn.title = '팀장: 기사앱에서 할당·실시간·주간콜수를 전원 기준으로 봄 (본인은 순위에 안 나옴)';
              }
              tr.querySelectorAll('.driver-region-mode').forEach(label => {
                const input = label.querySelector('input[data-region-rider-mode]');
                const on = input && input.value === mode;
                label.classList.toggle('is-on', Boolean(on));
                if (input) input.checked = Boolean(on);
              });
            }
            showToast(mode === 'dashboard'
              ? '전체열람 — 자기 순위 비노출 · 남 순위+할당 열람'
              : mode === 'metrics'
                ? '할당만 — 순위는 노출 · 본인 보드엔 할당만'
                : mode === 'hidden'
                  ? '미노출 — 기사앱에서 기사대시보드가 숨겨집니다'
                  : '올노출 — 대시보드 + 순위 노출');
          })
          .catch(error => {
            const tr = riderMode.closest('tr');
            const restore = prev === 'leader' ? 'full' : prev;
            tr?.querySelectorAll('input[data-region-rider-mode]').forEach(input => {
              input.checked = input.value === restore;
            });
            showToast(error.message || '기사 옵션 저장 실패');
          });
        return;
      }

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

    $('#driverOrgListReloadBtn')?.addEventListener('click', () => {
      loadOrg();
      renderOrgList();
      showToast('조직도 정리를 새로고침했습니다.');
    });
    $('#driverOrgAddRootBtn')?.addEventListener('click', () => addNode(''));
    $('#driverOrgAddChildBtn')?.addEventListener('click', () => {
      if (!state.selectedNodeId) {
        showToast('상위 박스를 먼저 선택하세요.');
        return;
      }
      addNode(state.selectedNodeId);
    });
    $('#driverOrgAddParentBtn')?.addEventListener('click', () => addParentAboveSelected());
    $('#driverOrgMoveUpBtn')?.addEventListener('click', () => moveSelectedNodeUp());
    $('#driverOrgDeleteBtn')?.addEventListener('click', () => deleteSelectedNode());
    $('#driverOrgCloseBtn')?.addEventListener('click', () => {
      state.selectedNodeId = '';
      renderOrg();
    });
    $('#driverOrgSaveBtn')?.addEventListener('click', () => { void saveOrg(); });
    $('#driverOrgWeekPrevBtn')?.addEventListener('click', () => shiftWeek(-1));
    $('#driverOrgWeekNextBtn')?.addEventListener('click', () => shiftWeek(1));
    $('#driverRegionWeekPrevBtn')?.addEventListener('click', () => shiftWeek(-1));
    $('#driverRegionWeekNextBtn')?.addEventListener('click', () => shiftWeek(1));
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
    $('#driverOrgMemberTemplateBtn')?.addEventListener('click', () => downloadOrgMemberTemplate());
    $('#driverOrgMemberBulkFile')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;
      void applyOrgMemberBulkExcel(file)
        .catch(error => showToast(error.message || '엑셀 일괄등록 실패'))
        .finally(() => { event.target.value = ''; });
    });
    bindOrgChartExcelDrop();

    $('#driverRegionReloadBtn')?.addEventListener('click', () => { void refreshRegions(); });
    $('#driverRegionCrawlMatchBtn')?.addEventListener('click', () => { void openCrawlMatchModal(); });
    $('#driverRegionCrawlMatchApplyBtn')?.addEventListener('click', () => { void applyCrawlMatchSelection(); });
    bindRegionAddCombo();
    $('#driverRegionListFilter')?.addEventListener('input', event => {
      const value = String(event.target.value || '');
      if (state.regionListFilterTimer) clearTimeout(state.regionListFilterTimer);
      state.regionListFilterTimer = setTimeout(() => {
        state.regionListFilter = value;
        renderRegionDetail();
      }, 160);
    });
    $('#driverRegionAddBtn')?.addEventListener('click', () => {
      const id = $('#driverRegionAddSelect')?.value;
      if (!id) {
        const typed = String($('#driverRegionAddInput')?.value || '').trim();
        showToast(typed ? '검색 목록에서 기사를 선택하세요.' : '기사를 선택하세요.');
        openRegionAddList();
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
    $('#driverRegionBulkCreateForm')?.addEventListener('submit', event => {
      void submitBulkCreate(event);
    });
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
    // 진입 즉시 이번 정산주(수요일)로 맞춘다. 안 맞으면 주간콜수가 빈 것처럼 보인다.
    ensureWeek();
    renderWeekControls();
    await ensureDriverMgmtStatsLoaded();
    setTab(state.tab, { skipRegionLoad: true });
    if (state.tab === 'region') {
      await refreshRegions();
      startRegionRankingPoll();
    } else {
      stopRegionRankingPoll();
    }
    if (state.tab === 'org-list') renderOrgList();
  }

  return {
    refresh,
    shortCoupangRegion,
    onWeekPicked: setWeek,
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
