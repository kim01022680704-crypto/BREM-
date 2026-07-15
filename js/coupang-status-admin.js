/**
 * BREM 관리자 · 쿠팡 현황 (조회 전용)
 * coupang_collect_items 를 /api/admin/coupang/* 로 읽어 표시.
 * 수집은 PC 로컬 세션 서버(npm run coupang:session-server)에서 수행.
 */
(function () {
  'use strict';

  const MENUS = [
    { id: 'peak_realtime', label: '피크타임 현황(오늘)' },
    { id: 'weekly_performance', label: '요일별 달성(주간)' },
    { id: 'vendor_info', label: '지역별 요약' },
    { id: 'rider_daily', label: '라이더별' }
  ];

  const LOCAL_BASE = 'http://127.0.0.1:3940';
  const PEAK_ORDER = ['MORNING', 'LUNCH', 'POST_LUNCH', 'DINNER', 'POST_DINNER'];
  const PEAK_LABEL = {
    MORNING: '아침',
    LUNCH: '점심피크',
    POST_LUNCH: '점심논피크',
    DINNER: '저녁피크',
    POST_DINNER: '저녁논피크'
  };
  const state = { activeMenu: 'peak_realtime', loaded: false };
  const dash = {
    busy: false,
    pollTimer: null,
    weekVendorId: '',
    weekCache: null,
    weekRange: null,
    bound: false
  };
  const local = { running: false, hasToken: false, vendorCount: 0, collecting: false, loop: {} };
  let localPollTimer = null;
  const $ = (id) => document.getElementById(id);

  function dp() { return window.BremDatePicker; }
  function localDateKey(d) {
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-');
  }
  function currentWeekStart() {
    const val = $('coupangStatusWeekDate')?.value || '';
    const picker = dp();
    if (!picker) return String(val || '').slice(0, 10);
    return picker.applyWeekWednesday(val || picker.weekStartKey());
  }
  function setWeekLabel() {
    const btn = $('coupangStatusWeekBtn');
    if (!btn) return;
    const ws = currentWeekStart();
    if (!ws) { btn.textContent = '수요일 선택'; return; }
    const wd = dp()?.formatWeekdayKo ? dp().formatWeekdayKo(ws) : '수';
    btn.textContent = `${dp()?.formatDate ? dp().formatDate(ws) : ws}(${wd})`;
  }
  function shiftWeek(days) {
    const cur = currentWeekStart();
    const d = new Date(`${cur}T00:00:00`);
    if (Number.isNaN(d.getTime())) return;
    d.setDate(d.getDate() + days);
    const next = dp() ? dp().applyWeekWednesday(localDateKey(d)) : localDateKey(d);
    const input = $('coupangStatusWeekDate');
    if (input) input.value = next;
    setWeekLabel();
    renderWeekPreview();
  }
  function renderWeekPreview() {
    const el = $('coupangStatusWeekPreview');
    if (!el) return;
    const ws = currentWeekStart();
    if (!ws) { el.textContent = '수요일을 선택하면 수~화 범위가 표시됩니다'; return; }
    const range = dp()?.formatWednesdayWeekRangeLong
      ? dp().formatWednesdayWeekRangeLong(ws)
      : (dp()?.formatWednesdayWeekRange ? dp().formatWednesdayWeekRange(ws) : `${ws} ~`);
    el.textContent = `수집 범위 ${range} · 라이더/지역을 하루씩 저장`;
  }
  function onWeekPicked(value) {
    const input = $('coupangStatusWeekDate');
    if (input && value) input.value = dp() ? dp().applyWeekWednesday(value) : value;
    setWeekLabel();
    renderWeekPreview();
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function n(v, d = 0) {
    const x = Number(v);
    return Number.isFinite(x) ? (Math.round(x * 100) / 100).toLocaleString('ko-KR') : d;
  }
  function toast(msg) {
    if (window.BremBaeminDeliveryStatusAdmin?.showToast) return window.BremBaeminDeliveryStatusAdmin.showToast(msg);
    console.log('[coupang]', msg);
  }

  async function adminApi(path, options = {}) {
    const token = await window.BremStorage?.resolveAdminAccessToken?.();
    if (!token) return { ok: false, message: '관리자 로그인이 필요합니다.' };
    try {
      const res = await fetch(path, {
        credentials: 'same-origin',
        ...options,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: payload.message || payload.error || `요청 실패 (${res.status})` };
      return { ok: true, ...payload };
    } catch (e) {
      return { ok: false, message: e.message || '네트워크 오류' };
    }
  }

  function renderMenuBar() {
    const bar = $('coupangStatusMenuBar');
    if (!bar) return;
    bar.innerHTML = MENUS.map(m =>
      `<button type="button" class="baemin-menu-tab${m.id === state.activeMenu ? ' is-active' : ''}" data-coupang-menu="${m.id}">${esc(m.label)}</button>`
    ).join('');
    bar.querySelectorAll('[data-coupang-menu]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeMenu = btn.dataset.coupangMenu;
        renderMenuBar();
        void loadItems();
      });
    });
  }

  function renderQuotaTagCell(actual, target) {
    const a = Number(actual) || 0;
    const t = Number(target) || 0;
    if (!t && !a) {
      return '<td class="dashboard-baemin-qcell"><span class="form-help">-</span></td>';
    }
    const achieved = t > 0 ? a >= t : a > 0;
    const statusClass = achieved ? 'baemin-quota-tag--achieved' : 'baemin-quota-tag--missed';
    return `<td class="dashboard-baemin-qcell">
      <div class="dashboard-baemin-qcell__stack">
        <span class="dashboard-baemin-qcell__ratio">${esc(n(a))} / ${esc(n(t))}</span>
        <span class="dashboard-baemin-qcell__meta">
          <span class="baemin-quota-tag ${statusClass}">${achieved ? '달성' : '미달성'}</span>
        </span>
      </div>
    </td>`;
  }

  function tableFor(menu, items) {
    if (!items.length) return '<p class="form-help">데이터가 없습니다. PC에서 수집(coupang:session-server → /collect) 후 조회하세요.</p>';
    const rows = items.map(it => it.parsed_json || {});
    if (menu === 'peak_realtime') {
      return wrapHtml(['지역', '피크', '완료/목표', '잔여', '상태', '거절율'],
        rows.map(p => {
          const done = Number(p.completedCount) || 0;
          const goal = Number(p.goalCount) || 0;
          const achieved = goal > 0 ? done >= goal : done > 0;
          const tag = (goal || done)
            ? `<span class="baemin-quota-tag ${achieved ? 'baemin-quota-tag--achieved' : 'baemin-quota-tag--missed'}">${achieved ? '달성' : '미달성'}</span>`
            : '-';
          return [
            esc(p.vendorName || p.vendorId),
            esc(p.peakLabel || p.peakType),
            `${n(done)} / ${n(goal)}`,
            esc(n(p.remainingCount)),
            tag,
            '-'
          ];
        }), true);
    }
    if (menu === 'weekly_performance') {
      return wrapHtml(['지역', '요일', '타임존', '완료/목표', '상태', '거절율'],
        rows.map(p => {
          const done = p.completedCount == null ? 0 : Number(p.completedCount) || 0;
          const goal = Number(p.goalCount) || 0;
          const has = p.completedCount != null || goal > 0;
          const achieved = goal > 0 ? done >= goal : done > 0;
          const tag = has
            ? `<span class="baemin-quota-tag ${achieved ? 'baemin-quota-tag--achieved' : 'baemin-quota-tag--missed'}">${achieved ? '달성' : '미달성'}</span>`
            : '-';
          const ratio = p.completedCount == null && !goal ? '-' : `${p.completedCount == null ? '-' : n(done)} / ${n(goal)}`;
          return [
            esc(p.vendorName || p.vendorId),
            esc(p.dayOfWeek),
            esc(p.peakLabel || p.peakType),
            ratio,
            tag,
            p.rejectionRate == null ? '-' : `${n(p.rejectionRate)}%`
          ];
        }), true);
    }
    if (menu === 'vendor_info') {
      return wrapHtml(['지역', '목표', '완료', '진행중', '운행중', '거절율'],
        rows.map(p => [
          esc(p.vendorName || p.vendorId),
          esc(n(p.target)),
          esc(n(p.completedCount)),
          esc(n(p.onGoingCount)),
          esc(`${n(p.riderOnLineCount)}/${n(p.riderTotalCount)}`),
          p.rejectionRate == null ? '-' : `${n(p.rejectionRate)}%`
        ]), true);
    }
    // rider_daily
    return wrap(['매칭키', '이름', '연락처', '쿠팡ID', '완료', '거절', '취소', '지역'],
      rows.map(p => [p.matchKey, p.name, p.phone, p.courierId, n(p.completeCount), n(p.rejectCount), n(p.cancelCount), p.vendorName || p.vendorId]));
  }

  function wrap(headers, rows) {
    return `<div class="dashboard-baemin-table-wrap"><table class="admin-table">
      <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  function wrapHtml(headers, rows, alreadyEscaped) {
    return `<div class="dashboard-baemin-table-wrap"><table class="admin-table dashboard-baemin-compact-table">
      <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${alreadyEscaped ? c : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  function todayBusinessKey() {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    if (kst.getUTCHours() < 6) kst.setUTCDate(kst.getUTCDate() - 1);
    return kst.toISOString().slice(0, 10);
  }

  function addDaysKey(dateKey, days) {
    const d = new Date(`${String(dateKey).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + days);
    return localDateKey(d);
  }

  function listDatesInclusive(fromDate, toDate) {
    const out = [];
    let cur = String(fromDate || '').slice(0, 10);
    const end = String(toDate || '').slice(0, 10);
    if (!cur || !end || end < cur) return out;
    for (let i = 0; i < 14 && cur <= end; i += 1) {
      out.push(cur);
      cur = addDaysKey(cur, 1);
    }
    return out;
  }

  function formatDateTimeLabel(d) {
    const x = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(x.getTime())) return '—';
    const pad = (v) => String(v).padStart(2, '0');
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())} ${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}`;
  }

  function formatDeliveryDateWithWeekday(dateKey) {
    const picker = dp();
    if (picker?.formatDate && picker?.formatWeekdayKo) {
      return `${picker.formatDate(dateKey)}(${picker.formatWeekdayKo(dateKey)})`;
    }
    return String(dateKey || '').slice(0, 10);
  }

  function thisWeekWedToToday() {
    const today = todayBusinessKey();
    const weekStart = dp()?.weekStartKey ? dp().weekStartKey(today) : today;
    return { fromDate: weekStart, toDate: today, weekStart };
  }

  function emptyPeaks() {
    return Object.fromEntries(PEAK_ORDER.map(pt => [pt, { goal: 0, completed: 0, has: false }]));
  }

  function bindDashboardCardOnce() {
    if (dash.bound) return;
    dash.bound = true;
    $('dashboardCoupangLiveQueryBtn')?.addEventListener('click', () => {
      void queryDashboardCoupangLive({ silent: false });
    });
    $('dashboardCoupangOpenStatusBtn')?.addEventListener('click', () => {
      document.querySelector('[data-section="coupang-rider-status"]')?.click();
    });
    startDashboardCoupangLivePoll();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const dashboard = $('dashboard');
      if (dashboard?.classList.contains('active') && !dash.busy) {
        void queryDashboardCoupangLive({ silent: true });
      }
    });
  }

  async function loadConfig() {
    const cfg = await adminApi('/api/admin/coupang/config');
    const el = $('coupangStatusSession');
    if (!el) return;
    if (!cfg.ok) { el.textContent = cfg.message || '상태 조회 실패'; return; }
    const s = cfg.session || {};
    const parts = [];
    parts.push(s.hasToken ? (s.expired ? '세션: 만료됨(갱신 필요)' : '세션: 연결됨') : '세션: 없음(PC 로컬 서버 로그인 필요)');
    if (cfg.latest) {
      const l = cfg.latest;
      parts.push(`최근수집 · 피크 ${l.peak_realtime || '-'} · 주간 ${l.weekly_performance || '-'} · 지역 ${l.vendor_info || '-'} · 라이더 ${l.rider_daily || '-'}`);
    }
    el.textContent = parts.join('  |  ');
  }

  async function loadItems() {
    const summary = $('coupangStatusSummary');
    const tableEl = $('coupangStatusTable');
    if (!tableEl) return;
    const day = String($('coupangStatusDate')?.value || '').slice(0, 10);
    const weekStart = currentWeekStart();
    if (summary) summary.textContent = '불러오는 중…';
    let q = `/api/admin/coupang/items?sourceMenu=${encodeURIComponent(state.activeMenu)}`;
    let labelDate = day;
    if (state.activeMenu === 'weekly_performance') {
      // 주간 데이터는 collect_date = 수요일(정산주 시작)
      const ws = weekStart || day;
      if (ws) q += `&collectDate=${encodeURIComponent(ws)}`;
      labelDate = ws;
    } else if (day) {
      q += `&collectDate=${encodeURIComponent(day)}`;
    }
    const res = await adminApi(q);
    if (!res.ok) {
      if (summary) summary.textContent = res.message || '조회 실패';
      tableEl.innerHTML = `<p class="form-help">${esc(res.message || '조회 실패')}</p>`;
      return;
    }
    const items = res.items || [];
    tableEl.innerHTML = tableFor(state.activeMenu, items);
    if (summary) {
      const menuLabel = MENUS.find(m => m.id === state.activeMenu)?.label || state.activeMenu;
      const hint = state.activeMenu === 'rider_daily'
        ? ' · 날짜를 바꿔 [하루 조회]'
        : (state.activeMenu === 'weekly_performance' ? ' · 정산주(수)' : '');
      summary.textContent = `${menuLabel} · ${items.length}건${labelDate ? ' · ' + labelDate : ''}${hint}`;
    }
  }

  function renderTodayTable(regionRows, totals) {
    const peakHeads = PEAK_ORDER.map(pt => `<th>${esc(PEAK_LABEL[pt])}</th>`).join('');
    const summaryPeakCells = PEAK_ORDER.map(pt =>
      renderQuotaTagCell(totals.peaks[pt].completed, totals.peaks[pt].goal)
    ).join('');
    const summaryRow = `<tr class="dashboard-baemin-compact-table__summary">
      <td><strong>전체 합계</strong></td>
      <td>${esc(n(totals.drivingSum))}명</td>
      ${summaryPeakCells}
      <td>${totals.rejectionRate == null ? '-' : `${esc(n(totals.rejectionRate))}%`}</td>
    </tr>`;
    const bodyRows = regionRows.map(region => {
      const peakCells = PEAK_ORDER.map(pt => {
        const peak = region.peaks[pt] || { goal: 0, completed: 0 };
        return renderQuotaTagCell(peak.completed, peak.goal);
      }).join('');
      return `<tr>
        <td><strong class="dashboard-baemin-region-name">${esc(region.vendorName)}</strong></td>
        <td>${esc(n(region.drivingCount))}명</td>
        ${peakCells}
        <td>${region.rejectionRate == null ? '-' : `${esc(n(region.rejectionRate))}%`}</td>
      </tr>`;
    }).join('');
    return `<div class="dashboard-baemin-table-wrap">
      <table class="admin-table dashboard-baemin-compact-table">
        <thead>
          <tr>
            <th>지역</th>
            <th>운행중</th>
            ${peakHeads}
            <th>거절율</th>
          </tr>
        </thead>
        <tbody>${summaryRow}${bodyRows}</tbody>
      </table>
    </div>`;
  }

  function renderWeekRegionTabs(vendors) {
    const bar = $('dashboardCoupangWeekRegionBar');
    if (!bar) return;
    const list = vendors || [];
    if (!list.length) {
      bar.hidden = true;
      bar.innerHTML = '';
      dash.weekVendorId = '';
      return;
    }
    if (!list.some(v => v.vendorId === dash.weekVendorId)) {
      dash.weekVendorId = list[0].vendorId;
    }
    bar.hidden = false;
    bar.innerHTML = list.map(v => {
      const active = v.vendorId === dash.weekVendorId ? ' is-active' : '';
      return `<button type="button" class="baemin-region-tab${active}" data-coupang-week-vendor="${esc(v.vendorId)}" aria-pressed="${v.vendorId === dash.weekVendorId ? 'true' : 'false'}">${esc(v.vendorName)}</button>`;
    }).join('');
    bar.querySelectorAll('[data-coupang-week-vendor]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.coupangWeekVendor || '';
        if (!id || id === dash.weekVendorId) return;
        dash.weekVendorId = id;
        renderWeekRegionTabs(list);
        renderWeekRowsForVendor(id);
      });
    });
  }

  function renderWeekRowsForVendor(vendorId) {
    const rowsEl = $('dashboardCoupangWeekRows');
    const summaryEl = $('dashboardCoupangWeekSummary');
    if (!rowsEl || !dash.weekCache || !dash.weekRange) return;
    const vendor = (dash.weekCache.vendors || []).find(v => v.vendorId === vendorId);
    const regionName = vendor?.vendorName || vendorId;
    const byDate = dash.weekCache.byVendor?.[vendorId] || {};
    const dates = listDatesInclusive(dash.weekRange.fromDate, dash.weekRange.toDate);
    if (!dates.length) {
      rowsEl.innerHTML = '<tr><td colspan="8" class="form-help">이번주 조회 기간이 없습니다.</td></tr>';
      if (summaryEl) summaryEl.textContent = '조회 기간 없음';
      return;
    }
    let filled = 0;
    rowsEl.innerHTML = dates.map(date => {
      const day = byDate[date];
      if (day) filled += 1;
      const peaks = day?.peaks || emptyPeaks();
      const peakCells = PEAK_ORDER.map(pt =>
        renderQuotaTagCell(peaks[pt]?.completed || 0, peaks[pt]?.goal || 0)
      ).join('');
      const rej = day?.rejectionRate;
      return `<tr>
        <td><strong class="dashboard-baemin-region-name">${esc(regionName)}</strong></td>
        <td>${esc(formatDeliveryDateWithWeekday(date))}</td>
        ${peakCells}
        <td>${rej == null ? '-' : `${esc(n(rej))}%`}</td>
      </tr>`;
    }).join('');
    if (summaryEl) {
      summaryEl.textContent = `${regionName} · ${dash.weekRange.fromDate} ~ ${dash.weekRange.toDate} · 데이터 ${filled}/${dates.length}일 · 이번주 수~오늘`;
    }
    persistWeekCache();
  }

  async function loadWeekQuota(vendorsHint = []) {
    const weekRange = thisWeekWedToToday();
    dash.weekRange = weekRange;
    const summaryEl = $('dashboardCoupangWeekSummary');
    const rowsEl = $('dashboardCoupangWeekRows');
    if (summaryEl) summaryEl.textContent = `${weekRange.fromDate} ~ ${weekRange.toDate} · 불러오는 중…`;

    const res = await adminApi(
      `/api/admin/coupang/items?sourceMenu=weekly_performance&collectDate=${encodeURIComponent(weekRange.weekStart)}`
    );
    if (!res.ok) {
      if (rowsEl) rowsEl.innerHTML = `<tr><td colspan="8" class="form-help">${esc(res.message || '주간 조회 실패')}</td></tr>`;
      if (summaryEl) summaryEl.textContent = res.message || '주간 조회 실패';
      return;
    }

    const byVendor = {};
    const vendorMap = new Map();
    (res.items || []).forEach(it => {
      const p = it.parsed_json || {};
      const vid = String(p.vendorId || it.vendor_id || '').trim();
      const date = String(p.date || '').slice(0, 10);
      if (!vid || !date || date < weekRange.fromDate || date > weekRange.toDate) return;
      const name = String(p.vendorName || it.vendor_name || vid);
      if (!vendorMap.has(vid)) vendorMap.set(vid, name);
      if (!byVendor[vid]) byVendor[vid] = {};
      if (!byVendor[vid][date]) {
        byVendor[vid][date] = { peaks: emptyPeaks(), rejectionRate: null };
      }
      const day = byVendor[vid][date];
      const pt = String(p.peakType || '').toUpperCase();
      if (PEAK_ORDER.includes(pt)) {
        day.peaks[pt].goal += Number(p.goalCount) || 0;
        if (p.completedCount != null) {
          day.peaks[pt].completed += Number(p.completedCount) || 0;
          day.peaks[pt].has = true;
        }
      }
      if (p.rejectionRate != null) day.rejectionRate = Number(p.rejectionRate);
    });

    let vendors = Array.from(vendorMap.entries()).map(([vendorId, vendorName]) => ({ vendorId, vendorName }));
    if (!vendors.length && vendorsHint.length) vendors = vendorsHint.slice();
    vendors.sort((a, b) => String(a.vendorName).localeCompare(String(b.vendorName), 'ko'));
    dash.weekCache = { vendors, byVendor, weekRange };
    renderWeekRegionTabs(vendors);
    if (!vendors.length) {
      if (rowsEl) rowsEl.innerHTML = '<tr><td colspan="8" class="form-help">이번주 할당 데이터가 없습니다. 쿠팡 밴더현황에서 주간 수집 후 다시 조회하세요.</td></tr>';
      if (summaryEl) summaryEl.textContent = '주간 데이터 없음';
      return;
    }
    renderWeekRowsForVendor(dash.weekVendorId || vendors[0].vendorId);
  }

  async function queryDashboardCoupangLive(options = {}) {
    const silent = options.silent === true;
    const mount = $('dashboardCoupangCard');
    const summary = $('dashboardCoupangLiveSummary');
    const appliedEl = $('dashboardCoupangAppliedTime');
    const btn = $('dashboardCoupangLiveQueryBtn');
    const card = $('dashboardCoupangLiveCard');
    if (!mount) return;
    bindDashboardCardOnce();
    if (dash.busy) return;
    dash.busy = true;

    if (!silent) {
      btn?.classList.add('is-loading');
      if (btn) btn.textContent = '조회 중…';
      if (summary) summary.textContent = '오늘 피크·운행중 불러오는 중…';
    } else {
      card?.classList.add('is-soft-refreshing');
    }

    try {
      const today = todayBusinessKey();
      const queriedAt = new Date();
      if (appliedEl) {
        appliedEl.innerHTML = `기준일 ${esc(today)}<span class="dashboard-baemin-queried-at"> · 자동조회 ${esc(formatDateTimeLabel(queriedAt))}</span>`;
      }

      const [peakRes, vendorRes] = await Promise.all([
        adminApi(`/api/admin/coupang/items?sourceMenu=peak_realtime&collectDate=${encodeURIComponent(today)}`),
        adminApi(`/api/admin/coupang/items?sourceMenu=vendor_info&collectDate=${encodeURIComponent(today)}`)
      ]);

      if (!peakRes.ok && !vendorRes.ok) {
        const msg = peakRes.message || vendorRes.message || '조회 실패';
        if (!silent) {
          mount.innerHTML = `<p class="form-help">${esc(msg)}</p>`;
          if (summary) summary.textContent = msg;
          toast(msg);
        }
        return;
      }

      const vendorById = new Map();
      (vendorRes.items || []).forEach(it => {
        const p = it.parsed_json || {};
        const vid = String(p.vendorId || it.vendor_id || '').trim();
        if (!vid) return;
        vendorById.set(vid, {
          vendorId: vid,
          vendorName: String(p.vendorName || it.vendor_name || vid),
          drivingCount: Number(p.riderOnLineCount) || 0,
          riderTotalCount: Number(p.riderTotalCount) || 0,
          rejectionRate: p.rejectionRate == null ? null : Number(p.rejectionRate),
          peaks: emptyPeaks()
        });
      });

      (peakRes.items || []).forEach(it => {
        const p = it.parsed_json || {};
        const vid = String(p.vendorId || it.vendor_id || '').trim();
        if (!vid) return;
        if (!vendorById.has(vid)) {
          vendorById.set(vid, {
            vendorId: vid,
            vendorName: String(p.vendorName || it.vendor_name || vid),
            drivingCount: 0,
            riderTotalCount: 0,
            rejectionRate: null,
            peaks: emptyPeaks()
          });
        }
        const row = vendorById.get(vid);
        if (p.vendorName) row.vendorName = String(p.vendorName);
        const pt = String(p.peakType || '').toUpperCase();
        if (!PEAK_ORDER.includes(pt)) return;
        row.peaks[pt].goal += Number(p.goalCount) || 0;
        row.peaks[pt].completed += Number(p.completedCount) || 0;
        row.peaks[pt].has = true;
      });

      const regionRows = Array.from(vendorById.values())
        .sort((a, b) => String(a.vendorName).localeCompare(String(b.vendorName), 'ko'));

      if (!regionRows.length) {
        if (!silent) {
          mount.innerHTML = '<p class="form-help">오늘 피크·지역 수집 데이터가 없습니다. 쿠팡 밴더현황에서 오늘 수집 또는 자동순회를 실행하세요.</p>';
          if (summary) summary.textContent = '오늘 데이터 없음';
        }
        return;
      }

      const totals = {
        drivingSum: 0,
        rejectionRateSum: 0,
        rejectionRateN: 0,
        rejectionRate: null,
        peaks: emptyPeaks()
      };
      regionRows.forEach(r => {
        totals.drivingSum += r.drivingCount;
        if (r.rejectionRate != null) {
          totals.rejectionRateSum += r.rejectionRate;
          totals.rejectionRateN += 1;
        }
        PEAK_ORDER.forEach(pt => {
          totals.peaks[pt].goal += r.peaks[pt].goal;
          totals.peaks[pt].completed += r.peaks[pt].completed;
        });
      });
      if (totals.rejectionRateN > 0) {
        totals.rejectionRate = Math.round((totals.rejectionRateSum / totals.rejectionRateN) * 10) / 10;
      }

      mount.innerHTML = renderTodayTable(regionRows, totals);
      const summaryText = `오늘 ${today} · 지역 ${regionRows.length}곳 · 운행중 ${n(totals.drivingSum)}명 · 피크 할당 대비 · 2분마다 자동 조회`;
      if (summary) summary.textContent = summaryText;
      persistTodayCache();
      if (!silent || !dash.weekCache) {
        void loadWeekQuota(regionRows.map(r => ({ vendorId: r.vendorId, vendorName: r.vendorName })));
      }
      if (!silent) {
        toast(`오늘 쿠팡 할당 · 운행중 ${n(totals.drivingSum)}명 · 지역 ${regionRows.length}곳`);
      }
    } finally {
      dash.busy = false;
      card?.classList.remove('is-soft-refreshing');
      if (!silent) {
        btn?.classList.remove('is-loading');
        if (btn) btn.textContent = '실시간 조회';
      } else if (btn && !btn.classList.contains('is-loading')) {
        btn.textContent = '실시간 조회';
      }
    }
  }

  function stopDashboardCoupangLivePoll() {
    if (dash.pollTimer) {
      clearInterval(dash.pollTimer);
      dash.pollTimer = null;
    }
  }

  function startDashboardCoupangLivePoll() {
    stopDashboardCoupangLivePoll();
    const POLL_MS = 2 * 60 * 1000;
    dash.pollTimer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      const dashboard = $('dashboard');
      if (!dashboard || !dashboard.classList.contains('active')) return;
      void queryDashboardCoupangLive({ silent: true });
    }, POLL_MS);
  }

  const DASHBOARD_CACHE_KEY = 'brem_dashboard_coupang_cache';

  function readDashboardCache() {
    try { return JSON.parse(localStorage.getItem(DASHBOARD_CACHE_KEY) || 'null'); } catch { return null; }
  }
  function saveDashboardCache(data) {
    try { localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }
  function mergeDashboardCache(patch) {
    const prev = readDashboardCache() || {};
    saveDashboardCache({ ...prev, ...patch, savedAt: Date.now() });
  }

  // 대시보드 열자마자 마지막 숫자를 즉시 표시 → 뒤에서 최신값으로 조용히 갱신 (배민과 동일)
  function paintDashboardCacheInstant() {
    const cache = readDashboardCache();
    if (!cache) return;

    const mount = $('dashboardCoupangCard');
    if (mount && !mount.querySelector('table') && cache.panelsHtml) {
      mount.innerHTML = cache.panelsHtml;
      const summary = $('dashboardCoupangLiveSummary');
      if (summary && cache.summaryText) summary.textContent = `${cache.summaryText} · 최신 갱신 중…`;
      const appliedEl = $('dashboardCoupangAppliedTime');
      if (appliedEl && cache.appliedHtml) appliedEl.innerHTML = cache.appliedHtml;
    }

    const weekRows = $('dashboardCoupangWeekRows');
    if (
      weekRows
      && cache.weekRowsHtml
      && !weekRows.querySelector('.dashboard-baemin-qcell')
    ) {
      weekRows.innerHTML = cache.weekRowsHtml;
      const weekSummary = $('dashboardCoupangWeekSummary');
      if (weekSummary && cache.weekSummaryText) {
        weekSummary.textContent = `${cache.weekSummaryText} · 최신 갱신 중…`;
      }
    }
  }

  function persistTodayCache() {
    const mount = $('dashboardCoupangCard');
    const summary = $('dashboardCoupangLiveSummary');
    const appliedEl = $('dashboardCoupangAppliedTime');
    if (!mount?.querySelector('table')) return;
    mergeDashboardCache({
      panelsHtml: mount.innerHTML,
      summaryText: summary ? String(summary.textContent || '').replace(/\s*·\s*최신 갱신 중…$/, '') : '',
      appliedHtml: appliedEl ? appliedEl.innerHTML : ''
    });
  }

  function persistWeekCache() {
    const weekRows = $('dashboardCoupangWeekRows');
    const weekSummary = $('dashboardCoupangWeekSummary');
    if (!weekRows?.querySelector('.dashboard-baemin-qcell')) return;
    mergeDashboardCache({
      weekRowsHtml: weekRows.innerHTML,
      weekSummaryText: weekSummary
        ? String(weekSummary.textContent || '').replace(/\s*·\s*최신 갱신 중…$/, '')
        : ''
    });
  }

  // 배민과 동일: 캐시 즉시 페인팅 → 백그라운드 조용히 재조회
  function renderDashboardCard(options = {}) {
    bindDashboardCardOnce();
    paintDashboardCacheInstant();
    const silent = options.silent !== false;
    void queryDashboardCoupangLive({ silent });
  }

  // ── 로컬 세션서버(3940) 제어: 배민 BIZ와 동일한 방식 ──
  async function callLocal(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 120000);
    try {
      const res = await fetch(`${LOCAL_BASE}${path}`, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: options.body != null ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
        cache: 'no-store',
        mode: 'cors'
      });
      clearTimeout(timer);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, message: payload.message || payload.error || `요청 실패 (${res.status})`, ...payload };
      return { ok: true, ...payload };
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, message: e.message || '로컬 서버 연결 실패' };
    }
  }

  function renderLocalStatus() {
    const el = $('coupangLocalStatus');
    if (!el) return;
    if (!local.running) {
      el.textContent = '로컬 세션서버(3940): 꺼짐 — 바탕화면 [BREM-배민쿠팡-통합세션서버.bat]을 실행하세요.';
      return;
    }
    const parts = ['로컬 세션서버: 실행 중'];
    parts.push(local.hasToken ? '로그인: 완료' : '로그인: 필요 (브라우저 열기)');
    if (local.vendorCount) parts.push(`매장 ${local.vendorCount}개 감지`);
    if (local.collecting) parts.push('수집 중…');
    el.textContent = parts.join('  |  ');
  }

  function renderLoopStatus() {
    const el = $('coupangStatusLoopStatus');
    if (!el) return;
    const loop = local.loop || {};
    if (!local.running) { el.textContent = '자동순회: 로컬 세션서버 꺼짐'; return; }
    if (loop.active) {
      const bits = [`실행 중 · ${loop.round || 0}회차`];
      if (loop.message) bits.push(loop.message);
      if (loop.lastError) bits.push(`오류: ${loop.lastError}`);
      el.textContent = `자동순회: ${bits.join(' · ')}`;
    } else {
      el.textContent = `자동순회: 중지됨${loop.message ? ' — ' + loop.message : ''}`;
    }
  }

  function updateLocalButtons() {
    const openBtn = $('coupangOpenBrowserBtn');
    const collectBtn = $('coupangCollectBtn');
    const weekBtn = $('coupangCollectWeekBtn');
    const loopStart = $('coupangStatusLoopStartBtn');
    const loopStop = $('coupangStatusLoopStopBtn');
    const loop = local.loop || {};
    const busy = local.collecting || Boolean(loop.active);
    if (openBtn) openBtn.disabled = !local.running || busy;
    if (collectBtn) collectBtn.disabled = !local.running || !local.hasToken || busy;
    if (weekBtn) weekBtn.disabled = !local.running || !local.hasToken || busy;
    if (loopStart) loopStart.disabled = !local.running || !local.hasToken || Boolean(loop.active);
    if (loopStop) loopStop.disabled = !local.running || !loop.active;
  }

  async function refreshLocalStatus() {
    const h = await callLocal('/health', { timeoutMs: 2500 });
    local.running = Boolean(h.ok);
    local.hasToken = Boolean(h.hasToken);
    local.vendorCount = Number(h.vendorCount || 0);
    local.collecting = Boolean(h.collecting);
    local.loop = h.statusLoop || {};
    renderLocalStatus();
    renderLoopStatus();
    updateLocalButtons();
  }

  async function openBrowser() {
    await refreshLocalStatus();
    if (!local.running) {
      toast('로컬 세션서버(3940)가 꺼져 있어요. 바탕화면 통합 세션서버 bat을 먼저 실행하세요.');
      return;
    }
    toast('쿠팡 브라우저를 엽니다…');
    const r = await callLocal('/browser/open', { method: 'POST', timeoutMs: 60000 });
    await refreshLocalStatus();
    toast(r.ok ? '브라우저를 열었습니다. 로그인 후 대시보드를 한 번 여세요.' : (r.message || '브라우저 열기 실패'));
  }

  async function runCollect() {
    await refreshLocalStatus();
    if (!local.running) { toast('로컬 세션서버(3940)가 꺼져 있어요.'); return; }
    if (!local.hasToken) { toast('먼저 [브라우저 열기]로 로그인 후 대시보드를 한 번 여세요.'); return; }
    if (local.collecting) { toast('이미 수집 중입니다.'); return; }
    local.collecting = true;
    updateLocalButtons();
    renderLocalStatus();
    toast('쿠팡 데이터 수집 중… (몇 분 소요)');
    const r = await callLocal('/collect', { method: 'POST', body: {}, timeoutMs: 300000 });
    await refreshLocalStatus();
    if (!r.ok) { toast(r.message || '수집 실패'); return; }
    const s = r.summary || {};
    const total = (s.peak_realtime || 0) + (s.weekly_performance || 0) + (s.vendor_info || 0) + (s.rider_daily || 0);
    toast(`수집 완료 · 피크 ${s.peak_realtime || 0} · 주간 ${s.weekly_performance || 0} · 지역 ${s.vendor_info || 0} · 라이더 ${s.rider_daily || 0}`);
    if (total === 0) {
      const tableEl = $('coupangStatusTable');
      if (tableEl) {
        const errs = (s.errors || []).map(e => `<li>${esc(e)}</li>`).join('');
        const diag = (s.diag || []).map(e => `<li>${esc(e)}</li>`).join('');
        const samples = (r.apiSamples || []).map(e => `<li><code>${esc(e)}</code></li>`).join('');
        tableEl.innerHTML = `
          <div class="form-help" style="line-height:1.7">
            <p><strong>수집 결과가 0건입니다.</strong> 아래 진단을 확인하세요(그대로 복사해 알려주면 매핑을 고칩니다).</p>
            ${errs ? `<p><strong>오류</strong><ul>${errs}</ul></p>` : ''}
            ${diag ? `<p><strong>API 상태</strong><ul>${diag}</ul></p>` : ''}
            ${samples ? `<p><strong>브라우저가 실제 호출한 API 경로(샘플)</strong><ul>${samples}</ul></p>` : '<p>브라우저에서 쿠팡 대시보드 각 메뉴(피크/요일별/지역/라이더)를 한 번씩 연 뒤 다시 수집하세요.</p>'}
          </div>`;
      }
      return;
    }
    await loadConfig();
    await loadItems();
    void renderDashboardCard({ silent: true });
  }

  async function collectWeek() {
    await refreshLocalStatus();
    if (!local.running) { toast('로컬 세션서버(3940)가 꺼져 있어요.'); return; }
    if (!local.hasToken) { toast('먼저 [브라우저 열기]로 로그인 후 대시보드를 한 번 여세요.'); return; }
    if (local.collecting || local.loop?.active) { toast('이미 수집 중입니다.'); return; }
    const weekStart = currentWeekStart();
    const rangeLabel = dp()?.formatWednesdayWeekRangeLong
      ? dp().formatWednesdayWeekRangeLong(weekStart)
      : weekStart;
    local.collecting = true;
    updateLocalButtons();
    renderLocalStatus();
    toast(`${rangeLabel} 수집 중… (라이더/지역 하루씩, 몇 분 소요)`);
    const r = await callLocal('/collect', {
      method: 'POST',
      body: { weekStartDate: weekStart, fullWeek: true, includeRider: true },
      timeoutMs: 600000
    });
    await refreshLocalStatus();
    if (!r.ok) { toast(r.message || '주간 수집 실패'); return; }
    const s = r.summary || {};
    const days = (r.dates || []).join(', ');
    toast(`주간 수집 완료 · ${rangeLabel} · ${(r.dates || []).length}일(${days}) · 지역 ${s.vendor_info || 0} · 라이더 ${s.rider_daily || 0}`);
    // 조회일을 주 시작일로 맞춰 바로 확인 가능하게
    const dateInput = $('coupangStatusDate');
    if (dateInput && weekStart) dateInput.value = weekStart;
    state.activeMenu = 'rider_daily';
    renderMenuBar();
    await loadConfig();
    await loadItems();
    void renderDashboardCard({ silent: true });
  }

  async function startLoop() {
    await refreshLocalStatus();
    if (!local.running) { toast('로컬 세션서버(3940)가 꺼져 있어요.'); return; }
    if (!local.hasToken) { toast('먼저 [브라우저 열기]로 로그인 후 대시보드를 한 번 여세요.'); return; }
    const r = await callLocal('/status-loop/start', { method: 'POST', body: {}, timeoutMs: 15000 });
    if (r.statusLoop) local.loop = r.statusLoop;
    toast(r.ok ? '자동순회를 시작했습니다. (1회차 대시보드+라이더 → 이후 30초마다 대시보드)' : (r.message || '자동순회 시작 실패'));
    renderLoopStatus();
    updateLocalButtons();
  }

  async function stopLoop() {
    const r = await callLocal('/status-loop/stop', { method: 'POST', body: {}, timeoutMs: 10000 });
    if (r.statusLoop) local.loop = r.statusLoop;
    toast(r.ok ? '자동순회를 중지했습니다.' : (r.message || '자동순회 중지 실패'));
    renderLoopStatus();
    updateLocalButtons();
  }

  function startLocalPoll() {
    if (localPollTimer) return;
    localPollTimer = setInterval(() => {
      const sec = document.getElementById('coupang-status');
      if (sec && sec.classList.contains('active')) void refreshLocalStatus();
    }, 5000);
  }

  function bindOnce(id, handler) {
    const btn = $(id);
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', handler);
    }
  }

  async function refresh() {
    renderMenuBar();
    bindOnce('coupangOpenBrowserBtn', () => void openBrowser());
    bindOnce('coupangCollectBtn', () => void runCollect());
    bindOnce('coupangCollectWeekBtn', () => void collectWeek());
    bindOnce('coupangStatusLoopStartBtn', () => void startLoop());
    bindOnce('coupangStatusLoopStopBtn', () => void stopLoop());
    bindOnce('coupangStatusPrevWeekBtn', () => shiftWeek(-7));
    bindOnce('coupangStatusNextWeekBtn', () => shiftWeek(7));
    startLocalPoll();
    void refreshLocalStatus();
    const weekInput = $('coupangStatusWeekDate');
    if (weekInput && !weekInput.value) {
      weekInput.value = dp() ? dp().weekStartKey() : new Date().toISOString().slice(0, 10);
    }
    setWeekLabel();
    renderWeekPreview();
    const dateInput = $('coupangStatusDate');
    if (dateInput && !dateInput.value) {
      const kst = new Date(Date.now() + 9 * 3600 * 1000);
      if (kst.getUTCHours() < 6) kst.setUTCDate(kst.getUTCDate() - 1);
      dateInput.value = kst.toISOString().slice(0, 10);
    }
    const btn = $('coupangStatusLoadBtn');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => void loadItems());
    }
    await loadConfig();
    await loadItems();
    state.loaded = true;
  }

  window.BremCoupangStatusAdmin = {
    refresh,
    renderDashboardCard,
    refreshDashboardCard: renderDashboardCard,
    onWeekPicked
  };
})();
