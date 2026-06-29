const { getServiceClient } = require('./admin-bootstrap');
const {
  extractStatsFromItem,
  mapToDeliveryStatusRow,
  mapToDailyStatsRow,
  mapToRiderStatsRow
} = require('./baemin-stats-extract');
const { buildDedupeKey } = require('./baemin-collect-sources');

async function upsertRows(table, rows, conflictKey, menuType = '') {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  if (!rows.length) return { ok: true, savedCount: 0, skipped: true };

  const map = new Map();
  rows.forEach(row => {
    const parts = String(conflictKey || '').split(',').map(key => row[key]);
    const key = parts.join('|');
    map.set(key, row);
  });
  const deduped = Array.from(map.values());
  if (menuType) {
    console.log(`[BREM][save] menu_type=${menuType} table=${table} rows=${deduped.length}`);
  }

  const chunkSize = 100;
  let savedCount = 0;
  for (let i = 0; i < deduped.length; i += chunkSize) {
    const chunk = deduped.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflictKey });
    if (error) {
      return { ok: false, status: 500, error: 'SUPABASE_SAVE_FAILED', message: error.message || String(error) };
    }
    savedCount += chunk.length;
  }
  return { ok: true, savedCount };
}

function buildStatsRows(sourceId, items, weekStart, collectedAt, sourceUrl, options = {}) {
  const partnerId = String(options.partnerId || '').trim();
  if (sourceId === 'delivery_status') {
    return items.map((item, index) => {
      const stats = extractStatsFromItem(item, weekStart);
      const dedupeKey = buildDedupeKey(sourceId, item, index, {
        partnerId,
        collectDate: weekStart
      });
      return mapToDeliveryStatusRow(stats, weekStart, collectedAt, sourceUrl, dedupeKey);
    });
  }

  if (sourceId === 'daily_history') {
    return items.map((item, index) => {
      const stats = extractStatsFromItem(item, weekStart);
      const dedupeKey = buildDedupeKey(sourceId, item, index, {
        partnerId,
        collectDate: weekStart,
        dateRange: options.dateRange,
        index
      });
      return mapToDailyStatsRow(stats, weekStart, collectedAt, sourceUrl, dedupeKey);
    });
  }

  if (sourceId === 'rider_history') {
    return items.map((item, index) => {
      const stats = extractStatsFromItem(item, weekStart);
      const dedupeKey = buildDedupeKey(sourceId, item, index, {
        partnerId,
        collectDate: weekStart,
        dateRange: options.dateRange,
        index
      });
      return mapToRiderStatsRow(stats, weekStart, collectedAt, sourceUrl, dedupeKey);
    });
  }

  return [];
}

async function saveStatsForSource(sourceId, items, weekStart, collectedAt, sourceUrl, options = {}) {
  if (sourceId === 'delivery_status') {
    const { saveRowsDirect } = require('./baemin-delivery-collect');
    return saveRowsDirect(items, weekStart);
  }

  const tableBySource = {
    daily_history: { table: 'baemin_daily_delivery_stats', conflict: 'week_start,delivery_date,dedupe_key', menuType: 'daily_history' },
    rider_history: { table: 'baemin_rider_delivery_stats', conflict: 'week_start,dedupe_key', menuType: 'rider_history' }
  };
  const target = tableBySource[sourceId];
  if (!target) return { ok: true, savedCount: 0, skipped: true };

  const rows = buildStatsRows(sourceId, items, weekStart, collectedAt, sourceUrl, options);
  return upsertRows(target.table, rows, target.conflict, target.menuType);
}

module.exports = {
  saveStatsForSource,
  buildStatsRows,
  upsertRows
};
