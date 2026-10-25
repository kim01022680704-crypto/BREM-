const { createClient } = require('@supabase/supabase-js');
const {
  nowIso,
  isExpired,
  extraFromPayload,
  enrichRecord
} = require('./rider-inquiries-shared');

let client = null;

function getClient() {
  if (client) return client;

  const url = String(process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRoleKey) return null;

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return client;
}

function isEnabled() {
  return Boolean(getClient());
}

function createId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `inq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function rawObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return { ...value };
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') return { ...parsed };
    } catch {
      /* raw_data가 문자로 오면 답장이 빠지지 않게 한 번 더 읽는다 */
    }
  }
  return {};
}

function rowToRecord(row) {
  if (!row) return null;
  const raw = rawObject(row.raw_data);
  return enrichRecord({
    id: row.id,
    name: row.name || '',
    phone: row.phone || '',
    area: row.area || '',
    inquiryType: row.inquiry_type || raw.inquiryType || '라이더 지원',
    message: row.message || '',
    status: row.status || 'new',
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at
  }, raw);
}

const INQUIRY_SELECT = 'id,name,phone,area,inquiry_type,message,status,raw_data,created_at,updated_at';

async function purgeExpired() {
  const supabase = getClient();
  if (!supabase) return;
  const cutoff = new Date(Date.now() - require('./rider-inquiries-shared').RETENTION_MS).toISOString();
  await supabase.from('rider_inquiries').delete().lt('created_at', cutoff);
}

async function readAll() {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase 문의 저장소가 설정되지 않았습니다.');

  await purgeExpired();

  const { data, error } = await supabase
    .from('rider_inquiries')
    .select(INQUIRY_SELECT)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(rowToRecord).filter(item => !isExpired(item));
}

async function createInquiry(payload) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase 문의 저장소가 설정되지 않았습니다.');

  const now = nowIso();
  const extra = extraFromPayload(payload);
  const record = {
    id: createId(),
    name: String(payload.name || '').trim(),
    phone: String(payload.phone || '').trim(),
    area: String(payload.area || '').trim(),
    inquiry_type: String(payload.inquiryType || '라이더 지원').trim(),
    message: String(payload.message || '').trim(),
    status: 'new',
    raw_data: { ...(payload || {}), ...extra },
    created_at: now,
    updated_at: now
  };

  const { data, error } = await supabase
    .from('rider_inquiries')
    .insert(record)
    .select(INQUIRY_SELECT)
    .single();

  if (error) throw error;
  return rowToRecord(data);
}

function applyInquiryPatch(raw, patch, row) {
  const next = { ...raw };
  if (patch.adminReply != null) {
    const reply = String(patch.adminReply || '').trim();
    if (!reply) throw new Error('답장 내용을 입력하세요.');
    next.adminReply = reply;
    next.adminRepliedAt = nowIso();
    next.adminReplyBy = String(patch.adminReplyBy || next.adminReplyBy || '').trim();
    next.adminReplyById = String(patch.adminReplyById || next.adminReplyById || '').trim();
    next.replyingBy = '';
    next.replyingById = '';
    next.replyingAt = '';
  }
  if (patch.replyingClear) {
    next.replyingBy = '';
    next.replyingById = '';
    next.replyingAt = '';
  } else if (patch.replyingBy != null) {
    next.replyingBy = String(patch.replyingBy || '').trim();
    next.replyingById = String(patch.replyingById || '').trim();
    next.replyingAt = next.replyingBy ? nowIso() : '';
  }
  if (patch.riderAck) {
    next.riderAckAt = nowIso();
  }
  let nextStatus = patch.status != null ? String(patch.status || 'new') : row.status;
  if (patch.adminReply != null && nextStatus === 'new') nextStatus = 'read';
  return { raw: next, status: nextStatus };
}

async function updateInquiry(id, patch = {}) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase 문의 저장소가 설정되지 않았습니다.');

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data: row, error: readError } = await supabase
      .from('rider_inquiries')
      .select(INQUIRY_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (readError) throw readError;
    if (!row) throw new Error('문의를 찾지 못했습니다.');

    const applied = applyInquiryPatch(rawObject(row.raw_data), patch, row);
    const writtenAt = nowIso();
    const { data: saved, error } = await supabase
      .from('rider_inquiries')
      .update({
        status: applied.status,
        raw_data: applied.raw,
        updated_at: writtenAt
      })
      .eq('id', id)
      .eq('updated_at', row.updated_at)
      .select('id');
    if (error) throw error;
    if (saved && saved.length) return readAll();

    const { data: again, error: againError } = await supabase
      .from('rider_inquiries')
      .select('updated_at')
      .eq('id', id)
      .maybeSingle();
    if (againError) throw againError;
    if (again && again.updated_at === row.updated_at) {
      const { error: plainError } = await supabase
        .from('rider_inquiries')
        .update({
          status: applied.status,
          raw_data: applied.raw,
          updated_at: writtenAt
        })
        .eq('id', id);
      if (plainError) throw plainError;
      return readAll();
    }
  }

  throw new Error('다른 관리자가 방금 수정했습니다. 다시 시도하세요.');
}

async function updateStatus(id, status) {
  return updateInquiry(id, { status });
}

async function removeById(id) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase 문의 저장소가 설정되지 않았습니다.');

  const { error } = await supabase
    .from('rider_inquiries')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return readAll();
}

module.exports = {
  isEnabled,
  readAll,
  createInquiry,
  updateInquiry,
  updateStatus,
  removeById
};
