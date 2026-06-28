const { getServiceClient } = require('./admin-bootstrap');
const {
  listCollectSources,
  getCollectSource,
  mapItemToCollectRow,
  buildDefaultQuery,
  resolveApiEndpoint,
  API_REGISTRY_KEY
} = require('./baemin-collect-sources');
const { fetchPaginatedApi } = require('./baemin-api-fetch');
const { createCollectRunId } = require('./baemin-raw-api-logs');

function getBaeminSession() {
  return require('./baemin-delivery-session');
}

function getLegacyCollectHelpers() {
  return require('./baemin-delivery-collect');
}

async function readSettingsValue(key) {
  const supabase = getServiceClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw new Error(error.message || '설정을 불러오지 못했습니다.');
  return data?.value ?? null;
}

async function writeSettingsValue(key, value, description) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  const { error } = await supabase.from('settings').upsert({
    key,
    value,
    description: description || key,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) return { ok: false, status: 500, error: error.message || '설정 저장에 실패했습니다.' };
  return { ok: true };
}

function isMissingBizCollectTableError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('baemin_biz_collect')
    || (message.includes('relation') && message.includes('does not exist'));
}

async function getBizCollectTableStatus() {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, tableExists: false };
  const { error } = await supabase.from('baemin_biz_collect_items').select('id', { head: true, count: 'exact' });
  if (error) {
    if (isMissingBizCollectTableError(error)) return { ok: true, tableExists: false };
    return { ok: false, tableExists: false, error: error.message };
  }
  return { ok: true, tableExists: true };
}

async function getApiRegistry() {
  const raw = await readSettingsValue(API_REGISTRY_KEY);
  return raw && typeof raw === 'object' ? raw : { endpoints: {}, discoveredAt: null };
}

async function saveApiRegistry(registry) {
  return writeSettingsValue(API_REGISTRY_KEY, registry, 'Baemin Biz discovered API endpoints');
}

function resolveApiPath(sourceId, registry) {
  return resolveApiEndpoint(sourceId, registry)?.apiPath || null;
}

function aggregateRiderHistoryFromDaily(items, collectDate, collectedAt, sourceUrl) {
  const map = new Map();
  items.forEach((item, index) => {
    const userId = String(item?.userId || item?.riderId || '').trim();
    const key = userId || String(item?.phoneNumber || item?.phone || item?.name || index);
    if (!map.has(key)) {
      map.set(key, {
        userId,
        name: item?.name || item?.riderName || '',
        phoneNumber: item?.phoneNumber || item?.phone || '',
        deliveryAcceptanceCount: { totalComplete: 0, foodComplete: 0, bmartComplete: 0, storeComplete: 0 },
        deliveryPeakTimeCount: { morning: 0, afternoon: 0, evening: 0, midnight: 0 },
        deliveryCount: 0,
        sourceUrl
      });
    }
    const row = map.get(key);
    row.deliveryCount += 1;
    const acceptance = item?.deliveryAcceptanceCount || {};
    row.deliveryAcceptanceCount.totalComplete += Number(acceptance.totalComplete || item?.totalComplete || 1);
    row.deliveryAcceptanceCount.foodComplete += Number(acceptance.foodComplete || 0);
    row.deliveryAcceptanceCount.bmartComplete += Number(acceptance.bmartComplete || 0);
    row.deliveryAcceptanceCount.storeComplete += Number(acceptance.storeComplete || 0);
  });
  return Array.from(map.values()).map(item => mapItemToCollectRow('rider_history', item, collectDate, sourceUrl, collectedAt));
}

async function saveCollectItems(rows) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  if (!rows.length) return { ok: false, status: 400, error: 'NO_ROWS', message: '저장할 데이터가 없습니다.' };

  const chunkSize = 100;
  let savedCount = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase
      .from('baemin_biz_collect_items')
      .upsert(chunk, { onConflict: 'collect_date,source_menu,dedupe_key' });
    if (error) {
      return { ok: false, status: 500, error: 'SUPABASE_SAVE_FAILED', message: error.message || String(error) };
    }
    savedCount += chunk.length;
  }
  return { ok: true, savedCount };
}

async function saveCollectRun(runRow) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  const { error } = await supabase.from('baemin_biz_collect_runs').insert(runRow);
  if (error) return { ok: false, status: 500, error: error.message || String(error) };
  return { ok: true };
}

function shouldAggregateRiderFromDaily(sourceId, registry) {
  if (sourceId !== 'rider_history') return false;
  const riderEndpoint = registry?.endpoints?.rider_history;
  if (riderEndpoint?.fallbackFromDaily) return true;
  const dailyPath = registry?.endpoints?.daily_history?.apiPath || '/delivery/history';
  const riderPath = riderEndpoint?.apiPath || '/delivery/history';
  return riderPath === dailyPath && !riderEndpoint?.sampleUrl?.includes('userId=');
}

