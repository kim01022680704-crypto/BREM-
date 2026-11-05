const BremPromotionAdmin = (function () {
  const state = {
    editingRuleId: '',
    previewRuleId: '',
    previewMode: 'single',
    rulesPlatformTab: 'coupang',
    tierDraft: [],
    payTierDraft: [],
    distanceTierDraft: [],
    distanceAddonDraft: [],
    globalSelectedRuleIds: [],
    conditionDrafts: {
      block: [],
      bonus: [],
      reference: []
    }
  };

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

  function formatRate(value) {
    if (value === null || value === undefined || value === '') return '-';
    return `${Number(value).toLocaleString('ko-KR')}%`;
  }

  function platformLabel(platform) {
    return BremPlatforms.label(platform);
  }

  function promotionTypeLabel(type) {
    const map = {
      count_per_order: '건당',
      guaranteed_unit_price: '단가보장',
      both: '건당+단가보장'
    };
    return map[type] || type;
  }

  function platformRateLabel(platform) {
    return BremPlatforms.rateLabel(platform);
  }

  function getPromotionRulesForPlatform(platform, { includeDisabled = false } = {}) {
    const list = BremStorage.getUserPromotionRules?.() || BremStorage.promotionRules.getAll();
    return list.filter(rule => {
      if (normalizePlatform(rule.platform) !== normalizePlatform(platform)) return false;
      if (!includeDisabled && !rule.enabled) return false;
      return true;
    });
  }

  function getActiveRulesPlatformTab() {
    return normalizePlatform(state.rulesPlatformTab || 'coupang');
  }

  function setRulesPlatformTab(platform) {
    state.rulesPlatformTab = normalizePlatform(platform);
    $$('[data-promotion-rules-platform]').forEach(button => {
      button.classList.toggle('active', button.dataset.promotionRulesPlatform === state.rulesPlatformTab);
    });
    renderRulesList();
    syncRuleFormPlatformWithTab();
  }

  function setPromotionRulePlatformField(platform) {
    const p = normalizePlatform(platform);
    const select = $('#promotionRulePlatform');
    if (select) select.value = p;
    return p;
  }

  function syncRuleFormPlatformWithTab() {
    const formCard = $('#promotionRuleFormCard');
    if (!formCard || formCard.hidden || state.editingRuleId) return;
    syncConditionDraftsFromForm();
    const tabPlatform = getActiveRulesPlatformTab();
    setPromotionRulePlatformField(tabPlatform);
    renderConditionLists(tabPlatform);
    updateRateFieldLabels(tabPlatform);
  }

  function normalizePlatform(platform) {
    return BremPlatforms.normalize(platform);
  }

  function buildPromotionRuleSelect(platform, value, field) {
    const rules = getPromotionRulesForPlatform(platform, { includeDisabled: true });
    const options = ['<option value="">미선택</option>'].concat(rules.map(rule => `
      <option value="${escapeHtml(rule.id)}"${rule.id === value ? ' selected' : ''}>${escapeHtml(rule.name)}</option>
    `));
    return `<select class="promotion-driver-select" data-promotion-driver-field="${field}">${options.join('')}</select>`;
  }

  function updateRateFieldLabels(platform) {
    const previewHead = $('#promotionPreviewRateHead');
    if (previewHead) previewHead.textContent = platformRateLabel(platform);
  }

  function bonusActionFieldsMarkup(condition) {
    const action = condition.actionType || 'add_pay_per_order';
    const actions = Object.entries(BremPromotionConditions.BONUS_ACTION_TYPES)
      .filter(([value]) => value !== 'distance_per_km')
      .map(([value, label]) => (
      `<option value="${value}"${value === action ? ' selected' : ''}>${escapeHtml(label)}</option>`
    )).join('');

    let valueFields = '';
    if (action === 'add_pay_per_order') {
      valueFields = `<label><span>건당 추가 (원)</span><input type="number" data-field="addPayPerOrder" min="0" step="100" value="${condition.addPayPerOrder ?? 0}"></label>`;
    } else if (action === 'fixed_bonus') {
      valueFields = `<label><span>정액 (원)</span><input type="number" data-field="fixedBonus" min="0" step="1000" value="${condition.fixedBonus ?? 0}"></label>`;
    } else if (action === 'guarantee_unit_add') {
      valueFields = `<label><span>보장단가 (원)</span><input type="number" data-field="guaranteeUnitAdd" min="0" step="100" value="${condition.guaranteeUnitAdd ?? 0}"></label>`;
    } else if (action === 'percent_bonus') {
      valueFields = `<label><span>비율 (%)</span><input type="number" data-field="bonusPercent" min="0" max="100" step="0.1" value="${condition.bonusPercent ?? 0}"></label>`;
    } else if (action === 'distance_per_km') {
      valueFields = `<label><span>km당 지급 (원)</span><input type="number" data-field="distancePayPerKm" min="0" step="10" value="${condition.distancePayPerKm ?? 0}" placeholder="예: 100"></label>`;
    }

    return `
      <label><span>추가 지급 방식</span><select data-field="actionType">${actions}</select></label>
      ${valueFields}
    `;
  }

  function conditionTypeFieldsMarkup(condition, processingMode, platform) {
    const type = condition.conditionType;
    let fields = '';

    if (['reject_rate_over', 'reject_rate_under', 'accept_rate_under', 'accept_rate_over'].includes(type)) {
      const label = type.startsWith('reject') ? '거절율 (%)' : '수락률 (%)';
      fields += `<label><span>${label}</span><input type="number" data-field="rateThreshold" min="0" max="100" step="0.1" value="${condition.rateThreshold ?? ''}"></label>`;
    }
    if (['total_orders_under', 'total_orders_over'].includes(type)) {
      fields += `<label><span>콜수 (건)</span><input type="number" data-field="minTotalOrders" min="0" step="1" value="${condition.minTotalOrders ?? ''}"></label>`;
    }
    if (type === 'working_days') {
      fields += `
        <label><span>최소 근무일</span><input type="number" data-field="minWorkingDays" min="0" max="7" step="1" value="${condition.minWorkingDays ?? 6}"></label>
        <label><span>일일 기준 콜수</span><input type="number" data-field="dailyMinOrders" min="0" step="1" value="${condition.dailyMinOrders ?? 30}"></label>
      `;
    }
    if (type === 'daily_min_days') {
      fields += `
        <label><span>일일 최소 콜수</span><input type="number" data-field="dailyMinOrders" min="0" step="1" value="${condition.dailyMinOrders ?? 30}"></label>
        <label><span>최소 달성일</span><input type="number" data-field="minDailyOrderDays" min="0" max="7" step="1" value="${condition.minDailyOrderDays ?? 6}"></label>
      `;
    }
    if (type === 'weekly_distance_km') {
      fields += `<label><span>달성 거리 (km)</span><input type="number" data-field="minDistanceKm" min="0" step="10" value="${condition.minDistanceKm ?? ''}" placeholder="예: 800"></label>`;
    }
    if (processingMode === 'bonus') {
      fields += bonusActionFieldsMarkup(condition);
    }
    return fields;
  }

  function maxConditionsPerMode() {
    return Number(BremPromotionConditions.MAX_CONDITIONS_PER_MODE) || 50;
  }

  function maxCallTiers() {
    return Number(BremPromotionConditions.MAX_CALL_TIERS) || 50;
  }

  function namedConditions(conditions, platform) {
    return (conditions || []).map(item => {
      const name = String(item?.conditionName || '').trim();
      if (name) return { ...item, conditionName: name };
      const fallback = BremPromotionConditions.fallbackConditionName
        ? BremPromotionConditions.fallbackConditionName(item, platform)
        : (item?.conditionType || '조건');
      return { ...item, conditionName: fallback };
    });
  }

  function autoNameForRow(row, platform) {
    const readField = name => row.querySelector(`[data-field="${name}"]`)?.value;
    const draft = {
      conditionName: '',
      conditionType: readField('conditionType'),
      processingMode: row.dataset.conditionMode,
      rateThreshold: Number(readField('rateThreshold') || 0),
      minTotalOrders: Number(readField('minTotalOrders') || 0),
      minWorkingDays: Number(readField('minWorkingDays') || 6),
      dailyMinOrders: Number(readField('dailyMinOrders') || 30),
      minDailyOrderDays: Number(readField('minDailyOrderDays') || 6),
      minDistanceKm: Number(readField('minDistanceKm') || 0)
    };
    return BremPromotionConditions.fallbackConditionName
      ? BremPromotionConditions.fallbackConditionName(draft, platform)
      : (draft.conditionType || '조건');
  }

  function syncAutoConditionName(row, platform) {
    const nameInput = row.querySelector('[data-field="conditionName"]');
    if (!nameInput) return;
    const next = autoNameForRow(row, platform);
    const current = nameInput.value.trim();
    const previous = nameInput.dataset.autoName || '';
    if (!current || current === previous) nameInput.value = next;
    nameInput.dataset.autoName = next;
  }

  function renderConditionRow(condition, processingMode, platform, index) {
    const types = BremPromotionConditions.conditionTypesForPlatform(platform, processingMode);
    const typeOptions = types.map(item => (
      `<option value="${item.value}"${item.value === condition.conditionType ? ' selected' : ''}>${escapeHtml(item.label)}</option>`
    )).join('');

    return `
      <div class="promotion-condition-row" data-condition-mode="${processingMode}" data-condition-index="${index}" data-condition-id="${escapeHtml(condition.id || '')}">
        <div class="promotion-condition-row-header">
          <strong>${processingMode === 'block' ? '미지급' : processingMode === 'bonus' ? '추가 가산' : '참고'} 조건 ${index + 1}</strong>
          <button type="button" class="small-btn danger-btn" data-remove-condition>삭제</button>
        </div>
        <div class="promotion-condition-fields">
          <label><span>조건명</span><input type="text" data-field="conditionName" value="${escapeHtml(condition.conditionName || '')}" placeholder="예: 주6일 이상 추가 지급"></label>
          <label><span>조건 유형</span><select data-field="conditionType">${typeOptions}</select></label>
          ${conditionTypeFieldsMarkup(condition, processingMode, platform)}
        </div>
      </div>
    `;
  }

  function renderConditionLists(platform) {
    const p = normalizePlatform(platform);
    ['block', 'bonus', 'reference'].forEach(mode => {
      const container = $(`#promotion${mode.charAt(0).toUpperCase()}${mode.slice(1)}ConditionsList`.replace('Block', 'Block').replace('Bonus', 'Bonus').replace('Reference', 'Reference'));
      const listId = {
        block: '#promotionBlockConditionsList',
        bonus: '#promotionBonusConditionsList',
        reference: '#promotionReferenceConditionsList'
      }[mode];
      const el = $(listId);
      if (!el) return;
      const items = state.conditionDrafts[mode] || [];
      el.innerHTML = items.length
        ? items.map((item, index) => renderConditionRow(item, mode, p, index)).join('')
        : '<p class="form-help">등록된 조건이 없습니다. 조건 추가 버튼을 눌러 주세요.</p>';
      el.querySelectorAll('.promotion-condition-row').forEach(row => {
        const nameInput = row.querySelector('[data-field="conditionName"]');
        if (nameInput && !nameInput.dataset.autoName) {
          nameInput.dataset.autoName = autoNameForRow(row, p);
        }
      });
    });
  }

  function readConditionsFromForm(mode) {
    const listId = {
      block: '#promotionBlockConditionsList',
      bonus: '#promotionBonusConditionsList',
      reference: '#promotionReferenceConditionsList'
    }[mode];
    const rows = $$(`${listId} .promotion-condition-row`);
    return rows.map((row, index) => {
      const readField = name => row.querySelector(`[data-field="${name}"]`)?.value;
      const condition = BremPromotionConditions.normalizeCondition({
        id: row.dataset.conditionId || undefined,
        conditionName: readField('conditionName')?.trim() || '',
        conditionType: readField('conditionType') || 'total_orders_under',
        processingMode: mode,
        rateThreshold: Number(readField('rateThreshold') || 0),
        minTotalOrders: Number(readField('minTotalOrders') || 0),
        minWorkingDays: Number(readField('minWorkingDays') || 6),
        dailyMinOrders: Number(readField('dailyMinOrders') || 30),
        minDailyOrderDays: Number(readField('minDailyOrderDays') || 6),
        actionType: readField('actionType') || 'add_pay_per_order',
        addPayPerOrder: Number(readField('addPayPerOrder') || 0),
        fixedBonus: Number(readField('fixedBonus') || 0),
        bonusPercent: Number(readField('bonusPercent') || 0),
        guaranteeUnitAdd: Number(readField('guaranteeUnitAdd') || 0),
        minDistanceKm: Number(readField('minDistanceKm') || 0),
        distancePayPerKm: Number(readField('distancePayPerKm') || 0),
        sortOrder: index
      }, index);
      return condition;
    });
  }

  function syncConditionDraftsFromForm() {
    if (!$('#promotionBlockConditionsList')) return;
    state.conditionDrafts.block = readConditionsFromForm('block');
    state.conditionDrafts.bonus = readConditionsFromForm('bonus');
    state.conditionDrafts.reference = readConditionsFromForm('reference');
  }

  function normalizeConditionsForPlatform(conditions, platform) {
    const p = normalizePlatform(platform);
    return (conditions || []).map(item => {
      const synced = BremPromotionConditions.syncRateConditionName(item, p);
      if (!BremPromotionConditions.isRateConditionType(item.conditionType)) {
        return synced;
      }
      const resolved = BremPromotionConditions.resolveRateCondition(synced, p);
      return {
        ...synced,
        conditionType: resolved.conditionType,
        rateThreshold: resolved.rateThreshold,
        conditionName: BremPromotionConditions.formatConditionLabel(resolved, p)
      };
    });
  }

  function syncConditionNameInRow(row, platform) {
    const mode = row.dataset.conditionMode;
    const condition = BremPromotionConditions.normalizeCondition({
      conditionName: row.querySelector('[data-field="conditionName"]')?.value || '',
      conditionType: row.querySelector('[data-field="conditionType"]')?.value,
      processingMode: mode,
      rateThreshold: Number(row.querySelector('[data-field="rateThreshold"]')?.value || 0),
      minTotalOrders: Number(row.querySelector('[data-field="minTotalOrders"]')?.value || 0),
      minWorkingDays: Number(row.querySelector('[data-field="minWorkingDays"]')?.value || 6),
      dailyMinOrders: Number(row.querySelector('[data-field="dailyMinOrders"]')?.value || 30),
      minDailyOrderDays: Number(row.querySelector('[data-field="minDailyOrderDays"]')?.value || 6),
      actionType: row.querySelector('[data-field="actionType"]')?.value || 'add_pay_per_order'
    });
    if (!BremPromotionConditions.isRateConditionType(condition.conditionType)) return;
    const nameInput = row.querySelector('[data-field="conditionName"]');
    if (!nameInput) return;
    nameInput.value = BremPromotionConditions.formatConditionLabel(condition, platform);
  }

  function addConditionDraft(mode) {
    syncConditionDraftsFromForm();
    const current = state.conditionDrafts[mode] || [];
    if (current.length >= maxConditionsPerMode()) {
      showToast(`미지급/추가/참고 조건은 각각 최대 ${maxConditionsPerMode()}개까지 추가할 수 있습니다.`);
      return;
    }
    const platform = $('#promotionRulePlatform')?.value || getActiveRulesPlatformTab();
    state.conditionDrafts[mode].push(BremPromotionConditions.emptyCondition(mode, platform));
    renderConditionLists(platform);
  }

  function refreshConditionRowFields(row, platform) {
    const mode = row.dataset.conditionMode;
    const index = Number(row.dataset.conditionIndex || 0);
    const condition = {
      conditionName: row.querySelector('[data-field="conditionName"]')?.value || '',
      conditionType: row.querySelector('[data-field="conditionType"]')?.value,
      actionType: row.querySelector('[data-field="actionType"]')?.value || 'add_pay_per_order',
      rateThreshold: row.querySelector('[data-field="rateThreshold"]')?.value,
      minTotalOrders: row.querySelector('[data-field="minTotalOrders"]')?.value,
      minWorkingDays: row.querySelector('[data-field="minWorkingDays"]')?.value,
      dailyMinOrders: row.querySelector('[data-field="dailyMinOrders"]')?.value,
      minDailyOrderDays: row.querySelector('[data-field="minDailyOrderDays"]')?.value,
      addPayPerOrder: row.querySelector('[data-field="addPayPerOrder"]')?.value,
      fixedBonus: row.querySelector('[data-field="fixedBonus"]')?.value,
      bonusPercent: row.querySelector('[data-field="bonusPercent"]')?.value,
      guaranteeUnitAdd: row.querySelector('[data-field="guaranteeUnitAdd"]')?.value
    };
    const fieldsWrap = row.querySelector('.promotion-condition-fields');
    if (!fieldsWrap) return;
    const typeSelect = fieldsWrap.querySelector('[data-field="conditionType"]');
    fieldsWrap.innerHTML = `
      <label><span>조건명</span><input type="text" data-field="conditionName" value="${escapeHtml(condition.conditionName)}" placeholder="예: 주6일 이상 추가 지급"></label>
      <label><span>조건 유형</span><select data-field="conditionType">${BremPromotionConditions.conditionTypesForPlatform(platform, mode).map(item => (
      `<option value="${item.value}"${item.value === condition.conditionType ? ' selected' : ''}>${escapeHtml(item.label)}</option>`
    )).join('')}</select></label>
      ${conditionTypeFieldsMarkup({ ...condition, conditionType: typeSelect?.value || condition.conditionType }, mode, platform)}
    `;
    row.dataset.conditionIndex = String(index);
  }

  function selectorLabel(ruleId) {
    return BremPromotionEngine.getPromotionNameById(ruleId);
  }

  function getSelectedWeekStart() {
    const input = $('#promotionWeekDate');
    const value = input?.value;
    return BremPromotionEngine.weekStartKey(value || new Date().toISOString().slice(0, 10));
  }

  function getActivePlatform() {
    return normalizePlatform($('#promotionRulePlatform')?.value || 'coupang');
  }

  function driverFilterFromSearch() {
    const searchInput = $('#adminDriverSearch');
    const query = String(searchInput?.value || '').trim();
    if (!query) return null;

    const normalizeText = value => String(value || '').replace(/\s/g, '').toLowerCase();
    const normalizePhone = value => String(value || '').replace(/[^0-9]/g, '');
    const nameQuery = normalizeText(query);
    const phoneQuery = normalizePhone(query);

    return driverId => {
      const driver = BremStorage.drivers.getAll().find(item => item.id === driverId);
      if (!driver) return false;
      if (nameQuery && normalizeText(driver.name).includes(nameQuery)) return true;
      if (phoneQuery && normalizePhone(driver.phone).includes(phoneQuery)) return true;
      return false;
    };
  }

  function filteredDriversForPromotion() {
    const filter = driverFilterFromSearch();
    const drivers = BremStorage.drivers.getAll();
    if (!filter) return drivers;
    return drivers.filter(driver => filter(driver.id));
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function emptyRuleDraft() {
    return {
      name: '',
      type: 'count_per_order',
      platform: 'baemin',
      enabled: true,
      slaApply: false,
      startDate: '',
      endDate: '',
      base: {
        baseCallCount: 0,
        payStartCallCount: 0,
        payPerCall: 0,
        guaranteedUnitPrice: 0,
        callTiers: [],
        payPerCallTiers: [],
        payPerCallTierMode: 'retroactive',
        distance: {
          enabled: false,
          unit: 'km',
          startKm: 0,
          payPerUnit: 0,
          tiers: [],
          tierMode: 'retroactive'
        },
        distanceAddons: [],
        distanceAddonLadder: null,
        outsideCallAddon: null
      },
      blockConditions: [],
      bonusConditions: [],
      referenceConditions: [],
      applyGlobalAcceptBlock: true,
      priority: 100,
      allowDuplicate: false,
      duplicateStrategy: 'highest_priority',
      noPayConditions: ''
    };
  }

  function readTierRowsFromForm({ includeEmpty = false } = {}) {
    const rows = $$('#promotionTierRows .promotion-tier-row').map((row, index) => ({
      id: row.dataset.tierId || '',
      minCalls: row.querySelector('[data-tier-min-calls]')?.value ?? '',
      unitPrice: row.querySelector('[data-tier-unit-price]')?.value ?? '',
      sortOrder: index
    }));
    if (includeEmpty) return rows;
    return rows
      .filter(tier => Number(tier.minCalls) > 0 || Number(tier.unitPrice) > 0)
      .map(tier => ({
        ...tier,
        minCalls: Number(tier.minCalls) || 0,
        unitPrice: Number(tier.unitPrice) || 0
      }));
  }

  function renderTierRows(tiers = []) {
    const container = $('#promotionTierRows');
    if (!container) return;

    const rows = tiers.length ? tiers : [{ id: '', minCalls: '', unitPrice: '' }];
    container.innerHTML = rows.map((tier, index) => `
      <div class="promotion-tier-row" data-tier-id="${escapeHtml(tier.id || '')}">
        <label>
          <span>${index + 1}구간 · N건 이상</span>
          <input type="number" min="0" step="1" data-tier-min-calls value="${tier.minCalls ?? ''}" placeholder="예: 50">
        </label>
        <label>
          <span>보장 단가 (원)</span>
          <input type="number" min="0" step="100" data-tier-unit-price value="${tier.unitPrice ?? ''}" placeholder="예: 2800">
        </label>
        <button type="button" class="small-btn danger-btn" data-remove-tier aria-label="구간 삭제">삭제</button>
      </div>
    `).join('');
  }

  function readPayTierRowsFromForm({ includeEmpty = false } = {}) {
    const rows = $$('#promotionPayTierRows .promotion-tier-row').map((row, index) => ({
      id: row.dataset.tierId || '',
      minCalls: row.querySelector('[data-pay-tier-min-calls]')?.value ?? '',
      payPerCall: row.querySelector('[data-pay-tier-pay-per-call]')?.value ?? '',
      sortOrder: index
    }));
    if (includeEmpty) return rows;
    return rows
      .filter(tier => Number(tier.minCalls) > 0 || Number(tier.payPerCall) > 0)
      .map(tier => ({
        ...tier,
        minCalls: Number(tier.minCalls) || 0,
        payPerCall: Number(tier.payPerCall) || 0
      }));
  }

  function renderPayTierRows(tiers = []) {
    const container = $('#promotionPayTierRows');
    if (!container) return;

    const stepMode = $('#promotionPayTierMode')?.value === 'step';
    const rows = tiers.length ? tiers : [{ id: '', minCalls: '', payPerCall: '' }];
    container.innerHTML = rows.map((tier, index) => `
      <div class="promotion-tier-row" data-tier-id="${escapeHtml(tier.id || '')}">
        <label>
          <span>${index + 1}구간 · ${stepMode ? 'N건부터' : 'N건 달성'}</span>
          <input type="number" min="0" step="1" data-pay-tier-min-calls value="${tier.minCalls ?? ''}" placeholder="${stepMode ? '예: 301' : '예: 300'}">
        </label>
        <label>
          <span>${stepMode ? '이 콜부터 건당 (원)' : '소급 건당 단가 (원)'}</span>
          <input type="number" min="0" step="100" data-pay-tier-pay-per-call value="${tier.payPerCall ?? ''}" placeholder="예: 1200">
        </label>
        <button type="button" class="small-btn danger-btn" data-remove-pay-tier aria-label="구간 삭제">삭제</button>
      </div>
    `).join('');
  }

  function readDistanceTierRowsFromForm({ includeEmpty = false } = {}) {
    const rows = $$('#promotionDistanceTierRows .promotion-tier-row').map((row, index) => ({
      id: row.dataset.tierId || '',
      minKm: row.querySelector('[data-dist-tier-min-km]')?.value ?? '',
      payPerUnit: row.querySelector('[data-dist-tier-pay-per-unit]')?.value ?? '',
      sortOrder: index
    }));
    if (includeEmpty) return rows;
    return rows
      .filter(tier => Number(tier.minKm) > 0 || Number(tier.payPerUnit) > 0)
      .map(tier => ({
        ...tier,
        minKm: Number(tier.minKm) || 0,
        payPerUnit: Number(tier.payPerUnit) || 0
      }));
  }

  function renderDistanceTierRows(tiers = []) {
    const container = $('#promotionDistanceTierRows');
    if (!container) return;
    const unit = $('#promotionDistanceUnit')?.value === '100m' ? '100m' : 'km';
    const stepMode = $('#promotionDistanceTierMode')?.value === 'step';
    const rows = tiers.length ? tiers : [{ id: '', minKm: '', payPerUnit: '' }];
    container.innerHTML = rows.map((tier, index) => `
      <div class="promotion-tier-row" data-tier-id="${escapeHtml(tier.id || '')}">
        <label>
          <span>${index + 1}구간 · ${stepMode ? 'N km부터' : 'N km 달성'}</span>
          <input type="number" min="0" step="1" data-dist-tier-min-km value="${tier.minKm ?? ''}" placeholder="예: 300">
        </label>
        <label>
          <span>${unit}당 지급액 (원)</span>
          <input type="number" min="0" step="10" data-dist-tier-pay-per-unit value="${tier.payPerUnit ?? ''}" placeholder="예: 150">
        </label>
        <button type="button" class="small-btn danger-btn" data-remove-dist-tier aria-label="구간 삭제">삭제</button>
      </div>
    `).join('');
  }

  function readDistanceAddonLadder() {
    const startKm = Math.round(Number($('#promotionDistanceLadderStart')?.value || 0));
    const stepKm = Math.round(Number($('#promotionDistanceLadderStep')?.value || 0));
    const amount = Math.round(Number($('#promotionDistanceLadderAmount')?.value || 0));
    const untilKm = Math.round(Number($('#promotionDistanceLadderUntil')?.value || 0));
    const any = startKm > 0 || stepKm > 0 || amount > 0 || untilKm > 0;
    if (!any) return null;
    return { startKm, stepKm, amount, untilKm };
  }

  function readOutsideCallAddon() {
    const startCount = Math.round(Number($('#promotionOutsideCallStart')?.value || 0));
    const amountPerCall = Math.round(Number($('#promotionOutsideCallAmount')?.value || 0));
    if (!(startCount > 0 && amountPerCall > 0)) return null;
    return { startCount, amountPerCall };
  }

  function renderDistanceLadderPreview() {
    const preview = $('#promotionDistanceLadderPreview');
    if (!preview) return;
    const ladder = readDistanceAddonLadder();
    if (!ladder) {
      preview.textContent = '시작 km, 간격, 칸마다 금액, 마지막 km를 넣으면 칸 수가 여기 보입니다.';
      return;
    }
    if (!(ladder.startKm > 0 && ladder.stepKm > 0 && ladder.amount > 0 && ladder.untilKm >= ladder.startKm)) {
      preview.textContent = '시작 km, 간격, 칸마다 금액, 마지막 km를 모두 넣으세요. 마지막 km는 시작 km 이상이어야 합니다.';
      return;
    }
    const steps = Math.floor((ladder.untilKm - ladder.startKm) / ladder.stepKm) + 1;
    const maxSteps = window.BremPromotionConditions?.MAX_DISTANCE_LADDER_STEPS || 80;
    if (steps > maxSteps) {
      preview.textContent = `칸이 ${steps}개입니다. ${maxSteps}개까지만 됩니다. 마지막 km를 낮추거나 간격을 넓히세요.`;
      return;
    }
    const endKm = ladder.startKm + (steps - 1) * ladder.stepKm;
    const total = steps * ladder.amount;
    preview.textContent = `${ladder.startKm.toLocaleString('ko-KR')}km부터 ${endKm.toLocaleString('ko-KR')}km까지 ${ladder.stepKm.toLocaleString('ko-KR')}km마다 ${ladder.amount.toLocaleString('ko-KR')}원 · ${steps}칸 · 전부 달성 시 ${total.toLocaleString('ko-KR')}원`;
  }

  function fillDistanceAddonLadder(ladder) {
    const spec = ladder && typeof ladder === 'object' ? ladder : {};
    if ($('#promotionDistanceLadderStart')) $('#promotionDistanceLadderStart').value = spec.startKm ?? '';
    if ($('#promotionDistanceLadderStep')) $('#promotionDistanceLadderStep').value = spec.stepKm ?? '';
    if ($('#promotionDistanceLadderAmount')) $('#promotionDistanceLadderAmount').value = spec.amount ?? '';
    if ($('#promotionDistanceLadderUntil')) $('#promotionDistanceLadderUntil').value = spec.untilKm ?? '';
    renderDistanceLadderPreview();
  }

  function distanceAddonAutoName(minKm, amount) {
    const km = Number(minKm || 0);
    const pay = Number(amount || 0);
    if (!(km > 0)) return '주간 거리 이상';
    const payText = pay > 0 ? `${Math.round(pay).toLocaleString('ko-KR')}원 지급` : '지급';
    return `${Math.round(km).toLocaleString('ko-KR')}km 이상 달성 시 ${payText}`;
  }

  function readDistanceAddonRows({ includeEmpty = false } = {}) {
    const rows = $$('#promotionDistanceAddonRows .promotion-condition-row').map((row, index) => ({
      id: row.dataset.conditionId || '',
      conditionName: row.querySelector('[data-dist-addon-name]')?.value ?? '',
      conditionType: 'weekly_distance_km',
      minKm: row.querySelector('[data-dist-addon-km]')?.value ?? '',
      amount: row.querySelector('[data-dist-addon-amount]')?.value ?? '',
      sortOrder: index
    }));
    if (includeEmpty) return rows;
    return rows
      .filter(row => Number(row.minKm) > 0 || Number(row.amount) > 0 || String(row.conditionName || '').trim())
      .map(row => {
        const minKm = Number(row.minKm) || 0;
        const amount = Number(row.amount) || 0;
        const typed = String(row.conditionName || '').trim();
        return {
          ...row,
          minKm,
          amount,
          conditionName: typed || distanceAddonAutoName(minKm, amount)
        };
      });
  }

  function renderDistanceAddonRows(rows = []) {
    const container = $('#promotionDistanceAddonRows');
    if (!container) return;
    if (!rows.length) {
      container.innerHTML = '<p class="form-help">거리 가산이 없습니다. 조건 추가처럼 조건명·몇 km 이상·지급 금액을 넣으면 라이더 앱에 그대로 보입니다.</p>';
      return;
    }
    container.innerHTML = rows.map((row, index) => {
      const autoName = distanceAddonAutoName(row.minKm, row.amount);
      const name = String(row.conditionName || '').trim() || autoName;
      return `
      <div class="promotion-condition-row" data-condition-id="${escapeHtml(row.id || '')}">
        <div class="promotion-condition-row-header">
          <strong>거리 가산 ${index + 1}</strong>
          <button type="button" class="small-btn danger-btn" data-remove-dist-addon>삭제</button>
        </div>
        <div class="promotion-condition-fields">
          <label>
            <span>조건명</span>
            <input type="text" data-dist-addon-name data-auto-name="${escapeHtml(autoName)}" value="${escapeHtml(name)}" placeholder="예: 800km 이상 달성 시 30,000원 지급">
          </label>
          <label>
            <span>조건 유형</span>
            <select data-dist-addon-type>
              <option value="weekly_distance_km" selected>주간 거리 이상</option>
            </select>
          </label>
          <label>
            <span>몇 km 이상</span>
            <input type="number" min="0" step="10" data-dist-addon-km value="${row.minKm ?? ''}" placeholder="예: 800">
          </label>
          <label>
            <span>달성 시 지급 (원)</span>
            <input type="number" min="0" step="1000" data-dist-addon-amount value="${row.amount ?? ''}" placeholder="예: 30000">
          </label>
        </div>
      </div>`;
    }).join('');
  }

  function syncTypeSections() {
    const type = $('#promotionRuleType')?.value || 'count_per_order';
    const platform = normalizePlatform($('#promotionRulePlatform')?.value || 'coupang');
    const distanceOnly = type === 'distance';
    const distanceSection = $('#promotionDistanceSection');
    if (distanceSection) distanceSection.hidden = platform === 'baemin';
    const addonSection = $('#promotionDistanceAddonSection');
    if (addonSection) addonSection.hidden = platform === 'baemin';
    const outsideSection = $('#promotionOutsideCallSection');
    if (outsideSection) outsideSection.hidden = platform === 'baemin';
    const enabledBox = $('#promotionDistanceEnabled');
    if (enabledBox && distanceOnly) enabledBox.checked = true;
    const distanceOn = platform !== 'baemin' && (distanceOnly || enabledBox?.checked);
    const body = $('#promotionDistanceBody');
    if (body) body.hidden = !distanceOn;
    const baseSection = $('#promotionBaseSection');
    if (baseSection) baseSection.hidden = distanceOnly;
    const guaranteeSection = $('#promotionGuaranteeSection');
    if (guaranteeSection) guaranteeSection.hidden = distanceOnly;
  }

  function fillRuleForm(rule) {
    const draft = rule || emptyRuleDraft();
    const base = draft.base || {
      baseCallCount: draft.baseCallCount,
      payStartCallCount: draft.payStartCallCount,
      payPerCall: draft.payPerCall,
      guaranteedUnitPrice: draft.guaranteedUnitPrice,
      callTiers: draft.callTiers,
      payPerCallTiers: draft.payPerCallTiers
    };
    state.tierDraft = base.callTiers || draft.callTiers || [];
    state.payTierDraft = base.payPerCallTiers || draft.payPerCallTiers || [];
    const distance = base.distance || draft.distance || {};
    state.distanceTierDraft = Array.isArray(distance.tiers) ? distance.tiers : [];
    state.distanceAddonDraft = Array.isArray(base.distanceAddons) ? base.distanceAddons : (draft.base?.distanceAddons || []);
    state.editingRuleId = rule?.id || '';
    const platformValue = setPromotionRulePlatformField(
      rule?.id
        ? (draft.platform || getActiveRulesPlatformTab())
        : getActiveRulesPlatformTab()
    );
    state.conditionDrafts = {
      block: normalizeConditionsForPlatform(draft.blockConditions || [], platformValue),
      bonus: normalizeConditionsForPlatform(draft.bonusConditions || [], platformValue),
      reference: normalizeConditionsForPlatform(draft.referenceConditions || [], platformValue)
    };

    $('#promotionRuleFormTitle').textContent = rule ? '프로모션 조건 수정' : '프로모션 조건 추가';
    $('#promotionRuleName').value = draft.name;
    $('#promotionRuleType').value = draft.type || 'count_per_order';
    $('#promotionRuleEnabled').checked = draft.enabled !== false;
    if ($('#promotionRuleSlaApply')) $('#promotionRuleSlaApply').checked = draft.slaApply === true;
    syncSlaApplyField(platformValue);
    $('#promotionRuleBaseCallCount').value = base.baseCallCount ?? 0;
    $('#promotionRulePayStartCallCount').value = base.payStartCallCount ?? 0;
    $('#promotionRulePayPerCall').value = base.payPerCall ?? 0;
    const tierMode = $('#promotionPayTierMode');
    if (tierMode) tierMode.value = base.payPerCallTierMode === 'step' ? 'step' : 'retroactive';
    $('#promotionRuleApplyGlobalBlock').checked = draft.applyGlobalAcceptBlock !== false;
    $('#promotionRuleAllowDuplicate').checked = Boolean(draft.allowDuplicate);
    $('#promotionRuleDuplicateStrategy').value = draft.duplicateStrategy || 'highest_priority';
    $('#promotionRuleNoPayConditions').value = draft.noPayConditions || '';
    if ($('#promotionDistanceEnabled')) $('#promotionDistanceEnabled').checked = distance.enabled === true || draft.type === 'distance';
    if ($('#promotionDistanceUnit')) $('#promotionDistanceUnit').value = distance.unit === '100m' ? '100m' : 'km';
    if ($('#promotionDistanceStart')) $('#promotionDistanceStart').value = distance.startKm ?? 0;
    if ($('#promotionDistancePayPerUnit')) $('#promotionDistancePayPerUnit').value = distance.payPerUnit ?? 0;
    if ($('#promotionDistanceTierMode')) $('#promotionDistanceTierMode').value = distance.tierMode === 'step' ? 'step' : 'retroactive';

    renderTierRows(state.tierDraft);
    renderPayTierRows(state.payTierDraft);
    renderDistanceTierRows(state.distanceTierDraft);
    renderDistanceAddonRows(state.distanceAddonDraft);
    fillDistanceAddonLadder(base.distanceAddonLadder || draft.base?.distanceAddonLadder);
    const outside = base.outsideCallAddon || draft.base?.outsideCallAddon || {};
    if ($('#promotionOutsideCallStart')) $('#promotionOutsideCallStart').value = outside.startCount || '';
    if ($('#promotionOutsideCallAmount')) $('#promotionOutsideCallAmount').value = outside.amountPerCall || '';
    syncTypeSections();
    renderConditionLists(platformValue);
    updateRateFieldLabels(platformValue);

    const formCard = $('#promotionRuleFormCard');
    if (formCard) {
      formCard.hidden = false;
      formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function hideRuleForm() {
    state.editingRuleId = '';
    state.tierDraft = [];
    state.payTierDraft = [];
    state.distanceTierDraft = [];
    state.distanceAddonDraft = [];
    state.conditionDrafts = { block: [], bonus: [], reference: [] };
    const formCard = $('#promotionRuleFormCard');
    if (formCard) formCard.hidden = true;
    const form = $('#promotionRuleForm');
    if (form) form.reset();
  }

  function readRuleForm() {
    const platform = normalizePlatform($('#promotionRulePlatform').value || getActiveRulesPlatformTab());
    const callTiers = readTierRowsFromForm();
    const type = $('#promotionRuleType').value;
    const distanceEnabled = $('#promotionDistanceEnabled')?.checked === true || type === 'distance';
    const base = {
      baseCallCount: Number($('#promotionRuleBaseCallCount').value || 0),
      payStartCallCount: Number($('#promotionRulePayStartCallCount').value || 0),
      payPerCall: Number($('#promotionRulePayPerCall').value || 0),
      guaranteedUnitPrice: 0,
      callTiers,
      payPerCallTiers: readPayTierRowsFromForm(),
      payPerCallTierMode: $('#promotionPayTierMode')?.value === 'step' ? 'step' : 'retroactive',
      distance: {
        enabled: distanceEnabled,
        unit: $('#promotionDistanceUnit')?.value === '100m' ? '100m' : 'km',
        startKm: Number($('#promotionDistanceStart')?.value || 0),
        payPerUnit: Number($('#promotionDistancePayPerUnit')?.value || 0),
        tiers: readDistanceTierRowsFromForm(),
        tierMode: $('#promotionDistanceTierMode')?.value === 'step' ? 'step' : 'retroactive'
      },
      distanceAddons: readDistanceAddonRows(),
      distanceAddonLadder: readDistanceAddonLadder(),
      outsideCallAddon: readOutsideCallAddon()
    };

    return {
      name: $('#promotionRuleName').value.trim(),
      type: $('#promotionRuleType').value,
      platform,
      enabled: $('#promotionRuleEnabled').checked,
      slaApply: (platform === 'baemin' || platform === 'combined')
        && $('#promotionRuleSlaApply')?.checked === true,
      startDate: '',
      endDate: '',
      base,
      blockConditions: normalizeConditionsForPlatform(namedConditions(readConditionsFromForm('block'), platform), platform),
      bonusConditions: normalizeConditionsForPlatform(namedConditions(readConditionsFromForm('bonus'), platform), platform),
      referenceConditions: normalizeConditionsForPlatform(namedConditions(readConditionsFromForm('reference'), platform), platform),
      applyGlobalAcceptBlock: $('#promotionRuleApplyGlobalBlock').checked,
      allowDuplicate: $('#promotionRuleAllowDuplicate').checked,
      duplicateStrategy: $('#promotionRuleDuplicateStrategy').value,
      noPayConditions: $('#promotionRuleNoPayConditions').value.trim()
    };
  }

  function validateRuleForm(payload) {
    if (!payload.name) return '프로모션명을 입력하세요.';

    if (payload.type !== 'guaranteed_unit_price' && payload.base.payPerCall > 0 && payload.base.payStartCallCount <= 0) {
      return '건당 지급을 사용하려면 지급 시작 콜수를 입력하세요.';
    }

    if (payload.type === 'guaranteed_unit_price' || payload.type === 'both') {
      const validTiers = payload.base.callTiers.filter(tier => tier.minCalls > 0 && tier.unitPrice > 0);
      if (!validTiers.length) {
        return '단가보장은 콜수 구간에 N건 이상·보장 단가를 입력하세요.';
      }
    }

    const tierMins = payload.base.callTiers
      .filter(tier => tier.minCalls > 0 && tier.unitPrice > 0)
      .map(tier => tier.minCalls);
    if (new Set(tierMins).size !== tierMins.length) {
      return '콜수 구간의 최소 콜수가 중복되면 안 됩니다.';
    }

    const payTiers = payload.base.payPerCallTiers || [];
    const stepTiers = payload.base.payPerCallTierMode === 'step';
    const tierWord = stepTiers ? '구간 단가' : '소급 단가';
    const halfFilled = payTiers.find(tier => !(tier.minCalls > 0) || !(tier.payPerCall > 0));
    if (halfFilled) {
      return `${tierWord} 구간은 콜수와 건당 단가를 모두 입력하세요.`;
    }
    const payTierMins = payTiers.map(tier => tier.minCalls);
    if (new Set(payTierMins).size !== payTierMins.length) {
      return `${tierWord} 구간의 콜수가 중복되면 안 됩니다.`;
    }
    if (payTiers.length > maxCallTiers()) {
      return `${tierWord} 구간은 최대 ${maxCallTiers()}개까지 저장할 수 있습니다.`;
    }
    if (payTiers.length && !(payload.base.payStartCallCount > 0)) {
      return `${tierWord} 구간을 쓰려면 지급 시작 콜수를 입력하세요.`;
    }
    // 달성 콜수가 지급 시작 콜수보다 작으면 그 구간은 절대 단독으로 적용되지 않아
    // 설정한 사람이 의도한 금액과 다르게 나온다.
    const tooEarly = payTiers.find(tier => tier.minCalls < payload.base.payStartCallCount
      || (stepTiers && tier.minCalls <= payload.base.payStartCallCount));
    if (tooEarly) {
      return stepTiers
        ? `구간은 지급 시작 콜수(${payload.base.payStartCallCount}건)보다 큰 콜수부터 입력하세요. 101건부터 300건까지 기본 단가면 301을 입력합니다.`
        : `소급 단가 구간의 달성 콜수(${tooEarly.minCalls}건)는 지급 시작 콜수(${payload.base.payStartCallCount}건) 이상이어야 합니다.`;
    }

    const distance = payload.base.distance || {};
    const distanceActive = distance.enabled === true || payload.type === 'distance';
    if (distanceActive) {
      const distTiers = (distance.tiers || []).filter(tier => tier.minKm > 0 || tier.payPerUnit > 0);
      const distHalf = distTiers.find(tier => !(tier.minKm > 0) || !(tier.payPerUnit > 0));
      if (distHalf) {
        return '거리 구간은 N km와 단위당 지급액을 모두 입력하세요.';
      }
      const validDistTiers = distTiers.filter(tier => tier.minKm > 0 && tier.payPerUnit > 0);
      if (!(distance.payPerUnit > 0) && !validDistTiers.length) {
        return '거리 프로모션은 단위당 지급액이나 거리 구간을 입력하세요.';
      }
      const distMins = validDistTiers.map(tier => tier.minKm);
      if (new Set(distMins).size !== distMins.length) {
        return '거리 구간의 N km가 중복되면 안 됩니다.';
      }
      const distStepMode = distance.tierMode === 'step';
      const distTooEarly = validDistTiers.find(tier => tier.minKm < distance.startKm
        || (distStepMode && tier.minKm <= distance.startKm));
      if (distTooEarly) {
        return `거리 구간의 N km(${distTooEarly.minKm}km)는 지급 시작 거리(${distance.startKm}km) 이상이어야 합니다.`;
      }
      if (payload.platform === 'baemin') {
        return '배민은 거리 데이터가 없어 거리 프로모션을 쓸 수 없습니다. 쿠팡 또는 합산으로 만드세요.';
      }
    }

    const bonusDistance = (payload.bonusConditions || []).filter(item =>
      item.conditionType === 'weekly_distance_km' || item.actionType === 'distance_per_km'
    );
    if (payload.platform === 'baemin' && bonusDistance.length) {
      return '배민은 거리 데이터가 없어 추가 가산에 주간 거리를 넣을 수 없습니다.';
    }
    if (distanceActive && bonusDistance.some(item => item.actionType === 'distance_per_km')) {
      return '거리 금액은 거리 프로모션 칸이나 추가 가산의 거리당 지급 중 한곳에만 넣으세요.';
    }
    const bonusRateMissing = bonusDistance.find(item =>
      item.actionType === 'distance_per_km' && !(item.distancePayPerKm > 0)
    );
    if (bonusRateMissing) {
      return '추가 가산의 거리당 지급은 km당 금액을 입력하세요.';
    }

    const addons = payload.base.distanceAddons || [];
    if (addons.length && payload.platform === 'baemin') {
      return '배민은 거리 데이터가 없어 거리 가산을 넣을 수 없습니다.';
    }
    if (addons.length > 3) {
      return '거리 가산은 최대 3개까지입니다.';
    }
    const addonHalf = addons.find(row => !(row.minKm > 0) || !(row.amount > 0));
    if (addonHalf) {
      return '거리 가산은 달성 km와 지급 금액을 모두 입력하세요.';
    }
    const addonKms = addons.map(row => row.minKm);
    if (new Set(addonKms).size !== addonKms.length) {
      return '거리 가산의 달성 km가 중복되면 안 됩니다.';
    }

    const outside = payload.base.outsideCallAddon;
    if (outside && payload.platform === 'baemin') {
      return '배민은 권외콜 데이터가 없어 가산3을 넣을 수 없습니다.';
    }
    const outsideStart = Number($('#promotionOutsideCallStart')?.value || 0);
    const outsideAmount = Number($('#promotionOutsideCallAmount')?.value || 0);
    if ((outsideStart > 0) !== (outsideAmount > 0)) {
      return '권외콜 가산은 시작 건수와 건당 금액을 모두 입력하세요.';
    }

    const ladder = payload.base.distanceAddonLadder;
    if (ladder) {
      if (!(ladder.startKm > 0 && ladder.stepKm > 0 && ladder.amount > 0 && ladder.untilKm >= ladder.startKm)) {
        return '반복 가산은 시작 km, 간격, 칸마다 금액, 마지막 km를 모두 입력하세요.';
      }
      const steps = Math.floor((ladder.untilKm - ladder.startKm) / ladder.stepKm) + 1;
      const maxSteps = window.BremPromotionConditions?.MAX_DISTANCE_LADDER_STEPS || 80;
      if (steps > maxSteps) {
        return `반복 가산은 ${maxSteps}칸까지입니다. 마지막 km를 낮추거나 간격을 넓히세요.`;
      }
    }

    const allConditions = [
      ...payload.blockConditions,
      ...payload.bonusConditions,
      ...payload.referenceConditions
    ];
    if (allConditions.some(item => !item.conditionName.trim())) {
      return '입력한 조건에는 조건명을 모두 입력하세요.';
    }

    if (payload.blockConditions.length > maxConditionsPerMode()
      || payload.bonusConditions.length > maxConditionsPerMode()
      || payload.referenceConditions.length > maxConditionsPerMode()) {
      return `미지급/추가/참고 조건은 각각 최대 ${maxConditionsPerMode()}개까지 저장할 수 있습니다.`;
    }

    const validTiersForCount = payload.base.callTiers.filter(tier => tier.minCalls > 0 || tier.unitPrice > 0);
    if (validTiersForCount.length > maxCallTiers()) {
      return `콜수 구간은 최대 ${maxCallTiers()}개까지 저장할 수 있습니다.`;
    }

    return '';
  }

  async function persistPromotionWrite(work) {
    const result = await Promise.resolve(work());
    if (typeof BremStorage.flush === 'function') {
      await BremStorage.flush();
    }
    return result;
  }

  async function saveRuleForm(event) {
    event.preventDefault();
    const payload = readRuleForm();
    const error = validateRuleForm(payload);
    if (error) {
      showToast(error);
      return;
    }

    try {
      if (state.editingRuleId) {
        const id = state.editingRuleId;
        await persistPromotionWrite(() => BremStorage.promotionRules.update(id, payload));
        state.previewRuleId = id;
        showToast('프로모션 조건이 저장되었습니다.');
      } else {
        const created = await persistPromotionWrite(() => BremStorage.promotionRules.create(payload));
        state.previewRuleId = created.id;
        showToast('프로모션 조건이 추가되었습니다.');
      }
    } catch (saveError) {
      showToast(saveError.message || '프로모션 조건 저장에 실패했습니다. 새로고침 후 다시 저장하세요.');
      return;
    }

    hideRuleForm();
    refresh();
  }

  function syncSlaApplyField(platform) {
    const show = normalizePlatform(platform) === 'baemin' || normalizePlatform(platform) === 'combined';
    $$('[data-sla-apply-field]').forEach(field => {
      field.hidden = !show;
    });
    if (!show && $('#promotionRuleSlaApply')) $('#promotionRuleSlaApply').checked = false;
  }

  function renderGlobalSettingsForm() {
    const settings = BremStorage.promotionSettings.get();
    $('#promotionGlobalBlockEnabled').checked = settings.globalBlockEnabled !== false;
    $('#promotionGlobalMinAcceptRate').value = settings.globalMinAcceptRate;
    $('#promotionGlobalMaxRejectRate').value = settings.globalMaxRejectRate;
    $('#promotionGlobalBlockPlatform').value = settings.globalBlockPlatform || 'all';

    const applyTo = settings.globalBlockApplyTo;
    const isSelected = Array.isArray(applyTo);
    $('#promotionGlobalBlockApplyTo').value = isSelected ? 'selected' : 'all';
    state.globalSelectedRuleIds = isSelected ? applyTo : [];

    renderGlobalRulePickers();
  }

  function renderGlobalRulePickers() {
    const container = $('#promotionGlobalRulePickers');
    const mode = $('#promotionGlobalBlockApplyTo')?.value;
    if (!container) return;

    if (mode !== 'selected') {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }

    container.hidden = false;
    const rules = BremStorage.getUserPromotionRules?.() || BremStorage.promotionRules.getAll();
    container.innerHTML = rules.map(rule => `
      <label class="promotion-checkbox-field">
        <input type="checkbox" value="${escapeHtml(rule.id)}" data-global-rule-id${state.globalSelectedRuleIds.includes(rule.id) ? ' checked' : ''}>
        <span>${escapeHtml(rule.name)} (${escapeHtml(platformLabel(rule.platform))})</span>
      </label>
    `).join('') || '<p class="form-help">선택할 프로모션 조건이 없습니다.</p>';
  }

  function saveGlobalSettings(event) {
    event.preventDefault();
    const applyMode = $('#promotionGlobalBlockApplyTo').value;
    let globalBlockApplyTo = 'all';
    if (applyMode === 'selected') {
      globalBlockApplyTo = $$('[data-global-rule-id]:checked').map(input => input.value);
    }

    BremStorage.promotionSettings.update({
      globalBlockEnabled: $('#promotionGlobalBlockEnabled').checked,
      globalMinAcceptRate: Number($('#promotionGlobalMinAcceptRate').value || 0),
      globalMaxRejectRate: Number($('#promotionGlobalMaxRejectRate').value || 0),
      globalBlockPlatform: $('#promotionGlobalBlockPlatform').value,
      globalBlockApplyTo
    });

    showToast('전역 조건이 저장되었습니다.');
    refresh();
  }

  function assignedPromotionStats() {
    const driverCounts = new Map();
    const regionIds = new Set();
    const addCount = (map, id) => {
      const key = String(id || '').trim();
      if (!key) return;
      map.set(key, (map.get(key) || 0) + 1);
    };
    const addId = (set, id) => {
      const key = String(id || '').trim();
      if (key) set.add(key);
    };
    const drivers = (typeof BremStorage.drivers.getAllKnownById === 'function'
      ? BremStorage.drivers.getAllKnownById()
      : BremStorage.drivers.getAll?.()) || [];
    drivers.forEach(driver => {
      const assigned = window.BremMissionPromotionCatalog?.getDriverAssignment?.(driver, { strict: false });
      if (assigned) {
        addCount(driverCounts, assigned.baemin);
        addCount(driverCounts, assigned.coupang);
        addCount(driverCounts, assigned.combined);
        return;
      }
      addCount(driverCounts, driver.selectedMissionIdBaemin || driver.promotionRuleIdBaemin);
      addCount(driverCounts, driver.selectedMissionIdCoupang || driver.promotionRuleIdCoupang);
      addCount(driverCounts, driver.selectedMissionIdCombined || driver.promotionRuleIdCombined);
    });
    const defaults = BremStorage.missionDefaults?.getMeta?.()?.byRegion || {};
    Object.values(defaults).forEach(item => {
      addId(regionIds, item?.baemin);
      addId(regionIds, item?.coupang);
      addId(regionIds, item?.combined);
    });
    return { driverCounts, regionIds };
  }

  function isPromotionAssigned(ruleId, stats) {
    const id = String(ruleId || '').trim();
    return Boolean((stats.driverCounts.get(id) || 0) > 0 || stats.regionIds.has(id));
  }

  function assignedPromotionTag(ruleId, stats) {
    const id = String(ruleId || '').trim();
    const count = stats.driverCounts.get(id) || 0;
    if (!count && !stats.regionIds.has(id)) return '';
    const text = count > 0 ? `배정됨 ${formatNumber(count)}명` : '배정됨';
    return ` <span class="promotion-assigned-tag">${text}</span>`;
  }

  function renderRulesList() {
    const listEl = $('#promotionRulesList');
    if (!listEl) return;

    const tabPlatform = getActiveRulesPlatformTab();
    const assigned = assignedPromotionStats();
    const rules = getPromotionRulesForPlatform(tabPlatform, { includeDisabled: true })
      .slice()
      .sort((a, b) => Number(Boolean(b.locked)) - Number(Boolean(a.locked))
        || Number(isPromotionAssigned(b.id, assigned)) - Number(isPromotionAssigned(a.id, assigned))
        || String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
    if (!rules.length) {
      const emptyLabel = tabPlatform === 'combined' ? '합산' : platformLabel(tabPlatform);
      listEl.innerHTML = `<p class="empty promotion-empty">${emptyLabel} 프로모션 조건이 없습니다. 조건 추가 버튼으로 만들어 주세요.</p>`;
      return;
    }

    const unlockedCount = rules.filter(rule => !rule.locked).length;
    const lockedCount = rules.length - unlockedCount;
    const assignedCount = rules.filter(rule => isPromotionAssigned(rule.id, assigned)).length;
    const emptyLabel = tabPlatform === 'combined' ? '합산' : platformLabel(tabPlatform);

    listEl.innerHTML = `
      <div class="promotion-rules-toolbar">
        <button type="button" class="small-btn danger-btn" id="promotionRulesDeleteUnlockedBtn">잠금 제외 삭제</button>
        <p>${emptyLabel} ${formatNumber(rules.length)}개 · 배정됨 ${formatNumber(assignedCount)}개 · 잠금 ${formatNumber(lockedCount)}개 · 잠금 제외 ${formatNumber(unlockedCount)}개. 쓰는 조건은 잠그고, 나머지는 한 번에 지우세요.</p>
      </div>
      <div class="table-wrap">
        <table class="promotion-rules-table">
          <thead>
            <tr>
              <th>프로모션명</th>
              <th>유형</th>
              <th>플랫폼</th>
              <th>미지급/추가</th>
              <th>기본 건당</th>
              <th>구간</th>
              <th>잠금</th>
              <th>사용</th>
              <th>SLA시간</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            ${rules.map(rule => {
              const payLabel = rule.payPerCall > 0
                ? `${formatNumber(rule.payStartCallCount)}~ ${formatMoney(rule.payPerCall)}`
                : '-';
              const active = state.previewRuleId === rule.id ? ' row-selected' : '';
              const locked = rule.locked === true;
              const condText = `미지급 ${(rule.blockConditions || []).length} · 추가 ${(rule.bonusConditions || []).length}`;
              const canSla = tabPlatform === 'baemin' || tabPlatform === 'combined';
              return `
                <tr class="${active}${locked ? ' is-promotion-locked' : ''}">
                  <td><strong>${escapeHtml(rule.name)}</strong>${assignedPromotionTag(rule.id, assigned)}${locked ? ' <span class="mission-lock-tag">잠금</span>' : ''}${rule.slaApply ? ' <span class="promotion-sla-tag">SLA시간</span>' : ''}</td>
                  <td>${escapeHtml(promotionTypeLabel(rule.type))}</td>
                  <td>${escapeHtml(platformLabel(rule.platform))}</td>
                  <td>${escapeHtml(condText)}</td>
                  <td>${payLabel}</td>
                  <td>${(rule.callTiers || []).length}</td>
                  <td>
                    <button type="button" class="small-btn promotion-lock-btn${locked ? ' is-active' : ''}" data-toggle-promotion-lock="${rule.id}">
                      ${locked ? '잠금 해제' : '잠금'}
                    </button>
                  </td>
                  <td>
                    <button type="button" class="small-btn promotion-enabled-btn${rule.enabled ? ' is-active' : ''}" data-toggle-promotion="${rule.id}">
                      ${rule.enabled ? '사용' : '중지'}
                    </button>
                  </td>
                  <td>
                    ${canSla ? `
                    <button type="button" class="small-btn promotion-sla-btn${rule.slaApply ? ' is-active' : ''}" data-toggle-sla="${rule.id}">
                      ${rule.slaApply ? '적용' : '적용안함'}
                    </button>` : '-'}
                  </td>
                  <td class="promotion-rule-actions">
                    <button type="button" class="small-btn" data-edit-promotion="${rule.id}">수정</button>
                    <button type="button" class="small-btn" data-copy-promotion="${rule.id}">복사</button>
                    <button type="button" class="small-btn danger-btn" data-delete-promotion="${rule.id}"${locked ? ' disabled title="잠긴 조건은 삭제할 수 없습니다"' : ''}>삭제</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function deleteUnlockedRulesOnTab() {
    const tabPlatform = getActiveRulesPlatformTab();
    const rules = getPromotionRulesForPlatform(tabPlatform, { includeDisabled: true });
    const unlocked = rules.filter(rule => !rule.locked);
    if (!unlocked.length) {
      showToast('이 탭에서 지울 잠금 제외 조건이 없습니다.');
      return;
    }
    const label = tabPlatform === 'combined' ? '합산' : platformLabel(tabPlatform);
    if (!window.confirm(`${label} 탭에서 잠기지 않은 ${unlocked.length}개를 삭제할까요? 잠긴 조건은 그대로 둡니다.`)) {
      return;
    }
    const ids = unlocked.map(rule => rule.id);
    if (ids.includes(state.previewRuleId)) state.previewRuleId = '';
    if (ids.includes(state.editingRuleId)) hideRuleForm();
    void persistPromotionWrite(() => BremStorage.promotionRules.removeMany(ids))
      .then(() => {
        showToast(`${label} 잠금 제외 ${ids.length}개를 삭제했습니다.`);
        refresh();
      })
      .catch(error => {
        showToast(error.message || '삭제 저장에 실패했습니다.');
      });
  }

  function renderDriverSelectors() {
    const rowsEl = $('#promotionDriverSelectorRows');
    if (!rowsEl) return;

    const drivers = filteredDriversForPromotion();
    if (!drivers.length) {
      rowsEl.innerHTML = '<tr><td colspan="3" class="empty">표시할 기사가 없습니다.</td></tr>';
      return;
    }

    rowsEl.innerHTML = drivers.map(driver => `
      <tr>
        <td><strong>${escapeHtml(driver.name)}</strong></td>
        <td>${buildPromotionRuleSelect('coupang', driver.promotionRuleIdCoupang || driver.promotionSelectorCoupang || '', `coupang:${driver.id}`)}</td>
        <td>${buildPromotionRuleSelect('baemin', driver.promotionRuleIdBaemin || driver.promotionSelectorBaemin || '', `baemin:${driver.id}`)}</td>
      </tr>
    `).join('');
  }

  function saveDriverSelector(event) {
    const select = event.target.closest('.promotion-driver-select');
    if (!select) return;

    const field = select.dataset.promotionDriverField || '';
    const [platform, driverId] = field.split(':');
    if (!platform || !driverId) return;

    const changes = platform === 'baemin'
      ? {
        promotionRuleIdBaemin: select.value,
        promotionSelectorBaemin: select.value
      }
      : {
        promotionRuleIdCoupang: select.value,
        promotionSelectorCoupang: select.value
      };

    BremStorage.drivers.update(driverId, changes);
    showToast('기사 프로모션이 저장되어 미리보기에 적용되었습니다.');
    refresh();
  }

  function formatRateWithLabel(row) {
    if (row.platformRate === null || row.platformRate === undefined || row.platformRate === '') return '-';
    const label = row.rateLabel || platformRateLabel(row.platform || getActivePlatform());
    return `${label} ${formatRate(row.platformRate ?? row.acceptRate)}`;
  }

  function renderConditionChips(items, muted = false) {
    if (!items?.length) return '-';
    return items.map(item => {
      const label = typeof item === 'string' ? item : (item.name || item);
      return `<span class="promotion-condition-chip${muted ? ' muted' : ''}">${escapeHtml(label)}</span>`;
    }).join('');
  }

  function renderFailureCell(row) {
    const reasons = row.blockReasons?.length
      ? row.blockReasons
      : (row.failureReasons?.length ? row.failureReasons : (row.reason ? [row.reason] : []));
    if (!reasons.length) return '없음';
    return reasons.map(reason => `<span class="promotion-failure-chip">${escapeHtml(reason)}</span>`).join('');
  }

  function renderSinglePreview() {
    const titleEl = $('#promotionPreviewRuleName');
    const rowsEl = $('#promotionPreviewRows');
    const rule = state.previewRuleId ? BremStorage.promotionRules.getById(state.previewRuleId) : null;
    const weekStart = getSelectedWeekStart();
    const weekEnd = BremPromotionEngine.weekEndKey(weekStart);
    const filter = driverFilterFromSearch();

    if (!rule) {
      titleEl.textContent = '미리볼 프로모션 조건을 선택하세요.';
      rowsEl.innerHTML = '<tr><td colspan="11" class="empty">조건 목록에서 미리보기를 눌러 주세요.</td></tr>';
      return;
    }

    titleEl.textContent = `[단일] ${rule.name} · ${platformLabel(rule.platform)} · ${weekStart} ~ ${weekEnd}`;
    updateRateFieldLabels(rule.platform);
    const rows = BremPromotionEngine.evaluatePreview(rule, weekStart, filter);

    if (!rows.length) {
      rowsEl.innerHTML = '<tr><td colspan="11" class="empty">표시할 기사가 없습니다.</td></tr>';
      return;
    }

    rowsEl.innerHTML = rows.map(row => `
      <tr class="${row.eligible ? 'promotion-row-paid' : 'promotion-row-unpaid'}">
        <td><strong>${escapeHtml(row.driverName)}</strong></td>
        <td>${escapeHtml(row.selectedPromotionName || selectorLabel(row.selectedPromotionRuleId))}</td>
        <td>${formatNumber(row.callCount)}</td>
        <td>${formatRateWithLabel({ ...row, platform: rule.platform })}</td>
        <td>${row.paidCallCount ? `${formatNumber(row.paidCallCount)}건` : '-'}</td>
        <td>${row.basePay ? formatMoney(row.basePay) : (row.perCallBonus ? formatMoney(row.perCallBonus) : '-')}</td>
        <td>${row.bonusPay ? formatMoney(row.bonusPay) : '-'}</td>
        <td><strong>${row.eligible ? formatMoney(row.totalBonus) : '-'}</strong></td>
        <td>${renderConditionChips([
          ...(row.appliedBlockConditions || []).map(item => item.name),
          ...(row.appliedBonusConditions || []).map(item => item.name)
        ])}</td>
        <td>${renderConditionChips((row.failedBonusConditions || []).map(item => item.name), true)}</td>
        <td class="promotion-failure-cell">${renderFailureCell(row)}</td>
      </tr>
    `).join('');
  }

  function renderCombinedPreview() {
    const titleEl = $('#promotionPreviewRuleName');
    const rowsEl = $('#promotionPreviewRows');
    const platform = getActivePlatform();
    const weekStart = getSelectedWeekStart();
    const weekEnd = BremPromotionEngine.weekEndKey(weekStart);
    const filter = driverFilterFromSearch();

    titleEl.textContent = `[통합] ${platformLabel(platform)} · ${weekStart} ~ ${weekEnd} · 중복 규칙 적용`;
    updateRateFieldLabels(platform);
    const rows = BremPromotionEngine.evaluateCombinedPreview(platform, weekStart, filter);

    if (!rows.length) {
      rowsEl.innerHTML = '<tr><td colspan="11" class="empty">표시할 기사가 없습니다.</td></tr>';
      return;
    }

    rowsEl.innerHTML = rows.map(row => `
      <tr class="${row.eligible ? 'promotion-row-paid' : 'promotion-row-unpaid'}">
        <td><strong>${escapeHtml(row.driverName)}</strong></td>
        <td>${escapeHtml(row.selectedPromotionName || '미선택')}</td>
        <td>${formatNumber(row.callCount)}</td>
        <td>${formatRateWithLabel({ ...row, platform })}</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td><strong>${row.eligible ? formatMoney(row.finalTotal) : '-'}</strong></td>
        <td>${escapeHtml(row.appliedRules || '-')}</td>
        <td>-</td>
        <td class="promotion-failure-cell">${renderFailureCell(row)}</td>
      </tr>
    `).join('');
  }

  function renderPreview() {
    if (!$('#promotionPreviewRows')) return;
    if (state.previewMode === 'combined') renderCombinedPreview();
    else renderSinglePreview();
  }

  function setPreviewMode(mode) {
    state.previewMode = mode;
    $$('[data-promotion-preview-mode]').forEach(button => {
      button.classList.toggle('active', button.dataset.promotionPreviewMode === mode);
    });
    renderPreview();
  }

  async function ensureAssignmentData() {
    try {
      await BremStorage.ensureSectionLoaded?.('promotions', { force: false, forceDrivers: false });
    } catch (error) {
      console.warn('[BREM] promotion assigned tags:', error?.message || error);
    }
  }

  function refresh() {
    renderGlobalSettingsForm();
    renderRulesList();
    if (typeof BremPromotionApplyAdmin !== 'undefined') {
      BremPromotionApplyAdmin.refresh();
    }
    void ensureAssignmentData().then(() => renderRulesList());
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    $('#promotionRuleAddBtn')?.addEventListener('click', () => {
      fillRuleForm({
        ...emptyRuleDraft(),
        platform: getActiveRulesPlatformTab()
      });
    });
    $('#promotionRuleFormCancel')?.addEventListener('click', hideRuleForm);
    $('#promotionRuleForm')?.addEventListener('submit', saveRuleForm);
    $('#promotionGlobalSettingsForm')?.addEventListener('submit', saveGlobalSettings);
    $('#promotionPayTierMode')?.addEventListener('change', () => {
      renderPayTierRows(readPayTierRowsFromForm({ includeEmpty: true }));
    });
    $('#promotionRuleType')?.addEventListener('change', () => {
      const platform = normalizePlatform($('#promotionRulePlatform')?.value || getActiveRulesPlatformTab());
      updateRateFieldLabels(platform);
      syncTypeSections();
    });
    $('#promotionDistanceEnabled')?.addEventListener('change', syncTypeSections);
    $('#promotionDistanceUnit')?.addEventListener('change', () => {
      renderDistanceTierRows(readDistanceTierRowsFromForm({ includeEmpty: true }));
    });
    $('#promotionDistanceTierMode')?.addEventListener('change', () => {
      renderDistanceTierRows(readDistanceTierRowsFromForm({ includeEmpty: true }));
    });
    $('#promotionAddDistanceAddonBtn')?.addEventListener('click', () => {
      const rows = readDistanceAddonRows({ includeEmpty: true });
      if (rows.length >= 3) {
        showToast('거리 가산은 최대 3개까지입니다.');
        return;
      }
      rows.push({ id: '', minKm: '', amount: '' });
      renderDistanceAddonRows(rows);
    });
    $('#promotionDistanceLadderFields')?.addEventListener('input', () => {
      renderDistanceLadderPreview();
    });
    $('#promotionDistanceAddonRows')?.addEventListener('input', event => {
      const field = event.target.closest('[data-dist-addon-km], [data-dist-addon-amount]');
      if (!field) return;
      const row = field.closest('.promotion-condition-row');
      const nameInput = row?.querySelector('[data-dist-addon-name]');
      if (!nameInput) return;
      const km = row.querySelector('[data-dist-addon-km]')?.value;
      const amount = row.querySelector('[data-dist-addon-amount]')?.value;
      const next = distanceAddonAutoName(km, amount);
      const current = nameInput.value.trim();
      const previous = nameInput.dataset.autoName || '';
      if (!current || current === previous) nameInput.value = next;
      nameInput.dataset.autoName = next;
    });
    $('#promotionDistanceAddonRows')?.addEventListener('click', event => {
      const removeBtn = event.target.closest('[data-remove-dist-addon]');
      if (!removeBtn) return;
      const row = removeBtn.closest('.promotion-condition-row');
      const rows = readDistanceAddonRows({ includeEmpty: true }).filter((_, index) => {
        const currentRow = $$('#promotionDistanceAddonRows .promotion-condition-row')[index];
        return currentRow !== row;
      });
      renderDistanceAddonRows(rows);
    });
    $('#promotionAddDistanceTierBtn')?.addEventListener('click', () => {
      const tiers = readDistanceTierRowsFromForm({ includeEmpty: true });
      if (tiers.length >= maxCallTiers()) {
        showToast(`거리 구간은 최대 ${maxCallTiers()}개까지 추가할 수 있습니다.`);
        return;
      }
      tiers.push({ id: '', minKm: '', payPerUnit: '' });
      renderDistanceTierRows(tiers);
    });
    $('#promotionDistanceTierRows')?.addEventListener('click', event => {
      const removeBtn = event.target.closest('[data-remove-dist-tier]');
      if (!removeBtn) return;
      const row = removeBtn.closest('.promotion-tier-row');
      const tiers = readDistanceTierRowsFromForm({ includeEmpty: true }).filter((_, index) => {
        const currentRow = $$('#promotionDistanceTierRows .promotion-tier-row')[index];
        return currentRow !== row;
      });
      renderDistanceTierRows(tiers.length ? tiers : [{ id: '', minKm: '', payPerUnit: '' }]);
    });
    $('#promotionRulePlatform')?.addEventListener('change', event => {
      syncConditionDraftsFromForm();
      const platform = normalizePlatform(event.target.value || getActiveRulesPlatformTab());
      renderConditionLists(platform);
      updateRateFieldLabels(platform);
      syncSlaApplyField(platform);
      syncTypeSections();
    });

    $('#promotionAddBlockConditionBtn')?.addEventListener('click', () => addConditionDraft('block'));

    $('#promotionAddBonusConditionBtn')?.addEventListener('click', () => addConditionDraft('bonus'));

    $('#promotionAddReferenceConditionBtn')?.addEventListener('click', () => addConditionDraft('reference'));

    ['#promotionBlockConditionsList', '#promotionBonusConditionsList', '#promotionReferenceConditionsList'].forEach(selector => {
      $(selector)?.addEventListener('click', event => {
        const removeBtn = event.target.closest('[data-remove-condition]');
        if (removeBtn) {
          const row = removeBtn.closest('.promotion-condition-row');
          const mode = row?.dataset.conditionMode;
          const index = Number(row?.dataset.conditionIndex || -1);
          if (mode && index >= 0) {
            syncConditionDraftsFromForm();
            state.conditionDrafts[mode].splice(index, 1);
            renderConditionLists($('#promotionRulePlatform')?.value || 'baemin');
          }
          return;
        }
      });

      $(selector)?.addEventListener('change', event => {
        const field = event.target.closest('[data-field]');
        if (!field) return;
        const row = field.closest('.promotion-condition-row');
        if (!row) return;
        const mode = row.dataset.conditionMode;
        const index = Number(row.dataset.conditionIndex || 0);
        const platform = $('#promotionRulePlatform')?.value || getActiveRulesPlatformTab();
        if (field.dataset.field === 'conditionType' || field.dataset.field === 'actionType') {
          syncConditionDraftsFromForm();
          state.conditionDrafts[mode][index] = {
            ...state.conditionDrafts[mode][index],
            conditionType: row.querySelector('[data-field="conditionType"]')?.value,
            actionType: row.querySelector('[data-field="actionType"]')?.value || 'add_pay_per_order'
          };
          const previousAuto = row.querySelector('[data-field="conditionName"]')?.dataset.autoName || '';
          refreshConditionRowFields(row, platform);
          const nameInput = row.querySelector('[data-field="conditionName"]');
          if (nameInput) nameInput.dataset.autoName = previousAuto;
          syncAutoConditionName(row, platform);
          syncConditionNameInRow(row, platform);
          return;
        }
        syncAutoConditionName(row, platform);
        if (field.dataset.field === 'rateThreshold') {
          syncConditionNameInRow(row, platform);
        }
      });
    });

    $('#promotionGlobalBlockApplyTo')?.addEventListener('change', renderGlobalRulePickers);

    $$('[data-promotion-preview-mode]').forEach(button => {
      button.addEventListener('click', () => setPreviewMode(button.dataset.promotionPreviewMode));
    });

    $$('[data-promotion-rules-platform]').forEach(button => {
      button.addEventListener('click', () => setRulesPlatformTab(button.dataset.promotionRulesPlatform));
    });

    $('#promotionAddTierBtn')?.addEventListener('click', () => {
      const tiers = readTierRowsFromForm({ includeEmpty: true });
      if (tiers.length >= maxCallTiers()) {
        showToast(`콜수 구간은 최대 ${maxCallTiers()}개까지 추가할 수 있습니다.`);
        return;
      }
      tiers.push({ id: '', minCalls: '', unitPrice: '' });
      renderTierRows(tiers);
    });

    $('#promotionTierRows')?.addEventListener('click', event => {
      const removeBtn = event.target.closest('[data-remove-tier]');
      if (!removeBtn) return;
      const row = removeBtn.closest('.promotion-tier-row');
      const tiers = readTierRowsFromForm({ includeEmpty: true }).filter((_, index) => {
        const currentRow = $$('#promotionTierRows .promotion-tier-row')[index];
        return currentRow !== row;
      });
      renderTierRows(tiers.length ? tiers : [{ id: '', minCalls: '', unitPrice: '' }]);
    });

    $('#promotionAddPayTierBtn')?.addEventListener('click', () => {
      const tiers = readPayTierRowsFromForm({ includeEmpty: true });
      if (tiers.length >= maxCallTiers()) {
        showToast(`소급 단가 구간은 최대 ${maxCallTiers()}개까지 추가할 수 있습니다.`);
        return;
      }
      tiers.push({ id: '', minCalls: '', payPerCall: '' });
      renderPayTierRows(tiers);
    });

    $('#promotionPayTierRows')?.addEventListener('click', event => {
      const removeBtn = event.target.closest('[data-remove-pay-tier]');
      if (!removeBtn) return;
      const row = removeBtn.closest('.promotion-tier-row');
      const tiers = readPayTierRowsFromForm({ includeEmpty: true }).filter((_, index) => {
        const currentRow = $$('#promotionPayTierRows .promotion-tier-row')[index];
        return currentRow !== row;
      });
      renderPayTierRows(tiers.length ? tiers : [{ id: '', minCalls: '', payPerCall: '' }]);
    });

    $('#promotionDriverSelectorRows')?.addEventListener('change', saveDriverSelector);

    $('#promotionRulesList')?.addEventListener('click', event => {
      const previewBtn = event.target.closest('[data-preview-promotion]');
      if (previewBtn) {
        state.previewRuleId = previewBtn.dataset.previewPromotion;
        setPreviewMode('single');
        refresh();
        return;
      }

      const editBtn = event.target.closest('[data-edit-promotion]');
      if (editBtn) {
        const rule = BremStorage.promotionRules.getById(editBtn.dataset.editPromotion);
        if (rule) fillRuleForm(rule);
        return;
      }

      const copyBtn = event.target.closest('[data-copy-promotion]');
      if (copyBtn) {
        void persistPromotionWrite(() => BremStorage.promotionRules.duplicate(copyBtn.dataset.copyPromotion))
          .then(copied => {
            state.previewRuleId = copied.id;
            showToast('프로모션 조건이 복사되었습니다.');
            refresh();
          })
          .catch(error => {
            showToast(error.message || '복사 저장에 실패했습니다.');
          });
        return;
      }

      const lockBtn = event.target.closest('[data-toggle-promotion-lock]');
      if (lockBtn) {
        void persistPromotionWrite(() => BremStorage.promotionRules.toggleLocked(lockBtn.dataset.togglePromotionLock))
          .then(rule => {
            showToast(rule.locked ? '이 조건을 잠갔습니다. 잠금 제외 삭제에서 빠집니다.' : '잠금을 해제했습니다.');
            refresh();
          })
          .catch(error => {
            showToast(error.message || '잠금 저장에 실패했습니다. 새로고침 후 다시 눌러주세요.');
          });
        return;
      }

      if (event.target.closest('#promotionRulesDeleteUnlockedBtn')) {
        deleteUnlockedRulesOnTab();
        return;
      }

      const toggleBtn = event.target.closest('[data-toggle-promotion]');
      if (toggleBtn) {
        void persistPromotionWrite(() => BremStorage.promotionRules.toggleEnabled(toggleBtn.dataset.togglePromotion))
          .then(() => {
            showToast('사용 여부가 변경되었습니다.');
            refresh();
          })
          .catch(error => {
            showToast(error.message || '사용 여부 저장에 실패했습니다.');
          });
        return;
      }

      const slaBtn = event.target.closest('[data-toggle-sla]');
      if (slaBtn) {
        const rule = BremStorage.promotionRules.getById(slaBtn.dataset.toggleSla);
        if (!rule) return;
        const platform = normalizePlatform(rule.platform);
        if (platform !== 'baemin' && platform !== 'combined') {
          showToast('SLA시간은 배민·합산 미션만 적용됩니다.');
          return;
        }
        const next = rule.slaApply !== true;
        void persistPromotionWrite(() => BremStorage.promotionRules.update(rule.id, { slaApply: next }))
          .then(() => {
            showToast(next
              ? '이 미션에 SLA시간을 적용합니다. 프로모션 적용 때 총완료 − 시간외완료로 계산합니다.'
              : '이 미션의 SLA시간적용을 껐습니다.');
            refresh();
          })
          .catch(error => {
            showToast(error.message || 'SLA 저장에 실패했습니다.');
          });
        return;
      }

      const deleteBtn = event.target.closest('[data-delete-promotion]');
      if (deleteBtn) {
        const rule = BremStorage.promotionRules.getById(deleteBtn.dataset.deletePromotion);
        if (rule?.locked) {
          showToast('잠긴 조건은 삭제할 수 없습니다. 잠금을 먼저 해제하세요.');
          return;
        }
        if (!window.confirm('이 프로모션 조건을 삭제할까요?')) return;
        if (state.previewRuleId === deleteBtn.dataset.deletePromotion) state.previewRuleId = '';
        if (state.editingRuleId === deleteBtn.dataset.deletePromotion) hideRuleForm();
        void persistPromotionWrite(() => BremStorage.promotionRules.remove(deleteBtn.dataset.deletePromotion))
          .then(() => {
            showToast('프로모션 조건이 삭제되었습니다.');
            refresh();
          })
          .catch(error => {
            showToast(error.message || '삭제 저장에 실패했습니다.');
          });
      }
    });
  }

  function init() {
    if (!$('#promotions')) return;
    bindEvents();
    setRulesPlatformTab('coupang');
    refresh();
  }

  return {
    init,
    refresh
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  BremPromotionAdmin.init();
});
