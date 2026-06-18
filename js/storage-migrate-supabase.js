/**
 * localStorage → Supabase 마이그레이션
 */
window.BremSupabaseMigration = (function () {
  const Mapper = () => window.BremSupabaseMapper;
  const KEYS = () => window.BremStorage.STORAGE_KEYS;

  const KV_KEYS = [
    'calls',
    'rejections',
    'targets',
    'weeklyTargets',
    'notices',
    'eventCatalog',
    'eventItems',
    'eventConfig',
    'legacyBikes',
    'legacyMission',
    'settlements',
    'settlementUnmatched',
    'promotionSettings',
    'promotionSelectorOptions',
    'promotionApplyResults',
    'preservedUnknown'
  ];

  function readLocal(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function chunk(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }

  async function upsertBatched(client, table, rows, onConflict = 'id') {
    if (!rows.length) return 0;
    let count = 0;
    for (const batch of chunk(rows, 100)) {
      const { error } = await client.from(table).upsert(batch, { onConflict });
      if (error) throw new Error(`${table} upsert 실패: ${error.message}`);
      count += batch.length;
    }
    return count;
  }

  function collectRegionNames(localData) {
    const names = new Map();
    const add = (name, platform) => {
      const trimmed = String(name || '').trim();
      if (!trimmed) return;
      const key = `${platform || 'all'}:${trimmed}`;
      if (!names.has(key)) {
        names.set(key, {
          name: trimmed,
          platform: platform || null,
          slug: Mapper().slugifyRegion(trimmed)
        });
      }
    };

    (localData.weeklySettlements || []).forEach(item => add(item.region, item.platform));
    (localData.promotionApplyResults || []).forEach(item => add(item.region, item.platform));
    return Array.from(names.values());
  }

  function gatherLocalSnapshot() {
    const K = KEYS();
    return {
      drivers: readLocal(K.drivers, []),
      promotionRules: readLocal(K.promotionRules, []),
      weeklySettlements: readLocal(K.weeklySettlements, []),
      manualNameMappings: readLocal(K.manualNameMappings, []),
      notices: readLocal(K.notices, []),
      kv: KV_KEYS.reduce((acc, keyName) => {
        const storageKey = K[keyName];
        if (readLocal(storageKey, null) !== null) {
          acc[storageKey] = readLocal(storageKey, null);
        }
        return acc;
      }, {})
    };
  }

  async function migrateLocalStorageToSupabase(client, options = {}) {
    if (!client) throw new Error('Supabase client가 필요합니다.');
    const mapper = Mapper();
    const local = gatherLocalSnapshot();
    const report = {
      regions: 0,
      riders: 0,
      users: 0,
      promotions: 0,
      promotionRules: 0,
      weeklySettlements: 0,
      weeklySettlementRiders: 0,
      riderNameMappings: 0,
      notices: 0,
      systemKvStore: 0
    };

    const regionRows = collectRegionNames(local).map(row => ({
      ...row,
      platform: row.platform || 'all'
    }));
    if (regionRows.length) {
      report.regions = await upsertBatched(client, 'regions', regionRows, 'name,platform');
    }

    const { data: regionData } = await client.from('regions').select('id, name, platform');
    const regionIdMap = new Map(
      (regionData || []).map(row => [`${row.platform || 'all'}:${row.name}`, row.id])
    );

    const riderRows = (local.drivers || []).map(mapper.riderToRow);
    if (riderRows.length) {
      report.riders = await upsertBatched(client, 'riders', riderRows);
    }

    const userRows = (local.drivers || []).map(mapper.riderToUserRow);
    if (options.includeAdmin !== false) {
      userRows.unshift({
        role: 'admin',
        rider_id: null,
        login_id: '관리자',
        password_hash: '1234',
        display_name: '관리자',
        active: true
      });
    }
    if (userRows.length) {
      report.users = await upsertBatched(client, 'users', userRows, 'login_id');
    }

    const promotionRows = [];
    const promotionRuleRows = [];
    (local.promotionRules || []).forEach(rule => {
      const { promotion, detailRules } = mapper.promotionToRows(rule);
      promotionRows.push(promotion);
      promotionRuleRows.push(...detailRules);
    });
    if (promotionRows.length) {
      report.promotions = await upsertBatched(client, 'promotions', promotionRows);
    }
    if (promotionRuleRows.length) {
      const promotionIds = promotionRows.map(row => row.id);
      if (promotionIds.length) {
        await client.from('promotion_rules').delete().in('promotion_id', promotionIds);
      }
      report.promotionRules = await upsertBatched(client, 'promotion_rules', promotionRuleRows);
    }

    const weeklyHeaders = [];
    const weeklyRiderRows = [];
    (local.weeklySettlements || []).forEach(record => {
      const { header, riders } = mapper.weeklySettlementToRows(record, regionIdMap);
      weeklyHeaders.push(header);
      weeklyRiderRows.push(...riders);
    });
    if (weeklyHeaders.length) {
      report.weeklySettlements = await upsertBatched(client, 'weekly_settlements', weeklyHeaders);
      for (const header of weeklyHeaders) {
        await client.from('weekly_settlement_riders').delete().eq('weekly_settlement_id', header.id);
      }
    }
    if (weeklyRiderRows.length) {
      let count = 0;
      for (const batch of chunk(weeklyRiderRows, 100)) {
        const { error } = await client.from('weekly_settlement_riders').insert(batch);
        if (error) throw new Error(`weekly_settlement_riders insert 실패: ${error.message}`);
        count += batch.length;
      }
      report.weeklySettlementRiders = count;
    }

    const mappingRows = (local.manualNameMappings || []).map(mapper.mappingToRow);
    if (mappingRows.length) {
      report.riderNameMappings = await upsertBatched(client, 'rider_name_mappings', mappingRows);
    }

    const noticeRows = (local.notices || []).map(mapper.noticeToRow);
    if (noticeRows.length) {
      report.notices = await upsertBatched(client, 'notices', noticeRows);
    }

    const kvRows = Object.entries(local.kv).map(([storage_key, value]) => ({
      storage_key,
      value,
      updated_at: new Date().toISOString()
    }));
    if (kvRows.length) {
      report.systemKvStore = await upsertBatched(client, 'system_kv_store', kvRows, 'storage_key');
    }

    return {
      ok: true,
      migratedAt: new Date().toISOString(),
      report
    };
  }

  return {
    gatherLocalSnapshot,
    migrateLocalStorageToSupabase
  };
})();
