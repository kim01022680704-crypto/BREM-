/**
 * localStorage 객체 ↔ Supabase row 변환
 */
window.BremSupabaseMapper = (function () {
  function parseUuid(value) {
    const text = String(value || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
      ? text
      : null;
  }

  function toDate(value) {
    const text = String(value || '').slice(0, 10);
    return text || null;
  }

  function toIso(value) {
    if (!value) return new Date().toISOString();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function slugifyRegion(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9가-힣-]/g, '');
  }

  function makeRiderLoginId(driver) {
    const name = String(driver?.name || '').replace(/\s/g, '');
    const phone = String(driver?.phone || '').replace(/[^0-9]/g, '');
    return `${name}${phone.slice(-4)}`;
  }

  function riderToRow(driver) {
    const id = parseUuid(driver.id) || driver.id;
    return {
      id,
      name: driver.name,
      phone: driver.phone,
      resident_number: String(driver.residentNumber || ''),
      password: String(driver.password || '1234'),
      bank_name: String(driver.bankName || ''),
      account_holder: String(driver.accountHolder || ''),
      account_number: String(driver.accountNumber || ''),
      baemin_id: String(driver.baeminId || ''),
      platform_coupang: driver.platformCoupang !== false,
      platform_baemin: Boolean(driver.platformBaemin),
      long_event_item_id: String(driver.longEventItemId || ''),
      long_event_item: String(driver.longEventItem || ''),
      long_event_start_date: toDate(driver.longEventStartDate),
      join_date: toDate(driver.joinDate),
      status: String(driver.status || '근무중'),
      memo: String(driver.memo || ''),
      hidden_fields: driver.hiddenFields || {},
      promotion_selector_coupang: String(driver.promotionSelectorCoupang || ''),
      promotion_selector_baemin: String(driver.promotionSelectorBaemin || ''),
      promotion_rule_id_coupang: String(driver.promotionRuleIdCoupang || ''),
      promotion_rule_id_baemin: String(driver.promotionRuleIdBaemin || ''),
      created_at: toIso(driver.createdAt),
      updated_at: toIso(driver.updatedAt)
    };
  }

  function rowToRider(row) {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      residentNumber: row.resident_number || '',
      password: row.password || '1234',
      bankName: row.bank_name || '',
      accountHolder: row.account_holder || '',
      accountNumber: row.account_number || '',
      baeminId: row.baemin_id || '',
      platformCoupang: row.platform_coupang !== false,
      platformBaemin: Boolean(row.platform_baemin),
      longEventItemId: row.long_event_item_id || '',
      longEventItem: row.long_event_item || '',
      longEventStartDate: row.long_event_start_date || '',
      joinDate: row.join_date || '',
      status: row.status || '근무중',
      memo: row.memo || '',
      hiddenFields: row.hidden_fields || {},
      promotionSelectorCoupang: row.promotion_selector_coupang || '',
      promotionSelectorBaemin: row.promotion_selector_baemin || '',
      promotionRuleIdCoupang: row.promotion_rule_id_coupang || '',
      promotionRuleIdBaemin: row.promotion_rule_id_baemin || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function promotionToRows(rule) {
    const promotionId = parseUuid(rule.id) || rule.id;
    const promotion = {
      id: promotionId,
      name: rule.name,
      type: rule.type,
      platform: rule.platform,
      enabled: rule.enabled !== false,
      selector_key: rule.selectorKey || '',
      start_date: toDate(rule.startDate),
      end_date: toDate(rule.endDate),
      base: rule.base || {},
      priority: Number(rule.priority ?? 100),
      allow_duplicate: Boolean(rule.allowDuplicate),
      duplicate_strategy: rule.duplicateStrategy || 'highest_priority',
      apply_global_accept_block: rule.applyGlobalAcceptBlock !== false,
      no_pay_conditions: rule.noPayConditions || '',
      created_at: toIso(rule.createdAt),
      updated_at: toIso(rule.updatedAt)
    };

    const detailRules = [];
    ['blockConditions', 'bonusConditions', 'referenceConditions'].forEach(kindKey => {
      const kind = kindKey.replace('Conditions', '');
      (rule[kindKey] || []).forEach((condition, index) => {
        detailRules.push({
          promotion_id: promotionId,
          kind,
          condition_name: condition.conditionName || '',
          condition_type: condition.conditionType || '',
          processing_mode: condition.processingMode || kind,
          payload: condition,
          sort_order: index
        });
      });
    });

    return { promotion, detailRules };
  }

  function rowsToPromotion(promotion, detailRules) {
    const blockConditions = [];
    const bonusConditions = [];
    const referenceConditions = [];
    (detailRules || []).sort((a, b) => a.sort_order - b.sort_order).forEach(row => {
      const condition = row.payload || {};
      if (row.kind === 'block') blockConditions.push(condition);
      else if (row.kind === 'bonus') bonusConditions.push(condition);
      else referenceConditions.push(condition);
    });

    const base = promotion.base || {};
    return {
      id: promotion.id,
      name: promotion.name,
      type: promotion.type,
      platform: promotion.platform,
      enabled: promotion.enabled !== false,
      selectorKey: promotion.selector_key || '',
      startDate: promotion.start_date || '',
      endDate: promotion.end_date || '',
      base,
      blockConditions,
      bonusConditions,
      referenceConditions,
      baseCallCount: base.baseCallCount,
      payStartCallCount: base.payStartCallCount,
      payPerCall: base.payPerCall,
      guaranteedUnitPrice: base.guaranteedUnitPrice,
      callTiers: base.callTiers || [],
      applyGlobalAcceptBlock: promotion.apply_global_accept_block !== false,
      priority: promotion.priority,
      allowDuplicate: promotion.allow_duplicate,
      duplicateStrategy: promotion.duplicate_strategy,
      noPayConditions: promotion.no_pay_conditions || '',
      createdAt: promotion.created_at,
      updatedAt: promotion.updated_at
    };
  }

  function weeklySettlementToRows(record, regionIdMap) {
    const id = parseUuid(record.id) || record.id;
    const regionName = String(record.region || '').trim();
    const header = {
      id,
      platform: record.platform,
      region_id: regionIdMap.get(`${record.platform}:${regionName}`) || null,
      region_name: regionName,
      file_name: record.fileName || '',
      base_settlement_date: toDate(record.baseSettlementDate),
      start_date: toDate(record.startDate),
      end_date: toDate(record.endDate),
      payment_date: toDate(record.paymentDate),
      settlement_week_label: record.settlementWeekLabel || '',
      matched_names_label: record.matchedNamesLabel || '',
      summary: record.summary || {},
      uploaded_at: toIso(record.uploadedAt),
      created_at: toIso(record.uploadedAt),
      updated_at: toIso(record.uploadedAt)
    };

    const riders = (record.riders || []).map((rider, index) => ({
      weekly_settlement_id: id,
      rider_id: parseUuid(rider.matchedRiderId) || rider.matchedRiderId || null,
      original_name: rider.originalName || '',
      rider_name: rider.riderName || '',
      driver_name: rider.driverName || '',
      matched: Boolean(rider.matched || rider.matchedRiderId),
      weekly_order_count: Number(rider.weeklyOrderCount || 0),
      system_call_count: Number(rider.systemCallCount || 0),
      call_count_matched: rider.callCountMatched !== false,
      coupang_login_key: rider.coupangLoginKey || '',
      baemin_user_id: rider.baeminUserId || '',
      warnings: rider.warnings || [],
      sort_order: index
    }));

    return { header, riders };
  }

  function rowsToWeeklySettlement(header, riderRows) {
    return {
      id: header.id,
      platform: header.platform,
      region: header.region_name || '',
      fileName: header.file_name || '',
      baseSettlementDate: header.base_settlement_date || '',
      startDate: header.start_date || '',
      endDate: header.end_date || '',
      paymentDate: header.payment_date || '',
      settlementWeekLabel: header.settlement_week_label || '',
      uploadedAt: header.uploaded_at,
      matchedNamesLabel: header.matched_names_label || '',
      summary: header.summary || {},
      riders: (riderRows || [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(row => ({
          originalName: row.original_name || '',
          riderName: row.rider_name || '',
          driverName: row.driver_name || '',
          matchedRiderId: row.rider_id || '',
          matched: row.matched,
          weeklyOrderCount: row.weekly_order_count,
          systemCallCount: row.system_call_count,
          callCountMatched: row.call_count_matched,
          coupangLoginKey: row.coupang_login_key || '',
          baeminUserId: row.baemin_user_id || '',
          warnings: row.warnings || []
        }))
    };
  }

  function mappingToRow(mapping) {
    return {
      id: parseUuid(mapping.id) || mapping.id,
      platform: mapping.platform,
      original_name: mapping.originalName,
      rider_id: parseUuid(mapping.driverId) || mapping.driverId || null,
      driver_name: mapping.driverName || '',
      updated_at: toIso(mapping.updatedAt),
      created_at: toIso(mapping.updatedAt)
    };
  }

  function rowToMapping(row) {
    return {
      id: row.id,
      platform: row.platform,
      originalName: row.original_name,
      driverId: row.rider_id || '',
      driverName: row.driver_name || '',
      updatedAt: row.updated_at
    };
  }

  function noticeToRow(notice) {
    return {
      id: parseUuid(notice.id) || notice.id,
      title: notice.title,
      content: notice.content,
      pinned: Boolean(notice.pinned),
      created_at: toIso(notice.createdAt),
      updated_at: toIso(notice.updatedAt || notice.createdAt)
    };
  }

  function rowToNotice(row) {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      pinned: Boolean(row.pinned),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function riderToUserRow(driver) {
    return {
      role: 'rider',
      rider_id: parseUuid(driver.id) || driver.id,
      login_id: makeRiderLoginId(driver),
      password_hash: String(driver.password || '1234'),
      display_name: driver.name,
      active: driver.status !== '퇴사'
    };
  }

  return {
    parseUuid,
    slugifyRegion,
    makeRiderLoginId,
    riderToRow,
    rowToRider,
    promotionToRows,
    rowsToPromotion,
    weeklySettlementToRows,
    rowsToWeeklySettlement,
    mappingToRow,
    rowToMapping,
    noticeToRow,
    rowToNotice,
    riderToUserRow
  };
})();
