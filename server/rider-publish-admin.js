const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');

const PUBLISH_META_KEY = 'brem_rider_view_publish';
const PUBLISH_SELECT_BATCH = 800;
const PUBLISH_UPDATE_CHUNK = 100;

const SNAPSHOT_PAIRS = [
  ['brem_admin_long_event_catalog', 'brem_rider_published_long_event_catalog'],
  ['brem_admin_long_event_items', 'brem_rider_published_long_event_items'],
  ['brem_admin_long_event_config', 'brem_rider_published_long_event_config']
];

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

async function countPendingRows(supabase, table) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .is('rider_published_at', null);
  if (error) {
    if (/does not exist|column|rider_published_at/i.test(String(error.message || ''))) {
      return { count: 0, columnMissing: true };
    }
    throw error;
  }
  return { count: Number(count) || 0, columnMissing: false };
}

/**
 * 미반영 행을 배치로 공개. 전체 일괄 UPDATE + RETURNING 은 statement timeout 위험이 큼.
 * 관리자 ERP 데이터 자체는 그대로 두고, 라이더앱 공개 스탬프만 청크로 찍는다.
 */
async function publishTableRows(supabase, table, now) {
  let published = 0;
  for (;;) {
    const { data: pending, error: selectError } = await supabase
      .from(table)
      .select('id')
      .is('rider_published_at', null)
      .limit(PUBLISH_SELECT_BATCH);
    if (selectError) {
      if (/does not exist|column|rider_published_at/i.test(String(selectError.message || ''))) {
        return published;
      }
      throw selectError;
    }
    const ids = (pending || []).map(row => row.id).filter(Boolean);
    if (!ids.length) break;

    for (let i = 0; i < ids.length; i += PUBLISH_UPDATE_CHUNK) {
      const chunk = ids.slice(i, i + PUBLISH_UPDATE_CHUNK);
      const { data, error } = await supabase
        .from(table)
        .update({ rider_published_at: now, updated_at: now })
        .in('id', chunk)
        .select('id');
      if (error) {
        if (/does not exist|column|rider_published_at/i.test(String(error.message || ''))) {
          return published;
        }
        throw error;
      }
      published += Array.isArray(data) ? data.length : 0;
    }

    if (ids.length < PUBLISH_SELECT_BATCH) break;
  }
  return published;
}

async function getRiderViewPublishStatus(accessToken) {
  const auth = await verifyAdminCaller(accessToken);
  if (!auth.ok) return auth;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const [calls, rejections, metaRaw] = await Promise.all([
    countPendingRows(supabase, 'admin_calls'),
    countPendingRows(supabase, 'admin_rejection_rates'),
    readSettingValue(supabase, PUBLISH_META_KEY, {})
  ]);

  const pendingCalls = calls.count;
  const pendingRejections = rejections.count;
  const pendingTargets = 0;
  const pendingTotal = pendingCalls + pendingRejections;
  const publishedAt = metaRaw?.publishedAt || null;

  return {
    ok: true,
    publishedAt,
    pendingCalls,
    pendingRejections,
    pendingTargets,
    pendingTotal,
    columnWarnings: [
      calls.columnMissing ? 'admin_calls.rider_published_at' : ''
    ].filter(Boolean)
  };
}

async function publishRiderViewCore(supabase, options = {}) {
  const now = new Date().toISOString();
  const publishedBy = String(options.publishedBy || 'admin').trim();

  const [callsPublished, rejectionsPublished] = await Promise.all([
    publishTableRows(supabase, 'admin_calls', now),
    publishTableRows(supabase, 'admin_rejection_rates', now)
  ]);

  const snapshots = {};
  for (const [sourceKey, targetKey] of SNAPSHOT_PAIRS) {
    const fallback = sourceKey.includes('items') ? {} : [];
    const value = await readSettingValue(supabase, sourceKey, fallback);
    await writeSettingValue(supabase, targetKey, value);
    snapshots[targetKey] = Array.isArray(value) ? value.length : Object.keys(value || {}).length;
  }

  const meta = {
    publishedAt: now,
    publishedBy,
    callsPublished,
    rejectionsPublished,
    targetsPublished: 0,
    snapshots
  };
  await writeSettingValue(supabase, PUBLISH_META_KEY, meta);

  return {
    ok: true,
    ...meta,
    publishedCount: callsPublished + rejectionsPublished
  };
}

async function publishRiderView(accessToken, options = {}) {
  const auth = await verifyAdminCaller(accessToken);
  if (!auth.ok) return auth;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  return publishRiderViewCore(supabase, {
    publishedBy: options.publishedBy || auth.displayName || auth.email || 'admin'
  });
}

/** 스케줄러/크롤용 — 관리자 세션 없이 service role 로 공개 */
async function publishRiderViewWithServiceRole(options = {}) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  return publishRiderViewCore(supabase, {
    publishedBy: options.publishedBy || 'erp-publish-schedule'
  });
}

module.exports = {
  getRiderViewPublishStatus,
  publishRiderView,
  publishRiderViewWithServiceRole
};
