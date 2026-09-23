(function () {
  const SLOT_LABELS = {
    morning: '아침점심', afternoon: '오후', evening: '저녁', midnight: '심야',
    MORNING: '아침', LUNCH: '점심피크', POST_LUNCH: '점심논피크',
    DINNER: '저녁피크', POST_DINNER: '저녁논피크', weekly: '주간합계'
  };
  const state = {
    date: '', platform: 'baemin', period: 'day', fromDate: '', toDate: '',
    region: '', slot: '',
    keyword: '',
    items: [], regions: [], config: null, busy: false, liveTimer: 0, dateLocked: false
  };

  const $ = id => document.getElementById(id);
  const todayKst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const kstHour = (now = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now);
    let hour = Number((parts.find(part => part.type === 'hour') || {}).value);
    if (!Number.isFinite(hour)) hour = 0;
    if (hour === 24) hour = 0;
    return hour;
  };
  const currentContributionDate = (now = new Date()) => {
    const today = todayKst();
    if (kstHour(now) < 6) {
      const date = new Date(`${today}T12:00:00+09:00`);
      date.setUTCDate(date.getUTCDate() - 1);
      return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    }
    return today;
  };
  const currentSlotKey = (platform, now = new Date()) => {
    const hour = kstHour(now);
    if (platform === 'coupang') {
      if (hour >= 7 && hour < 11) return 'MORNING';
      if (hour >= 11 && hour < 13) return 'LUNCH';
      if (hour >= 13 && hour < 17) return 'POST_LUNCH';
      if (hour >= 17 && hour < 21) return 'DINNER';
      return 'POST_DINNER';
    }
    const weekday = now.toLocaleString('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' });
    const afternoonStart = weekday === 'Sat' || weekday === 'Sun' ? 14 : 13;
    if (hour >= 6 && hour < afternoonStart) return 'morning';
    if (hour >= afternoonStart && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 20) return 'evening';
    return 'midnight';
  };
  const LIVE_MS = 8000;
  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const number = value => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  const slotLabel = key => SLOT_LABELS[String(key || '')] || String(key || '-') || '-';
  const dateTime = value => {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  };
  const toast = message => {
    if (typeof window.showToast === 'function') window.showToast(message);
    else console.log('[기여도]', message);
  };

  async function adminApi(path, options = {}) {
    const token = await window.BremStorage?.resolveAdminAccessToken?.();
    if (!token) return { ok: false, message: '관리자 로그인이 필요합니다.' };
    try {
      const response = await fetch(path, {
        credentials: 'same-origin',
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      const data = await response.json().catch(() => ({}));
      return response.ok
        ? { ok: true, ...data }
        : { ok: false, status: response.status, message: data.message || data.error || `요청 실패 (${response.status})`, ...data };
    } catch (error) {
      return { ok: false, message: error.message || '네트워크 오류' };
    }
  }

  function applyLiveDate() {
    const live = currentContributionDate();
    if (state.dateLocked) return false;
    const selected = String($('contributionDate')?.value || state.date || '').slice(0, 10);
    if (selected === live && state.date === live) return false;
    const rolled = Boolean(state.date && state.date !== live);
    state.date = live;
    if ($('contributionDate')) $('contributionDate').value = live;
    if (rolled) {
      state.region = '';
      state.slot = '';
    }
    return rolled;
  }

  function readFilters() {
    applyLiveDate();
    state.date = String($('contributionDate')?.value || currentContributionDate()).slice(0, 10);
    state.keyword = String($('contributionSearch')?.value || '').trim();
  }

  const regionOf = row => String(row?.region || row?.vendor_or_partner || '지역 미지정');
  const slotOf = row => String(row?.slot_key || '');

  function availableRegions() {
    const rows = state.period === 'week' ? state.items : [...state.regions, ...state.items];
    return [...new Set(rows.map(regionOf).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ko'));
  }

  function availableSlots() {
    if (state.period === 'week') return [];
    const rows = [...state.regions, ...state.items]
      .filter(row => !state.region || regionOf(row) === state.region);
    const order = state.platform === 'coupang'
      ? ['MORNING', 'LUNCH', 'POST_LUNCH', 'DINNER', 'POST_DINNER']
      : ['morning', 'afternoon', 'evening', 'midnight'];
    const found = new Set(rows.map(slotOf).filter(Boolean));
    return order.filter(slot => found.has(slot));
  }

  function visibleItems() {
    const keyword = state.keyword.toLowerCase();
    return state.items
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => (!state.region || regionOf(row) === state.region)
        && (!state.slot || slotOf(row) === state.slot)
        && (!keyword || [
          row.rider_name, row.name, row.erp_id, row.baemin_id,
          row.rider_id, row.region, row.vendor_or_partner, row.assigned_region
        ].join(' ').toLowerCase().includes(keyword)));
  }

  function isAllSlotsView() {
    return state.period === 'day' && !state.slot;
  }

  function rowMatched(row) {
    if (typeof row?.matched === 'boolean') return row.matched;
    return Boolean(row?.rider_id) && !String(row.rider_id).startsWith('crawl:');
  }

  function rowRegionMatched(row) {
    if (typeof row?.region_matched === 'boolean') return row.region_matched;
    const assigned = String(row?.assigned_region || '').replace(/\s+/g, '').toLowerCase();
    const region = String(row?.region || '').replace(/\s+/g, '').toLowerCase();
    return Boolean(assigned && region && assigned === region);
  }

  function matchStats(entries) {
    const people = new Map();
    entries.forEach(({ row }) => {
      const key = String(row.rider_id || row.erp_id || row.rider_name || '');
      if (!key || people.has(key)) return;
      people.set(key, row);
    });
    const list = [...people.values()];
    const matched = list.filter(rowMatched).length;
    const regionMatched = list.filter(row => rowMatched(row) && rowRegionMatched(row)).length;
    const accuracy = list.length ? Math.round((matched / list.length) * 1000) / 10 : 0;
    return { people: list.length, matched, regionMatched, accuracy };
  }

  function matchBadges(row) {
    const matched = rowMatched(row);
    const assigned = String(row.assigned_region || '').trim();
    const matchHtml = matched
      ? '<span class="contribution-match-badge is-ok">매칭</span>'
      : '<span class="contribution-match-badge is-miss">미매칭</span>';
    let regionHtml = '<span class="contribution-match-badge is-miss">지역 미매칭</span>';
    if (matched && assigned && rowRegionMatched(row)) {
      regionHtml = `<span class="contribution-match-badge is-ok" title="배정 ${esc(assigned)}">지역일치</span>`;
    } else if (matched && assigned) {
      regionHtml = `<span class="contribution-match-badge is-miss" title="배정 ${esc(assigned)} · 원장 ${esc(row.region || '-')}">지역불일치</span>`;
    } else if (matched) {
      regionHtml = '<span class="contribution-match-badge is-warn">지역 미배정</span>';
    }
    return `<div class="contribution-match-cell">${matchHtml}${regionHtml}</div>`;
  }

  function collapseByPerson(entries) {
    const groups = new Map();
    entries.forEach(({ row, index }) => {
      const key = String(row.rider_id || row.erp_id || row.rider_name || index);
      if (!groups.has(key)) {
        groups.set(key, {
          row: {
            ...row,
            points: 0,
            credited_calls: 0,
            count_08: 0,
            count_10: 0,
            frozen: true,
            slot_key: 'all',
            _slots: [],
            _indexes: []
          },
          index
        });
      }
      const item = groups.get(key);
      item.row.points += Number(row.points || 0);
      item.row.credited_calls += Number(row.credited_calls || 0);
      item.row.count_08 += Number(row.count_08 || 0);
      item.row.count_10 += Number(row.count_10 || 0);
      item.row.frozen = item.row.frozen && Boolean(row.frozen);
      if (row.slot_key) item.row._slots.push(row.slot_key);
      item.row._indexes.push(index);
      if (!item.row.matched && rowMatched(row)) item.row.matched = true;
      if (!item.row.region_matched && rowRegionMatched(row)) item.row.region_matched = true;
    });
    return [...groups.values()];
  }

  function slotCell(row) {
    if (state.period === 'week') return esc(slotLabel(row.slot_key));
    if (isAllSlotsView()) {
      const labels = [...new Set((row._slots || []).map(slotLabel))];
      return `전체${labels.length ? `<small class="contribution-slot-chips">${esc(labels.join(' · '))}</small>` : ''}`;
    }
    return esc(slotLabel(row.slot_key));
  }

  function visibleRegions() {
    return state.regions.filter(row =>
      (!state.region || regionOf(row) === state.region)
      && (!state.slot || slotOf(row) === state.slot));
  }

  function renderSubmenus() {
    const regions = availableRegions();
    if (state.region && !regions.includes(state.region)) state.region = '';
    const regionMenu = $('contributionRegionMenu');
    if (regionMenu) {
      regionMenu.innerHTML = [
        `<button type="button" class="${state.region ? '' : 'active'}" data-contribution-region="">전체 지역</button>`,
        ...regions.map(region => `<button type="button" class="${state.region === region ? 'active' : ''}" data-contribution-region="${esc(region)}">${esc(region)}</button>`)
      ].join('');
    }

    const slots = availableSlots();
    const slotSubmenu = $('contributionSlotSubmenu');
    if (slotSubmenu) slotSubmenu.hidden = state.period === 'week';
    if (state.slot && !slots.includes(state.slot)) state.slot = '';
    const slotMenu = $('contributionSlotMenu');
    const nowSlot = currentSlotKey(state.platform);
    if (slotMenu) {
      slotMenu.innerHTML = [
        `<button type="button" class="${state.slot ? '' : 'active'}" data-contribution-slot="">전체 타임</button>`,
        ...slots.map(slot => `<button type="button" class="${[
          state.slot === slot ? 'active' : '',
          slot === nowSlot ? 'is-now' : ''
        ].filter(Boolean).join(' ')}" data-contribution-slot="${esc(slot)}">${esc(slotLabel(slot))}${slot === nowSlot ? ' · 현재' : ''}</button>`)
      ].join('');
    }
  }

  function syncPlatformTabs() {
    document.querySelectorAll('[data-contribution-platform]').forEach(button => {
      const active = button.dataset.contributionPlatform === state.platform;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-contribution-period]').forEach(button => {
      const active = button.dataset.contributionPeriod === state.period;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function renderConfig(config = {}) {
    state.config = config;
    if ($('contributionBaeminPoint')) $('contributionBaeminPoint').value = config.baeminPointsPerCall ?? 10;
    if ($('contributionCoupang08Point')) $('contributionCoupang08Point').value = config.coupangPoints08 ?? 8;
    if ($('contributionCoupang10Point')) $('contributionCoupang10Point').value = config.coupangPoints10 ?? 10;
    const active = config.active === true;
    const badge = $('contributionLedgerBadge');
    if (badge) {
      badge.textContent = active ? '집계 중' : '집계 전';
      badge.classList.toggle('is-active', active);
    }
    const status = $('contributionLedgerStatus');
    if (status) {
      status.textContent = active
        ? `24시간 자동 집계 · 현재 ${slotLabel(currentSlotKey(state.platform))} · 활성화 ${dateTime(config.activatedAt)} · 규칙 v${config.version || 1}`
        : '크롤이 시작되면 자동 활성화됩니다. 시작 시점 이전 콜은 제외됩니다.';
    }
    const activate = $('contributionActivateBtn');
    if (activate) {
      activate.disabled = active;
      activate.textContent = active ? '집계 활성화됨' : '집계 시작';
    }
  }

  async function loadConfig() {
    const result = await adminApi('/api/admin/contribution/config');
    if (!result.ok) {
      renderConfig({});
      toast(result.message || '기여도 설정 조회 실패');
      return result;
    }
    renderConfig(result.config || {});
    return result;
  }

  function rulePayload() {
    return {
      baeminPointsPerCall: Math.max(0, Number($('contributionBaeminPoint')?.value || 0)),
      coupangPoints08: Math.max(0, Number($('contributionCoupang08Point')?.value || 0)),
      coupangPoints10: Math.max(0, Number($('contributionCoupang10Point')?.value || 0))
    };
  }

  async function saveRules() {
    if (state.busy) return;
    state.busy = true;
    const button = $('contributionRuleSaveBtn');
    if (button) button.disabled = true;
    try {
      const result = await adminApi('/api/admin/contribution/config', {
        method: 'POST',
        body: JSON.stringify(rulePayload())
      });
      if (!result.ok) return toast(result.message || '포인트 규칙 저장 실패');
      renderConfig(result.config || {});
      toast('포인트 규칙을 저장했습니다. 다음 크롤부터 적용됩니다.');
    } finally {
      state.busy = false;
      if (button) button.disabled = false;
    }
  }

  async function activateLedger() {
    if (state.busy || state.config?.active) return;
    const confirmed = window.confirm(
      '지금 집계를 시작하면 현재 콜수는 기준점(0점)으로 저장되고 이후 크롤 증가분만 적립됩니다. 시작할까요?'
    );
    if (!confirmed) return;
    state.busy = true;
    const button = $('contributionActivateBtn');
    if (button) button.disabled = true;
    try {
      const result = await adminApi('/api/admin/contribution/activate', {
        method: 'POST',
        body: JSON.stringify(rulePayload())
      });
      if (!result.ok) {
        toast(result.message || result.error || '기여도 집계 시작 실패');
        return;
      }
      renderConfig(result.config || {});
      toast(result.message || '기여도 집계를 시작했습니다.');
      await loadList();
    } finally {
      state.busy = false;
      if (button && !state.config?.active) button.disabled = false;
    }
  }

  function statusBadge(row) {
    if (state.period === 'week') {
      return '<span class="contribution-status-badge is-live">주간합계</span>';
    }
    return row.frozen
      ? '<span class="contribution-status-badge is-frozen">마감</span>'
      : '<span class="contribution-status-badge is-live">진행</span>';
  }

  function renderSummary(message = '') {
    const summary = $('contributionSummary');
    if (!summary) return;
    const platform = state.platform === 'coupang' ? '쿠팡' : '배민';
    const entries = visibleItems();
    const totals = entries.reduce((acc, { row }) => {
      acc.count += 1;
      acc.creditedCalls += Number(row.credited_calls || 0);
      acc.pointsSum += Number(row.points || 0);
      if (row.frozen) acc.frozen += 1;
      else acc.live += 1;
      return acc;
    }, { count: 0, creditedCalls: 0, pointsSum: 0, frozen: 0, live: 0 });
    const stats = matchStats(entries);
    const peopleLabel = (isAllSlotsView() || state.period === 'week')
      ? `기사 ${stats.people || 0}명`
      : `기사·타임 ${totals.count || 0}건`;
    summary.textContent = [
      platform, state.period === 'week' ? '주간 기여도' : '일간 기여도',
      state.region || '전체 지역',
      state.period === 'week' ? `${state.fromDate} ~ ${state.toDate}` : (state.slot ? slotLabel(state.slot) : '전체 타임'),
      peopleLabel,
      `인정 ${number(totals.creditedCalls)}콜`,
      `전체 포인트 ${number(totals.pointsSum)}`,
      `지역매칭 ${stats.regionMatched}/${stats.people}`,
      `정확도 ${number(stats.accuracy)}%`,
      state.period === 'week' ? '' : `마감 ${totals.frozen || 0}`,
      state.period === 'week' ? '' : `진행 ${totals.live || 0}`, message
    ].filter(Boolean).join(' · ');
  }

  function renderTable() {
    const target = $('contributionTable');
    if (!target) return;
    const visible = visibleItems();
    if (!visible.length) {
      target.innerHTML = `<p class="form-help">${state.config?.active
        ? '선택한 지역·타임에 적립된 기여도 이벤트가 없습니다.'
        : '포인트 규칙을 확인하고 집계 시작을 눌러 주세요.'}</p>`;
      return;
    }
    const groups = new Map();
    visible.forEach(({ row, index }) => {
      const region = String(row.region || row.vendor_or_partner || '지역 미지정');
      if (!groups.has(region)) groups.set(region, []);
      groups.get(region).push({ row, index });
    });
    target.innerHTML = [...groups.entries()].map(([region, entries]) => {
      const display = (isAllSlotsView() || state.period === 'week') ? collapseByPerson(entries) : entries;
      const regionPoints = display.reduce((sum, entry) => sum + Number(entry.row.points || 0), 0);
      display.sort((left, right) => Number(right.row.points || 0) - Number(left.row.points || 0));
      const pointLabel = isAllSlotsView() || state.period === 'week' ? '전체 포인트' : '포인트';
      const countLabel = isAllSlotsView() || state.period === 'week'
        ? `${display.length}명 · 전체 포인트 ${number(regionPoints)}점`
        : `기사·타임 ${display.length}건 · ${number(regionPoints)}점`;
      const rows = display.map(({ row, index }, rank) => {
      const platformId = row.platform === 'baemin'
        ? (row.baemin_id || '-')
        : (row.erp_id || '-');
      const estimate = row.platform === 'coupang'
        ? `<span class="contribution-estimate">0.8콜 ${number(row.count_08)} · 1콜 ${number(row.count_10)}</span>`
        : '-';
      const detailSpec = Array.isArray(row._indexes) && row._indexes.length
        ? row._indexes.join(',')
        : String(index);
      return `<tr>
        <td>${rank + 1}</td>
        <td>${slotCell(row)}</td>
        <td><strong>${esc(row.rider_name || row.name || '-')}</strong></td>
        <td><code class="contribution-rider-id">${esc(row.erp_id || '-')}</code></td>
        ${row.platform === 'baemin' ? `<td><code class="contribution-rider-id">${esc(platformId)}</code></td>` : ''}
        <td>${number(row.credited_calls)}콜</td>
        <td><strong>${number(row.points)}점</strong></td>
        <td>${matchBadges(row)}</td>
        <td>${estimate}</td>
        <td>${statusBadge(row)}</td>
        <td><button type="button" class="small-btn contribution-detail-btn" data-contribution-detail="${esc(detailSpec)}">포인트 원장</button></td>
      </tr>`;
      }).join('');
      const idColspan = state.platform === 'baemin' ? 5 : 4;
      return `<section class="contribution-region-group">
        <div class="contribution-region-group__head">
          <h3>${esc(region)}</h3><span>${countLabel}</span>
        </div>
        <div class="table-wrap"><table class="lease-table lease-table--compact contribution-ledger-table">
          <thead><tr><th>#</th><th>타임</th><th>기사</th><th>ERP ID</th>${state.platform === 'baemin' ? '<th>배민 ID</th>' : ''}<th>인정콜</th><th>${pointLabel}</th><th>매칭</th><th>쿠팡 추정</th><th>상태</th><th>상세</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr class="contribution-total-row"><td colspan="${idColspan}">합계</td><td>${number(display.reduce((sum, entry) => sum + Number(entry.row.credited_calls || 0), 0))}콜</td><td><strong>${number(regionPoints)}점</strong></td><td colspan="4"></td></tr></tfoot>
        </table></div>
      </section>`;
    }).join('');
  }

  function renderRegionProgress() {
    const target = $('contributionRegionProgress');
    if (!target) return;
    const section = $('contributionProgressSection');
    if (section) section.hidden = state.period === 'week';
    if (state.period === 'week') return;
    const rows = visibleRegions();
    if (!rows.length) {
      target.innerHTML = `<p class="form-help">${state.config?.active
        ? '현재 타임의 크롤 상태가 아직 없습니다. 현재 크롤 반영 또는 다음 자동수집 후 표시됩니다.'
        : '집계를 시작하면 지역별 현재 완료/할당이 표시됩니다.'}</p>`;
      return;
    }
    target.innerHTML = rows.map(row => {
      const rate = Math.max(0, Math.min(100, Number(row.rate || 0)));
      const status = row.target > 0 && row.completed >= row.target
        ? '<span class="contribution-progress-tag is-achieved">달성</span>'
        : (row.frozen
          ? '<span class="contribution-progress-tag is-frozen">마감</span>'
          : '<span class="contribution-progress-tag">진행중</span>');
      const estimate = row.platform === 'coupang'
        ? ` · 인정 ${number(row.weighted_calls)} 가중콜`
        : ` · 인정 ${number(row.weighted_calls)}콜`;
      return `<article class="contribution-progress-card">
        <div class="contribution-progress-card__head">
          <div><strong>${esc(row.region || row.vendor_or_partner || '-')}</strong><span>${esc(slotLabel(row.slot_key))}</span></div>
          ${status}
        </div>
        <div class="contribution-progress-card__metric">
          <strong>${number(row.completed)} / ${number(row.target)}</strong><b>${number(rate)}%</b>
        </div>
        <div class="contribution-progress-bar"><span style="width:${rate}%"></span></div>
        <p>집계 시작 후${estimate} · <strong>${number(row.points)}점</strong></p>
        <small>최근 반영 ${esc(dateTime(row.captured_at))}</small>
      </article>`;
    }).join('');
  }

  async function loadList() {
    readFilters();
    const params = new URLSearchParams({
      date: state.date,
      platform: state.platform,
      period: state.period
    });
    const result = await adminApi(`/api/admin/contribution/daily?${params}`);
    if (!result.ok) {
      state.items = [];
      state.regions = [];
      renderTable();
      renderRegionProgress();
      renderSubmenus();
      renderSummary(result.message || '조회 실패');
      if (result.tableMissing) toast('supabase/contribution_ledger_v3.sql 마이그레이션이 필요합니다.');
      return result;
    }
    state.items = Array.isArray(result.items) ? result.items : [];
    state.regions = Array.isArray(result.regions) ? result.regions : [];
    state.fromDate = String(result.fromDate || state.date);
    state.toDate = String(result.toDate || state.date);
    renderSubmenus();
    renderSummary();
    renderRegionProgress();
    renderTable();
    return result;
  }

  async function refreshAndLoad() {
    if (state.busy) return;
    state.busy = true;
    readFilters();
    const button = $('contributionRefreshBtn');
    if (button) {
      button.disabled = true;
      button.textContent = '반영 중…';
    }
    try {
      const result = await adminApi('/api/admin/contribution/refresh', {
        method: 'POST',
        body: JSON.stringify({ date: state.date, platform: state.platform })
      });
      if (!result.ok) return toast(result.message || result.error || '현재 크롤 반영 실패');
      toast(result.message || '현재 크롤을 반영했습니다.');
      await loadList();
    } finally {
      state.busy = false;
      if (button) {
        button.disabled = false;
        button.textContent = '수동 크롤 반영';
      }
    }
  }

  function openEventDetail(spec) {
    const indexes = String(spec || '')
      .split(',')
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value >= 0);
    const rows = indexes.map(index => state.items[index]).filter(Boolean);
    const popup = $('contributionEventPopup');
    const row = rows[0];
    if (!row || !popup) return;
    const events = rows.flatMap(item => Array.isArray(item.raw_json?.events) ? item.raw_json.events : []);
    const totalPoints = rows.reduce((sum, item) => sum + Number(item.points || 0), 0);
    const groups = new Map();
    events.forEach(event => {
      const date = String(event.date || row.date || '').slice(0, 10);
      const slot = String(event.slot_key || (row.slot_key === 'weekly' ? '' : row.slot_key) || '');
      const key = [date, slot].join('|');
      const group = groups.get(key) || {
        date, slot, points: 0, latestAt: ''
      };
      group.points += Number(event.points || 0);
      if (String(event.captured_at || '') > group.latestAt) group.latestAt = event.captured_at;
      groups.set(key, group);
    });
    const ledgerGroups = [...groups.values()].sort((a, b) =>
      String(b.date).localeCompare(String(a.date))
      || String(b.latestAt).localeCompare(String(a.latestAt)));
    $('contributionEventTitle').textContent = `${row.rider_name || row.name || '-'} · 포인트 원장`;
    $('contributionEventSummary').textContent = `총 받은 포인트 ${number(totalPoints)}점`;
    $('contributionEventTable').innerHTML = ledgerGroups.length
      ? `<div class="contribution-event-list">${ledgerGroups.map(group => `
        <article class="contribution-event-item">
          <div><strong>${esc((() => {
            const parts = group.date.split('-');
            return parts.length === 3 ? `${Number(parts[1])}월 ${Number(parts[2])}일` : group.date || '-';
          })())} · ${row.platform === 'coupang' ? '쿠팡' : '배민'} · ${esc(slotLabel(group.slot))}</strong><b>+${number(group.points)}점</b></div>
        </article>`).join('')}</div>`
      : '<p class="form-help">원장 이벤트가 없습니다.</p>';
    popup.hidden = false;
  }

  function closeEventDetail() {
    const popup = $('contributionEventPopup');
    if (popup) popup.hidden = true;
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;
    $('contributionRuleSaveBtn')?.addEventListener('click', () => void saveRules());
    $('contributionActivateBtn')?.addEventListener('click', () => void activateLedger());
    $('contributionRefreshBtn')?.addEventListener('click', () => void refreshAndLoad());
    $('contributionLoadBtn')?.addEventListener('click', () => void loadList());
    $('contributionDate')?.addEventListener('change', () => {
      const live = currentContributionDate();
      const value = String($('contributionDate')?.value || live).slice(0, 10);
      state.dateLocked = value !== live;
      state.date = value;
      if (!state.dateLocked) {
        state.region = '';
        state.slot = '';
      }
      void loadList();
    });
    document.querySelectorAll('[data-contribution-platform]').forEach(button => {
      button.addEventListener('click', () => {
        state.platform = button.dataset.contributionPlatform === 'coupang' ? 'coupang' : 'baemin';
        state.region = '';
        state.slot = '';
        syncPlatformTabs();
        void loadList();
      });
    });
    document.querySelectorAll('[data-contribution-period]').forEach(button => {
      button.addEventListener('click', () => {
        state.period = button.dataset.contributionPeriod === 'week' ? 'week' : 'day';
        state.region = '';
        state.slot = '';
        syncPlatformTabs();
        void loadList();
      });
    });
    let searchTimer = 0;
    $('contributionSearch')?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        readFilters();
        renderSummary();
        renderTable();
      }, 150);
    });
    $('contributionRegionMenu')?.addEventListener('click', event => {
      const button = event.target.closest('[data-contribution-region]');
      if (!button) return;
      state.region = String(button.dataset.contributionRegion || '');
      state.slot = '';
      renderSubmenus();
      renderSummary();
      renderRegionProgress();
      renderTable();
    });
    $('contributionSlotMenu')?.addEventListener('click', event => {
      const button = event.target.closest('[data-contribution-slot]');
      if (!button) return;
      state.slot = String(button.dataset.contributionSlot || '');
      renderSubmenus();
      renderSummary();
      renderRegionProgress();
      renderTable();
    });
    $('contributionTable')?.addEventListener('click', event => {
      const button = event.target.closest('[data-contribution-detail]');
      if (button) openEventDetail(button.dataset.contributionDetail);
    });
    $('contributionEventPopup')?.addEventListener('click', event => {
      if (event.target.closest('[data-contribution-event-close]')) closeEventDetail();
    });
  }

  async function refresh() {
    bindEvents();
    state.dateLocked = false;
    applyLiveDate();
    if (!state.date) state.date = currentContributionDate();
    if ($('contributionDate')) $('contributionDate').value = state.date;
    syncPlatformTabs();
    await loadConfig();
    await loadList();
    startLiveWatch();
  }

  function stopLiveWatch() {
    if (state.liveTimer) {
      clearInterval(state.liveTimer);
      state.liveTimer = 0;
    }
  }

  function startLiveWatch() {
    stopLiveWatch();
    if (!$('contribution')?.classList.contains('active')) return;
    state.liveTimer = setInterval(() => {
      if (state.busy || document.hidden) return;
      if (!$('contribution')?.classList.contains('active')) {
        stopLiveWatch();
        return;
      }
      if (applyLiveDate()) toast(`영업일 ${state.date} 기여도로 이동합니다.`);
      void loadList();
    }, LIVE_MS);
  }

  window.BremContributionAdmin = { refresh, loadList, refreshAndLoad, stopLiveWatch };
})();
