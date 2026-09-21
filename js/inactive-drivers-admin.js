window.BremInactiveDriversAdmin = (function () {
  const MIN_LOOKBACK_WEEKS = 16;
  const MAX_LOOKBACK_WEEKS = 52;
  const DEFAULT_MIN_WEEKS = 4;
  const WEEK_FILTER_KEY = 'brem_inactive_driver_week_range';

  const state = {
    bound: false,
    loading: false,
    applying: false,
    rows: [],
    selected: new Set(),
    minWeeks: DEFAULT_MIN_WEEKS,
    maxWeeks: 0,
    loadedLookback: 0,
    statusFilter: '근무중',
    search: ''
  };

  function $(selector) {
    return document.querySelector(selector);
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function escapeHtml(value) {
    return window.BremDriverUtils?.escapeHtml?.(value) || String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function todayKey() {
    if (window.BremDatePicker?.today) return BremDatePicker.today();
    const date = new Date();
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function formatDateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function weekStartKey(dateValue) {
    if (window.BremDatePicker?.weekStartKey) return BremDatePicker.weekStartKey(dateValue);
    const raw = String(dateValue || todayKey()).slice(0, 10);
    const date = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(date.getTime())) return raw;
    const diff = (date.getDay() - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return formatDateKey(date);
  }

  function weekEndKey(weekStart) {
    if (window.BremDatePicker?.weekEndKey) return BremDatePicker.weekEndKey(weekStart);
    const date = new Date(`${weekStart}T00:00:00`);
    if (Number.isNaN(date.getTime())) return weekStart;
    date.setDate(date.getDate() + 6);
    return formatDateKey(date);
  }

  function shiftWeek(weekStart, weeks) {
    const date = new Date(`${weekStart}T00:00:00`);
    date.setDate(date.getDate() + (Number(weeks) || 0) * 7);
    return weekStartKey(formatDateKey(date));
  }

  function formatWeekLabel(weekStart) {
    if (!weekStart) return '없음';
    const start = String(weekStart).slice(0, 10);
    const end = weekEndKey(start);
    return `${start.slice(5).replace('-', '.')}~${end.slice(5).replace('-', '.')}`;
  }

  function formatJoinDate(driver) {
    const raw = String(driver?.joinDate || driver?.createdAt || '').slice(0, 10);
    if (!raw) return '-';
    return window.BremDriverUtils?.formatDate?.(raw) || raw.replace(/-/g, '.');
  }

  function driverStatus(driver) {
    return String(driver?.status || '근무중').trim() || '근무중';
  }

  function loginId(driver) {
    return window.BremDriverUtils?.makeDriverLoginId?.(driver) || '';
  }

  function neededLookbackWeeks() {
    const upper = state.maxWeeks > 0 ? state.maxWeeks : MAX_LOOKBACK_WEEKS;
    return Math.min(
      MAX_LOOKBACK_WEEKS,
      Math.max(MIN_LOOKBACK_WEEKS, state.minWeeks || 1, upper)
    );
  }

  function lookbackWeekKeys(count = neededLookbackWeeks()) {
    const current = weekStartKey(todayKey());
    const keys = [];
    for (let i = 0; i < count; i += 1) {
      keys.push(shiftWeek(current, -i));
    }
    return keys;
  }

  function readWeekInput(el, fallback) {
    if (!el) return fallback;
    const raw = String(el.value || '').trim();
    if (!raw) return fallback;
    const value = Math.round(Number(raw));
    if (!Number.isFinite(value)) return fallback;
    return Math.min(MAX_LOOKBACK_WEEKS, Math.max(1, value));
  }

  function weekRangeLabel() {
    if (state.maxWeeks > 0) return `${state.minWeeks}~${state.maxWeeks}주`;
    return `${state.minWeeks}주 이상`;
  }

  function persistWeekRange() {
    try {
      localStorage.setItem(WEEK_FILTER_KEY, JSON.stringify({
        minWeeks: state.minWeeks,
        maxWeeks: state.maxWeeks
      }));
    } catch {
      /* ignore */
    }
  }

  function restoreWeekRange() {
    try {
      const raw = JSON.parse(localStorage.getItem(WEEK_FILTER_KEY) || '');
      const minWeeks = Math.round(Number(raw?.minWeeks));
      const maxWeeks = Math.round(Number(raw?.maxWeeks));
      if (Number.isFinite(minWeeks) && minWeeks >= 1) {
        state.minWeeks = Math.min(MAX_LOOKBACK_WEEKS, minWeeks);
      }
      if (Number.isFinite(maxWeeks) && maxWeeks >= 1) {
        state.maxWeeks = Math.min(MAX_LOOKBACK_WEEKS, maxWeeks);
      }
    } catch {
      /* keep defaults */
    }
  }

  function syncWeekInputs() {
    const minInput = $('#inactiveDriverMinWeeks');
    const maxInput = $('#inactiveDriverMaxWeeks');
    if (minInput) minInput.value = String(state.minWeeks);
    if (maxInput) maxInput.value = state.maxWeeks > 0 ? String(state.maxWeeks) : '';
  }

  function applyWeekRangeFromInputs() {
    let minWeeks = readWeekInput($('#inactiveDriverMinWeeks'), DEFAULT_MIN_WEEKS);
    let maxWeeks = readWeekInput($('#inactiveDriverMaxWeeks'), 0);
    if (maxWeeks > 0 && minWeeks > maxWeeks) {
      const swap = minWeeks;
      minWeeks = maxWeeks;
      maxWeeks = swap;
    }
    state.minWeeks = minWeeks;
    state.maxWeeks = maxWeeks;
    syncWeekInputs();
    persistWeekRange();
  }

  function buildCallWeekIndex(weekKeys) {
    const weekSet = new Set(weekKeys);
    const map = new Map();
    (window.BremStorage?.calls?.getAll?.() || []).forEach(call => {
      const driverId = String(call?.driverId || '').trim();
      const day = String(call?.date || '').slice(0, 10);
      if (!driverId || !day) return;
      const week = weekStartKey(day);
      if (!weekSet.has(week)) return;
      const count = Math.max(0, Number(call.count ?? call.orderCount ?? 0));
      if (!count) return;
      let weeks = map.get(driverId);
      if (!weeks) {
        weeks = new Map();
        map.set(driverId, weeks);
      }
      weeks.set(week, (weeks.get(week) || 0) + count);
    });
    return map;
  }

  function analyzeDriver(driver, weekKeys, callIndex) {
    const joinDay = String(driver?.joinDate || driver?.createdAt || '').slice(0, 10);
    const joinWeek = joinDay ? weekStartKey(joinDay) : '';
    const weeks = callIndex.get(driver.id);
    let consecutive = 0;
    let lastActiveWeek = '';
    for (const week of weekKeys) {
      if (joinWeek && week < joinWeek) break;
      const count = weeks?.get(week) || 0;
      if (count > 0) {
        lastActiveWeek = week;
        break;
      }
      consecutive += 1;
    }
    return { consecutive, lastActiveWeek };
  }

  function visibleRows() {
    const query = state.search.trim().toLowerCase();
    return state.rows.filter(row => {
      if (state.statusFilter !== 'all' && row.status !== state.statusFilter) return false;
      if (row.consecutive < state.minWeeks) return false;
      if (state.maxWeeks > 0 && row.consecutive > state.maxWeeks) return false;
      if (!query) return true;
      const hay = [
        row.driver.name,
        row.driver.phone,
        loginId(row.driver),
        row.driver.baeminId
      ].join(' ').toLowerCase();
      return hay.includes(query);
    });
  }

  function syncSelectAll() {
    const selectAll = $('#inactiveDriverSelectAll');
    if (!selectAll) return;
    const rows = visibleRows();
    const selectedVisible = rows.filter(row => state.selected.has(row.driver.id));
    selectAll.checked = rows.length > 0 && selectedVisible.length === rows.length;
    selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < rows.length;
  }

  function updateSummary() {
    const summary = $('#inactiveDriverSummary');
    const selectedCount = $('#inactiveDriverSelectedCount');
    const rows = visibleRows();
    if (summary) {
      summary.textContent = `무실적 ${weekRangeLabel()} ${rows.length}명 · 조회 ${neededLookbackWeeks()}주 · 정산주(수~화) · 콜수입력 기준`;
    }
    if (selectedCount) {
      selectedCount.textContent = `선택 ${state.selected.size}명`;
    }
    const applyOff = $('#inactiveDriverApplyOffBtn');
    const applyLeft = $('#inactiveDriverApplyLeftBtn');
    const viewOnly = Boolean(document.querySelector('#inactive-drivers .admin-view-only-banner'));
    const disabled = state.applying || state.selected.size === 0 || viewOnly;
    if (applyOff) applyOff.disabled = disabled;
    if (applyLeft) applyLeft.disabled = disabled;
    syncSelectAll();
  }

  function renderTable() {
    const body = $('#inactiveDriverRows');
    if (!body) return;
    const rows = visibleRows();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" class="inactive-drivers-empty">조건에 맞는 기사가 없습니다.</td></tr>';
      updateSummary();
      return;
    }

    const utils = window.BremDriverUtils;
    body.innerHTML = rows.map(row => {
      const statusClass = utils?.statusClass?.(row.status) || '';
      const phone = utils?.formatPhoneDisplay?.(row.driver.phone) || row.driver.phone || '-';
      const platforms = utils?.renderPlatformBadges?.(row.driver) || '-';
      const lookback = neededLookbackWeeks();
      const weekLabel = row.consecutive >= lookback && !row.lastActiveWeek
        ? `${lookback}주+`
        : `${row.consecutive}주`;
      return `
        <tr data-driver-id="${escapeHtml(row.driver.id)}">
          <td class="inactive-drivers-check-cell">
            <input type="checkbox" data-inactive-driver-id="${escapeHtml(row.driver.id)}" ${state.selected.has(row.driver.id) ? 'checked' : ''}>
          </td>
          <td><strong>${escapeHtml(row.driver.name || '-')}</strong></td>
          <td>${escapeHtml(loginId(row.driver) || '-')}</td>
          <td>${escapeHtml(phone)}</td>
          <td><span class="badge ${statusClass}">${escapeHtml(row.status)}</span></td>
          <td>${escapeHtml(formatJoinDate(row.driver))}</td>
          <td>${escapeHtml(row.lastActiveWeek ? formatWeekLabel(row.lastActiveWeek) : '없음')}</td>
          <td class="inactive-drivers-weeks">${escapeHtml(weekLabel)}</td>
          <td>${platforms}</td>
        </tr>
      `;
    }).join('');
    updateSummary();
  }

  function collectRows() {
    const weekKeys = lookbackWeekKeys();
    const callIndex = buildCallWeekIndex(weekKeys);
    const drivers = window.BremStorage?.drivers?.getAll?.() || [];
    state.rows = drivers
      .map(driver => {
        const stats = analyzeDriver(driver, weekKeys, callIndex);
        return {
          driver,
          status: driverStatus(driver),
          consecutive: stats.consecutive,
          lastActiveWeek: stats.lastActiveWeek
        };
      })
      .filter(row => row.consecutive > 0)
      .sort((a, b) => (
        b.consecutive - a.consecutive
        || String(a.driver.name || '').localeCompare(String(b.driver.name || ''), 'ko')
      ));

    const visibleIds = new Set(visibleRows().map(row => row.driver.id));
    state.selected = new Set([...state.selected].filter(id => visibleIds.has(id)));
  }

  function lookbackSinceDate() {
    const keys = lookbackWeekKeys();
    return keys[keys.length - 1] || todayKey();
  }

  async function applyWeekFilter() {
    applyWeekRangeFromInputs();
    if (state.loading) {
      renderTable();
      return;
    }
    if (neededLookbackWeeks() > state.loadedLookback) {
      await loadAndRender();
      return;
    }
    renderTable();
  }

  async function loadAndRender() {
    if (state.loading) return;
    state.loading = true;
    const lookback = neededLookbackWeeks();
    const hint = $('#inactiveDriverLoadHint');
    if (hint) hint.textContent = '콜수입력 실적을 불러오는 중…';
    try {
      await window.BremStorage?.ensureCallsSinceDate?.(lookbackSinceDate(), {
        merge: true
      });
      state.loadedLookback = Math.max(state.loadedLookback, lookback);
      collectRows();
      renderTable();
      if (hint) {
        const current = weekStartKey(todayKey());
        hint.textContent = `이번 정산주 ${formatWeekLabel(current)} · 콜수입력 0콜 ${weekRangeLabel()}`;
      }
    } catch (error) {
      showToast(error.message || '비활성 기사 목록을 불러오지 못했습니다.');
      if (hint) hint.textContent = '불러오기에 실패했습니다. 다시 새로고침하세요.';
    } finally {
      state.loading = false;
    }
  }

  async function applyStatus(status) {
    const ids = [...state.selected];
    if (!ids.length || state.applying) return;
    if (document.querySelector('#inactive-drivers .admin-view-only-banner')) {
      showToast('이 메뉴는 조회 전용입니다.');
      return;
    }
    const label = status === '휴무' ? '휴무' : '퇴사';
    const confirmed = window.confirm(
      `선택한 ${ids.length}명을 ${label} 처리합니다.\n라이더앱 접속이 바로 차단됩니다. 계속할까요?`
    );
    if (!confirmed) return;

    state.applying = true;
    updateSummary();
    try {
      const patches = ids.map(id => ({ id, changes: { status } }));
      await window.BremStorage.drivers.batchPatch(patches);
      showToast(`${ids.length}명을 ${label} 처리했습니다. 라이더앱 접속이 차단됩니다.`);
      state.selected.clear();
      collectRows();
      renderTable();
    } catch (error) {
      showToast(error.message || `${label} 처리에 실패했습니다.`);
    } finally {
      state.applying = false;
      updateSummary();
    }
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;

    $('#inactiveDriverSearch')?.addEventListener('input', event => {
      state.search = String(event.target.value || '');
      renderTable();
    });
    $('#inactiveDriverMinWeeks')?.addEventListener('change', () => {
      void applyWeekFilter();
    });
    $('#inactiveDriverMaxWeeks')?.addEventListener('change', () => {
      void applyWeekFilter();
    });
    $('#inactiveDriverMinWeeks')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void applyWeekFilter();
      }
    });
    $('#inactiveDriverMaxWeeks')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void applyWeekFilter();
      }
    });
    $('#inactiveDriverStatusFilter')?.addEventListener('change', event => {
      state.statusFilter = String(event.target.value || '근무중');
      renderTable();
    });
    $('#inactiveDriverSelectAll')?.addEventListener('change', event => {
      const checked = Boolean(event.target.checked);
      visibleRows().forEach(row => {
        if (checked) state.selected.add(row.driver.id);
        else state.selected.delete(row.driver.id);
      });
      renderTable();
    });
    $('#inactiveDriverRows')?.addEventListener('change', event => {
      const input = event.target.closest('input[data-inactive-driver-id]');
      if (!input) return;
      const id = String(input.dataset.inactiveDriverId || '');
      if (!id) return;
      if (input.checked) state.selected.add(id);
      else state.selected.delete(id);
      updateSummary();
    });
    $('#inactiveDriverApplyOffBtn')?.addEventListener('click', () => {
      void applyStatus('휴무');
    });
    $('#inactiveDriverApplyLeftBtn')?.addEventListener('click', () => {
      void applyStatus('퇴사');
    });
    $('#inactiveDriverRefreshBtn')?.addEventListener('click', () => {
      void loadAndRender();
    });
  }

  async function refresh() {
    bind();
    restoreWeekRange();
    syncWeekInputs();
    const statusFilter = $('#inactiveDriverStatusFilter');
    if (statusFilter && !statusFilter.value) statusFilter.value = '근무중';
    applyWeekRangeFromInputs();
    state.statusFilter = String(statusFilter?.value || '근무중');
    state.search = String($('#inactiveDriverSearch')?.value || '');
    await loadAndRender();
  }

  return { refresh };
})();