async function collectSource(sourceId, sessionCookie, collectDate, registry = {}, context = {}) {
  const source = getCollectSource(sourceId);
  const collectedAt = new Date().toISOString();
  if (!source) {
    return { ok: false, sourceMenu: sourceId, message: '알 수 없는 수집 소스' };
  }

  if (shouldAggregateRiderFromDaily(sourceId, registry)) {
    let dailyItems = context.dailyItems;
    let sourceUrl = context.dailySourceUrl || '';
    if (!dailyItems) {
      const daily = await collectSource('daily_history', sessionCookie, collectDate, registry, context);
      if (!daily.ok) return { ...daily, sourceMenu: sourceId, label: source.label };
      dailyItems = daily.rawItems || [];
      sourceUrl = daily.sourceUrl || '';
    }
    const rows = aggregateRiderHistoryFromDaily(dailyItems, collectDate, collectedAt, sourceUrl);
    const saveResult = await saveCollectItems(rows);
    if (!saveResult.ok) return { ...saveResult, sourceMenu: sourceId, label: source.label };
    return {
      ok: true,
      sourceMenu: sourceId,
      label: source.label,
      savedCount: saveResult.savedCount,
      sourceUrl,
      collectedAt,
      fallback: 'daily_aggregate'
    };
  }

  const endpoint = resolveApiEndpoint(sourceId, registry);
  if (!endpoint?.apiPath) {
    return { ok: false, sourceMenu: sourceId, label: source.label, message: `${source.label} API 경로 없음` };
  }

  console.log(`[BREM][collect] ${sourceId} start collectDate=${collectDate} api=${endpoint.apiOrigin}${endpoint.apiPath}`);

  const baseQuery = buildDefaultQuery(sourceId, collectDate);
  const fetched = await fetchPaginatedApi({
    apiOrigin: endpoint.apiOrigin,
    apiPath: endpoint.apiPath,
    sessionCookie,
    baseQuery,
    pagination: source.pagination,
    logPrefix: `[BREM][collect:${sourceId}]`,
    logContext: context.runId ? {
      collectDate,
      sourceMenu: sourceId,
      runId: context.runId
    } : null,
    playwrightContext: context.playwrightContext || null
  });

  if (!fetched.ok) {
    return {
      ok: false,
      sourceMenu: sourceId,
      label: source.label,
      status: fetched.status,
      message: fetched.message || fetched.error || 'API 호출 실패',
      sourceUrl: fetched.meta?.sourceUrl || ''
    };
  }

  const items = fetched.items || [];

  const rows = items.map((item, index) => {
    const row = mapItemToCollectRow(sourceId, item, collectDate, fetched.meta?.sourceUrl || '', collectedAt);
    if (!row.dedupe_key) row.dedupe_key = `${sourceId}:row-${index}`;
    return row;
  });

  const saveResult = await saveCollectItems(rows);
  if (!saveResult.ok) {
    return { ...saveResult, sourceMenu: sourceId, label: source.label, rawItems: items };
  }

  if (sourceId === 'delivery_status') {
    const { saveRowsDirect, mapItemToRow } = getLegacyCollectHelpers();
    const legacyRows = items.map(item => mapItemToRow(item, collectDate)).filter(row => row.dedupe_key);
    const legacySave = await saveRowsDirect(legacyRows, collectDate);
    if (!legacySave.ok) {
      console.warn('[BREM][collect] legacy baemin_delivery_status save failed:', legacySave.message || legacySave.error);
    }
  }

  return {
    ok: true,
    sourceMenu: sourceId,
    label: source.label,
    savedCount: saveResult.savedCount,
    sourceUrl: fetched.meta?.sourceUrl || '',
    collectedAt,
    rawItems: items,
    meta: fetched.meta
  };
}

