/** 배민 API raw item → 집계 필드 추출 */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function readMetricBlock(block) {
  if (!block || typeof block !== 'object') {
    return { food: 0, bmart: 0, store: 0, total: 0 };
  }
  const food = num(block.food ?? block.foodComplete ?? block.foodCount);
  const bmart = num(block.bmart ?? block.bmartComplete ?? block.bmartCount);
  const store = num(block.store ?? block.storeComplete ?? block.baeminStore ?? block.storeCount);
  const total = num(
    block.total
    ?? block.totalComplete
    ?? block.sum
    ?? block.totalCount
  );
  return {
    food,
    bmart,
    store,
    total: total || (food + bmart + store)
  };
}

function pickPeakCounts(item, prefix = 'deliveryPeakTimeCount') {
  const peak = item?.[prefix] || item?.deliveryPeakTimeCount || {};
  return {
    morning: num(peak.morning),
    afternoon: num(peak.afternoon),
    evening: num(peak.evening),
    midnight: num(peak.midnight)
  };
}

function pickAcceptance(item) {
  const acc = item?.deliveryAcceptanceCount || item?.acceptanceCount || {};
  const riderFaultBlock = item?.deliveryCancelRiderFaultCount
    || item?.deliveryRiderFaultCount
    || item?.deliveryAcceptanceRiderFaultCount
    || item?.deliveryCancelByRiderFaultCount
    || item?.riderFaultCount
    || item?.deliveryRiderCancelCount
    || acc?.deliveryCancelRiderFaultCount
    || acc?.deliveryRiderFaultCount
    || {};

  const cancelBlock = item?.deliveryCancelCount
    || item?.deliveryDispatchCancelCount
    || item?.deliveryAcceptanceCancelCount
    || {};

  const riderFaultParts = readMetricBlock({
    food: acc.foodRiderFault
      ?? acc.foodCancelRiderFault
      ?? acc.foodDeliveryCancelRiderFault
      ?? riderFaultBlock.food
      ?? riderFaultBlock.foodRiderFault,
    bmart: acc.bmartRiderFault
      ?? acc.bmartCancelRiderFault
      ?? acc.bmartDeliveryCancelRiderFault
      ?? riderFaultBlock.bmart
      ?? riderFaultBlock.bmartRiderFault,
    store: acc.storeRiderFault
      ?? acc.storeCancelRiderFault
      ?? acc.storeDeliveryCancelRiderFault
      ?? riderFaultBlock.store
      ?? riderFaultBlock.storeRiderFault
      ?? riderFaultBlock.baeminStore,
    total: acc.totalRiderFault
      ?? acc.riderFault
      ?? acc.totalDeliveryCancelRiderFault
      ?? acc.deliveryCancelRiderFault
      ?? riderFaultBlock.total
      ?? riderFaultBlock.totalRiderFault
      ?? riderFaultBlock.sum
      ?? item?.totalRiderFault
      ?? item?.riderFault
  });

  const cancelParts = readMetricBlock({
    food: acc.foodCancel ?? cancelBlock.food ?? cancelBlock.foodCancel,
    bmart: acc.bmartCancel ?? cancelBlock.bmart ?? cancelBlock.bmartCancel,
    store: acc.storeCancel ?? cancelBlock.store ?? cancelBlock.storeCancel ?? cancelBlock.baeminStore,
    total: acc.totalCancel ?? acc.cancel ?? acc.totalDispatchCancel ?? cancelBlock.total ?? cancelBlock.totalCancel
  });

  const foodReject = num(acc.foodReject);
  const bmartReject = num(acc.bmartReject);
  const storeReject = num(acc.storeReject);
  const totalReject = num(acc.totalReject) || (foodReject + bmartReject + storeReject);

  return {
    completeTotal: num(acc.totalComplete),
    rejectTotal: totalReject,
    cancelTotal: cancelParts.total,
    foodComplete: num(acc.foodComplete),
    bmartComplete: num(acc.bmartComplete),
    storeComplete: num(acc.storeComplete),
    foodReject,
    bmartReject,
    storeReject,
    foodCancel: cancelParts.food,
    bmartCancel: cancelParts.bmart,
    storeCancel: cancelParts.store,
    foodRiderFault: riderFaultParts.food,
    bmartRiderFault: riderFaultParts.bmart,
    storeRiderFault: riderFaultParts.store,
    riderFault: riderFaultParts.total
  };
}

