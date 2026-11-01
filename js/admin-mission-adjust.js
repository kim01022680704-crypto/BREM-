(function () {
  const STARTS = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];
  const RATES = [1000, 1100, 1200, 1300, 1400, 1500];

  const state = {
    week: '',
    snap: null,
    loading: false,
    open: {}
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

  function compactMoney(value) {
    const amount = Math.round(Number(value) || 0);
    const sign = amount < 0 ? '-' : '';
    const abs = Math.abs(amount);
    if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(1)}억`;
    if (abs >= 10000) return `${sign}${Math.round(abs / 10000).toLocaleString('ko-KR')}만`;
    return `${sign}${abs.toLocaleString('ko-KR')}`;
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function missionAmount(calls, start, rate) {
    const count = Math.round(Number(calls) || 0);
    if (count < start) return 0;
    return (count - start + 1) * rate;
  }

  function lineCost(line, start, rate) {
    return (line.riders || []).reduce((sum, rider) => sum + missionAmount(rider.calls, start, rate), 0);
  }

  function missionNet(cost) {
    const loss = Math.max(0, Math.round(Number(cost) || 0));
    const taxProfit = Math.floor(loss * 0.033);
    return { loss, taxProfit, net: loss - taxProfit };
  }

  function cellState(line, cost) {
    if (line.base <= 0) return 'empty';
    if (missionNet(cost).net > line.pureRemain) return 'over';
    return 'ok';
  }

  function labelOf(start, rate, status) {
    const text = `${start}건 ${rate.toLocaleString('ko-KR')}원`;
    if (status === 'over') return `${text} 적자`;
    if (status === 'ok') return `${text} 가능`;
    return `${text} 기준 없음`;
  }

  function fact(label, value) {
    return `<span><em>${escapeHtml(label)}</em> ${value}</span>`;
  }

  function renderLine(line) {
    const cells = STARTS.map(start => RATES.map(rate => {
      const cost = lineCost(line, start, rate);
      return { start, rate, cost, status: cellState(line, cost) };
    }));
    const flat = cells.flat();
    const overCount = flat.filter(cell => cell.status === 'over').length;
    const okCount = flat.filter(cell => cell.status === 'ok').length;
    const corners = [
      [50, 1000],
      [50, 1500],
      [150, 1000],
      [150, 1500]
    ].map(([start, rate]) => {
      const cost = lineCost(line, start, rate);
      return labelOf(start, rate, cellState(line, cost));
    });
    const best = flat.filter(cell => cell.status === 'ok')
      .sort((a, b) => b.rate - a.rate || a.start - b.start)[0];
    const verdict = line.base <= 0
      ? '실지급액에서 부가세 20%를 뺀 기준이 없습니다.'
      : (line.pureRemain < 0
        ? `프로모션을 되돌린 뒤에도 이미 ${compactMoney(Math.abs(line.pureRemain))} 부족합니다. 이 범위는 전부 적자입니다.`
        : `프로모션 없을 때 남은 돈 ${compactMoney(line.pureRemain)} · 가능 ${okCount}칸 · 적자 ${overCount}칸${best ? ` · 가장 높은 가능 단가 ${best.start}건 ${best.rate.toLocaleString('ko-KR')}원` : ''}`);
    const opened = line.kind === 'group' && state.open[line.title];
    const toggle = line.kind === 'group'
      ? `<button type="button" class="small-btn" data-adjust-toggle="${escapeHtml(line.title)}">${opened ? '접기' : '펼치기'}</button>`
      : '';
    const members = opened
      ? `<div class="mission-adjust-members">${(line.memberLines || []).map(member => renderLine(member)).join('')}</div>`
      : '';
    return `
      <article class="mission-adjust-card${line.kind === 'group' ? ' is-group' : ''}">
        <header>
          <div>
            <h3>${escapeHtml(line.title)} ${toggle}</h3>
            <p class="hint">${line.kind === 'group' ? '묶음' : '지역'} · 기사 ${line.riderCount}명 · ${corners.join(' · ')}</p>
          </div>
        </header>
        <p class="mission-adjust-facts">
          ${fact('실지급액', money(line.supplyPaid))}
          ${fact('부가세', money(line.vat))}
          ${fact(`부가세 ${line.taxFeePercent || 20}%`, money(line.taxFee))}
          ${fact('최종입금', money(line.finalDeposit))}
          ${fact('선정산', money(line.prepaid))}
          ${fact('BREM프로모션', money(line.bremPromo))}
          ${fact('BREM프로모션원천세', money(line.bremPromoTax))}
          ${fact('프로모션 없을 때 남은 돈', compactMoney(line.pureRemain))}
        </p>
        <p class="hint">${verdict} 칸 금액은 미션 손해에서 3.3% 이익을 뺀 순손해입니다.</p>
        <div class="table-wrap">
          <table class="mission-adjust-table">
            <thead>
              <tr>
                <th>시작 건수</th>
                ${RATES.map(rate => `<th>건당 ${rate.toLocaleString('ko-KR')}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${cells.map(row => `
                <tr>
                  <th>${row[0].start}건</th>
                  ${row.map(cell => {
                    const net = missionNet(cell.cost);
                    const word = cell.status === 'over' ? '적자' : (cell.status === 'ok' ? '가능' : '-');
                    const title = `${labelOf(cell.start, cell.rate, cell.status)} · 미션 손해 ${money(net.loss)} · 원천세 이익 ${money(net.taxProfit)} · 순손해 ${money(net.net)}`;
                    return `<td class="is-${cell.status}" title="${escapeHtml(title)}">${word}<br><span>${compactMoney(net.net)}</span></td>`;
                  }).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${members}
      </article>`;
  }

  function render() {
    const title = $('pageTitle');
    if (title && document.getElementById('mission-adjust')?.classList.contains('active')) {
      title.textContent = '미션조정';
    }
    const host = $('missionAdjustBody');
    const stamp = $('missionAdjustStamp');
    if (!host) return;
    const snap = state.snap;
    if (!snap) {
      host.innerHTML = '<p class="hint">지역별 정산을 불러오는 중입니다.</p>';
      if (stamp) stamp.textContent = '';
      return;
    }
    if (stamp) {
      stamp.textContent = snap.weekStart
        ? `정산주 ${snap.weekStart} ~ ${snap.weekEnd} · 지역 ${snap.lines.length}곳`
        : '';
    }
    const weekInput = $('missionAdjustWeek');
    if (weekInput && snap.weekStart && document.activeElement !== weekInput) {
      weekInput.value = snap.weekStart;
      state.week = snap.weekStart;
    }
    if (!snap.lines.length) {
      host.innerHTML = '<p class="hint">이 주 지역별 정산이 없습니다. 수익관리의 지역별 정산에 실지급액이 있는 주를 고르세요.</p>';
      return;
    }
    host.innerHTML = snap.lines.map(renderLine).join('');
  }

  async function refresh() {
    if (state.loading) return;
    state.loading = true;
    const button = $('missionAdjustRefreshBtn');
    if (button) button.disabled = true;
    render();
    try {
      await Promise.all([
        window.BremStorage?.ensureSectionLoaded?.('revenue-region-settlement'),
        window.BremStorage?.ensureSectionLoaded?.('final-deposit'),
        window.BremStorage?.ensureSectionLoaded?.('tax-invoice-weekly')
      ]);
      const api = window.BremRevenueRegionSettlement;
      if (!api?.loadMissionAdjust) throw new Error('지역별 정산 데이터를 열 수 없습니다.');
      state.snap = await api.loadMissionAdjust(state.week || '');
      render();
    } catch (error) {
      showToast(error.message || '미션조정을 불러오지 못했습니다.');
    } finally {
      state.loading = false;
      if (button) button.disabled = false;
    }
  }

  function bind() {
    const button = $('missionAdjustRefreshBtn');
    const week = $('missionAdjustWeek');
    if (button && button.dataset.bound !== '1') {
      button.dataset.bound = '1';
      button.addEventListener('click', () => { void refresh(); });
    }
    if (week && week.dataset.bound !== '1') {
      week.dataset.bound = '1';
      week.addEventListener('change', () => {
        state.week = week.value || '';
        void refresh();
      });
    }
    if (document.documentElement.dataset.missionAdjustToggle !== '1') {
      document.documentElement.dataset.missionAdjustToggle = '1';
      document.addEventListener('click', event => {
        const toggle = event.target.closest('[data-adjust-toggle]');
        if (!toggle) return;
        const key = toggle.getAttribute('data-adjust-toggle') || '';
        state.open[key] = !state.open[key];
        render();
      });
    }
  }

  bind();
  window.BremAdminMissionAdjust = { refresh };
})();
