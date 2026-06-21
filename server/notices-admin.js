const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');

const NOTICE_SELECT = [
  'id', 'title', 'content', 'pinned', 'raw_data', 'created_at', 'updated_at'
].join(',');

function noticeToRow(notice) {
  const now = new Date().toISOString();
  return {
    id: String(notice.id || ''),
    title: String(notice.title || '').trim(),
    content: String(notice.content || '').trim(),
    pinned: Boolean(notice.pinned),
    raw_data: notice || {},
    created_at: notice.createdAt || now,
    updated_at: notice.updatedAt || now
  };
}

async function listNotices(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const { data, error } = await supabase
    .from('notices')
    .select(NOTICE_SELECT)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, status: 500, error: error.message || '공지사항 목록을 불러오지 못했습니다.' };
  }

  return { ok: true, notices: data || [] };
}

async function upsertNotice(accessToken, notice) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const row = noticeToRow(notice);
  if (!row.id) {
    return { ok: false, status: 400, error: '공지 ID가 없습니다.' };
  }
  if (!row.title) {
    return { ok: false, status: 400, error: '공지 제목을 입력하세요.' };
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const { error } = await supabase.from('notices').upsert(row, { onConflict: 'id' });
  if (error) {
    return { ok: false, status: 400, error: error.message || '공지사항 저장에 실패했습니다.' };
  }

  const { data, error: readError } = await supabase
    .from('notices')
    .select(NOTICE_SELECT)
    .eq('id', row.id)
    .maybeSingle();

  if (readError) {
    return { ok: false, status: 500, error: readError.message || '저장된 공지를 확인하지 못했습니다.' };
  }

  return { ok: true, notice: data };
}

async function deleteNotice(accessToken, noticeId) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const id = String(noticeId || '').trim();
  if (!id) {
    return { ok: false, status: 400, error: '공지 ID가 없습니다.' };
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const { data: existing, error: readError } = await supabase
    .from('notices')
    .select('id')
    .eq('id', id)
    .maybeSingle();

  if (readError) {
    return { ok: false, status: 500, error: readError.message || '공지를 확인하지 못했습니다.' };
  }
  if (!existing) {
    return { ok: false, status: 404, error: '삭제할 공지를 찾을 수 없습니다.' };
  }

  const { error } = await supabase.from('notices').delete().eq('id', id);
  if (error) {
    return { ok: false, status: 400, error: error.message || '공지사항 삭제에 실패했습니다.' };
  }

  return { ok: true, id };
}

module.exports = {
  listNotices,
  upsertNotice,
  deleteNotice
};