function extractStatsFromItem(item, collectDate = '') {
  const acceptance = pickAcceptance(item);
  const completePeak = pickPeakCounts(item, 'deliveryPeakTimeCount');
  const rejectPeak = pickPeakCounts(item, 'deliveryPeakTimeRejectCount');
  const cancelPeak = pickPeakCounts(item, 'deliveryPeakTimeCancelCount');

  return {
    riderName: String(item?.name || item?.riderName || '').trim(),
    riderUserId: String(item?.userId || item?.riderId || '').trim(),
    phoneNumber: String(item?.phoneNumber || item?.phone || '').trim(),
    statusCode: String(item?.status?.code ?? item?.statusCode ?? '').trim(),
    statusDesc: String(item?.status?.desc ?? item?.statusDesc ?? '').trim(),
    deliveryDate: String(item?.deliveryDate || item?.date || collectDate).slice(0, 10),
    ...acceptance,
    completeMorning: completePeak.morning,
    completeAfternoon: completePeak.afternoon,
    completeEvening: completePeak.evening,
    completeMidnight: completePeak.midnight,
    rejectMorning: rejectPeak.morning,
    rejectAfternoon: rejectPeak.afternoon,
    rejectEvening: rejectPeak.evening,
    rejectMidnight: rejectPeak.midnight,
    cancelMorning: cancelPeak.morning,
    cancelAfternoon: cancelPeak.afternoon,
    cancelEvening: cancelPeak.evening,
    cancelMidnight: cancelPeak.midnight,
    hourlyCompleted: Array.isArray(item?.hourlyCompleted) ? item.hourlyCompleted : []
  };
}

function sumStats(rows) {
  const totals = {
    completeTotal: 0,
    rejectTotal: 0,
    cancelTotal: 0,
    riderFaultTotal: 0,
    completeMorning: 0,
    completeAfternoon: 0,
    completeEvening: 0,
    completeMidnight: 0,
    rejectMorning: 0,
    rejectAfternoon: 0,
    rejectEvening: 0,
    rejectMidnight: 0,
    cancelMorning: 0,
    cancelAfternoon: 0,
    cancelEvening: 0,
    cancelMidnight: 0,
    riderCount: 0,
    dayCount: 0
  };

  const riderIds = new Set();
  const days = new Set();

  rows.forEach(row => {
    totals.completeTotal += num(row.completeTotal);
    totals.rejectTotal += num(row.rejectTotal);
    totals.cancelTotal += num(row.cancelTotal);
    totals.riderFaultTotal += num(row.riderFault);
    totals.completeMorning += num(row.completeMorning);
    totals.completeAfternoon += num(row.completeAfternoon);
    totals.completeEvening += num(row.completeEvening);
    totals.completeMidnight += num(row.completeMidnight);
    totals.rejectMorning += num(row.rejectMorning);
    totals.rejectAfternoon += num(row.rejectAfternoon);
    totals.rejectEvening += num(row.rejectEvening);
    totals.rejectMidnight += num(row.rejectMidnight);
    totals.cancelMorning += num(row.cancelMorning);
    totals.cancelAfternoon += num(row.cancelAfternoon);
    totals.cancelEvening += num(row.cancelEvening);
    totals.cancelMidnight += num(row.cancelMidnight);
    if (row.riderUserId) riderIds.add(row.riderUserId);
    if (row.deliveryDate) days.add(row.deliveryDate);
  });

  totals.riderCount = riderIds.size;
  totals.dayCount = days.size;
  return totals;
}

