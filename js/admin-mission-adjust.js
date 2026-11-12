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

  function cellQuote(line, start, rate) {
    const net = missionNet(lineCost(line, start, rate));
    const left = Math.round(Number(line.pureRemain) || 0) - net.net;
    const status = line.base <= 0 ? 'empty' : (left < 0 ? 'over' : 'ok');
    return { start, rate, loss: net.loss, taxProfit: net.taxProfit, net: net.net, left, status };
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
    const cells = STARTS.map(start => RATES.map(rate => cellQuote(line, start, rate)));
    const flat = cells.flat();
    const overCount = flat.filter(cell => cell.status === 'over').length;
    const okCount = flat.filter(cell => cell.status === 'ok').length;
    const corners = [
      [50, 1000],
      [50, 1500],
      [150, 1000],
      [150, 1500]
    ].map(([start, rate]) => labelOf(start, rate, cellQuote(line, start, rate).status));
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
    const kindLabel = line.kind === 'group' ? '묶음 합산미션' : '지역 따로';
    return `
      <article class="mission-adjust-card${line.kind === 'group' ? ' is-group' : ''}">
        <header>
          <div>
            <h3>${escapeHtml(line.title)} ${toggle}</h3>
            <p class="hint">${kindLabel} · 기사 ${line.riderCount}명 · ${corners.join(' · ')}</p>
          </div>
        </header>
        <p class="mission-adjust-facts">
          ${fact('실지급액', money(line.supplyPaid))}
          ${fact('부가세', money(line.vat))}
          ${fact(`부가세 ${line.taxFeePercent || 20}%`, money(line.taxFee))}
          ${fact('최종입금', money(line.finalDeposit))}
          ${fact('BREM프로모션', money(line.bremPromo))}
          ${fact('BREM프로모션 3.3%', money(line.bremPromoTax))}
          ${fact('프로모션 뺀 최종입금', money(line.depositWithoutPromo))}
          ${fact('선정산', money(line.prepaid))}
          ${fact('프로모션 없을 때 남은 돈', compactMoney(line.pureRemain))}
        </p>
        <p class="hint">${verdict} 칸의 남는 돈은 이 미션 순손해를 뺀 금액입니다.</p>
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
                    const word = cell.status === 'over' ? '적자' : (cell.status === 'ok' ? '가능' : '-');
                    const leftLabel = `남음 ${compactMoney(cell.left)}`;
                    const title = `${labelOf(cell.start, cell.rate, cell.status)} · 미션 ${money(cell.net)} · ${leftLabel}`;
                    return `<td class="is-${cell.status}" title="${escapeHtml(title)}">${word}<br><span>미션 ${compactMoney(cell.net)}</span><br><span>${leftLabel}</span></td>`;
                  }).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${members}
      </article>`;
  }

  // ── PDF / 인쇄 ─────────────────────────────────────────────
  // 화면과 같은 STARTS×RATES 표를 인쇄 전용 깨끗한 문서로 만들어 새 창에서 print() 한다.
  // 브라우저 인쇄 대화상자에서 "PDF로 저장"을 고르면 표 PDF가 나온다.
  const PRINT_LEGEND = `<p class="legend">
    <span><i class="sw sw-ok"></i>가능</span>
    <span><i class="sw sw-over"></i>적자</span>
    <span><i class="sw sw-empty"></i>기준 없음</span>
  </p>`;

  function printLineHtml(line, isMember, stamp) {
    const cells = STARTS.map(start => RATES.map(rate => cellQuote(line, start, rate)));
    const factsHtml = [
      ['실지급액', money(line.supplyPaid)],
      ['부가세', money(line.vat)],
      [`부가세 ${line.taxFeePercent || 20}%`, money(line.taxFee)],
      ['최종입금', money(line.finalDeposit)],
      ['BREM프로모션', money(line.bremPromo)],
      ['프로모션 뺀 최종입금', money(line.depositWithoutPromo)],
      ['선정산', money(line.prepaid)],
      ['프로모션 없을 때 남은 돈', money(line.pureRemain)]
    ].map(([label, value]) => `<span><b>${escapeHtml(label)}</b> ${escapeHtml(value)}</span>`).join('');
    const kindLabel = line.kind === 'group' ? '묶음 합산미션' : (isMember ? '묶음 소속 지역' : '지역 따로');
    const body = cells.map(row => `
      <tr>
        <th>${row[0].start}건</th>
        ${row.map(cell => {
          const word = cell.status === 'over' ? '적자' : (cell.status === 'ok' ? '가능' : '-');
          return `<td class="c-${cell.status}"><b>${word}</b><br>미션 ${compactMoney(cell.net)}<br>남음 ${compactMoney(cell.left)}</td>`;
        }).join('')}
      </tr>`).join('');
    const self = `
      <section class="blk${isMember ? ' member' : ''}${line.kind === 'group' ? ' group' : ''}">
        <div class="blk-head">
          <h2>${escapeHtml(line.title)} <small>${kindLabel} · 기사 ${line.riderCount}명</small></h2>
          <span class="blk-stamp">${escapeHtml(stamp)}</span>
        </div>
        <div class="facts">${factsHtml}</div>
        ${PRINT_LEGEND}
        <table>
          <thead>
            <tr><th>시작 건수</th>${RATES.map(rate => `<th>건당 ${rate.toLocaleString('ko-KR')}</th>`).join('')}</tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </section>`;
    const members = line.kind === 'group'
      ? (line.memberLines || []).map(member => printLineHtml(member, true, stamp)).join('')
      : '';
    return self + members;
  }

  function buildPrintDoc(snap) {
    const stamp = snap.weekStart ? `정산주 ${snap.weekStart} ~ ${snap.weekEnd}` : '';
    const blocks = snap.lines.map(line => printLineHtml(line, false, stamp)).join('');
    return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>미션조정 ${stamp}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Malgun Gothic", "맑은 고딕", sans-serif; color: #111; margin: 0; padding: 16px; font-size: 11px; }
  /* 지역별로 한 페이지씩 인쇄 */
  .blk { page-break-inside: avoid; break-inside: avoid; page-break-after: always; break-after: page; margin: 0; border: 1px solid #d0d0d0; border-radius: 6px; padding: 12px 14px; }
  .blk:last-child { page-break-after: auto; break-after: auto; }
  .blk.group { border-color: #4b5563; border-width: 1.5px; }
  .blk.member { border-style: dashed; background: #fafafa; }
  .blk-head { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 6px; }
  .blk h2 { font-size: 15px; margin: 0; }
  .blk h2 small { font-weight: normal; color: #666; font-size: 12px; }
  .blk-stamp { color: #555; font-size: 12px; }
  .facts { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0 0 6px; color: #333; font-size: 12px; }
  .facts b { color: #000; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #c8c8c8; padding: 5px 4px; text-align: center; line-height: 1.3; }
  thead th { background: #f1f1f1; font-size: 11px; }
  tbody th { background: #f6f6f6; white-space: nowrap; }
  td.c-ok { background: #e8f5e9; }
  td.c-over { background: #fdecea; }
  td.c-over b { color: #c0392b; }
  td.c-empty { background: #f3f4f6; color: #999; }
  td b { font-size: 12px; }
  .legend { margin: 0 0 8px; color: #555; font-size: 11px; }
  .legend span { display: inline-block; margin-right: 14px; }
  .sw { display: inline-block; width: 11px; height: 11px; border: 1px solid #c8c8c8; vertical-align: -1px; margin-right: 4px; }
  .sw-ok { background: #e8f5e9; }
  .sw-over { background: #fdecea; }
  .sw-empty { background: #f3f4f6; }
  @media print { button { display: none; } }
</style></head>
<body>
  ${blocks}
</body></html>`;
  }

  function printPdf() {
    const snap = state.snap;
    if (!snap || !snap.lines || !snap.lines.length) {
      showToast('먼저 정산주를 불러오세요. 인쇄할 미션조정 표가 없습니다.');
      return;
    }
    const win = window.open('', '_blank');
    if (!win) {
      showToast('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.');
      return;
    }
    win.document.open();
    win.document.write(buildPrintDoc(snap));
    win.document.close();
    win.focus();
    // 폰트·레이아웃이 적용된 뒤 인쇄 대화상자를 연다.
    win.addEventListener('load', () => setTimeout(() => win.print(), 150));
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
    const printBtn = $('missionAdjustPrintBtn');
    if (printBtn && printBtn.dataset.bound !== '1') {
      printBtn.dataset.bound = '1';
      printBtn.addEventListener('click', () => { printPdf(); });
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
