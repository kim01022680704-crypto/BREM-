/* 업무 요청 — ERP와 관리자앱이 같은 목록을 쓴다. */
(function () {
  const KINDS = ['프로모션', '기사 추가지급', '정비', '기타'];
  const STATUS_LABEL = {
    request: '승인대기',
    approved: '승인',
    done: '완료',
    rejected: '반려'
  };
  let loadToken = 0;
  let saveCounter = 0;
  let busy = false;
  let viewMode = 'week';
  let anchor = new Date();
  let clearOnRender = false;
  let regionCatalog = { baemin: [], coupang: [], error: '' };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sessionAccount() {
    return window.BremStorage?.auth?.getAdminSessionAccount?.() || null;
  }

  function requesterId(account) {
    return String(account?.name || account?.email || '').trim();
  }

  function toast(message) {
    const el = document.getElementById('toast');
    if (!el || !message) return;
    el.textContent = message;
    el.classList.add('show');
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => el.classList.remove('show'), 2200);
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function isoDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseDay(value) {
    const raw = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const date = new Date(`${raw}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function weekStartOf(date) {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    next.setDate(next.getDate() - ((next.getDay() - 3 + 7) % 7));
    return next;
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
    return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function shortRegionLabel(name) {
    let raw = String(name || '').replace(/\s+/g, '').trim();
    if (!raw) return '';
    raw = raw.replace(/\(\d+\)$/g, '');
    const hangul = raw.replace(/[^가-힣]/g, '');
    const base = hangul || raw;
    if (!base) return '';
    return base.length <= 4 ? base : base.slice(-4);
  }

  function regionText(item) {
    if (Array.isArray(item.regions) && item.regions.length) {
      return item.regions.map(region => region.label).filter(Boolean).join(' · ');
    }
    return String(item.region || '').trim();
  }

  function itemDay(item) {
    return String(item.createdAt || '').slice(0, 10);
  }

  function periodOf(mode, date) {
    if (mode === 'week') {
      const start = weekStartOf(date);
      const end = addDays(start, 6);
      return {
        start: isoDate(start),
        end: isoDate(end),
        label: `${start.getMonth() + 1}/${start.getDate()} ~ ${end.getMonth() + 1}/${end.getDate()}`
      };
    }
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return {
      start: isoDate(start),
      end: isoDate(end),
      label: `${start.getFullYear()}년 ${start.getMonth() + 1}월`
    };
  }

  function inPeriod(item, period) {
    const day = itemDay(item);
    return Boolean(day) && day >= period.start && day <= period.end;
  }

  function byNewest(list) {
    return list.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  function regionChips(item) {
    const list = Array.isArray(item.regions) && item.regions.length
      ? item.regions
      : (item.region ? [{ label: item.region }] : []);
    if (!list.length) return '';
    return `<div class="wr-item__regions">${list.map(region => (
      `<span class="wr-chip">${escapeHtml(region.label || '')}</span>`
    )).join('')}</div>`;
  }

  function itemHtml(item) {
    const status = STATUS_LABEL[item.status] ? item.status : 'request';
    const amount = formatAmount(item.amount);
    const actions = [];
    if (status === 'request') {
      actions.push(`<button type="button" class="wr-btn wr-btn--approve" data-wr-status="approved" data-wr-id="${escapeHtml(item.id)}">승인</button>`);
      actions.push(`<button type="button" class="wr-btn wr-btn--reject" data-wr-status="rejected" data-wr-id="${escapeHtml(item.id)}">반려</button>`);
    }
    if (status === 'approved') {
      actions.push(`<button type="button" class="wr-btn wr-btn--done" data-wr-status="done" data-wr-id="${escapeHtml(item.id)}">완료</button>`);
    }
    const meta = [
      item.kind ? `<span class="wr-tag">${escapeHtml(item.kind)}</span>` : '',
      amount ? `<span class="wr-cost">예상 ${escapeHtml(amount)}</span>` : ''
    ].filter(Boolean).join('');
    const sub = [item.requester ? `요청자 ${escapeHtml(item.requester)}` : '', escapeHtml(formatWhen(item.createdAt))].filter(Boolean).join(' · ');
    return `<div class="wr-item wr-item--${status}">
      <div class="wr-item__top">
        <span class="wr-badge wr-badge--${status}">${STATUS_LABEL[status]}</span>
        ${meta}
      </div>
      ${regionChips(item)}
      <p class="wr-body">${escapeHtml(item.content || '')}</p>
      <div class="wr-item__foot">
        <span class="wr-sub">${sub}</span>
        ${actions.length ? `<div class="wr-actions">${actions.join('')}</div>` : ''}
      </div>
    </div>`;
  }

  function listHtml(items, emptyText) {
    if (!items.length) return `<p class="wr-empty">${escapeHtml(emptyText)}</p>`;
    return `<div class="wr-list">${items.map(itemHtml).join('')}</div>`;
  }

  function monthKey(item) {
    return itemDay(item).slice(0, 7);
  }

  function monthLabel(key) {
    const [year, month] = String(key || '').split('-');
    if (!year || !month) return '날짜 없음';
    return `${year}년 ${Number(month)}월`;
  }

  function processedHtml(items) {
    if (viewMode === 'months') {
      const groups = new Map();
      byNewest(items).forEach(item => {
        const key = monthKey(item) || 'none';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      });
      const keys = [...groups.keys()].sort((a, b) => b.localeCompare(a));
      if (!keys.length) return '<p class="empty">이 보기에 해당하는 요청이 없습니다.</p>';
      return keys.map(key => `
        <h4 class="wr-monthhead">${escapeHtml(monthLabel(key))}</h4>
        ${listHtml(groups.get(key), '')}
      `).join('');
    }
    const period = periodOf(viewMode, anchor);
    const matched = byNewest(items.filter(item => inPeriod(item, period)));
    return listHtml(matched, '이 기간에 처리된 요청이 없습니다.');
  }

  function viewButtons() {
    const modes = [
      ['week', '주별'],
      ['month', '월별'],
      ['months', '달별']
    ];
    return modes.map(([id, label]) => (
      `<button type="button" class="wr-view${viewMode === id ? ' is-on' : ''}" data-wr-view="${id}">${label}</button>`
    )).join('');
  }

  function periodNav() {
    if (viewMode === 'months') return '';
    const period = periodOf(viewMode, anchor);
    return `<div class="wr-period">
      <button type="button" class="wr-nav-btn" data-wr-shift="-1" aria-label="이전">‹</button>
      <strong>${escapeHtml(period.label)}</strong>
      <button type="button" class="wr-nav-btn" data-wr-shift="1" aria-label="다음">›</button>
    </div>`;
  }

  function regionBox(selected) {
    const chosen = new Set(selected);
    const groups = [
      ['배민', regionCatalog.baemin],
      ['쿠팡', regionCatalog.coupang]
    ].filter(([, list]) => list.length);
    if (!groups.length) {
      return `<p class="form-help">${escapeHtml(regionCatalog.error || '크롤링 지역을 불러오는 중…')}</p>`;
    }
    const inner = groups.map(([title, list]) => `
      <p class="wr-region-title">${title}</p>
      <div class="wr-regions">
        ${list.map(region => {
          const value = `${region.platform}:${region.key}`;
          return `<label class="wr-region">
            <input type="checkbox" name="region" value="${escapeHtml(value)}"${chosen.has(value) ? ' checked' : ''}>
            <span>${escapeHtml(region.label)}</span>
          </label>`;
        }).join('')}
      </div>
    `).join('');
    return `<div class="wr-region-box">${inner}</div>`;
  }

  function kindOptions(selected) {
    return ['<option value="">선택</option>'].concat(KINDS.map(kind => (
      `<option value="${escapeHtml(kind)}"${kind === selected ? ' selected' : ''}>${escapeHtml(kind)}</option>`
    ))).join('');
  }

  function readDraft() {
    const form = document.querySelector('[data-wr-form]');
    if (!form) return null;
    return {
      kind: form.kind?.value || '',
      content: form.content?.value || '',
      amount: form.amount?.value || '',
      regions: [...form.querySelectorAll('input[name="region"]:checked')].map(input => input.value)
    };
  }

  function render() {
    const roots = document.querySelectorAll('[data-wr-root]');
    if (!roots.length) return;
    const draft = clearOnRender ? null : readDraft();
    clearOnRender = false;
    const periodLabel = viewMode === 'months' ? '달별' : periodOf(viewMode, anchor).label;
    const account = sessionAccount();
    const who = requesterId(account);
    const all = window.BremStorage?.workRequests?.getAll?.() || [];
    const pending = byNewest(all.filter(item => (item.status || 'request') === 'request'));
    const rest = all.filter(item => (item.status || 'request') !== 'request');
    const html = `
      <article class="card wr-card">
        <div class="card-header">
          <h2>업무</h2>
          <button type="button" class="small-btn" data-wr-reload>새로고침</button>
        </div>
        <div class="wr-toolbar">
          <div class="wr-views">${viewButtons()}</div>
          ${periodNav()}
        </div>
        <div data-wr-list>
          <div class="wr-section">
            <h3 class="wr-subhead"><span class="wr-dot wr-dot--wait"></span>승인 안 된 요청<span class="wr-count">${pending.length}</span></h3>
            ${listHtml(pending, '승인 대기 중인 요청이 없습니다.')}
          </div>
          <div class="wr-section">
            <h3 class="wr-subhead"><span class="wr-dot"></span>${escapeHtml(periodLabel)}</h3>
            ${processedHtml(rest)}
          </div>
        </div>
      </article>
      <article class="card wr-card">
        <div class="card-header"><h2>요청 등록</h2></div>
        <form data-wr-form class="wr-form">
          <p class="wr-requester">요청자 <strong>${escapeHtml(who || '로그인 필요')}</strong></p>
          <div class="wr-row">
            <label class="field"><span>종류</span><select name="kind" required>${kindOptions(draft?.kind || '')}</select></label>
            <label class="field"><span>예상 지출비용</span><input name="amount" inputmode="numeric" placeholder="없으면 비움" value="${escapeHtml(draft?.amount || '')}"></label>
          </div>
          <div class="field">
            <span>지역</span>
            ${regionBox(draft?.regions || [])}
          </div>
          <label class="field wr-content-field">
            <span>요청 내용</span>
            <textarea name="content" class="wr-content" required placeholder="요청 내용을 자세히 입력하세요">${escapeHtml(draft?.content || '')}</textarea>
          </label>
          <div class="wr-actions wr-actions--submit"><button type="submit" class="primary-btn">등록</button></div>
        </form>
      </article>`;
    roots.forEach(root => {
      root.innerHTML = html;
    });
    const titleEl = document.getElementById('adminAppTitle');
    if (titleEl && document.documentElement.dataset.adminAppTab === 'request') {
      titleEl.textContent = '업무';
    }
  }

  async function loadRegions() {
    try {
      const token = await window.BremStorage?.resolveAdminAccessToken?.();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const [baeminRes, coupangRes] = await Promise.all([
        fetch('/api/admin/baemin-delivery/partner-regions', { headers, credentials: 'same-origin' }),
        fetch('/api/admin/coupang/vendor-regions', { headers, credentials: 'same-origin' })
      ]);
      const baeminPayload = await baeminRes.json().catch(() => ({}));
      const coupangPayload = await coupangRes.json().catch(() => ({}));
      if (!baeminRes.ok && !coupangRes.ok) {
        throw new Error(baeminPayload.error || coupangPayload.error || '지역 목록을 불러오지 못했습니다.');
      }
      const baeminItems = baeminPayload.allItems || baeminPayload.items || [];
      const coupangItems = coupangPayload.allItems || coupangPayload.items || [];
      regionCatalog = {
        baemin: baeminItems.map(item => ({
          platform: 'baemin',
          key: String(item.partnerId || '').trim(),
          label: String(item.regionName || '').trim()
        })).filter(item => item.key && item.label),
        coupang: coupangItems.map(item => {
          const key = String(item.vendorId || '').trim();
          const full = String(item.vendorName || '').trim();
          return {
            platform: 'coupang',
            key,
            label: shortRegionLabel(full) || key,
            full
          };
        }).filter(item => item.key && item.label),
        error: ''
      };
      const seen = new Set();
      regionCatalog.coupang = regionCatalog.coupang.filter(item => {
        const id = `${item.label}:${item.key}`;
        if (seen.has(item.key)) return false;
        seen.add(item.key);
        return Boolean(id);
      }).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
      regionCatalog.baemin.sort((a, b) => a.label.localeCompare(b.label, 'ko'));
    } catch (error) {
      regionCatalog = { baemin: [], coupang: [], error: error?.message || '지역 목록을 불러오지 못했습니다.' };
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
      await Promise.all([
        window.BremStorage?.ensureSectionLoaded?.('work-requests', { force: true }),
        loadRegions()
      ]);
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
      clearOnRender = doneMessage === '등록했습니다.';
      render();
      toast(doneMessage);
    } catch (error) {
      toast(error?.message || '저장하지 못했습니다.');
    } finally {
      busy = false;
    }
  }

  function selectedRegions(form) {
    const byValue = new Map();
    [...regionCatalog.baemin, ...regionCatalog.coupang].forEach(region => {
      byValue.set(`${region.platform}:${region.key}`, region);
    });
    return [...form.querySelectorAll('input[name="region"]:checked')].map(input => {
      const region = byValue.get(input.value);
      if (!region) return null;
      return { platform: region.platform, key: region.key, label: region.label };
    }).filter(Boolean);
  }

  function submit(form) {
    const account = sessionAccount();
    const requester = requesterId(account);
    const kind = form.kind.value;
    const content = form.content.value.trim();
    const regions = selectedRegions(form);
    const amountRaw = form.amount.value.trim().replace(/,/g, '');
    if (!requester) {
      toast('로그인된 관리자만 등록할 수 있습니다.');
      return;
    }
    if (!kind || !content || !regions.length) {
      toast('종류, 요청 내용, 지역을 입력하세요.');
      return;
    }
    let amount = null;
    if (amountRaw) {
      amount = Number(amountRaw);
      if (!Number.isFinite(amount) || amount < 0) {
        toast('예상 지출비용은 숫자로 입력하세요.');
        return;
      }
    }
    const now = new Date().toISOString();
    const item = {
      id: window.BremStorage?.createId?.() || `wr_${Date.now()}`,
      kind,
      regions,
      region: regions.map(region => region.label).join(' · '),
      requester,
      content,
      amount,
      status: 'request',
      createdAt: now,
      updatedAt: now,
      createdById: account?.id || '',
      createdByName: requester
    };
    void mutate(list => [item, ...list], '등록했습니다.');
  }

  function setStatus(id, status) {
    void mutate(list => {
      const row = list.find(item => item.id === id);
      if (!row) {
        toast('요청을 찾지 못했습니다.');
        return null;
      }
      if ((status === 'approved' || status === 'rejected') && row.status !== 'request') return null;
      if (status === 'done' && row.status !== 'approved') return null;
      row.status = status;
      row.updatedAt = new Date().toISOString();
      return list;
    }, status === 'approved' ? '승인했습니다.' : status === 'rejected' ? '반려했습니다.' : '완료했습니다.');
  }

  function shiftAnchor(delta) {
    const step = Number(delta) || 0;
    if (!step) return;
    if (viewMode === 'week') anchor = addDays(weekStartOf(anchor), step * 7);
    else anchor = new Date(anchor.getFullYear(), anchor.getMonth() + step, 1);
    render();
  }

  document.addEventListener('click', event => {
    const reloadBtn = event.target.closest?.('[data-wr-reload]');
    if (reloadBtn) {
      event.preventDefault();
      void reload();
      return;
    }
    const viewBtn = event.target.closest?.('[data-wr-view]');
    if (viewBtn) {
      event.preventDefault();
      viewMode = viewBtn.dataset.wrView || 'week';
      anchor = new Date();
      render();
      return;
    }
    const shiftBtn = event.target.closest?.('[data-wr-shift]');
    if (shiftBtn) {
      event.preventDefault();
      shiftAnchor(shiftBtn.dataset.wrShift);
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
