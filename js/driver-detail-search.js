// 기사관리 — 기사상세검색 오른쪽 패널
const BremDriverDetailSearch = (function () {
  const $ = selector => document.querySelector(selector);

  const state = {
    bound: false,
    weekStart: '',
    query: '',
    selectedId: '',
    phonePeriod: 'today',
    phonePayload: null,
    phoneDriverId: '',
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

  function erpPassword(driver) {
    const saved = String(driver?.password || '').trim();
    return saved || '1234';
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

  function driversReady() {
    const api = window.BremStorage?.drivers;
    if (typeof api?.isLoadComplete === 'function') {
      return Boolean(api.isLoadComplete()) && drivers().length > 0;
    }
    return drivers().length > 0;
  }

  function renderResults() {
    const root = $('#driverDetailResults');
    if (!root) return;
    const typed = String($('#driverDetailQuery')?.value || '');
    if (typed !== state.query) state.query = typed;
    const query = String(state.query || '').trim();
    if (!query) {
      root.innerHTML = driversReady()
        ? '<p class="driver-detail-empty">기사 이름을 입력하세요.</p>'
        : '<p class="driver-detail-empty">기사 목록 불러오는 중…</p>';
      return;
    }
    const hits = searchHits();
    if (!hits.length) {
      root.innerHTML = driversReady()
        ? '<p class="driver-detail-empty">검색 결과가 없습니다.</p>'
        : '<p class="driver-detail-empty">기사 목록 불러오는 중…</p>';
      return;
    }
    root.innerHTML = hits.map(driver => {
      const id = String(driver.id || '');
      const active = id && id === state.selectedId ? ' is-active' : '';
      return `<button type="button" class="driver-detail-hit${active}" data-driver-detail-id="${escapeHtml(id)}">
        <strong>${escapeHtml(driver.name || '-')}</strong>
        <small>${escapeHtml(erpId(driver) || '-')} · ${escapeHtml(phoneLabel(driver))} · ${escapeHtml(driver.status || '근무중')}</small>
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
      <div class="driver-detail-op-line">
        <span class="driver-detail-op is-unknown" id="driverDetailOpTag">운행 확인중</span>
      </div>
      <div class="driver-detail-profile">
        <strong>${escapeHtml(driver.name || '-')}</strong>
        <span>ERP ${escapeHtml(erpId(driver) || '-')}</span>
        <span>비밀번호 ${escapeHtml(erpPassword(driver))}</span>
        <span>${escapeHtml(phoneLabel(driver))}</span>
        <span>${escapeHtml(driver.status || '근무중')}</span>
        <span>배민ID ${escapeHtml(driver.baeminId || '-')}</span>
        <span>쿠팡ID ${escapeHtml(coupangId(driver) || '-')}</span>
      </div>
      <div class="driver-detail-regions">
        <span class="driver-detail-chip${baeminRegion.empty ? ' is-empty' : ''}">배민 지역 · ${escapeHtml(baeminRegion.text)}</span>
        <span class="driver-detail-chip${coupangRegion.empty ? ' is-empty' : ''}">쿠팡 지역 · ${escapeHtml(coupangRegion.text)}</span>
      </div>
      <div class="driver-detail-actions">
        <button type="button" class="driver-detail-mobile-open driver-detail-edit" data-driver-detail-edit>
          <span>
            <b>정보 수정</b>
            <small>근무 상태 · 연락처 · 계좌 · 아이디</small>
          </span>
          <em>수정</em>
        </button>
        <button type="button" class="driver-detail-mobile-open" data-driver-detail-mobile>
          <span>
            <b>모바일 화면 보기</b>
            <small>이 기사가 보는 앱</small>
          </span>
          <em>열기</em>
        </button>
        <button type="button" class="driver-detail-mobile-open" data-driver-detail-payslip>
          <span>
            <b>급여명세서 보기</b>
            <small>이 정산주 주급명세서</small>
          </span>
          <em>열기</em>
        </button>
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
      void refreshOperating(String(fresh.id || ''));
    } catch (error) {
      body.innerHTML = `<p class="driver-detail-empty">${escapeHtml(error?.message || '상세를 불러오지 못했습니다.')}</p>`;
    } finally {
      state.loading = false;
    }
  }

  function metric(label, value, positive) {
    return `<div class="dphone-metric"><span>${escapeHtml(label)}</span><strong${positive ? ' class="is-pos"' : ''}>${escapeHtml(value)}</strong></div>`;
  }

  function rateText(value) {
    if (value == null || value === '' || Number.isNaN(Number(value))) return '-';
    return `${Math.round(Number(value) * 10) / 10}%`;
  }

  function platformTag(label, row) {
    if (row?.skipped) return `<span class="driver-detail-op is-off">${escapeHtml(label)} 해당없음</span>`;
    if (!row?.known) return `<span class="driver-detail-op is-unknown">${escapeHtml(label)} 미확인</span>`;
    const on = row.operating === true;
    return `<span class="driver-detail-op ${on ? 'is-on' : 'is-off'}">${escapeHtml(label)} ${on ? '운행중' : '운행종료'}</span>`;
  }

  function paintOperating(payload) {
    const tag = $('#driverDetailOpTag');
    const operating = payload?.operating || {};
    if (!tag) return;
    tag.classList.remove('is-on', 'is-off', 'is-unknown');
    if (operating.operating === true) {
      tag.textContent = '운행중';
      tag.classList.add('is-on');
    } else if (operating.operating === false) {
      tag.textContent = '운행종료';
      tag.classList.add('is-off');
    } else {
      tag.textContent = '운행 미확인';
      tag.classList.add('is-unknown');
    }
    const extra = [platformTag('배민', operating.baemin), platformTag('쿠팡', operating.coupang)].join('');
    let row = tag.parentElement?.querySelector('.driver-detail-op-row');
    if (!row) {
      tag.insertAdjacentHTML('afterend', `<span class="driver-detail-op-row">${extra}</span>`);
    } else {
      row.innerHTML = extra;
    }
  }

  async function fetchMobile(driverId) {
    const id = String(driverId || '');
    if (!id) return null;
    if (state.phonePayload && state.phoneDriverId === id) return state.phonePayload;
    const token = await window.BremStorage?.resolveAdminAccessToken?.();
    if (!token) throw new Error('관리자 로그인 세션이 없습니다.');
    const response = await fetch(`/api/admin/driver-mobile-preview?driverId=${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '모바일 화면을 불러오지 못했습니다.');
    state.phoneDriverId = id;
    state.phonePayload = payload;
    return payload;
  }

  async function refreshOperating(driverId) {
    const seq = state.detailSeq;
    try {
      const payload = await fetchMobile(driverId);
      if (seq !== state.detailSeq || String(state.selectedId || '') !== driverId) return;
      paintOperating(payload);
    } catch (error) {
      const tag = $('#driverDetailOpTag');
      if (tag && seq === state.detailSeq) {
        tag.textContent = '운행 미확인';
        tag.classList.remove('is-on', 'is-off');
        tag.classList.add('is-unknown');
        tag.title = error?.message || '';
      }
    }
  }

  function phonePeriodHtml(period, baemin, coupang) {
    const today = period === 'today';
    const bmComplete = today ? baemin?.complete : baemin?.weekComplete;
    const bmSla = today ? baemin?.slaOutComplete : baemin?.weekSlaOutComplete;
    const bmRate = today ? baemin?.acceptRate : baemin?.weekAcceptRate;
    const bmReject = today ? baemin?.foodReject : baemin?.weekFoodReject;
    const bmCancel = today ? baemin?.foodCancel : baemin?.weekFoodCancel;
    const cpComplete = today ? coupang?.complete : coupang?.weekComplete;
    const cpRate = today ? coupang?.rejectionRate : coupang?.weekRejectionRate;
    const cpReject = today ? coupang?.reject : coupang?.weekReject;
    const cpCancel = today ? coupang?.cancel : coupang?.weekCancel;
    return `
      <div class="dphone-plat">
        <span class="dphone-chip dphone-chip--baemin">배민</span>
        <div class="dphone-metrics">
          ${metric('총완료', formatNumber(bmComplete))}
          ${metric('시간외완료', formatNumber(bmSla))}
          ${metric('수락율', rateText(bmRate), true)}
          ${metric('거절', formatNumber(bmReject))}
          ${metric('취소', formatNumber(bmCancel))}
        </div>
      </div>
      <div class="dphone-plat">
        <span class="dphone-chip dphone-chip--coupang">쿠팡</span>
        <div class="dphone-metrics">
          ${metric('총완료', formatNumber(cpComplete))}
          ${metric('거절율', rateText(cpRate), true)}
          ${metric('거절', formatNumber(cpReject))}
          ${metric('취소', formatNumber(cpCancel))}
        </div>
      </div>`;
  }

  function renderPhone(payload) {
    const screen = $('#driverPhoneScreen');
    const title = $('#driverPhoneTitle');
    if (!screen) return;
    const driver = drivers().find(item => String(item.id || '') === state.selectedId);
    const rider = payload?.rider || {};
    const name = rider.name || driver?.name || '기사';
    if (title) title.textContent = `${name} 앱 홈`;
    const baeminRegion = regionText(driver || rider, 'baemin');
    const coupangRegion = regionText(driver || rider, 'coupang');
    const operating = payload?.operating || {};
    const period = state.phonePeriod === 'week' ? 'week' : 'today';
    const baemin = payload?.baeminOps;
    const coupang = payload?.coupangOps;
    const weekCalls = Number(baemin?.weekComplete || 0) + Number(coupang?.weekComplete || 0);
    screen.innerHTML = `
      <article class="dphone-card dphone-profile">
        <div class="dphone-avatar">${escapeHtml(String(name).trim().slice(0, 1) || '-')}</div>
        <div>
          <strong>${escapeHtml(name)}</strong>
          <div class="dphone-tags">
            ${platformTag('배민', operating.baemin)}
            ${platformTag('쿠팡', operating.coupang)}
          </div>
          <p>${escapeHtml(phoneLabel(driver || { phone: rider.phone }))} · ${escapeHtml(baeminRegion.text)} · ${escapeHtml(coupangRegion.text)}</p>
        </div>
      </article>
      <article class="dphone-card">
        <div class="dphone-head">
          <b>실시간 현황</b>
          <div class="dphone-seg">
            <button type="button" data-phone-period="today"${period === 'today' ? ' class="is-active"' : ''}>오늘</button>
            <button type="button" data-phone-period="week"${period === 'week' ? ' class="is-active"' : ''}>주간</button>
          </div>
        </div>
        ${phonePeriodHtml(period, baemin, coupang)}
      </article>
      <div class="dphone-kpis">
        <div><span>주간 콜수</span><strong>${formatNumber(weekCalls)}</strong></div>
        <div><span>수락율(배민)</span><strong>${rateText(baemin?.weekAcceptRate)}</strong></div>
        <div><span>거절율(쿠팡)</span><strong>${rateText(coupang?.weekRejectionRate)}</strong></div>
      </div>
      <p class="dphone-note">기사 앱 홈과 같은 오늘·주간 실적입니다. 다른 메뉴는 기사 앱에서 엽니다.</p>
      <nav class="dphone-nav" aria-label="기사앱 메뉴">
        <span class="is-active">홈</span>
        <span>정비·지출</span>
        <span>실적</span>
        <span>공지</span>
        <span>출금</span>
        <span>명세서</span>
      </nav>`;
  }

  function renderPhoneMessage(text) {
    const screen = $('#driverPhoneScreen');
    if (screen) screen.innerHTML = `<p class="dphone-note">${escapeHtml(text)}</p>`;
  }

  function closePhone() {
    const popup = $('#driverPhonePopup');
    const screen = $('#driverPhoneScreen');
    if (screen) screen.replaceChildren();
    if (!popup) return;
    popup.classList.remove('is-open');
    popup.hidden = true;
  }

  async function fetchPreviewToken(driverId) {
    const token = await window.BremStorage?.resolveAdminAccessToken?.();
    if (!token) throw new Error('관리자 로그인 세션이 없습니다.');
    const response = await fetch(`/api/admin/driver-app-preview-token?driverId=${encodeURIComponent(driverId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.token) throw new Error(payload.error || '기사 앱을 열지 못했습니다.');
    return payload.token;
  }

  function openRiderEdit() {
    const driver = drivers().find(item => String(item.id || '') === state.selectedId);
    if (!driver?.id) return;
    const opener = window.BremDriverPopups?.openEdit;
    if (typeof opener === 'function') {
      opener(driver.id, driver.name || '');
      return;
    }
    window.open(`rider-manage.html?edit=${encodeURIComponent(driver.id)}`, '_blank', 'noopener');
  }

  async function openPhone() {
    const popup = $('#driverPhonePopup');
    const screen = $('#driverPhoneScreen');
    if (!popup || !screen || !state.selectedId) return;
    popup.hidden = false;
    popup.classList.add('is-open');
    const driver = drivers().find(item => String(item.id || '') === state.selectedId);
    const title = $('#driverPhoneTitle');
    if (title) title.textContent = driver?.name ? `${driver.name} 기사앱` : '기사앱';
    screen.innerHTML = '<p class="dphone-note">기사 앱을 여는 중…</p>';
    try {
      const previewToken = await fetchPreviewToken(state.selectedId);
      if (!$('#driverPhonePopup')?.classList.contains('is-open')) return;
      const frame = document.createElement('iframe');
      frame.className = 'driver-phone__frame';
      frame.title = driver?.name ? `${driver.name} 기사앱` : '기사앱';
      frame.src = `driver.html?adminPreview=${encodeURIComponent(previewToken)}`;
      screen.replaceChildren(frame);
    } catch (error) {
      screen.innerHTML = `<p class="dphone-note">${escapeHtml(error?.message || '기사 앱을 열지 못했습니다.')}</p>`;
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
    document.addEventListener('brem-drivers-sync-ready', () => {
      if (!$('#driverDetailPanel')?.classList.contains('is-open')) return;
      if ($('#driverDetailScreen') && !$('#driverDetailScreen').hidden) return;
      renderResults();
    });
    $('#driverDetailResults')?.addEventListener('click', event => {
      const hit = event.target.closest('[data-driver-detail-id]');
      if (!hit) return;
      state.selectedId = hit.dataset.driverDetailId || '';
      showDetail();
    });
    document.addEventListener('click', event => {
      if (event.target.closest('[data-driver-detail-back]')) showSearch();
    });
    $('#driverDetailWeekPrevBtn')?.addEventListener('click', () => shiftWeek(-1));
    $('#driverDetailWeekNextBtn')?.addEventListener('click', () => shiftWeek(1));
    $('#driverDetailOpenBtn')?.addEventListener('click', () => togglePanel());
    $('#driverDetailSideBtn')?.addEventListener('click', () => {
      togglePanel();
      document.getElementById('sidebar')?.classList.remove('open');
      document.getElementById('overlay')?.classList.remove('active');
    });
    document.addEventListener('click', event => {
      if (event.target.closest('[data-driver-detail-edit]')) {
        openRiderEdit();
        return;
      }
      if (event.target.closest('[data-driver-detail-mobile]')) {
        void openPhone();
        return;
      }
      if (event.target.closest('[data-driver-detail-payslip]')) {
        void openPayslip();
        return;
      }
      if (event.target.closest('[data-driver-phone-close]')) closePhone();
      if (event.target.closest('[data-driver-detail-close]')) closePanel();
    });
    window.addEventListener('message', event => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'brem-driver-saved') return;
      const id = String(event.data.id || '');
      if (!id || id !== state.selectedId) return;
      const refresh = window.BremStorage?.drivers?.fetchById;
      const redraw = () => {
        if (state.selectedId === id && !$('#driverDetailScreen')?.hidden) void renderDetail();
      };
      if (typeof refresh === 'function') {
        refresh(id, { force: true }).then(redraw).catch(redraw);
      } else {
        redraw();
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (window.BremDriverPopups?.isOpen?.()) return;
      if ($('#driverPhonePopup')?.classList.contains('is-open')) {
        closePhone();
        return;
      }
      if ($('#driverDetailPanel')?.classList.contains('is-open')) closePanel();
    });
  }

  function markOpenButtons(open) {
    $('#driverDetailOpenBtn')?.classList.toggle('is-open', open);
    $('#driverDetailSideBtn')?.classList.toggle('is-open', open);
    document.querySelector('[data-driver-mgmt-tab="detail"]')?.classList.toggle('is-open', open);
  }

  async function openPayslip() {
    const driver = drivers().find(item => String(item.id || '') === state.selectedId);
    if (!driver) return;
    const opener = window.BremAdminPayrollSlipSearch?.openForDriver;
    if (typeof opener !== 'function') return;
    try {
      await opener(driver, state.weekStart);
    } catch (error) {
      window.alert(error?.message || '급여명세서를 열지 못했습니다.');
    }
  }

  function showSearch() {
    const search = $('#driverDetailSearchView');
    const screen = $('#driverDetailScreen');
    const title = $('#driverDetailTitle');
    if (search) search.hidden = false;
    if (screen) screen.hidden = true;
    if (title) title.textContent = '기사상세검색';
    closePhone();
    renderResults();
    window.setTimeout(() => $('#driverDetailQuery')?.focus(), 30);
  }

  function showDetail() {
    if (state.phoneDriverId && state.phoneDriverId !== state.selectedId) {
      state.phonePayload = null;
      state.phoneDriverId = '';
    }
    const search = $('#driverDetailSearchView');
    const screen = $('#driverDetailScreen');
    const title = $('#driverDetailTitle');
    const driver = drivers().find(item => String(item.id || '') === state.selectedId);
    if (search) search.hidden = true;
    if (screen) screen.hidden = false;
    if (title) title.textContent = driver?.name ? `${driver.name} 상세` : '기사상세';
    if (!state.weekStart) state.weekStart = weekStartKey(localDateKey());
    syncWeekUi();
    void renderDetail();
  }

  function open() {
    bind();
    if (!state.weekStart) state.weekStart = weekStartKey(localDateKey());
    syncWeekUi();
    showSearch();
  }

  async function ensureHomepageDrivers() {
    const storage = window.BremStorage;
    if (!storage) return;
    // ERP 관리자 홈과 같다. 배경 수화를 끝낸 뒤 대시보드 섹션(기사 목록 포함)을 연다.
    if (typeof storage.hydrateAdminDataInBackground === 'function') {
      await storage.hydrateAdminDataInBackground().catch(() => {});
    }
    if (typeof storage.ensureSectionLoaded === 'function') {
      try {
        await storage.ensureSectionLoaded('dashboard');
      } catch (error) {
        if (!drivers().length) throw error;
      }
    }
  }

  async function ensureSearchDrivers() {
    await ensureHomepageDrivers();
    if (driversReady()) return;
    const reload = window.BremStorage?.reloadDrivers;
    if (typeof reload === 'function') {
      await reload(false);
    }
  }

  function refreshOpenSearch() {
    if (!$('#driverDetailPanel')?.classList.contains('is-open')) return;
    if ($('#driverDetailScreen') && !$('#driverDetailScreen').hidden) return;
    renderResults();
  }

  function openPanel() {
    const panel = $('#driverDetailPanel');
    if (!panel) return;
    bind();
    panel.hidden = false;
    panel.classList.add('is-open');
    markOpenButtons(true);
    open();
    const root = $('#driverDetailResults');
    if (root && !driversReady()) {
      const typed = String($('#driverDetailQuery')?.value || '').trim();
      root.innerHTML = '<p class="driver-detail-empty">기사 목록 불러오는 중…</p>';
    }
    void ensureSearchDrivers().then(() => {
      refreshOpenSearch();
    }).catch(error => {
      if (drivers().length) {
        refreshOpenSearch();
        return;
      }
      if (root && $('#driverDetailPanel')?.classList.contains('is-open')) {
        root.innerHTML = `<p class="driver-detail-empty">${escapeHtml(error?.message || '기사 목록을 불러오지 못했습니다.')}</p>`;
      }
    });
  }

  function closePanel() {
    const panel = $('#driverDetailPanel');
    if (!panel) return;
    closePhone();
    panel.classList.remove('is-open');
    panel.hidden = true;
    document.getElementById('adminApp')?.classList.remove('driver-detail-open');
    markOpenButtons(false);
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
