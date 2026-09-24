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
  const now0 = new Date();
  let state = { bike: null, logs: [], part: 'oil', calY: now0.getFullYear(), calM: now0.getMonth() + 1 };

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

  function logsOnDay(y, m, d) {
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return (state.logs || []).filter(row => row.date === key);
  }

  function calendarHtml() {
    const y = state.calY;
    const m = state.calM;
    const first = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
    let cells = DOW.map(name => `<div class="mt-cal__h">${name}</div>`).join('');
    for (let i = 0; i < first; i += 1) cells += '<div class="mt-cal__cell mt-cal__cell--empty"></div>';
    for (let d = 1; d <= days; d += 1) {
      const rows = logsOnDay(y, m, d);
      if (!rows.length) {
        cells += `<div class="mt-cal__cell"><span class="mt-cal__d">${d}</span></div>`;
        continue;
      }
      const label = rows.map(row => row.partLabel).filter(Boolean).join('·');
      const cost = rows.reduce((sum, row) => sum + Number(row.cost || 0), 0);
      const km = rows[rows.length - 1].km;
      cells += `<div class="mt-cal__cell mt-cal__cell--on"><span class="mt-cal__d">${d}</span><b>${label}</b><span>${won(km)}km</span><strong>${won(cost)}</strong></div>`;
    }
    return cells;
  }

  function render() {
    const bike = state.bike;
    const logs = state.logs || [];
    const monthKey = `${state.calY}-${String(state.calM).padStart(2, '0')}`;
    const monthLogs = logs.filter(row => String(row.date).startsWith(monthKey));
    const monthSum = monthLogs.reduce((sum, row) => sum + Number(row.cost || 0), 0);
    const bikeText = bike
      ? `<b>${bike.model}</b><span>오일교체주기 ${won(bike.cycleKm)}km</span>`
      : '<b>등록된 오토바이 없음</b><span>오일교체주기를 함께 등록하세요</span>';

    panel.innerHTML = `
      <div class="mt-head"><h2>정비기록</h2></div>
      <div class="mt-card mt-sum"><div><span>${state.calM}월 정비 사용금액</span><strong>${won(monthSum)}<i>원</i></strong></div><em>${monthLogs.length}건</em></div>
      <div class="mt-card mt-bike">
        <div class="mt-bike__info">${bikeText}</div>
        <button type="button" class="mt-yellow mt-yellow--block" id="mtBikeBtn">오토바이 등록</button>
      </div>
      <form class="mt-card" id="mtForm">
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
        <button type="submit" class="mt-yellow mt-yellow--block">이 날짜로 저장</button>
      </form>
      <div class="mt-card">
        <div class="mt-cal__nav">
          <button type="button" id="mtCalPrev" aria-label="이전달">‹</button>
          <strong>${state.calY}.${String(state.calM).padStart(2, '0')}</strong>
          <button type="button" id="mtCalNext" aria-label="다음달">›</button>
        </div>
        <div class="mt-cal">${calendarHtml()}</div>
      </div>
      <div class="mt-pop" id="mtBikePop" hidden>
        <button type="button" class="mt-pop__bg" data-close-bike aria-label="닫기"></button>
        <form class="mt-pop__box" id="mtBikeForm">
          <h3>오토바이 등록</h3>
          <label>오토바이<input id="mtBikeModel" value="${bike ? bike.model : ''}" placeholder="예: PCX 125" required></label>
          <label>오일교체주기<input id="mtBikeCycle" inputmode="numeric" value="${bike ? bike.cycleKm : ''}" placeholder="km" required></label>
          <button type="submit" class="mt-yellow mt-yellow--block">저장</button>
          <button type="button" class="mt-ghost" data-close-bike>닫기</button>
        </form>
      </div>
    `;
    document.getElementById('mtBikeBtn')?.addEventListener('click', () => {
      const pop = document.getElementById('mtBikePop');
      if (pop) pop.hidden = false;
    });
    panel.querySelectorAll('[data-close-bike]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pop = document.getElementById('mtBikePop');
        if (pop) pop.hidden = true;
      });
    });
    document.getElementById('mtBikeForm')?.addEventListener('submit', saveBike);
    document.getElementById('mtCalPrev')?.addEventListener('click', () => {
      state.calM -= 1;
      if (state.calM < 1) { state.calM = 12; state.calY -= 1; }
      render();
    });
    document.getElementById('mtCalNext')?.addEventListener('click', () => {
      state.calM += 1;
      if (state.calM > 12) { state.calM = 1; state.calY += 1; }
      render();
    });
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

  async function saveBike(event) {
    event.preventDefault();
    const model = document.getElementById('mtBikeModel')?.value;
    const cycle = document.getElementById('mtBikeCycle')?.value;
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
    const savedDate = String(payload.date || '');
    if (/^\d{4}-\d{2}/.test(savedDate)) {
      state.calY = Number(savedDate.slice(0, 4));
      state.calM = Number(savedDate.slice(5, 7));
    }
    render();
    toast('정비일지를 저장했습니다.');
  }

  window.BremDriverMaintenance = {
    open: load,
    daysInMonth,
    render
  };
})();
