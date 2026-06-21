const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');

const PUBLISH_META_KEY = 'brem_rider_view_publish';

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

async function publishTableRows(supabase, table, now) {
  const { data, error } = await supabase
    .from(table)
    .update({ rider_published_at: now, updated_at: now })
    .is('rider_published_at', null)
    .select('id');
  if (error) {
    if (/does not exist|column|rider_published_at/i.test(String(error.message || ''))) {
      return 0;
    }
    throw error;
  }
  return Array.isArray(data) ? data.length : 0;
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

async function publishRiderView(accessToken, options = {}) {
  const auth = await verifyAdminCaller(accessToken);
  if (!auth.ok) return auth;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const now = new Date().toISOString();
  const publishedBy = String(options.publishedBy || auth.displayName || auth.email || 'admin').trim();

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

module.exports = {
  getRiderViewPublishStatus,
  publishRiderView
};
