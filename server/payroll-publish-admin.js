const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');
const { normalizeSettlementWeekStart } = require('./rider-weekly-payslip');

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

async function loadPayrollLines(supabase) {
  const { data, error } = await supabase
    .from('payroll_slip_lines')
    .select('id,driver_id,rider_published_at,raw_data,updated_at')
    .order('updated_at', { ascending: false })
    .limit(5000);
  if (error) {
    if (/does not exist|relation|schema cache/i.test(error.message || '')) {
      return { ok: false, columnMissing: true, lines: [] };
    }
    throw error;
  }
  return { ok: true, columnMissing: false, lines: data || [] };
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

  let linesPublished = 0;
  if (weekLineIds.length) {
    const { data, error } = await supabase
      .from('payroll_slip_lines')
      .update({ rider_published_at: now, updated_at: now })
      .in('id', weekLineIds)
      .select('id');
    if (error) throw error;
    linesPublished = Array.isArray(data) ? data.length : 0;
  }

  let noticesPublished = 0;
  if (!noticesResult.tableMissing) {
    const noticeIds = (noticesResult.notices || [])
      .filter(notice => noticeAppliesToWeek(notice, settlementWeekStart))
      .map(notice => notice.id)
      .filter(Boolean);

    if (noticeIds.length) {
      const { data, error } = await supabase
        .from('payroll_notices')
        .update({ rider_published_at: now, updated_at: now })
        .in('id', noticeIds)
        .select('id');
      if (error) throw error;
      noticesPublished = Array.isArray(data) ? data.length : 0;
    }
  }

  const existingMeta = await readSettingValue(supabase, PUBLISH_META_KEY, {});
  const weeks = existingMeta?.weeks && typeof existingMeta.weeks === 'object' ? { ...existingMeta.weeks } : {};
  weeks[settlementWeekStart] = {
    publishedAt: now,
    publishedBy,
    linesPublished,
    noticesPublished
  };
  const meta = {
    ...existingMeta,
    publishedAt: now,
    publishedBy,
    settlementWeekStart,
    linesPublished,
    noticesPublished,
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
    publishedCount: linesPublished + noticesPublished
  };
}

module.exports = {
  getPayrollPublishStatus,
  publishPayrollToRiders
};
