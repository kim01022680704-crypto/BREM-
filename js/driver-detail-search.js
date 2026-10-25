// 기사관리 — 기사상세검색 오른쪽 패널
const BremDriverDetailSearch = (function () {
  const $ = selector => document.querySelector(selector);

  const state = {
    bound: false,
    weekStart: '',
    query: '',
    selectedId: '',
    loading: false,
    loadError: '',
    searchTimer: null,
    detailSeq: 0
  };

  function localDateKey(date = new Date()) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function weekStartKey(value) {
    const picker = window.BremDatePicker;
    if (picker?.weekStartKey) {
      const picked = String(picker.weekStartKey(value || picker.today?.() || localDateKey()) || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(picked)) return picked;
    }
    const seed = String(value || localDateKey()).slice(0, 10);
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

  function addDays(dateKey, days) {
    const date = new Date(`${String(dateKey).slice(0, 10)}T00:00:00`);
    date.setDate(date.getDate() + days);
    return localDateKey(date);
  }

  function dateList(from, to) {
    const out = [];
    let cursor = String(from).slice(0, 10);
    const end = String(to).slice(0, 10);
    while (cursor && cursor <= end) {
      out.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return out;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function formatMoney(value) {
    return `${formatNumber(value)}원`;
  }

  function formatRate(value) {
    if (value == null || value === '' || Number.isNaN(Number(value))) return '-';
    return `${Math.round(Number(value) * 10) / 10}%`;
  }

  function digits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function fold(value) {
    return String(value || '').replace(/\s/g, '').toLowerCase();
  }

  function erpId(driver) {
    const make = window.BremDriverUtils?.makeDriverLoginId;
    if (typeof make === 'function') return String(make(driver) || '').trim();
    const name = String(driver?.name || '').replace(/\s/g, '');
    const tail = digits(driver?.phone).slice(-4);
    return tail ? `${name}${tail}` : name;
  }

  function coupangId(driver) {
    const get = window.BremDriverUtils?.getErpCoupangId;
    if (typeof get === 'function') return String(get(driver) || '').trim();
    return String(driver?.coupangId || driver?.coupangLoginId || '').trim();
  }

  function phoneLabel(driver) {
    const format = window.BremDriverUtils?.formatPhoneDisplay;
    if (typeof format === 'function') return format(driver?.phone) || '-';
    return String(driver?.phone || '').trim() || '-';
  }

  function drivers() {
    const api = window.BremStorage?.drivers;
    if (typeof api?.getAllKnownById === 'function') return api.getAllKnownById() || [];
    return api?.getAll?.() || [];
  }

  function usesPlatform(driver, platform) {
    if (platform === 'baemin') return Boolean(driver?.platformBaemin);
    return driver?.platformCoupang !== false;
  }

  function regionText(driver, platform) {
    const value = platform === 'coupang'
      ? String(driver?.regionCoupang || '').trim()
      : String(driver?.regionBaemin || '').trim();
    if (!usesPlatform(driver, platform)) return { text: '해당없음', empty: false };
    if (!value) return { text: '미배정', empty: true };
    return { text: value, empty: false };
  }

  function syncWeekUi() {
    const start = weekStartKey(state.weekStart || localDateKey());
    state.weekStart = start;
    const hidden = $('#driverDetailWeek');
    const label = $('#driverDetailWeekBtn');
    const range = $('#driverDetailWeekRange');
    const picker = window.BremDatePicker;
    if (hidden) hidden.value = start;
    if (label) {
      const formatted = picker?.formatDate?.(start) || start;
      const weekday = picker?.formatWeekdayKo?.(start) || '수';
      label.textContent = `${formatted}(${weekday})`;
    }
    if (range) {
      range.textContent = picker?.formatWednesdayWeekRange?.(start) || `${start} ~ ${weekEndKey(start)}`;
    }
  }

  function setWeek(value) {
    state.weekStart = weekStartKey(value);
    syncWeekUi();
    if (state.selectedId) void renderDetail();
  }

  function shiftWeek(delta) {
    setWeek(addDays(state.weekStart || localDateKey(), delta * 7));
  }

  function searchHits() {
    const query = fold(state.query);
    const phoneQuery = digits(state.query);
    if (!query && !phoneQuery) return [];
    return drivers().filter(driver => {
      const blob = [
        driver?.name,
        erpId(driver),
        driver?.baeminId,
        coupangId(driver),
        driver?.coupangLoginId,
        driver?.status
      ].map(fold).join(' ');
      if (query && blob.includes(query)) return true;
      if (phoneQuery && phoneQuery.length >= 4 && digits(driver?.phone).includes(phoneQuery)) return true;
      return false;
    }).slice(0, 40);
  }

  function renderResults() {
    const root = $('#driverDetailResults');
    if (!root) return;
    const query = String(state.query || '').trim();
    if (!query) {
      root.innerHTML = '<p class="driver-detail-empty">이름, 전화, ID를 입력하세요.</p>';
      return;
    }
    const hits = searchHits();
    if (!hits.length) {
      root.innerHTML = '<p class="driver-detail-empty">검색 결과가 없습니다.</p>';
      return;
    }
    root.innerHTML = hits.map(driver => {
      const id = String(driver.id || '');
      const active = id && id === state.selectedId ? ' is-active' : '';
      return `<button type="button" class="driver-detail-hit${active}" data-driver-detail-id="${escapeHtml(id)}">
        <strong>${escapeHtml(driver.name || '-')}</strong>
        <small>${escapeHtml(erpId(driver) || '-')} · ${escapeHtml(driver.status || '근무중')}</small>
      </button>`;
    }).join('');
  }

  async function ensureWeekData() {
    const start = weekStartKey(state.weekStart);
    const end = weekEndKey(start);
    const storage = window.BremStorage;
    const jobs = [];
    if (typeof storage?.ensureSectionLoaded === 'function') {
      jobs.push(storage.ensureSectionLoaded('rejections', { force: false }).catch(error => {
        throw new Error(`거절율: ${error?.message || error}`);
      }));
    }
    if (typeof storage?.ensureCallsSinceDate === 'function') {
      jobs.push(storage.ensureCallsSinceDate(start, { force: false, untilDate: end, merge: true }).catch(error => {
        throw new Error(`콜수: ${error?.message || error}`);
      }));
    }
    if (typeof storage?.ensureSettlementsSinceDate === 'function') {
      jobs.push(storage.ensureSettlementsSinceDate(start, { force: false, untilDate: end, merge: true }).catch(error => {
        throw new Error(`일정산: ${error?.message || error}`);
      }));
    }
    const errors = [];
    await Promise.all(jobs.map(job => job.catch(error => errors.push(error.message || String(error)))));
    state.loadError = errors.join(' / ');
  }

  function buildWeekBuckets(driverId, weekStart) {
    const start = weekStartKey(weekStart);
    const end = weekEndKey(start);
    const buckets = new Map();
    dateList(start, end).forEach(day => {
      buckets.set(day, {
        baeminCalls: 0,
        coupangCalls: 0,
        baeminFee: 0,
        coupangFee: 0,
        feeStamp: { baemin: '', coupang: '' },
        hasCall: { baemin: false, coupang: false }
      });
    });

    (window.BremStorage?.calls?.getAll?.() || []).forEach(call => {
      if (String(call.driverId || '') !== driverId) return;
      const platform = String(call.platform || '').toLowerCase();
      if (platform !== 'baemin' && platform !== 'coupang') return;
      const day = String(call.date || '').slice(0, 10);
      const bucket = buckets.get(day);
      if (!bucket) return;
      bucket[`${platform}Calls`] += Math.max(0, Number(call.count || call.orderCount || 0));
      bucket.hasCall[platform] = true;
    });

    (window.BremStorage?.settlements?.getAll?.() || []).forEach(row => {
      if (String(row.driverId || '') !== driverId) return;
      const platform = String(row.platform || '').toLowerCase();
      if (platform !== 'baemin' && platform !== 'coupang') return;
      const day = String(row.period || row.date || '').slice(0, 10);
      const bucket = buckets.get(day);
      if (!bucket) return;
      const appliedAt = String(row.appliedAt || '');
      if (bucket.feeStamp[platform] && appliedAt < bucket.feeStamp[platform]) return;
      bucket.feeStamp[platform] = appliedAt;
      bucket[`${platform}Fee`] = Math.max(0, Number(row.deliveryAmount ?? row.settlementAmount ?? 0));
      if (!bucket.hasCall[platform]) {
        bucket[`${platform}Calls`] = Math.max(0, Math.round(Number(row.orderCount ?? row.callCount ?? 0)));
      }
    });

    return { start, end, days: [...buckets.entries()].map(([date, row]) => ({ date, ...row })) };
  }

  function rejectionRow(driverId, weekStart, platform) {
    const rows = (window.BremStorage?.rejections?.getAll?.() || []).filter(row => (
      String(row.driverId || '') === driverId
      && String(row.weekStart || '').slice(0, 10) === weekStart
      && String(row.platform || '').toLowerCase() === platform
    ));
    rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return rows[0] || null;
  }

  function rateCard(title, row, kind) {
    if (!row) {
      return `<article class="driver-detail-kpi"><span>${escapeHtml(title)}</span><b>-</b><em>이번 주 기록 없음</em></article>`;
    }
    const stats = row.stats || {};
    if (stats.unmeasured || row.rate == null) {
      return `<article class="driver-detail-kpi"><span>${escapeHtml(title)}</span><b>미측정</b><em>건수 없음</em></article>`;
    }
    const extra = kind === 'baemin'
      ? `완료 ${formatNumber(stats.completeTotal)} · 거절 ${formatNumber(stats.rejectCount)}`
      : `완료 ${formatNumber(stats.completeCount)} · 거절 ${formatNumber(stats.rejectCount)} · 취소 ${formatNumber(stats.cancelCount)}`;
    return `<article class="driver-detail-kpi"><span>${escapeHtml(title)}</span><b>${formatRate(row.rate)}</b><em>${escapeHtml(extra)}</em></article>`;
  }

  function renderDetailHtml(driver) {
    const built = buildWeekBuckets(String(driver.id), state.weekStart);
    const totals = built.days.reduce((acc, day) => {
      acc.baeminCalls += day.baeminCalls;
      acc.coupangCalls += day.coupangCalls;
      acc.baeminFee += day.baeminFee;
      acc.coupangFee += day.coupangFee;
      return acc;
    }, { baeminCalls: 0, coupangCalls: 0, baeminFee: 0, coupangFee: 0 });
    const fee = totals.baeminFee + totals.coupangFee;
    const calls = totals.baeminCalls + totals.coupangCalls;
    const baeminRegion = regionText(driver, 'baemin');
    const coupangRegion = regionText(driver, 'coupang');
    const baeminRate = rejectionRow(String(driver.id), built.start, 'baemin');
    const coupangRate = rejectionRow(String(driver.id), built.start, 'coupang');
    const dayRows = built.days.map(day => `
      <tr>
        <td>${escapeHtml(day.date)}</td>
        <td>${formatNumber(day.baeminCalls)}</td>
        <td>${formatNumber(day.coupangCalls)}</td>
        <td>${formatMoney(day.baeminFee)}</td>
        <td>${formatMoney(day.coupangFee)}</td>
        <td>${formatMoney(day.baeminFee + day.coupangFee)}</td>
      </tr>`).join('');

    return `
      <div class="driver-detail-profile">
        <strong>${escapeHtml(driver.name || '-')}</strong>
        <span>ERP ${escapeHtml(erpId(driver) || '-')}</span>
        <span>${escapeHtml(phoneLabel(driver))}</span>
        <span>${escapeHtml(driver.status || '근무중')}</span>
        <span>배민ID ${escapeHtml(driver.baeminId || '-')}</span>
        <span>쿠팡ID ${escapeHtml(coupangId(driver) || '-')}</span>
      </div>
      <div class="driver-detail-regions">
        <span class="driver-detail-chip${baeminRegion.empty ? ' is-empty' : ''}">배민 지역 · ${escapeHtml(baeminRegion.text)}</span>
        <span class="driver-detail-chip${coupangRegion.empty ? ' is-empty' : ''}">쿠팡 지역 · ${escapeHtml(coupangRegion.text)}</span>
      </div>
      <div class="driver-detail-kpis">
        <article class="driver-detail-kpi"><span>이번 주 배달료</span><b>${formatMoney(fee)}</b><em>배민 ${formatMoney(totals.baeminFee)} · 쿠팡 ${formatMoney(totals.coupangFee)}</em></article>
        <article class="driver-detail-kpi"><span>이번 주 콜수</span><b>${formatNumber(calls)}</b><em>배민 ${formatNumber(totals.baeminCalls)} · 쿠팡 ${formatNumber(totals.coupangCalls)}</em></article>
        ${rateCard('배민 수락율', baeminRate, 'baemin')}
        ${rateCard('쿠팡 거절율', coupangRate, 'coupang')}
      </div>
      <p class="driver-detail-note">${state.loadError ? `일부 데이터를 읽지 못했습니다. ${escapeHtml(state.loadError)}` : '배달료는 일정산 업로드 금액이고, 콜수는 콜수 입력이 있으면 그 값을 우선합니다.'}</p>
      <div class="driver-scroll-table table-wrap">
        <table class="driver-detail-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>배민콜</th>
              <th>쿠팡콜</th>
              <th>배민배달료</th>
              <th>쿠팡배달료</th>
              <th>배달료합계</th>
            </tr>
          </thead>
          <tbody>${dayRows}</tbody>
          <tfoot>
            <tr>
              <th>합계</th>
              <th>${formatNumber(totals.baeminCalls)}</th>
              <th>${formatNumber(totals.coupangCalls)}</th>
              <th>${formatMoney(totals.baeminFee)}</th>
              <th>${formatMoney(totals.coupangFee)}</th>
              <th>${formatMoney(fee)}</th>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }

  async function renderDetail() {
    const body = $('#driverDetailBody');
    if (!body) return;
    const driver = drivers().find(item => String(item.id || '') === state.selectedId);
    if (!driver) {
      body.innerHTML = '<p class="driver-detail-empty">기사를 검색한 뒤 이름을 선택하세요.</p>';
      return;
    }
    const seq = ++state.detailSeq;
    body.innerHTML = '<p class="driver-detail-empty">이번 주 실적을 불러오는 중…</p>';
    state.loading = true;
    try {
      await ensureWeekData();
      if (seq !== state.detailSeq) return;
      const fresh = drivers().find(item => String(item.id || '') === state.selectedId) || driver;
      body.innerHTML = renderDetailHtml(fresh);
    } catch (error) {
      body.innerHTML = `<p class="driver-detail-empty">${escapeHtml(error?.message || '상세를 불러오지 못했습니다.')}</p>`;
    } finally {
      state.loading = false;
    }
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    $('#driverDetailQuery')?.addEventListener('input', event => {
      state.query = event.target.value || '';
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(renderResults, 120);
    });
    $('#driverDetailResults')?.addEventListener('click', event => {
      const hit = event.target.closest('[data-driver-detail-id]');
      if (!hit) return;
      state.selectedId = hit.dataset.driverDetailId || '';
      renderResults();
      void renderDetail();
    });
    $('#driverDetailWeekPrevBtn')?.addEventListener('click', () => shiftWeek(-1));
    $('#driverDetailWeekNextBtn')?.addEventListener('click', () => shiftWeek(1));
    $('#driverDetailOpenBtn')?.addEventListener('click', () => togglePanel());
    document.addEventListener('click', event => {
      if (event.target.closest('[data-driver-detail-close]')) closePanel();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && $('#driverDetailPanel')?.classList.contains('is-open')) closePanel();
    });
  }

  function markOpenButtons(open) {
    $('#driverDetailOpenBtn')?.classList.toggle('is-open', open);
    document.querySelector('[data-driver-mgmt-tab="detail"]')?.classList.toggle('is-open', open);
  }

  function open() {
    bind();
    if (!state.weekStart) state.weekStart = weekStartKey(localDateKey());
    syncWeekUi();
    renderResults();
    if (state.selectedId && !$('#driverDetailBody')?.querySelector('.driver-detail-kpis')) {
      void renderDetail();
    }
  }

  function openPanel() {
    const panel = $('#driverDetailPanel');
    if (!panel) return;
    bind();
    panel.hidden = false;
    document.getElementById('adminApp')?.classList.add('driver-detail-open');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => panel.classList.add('is-open'));
    });
    markOpenButtons(true);
    open();
    window.setTimeout(() => $('#driverDetailQuery')?.focus(), 30);
  }

  function closePanel() {
    const panel = $('#driverDetailPanel');
    if (!panel) return;
    panel.classList.remove('is-open');
    document.getElementById('adminApp')?.classList.remove('driver-detail-open');
    markOpenButtons(false);
    window.setTimeout(() => {
      if (!panel.classList.contains('is-open')) panel.hidden = true;
    }, 180);
  }

  function togglePanel() {
    const panel = $('#driverDetailPanel');
    if (panel?.classList.contains('is-open')) closePanel();
    else openPanel();
  }

  bind();

  return { open, openPanel, closePanel, togglePanel, setWeek };
})();

window.BremDriverDetailSearch = BremDriverDetailSearch;
