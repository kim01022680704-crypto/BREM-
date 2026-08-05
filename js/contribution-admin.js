/**
 * BREM 관리자 · 기여도 (일별)
 * 배민=콜수기여도, 쿠팡=소수 콜(completeCount)
 */
(function () {
  const state = {
    date: '',
    platform: 'all',
    region: '',
    keyword: '',
    items: [],
    busy: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function todayKst() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  }

  function toast(message) {
    if (typeof window.showToast === 'function') window.showToast(message);
    else console.log('[기여도]', message);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatScore(platform, score) {
    const n = Number(score) || 0;
    if (platform === 'coupang') {
      return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
    }
    return String(Math.round(n));
  }

  async function adminApi(path, options = {}) {
    const token = await window.BremStorage?.resolveAdminAccessToken?.();
    if (!token) return { ok: false, message: '관리자 로그인이 필요합니다.' };
    try {
      const res = await fetch(path, {
        credentials: 'same-origin',
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          message: data.message || data.error || `요청 실패 (${res.status})`,
          tableMissing: Boolean(data.tableMissing),
          ...data
        };
      }
      return { ok: true, ...data };
    } catch (error) {
      return { ok: false, message: error.message || '네트워크 오류' };
    }
  }

  function syncInputsFromState() {
    const dateEl = $('contributionDate');
    const platformEl = $('contributionPlatform');
    const regionEl = $('contributionRegion');
    const searchEl = $('contributionSearch');
    if (dateEl && !state.date) state.date = todayKst();
    if (dateEl) dateEl.value = state.date || todayKst();
    if (platformEl) platformEl.value = state.platform || 'all';
    if (regionEl) regionEl.value = state.region || '';
    if (searchEl) searchEl.value = state.keyword || '';
  }

  function readInputs() {
    state.date = String($('contributionDate')?.value || todayKst()).slice(0, 10);
    state.platform = String($('contributionPlatform')?.value || 'all');
    state.region = String($('contributionRegion')?.value || '').trim();
    state.keyword = String($('contributionSearch')?.value || '').trim();
  }

  function renderSummary(totals = {}, message = '') {
    const el = $('contributionSummary');
    if (!el) return;
    const bits = [
      `${state.date}`,
      `총 ${totals.count || 0}명`,
      `배민 ${totals.baemin || 0}`,
      `쿠팡 ${totals.coupang || 0}`,
      `점수합 ${formatScore('coupang', totals.scoreSum || 0)}`
    ];
    el.textContent = message ? `${bits.join(' · ')} · ${message}` : bits.join(' · ');
  }

  function renderTable() {
    const wrap = $('contributionTable');
    if (!wrap) return;
    if (!state.items.length) {
      wrap.innerHTML = '<p class="form-help">해당 일자 기여도 데이터가 없습니다. [오늘/선택일 저장]을 눌러 크롤 현황에서 일별 스냅샷을 만드세요.</p>';
      return;
    }
    const rows = state.items.map((row, index) => {
      const platformLabel = row.platform === 'baemin' ? '배민' : '쿠팡';
      const scoreLabel = row.platform === 'baemin' ? '콜수기여도' : '기여도(소수콜)';
      return `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(platformLabel)}</td>
        <td>${escapeHtml(row.region || '-')}</td>
        <td>${escapeHtml(row.rider_name || '-')}</td>
        <td title="${escapeHtml(scoreLabel)}"><strong>${escapeHtml(formatScore(row.platform, row.score))}</strong></td>
        <td>${escapeHtml(row.source || '-')}</td>
        <td>${escapeHtml(row.match_key || '-')}</td>
        <td>${escapeHtml(String(row.updated_at || '').replace('T', ' ').slice(0, 19))}</td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `<div class="table-wrap">
      <table class="lease-table lease-table--compact">
        <thead>
          <tr>
            <th>#</th><th>플랫폼</th><th>지역</th><th>기사</th><th>기여도</th><th>출처</th><th>매칭키</th><th>저장시각</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  async function loadList() {
    readInputs();
    syncInputsFromState();
    const params = new URLSearchParams({
      date: state.date,
      platform: state.platform
    });
    if (state.region) params.set('region', state.region);
    if (state.keyword) params.set('keyword', state.keyword);
    const res = await adminApi(`/api/admin/contribution/daily?${params.toString()}`);
    if (!res.ok) {
      state.items = [];
      renderTable();
      renderSummary({}, res.message || '조회 실패');
      if (res.tableMissing) {
        toast('contribution_daily 테이블이 없습니다. supabase/contribution_daily_migration.sql 을 실행하세요.');
      } else {
        toast(res.message || '기여도 조회 실패');
      }
      return res;
    }
    state.items = Array.isArray(res.items) ? res.items : [];
    renderSummary(res.totals || {}, '');
    renderTable();
    return res;
  }

  async function refreshAndLoad() {
    if (state.busy) return;
    state.busy = true;
    readInputs();
    const btn = $('contributionRefreshBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '저장 중…';
    }
    try {
      const saved = await adminApi('/api/admin/contribution/refresh', {
        method: 'POST',
        body: JSON.stringify({
          date: state.date,
          platform: state.platform === 'all' ? 'all' : state.platform
        })
      });
      if (!saved.ok) {
        toast(saved.message || saved.error || '기여도 저장 실패');
        if (saved.tableMissing) {
          renderSummary({}, saved.message || '테이블 없음');
        }
        return;
      }
      toast(saved.message || '기여도 저장 완료');
      await loadList();
    } finally {
      state.busy = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = '오늘/선택일 저장';
      }
    }
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;
    $('contributionRefreshBtn')?.addEventListener('click', () => { void refreshAndLoad(); });
    $('contributionLoadBtn')?.addEventListener('click', () => { void loadList(); });
    $('contributionDate')?.addEventListener('change', () => { void loadList(); });
    $('contributionPlatform')?.addEventListener('change', () => { void loadList(); });
    $('contributionRegion')?.addEventListener('change', () => { void loadList(); });
    let searchTimer = 0;
    $('contributionSearch')?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { void loadList(); }, 250);
    });
  }

  async function refresh() {
    bindEvents();
    if (!state.date) state.date = todayKst();
    syncInputsFromState();
    await loadList();
  }

  window.BremContributionAdmin = {
    refresh,
    loadList,
    refreshAndLoad
  };
})();
