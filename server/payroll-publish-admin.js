const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');
const {
  normalizeSettlementWeekStart,
  settlementWeekEnd,
  defaultPaymentDateForWeekEnd
} = require('./rider-weekly-payslip');
const { fetchAllPages } = require('./supabase-paginate');

const PUBLISH_META_KEY = 'brem_payroll_rider_publish';

async function readSettingValue(supabase, key, fallback) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  if (data?.value !== undefined && data?.value !== null) return data.value;
  return fallback;
}

async function writeSettingValue(supabase, key, value) {
  const { error } = await supabase.from('settings').upsert({
    key,
    value,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) throw error;
}

function lineWeekStart(row) {
  const raw = row?.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  return String(raw.settlementWeekStart || raw.settlementWeekPayKey || '').slice(0, 10);
}

function noticeWeekStart(row) {
  return String(row?.settlement_week_start || '').slice(0, 10);
}

function noticeAppliesToWeek(notice, weekStart) {
  const scoped = noticeWeekStart(notice);
  return !scoped || scoped === weekStart;
}

// PostgREST .in() 필터는 쿼리스트링으로 붙어 URL 길이 한도(긴 direct-… id)에 걸리면
// "Bad Request" 만 떨어지고 반영이 실패한다. 청크로 나눠 업데이트한다.
async function updatePublishedAtByIds(supabase, table, ids, now) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return 0;
  const CHUNK = 40;
  let published = 0;
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from(table)
      .update({ rider_published_at: now, updated_at: now })
      .in('id', chunk)
      .select('id');
    if (error) throw error;
    published += Array.isArray(data) ? data.length : 0;
  }
  return published;
}

async function loadPayrollLines(supabase) {
  try {
    const lines = await fetchAllPages((offset, pageSize) => supabase
      .from('payroll_slip_lines')
      .select('id,driver_id,rider_published_at,raw_data,updated_at')
      .order('updated_at', { ascending: false })
      .range(offset, offset + pageSize - 1), { pageSize: 1000 });
    return { ok: true, columnMissing: false, lines };
  } catch (error) {
    if (/does not exist|relation|schema cache/i.test(error.message || '')) {
      return { ok: false, columnMissing: true, lines: [] };
    }
    throw error;
  }
}

async function loadPayrollNotices(supabase) {
  const { data, error } = await supabase
    .from('payroll_notices')
    .select('*')
    .order('sort_order', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(500);
  if (error) {
    if (/does not exist|relation|schema cache/i.test(error.message || '')) {
      return { ok: false, tableMissing: true, notices: [] };
    }
    throw error;
  }
  return { ok: true, tableMissing: false, notices: data || [] };
}

async function getPayrollPublishStatus(accessToken, weekStartInput) {
  const auth = await verifyAdminCaller(accessToken);
  if (!auth.ok) return auth;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const settlementWeekStart = normalizeSettlementWeekStart(weekStartInput);
  const [linesResult, noticesResult, metaRaw] = await Promise.all([
    loadPayrollLines(supabase),
    loadPayrollNotices(supabase),
    readSettingValue(supabase, PUBLISH_META_KEY, {})
  ]);

  const weekLines = (linesResult.lines || []).filter(row => lineWeekStart(row) === settlementWeekStart);
  const pendingLines = weekLines.filter(row => !row.rider_published_at).length;
  const publishedLines = weekLines.filter(row => row.rider_published_at).length;

  const applicableNotices = (noticesResult.notices || []).filter(notice => noticeAppliesToWeek(notice, settlementWeekStart));
  const pendingNotices = applicableNotices.filter(notice => !notice.rider_published_at).length;
  const publishedNotices = applicableNotices.filter(notice => notice.rider_published_at).length;

  const lastWeekMeta = metaRaw?.weeks?.[settlementWeekStart] || null;
  const paymentDate = lastWeekMeta?.paymentDate
    || defaultPaymentDateForWeekEnd(settlementWeekEnd(settlementWeekStart));

  return {
    ok: true,
    settlementWeekStart,
    totalLines: weekLines.length,
    pendingLines,
    publishedLines,
    totalNotices: applicableNotices.length,
    pendingNotices,
    publishedNotices,
    pendingTotal: pendingLines + pendingNotices,
    lastPublishedAt: lastWeekMeta?.publishedAt || null,
    lastPublishedBy: lastWeekMeta?.publishedBy || '',
    paymentDate,
    columnMissing: linesResult.columnMissing === true,
    noticesTableMissing: noticesResult.tableMissing === true
  };
}

async function publishPayrollToRiders(accessToken, options = {}) {
  const auth = await verifyAdminCaller(accessToken);
  if (!auth.ok) return auth;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const settlementWeekStart = normalizeSettlementWeekStart(options.weekStart);
  if (!settlementWeekStart) {
    return { ok: false, status: 400, error: '정산주(수요일 시작)를 선택하세요.' };
  }

  const paymentDateInput = String(options.paymentDate || '').trim().slice(0, 10);
  const paymentDate = paymentDateInput || defaultPaymentDateForWeekEnd(settlementWeekEnd(settlementWeekStart));

  const now = new Date().toISOString();
  const publishedBy = String(options.publishedBy || auth.displayName || auth.email || 'admin').trim();

  const [linesResult, noticesResult] = await Promise.all([
    loadPayrollLines(supabase),
    loadPayrollNotices(supabase)
  ]);

  if (linesResult.columnMissing) {
    return {
      ok: false,
      status: 400,
      error: 'payroll_slip_lines.rider_published_at 컬럼이 없습니다. supabase/payroll_rider_publish_migration.sql 을 실행하세요.'
    };
  }

  const weekLineIds = (linesResult.lines || [])
    .filter(row => lineWeekStart(row) === settlementWeekStart)
    .map(row => row.id)
    .filter(Boolean);

  const linesPublished = await updatePublishedAtByIds(
    supabase,
    'payroll_slip_lines',
    weekLineIds,
    now
  );

  let noticesPublished = 0;
  if (!noticesResult.tableMissing) {
    const noticeIds = (noticesResult.notices || [])
      .filter(notice => noticeAppliesToWeek(notice, settlementWeekStart))
      .map(notice => notice.id)
      .filter(Boolean);
    noticesPublished = await updatePublishedAtByIds(
      supabase,
      'payroll_notices',
      noticeIds,
      now
    );
  }

  const existingMeta = await readSettingValue(supabase, PUBLISH_META_KEY, {});
  const weeks = existingMeta?.weeks && typeof existingMeta.weeks === 'object' ? { ...existingMeta.weeks } : {};
  weeks[settlementWeekStart] = {
    publishedAt: now,
    publishedBy,
    linesPublished,
    noticesPublished,
    paymentDate
  };
  const meta = {
    ...existingMeta,
    publishedAt: now,
    publishedBy,
    settlementWeekStart,
    linesPublished,
    noticesPublished,
    paymentDate,
    weeks
  };
  await writeSettingValue(supabase, PUBLISH_META_KEY, meta);

  return {
    ok: true,
    settlementWeekStart,
    publishedAt: now,
    publishedBy,
    linesPublished,
    noticesPublished,
    paymentDate,
    publishedCount: linesPublished + noticesPublished
  };
}

module.exports = {
  getPayrollPublishStatus,
  publishPayrollToRiders
};
