/**
 * Supabase storage adapter — lazy load + column-pruned queries
 */
window.BremSupabaseStorageAdapter = (function () {
  const Mapper = () => window.BremSupabaseMapper;

  const DEFAULT_RIDER_PAGE_SIZE = 100;

  const RIDER_SELECT = [
    'id', 'auth_user_id', 'name', 'phone', 'resident_number', 'bank_name', 'account_holder',
    'account_number', 'baemin_id', 'platform_coupang', 'platform_baemin',
    'long_event_item_id', 'long_event_item', 'long_event_start_date', 'join_date',
    'status', 'memo', 'hidden_fields', 'promotion_selector_coupang', 'promotion_selector_baemin',
    'promotion_rule_id_coupang', 'promotion_rule_id_baemin', 'created_at', 'updated_at'
  ].join(',');

  const NOTICE_SELECT = 'id,title,content,pinned,created_at,updated_at';
  const PROMOTION_SELECT = 'id,name,platform,type,enabled,selector_key,start_date,end_date,priority,payload,created_at,updated_at';
  const INQUIRY_SELECT = 'id,name,phone,area,inquiry_type,message,status,created_at,updated_at';

  const TABLE_KEYS = new Set();

  function mergeRidersById(existing, incoming) {
    const map = new Map((existing || []).map(item => [item.id, item]));
    (incoming || []).forEach(item => {
      const prev = map.get(item.id) || {};
      map.set(item.id, { ...prev, ...item });
    });
    return Array.from(map.values()).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  function createSupabaseAdapter(client, keys) {
    const cache = new Map();
    let coreHydrated = false;
    const loadedTableKeys = new Set();
    const keyLoadPromises = new Map();
    let persistQueue = Promise.resolve();
    let ridersMeta = { total: 0, hasMore: false, pageSize: DEFAULT_RIDER_PAGE_SIZE, offset: 0 };

    TABLE_KEYS.clear();
    [keys.drivers, keys.notices, keys.promotionRules, keys.riderInquiries].forEach(key => TABLE_KEYS.add(key));

    function setCache(key, value) {
      cache.set(key, value);
    }

    function getCache(key, fallback) {
      return cache.has(key) ? cache.get(key) : fallback;
    }

    function isTableKey(key) {
      return TABLE_KEYS.has(key);
    }

    async function loadSettings() {
      window.BremPerf?.time?.('settings.fetch');
      const { data, error } = await client.from('settings').select('key,value').order('key');
      window.BremPerf?.timeEnd?.('settings.fetch');
      if (error) throw error;
      (data || []).forEach(row => setCache(row.key, row.value));
    }

    async function loadNotices(options = {}) {
      window.BremPerf?.time?.('notices.fetch');
      const limit = Number(options.limit) > 0 ? Number(options.limit) : null;
      let query = client
        .from('notices')
        .select(NOTICE_SELECT)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false });
      if (limit) query = query.limit(limit);
      const { data, error } = await query;
      window.BremPerf?.timeEnd?.('notices.fetch');
      if (error) throw error;
      const value = (data || []).map(row => Mapper().rowToNotice(row));
      if (options.append && cache.has(keys.notices)) {
        const merged = new Map(getCache(keys.notices, []).map(item => [item.id, item]));
        value.forEach(item => merged.set(item.id, item));
        setCache(keys.notices, Array.from(merged.values()));
      } else {
        setCache(keys.notices, value);
      }
      loadedTableKeys.add(keys.notices);
      return value;
    }

    async function loadPromotions() {
      window.BremPerf?.time?.('promotions.fetch');
      const { data, error } = await client
        .from('promotions')
        .select(PROMOTION_SELECT)
        .order('created_at', { ascending: false });
      window.BremPerf?.timeEnd?.('promotions.fetch');
      if (error) throw error;
      const value = (data || []).map(row => Mapper().rowToPromotion(row));
      setCache(keys.promotionRules, value);
      loadedTableKeys.add(keys.promotionRules);
      return value;
    }

    async function loadRiderInquiries() {
      window.BremPerf?.time?.('riderInquiries.fetch');
      const { data, error } = await client
        .from('rider_inquiries')
        .select(INQUIRY_SELECT)
        .order('created_at', { ascending: false });
      window.BremPerf?.timeEnd?.('riderInquiries.fetch');
      if (error) throw error;
      const value = (data || []).map(row => Mapper().rowToInquiry(row));
      setCache(keys.riderInquiries, value);
      loadedTableKeys.add(keys.riderInquiries);
      return value;
    }

    async function loadRiders(options = {}) {
      window.BremPerf?.time?.('riders.fetch');
      const pageSize = Math.min(Math.max(Number(options.limit) || DEFAULT_RIDER_PAGE_SIZE, 1), 200);
      const offset = Math.max(Number(options.offset) || 0, 0);
      const append = options.append === true;

      let query = client
        .from('riders')
        .select(RIDER_SELECT, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      const status = String(options.status || '').trim();
      const search = String(options.search || '').trim();
      if (status && status !== '전체') query = query.eq('status', status);
      if (search) query = query.ilike('name', `%${search}%`);

      const { data, error, count } = await query;
      window.BremPerf?.timeEnd?.('riders.fetch');
      if (error) throw error;

      const page = (data || []).map(row => Mapper().rowToRider(row));
      const merged = append ? mergeRidersById(getCache(keys.drivers, []), page) : page;
      setCache(keys.drivers, merged);
      ridersMeta = {
        total: count ?? merged.length,
        hasMore: offset + page.length < (count ?? 0),
        pageSize,
        offset
      };
      loadedTableKeys.add(keys.drivers);
      return { riders: merged, meta: ridersMeta };
    }

    async function loadKey(key, options = {}) {
      if (key === keys.drivers) return loadRiders(options);
      if (key === keys.notices) return loadNotices(options);
      if (key === keys.promotionRules) return loadPromotions();
      if (key === keys.riderInquiries) return loadRiderInquiries();
      return null;
    }

    async function ensureKeysLoaded(targetKeys = [], options = {}) {
      await hydrateCore();
      const unique = [...new Set((targetKeys || []).filter(isTableKey))];
      const missing = unique.filter(key => !loadedTableKeys.has(key));
      if (!missing.length) return { ok: true, cached: true };

      window.BremPerf?.time?.('storage.ensureKeysLoaded');
      await Promise.all(missing.map(key => {
        if (keyLoadPromises.has(key)) return keyLoadPromises.get(key);
        const promise = loadKey(key, options[key] || options).finally(() => {
          keyLoadPromises.delete(key);
        });
        keyLoadPromises.set(key, promise);
        return promise;
      }));
      window.BremPerf?.timeEnd?.('storage.ensureKeysLoaded');
      return { ok: true };
    }

    function invalidateKeys(targetKeys = []) {
      (targetKeys || []).forEach(key => {
        if (!isTableKey(key)) return;
        loadedTableKeys.delete(key);
        keyLoadPromises.delete(key);
      });
    }

    async function hydrateCore() {
      if (coreHydrated) return;
      window.BremPerf?.time?.('storage.hydrateCore');
      await loadSettings();
      coreHydrated = true;
      window.BremPerf?.timeEnd?.('storage.hydrateCore');
    }

    async function hydrate(options = {}) {
      const skip = new Set(options.skipKeys || []);
      window.BremPerf?.time?.('storage.hydrate');
      await hydrateCore();

      const tasks = [];
      if (!skip.has(keys.drivers)) {
        tasks.push(loadRiders({ limit: DEFAULT_RIDER_PAGE_SIZE }));
      } else {
        setCache(keys.drivers, getCache(keys.drivers, []));
      }
      if (!skip.has(keys.notices)) tasks.push(loadNotices());
      if (!skip.has(keys.promotionRules)) tasks.push(loadPromotions());
      if (!skip.has(keys.riderInquiries)) tasks.push(loadRiderInquiries());

      if (tasks.length) await Promise.all(tasks);
      window.BremPerf?.timeEnd?.('storage.hydrate');
    }

    async function upsertRider(driver) {
      const row = Mapper().riderToRow(driver);
      if (!row.id) throw new Error('기사 ID가 없습니다.');
      const { error } = await client.from('riders').upsert(row, { onConflict: 'id' });
      if (error) throw error;
    }

    async function persistRiders(value) {
      const rows = (value || []).map(item => Mapper().riderToRow(item)).filter(row => row.id);
      if (!rows.length) return;
      const { error } = await client.from('riders').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }

    async function deleteRider(id) {
      const riderId = String(id || '').trim();
      if (!riderId) return;
      const { error } = await client.from('riders').delete().eq('id', riderId);
      if (error) throw error;
    }

    async function reloadRiders(options = {}) {
      invalidateKeys([keys.drivers]);
      return loadRiders(options);
    }

    async function persistRiderInquiries(value) {
      const rows = (value || []).map(item => Mapper().inquiryToRow(item)).filter(row => row.id);
      await replaceTable('rider_inquiries', rows);
      loadedTableKeys.add(keys.riderInquiries);
    }

    async function persistNotices(value) {
      const rows = (value || []).map(item => Mapper().noticeToRow(item)).filter(row => row.id);
      await replaceTable('notices', rows);
      loadedTableKeys.add(keys.notices);
    }

    async function persistPromotions(value) {
      const rows = (value || []).map(item => Mapper().promotionToRow(item)).filter(row => row.id);
      await replaceTable('promotions', rows);
      loadedTableKeys.add(keys.promotionRules);
    }

    async function replaceTable(table, rows) {
      const { error: deleteError } = await client.from(table).delete().neq('id', '__never__');
      if (deleteError) throw deleteError;
      if (!rows.length) return;
      const { error } = await client.from(table).upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }

    async function persistSetting(key, value) {
      const { error } = await client.from('settings').upsert({
        key,
        value,
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });
      if (error) throw error;
    }

    const persistHandlers = {
      [keys.drivers]: persistRiders,
      [keys.notices]: persistNotices,
      [keys.promotionRules]: persistPromotions,
      [keys.riderInquiries]: persistRiderInquiries
    };

    function queuePersist(key, value) {
      persistQueue = persistQueue.then(async () => {
        if (persistHandlers[key]) {
          await persistHandlers[key](value);
        } else {
          await persistSetting(key, value);
        }
      });

      persistQueue = persistQueue.catch(error => {
        document.dispatchEvent(new CustomEvent('brem-storage-persist-error', {
          detail: { key, message: error.message || String(error) }
        }));
        throw error;
      });

      return persistQueue;
    }

    function stage(key, value) {
      setCache(key, value);
      if (isTableKey(key)) loadedTableKeys.add(key);
    }

    return {
      type: 'supabase',
      isHydrated() {
        return coreHydrated;
      },
      isKeyLoaded(key) {
        return !isTableKey(key) || loadedTableKeys.has(key);
      },
      getRidersMeta() {
        return { ...ridersMeta };
      },
      hydrate,
      hydrateCore,
      ensureKeysLoaded,
      invalidateKeys,
      reloadRiders,
      deleteRider,
      upsertRider,
      stage,
      enqueuePersist(key, value) {
        return queuePersist(key, value);
      },
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
        stage(key, value);
        return queuePersist(key, value);
      },
      remove(key) {
        cache.delete(key);
        invalidateKeys([key]);
        persistQueue = persistQueue.then(async () => {
          if (key === keys.drivers) await replaceTable('riders', []);
          else if (key === keys.notices) await replaceTable('notices', []);
          else if (key === keys.promotionRules) await replaceTable('promotions', []);
          else if (key === keys.riderInquiries) await replaceTable('rider_inquiries', []);
          else await client.from('settings').delete().eq('key', key);
        }).catch(error => {
          console.error('[BremSupabaseStorageAdapter] remove failed:', key, error);
        });
      },
      has(key) {
        return cache.has(key);
      },
      listBremKeys() {
        return Array.from(cache.keys()).filter(key => key.startsWith('brem_')).sort();
      }
    };
  }

  return { createSupabaseAdapter, DEFAULT_RIDER_PAGE_SIZE };
})();
