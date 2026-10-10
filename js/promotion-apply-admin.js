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
    ignoreMissingRates: false,
    rainApply: false,
    gapTab: 'mission',
    gapRegions: { baemin: [], coupang: [] },
    gapBusy: false,
    gapResult: null
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

  function shortCoupangRegionName(name) {
    let raw = String(name || '').replace(/\s+/g, '').trim();
    if (!raw) return '';
    raw = raw.replace(/\(\d+\)$/g, '');
    const hangul = raw.replace(/[^가-힣]/g, '');
    const base = hangul || raw;
    return !base ? '' : (base.length <= 4 ? base : base.slice(-4));
  }

  function currentSetupGaps(result = state.gapResult || state.lastResult) {
    return BremPromotionApply.collectPromotionSetupGaps?.(result) || [];
  }

  function missionNameById(id) {
    const key = String(id || '').trim();
    if (!key) return '';
    return String(
      window.BremMissionPromotionCatalog?.getById?.(key)?.title
      || BremStorage.promotionRules.getById?.(key)?.name
      || ''
    ).trim();
  }

  function settlementRegionHint(result, platform) {
    const raw = String(result?.region || '').trim();
    if (!raw) return '';
    if (BremPlatforms.normalize(result?.platform) === 'combined') {
      const parts = raw.split('/').map(part => part.trim()).filter(Boolean);
      return platform === 'coupang' ? (parts[0] || '') : (parts[1] || parts[0] || '');
    }
    return raw;
  }

  function resolveCatalogRegion(platform, value) {
    const list = state.gapRegions[platform === 'coupang' ? 'coupang' : 'baemin'] || [];
    const key = matchRegionKey(list, value);
    return key ? findGapRegion(platform, key) : null;
  }

  function collectRegionMissionMismatches(result = state.gapResult || state.lastResult) {
    return BremPromotionApply.collectRegionMissionMismatches?.(result, {
      regions: state.gapRegions,
      setupDriverIds: currentSetupGaps(result).map(item => item.driverId),
      getDriver: id => BremStorage.drivers.getById?.(id) || null,
      getAssignment: driver => window.BremMissionPromotionCatalog?.getDriverAssignment?.(driver, { strict: false }) || {},
      isAssignmentLocked: driver => window.BremMissionPromotionCatalog?.isAssignmentLocked?.(driver) || Boolean(driver?.missionAssignmentLocked),
      readDefaults: (platform, region) => readSavedRegionDefaults(platform, region),
      missionName: missionNameById
    }) || [];
  }

  function settlementSides(result) {
    const platform = BremPlatforms.normalize(result?.platform);
    return platform === 'combined'
      ? ['baemin', 'coupang']
      : [platform === 'coupang' ? 'coupang' : 'baemin'];
  }

  function settlementExpectedMissions(result) {
    const expected = { baemin: '', coupang: '', combined: '' };
    settlementSides(result).forEach(side => {
      const region = resolveCatalogRegion(side, settlementRegionHint(result, side));
      const saved = region ? readSavedRegionDefaults(side, region) : {};
      if (saved.baemin) expected.baemin = saved.baemin;
      if (saved.coupang) expected.coupang = saved.coupang;
      if (saved.combined) expected.combined = saved.combined;
    });
    return expected;
  }

  function settlementExpectedRegions(result) {
    const expected = { baemin: '', coupang: '' };
    settlementSides(result).forEach(side => {
      const region = resolveCatalogRegion(side, settlementRegionHint(result, side));
      if (region?.key) expected[side] = region.key;
    });
    return expected;
  }

  function withExpectedDefaults(item, missions, regions) {
    let next = item;
    const currentMissions = next?.expectedMissions || {};
    if (!(currentMissions.baemin || currentMissions.coupang || currentMissions.combined)
      && (missions.baemin || missions.coupang || missions.combined)) {
      next = { ...next, expectedMissions: { ...missions } };
    }
    const currentRegions = next?.expectedRegions || {};
    if (!(currentRegions.baemin || currentRegions.coupang)
      && (regions.baemin || regions.coupang)) {
      next = { ...next, expectedRegions: { ...regions } };
    }
    return next;
  }

  function collectReviewItems(result = state.gapResult || state.lastResult) {
    const missions = settlementExpectedMissions(result);
    const regions = settlementExpectedRegions(result);
    const setup = currentSetupGaps(result).map(item => withExpectedDefaults(item, missions, regions));
    const mismatches = collectRegionMissionMismatches(result).map(item => withExpectedDefaults(item, missions, regions));
    return {
      setup,
      mismatches,
      all: setup.concat(mismatches)
    };
  }

  function driverRegionValue(driver, platform) {
    if (!driver) return '';
    return platform === 'coupang'
      ? String(driver.regionCoupang || driver.raw_data?.regionCoupang || '').trim()
      : String(driver.regionBaemin || driver.raw_data?.regionBaemin || '').trim();
  }

  function matchRegionKey(list, value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const rows = list || [];
    const exact = rows.find(region =>
      region.key === raw
      || region.label === raw
      || region.partnerId === raw
      || region.vendorId === raw
      || region.vendorName === raw
      || shortCoupangRegionName(region.vendorName) === raw
      || shortCoupangRegionName(region.label) === shortCoupangRegionName(raw)
    );
    if (exact) return exact.key;
    const scored = rows
      .map(region => ({
        region,
        score: Math.max(
          BremPromotionApply.scoreRegionAliasMatch?.(raw, region.label) || 0,
          BremPromotionApply.scoreRegionAliasMatch?.(raw, region.vendorName) || 0
        )
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || String(b.region.label || '').length - String(a.region.label || '').length);
    if (scored[0]) return scored[0].region.key;
    const fuzzy = rows
      .filter(region => {
        const label = String(region.label || '');
        return (label && raw && (label.includes(raw) || raw.includes(label)));
      })
      .sort((a, b) => String(b.label || '').length - String(a.label || '').length);
    return fuzzy[0]?.key || '';
  }

  function missionOptionsHtml(platform, selectedId, placeholder) {
    const items = window.BremMissionPromotionCatalog?.getForPlatform?.(platform) || [];
    const selected = String(selectedId || '');
    const options = [
      `<option value="">${escapeHtml(placeholder)}</option>`,
      `<option value="__clear__">미배정으로 비우기</option>`,
      ...items.map(item => {
        const inactive = item.isActive === false ? ' (중지)' : '';
        return `<option value="${escapeHtml(item.id)}"${item.id === selected ? ' selected' : ''}>${escapeHtml(item.title)}${inactive}</option>`;
      })
    ];
    return options.join('');
  }

  function regionOptionsHtml(platform, selectedValue) {
    const list = state.gapRegions[platform === 'coupang' ? 'coupang' : 'baemin'] || [];
    const selectedKey = matchRegionKey(list, selectedValue);
    return [
      '<option value="">변경 안 함</option>',
      '<option value="__clear__">미배정으로 비우기</option>',
      ...list.map(region => {
        const extra = region.partnerId ? ` (${escapeHtml(region.partnerId)})` : '';
        return `<option value="${escapeHtml(region.key)}"${region.key === selectedKey ? ' selected' : ''}>${escapeHtml(region.label)}${extra}</option>`;
      })
    ].join('');
  }

  function fallbackRegionsFromDrivers(platform) {
    const field = platform === 'coupang' ? 'regionCoupang' : 'regionBaemin';
    const seen = new Set();
    return (BremStorage.drivers.getAll?.() || [])
      .map(driver => String(driver?.[field] || driver?.raw_data?.[field] || '').trim())
      .filter(Boolean)
      .filter(label => {
        if (seen.has(label)) return false;
        seen.add(label);
        return true;
      })
      .sort((a, b) => a.localeCompare(b, 'ko'))
      .map(label => ({ key: label, label, platform }));
  }

  async function ensureGapRegions() {
    const token = await window.BremStorage?.resolveAdminAccessToken?.();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const res = await fetch('/api/admin/baemin-delivery/partner-regions', { headers, credentials: 'same-origin' });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        state.gapRegions.baemin = (payload.allItems || payload.items || []).map(item => ({
          key: String(item.partnerId || '').trim(),
          partnerId: String(item.partnerId || '').trim(),
          label: String(item.regionName || '').trim(),
          platform: 'baemin'
        })).filter(item => item.key && item.label);
      }
    } catch (error) {
      console.warn('[BREM] promotion gap baemin regions:', error);
    }
    try {
      const res = await fetch('/api/admin/coupang/vendor-regions', { headers, credentials: 'same-origin' });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        const seen = new Set();
        state.gapRegions.coupang = (payload.allItems || payload.items || []).map(item => {
          const vendorId = String(item.vendorId || '').trim();
          const vendorName = String(item.vendorName || '').trim();
          if (!vendorId || seen.has(vendorId)) return null;
          seen.add(vendorId);
          return {
            key: vendorId,
            vendorId,
            vendorName,
            label: shortCoupangRegionName(vendorName) || vendorId,
            platform: 'coupang'
          };
        }).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
      }
    } catch (error) {
      console.warn('[BREM] promotion gap coupang regions:', error);
    }
    if (!state.gapRegions.baemin.length) state.gapRegions.baemin = fallbackRegionsFromDrivers('baemin');
    if (!state.gapRegions.coupang.length) state.gapRegions.coupang = fallbackRegionsFromDrivers('coupang');
  }

  function findGapRegion(platform, key) {
    return (state.gapRegions[platform === 'coupang' ? 'coupang' : 'baemin'] || [])
      .find(item => item.key === key) || null;
  }

  function ensureGapPopup() {
    let root = $('#promotionApplyGapPopup');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'promotionApplyGapPopup';
    root.className = 'promotion-gap-popup';
    root.hidden = true;
    root.innerHTML = `
      <button type="button" class="promotion-gap-popup__backdrop" data-gap-close aria-label="닫기"></button>
      <div class="promotion-gap-popup__dialog" role="dialog" aria-modal="true" aria-labelledby="promotionApplyGapTitle">
        <div class="promotion-gap-popup__head">
          <p class="promotion-gap-popup__eyebrow">프로모션 적용</p>
          <div class="promotion-gap-popup__title-row">
            <h2 id="promotionApplyGapTitle">확인 필요</h2>
            <button type="button" class="small-btn" data-gap-close>닫기</button>
          </div>
          <p class="promotion-gap-popup__meta" id="promotionApplyGapMeta">미지급 조건은 제외했습니다. 지역을 옮긴 기사는 미션을 고치거나 그대로 두고 진행할 수 있습니다.</p>
        </div>
        <div class="promotion-gap-popup__tabs" role="tablist">
          <button type="button" class="promotion-gap-popup__tab is-active" data-gap-tab="mission">미션 설정</button>
          <button type="button" class="promotion-gap-popup__tab" data-gap-tab="region">지역 설정</button>
        </div>
        <div class="promotion-gap-popup__body">
          <div data-gap-panel="mission"></div>
          <div data-gap-panel="region" hidden></div>
        </div>
        <div class="promotion-gap-popup__foot">
          <div class="promotion-gap-popup__foot-links">
            <button type="button" class="small-btn" data-gap-goto="mission-management">미션관리</button>
            <button type="button" class="small-btn" data-gap-goto="mission-assignment">미션배정</button>
            <button type="button" class="small-btn" data-gap-goto="driver-region">기사지역관리</button>
          </div>
          <div class="promotion-gap-popup__foot-actions">
            <button type="button" class="small-btn" data-gap-keep>그대로 진행</button>
            <button type="button" class="primary-btn" id="promotionApplyGapSaveBtn">저장 후 다시 계산</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    root.addEventListener('click', event => {
      if (event.target.closest('[data-gap-close]') || event.target.closest('[data-gap-keep]')) {
        hideGapPopup();
        return;
      }
      const tabBtn = event.target.closest('[data-gap-tab]');
      if (tabBtn) {
        setGapTab(tabBtn.dataset.gapTab);
        return;
      }
      const gotoBtn = event.target.closest('[data-gap-goto]');
      if (gotoBtn) {
        goToGapSection(gotoBtn.dataset.gapGoto);
        return;
      }
      if (event.target.closest('#promotionApplyGapSaveBtn')) {
        void saveGapFixesAndRecalc();
        return;
      }
      if (event.target.closest('#promotionApplyGapApplyDefaultsBtn')) {
        applyExpectedMissionsToSelects();
        return;
      }
      const oneBtn = event.target.closest('[data-gap-apply-one]');
      if (oneBtn) applyExpectedMissionsToSelects(oneBtn.closest('tr'));
    });
    return root;
  }

  function setGapTab(tab) {
    state.gapTab = tab === 'region' ? 'region' : 'mission';
    const root = ensureGapPopup();
    root.querySelectorAll('[data-gap-tab]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.gapTab === state.gapTab);
    });
    root.querySelectorAll('[data-gap-panel]').forEach(panel => {
      panel.hidden = panel.dataset.gapPanel !== state.gapTab;
    });
  }

  function hideGapPopup() {
    const root = $('#promotionApplyGapPopup');
    if (root) root.hidden = true;
    document.body.classList.remove('promotion-gap-open');
    state.gapResult = null;
  }

  function gapRowLabel(gap, result) {
    const row = gap.row || {};
    const platform = result?.platform;
    if (BremPlatforms.normalize(platform) === 'baemin') {
      const id = BremPromotionApply.getResultRowBaeminRiderId(row);
      const name = BremPromotionApply.getResultRowMatchedDriverName(row);
      return name ? `${id} · ${name}` : id;
    }
    if (BremPlatforms.normalize(platform) === 'combined') {
      return BremPromotionApply.getResultRowErpName(row) || BremPromotionApply.getResultRowDisplayName(row, platform);
    }
    return BremPromotionApply.getResultRowDisplayName(row, platform);
  }

  function renderGapPanels(result) {
    const root = ensureGapPopup();
    const review = collectReviewItems(result);
    const gaps = review.all;
    const title = root.querySelector('#promotionApplyGapTitle');
    const meta = root.querySelector('#promotionApplyGapMeta');
    if (title) {
      title.textContent = review.setup.length && review.mismatches.length
        ? `확인 필요 ${formatNumber(gaps.length)}명`
        : review.mismatches.length
          ? `지역 기본과 다른 미션 ${formatNumber(review.mismatches.length)}명`
          : `계산 누락 ${formatNumber(review.setup.length)}명`;
    }
    const missionCount = review.setup.filter(item => item.category === 'mission' || item.reasons.some(reason => String(reason).includes('미션'))).length;
    const regionCount = review.setup.filter(item => item.reasons.some(reason => String(reason).includes('지역 미배정'))).length;
    const matchCount = review.setup.filter(item => item.category === 'match').length;
    const feeCount = review.setup.filter(item => item.category === 'delivery_fee').length;
    if (meta) {
      meta.textContent = [
        review.setup.length ? '미지급 조건은 제외했습니다.' : '계산은 됐습니다.',
        missionCount ? `미션 누락 ${missionCount}명` : '',
        review.mismatches.length ? `다른 지역 미션 ${review.mismatches.length}명` : '',
        regionCount ? `지역 ${regionCount}명` : '',
        matchCount ? `ERP 미매칭 ${matchCount}명` : '',
        feeCount ? `배달처리비 ${feeCount}명` : '',
        '고친 뒤 다시 계산하거나, 그대로 진행할 수 있습니다.'
      ].filter(Boolean).join(' · ');
    }

    const assignedOf = (driver, platform) => {
      const assigned = window.BremMissionPromotionCatalog?.getDriverAssignment?.(driver, { strict: false }) || {};
      return assigned[platform] || '';
    };

    const missionPanel = root.querySelector('[data-gap-panel="mission"]');
    if (missionPanel) {
      missionPanel.innerHTML = `
        ${gaps.some(gap => gap.canEdit) ? `
          <div class="promotion-gap-toolbar">
            <button type="button" class="small-btn" id="promotionApplyGapApplyDefaultsBtn">지역 기본미션으로 맞추기</button>
            <p>버튼을 누르면 미션과 지역이 이 정산 지역 기본값으로 바뀝니다. 일부러 다르게 둘 사람은 칸을 되돌리거나 그대로 진행하세요.</p>
          </div>
        ` : ''}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>기사</th>
                <th>플랫폼</th>
                <th>사유</th>
                <th>배민 미션</th>
                <th>쿠팡 미션</th>
                <th>합산 미션</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${gaps.map(gap => {
                const can = gap.canEdit;
                const expected = gap.expectedMissions || {};
                const expectedRegions = gap.expectedRegions || {};
                return `
                  <tr data-gap-key="${escapeHtml(gap.key)}" data-gap-driver="${escapeHtml(gap.driverId)}" data-gap-expected-baemin="${escapeHtml(expected.baemin || '')}" data-gap-expected-coupang="${escapeHtml(expected.coupang || '')}" data-gap-expected-combined="${escapeHtml(expected.combined || '')}" data-gap-expected-region-baemin="${escapeHtml(expectedRegions.baemin || '')}" data-gap-expected-region-coupang="${escapeHtml(expectedRegions.coupang || '')}">
                    <td><strong>${escapeHtml(gapRowLabel(gap, result))}</strong></td>
                    <td>${escapeHtml(platformLabel(gap.platform))}</td>
                    <td class="promotion-gap-reason">${escapeHtml(gap.reasons.join(' · '))}</td>
                    <td>${can ? `<select data-gap-mission="baemin">${missionOptionsHtml('baemin', assignedOf(gap.driver, 'baemin'), '변경 안 함')}</select>` : '-'}</td>
                    <td>${can ? `<select data-gap-mission="coupang">${missionOptionsHtml('coupang', assignedOf(gap.driver, 'coupang'), '변경 안 함')}</select>` : '-'}</td>
                    <td>${can ? `<select data-gap-mission="combined">${missionOptionsHtml('combined', assignedOf(gap.driver, 'combined'), '변경 안 함')}</select>` : '-'}</td>
                    <td>${can && (expected.baemin || expected.coupang || expected.combined) ? '<button type="button" class="small-btn" data-gap-apply-one>기본으로</button>' : ''}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    const regionPanel = root.querySelector('[data-gap-panel="region"]');
    if (regionPanel) {
      regionPanel.innerHTML = `
        <p class="promotion-gap-default-hint">${escapeHtml(formatSettlementDefaultHint(result))}</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>기사</th>
                <th>현재 배민지역</th>
                <th>현재 쿠팡지역</th>
                <th>배민 지역</th>
                <th>쿠팡 지역</th>
                <th>사유</th>
              </tr>
            </thead>
            <tbody>
              ${gaps.map(gap => {
                const can = gap.canEdit;
                const expectedRegions = gap.expectedRegions || {};
                return `
                  <tr data-gap-key="${escapeHtml(gap.key)}" data-gap-driver="${escapeHtml(gap.driverId)}" data-gap-expected-region-baemin="${escapeHtml(expectedRegions.baemin || '')}" data-gap-expected-region-coupang="${escapeHtml(expectedRegions.coupang || '')}">
                    <td><strong>${escapeHtml(gapRowLabel(gap, result))}</strong></td>
                    <td>${escapeHtml(driverRegionValue(gap.driver, 'baemin') || '미배정')}</td>
                    <td>${escapeHtml(driverRegionValue(gap.driver, 'coupang') || '미배정')}</td>
                    <td>${can ? `<select data-gap-region="baemin">${regionOptionsHtml('baemin', driverRegionValue(gap.driver, 'baemin'))}</select>` : '-'}</td>
                    <td>${can ? `<select data-gap-region="coupang">${regionOptionsHtml('coupang', driverRegionValue(gap.driver, 'coupang'))}</select>` : '-'}</td>
                    <td class="promotion-gap-reason">${escapeHtml(gap.reasons.join(' · '))}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  }

  function readSavedRegionDefaults(platform, region) {
    const empty = { baemin: '', coupang: '', combined: '' };
    const store = window.BremStorage?.missionDefaults;
    if (!store?.getRegion || !region) return empty;
    const keys = [region.key, region.partnerId, region.vendorId, region.label]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index);
    for (const key of keys) {
      const saved = store.getRegion(platform, key);
      if (saved?.baemin || saved?.coupang || saved?.combined) return saved;
    }
    return empty;
  }

  function formatSettlementDefaultHint(result) {
    const platform = BremPlatforms.normalize(result?.platform) === 'coupang' ? 'coupang' : 'baemin';
    const hint = settlementRegionHint(result, platform);
    const region = resolveCatalogRegion(platform, hint);
    if (!region) {
      return '지역 기본미션은 미션배정에서 저장한 값을 씁니다. 이 화면에서는 기사 지역만 고치면 됩니다.';
    }
    const saved = readSavedRegionDefaults(platform, region);
    const pick = (id, emptyText) => (id ? (missionNameById(id) || '삭제된 미션') : emptyText);
    if (!saved.baemin && !saved.coupang && !saved.combined) {
      return `${region.label} 기본미션이 없습니다. 미션배정에서 저장하면, 다른 지역 잔여 미션을 여기서 골라냅니다.`;
    }
    return `${region.label} 기본미션 · 배민 ${pick(saved.baemin, '미배정')} · 쿠팡 ${pick(saved.coupang, '미배정')} · 합산 ${pick(saved.combined, '미배정')} (미션배정 저장값)`;
  }

  async function openGapPopup(result = state.lastResult) {
    await ensureGapRegions();
    state.gapResult = result || state.lastResult;
    const review = collectReviewItems(state.gapResult);
    if (!review.all.length) {
      hideGapPopup();
      return false;
    }
    const root = ensureGapPopup();
    renderGapPanels(state.gapResult);
    const preferRegion = review.setup.length
      && review.setup.every(item => item.reasons.some(reason => String(reason).includes('지역 미배정')) && item.category !== 'mission')
      && !review.mismatches.length;
    setGapTab(preferRegion ? 'region' : 'mission');
    root.hidden = false;
    document.body.classList.add('promotion-gap-open');
    paintGapBanner(state.gapResult);
    return true;
  }

  function paintGapBanner(result) {
    const summaryEl = $('#promotionApplyResultSummary');
    if (!summaryEl) return;
    const review = collectReviewItems(result);
    const parts = [];
    if (review.setup.length) parts.push(`계산 누락 <strong>${formatNumber(review.setup.length)}</strong>명`);
    if (review.mismatches.length) parts.push(`지역 기본과 다른 미션 <strong>${formatNumber(review.mismatches.length)}</strong>명`);
    const html = parts.length
      ? `<p class="promotion-gap-summary">⚠ ${parts.join(' · ')} <button type="button" class="small-btn" id="promotionApplyOpenGapBtn">바로 수정</button></p>`
      : '';
    const existing = summaryEl.querySelector('.promotion-gap-summary');
    if (!html) {
      existing?.remove();
      return;
    }
    if (existing) existing.outerHTML = html;
    else summaryEl.insertAdjacentHTML('beforeend', html);
  }

  function fillRegionSelect(select, value) {
    if (!select) return false;
    const next = String(value || '');
    if (!next) return false;
    const options = [...select.options];
    let match = options.find(option => option.value === next);
    if (!match) {
      const platform = select.dataset.gapRegion === 'coupang' ? 'coupang' : 'baemin';
      const key = matchRegionKey(state.gapRegions[platform] || [], next);
      if (key) match = options.find(option => option.value === key);
    }
    if (!match) return false;
    select.value = match.value;
    options.forEach(option => {
      option.selected = option === match;
    });
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function applyExpectedRegionsToDriver(driverId, expectedRegions = {}) {
    const root = ensureGapPopup();
    const safeId = window.CSS?.escape ? CSS.escape(String(driverId || '')) : String(driverId || '');
    if (!safeId) return false;
    const regionTr = root.querySelector(`[data-gap-panel="region"] tr[data-gap-driver="${safeId}"]`);
    if (!regionTr) return false;
    let changed = false;
    if (expectedRegions.baemin) {
      changed = fillRegionSelect(regionTr.querySelector('[data-gap-region="baemin"]'), expectedRegions.baemin) || changed;
      const currentEl = regionTr.children[1];
      const region = findGapRegion('baemin', expectedRegions.baemin);
      if (currentEl && region?.label) currentEl.textContent = region.label;
    }
    if (expectedRegions.coupang) {
      changed = fillRegionSelect(regionTr.querySelector('[data-gap-region="coupang"]'), expectedRegions.coupang) || changed;
      const currentEl = regionTr.children[2];
      const region = findGapRegion('coupang', expectedRegions.coupang);
      if (currentEl && region?.label) currentEl.textContent = region.label;
    }
    return changed;
  }

  function fillMissionSelect(select, value) {
    if (!select) return false;
    const next = String(value || '');
    const options = [...select.options];
    let match = options.find(option => option.value === next);
    if (!match && next && next !== '__clear__') {
      const name = missionNameById(next).replace(/\s+/g, '');
      if (name) {
        match = options.find(option => String(option.textContent || '').replace(/\s+/g, '').includes(name));
      }
    }
    if (!match) return false;
    select.value = match.value;
    options.forEach(option => {
      option.selected = option === match;
    });
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function applyExpectedMissionsToSelects(scope) {
    const root = scope || ensureGapPopup().querySelector('[data-gap-panel="mission"]');
    const rows = scope?.matches?.('tr')
      ? [scope]
      : [...(root?.querySelectorAll('tr[data-gap-driver]') || [])];
    let filled = 0;
    rows.forEach(tr => {
      const baemin = tr.dataset.gapExpectedBaemin || '';
      const coupang = tr.dataset.gapExpectedCoupang || '';
      const combined = tr.dataset.gapExpectedCombined || '';
      const expectedRegions = {
        baemin: tr.dataset.gapExpectedRegionBaemin || '',
        coupang: tr.dataset.gapExpectedRegionCoupang || ''
      };
      if (!baemin && !coupang && !combined && !expectedRegions.baemin && !expectedRegions.coupang) return;
      let changed = false;
      if (combined) {
        changed = fillMissionSelect(tr.querySelector('[data-gap-mission="combined"]'), combined) || changed;
        fillMissionSelect(tr.querySelector('[data-gap-mission="baemin"]'), '__clear__');
        fillMissionSelect(tr.querySelector('[data-gap-mission="coupang"]'), '__clear__');
      } else {
        if (baemin) changed = fillMissionSelect(tr.querySelector('[data-gap-mission="baemin"]'), baemin) || changed;
        if (coupang) changed = fillMissionSelect(tr.querySelector('[data-gap-mission="coupang"]'), coupang) || changed;
        fillMissionSelect(tr.querySelector('[data-gap-mission="combined"]'), '__clear__');
      }
      changed = applyExpectedRegionsToDriver(tr.dataset.gapDriver, expectedRegions) || changed;
      if (changed) filled += 1;
    });
    showToast(filled
      ? `${filled}명 미션·지역을 이 정산 기본으로 바꿨습니다. 저장 후 다시 계산하세요.`
      : '맞출 지역 기본값이 없습니다.');
  }

  function goToGapSection(target) {
    hideGapPopup();
    if (target === 'driver-region') {
      document.querySelector('.nav-btn[data-section="driver-management"]')?.click();
      window.setTimeout(() => {
        document.querySelector('[data-driver-mgmt-tab="region"]')?.click();
      }, 80);
      return;
    }
    document.querySelector(`.nav-btn[data-section="${target}"]`)?.click();
  }

  function readGapMissionPatch(tr, driver) {
    const catalog = window.BremMissionPromotionCatalog;
    if (!catalog?.buildAssignmentPatch || !driver) return null;
    const current = catalog.getDriverAssignment?.(driver, { strict: false }) || {};
    const read = platform => {
      const value = tr.querySelector(`[data-gap-mission="${platform}"]`)?.value;
      if (value == null || value === '') return current[platform] || '';
      if (value === '__clear__') return '';
      return value;
    };
    const next = {
      baemin: read('baemin'),
      coupang: read('coupang'),
      combined: read('combined')
    };
    const patch = catalog.buildAssignmentPatch(next);
    const changed = Object.keys(patch).some(key => String(patch[key] || '') !== String(driver[key] || ''));
    return changed ? patch : null;
  }

  function applyRegionDefaultToPatch(driver, region, platform, existingPatch) {
    const catalog = window.BremMissionPromotionCatalog;
    if (!catalog?.buildAssignmentPatch || catalog.isAssignmentLocked?.(driver)) return existingPatch;
    const assigned = catalog.getDriverAssignment?.(driver, { strict: true }) || {};
    const defaults = readSavedRegionDefaults(platform, region);
    const next = { ...assigned };
    let changed = false;
    if (!assigned.combined) {
      if (platform === 'baemin' && !assigned.baemin && defaults.baemin) {
        next.baemin = defaults.baemin;
        changed = true;
      }
      if (platform === 'coupang' && !assigned.coupang && defaults.coupang) {
        next.coupang = defaults.coupang;
        changed = true;
      }
      if (!assigned.baemin && !assigned.coupang && defaults.combined) {
        next.combined = defaults.combined;
        next.baemin = '';
        next.coupang = '';
        changed = true;
      }
    }
    if (!changed) return existingPatch;
    const missionPatch = catalog.buildAssignmentPatch(next);
    return { ...(existingPatch || {}), ...missionPatch };
  }

  function readGapRegionPatch(tr, driver) {
    if (!driver) return null;
    let patch = {};
    ['baemin', 'coupang'].forEach(platform => {
      const value = tr.querySelector(`[data-gap-region="${platform}"]`)?.value;
      if (value == null || value === '') return;
      if (value === '__clear__') {
        if (platform === 'coupang') patch.regionCoupang = '';
        else patch.regionBaemin = '';
        return;
      }
      const region = findGapRegion(platform, value);
      if (!region) return;
      if (platform === 'coupang') {
        patch.regionCoupang = region.label;
        patch.platformCoupang = true;
      } else {
        patch.regionBaemin = region.label;
        patch.platformBaemin = true;
      }
      const merged = { ...driver, ...patch };
      const withDefault = applyRegionDefaultToPatch(merged, region, platform, patch);
      if (withDefault) patch = withDefault;
    });
    return Object.keys(patch).length ? patch : null;
  }

  async function saveGapFixesAndRecalc() {
    if (state.gapBusy) return;
    const root = ensureGapPopup();
    const gaps = collectReviewItems().all;
    const byDriver = new Map();
    gaps.forEach(gap => {
      if (!gap.driverId || !gap.driver) return;
      const safeId = window.CSS?.escape ? CSS.escape(gap.driverId) : gap.driverId;
      const missionTr = root.querySelector(`[data-gap-panel="mission"] tr[data-gap-driver="${safeId}"]`);
      const regionTr = root.querySelector(`[data-gap-panel="region"] tr[data-gap-driver="${safeId}"]`);
      const missionPatch = missionTr ? readGapMissionPatch(missionTr, gap.driver) : null;
      const regionPatch = regionTr ? readGapRegionPatch(regionTr, gap.driver) : null;
      const changes = { ...(regionPatch || {}), ...(missionPatch || {}) };
      if (!Object.keys(changes).length) return;
      const prev = byDriver.get(gap.driverId) || { id: gap.driverId, changes: {} };
      prev.changes = { ...prev.changes, ...changes };
      byDriver.set(gap.driverId, prev);
    });
    const patches = [...byDriver.values()];
    if (!patches.length) {
      showToast('변경된 미션·지역이 없습니다. 값을 고친 뒤 저장하세요.');
      return;
    }
    state.gapBusy = true;
    const btn = $('#promotionApplyGapSaveBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '저장 중…';
    }
    try {
      const result = await BremStorage.drivers.batchPatch(patches);
      if (result?.warning) showToast(result.warning);
      else showToast(`${patches.length}명 미션·지역을 저장했습니다. 다시 계산합니다.`);
      hideGapPopup();
      await runCalculation({
        ignoreMissingRates: state.lastResult?.ignoreMissingRates === true || state.ignoreMissingRates === true,
        rainApply: state.lastResult?.rainApply === true || state.rainApply === true
      });
    } catch (error) {
      showToast(error.message || '미션·지역 저장에 실패했습니다.');
    } finally {
      state.gapBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = '저장 후 다시 계산';
      }
    }
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
        ? '단가보장 조건이 있으면 <strong>쿠팡 주정산서(배달현황)</strong>·<strong>배민 배달처리비</strong>를 모두 업로드하세요. 합산 콜수로 구간을 고르고, 쿠팡은 3시트 <strong>B열·Y열</strong>, 배민은 <strong>K열·AI열</strong>로 보장액을 각각 계산합니다. 배민 단가보장 우천은 <strong>우천적용</strong>으로 계산하세요. AC(기상할증)가 있는 건은 AI-500원으로 보장합니다.'
        : '단가보장(미션 배정) 시 <strong>배달처리비_팀명_YYYYMMDD_YYYYMMDD</strong> 파일을 업로드하세요. <strong>K열 User ID</strong> 매칭 · <strong>U·V·AI 중 하나라도 빈칸/0이면 해당 행 전체 무효</strong> · 세 열 모두 유효한 행만 집계. 단가보장 우천은 <strong>우천적용</strong>으로 계산하세요. AC(기상할증)가 있는 건은 AI-500원으로 보장합니다.';
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
        + '<br>쿠팡은 <strong>배달현황_…_YYYYMMDD</strong> 주정산서(3시트 B·Y), 배민은 <strong>배달처리비_…_시작_종료</strong>(K·AI)입니다.';
    }
  }

  async function resolveDeliveryFeeForCalculation(platform, baeminSettlement, coupangSettlement = null) {
    const assignmentMode = readApplyMode(platform);
    const ruleIds = assignmentMode === 'selected_rules'
      ? readSelectedRuleIds(platform)
      : [];
    const pickOptions = { assignmentMode };
    const needsFile = platform === 'combined'
      ? BremPromotionApply.combinedSettlementsNeedDeliveryFee(coupangSettlement, baeminSettlement, ruleIds, pickOptions)
      : BremPromotionApply.settlementNeedsDeliveryFee(baeminSettlement, 'baemin', ruleIds, pickOptions);
    if (!needsFile) return null;

    if (platform === 'combined') {
      const coupangPassword = $('#promotionApplyDeliveryFeePassword-combined-coupang')?.value ?? '';
      const baeminPassword = $('#promotionApplyDeliveryFeePassword-combined-baemin')?.value ?? '';
      const coupangFile = $('#promotionApplyDeliveryFeeFile-combined-coupang')?.files?.[0];
      const baeminFile = $('#promotionApplyDeliveryFeeFile-combined-baemin')?.files?.[0];
      if (!coupangFile && !baeminFile) return null;

      let coupangParsed = null;
      let baeminParsed = null;
      if (coupangFile) {
        coupangParsed = await BremCoupangDeliveryFee.parseFile(coupangFile, coupangPassword);
        BremCoupangDeliveryFee.assertDateMatch(coupangSettlement, coupangParsed);
      }
      if (baeminFile) {
        baeminParsed = await BremBaeminDeliveryFee.parseFile(baeminFile, baeminPassword);
        BremBaeminDeliveryFee.assertDateMatch(baeminSettlement, baeminParsed);
      }

      return {
        baemin: baeminParsed,
        coupang: coupangParsed,
        index: baeminParsed?.index || null,
        fileName: [coupangParsed?.fileName, baeminParsed?.fileName].filter(Boolean).join(' / '),
        teamName: baeminParsed?.teamName || coupangParsed?.teamName,
        startDate: baeminParsed?.startDate || coupangParsed?.startDate,
        endDate: baeminParsed?.endDate || coupangParsed?.endDate,
        riderCount: Number(baeminParsed?.riderCount || 0) + Number(coupangParsed?.riderCount || 0)
      };
    }

    const panelKey = deliveryFeePanelKey(platform);
    const fileInput = $(`#promotionApplyDeliveryFeeFile-${panelKey}`);
    const passwordInput = $(`#promotionApplyDeliveryFeePassword-${panelKey}`);
    const file = fileInput?.files?.[0];
    if (!file) return null;

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
    if (platform === 'baemin') fillSecondPartSelect('promotionApplySettlementSelect2-baemin', options);
  }

  // 부분1·2 직접 선택용 두 번째 배민 정산서 목록을 채운다(같은 옵션).
  function fillSecondPartSelect(id, options) {
    const sel = $(`#${id}`);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = ['<option value="">합칠 부분2 정산서 선택</option>']
      .concat(options.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`))
      .join('');
    sel.value = (prev && options.some(item => item.id === prev)) ? prev : '';
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
      if (platform === 'baemin') fillSecondPartSelect('promotionApplySettlementSelect2-combined-baemin', options);
    });
  }

  function renderSettlementSelect() {
    PLATFORMS.filter(platform => platform !== 'combined').forEach(renderSettlementSelectForPlatform);
    renderCombinedSettlementSelects();
  }

  function readApplyMode(platform = getActivePlatform()) {
    const checked = $(`input[name="promotionApplyMode-${platform}"]:checked`);
    return checked?.value === 'selected_rules' ? 'selected_rules' : 'per_driver';
  }

  function syncApplyModeUI(platform) {
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

    if (platform === 'combined') {
      let combinedCount = 0;
      let coupangOnlyCount = 0;
      let baeminOnlyCount = 0;
      let splitCount = 0;
      drivers.forEach(driver => {
        const assignment = catalog?.getDriverAssignment?.(driver, { strict: true }) || {};
        if (assignment.combined) combinedCount += 1;
        else if (assignment.coupang && assignment.baemin) splitCount += 1;
        else if (assignment.coupang) coupangOnlyCount += 1;
        else if (assignment.baemin) baeminOnlyCount += 1;
      });
      const assignedTotal = combinedCount + splitCount + coupangOnlyCount + baeminOnlyCount;
      const missions = catalog?.getForPlatform?.('combined') || [];
      const baeminMissions = catalog?.getForPlatform?.('baemin') || [];
      const coupangMissions = catalog?.getForPlatform?.('coupang') || [];
      container.innerHTML = `
        <p class="form-help promotion-apply-mission-summary">
          <strong>미션 관리</strong>에서 배정한 조건을 기사별로 자동 적용합니다.
          합산 미션이 있으면 쿠팡+배민 합산으로, 없으면 쿠팡·배민 개별 미션을 각각 적용합니다.
        </p>
        <p class="form-help">배정 현황: 합산 <strong>${combinedCount}</strong>명 · 쿠팡+배민 분리 <strong>${splitCount}</strong>명 · 쿠팡만 <strong>${coupangOnlyCount}</strong>명 · 배민만 <strong>${baeminOnlyCount}</strong>명 (총 ${assignedTotal}명 / 전체 ${drivers.length}명)</p>
        <p class="form-help">합산 미션 ${missions.length}개 · 쿠팡 ${coupangMissions.length}개 · 배민 ${baeminMissions.length}개</p>
      `;
      return;
    }

    const field = platform === 'baemin' ? 'baemin' : 'coupang';
    const assigned = drivers.filter(driver => {
      const assignment = catalog?.getDriverAssignment?.(driver, { strict: true }) || {};
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
        <span>${escapeHtml(rule.name)}${rule.slaApply ? ' <span class="promotion-sla-tag">SLA시간</span>' : ''}</span>
      </label>
    `).join('');
  }

  function renderPromotionRulePickersForPlatform(platform) {
    const container = $(`#promotionApplyRuleList-${platform}`);
    if (!container) return;

    if (platform === 'coupang' || platform === 'baemin' || platform === 'combined') {
      renderPromotionRuleCheckboxList(platform, container);
      renderMissionAssignmentSummary(platform);
      syncApplyModeUI(platform);
      return;
    }
  }

  function renderPromotionRulePickers() {
    PLATFORMS.forEach(renderPromotionRulePickersForPlatform);
  }

  async function renderResult(result, options = {}) {
    const card = $('#promotionApplyResultCard');
    const rowsEl = $('#promotionApplyResultRows');
    const summaryEl = $('#promotionApplyResultSummary');
    if (!card || !rowsEl || !result) return;
    await ensureGapRegions();

    card.hidden = false;
    const slaCount = Number(result.slaApplyCount || 0);
    const slaAll = result.slaApplyAll === true;
    const slaMissions = (result.slaMissions || []).filter(Boolean);
    const slaOtherMissions = (result.slaOtherMissions || []).filter(Boolean);
    const resultSlaTag = $('#promotionApplyResultSlaTag');
    if (resultSlaTag) {
      resultSlaTag.hidden = slaCount <= 0 && result.slaApply !== true;
      resultSlaTag.textContent = slaAll || (slaCount > 0 && Number(result.slaOtherCount || 0) <= 0)
        ? 'SLA시간'
        : (slaCount > 0 ? `SLA시간 ${formatNumber(slaCount)}명` : 'SLA시간');
    }
    const savedBadge = options.savedAt
      ? `<p>저장일: <strong>${escapeHtml(String(options.savedAt).slice(0, 19).replace('T', ' '))}</strong></p>`
      : '';
    const isCombined = BremPlatforms.normalize(result.platform) === 'combined';
    const combinedSummary = isCombined
      ? `<p>적용 구분: 쿠팡만 <strong>${formatNumber(result.summary?.coupangAssigned)}</strong>명 · 배민만 <strong>${formatNumber(result.summary?.baeminAssigned)}</strong>명 · 분리(쿠팡+배민 각각) <strong>${formatNumber(result.summary?.splitAssigned)}</strong>명 · 합산 미션 <strong>${formatNumber(result.summary?.overlapAssigned)}</strong>명</p>
        <p class="form-help">정산서 붙이기: 배민 <strong>${formatMoney(result.summary?.baeminAttachTotal ?? result.summary?.totalPromotionAmount)}</strong> (1순위) · 쿠팡 <strong>${formatMoney(result.summary?.coupangAttachTotal ?? 0)}</strong> (2순위, 쿠팡-only)</p>`
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
    const reviewItems = collectReviewItems(result);
    const mismatchIds = new Set(reviewItems.mismatches.map(item => String(item.driverId || '')));
    const setupGaps = reviewItems.setup;
    const gapParts = [];
    if (setupGaps.length) gapParts.push(`계산 누락 <strong>${formatNumber(setupGaps.length)}</strong>명`);
    if (reviewItems.mismatches.length) gapParts.push(`지역 기본과 다른 미션 <strong>${formatNumber(reviewItems.mismatches.length)}</strong>명`);
    const gapSummary = gapParts.length
      ? `<p class="promotion-gap-summary">⚠ ${gapParts.join(' · ')} <button type="button" class="small-btn" id="promotionApplyOpenGapBtn">바로 수정</button></p>`
      : '';

    summaryEl.innerHTML = `
      <p>대상: <strong>${escapeHtml(result.settlementLabel)}</strong></p>
      <p>정산기간: <strong>${escapeHtml(result.startDate)} ~ ${escapeHtml(result.endDate)}</strong></p>
      <p>적용 방식: <strong>${escapeHtml(result.assignmentMode === 'per_driver' ? '기사별 미션 배정' : '선택 조건 시뮬레이션')}</strong></p>
      <p>적용 조건: <strong>${escapeHtml(result.appliedRuleLabel || (result.selectedPromotionRuleNames || []).join(', ') || '-')}</strong>${result.unassignedRiderCount ? ` · 미배정 <strong>${formatNumber(result.unassignedRiderCount)}</strong>명` : ''}</p>
      <p>기사 <strong>${formatNumber(result.summary.riderCount)}</strong>명 · 총 프로모션 <strong>${formatMoney(result.summary.totalPromotionAmount)}</strong>${rateMissingSummary}</p>
      ${deliveryFeeSummary}
      ${result.rainApply ? '<p>우천적용: <strong>기상할증(AC) 건은 AH-500원 후 단가보장</strong></p>' : ''}
      ${slaCount > 0
        ? (slaAll || Number(result.slaOtherCount || 0) <= 0
          ? '<p><span class="promotion-sla-tag">SLA시간</span> 이 결과 전원 배민 총완료 − 시간외완료 (쿠팡은 그대로)</p>'
          : `<p><span class="promotion-sla-tag">SLA시간 ${formatNumber(slaCount)}명</span>만 총완료 − 시간외완료 · ${slaMissions.length ? `적용 미션: <strong>${escapeHtml(slaMissions.join(', '))}</strong>` : 'SLA 켜진 미션'} · 나머지 <strong>${formatNumber(result.slaOtherCount)}</strong>명${slaOtherMissions.length ? ` (${escapeHtml(slaOtherMissions.join(', '))})` : ''}은 총완료 그대로</p>`)
        : ''}
      ${combinedSummary}
      ${gapSummary}
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
          ` : isCombinedResult ? `
          <th>ERP 기사명</th>
          <th>쿠팡ID</th>
          <th>배민ID</th>
          ` : `
          <th>${escapeHtml(platform === 'coupang' ? '쿠팡 ID' : '기사')}</th>
          <th>ERP 기사명</th>
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
    if (options.autoGap) void openGapPopup(result);
    else if (!reviewItems.all.length) hideGapPopup();

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
        : isCombinedResult
          ? `
        <td><strong>${escapeHtml(BremPromotionApply.getResultRowErpName(row))}</strong></td>
        <td>${escapeHtml(BremPromotionApply.getResultRowCoupangId(row))}</td>
        <td>${escapeHtml(BremPromotionApply.getResultRowBaeminId(row))}</td>
        `
          : `
        <td><strong>${escapeHtml(BremPromotionApply.getResultRowDisplayName(row, platform))}</strong></td>
        <td>${escapeHtml(BremPromotionApply.getResultRowErpName(row))}</td>
        `;
      const regionMismatch = mismatchIds.has(String(row.matchedRiderId || ''));
      return `
      <tr class="${row.totalPromotionAmount > 0 ? 'promotion-row-paid' : 'promotion-row-unpaid'}${rateMissing ? ' promotion-row-rate-missing' : ''}${regionMismatch ? ' promotion-row-region-mismatch' : ''}">
        ${identityCells}
        ${isCombinedResult ? `
          <td>${escapeHtml(BremPlatforms.label(rowPlatform))}</td>
          <td>${escapeHtml(row.assignmentSource || '-')}</td>
        ` : ''}
        <td>${formatNumber(row.callCount)}${row.slaApply && Number(row.slaOutComplete || 0) > 0 ? ` <span class="form-help">(시간외 ${formatNumber(row.slaOutComplete)})</span>` : ''}${row.slaApply ? ' <span class="promotion-sla-tag">SLA시간</span>' : ''}</td>
        <td>${formatRate(row.platformRate, rowPlatform, { highlightMissing: rateMissing })}</td>
        <td>${escapeHtml(row.ruleName || '-')}${regionMismatch ? ' <span class="promotion-region-mismatch-tag">기본과 다름</span>' : ''}</td>
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
        <td>${escapeHtml(BremPlatforms.label(item.platform))}<span class="promotion-channel-badge ${item.channel === 'direct' ? 'is-direct' : 'is-bro'}">${escapeHtml(channelLabel(item.channel))}</span>${item.slaApplyAll ? '<span class="promotion-sla-tag">SLA시간</span>' : (Number(item.slaApplyCount || 0) > 0 || item.slaApply ? `<span class="promotion-sla-tag">SLA ${formatNumber(item.slaApplyCount || 0)}명</span>` : '')}</td>
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
    const ruleIds = assignmentMode === 'selected_rules'
      ? readSelectedRuleIds(platform)
      : [];
    const ignoreMissingRates = options.ignoreMissingRates === true
      || state.ignoreMissingRates === true;
    const rainApply = (platform === 'baemin' || platform === 'combined')
      && options.rainApply === true;

    if (platform === 'combined' && assignmentMode === 'selected_rules' && !ruleIds.length) {
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
            deliveryFeeIndex: deliveryFeeParsed.baemin?.index
              || deliveryFeeParsed.index
              || deliveryFeeParsed.baemin
              || deliveryFeeParsed,
            deliveryFeeMeta: deliveryFeeParsed.baemin || deliveryFeeParsed,
            coupangDeliveryFeeIndex: deliveryFeeParsed.coupang?.index || null,
            coupangDeliveryFeeMeta: deliveryFeeParsed.coupang || null,
            ignoreMissingRates,
            rainApply,
            assignmentMode,
            ...combinedMeta
          }
          : { ignoreMissingRates, rainApply, assignmentMode, ...combinedMeta };

        if (BremPromotionApply.combinedSettlementsNeedSlaOutMap?.(
          coupangSettlement,
          baeminSettlement,
          ruleIds,
          assignmentMode
        )) {
          const slaOutMap = await BremPromotionApply.loadBaeminSlaOutMap(
            baeminSettlement.startDate || baeminSettlement.baseSettlementDate
          );
          if (!slaOutMap) {
            showToast('SLA 시간외완료를 불러오지 못했습니다. 배민현황 저장 후 다시 계산하세요.');
            return;
          }
          applyOptions.slaOutMap = slaOutMap;
        }

        // 배민 부분1·2 합산: 두 번째로 고른 배민 정산서를 사람별로 합쳐 계산한다.
        let baeminForCalc = baeminSettlement;
        if ($('#promotionApplyCombineParts-combined-baemin')?.checked) {
          const id2 = $('#promotionApplySettlementSelect2-combined-baemin')?.value || '';
          const second = id2 ? BremStorage.weeklySettlements.getById(id2, baeminChannel) : null;
          if (!second) {
            showToast('합칠 배민 부분2 정산서를 선택하세요.');
            return;
          }
          baeminForCalc = BremPromotionApply.mergePartSettlementsList([baeminSettlement, second], baeminSettlement);
        }
        state.lastResult = BremPromotionApply.applyPromotionToCombinedSettlements(
          coupangSettlement,
          baeminForCalc,
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

        let applyOptions = { assignmentMode, channel: state.channel, ignoreMissingRates, rainApply };
        if (BremPromotionApply.settlementNeedsSlaOutMap?.(
          settlement,
          platform,
          ruleIds,
          assignmentMode
        )) {
          const slaOutMap = await BremPromotionApply.loadBaeminSlaOutMap(
            settlement.startDate || settlement.baseSettlementDate
          );
          if (!slaOutMap) {
            showToast('SLA 시간외완료를 불러오지 못했습니다. 배민현황 저장 후 다시 계산하세요.');
            return;
          }
          applyOptions.slaOutMap = slaOutMap;
        }
        if (platform === 'baemin') {
          const deliveryFeeParsed = await resolveDeliveryFeeForCalculation('baemin', settlement);
          if (deliveryFeeParsed) {
            applyOptions = {
              ...applyOptions,
              deliveryFeeIndex: deliveryFeeParsed.index || deliveryFeeParsed,
              deliveryFeeMeta: deliveryFeeParsed
            };
          }
        }

        // 배민 부분1·2 합산: 두 번째로 고른 배민 정산서를 사람별로 합쳐 계산한다.
        let settlementForCalc = settlement;
        if (platform === 'baemin' && $('#promotionApplyCombineParts-baemin')?.checked) {
          const id2 = $('#promotionApplySettlementSelect2-baemin')?.value || '';
          const second = id2 ? BremStorage.weeklySettlements.getById(id2, state.channel) : null;
          if (!second) {
            showToast('합칠 배민 부분2 정산서를 선택하세요.');
            return;
          }
          settlementForCalc = BremPromotionApply.mergePartSettlementsList([settlement, second], settlement);
        }
        state.lastResult = BremPromotionApply.applyPromotionToSettlement(
          settlementForCalc,
          ruleIds,
          undefined,
          applyOptions
        );
      }

      state.savedResultId = '';
      state.ignoreMissingRates = ignoreMissingRates;
      state.rainApply = rainApply;
      renderResult(state.lastResult, { autoGap: true });
      const feeSkip = (state.lastResult?.results || []).filter(row =>
        (row.failureReasons || []).some(reason => String(reason || '').includes('배달처리비 정산서 업로드'))
      ).length;
      showToast(ignoreMissingRates
        ? '수락/거절율 미등록을 무시하고 프로모션을 다시 계산했습니다.'
        : rainApply
          ? '우천적용으로 프로모션을 계산했습니다. (기상할증 건 AH-500원 후 단가보장)'
          : state.lastResult?.slaApply
            ? 'SLA적용: 배민 총완료 − 시간외완료로 프로모션을 계산했습니다.'
          : feeSkip
            ? `프로모션 계산 완료. 단가보장 ${feeSkip}명은 배달처리비가 없어 제외했습니다.`
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
    await runCalculation({
      ignoreMissingRates: true,
      rainApply: state.lastResult?.rainApply === true || state.rainApply === true
    });
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
    hideGapPopup();
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

    updateRainButtonVisibility(p);

    if (!options.keepResult) {
      const card = $('#promotionApplyResultCard');
      if (card) card.hidden = true;
      state.lastResult = null;
      state.savedResultId = '';
      state.rainApply = false;
    }
  }

  function updateRainButtonVisibility(platform = state.platform) {
    const btn = $('#promotionApplyRainBtn');
    if (!btn) return;
    const show = platform === 'baemin' || platform === 'combined';
    btn.hidden = !show;
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

    ['coupang', 'baemin', 'combined'].forEach(platform => {
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

    // 부분1·2 직접 선택 합산 토글: 두 번째 배민 정산서 선택칸을 보이고 숨긴다.
    [['promotionApplyCombineParts-baemin', 'promotionApplySettlementSelect2Wrap-baemin'],
     ['promotionApplyCombineParts-combined-baemin', 'promotionApplySettlementSelect2Wrap-combined-baemin']]
      .forEach(([cbId, wrapId]) => {
        $(`#${cbId}`)?.addEventListener('change', event => {
          const wrap = $(`#${wrapId}`);
          if (wrap) wrap.hidden = !event.target.checked;
        });
      });

    $('#promotionApplyForm')?.addEventListener('submit', event => {
      // 일반 계산은 무시 옵션을 끈다. 패널 버튼으로만 켠다.
      state.ignoreMissingRates = false;
      event.preventDefault();
      runCalculation({ rainApply: false });
    });

    $('#promotionApplyRainBtn')?.addEventListener('click', () => {
      state.ignoreMissingRates = false;
      runCalculation({ rainApply: true });
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

    $('#promotionApplyResultSummary')?.addEventListener('click', event => {
      const btn = event.target.closest('#promotionApplyOpenGapBtn');
      if (!btn) return;
      void openGapPopup(state.lastResult);
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

  window.BremPromotionApplyAdmin = { init, refresh, handleWeekSelect, handleSavedWeekSelect, openSetupGapPopup: openGapPopup };
  return window.BremPromotionApplyAdmin;
})();

document.addEventListener('DOMContentLoaded', () => {
  BremPromotionApplyAdmin.init();
});
