/**
 * BREM 공통 데이터 로딩 UI
 */
window.BremLoadingUI = (function () {
  const DEFAULT_MESSAGE = '데이터 불러오는 중...';
  const activeTargets = new Map();

  function resolveTarget(target) {
    if (!target) return document.getElementById('bremDataLoading');
    if (typeof target === 'string') return document.getElementById(target);
    return target;
  }

  function ensureBanner(target, message) {
    let el = resolveTarget(target);
    if (el) return el;

    const host = target && typeof target !== 'string' ? target : document.body;
    el = document.createElement('div');
    el.className = 'brem-data-loading';
    el.id = 'bremDataLoading';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `
      <span class="brem-data-loading__spinner" aria-hidden="true"></span>
      <span class="brem-data-loading__text">${message}</span>
    `;
    host.appendChild(el);
    return el;
  }

  function show(target, message = DEFAULT_MESSAGE) {
    const el = ensureBanner(target, message);
    if (!el) return;

    const textEl = el.querySelector('.brem-data-loading__text');
    if (textEl) textEl.textContent = message;

    el.hidden = false;
    el.classList.add('is-visible');
    activeTargets.set(el, (activeTargets.get(el) || 0) + 1);

    const section = el.closest('.section') || el.closest('.list-panel') || el.closest('.main-content');
    section?.classList.add('is-data-loading');
  }

  function hide(target) {
    const el = resolveTarget(target);
    if (!el) return;

    const count = Math.max(0, (activeTargets.get(el) || 1) - 1);
    if (count > 0) {
      activeTargets.set(el, count);
      return;
    }

    activeTargets.delete(el);
    el.classList.remove('is-visible');
    el.hidden = true;

    const section = el.closest('.section') || el.closest('.list-panel') || el.closest('.main-content');
    section?.classList.remove('is-data-loading');
  }

  function wrapAsync(target, promise, message = DEFAULT_MESSAGE) {
    show(target, message);
    return Promise.resolve(promise).finally(() => hide(target));
  }

  return {
    DEFAULT_MESSAGE,
    show,
    hide,
    wrapAsync
  };
})();
