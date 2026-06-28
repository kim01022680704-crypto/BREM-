function safeJsonStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (_, nested) => {
    if (typeof nested === 'object' && nested !== null) {
      if (seen.has(nested)) return '[Circular]';
      seen.add(nested);
    }
    return nested;
  });
}

function stringifyErrorValue(value, depth = 0) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) {
    const parts = [value.message, value.stack, value.name].filter(part => typeof part === 'string' && part.trim());
    if (parts.length) return parts.join(' | ');
  }

  if (typeof value.message === 'string' && value.message.trim()) return value.message;
  if (value.message != null && depth < 2) {
    const nested = stringifyErrorValue(value.message, depth + 1);
    if (nested && nested !== '[object Object]') return nested;
  }

  if (typeof value.error === 'string' && value.error.trim()) return value.error;
  if (value.error != null && depth < 2) {
    const nested = stringifyErrorValue(value.error, depth + 1);
    if (nested && nested !== '[object Object]') return nested;
  }

  if (typeof value.reason === 'string' && value.reason.trim()) return value.reason;
  if (value.reason != null && depth < 2) {
    const nested = stringifyErrorValue(value.reason, depth + 1);
    if (nested && nested !== '[object Object]') return nested;
  }

  try {
    const json = safeJsonStringify(value);
    if (json && json !== '{}' && json !== '[]') return json;
  } catch {
    // fall through
  }

  if (typeof value.code === 'string' && value.code.trim()) return value.code;
  if (typeof value.name === 'string' && value.name.trim()) return value.name;
  return 'unknown error';
}

function formatApiPayloadError(payload, status, responseText) {
  if (payload?.message) {
    const message = stringifyErrorValue(payload.message);
    if (message && message !== '[object Object]') return message;
  }
  if (payload?.error) {
    const error = stringifyErrorValue(payload.error);
    if (error && error !== '[object Object]') return error;
  }
  const text = String(responseText || '').trim();
  if (text) return text.slice(0, 800);
  return `HTTP ${status || 'unknown'}`;
}

function formatError(error, fallback = 'unknown error') {
  const text = stringifyErrorValue(error);
  if (!text || text === '[object Object]') return fallback;
  return text;
}

function migrationHintForError(message) {
  const text = String(message || '').toLowerCase();
  if (text.includes('baemin_biz_collect') && text.includes('does not exist')) {
    return ' Supabase SQL Editor에서 supabase/baemin_all_migrations.sql 실행이 필요합니다.';
  }
  if (text.includes('baemin_delivery_status') && text.includes('does not exist')) {
    return ' Supabase SQL Editor에서 supabase/baemin_all_migrations.sql 실행이 필요합니다.';
  }
  if (text.includes('table_missing') || text.includes('테이블이 없습니다')) {
    return ' Supabase SQL Editor에서 supabase/baemin_all_migrations.sql 실행이 필요합니다.';
  }
  return '';
}

module.exports = {
  safeJsonStringify,
  stringifyErrorValue,
  formatApiPayloadError,
  formatError,
  migrationHintForError
};
