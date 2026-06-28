function stringifyErrorValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) return value.stack || value.message || String(value);
  if (typeof value.message === 'string') return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatApiPayloadError(payload, status, responseText) {
  if (payload?.message) {
    const message = stringifyErrorValue(payload.message);
    if (message) return message;
  }
  if (payload?.error) {
    const error = stringifyErrorValue(payload.error);
    if (error) return error;
  }
  const text = String(responseText || '').trim();
  if (text) return text.slice(0, 800);
  return `HTTP ${status || 'unknown'}`;
}

function formatError(error, fallback = 'unknown error') {
  const text = stringifyErrorValue(error);
  return text || fallback;
}

function migrationHintForError(message) {
  const text = String(message || '').toLowerCase();
  if (text.includes('baemin_delivery_status') && text.includes('does not exist')) {
    return ' Supabase SQL Editor에서 supabase/baemin_delivery_status_migration.sql 실행이 필요합니다.';
  }
  if (text.includes('table_missing') || text.includes('테이블이 없습니다')) {
    return ' Supabase SQL Editor에서 supabase/baemin_delivery_status_migration.sql 실행이 필요합니다.';
  }
  return '';
}

module.exports = {
  stringifyErrorValue,
  formatApiPayloadError,
  formatError,
  migrationHintForError
};
