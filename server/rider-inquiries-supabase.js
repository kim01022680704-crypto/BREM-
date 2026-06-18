const { createClient } = require('@supabase/supabase-js');

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
  return {
    id: row.id,
    name: row.name || '',
    phone: row.phone || '',
    area: row.area || '',
    inquiryType: row.inquiry_type || row.raw_data?.inquiryType || '라이더 지원',
    message: row.message || '',
    status: row.status || 'new',
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at
  };
}

async function readAll() {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase 문의 저장소가 설정되지 않았습니다.');

  const { data, error } = await supabase
    .from('rider_inquiries')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(rowToRecord);
}

async function createInquiry(payload) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase 문의 저장소가 설정되지 않았습니다.');

  const now = new Date().toISOString();
  const record = {
    id: createId(),
    name: String(payload.name || '').trim(),
    phone: String(payload.phone || '').trim(),
    area: String(payload.area || '').trim(),
    inquiry_type: String(payload.inquiryType || '라이더 지원').trim(),
    message: String(payload.message || '').trim(),
    status: 'new',
    raw_data: payload || {},
    created_at: now,
    updated_at: now
  };

  const { data, error } = await supabase
    .from('rider_inquiries')
    .insert(record)
    .select('*')
    .single();

  if (error) throw error;
  return rowToRecord(data);
}

async function updateStatus(id, status) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase 문의 저장소가 설정되지 않았습니다.');

  const { error } = await supabase
    .from('rider_inquiries')
    .update({
      status: String(status || 'new'),
      updated_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) throw error;
  return readAll();
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
  updateStatus,
  removeById
};
