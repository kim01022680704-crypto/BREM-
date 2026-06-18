(function () {
  const API_BASE = '/api/rider-inquiries';
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

  function getStorage() {
    return window.BremStorage || (typeof BremStorage !== 'undefined' ? BremStorage : null);
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

  async function listFromStorage() {
    const storage = getStorage();
    if (storage?.riderInquiries?.getAll) {
      return storage.riderInquiries.getAll();
    }
    return [];
  }

  async function list() {
    await waitForConfig();

    if (await checkApi()) {
      try {
        const remote = await request(API_BASE);
        return Array.isArray(remote) ? remote : [];
      } catch (error) {
        console.error('[BREM] Inquiry API list failed:', error);
      }
    }

    const cached = await listFromStorage();
    if (cached.length) return cached;

    throw new Error('문의 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
  }

  async function create(payload) {
    await waitForConfig();

    if (await checkApi()) {
      return request(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const storage = getStorage();
    if (storage?.riderInquiries?.create) {
      return storage.riderInquiries.create(payload);
    }

    throw new Error('문의 접수에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }

  async function updateStatus(id, status) {
    await waitForConfig();

    if (await checkApi()) {
      return request(`${API_BASE}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
    }

    const storage = getStorage();
    if (storage?.riderInquiries?.updateStatus) {
      storage.riderInquiries.updateStatus(id, status);
      return listFromStorage();
    }

    throw new Error('문의 상태 변경에 실패했습니다.');
  }

  async function remove(id) {
    await waitForConfig();

    if (await checkApi()) {
      return request(`${API_BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }

    const storage = getStorage();
    if (storage?.riderInquiries?.remove) {
      storage.riderInquiries.remove(id);
      return listFromStorage();
    }

    throw new Error('문의 삭제에 실패했습니다.');
  }

  window.BremRiderInquiryApi = {
    list,
    create,
    updateStatus,
    remove,
    ready: waitForConfig()
  };
})();
