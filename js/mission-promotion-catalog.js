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
      // 미션관리 저장값(selectedMissionId*)을 우선. 없으면 프로모션 배정 레거시 필드.
      baemin: String(
        driver.selectedMissionIdBaemin
        || driver.promotionRuleIdBaemin
        || driver.promotionSelectorBaemin
        || ''
      ).trim(),
      coupang: String(
        driver.selectedMissionIdCoupang
        || driver.promotionRuleIdCoupang
        || driver.promotionSelectorCoupang
        || ''
      ).trim()
    };
  }

  function buildAssignmentPatch(draft) {
    const baemin = String(draft?.baemin || '').trim();
    const coupang = String(draft?.coupang || '').trim();
    const changes = {};
    if (draft?.baemin !== undefined) {
      // 미션관리·프로모션 적용이 같은 값을 보도록 관련 필드를 함께 맞춤
      changes.selectedMissionIdBaemin = baemin;
      changes.promotionRuleIdBaemin = baemin;
      changes.promotionSelectorBaemin = baemin;
    }
    if (draft?.coupang !== undefined) {
      changes.selectedMissionIdCoupang = coupang;
      changes.promotionRuleIdCoupang = coupang;
      changes.promotionSelectorCoupang = coupang;
    }
    if (draft?.baemin !== undefined || draft?.coupang !== undefined) {
      if (baemin && coupang && baemin === coupang) changes.selectedMissionId = baemin;
      else if (baemin && !coupang) changes.selectedMissionId = baemin;
      else if (!baemin && coupang) changes.selectedMissionId = coupang;
      else changes.selectedMissionId = '';
    }
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
