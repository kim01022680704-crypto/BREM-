const BremWeeklySettlementAdmin = (function () {
  const CHANNELS = ['bro', 'direct'];
  const PLATFORMS = ['coupang', 'baemin'];

  const state = {
    // per-channel, per-platform
    previewByChannel: {
      bro: { coupang: null, baemin: null },
      direct: { coupang: null, baemin: null }
    },
    weeklyLogWeekByChannel: {
      bro: { coupang: null, baemin: null },
      direct: { coupang: null, baemin: null }
    },
    detailId: ''
  };

  const $ = selector => document.querySelector(selector);

  function normChannel(channel) {
    return channel === 'direct' ? 'direct' : 'bro';
  }

  function prefix(channel) {
    return normChannel(channel) === 'direct' ? 'weeklySettlementDirect' : 'weeklySettlement';
  }

  function sectionIdFor(channel) {
    return normChannel(channel) === 'direct' ? 'weekly-settlement-direct' : 'weekly-settlement';
  }

  // element lookup: q(channel, 'UploadForm', 'coupang') → #weeklySettlementUploadForm-coupang
  function q(channel, thing, platform) {
    return $(`#${prefix(channel)}${thing}-${platform}`);
  }

  function getPreview(channel, platform) {
    return state.previewByChannel[normChannel(channel)][platform];
  }

  function setPreview(channel, platform, value) {
    state.previewByChannel[normChannel(channel)][platform] = value;
  }

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

  // 직계약 정산서 금액/공제 열 (미리보기·상세에 표시).
  // 배민과 쿠팡은 정산서 서식이 달라 뽑는 항목도 다르다.
  const DIRECT_AMOUNT_FIELDS_BAEMIN = [
    { key: 'deliveryFee', label: '배달료(E)' },
    { key: 'missionPay', label: '추가지급(F)' },
    { key: 'totalDeliveryPay', label: '총배달료(G)' },
    { key: 'hourlyInsurance', label: '시간제보험(H)' },
    { key: 'employmentInsurance', label: '고용보험(L)' },
    { key: 'accidentInsurance', label: '산재보험(N)' },
    { key: 'withholdingTax', label: '원천세(Y)' }
  ];

  const DIRECT_AMOUNT_FIELDS_COUPANG = [
    { key: 'deliveryFee', label: '배달료(AM)' },
    { key: 'deductionDetail', label: '차감내역(AB)' },
    { key: 'deductionBase', label: '원천세기준(AC)' },
    { key: 'withholdingTax', label: '원천세(AC×3.3%)' },
    { key: 'employmentInsurance', label: '고용보험(AE)' },
    { key: 'accidentInsurance', label: '산재보험(AG)' },
    { key: 'hourlyInsurance', label: '시간제보험(AH)' }
  ];

  function directAmountFields(platform) {
    return platform === 'coupang' ? DIRECT_AMOUNT_FIELDS_COUPANG : DIRECT_AMOUNT_FIELDS_BAEMIN;
  }

  function isDirectAmountView(channel, platform) {
    if (normChannel(channel) !== 'direct') return false;
    return platform === 'baemin' || platform === 'coupang';
  }

  function directAmountHeadCells(channel, platform) {
    if (!isDirectAmountView(channel, platform)) return '';
    return directAmountFields(platform).map(f => `<th>${escapeHtml(f.label)}</th>`).join('');
  }

  function directAmountBodyCells(rider, channel, platform) {
    if (!isDirectAmountView(channel, platform)) return '';
    const amounts = rider?.amounts || {};
    return directAmountFields(platform)
      .map(f => `<td class="weekly-amount-cell">${formatNumber(amounts[f.key] || 0)}</td>`)
      .join('');
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

  function ensureWeeklyLogWeek(channel, platform) {
    const ch = normChannel(channel);
    if (!state.weeklyLogWeekByChannel[ch][platform]) {
      state.weeklyLogWeekByChannel[ch][platform] = weekStartKey();
    }
    const input = q(channel, 'LogWeek', platform);
    if (input && !input.value) {
      input.value = state.weeklyLogWeekByChannel[ch][platform];
    }
    return state.weeklyLogWeekByChannel[ch][platform];
  }

  function updateWeeklyLogWeekRangeLabel(channel, platform) {
    const weekStart = ensureWeeklyLogWeek(channel, platform);
    const label = q(channel, 'LogWeekRange', platform);
    if (label) {
      label.textContent = weekStart
        ? `표시 범위: ${formatDate(weekStart)}(수) ~ ${formatDate(weekEndKey(weekStart))}(화)`
        : '';
    }
  }

  function fillCoupangDatesFromBase(channel) {
    const baseInput = q(channel, 'BaseDate', 'coupang');
    if (!baseInput?.value) return;
    if (window.BremDatePicker?.applyWeekWednesday) {
      const normalized = BremDatePicker.applyWeekWednesday(baseInput.value);
      if (normalized && normalized !== baseInput.value) {
        baseInput.value = normalized;
      }
    }
    const dates = BremWeeklySettlement.calculateCoupangSettlementDates(baseInput.value);
    const startInput = q(channel, 'StartDate', 'coupang');
    const endInput = q(channel, 'EndDate', 'coupang');
    const paymentInput = q(channel, 'PaymentDate', 'coupang');
    if (startInput) startInput.value = dates.startDate;
    if (endInput) endInput.value = dates.endDate;
    if (paymentInput) paymentInput.value = dates.paymentDate;
  }

  function applyFilenameHints(channel, platform, fileName) {
    if (!fileName) return;
    if (platform === 'coupang') {
      const parsed = BremWeeklySettlement.parseCoupangFileName(fileName);
      const regionInput = q(channel, 'Region', 'coupang');
      const weekLabelInput = q(channel, 'WeekLabel', 'coupang');
      if (regionInput && parsed.region) regionInput.value = parsed.region;
      if (weekLabelInput && parsed.settlementWeekLabel) weekLabelInput.value = parsed.settlementWeekLabel;
      return;
    }
    const parsed = BremWeeklySettlement.parseBaeminFileName(fileName);
    const regionInput = q(channel, 'Region', 'baemin');
    const startInput = q(channel, 'StartDate', 'baemin');
    const endInput = q(channel, 'EndDate', 'baemin');
    const paymentInput = q(channel, 'PaymentDate', 'baemin');
    const weekLabelInput = q(channel, 'WeekLabel', 'baemin');
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

  // 매칭 기준이 되는 ID는 눈에 바로 들어와야 해서 태그로 감싼다.
  function riderMatchIdTag(rider, platform) {
    const value = riderMatchIdValue(rider, platform);
    if (!value || value === '-') return '-';
    return `<span class="weekly-id-tag">${escapeHtml(value)}</span>`;
  }

  // 기사명 가나다순. 파일에 적힌 순서대로 두면 찾기 어렵다.
  function byDriverName(nameOf) {
    return (a, b) => String(nameOf(a) || '').localeCompare(String(nameOf(b) || ''), 'ko-KR');
  }

  function isDirectBaemin(channel, platform) {
    return normChannel(channel) === 'direct' && platform === 'baemin';
  }

  function isDirectCoupang(channel, platform) {
    return normChannel(channel) === 'direct' && platform === 'coupang';
  }

  function readDirectBaeminAmountColumns(channel) {
    return {
      deliveryFee: q(channel, 'DeliveryFeeCol', 'baemin')?.value?.trim() || 'E',
      missionPay: q(channel, 'MissionPayCol', 'baemin')?.value?.trim() || 'F',
      totalDeliveryPay: q(channel, 'TotalPayCol', 'baemin')?.value?.trim() || 'G',
      hourlyInsurance: q(channel, 'HourlyInsCol', 'baemin')?.value?.trim() || 'H',
      employmentInsurance: q(channel, 'EmploymentInsCol', 'baemin')?.value?.trim() || 'L',
      accidentInsurance: q(channel, 'AccidentInsCol', 'baemin')?.value?.trim() || 'N',
      withholdingTax: q(channel, 'WithholdingTaxCol', 'baemin')?.value?.trim() || 'Y'
    };
  }

  function readDirectCoupangAmountColumns(channel) {
    return {
      deliveryFee: q(channel, 'DeliveryFeeCol', 'coupang')?.value?.trim() || 'AM',
      deductionDetail: q(channel, 'DeductionDetailCol', 'coupang')?.value?.trim() || 'AB',
      deductionBase: q(channel, 'DeductionBaseCol', 'coupang')?.value?.trim() || 'AC',
      employmentInsurance: q(channel, 'EmploymentInsCol', 'coupang')?.value?.trim() || 'AE',
      accidentInsurance: q(channel, 'AccidentInsCol', 'coupang')?.value?.trim() || 'AG',
      hourlyInsurance: q(channel, 'HourlyInsCol', 'coupang')?.value?.trim() || 'AH'
    };
  }

  function readUploadForm(channel, platform) {
    if (platform === 'coupang') fillCoupangDatesFromBase(channel);
    // 직계약은 시작행을 여유있게 앞으로 두고, 오더수(콜수)가 숫자인 행만 읽어 헤더행을 건너뛴다.
    const startRowDefault = isDirectBaemin(channel, platform)
      ? 15
      : (platform === 'coupang' ? 12 : 2);
    const columnConfig = {
      nameColumn: q(channel, 'NameCol', platform)?.value || 'C',
      userIdColumn: platform === 'baemin'
        ? (q(channel, 'UserIdCol', 'baemin')?.value || 'B')
        : '',
      orderCountColumn: q(channel, 'OrderCol', platform)?.value
        || (platform === 'baemin' ? 'D' : 'F'),
      startRow: Number(q(channel, 'StartRow', platform)?.value || startRowDefault)
    };
    if (isDirectBaemin(channel, platform)) {
      columnConfig.amountColumns = readDirectBaeminAmountColumns(channel);
    } else if (isDirectCoupang(channel, platform)) {
      columnConfig.amountColumns = readDirectCoupangAmountColumns(channel);
    }
    return {
      platform,
      channel: normChannel(channel),
      region: q(channel, 'Region', platform)?.value?.trim() || '',
      baseSettlementDate: q(channel, 'BaseDate', platform)?.value
        || q(channel, 'StartDate', platform)?.value || '',
      startDate: q(channel, 'StartDate', platform)?.value || '',
      endDate: q(channel, 'EndDate', platform)?.value || '',
      paymentDate: q(channel, 'PaymentDate', platform)?.value || '',
      settlementWeekLabel: q(channel, 'WeekLabel', platform)?.value?.trim() || '',
      password: q(channel, 'Password', platform)?.value || '',
      file: q(channel, 'File', platform)?.files?.[0] || null,
      columnConfig
    };
  }

  function validateUploadForm(payload) {
    if (!payload.region) return '지역을 입력하세요.';
    if (!payload.startDate || !payload.endDate) return '정산 시작일과 종료일을 입력하세요.';
    if (!payload.file) return '엑셀 파일을 선택하세요.';
    return '';
  }

  async function uploadAndMatch(channel, platform) {
    const ch = normChannel(channel);
    const payload = readUploadForm(channel, platform);
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
        channel: ch,
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
      setPreview(ch, platform, record);
      if (record.previewUnmatched?.length) {
        BremStorage.settlementUnmatched.saveWeeklyBatch({
          weekStart: weekStartKey(record.startDate || payload.startDate),
          startDate: record.startDate,
          endDate: record.endDate,
          records: record.previewUnmatched,
          sourceFileName: payload.file.name,
          platform,
          region: record.region,
          channel: ch
        });
      }
      renderPreview(ch, platform);
      renderSavedList(ch, platform);
      renderWeeklyUnmatched(ch, platform);
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

  function savePreview(channel, platform) {
    const ch = normChannel(channel);
    const record = getPreview(ch, platform);
    if (!record) {
      showToast('먼저 업로드 및 매칭을 실행하세요.');
      return;
    }
    if (!record.riders?.length) {
      showToast('매칭된 기사가 없어 저장할 수 없습니다.');
      return;
    }
    const { previewUnmatched, ...saveRecord } = record;
    saveRecord.channel = ch;
    const refreshedRecord = BremWeeklySettlement.refreshWeeklySettlementRiders(saveRecord);
    refreshedRecord.channel = ch;
    refreshedRecord.summary = {
      ...(refreshedRecord.summary || {}),
      totalExtracted: refreshedRecord.riders.length,
      matchedRiders: refreshedRecord.riders.length,
      unmatchedRiders: 0,
      callCountMismatches: refreshedRecord.riders.filter(r => isMismatchRider(r)).length,
      channel: ch
    };
    const saved = BremWeeklySettlement.saveWeeklySettlement(refreshedRecord);
    if (record.uploadLogId) {
      BremStorage.settlementUploadLogs.update(record.uploadLogId, {
        status: 'saved',
        channel: ch,
        linkedRecordId: saved.id,
        matchedCount: saveRecord.riders.length,
        fileName: saveRecord.fileName || record.fileName || ''
      });
    } else {
      BremStorage.settlementUploadLogs.add({
        kind: 'weekly',
        channel: ch,
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
    setPreview(ch, platform, null);
    const card = q(ch, 'PreviewCard', platform);
    if (card) card.hidden = true;
    renderSavedList(ch, platform);
    renderWeeklyUnmatched(ch, platform);
    if (typeof BremPromotionApplyAdmin !== 'undefined') BremPromotionApplyAdmin.refresh();
    showToast(`${record.region} · 매칭 ${record.riders.length}명 저장 완료`);
  }

  function formatCallMismatchWarnings(rider) {
    const lines = (rider.warnings || []).filter(Boolean);
    if (!lines.length) return '-';
    return lines.map(line => `<span class="weekly-mismatch-line">${escapeHtml(line)}</span>`).join('');
  }

  function callCountStatusHtml(rider) {
    if (BremWeeklySettlement.isCallCountIgnored?.(rider) || rider?.callCountIgnored === true) {
      return '<span class="promotion-status-ok weekly-call-ignored-badge">승인(콜수무시)</span>';
    }
    if (rider?.callCountMatched === false) {
      return '<span class="promotion-status-no">불일치</span>';
    }
    return '<span class="promotion-status-ok">일치</span>';
  }

  function isMismatchRider(rider) {
    if (typeof BremWeeklySettlement.isCallCountMismatch === 'function') {
      return BremWeeklySettlement.isCallCountMismatch(rider);
    }
    return rider?.callCountMatched === false && rider?.callCountIgnored !== true;
  }

  function renderCallAuditButton(rider, context = {}) {
    if (!rider?.matchedRiderId) return '-';
    const label = rider.driverName || rider.riderName || '기사';
    const ignored = rider.callCountIgnored === true;
    const mismatch = isMismatchRider(rider);
    const ignoreBtn = mismatch
      ? `<button type="button" class="small-btn weekly-ignore-call-btn"
        data-weekly-ignore-call="1"
        data-driver-id="${escapeHtml(rider.matchedRiderId)}"
        data-platform="${escapeHtml(context.platform || 'coupang')}"
        data-channel="${escapeHtml(context.channel || 'bro')}"
        data-settlement-id="${escapeHtml(context.settlementId || '')}"
        data-driver-label="${escapeHtml(label)}"
        title="시스템 콜수는 그대로 두고, 콜수 불일치 경고만 승인합니다. 정산금액은 주간서 기준으로 유지됩니다."
      >콜수무시 승인</button>`
      : '';
    const undoIgnoreBtn = ignored
      ? `<button type="button" class="small-btn weekly-undo-ignore-call-btn"
        data-weekly-undo-ignore-call="1"
        data-driver-id="${escapeHtml(rider.matchedRiderId)}"
        data-platform="${escapeHtml(context.platform || 'coupang')}"
        data-channel="${escapeHtml(context.channel || 'bro')}"
        data-settlement-id="${escapeHtml(context.settlementId || '')}"
        data-driver-label="${escapeHtml(label)}"
        title="콜수무시 승인을 취소하고 불일치 경고를 다시 표시합니다."
      >승인취소</button>`
      : '';
    const applyBtn = mismatch
      ? `<button type="button" class="small-btn weekly-apply-call-btn"
        data-weekly-apply-call="1"
        data-driver-id="${escapeHtml(rider.matchedRiderId)}"
        data-platform="${escapeHtml(context.platform || 'coupang')}"
        data-channel="${escapeHtml(context.channel || 'bro')}"
        data-start-date="${escapeHtml(context.startDate || '')}"
        data-end-date="${escapeHtml(context.endDate || '')}"
        data-weekly-order-count="${Number(rider.weeklyOrderCount || 0)}"
        data-driver-label="${escapeHtml(label)}"
        title="주간정산서 오더수로 콜수를 맞춥니다. 콜수입력·일정산 기록이 조정됩니다. 여러 권역 콜이 있으면 쓰지 마세요."
      >주간서 기준 입력</button>`
      : '';
    return `<div class="weekly-call-action-cell">
      <button type="button" class="small-btn weekly-call-audit-btn"
        data-weekly-call-audit="1"
        data-driver-id="${escapeHtml(rider.matchedRiderId)}"
        data-platform="${escapeHtml(context.platform || 'coupang')}"
        data-channel="${escapeHtml(context.channel || 'bro')}"
        data-start-date="${escapeHtml(context.startDate || '')}"
        data-end-date="${escapeHtml(context.endDate || '')}"
        data-weekly-order-count="${Number(rider.weeklyOrderCount || 0)}"
        data-stored-system-call-count="${Number(rider.systemCallCount || 0)}"
        data-driver-label="${escapeHtml(label)}"
      >상세분석</button>
      ${ignoreBtn}
      ${undoIgnoreBtn}
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
    const channel = normChannel(params.channel);
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
      '해당 주간의 기존 일정산·콜수 기록을 지우고, 정산 마지막 날에 주간서 총 콜수를 콜수입력으로 넣습니다.',
      '콜수입력 메뉴·대시보드에 바로 반영됩니다.',
      '적용 후 「라이더 앱 반영」을 누르면 기사 앱에도 갱신됩니다.'
    ].join('\n');

    if (!window.confirm(confirmMessage)) return;

    try {
      await BremStorage.ensureSectionLoaded?.('settlements');
      await BremStorage.ensureSectionLoaded?.('calls');

      const result = await BremWeeklySettlement.applyWeeklySettlementCallCount({
        driverId,
        startDate,
        endDate,
        platform,
        weeklyOrderCount
      });

      document.dispatchEvent(new CustomEvent('brem-calls-changed'));

      const preview = getPreview(channel, platform);
      if (preview) {
        setPreview(channel, platform, BremWeeklySettlement.refreshWeeklySettlementRiders(preview));
        renderPreview(channel, platform);
      }

      if (state.detailId) {
        const record = BremStorage.weeklySettlements.getById(state.detailId);
        if (record) renderDetail(record);
      }

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
      const raw = String(error?.message || '');
      const friendly = raw.includes('cannot affect row a second time')
        ? '같은 콜수 기록이 중복되어 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.'
        : (raw || '주간정산서 기준 콜수 입력에 실패했습니다.');
      showToast(friendly);
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

  function renderPreview(channel, platform) {
    const ch = normChannel(channel);
    let record = getPreview(ch, platform);
    const card = q(ch, 'PreviewCard', platform);
    const rowsEl = q(ch, 'PreviewRows', platform);
    if (!card || !rowsEl) return;

    if (!record) {
      card.hidden = true;
      rowsEl.innerHTML = '';
      return;
    }

    record = BremWeeklySettlement.refreshWeeklySettlementRiders(record);
    setPreview(ch, platform, record);

    card.hidden = false;
    const unmatched = record.previewUnmatched || [];
    const mismatchCount = record.summary.callCountMismatches || 0;
    const orderLabel = platformWeeklyOrderLabel(platform);
    const summaryExtra = mismatchCount
      ? `<p class="weekly-call-mismatch-banner">⚠ 콜수 미매칭 <strong>${formatNumber(mismatchCount)}</strong>명 — 여러 권역 콜이면 「콜수무시 승인」, 콜수를 주간서에 맞출 때만 「주간서 기준 입력」.</p>`
      : '';

    const matchBasisLabel = platform === 'baemin'
      ? '배민 User ID ↔ 기사 배민 ID'
      : '정산표/콜수 기준';
    const summaryEl = q(ch, 'PreviewSummary', platform);
    if (summaryEl) {
      summaryEl.innerHTML = `
      <p>추출 인수 <strong>${formatNumber(record.summary.totalExtracted)}</strong>명</p>
      <p>매칭 <strong>${formatNumber(record.summary.matchedRiders)}</strong>명 (${matchBasisLabel})</p>
      <p>미매칭 <strong>${formatNumber(record.summary.unmatchedRiders)}</strong>명</p>
      <p>콜수 불일치 <strong>${formatNumber(mismatchCount)}</strong>명</p>
      <p>저장 대상 <strong>${formatNumber(record.riders.length)}</strong>명 (매칭된 기사만)</p>
      ${summaryExtra}
    `;
    }

    const auditContext = {
      platform,
      channel: ch,
      startDate: record.startDate,
      endDate: record.endDate,
      settlementId: record.id || ''
    };

    // 저장 순서를 바꾸지 않으려고 원본 배열은 그대로 두고 사본을 정렬한다.
    const matchedRows = [...(record.riders || [])]
      .sort(byDriverName(r => r.driverName || r.riderName))
      .map(rider => {
      const warningText = formatCallMismatchWarnings(rider);
      const rowClass = isMismatchRider(rider) ? 'promotion-row-unpaid' : '';
      return `
      <tr class="${rowClass}">
        <td><strong>${escapeHtml(rider.driverName || rider.riderName)}</strong></td>
        <td>${escapeHtml(rider.originalName)}</td>
        <td>${riderMatchIdTag(rider, platform)}</td>
        <td>${formatNumber(rider.weeklyOrderCount)}</td>
        ${directAmountBodyCells(rider, ch, platform)}
        <td>${formatNumber(rider.systemCallCount)}</td>
        <td>${callCountStatusHtml(rider)}</td>
        <td class="promotion-status-ok">매칭</td>
        <td class="weekly-warning-cell weekly-mismatch-detail">${warningText}</td>
        <td>${renderCallAuditButton(rider, auditContext)}</td>
      </tr>
    `;
    }).join('');

    const unmatchedRows = [...unmatched]
      .sort(byDriverName(r => r.riderName))
      .map(rider => {
      const warningText = (rider.warnings || []).join(', ') || unmatchedDefaultWarning(platform);
      return `
      <tr class="promotion-row-unpaid">
        <td><strong>${escapeHtml(rider.riderName)}</strong></td>
        <td>${escapeHtml(rider.originalName)}</td>
        <td>${riderMatchIdTag(rider, platform)}</td>
        <td>${formatNumber(rider.weeklyOrderCount)}</td>
        ${directAmountBodyCells(rider, ch, platform)}
        <td>-</td>
        <td class="promotion-status-no">-</td>
        <td class="promotion-status-no">미매칭</td>
        <td class="weekly-warning-cell">${escapeHtml(warningText)}</td>
        <td>-</td>
      </tr>
    `;
    }).join('');

    const emptyColspan = isDirectAmountView(ch, platform)
      ? 9 + directAmountFields(platform).length
      : 9;
    rowsEl.innerHTML = matchedRows + unmatchedRows || `<tr><td colspan="${emptyColspan}" class="empty">데이터 없음</td></tr>`;
  }

  function unmatchedDefaultWarning(platform) {
    return platform === 'baemin' ? '배민 User ID 미매칭' : '쿠팡 ID(이름+연락처)/기사명 미매칭';
  }

  function renderWeeklyUnmatched(channel, platform) {
    const ch = normChannel(channel);
    const rowsEl = q(ch, 'UnmatchedRows', platform);
    if (!rowsEl) return;

    const weekStart = ensureWeeklyLogWeek(ch, platform);
    updateWeeklyLogWeekRangeLabel(ch, platform);
    const label = q(ch, 'UnmatchedLabel', platform);
    if (label) {
      label.textContent = weekStart ? `· ${formatDate(weekStart)} 주` : '';
    }

    const rows = BremStorage.settlementUnmatched.getByWeek({
      weekStart,
      platform,
      kind: 'weekly',
      channel: ch
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

  function retryWeeklyUnmatched(channel, platform, options = {}) {
    const ch = normChannel(channel);
    const weekStart = ensureWeeklyLogWeek(ch, platform);
    const recordIds = Array.isArray(options.recordIds) ? options.recordIds : [];
    const pendingCount = BremStorage.settlementUnmatched.getByWeek({
      weekStart,
      platform,
      kind: 'weekly',
      channel: ch
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
          recordIds,
          channel: ch
        });
        await BremStorage.flushStorage?.();

        if (result.needsManualSave && result.matched?.length) {
          setPreview(ch, platform, {
            platform,
            channel: ch,
            region: result.region || '',
            startDate: result.startDate,
            endDate: result.endDate,
            fileName: '',
            riders: result.matched,
            previewUnmatched: [],
            summary: BremWeeklySettlement.buildWeeklySummary(result.matched, []),
            uploadedAt: new Date().toISOString()
          });
          renderPreview(ch, platform);
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

        renderWeeklyUnmatched(ch, platform);
        renderSavedList(ch, platform);
        if (typeof BremPromotionApplyAdmin !== 'undefined') BremPromotionApplyAdmin.refresh();
      } catch (error) {
        console.error('[BREM] weekly unmatched retry failed:', error);
        showToast(error.message || '매칭 재시도에 실패했습니다.');
      }
    })();
  }

  function renderSavedList(channel, platform) {
    const ch = normChannel(channel);
    const rowsEl = q(ch, 'SavedRows', platform);
    if (!rowsEl) return;

    BremStorage.settlementUploadLogs.syncWeeklyFromSavedRecords(ch);
    const weekStart = ensureWeeklyLogWeek(ch, platform);
    updateWeeklyLogWeekRangeLabel(ch, platform);

    const list = BremStorage.settlementUploadLogs.getFiltered({
      kind: 'weekly',
      platform,
      weekStart,
      channel: ch
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
    const mismatchCount = refreshedRiders.filter(r => isMismatchRider(r)).length;
    const orderLabel = platformWeeklyOrderLabel(record.platform);
    const idLabel = platformMatchIdLabel(record.platform);
    const channelLabel = (record.channel === 'direct') ? ' · 직계약' : '';
    $('#weeklySettlementDetailTitle').textContent = `${platformLabel(record.platform)} · ${record.region}${channelLabel}`;
    $('#weeklySettlementDetailMeta').innerHTML = `
      <p>정산기간: <strong>${escapeHtml(period.startDate)} ~ ${escapeHtml(period.endDate)}</strong> (수~화 7일)</p>
      <p>매칭 ${formatNumber(record.summary.matchedRiders)}명: <strong>${escapeHtml(record.matchedNamesLabel || '-')}</strong></p>
      ${mismatchCount ? `<p class="weekly-call-mismatch-banner">⚠ 콜수 불일치 ${formatNumber(mismatchCount)}명 — 여러 권역 콜이면 「콜수무시 승인」으로 정산을 진행하세요. (시스템 콜수는 유지)</p>` : ''}
    `;
    const detailIsDirectAmount = isDirectAmountView(record.channel, record.platform);
    const headEl = $('#weeklySettlementDetailHead');
    if (headEl) {
      headEl.innerHTML = `<tr>
            <th>기사명</th>
            <th>원본 이름</th>
            <th>${escapeHtml(idLabel)}</th>
            <th>주간 ${escapeHtml(orderLabel)}</th>
            ${directAmountHeadCells(record.channel, record.platform)}
            <th>시스템 콜수</th>
            <th>콜수 일치</th>
            <th>경고</th>
            <th>분석 · 적용</th>
          </tr>`;
    }
    const auditContext = {
      platform: record.platform,
      channel: normChannel(record.channel),
      startDate: period.startDate,
      endDate: period.endDate,
      settlementId: record.id || ''
    };
    $('#weeklySettlementDetailRows').innerHTML = [...refreshedRiders]
      .sort(byDriverName(r => r.driverName || r.riderName))
      .map(rider => {
      const warningText = formatCallMismatchWarnings(rider);
      return `
      <tr${isMismatchRider(rider) ? ' class="promotion-row-unpaid"' : ''}>
        <td><strong>${escapeHtml(rider.driverName || rider.riderName)}</strong></td>
        <td>${escapeHtml(rider.originalName)}</td>
        <td>${riderMatchIdTag(rider, record.platform)}</td>
        <td>${formatNumber(rider.weeklyOrderCount)}</td>
        ${detailIsDirectAmount ? directAmountBodyCells(rider, record.channel, record.platform) : ''}
        <td>${formatNumber(rider.systemCallCount)}</td>
        <td>${callCountStatusHtml(rider)}</td>
        <td class="weekly-warning-cell weekly-mismatch-detail">${warningText}</td>
        <td>${renderCallAuditButton(rider, auditContext)}</td>
      </tr>
    `;
    }).join('');
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function setCallCountIgnoredForRider(params = {}) {
    const driverId = String(params.driverId || '').trim();
    const platform = params.platform || 'coupang';
    const channel = normChannel(params.channel);
    const settlementId = String(params.settlementId || '').trim();
    const driverLabel = params.driverLabel || '기사';
    const ignored = params.ignored === true;

    if (!driverId) {
      showToast('매칭된 기사가 없어 처리할 수 없습니다.');
      return;
    }

    if (ignored) {
      const ok = window.confirm(
        [
          `${driverLabel} · 콜수무시 승인할까요?`,
          '',
          '· 시스템 콜수(여러 권역 합계)는 그대로 둡니다',
          '· 주간서 정산금액은 그대로 정산결과에 반영됩니다',
          '· 「주간서 기준 입력」처럼 콜수를 덮어쓰지 않습니다'
        ].join('\n')
      );
      if (!ok) return;
    }

    try {
      const saved = settlementId ? BremStorage.weeklySettlements.getById(settlementId) : null;
      if (saved) {
        const updated = BremWeeklySettlement.setRiderCallCountIgnored(saved, driverId, ignored);
        updated.channel = normChannel(saved.channel || channel);
        BremWeeklySettlement.saveWeeklySettlement(updated);
        await BremStorage?.awaitPersist?.(BremStorage.flushStorage?.());
        if (state.detailId === settlementId) renderDetail(updated);
      }

      const preview = getPreview(channel, platform);
      if (preview) {
        const nextPreview = BremWeeklySettlement.setRiderCallCountIgnored(preview, driverId, ignored);
        setPreview(channel, platform, nextPreview);
        renderPreview(channel, platform);
      } else if (!saved) {
        showToast('정산서 미리보기 또는 저장 기록을 찾지 못했습니다.');
        return;
      }

      renderSavedList(channel, platform);
      showToast(
        ignored
          ? `${driverLabel} · 콜수무시 승인 완료 (시스템 콜수 유지 · 정산금액 반영)`
          : `${driverLabel} · 콜수무시 승인을 취소했습니다.`
      );
    } catch (error) {
      console.error('[call-count-ignore]', error);
      showToast(error.message || '콜수무시 처리에 실패했습니다.');
    }
  }

  function hideDetail() {
    state.detailId = '';
    const card = $('#weeklySettlementDetailCard');
    if (card) card.hidden = true;
  }

  function channelFromEvent(event) {
    const section = event.target.closest('.section');
    return section?.id === 'weekly-settlement-direct' ? 'direct' : 'bro';
  }

  function platformFromEvent(event) {
    const panel = event.target.closest('.admin-platform-panel[data-platform]');
    return panel?.dataset?.platform || 'coupang';
  }

  function bindPlatformEvents(channel, platform) {
    const ch = normChannel(channel);
    q(ch, 'UploadForm', platform)?.addEventListener('submit', event => {
      event.preventDefault();
      uploadAndMatch(ch, platform);
    });
    q(ch, 'SaveBtn', platform)?.addEventListener('click', () => savePreview(ch, platform));
    q(ch, 'CancelBtn', platform)?.addEventListener('click', () => {
      setPreview(ch, platform, null);
      renderPreview(ch, platform);
    });
    q(ch, 'File', platform)?.addEventListener('change', event => {
      applyFilenameHints(ch, platform, event.target.files?.[0]?.name || '');
    });
    if (platform === 'coupang') {
      q(ch, 'BaseDate', 'coupang')?.addEventListener('change', () => fillCoupangDatesFromBase(ch));
    }
    q(ch, 'LogWeek', platform)?.addEventListener('change', event => {
      const picked = weekStartKey(event.target.value || weekStartKey());
      state.weeklyLogWeekByChannel[ch][platform] = picked;
      event.target.value = picked;
      renderSavedList(ch, platform);
      renderWeeklyUnmatched(ch, platform);
    });
    q(ch, 'UnmatchedRetryBtn', platform)?.addEventListener('click', () => {
      retryWeeklyUnmatched(ch, platform);
    });
  }

  // 주정산서 삭제는 정산서 자체 + 업로드 로그 + 그 정산서에 붙은 프로모션/기타지급까지
  // 한 번에 정리해야 한다. 하나라도 남으면 정산결과·최종입금에 삭제한 건이 계속 보인다.
  async function removeSettlementRecord(recordId, options = {}) {
    const id = String(recordId || '').trim();
    if (!id) return;
    const record = await BremWeeklySettlement.deleteDirectSettlementCascade(id, {
      logId: options.logId
    });
    const channel = normChannel(record?.channel || options.fallbackChannel);
    const platform = record?.platform || options.fallbackPlatform || 'coupang';

    if (state.detailId === id) hideDetail();
    renderSavedList(channel, platform);
    if (typeof BremPromotionApplyAdmin !== 'undefined') BremPromotionApplyAdmin.refresh();
    if (typeof BremDirectAdjustmentAdmin !== 'undefined') BremDirectAdjustmentAdmin.refresh?.(platform);
    // 각 화면이 보고 있던 플랫폼은 그대로 두고 다시 그리게 한다.
    if (typeof BremSettlementResultDirect !== 'undefined') {
      void BremSettlementResultDirect.refresh?.(BremSettlementResultDirect.state?.platform);
    }
    if (typeof BremFinalDeposit !== 'undefined') void BremFinalDeposit.refresh?.();
    showToast(options.message || '주간정산이 삭제되었습니다.');
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;
    CHANNELS.forEach(channel => {
      PLATFORMS.forEach(platform => bindPlatformEvents(channel, platform));
    });
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
          channel: applyCallBtn.dataset.channel || 'bro',
          startDate: applyCallBtn.dataset.startDate,
          endDate: applyCallBtn.dataset.endDate,
          weeklyOrderCount: Number(applyCallBtn.dataset.weeklyOrderCount || 0),
          driverLabel: applyCallBtn.dataset.driverLabel || ''
        });
        return;
      }
      const ignoreCallBtn = event.target.closest('[data-weekly-ignore-call]');
      if (ignoreCallBtn) {
        void setCallCountIgnoredForRider({
          driverId: ignoreCallBtn.dataset.driverId,
          platform: ignoreCallBtn.dataset.platform,
          channel: ignoreCallBtn.dataset.channel || 'bro',
          settlementId: ignoreCallBtn.dataset.settlementId || '',
          driverLabel: ignoreCallBtn.dataset.driverLabel || '',
          ignored: true
        });
        return;
      }
      const undoIgnoreCallBtn = event.target.closest('[data-weekly-undo-ignore-call]');
      if (undoIgnoreCallBtn) {
        void setCallCountIgnoredForRider({
          driverId: undoIgnoreCallBtn.dataset.driverId,
          platform: undoIgnoreCallBtn.dataset.platform,
          channel: undoIgnoreCallBtn.dataset.channel || 'bro',
          settlementId: undoIgnoreCallBtn.dataset.settlementId || '',
          driverLabel: undoIgnoreCallBtn.dataset.driverLabel || '',
          ignored: false
        });
        return;
      }
      const weeklyRetryBtn = event.target.closest('[data-weekly-retry-unmatched]');
      if (weeklyRetryBtn) {
        const channel = channelFromEvent(event);
        const platform = platformFromEvent(event);
        retryWeeklyUnmatched(channel, platform, { recordIds: [weeklyRetryBtn.dataset.weeklyRetryUnmatched] });
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
        if (!window.confirm('저장된 주간정산을 삭제할까요?\n정산결과·최종입금에서도 함께 사라집니다.')) return;
        void removeSettlementRecord(deleteBtn.dataset.weeklyDelete, {
          fallbackChannel: channelFromEvent(event),
          fallbackPlatform: platformFromEvent(event),
          message: '주간정산이 삭제되었습니다.'
        });
        return;
      }
      const deleteLogBtn = event.target.closest('[data-weekly-delete-log]');
      if (deleteLogBtn) {
        const log = BremStorage.settlementUploadLogs.getById(deleteLogBtn.dataset.weeklyDeleteLog);
        const channel = channelFromEvent(event);
        const platform = log?.platform || platformFromEvent(event);
        // 저장된 정산서가 딸린 기록은 로그만 지워도 소용이 없다. 정산서가 남아 있으면
        // 목록을 다시 그릴 때 syncWeeklyFromSavedRecords 가 로그를 되살리고,
        // 정산결과·최종입금에도 그대로 남는다. 그래서 정산서까지 함께 지운다.
        if (log?.linkedRecordId) {
          if (!window.confirm('이 기록에는 저장된 주간정산이 딸려 있습니다.\n기록과 정산서를 함께 삭제할까요? (정산결과·최종입금에서도 사라집니다)')) return;
          void removeSettlementRecord(log.linkedRecordId, {
            fallbackChannel: channel,
            fallbackPlatform: platform,
            logId: deleteLogBtn.dataset.weeklyDeleteLog,
            message: '업로드 기록과 주간정산이 삭제되었습니다.'
          });
          return;
        }
        if (!window.confirm('업로드 기록을 삭제할까요?')) return;
        BremStorage.settlementUploadLogs.remove(deleteLogBtn.dataset.weeklyDeleteLog);
        void BremStorage.flushStorage?.().then(() => {
          renderSavedList(channel, platform);
          showToast('업로드 기록이 삭제되었습니다.');
        });
      }
    });
  }

  function refresh(channelFilter) {
    const channels = (channelFilter === 'bro' || channelFilter === 'direct')
      ? [channelFilter]
      : CHANNELS;
    channels.forEach(channel => {
      if (!$(`#${sectionIdFor(channel)}`)) return;
      PLATFORMS.forEach(platform => {
        renderPreview(channel, platform);
        renderSavedList(channel, platform);
        renderWeeklyUnmatched(channel, platform);
      });
    });
  }

  function init() {
    if (!$('#weekly-settlement') && !$('#weekly-settlement-direct')) return;
    bindEvents();
    refresh();
  }

  return { init, refresh, hideDetail };
})();

document.addEventListener('DOMContentLoaded', () => {
  BremWeeklySettlementAdmin.init();
});
