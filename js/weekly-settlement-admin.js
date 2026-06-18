const BremWeeklySettlementAdmin = (function () {
  const state = {
    previewByPlatform: { coupang: null, baemin: null },
    detailId: ''
  };

  const PLATFORMS = ['coupang', 'baemin'];
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

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

  function platformLabel(platform) {
    return BremPlatforms.label(platform);
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function fillCoupangDatesFromBase() {
    const baseInput = $('#weeklySettlementBaseDate-coupang');
    if (!baseInput?.value) return;
    const dates = BremWeeklySettlement.calculateCoupangSettlementDates(baseInput.value);
    const startInput = $('#weeklySettlementStartDate-coupang');
    const endInput = $('#weeklySettlementEndDate-coupang');
    const paymentInput = $('#weeklySettlementPaymentDate-coupang');
    if (startInput) startInput.value = dates.startDate;
    if (endInput) endInput.value = dates.endDate;
    if (paymentInput) paymentInput.value = dates.paymentDate;
  }

  function applyFilenameHints(platform, fileName) {
    if (!fileName) return;
    if (platform === 'coupang') {
      const parsed = BremWeeklySettlement.parseCoupangFileName(fileName);
      const regionInput = $('#weeklySettlementRegion-coupang');
      const weekLabelInput = $('#weeklySettlementWeekLabel-coupang');
      if (regionInput && parsed.region && !regionInput.value) regionInput.value = parsed.region;
      if (weekLabelInput && parsed.settlementWeekLabel) weekLabelInput.value = parsed.settlementWeekLabel;
      return;
    }
    const parsed = BremWeeklySettlement.parseBaeminFileName(fileName);
    const regionInput = $('#weeklySettlementRegion-baemin');
    const startInput = $('#weeklySettlementStartDate-baemin');
    const endInput = $('#weeklySettlementEndDate-baemin');
    const paymentInput = $('#weeklySettlementPaymentDate-baemin');
    const weekLabelInput = $('#weeklySettlementWeekLabel-baemin');
    if (regionInput && parsed.teamName && !regionInput.value) regionInput.value = parsed.teamName;
    if (startInput && parsed.startDate) startInput.value = parsed.startDate;
    if (endInput && parsed.endDate) endInput.value = parsed.endDate;
    if (paymentInput && parsed.startDate) {
      paymentInput.value = BremWeeklySettlement.calculateCoupangSettlementDates(parsed.startDate).paymentDate;
    }
    if (weekLabelInput && parsed.startDate && parsed.endDate) {
      weekLabelInput.value = `${parsed.startDate} ~ ${parsed.endDate}`;
    }
  }

  function platformWeeklyOrderLabel(platform) {
    return platform === 'baemin' ? '처리건수(D)' : '오더수(F)';
  }

  function platformMatchIdLabel(platform) {
    return platform === 'baemin' ? 'User ID(B)' : '쿠팡 ID';
  }

  function riderMatchIdValue(rider, platform) {
    if (platform === 'baemin') return rider.baeminUserId || '-';
    return rider.coupangLoginKey || rider.originalName || '-';
  }

  function readUploadForm(platform) {
    if (platform === 'coupang') fillCoupangDatesFromBase();
    return {
      platform,
      region: $(`#weeklySettlementRegion-${platform}`)?.value?.trim() || '',
      baseSettlementDate: $(`#weeklySettlementBaseDate-${platform}`)?.value
        || $(`#weeklySettlementStartDate-${platform}`)?.value || '',
      startDate: $(`#weeklySettlementStartDate-${platform}`)?.value || '',
      endDate: $(`#weeklySettlementEndDate-${platform}`)?.value || '',
      paymentDate: $(`#weeklySettlementPaymentDate-${platform}`)?.value || '',
      settlementWeekLabel: $(`#weeklySettlementWeekLabel-${platform}`)?.value?.trim() || '',
      password: $(`#weeklySettlementPassword-${platform}`)?.value || '',
      file: $(`#weeklySettlementFile-${platform}`)?.files?.[0] || null,
      columnConfig: {
        nameColumn: $(`#weeklySettlementNameCol-${platform}`)?.value || 'C',
        userIdColumn: platform === 'baemin'
          ? ($(`#weeklySettlementUserIdCol-baemin`)?.value || 'B')
          : '',
        orderCountColumn: $(`#weeklySettlementOrderCol-${platform}`)?.value
          || (platform === 'baemin' ? 'D' : 'F'),
        startRow: Number($(`#weeklySettlementStartRow-${platform}`)?.value || (platform === 'coupang' ? 13 : 2))
      }
    };
  }

  function validateUploadForm(payload) {
    if (!payload.region) return '지역을 입력하세요.';
    if (!payload.startDate || !payload.endDate) return '정산 시작일과 종료일을 입력하세요.';
    if (!payload.file) return '엑셀 파일을 선택하세요.';
    return '';
  }

  async function uploadAndMatch(platform) {
    const payload = readUploadForm(platform);
    const error = validateUploadForm(payload);
    if (error) {
      showToast(error);
      return;
    }
    try {
      const record = await BremWeeklySettlement.processWeeklyUpload(payload);
      state.previewByPlatform[platform] = record;
      renderPreview(platform);
      const mismatchCount = record.summary.callCountMismatches || 0;
      let toastMessage = `정산 인수 ${record.summary.totalExtracted}명 · 매칭 ${record.summary.matchedRiders}명`;
      if (mismatchCount > 0) {
        toastMessage += ` · ⚠ 콜수 불일치 ${mismatchCount}명 (정산표/콜수입력 확인)`;
      }
      showToast(toastMessage);
    } catch (uploadError) {
      showToast(uploadError.message || '주간정산서 처리 중 오류가 발생했습니다.');
    }
  }

  function savePreview(platform) {
    const record = state.previewByPlatform[platform];
    if (!record) {
      showToast('먼저 업로드 및 매칭을 실행하세요.');
      return;
    }
    if (!record.riders?.length) {
      showToast('매칭된 기사가 없어 저장할 수 없습니다.');
      return;
    }
    const { previewUnmatched, ...saveRecord } = record;
    saveRecord.summary = {
      totalExtracted: saveRecord.riders.length,
      matchedRiders: saveRecord.riders.length,
      unmatchedRiders: 0,
      callCountMismatches: saveRecord.riders.filter(r => r.callCountMatched === false).length
    };
    BremWeeklySettlement.saveWeeklySettlement(saveRecord);
    state.previewByPlatform[platform] = null;
    $(`#weeklySettlementPreviewCard-${platform}`).hidden = true;
    renderSavedList(platform);
    if (typeof BremPromotionApplyAdmin !== 'undefined') BremPromotionApplyAdmin.refresh();
    showToast(`${record.region} · 매칭 ${record.riders.length}명 저장 완료`);
  }

  function renderPreview(platform) {
    const record = state.previewByPlatform[platform];
    const card = $(`#weeklySettlementPreviewCard-${platform}`);
    const rowsEl = $(`#weeklySettlementPreviewRows-${platform}`);
    if (!card || !rowsEl) return;

    if (!record) {
      card.hidden = true;
      rowsEl.innerHTML = '';
      return;
    }

    card.hidden = false;
    const unmatched = record.previewUnmatched || [];
    const mismatchCount = record.summary.callCountMismatches || 0;
    const orderLabel = platformWeeklyOrderLabel(platform);
    const summaryExtra = mismatchCount
      ? `<p class="weekly-call-mismatch-banner">⚠ 콜수 미매칭 <strong>${formatNumber(mismatchCount)}</strong>명 — 정산표 업로드/콜수입력과 주간서 ${orderLabel}을 확인하세요.</p>`
      : '';

    const matchBasisLabel = platform === 'baemin'
      ? '배민 User ID ↔ 기사 배민 ID'
      : '정산표/콜수 기준';
    $(`#weeklySettlementPreviewSummary-${platform}`).innerHTML = `
      <p>추출 인수 <strong>${formatNumber(record.summary.totalExtracted)}</strong>명</p>
      <p>매칭 <strong>${formatNumber(record.summary.matchedRiders)}</strong>명 (${matchBasisLabel})</p>
      <p>미매칭 <strong>${formatNumber(record.summary.unmatchedRiders)}</strong>명</p>
      <p>콜수 불일치 <strong>${formatNumber(mismatchCount)}</strong>명</p>
      <p>저장 대상 <strong>${formatNumber(record.riders.length)}</strong>명 (매칭된 기사만)</p>
      ${summaryExtra}
    `;

    const matchedRows = (record.riders || []).map(rider => {
      const callStatus = rider.callCountMatched === false
        ? '<span class="promotion-status-no">불일치</span>'
        : '<span class="promotion-status-ok">일치</span>';
      const warningText = (rider.warnings || []).join(', ');
      const rowClass = rider.callCountMatched === false ? 'promotion-row-unpaid' : '';
      return `
      <tr class="${rowClass}">
        <td><strong>${escapeHtml(rider.driverName || rider.riderName)}</strong></td>
        <td>${escapeHtml(rider.originalName)}</td>
        <td>${escapeHtml(riderMatchIdValue(rider, platform))}</td>
        <td>${formatNumber(rider.weeklyOrderCount)}</td>
        <td>${formatNumber(rider.systemCallCount)}</td>
        <td>${callStatus}</td>
        <td class="promotion-status-ok">매칭</td>
        <td class="weekly-warning-cell">${escapeHtml(warningText)}</td>
      </tr>
    `;
    }).join('');

    const unmatchedRows = unmatched.map(rider => {
      const warningText = (rider.warnings || []).join(', ') || unmatchedDefaultWarning(platform);
      return `
      <tr class="promotion-row-unpaid">
        <td><strong>${escapeHtml(rider.riderName)}</strong></td>
        <td>${escapeHtml(rider.originalName)}</td>
        <td>${escapeHtml(riderMatchIdValue(rider, platform))}</td>
        <td>${formatNumber(rider.weeklyOrderCount)}</td>
        <td>-</td>
        <td class="promotion-status-no">-</td>
        <td class="promotion-status-no">미매칭</td>
        <td class="weekly-warning-cell">${escapeHtml(warningText)}</td>
      </tr>
    `;
    }).join('');

    rowsEl.innerHTML = matchedRows + unmatchedRows || '<tr><td colspan="8" class="empty">데이터 없음</td></tr>';
  }

  function unmatchedDefaultWarning(platform) {
    return platform === 'baemin' ? '배민 User ID 미매칭' : '쿠팡 ID(이름+연락처)/기사명 미매칭';
  }

  function renderSavedList(platform) {
    const rowsEl = $(`#weeklySettlementSavedRows-${platform}`);
    if (!rowsEl) return;

    const list = BremWeeklySettlement.loadWeeklySettlements({ platform });
    if (!list.length) {
      rowsEl.innerHTML = '<tr><td colspan="7" class="empty">저장된 주간정산이 없습니다.</td></tr>';
      return;
    }

    rowsEl.innerHTML = list.map(item => `
      <tr>
        <td>${escapeHtml(item.region || '-')}</td>
        <td>${escapeHtml(item.startDate)} ~ ${escapeHtml(item.endDate)}</td>
        <td>${formatNumber(item.summary.matchedRiders)}명</td>
        <td>${escapeHtml(item.matchedNamesLabel || '-')}</td>
        <td>${escapeHtml(item.fileName || '-')}</td>
        <td>${escapeHtml(String(item.uploadedAt).slice(0, 10))}</td>
        <td class="promotion-rule-actions">
          <button type="button" class="small-btn" data-weekly-detail="${escapeHtml(item.id)}">상세</button>
          <button type="button" class="small-btn danger-btn" data-weekly-delete="${escapeHtml(item.id)}">삭제</button>
        </td>
      </tr>
    `).join('');
  }

  function renderDetail(record) {
    const card = $('#weeklySettlementDetailCard');
    if (!card || !record) return;
    state.detailId = record.id;
    card.hidden = false;
    $('#weeklySettlementDetailTitle').textContent = `${platformLabel(record.platform)} · ${record.region}`;
    const mismatchCount = (record.riders || []).filter(r => r.callCountMatched === false).length;
    const orderLabel = platformWeeklyOrderLabel(record.platform);
    const idLabel = platformMatchIdLabel(record.platform);
    $('#weeklySettlementDetailMeta').innerHTML = `
      <p>정산기간: <strong>${escapeHtml(record.startDate)} ~ ${escapeHtml(record.endDate)}</strong></p>
      <p>매칭 ${formatNumber(record.summary.matchedRiders)}명: <strong>${escapeHtml(record.matchedNamesLabel || '-')}</strong></p>
      ${mismatchCount ? `<p class="weekly-call-mismatch-banner">⚠ 콜수 불일치 ${formatNumber(mismatchCount)}명</p>` : ''}
    `;
    const headEl = $('#weeklySettlementDetailHead');
    if (headEl) {
      headEl.innerHTML = `<tr>
            <th>기사명</th>
            <th>원본 이름</th>
            <th>${escapeHtml(idLabel)}</th>
            <th>주간 ${escapeHtml(orderLabel)}</th>
            <th>시스템 콜수</th>
            <th>콜수 일치</th>
            <th>경고</th>
          </tr>`;
    }
    $('#weeklySettlementDetailRows').innerHTML = (record.riders || []).map(rider => {
      const warningText = (rider.warnings || []).join(', ');
      return `
      <tr${rider.callCountMatched === false ? ' class="promotion-row-unpaid"' : ''}>
        <td><strong>${escapeHtml(rider.driverName || rider.riderName)}</strong></td>
        <td>${escapeHtml(rider.originalName)}</td>
        <td>${escapeHtml(riderMatchIdValue(rider, record.platform))}</td>
        <td>${formatNumber(rider.weeklyOrderCount)}</td>
        <td>${formatNumber(rider.systemCallCount)}</td>
        <td>${rider.callCountMatched === false ? '불일치' : '일치'}</td>
        <td>${escapeHtml(warningText)}</td>
      </tr>
    `;
    }).join('');
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function hideDetail() {
    state.detailId = '';
    const card = $('#weeklySettlementDetailCard');
    if (card) card.hidden = true;
  }

  function bindPlatformEvents(platform) {
    $(`#weeklySettlementUploadForm-${platform}`)?.addEventListener('submit', event => {
      event.preventDefault();
      uploadAndMatch(platform);
    });
    $(`#weeklySettlementSaveBtn-${platform}`)?.addEventListener('click', () => savePreview(platform));
    $(`#weeklySettlementCancelBtn-${platform}`)?.addEventListener('click', () => {
      state.previewByPlatform[platform] = null;
      renderPreview(platform);
    });
    $(`#weeklySettlementFile-${platform}`)?.addEventListener('change', event => {
      applyFilenameHints(platform, event.target.files?.[0]?.name || '');
    });
    if (platform === 'coupang') {
      $('#weeklySettlementBaseDate-coupang')?.addEventListener('change', fillCoupangDatesFromBase);
    }
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;
    PLATFORMS.forEach(bindPlatformEvents);
    $('#weeklySettlementDetailClose')?.addEventListener('click', hideDetail);
    document.addEventListener('click', event => {
      const detailBtn = event.target.closest('[data-weekly-detail]');
      if (detailBtn) {
        const record = BremStorage.weeklySettlements.getById(detailBtn.dataset.weeklyDetail);
        if (record) renderDetail(record);
        return;
      }
      const deleteBtn = event.target.closest('[data-weekly-delete]');
      if (deleteBtn) {
        if (!window.confirm('저장된 주간정산을 삭제할까요?')) return;
        const record = BremStorage.weeklySettlements.getById(deleteBtn.dataset.weeklyDelete);
        BremWeeklySettlement.deleteWeeklySettlement(deleteBtn.dataset.weeklyDelete);
        if (state.detailId === deleteBtn.dataset.weeklyDelete) hideDetail();
        if (record) renderSavedList(record.platform);
        if (typeof BremPromotionApplyAdmin !== 'undefined') BremPromotionApplyAdmin.refresh();
        showToast('주간정산이 삭제되었습니다.');
      }
    });
  }

  function refresh() {
    PLATFORMS.forEach(platform => {
      renderPreview(platform);
      renderSavedList(platform);
    });
  }

  function init() {
    if (!$('#weekly-settlement')) return;
    bindEvents();
    refresh();
  }

  return { init, refresh, hideDetail };
})();

document.addEventListener('DOMContentLoaded', () => {
  BremWeeklySettlementAdmin.init();
});
