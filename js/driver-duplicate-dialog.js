const BremDriverDuplicateDialog = (function () {
  const ROOT_ID = 'bremDriverDuplicateDialog';

  function escapeHtml(value) {
    if (typeof BremDriverUtils?.escapeHtml === 'function') {
      return BremDriverUtils.escapeHtml(value);
    }
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function formatPhone(value) {
    if (typeof BremDriverUtils?.formatPhoneDisplay === 'function') {
      return BremDriverUtils.formatPhoneDisplay(value);
    }
    return String(value || '-');
  }

  function loginId(driver) {
    return typeof BremDriverUtils?.makeDriverLoginId === 'function'
      ? (BremDriverUtils.makeDriverLoginId(driver) || '-')
      : '-';
  }

  function reasonSummary(hits) {
    const set = new Set();
    (hits || []).forEach(item => (item.reasons || []).forEach(reason => set.add(reason)));
    return [...set];
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'driver-dup-dialog';
    root.hidden = true;
    root.innerHTML = `
      <div class="driver-dup-dialog__backdrop" data-dup-cancel></div>
      <div class="driver-dup-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="driverDupDialogTitle">
        <div class="driver-dup-dialog__head">
          <p class="driver-dup-dialog__eyebrow">중복 확인</p>
          <h3 id="driverDupDialogTitle">이미 등록된 기사가 있습니다</h3>
          <p class="driver-dup-dialog__lead" id="driverDupDialogLead"></p>
        </div>
        <div class="driver-dup-dialog__list" id="driverDupDialogList"></div>
        <p class="driver-dup-dialog__note" id="driverDupDialogNote"></p>
        <div class="driver-dup-dialog__actions">
          <button type="button" class="driver-dup-dialog__btn driver-dup-dialog__btn--ghost" data-dup-cancel>취소</button>
          <button type="button" class="driver-dup-dialog__btn driver-dup-dialog__btn--primary" id="driverDupCreateAnyway" hidden>다른 사람으로 신규 등록</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    return root;
  }

  function close() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.hidden = true;
  }

  function open(options = {}) {
    const hits = Array.isArray(options.hits) ? options.hits : [];
    if (!hits.length) {
      options.onCancel?.();
      return;
    }

    const hard = hits.some(item => item.hard);
    const reasons = reasonSummary(hits);
    const root = ensureRoot();
    const lead = root.querySelector('#driverDupDialogLead');
    const list = root.querySelector('#driverDupDialogList');
    const note = root.querySelector('#driverDupDialogNote');
    const createBtn = root.querySelector('#driverDupCreateAnyway');

    lead.textContent = `${reasons.join(' · ')} — 어떻게 할까요?`;
    note.textContent = hard
      ? '같은 연락처·아이디는 신규 등록할 수 없습니다. 기존 기사를 수정하세요.'
      : '이름만 같은 동명이인입니다. 다른 사람이면 신규 등록할 수 있습니다.';
    createBtn.hidden = hard || options.allowCreateAnyway === false;

    list.innerHTML = hits.map(item => {
      const driver = item.driver || {};
      const id = String(driver.id || '');
      return `
        <article class="driver-dup-card">
          <div>
            <strong>${escapeHtml(driver.name || '-')}</strong>
            <p>${escapeHtml((item.reasons || []).join(' · '))}</p>
            <p>연락처 ${escapeHtml(formatPhone(driver.phone))} · 쿠팡ID ${escapeHtml(loginId(driver))} · 배민ID ${escapeHtml(driver.baeminId || '-')}</p>
            <p>상태 ${escapeHtml(driver.status || '-')} · 가입 ${escapeHtml(driver.joinDate || '-')}</p>
          </div>
          <button type="button" class="driver-dup-dialog__btn driver-dup-dialog__btn--primary" data-dup-edit="${escapeHtml(id)}">이 기사 수정</button>
        </article>
      `;
    }).join('');

    const finish = (fn, payload) => {
      close();
      fn?.(payload);
    };

    root.onclick = event => {
      const editBtn = event.target.closest('[data-dup-edit]');
      if (editBtn) {
        const driver = hits.find(item => String(item.driver?.id || '') === editBtn.dataset.dupEdit)?.driver;
        if (driver) finish(options.onEdit, driver);
        return;
      }
      if (event.target.closest('[data-dup-cancel]')) {
        finish(options.onCancel);
      }
    };
    createBtn.onclick = () => finish(options.onCreateAnyway);

    root.hidden = false;
  }

  return { open, close };
})();
