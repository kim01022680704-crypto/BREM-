/**
 * BREM 관리자 · 쿠팡이츠 현황 (배민현황 쿠팡판)
 * - 라이더별: 정산주 수~어제(과거) + 오늘 실시간 합산 → 거절율
 * - 거절율 = (거절+취소)/(완료+거절+취소)×100
 * - [거절율 반영] → admin_rejection_rates + 라이더앱 publish
 * - 자동수집: PC 로컬 세션서버(3940) 30초 status-loop
 */
(function () {
  'use strict';

  const LOCAL_BASE = 'http://127.0.0.1:3940';
  const ALL = '__ALL__';
  const SUBMENUS = [
    { id: 'rider', label: '라이더별 현황', title: '라이더별 현황' },
    { id: 'quota', label: '할당 달성(주간)', title: '요일별 할당 달성 (수~화)' },
    { id: 'today', label: '오늘 현황', title: '오늘 현황' }
  ];
  const PEAK_ORDER = ['MORNING', 'LUNCH', 'POST_LUNCH', 'DINNER', 'POST_DINNER'];
  const DOW_ORDER = ['WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY'];
  const DOW_LABEL = { WEDNESDAY: '수', THURSDAY: '목', FRIDAY: '금', SATURDAY: '토', SUNDAY: '일', MONDAY: '월', TUESDAY: '화' };
  const state = {
    activeVendor: ALL, activeSub: 'rider', weekStart: '',
    pastRows: [], liveRows: [], rows: [],
    weekly: [], today: { vendor: [], peak: [] },
    range: null, lastLiveAt: '',
    vendors: [], loaded: false
  };
  const local = { running: false, hasToken: false, loop: {} };
  let localPollTimer = null;
  let lastLoopRound = -1;

  const $ = (id) => document.getElementById(id);

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function n(v) {
    const x = Number(v);
    if (!Number.isFinite(x)) return '0';
    return x.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  }
  /** 쿠팡 API 거절율: 0.103 → 10.3 (이미 %면 그대로) */
  function toRejectionPercent(v) {
    if (v == null || v === '') return null;
    const x = Number(v);
    if (!Number.isFinite(x)) return null;
    const pct = Math.abs(x) <= 1 ? x * 100 : x;
    return Math.round(pct * 10) / 10;
  }
  function rejectionPctLabel(v) {
    const p = toRejectionPercent(v);
    return p == null ? '-' : `${n(p)}%`;
  }
  function toast(msg) {
    if (window.BremBaeminDeliveryStatusAdmin?.showToast) return window.BremBaeminDeliveryStatusAdmin.showToast(msg);
    console.log('[coupang현황]', msg);
  }

  function calcRejectionRate(complete, reject, cancel) {
    const c = Math.max(0, Number(complete) || 0);
    const r = Math.max(0, Number(reject) || 0);
    const x = Math.max(0, Number(cancel) || 0);
    const denom = c + r + x;
    if (denom <= 0) return null;
    return Math.round(((r + x) / denom) * 1000) / 10;
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

  async function callLocal(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
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

  // ── 주간 도우미 ──
  function dp() { return window.BremDatePicker; }
  function localDateKey(d) {
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-');
  }
  function addDaysKey(dateKey, days) {
    const d = new Date(`${String(dateKey).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + days);
    return localDateKey(d);
  }
  function todayKey() {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    if (kst.getUTCHours() < 6) kst.setUTCDate(kst.getUTCDate() - 1);
    return kst.toISOString().slice(0, 10);
  }
  /** 선택한 정산주(수~화)만 조회.
   * - 과거주: 수~화 7일만
   * - 이번주(오늘이 그 주 안): 수~어제 + 오늘 실시간
   *   예) 오늘 18일이면 그주 수~17일 + 오늘(18)
   */
  function resolveRiderRange(weekStart) {
    const picker = dp();
    const raw = String(weekStart || $('coupangRiderWeekDate')?.value || '').slice(0, 10);
    const ws = picker?.applyWeekWednesday
      ? picker.applyWeekWednesday(raw || picker.weekStartKey())
      : raw;
    const we = picker?.weekEndKey ? picker.weekEndKey(ws) : addDaysKey(ws, 6);
    const today = todayKey();
    const yesterday = addDaysKey(today, -1);
    const todayInSelectedWeek = Boolean(ws && we && today >= ws && today <= we);

    if (todayInSelectedWeek) {
      const hasPast = Boolean(yesterday && yesterday >= ws);
      // 어제라도 선택 주(화)를 넘기지 않음
      const pastTo = hasPast ? (yesterday > we ? we : yesterday) : '';
      return {
        weekStart: ws,
        weekEnd: we,
        today,
        includeLive: true,
        pastFrom: hasPast ? ws : '',
        pastTo,
        label: hasPast
          ? `수~어제 ${ws} ~ ${pastTo} + 오늘 실시간 ${today}`
          : `오늘 실시간 ${today} (수요일 · 과거일 없음)`
      };
    }

    // 과거 정산주(또는 미래주): 해당 주 수~화만, 오늘 실시간 합산 금지
    return {
      weekStart: ws,
      weekEnd: we,
      today,
      includeLive: false,
      pastFrom: ws,
      pastTo: we,
      label: `정산주 ${ws} ~ ${we} (수~화만)`
    };
  }
  function currentWeekStart() {
    const val = $('coupangRiderWeekDate')?.value || '';
    const picker = dp();
    if (!picker) return String(val || '').slice(0, 10);
    return picker.applyWeekWednesday(val || picker.weekStartKey());
  }
  function setWeekLabel() {
    const btn = $('coupangRiderWeekBtn');
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
    const input = $('coupangRiderWeekDate');
    if (input) input.value = next;
    setWeekLabel();
    renderWeekPreview();
  }
  function renderWeekPreview() {
    const el = $('coupangRiderWeekPreview');
    if (!el) return;
    const ws = currentWeekStart();
    if (!ws) { el.textContent = '수요일을 선택하면 수~화 범위가 표시됩니다'; return; }
    const range = dp()?.formatWednesdayWeekRangeLong
      ? dp().formatWednesdayWeekRangeLong(ws)
      : (dp()?.formatWednesdayWeekRange ? dp().formatWednesdayWeekRange(ws) : `${ws} ~`);
    el.textContent = `${range} · 선택한 수~화만 조회`;
  }
  function onWeekPicked(value) {
    const input = $('coupangRiderWeekDate');
    if (input && value) input.value = dp() ? dp().applyWeekWednesday(value) : value;
    setWeekLabel();
    renderWeekPreview();
    void loadWeek();
  }

  // ── ERP 기사 매칭 맵 (쿠팡ID → 기사) ──
  function buildErpMap() {
    const map = new Map();
    const drivers = window.BremStorage?.drivers?.getAll?.() || [];
    const utils = window.BremDriverUtils;
    drivers.forEach(d => {
      const id = utils?.getErpCoupangId ? utils.getErpCoupangId(d) : '';
      if (id && !map.has(id)) map.set(id, d);
    });
    return map;
  }

  // ── 라이더별 집계 (과거/실시간/합산) ──
  function emptyRider(p = {}) {
    return {
      matchKey: p.matchKey || '',
      courierId: p.courierId || '',
      name: p.name || '',
      phone: p.phone || '',
      past: { complete: 0, reject: 0, cancel: 0 },
      live: { complete: 0, reject: 0, cancel: 0 },
      complete: 0,
      reject: 0,
      cancel: 0,
      vendors: new Set()
    };
  }
  function addMetrics(bucket, p) {
    bucket.complete += Math.max(0, Number(p.completeCount) || 0);
    bucket.reject += Math.max(0, Number(p.rejectCount) || 0);
    bucket.cancel += Math.max(0, Number(p.cancelCount) || 0);
  }
  function mergeBuckets(a, b) {
    return {
      complete: Number(a.complete || 0) + Number(b.complete || 0),
      reject: Number(a.reject || 0) + Number(b.reject || 0),
      cancel: Number(a.cancel || 0) + Number(b.cancel || 0)
    };
  }
  function upsertRiderRow(map, p, bucket) {
    const key = String(p.matchKey || p.courierId || '').trim();
    if (!key) return;
    const prev = map.get(key) || emptyRider(p);
    addMetrics(prev[bucket], p);
    const combined = mergeBuckets(prev.past, prev.live);
    prev.complete = combined.complete;
    prev.reject = combined.reject;
    prev.cancel = combined.cancel;
    if (p.name) prev.name = p.name;
    if (p.phone) prev.phone = p.phone;
    if (p.courierId) prev.courierId = p.courierId;
    if (p.matchKey) prev.matchKey = p.matchKey;
    const vName = p.vendorName || p.vendorId;
    if (vName) prev.vendors.add(vName);
    map.set(key, prev);
  }
  function aggregateCombined(pastRows, liveRows) {
    const map = new Map();
    (pastRows || []).forEach(p => upsertRiderRow(map, p, 'past'));
    (liveRows || []).forEach(p => upsertRiderRow(map, p, 'live'));
    return [...map.values()];
  }
  /** 레거시: 단일 배열 합산 */
  function aggregate(rows) {
    return aggregateCombined(rows, []);
  }

  function vendorLabel(p) {
    return String(p.vendorName || p.vendorId || '').trim();
  }

  // 현재 서브메뉴의 데이터셋 (매장 탭 도출용)
  function rowsForActiveSub() {
    if (state.activeSub === 'quota') return state.weekly;
    if (state.activeSub === 'today') return [...(state.today.vendor || []), ...(state.today.peak || [])];
    return [...(state.pastRows || []), ...(state.liveRows || [])];
  }
  function filterByVendor(rows) {
    return state.activeVendor === ALL ? rows : rows.filter(p => vendorLabel(p) === state.activeVendor);
  }

  function renderSubmenu() {
    const bar = $('coupangRiderSubmenu');
    if (!bar) return;
    bar.innerHTML = SUBMENUS.map(m =>
      `<button type="button" class="baemin-region-tab${m.id === state.activeSub ? ' is-active' : ''}" data-coupang-sub="${m.id}">${esc(m.label)}</button>`
    ).join('');
    bar.querySelectorAll('[data-coupang-sub]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (state.activeSub === btn.dataset.coupangSub) return;
        state.activeSub = btn.dataset.coupangSub;
        renderSubmenu();
        void loadActive();
      });
    });
    const title = $('coupangRiderCardTitle');
    if (title) title.textContent = (SUBMENUS.find(m => m.id === state.activeSub) || {}).title || '';
  }

  function renderVendorTabs() {
    const bar = $('coupangRiderVendorTabs');
    if (!bar) return;
    const set = new Map();
    rowsForActiveSub().forEach(p => {
      const label = vendorLabel(p);
      if (label) set.set(label, (set.get(label) || 0) + 1);
    });
    state.vendors = [...set.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
    if (state.activeVendor !== ALL && !state.vendors.includes(state.activeVendor)) state.activeVendor = ALL;
    const tabs = [{ id: ALL, label: '전체' }, ...state.vendors.map(v => ({ id: v, label: v }))];
    bar.innerHTML = tabs.map(t =>
      `<button type="button" class="baemin-region-tab${t.id === state.activeVendor ? ' is-active' : ''}" data-coupang-vendor="${esc(t.id)}">${esc(t.label)}</button>`
    ).join('');
    bar.querySelectorAll('[data-coupang-vendor]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeVendor = btn.dataset.coupangVendor;
        renderVendorTabs();
        renderTable();
      });
    });
  }

  function renderTable() {
    if (state.activeSub !== 'rider') {
      const strip = $('coupangRiderLiveStrip');
      if (strip) { strip.hidden = true; strip.innerHTML = ''; }
    }
    if (state.activeSub === 'quota') return renderQuota();
    if (state.activeSub === 'today') return renderToday();
    return renderRiderTable();
  }

  function renderLiveStrip(riders, range) {
    const el = $('coupangRiderLiveStrip');
    if (!el) return;
    if (state.activeSub !== 'rider' || !riders.length) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const tot = riders.reduce((a, r) => {
      a.complete += r.complete; a.reject += r.reject; a.cancel += r.cancel;
      a.pastC += r.past.complete; a.liveC += r.live.complete;
      return a;
    }, { complete: 0, reject: 0, cancel: 0, pastC: 0, liveC: 0 });
    const rate = calcRejectionRate(tot.complete, tot.reject, tot.cancel);
    el.hidden = false;
    el.innerHTML = `
      <div class="coupang-rider-live-card is-complete"><span class="coupang-rider-live-card__label">합계완료</span><span class="coupang-rider-live-card__value">${n(tot.complete)}</span><span class="coupang-rider-live-card__sub">${range?.includeLive ? `수~어제 ${n(tot.pastC)} + 오늘 ${n(tot.liveC)}` : `해당 주(수~화) ${n(tot.pastC)}`}</span></div>
      <div class="coupang-rider-live-card is-reject"><span class="coupang-rider-live-card__label">거절</span><span class="coupang-rider-live-card__value">${n(tot.reject)}</span></div>
      <div class="coupang-rider-live-card is-cancel"><span class="coupang-rider-live-card__label">취소</span><span class="coupang-rider-live-card__value">${n(tot.cancel)}</span></div>
      <div class="coupang-rider-live-card is-rate"><span class="coupang-rider-live-card__label">거절율</span><span class="coupang-rider-live-card__value">${rate == null ? '-' : rate + '%'}</span><span class="coupang-rider-live-card__sub">${esc(range?.label || '')}</span></div>`;
  }

  function renderLiveBadge(range) {
    const el = $('coupangRiderLiveBadge');
    if (!el) return;
    if (!range) { el.textContent = '라이더별: 선택한 정산주(수~화)만 조회'; return; }
    const liveHint = range.includeLive
      ? (state.lastLiveAt ? ` · 실시간 ${state.lastLiveAt}` : ' · 오늘 실시간 포함')
      : ' · 오늘 실시간 미포함(그 주만)';
    el.textContent = `라이더별: ${range.label}${liveHint}`;
  }

  function renderRiderTable() {
    const tableEl = $('coupangRiderTable');
    const summary = $('coupangRiderSummary');
    if (!tableEl) return;
    const range = state.range || resolveRiderRange(state.weekStart || currentWeekStart());
    const pastFiltered = filterByVendor(state.pastRows);
    const liveFiltered = filterByVendor(state.liveRows);
    const riders = aggregateCombined(pastFiltered, liveFiltered).sort((a, b) => b.complete - a.complete);
    renderLiveStrip(riders, range);
    renderLiveBadge(range);
    if (!riders.length) {
      tableEl.innerHTML = '<p class="form-help">해당 기간·매장에 라이더 데이터가 없습니다. [실시간 업데이트] 또는 밴더현황에서 주간 수집 후 조회하세요.</p>';
      if (summary) summary.textContent = `${state.activeVendor === ALL ? '전체' : state.activeVendor} · 0명 · ${range.label}`;
      return;
    }
    const erpMap = buildErpMap();
    let matched = 0;
    const bodyRows = riders.map(r => {
      const rate = calcRejectionRate(r.complete, r.reject, r.cancel);
      const driver = erpMap.get(String(r.matchKey || '').trim());
      if (driver) matched += 1;
      const driverLabel = driver ? esc(driver.name || driver.id) : '<span style="color:#c0392b">미매칭</span>';
      const pastRate = calcRejectionRate(r.past.complete, r.past.reject, r.past.cancel);
      const liveRate = calcRejectionRate(r.live.complete, r.live.reject, r.live.cancel);
      return `<tr>
        <td>${driverLabel}</td>
        <td>${esc(r.name)}</td>
        <td>${esc(r.phone)}</td>
        <td>${esc(r.matchKey)}</td>
        <td title="어제까지 ${n(r.past.complete)} / 오늘 ${n(r.live.complete)}">${n(r.complete)}</td>
        <td title="어제까지 ${n(r.past.reject)} / 오늘 ${n(r.live.reject)}">${n(r.reject)}</td>
        <td title="어제까지 ${n(r.past.cancel)} / 오늘 ${n(r.live.cancel)}">${n(r.cancel)}</td>
        <td title="수~어제 ${pastRate == null ? '-' : pastRate + '%'} · 오늘 ${liveRate == null ? '-' : liveRate + '%'}">${rate == null ? '-' : rate + '%'}</td>
      </tr>`;
    }).join('');
    tableEl.innerHTML = `<div class="dashboard-baemin-table-wrap"><table class="admin-table dashboard-baemin-compact-table">
      <thead><tr>
        <th>매칭기사</th><th>이름</th><th>연락처</th><th>쿠팡ID</th>
        <th>완료</th><th>거절</th><th>취소</th><th>거절율</th>
      </tr></thead>
      <tbody>${bodyRows}</tbody>
    </table></div>`;
    if (summary) {
      summary.textContent = `${state.activeVendor === ALL ? '전체' : state.activeVendor} · ${riders.length}명 · ERP매칭 ${matched}명 · ${range.label}`;
    }
  }

  const PEAK_LABEL = { MORNING: '아침', LUNCH: '점심피크', POST_LUNCH: '점심논피크', DINNER: '저녁피크', POST_DINNER: '저녁논피크' };
  const PEAK_LABEL_SHORT = { MORNING: '아침', LUNCH: '점피', POST_LUNCH: '점논', DINNER: '저피', POST_DINNER: '저논' };

  function shortRegionLabel(name) {
    const raw = String(name || '').replace(/\s+/g, '').trim();
    if (!raw) return '-';
    if (raw === '전체합계' || raw === '전체 합계') return '합계';
    if (raw.length <= 4) return raw;
    return raw.slice(-4);
  }

  function regionNameCell(fullName) {
    const full = String(fullName || '').trim() || '-';
    return `<strong class="dashboard-baemin-region-name" title="${esc(full)}">${esc(shortRegionLabel(full))}</strong>`;
  }

  function renderQuotaTagCell(actual, target, hasCompleted = true) {
    const a = Number(actual) || 0;
    const t = Number(target) || 0;
    if (!t && !hasCompleted && !a) {
      return '<td class="dashboard-baemin-qcell"><span class="form-help">-</span></td>';
    }
    const achieved = t > 0 ? a >= t : a > 0;
    const statusClass = achieved ? 'baemin-quota-tag--achieved' : 'baemin-quota-tag--missed';
    const ratio = hasCompleted ? `${n(a)}/${n(t)}` : `-/${n(t)}`;
    return `<td class="dashboard-baemin-qcell">
      <div class="dashboard-baemin-qcell__stack">
        <span class="dashboard-baemin-qcell__ratio">${esc(ratio)}</span>
        <span class="dashboard-baemin-qcell__meta">
          <span class="baemin-quota-tag ${statusClass}">${achieved ? '달성' : '미달'}</span>
        </span>
      </div>
    </td>`;
  }

  // 요일별 할당 달성 (수~화). 피크별 완료/목표 + 달성/미달성 태그 + 거절율
  function renderQuota() {
    const tableEl = $('coupangRiderTable');
    const summary = $('coupangRiderSummary');
    if (!tableEl) return;
    const rows = filterByVendor(state.weekly);
    if (!rows.length) {
      tableEl.innerHTML = '<p class="form-help">해당 정산주 할당(주간) 데이터가 없습니다. 쿠팡 밴더현황에서 [주간 수집] 후 조회하세요.</p>';
      if (summary) summary.textContent = `할당 달성 · 정산주 ${state.weekStart} · 0건`;
      return;
    }
    const byDay = new Map();
    const dateByDay = new Map();
    rows.forEach(p => {
      const day = String(p.dayOfWeek || '').toUpperCase();
      if (!day) return;
      if (p.date && !dateByDay.has(day)) dateByDay.set(day, String(p.date).slice(5, 10));
      if (!byDay.has(day)) byDay.set(day, new Map());
      const pk = byDay.get(day);
      const pt = String(p.peakType || '').toUpperCase();
      const cur = pk.get(pt) || { goal: 0, completed: 0, hasCompleted: false };
      cur.goal += Number(p.goalCount) || 0;
      if (p.completedCount != null) { cur.completed += Number(p.completedCount) || 0; cur.hasCompleted = true; }
      pk.set(pt, cur);
    });
    const rejByDay = new Map();
    const seen = new Set();
    rows.forEach(p => {
      const day = String(p.dayOfWeek || '').toUpperCase();
      const key = `${p.vendorId}:${day}`;
      if (!day || seen.has(key)) return;
      seen.add(key);
      const cur = rejByDay.get(day) || { rateSum: 0, rateN: 0 };
      if (p.rejectionRate != null) { cur.rateSum += toRejectionPercent(p.rejectionRate) || 0; cur.rateN += 1; }
      rejByDay.set(day, cur);
    });
    const days = DOW_ORDER.filter(d => byDay.has(d));
    const header = ['요일', ...PEAK_ORDER.map(pt => PEAK_LABEL_SHORT[pt]), '거절'];
    const bodyRows = days.map(day => {
      const pk = byDay.get(day);
      const cells = PEAK_ORDER.map(pt => {
        const c = pk.get(pt);
        if (!c || (!c.goal && !c.hasCompleted)) {
          return '<td class="dashboard-baemin-qcell"><span class="form-help">-</span></td>';
        }
        return renderQuotaTagCell(c.completed, c.goal, c.hasCompleted);
      });
      const rej = rejByDay.get(day) || { rateSum: 0, rateN: 0 };
      const rejRate = rej.rateN > 0 ? Math.round((rej.rateSum / rej.rateN) * 10) / 10 : null;
      const dLabel = `${DOW_LABEL[day] || day}${dateByDay.get(day) ? ` (${dateByDay.get(day)})` : ''}`;
      return `<tr><td>${esc(dLabel)}</td>${cells.join('')}<td>${rejRate == null ? '-' : rejectionPctLabel(rejRate)}</td></tr>`;
    }).join('');
    tableEl.innerHTML = `<div class="dashboard-baemin-table-wrap dashboard-coupang-table-wrap"><table class="admin-table dashboard-baemin-compact-table dashboard-coupang-compact-table">
      <thead><tr>${header.map((h, i) => `<th${i >= 1 && i <= 5 ? ` title="${esc(PEAK_LABEL[PEAK_ORDER[i - 1]])}"` : ''}>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${bodyRows}</tbody></table></div>`;
    if (summary) summary.textContent = `${state.activeVendor === ALL ? '전체' : state.activeVendor} · 할당 달성(수~화) · 정산주 ${state.weekStart}`;
  }

  // 오늘 현황: 지역×피크 타임 표 (운행중 + 달성 태그 + 거절율)
  function renderToday() {
    const tableEl = $('coupangRiderTable');
    const summary = $('coupangRiderSummary');
    if (!tableEl) return;
    const vinfo = filterByVendor(state.today.vendor);
    const peaks = filterByVendor(state.today.peak);
    if (!vinfo.length && !peaks.length) {
      tableEl.innerHTML = '<p class="form-help">오늘 수집된 대시보드 데이터가 없습니다. 쿠팡 밴더현황에서 [오늘 수집] 또는 [자동순회 시작]을 실행하세요.</p>';
      if (summary) summary.textContent = '오늘 현황 · 0건';
      return;
    }

    const byVendor = new Map();
    vinfo.forEach(p => {
      const vid = String(p.vendorId || '').trim();
      if (!vid) return;
      byVendor.set(vid, {
        vendorId: vid,
        vendorName: String(p.vendorName || vid),
        drivingCount: Number(p.riderOnLineCount) || 0,
        riderTotalCount: Number(p.riderTotalCount) || 0,
        rejectionRate: p.rejectionRate == null ? null : toRejectionPercent(p.rejectionRate),
        peaks: Object.fromEntries(PEAK_ORDER.map(pt => [pt, { goal: 0, completed: 0, has: false }]))
      });
    });
    peaks.forEach(p => {
      const vid = String(p.vendorId || '').trim();
      if (!vid) return;
      if (!byVendor.has(vid)) {
        byVendor.set(vid, {
          vendorId: vid,
          vendorName: String(p.vendorName || vid),
          drivingCount: 0,
          riderTotalCount: 0,
          rejectionRate: null,
          peaks: Object.fromEntries(PEAK_ORDER.map(pt => [pt, { goal: 0, completed: 0, has: false }]))
        });
      }
      const row = byVendor.get(vid);
      if (p.vendorName) row.vendorName = String(p.vendorName);
      const pt = String(p.peakType || '').toUpperCase();
      if (!PEAK_ORDER.includes(pt)) return;
      row.peaks[pt].goal += Number(p.goalCount) || 0;
      row.peaks[pt].completed += Number(p.completedCount) || 0;
      row.peaks[pt].has = true;
    });

    const regionRows = Array.from(byVendor.values())
      .sort((a, b) => String(a.vendorName).localeCompare(String(b.vendorName), 'ko'));
    let onlineSum = 0;
    let totalSum = 0;
    const peakTotals = Object.fromEntries(PEAK_ORDER.map(pt => [pt, { goal: 0, completed: 0 }]));
    let rejSum = 0;
    let rejN = 0;
    regionRows.forEach(r => {
      onlineSum += r.drivingCount;
      totalSum += r.riderTotalCount;
      if (r.rejectionRate != null) { rejSum += r.rejectionRate; rejN += 1; }
      PEAK_ORDER.forEach(pt => {
        peakTotals[pt].goal += r.peaks[pt].goal;
        peakTotals[pt].completed += r.peaks[pt].completed;
      });
    });
    const rejAvg = rejN > 0 ? Math.round((rejSum / rejN) * 10) / 10 : null;

    const header = ['지역', '운행', ...PEAK_ORDER.map(pt => PEAK_LABEL_SHORT[pt]), '거절'];
    const summaryRow = `<tr class="dashboard-baemin-compact-table__summary">
      <td><strong class="dashboard-baemin-region-name">합계</strong></td>
      <td>${esc(n(onlineSum))}</td>
      ${PEAK_ORDER.map(pt => renderQuotaTagCell(peakTotals[pt].completed, peakTotals[pt].goal)).join('')}
      <td>${rejAvg == null ? '-' : rejectionPctLabel(rejAvg)}</td>
    </tr>`;
    const bodyRows = regionRows.map(r => `<tr>
      <td>${regionNameCell(r.vendorName)}</td>
      <td>${esc(n(r.drivingCount))}</td>
      ${PEAK_ORDER.map(pt => renderQuotaTagCell(r.peaks[pt].completed, r.peaks[pt].goal, r.peaks[pt].has)).join('')}
      <td>${r.rejectionRate == null ? '-' : rejectionPctLabel(r.rejectionRate)}</td>
    </tr>`).join('');

    tableEl.innerHTML = `<div class="dashboard-baemin-table-wrap dashboard-coupang-table-wrap"><table class="admin-table dashboard-baemin-compact-table dashboard-coupang-compact-table">
      <thead><tr>${header.map((h, i) => `<th${i >= 2 && i <= 6 ? ` title="${esc(PEAK_LABEL[PEAK_ORDER[i - 2]])}"` : ''}>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${summaryRow}${bodyRows}</tbody></table></div>`;
    if (summary) summary.textContent = `오늘 현황 · ${todayKey()} · 운행중 ${n(onlineSum)}/${n(totalSum)}명 · 피크타임 기준`;
  }

  async function fetchRiderItems(fromDate, toDate) {
    if (!fromDate || !toDate || toDate < fromDate) return { ok: true, items: [] };
    const res = await adminApi(`/api/admin/coupang/items?sourceMenu=rider_daily&fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`);
    if (!res.ok) return res;
    return { ok: true, items: (res.items || []).map(it => it.parsed_json || {}) };
  }

  async function loadRider(ws) {
    const range = resolveRiderRange(ws);
    state.range = range;
    state.weekStart = range.weekStart;
    let past = { ok: true, items: [] };
    let live = { ok: true, items: [] };
    if (range.pastFrom && range.pastTo) {
      past = await fetchRiderItems(range.pastFrom, range.pastTo);
    }
    if (range.includeLive) {
      live = await fetchRiderItems(range.today, range.today);
      if (live.ok) state.lastLiveAt = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    } else {
      state.lastLiveAt = '';
    }
    state.pastRows = past.ok ? (past.items || []) : [];
    state.liveRows = live.ok ? (live.items || []) : [];
    state.rows = [...state.pastRows, ...state.liveRows];
    if (!past.ok) return past;
    if (!live.ok) return live;
    return { ok: true };
  }
  async function loadQuota(ws, we) {
    const res = await adminApi(`/api/admin/coupang/items?sourceMenu=weekly_performance&fromDate=${encodeURIComponent(ws)}&toDate=${encodeURIComponent(we)}`);
    state.weekly = res.ok ? (res.items || []).map(it => it.parsed_json || {}) : [];
    return res;
  }
  async function loadToday() {
    const d = todayKey();
    const [vi, pk] = await Promise.all([
      adminApi(`/api/admin/coupang/items?sourceMenu=vendor_info&collectDate=${encodeURIComponent(d)}`),
      adminApi(`/api/admin/coupang/items?sourceMenu=peak_realtime&collectDate=${encodeURIComponent(d)}`)
    ]);
    state.today.vendor = vi.ok ? (vi.items || []).map(it => it.parsed_json || {}) : [];
    state.today.peak = pk.ok ? (pk.items || []).map(it => it.parsed_json || {}) : [];
    return { ok: vi.ok || pk.ok, message: vi.message || pk.message };
  }

  async function loadActive() {
    const summary = $('coupangRiderSummary');
    const ws = currentWeekStart();
    state.weekStart = ws;
    renderWeekPreview();
    if (summary) summary.textContent = '불러오는 중…';
    const we = dp()?.weekEndKey ? dp().weekEndKey(ws) : addDaysKey(ws, 6);
    const riderRes = await loadRider(ws);
    if (state.activeSub === 'quota') await loadQuota(ws, we);
    else if (state.activeSub === 'today') await loadToday();
    renderSubmenu();
    renderVendorTabs();
    renderTable();
    if (state.activeSub === 'rider' && !riderRes.ok && summary) summary.textContent = riderRes.message || '조회 실패';
  }

  async function loadWeek() { return loadActive(); }

  async function refreshLiveToday() {
    await refreshLocalStatus();
    if (!local.running) { toast('로컬 세션서버(3940)가 꺼져 있어요. 통합 세션서버 bat을 먼저 실행하세요.'); return; }
    if (!local.hasToken) { toast('쿠팡 밴더현황에서 [브라우저 열기]로 로그인 후 대시보드를 한 번 여세요.'); return; }
    const today = todayKey();
    toast(`오늘(${today}) 라이더 실시간 수집 중…`);
    const r = await callLocal('/collect', {
      method: 'POST',
      body: { date: today, includeRider: true, skipWeekly: true },
      timeoutMs: 180000
    });
    if (!r.ok) { toast(r.message || '오늘 실시간 수집 실패'); return; }
    const s = r.summary || {};
    toast(`오늘 실시간 저장 · 라이더 ${s.rider_daily || 0} · 지역 ${s.vendor_info || 0}`);
    await loadActive();
  }

  function applyRejectionRates() {
    if (window.BremCoupangRejectionSync?.run) {
      void window.BremCoupangRejectionSync.run();
      return;
    }
    toast('거절율 반영 모듈을 불러오지 못했습니다.');
  }

  // ── 로컬 세션서버 / 자동수집 루프 ──
  function renderLocalStatus() {
    const el = $('coupangRiderLocalStatus');
    if (!el) return;
    if (!local.running) {
      el.textContent = '로컬 세션서버(3940): 꺼짐 — 바탕화면 통합 세션서버 bat을 실행하세요.';
      return;
    }
    const parts = ['로컬 세션서버: 실행 중'];
    parts.push(local.hasToken ? '로그인: 완료' : '로그인: 필요 (쿠팡 밴더현황에서 브라우저 열기)');
    el.textContent = parts.join('  |  ');
  }

  function renderLoopStatus() {
    const el = $('coupangRiderLoopStatus');
    if (!el) return;
    const loop = local.loop || {};
    if (!local.running) { el.textContent = '자동수집: 로컬 세션서버 꺼짐'; return; }
    if (loop.active) {
      const bits = [`실행 중 · ${loop.round || 0}회차`];
      if (loop.message) bits.push(loop.message);
      if (loop.lastError) bits.push(`오류: ${loop.lastError}`);
      el.textContent = `자동수집: ${bits.join(' · ')}`;
    } else {
      el.textContent = `자동수집: 중지됨${loop.message ? ' — ' + loop.message : ''}`;
    }
  }

  function updateLoopButtons() {
    const start = $('coupangRiderLoopStartBtn');
    const stop = $('coupangRiderLoopStopBtn');
    const loop = local.loop || {};
    if (start) start.disabled = !local.running || !local.hasToken || Boolean(loop.active);
    if (stop) stop.disabled = !local.running || !loop.active;
  }

  async function refreshLocalStatus() {
    const h = await callLocal('/health', { timeoutMs: 2500 });
    local.running = Boolean(h.ok);
    local.hasToken = Boolean(h.hasToken);
    local.loop = h.statusLoop || {};
    renderLocalStatus();
    renderLoopStatus();
    updateLoopButtons();
    // 루프가 새 회차를 마쳤으면 현재 주간 표를 자동 갱신
    if (local.loop.active) {
      const round = Number(local.loop.round || 0);
      if (round !== lastLoopRound && local.loop.phase === 'waiting') {
        lastLoopRound = round;
        void loadWeek();
      }
    } else {
      lastLoopRound = -1;
    }
  }

  async function startLoop() {
    await refreshLocalStatus();
    if (!local.running) { toast('로컬 세션서버(3940)가 꺼져 있어요. 통합 세션서버 bat을 먼저 실행하세요.'); return; }
    if (!local.hasToken) { toast('쿠팡 밴더현황에서 [브라우저 열기]로 로그인 후 대시보드를 한 번 여세요.'); return; }
    const r = await callLocal('/status-loop/start', { method: 'POST', body: {}, timeoutMs: 15000 });
    if (r.statusLoop) local.loop = r.statusLoop;
    toast(r.ok ? '자동수집을 시작했습니다. 30초 주기로 수집합니다.' : (r.message || '자동수집 시작 실패'));
    renderLoopStatus();
    updateLoopButtons();
  }

  async function stopLoop() {
    const r = await callLocal('/status-loop/stop', { method: 'POST', body: {}, timeoutMs: 10000 });
    if (r.statusLoop) local.loop = r.statusLoop;
    toast(r.ok ? '자동수집을 중지했습니다.' : (r.message || '자동수집 중지 실패'));
    renderLoopStatus();
    updateLoopButtons();
  }

  function startLocalPoll() {
    if (localPollTimer) return;
    localPollTimer = setInterval(() => {
      const sec = document.getElementById('coupang-rider-status');
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

  // ── 거절율 반영용 컨텍스트 (수~어제 + 오늘 실시간 합산) ──
  function getWeekContext() {
    const ws = state.weekStart || currentWeekStart();
    const riders = aggregateCombined(state.pastRows, state.liveRows).map(r => ({
      matchKey: String(r.matchKey || '').trim(),
      courierId: r.courierId,
      name: r.name,
      phone: r.phone,
      complete: r.complete,
      reject: r.reject,
      cancel: r.cancel,
      past: { ...r.past },
      live: { ...r.live },
      rate: calcRejectionRate(r.complete, r.reject, r.cancel),
      vendors: [...r.vendors]
    }));
    return {
      weekStart: ws,
      riders,
      range: state.range || resolveRiderRange(ws),
      includeLive: Boolean((state.range || resolveRiderRange(ws)).includeLive)
    };
  }

  async function refresh() {
    try { await window.BremStorage?.ensureSectionLoaded?.('drivers'); } catch { /* ignore */ }
    const dateInput = $('coupangRiderWeekDate');
    if (dateInput && !dateInput.value) {
      dateInput.value = dp() ? dp().weekStartKey() : todayKey();
    }
    setWeekLabel();
    renderWeekPreview();
    renderSubmenu();
    bindOnce('coupangRiderLoadBtn', () => void loadWeek());
    bindOnce('coupangRiderPrevWeekBtn', () => { shiftWeek(-7); renderWeekPreview(); void loadWeek(); });
    bindOnce('coupangRiderNextWeekBtn', () => { shiftWeek(7); renderWeekPreview(); void loadWeek(); });
    bindOnce('coupangRiderLoopStartBtn', () => void startLoop());
    bindOnce('coupangRiderLoopStopBtn', () => void stopLoop());
    bindOnce('coupangRiderLiveRefreshBtn', () => void refreshLiveToday());
    startLocalPoll();
    void refreshLocalStatus();
    await loadWeek();
    state.loaded = true;
  }

  window.BremCoupangRiderStatusAdmin = {
    refresh,
    getWeekContext,
    loadWeek,
    onWeekPicked,
    refreshLiveToday,
    applyRejectionRates,
    adminApi,
    calcRejectionRate,
    get weekStart() { return state.weekStart; }
  };
})();
