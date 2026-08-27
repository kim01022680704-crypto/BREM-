/**
 * 프로모션 관리 → 미션 관리 목록 연동
 * 미션 목록은 promotions(프로모션 규칙)에서 자동 생성합니다.
 */
window.BremMissionPromotionCatalog = (function () {
  const TYPE_LABELS = {
    count_per_order: '건당',
    guaranteed_unit_price: '단가보장',
    both: '건당+단가보장'
  };

  function normalizePlatform(platform) {
    return BremPlatforms.normalize(platform);
  }

  function summarizeConditions(rule) {
    const parts = [];
    const tiers = Array.isArray(rule?.bonusTiers) ? rule.bonusTiers : [];
    if (tiers.length) {
      parts.push(`구간 ${tiers.length}개`);
    }
    if (rule?.payPerCall) {
      parts.push(`건당 ${Number(rule.payPerCall).toLocaleString('ko-KR')}원`);
    }
    if (rule?.guaranteedUnitPrice) {
      parts.push(`보장단가 ${Number(rule.guaranteedUnitPrice).toLocaleString('ko-KR')}원`);
    }
    const block = Array.isArray(rule?.blockConditions) ? rule.blockConditions : [];
    const bonus = Array.isArray(rule?.bonusConditions) ? rule.bonusConditions : [];
    if (block.length) parts.push(`미지급조건 ${block.length}`);
    if (bonus.length) parts.push(`추가조건 ${bonus.length}`);
    return parts.join(' · ') || rule?.description || '-';
  }

  function promotionToMissionItem(rule) {
    if (!rule?.id) return null;
    return {
      id: String(rule.id),
      title: String(rule.name || '').trim() || '(이름 없음)',
      description: String(rule.description || '').trim(),
      type: TYPE_LABELS[rule.type] || rule.type || '',
      conditions: summarizeConditions(rule),
      isActive: rule.enabled !== false,
      platform: normalizePlatform(rule.platform),
      source: 'promotion',
      promotionRule: rule
    };
  }

  function getPromotionRules() {
    return BremStorage?.getUserPromotionRules?.() || [];
  }

  function getAll() {
    return getPromotionRules()
      .map(promotionToMissionItem)
      .filter(Boolean)
      .sort((a, b) => String(a.title).localeCompare(String(b.title), 'ko'));
  }

  function getById(id) {
    const key = String(id || '').trim();
    if (!key) return null;
    const rule = BremStorage?.promotionRules?.getById?.(key);
    if (rule) return promotionToMissionItem(rule);
    return null;
  }

  function getForPlatform(platform) {
    const p = normalizePlatform(platform);
    return getAll().filter(item => item.platform === p);
  }

  function resolveLegacyMissionIdForPlatform(driver, platform) {
    const legacy = String(driver?.selectedMissionId || '').trim();
    if (!legacy) return '';
    const rule = BremStorage?.promotionRules?.getById?.(legacy);
    if (!rule || rule.enabled === false) return '';
    if (normalizePlatform(rule.platform) !== normalizePlatform(platform)) return '';
    return legacy;
  }

  function getDriverAssignment(driver) {
    if (!driver) return { baemin: '', coupang: '', combined: '' };
    return {
      // 미션관리 저장값(selectedMissionId*)을 우선. 없으면 프로모션 배정 레거시 필드.
      baemin: String(
        driver.selectedMissionIdBaemin
        || driver.promotionRuleIdBaemin
        || driver.promotionSelectorBaemin
        || resolveLegacyMissionIdForPlatform(driver, 'baemin')
        || ''
      ).trim(),
      coupang: String(
        driver.selectedMissionIdCoupang
        || driver.promotionRuleIdCoupang
        || driver.promotionSelectorCoupang
        || resolveLegacyMissionIdForPlatform(driver, 'coupang')
        || ''
      ).trim(),
      combined: String(
        driver.selectedMissionIdCombined
        || driver.promotionRuleIdCombined
        || driver.promotionSelectorCombined
        || resolveLegacyMissionIdForPlatform(driver, 'combined')
        || ''
      ).trim()
    };
  }

  function normalizeAssignmentDraft(draft = {}) {
    const baemin = String(draft.baemin ?? '').trim();
    const coupang = String(draft.coupang ?? '').trim();
    const combined = String(draft.combined ?? '').trim();

    // 합산 미션이 있으면 플랫폼별 개별 미션은 비운다.
    if (combined) {
      return { baemin: '', coupang: '', combined };
    }
    // 배민·쿠팡을 따로 쓰면 합산 미션은 비운다.
    if (baemin || coupang) {
      return { baemin, coupang, combined: '' };
    }
    return { baemin: '', coupang: '', combined: '' };
  }

  function buildAssignmentPatch(draft) {
    const normalized = normalizeAssignmentDraft(draft);
    const baemin = normalized.baemin;
    const coupang = normalized.coupang;
    const combined = normalized.combined;
    const changes = {
      selectedMissionIdBaemin: baemin,
      promotionRuleIdBaemin: baemin,
      promotionSelectorBaemin: baemin,
      selectedMissionIdCoupang: coupang,
      promotionRuleIdCoupang: coupang,
      promotionSelectorCoupang: coupang,
      selectedMissionIdCombined: combined,
      promotionRuleIdCombined: combined,
      promotionSelectorCombined: combined
    };
    if (combined) changes.selectedMissionId = combined;
    else if (baemin && coupang && baemin === coupang) changes.selectedMissionId = baemin;
    else if (baemin && !coupang) changes.selectedMissionId = baemin;
    else if (!baemin && coupang) changes.selectedMissionId = coupang;
    else changes.selectedMissionId = '';
    return changes;
  }

  return {
    getAll,
    getById,
    getForPlatform,
    getDriverAssignment,
    normalizeAssignmentDraft,
    buildAssignmentPatch,
    promotionToMissionItem
  };
})();
