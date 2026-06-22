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
      name: String(driver.name || '').trim(),
      phone: String(driver.phone || '').trim(),
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
      long_event_platform: String(driver.longEventPlatform || 'coupang') === 'baemin' ? 'baemin' : 'coupang',
      join_date: toDate(driver.joinDate),
      status: String(driver.status || '근무중'),
      memo: String(driver.memo || ''),
      hidden_fields: driver.hiddenFields || {},
      promotion_selector_coupang: String(driver.promotionSelectorCoupang || ''),
      promotion_selector_baemin: String(driver.promotionSelectorBaemin || ''),
    promotion_rule_id_coupang: String(driver.promotionRuleIdCoupang || ''),
    promotion_rule_id_baemin: String(driver.promotionRuleIdBaemin || ''),
    selected_mission_id: String(driver.selectedMissionId || driver.selectedMissionIdBaemin || driver.selectedMissionIdCoupang || ''),
    selected_mission_id_baemin: String(driver.selectedMissionIdBaemin || driver.selectedMissionId || ''),
    selected_mission_id_coupang: String(driver.selectedMissionIdCoupang || driver.selectedMissionId || ''),
    raw_data: driver || {},
      created_at: toIso(driver.createdAt),
      updated_at: toIso(driver.updatedAt)
    };
  }

  function rowToRider(row) {
    const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
    return {
      id: row.id,
      authUserId: row.auth_user_id || '',
      name: row.name,
      phone: row.phone,
      residentNumber: row.resident_number || raw.residentNumber || '',
      password: String(raw.password ?? '').trim() || '1234',
      bankName: row.bank_name || '',
      accountHolder: row.account_holder || '',
      accountNumber: row.account_number || '',
      baeminId: row.baemin_id || '',
      platformCoupang: row.platform_coupang !== false,
      platformBaemin: Boolean(row.platform_baemin),
      longEventItemId: row.long_event_item_id || '',
      longEventItem: row.long_event_item || '',
      longEventStartDate: row.long_event_start_date || '',
      longEventPlatform: String(row.long_event_platform || raw.longEventPlatform || 'coupang') === 'baemin'
        ? 'baemin'
        : 'coupang',
      joinDate: row.join_date || raw.joinDate || '',
      status: row.status || '근무중',
      memo: row.memo || '',
      hiddenFields: row.hidden_fields || {},
      promotionSelectorCoupang: row.promotion_selector_coupang || '',
      promotionSelectorBaemin: row.promotion_selector_baemin || '',
      promotionRuleIdCoupang: row.promotion_rule_id_coupang || '',
      promotionRuleIdBaemin: row.promotion_rule_id_baemin || '',
      selectedMissionId: row.selected_mission_id || row.selected_mission_id_baemin || row.selected_mission_id_coupang || '',
      selectedMissionIdBaemin: row.selected_mission_id_baemin || row.selected_mission_id || '',
      selectedMissionIdCoupang: row.selected_mission_id_coupang || row.selected_mission_id || '',
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

  function dailySettlementToRow(item) {
    return {
      id: String(item.id || ''),
      driver_id: String(item.driverId || ''),
      period: toDate(item.period),
      platform: String(item.platform || 'coupang'),
      rider_id: String(item.riderId || ''),
      order_count: Number(item.orderCount ?? item.callCount ?? 0),
      delivery_amount: Number(item.deliveryAmount ?? item.settlementAmount ?? 0),
      settlement_amount: Number(item.settlementAmount ?? item.deliveryAmount ?? 0),
      applied_at: toIso(item.appliedAt),
      updated_at: toIso(item.appliedAt)
    };
  }

  function rowToDailySettlement(row) {
    return {
      id: row.id,
      driverId: row.driver_id || '',
      period: row.period || '',
      platform: row.platform || 'coupang',
      riderId: row.rider_id || '',
      orderCount: Number(row.order_count || 0),
      deliveryAmount: Number(row.delivery_amount ?? row.settlement_amount ?? 0),
      settlementAmount: Number(row.settlement_amount ?? row.delivery_amount ?? 0),
      appliedAt: row.applied_at
    };
  }

  function weeklySettlementRecordToRow(record) {
    return {
      id: String(record.id || ''),
      platform: String(record.platform || 'coupang'),
      region: String(record.region || ''),
      file_name: String(record.fileName || ''),
      base_settlement_date: toDate(record.baseSettlementDate),
      start_date: toDate(record.startDate),
      end_date: toDate(record.endDate),
      payment_date: toDate(record.paymentDate),
      settlement_week_label: String(record.settlementWeekLabel || ''),
      matched_names_label: String(record.matchedNamesLabel || ''),
      summary: record.summary && typeof record.summary === 'object' ? record.summary : {},
      riders: Array.isArray(record.riders) ? record.riders : [],
      uploaded_at: toIso(record.uploadedAt),
      updated_at: toIso(record.uploadedAt)
    };
  }

  function rowToWeeklySettlementRecord(row) {
    return {
      id: row.id,
      platform: row.platform || 'coupang',
      region: row.region || '',
      fileName: row.file_name || '',
      baseSettlementDate: row.base_settlement_date || '',
      startDate: row.start_date || '',
      endDate: row.end_date || '',
      paymentDate: row.payment_date || '',
      settlementWeekLabel: row.settlement_week_label || '',
      matchedNamesLabel: row.matched_names_label || '',
      summary: row.summary && typeof row.summary === 'object' ? row.summary : {},
      riders: Array.isArray(row.riders) ? row.riders : [],
      uploadedAt: row.uploaded_at
    };
  }

  function settlementUploadLogToRow(entry) {
    return {
      id: String(entry.id || ''),
      kind: entry.kind === 'weekly' ? 'weekly' : 'daily',
      platform: String(entry.platform || 'coupang'),
      file_name: String(entry.fileName || ''),
      period: toDate(entry.period || entry.startDate),
      week_start: toDate(entry.weekStart),
      week_end: toDate(entry.weekEnd),
      region: String(entry.region || ''),
      start_date: toDate(entry.startDate || entry.period),
      end_date: toDate(entry.endDate),
      status: String(entry.status || 'uploaded'),
      matched_count: Number(entry.matchedCount || 0),
      unmatched_count: Number(entry.unmatchedCount || 0),
      total_delivery_amount: Number(entry.totalDeliveryAmount || 0),
      total_order_count: Number(entry.totalOrderCount || 0),
      content_hash: String(entry.contentHash || ''),
      matched_records: Array.isArray(entry.matchedRecords) ? entry.matchedRecords : [],
      unmatched_records: Array.isArray(entry.unmatchedRecords) ? entry.unmatchedRecords : [],
      applied_records: Array.isArray(entry.appliedRecords) ? entry.appliedRecords : [],
      duplicate_of_log_id: String(entry.duplicateOfLogId || ''),
      skip_reason: String(entry.skipReason || ''),
      linked_record_id: String(entry.linkedRecordId || ''),
      uploaded_at: toIso(entry.uploadedAt),
      applied_at: entry.appliedAt ? toIso(entry.appliedAt) : null,
      updated_at: toIso(entry.updatedAt || entry.uploadedAt)
    };
  }

  function rowToSettlementUploadLog(row) {
    return {
      id: row.id,
      kind: row.kind === 'weekly' ? 'weekly' : 'daily',
      platform: row.platform || 'coupang',
      fileName: row.file_name || '',
      period: row.period || row.start_date || '',
      weekStart: row.week_start || '',
      weekEnd: row.week_end || '',
      region: row.region || '',
      startDate: row.start_date || row.period || '',
      endDate: row.end_date || '',
      status: row.status || 'uploaded',
      matchedCount: Number(row.matched_count || 0),
      unmatchedCount: Number(row.unmatched_count || 0),
      totalDeliveryAmount: Number(row.total_delivery_amount || 0),
      totalOrderCount: Number(row.total_order_count || 0),
      contentHash: row.content_hash || '',
      matchedRecords: Array.isArray(row.matched_records) ? row.matched_records : [],
      unmatchedRecords: Array.isArray(row.unmatched_records) ? row.unmatched_records : [],
      appliedRecords: Array.isArray(row.applied_records) ? row.applied_records : [],
      duplicateOfLogId: row.duplicate_of_log_id || '',
      skipReason: row.skip_reason || '',
      linkedRecordId: row.linked_record_id || '',
      uploadedAt: row.uploaded_at,
      appliedAt: row.applied_at || '',
      updatedAt: row.updated_at || row.uploaded_at
    };
  }

  function settlementUnmatchedToRow(item) {
    return {
      id: String(item.id || ''),
      kind: item.kind === 'weekly' ? 'weekly' : 'daily',
      platform: String(item.platform || 'coupang'),
      week_start: toDate(item.weekStart || item.period),
      period: toDate(item.period),
      end_date: toDate(item.endDate),
      region: String(item.region || ''),
      raw_name: String(item.rawName || item.name || ''),
      name: String(item.name || item.rawName || ''),
      rider_id: String(item.riderId || ''),
      order_count: Number(item.orderCount ?? item.weeklyOrderCount ?? 0),
      delivery_amount: Number(item.deliveryAmount ?? 0),
      settlement_amount: Number(item.settlementAmount ?? 0),
      coupang_login_key: String(item.coupangLoginKey || ''),
      baemin_user_id: String(item.baeminUserId || ''),
      match_payload: item.matchPayload && typeof item.matchPayload === 'object' ? item.matchPayload : {},
      source_file_name: String(item.sourceFileName || ''),
      saved_at: toIso(item.savedAt),
      updated_at: toIso(item.savedAt)
    };
  }

  function rowToSettlementUnmatched(row) {
    return {
      id: row.id,
      kind: row.kind === 'weekly' ? 'weekly' : 'daily',
      platform: row.platform || 'coupang',
      weekStart: row.week_start || row.period || '',
      period: row.period || '',
      endDate: row.end_date || '',
      region: row.region || '',
      rawName: row.raw_name || row.name || '',
      name: row.name || row.raw_name || '',
      riderId: row.rider_id || '',
      orderCount: Number(row.order_count || 0),
      deliveryAmount: Number(row.delivery_amount || 0),
      settlementAmount: Number(row.settlement_amount || 0),
      coupangLoginKey: row.coupang_login_key || '',
      baeminUserId: row.baemin_user_id || '',
      matchPayload: row.match_payload && typeof row.match_payload === 'object' ? row.match_payload : {},
      sourceFileName: row.source_file_name || '',
      savedAt: row.saved_at
    };
  }

  function promotionApplyResultToRow(item) {
    const savedAt = toIso(item.savedAt);
    return {
      id: String(item.id || ''),
      platform: String(item.platform || ''),
      region: String(item.region || ''),
      settlement_kind: 'weekly',
      week_start: toDate(item.startDate),
      week_end: toDate(item.endDate),
      settlement_label: String(item.settlementLabel || ''),
      settlement_id: String(item.settlementId || ''),
      coupang_settlement_id: String(item.coupangSettlementId || ''),
      baemin_settlement_id: String(item.baeminSettlementId || ''),
      selected_rule_ids: Array.isArray(item.selectedPromotionRuleIds) ? item.selectedPromotionRuleIds : [],
      selected_rule_names: Array.isArray(item.selectedPromotionRuleNames) ? item.selectedPromotionRuleNames : [],
      summary: item.summary && typeof item.summary === 'object' ? item.summary : {},
      rows: Array.isArray(item.results) ? item.results : [],
      meta: {
        deliveryFeeFileName: String(item.deliveryFeeFileName || ''),
        deliveryFeeLabel: String(item.deliveryFeeLabel || ''),
        savedAt
      },
      published: false,
      created_at: savedAt,
      updated_at: new Date().toISOString()
    };
  }

  function rowToPromotionApplyResult(row) {
    const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
    return {
      id: row.id,
      platform: row.platform || '',
      region: row.region || '',
      startDate: row.week_start || '',
      endDate: row.week_end || '',
      settlementLabel: row.settlement_label || '',
      settlementId: row.settlement_id || '',
      coupangSettlementId: row.coupang_settlement_id || '',
      baeminSettlementId: row.baemin_settlement_id || '',
      selectedPromotionRuleIds: Array.isArray(row.selected_rule_ids) ? row.selected_rule_ids : [],
      selectedPromotionRuleNames: Array.isArray(row.selected_rule_names) ? row.selected_rule_names : [],
      deliveryFeeFileName: meta.deliveryFeeFileName || '',
      deliveryFeeLabel: meta.deliveryFeeLabel || '',
      savedAt: meta.savedAt || row.created_at || row.updated_at,
      results: Array.isArray(row.rows) ? row.rows : [],
      summary: row.summary && typeof row.summary === 'object' ? row.summary : {}
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

  function missionToRow(mission) {
    return {
      id: String(mission.id || ''),
      title: String(mission.title || ''),
      description: String(mission.description || ''),
      type: String(mission.type || ''),
      conditions: String(mission.conditions || ''),
      is_active: mission.isActive !== false,
      raw_data: mission || {},
      created_at: toIso(mission.createdAt),
      updated_at: toIso(mission.updatedAt || mission.createdAt)
    };
  }

  function rowToMission(row) {
    return {
      ...(row.raw_data || {}),
      id: row.id,
      title: row.raw_data?.title ?? row.title ?? '',
      description: row.raw_data?.description ?? row.description ?? '',
      type: row.raw_data?.type ?? row.type ?? '',
      conditions: row.raw_data?.conditions ?? row.conditions ?? '',
      isActive: row.raw_data?.isActive ?? row.is_active !== false,
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
    dailySettlementToRow,
    rowToDailySettlement,
    weeklySettlementRecordToRow,
    rowToWeeklySettlementRecord,
    settlementUploadLogToRow,
    rowToSettlementUploadLog,
    settlementUnmatchedToRow,
    rowToSettlementUnmatched,
    promotionApplyResultToRow,
    rowToPromotionApplyResult,
    mappingToRow,
    rowToMapping,
    noticeToRow,
    rowToNotice,
    inquiryToRow,
    rowToInquiry,
    missionToRow,
    rowToMission
  };
})();
