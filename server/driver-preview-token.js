const crypto = require('crypto');

const TTL_MS = 30 * 60 * 1000;

function secret() {
  const value = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!value) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.');
  }
  return value;
}

function issue(driverId) {
  const payload = {
    driverId: String(driverId || '').trim(),
    exp: Date.now() + TTL_MS
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `brempreview.${body}.${sig}`;
}

function read(token) {
  const raw = String(token || '').trim();
  if (!raw.startsWith('brempreview.')) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return { invalid: true };
  let expected = '';
  try {
    expected = crypto.createHmac('sha256', secret()).update(parts[1]).digest('base64url');
  } catch {
    return { invalid: true };
  }
  const actual = Buffer.from(parts[2]);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !crypto.timingSafeEqual(actual, wanted)) {
    return { invalid: true };
  }
  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return { invalid: true };
  }
  if (!payload?.driverId || Date.now() > Number(payload.exp || 0)) return { expired: true };
  return payload;
}

module.exports = { issue, read, TTL_MS };
