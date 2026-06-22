const BremPromotionAdmin = (function () {
  const state = {
    editingRuleId: '',
    previewRuleId: '',
    previewMode: 'single',
    rulesPlatformTab: 'coupang',
    tierDraft: [],
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
    const actions = Object.entries(BremPromotionConditions.BONUS_ACTION_TYPES).map(([value, label]) => (
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
    if (processingMode === 'bonus') {
      fields += bonusActionFieldsMarkup(condition);
    }
    return fields;
  }

  function renderConditionRow(condition, processingMode, platform, index) {
    const types = BremPromotionConditions.conditionTypesForPlatform(platform, processingMode);
    const typeOptions = types.map(item => (
      `<option value="${item.value}"${item.value === condition.conditionType ? ' selected' : ''}>${escapeHtml(item.label)}</option>`
    )).join('');

    return `
      <div class="promotion-condition-row" data-condition-mode="${processingMode}" data-condition-index="${index}">
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
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return {
      name: '',
      type: 'count_per_order',
      platform: 'baemin',
      enabled: true,
      startDate: `${year}-${month}-01`,
      endDate: `${year}-${month}-${String(new Date(year, now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`,
      base: {
        baseCallCount: 0,
        payStartCallCount: 0,
        payPerCall: 0,
        guaranteedUnitPrice: 0,
        callTiers: []
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

  function readTierRowsFromForm() {
    return $$('#promotionTierRows .promotion-tier-row').map((row, index) => ({
      id: row.dataset.tierId || '',
      minCalls: Number(row.querySelector('[data-tier-min-calls]')?.value || 0),
      unitPrice: Number(row.querySelector('[data-tier-unit-price]')?.value || 0),
      sortOrder: index
    })).filter(tier => tier.minCalls > 0 || tier.unitPrice > 0);
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

  function fillRuleForm(rule) {
    const draft = rule || emptyRuleDraft();
    const base = draft.base || {
      baseCallCount: draft.baseCallCount,
      payStartCallCount: draft.payStartCallCount,
      payPerCall: draft.payPerCall,
      guaranteedUnitPrice: draft.guaranteedUnitPrice,
      callTiers: draft.callTiers
    };
    state.tierDraft = base.callTiers || draft.callTiers || [];
    state.editingRuleId = rule?.id || '';
    state.conditionDrafts = {
      block: normalizeConditionsForPlatform(draft.blockConditions, platformValue),
      bonus: normalizeConditionsForPlatform(draft.bonusConditions, platformValue),
      reference: normalizeConditionsForPlatform(draft.referenceConditions, platformValue)
    };

    $('#promotionRuleFormTitle').textContent = rule ? '프로모션 조건 수정' : '프로모션 조건 추가';
    $('#promotionRuleName').value = draft.name;
    $('#promotionRuleType').value = draft.type || 'count_per_order';
    const platformValue = setPromotionRulePlatformField(
      rule?.id
        ? (draft.platform || getActiveRulesPlatformTab())
        : getActiveRulesPlatformTab()
    );
    $('#promotionRuleEnabled').checked = draft.enabled !== false;
    $('#promotionRuleStartDate').value = draft.startDate;
    $('#promotionRuleEndDate').value = draft.endDate;
    $('#promotionRuleBaseCallCount').value = base.baseCallCount ?? 0;
    $('#promotionRulePayStartCallCount').value = base.payStartCallCount ?? 0;
    $('#promotionRulePayPerCall').value = base.payPerCall ?? 0;
    $('#promotionRuleApplyGlobalBlock').checked = draft.applyGlobalAcceptBlock !== false;
    $('#promotionRuleAllowDuplicate').checked = Boolean(draft.allowDuplicate);
    $('#promotionRuleDuplicateStrategy').value = draft.duplicateStrategy || 'highest_priority';
    $('#promotionRuleNoPayConditions').value = draft.noPayConditions || '';
    renderTierRows(state.tierDraft);
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
    state.conditionDrafts = { block: [], bonus: [], reference: [] };
    const formCard = $('#promotionRuleFormCard');
    if (formCard) formCard.hidden = true;
    const form = $('#promotionRuleForm');
    if (form) form.reset();
  }

  function readRuleForm() {
    const platform = normalizePlatform($('#promotionRulePlatform').value || getActiveRulesPlatformTab());
    const callTiers = readTierRowsFromForm();
    const base = {
      baseCallCount: Number($('#promotionRuleBaseCallCount').value || 0),
      payStartCallCount: Number($('#promotionRulePayStartCallCount').value || 0),
      payPerCall: Number($('#promotionRulePayPerCall').value || 0),
      guaranteedUnitPrice: 0,
      callTiers
    };

    return {
      name: $('#promotionRuleName').value.trim(),
      type: $('#promotionRuleType').value,
      platform,
      enabled: $('#promotionRuleEnabled').checked,
      startDate: $('#promotionRuleStartDate').value,
      endDate: $('#promotionRuleEndDate').value,
      base,
      blockConditions: normalizeConditionsForPlatform(readConditionsFromForm('block'), platform),
      bonusConditions: normalizeConditionsForPlatform(readConditionsFromForm('bonus'), platform),
      referenceConditions: normalizeConditionsForPlatform(readConditionsFromForm('reference'), platform),
      applyGlobalAcceptBlock: $('#promotionRuleApplyGlobalBlock').checked,
      allowDuplicate: $('#promotionRuleAllowDuplicate').checked,
      duplicateStrategy: $('#promotionRuleDuplicateStrategy').value,
      noPayConditions: $('#promotionRuleNoPayConditions').value.trim()
    };
  }

  function validateRuleForm(payload) {
    if (!payload.name) return '프로모션명을 입력하세요.';
    if (!payload.startDate || !payload.endDate) return '시작일과 종료일을 입력하세요.';
    if (payload.startDate > payload.endDate) return '종료일은 시작일 이후여야 합니다.';

    if (payload.type !== 'guaranteed_unit_price' && payload.base.payPerCall > 0 && payload.base.payStartCallCount <= 0) {
      return '건당 지급을 사용하려면 지급 시작 콜수를 입력하세요.';
    }

    if (payload.type === 'guaranteed_unit_price' || payload.type === 'both') {
      const validTiers = payload.base.callTiers.filter(tier => tier.minCalls > 0 && tier.unitPrice > 0);
      if (!validTiers.length) {
        return '단가보장은 콜수 구간에 N건 이상·보장 단가를 입력하세요.';
      }
    }

    const tierMins = payload.base.callTiers.map(tier => tier.minCalls);
    if (new Set(tierMins).size !== tierMins.length) {
      return '콜수 구간의 최소 콜수가 중복되면 안 됩니다.';
    }

    const allConditions = [
      ...payload.blockConditions,
      ...payload.bonusConditions,
      ...payload.referenceConditions
    ];
    if (allConditions.some(item => !item.conditionName.trim())) {
      return '모든 조건에 조건명을 입력하세요.';
    }

    return '';
  }

  function saveRuleForm(event) {
    event.preventDefault();
    const payload = readRuleForm();
    const error = validateRuleForm(payload);
    if (error) {
      showToast(error);
      return;
    }

    if (state.editingRuleId) {
      BremStorage.promotionRules.update(state.editingRuleId, payload);
      state.previewRuleId = state.editingRuleId;
      showToast('프로모션 조건이 수정되었습니다. 미리보기에 적용되었습니다.');
    } else {
      const created = BremStorage.promotionRules.create(payload);
      state.previewRuleId = created.id;
      showToast('프로모션 조건이 추가되었습니다. 미리보기에 적용되었습니다.');
    }

    hideRuleForm();
    refresh();
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

  function renderRulesList() {
    const listEl = $('#promotionRulesList');
    if (!listEl) return;

    const tabPlatform = getActiveRulesPlatformTab();
    const rules = getPromotionRulesForPlatform(tabPlatform, { includeDisabled: true });
    if (!rules.length) {
      const emptyLabel = tabPlatform === 'combined' ? '합산' : platformLabel(tabPlatform);
      listEl.innerHTML = `<p class="empty promotion-empty">${emptyLabel} 프로모션 조건이 없습니다. 조건 추가 버튼으로 만들어 주세요.</p>`;
      return;
    }

    listEl.innerHTML = `
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
              <th>사용</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            ${rules.map(rule => {
              const payLabel = rule.payPerCall > 0
                ? `${formatNumber(rule.payStartCallCount)}~ ${formatMoney(rule.payPerCall)}`
                : '-';
              const active = state.previewRuleId === rule.id ? ' row-selected' : '';
              const condText = `미지급 ${(rule.blockConditions || []).length} · 추가 ${(rule.bonusConditions || []).length}`;
              return `
                <tr class="${active}">
                  <td><strong>${escapeHtml(rule.name)}</strong></td>
                  <td>${escapeHtml(promotionTypeLabel(rule.type))}</td>
                  <td>${escapeHtml(platformLabel(rule.platform))}</td>
                  <td>${escapeHtml(condText)}</td>
                  <td>${payLabel}</td>
                  <td>${(rule.callTiers || []).length}</td>
                  <td>
                    <button type="button" class="small-btn promotion-enabled-btn" data-toggle-promotion="${rule.id}">
                      ${rule.enabled ? '사용' : '중지'}
                    </button>
                  </td>
                  <td class="promotion-rule-actions">
                    <button type="button" class="small-btn" data-edit-promotion="${rule.id}">수정</button>
                    <button type="button" class="small-btn" data-copy-promotion="${rule.id}">복사</button>
                    <button type="button" class="small-btn danger-btn" data-delete-promotion="${rule.id}">삭제</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
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
        <td>${renderConditionChips((row.appliedBonusConditions || []).map(item => item.name))}</td>
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

  function refresh() {
    renderGlobalSettingsForm();
    renderRulesList();
    if (typeof BremPromotionApplyAdmin !== 'undefined') {
      BremPromotionApplyAdmin.refresh();
    }
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
    $('#promotionRuleType')?.addEventListener('change', () => {
      const platform = normalizePlatform($('#promotionRulePlatform')?.value || getActiveRulesPlatformTab());
      updateRateFieldLabels(platform);
    });
    $('#promotionRulePlatform')?.addEventListener('change', event => {
      const platform = normalizePlatform(event.target.value || getActiveRulesPlatformTab());
      renderConditionLists(platform);
      updateRateFieldLabels(platform);
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
        if (field.dataset.field === 'conditionType' || field.dataset.field === 'actionType') {
          syncConditionDraftsFromForm();
          state.conditionDrafts[mode][index] = {
            ...state.conditionDrafts[mode][index],
            conditionType: row.querySelector('[data-field="conditionType"]')?.value,
            actionType: row.querySelector('[data-field="actionType"]')?.value || 'add_pay_per_order'
          };
          refreshConditionRowFields(row, $('#promotionRulePlatform')?.value || 'baemin');
          syncConditionNameInRow(row, $('#promotionRulePlatform')?.value || 'baemin');
          return;
        }
        if (field.dataset.field === 'rateThreshold') {
          syncConditionNameInRow(row, $('#promotionRulePlatform')?.value || getActiveRulesPlatformTab());
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
      const tiers = readTierRowsFromForm();
      tiers.push({ id: '', minCalls: '', unitPrice: '' });
      renderTierRows(tiers);
    });

    $('#promotionTierRows')?.addEventListener('click', event => {
      const removeBtn = event.target.closest('[data-remove-tier]');
      if (!removeBtn) return;
      const row = removeBtn.closest('.promotion-tier-row');
      const tiers = readTierRowsFromForm().filter((_, index) => {
        const currentRow = $$('#promotionTierRows .promotion-tier-row')[index];
        return currentRow !== row;
      });
      renderTierRows(tiers.length ? tiers : [{ id: '', minCalls: '', unitPrice: '' }]);
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
        const copied = BremStorage.promotionRules.duplicate(copyBtn.dataset.copyPromotion);
        state.previewRuleId = copied.id;
        showToast('프로모션 조건이 복사되었습니다.');
        refresh();
        return;
      }

      const toggleBtn = event.target.closest('[data-toggle-promotion]');
      if (toggleBtn) {
        BremStorage.promotionRules.toggleEnabled(toggleBtn.dataset.togglePromotion);
        showToast('사용 여부가 변경되었습니다.');
        refresh();
        return;
      }

      const deleteBtn = event.target.closest('[data-delete-promotion]');
      if (deleteBtn) {
        if (!window.confirm('이 프로모션 조건을 삭제할까요?')) return;
        if (state.previewRuleId === deleteBtn.dataset.deletePromotion) state.previewRuleId = '';
        if (state.editingRuleId === deleteBtn.dataset.deletePromotion) hideRuleForm();
        BremStorage.promotionRules.remove(deleteBtn.dataset.deletePromotion);
        showToast('프로모션 조건이 삭제되었습니다.');
        refresh();
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
