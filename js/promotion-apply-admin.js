const BremPromotionApplyAdmin = (function () {
  const PLATFORMS = ['coupang', 'baemin', 'combined'];
  const SETTLEMENT_WEEK_KEYS = ['coupang', 'baemin', 'combined-coupang', 'combined-baemin'];
  const state = {
    lastResult: null,
    platform: 'coupang',
    // 브로/직계약. 주정산서 저장 키가 달라 목록·계산·저장 모두 이 값을 따라간다.
    channel: 'bro',
    // 합산(콜수합산) 전용: 배민=브로 / 쿠팡=직계약 처럼 채널이 갈릴 때 쿠팡·배민을
    // 각각 다른 채널에서 고를 수 있게 플랫폼별 채널을 따로 둔다. (빈 값이면 state.channel 따름)
    combinedChannel: { coupang: '', baemin: '' },
    savedResultId: '',
    settlementWeekByKey: {},
    savedWeekFilter: '',
    // 수락/거절율 미등록 기사를 막고 계산하지 않도록 기본 false. 패널 버튼으로 켠다.
    ignoreMissingRates: false
  };
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  // 브로와 직계약은 업로드된 정산서 주차가 다를 수 있어 선택한 주차도 채널별로 나눈다.
  // 한 칸에 같이 두면 채널을 바꿨을 때 정산서 없는 주가 그대로 남아 목록이 빈다.
  function channelLabel(channel = state.channel) {
    return channel === 'direct' ? '직계약' : '브로';
  }

  // 합산 탭에서 플랫폼별로 선택된 채널(없으면 현재 채널 따름)
  function combinedChannelFor(platform) {
    const ch = state.combinedChannel?.[platform];
    return ch === 'direct' || ch === 'bro' ? ch : state.channel;
  }

  function platformLabel(platform) {
    if (platform === 'baemin') return '배민';
    if (platform === 'combined') return '합산';
    return '쿠팡';
  }

  function weekSlot(selectKey) {
    return `${state.channel}:${selectKey}`;
  }

  function getWeek(selectKey) {
    return state.settlementWeekByKey[weekSlot(selectKey)];
  }

  function setWeek(selectKey, value) {
    state.settlementWeekByKey[weekSlot(selectKey)] = value;
    return value;
  }

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

  function formatRate(value, platform, options = {}) {
    const label = BremPlatforms.rateLabel(platform);
    if (value === null || value === undefined || value === '') {
      if (options.highlightMissing) {
        return `<span class="promotion-rate-missing-badge">${escapeHtml(label)} 미등록</span>`;
      }
      return '-';
    }
    return `${label} ${Number(value).toLocaleString('ko-KR')}%`;
  }

  function rowHasWeeklyCalls(row) {
    return Number(row?.callCount || 0) >= 1;
  }

  function isRateUnregistered(row, rowPlatform) {
    if (!rowHasWeeklyCalls(row)) return false;
    const rate = row.platformRate;
    if (rate === null || rate === undefined || rate === '') return true;
    const label = BremPlatforms.rateLabel(rowPlatform);
    return (row.failureReasons || []).some(reason => {
      const text = String(reason || '');
      return text.includes(`${label} 미등록`)
        || text.includes('수락률 미등록')
        || text.includes('거절율 미등록');
    });
  }

  function getRateMissingRows(result) {
    const platform = result?.platform;
    return (result?.results || []).filter(row => {
      const rowPlatform = row.appliedPlatform || platform;
      return isRateUnregistered(row, rowPlatform);
    });
  }

  function getRateMissingRowLabel(row, result) {
    const platform = BremPlatforms.normalize(result?.platform);
    const rowPlatform = BremPlatforms.normalize(row.appliedPlatform || platform);
    if (platform === 'baemin' || (platform === 'combined' && rowPlatform === 'baemin')) {
      const riderId = BremPromotionApply.getResultRowBaeminRiderId(row);
      const name = BremPromotionApply.getResultRowMatchedDriverName(row);
      return name ? `${riderId} · ${name}` : riderId;
    }
    return BremPromotionApply.getResultRowDisplayName(row, platform);
  }

  function renderRateMissingPanel(result) {
    const panel = $('#promotionApplyRateMissingPanel');
    if (!panel) return;

    const rows = getRateMissingRows(result);
    if (!rows.length) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }

    const platform = BremPlatforms.normalize(result.platform);
    const isBaeminTab = platform === 'baemin';
    const isCombined = platform === 'combined';
    const rateHeader = isBaeminTab ? '수락률' : (isCombined ? '수락/거절율' : '거절율');

    panel.hidden = false;
    panel.innerHTML = `
      <div class="promotion-rate-missing-header">
        <div class="promotion-rate-missing-header-row">
          <strong>⚠ ${escapeHtml(rateHeader)} 미등록 · 정산 필수 ${formatNumber(rows.length)}명</strong>
          <button type="button" class="primary-btn" id="promotionApplyIgnoreMissingRatesBtn">
            ${escapeHtml(rateHeader)} 무시하고 다시 계산
          </button>
        </div>
        <p>주간 콜수 1건 이상인데 ${escapeHtml(rateHeader)} 데이터가 없습니다. 거절율·수락률을 등록하거나, 위 버튼으로 미등록만 무시하고 적용하세요.</p>
      </div>
      <div class="table-wrap promotion-rate-missing-table-wrap">
        <table class="weekly-settlement-detail-table promotion-rate-missing-table">
          <thead>
            <tr>
              ${isBaeminTab ? '<th>배민 RIDER ID</th><th>매칭 기사명</th>' : '<th>기사</th>'}
              ${isCombined ? '<th>플랫폼</th>' : ''}
              <th>주간 콜수</th>
              <th>${escapeHtml(rateHeader)}</th>
              <th>미지급 사유</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => {
              const rowPlatform = row.appliedPlatform || platform;
              const identityCells = isBaeminTab
                ? `
                  <td><strong>${escapeHtml(BremPromotionApply.getResultRowBaeminRiderId(row))}</strong></td>
                  <td>${escapeHtml(BremPromotionApply.getResultRowMatchedDriverName(row) || '-')}</td>
                `
                : `<td><strong>${escapeHtml(getRateMissingRowLabel(row, result))}</strong></td>`;
              return `
                <tr class="promotion-row-rate-missing">
                  ${identityCells}
                  ${isCombined ? `<td>${escapeHtml(BremPlatforms.label(rowPlatform))}</td>` : ''}
                  <td>${formatNumber(row.callCount)}</td>
                  <td>${formatRate(row.platformRate, rowPlatform, { highlightMissing: true })}</td>
                  <td>${escapeHtml((row.failureReasons || []).join(', ') || `${BremPlatforms.rateLabel(rowPlatform)} 미등록`)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function weekStartKey(dateValue) {
    const fallback = window.BremDatePicker?.today?.() || new Date().toISOString().slice(0, 10);
    return BremPromotionApply.weekStartKey(dateValue || fallback);
  }

  function applyWeekWednesday(dateValue) {
    return BremPromotionApply.applyWeekWednesday(dateValue || weekStartKey());
  }

  function weekTriggerId(selectKey) {
    return selectKey;
  }

  function formatWeekPickerLabel(weekStart) {
    if (!weekStart) return '수요일 선택';
    const normalized = applyWeekWednesday(weekStart);
    const dateText = window.BremDatePicker?.formatDate?.(normalized) || formatDate(normalized);
    const weekday = window.BremDatePicker?.formatWeekdayKo?.(normalized) || '';
    return weekday ? `${dateText}(${weekday})` : dateText;
  }

  function syncWeekPickerDisplay(selectKey, weekStart) {
    const normalized = applyWeekWednesday(weekStart);
    const input = $(`#promotionApplySettlementWeek-${selectKey}`);
    if (input) input.value = normalized;
    const label = $(`[data-promotion-apply-week-label="${weekTriggerId(selectKey)}"]`);
    if (label) label.textContent = formatWeekPickerLabel(normalized);
    return normalized;
  }

  function syncSavedWeekPickerDisplay(weekStart) {
    const normalized = applyWeekWednesday(weekStart);
    const input = $('#promotionApplySavedWeekFilter');
    if (input) input.value = normalized;
    const label = $('[data-promotion-apply-week-label="saved"]');
    if (label) label.textContent = formatWeekPickerLabel(normalized);
    return normalized;
  }

  function handleWeekSelect(selectKey, value) {
    const normalized = syncWeekPickerDisplay(selectKey, value);
    setWeek(selectKey, normalized);
    updateSettlementWeekRangeLabel(selectKey);
    if (selectKey.startsWith('combined-')) {
      renderCombinedSettlementSelects();
    } else {
      renderSettlementSelectForPlatform(selectKey);
    }
  }

  function handleSavedWeekSelect(value) {
    const normalized = syncSavedWeekPickerDisplay(value);
    state.savedWeekFilter = normalized;
    updateSavedWeekRangeLabel();
    renderSavedList();
  }

  function weekEndKey(weekStart) {
    return BremPromotionApply.weekEndKey(weekStart);
  }

  function formatDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(`${value}T00:00:00`));
  }

  function formatWeekRangeLabel(weekStart) {
    if (!weekStart) return '';
    if (window.BremDatePicker?.formatWednesdayWeekRange) {
      return BremDatePicker.formatWednesdayWeekRange(applyWeekWednesday(weekStart));
    }
    const normalized = applyWeekWednesday(weekStart);
    const end = weekEndKey(normalized);
    const weekday = value => {
      const day = new Date(`${value}T00:00:00`).getDay();
      return ['일', '월', '화', '수', '목', '금', '토'][day] || '';
    };
    return `${formatDate(normalized)}(${weekday(normalized)}) ~ ${formatDate(end)}(${weekday(end)})`;
  }

  function settlementPlatformFromKey(selectKey) {
    return selectKey.startsWith('combined-') ? selectKey.replace('combined-', '') : selectKey;
  }

  function defaultSettlementWeek(platform) {
    const items = (BremPromotionApply.getWeeklySettlementIndex?.(state.channel) || [])
      .filter(item => item.platform === platform)
      .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
    if (!items.length) return weekStartKey();
    const latest = items[0];
    return applyWeekWednesday(latest.startDate || latest.weekStart || '');
  }

  function bindLegacyWeekInputs() {
    SETTLEMENT_WEEK_KEYS.forEach(selectKey => {
      const input = $(`#promotionApplySettlementWeek-${selectKey}`);
      if (!input || input.type === 'hidden' || input.dataset.weekBound) return;
      input.dataset.weekBound = '1';
      input.addEventListener('change', () => {
        handleWeekSelect(selectKey, input.value);
      });
      if (input.value) {
        handleWeekSelect(selectKey, input.value);
      }
    });

    const savedInput = $('#promotionApplySavedWeekFilter');
    if (savedInput && savedInput.type === 'date' && !savedInput.dataset.weekBound) {
      savedInput.dataset.weekBound = '1';
      savedInput.addEventListener('change', () => {
        handleSavedWeekSelect(savedInput.value);
      });
      if (savedInput.value) {
        handleSavedWeekSelect(savedInput.value);
      }
    }
  }

  function initializeAllSettlementWeeks() {
    SETTLEMENT_WEEK_KEYS.forEach(selectKey => {
      const platform = settlementPlatformFromKey(selectKey);
      const input = $(`#promotionApplySettlementWeek-${selectKey}`);
      const raw = getWeek(selectKey) || input?.value || defaultSettlementWeek(platform);
      const week = applyWeekWednesday(raw);
      setWeek(selectKey, week);
      if (input) input.value = week;
      const label = $(`[data-promotion-apply-week-label="${selectKey}"]`);
      if (label) label.textContent = formatWeekPickerLabel(week);
      updateSettlementWeekRangeLabel(selectKey);
    });
  }

  function syncSettlementWeekDefaults(selectKey) {
    const platform = settlementPlatformFromKey(selectKey);
    if (!getWeek(selectKey)) {
      setWeek(selectKey, applyWeekWednesday(defaultSettlementWeek(platform)));
    }
    setWeek(selectKey, syncWeekPickerDisplay(selectKey, getWeek(selectKey)));
    updateSettlementWeekRangeLabel(selectKey);
  }

  function renderActivePlatformSettlement() {
    const platform = getActivePlatform();
    if (platform === 'combined') {
      ['combined-coupang', 'combined-baemin'].forEach(selectKey => {
        ensureSettlementWeek(selectKey);
        updateSettlementWeekRangeLabel(selectKey);
      });
      renderCombinedSettlementSelects();
      return;
    }
    ensureSettlementWeek(platform);
    updateSettlementWeekRangeLabel(platform);
    renderSettlementSelectForPlatform(platform);
  }

  function ensureSettlementWeek(selectKey) {
    const platform = settlementPlatformFromKey(selectKey);
    if (!getWeek(selectKey)) {
      setWeek(selectKey, applyWeekWednesday(defaultSettlementWeek(platform)));
    }
    return setWeek(selectKey, syncWeekPickerDisplay(selectKey, getWeek(selectKey)));
  }

  function updateSettlementWeekRangeLabel(selectKey) {
    const weekStart = applyWeekWednesday(getWeek(selectKey) || ensureSettlementWeek(selectKey));
    setWeek(selectKey, weekStart);
    const label = $(`#promotionApplySettlementWeekRange-${selectKey}`);
    if (label) {
      label.textContent = weekStart ? `표시 범위: ${formatWeekRangeLabel(weekStart)}` : '';
    }
  }

  function ensureSavedWeekFilter() {
    const input = $('#promotionApplySavedWeekFilter');
    if (!input) return '';
    if (!state.savedWeekFilter) {
      const all = BremPromotionApply.getSavedResults(null);
      const latestWeek = all
        .map(item => BremPromotionApply.getSavedResultWeekStart(item))
        .find(Boolean);
      state.savedWeekFilter = applyWeekWednesday(latestWeek || weekStartKey());
    }
    const normalized = syncSavedWeekPickerDisplay(state.savedWeekFilter);
    state.savedWeekFilter = normalized;
    return normalized;
  }

  function updateSavedWeekRangeLabel() {
    const weekStart = ensureSavedWeekFilter();
    const label = $('#promotionApplySavedWeekRange');
    if (label) {
      label.textContent = weekStart ? `표시 범위: ${formatWeekRangeLabel(weekStart)}` : '';
    }
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
    // 합산 단가보장은 배달처리비로 보장액을 내므로 결과표에 배달처리비 열을 항상 연다.
    if (platform === 'combined') return true;
    return false;
  }

  function updateDeliveryFeeHint(platformKey, file) {
    const hintEl = $(`#promotionApplyDeliveryFeeHint-${platformKey}`);
    if (!hintEl) return;

    if (!file) {
      hintEl.innerHTML = platformKey === 'combined'
        ? '단가보장 조건이 있으면 <strong>쿠팡·배민 배달처리비</strong>를 모두 업로드하세요. 합산 콜수로 구간을 고르고, 쿠팡은 <strong>B열 이름·Y열</strong>, 배민은 <strong>K열·AH열</strong>로 보장액을 각각 계산합니다.'
        : '단가보장(미션 배정) 시 <strong>배달처리비_팀명_YYYYMMDD_YYYYMMDD</strong> 파일을 업로드하세요. <strong>K열 User ID</strong> 매칭 · <strong>U·V·AH 중 하나라도 빈칸/0이면 해당 행 전체 무효</strong> · 세 열 모두 유효한 행만 집계';
      return;
    }

    const parser = platformKey.includes('coupang') && typeof BremCoupangDeliveryFee !== 'undefined'
      ? BremCoupangDeliveryFee
      : BremBaeminDeliveryFee;
    const meta = parser.parseFileName(file.name);
    if (!meta?.startDate || !meta?.endDate) {
      hintEl.innerHTML = `<span class="field-error">파일명에서 정산기간을 읽지 못했습니다. 예: 배달처리비_표준울산남A팀브로1_20260610_20260616</span>`;
      return;
    }

    hintEl.innerHTML = `선택 파일: <strong>${escapeHtml(file.name)}</strong> · 팀 <strong>${escapeHtml(meta.teamName || '-')}</strong> · 기간 <strong>${escapeHtml(meta.startDate)} ~ ${escapeHtml(meta.endDate)}</strong>`;
  }

  function updateCombinedDeliveryFeeHints() {
    const coupangFile = $('#promotionApplyDeliveryFeeFile-combined-coupang')?.files?.[0] || null;
    const baeminFile = $('#promotionApplyDeliveryFeeFile-combined-baemin')?.files?.[0] || null;
    const mainHint = $('#promotionApplyDeliveryFeeHint-combined');
    const parts = [];

    if (coupangFile) {
      const meta = BremCoupangDeliveryFee?.parseFileName?.(coupangFile.name);
      parts.push(meta?.startDate
        ? `쿠팡: <strong>${escapeHtml(coupangFile.name)}</strong> (${escapeHtml(meta.startDate)}~${escapeHtml(meta.endDate)})`
        : `쿠팡: <span class="field-error">${escapeHtml(coupangFile.name)} (기간 인식 실패)</span>`);
    } else {
      parts.push('쿠팡: <span class="field-error">미선택</span>');
    }

    if (baeminFile) {
      const meta = BremBaeminDeliveryFee?.parseFileName?.(baeminFile.name);
      parts.push(meta?.startDate
        ? `배민: <strong>${escapeHtml(baeminFile.name)}</strong> (${escapeHtml(meta.startDate)}~${escapeHtml(meta.endDate)})`
        : `배민: <span class="field-error">${escapeHtml(baeminFile.name)} (기간 인식 실패)</span>`);
    } else {
      parts.push('배민: <span class="field-error">미선택</span>');
    }

    if (mainHint) {
      mainHint.innerHTML = parts.join(' · ')
        + '<br>단가보장 시 합산 콜수로 구간을 고르고, 쿠팡(B·Y)·배민(K·AH) 보장액을 각각 적용합니다.';
    }
  }

  async function resolveDeliveryFeeForCalculation(platform, baeminSettlement, coupangSettlement = null) {
    const assignmentMode = platform === 'combined' ? 'selected_rules' : readApplyMode(platform);
    const ruleIds = platform === 'combined' || assignmentMode === 'selected_rules'
      ? readSelectedRuleIds(platform)
      : [];
    const pickOptions = { assignmentMode };
    const needsFile = platform === 'combined'
      ? BremPromotionApply.combinedSettlementsNeedDeliveryFee(coupangSettlement, baeminSettlement, ruleIds)
      : BremPromotionApply.settlementNeedsDeliveryFee(baeminSettlement, 'baemin', ruleIds, pickOptions);
    if (!needsFile) return null;

    if (platform === 'combined') {
      const coupangPassword = $('#promotionApplyDeliveryFeePassword-combined-coupang')?.value ?? '';
      const baeminPassword = $('#promotionApplyDeliveryFeePassword-combined-baemin')?.value ?? '';
      const coupangFile = $('#promotionApplyDeliveryFeeFile-combined-coupang')?.files?.[0];
      const baeminFile = $('#promotionApplyDeliveryFeeFile-combined-baemin')?.files?.[0];
      if (!coupangFile) {
        throw new Error('단가보장 프로모션은 쿠팡 배달처리비 정산서 파일을 선택하세요.');
      }
      if (!baeminFile) {
        throw new Error('단가보장 프로모션은 배민 배달처리비 정산서 파일을 선택하세요.');
      }

      const coupangParsed = await BremCoupangDeliveryFee.parseFile(coupangFile, coupangPassword);
      BremCoupangDeliveryFee.assertDateMatch(coupangSettlement, coupangParsed);
      const baeminParsed = await BremBaeminDeliveryFee.parseFile(baeminFile, baeminPassword);
      BremBaeminDeliveryFee.assertDateMatch(baeminSettlement, baeminParsed);

      return {
        baemin: baeminParsed,
        coupang: coupangParsed,
        index: baeminParsed.index,
        fileName: [coupangParsed.fileName, baeminParsed.fileName].filter(Boolean).join(' / '),
        teamName: baeminParsed.teamName,
        startDate: baeminParsed.startDate,
        endDate: baeminParsed.endDate,
        riderCount: Number(baeminParsed.riderCount || 0) + Number(coupangParsed.riderCount || 0)
      };
    }

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

    const weekStart = applyWeekWednesday(getWeek(platform) || ensureSettlementWeek(platform));
    setWeek(platform, weekStart);

    const previous = select.value;
    const options = BremPromotionApply.getSettlementOptions(platform, { weekStart, channel: state.channel });
    const emptyLabel = options.length
      ? `저장된 ${channelLabel()} ${platformLabel(platform)} 주정산 선택`
      : `${formatDate(weekStart)} 주에 저장된 ${channelLabel()} ${platformLabel(platform)} 주정산이 없습니다`;

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
      const selectKey = `combined-${platform}`;
      const channelSelect = $(`#promotionApplyCombinedChannel-${platform}`);
      if (channelSelect) channelSelect.value = combinedChannelFor(platform);
      const select = $(`#promotionApplySettlementSelect-${selectKey}`);
      if (!select) return;

      const weekStart = applyWeekWednesday(getWeek(selectKey) || ensureSettlementWeek(selectKey));
      setWeek(selectKey, weekStart);

      const ch = combinedChannelFor(platform);
      const previous = select.value;
      const options = BremPromotionApply.getSettlementOptions(platform, { weekStart, channel: ch });
      const emptyLabel = options.length
        ? `저장된 ${channelLabel(ch)} ${platformLabel(platform)} 주정산 선택`
        : `${formatDate(weekStart)} 주에 저장된 ${channelLabel(ch)} ${platformLabel(platform)} 주정산이 없습니다`;

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

  function readApplyMode(platform = getActivePlatform()) {
    if (platform === 'combined') return 'selected_rules';
    const checked = $(`input[name="promotionApplyMode-${platform}"]:checked`);
    return checked?.value === 'selected_rules' ? 'selected_rules' : 'per_driver';
  }

  function syncApplyModeUI(platform) {
    if (platform === 'combined') return;
    const mode = readApplyMode(platform);
    const selectedSection = $(`#promotionApplySelectedSection-${platform}`);
    const missionSection = $(`#promotionApplyMissionSection-${platform}`);
    if (selectedSection) selectedSection.hidden = mode !== 'selected_rules';
    if (missionSection) missionSection.hidden = mode !== 'per_driver';
  }

  function renderMissionAssignmentSummary(platform) {
    const container = $(`#promotionApplyMissionSummary-${platform}`);
    if (!container) return;

    const catalog = window.BremMissionPromotionCatalog;
    const drivers = BremStorage.drivers.getAll();
    const field = platform === 'baemin' ? 'baemin' : 'coupang';
    const assigned = drivers.filter(driver => {
      const assignment = catalog?.getDriverAssignment?.(driver) || {};
      return Boolean(assignment[field]);
    }).length;
    const missions = catalog?.getForPlatform?.(platform) || [];
    const missionNames = missions.length
      ? missions.slice(0, 5).map(item => escapeHtml(item.title)).join(', ')
      : '등록된 프로모션 없음';

    container.innerHTML = `
      <p class="form-help promotion-apply-mission-summary">
        <strong>미션 관리</strong>에서 기사별로 배정한 프로모션이 정산서 기사마다 자동 적용됩니다.
      </p>
      <p class="form-help">배정 현황: <strong>${assigned}</strong>명 / 전체 ${drivers.length}명</p>
      <p class="form-help">사용 가능 미션: ${missionNames}${missions.length > 5 ? ` 외 ${missions.length - 5}개` : ''}</p>
    `;
  }

  function renderPromotionRuleCheckboxList(platform, container) {
    const allForPlatform = (BremStorage.getUserPromotionRules?.() || BremStorage.promotionRules.getAll())
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

  function renderPromotionRulePickersForPlatform(platform) {
    const container = $(`#promotionApplyRuleList-${platform}`);
    if (!container) return;

    if (platform === 'coupang' || platform === 'baemin') {
      renderPromotionRuleCheckboxList(platform, container);
      renderMissionAssignmentSummary(platform);
      syncApplyModeUI(platform);
      return;
    }

    renderPromotionRuleCheckboxList(platform, container);
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
      ? `<p>적용 구분: 쿠팡만 <strong>${formatNumber(result.summary?.coupangAssigned)}</strong>명 · 배민만 <strong>${formatNumber(result.summary?.baeminAssigned)}</strong>명 · 쿠팡+배민 합산 <strong>${formatNumber(result.summary?.overlapAssigned)}</strong>명</p>`
      : '';
    const deliveryFeeSummary = result.deliveryFeeLabel
      ? `<p>배달처리비: <strong>${escapeHtml(result.deliveryFeeLabel)}</strong>${result.deliveryFeeFileName ? ` · ${escapeHtml(result.deliveryFeeFileName)}` : ''}</p>`
      : '';
    const platform = result.platform;
    const isCombinedResult = BremPlatforms.normalize(platform) === 'combined';
    const isBaeminTab = BremPlatforms.normalize(platform) === 'baemin';
    const rateMissingRows = getRateMissingRows(result);
    const rateMissingLabel = isBaeminTab ? '수락률' : (isCombinedResult ? '수락/거절율' : '거절율');
    const rateMissingSummary = rateMissingRows.length
      ? ` · <span class="promotion-rate-missing-summary">⚠ ${escapeHtml(rateMissingLabel)} 미등록 <strong>${formatNumber(rateMissingRows.length)}</strong>명</span>`
      : '';

    summaryEl.innerHTML = `
      <p>대상: <strong>${escapeHtml(result.settlementLabel)}</strong></p>
      <p>정산기간: <strong>${escapeHtml(result.startDate)} ~ ${escapeHtml(result.endDate)}</strong></p>
      <p>적용 방식: <strong>${escapeHtml(result.assignmentMode === 'per_driver' ? '기사별 미션 배정' : '선택 조건 시뮬레이션')}</strong></p>
      <p>적용 조건: <strong>${escapeHtml(result.appliedRuleLabel || (result.selectedPromotionRuleNames || []).join(', ') || '-')}</strong>${result.unassignedRiderCount ? ` · 미배정 <strong>${formatNumber(result.unassignedRiderCount)}</strong>명` : ''}</p>
      <p>기사 <strong>${formatNumber(result.summary.riderCount)}</strong>명 · 총 프로모션 <strong>${formatMoney(result.summary.totalPromotionAmount)}</strong>${rateMissingSummary}</p>
      ${deliveryFeeSummary}
      ${combinedSummary}
      ${savedBadge}
    `;

    const showDeliveryFee = resultShowsDeliveryFeeColumns(result);
    const headEl = $('#promotionApplyResultHead');
    if (headEl) {
      headEl.innerHTML = `
        <tr>
          ${isBaeminTab ? `
          <th>배민 RIDER ID</th>
          <th>매칭 기사명</th>
          ` : `
          <th>${escapeHtml(isCombinedResult ? '기사' : (platform === 'coupang' ? '쿠팡 ID' : '기사'))}</th>
          `}
          ${isCombinedResult ? '<th>적용 플랫폼</th><th>구분</th>' : ''}
          <th>주간 콜수</th>
          <th>${escapeHtml(isBaeminTab ? '수락률' : '거절율/수락율')}</th>
          <th>적용 프로모션</th>
          ${showDeliveryFee ? `
          <th>배달처리비합계</th>
          <th>건당실제</th>
          <th>보장단가</th>
          ${isCombinedResult ? '<th>쿠팡보장</th><th>배민보장</th>' : ''}
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
    renderRateMissingPanel(result);

    rowsEl.innerHTML = result.results.map(row => {
      const rowPlatform = row.appliedPlatform || platform;
      const isBaeminRow = BremPlatforms.normalize(rowPlatform) === 'baemin';
      const showFeeAmounts = showDeliveryFee && (isBaeminTab || isCombinedResult || isBaeminRow);
      const rateMissing = isRateUnregistered(row, rowPlatform);
      const identityCells = isBaeminTab
        ? `
        <td><strong>${escapeHtml(BremPromotionApply.getResultRowBaeminRiderId(row))}</strong></td>
        <td>${escapeHtml(BremPromotionApply.getResultRowMatchedDriverName(row) || '-')}</td>
        `
        : `<td><strong>${escapeHtml(BremPromotionApply.getResultRowDisplayName(row, platform))}</strong></td>`;
      return `
      <tr class="${row.totalPromotionAmount > 0 ? 'promotion-row-paid' : 'promotion-row-unpaid'}${rateMissing ? ' promotion-row-rate-missing' : ''}">
        ${identityCells}
        ${isCombinedResult ? `
          <td>${escapeHtml(BremPlatforms.label(rowPlatform))}</td>
          <td>${escapeHtml(row.assignmentSource || '-')}</td>
        ` : ''}
        <td>${formatNumber(row.callCount)}</td>
        <td>${formatRate(row.platformRate, rowPlatform, { highlightMissing: rateMissing })}</td>
        <td>${escapeHtml(row.ruleName || '-')}</td>
        ${showDeliveryFee ? `
        <td>${showFeeAmounts ? formatMoney(row.deliveryAmountTotal) : '-'}</td>
        <td>${showFeeAmounts && row.avgDeliveryUnitPrice ? `${formatNumber(row.avgDeliveryUnitPrice)}원` : (showFeeAmounts ? '0원' : '-')}</td>
        <td>${showFeeAmounts && row.guaranteedUnitPrice ? `${formatNumber(row.guaranteedUnitPrice)}원` : (showFeeAmounts ? '-' : '-')}</td>
        ${isCombinedResult ? `
        <td>${formatMoney(row.coupangGuaranteeAmount)}</td>
        <td>${formatMoney(row.baeminGuaranteeAmount)}</td>
        ` : ''}
        <td>${showFeeAmounts ? formatMoney(row.guaranteePromotionAmount) : '-'}</td>
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

  function getFilteredSavedResults() {
    const platformFilter = $('#promotionApplySavedPlatformFilter')?.value || 'all';
    const regionFilter = String($('#promotionApplySavedRegionFilter')?.value || '').trim().toLowerCase();
    const weekFilter = ensureSavedWeekFilter();

    let list = BremPromotionApply.getSavedResults(platformFilter === 'all' ? null : platformFilter);
    if (regionFilter) {
      list = list.filter(item => String(item.region || '').toLowerCase().includes(regionFilter));
    }
    if (weekFilter) {
      const normalizedWeek = applyWeekWednesday(weekFilter);
      list = list.filter(item => BremPromotionApply.getSavedResultWeekStart(item) === normalizedWeek);
    }
    return list.sort((a, b) => {
      const weekCompare = String(BremPromotionApply.getSavedResultWeekStart(b)).localeCompare(
        String(BremPromotionApply.getSavedResultWeekStart(a))
      );
      if (weekCompare) return weekCompare;
      return String(b.savedAt || '').localeCompare(String(a.savedAt || ''));
    });
  }

  function renderSavedList() {
    const rowsEl = $('#promotionApplySavedRows');
    if (!rowsEl) return;

    updateSavedWeekRangeLabel();
    const list = getFilteredSavedResults();
    if (!list.length) {
      rowsEl.innerHTML = '<tr><td colspan="9" class="empty">저장된 프로모션 계산 결과가 없습니다.</td></tr>';
      return;
    }

    rowsEl.innerHTML = list.map(item => {
      const itemWeekStart = BremPromotionApply.getSavedResultWeekStart(item);
      const weekLabel = itemWeekStart ? formatWeekRangeLabel(itemWeekStart) : '-';
      return `
      <tr>
        <td>${escapeHtml(BremPlatforms.label(item.platform))}<span class="promotion-channel-badge ${item.channel === 'direct' ? 'is-direct' : 'is-bro'}">${escapeHtml(channelLabel(item.channel))}</span></td>
        <td>${escapeHtml(weekLabel)}</td>
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
    `;
    }).join('');
  }

  function downloadFilteredWeekResults() {
    const list = getFilteredSavedResults();
    if (!list.length) {
      showToast('선택한 주에 저장된 프로모션 계산 결과가 없습니다.');
      return;
    }
    try {
      const weekStart = applyWeekWednesday(ensureSavedWeekFilter());
      BremPromotionApply.exportWeekResultsToExcel(list, weekStart);
      showToast(`${formatDate(weekStart)} 주 프로모션 결과 ${list.length}건을 엑셀로 내려받았습니다.`);
    } catch (error) {
      showToast(error.message || '엑셀 다운로드에 실패했습니다.');
    }
  }

  async function runCalculation(options = {}) {
    const platform = getActivePlatform();
    const assignmentMode = readApplyMode(platform);
    const ruleIds = platform === 'combined' || assignmentMode === 'selected_rules'
      ? readSelectedRuleIds(platform)
      : [];
    const ignoreMissingRates = options.ignoreMissingRates === true
      || state.ignoreMissingRates === true;

    if (platform === 'combined' && !ruleIds.length) {
      showToast('적용할 합산 프로모션 조건을 선택하세요.');
      return;
    }
    if (platform !== 'combined' && assignmentMode === 'selected_rules' && !ruleIds.length) {
      showToast('시뮬레이션용 프로모션 조건을 선택하세요.');
      return;
    }

    try {
      await BremStorage.ensureSectionLoaded?.('promotion-apply');
      await BremStorage.ensureSectionLoaded?.('settlements');
      await BremStorage.ensureSectionLoaded?.('rejections');
      await BremStorage.refreshDriversForSettlementMatch?.();

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
        // 채널을 명시해야 브로/직계약에 같은 지역·주차 정산서가 있을 때 엉뚱한 쪽을 잡지 않는다.
        // 합산은 쿠팡·배민 채널이 갈릴 수 있어(배민 브로 / 쿠팡 직계약) 각 플랫폼 채널로 조회한다.
        const coupangChannel = combinedChannelFor('coupang');
        const baeminChannel = combinedChannelFor('baemin');
        const coupangSettlement = BremStorage.weeklySettlements.getById(ids.coupang, coupangChannel);
        const baeminSettlement = BremStorage.weeklySettlements.getById(ids.baemin, baeminChannel);
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

        const calcStartDate = [coupangSettlement.startDate, baeminSettlement.startDate]
          .map(value => String(value || '').slice(0, 10))
          .filter(Boolean)
          .sort()[0];
        await BremStorage.ensurePromotionCalculationCalls?.(calcStartDate);

        const deliveryFeeParsed = await resolveDeliveryFeeForCalculation('combined', baeminSettlement, coupangSettlement);
        // 저장 결과 채널은 쿠팡 채널을 대표로 두고, 배민 채널은 메타에 함께 남긴다.
        const combinedMeta = { channel: coupangChannel, coupangChannel, baeminChannel };
        const applyOptions = deliveryFeeParsed
          ? {
            deliveryFeeIndex: deliveryFeeParsed.baemin?.index || deliveryFeeParsed.index,
            deliveryFeeMeta: deliveryFeeParsed.baemin || deliveryFeeParsed,
            coupangDeliveryFeeIndex: deliveryFeeParsed.coupang?.index || null,
            coupangDeliveryFeeMeta: deliveryFeeParsed.coupang || null,
            ignoreMissingRates,
            ...combinedMeta
          }
          : { ignoreMissingRates, ...combinedMeta };

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
        const settlement = BremStorage.weeklySettlements.getById(settlementId, state.channel);
        if (!settlement) {
          showToast(`${channelLabel()} 주정산 데이터를 찾을 수 없습니다.`);
          renderSettlementSelectForPlatform(platform);
          return;
        }
        if (BremStorage.resolveWeeklySettlementPlatform(settlement) !== platform) {
          showToast(`${BremPlatforms.label(platform)} 주정산만 선택할 수 있습니다.`);
          renderSettlementSelectForPlatform(platform);
          return;
        }

        await BremStorage.ensurePromotionCalculationCalls?.(settlement.startDate, settlement.endDate);

        let applyOptions = { assignmentMode, channel: state.channel, ignoreMissingRates };
        if (platform === 'baemin') {
          const deliveryFeeParsed = await resolveDeliveryFeeForCalculation('baemin', settlement);
          if (deliveryFeeParsed) {
            applyOptions = {
              ...applyOptions,
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
      state.ignoreMissingRates = ignoreMissingRates;
      renderResult(state.lastResult);
      showToast(ignoreMissingRates
        ? '수락/거절율 미등록을 무시하고 프로모션을 다시 계산했습니다.'
        : '프로모션 계산이 완료되었습니다.');
    } catch (error) {
      showToast(error.message || '프로모션 계산 중 오류가 발생했습니다.');
    }
  }

  async function runCalculationIgnoringMissingRates() {
    const rows = getRateMissingRows(state.lastResult);
    if (!rows.length) {
      showToast('수락/거절율 미등록 대상이 없습니다.');
      return;
    }
    const ok = window.confirm(
      `수락/거절율 미등록 ${rows.length}명을 무시하고 프로모션을 다시 계산할까요?\n\n미등록만 통과하며, 수락률 미달·거절율 초과 조건은 그대로 적용됩니다.`
    );
    if (!ok) return;
    state.ignoreMissingRates = true;
    await runCalculation({ ignoreMissingRates: true });
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
      void BremStorage.promotionApplyResults.persist?.().catch(error => {
        console.error('[BREM] promotion apply result save persist failed:', error);
        showToast('저장 동기화에 실패했습니다. 새로고침 후 다시 시도하세요.');
      });
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
    const label = [
      BremPlatforms.label(record.platform),
      record.region || '-',
      `${record.startDate} ~ ${record.endDate}`,
      `저장일 ${String(record.savedAt).slice(0, 10)}`
    ].join(' · ');
    const detail = `기사 ${formatNumber(record.summary?.riderCount)}명 · 총 ${formatMoney(record.summary?.totalPromotionAmount)}`;
    if (!window.confirm(`다음 프로모션 계산 결과를 삭제할까요?\n\n${label}\n${detail}`)) return;

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

  function resetCurrentResult() {
    state.lastResult = null;
    state.savedResultId = '';
    state.ignoreMissingRates = false;
    const card = $('#promotionApplyResultCard');
    if (card) card.hidden = true;
    const summaryEl = $('#promotionApplyResultSummary');
    if (summaryEl) summaryEl.innerHTML = '';
    const rowsEl = $('#promotionApplyResultRows');
    if (rowsEl) rowsEl.innerHTML = '';
    const headEl = $('#promotionApplyResultHead');
    if (headEl) headEl.innerHTML = '';
    const panel = $('#promotionApplyRateMissingPanel');
    if (panel) {
      panel.hidden = true;
      panel.innerHTML = '';
    }
    showToast('계산 결과를 초기화했습니다.');
  }

  function setChannel(channel, options = {}) {
    const ch = channel === 'direct' ? 'direct' : 'bro';
    state.channel = ch;

    const root = applyRoot();
    root?.querySelectorAll('[data-promotion-apply-channel]').forEach(button => {
      const active = button.dataset.promotionApplyChannel === ch;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const hint = $('#promotionApplyChannelHint');
    if (hint) {
      hint.textContent = ch === 'direct'
        ? '직계약 주정산서로 계산합니다. 결과는 「프로모션정산등록」에서 직계약으로 표시됩니다.'
        : '브로 주정산서로 계산합니다. 직계약 정산서에 적용할 프로모션은 「직계약」으로 바꿔 계산하세요.';
    }

    // 채널이 바뀌면 이전 채널 정산서로 낸 결과가 남아 있으면 안 된다.
    const card = $('#promotionApplyResultCard');
    if (card) card.hidden = true;
    state.lastResult = null;
    state.savedResultId = '';

    if (!options.skipRender) renderActivePlatformSettlement();
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

    renderActivePlatformSettlement();
    renderPromotionRulePickersForPlatform(p);
    if (p === 'combined') {
      renderPromotionRulePickersForPlatform('combined');
    }

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

    applyRoot()?.querySelectorAll('[data-promotion-apply-channel]').forEach(button => {
      button.addEventListener('click', () => setChannel(button.dataset.promotionApplyChannel));
    });

    applyRoot()?.querySelectorAll('[data-promotion-apply-platform]').forEach(button => {
      button.addEventListener('click', () => setPlatform(button.dataset.promotionApplyPlatform));
    });

    ['coupang', 'baemin'].forEach(platform => {
      $$(`input[name="promotionApplyMode-${platform}"]`).forEach(input => {
        input.addEventListener('change', () => syncApplyModeUI(platform));
      });
      // 합산 탭 플랫폼별 채널 선택(배민 브로 / 쿠팡 직계약 등 교차 지원)
      $(`#promotionApplyCombinedChannel-${platform}`)?.addEventListener('change', event => {
        const ch = event.target.value === 'direct' ? 'direct' : 'bro';
        state.combinedChannel[platform] = ch;
        renderCombinedSettlementSelects();
      });
    });

    $('#promotionApplyForm')?.addEventListener('submit', event => {
      // 일반 계산은 무시 옵션을 끈다. 패널 버튼으로만 켠다.
      state.ignoreMissingRates = false;
      event.preventDefault();
      runCalculation();
    });

    $('#promotionApplyDeliveryFeeFile-baemin')?.addEventListener('change', event => {
      updateDeliveryFeeHint('baemin', event.target.files?.[0] || null);
    });
    ['combined-coupang', 'combined-baemin'].forEach(panelKey => {
      $(`#promotionApplyDeliveryFeeFile-${panelKey}`)?.addEventListener('change', () => {
        updateCombinedDeliveryFeeHints();
      });
    });

    $('#promotionApplySaveBtn')?.addEventListener('click', saveCurrentResult);
    $('#promotionApplyDownloadBtn')?.addEventListener('click', downloadCurrentResult);
    $('#promotionApplyResetBtn')?.addEventListener('click', resetCurrentResult);

    $('#promotionApplyRateMissingPanel')?.addEventListener('click', event => {
      const btn = event.target.closest('#promotionApplyIgnoreMissingRatesBtn');
      if (!btn) return;
      void runCalculationIgnoringMissingRates();
    });

    ['promotionApplySavedPlatformFilter', 'promotionApplySavedRegionFilter'].forEach(id => {
      const el = $(`#${id}`);
      if (!el) return;
      const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(eventName, () => renderSavedList());
    });

    $('#promotionApplySavedWeekExportBtn')?.addEventListener('click', downloadFilteredWeekResults);

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
    BremPromotionApply.invalidateSettlementOptionsCache?.();
    bindLegacyWeekInputs();
    initializeAllSettlementWeeks();
    const platform = getActivePlatform();
    if (platform === 'combined') {
      renderCombinedSettlementSelects();
    } else {
      renderSettlementSelectForPlatform(platform);
    }
    renderPromotionRulePickersForPlatform(platform);
    if (platform === 'combined') {
      renderPromotionRulePickersForPlatform('combined');
    }
    ensureSavedWeekFilter();
    updateSavedWeekRangeLabel();
    renderSavedList();
  }

  function init() {
    if (!applyRoot()) return;
    bindEvents();
    setChannel(state.channel, { skipRender: true });
    bindLegacyWeekInputs();
    initializeAllSettlementWeeks();
    setPlatform('coupang');
    ensureSavedWeekFilter();
    updateSavedWeekRangeLabel();
    renderSavedList();
  }

  window.BremPromotionApplyAdmin = { init, refresh, handleWeekSelect, handleSavedWeekSelect };
  return window.BremPromotionApplyAdmin;
})();

document.addEventListener('DOMContentLoaded', () => {
  BremPromotionApplyAdmin.init();
});
