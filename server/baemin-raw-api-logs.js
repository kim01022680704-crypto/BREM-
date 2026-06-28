const crypto = require('crypto');
const { getServiceClient } = require('./admin-bootstrap');

function createCollectRunId() {
  return crypto.randomUUID();
}

function isMissingRawLogTableError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('baemin_raw_api_logs')
    || (message.includes('relation') && message.includes('does not exist'));
}

async function saveRawApiLog({
  collectDate,
  sourceMenu = '',
  sourceUrl = '',
  httpStatus = 0,
  rawJson = {},
  runId = null,
  pageIndex = null
}) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, skipped: true };

  const row = {
    collect_date: String(collectDate || new Date().toISOString().slice(0, 10)).slice(0, 10),
    collected_at: new Date().toISOString(),
    source_menu: String(sourceMenu || '').trim(),
    source_url: String(sourceUrl || '').trim(),
    http_status: Number(httpStatus || 0),
    run_id: runId || null,
    page_index: pageIndex == null ? null : Number(pageIndex),
    raw_json: rawJson && typeof rawJson === 'object' ? rawJson : { value: rawJson }
  };

  const { error } = await supabase.from('baemin_raw_api_logs').insert(row);
  if (error) {
    if (isMissingRawLogTableError(error)) {
      return { ok: false, tableMissing: true, error: error.message };
    }
    console.warn('[BREM][raw-api-log] save failed:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

module.exports = {
  createCollectRunId,
  saveRawApiLog,
  isMissingRawLogTableError
};
