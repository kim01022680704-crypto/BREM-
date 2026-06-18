/**
 * Supabase storage adapter
 * localStorage와 동일한 read/write 인터페이스 + 메모리 캐시
 */
window.BremSupabaseStorageAdapter = (function () {
  const Mapper = () => window.BremSupabaseMapper;

  function createSupabaseAdapter(client, keys) {
    const cache = new Map();
    let hydrated = false;
    let persistQueue = Promise.resolve();

    function setCache(key, value) {
      cache.set(key, value);
    }

    function getCache(key, fallback) {
      return cache.has(key) ? cache.get(key) : fallback;
    }

    async function loadRiders() {
      const { data, error } = await client.from('riders').select('*');
      if (error) throw error;
      return (data || []).map(row => Mapper().rowToRider(row));
    }

    async function loadPromotionRules() {
      const { data: promotions, error: pErr } = await client.from('promotions').select('*');
      if (pErr) throw pErr;
      const { data: rules, error: rErr } = await client.from('promotion_rules').select('*');
      if (rErr) throw rErr;
      const grouped = new Map();
      (rules || []).forEach(row => {
        if (!grouped.has(row.promotion_id)) grouped.set(row.promotion_id, []);
        grouped.get(row.promotion_id).push(row);
      });
      return (promotions || []).map(promotion => Mapper().rowsToPromotion(
        promotion,
        grouped.get(promotion.id) || []
      ));
    }

    async function loadWeeklySettlements() {
      const { data: headers, error: hErr } = await client.from('weekly_settlements').select('*');
      if (hErr) throw hErr;
      const { data: riders, error: rErr } = await client.from('weekly_settlement_riders').select('*');
      if (rErr) throw rErr;
      const grouped = new Map();
      (riders || []).forEach(row => {
        if (!grouped.has(row.weekly_settlement_id)) grouped.set(row.weekly_settlement_id, []);
        grouped.get(row.weekly_settlement_id).push(row);
      });
      return (headers || []).map(header => Mapper().rowsToWeeklySettlement(
        header,
        grouped.get(header.id) || []
      ));
    }

    async function loadMappings() {
      const { data, error } = await client.from('rider_name_mappings').select('*');
      if (error) throw error;
      return (data || []).map(row => Mapper().rowToMapping(row));
    }

    async function loadNotices() {
      const { data, error } = await client.from('notices').select('*');
      if (error) throw error;
      return (data || []).map(row => Mapper().rowToNotice(row));
    }

    async function loadKvStore() {
      const { data, error } = await client.from('system_kv_store').select('storage_key, value');
      if (error) throw error;
      (data || []).forEach(row => setCache(row.storage_key, row.value));
    }

    async function persistRiders(value) {
      const rows = (value || []).map(item => Mapper().riderToRow(item));
      if (!rows.length) return;
      const { error } = await client.from('riders').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }

    async function persistPromotionRules(value) {
      const promotions = [];
      const details = [];
      (value || []).forEach(rule => {
        const mapped = Mapper().promotionToRows(rule);
        promotions.push(mapped.promotion);
        details.push(...mapped.detailRules);
      });
      if (promotions.length) {
        const { error } = await client.from('promotions').upsert(promotions, { onConflict: 'id' });
        if (error) throw error;
      }
      if (details.length) {
        const ids = promotions.map(item => item.id);
        await client.from('promotion_rules').delete().in('promotion_id', ids);
        const { error } = await client.from('promotion_rules').insert(details);
        if (error) throw error;
      }
    }

    async function persistWeeklySettlements(value) {
      const regionRes = await client.from('regions').select('id, name, platform');
      const regionIdMap = new Map(
        (regionRes.data || []).map(row => [`${row.platform || 'all'}:${row.name}`, row.id])
      );
      for (const record of value || []) {
        const { header, riders } = Mapper().weeklySettlementToRows(record, regionIdMap);
        const { error: hErr } = await client.from('weekly_settlements').upsert(header, { onConflict: 'id' });
        if (hErr) throw hErr;
        await client.from('weekly_settlement_riders').delete().eq('weekly_settlement_id', header.id);
        if (riders.length) {
          const { error: rErr } = await client.from('weekly_settlement_riders').insert(riders);
          if (rErr) throw rErr;
        }
      }
    }

    async function persistMappings(value) {
      const rows = (value || []).map(item => Mapper().mappingToRow(item));
      if (!rows.length) return;
      const { error } = await client.from('rider_name_mappings').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }

    async function persistNotices(value) {
      const rows = (value || []).map(item => Mapper().noticeToRow(item));
      if (!rows.length) return;
      const { error } = await client.from('notices').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }

    async function persistKv(key, value) {
      const { error } = await client.from('system_kv_store').upsert({
        storage_key: key,
        value,
        updated_at: new Date().toISOString()
      }, { onConflict: 'storage_key' });
      if (error) throw error;
    }

    const persistHandlers = {
      [keys.drivers]: persistRiders,
      [keys.promotionRules]: persistPromotionRules,
      [keys.weeklySettlements]: persistWeeklySettlements,
      [keys.manualNameMappings]: persistMappings,
      [keys.notices]: persistNotices
    };

    async function hydrate() {
      setCache(keys.drivers, await loadRiders());
      setCache(keys.promotionRules, await loadPromotionRules());
      setCache(keys.weeklySettlements, await loadWeeklySettlements());
      setCache(keys.manualNameMappings, await loadMappings());
      setCache(keys.notices, await loadNotices());
      await loadKvStore();
      hydrated = true;
    }

    function queuePersist(key, value) {
      persistQueue = persistQueue.then(async () => {
        if (persistHandlers[key]) {
          await persistHandlers[key](value);
          return;
        }
        await persistKv(key, value);
      }).catch(error => {
        console.error('[BremSupabaseStorageAdapter] persist failed', key, error);
      });
      return persistQueue;
    }

    return {
      type: 'supabase',
      isHydrated() {
        return hydrated;
      },
      hydrate,
      flush() {
        return persistQueue;
      },
      read(key, fallback) {
        return getCache(key, fallback);
      },
      readRaw(key) {
        if (!cache.has(key)) return { exists: false, value: null };
        return { exists: true, value: cache.get(key) };
      },
      write(key, value) {
        setCache(key, value);
        queuePersist(key, value);
      },
      remove(key) {
        cache.delete(key);
      },
      has(key) {
        return cache.has(key);
      },
      listBremKeys() {
        return Array.from(cache.keys()).filter(key => key.startsWith('brem_')).sort();
      }
    };
  }

  return { createSupabaseAdapter };
})();
