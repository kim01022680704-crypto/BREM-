/**
 * localStorage 객체 ↔ Supabase row 변환
 */
window.BremSupabaseMapper = (function () {
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
    return {
      id: String(driver.id || ''),
      auth_user_id: driver.authUserId || null,
      name: driver.name,
      phone: driver.phone,
      resident_number: String(driver.residentNumber || ''),
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
      raw_data: driver || {},
      created_at: toIso(driver.createdAt),
      updated_at: toIso(driver.updatedAt)
    };
  }

  function rowToRider(row) {
    return {
      id: row.id,
      authUserId: row.auth_user_id || '',
      name: row.name,
      phone: row.phone,
      residentNumber: row.resident_number || '',
      password: '',
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

  function promotionToRow(rule) {
    return {
      id: String(rule.id || ''),
      name: String(rule.name || ''),
      type: String(rule.type || ''),
      platform: String(rule.platform || 'coupang'),
      enabled: rule.enabled !== false,
      selector_key: String(rule.selectorKey || ''),
      start_date: toDate(rule.startDate),
      end_date: toDate(rule.endDate),
      priority: Number(rule.priority ?? 100),
      payload: rule || {},
      created_at: toIso(rule.createdAt),
      updated_at: toIso(rule.updatedAt)
    };
  }

  function rowToPromotion(row) {
    return {
      ...(row.payload || {}),
      id: row.id,
      name: row.payload?.name ?? row.name,
      type: row.payload?.type ?? row.type,
      platform: row.payload?.platform ?? row.platform,
      enabled: row.payload?.enabled ?? row.enabled,
      selectorKey: row.payload?.selectorKey ?? row.selector_key ?? '',
      startDate: row.payload?.startDate ?? row.start_date ?? '',
      endDate: row.payload?.endDate ?? row.end_date ?? '',
      priority: row.payload?.priority ?? row.priority,
      createdAt: row.payload?.createdAt ?? row.created_at,
      updatedAt: row.payload?.updatedAt ?? row.updated_at
    };
  }

  function weeklySettlementToRows(record, regionIdMap) {
    const id = record.id;
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
      rider_id: rider.matchedRiderId || null,
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
      id: mapping.id,
      platform: mapping.platform,
      original_name: mapping.originalName,
      rider_id: mapping.driverId || null,
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
      id: String(notice.id || ''),
      title: notice.title,
      content: notice.content,
      pinned: Boolean(notice.pinned),
      raw_data: notice || {},
      created_at: toIso(notice.createdAt),
      updated_at: toIso(notice.updatedAt || notice.createdAt)
    };
  }

  function rowToNotice(row) {
    return {
      ...(row.raw_data || {}),
      id: row.id,
      title: row.raw_data?.title ?? row.title,
      content: row.raw_data?.content ?? row.content,
      pinned: row.raw_data?.pinned ?? Boolean(row.pinned),
      createdAt: row.raw_data?.createdAt ?? row.created_at,
      updatedAt: row.raw_data?.updatedAt ?? row.updated_at
    };
  }

  function inquiryToRow(inquiry) {
    return {
      id: String(inquiry.id || ''),
      name: String(inquiry.name || ''),
      phone: String(inquiry.phone || ''),
      area: String(inquiry.area || ''),
      inquiry_type: String(inquiry.inquiryType || inquiry.inquiry_type || ''),
      message: String(inquiry.message || ''),
      status: String(inquiry.status || 'new'),
      raw_data: inquiry || {},
      created_at: toIso(inquiry.createdAt),
      updated_at: toIso(inquiry.updatedAt || inquiry.createdAt)
    };
  }

  function rowToInquiry(row) {
    return {
      ...(row.raw_data || {}),
      id: row.id,
      name: row.raw_data?.name ?? row.name ?? '',
      phone: row.raw_data?.phone ?? row.phone ?? '',
      area: row.raw_data?.area ?? row.area ?? '',
      inquiryType: row.raw_data?.inquiryType ?? row.inquiry_type ?? '',
      message: row.raw_data?.message ?? row.message ?? '',
      status: row.raw_data?.status ?? row.status ?? 'new',
      createdAt: row.raw_data?.createdAt ?? row.created_at,
      updatedAt: row.raw_data?.updatedAt ?? row.updated_at
    };
  }

  return {
    slugifyRegion,
    makeRiderLoginId,
    riderToRow,
    rowToRider,
    promotionToRow,
    rowToPromotion,
    weeklySettlementToRows,
    rowsToWeeklySettlement,
    mappingToRow,
    rowToMapping,
    noticeToRow,
    rowToNotice,
    inquiryToRow,
    rowToInquiry
  };
})();
