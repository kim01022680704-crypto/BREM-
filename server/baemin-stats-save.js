const { getServiceClient } = require('./admin-bootstrap');
const {
  extractStatsFromItem,
  mapToDeliveryStatusRow,
  mapToDailyStatsRow,
  mapToRiderStatsRow
} = require('./baemin-stats-extract');
const { buildDedupeKey } = require('./baemin-collect-sources');

async function upsertRows(table, rows, conflictKey) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  if (!rows.length) return { ok: true, savedCount: 0, skipped: true };

  const chunkSize = 100;
  let savedCount = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflictKey });
    if (error) {
      return { ok: false, status: 500, error: 'SUPABASE_SAVE_FAILED', message: error.message || String(error) };
    }
    savedCount += chunk.length;
  }
  return { ok: true, savedCount };
}

function buildStatsRows(sourceId, items, weekStart, collectedAt, sourceUrl) {
  if (sourceId === 'delivery_status') {
    return items.map((item, index) => {
      const stats = extractStatsFromItem(item, weekStart);
      const dedupeKey = buildDedupeKey(sourceId, item, index);
      return mapToDeliveryStatusRow(stats, weekStart, collectedAt, sourceUrl, dedupeKey);
    });
  }

  if (sourceId === 'daily_history') {
    return items.map((item, index) => {
      const stats = extractStatsFromItem(item, weekStart);
      const dedupeKey = buildDedupeKey(sourceId, item, index);
      return mapToDailyStatsRow(stats, weekStart, collectedAt, sourceUrl, dedupeKey);
    });
  }

  if (sourceId === 'rider_history') {
    return items.map((item, index) => {
      const stats = extractStatsFromItem(item, weekStart);
      const dedupeKey = buildDedupeKey(sourceId, item, index);
      return mapToRiderStatsRow(stats, weekStart, collectedAt, sourceUrl, dedupeKey);
    });
  }

  return [];
}

async function saveStatsForSource(sourceId, items, weekStart, collectedAt, sourceUrl) {
  if (sourceId === 'delivery_status') {
    const { mapItemToRow, saveRowsDirect } = require('./baemin-delivery-collect');
    const rows = items.map(item => mapItemToRow(item, weekStart)).filter(row => row.dedupe_key);
    if (!rows.length) return { ok: true, savedCount: 0, skipped: true };
    return saveRowsDirect(rows, weekStart);
  }

  const tableBySource = {
    daily_history: { table: 'baemin_daily_delivery_stats', conflict: 'week_start,delivery_date,dedupe_key' },
    rider_history: { table: 'baemin_rider_delivery_stats', conflict: 'week_start,dedupe_key' }
  };
  const target = tableBySource[sourceId];
  if (!target) return { ok: true, savedCount: 0, skipped: true };

  const rows = buildStatsRows(sourceId, items, weekStart, collectedAt, sourceUrl);
  return upsertRows(target.table, rows, target.conflict);
}

module.exports = {
  saveStatsForSource,
  buildStatsRows,
  upsertRows
};
