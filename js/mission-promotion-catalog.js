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
    return getAll().filter(item => item.platform === p || item.platform === 'combined');
  }

  function getDriverAssignment(driver) {
    if (!driver) return { baemin: '', coupang: '' };
    return {
      baemin: String(
        driver.promotionRuleIdBaemin
        || driver.promotionSelectorBaemin
        || driver.selectedMissionIdBaemin
        || driver.selectedMissionId
        || ''
      ).trim(),
      coupang: String(
        driver.promotionRuleIdCoupang
        || driver.promotionSelectorCoupang
        || driver.selectedMissionIdCoupang
        || driver.selectedMissionId
        || ''
      ).trim()
    };
  }

  function buildAssignmentPatch(draft) {
    const baemin = String(draft?.baemin || '').trim();
    const coupang = String(draft?.coupang || '').trim();
    const changes = {};
    if (draft?.baemin !== undefined) {
      changes.promotionRuleIdBaemin = baemin;
      changes.promotionSelectorBaemin = baemin;
      changes.selectedMissionIdBaemin = baemin;
    }
    if (draft?.coupang !== undefined) {
      changes.promotionRuleIdCoupang = coupang;
      changes.promotionSelectorCoupang = coupang;
      changes.selectedMissionIdCoupang = coupang;
    }
    if (baemin && !coupang) changes.selectedMissionId = baemin;
    else if (coupang && !baemin) changes.selectedMissionId = coupang;
    else if (baemin === coupang && baemin) changes.selectedMissionId = baemin;
    return changes;
  }

  return {
    getAll,
    getById,
    getForPlatform,
    getDriverAssignment,
    buildAssignmentPatch,
    promotionToMissionItem
  };
})();
