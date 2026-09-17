(function () {
  const COLLAB_SECTIONS = new Set([
    'promotions',
    'promotion-apply',
    'promotion-settlement',
    'settlements',
    'weekly-settlement',
    'weekly-settlement-direct',
    'settlement-result-direct',
    'payroll-slips',
    'payroll-slip-search',
    'payroll-daily-settlement'
  ]);

  const POLL_MS = 45000;
  const FOCUS_DEBOUNCE_MS = 1500;
  const EDIT_RETRY_MS = 8000;

  let activeSection = '';
  let pollTimer = 0;
  let focusTimer = 0;
  let editRetryTimer = 0;
  let lastRevision = '';
  let syncInFlight = false;
  let pendingAfterEdit = false;
  let holdCount = 0;
  let onRefresh = null;

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function isHeld() {
    return holdCount > 0;
  }

  function hold() {
    holdCount += 1;
  }

  function release() {
    holdCount = Math.max(0, holdCount - 1);
  }

  function isUserEditing() {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return Boolean(el.isContentEditable);
  }

  function isBlockingDialogOpen() {
    const dialog = document.getElementById('callFeeSetupDialog');
    return Boolean(dialog && !dialog.hidden);
  }

  async function captureBaseline(sectionId) {
    if (!sectionId) return;
    try {
      lastRevision = await window.BremStorage?.fetchSectionCollabRevision?.(sectionId) || '';
    } catch (error) {
      console.warn('[BREM collab-sync] baseline failed:', error);
      lastRevision = '';
    }
  }

  function setIndicator(active) {
    let badge = document.getElementById('admin-collab-sync-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'admin-collab-sync-badge';
      badge.title = '동시 작업 자동 동기화';
      badge.style.cssText = [
        'position:fixed',
        'bottom:16px',
        'right:16px',
        'z-index:9998',
        'padding:6px 10px',
        'border-radius:999px',
        'font-size:12px',
        'font-weight:600',
        'color:#0f5132',
        'background:#d1e7dd',
        'border:1px solid #badbcc',
        'box-shadow:0 2px 8px rgba(0,0,0,.08)',
        'opacity:0',
        'pointer-events:none',
        'transition:opacity .25s ease'
      ].join(';');
      document.body.appendChild(badge);
    }
    badge.textContent = active ? '동기화 반영됨' : '';
    badge.style.opacity = active ? '1' : '0';
    if (active) {
      window.setTimeout(() => {
        if (badge) badge.style.opacity = '0';
      }, 2600);
    }
  }

  async function applyRefresh(sectionId, { notify = false } = {}) {
    if (!sectionId || !onRefresh) return;
    await window.BremStorage?.refreshSectionForCollab?.(sectionId);
    await onRefresh(sectionId);
    if (notify) {
      setIndicator(true);
      showToast('다른 PC에서 변경된 내용을 반영했습니다.');
    }
  }

  async function tick(options = {}) {
    const sectionId = activeSection;
    if (!sectionId || syncInFlight || isHeld()) return;
    if (isBlockingDialogOpen()) return;
    if (document.hidden && !options.forceVisible) return;

    if (!options.immediate && isUserEditing()) {
      pendingAfterEdit = true;
      if (!editRetryTimer) {
        editRetryTimer = window.setTimeout(() => {
          editRetryTimer = 0;
          if (pendingAfterEdit) void tick({ forceVisible: true });
        }, EDIT_RETRY_MS);
      }
      return;
    }

    syncInFlight = true;
    try {
      const revision = await window.BremStorage?.fetchSectionCollabRevision?.(sectionId);
      if (!revision) return;

      const changed = Boolean(lastRevision) && revision !== lastRevision;
      if (!options.immediate && !changed) return;

      await applyRefresh(sectionId, { notify: changed && !options.silent });
      lastRevision = revision;
      pendingAfterEdit = false;
    } catch (error) {
      console.warn('[BREM collab-sync]', error);
    } finally {
      syncInFlight = false;
    }
  }

  function stopTimers() {
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = 0;
    }
    if (focusTimer) {
      window.clearTimeout(focusTimer);
      focusTimer = 0;
    }
    if (editRetryTimer) {
      window.clearTimeout(editRetryTimer);
      editRetryTimer = 0;
    }
  }

  function stop() {
    stopTimers();
    activeSection = '';
    lastRevision = '';
    pendingAfterEdit = false;
  }

  function setActiveSection(sectionId) {
    const next = COLLAB_SECTIONS.has(sectionId) ? sectionId : '';
    if (activeSection === next) return;

    stopTimers();
    activeSection = next;
    lastRevision = '';
    pendingAfterEdit = false;
    if (!activeSection) return;

    void captureBaseline(activeSection);
    pollTimer = window.setInterval(() => {
      void tick({ silent: true });
    }, POLL_MS);
  }

  function scheduleFocusSync() {
    if (!activeSection) return;
    if (focusTimer) window.clearTimeout(focusTimer);
    focusTimer = window.setTimeout(() => {
      focusTimer = 0;
      void tick({ forceVisible: true, silent: true });
    }, FOCUS_DEBOUNCE_MS);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleFocusSync();
  });
  window.addEventListener('focus', scheduleFocusSync);

  window.BremAdminCollabSync = {
    setActiveSection,
    stop,
    hold,
    release,
    setRefreshHandler(fn) {
      onRefresh = typeof fn === 'function' ? fn : null;
    },
    forceSync() {
      return tick({ forceVisible: true, silent: true });
    },
    isCollabSection(sectionId) {
      return COLLAB_SECTIONS.has(sectionId);
    }
  };
})();