async function runFullCollectPipeline(options = {}) {
  const collectDate = String(options.collectDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const source = String(options.source || 'local_scheduler').trim();
  const runId = options.runId || createCollectRunId();
  const playwrightContext = options.playwrightContext || null;
  const results = {};
  const collectedAt = new Date().toISOString();

  const tableStatus = await getBizCollectTableStatus();
  if (!tableStatus.tableExists) {
    const message = 'public.baemin_biz_collect_items 테이블이 없습니다. supabase/baemin_all_migrations.sql 을 SQL Editor에서 실행하세요.';
    return { ok: false, message, results, sessionExpired: false };
  }

  const cookie = String(options.sessionCookie || '').trim()
    || await getBaeminSession().resolveStoredSessionCookie({});
  if (!cookie && !playwrightContext) {
    return {
      ok: false,
      message: '배민 세션 쿠키가 없습니다. [배민 세션 갱신]으로 로그인하세요.',
      results,
      sessionExpired: false
    };
  }

  const registry = await getApiRegistry();
  if (!registry.endpoints?.rider_history) {
    registry.endpoints = registry.endpoints || {};
    registry.endpoints.rider_history = { fallbackFromDaily: true };
  }

  let anySuccess = false;
  let sessionExpired = false;
  let authFailureCount = 0;
  const pipelineContext = { runId, playwrightContext };
  const sourceDefs = listCollectSources();

  function isAuthFailure(result) {
    return result.status === 401
      || result.status === 403
      || result.message === '배민 로그인 만료';
  }

  for (const sourceDef of sourceDefs) {
    const result = await collectSource(sourceDef.id, cookie, collectDate, registry, pipelineContext);
    results[sourceDef.id] = result;

    if (sourceDef.id === 'daily_history' && result.ok) {
      pipelineContext.dailyItems = result.rawItems || [];
      pipelineContext.dailySourceUrl = result.sourceUrl || '';
    }

    await saveCollectRun({
      collect_date: collectDate,
      collected_at: collectedAt,
      source_menu: sourceDef.id,
      source_url: result.sourceUrl || '',
      status: result.ok ? 'success' : 'failed',
      error_message: result.ok ? '' : String(result.message || result.error || '수집 실패'),
      row_count: Number(result.savedCount || 0),
      meta_json: { source, fallback: result.fallback || null }
    });

    if (result.ok) anySuccess = true;

    if (isAuthFailure(result)) {
      authFailureCount += 1;
      if (!playwrightContext) {
        sessionExpired = true;
        await getBaeminSession().markSessionError(result.message || '배민 로그인 만료');
        break;
      }
      console.warn(`[BREM][collect] ${sourceDef.id} auth failure — continue (playwright browser active)`);
      continue;
    }
  }

  if (playwrightContext && authFailureCount === sourceDefs.length && !anySuccess) {
    sessionExpired = true;
    await getBaeminSession().markSessionError('배민 로그인 만료');
  }

  if (anySuccess && !sessionExpired) {
    await getBaeminSession().markSessionValidated();
  }

  const savedTotal = Object.values(results).reduce((sum, row) => sum + Number(row.savedCount || 0), 0);
  return {
    ok: anySuccess && !sessionExpired,
    collectDate,
    runId,
    savedTotal,
    results,
    sessionExpired,
    message: sessionExpired
      ? '세션 만료 — 배민 세션 갱신 필요'
      : (anySuccess ? '수집 완료' : '수집 실패')
  };
}

async function getLatestMenuCollectStatus(collectDate) {
  const supabase = getServiceClient();
  const menus = listCollectSources().map(source => ({
    id: source.id,
    label: source.label,
    lastCollectedAt: null,
    lastStatus: null,
    lastError: '',
    rowCount: 0,
    sourceUrl: '',
    collectDate: collectDate || null
  }));

  if (!supabase) return menus;

  let query = supabase
    .from('baemin_biz_collect_runs')
    .select('collect_date, collected_at, source_menu, source_url, status, error_message, row_count')
    .order('collected_at', { ascending: false })
    .limit(100);

  if (collectDate) {
    query = query.eq('collect_date', collectDate);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingBizCollectTableError(error)) return menus;
    return menus;
  }

  const latestByMenu = new Map();
  (data || []).forEach(row => {
    const key = row.source_menu;
    if (!latestByMenu.has(key)) latestByMenu.set(key, row);
  });

  return menus.map(menu => {
    const row = latestByMenu.get(menu.id);
    if (!row) return menu;
    return {
      ...menu,
      lastCollectedAt: row.collected_at,
      lastStatus: row.status,
      lastError: row.error_message || '',
      rowCount: Number(row.row_count || 0),
      sourceUrl: row.source_url || '',
      collectDate: row.collect_date
    };
  });
}

async function getCollectItemsForAdmin(collectDate, sourceMenu) {
  const supabase = getServiceClient();
  const date = String(collectDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const menu = String(sourceMenu || '').trim();

  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  let query = supabase
    .from('baemin_biz_collect_items')
    .select('id, collect_date, collected_at, source_menu, rider_name, rider_user_id, phone_number, parsed_json, raw_json')
    .eq('collect_date', date)
    .order('rider_name', { ascending: true })
    .limit(5000);

  if (menu) query = query.eq('source_menu', menu);

  const { data, error } = await query;
  if (error) {
    if (isMissingBizCollectTableError(error)) {
      return { ok: false, tableMissing: true, message: 'baemin_biz_collect_items 테이블이 없습니다.' };
    }
    return { ok: false, error: error.message || '조회 실패' };
  }

  return {
    ok: true,
    collectDate: date,
    sourceMenu: menu,
    items: data || [],
    count: (data || []).length
  };
}

module.exports = {
  getBizCollectTableStatus,
  getApiRegistry,
  saveApiRegistry,
  collectSource,
  runFullCollectPipeline,
  saveCollectRun,
  getLatestMenuCollectStatus,
  getCollectItemsForAdmin
};
