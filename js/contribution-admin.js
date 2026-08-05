/**
 * BREM 관리자 · 기여도
 * 배민/쿠팡 분리. 할당 0 → 달성(또는 슬롯/일자 종료) 콜수 고정.
 * 과거 수집 복원 불가 · 오늘 저녁 슬롯부터 적재.
 */
(function () {
  const SLOT_LABELS = {
    morning: '아침점심',
    afternoon: '오후',
    evening: '저녁',
    midnight: '심야',
    MORNING: '아침',
    LUNCH: '점심피크',
    POST_LUNCH: '점심논피크',
    DINNER: '저녁피크',
    POST_DINNER: '저녁논피크',
    day: '일일(이전)',
    peak: '피크'
  };

  const state = {
    date: '',
    platform: 'baemin',
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

  function slotLabel(slotKey) {
    const key = String(slotKey || '');
    return SLOT_LABELS[key] || key || '-';
  }

  function freezeBadge(frozen) {
    return frozen
      ? '<span class="badge" style="background:#1f2937;color:#fff;">고정</span>'
      : '<span class="badge" style="background:#dbeafe;color:#1e40af;">진행</span>';
  }

  function platformLabel(platform) {
    return platform === 'coupang' ? '쿠팡' : '배민';
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

  function syncPlatformTabs() {
    document.querySelectorAll('[data-contribution-platform]').forEach(btn => {
      const active = btn.getAttribute('data-contribution-platform') === state.platform;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function syncInputsFromState() {
    const dateEl = $('contributionDate');
    const regionEl = $('contributionRegion');
    const searchEl = $('contributionSearch');
    if (dateEl && !state.date) state.date = todayKst();
    if (dateEl) dateEl.value = state.date || todayKst();
    if (regionEl) regionEl.value = state.region || '';
    if (searchEl) searchEl.value = state.keyword || '';
    syncPlatformTabs();
  }

  function readInputs() {
    state.date = String($('contributionDate')?.value || todayKst()).slice(0, 10);
    state.region = String($('contributionRegion')?.value || '').trim();
    state.keyword = String($('contributionSearch')?.value || '').trim();
    if (state.platform !== 'baemin' && state.platform !== 'coupang') {
      state.platform = 'baemin';
    }
  }

  function renderSummary(totals = {}, message = '') {
    const el = $('contributionSummary');
    if (!el) return;
    const bits = [
      platformLabel(state.platform),
      `${state.date}`,
      `총 ${totals.count || 0}건`,
      `고정 ${totals.frozen || 0}`,
      `진행 ${totals.live || 0}`,
      `점수합 ${formatScore(state.platform, totals.scoreSum || 0)}`
    ];
    el.textContent = message ? `${bits.join(' · ')} · ${message}` : bits.join(' · ');
  }

  function progressLabel(row) {
    const assigned = Number(row.assigned_target || 0);
    const done = Number(row.region_slot_complete || 0);
    if (assigned <= 0 && done <= 0) return '-';
    return `${Math.round(done)} / ${Math.round(assigned)}`;
  }

  function emptyHelp() {
    if (state.platform === 'coupang') {
      return '쿠팡 타임별 기여도가 없습니다. 크롤 중 각 피크(아침~저녁논피크) 할당이 끝나거나 달성되면 자동 고정됩니다. 일일 합계(이전)는 무시 · 오늘 저녁피크부터 쌓입니다.';
    }
    return '배민 타임별 기여도가 없습니다. 배달현황 크롤 저장 시마다 아침점심/오후/저녁/심야를 갱신하고, 할당 달성·슬롯 종료 시 자동 고정됩니다. 지난 수집분 복원 불가 · 오늘 저녁부터 쌓입니다.';
  }

  function renderTable() {
    const wrap = $('contributionTable');
    if (!wrap) return;
    // 이전 일일(day) 스냅샷은 타임별 규칙과 무관 → 숨김
    const items = state.items.filter(row => String(row.slot_key || '') !== 'day');
    if (!items.length) {
      wrap.innerHTML = `<p class="form-help">${escapeHtml(emptyHelp())}</p>`;
      return;
    }
    const rows = items.map((row, index) => `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(slotLabel(row.slot_key))}</td>
        <td>${escapeHtml(row.region || row.vendor_or_partner || '-')}</td>
        <td>${escapeHtml(row.rider_name || '-')}</td>
        <td><strong>${escapeHtml(formatScore(row.platform || state.platform, row.score))}</strong></td>
        <td>${escapeHtml(progressLabel(row))}</td>
        <td>${freezeBadge(Boolean(row.frozen))}</td>
        <td>${escapeHtml(String(row.updated_at || '').replace('T', ' ').slice(0, 19))}</td>
      </tr>`).join('');
    wrap.innerHTML = `<div class="table-wrap">
      <table class="lease-table lease-table--compact">
        <thead>
          <tr>
            <th>#</th><th>타임</th><th>지역</th><th>기사</th>
            <th>기여도</th><th>할당진행</th><th>상태</th><th>저장시각</th>
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
    if (res.needsV2Migration) {
      toast('슬롯고정 컬럼이 없습니다. supabase/contribution_daily_v2_slot_freeze.sql 을 실행하세요.');
    }
    state.items = Array.isArray(res.items) ? res.items : [];
    renderSummary(res.totals || {}, res.message || '');
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
          platform: state.platform
        })
      });
      if (!saved.ok) {
        toast(saved.message || saved.error || '기여도 저장 실패');
        if (saved.tableMissing || /v2_slot_freeze/.test(String(saved.error || ''))) {
          renderSummary({}, saved.message || saved.error || '마이그레이션 필요');
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

  function setPlatform(platform) {
    const next = platform === 'coupang' ? 'coupang' : 'baemin';
    if (state.platform === next) return;
    state.platform = next;
    syncPlatformTabs();
    void loadList();
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;
    $('contributionRefreshBtn')?.addEventListener('click', () => { void refreshAndLoad(); });
    $('contributionLoadBtn')?.addEventListener('click', () => { void loadList(); });
    $('contributionDate')?.addEventListener('change', () => { void loadList(); });
    $('contributionRegion')?.addEventListener('change', () => { void loadList(); });
    document.querySelectorAll('[data-contribution-platform]').forEach(btn => {
      btn.addEventListener('click', () => {
        setPlatform(btn.getAttribute('data-contribution-platform'));
      });
    });
    let searchTimer = 0;
    $('contributionSearch')?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { void loadList(); }, 250);
    });
  }

  async function refresh() {
    bindEvents();
    if (!state.date) state.date = todayKst();
    if (state.platform !== 'baemin' && state.platform !== 'coupang') {
      state.platform = 'baemin';
    }
    syncInputsFromState();
    await loadList();
  }

  window.BremContributionAdmin = {
    refresh,
    loadList,
    refreshAndLoad
  };
})();
