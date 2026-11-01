(function () {
  const state = {
    search: '',
    filter: 'assigned',
    live: null,
    timer: null,
    loading: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(value) {
    return `${Math.round(Number(value) || 0).toLocaleString('ko-KR')}원`;
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function isWorkingDriver(driver) {
    if (window.BremDriverUtils?.isRiderAppAccessBlocked?.(driver)) return false;
    const status = String(driver?.status || driver?.raw_data?.status || '').trim();
    return !status || status === '근무중';
  }

  function baeminIdVariants(value) {
    const raw = String(value || '').trim();
    if (!raw) return [];
    const digits = raw.replace(/\D/g, '');
    const stripped = digits.replace(/^0+/, '') || digits;
    return [...new Set([raw, digits, stripped].filter(Boolean))];
  }

  function lookupNumber(map, keys) {
    if (!map) return null;
    for (const key of keys) {
      if (key && Object.prototype.hasOwnProperty.call(map, key)) return Number(map[key]) || 0;
    }
    return null;
  }

  function callCounts(driver, live) {
    const baeminKeys = baeminIdVariants(driver.baeminId || driver.raw_data?.baeminId);
    const baemin = lookupNumber(live?.baeminByDriverId, [String(driver.id || '')])
      ?? lookupNumber(live?.baeminByUserId, baeminKeys)
      ?? 0;
    const coupangKeys = [];
    const login = window.BremDriverUtils?.makeDriverLoginId?.(driver);
    if (login) coupangKeys.push(String(login).replace(/\s+/g, ''));
    const stored = driver.coupangId || driver.raw_data?.coupangLoginKey || driver.raw_data?.coupangId;
    if (stored) coupangKeys.push(String(stored).replace(/\s+/g, ''));
    const coupang = lookupNumber(live?.coupangByMatchKey, coupangKeys) ?? 0;
    return {
      baemin: Math.max(0, Math.round(baemin)),
      coupang: Math.max(0, Math.round(coupang))
    };
  }

  function missionOf(id) {
    return window.BremMissionPromotionCatalog?.getById?.(id) || null;
  }

  function quoteOne(mission, calls) {
    const simApi = window.BremPromotionCountSim;
    const config = simApi?.extract?.(mission?.promotionRule || mission);
    if (!config || !simApi) {
      return { amount: 0, countable: false, started: false, remain: 0, title: mission?.title || '미션' };
    }
    const sim = simApi.simulate(config, calls);
    return {
      amount: sim.started ? sim.amount : 0,
      countable: true,
      started: sim.started,
      remain: sim.remainToStart || 0,
      title: mission?.title || '미션',
      calls: sim.calls
    };
  }

  function quoteDriver(driver, live) {
    const assignment = window.BremMissionPromotionCatalog?.getDriverAssignment?.(driver)
      || { baemin: '', coupang: '', combined: '' };
    const calls = callCounts(driver, live);
    const lines = [];
    if (assignment.combined) {
      const mission = missionOf(assignment.combined);
      if (mission) lines.push({ ...quoteOne(mission, calls.baemin + calls.coupang), platform: '합산' });
    } else {
      if (assignment.baemin && driver.platformBaemin) {
        const mission = missionOf(assignment.baemin);
        if (mission) lines.push({ ...quoteOne(mission, calls.baemin), platform: '배민' });
      }
      if (assignment.coupang && driver.platformCoupang !== false) {
        const mission = missionOf(assignment.coupang);
        if (mission) lines.push({ ...quoteOne(mission, calls.coupang), platform: '쿠팡' });
      }
    }
    const amount = lines.reduce((sum, line) => sum + (line.countable ? line.amount : 0), 0);
    return { driver, calls, lines, amount, assigned: lines.length > 0 };
  }

  function amountForCalls(driver, baeminCalls, coupangCalls) {
    const assignment = window.BremMissionPromotionCatalog?.getDriverAssignment?.(driver)
      || { baemin: '', coupang: '', combined: '' };
    let amount = 0;
    if (assignment.combined) {
      const quote = quoteOne(missionOf(assignment.combined), baeminCalls + coupangCalls);
      if (quote.countable) amount += quote.amount;
    } else {
      if (assignment.baemin && driver.platformBaemin) {
        const quote = quoteOne(missionOf(assignment.baemin), baeminCalls);
        if (quote.countable) amount += quote.amount;
      }
      if (assignment.coupang && driver.platformCoupang !== false) {
        const quote = quoteOne(missionOf(assignment.coupang), coupangCalls);
        if (quote.countable) amount += quote.amount;
      }
    }
    return amount;
  }

  function coupangKeys(driver) {
    const keys = [];
    const login = window.BremDriverUtils?.makeDriverLoginId?.(driver);
    if (login) keys.push(String(login).replace(/\s+/g, ''));
    const stored = driver.coupangId || driver.raw_data?.coupangLoginKey || driver.raw_data?.coupangId;
    if (stored) keys.push(String(stored).replace(/\s+/g, ''));
    return keys;
  }

  function dailyBag(map, keys) {
    if (!map) return {};
    for (const key of keys) {
      if (key && map[key]) return map[key];
    }
    return {};
  }

  function addDays(dateKey, days) {
    const date = new Date(`${dateKey}T00:00:00`);
    date.setDate(date.getDate() + days);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function weekTitle(offset) {
    if (offset === 0) return '이번주';
    if (offset === -1) return '저번주';
    return '2주 전';
  }

  function weekDays(start) {
    const days = [];
    for (let offset = 0; offset < 7; offset += 1) days.push(addDays(start, offset));
    return days;
  }

  function callsThrough(row, live, days, throughDay, isCurrent) {
    const today = String(live?.today || '');
    const baeminBag = dailyBag(live?.baeminDailyByUserId, baeminIdVariants(row.driver.baeminId || row.driver.raw_data?.baeminId));
    const coupangBag = dailyBag(live?.coupangDailyByMatchKey, coupangKeys(row.driver));
    let baemin = 0;
    let coupang = 0;
    days.forEach(day => {
      if (day > throughDay) return;
      baemin += Number(baeminBag[day] || 0);
      coupang += Number(coupangBag[day] || 0);
    });
    if (isCurrent && today && throughDay >= today) {
      baemin = Math.max(baemin, row.calls.baemin);
      coupang = Math.max(coupang, row.calls.coupang);
    }
    return { baemin, coupang };
  }

  function seriesForWeek(rows, live, week) {
    const days = weekDays(week.start);
    const today = String(live?.today || '');
    const isCurrent = week.offset === 0;
    const cap = isCurrent ? today : week.end;
    return days.map(day => {
      if (cap && day > cap) return { day, amount: null, delta: null };
      const amount = rows.reduce((sum, row) => {
        const calls = callsThrough(row, live, days, day, isCurrent);
        return sum + amountForCalls(row.driver, calls.baemin, calls.coupang);
      }, 0);
      return { day, amount, delta: null };
    }).map((point, index, list) => {
      if (point.amount == null) return point;
      const prev = index > 0 ? list[index - 1].amount : 0;
      return { ...point, delta: point.amount - (prev || 0) };
    });
  }

  function dayLabel(dateKey) {
    const names = ['일', '월', '화', '수', '목', '금', '토'];
    const date = new Date(`${dateKey}T00:00:00`);
    const name = Number.isNaN(date.getTime()) ? '' : names[date.getDay()];
    return `${name} ${dateKey.slice(5).replace('-', '/')}`;
  }

  function chartSvg(points, scaleMax) {
    const width = 240;
    const height = 132;
    const left = 8;
    const right = 8;
    const top = 12;
    const bottom = 22;
    const max = Math.max(1, scaleMax);
    const slot = (width - left - right) / Math.max(points.length - 1, 1);
    const yOf = amount => top + (height - top - bottom) * (1 - amount / max);
    const coords = points.map((point, index) => ({
      ...point,
      x: left + slot * index,
      y: point.amount == null ? null : yOf(point.amount)
    }));
    const line = coords.filter(point => point.y != null);
    const linePath = line.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    const area = line.length
      ? `${linePath} L${line[line.length - 1].x.toFixed(1)},${height - bottom} L${line[0].x.toFixed(1)},${height - bottom} Z`
      : '';
    return `
      <svg viewBox="0 0 ${width} ${height}" role="img">
        <line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" stroke="#3a3a3a"></line>
        <path d="${area}" fill="rgba(245,197,24,0.16)"></path>
        <path d="${linePath}" fill="none" stroke="#f5c518" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"></path>
        ${coords.map(point => {
          const label = dayLabel(point.day).split(' ')[0];
          const dot = point.y == null
            ? ''
            : `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3" fill="#f5c518"><title>${dayLabel(point.day)} ${money(point.amount)} · 전일 대비 +${money(point.delta || 0)}</title></circle>`;
          return `${dot}<text x="${point.x.toFixed(1)}" y="${height - 6}" text-anchor="middle" class="mission-forecast-chart__axis">${label}</text>`;
        }).join('')}
      </svg>`;
  }

  function renderChart(rows, live) {
    const host = $('missionForecastChart');
    if (!host) return;
    const weeks = Array.isArray(live?.weeks) && live.weeks.length
      ? live.weeks
      : (live?.weekStart ? [{ start: live.weekStart, end: addDays(live.weekStart, 6), offset: 0 }] : []);
    if (!live || !weeks.length) {
      host.innerHTML = '<p class="hint">그래프는 이번 주 콜수를 받은 뒤 표시됩니다.</p>';
      return;
    }
    const series = weeks.map(week => ({ week, points: seriesForWeek(rows, live, week) }));
    const scaleMax = Math.max(1, ...series.flatMap(item => item.points.map(point => point.amount || 0)));
    const current = series.find(item => item.week.offset === 0);
    const previous = series.find(item => item.week.offset === -1);
    const currentTotal = [...(current?.points || [])].reverse().find(point => point.amount != null)?.amount || 0;
    const previousTotal = [...(previous?.points || [])].reverse().find(point => point.amount != null)?.amount || 0;
    const gap = currentTotal - previousTotal;
    host.innerHTML = `
      <p class="mission-forecast-chart__rise">최근 3주 비교 · 이번주 <strong>${compactMoney(currentTotal)}</strong> · 저번주보다 <strong>${gap >= 0 ? '+' : ''}${compactMoney(gap)}</strong></p>
      <div class="mission-forecast-weeks">
        ${series.map(item => {
          const total = [...item.points].reverse().find(point => point.amount != null)?.amount || 0;
          const range = `${item.week.start.slice(5).replace('-', '/')}~${item.week.end.slice(5).replace('-', '/')}`;
          return `
            <article class="mission-forecast-week${item.week.offset === 0 ? ' is-current' : ''}">
              <p class="mission-forecast-week__title">${weekTitle(item.week.offset)} <strong>${compactMoney(total)}</strong></p>
              <p class="mission-forecast-week__range">${range}</p>
              ${chartSvg(item.points, scaleMax)}
            </article>`;
        }).join('')}
      </div>
      <p class="hint">세 그래프 높이는 같습니다. 지금 배정된 개인미션으로 그 주 콜수를 계산한 예상금액입니다.</p>`;
  }

  function compactMoney(value) {
    const amount = Math.round(Number(value) || 0);
    if (Math.abs(amount) >= 100000000) return `${(amount / 100000000).toFixed(1)}억`;
    if (Math.abs(amount) >= 10000) return `${Math.round(amount / 10000).toLocaleString('ko-KR')}만`;
    return amount.toLocaleString('ko-KR');
  }

  async function loadLive() {
    const token = await window.BremStorage?.resolveAdminAccessToken?.();
    if (!token) throw new Error('관리자 로그인 세션이 없습니다.');
    const response = await fetch('/api/admin/mission-forecast', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || '실시간 콜수를 불러오지 못했습니다.');
    }
    state.live = payload;
    return payload;
  }

  function render() {
    const body = $('missionForecastRows');
    const summary = $('missionForecastSummary');
    const stamp = $('missionForecastStamp');
    if (!body) return;
    const title = $('pageTitle');
    if (title && document.getElementById('mission-forecast')?.classList.contains('active')) {
      title.textContent = '예상미션금액';
    }
    const live = state.live;
    const query = state.search.trim().toLowerCase();
    const rows = (window.BremStorage?.drivers?.getAll?.() || [])
      .filter(isWorkingDriver)
      .map(driver => quoteDriver(driver, live))
      .filter(row => {
        if (state.filter === 'assigned' && !row.assigned) return false;
        if (state.filter === 'paying' && row.amount <= 0) return false;
        if (!query) return true;
        const name = String(row.driver.name || '').toLowerCase();
        const phone = String(row.driver.phone || '').replace(/\D/g, '');
        return name.includes(query) || phone.includes(query.replace(/\D/g, ''));
      })
      .sort((a, b) => b.amount - a.amount || String(a.driver.name || '').localeCompare(String(b.driver.name || ''), 'ko'));

    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    const paying = rows.filter(row => row.amount > 0).length;
    const waiting = rows.filter(row => row.assigned && row.lines.some(line => line.countable && !line.started)).length;
    if (summary) {
      summary.textContent = live
        ? `이번 주 현재 예상 합계 ${money(total)} · 금액 있는 기사 ${paying}명 · 시작 전 ${waiting}명 · 표시 ${rows.length}명`
        : '실시간 콜수를 불러오는 중입니다.';
    }
    if (stamp) {
      const when = String(live?.fetchedAt || '').replace('T', ' ').slice(0, 19);
      stamp.textContent = live
        ? `정산주 ${live.weekStart} ~ ${live.today} · 갱신 ${when} · 기사앱과 같은 이번 주 완료콜 · 거절율·미지급 조건은 빼고 건당만 계산`
        : '';
    }
    renderChart(rows, live);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty">표시할 기사가 없습니다.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(row => {
      const missionText = row.lines.length
        ? row.lines.map(line => {
          const detail = !line.countable
            ? '건당 예상 없음'
            : (line.started ? money(line.amount) : `0원 · ${line.remain}콜 남음`);
          return `${line.platform} ${escapeHtml(line.title)} · ${detail}`;
        }).join('<br>')
        : '미배정';
      return `
        <tr>
          <td>${escapeHtml(row.driver.name || '-')}</td>
          <td>${row.calls.baemin.toLocaleString('ko-KR')}</td>
          <td>${row.calls.coupang.toLocaleString('ko-KR')}</td>
          <td>${missionText}</td>
          <td><strong>${money(row.amount)}</strong></td>
        </tr>`;
    }).join('');
  }

  async function refresh() {
    if (state.loading) return;
    state.loading = true;
    const button = $('missionForecastRefreshBtn');
    if (button) button.disabled = true;
    if (!state.live) render();
    try {
      await Promise.all([
        window.BremStorage?.ensureSectionLoaded?.('mission-forecast'),
        loadLive()
      ]);
      render();
    } catch (error) {
      showToast(error.message || '예상미션금액을 불러오지 못했습니다.');
      render();
    } finally {
      state.loading = false;
      if (button) button.disabled = false;
    }
  }

  function ensureTimer() {
    if (state.timer) return;
    state.timer = window.setInterval(() => {
      const section = document.getElementById('mission-forecast');
      if (!section || !section.classList.contains('active')) return;
      void refresh();
    }, 60000);
  }

  function bind() {
    const search = $('missionForecastSearch');
    const filter = $('missionForecastFilter');
    const button = $('missionForecastRefreshBtn');
    if (search && search.dataset.bound !== '1') {
      search.dataset.bound = '1';
      search.addEventListener('input', () => {
        state.search = search.value || '';
        render();
      });
    }
    if (filter && filter.dataset.bound !== '1') {
      filter.dataset.bound = '1';
      filter.addEventListener('change', () => {
        state.filter = filter.value || 'assigned';
        render();
      });
    }
    if (button && button.dataset.bound !== '1') {
      button.dataset.bound = '1';
      button.addEventListener('click', () => { void refresh(); });
    }
    ensureTimer();
    if (document.documentElement.dataset.missionForecastBound !== '1') {
      document.documentElement.dataset.missionForecastBound = '1';
      document.addEventListener('brem-drivers-sync-ready', () => {
        const section = document.getElementById('mission-forecast');
        if (!section || !section.classList.contains('active') || !state.live) return;
        render();
      });
    }
  }

  window.BremAdminMissionForecast = {
    refresh() {
      bind();
      return refresh();
    }
  };
})();
