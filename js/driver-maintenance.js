/**
 * 기사앱 정비기록. 모든 기사에게 보이고, 저장은 서버(Supabase settings)로만 한다.
 */
(function () {
  const panel = document.getElementById('driverMaintPanel');
  if (!panel) return;

  const PARTS = [
    { id: 'oil', label: '오일' },
    { id: 'pad', label: '패드' },
    { id: 'drive', label: '구동계' },
    { id: 'other', label: '기타' }
  ];
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  let state = { bike: null, logs: [], part: 'oil', openMonth: '' };

  function won(n) { return Number(n || 0).toLocaleString('ko-KR'); }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function labelDate(value) {
    if (!value) return '날짜 선택';
    const [y, m, d] = String(value).split('-');
    return `${y}.${m}.${d}`;
  }
  function toast(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
    else alert(msg);
  }

  function daysInMonth(y, m) {
    const prefix = `${y}-${String(m).padStart(2, '0')}-`;
    const map = {};
    (state.logs || []).forEach(row => {
      if (!String(row.date || '').startsWith(prefix)) return;
      const day = Number(String(row.date).slice(8, 10));
      map[day] = true;
    });
    return map;
  }

  function render() {
    const bike = state.bike;
    const logs = state.logs || [];
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (!state.openMonth) state.openMonth = monthKey;
    const monthLogs = logs.filter(row => String(row.date).startsWith(monthKey));
    const monthSum = monthLogs.reduce((sum, row) => sum + Number(row.cost || 0), 0);
    const groups = {};
    logs.forEach(row => {
      const key = String(row.date || '').slice(0, 7);
      if (!key) return;
      (groups[key] = groups[key] || []).push(row);
    });
    const keys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    const lines = keys.map(key => {
      const list = groups[key];
      const sum = list.reduce((acc, row) => acc + Number(row.cost || 0), 0);
      const title = `${key.slice(5)}월 · ${list.length}건 · ${won(sum)}원`;
      if (state.openMonth !== key) {
        return `<button type="button" class="mt-fold" data-month="${key}">${title} ▾</button>`;
      }
      const rows = list.map(row => {
        const dt = new Date(`${row.date}T00:00:00`);
        return `<div class="mt-row"><span><i>${DOW[dt.getDay()]}</i> ${dt.getMonth() + 1}/${dt.getDate()}</span><b>${row.partLabel || ''}</b><span class="mt-km">${won(row.km)}km</span><strong>${won(row.cost)}</strong></div>`;
      }).join('');
      return `<div class="mt-month">${title}</div>${rows}`;
    }).join('');

    panel.innerHTML = `
      <div class="mt-head"><h2>정비기록</h2><button type="button" class="mt-add" id="mtToggle">+ 등록</button></div>
      <div class="mt-card mt-sum"><div><span>${now.getMonth() + 1}월 정비 사용금액</span><strong>${won(monthSum)}<i>원</i></strong></div><em>${monthLogs.length}건</em></div>
      <div class="mt-card mt-bike">
        <div><b>${bike ? bike.model : '오토바이 없음'}</b><small>${bike ? `교체주기 ${won(bike.cycleKm)}km` : '종류와 교체주기를 등록하세요'}</small></div>
        <button type="button" class="mt-yellow" id="mtBikeBtn">오토바이 등록</button>
      </div>
      <form class="mt-card" id="mtForm" hidden>
        <div class="mt-grid">
          <label>날짜
            <button type="button" class="mt-date" id="mtDateBtn"><span id="mtDateLabel">${labelDate(todayKey())}</span></button>
            <input type="date" id="mtDate" value="${todayKey()}" tabindex="-1">
          </label>
          <label>내 오토바이 km<input id="mtKm" inputmode="numeric" placeholder="예: 18240"></label>
          <label>금액<input id="mtCost" inputmode="numeric" placeholder="원"></label>
          <label>교체
            <select id="mtPart">${PARTS.map(part => `<option value="${part.id}" ${part.id === state.part ? 'selected' : ''}>${part.label}</option>`).join('')}</select>
          </label>
        </div>
        <label id="mtCustomWrap" ${state.part === 'other' ? '' : 'hidden'}>직접입력<input id="mtCustom" placeholder="예: 타이어"></label>
        <button type="submit" class="mt-yellow">이 날짜로 저장</button>
      </form>
      <div class="mt-card">${lines || '<p class="mt-empty">아직 정비 기록이 없습니다.</p>'}</div>
    `;
    document.getElementById('mtToggle')?.addEventListener('click', () => {
      const form = document.getElementById('mtForm');
      if (form) form.hidden = !form.hidden;
    });
    document.getElementById('mtBikeBtn')?.addEventListener('click', saveBike);
    document.getElementById('mtForm')?.addEventListener('submit', saveLog);
    document.getElementById('mtPart')?.addEventListener('change', event => {
      state.part = event.target.value;
      const wrap = document.getElementById('mtCustomWrap');
      if (wrap) wrap.hidden = state.part !== 'other';
    });
    const dateInput = document.getElementById('mtDate');
    const dateBtn = document.getElementById('mtDateBtn');
    dateBtn?.addEventListener('click', () => {
      if (!dateInput) return;
      if (typeof dateInput.showPicker === 'function') dateInput.showPicker();
      else dateInput.click();
    });
    dateInput?.addEventListener('change', () => {
      const label = document.getElementById('mtDateLabel');
      if (label) label.textContent = labelDate(dateInput.value);
    });
    panel.querySelectorAll('[data-month]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.openMonth = btn.dataset.month;
        render();
      });
    });
    window.BremDriverPerfCalendar?.render?.();
  }

  async function load() {
    const res = await window.BremStorage?.fetchRiderMaintenanceFromServer?.();
    if (!res?.ok) {
      toast(res?.message || '정비기록을 불러오지 못했습니다.');
      return;
    }
    state.bike = res.bike || null;
    state.logs = res.logs || [];
    render();
  }

  async function saveBike() {
    const model = prompt('오토바이 종류', state.bike?.model || '');
    if (!model) return;
    const cycle = prompt('교체주기 km', state.bike?.cycleKm ? String(state.bike.cycleKm) : '');
    if (!cycle) return;
    const res = await window.BremStorage?.saveRiderMaintenanceBike?.({ model, cycleKm: cycle });
    if (!res?.ok) { toast(res?.message || '저장하지 못했습니다.'); return; }
    state.bike = res.bike || null;
    state.logs = res.logs || state.logs;
    render();
    toast('오토바이를 저장했습니다.');
  }

  async function saveLog(event) {
    event.preventDefault();
    const payload = {
      date: document.getElementById('mtDate')?.value,
      km: document.getElementById('mtKm')?.value,
      cost: document.getElementById('mtCost')?.value,
      part: document.getElementById('mtPart')?.value,
      custom: document.getElementById('mtCustom')?.value
    };
    const res = await window.BremStorage?.saveRiderMaintenanceLog?.(payload);
    if (!res?.ok) { toast(res?.message || '저장하지 못했습니다.'); return; }
    state.bike = res.bike || state.bike;
    state.logs = res.logs || [];
    state.openMonth = String(payload.date || '').slice(0, 7) || state.openMonth;
    render();
    toast('정비일지를 저장했습니다.');
  }

  window.BremDriverMaintenance = {
    open: load,
    daysInMonth,
    render
  };
})();