function mapToDeliveryStatusRow(stats, weekStart, collectedAt, sourceUrl, dedupeKey) {
  return {
    week_start: weekStart,
    collected_at: collectedAt,
    source_url: sourceUrl || '',
    dedupe_key: dedupeKey,
    rider_name: stats.riderName,
    rider_user_id: stats.riderUserId,
    phone_number: stats.phoneNumber,
    complete_total: stats.completeTotal,
    reject_total: stats.rejectTotal,
    cancel_total: stats.cancelTotal,
    complete_morning: stats.completeMorning,
    complete_afternoon: stats.completeAfternoon,
    complete_evening: stats.completeEvening,
    complete_midnight: stats.completeMidnight,
    reject_morning: stats.rejectMorning,
    reject_afternoon: stats.rejectAfternoon,
    reject_evening: stats.rejectEvening,
    reject_midnight: stats.rejectMidnight,
    cancel_morning: stats.cancelMorning,
    cancel_afternoon: stats.cancelAfternoon,
    cancel_evening: stats.cancelEvening,
    cancel_midnight: stats.cancelMidnight,
    raw_json: stats
  };
}

function serviceBreakdownFromStats(stats) {
  const s = stats || {};
  return {
    foodReject: num(s.foodReject),
    bmartReject: num(s.bmartReject),
    storeReject: num(s.storeReject),
    totalReject: num(s.rejectTotal ?? s.totalReject),
    foodCancel: num(s.foodCancel),
    bmartCancel: num(s.bmartCancel),
    storeCancel: num(s.storeCancel),
    cancelCount: num(s.cancelTotal ?? s.cancelCount),
    foodRiderFault: num(s.foodRiderFault),
    bmartRiderFault: num(s.bmartRiderFault),
    storeRiderFault: num(s.storeRiderFault),
    riderFault: num(s.riderFault ?? s.totalRiderFault)
  };
}

function mapToDailyStatsRow(stats, weekStart, collectedAt, sourceUrl, dedupeKey) {
  return {
    week_start: weekStart,
    delivery_date: stats.deliveryDate,
    collected_at: collectedAt,
    source_url: sourceUrl || '',
    dedupe_key: dedupeKey,
    complete_total: stats.completeTotal,
    reject_total: stats.rejectTotal,
    cancel_total: stats.cancelTotal,
    complete_morning: stats.completeMorning,
    complete_afternoon: stats.completeAfternoon,
    complete_evening: stats.completeEvening,
    complete_midnight: stats.completeMidnight,
    reject_morning: stats.rejectMorning,
    reject_afternoon: stats.rejectAfternoon,
    reject_evening: stats.rejectEvening,
    reject_midnight: stats.rejectMidnight,
    cancel_morning: stats.cancelMorning,
    cancel_afternoon: stats.cancelAfternoon,
    cancel_evening: stats.cancelEvening,
    cancel_midnight: stats.cancelMidnight,
    raw_json: stats
  };
}

function mapToRiderStatsRow(stats, weekStart, collectedAt, sourceUrl, dedupeKey) {
  return {
    week_start: weekStart,
    collected_at: collectedAt,
    source_url: sourceUrl || '',
    dedupe_key: dedupeKey,
    rider_name: stats.riderName,
    rider_user_id: stats.riderUserId,
    phone_number: stats.phoneNumber,
    complete_total: stats.completeTotal,
    reject_total: stats.rejectTotal,
    cancel_total: stats.cancelTotal,
    complete_morning: stats.completeMorning,
    complete_afternoon: stats.completeAfternoon,
    complete_evening: stats.completeEvening,
    complete_midnight: stats.completeMidnight,
    reject_morning: stats.rejectMorning,
    reject_afternoon: stats.rejectAfternoon,
    reject_evening: stats.rejectEvening,
    reject_midnight: stats.rejectMidnight,
    cancel_morning: stats.cancelMorning,
    cancel_afternoon: stats.cancelAfternoon,
    cancel_evening: stats.cancelEvening,
    cancel_midnight: stats.cancelMidnight,
    raw_json: stats
  };
}

module.exports = {
  pickAcceptance,
  extractStatsFromItem,
  sumStats,
  serviceBreakdownFromStats,
  mapToDeliveryStatusRow,
  mapToDailyStatsRow,
  mapToRiderStatsRow
};
