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
    try {
      await window.BremStorage?.ensureSectionLoaded?.('mission-forecast');
      await loadLive();
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
  }

  window.BremAdminMissionForecast = {
    refresh() {
      bind();
      return refresh();
    }
  };
})();
