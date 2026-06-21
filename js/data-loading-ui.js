/**
 * BREM 공통 데이터 로딩 UI
 */
window.BremLoadingUI = (function () {
  const DEFAULT_MESSAGE = '데이터 불러오는 중...';
  const activeTargets = new Map();
  const statusTimers = new WeakMap();

  function isBannerElement(el) {
    return Boolean(el?.classList?.contains('brem-data-loading'));
  }

  function resolveHost(target) {
    if (!target) return null;
    if (typeof target === 'string') {
      const node = document.getElementById(target);
      if (!node) return null;
      return isBannerElement(node) ? node.parentElement : node;
    }
    return isBannerElement(target) ? target.parentElement : target;
  }

  function ensureBanner(target, message = DEFAULT_MESSAGE) {
    if (!target) {
      const fallback = document.getElementById('bremDataLoading');
      if (fallback) return fallback;
      return null;
    }

    if (typeof target === 'string') {
      const node = document.getElementById(target);
      if (!node) return null;
      if (isBannerElement(node)) return node;
      return ensureBanner(node, message);
    }

    if (isBannerElement(target)) return target;

    const host = target;
    let el = host.querySelector('#bremDataLoading') || host.querySelector(':scope > .brem-data-loading');
    if (el) return el;

    el = document.createElement('div');
    el.className = 'brem-data-loading';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `
      <span class="brem-data-loading__spinner" aria-hidden="true"></span>
      <span class="brem-data-loading__text">${message}</span>
    `;

    const header = host.querySelector('.panel-header');
    if (header?.parentElement === host) {
      header.insertAdjacentElement('afterend', el);
    } else {
      host.insertBefore(el, host.firstChild);
    }
    return el;
  }

  function resolveBanner(target) {
    if (!target) return document.getElementById('bremDataLoading');
    if (typeof target === 'string') {
      const node = document.getElementById(target);
      if (!node) return null;
      if (isBannerElement(node)) return node;
      return ensureBanner(node);
    }
    if (isBannerElement(target)) return target;
    return ensureBanner(target);
  }

  function resolveSection(el) {
    return el?.closest('.section')
      || el?.closest('.list-panel')
      || el?.closest('.admin-app')
      || el?.closest('.main-content');
  }

  function clearStatusTimer(el) {
    const timer = statusTimers.get(el);
    if (timer) {
      clearTimeout(timer);
      statusTimers.delete(el);
    }
  }

  function applyBannerMode(el, mode = 'loading') {
    el.classList.remove('brem-data-loading--success', 'brem-data-loading--error');
    const spinner = el.querySelector('.brem-data-loading__spinner');
    if (mode === 'success') {
      el.classList.add('brem-data-loading--success');
      if (spinner) spinner.hidden = true;
      return;
    }
    if (mode === 'error') {
      el.classList.add('brem-data-loading--error');
      if (spinner) spinner.hidden = true;
      return;
    }
    if (spinner) spinner.hidden = false;
  }

  function show(target, message = DEFAULT_MESSAGE) {
    const el = ensureBanner(target, message);
    if (!el) return;

    clearStatusTimer(el);
    applyBannerMode(el, 'loading');

    const textEl = el.querySelector('.brem-data-loading__text');
    if (textEl) textEl.textContent = message;

    el.hidden = false;
    el.classList.add('is-visible');
    activeTargets.set(el, (activeTargets.get(el) || 0) + 1);

    resolveSection(el)?.classList.add('is-data-loading');
  }

  function hide(target, options = {}) {
    const el = resolveBanner(target);
    if (!el) return;

    clearStatusTimer(el);

    if (options.force) {
      activeTargets.delete(el);
    } else {
      const count = Math.max(0, (activeTargets.get(el) || 1) - 1);
      if (count > 0) {
        activeTargets.set(el, count);
        return;
      }
      activeTargets.delete(el);
    }

    el.classList.remove('is-visible', 'brem-data-loading--success', 'brem-data-loading--error');
    el.hidden = true;
    applyBannerMode(el, 'loading');

    resolveSection(el)?.classList.remove('is-data-loading');
  }

  function forceHide(target) {
    hide(target, { force: true });
  }

  function showStatus(target, options = {}) {
    const el = ensureBanner(target, options.message || DEFAULT_MESSAGE);
    if (!el) return;

    clearStatusTimer(el);
    activeTargets.delete(el);
    applyBannerMode(el, options.type || 'loading');

    const textEl = el.querySelector('.brem-data-loading__text');
    if (textEl) textEl.textContent = options.message || DEFAULT_MESSAGE;

    el.hidden = false;
    el.classList.add('is-visible');
    resolveSection(el)?.classList.remove('is-data-loading');

    const autoHideMs = Number(options.autoHideMs);
    if (Number.isFinite(autoHideMs) && autoHideMs > 0) {
      statusTimers.set(el, setTimeout(() => hide(el), autoHideMs));
    }
  }

  function wrapAsync(target, promise, message = DEFAULT_MESSAGE) {
    show(target, message);
    return Promise.resolve(promise).finally(() => hide(target));
  }

  return {
    DEFAULT_MESSAGE,
    show,
    hide,
    forceHide,
    showStatus,
    wrapAsync
  };
})();
