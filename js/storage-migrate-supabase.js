/**
 * localStorage -> Supabase migration
 *
 * Supabase 구조:
 * - riders
 * - notices
 * - promotions
 * - settings
 */
window.BremSupabaseMigration = (function () {
  const Mapper = () => window.BremSupabaseMapper;
  const KEYS = () => window.BremStorage.STORAGE_KEYS;

  function assertNotProduction() {
    const mode = window.BREM_SUPABASE_CONFIG?.mode || window.BremStorage?.getSupabaseConfig?.().mode;
    if (mode === 'production') {
      throw new Error('운영 환경에서는 localStorage 이전 기능을 사용할 수 없습니다.');
    }
  }

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

  async function replaceTable(client, table, rows) {
    const { error: deleteError } = await client.from(table).delete().neq('id', '__never__');
    if (deleteError) throw new Error(`${table} 기존 데이터 삭제 실패: ${deleteError.message}`);
    if (!rows.length) return 0;

    let count = 0;
    for (const batch of chunk(rows, 100)) {
      const { error } = await client.from(table).upsert(batch, { onConflict: 'id' });
      if (error) throw new Error(`${table} upsert 실패: ${error.message}`);
      count += batch.length;
    }
    return count;
  }

  async function upsertSettings(client, rows) {
    if (!rows.length) return 0;
    let count = 0;
    for (const batch of chunk(rows, 100)) {
      const { error } = await client.from('settings').upsert(batch, { onConflict: 'key' });
      if (error) throw new Error(`settings upsert 실패: ${error.message}`);
      count += batch.length;
    }
    return count;
  }

  function gatherLocalSnapshot() {
    const K = KEYS();
    const knownKeys = Object.values(K).filter(key => String(key || '').startsWith('brem_'));
    const localValues = {};
    knownKeys.forEach(key => {
      const value = readLocal(key, undefined);
      if (value !== undefined) localValues[key] = value;
    });

    return {
      drivers: readLocal(K.drivers, []),
      notices: readLocal(K.notices, []),
      promotions: readLocal(K.promotionRules, []),
      settings: Object.entries(localValues)
        .filter(([key]) => ![K.drivers, K.notices, K.promotionRules].includes(key))
        .map(([key, value]) => ({
          key,
          value,
          description: storageKeyDescription(key, K),
          updated_at: new Date().toISOString()
        }))
    };
  }

  function storageKeyDescription(key, K) {
    const match = Object.entries(K).find(([, storageKey]) => storageKey === key);
    return match ? `localStorage:${match[0]}` : 'localStorage backup';
  }

  async function migrateLocalStorageToSupabase(client) {
    assertNotProduction();
    if (!client) throw new Error('Supabase client가 필요합니다.');
    const mapper = Mapper();
    const local = gatherLocalSnapshot();

    const riderRows = (local.drivers || []).map(mapper.riderToRow).filter(row => row.id);
    const noticeRows = (local.notices || []).map(mapper.noticeToRow).filter(row => row.id);
    const promotionRows = (local.promotions || []).map(mapper.promotionToRow).filter(row => row.id);

    const report = {
      riders: await replaceTable(client, 'riders', riderRows),
      notices: await replaceTable(client, 'notices', noticeRows),
      promotions: await replaceTable(client, 'promotions', promotionRows),
      settings: await upsertSettings(client, local.settings)
    };

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
