/**
 * Supabase storage adapter — lazy load + column-pruned queries
 */
window.BremSupabaseStorageAdapter = (function () {
  const Mapper = () => window.BremSupabaseMapper;

  const DEFAULT_RIDER_PAGE_SIZE = 100;

  const RIDER_SELECT_BASE = [
    'id', 'auth_user_id', 'name', 'phone', 'resident_number', 'bank_name', 'account_holder',
    'account_number', 'baemin_id', 'platform_coupang', 'platform_baemin',
    'long_event_item_id', 'long_event_item', 'long_event_start_date', 'join_date',
    'status', 'memo', 'hidden_fields', 'promotion_selector_coupang', 'promotion_selector_baemin',
    'promotion_rule_id_coupang', 'promotion_rule_id_baemin',
    'created_at', 'updated_at'
  ].join(',');

  const RIDER_SELECT_WITH_PLATFORM = [
    'id', 'auth_user_id', 'name', 'phone', 'resident_number', 'bank_name', 'account_holder',
    'account_number', 'baemin_id', 'platform_coupang', 'platform_baemin',
    'long_event_item_id', 'long_event_item', 'long_event_start_date', 'long_event_platform', 'join_date',
    'status', 'memo', 'hidden_fields', 'promotion_selector_coupang', 'promotion_selector_baemin',
    'promotion_rule_id_coupang', 'promotion_rule_id_baemin',
    'created_at', 'updated_at'
  ].join(',');

  const RIDER_SELECT = [
    'id', 'auth_user_id', 'name', 'phone', 'resident_number', 'bank_name', 'account_holder',
    'account_number', 'baemin_id', 'platform_coupang', 'platform_baemin',
    'long_event_item_id', 'long_event_item', 'long_event_start_date', 'long_event_platform', 'join_date',
    'status', 'memo', 'hidden_fields', 'promotion_selector_coupang', 'promotion_selector_baemin',
    'promotion_rule_id_coupang', 'promotion_rule_id_baemin',
    'selected_mission_id', 'selected_mission_id_baemin', 'selected_mission_id_coupang',
    'created_at', 'updated_at'
  ].join(',');

  const RIDER_SELECT_VARIANTS = [RIDER_SELECT, RIDER_SELECT_WITH_PLATFORM, RIDER_SELECT_BASE];

  function isMissingRiderColumnError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('does not exist') || message.includes('column');
  }

  function stripOptionalRiderColumns(row) {
    delete row.selected_mission_id;
    delete row.selected_mission_id_baemin;
    delete row.selected_mission_id_coupang;
    delete row.long_event_platform;
  }

  async function queryRidersWithSelectFallback(runQuery) {
    let lastResult = null;
    for (const selectColumns of RIDER_SELECT_VARIANTS) {
      lastResult = await runQuery(selectColumns);
      if (!lastResult?.error) {
        return { ...lastResult, selectColumns };
      }
      if (!isMissingRiderColumnError(lastResult.error)) break;
    }
    return lastResult || { error: new Error('기사 목록을 불러오지 못했습니다.') };
  }

  const NOTICE_SELECT = 'id,title,content,pinned,created_at,updated_at';
  const PROMOTION_SELECT = 'id,name,platform,type,enabled,selector_key,start_date,end_date,priority,payload,created_at,updated_at';
  const INQUIRY_SELECT = 'id,name,phone,area,inquiry_type,message,status,created_at,updated_at';
  const MISSION_SELECT = 'id,title,description,type,conditions,is_active,raw_data,created_at,updated_at';

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
    [keys.drivers, keys.notices, keys.promotionRules, keys.riderInquiries, keys.missions].forEach(key => TABLE_KEYS.add(key));

    function setCache(key, value) {
      cache.set(key, value);
    }

    function getCache(key, fallback) {
      return cache.has(key) ? cache.get(key) : fallback;
    }

    function isTableKey(key) {
      return TABLE_KEYS.has(key);
    }

    async function upsertRiderRows(rows) {
      if (!rows.length) return;
      let payload = rows;
      let { error } = await client.from('riders').upsert(payload, { onConflict: 'id' });
      if (error && isMissingRiderColumnError(error)) {
        payload = rows.map(row => {
          const next = { ...row };
          stripOptionalRiderColumns(next);
          return next;
        });
        ({ error } = await client.from('riders').upsert(payload, { onConflict: 'id' }));
      }
      if (error) throw error;
    }

    async function loadSettings() {
      window.BremPerf?.time?.('settings.fetch');
      const { data, error } = await client.from('settings').select('key,value').order('key');
      window.BremPerf?.timeEnd?.('settings.fetch');
      if (error) throw error;
      (data || []).forEach(row => {
        setCache(row.key, row.value);
        if (!isTableKey(row.key)) {
          window.BremDataCache?.set?.(row.key, row.value);
        }
      });
    }

    async function loadNotices(options = {}) {
      if (!options.force && window.BremDataCache?.isValid(keys.notices)) {
        const cached = window.BremDataCache.getData(keys.notices);
        if (Array.isArray(cached)) {
          setCache(keys.notices, cached);
          loadedTableKeys.add(keys.notices);
          return cached;
        }
      }

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
      window.BremDataCache?.set?.(keys.notices, getCache(keys.notices, value));
      return value;
    }

    async function loadPromotions(options = {}) {
      if (!options.force && window.BremDataCache?.isValid(keys.promotionRules)) {
        const cached = window.BremDataCache.getData(keys.promotionRules);
        if (Array.isArray(cached)) {
          setCache(keys.promotionRules, cached);
          loadedTableKeys.add(keys.promotionRules);
          return cached;
        }
      }

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
      window.BremDataCache?.set?.(keys.promotionRules, value);
      return value;
    }

    async function loadMissions(options = {}) {
      if (!options.force && window.BremDataCache?.isValid(keys.missions)) {
        const cached = window.BremDataCache.getData(keys.missions);
        if (Array.isArray(cached)) {
          setCache(keys.missions, cached);
          loadedTableKeys.add(keys.missions);
          return cached;
        }
      }

      window.BremPerf?.time?.('missions.fetch');
      const { data, error } = await client
        .from('missions')
        .select(MISSION_SELECT)
        .order('created_at', { ascending: true });
      window.BremPerf?.timeEnd?.('missions.fetch');
      if (error) throw error;
      const value = (data || []).map(row => Mapper().rowToMission(row));
      setCache(keys.missions, value);
      loadedTableKeys.add(keys.missions);
      window.BremDataCache?.set?.(keys.missions, value, { tableLoaded: true });
      return value;
    }

    async function loadRiderInquiries(options = {}) {
      if (!options.force && window.BremDataCache?.isValid(keys.riderInquiries)) {
        const cached = window.BremDataCache.getData(keys.riderInquiries);
        if (Array.isArray(cached)) {
          setCache(keys.riderInquiries, cached);
          loadedTableKeys.add(keys.riderInquiries);
          return cached;
        }
      }

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
      window.BremDataCache?.set?.(keys.riderInquiries, value);
      return value;
    }

    async function loadRiders(options = {}) {
      const force = options.force === true;
      const append = options.append === true;
      const hasFilter = Boolean(String(options.search || '').trim())
        || (options.status && options.status !== '전체');

      if (!force && !append && !hasFilter && window.BremDataCache?.isValid(keys.drivers)) {
        const cached = window.BremDataCache.getData(keys.drivers);
        if (Array.isArray(cached)) {
          setCache(keys.drivers, cached);
          loadedTableKeys.add(keys.drivers);
          ridersMeta = {
            total: cached.length,
            hasMore: false,
            pageSize: DEFAULT_RIDER_PAGE_SIZE,
            offset: 0
          };
          return { riders: cached, meta: ridersMeta, cached: true };
        }
      }

      window.BremPerf?.time?.('riders.fetch');
      const pageSize = Math.min(Math.max(Number(options.limit) || DEFAULT_RIDER_PAGE_SIZE, 1), 200);
      const offset = Math.max(Number(options.offset) || 0, 0);

      const status = String(options.status || '').trim();
      const search = String(options.search || '').trim();

      const { data, error, count } = await queryRidersWithSelectFallback(selectColumns => {
        let nextQuery = client
          .from('riders')
          .select(selectColumns, { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (status && status !== '전체') nextQuery = nextQuery.eq('status', status);
        if (search) nextQuery = nextQuery.ilike('name', `%${search}%`);
        return nextQuery;
      });
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
      if (!append && !hasFilter) {
        window.BremDataCache?.set?.(keys.drivers, merged);
      }
      return { riders: merged, meta: ridersMeta };
    }

    async function loadKey(key, options = {}) {
      if (key === keys.drivers) return loadRiders(options);
      if (key === keys.notices) return loadNotices(options);
      if (key === keys.promotionRules) return loadPromotions(options);
      if (key === keys.riderInquiries) return loadRiderInquiries(options);
      if (key === keys.missions) return loadMissions(options);
      return null;
    }

    async function ensureKeysLoaded(targetKeys = [], options = {}) {
      await hydrateCore();
      const unique = [...new Set((targetKeys || []).filter(isTableKey))];
      const force = options.force === true;
      const missing = [];

      unique.forEach(key => {
        if (force) {
          loadedTableKeys.delete(key);
          missing.push(key);
          return;
        }
        if (loadedTableKeys.has(key)) {
          if (window.BremDataCache?.isValid(key)) return;
          loadedTableKeys.delete(key);
        }

        const cached = window.BremDataCache?.getData(key);
        if (Array.isArray(cached)) {
          setCache(key, cached);
          loadedTableKeys.add(key);
          return;
        }

        missing.push(key);
      });

      if (!missing.length) return { ok: true, cached: true };

      window.BremPerf?.time?.('storage.ensureKeysLoaded');
      await Promise.all(missing.map(key => window.BremDataCache.runOnce(`load:${key}`, () => loadKey(key, {
        ...(options[key] || options),
        force
      }))));
      window.BremPerf?.timeEnd?.('storage.ensureKeysLoaded');
      return { ok: true };
    }

    function invalidateKeys(targetKeys = []) {
      (targetKeys || []).forEach(key => {
        if (!isTableKey(key)) return;
        loadedTableKeys.delete(key);
        keyLoadPromises.delete(key);
        window.BremDataCache?.invalidate?.(key);
      });
    }

    async function hydrateCore() {
      if (coreHydrated) return;

      if (window.BremDataCache?.isCoreReady?.()) {
        const snapshot = window.BremDataCache.getData('__settings_snapshot__');
        if (Array.isArray(snapshot) && snapshot.length) {
          let restored = 0;
          snapshot.forEach(key => {
            if (isTableKey(key)) return;
            const cached = window.BremDataCache.getData(key);
            if (cached !== null && cached !== undefined) {
              setCache(key, cached);
              restored += 1;
            }
          });
          if (restored > 0) {
            coreHydrated = true;
            return;
          }
        }
      }

      window.BremPerf?.time?.('storage.hydrateCore');
      await loadSettings();
      coreHydrated = true;
      window.BremDataCache?.markCoreReady?.();
      window.BremDataCache?.set?.('__settings_snapshot__', Array.from(cache.keys()).filter(key => !isTableKey(key)));
      window.BremPerf?.timeEnd?.('storage.hydrateCore');
    }

    async function reloadSettingKey(key) {
      const { data, error } = await client.from('settings').select('key,value').eq('key', key).maybeSingle();
      if (error) throw error;
      if (data) {
        setCache(key, data.value);
        window.BremDataCache?.set?.(key, data.value);
      }
      return data?.value ?? null;
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
      await upsertRiderRows([row]);
    }

    async function persistRiders(value) {
      const rows = (value || []).map(item => Mapper().riderToRow(item)).filter(row => row.id);
      if (!rows.length) return;
      await upsertRiderRows(rows);
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

    async function upsertTableRows(table, rows) {
      if (!rows.length) return;
      const { error } = await client.from(table).upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }

    async function deleteTableRow(table, id) {
      const rowId = String(id || '').trim();
      if (!rowId) return;
      const { error } = await client.from(table).delete().eq('id', rowId);
      if (error) throw error;
    }

    const TABLE_BY_KEY = {
      [keys.notices]: 'notices',
      [keys.promotionRules]: 'promotions',
      [keys.riderInquiries]: 'rider_inquiries',
      [keys.missions]: 'missions'
    };

    function validatePersistPayload(key, value, options = {}) {
      const guard = window.BremStorageGuard;
      if (!guard) return { ok: true };
      return guard.validatePersist(key, value, options);
    }

    async function persistMissions(value) {
      const rows = (value || []).map(item => Mapper().missionToRow(item)).filter(row => row.id);
      const check = validatePersistPayload(keys.missions, value);
      if (!check.ok) {
        window.BremStorageGuard?.logBlocked?.(check);
        throw new Error(check.message || '미션 저장이 차단되었습니다.');
      }
      await upsertTableRows('missions', rows);
      loadedTableKeys.add(keys.missions);
    }

    async function upsertMission(mission) {
      const row = Mapper().missionToRow(mission);
      if (!row.id) throw new Error('미션 ID가 없습니다.');
      const { error } = await client.from('missions').upsert(row, { onConflict: 'id' });
      if (error) throw error;

      const list = getCache(keys.missions, []);
      const exists = list.some(item => item.id === mission.id);
      const next = exists
        ? list.map(item => (item.id === mission.id ? mission : item))
        : [mission, ...list];
      setCache(keys.missions, next);
      loadedTableKeys.add(keys.missions);
      window.BremDataCache?.set?.(keys.missions, next);
      return mission;
    }

    async function fetchMissionById(id) {
      const missionId = String(id || '').trim();
      if (!missionId) return null;
      const { data, error } = await client
        .from('missions')
        .select(MISSION_SELECT)
        .eq('id', missionId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const mission = Mapper().rowToMission(data);
      const list = getCache(keys.missions, []);
      const next = list.some(item => item.id === mission.id)
        ? list.map(item => (item.id === mission.id ? mission : item))
        : [...list, mission];
      setCache(keys.missions, next);
      window.BremDataCache?.set?.(keys.missions, next);
      loadedTableKeys.add(keys.missions);
      return mission;
    }

    async function persistRiderInquiries(value) {
      const rows = (value || []).map(item => Mapper().inquiryToRow(item)).filter(row => row.id);
      const check = validatePersistPayload(keys.riderInquiries, value);
      if (!check.ok) {
        window.BremStorageGuard?.logBlocked?.(check);
        throw new Error(check.message || '문의 저장이 차단되었습니다.');
      }
      await upsertTableRows('rider_inquiries', rows);
      loadedTableKeys.add(keys.riderInquiries);
    }

    async function persistNotices(value) {
      const rows = (value || []).map(item => Mapper().noticeToRow(item)).filter(row => row.id);
      const check = validatePersistPayload(keys.notices, value);
      if (!check.ok) {
        window.BremStorageGuard?.logBlocked?.(check);
        throw new Error(check.message || '공지 저장이 차단되었습니다.');
      }
      await upsertTableRows('notices', rows);
      loadedTableKeys.add(keys.notices);
    }

    async function persistPromotions(value) {
      const rows = (value || []).map(item => Mapper().promotionToRow(item)).filter(row => row.id);
      const check = validatePersistPayload(keys.promotionRules, value);
      if (!check.ok) {
        window.BremStorageGuard?.logBlocked?.(check);
        throw new Error(check.message || '프로모션 저장이 차단되었습니다.');
      }
      await upsertTableRows('promotions', rows);
      loadedTableKeys.add(keys.promotionRules);
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
      [keys.riderInquiries]: persistRiderInquiries,
      [keys.missions]: persistMissions
    };

    function queuePersist(key, value, options = {}) {
      persistQueue = persistQueue.then(async () => {
        const check = validatePersistPayload(key, value, options);
        if (!check.ok) {
          window.BremStorageGuard?.logBlocked?.(check);
          throw new Error(check.message || '데이터 저장이 보호 정책에 의해 차단되었습니다.');
        }
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
      if (isTableKey(key)) {
        loadedTableKeys.add(key);
        window.BremDataCache?.set?.(key, value, { tableLoaded: true });
      }
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
      reloadSettingKey,
      fetchMissionById,
      deleteRider,
      deleteTableRow,
      upsertMission,
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
        if (isTableKey(key)) {
          const guard = window.BremStorageGuard;
          if (guard?.isProductionMode?.()) {
            console.error('[BREM Data Guard] 운영 환경에서 테이블 전체 삭제(remove)는 차단됩니다:', key);
            guard?.logBlocked?.({ message: `[데이터 보호] ${key} 전체 삭제가 차단되었습니다.` });
            return;
          }
          cache.delete(key);
          invalidateKeys([key]);
          return;
        }
        cache.delete(key);
        invalidateKeys([key]);
        persistQueue = persistQueue.then(async () => {
          await client.from('settings').delete().eq('key', key);
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
