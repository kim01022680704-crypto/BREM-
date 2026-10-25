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

  async function updateInquiry(id, patch = {}) {
    await waitForConfig();

    if (await checkApi()) {
      return request(`${API_BASE}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch || {})
      });
    }

    const storage = getStorage();
    if (storage?.riderInquiries?.updateInquiry) {
      return storage.riderInquiries.updateInquiry(id, patch);
    }
    if (storage?.riderInquiries?.updateStatus && patch.status) {
      storage.riderInquiries.updateStatus(id, patch.status);
      return listFromStorage();
    }

    throw new Error('문의 상태 변경에 실패했습니다.');
  }

  async function updateStatus(id, status) {
    return updateInquiry(id, { status });
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function currentAdmin() {
    const account = window.BremStorage?.auth?.getAdminSessionAccount?.() || null;
    const loginId = String(account?.name || account?.loginName || '').trim() || '관리자';
    return { id: String(account?.id || '').trim(), name: loginId, loginId };
  }

  function loginLabel(value) {
    const loginId = String(value || '').trim();
    return loginId ? `아이디 ${loginId}` : '';
  }

  function typingName(inquiry, now = Date.now()) {
    const at = Date.parse(inquiry?.replyingAt || '');
    if (!Number.isFinite(at) || now - at > 40000) return '';
    const me = currentAdmin();
    if (me.id && String(inquiry?.replyingById || '') === me.id) return '';
    return String(inquiry?.replyingBy || '다른 관리자');
  }

  function replySeen(inquiry) {
    if (!inquiry?.adminReply || !inquiry?.riderAckAt) return false;
    const ack = Date.parse(inquiry.riderAckAt);
    if (!Number.isFinite(ack)) return false;
    const replied = Date.parse(inquiry.adminRepliedAt || '');
    if (!Number.isFinite(replied)) return true;
    return ack >= replied - 2000;
  }

  function inquiryMenu(inquiry) {
    if (inquiry?.status === 'done') return 'done';
    if (replySeen(inquiry)) return 'ack';
    return 'open';
  }

  function menuCounts(list) {
    const counts = { open: 0, ack: 0, done: 0 };
    (list || []).forEach(item => {
      const key = inquiryMenu(item);
      if (counts[key] != null) counts[key] += 1;
    });
    return counts;
  }

  function statusLabel(inquiry) {
    const parts = [];
    if (inquiry?.adminReply) parts.push('답장함');
    if (inquiry?.status === 'done') parts.push('처리완료');
    if (replySeen(inquiry)) parts.push('답장확인');
    if (!parts.length && inquiry?.status === 'read') parts.push('확인중');
    if (!parts.length) parts.push('미확인');
    return parts.join(' · ');
  }

  function statusClass(inquiry) {
    if (inquiry?.adminReply) return 'inquiry-badge inquiry-badge--reply';
    if (inquiry?.status === 'done') return 'inquiry-badge inquiry-badge--done';
    if (replySeen(inquiry)) return 'inquiry-badge inquiry-badge--ack';
    if (inquiry?.status === 'read') return 'inquiry-badge inquiry-badge--read';
    return 'inquiry-badge inquiry-badge--new';
  }

  function listExtraHtml(inquiry) {
    const typing = typingName(inquiry);
    const parts = [];
    if (typing) {
      parts.push(`<p class="inquiry-typing">${escapeHtml(loginLabel(typing))} 답장 쓰는 중</p>`);
    }
    if (inquiry?.adminReply) {
      const who = loginLabel(inquiry.adminReplyBy);
      const when = String(inquiry.adminRepliedAt || '').replace('T', ' ').slice(0, 16);
      const preview = String(inquiry.adminReply).replace(/\s+/g, ' ').slice(0, 90);
      const head = who || '답장함';
      parts.push(`<p class="inquiry-reply-preview"><strong>${escapeHtml(head)}</strong>${when ? ` · ${escapeHtml(when)}` : ''} · ${escapeHtml(preview)}</p>`);
    }
    return parts.join('');
  }

  function replyNote(inquiry) {
    const typing = typingName(inquiry);
    if (typing) return `${loginLabel(typing)} 답장 쓰는 중입니다. 겹치면 한쪽 답장이 사라질 수 있습니다.`;
    if (replySeen(inquiry)) {
      const who = loginLabel(inquiry.adminReplyBy || '관리자');
      const when = String(inquiry.riderAckAt || '').replace('T', ' ').slice(0, 16);
      return `${who} 답장을 기사가 답장확인 했습니다.${when ? ` (${when})` : ''}`;
    }
    if (inquiry?.adminReply) {
      const who = loginLabel(inquiry.adminReplyBy);
      return who
        ? `${who} 답장입니다. 다시 보내면 그 답장이 바뀝니다.`
        : '답장을 보냈습니다. 다시 보내면 그 답장이 바뀝니다.';
    }
    return '답장을 보내면 기사앱에 보이고, 관리자 화면에는 로그인한 아이디가 남습니다.';
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
    updateInquiry,
    updateStatus,
    remove,
    currentAdmin,
    typingName,
    statusLabel,
    statusClass,
    inquiryMenu,
    menuCounts,
    listExtraHtml,
    replyNote,
    ready: waitForConfig()
  };
})();
