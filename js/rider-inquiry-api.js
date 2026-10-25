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
    const name = String(account?.name || account?.loginName || '').trim() || '관리자';
    return { id: String(account?.id || '').trim(), name };
  }

  function typingName(inquiry, now = Date.now()) {
    const at = Date.parse(inquiry?.replyingAt || '');
    if (!Number.isFinite(at) || now - at > 40000) return '';
    const me = currentAdmin();
    if (me.id && String(inquiry?.replyingById || '') === me.id) return '';
    return String(inquiry?.replyingBy || '다른 관리자');
  }

  function statusLabel(inquiry) {
    const status = inquiry?.status;
    if (status === 'done') return '처리완료';
    if (inquiry?.riderAckAt) return '기사확인';
    if (inquiry?.adminReply) return '답장함';
    if (status === 'read') return '확인중';
    return '미확인';
  }

  function statusClass(inquiry) {
    const status = inquiry?.status;
    if (status === 'done') return 'inquiry-badge inquiry-badge--done';
    if (inquiry?.riderAckAt) return 'inquiry-badge inquiry-badge--ack';
    if (inquiry?.adminReply) return 'inquiry-badge inquiry-badge--reply';
    if (status === 'read') return 'inquiry-badge inquiry-badge--read';
    return 'inquiry-badge inquiry-badge--new';
  }

  function listExtraHtml(inquiry) {
    const typing = typingName(inquiry);
    const parts = [];
    if (typing) {
      parts.push(`<p class="inquiry-typing">${escapeHtml(typing)}님이 답장을 쓰는 중입니다.</p>`);
    }
    if (inquiry?.adminReply) {
      const who = String(inquiry.adminReplyBy || '').trim();
      const when = String(inquiry.adminRepliedAt || '').replace('T', ' ').slice(0, 16);
      const preview = String(inquiry.adminReply).replace(/\s+/g, ' ').slice(0, 90);
      const head = who ? `${who} 답장` : '답장함';
      parts.push(`<p class="inquiry-reply-preview"><strong>${escapeHtml(head)}</strong>${when ? ` · ${escapeHtml(when)}` : ''} · ${escapeHtml(preview)}</p>`);
    }
    return parts.join('');
  }

  function replyNote(inquiry) {
    const typing = typingName(inquiry);
    if (typing) return `${typing}님이 지금 답장을 쓰고 있습니다. 겹치면 한쪽 답장이 사라질 수 있습니다.`;
    if (inquiry?.adminReply && inquiry?.riderAckAt) {
      const who = String(inquiry.adminReplyBy || '관리자').trim();
      const when = String(inquiry.riderAckAt || '').replace('T', ' ').slice(0, 16);
      return `${who}님 답장을 기사가 확인했습니다.${when ? ` (${when})` : ''}`;
    }
    if (inquiry?.adminReply) {
      const who = String(inquiry.adminReplyBy || '').trim();
      return who
        ? `${who}님이 이미 답장했습니다. 다시 보내면 그 답장이 바뀝니다.`
        : '답장을 보냈습니다. 다시 보내면 그 답장이 바뀝니다.';
    }
    return '답장을 보내면 기사앱에 보이고, 다른 관리자 목록에도 누가 보냈는지 남습니다.';
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
    listExtraHtml,
    replyNote,
    ready: waitForConfig()
  };
})();
