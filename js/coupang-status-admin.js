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

  const state = { activeMenu: 'peak_realtime', loaded: false };
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

  async function refresh() {
    renderMenuBar();
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
