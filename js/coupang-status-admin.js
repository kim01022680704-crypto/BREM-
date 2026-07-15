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
  const state = { activeMenu: 'peak_realtime', loaded: false };
  const local = { running: false, hasToken: false, vendorCount: 0, collecting: false };
  let localPollTimer = null;
  const $ = (id) => document.getElementById(id);

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

  function tableFor(menu, items) {
    if (!items.length) return '<p class="form-help">데이터가 없습니다. PC에서 수집(coupang:session-server → /collect) 후 조회하세요.</p>';
    const rows = items.map(it => it.parsed_json || {});
    if (menu === 'peak_realtime') {
      return wrap(['지역', '피크', '목표', '완료', '잔여', '달성률'],
        rows.map(p => [p.vendorName || p.vendorId, p.peakLabel, n(p.goalCount), n(p.completedCount), n(p.remainingCount), p.achievementRate == null ? '-' : n(p.achievementRate) + '%']));
    }
    if (menu === 'weekly_performance') {
      return wrap(['지역', '요일', '타임존', '완료/목표', '거절', '거절률'],
        rows.map(p => [p.vendorName || p.vendorId, p.dayOfWeek, p.peakLabel, `${p.completedCount == null ? '-' : n(p.completedCount)}/${n(p.goalCount)}`, p.rejectionCount == null ? '-' : n(p.rejectionCount), p.rejectionRate == null ? '-' : n(p.rejectionRate) + '%']));
    }
    if (menu === 'vendor_info') {
      return wrap(['지역', '목표', '완료', '진행중', '운행중 인원', '거절률'],
        rows.map(p => [p.vendorName || p.vendorId, n(p.target), n(p.completedCount), n(p.onGoingCount), n(p.riderOnLineCount) + '/' + n(p.riderTotalCount), p.rejectionRate == null ? '-' : n(p.rejectionRate) + '%']));
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
    const date = String($('coupangStatusDate')?.value || '').slice(0, 10);
    if (summary) summary.textContent = '불러오는 중…';
    const q = `/api/admin/coupang/items?sourceMenu=${encodeURIComponent(state.activeMenu)}${date ? '&collectDate=' + encodeURIComponent(date) : ''}`;
    const res = await adminApi(q);
    if (!res.ok) {
      if (summary) summary.textContent = res.message || '조회 실패';
      tableEl.innerHTML = `<p class="form-help">${esc(res.message || '조회 실패')}</p>`;
      return;
    }
    const items = res.items || [];
    tableEl.innerHTML = tableFor(state.activeMenu, items);
    if (summary) summary.textContent = `${MENUS.find(m => m.id === state.activeMenu)?.label} · ${items.length}건${date ? ' · ' + date : ''}`;
  }

  async function renderDashboardCard() {
    const mount = $('dashboardCoupangCard');
    if (!mount) return;
    const openBtn = $('dashboardCoupangOpenStatusBtn');
    if (openBtn && !openBtn.dataset.bound) {
      openBtn.dataset.bound = '1';
      openBtn.addEventListener('click', () => {
        document.querySelector('[data-section="coupang-status"]')?.click();
      });
    }
    const cfg = await adminApi('/api/admin/coupang/config');
    if (!cfg.ok) {
      mount.innerHTML = `<p class="form-help">${esc(cfg.message || '조회 실패')}</p>`;
      return;
    }
    const latestDate = cfg.latest ? cfg.latest.vendor_info : null;
    if (!latestDate) {
      mount.innerHTML = '<p class="form-help">수집된 지역별 데이터가 없습니다. PC에서 수집하면 표시됩니다.</p>';
      return;
    }
    const res = await adminApi(`/api/admin/coupang/items?sourceMenu=vendor_info&collectDate=${encodeURIComponent(latestDate)}`);
    if (!res.ok) {
      mount.innerHTML = `<p class="form-help">${esc(res.message || '조회 실패')}</p>`;
      return;
    }
    const rows = (res.items || []).map(it => it.parsed_json || {});
    if (!rows.length) {
      mount.innerHTML = '<p class="form-help">수집된 지역별 데이터가 없습니다.</p>';
      return;
    }
    const table = wrap(
      ['지역', '목표', '완료', '달성률', '진행중', '운행 인원', '거절률'],
      rows.map(p => {
        const target = p.target == null ? null : Number(p.target);
        const done = p.completedCount == null ? null : Number(p.completedCount);
        const rate = (target && done != null) ? Math.round((done / target) * 1000) / 10 : null;
        return [
          p.vendorName || p.vendorId,
          n(p.target),
          n(p.completedCount),
          rate == null ? '-' : rate + '%',
          n(p.onGoingCount),
          n(p.riderOnLineCount) + '/' + n(p.riderTotalCount),
          p.rejectionRate == null ? '-' : n(p.rejectionRate) + '%'
        ];
      })
    );
    mount.innerHTML = `<p class="admin-table-summary">기준일 ${esc(latestDate)} · ${rows.length}개 지역</p>${table}`;
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

  function updateLocalButtons() {
    const openBtn = $('coupangOpenBrowserBtn');
    const collectBtn = $('coupangCollectBtn');
    if (openBtn) openBtn.disabled = !local.running || local.collecting;
    if (collectBtn) collectBtn.disabled = !local.running || !local.hasToken || local.collecting;
  }

  async function refreshLocalStatus() {
    const h = await callLocal('/health', { timeoutMs: 2500 });
    local.running = Boolean(h.ok);
    local.hasToken = Boolean(h.hasToken);
    local.vendorCount = Number(h.vendorCount || 0);
    local.collecting = Boolean(h.collecting);
    renderLocalStatus();
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
    toast(`수집 완료 · 피크 ${s.peak_realtime || 0} · 주간 ${s.weekly_performance || 0} · 지역 ${s.vendor_info || 0} · 라이더 ${s.rider_daily || 0}`);
    await loadConfig();
    await loadItems();
    void renderDashboardCard();
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
    startLocalPoll();
    void refreshLocalStatus();
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

  window.BremCoupangStatusAdmin = { refresh, renderDashboardCard };
})();
