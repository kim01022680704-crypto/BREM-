(function () {
  const API_BASE = '/api/rider-inquiries';
  const LOCAL_KEY = 'brem_rider_inquiries';
  let apiAvailable = null;
  let configReady = null;

  function waitForConfig() {
    if (!configReady) {
      configReady = window.BremSupabaseConfig?.load
        ? window.BremSupabaseConfig.load()
        : Promise.resolve(window.BREM_SUPABASE_CONFIG || {});
    }
    return configReady;
  }

  function getConfig() {
    return window.BREM_SUPABASE_CONFIG || {};
  }

  function getStorage() {
    return window.BremStorage || (typeof BremStorage !== 'undefined' ? BremStorage : null);
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeLocal(list) {
    const next = Array.isArray(list) ? list : [];
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next));

    const storage = getStorage();
    if (storage?.riderInquiries?.persistList) {
      storage.riderInquiries.persistList(next);
    } else if (storage?.useLocalStorageAdapter) {
      storage.useLocalStorageAdapter();
      storage.riderInquiries?.persistList?.(next);
    }

    return next;
  }

  function mergeById(...lists) {
    const map = new Map();
    lists.flat().forEach(item => {
      if (item && item.id) map.set(item.id, item);
    });
    return Array.from(map.values()).sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      return bTime - aTime;
    });
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `inq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function allowLocalFallback() {
    const config = getConfig();
    return config.allowLocalFallback !== false && config.mode !== 'production';
  }

  async function checkApi() {
    if (apiAvailable !== null) return apiAvailable;
    await waitForConfig();
    try {
      const response = await fetch(API_BASE, { method: 'GET' });
      if (!response.ok) {
        apiAvailable = false;
        return false;
      }
      const data = await response.json();
      apiAvailable = Array.isArray(data);
      return apiAvailable;
    } catch {
      apiAvailable = false;
      return false;
    }
  }

  async function request(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
      let message = '요청에 실패했습니다.';
      try {
        const body = await response.json();
        message = body.error || message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    return response.json();
  }

  async function list() {
    await waitForConfig();
    const local = readLocal();

    if (!(await checkApi())) {
      if (!allowLocalFallback() && getConfig().inquiryStorage === 'supabase') {
        throw new Error('문의 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
      }
      return local;
    }

    try {
      const remote = await request(API_BASE);
      const merged = mergeById(local, Array.isArray(remote) ? remote : []);
      if (allowLocalFallback()) {
        writeLocal(merged);
      }
      return merged;
    } catch (error) {
      if (!allowLocalFallback()) throw error;
      return local;
    }
  }

  function createLocal(payload) {
    const storage = getStorage();
    if (storage?.useLocalStorageAdapter) {
      storage.useLocalStorageAdapter();
    }
    if (storage?.riderInquiries?.create) {
      return storage.riderInquiries.create(payload);
    }

    const record = {
      id: createId(),
      name: String(payload.name || '').trim(),
      phone: String(payload.phone || '').trim(),
      area: String(payload.area || '').trim(),
      inquiryType: String(payload.inquiryType || '라이더 지원').trim(),
      message: String(payload.message || '').trim(),
      status: 'new',
      createdAt: new Date().toISOString()
    };

    writeLocal([record, ...readLocal()]);
    return record;
  }

  async function syncCreate(payload) {
    if (!(await checkApi())) return null;
    try {
      return await request(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch {
      return null;
    }
  }

  async function create(payload) {
    await waitForConfig();

    if (await checkApi()) {
      try {
        const saved = await request(API_BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (allowLocalFallback()) {
          const merged = mergeById([saved], readLocal());
          writeLocal(merged);
        }
        return saved;
      } catch (error) {
        if (!allowLocalFallback()) throw error;
      }
    }

    if (!allowLocalFallback()) {
      throw new Error('문의 접수에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }

    const record = createLocal(payload);
    const saved = await syncCreate(payload);
    if (saved && saved.id) {
      const merged = mergeById([saved], readLocal().filter(item => item.id !== record.id));
      writeLocal(merged);
      return saved;
    }
    return record;
  }

  async function updateStatus(id, status) {
    await waitForConfig();

    if (await checkApi()) {
      try {
        return await request(`${API_BASE}/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
      } catch (error) {
        if (!allowLocalFallback()) throw error;
      }
    }

    const next = readLocal().map(item => (
      item.id === id
        ? { ...item, status: String(status || 'new'), updatedAt: new Date().toISOString() }
        : item
    ));
    writeLocal(next);
    return list();
  }

  async function remove(id) {
    await waitForConfig();

    if (await checkApi()) {
      try {
        return await request(`${API_BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch (error) {
        if (!allowLocalFallback()) throw error;
      }
    }

    writeLocal(readLocal().filter(item => item.id !== id));
    return list();
  }

  window.BremRiderInquiryApi = {
    list,
    create,
    createLocal,
    syncCreate,
    updateStatus,
    remove,
    ready: waitForConfig()
  };
})();
