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
  const local = { running: false, hasToken: false, vendorCount: 0, collecting: false, loop: {} };
  let localPollTimer = null;
  const $ = (id) => document.getElementById(id);

  function dp() { return window.BremDatePicker; }
  function currentWeekStart() {
    const val = $('coupangStatusWeekDate')?.value || '';
    const picker = dp();
    if (!picker) return String(val || '').slice(0, 10);
    return picker.applyWeekWednesday(val || picker.weekStartKey());
  }
  function shiftWeek(days) {
    const cur = currentWeekStart();
    const d = new Date(`${cur}T00:00:00`);
    d.setDate(d.getDate() + days);
    const input = $('coupangStatusWeekDate');
    if (input) input.value = dp() ? dp().applyWeekWednesday(d.toISOString().slice(0, 10)) : d.toISOString().slice(0, 10);
  }
  function renderWeekPreview() {
    const el = $('coupangStatusWeekPreview');
    if (!el) return;
    const ws = currentWeekStart();
    el.textContent = dp()?.formatWednesdayWeekRange ? dp().formatWednesdayWeekRange(ws) : `${ws} ~`;
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
    void renderDashboardCard();
  }

  async function collectWeek() {
    await refreshLocalStatus();
    if (!local.running) { toast('로컬 세션서버(3940)가 꺼져 있어요.'); return; }
    if (!local.hasToken) { toast('먼저 [브라우저 열기]로 로그인 후 대시보드를 한 번 여세요.'); return; }
    if (local.collecting || local.loop?.active) { toast('이미 수집 중입니다.'); return; }
    const weekStart = currentWeekStart();
    local.collecting = true;
    updateLocalButtons();
    renderLocalStatus();
    toast(`정산주(${weekStart}~) 일주일치 수집 중… (몇 분 소요)`);
    const r = await callLocal('/collect', { method: 'POST', body: { weekStartDate: weekStart, fullWeek: true }, timeoutMs: 600000 });
    await refreshLocalStatus();
    if (!r.ok) { toast(r.message || '주간 수집 실패'); return; }
    const s = r.summary || {};
    toast(`주간 수집 완료 · 지역 ${s.vendor_info || 0} · 라이더 ${s.rider_daily || 0} · 주간 ${s.weekly_performance || 0} (${(r.dates || []).length}일)`);
    await loadConfig();
    await loadItems();
    void renderDashboardCard();
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
    bindOnce('coupangStatusPrevWeekBtn', () => { shiftWeek(-7); renderWeekPreview(); });
    bindOnce('coupangStatusNextWeekBtn', () => { shiftWeek(7); renderWeekPreview(); });
    startLocalPoll();
    void refreshLocalStatus();
    const weekInput = $('coupangStatusWeekDate');
    if (weekInput && !weekInput.value) {
      weekInput.value = dp() ? dp().weekStartKey() : new Date().toISOString().slice(0, 10);
    }
    if (weekInput && !weekInput.dataset.bound) {
      weekInput.dataset.bound = '1';
      weekInput.addEventListener('change', () => {
        if (dp() && weekInput.value) weekInput.value = dp().applyWeekWednesday(weekInput.value);
        renderWeekPreview();
      });
    }
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

  window.BremCoupangStatusAdmin = { refresh, renderDashboardCard };
})();
