(function () {
  const state = {
    date: '',
    partnerId: '',
    regions: [],
    riders: [],
    hourOrder: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5],
    message: '',
    collectedAt: '',
    latestCollectedDate: '',
    keyword: '',
    showZeros: false,
    loading: false
  };

  const $ = id => document.getElementById(id);

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

  function formatWhen(iso) {
    const raw = String(iso || '').trim();
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(date);
  }

  async function adminApi(path) {
    const token = await window.BremStorage?.resolveAdminAccessToken?.();
    if (!token) return { ok: false, message: '관리자 로그인이 필요합니다.' };
    try {
      const response = await fetch(path, {
        credentials: 'same-origin',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));
      return response.ok
        ? { ok: true, ...data }
        : { ok: false, message: data.message || data.error || `요청 실패 (${response.status})` };
    } catch (error) {
      return { ok: false, message: error.message || '네트워크 오류' };
    }
  }

  function visibleRiders() {
    const keyword = state.keyword.trim();
    return state.riders.filter(rider => {
      if (!state.showZeros && !rider.total) return false;
      if (keyword && !String(rider.riderName || '').includes(keyword)) return false;
      return true;
    });
  }

  function renderMeta() {
    const meta = $('baeminRiderHourlyMeta');
    if (!meta) return;
    const region = state.regions.find(item => item.partnerId === state.partnerId);
    const when = formatWhen(state.collectedAt || region?.collectedAt);
    const bits = [];
    if (state.date) bits.push(`${state.date} 영업일`);
    if (region) bits.push(`${region.regionName} · 기사 ${formatNumber(region.riderCount)}명 · 완료 ${formatNumber(region.total)}건`);
    if (when) bits.push(`수집 ${when}`);
    bits.push('06시~다음날 05시 · 라이더별 수집과 함께 저장');
    meta.textContent = state.message ? `${state.message} ${bits.join(' · ')}` : bits.join(' · ');
  }

  function renderRegions() {
    const select = $('baeminRiderHourlyRegion');
    if (!select) return;
    const current = state.partnerId;
    select.innerHTML = state.regions.map(region => (
      `<option value="${escapeHtml(region.partnerId)}">${escapeHtml(region.regionName)} · ${formatNumber(region.total)}건</option>`
    )).join('');
    if (!state.regions.length) {
      select.innerHTML = '<option value="">수집된 지역 없음</option>';
      return;
    }
    if (current && state.regions.some(region => region.partnerId === current)) {
      select.value = current;
    }
  }

  function renderTable() {
    const host = $('baeminRiderHourlyTable');
    if (!host) return;
    const hours = state.hourOrder.length ? state.hourOrder : [];
    const riders = visibleRiders();
    if (!state.regions.length) {
      host.innerHTML = `<p class="rider-hourly-empty">${escapeHtml(state.message || '표시할 라이더 내역이 없습니다.')}</p>`;
      return;
    }
    const head = hours.map(hour => `<th>${hour}시</th>`).join('');
    const sum = hours.map(() => 0);
    const body = riders.map(rider => {
      const cells = hours.map((hour, index) => {
        const count = Number(rider.hours?.[hour] || 0);
        sum[index] += count;
        const cls = count ? '' : ' class="is-zero"';
        return `<td${cls}>${formatNumber(count)}</td>`;
      }).join('');
      return `<tr><td class="is-name">${escapeHtml(rider.riderName)}</td><td class="is-total">${formatNumber(rider.total)}</td>${cells}</tr>`;
    }).join('');
    const sumTotal = sum.reduce((total, count) => total + count, 0);
    const sumCells = sum.map(count => `<td>${formatNumber(count)}</td>`).join('');
    const emptyRow = riders.length ? '' : '<tr><td class="is-name" colspan="2">표시할 기사가 없습니다.</td></tr>';
    host.innerHTML = `
      <table class="rider-hourly-table">
        <thead>
          <tr><th class="is-name">기사</th><th class="is-total">합계</th>${head}</tr>
        </thead>
        <tbody>
          <tr class="is-sum"><td class="is-name">합계 ${formatNumber(riders.length)}명</td><td class="is-total">${formatNumber(sumTotal)}</td>${sumCells}</tr>
          ${body || emptyRow}
        </tbody>
      </table>`;
  }

  function render() {
    const dateInput = $('baeminRiderHourlyDate');
    if (dateInput && state.date && dateInput.value !== state.date) dateInput.value = state.date;
    renderRegions();
    renderMeta();
    renderTable();
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    const button = $('baeminRiderHourlyLoadBtn');
    if (button) button.disabled = true;
    const params = new URLSearchParams();
    if (state.date) params.set('date', state.date);
    if (state.partnerId) params.set('partnerId', state.partnerId);
    const result = await adminApi(`/api/admin/baemin-delivery/rider-hourly?${params.toString()}`);
    state.loading = false;
    if (button) button.disabled = false;
    if (!result.ok) {
      state.message = result.message || '라이더 시간대 내역을 불러오지 못했습니다.';
      state.regions = [];
      state.riders = [];
      render();
      return;
    }
    state.date = String(result.date || state.date || '').slice(0, 10);
    state.partnerId = String(result.partnerId || '');
    state.regions = Array.isArray(result.regions) ? result.regions : [];
    state.riders = Array.isArray(result.riders) ? result.riders : [];
    state.hourOrder = Array.isArray(result.hourOrder) && result.hourOrder.length ? result.hourOrder : state.hourOrder;
    state.message = String(result.message || '');
    state.collectedAt = String(result.collectedAt || '');
    state.latestCollectedDate = String(result.latestCollectedDate || '');
    render();
  }

  function bind() {
    const root = $('baemin-rider-hourly');
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';
    $('baeminRiderHourlyDate')?.addEventListener('change', event => {
      state.date = String(event.target.value || '').slice(0, 10);
      state.partnerId = '';
      load();
    });
    $('baeminRiderHourlyRegion')?.addEventListener('change', event => {
      state.partnerId = String(event.target.value || '');
      load();
    });
    $('baeminRiderHourlySearch')?.addEventListener('input', event => {
      state.keyword = String(event.target.value || '');
      renderTable();
      renderMeta();
    });
    $('baeminRiderHourlyZeros')?.addEventListener('change', event => {
      state.showZeros = Boolean(event.target.checked);
      renderTable();
    });
    $('baeminRiderHourlyLoadBtn')?.addEventListener('click', () => load());
  }

  function refresh() {
    bind();
    if (!state.riders.length && !state.loading) load();
  }

  window.BremBaeminRiderHourlyAdmin = { refresh, load };
})();
