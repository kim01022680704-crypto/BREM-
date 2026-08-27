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

  function resolveLegacyMissionIdForPlatform(driver, platform, pick = resolveMissionIdForPlatform) {
    const legacy = String(driver?.selectedMissionId || '').trim();
    if (!legacy) return '';
    return pick(legacy, platform);
  }

  /** DB에 다른 플랫폼 미션 ID가 섞여 있으면 무시한다. (프로모션 적용용 strict) */
  function resolveMissionIdForPlatform(rawId, platform) {
    const id = String(rawId || '').trim();
    if (!id) return '';
    const rule = BremStorage?.promotionRules?.getById?.(id);
    if (!rule || rule.enabled === false) return '';
    if (normalizePlatform(rule.platform) !== normalizePlatform(platform)) return '';
    return id;
  }

  /** 미션관리 표시용: 규칙 캐시가 비어 있어도 DB/캐시에 있는 ID는 그대로 보여준다. */
  function resolveStoredMissionId(rawId, platform) {
    const id = String(rawId || '').trim();
    if (!id) return '';
    const rule = BremStorage?.promotionRules?.getById?.(id);
    if (!rule) return id;
    if (rule.enabled === false) return '';
    if (normalizePlatform(rule.platform) !== normalizePlatform(platform)) return '';
    return id;
  }

  /** 저장 시: 규칙 캐시가 비어 있어도 드롭다운에서 고른 ID는 유지, 플랫폼만 막는다. */
  function sanitizeMissionIdForSave(rawId, platform) {
    const id = String(rawId || '').trim();
    if (!id) return '';
    const rule = BremStorage?.promotionRules?.getById?.(id);
    if (!rule) return id;
    if (rule.enabled === false) return '';
    if (normalizePlatform(rule.platform) !== normalizePlatform(platform)) return '';
    return id;
  }

  function describeInvalidMissionFields(driver) {
    if (!driver) return [];
    const issues = [];
    const checks = [
      ['baemin', driver.selectedMissionIdBaemin || driver.promotionRuleIdBaemin || driver.promotionSelectorBaemin],
      ['coupang', driver.selectedMissionIdCoupang || driver.promotionRuleIdCoupang || driver.promotionSelectorCoupang],
      ['combined', driver.selectedMissionIdCombined || driver.promotionRuleIdCombined || driver.promotionSelectorCombined]
    ];
    checks.forEach(([platform, rawId]) => {
      const id = String(rawId || '').trim();
      if (!id) return;
      if (resolveMissionIdForPlatform(id, platform)) return;
      const rule = BremStorage?.promotionRules?.getById?.(id);
      if (!rule) {
        issues.push(`${BremPlatforms.label(platform)} 칸: 삭제된 프로모션 ID`);
      } else if (rule.enabled === false) {
        issues.push(`${BremPlatforms.label(platform)} 칸: 중지된 프로모션「${rule.name}」`);
      } else {
        issues.push(`${BremPlatforms.label(platform)} 칸: ${BremPlatforms.label(rule.platform)} 프로모션「${rule.name}」`);
      }
    });
    return issues;
  }

  function getDriverAssignment(driver, options = {}) {
    if (!driver) return { baemin: '', coupang: '', combined: '' };
    const pick = options.strict ? resolveMissionIdForPlatform : resolveStoredMissionId;
    const raw = {
      baemin: pick(
        driver.selectedMissionIdBaemin
        || driver.promotionRuleIdBaemin
        || driver.promotionSelectorBaemin
        || resolveLegacyMissionIdForPlatform(driver, 'baemin', pick),
        'baemin'
      ),
      coupang: pick(
        driver.selectedMissionIdCoupang
        || driver.promotionRuleIdCoupang
        || driver.promotionSelectorCoupang
        || resolveLegacyMissionIdForPlatform(driver, 'coupang', pick),
        'coupang'
      ),
      combined: pick(
        driver.selectedMissionIdCombined
        || driver.promotionRuleIdCombined
        || driver.promotionSelectorCombined
        || resolveLegacyMissionIdForPlatform(driver, 'combined', pick),
        'combined'
      )
    };
    return normalizeAssignmentDraft(raw);
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
    const normalized = normalizeAssignmentDraft({
      baemin: sanitizeMissionIdForSave(draft.baemin, 'baemin'),
      coupang: sanitizeMissionIdForSave(draft.coupang, 'coupang'),
      combined: sanitizeMissionIdForSave(draft.combined, 'combined')
    });
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
    describeInvalidMissionFields,
    resolveMissionIdForPlatform,
    resolveStoredMissionId,
    normalizeAssignmentDraft,
    buildAssignmentPatch,
    promotionToMissionItem
  };
})();
