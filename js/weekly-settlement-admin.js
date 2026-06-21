const BremWeeklySettlementAdmin = (function () {
  const state = {
    previewByPlatform: { coupang: null, baemin: null },
    detailId: '',
    weeklyLogWeekByPlatform: { coupang: null, baemin: null }
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

  function weekStartKey(dateValue = new Date().toISOString().slice(0, 10)) {
    if (window.BremDatePicker?.weekStartKey) return BremDatePicker.weekStartKey(dateValue);
    const date = new Date(`${dateValue}T00:00:00`);
    const day = date.getDay();
    const diff = (day - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return date.toISOString().slice(0, 10);
  }

  function weekEndKey(weekStart) {
    const end = new Date(`${weekStart}T00:00:00`);
    end.setDate(end.getDate() + 6);
    return end.toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(`${value}T00:00:00`));
  }

  function uploadLogStatusLabel(status) {
    switch (String(status || '')) {
      case 'saved':
        return '저장완료';
      case 'applied':
        return '반영완료';
      default:
        return '업로드';
    }
  }

  function ensureWeeklyLogWeek(platform) {
    if (!state.weeklyLogWeekByPlatform[platform]) {
      state.weeklyLogWeekByPlatform[platform] = weekStartKey();
    }
    const input = $(`#weeklySettlementLogWeek-${platform}`);
    if (input && !input.value) {
      input.value = state.weeklyLogWeekByPlatform[platform];
    }
    return state.weeklyLogWeekByPlatform[platform];
  }

  function updateWeeklyLogWeekRangeLabel(platform) {
    const weekStart = ensureWeeklyLogWeek(platform);
    const label = $(`#weeklySettlementLogWeekRange-${platform}`);
    if (label) {
      label.textContent = weekStart
        ? `표시 범위: ${formatDate(weekStart)}(수) ~ ${formatDate(weekEndKey(weekStart))}(화)`
        : '';
    }
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
      const uploadLog = BremStorage.settlementUploadLogs.add({
        kind: 'weekly',
        platform,
        fileName: payload.file.name,
        period: record.startDate,
        weekStart: weekStartKey(record.startDate || payload.startDate),
        region: record.region,
        startDate: record.startDate,
        endDate: record.endDate,
        status: 'uploaded',
        matchedCount: Number(record.summary?.matchedRiders || record.riders?.length || 0)
      });
      record.uploadLogId = uploadLog.id;
      state.previewByPlatform[platform] = record;
      renderPreview(platform);
      renderSavedList(platform);
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
    const saved = BremWeeklySettlement.saveWeeklySettlement(saveRecord);
    if (record.uploadLogId) {
      BremStorage.settlementUploadLogs.update(record.uploadLogId, {
        status: 'saved',
        linkedRecordId: saved.id,
        matchedCount: saveRecord.riders.length,
        fileName: saveRecord.fileName || record.fileName || ''
      });
    } else {
      BremStorage.settlementUploadLogs.add({
        kind: 'weekly',
        platform,
        fileName: saveRecord.fileName || record.fileName || '',
        period: saveRecord.startDate,
        weekStart: weekStartKey(saveRecord.startDate),
        region: saveRecord.region,
        startDate: saveRecord.startDate,
        endDate: saveRecord.endDate,
        status: 'saved',
        matchedCount: saveRecord.riders.length,
        linkedRecordId: saved.id,
        uploadedAt: saveRecord.uploadedAt
      });
    }
    void BremStorage.flushStorage?.();
    state.previewByPlatform[platform] = null;
    $(`#weeklySettlementPreviewCard-${platform}`).hidden = true;
    renderSavedList(platform);
    if (typeof BremPromotionApplyAdmin !== 'undefined') BremPromotionApplyAdmin.refresh();
    showToast(`${record.region} · 매칭 ${record.riders.length}명 저장 완료`);
  }

  function formatCallMismatchWarnings(rider) {
    const lines = (rider.warnings || []).filter(Boolean);
    if (!lines.length) return '-';
    return lines.map(line => `<span class="weekly-mismatch-line">${escapeHtml(line)}</span>`).join('');
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
      const warningText = formatCallMismatchWarnings(rider);
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
        <td class="weekly-warning-cell weekly-mismatch-detail">${warningText}</td>
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

    BremStorage.settlementUploadLogs.syncWeeklyFromSavedRecords();
    const weekStart = ensureWeeklyLogWeek(platform);
    updateWeeklyLogWeekRangeLabel(platform);

    const list = BremStorage.settlementUploadLogs.getFiltered({
      kind: 'weekly',
      platform,
      weekStart
    });

    if (!list.length) {
      rowsEl.innerHTML = `<tr><td colspan="8" class="empty">${formatDate(weekStart)} 주에 업로드한 ${platformLabel(platform)} 주정산 기록이 없습니다.</td></tr>`;
      return;
    }

    rowsEl.innerHTML = list.map(item => {
      const periodLabel = item.startDate && item.endDate
        ? `${escapeHtml(item.startDate)} ~ ${escapeHtml(item.endDate)}`
        : '-';
      const detailBtn = item.linkedRecordId
        ? `<button type="button" class="small-btn" data-weekly-detail="${escapeHtml(item.linkedRecordId)}">상세</button>`
        : '';
      const settlementDeleteBtn = item.linkedRecordId
        ? `<button type="button" class="small-btn danger-btn" data-weekly-delete="${escapeHtml(item.linkedRecordId)}">정산 삭제</button>`
        : '';
      return `
      <tr>
        <td>${formatDate(item.weekStart)} ~ ${formatDate(item.weekEnd)}</td>
        <td>${escapeHtml(item.region || '-')}</td>
        <td>${periodLabel}</td>
        <td>${escapeHtml(item.fileName || '-')}</td>
        <td>${escapeHtml(uploadLogStatusLabel(item.status))}</td>
        <td>${formatNumber(item.matchedCount)}명</td>
        <td>${formatDate(String(item.uploadedAt || '').slice(0, 10))}</td>
        <td class="promotion-rule-actions">
          ${detailBtn}
          ${settlementDeleteBtn}
          <button type="button" class="small-btn danger-btn" data-weekly-delete-log="${escapeHtml(item.id)}">기록 삭제</button>
        </td>
      </tr>
    `;
    }).join('');
  }

  function renderDetail(record) {
    const card = $('#weeklySettlementDetailCard');
    if (!card || !record) return;
    state.detailId = record.id;
    card.hidden = false;
    const period = BremWeeklySettlement.resolveWeeklyComparePeriod(record);
    const refreshedRiders = (record.riders || []).map(rider => (
      BremWeeklySettlement.refreshRiderCallMatch(rider, {
        platform: record.platform,
        startDate: period.startDate,
        endDate: period.endDate
      })
    ));
    const mismatchCount = refreshedRiders.filter(r => r.callCountMatched === false).length;
    const orderLabel = platformWeeklyOrderLabel(record.platform);
    const idLabel = platformMatchIdLabel(record.platform);
    $('#weeklySettlementDetailTitle').textContent = `${platformLabel(record.platform)} · ${record.region}`;
    $('#weeklySettlementDetailMeta').innerHTML = `
      <p>정산기간: <strong>${escapeHtml(period.startDate)} ~ ${escapeHtml(period.endDate)}</strong> (수~화 7일)</p>
      <p>매칭 ${formatNumber(record.summary.matchedRiders)}명: <strong>${escapeHtml(record.matchedNamesLabel || '-')}</strong></p>
      ${mismatchCount ? `<p class="weekly-call-mismatch-banner">⚠ 콜수 불일치 ${formatNumber(mismatchCount)}명 — 경고 열에서 누락 일·일별 콜수를 확인하세요.</p>` : ''}
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
    $('#weeklySettlementDetailRows').innerHTML = refreshedRiders.map(rider => {
      const warningText = formatCallMismatchWarnings(rider);
      return `
      <tr${rider.callCountMatched === false ? ' class="promotion-row-unpaid"' : ''}>
        <td><strong>${escapeHtml(rider.driverName || rider.riderName)}</strong></td>
        <td>${escapeHtml(rider.originalName)}</td>
        <td>${escapeHtml(riderMatchIdValue(rider, record.platform))}</td>
        <td>${formatNumber(rider.weeklyOrderCount)}</td>
        <td>${formatNumber(rider.systemCallCount)}</td>
        <td>${rider.callCountMatched === false ? '불일치' : '일치'}</td>
        <td class="weekly-warning-cell weekly-mismatch-detail">${warningText}</td>
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
    $(`#weeklySettlementLogWeek-${platform}`)?.addEventListener('change', event => {
      const picked = weekStartKey(event.target.value || weekStartKey());
      state.weeklyLogWeekByPlatform[platform] = picked;
      event.target.value = picked;
      renderSavedList(platform);
    });
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
        BremStorage.settlementUploadLogs.removeByLinkedRecordId(deleteBtn.dataset.weeklyDelete);
        void BremStorage.flushStorage?.();
        if (state.detailId === deleteBtn.dataset.weeklyDelete) hideDetail();
        if (record) renderSavedList(record.platform);
        if (typeof BremPromotionApplyAdmin !== 'undefined') BremPromotionApplyAdmin.refresh();
        showToast('주간정산이 삭제되었습니다.');
        return;
      }
      const deleteLogBtn = event.target.closest('[data-weekly-delete-log]');
      if (deleteLogBtn) {
        const log = BremStorage.settlementUploadLogs.getById(deleteLogBtn.dataset.weeklyDeleteLog);
        BremStorage.settlementUploadLogs.remove(deleteLogBtn.dataset.weeklyDeleteLog);
        void BremStorage.flushStorage?.().then(() => {
          renderSavedList(log?.platform || platformFromEvent(event));
          showToast('업로드 기록이 삭제되었습니다.');
        });
      }
    });
  }

  function platformFromEvent(event) {
    const panel = event.target.closest('.admin-platform-panel[data-platform]');
    return panel?.dataset?.platform || 'coupang';
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
