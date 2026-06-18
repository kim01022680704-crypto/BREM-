/**
 * Supabase storage adapter
 *
 * localStorage와 같은 read/write 인터페이스를 제공한다.
 * - riders: 기사 데이터
 * - notices: 공지사항
 * - promotions: 프로모션
 * - settings: 관리자 설정 및 기타 BREM 저장 데이터
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
      const { data, error } = await client.from('riders').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(row => Mapper().rowToRider(row));
    }

    async function loadRiderInquiries() {
      const { data, error } = await client.from('rider_inquiries').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(row => Mapper().rowToInquiry(row));
    }

    async function loadNotices() {
      const { data, error } = await client.from('notices').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(row => Mapper().rowToNotice(row));
    }

    async function loadPromotions() {
      const { data, error } = await client.from('promotions').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(row => Mapper().rowToPromotion(row));
    }

    async function loadSettings() {
      const { data, error } = await client.from('settings').select('key, value');
      if (error) throw error;
      (data || []).forEach(row => setCache(row.key, row.value));
    }

    async function persistRiders(value) {
      const rows = (value || []).map(item => Mapper().riderToRow(item)).filter(row => row.id);
      await replaceTable('riders', rows);
    }

    async function persistRiderInquiries(value) {
      const rows = (value || []).map(item => Mapper().inquiryToRow(item)).filter(row => row.id);
      await replaceTable('rider_inquiries', rows);
    }

    async function persistNotices(value) {
      const rows = (value || []).map(item => Mapper().noticeToRow(item)).filter(row => row.id);
      await replaceTable('notices', rows);
    }

    async function persistPromotions(value) {
      const rows = (value || []).map(item => Mapper().promotionToRow(item)).filter(row => row.id);
      await replaceTable('promotions', rows);
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

    async function hydrate() {
      setCache(keys.drivers, await loadRiders());
      setCache(keys.notices, await loadNotices());
      setCache(keys.promotionRules, await loadPromotions());
      setCache(keys.riderInquiries, await loadRiderInquiries());
      await loadSettings();
      hydrated = true;
    }

    function queuePersist(key, value) {
      persistQueue = persistQueue.then(async () => {
        if (persistHandlers[key]) {
          await persistHandlers[key](value);
          return;
        }
        await persistSetting(key, value);
      });

      if (window.BREM_SUPABASE_CONFIG?.mode === 'production') {
        persistQueue = persistQueue.catch(error => {
          console.error('[BremSupabaseStorageAdapter] persist failed:', key, error);
          document.dispatchEvent(new CustomEvent('brem-storage-persist-error', {
            detail: { key, message: error.message || String(error) }
          }));
          throw error;
        });
      } else {
        persistQueue = persistQueue.catch(error => {
          console.error('[BremSupabaseStorageAdapter] persist failed, local cache kept:', key, error);
        });
      }

      return persistQueue;
    }

    function writeLocalBackup(key, value) {
      if (window.BREM_SUPABASE_CONFIG?.mode === 'production') return;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* local backup is best-effort */
      }
    }

    function removeLocalBackup(key) {
      if (window.BREM_SUPABASE_CONFIG?.mode === 'production') return;
      try {
        localStorage.removeItem(key);
      } catch {
        /* local backup is best-effort */
      }
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
        writeLocalBackup(key, value);
        return queuePersist(key, value);
      },
      remove(key) {
        cache.delete(key);
        removeLocalBackup(key);
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

  return { createSupabaseAdapter };
})();
