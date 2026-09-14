/**
 * 기사앱 실적 탭 · 월별 실적 달력 (Phase 3)
 * - 콜수: BremStorage.calls (클라이언트, 배민+쿠팡 합산) — 즉시 표시
 * - 정산금액: 주차별 출금 API(fetchRiderWithdrawalFromServer)의 settlementAmount 날짜별 합산 → 만원 내림
 *   (읽기 전용. 계산/정산 로직 무변경. 주차 단위 캐싱)
 */
(function () {
  const grid = document.getElementById('perfCalGrid');
  const label = document.getElementById('perfCalLabel');
  const prevBtn = document.getElementById('perfCalPrevBtn');
  const nextBtn = document.getElementById('perfCalNextBtn');
  if (!grid) return;

  const now = new Date();
  const calState = { y: now.getFullYear(), m: now.getMonth() + 1 }; // m: 1~12
  const settlementCache = {}; // weekStart -> { 'YYYY-MM-DD': 정산금액합 }
  let renderToken = 0;

  function pad2(n) { return String(n).padStart(2, '0'); }
  function dateKey(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }
  // 핵심: 정산금액을 무조건 "만원 앞단위"로만 내림 (116,000 → 11)
  function wanFloor(won) { return Math.floor(Math.max(0, Number(won) || 0) / 10000); }

  function currentDriverId() {
    try { return window.BremStorage?.auth?.getDriverSessionId?.() || ''; } catch (e) { return ''; }
  }

  function weekUtils() { return window.BremPayrollSlipUtils || window.BremDatePicker || null; }

  function normWeekStart(key) {
    const u = weekUtils();
    if (u?.normalizeSettlementWeekStart) return u.normalizeSettlementWeekStart(key);
    // 폴백: 정산주는 수요일 시작
    const dt = new Date(`${key}T00:00:00`);
    const diff = (dt.getDay() - 3 + 7) % 7; // Wed=3
    dt.setDate(dt.getDate() - diff);
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  }

  function addDaysKey(key, days) {
    const dt = new Date(`${key}T00:00:00`);
    dt.setDate(dt.getDate() + days);
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  }

  // 월의 일별 콜수(배민+쿠팡 합산)
  function callsForMonth(driverId, y, m) {
    const map = {};
    if (!driverId || !window.BremStorage?.calls?.getAll) return map;
    const prefix = `${y}-${pad2(m)}-`;
    const all = window.BremStorage.calls.getAll();
    for (let i = 0; i < all.length; i += 1) {
      const c = all[i];
      if (c.driverId !== driverId) continue;
      const dk = String(c.date || '').slice(0, 10);
      if (dk.indexOf(prefix) !== 0) continue;
      const day = Number(dk.slice(8, 10));
      map[day] = (map[day] || 0) + (Number(c.count) || 0);
    }
    return map;
  }

  // 월에 걸치는 정산주(수~화) weekStart 목록
  function weekStartsForMonth(y, m) {
    const firstKey = dateKey(y, m, 1);
    const lastDay = new Date(y, m, 0).getDate();
    const lastKey = dateKey(y, m, lastDay);
    let ws = normWeekStart(firstKey);
    const end = normWeekStart(lastKey);
    const list = [];
    let guard = 0;
    while (ws <= end && guard < 8) { list.push(ws); ws = normWeekStart(addDaysKey(ws, 7)); guard += 1; }
    return list;
  }

  async function fetchWeekSettlement(weekStart) {
    if (settlementCache[weekStart]) return settlementCache[weekStart];
    let res = null;
    try { res = await window.BremStorage?.fetchRiderWithdrawalFromServer?.(weekStart); } catch (e) { res = null; }
    const byDate = {};
    if (res?.ok && Array.isArray(res.days)) {
      res.days.forEach(row => {
        const dk = String(row.period || row.date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return;
        byDate[dk] = (byDate[dk] || 0) + Math.max(0, Math.round(Number(row.settlementAmount) || 0));
      });
      settlementCache[weekStart] = byDate; // 성공한 주만 캐시
    }
    return byDate;
  }

  async function settlementForMonth(y, m) {
    const weeks = weekStartsForMonth(y, m);
    const maps = await Promise.all(weeks.map(fetchWeekSettlement));
    const byDay = {};
    const prefix = `${y}-${pad2(m)}-`;
    maps.forEach(byDate => {
      Object.keys(byDate).forEach(dk => {
        if (dk.indexOf(prefix) !== 0) return;
        const day = Number(dk.slice(8, 10));
        byDay[day] = (byDay[day] || 0) + byDate[dk];
      });
    });
    return byDay;
  }

  function paint(callMap, amtMap) {
    const { y, m } = calState;
    if (label) label.textContent = `${y}.${pad2(m)}`;
    const first = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const today = new Date();
    const todayD = (today.getFullYear() === y && today.getMonth() + 1 === m) ? today.getDate() : -1;
    let html = '';
    for (let i = 0; i < first; i += 1) html += '<div class="ds-cal__cell ds-cal__cell--empty"></div>';
    for (let d = 1; d <= daysInMonth; d += 1) {
      const dow = new Date(y, m - 1, d).getDay();
      let cls = 'ds-cal__cell';
      if (dow === 0) cls += ' ds-cal__cell--sun';
      if (dow === 6) cls += ' ds-cal__cell--sat';
      if (d === todayD) cls += ' ds-cal__cell--today';
      let body = `<span class="ds-cal__day">${d}</span>`;
      const call = callMap ? callMap[d] : 0;
      if (call) body += `<span class="ds-cal__call">${call}콜</span>`;
      const amt = amtMap ? amtMap[d] : 0;
      if (amt) body += `<span class="ds-cal__amt">${wanFloor(amt)}<small>만</small></span>`;
      html += `<div class="${cls}">${body}</div>`;
    }
    grid.innerHTML = html;
  }

  function render(withSettlement) {
    const token = ++renderToken;
    const driverId = currentDriverId();
    const callMap = callsForMonth(driverId, calState.y, calState.m);
    paint(callMap, null); // 콜수 먼저 표시
    if (!withSettlement || !driverId) return;
    settlementForMonth(calState.y, calState.m)
      .then(amtMap => { if (token === renderToken) paint(callMap, amtMap); })
      .catch(() => { /* 정산금액 실패 시 콜수만 유지 */ });
  }

  function isFutureMonth(y, m) {
    const t = new Date();
    return y > t.getFullYear() || (y === t.getFullYear() && m >= t.getMonth() + 1);
  }

  prevBtn?.addEventListener('click', () => {
    calState.m -= 1;
    if (calState.m < 1) { calState.m = 12; calState.y -= 1; }
    render(true);
  });
  nextBtn?.addEventListener('click', () => {
    if (isFutureMonth(calState.y, calState.m)) return; // 이번 달 이후로는 이동 금지
    calState.m += 1;
    if (calState.m > 12) { calState.m = 1; calState.y += 1; }
    render(true);
  });

  // 실적 탭이 열릴 때 정산금액까지 로드
  document.addEventListener('click', event => {
    const btn = event.target?.closest?.('[data-driver-tab="perf"]');
    if (btn) setTimeout(() => render(true), 0);
  });

  // 최초: 콜수만 즉시 그리고, 이미 화면에 보이면(PC 인라인) 정산금액까지 로드
  let tries = 0;
  (function tryInit() {
    if (currentDriverId() && window.BremStorage?.calls?.getAll) {
      render(grid.offsetParent !== null);
      return;
    }
    if (tries < 20) { tries += 1; setTimeout(tryInit, 400); }
  })();

  window.BremDriverPerfCalendar = { render: () => render(true) };
})();
