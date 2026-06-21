/**
 * Reusable table/list column sorting (asc / desc toggle).
 */
window.BremTableSort = (function () {
  function toggle(state, key) {
    if (!state || state.key !== key) return { key, dir: 'asc' };
    return { key, dir: state.dir === 'asc' ? 'desc' : 'asc' };
  }

  function dirIcon(dir, active) {
    if (!active) return '↕';
    return dir === 'desc' ? '↓' : '↑';
  }

  function header(label, key, state, options = {}) {
    if (options.sortable === false) {
      return `<span class="th-sort-label">${label}</span>`;
    }
    const active = state?.key === key;
    const aria = active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    return `<button type="button" class="th-sort-btn" data-sort-key="${key}" aria-sort="${aria}"><span class="th-sort-label">${label}</span><span class="th-sort-indicator" aria-hidden="true">${dirIcon(state?.dir, active)}</span></button>`;
  }

  function compareValues(a, b, type) {
    if (type === 'number') {
      return (Number(a) || 0) - (Number(b) || 0);
    }
    if (type === 'date') {
      return String(a || '').localeCompare(String(b || ''));
    }
    return String(a ?? '').localeCompare(String(b ?? ''), 'ko', { numeric: true, sensitivity: 'base' });
  }

  function sortItems(items, state, schema) {
    if (!Array.isArray(items)) return [];
    if (!state?.key || !schema?.[state.key]) return [...items];

    const field = schema[state.key];
    const getValue = typeof field.get === 'function' ? field.get : field;
    const type = field.type || 'text';
    const dir = state.dir === 'desc' ? -1 : 1;

    return [...items].sort((a, b) => compareValues(getValue(a), getValue(b), type) * dir);
  }

  function markScope(root, state) {
    if (!root) return;
    root.querySelectorAll('[data-sort-key]').forEach(btn => {
      const key = btn.dataset.sortKey;
      const active = state?.key === key;
      btn.setAttribute('aria-sort', active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      btn.classList.toggle('is-sort-active', active);
      const indicator = btn.querySelector('.th-sort-indicator');
      if (indicator) indicator.textContent = dirIcon(state?.dir, active);
    });
  }

  function bind(root, state, rerender) {
    if (!root || root.dataset.sortBound === '1') return;
    root.dataset.sortBound = '1';
    root.addEventListener('click', event => {
      const btn = event.target.closest('[data-sort-key]');
      if (!btn || !root.contains(btn)) return;
      event.preventDefault();
      const next = toggle(state, btn.dataset.sortKey);
      state.key = next.key;
      state.dir = next.dir;
      rerender();
      markScope(root, state);
    });
  }

  return {
    toggle,
    header,
    sortItems,
    markScope,
    bind
  };
})();
