/* 업무 요청 — ERP와 관리자앱이 같은 목록을 쓴다. */
(function () {
  const APPROVERS = ['김형진', '방준길'];
  const STATUS_LABEL = {
    request: '승인대기',
    approved: '승인',
    done: '완료',
    rejected: '반려'
  };
  let loadToken = 0;
  let saveCounter = 0;
  let busy = false;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function approverKey(name) {
    const compact = String(name || '').replace(/\s+/g, '');
    if (compact.startsWith('김형진')) return '김형진';
    if (compact.startsWith('방준길')) return '방준길';
    return '';
  }

  function sessionAccount() {
    return window.BremStorage?.auth?.getAdminSessionAccount?.() || null;
  }

  function toast(message) {
    const el = document.getElementById('toast');
    if (!el || !message) return;
    el.textContent = message;
    el.classList.add('show');
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => el.classList.remove('show'), 2200);
  }

  function formatAmount(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n % 10000 === 0) return `${n / 10000}만원`;
    return `${n.toLocaleString('ko-KR')}원`;
  }

  function formatWhen(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${date.getMonth() + 1}/${date.getDate()} ${hh}:${mm}`;
  }

  function handlers() {
    const accounts = window.BremStorage?.auth?.getAdminAccounts?.() || [];
    return accounts
      .filter(account => account && account.active !== false && String(account.name || '').trim())
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
  }

  function sortItems(list) {
    const rank = { request: 0, approved: 1, done: 2, rejected: 3 };
    return list.slice().sort((a, b) => {
      const diff = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
      if (diff) return diff;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  function itemHtml(item, viewerKey) {
    const status = STATUS_LABEL[item.status] ? item.status : 'request';
    const amount = formatAmount(item.amount);
    const content = `${item.content || ''}${amount ? ` ${amount}` : ''}`.trim();
    const actions = [];
    if (status === 'request' && viewerKey && viewerKey === item.approverName) {
      actions.push(`<button type="button" class="small-btn" data-wr-status="approved" data-wr-id="${escapeHtml(item.id)}">승인</button>`);
      actions.push(`<button type="button" class="small-btn wr-reject" data-wr-status="rejected" data-wr-id="${escapeHtml(item.id)}">반려</button>`);
    }
    if (status === 'approved') {
      actions.push(`<button type="button" class="small-btn" data-wr-status="done" data-wr-id="${escapeHtml(item.id)}">완료</button>`);
    }
    const sub = [item.requester ? `요청자 ${item.requester}` : '', formatWhen(item.createdAt)].filter(Boolean).join(' · ');
    return `<div class="wr-item">
      <div class="wr-line">${escapeHtml(item.region || '-')} | ${escapeHtml(content)} | 총괄: ${escapeHtml(item.handlerName || '-')} | 승인자: ${escapeHtml(item.approverName || '-')} | <span class="wr-status wr-status--${status}">${STATUS_LABEL[status]}</span></div>
      ${sub ? `<div class="wr-sub">${escapeHtml(sub)}</div>` : ''}
      ${actions.length ? `<div class="wr-actions">${actions.join('')}</div>` : ''}
    </div>`;
  }

  function listHtml(items, emptyText, viewerKey) {
    if (!items.length) return `<p class="empty">${escapeHtml(emptyText)}</p>`;
    return items.map(item => itemHtml(item, viewerKey)).join('');
  }

  function render() {
    const roots = document.querySelectorAll('[data-wr-root]');
    if (!roots.length) return;
    const account = sessionAccount();
    const viewerKey = approverKey(account?.name);
    const all = sortItems(window.BremStorage?.workRequests?.getAll?.() || []);
    const visible = viewerKey ? all.filter(item => item.approverName === viewerKey) : all;
    const title = viewerKey ? `${viewerKey} 승인대기` : '업무 요청';
    const pending = viewerKey ? visible.filter(item => (item.status || 'request') === 'request') : visible;
    const rest = viewerKey ? visible.filter(item => (item.status || 'request') !== 'request') : [];
    const handlerOptions = handlers().map(handler => (
      `<option value="${escapeHtml(handler.id)}">${escapeHtml(handler.name)}</option>`
    )).join('');
    const approverOptions = APPROVERS.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    const html = `
      <article class="card wr-card">
        <div class="card-header">
          <h2>${escapeHtml(title)}</h2>
          <button type="button" class="small-btn" data-wr-reload>새로고침</button>
        </div>
        <div data-wr-list>
          ${listHtml(pending, viewerKey ? '승인 대기 중인 요청이 없습니다.' : '등록된 요청이 없습니다.', viewerKey)}
          ${rest.length ? `<h3 class="wr-subhead">처리한 요청</h3>${listHtml(rest, '', viewerKey)}` : ''}
        </div>
      </article>
      <article class="card wr-card">
        <div class="card-header"><h2>요청 등록</h2></div>
        <form data-wr-form class="wr-form">
          <label class="field"><span>지역</span><input name="region" required placeholder="포항"></label>
          <label class="field"><span>요청자</span><input name="requester" required value="${escapeHtml(account?.name || '')}"></label>
          <label class="field wr-wide"><span>요청 내용</span><input name="content" required placeholder="프로모션"></label>
          <label class="field"><span>금액</span><input name="amount" inputmode="numeric" placeholder="없으면 비움"></label>
          <label class="field"><span>총괄 담당자</span><select name="handlerId" required><option value="">선택</option>${handlerOptions}</select></label>
          <label class="field"><span>승인자</span><select name="approverName" required><option value="">선택</option>${approverOptions}</select></label>
          <div class="wr-wide wr-actions"><button type="submit" class="primary-btn">등록</button></div>
        </form>
      </article>`;
    roots.forEach(root => {
      root.innerHTML = html;
    });
    const titleEl = document.getElementById('adminAppTitle');
    if (titleEl && document.documentElement.dataset.adminAppTab === 'request') {
      titleEl.textContent = title;
    }
  }

  async function reload() {
    const token = ++loadToken;
    const seen = saveCounter;
    document.querySelectorAll('[data-wr-root]').forEach(root => {
      if (!root.querySelector('[data-wr-list]')) {
        root.innerHTML = '<p class="form-help">불러오는 중…</p>';
      }
    });
    try {
      await window.BremStorage?.ensureSectionLoaded?.('work-requests', { force: true });
    } catch (error) {
      console.warn('[BREM] work requests load failed:', error?.message || error);
    }
    if (token !== loadToken || seen !== saveCounter) return;
    render();
  }

  async function mutate(change, doneMessage) {
    if (busy) return;
    busy = true;
    saveCounter += 1;
    try {
      await window.BremStorage?.ensureSectionLoaded?.('work-requests', { force: true });
      const list = window.BremStorage?.workRequests?.getAll?.() || [];
      const next = change(list);
      if (!next) return;
      await window.BremStorage.workRequests.saveAll(next);
      saveCounter += 1;
      render();
      toast(doneMessage);
    } catch (error) {
      toast(error?.message || '저장하지 못했습니다.');
    } finally {
      busy = false;
    }
  }

  function submit(form) {
    const region = form.region.value.trim();
    const requester = form.requester.value.trim();
    const content = form.content.value.trim();
    const handlerId = form.handlerId.value;
    const approverName = form.approverName.value;
    const amountRaw = form.amount.value.trim().replace(/,/g, '');
    if (!region || !requester || !content || !handlerId || !approverName) {
      toast('지역, 요청자, 내용, 총괄 담당자, 승인자를 입력하세요.');
      return;
    }
    let amount = null;
    if (amountRaw) {
      amount = Number(amountRaw);
      if (!Number.isFinite(amount) || amount < 0) {
        toast('금액은 숫자로 입력하세요.');
        return;
      }
    }
    const handler = handlers().find(account => account.id === handlerId);
    if (!handler) {
      toast('총괄 담당자를 다시 선택하세요.');
      return;
    }
    const account = sessionAccount();
    const now = new Date().toISOString();
    const item = {
      id: window.BremStorage?.createId?.() || `wr_${Date.now()}`,
      region,
      requester,
      content,
      amount,
      handlerId: handler.id,
      handlerName: handler.name,
      approverName,
      status: 'request',
      createdAt: now,
      updatedAt: now,
      createdById: account?.id || '',
      createdByName: account?.name || requester
    };
    void mutate(list => [item, ...list], '등록했습니다.');
  }

  function setStatus(id, status) {
    const viewerKey = approverKey(sessionAccount()?.name);
    void mutate(list => {
      const row = list.find(item => item.id === id);
      if (!row) {
        toast('요청을 찾지 못했습니다.');
        return null;
      }
      if ((status === 'approved' || status === 'rejected') && (!viewerKey || row.approverName !== viewerKey || row.status !== 'request')) {
        return null;
      }
      if (status === 'done' && row.status !== 'approved') return null;
      row.status = status;
      row.updatedAt = new Date().toISOString();
      return list;
    }, status === 'approved' ? '승인했습니다.' : status === 'rejected' ? '반려했습니다.' : '완료했습니다.');
  }

  document.addEventListener('click', event => {
    const reloadBtn = event.target.closest?.('[data-wr-reload]');
    if (reloadBtn) {
      event.preventDefault();
      void reload();
      return;
    }
    const statusBtn = event.target.closest?.('[data-wr-status]');
    if (!statusBtn) return;
    event.preventDefault();
    setStatus(statusBtn.dataset.wrId, statusBtn.dataset.wrStatus);
  });

  document.addEventListener('submit', event => {
    const form = event.target?.closest?.('[data-wr-form]');
    if (!form) return;
    event.preventDefault();
    submit(form);
  });

  window.BremAdminWorkRequests = { reload, render };
})();
