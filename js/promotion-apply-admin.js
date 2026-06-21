const BremPromotionApplyAdmin = (function () {
  const PLATFORMS = ['coupang', 'baemin', 'combined'];
  const state = { lastResult: null, platform: 'coupang', savedResultId: '' };
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMoney(value) {
    return `${Number(value || 0).toLocaleString('ko-KR')}원`;
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function formatRate(value, platform) {
    if (value === null || value === undefined || value === '') return '-';
    return `${BremPlatforms.rateLabel(platform)} ${Number(value).toLocaleString('ko-KR')}%`;
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function applyRoot() {
    return $('#promotion-apply');
  }

  function getActivePlatform() {
    return state.platform || 'coupang';
  }

  function readSelectedRuleIds(platform = getActivePlatform()) {
    return $$(`[data-promotion-apply-rule="${platform}"]:checked`).map(input => input.value);
  }

  function readSettlementId(platform = getActivePlatform()) {
    if (platform === 'combined') return '';
    return $(`#promotionApplySettlementSelect-${platform}`)?.value || '';
  }

  function readCombinedSettlementIds() {
    return {
      coupang: $('#promotionApplySettlementSelect-combined-coupang')?.value || '',
      baemin: $('#promotionApplySettlementSelect-combined-baemin')?.value || ''
    };
  }

  function deliveryFeePanelKey(platform) {
    return platform === 'combined' ? 'combined' : 'baemin';
  }

  function resultShowsDeliveryFeeColumns(result) {
    const platform = BremPlatforms.normalize(result?.platform);
    if (platform === 'baemin') return true;
    if (platform === 'combined') {
      return (result?.results || []).some(row => BremPlatforms.normalize(row.appliedPlatform) === 'baemin');
    }
    return false;
  }

  function updateDeliveryFeeHint(platformKey, file) {
    const hintEl = $(`#promotionApplyDeliveryFeeHint-${platformKey}`);
    if (!hintEl) return;

    if (!file) {
      hintEl.innerHTML = platformKey === 'combined'
        ? '단가보장 조건이 있으면 배민 기사(배민 단독)에 배달처리비 정산서가 필요합니다. K열 User ID로 매칭하며, 파일명 기간은 배민 주정산서와 같아야 합니다.'
        : '단가보장 프로모션 적용 시 <strong>배달처리비_팀명_YYYYMMDD_YYYYMMDD</strong> 형식 파일을 업로드하세요. <strong>K열 User ID</strong>로 기사 배민 ID와 매칭하고 AH열 배달처리비를 합산합니다. 주정산서와 정산기간이 일치해야 합니다.';
      return;
    }

    const meta = BremBaeminDeliveryFee.parseFileName(file.name);
    if (!meta?.startDate || !meta?.endDate) {
      hintEl.innerHTML = `<span class="field-error">파일명에서 정산기간을 읽지 못했습니다. 예: 배달처리비_표준울산남A팀브로1_20260610_20260616</span>`;
      return;
    }

    hintEl.innerHTML = `선택 파일: <strong>${escapeHtml(file.name)}</strong> · 팀 <strong>${escapeHtml(meta.teamName || '-')}</strong> · 기간 <strong>${escapeHtml(meta.startDate)} ~ ${escapeHtml(meta.endDate)}</strong>`;
  }

  async function resolveDeliveryFeeForCalculation(platform, baeminSettlement) {
    const needsFile = BremPromotionApply.selectedRulesNeedDeliveryFee(readSelectedRuleIds(platform));
    if (!needsFile) return null;

    const panelKey = deliveryFeePanelKey(platform);
    const fileInput = $(`#promotionApplyDeliveryFeeFile-${panelKey}`);
    const passwordInput = $(`#promotionApplyDeliveryFeePassword-${panelKey}`);
    const file = fileInput?.files?.[0];

    if (!file) {
      throw new Error('단가보장 프로모션은 배달처리비 정산서 파일을 선택하세요.');
    }

    const parsed = await BremBaeminDeliveryFee.parseFile(file, passwordInput?.value ?? '');
    BremBaeminDeliveryFee.assertDateMatch(baeminSettlement, parsed);
    return parsed;
  }

  function renderSettlementSelectForPlatform(platform) {
    const select = $(`#promotionApplySettlementSelect-${platform}`);
    if (!select) return;

    const previous = select.value;
    const options = BremPromotionApply.getSettlementOptions(platform);
    const emptyLabel = platform === 'baemin'
      ? '저장된 배민 주정산 선택'
      : '저장된 쿠팡 주정산 선택';

    select.innerHTML = [`<option value="">${emptyLabel}</option>`].concat(
      options.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`)
    ).join('');

    if (previous && options.some(item => item.id === previous)) {
      select.value = previous;
    } else {
      select.value = '';
    }
  }

  function renderCombinedSettlementSelects() {
    ['coupang', 'baemin'].forEach(platform => {
      const select = $(`#promotionApplySettlementSelect-combined-${platform}`);
      if (!select) return;

      const previous = select.value;
      const options = BremPromotionApply.getSettlementOptions(platform);
      const emptyLabel = platform === 'baemin'
        ? '저장된 배민 주정산 선택'
        : '저장된 쿠팡 주정산 선택';

      select.innerHTML = [`<option value="">${emptyLabel}</option>`].concat(
        options.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`)
      ).join('');

      if (previous && options.some(item => item.id === previous)) {
        select.value = previous;
      } else {
        select.value = '';
      }
    });
  }

  function renderSettlementSelect() {
    PLATFORMS.filter(platform => platform !== 'combined').forEach(renderSettlementSelectForPlatform);
    renderCombinedSettlementSelects();
  }

  function renderPromotionRulePickersForPlatform(platform) {
    const container = $(`#promotionApplyRuleList-${platform}`);
    if (!container) return;

    const allForPlatform = BremStorage.promotionRules.getAll()
      .filter(rule => BremPlatforms.normalize(rule.platform) === platform);
    const rules = allForPlatform.filter(rule => rule.enabled);

    if (!rules.length) {
      const disabledCount = allForPlatform.filter(rule => !rule.enabled).length;
      let emptyMessage = platform === 'combined'
        ? '사용 중인 합산 프로모션 조건이 없습니다. 프로모션 관리 → 합산 탭에서 조건을 만드세요.'
        : '사용 중인 프로모션 조건이 없습니다. 프로모션 관리에서 조건을 추가하세요.';
      if (disabledCount > 0) {
        emptyMessage += ` (중지된 조건 ${disabledCount}개 — 프로모션 관리에서 <strong>사용</strong>으로 켜주세요)`;
      }
      container.innerHTML = `<p class="form-help">${emptyMessage}</p>`;
      return;
    }

    container.innerHTML = rules.map(rule => `
      <label class="promotion-checkbox-field">
        <input type="checkbox" value="${escapeHtml(rule.id)}" data-promotion-apply-rule="${platform}">
        <span>${escapeHtml(rule.name)}</span>
      </label>
    `).join('');
  }

  function renderPromotionRulePickers() {
    PLATFORMS.forEach(renderPromotionRulePickersForPlatform);
  }

  function renderResult(result, options = {}) {
    const card = $('#promotionApplyResultCard');
    const rowsEl = $('#promotionApplyResultRows');
    const summaryEl = $('#promotionApplyResultSummary');
    if (!card || !rowsEl || !result) return;

    card.hidden = false;
    const savedBadge = options.savedAt
      ? `<p>저장일: <strong>${escapeHtml(String(options.savedAt).slice(0, 19).replace('T', ' '))}</strong></p>`
      : '';
    const isCombined = BremPlatforms.normalize(result.platform) === 'combined';
    const combinedSummary = isCombined
      ? `<p>적용 구분: 쿠팡 <strong>${formatNumber(result.summary?.coupangAssigned)}</strong>명 · 배민 <strong>${formatNumber(result.summary?.baeminAssigned)}</strong>명 · 겹침→쿠팡 <strong>${formatNumber(result.summary?.overlapAssigned)}</strong>명</p>`
      : '';
    const deliveryFeeSummary = result.deliveryFeeLabel
      ? `<p>배달처리비: <strong>${escapeHtml(result.deliveryFeeLabel)}</strong>${result.deliveryFeeFileName ? ` · ${escapeHtml(result.deliveryFeeFileName)}` : ''}</p>`
      : '';

    summaryEl.innerHTML = `
      <p>대상: <strong>${escapeHtml(result.settlementLabel)}</strong></p>
      <p>정산기간: <strong>${escapeHtml(result.startDate)} ~ ${escapeHtml(result.endDate)}</strong></p>
      <p>적용 조건: <strong>${escapeHtml((result.selectedPromotionRuleNames || []).join(', ') || '-')}</strong></p>
      <p>기사 <strong>${formatNumber(result.summary.riderCount)}</strong>명 · 총 프로모션 <strong>${formatMoney(result.summary.totalPromotionAmount)}</strong></p>
      ${deliveryFeeSummary}
      ${combinedSummary}
      ${savedBadge}
    `;

    const platform = result.platform;
    const isCombinedResult = BremPlatforms.normalize(platform) === 'combined';
    const showDeliveryFee = resultShowsDeliveryFeeColumns(result);
    const driverColumnLabel = isCombinedResult
      ? '기사'
      : (platform === 'coupang'
        ? '쿠팡 ID'
        : (platform === 'baemin' ? '배민 User ID' : '기사'));
    const headEl = $('#promotionApplyResultHead');
    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>${escapeHtml(driverColumnLabel)}</th>
          ${isCombinedResult ? '<th>적용 플랫폼</th><th>구분</th>' : ''}
          <th>주간 콜수</th>
          <th>거절율/수락율</th>
          <th>적용 프로모션</th>
          ${showDeliveryFee ? `
          <th>배달처리비합계</th>
          <th>건당실제</th>
          <th>보장단가</th>
          <th>단가보장지급</th>
          ` : ''}
          <th>기본 지급</th>
          <th>추가 지급</th>
          <th>총 지급</th>
          <th>적용 조건</th>
          <th>미달성 조건</th>
          <th>미지급 사유</th>
        </tr>
      `;
    }
    rowsEl.innerHTML = result.results.map(row => {
      const rowPlatform = row.appliedPlatform || platform;
      const isBaeminRow = BremPlatforms.normalize(rowPlatform) === 'baemin';
      return `
      <tr class="${row.totalPromotionAmount > 0 ? 'promotion-row-paid' : 'promotion-row-unpaid'}">
        <td><strong>${escapeHtml(BremPromotionApply.getResultRowDisplayName(row, platform))}</strong></td>
        ${isCombinedResult ? `
          <td>${escapeHtml(BremPlatforms.label(rowPlatform))}</td>
          <td>${escapeHtml(row.assignmentSource || '-')}</td>
        ` : ''}
        <td>${formatNumber(row.callCount)}</td>
        <td>${formatRate(row.platformRate, rowPlatform)}</td>
        <td>${escapeHtml(row.ruleName || '-')}</td>
        ${showDeliveryFee ? `
        <td>${isBaeminRow ? formatMoney(row.deliveryAmountTotal) : '-'}</td>
        <td>${isBaeminRow && row.avgDeliveryUnitPrice ? `${formatNumber(row.avgDeliveryUnitPrice)}원` : (isBaeminRow ? '0원' : '-')}</td>
        <td>${isBaeminRow && row.guaranteedUnitPrice ? `${formatNumber(row.guaranteedUnitPrice)}원` : (isBaeminRow ? '-' : '-')}</td>
        <td>${isBaeminRow ? formatMoney(row.guaranteePromotionAmount) : '-'}</td>
        ` : ''}
        <td>${formatMoney(row.basePromotionAmount)}</td>
        <td>${formatMoney(row.extraPromotionAmount)}</td>
        <td><strong>${formatMoney(row.totalPromotionAmount)}</strong></td>
        <td>${(row.appliedConditions || []).map(name => `<span class="promotion-condition-chip">${escapeHtml(name)}</span>`).join('') || '-'}</td>
        <td>${(row.failedConditions || []).map(name => `<span class="promotion-condition-chip muted">${escapeHtml(name)}</span>`).join('') || '-'}</td>
        <td>${escapeHtml((row.failureReasons || []).join(', ') || '없음')}</td>
      </tr>
    `;
    }).join('');
  }

  function renderSavedList() {
    const rowsEl = $('#promotionApplySavedRows');
    if (!rowsEl) return;

    const platform = getActivePlatform();
    const list = BremPromotionApply.getSavedResults(platform);
    if (!list.length) {
      rowsEl.innerHTML = '<tr><td colspan="7" class="empty">저장된 프로모션 계산 결과가 없습니다.</td></tr>';
      return;
    }

    rowsEl.innerHTML = list.map(item => `
      <tr>
        <td>${escapeHtml(item.region || '-')}</td>
        <td>${escapeHtml(item.startDate)} ~ ${escapeHtml(item.endDate)}</td>
        <td>${formatNumber(item.summary?.riderCount)}명</td>
        <td>${formatMoney(item.summary?.totalPromotionAmount)}</td>
        <td>${escapeHtml((item.selectedPromotionRuleNames || []).join(', ') || '-')}</td>
        <td>${escapeHtml(String(item.savedAt).slice(0, 10))}</td>
        <td class="promotion-rule-actions">
          <button type="button" class="small-btn" data-promotion-apply-view="${escapeHtml(item.id)}">보기</button>
          <button type="button" class="small-btn" data-promotion-apply-download="${escapeHtml(item.id)}">엑셀</button>
          <button type="button" class="small-btn danger-btn" data-promotion-apply-delete="${escapeHtml(item.id)}">삭제</button>
        </td>
      </tr>
    `).join('');
  }

  async function runCalculation() {
    const platform = getActivePlatform();
    const ruleIds = readSelectedRuleIds(platform);

    if (!ruleIds.length) {
      showToast(platform === 'combined' ? '적용할 합산 프로모션 조건을 선택하세요.' : '적용할 프로모션 조건을 선택하세요.');
      return;
    }

    try {
      if (platform === 'combined') {
        const ids = readCombinedSettlementIds();
        if (!ids.coupang) {
          showToast('저장된 쿠팡 주정산서를 선택하세요.');
          return;
        }
        if (!ids.baemin) {
          showToast('저장된 배민 주정산서를 선택하세요.');
          return;
        }
        const coupangSettlement = BremStorage.weeklySettlements.getById(ids.coupang);
        const baeminSettlement = BremStorage.weeklySettlements.getById(ids.baemin);
        if (!coupangSettlement || BremStorage.resolveWeeklySettlementPlatform(coupangSettlement) !== 'coupang') {
          showToast('쿠팡 주정산서를 확인하세요.');
          renderCombinedSettlementSelects();
          return;
        }
        if (!baeminSettlement || BremStorage.resolveWeeklySettlementPlatform(baeminSettlement) !== 'baemin') {
          showToast('배민 주정산서를 확인하세요.');
          renderCombinedSettlementSelects();
          return;
        }

        const deliveryFeeParsed = await resolveDeliveryFeeForCalculation('combined', baeminSettlement);
        const applyOptions = deliveryFeeParsed
          ? { deliveryFeeIndex: deliveryFeeParsed.index, deliveryFeeMeta: deliveryFeeParsed }
          : {};

        state.lastResult = BremPromotionApply.applyPromotionToCombinedSettlements(
          coupangSettlement,
          baeminSettlement,
          ruleIds,
          undefined,
          applyOptions
        );
      } else {
        const settlementId = readSettlementId(platform);
        if (!settlementId) {
          showToast(platform === 'baemin' ? '저장된 배민 주정산을 선택하세요.' : '저장된 쿠팡 주정산을 선택하세요.');
          return;
        }
        const settlement = BremStorage.weeklySettlements.getById(settlementId);
        if (!settlement) {
          showToast('주정산 데이터를 찾을 수 없습니다.');
          renderSettlementSelectForPlatform(platform);
          return;
        }
        if (BremStorage.resolveWeeklySettlementPlatform(settlement) !== platform) {
          showToast(`${BremPlatforms.label(platform)} 주정산만 선택할 수 있습니다.`);
          renderSettlementSelectForPlatform(platform);
          return;
        }

        let applyOptions = {};
        if (platform === 'baemin') {
          const deliveryFeeParsed = await resolveDeliveryFeeForCalculation('baemin', settlement);
          if (deliveryFeeParsed) {
            applyOptions = {
              deliveryFeeIndex: deliveryFeeParsed.index,
              deliveryFeeMeta: deliveryFeeParsed
            };
          }
        }

        state.lastResult = BremPromotionApply.applyPromotionToSettlement(
          settlement,
          ruleIds,
          undefined,
          applyOptions
        );
      }

      state.savedResultId = '';
      renderResult(state.lastResult);
      showToast('프로모션 계산이 완료되었습니다.');
    } catch (error) {
      showToast(error.message || '프로모션 계산 중 오류가 발생했습니다.');
    }
  }

  function saveCurrentResult() {
    if (!state.lastResult) {
      showToast('먼저 프로모션 계산을 실행하세요.');
      return;
    }
    try {
      const saved = BremPromotionApply.saveResult(state.lastResult);
      state.savedResultId = saved.id;
      renderResult(saved, { savedAt: saved.savedAt });
      renderSavedList();
      showToast('프로모션 계산 결과를 저장했습니다.');
    } catch (error) {
      showToast(error.message || '저장 중 오류가 발생했습니다.');
    }
  }

  function downloadCurrentResult() {
    if (!state.lastResult) {
      showToast('먼저 프로모션 계산을 실행하세요.');
      return;
    }
    try {
      const payload = state.savedResultId
        ? BremPromotionApply.getSavedResultById(state.savedResultId) || state.lastResult
        : { ...state.lastResult, savedAt: state.lastResult.savedAt || new Date().toISOString() };
      BremPromotionApply.exportResultToExcel(payload);
      showToast('엑셀 파일을 다운로드했습니다.');
    } catch (error) {
      showToast(error.message || '엑셀 다운로드 중 오류가 발생했습니다.');
    }
  }

  function viewSavedResult(id) {
    const record = BremPromotionApply.getSavedResultById(id);
    if (!record) {
      showToast('저장된 결과를 찾을 수 없습니다.');
      renderSavedList();
      return;
    }
    state.platform = BremPlatforms.normalize(record.platform);
    setPlatform(state.platform, { keepResult: true });
    state.lastResult = record;
    state.savedResultId = record.id;
    renderResult(record, { savedAt: record.savedAt });
    $('#promotionApplyResultCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function downloadSavedResult(id) {
    const record = BremPromotionApply.getSavedResultById(id);
    if (!record) {
      showToast('저장된 결과를 찾을 수 없습니다.');
      renderSavedList();
      return;
    }
    try {
      BremPromotionApply.exportResultToExcel(record);
      showToast('엑셀 파일을 다운로드했습니다.');
    } catch (error) {
      showToast(error.message || '엑셀 다운로드 중 오류가 발생했습니다.');
    }
  }

  async function deleteSavedResult(id) {
    const record = BremPromotionApply.getSavedResultById(id);
    if (!record) {
      renderSavedList();
      return;
    }
    if (!window.confirm('저장된 프로모션 계산 결과를 삭제할까요?')) return;

    BremPromotionApply.deleteSavedResult(id);
    if (state.savedResultId === id) state.savedResultId = '';
    renderSavedList();
    showToast('저장된 결과를 삭제했습니다.');

    void BremStorage.promotionApplyResults.persist?.().catch(error => {
      console.error('[BREM] promotion apply result delete persist failed:', error);
      showToast('삭제 저장에 실패했습니다. 새로고침 후 다시 시도하세요.');
      renderSavedList();
    });
  }

  function setPlatform(platform, options = {}) {
    const p = BremPlatforms.normalize(platform);
    state.platform = p;

    const root = applyRoot();
    root?.querySelectorAll('[data-promotion-apply-platform]').forEach(button => {
      const active = button.dataset.promotionApplyPlatform === p;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    root?.querySelectorAll('[data-promotion-apply-panel]').forEach(panel => {
      panel.hidden = panel.dataset.promotionApplyPanel !== p;
    });

    renderSettlementSelect();
    renderPromotionRulePickers();
    renderSavedList();

    if (!options.keepResult) {
      const card = $('#promotionApplyResultCard');
      if (card) card.hidden = true;
      state.lastResult = null;
      state.savedResultId = '';
    }
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    applyRoot()?.querySelectorAll('[data-promotion-apply-platform]').forEach(button => {
      button.addEventListener('click', () => setPlatform(button.dataset.promotionApplyPlatform));
    });

    $('#promotionApplyForm')?.addEventListener('submit', event => {
      event.preventDefault();
      runCalculation();
    });

    ['baemin', 'combined'].forEach(panelKey => {
      $(`#promotionApplyDeliveryFeeFile-${panelKey}`)?.addEventListener('change', event => {
        updateDeliveryFeeHint(panelKey, event.target.files?.[0] || null);
      });
    });

    $('#promotionApplySaveBtn')?.addEventListener('click', saveCurrentResult);
    $('#promotionApplyDownloadBtn')?.addEventListener('click', downloadCurrentResult);

    $('#promotionApplySavedRows')?.addEventListener('click', event => {
      const viewBtn = event.target.closest('[data-promotion-apply-view]');
      const downloadBtn = event.target.closest('[data-promotion-apply-download]');
      const deleteBtn = event.target.closest('[data-promotion-apply-delete]');
      if (viewBtn) {
        viewSavedResult(viewBtn.dataset.promotionApplyView);
        return;
      }
      if (downloadBtn) {
        downloadSavedResult(downloadBtn.dataset.promotionApplyDownload);
        return;
      }
      if (deleteBtn) {
        deleteSavedResult(deleteBtn.dataset.promotionApplyDelete);
      }
    });
  }

  function refresh() {
    if (!applyRoot()) return;
    renderSettlementSelect();
    renderPromotionRulePickers();
    renderSavedList();
  }

  function init() {
    if (!applyRoot()) return;
    bindEvents();
    setPlatform('coupang');
  }

  return { init, refresh };
})();

document.addEventListener('DOMContentLoaded', () => {
  BremPromotionApplyAdmin.init();
});
