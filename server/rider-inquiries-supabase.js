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

function rowToRecord(row) {
  if (!row) return null;
  const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
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

async function updateInquiry(id, patch = {}) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase 문의 저장소가 설정되지 않았습니다.');

  const { data: row, error: readError } = await supabase
    .from('rider_inquiries')
    .select(INQUIRY_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (readError) throw readError;
  if (!row) throw new Error('문의를 찾지 못했습니다.');

  const raw = row.raw_data && typeof row.raw_data === 'object' ? { ...row.raw_data } : {};
  if (patch.adminReply != null) {
    const reply = String(patch.adminReply || '').trim();
    if (!reply) throw new Error('답장 내용을 입력하세요.');
    raw.adminReply = reply;
    raw.adminRepliedAt = nowIso();
  }
  if (patch.riderAck) {
    if (!String(raw.adminReply || '').trim()) {
      throw new Error('관리자 답장이 아직 없습니다.');
    }
    raw.riderAckAt = nowIso();
  }

  let nextStatus = patch.status != null ? String(patch.status || 'new') : row.status;
  if (patch.adminReply != null && nextStatus === 'new') nextStatus = 'read';
  if (nextStatus === 'done' && String(raw.adminReply || '').trim() && !raw.riderAckAt) {
    throw new Error('기사가 답장을 확인한 뒤에 처리완료할 수 있습니다.');
  }

  const { error } = await supabase
    .from('rider_inquiries')
    .update({
      status: nextStatus,
      raw_data: raw,
      updated_at: nowIso()
    })
    .eq('id', id);

  if (error) throw error;
  return readAll();
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
