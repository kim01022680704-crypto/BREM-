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
    if (window.BremDatePicker?.applyWeekWednesday) {
      const normalized = BremDatePicker.applyWeekWednesday(baseInput.value);
      if (normalized && normalized !== baseInput.value) {
        baseInput.value = normalized;
      }
    }
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
      if (regionInput && parsed.region) regionInput.value = parsed.region;
      if (weekLabelInput && parsed.settlementWeekLabel) weekLabelInput.value = parsed.settlementWeekLabel;
      return;
    }
    const parsed = BremWeeklySettlement.parseBaeminFileName(fileName);
    const regionInput = $('#weeklySettlementRegion-baemin');
    const startInput = $('#weeklySettlementStartDate-baemin');
    const endInput = $('#weeklySettlementEndDate-baemin');
    const paymentInput = $('#weeklySettlementPaymentDate-baemin');
    const weekLabelInput = $('#weeklySettlementWeekLabel-baemin');
    if (regionInput && parsed.teamName) regionInput.value = parsed.teamName;
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
        startRow: Number($(`#weeklySettlementStartRow-${platform}`)?.value || (platform === 'coupang' ? 12 : 2))
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
      await BremStorage.refreshDriversForSettlementMatch?.();
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
      if (record.previewUnmatched?.length) {
        BremStorage.settlementUnmatched.saveWeeklyBatch({
          weekStart: weekStartKey(record.startDate || payload.startDate),
          startDate: record.startDate,
          endDate: record.endDate,
          records: record.previewUnmatched,
          sourceFileName: payload.file.name,
          platform,
          region: record.region
        });
      }
      renderPreview(platform);
      renderSavedList(platform);
      renderWeeklyUnmatched(platform);
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
    const refreshedRecord = BremWeeklySettlement.refreshWeeklySettlementRiders(saveRecord);
    refreshedRecord.summary = {
      totalExtracted: refreshedRecord.riders.length,
      matchedRiders: refreshedRecord.riders.length,
      unmatchedRiders: 0,
      callCountMismatches: refreshedRecord.riders.filter(r => r.callCountMatched === false).length
    };
    const saved = BremWeeklySettlement.saveWeeklySettlement(refreshedRecord);
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
    renderWeeklyUnmatched(platform);
    if (typeof BremPromotionApplyAdmin !== 'undefined') BremPromotionApplyAdmin.refresh();
    showToast(`${record.region} · 매칭 ${record.riders.length}명 저장 완료`);
  }

  function formatCallMismatchWarnings(rider) {
    const lines = (rider.warnings || []).filter(Boolean);
    if (!lines.length) return '-';
    return lines.map(line => `<span class="weekly-mismatch-line">${escapeHtml(line)}</span>`).join('');
  }

  function renderCallAuditButton(rider, context = {}) {
    if (!rider?.matchedRiderId) return '-';
    const label = rider.driverName || rider.riderName || '기사';
    const applyBtn = rider.callCountMatched === false
      ? `<button type="button" class="small-btn weekly-apply-call-btn"
        data-weekly-apply-call="1"
        data-driver-id="${escapeHtml(rider.matchedRiderId)}"
        data-platform="${escapeHtml(context.platform || 'coupang')}"
        data-start-date="${escapeHtml(context.startDate || '')}"
        data-end-date="${escapeHtml(context.endDate || '')}"
        data-weekly-order-count="${Number(rider.weeklyOrderCount || 0)}"
        data-driver-label="${escapeHtml(label)}"
        title="주간정산서 오더수로 콜수를 맞춥니다. 콜수입력·일정산 기록이 조정됩니다."
      >주간서 기준 입력</button>`
      : '';
    return `<div class="weekly-call-action-cell">
      <button type="button" class="small-btn weekly-call-audit-btn"
        data-weekly-call-audit="1"
        data-driver-id="${escapeHtml(rider.matchedRiderId)}"
        data-platform="${escapeHtml(context.platform || 'coupang')}"
        data-start-date="${escapeHtml(context.startDate || '')}"
        data-end-date="${escapeHtml(context.endDate || '')}"
        data-weekly-order-count="${Number(rider.weeklyOrderCount || 0)}"
        data-stored-system-call-count="${Number(rider.systemCallCount || 0)}"
        data-driver-label="${escapeHtml(label)}"
      >상세분석</button>
      ${applyBtn}
    </div>`;
  }

  function formatAuditSource(source) {
    if (source === 'settlement') return '일정산';
    if (source === 'call') return '콜입력';
    return '없음';
  }

  function formatAuditStatusClass(day) {
    if (day.status === 'missing') return 'weekly-call-audit-row-missing';
    if (day.status === 'duplicate_settlement') return 'weekly-call-audit-row-duplicate';
    if (day.usedCount > 0) return 'weekly-call-audit-row-ok';
    return '';
  }

  function formatSettlementRecordsCell(day) {
    if (!day.settlements?.length) return '-';
    return day.settlements.map(row => {
      const used = day.usedSettlementId && row.id === day.usedSettlementId;
      const tag = used ? ' ✓반영' : ' (미반영)';
      const className = used ? 'weekly-call-audit-record-used' : 'weekly-call-audit-record-skipped';
      return (
        `<span class="weekly-call-audit-record ${className}">${formatNumber(row.orderCount)}건${tag}${day.settlements.length > 1 ? ` · ${escapeHtml(String(row.id).slice(0, 8))}` : ''}</span>`
      );
    }).join('<br>');
  }

  function formatCallRecordsCell(day) {
    if (!day.calls?.length) return '-';
    return day.calls.map(row => `${formatNumber(row.count)}건`).join('<br>');
  }

  async function applyWeeklyCallFromReport(params = {}) {
    const driverId = String(params.driverId || '').trim();
    const platform = params.platform || 'coupang';
    const startDate = params.startDate || '';
    const endDate = params.endDate || '';
    const weeklyOrderCount = Number(params.weeklyOrderCount || 0);
    const driverLabel = params.driverLabel || '기사';

    if (!driverId) {
      showToast('매칭된 기사가 없어 적용할 수 없습니다.');
      return;
    }

    const orderLabel = platformWeeklyOrderLabel(platform);
    const confirmMessage = [
      `${driverLabel} 기사의 콜수를 주간정산서 기준으로 맞출까요?`,
      '',
      `주간서 ${orderLabel}: ${formatNumber(weeklyOrderCount)}건`,
      '일정산·콜수입력 기록이 함께 조정되며, 콜수입력 메뉴에도 반영됩니다.',
      '적용 후 「라이더 앱 반영」을 누르면 기사 앱에도 갱신됩니다.'
    ].join('\n');

    if (!window.confirm(confirmMessage)) return;

    try {
      await BremStorage.ensureSectionLoaded?.('settlements');
      await BremStorage.ensureSectionLoaded?.('calls');

      const result = BremWeeklySettlement.applyWeeklySettlementCallCount({
        driverId,
        startDate,
        endDate,
        platform,
        weeklyOrderCount
      });

      await BremStorage.flushStorage?.();

      if (state.previewByPlatform[platform]) {
        state.previewByPlatform[platform] = BremWeeklySettlement.refreshWeeklySettlementRiders(
          state.previewByPlatform[platform]
        );
        renderPreview(platform);
      }

      if (state.detailId) {
        const record = BremStorage.weeklySettlements.getById(state.detailId);
        if (record) renderDetail(record);
      }

      document.dispatchEvent(new CustomEvent('brem-calls-changed'));

      if (!result.applied) {
        showToast(`${driverLabel} · 이미 주간서와 콜수가 일치합니다.`);
        return;
      }

      const matched = result.systemCallCount === weeklyOrderCount;
      showToast(
        matched
          ? `${driverLabel} · 주간서 ${formatNumber(weeklyOrderCount)}건으로 콜수 입력 완료`
          : `${driverLabel} · ${formatNumber(weeklyOrderCount)}건 적용 (현재 합계 ${formatNumber(result.systemCallCount)}건 — 상세분석에서 확인)`
      );
    } catch (error) {
      console.error('[BREM] weekly call apply failed:', error);
      showToast(error.message || '주간정산서 기준 콜수 입력에 실패했습니다.');
    }
  }

  function hideCallAudit() {
    const card = $('#weeklySettlementCallAuditCard');
    if (card) card.hidden = true;
  }

  async function openCallAudit(params = {}) {
    const driverId = String(params.driverId || '').trim();
    if (!driverId) {
      showToast('매칭된 기사가 없어 분석할 수 없습니다.');
      return;
    }

    try {
      await BremStorage.ensureSectionLoaded?.('settlements');
      await BremStorage.ensureSectionLoaded?.('calls');
      await BremStorage.ensureSectionLoaded?.('weekly-settlement');

      const audit = BremWeeklySettlement.buildDriverCallAudit(
        driverId,
        params.startDate,
        params.endDate,
        params.platform,
        params.weeklyOrderCount
      );
      renderCallAuditPanel(audit, params.driverLabel, {
        storedSystemCallCount: params.storedSystemCallCount
      });
    } catch (error) {
      console.error('[BREM] call audit failed:', error);
      showToast(error.message || '콜수 상세 분석 중 오류가 발생했습니다.');
    }
  }

  function renderCallAuditPanel(audit, driverLabel = '', options = {}) {
    const card = $('#weeklySettlementCallAuditCard');
    const titleEl = $('#weeklySettlementCallAuditTitle');
    const metaEl = $('#weeklySettlementCallAuditMeta');
    const insightsEl = $('#weeklySettlementCallAuditInsights');
    const rowsEl = $('#weeklySettlementCallAuditRows');
    if (!card || !metaEl || !rowsEl) return;

    card.hidden = false;
    const orderLabel = platformWeeklyOrderLabel(audit.platform);
    const storedSystemCallCount = options.storedSystemCallCount;
    const storedDiffers = storedSystemCallCount !== null
      && storedSystemCallCount !== undefined
      && Number(storedSystemCallCount) !== Number(audit.systemCallCount);
    if (titleEl) {
      titleEl.textContent = `콜수 상세 분석 · ${driverLabel || audit.driverName || '기사'}`;
    }

    const deltaText = audit.delta === null
      ? '-'
      : (audit.delta === 0 ? '0건 (일치)' : `${audit.delta > 0 ? '+' : ''}${formatNumber(audit.delta)}건`);

    metaEl.innerHTML = `
      <p>기사: <strong>${escapeHtml(audit.driverName || driverLabel || '-')}</strong> · ${escapeHtml(platformLabel(audit.platform))}</p>
      <p>정산기간: <strong>${escapeHtml(audit.startDate)} ~ ${escapeHtml(audit.endDate)}</strong></p>
      <p>주간서 ${escapeHtml(orderLabel)}: <strong>${audit.weeklyOrderCount === null ? '-' : formatNumber(audit.weeklyOrderCount)}</strong>
        · 시스템 합계(일정산): <strong>${formatNumber(audit.systemCallCount)}</strong>
        · 차이: <strong class="${audit.delta ? 'weekly-call-audit-delta-warn' : ''}">${escapeHtml(deltaText)}</strong></p>
      ${storedDiffers ? `<p class="weekly-call-audit-stale">저장된 시스템 콜수 <strong>${formatNumber(storedSystemCallCount)}</strong> → 현재 재계산 <strong>${formatNumber(audit.systemCallCount)}</strong> (일정산 다시 불러옴)</p>` : ''}
      <p class="form-help">주간서 ${escapeHtml(orderLabel)}는 <strong>주간정산서 엑셀</strong> 값, 시스템 합계는 <strong>일정산 업로드 합</strong>입니다. 숫자가 다르면 둘 중 어느 쪽이 맞는지 확인하세요.</p>
      <p class="form-help">시스템 합계는 일정산 우선 · 없으면 콜입력 · 같은 날 일정산 중복 시 <strong>마지막 1건</strong>만 반영됩니다.</p>
    `;

    if (insightsEl) {
      insightsEl.innerHTML = audit.insights?.length
        ? `<ul class="weekly-call-audit-insight-list">${audit.insights.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : '';
    }

    rowsEl.innerHTML = (audit.dayAudits || []).map(day => `
      <tr class="${formatAuditStatusClass(day)}">
        <td><strong>${escapeHtml(day.label)}</strong><span class="weekly-call-audit-date">${escapeHtml(day.date)}</span></td>
        <td><strong>${formatNumber(day.usedCount)}</strong></td>
        <td><strong>${formatNumber(day.cumulativeSum || 0)}</strong></td>
        <td>${escapeHtml(formatAuditSource(day.source))}${day.status === 'duplicate_settlement' ? ' <span class="weekly-call-audit-tag">중복</span>' : ''}</td>
        <td class="weekly-call-audit-records">${formatSettlementRecordsCell(day)}</td>
        <td>${formatCallRecordsCell(day)}</td>
        <td class="weekly-call-audit-hints">${(day.uploadHints || []).map(hint => `<span class="weekly-call-audit-hint">${escapeHtml(hint)}</span>`).join('<br>') || '-'}</td>
      </tr>
    `).join('') || '<tr><td colspan="7" class="empty">분석할 일별 데이터가 없습니다.</td></tr>';

    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderPreview(platform) {
    let record = state.previewByPlatform[platform];
    const card = $(`#weeklySettlementPreviewCard-${platform}`);
    const rowsEl = $(`#weeklySettlementPreviewRows-${platform}`);
    if (!card || !rowsEl) return;

    if (!record) {
      card.hidden = true;
      rowsEl.innerHTML = '';
      return;
    }

    record = BremWeeklySettlement.refreshWeeklySettlementRiders(record);
    state.previewByPlatform[platform] = record;

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

    const auditContext = {
      platform,
      startDate: record.startDate,
      endDate: record.endDate
    };

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
        <td>${renderCallAuditButton(rider, auditContext)}</td>
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
        <td>-</td>
      </tr>
    `;
    }).join('');

    rowsEl.innerHTML = matchedRows + unmatchedRows || '<tr><td colspan="9" class="empty">데이터 없음</td></tr>';
  }

  function unmatchedDefaultWarning(platform) {
    return platform === 'baemin' ? '배민 User ID 미매칭' : '쿠팡 ID(이름+연락처)/기사명 미매칭';
  }

  function renderWeeklyUnmatched(platform) {
    const rowsEl = $(`#weeklySettlementUnmatchedRows-${platform}`);
    if (!rowsEl) return;

    const weekStart = ensureWeeklyLogWeek(platform);
    updateWeeklyLogWeekRangeLabel(platform);
    const label = $(`#weeklySettlementUnmatchedLabel-${platform}`);
    if (label) {
      label.textContent = weekStart ? `· ${formatDate(weekStart)} 주` : '';
    }

    const rows = BremStorage.settlementUnmatched.getByWeek({
      weekStart,
      platform,
      kind: 'weekly'
    }).sort((a, b) => b.savedAt.localeCompare(a.savedAt));

    if (!rows.length) {
      rowsEl.innerHTML = `<tr><td colspan="8" class="empty">${formatDate(weekStart)} 주 ${platformLabel(platform)} 주정산 미매칭 기사가 없습니다.</td></tr>`;
      return;
    }

    rowsEl.innerHTML = rows.map(record => {
      const periodLabel = record.period && record.endDate
        ? `${escapeHtml(record.period)} ~ ${escapeHtml(record.endDate)}`
        : '-';
      const idValue = platform === 'baemin'
        ? (record.baeminUserId || '-')
        : (record.coupangLoginKey || '-');
      return `
      <tr>
        <td>${periodLabel}</td>
        <td>${escapeHtml(record.region || '-')}</td>
        <td>${escapeHtml(record.rawName || record.name)}</td>
        <td>${escapeHtml(idValue)}</td>
        <td>${formatNumber(record.orderCount)}</td>
        <td>${escapeHtml(record.sourceFileName || '-')}</td>
        <td>${formatDate(String(record.savedAt || '').slice(0, 10))}</td>
        <td>
          <button type="button" class="small-btn" data-weekly-retry-unmatched="${record.id}">재시도</button>
        </td>
      </tr>
    `;
    }).join('');
  }

  function retryWeeklyUnmatched(platform, options = {}) {
    const weekStart = ensureWeeklyLogWeek(platform);
    const recordIds = Array.isArray(options.recordIds) ? options.recordIds : [];
    const pendingCount = BremStorage.settlementUnmatched.getByWeek({
      weekStart,
      platform,
      kind: 'weekly'
    }).filter(record => !recordIds.length || recordIds.includes(record.id)).length;
    if (!pendingCount) {
      showToast(recordIds.length ? '재시도할 미매칭 기사가 없습니다.' : '선택한 주에 미매칭 기사가 없습니다.');
      return;
    }

    void (async () => {
      try {
        await BremStorage.refreshDriversForSettlementMatch?.();
        await BremStorage.ensureSectionLoaded('weeklySettlements');
        const result = BremStorage.settlementUnmatched.retryWeeklyMatching({
          platform,
          weekStart,
          recordIds
        });
        await BremStorage.flushStorage?.();

        if (result.needsManualSave && result.matched?.length) {
          state.previewByPlatform[platform] = {
            platform,
            region: result.region || '',
            startDate: result.startDate,
            endDate: result.endDate,
            fileName: '',
            riders: result.matched,
            previewUnmatched: [],
            summary: BremWeeklySettlement.buildWeeklySummary(result.matched, []),
            uploadedAt: new Date().toISOString()
          };
          renderPreview(platform);
          showToast(`매칭 ${result.matchedCount}명 — 저장된 주정산이 없어 미리보기를 열었습니다. 「매칭 기사만 저장」을 눌러주세요.`);
        } else {
          let message = `매칭 재시도: ${result.matchedCount}명`;
          if (result.mergedToSaved) message += ` · 저장된 주정산에 ${result.mergedToSaved}명 반영`;
          if (result.stillUnmatchedCount) message += ` · 미매칭 ${result.stillUnmatchedCount}명 유지`;
          if (!result.matchedCount) {
            message = '새로 등록한 기사와 매칭되지 않았습니다. 배민 User ID·쿠팡 ID를 확인하세요.';
          }
          showToast(message);
        }

        renderWeeklyUnmatched(platform);
        renderSavedList(platform);
        if (typeof BremPromotionApplyAdmin !== 'undefined') BremPromotionApplyAdmin.refresh();
      } catch (error) {
        console.error('[BREM] weekly unmatched retry failed:', error);
        showToast(error.message || '매칭 재시도에 실패했습니다.');
      }
    })();
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
            <th>분석 · 적용</th>
          </tr>`;
    }
    const auditContext = {
      platform: record.platform,
      startDate: period.startDate,
      endDate: period.endDate
    };
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
        <td>${renderCallAuditButton(rider, auditContext)}</td>
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
      renderWeeklyUnmatched(platform);
    });
    $(`#weeklySettlementUnmatchedRetryBtn-${platform}`)?.addEventListener('click', () => {
      retryWeeklyUnmatched(platform);
    });
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;
    PLATFORMS.forEach(bindPlatformEvents);
    $('#weeklySettlementDetailClose')?.addEventListener('click', hideDetail);
    $('#weeklySettlementCallAuditClose')?.addEventListener('click', hideCallAudit);
    document.addEventListener('click', event => {
      const auditBtn = event.target.closest('[data-weekly-call-audit]');
      if (auditBtn) {
        openCallAudit({
          driverId: auditBtn.dataset.driverId,
          platform: auditBtn.dataset.platform,
          startDate: auditBtn.dataset.startDate,
          endDate: auditBtn.dataset.endDate,
          weeklyOrderCount: Number(auditBtn.dataset.weeklyOrderCount || 0),
          storedSystemCallCount: Number(auditBtn.dataset.storedSystemCallCount || 0),
          driverLabel: auditBtn.dataset.driverLabel || ''
        });
        return;
      }
      const applyCallBtn = event.target.closest('[data-weekly-apply-call]');
      if (applyCallBtn) {
        void applyWeeklyCallFromReport({
          driverId: applyCallBtn.dataset.driverId,
          platform: applyCallBtn.dataset.platform,
          startDate: applyCallBtn.dataset.startDate,
          endDate: applyCallBtn.dataset.endDate,
          weeklyOrderCount: Number(applyCallBtn.dataset.weeklyOrderCount || 0),
          driverLabel: applyCallBtn.dataset.driverLabel || ''
        });
        return;
      }
      const weeklyRetryBtn = event.target.closest('[data-weekly-retry-unmatched]');
      if (weeklyRetryBtn) {
        const panel = weeklyRetryBtn.closest('.admin-platform-panel[data-platform]');
        const platform = panel?.dataset?.platform || platformFromEvent(event);
        retryWeeklyUnmatched(platform, { recordIds: [weeklyRetryBtn.dataset.weeklyRetryUnmatched] });
        return;
      }
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
      renderWeeklyUnmatched(platform);
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
