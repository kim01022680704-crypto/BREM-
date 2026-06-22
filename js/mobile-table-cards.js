/**
 * BREM mobile UI — labels table cells for card layout (layout only).
 */
(function () {
  var MQ = window.matchMedia('(max-width: 430px)');
  var SKIP = '.bulk-guide-table, .bulk-preview-table, .lease-bulk-guide-table';

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function shouldSkip(table) {
    if (table.closest('.drivers-page')) return true;
    return table.matches(SKIP);
  }

  function labelTable(table) {
    if (!table || shouldSkip(table)) return;
    var wrap = table.closest('.table-wrap') || table.parentElement;
    var headers = [];
    table.querySelectorAll('thead th').forEach(function (th, i) {
      headers[i] = (th.textContent || '').replace(/\s+/g, ' ').trim();
    });
    if (!headers.length) return;

    table.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.querySelectorAll('td').forEach(function (td, i) {
        if (headers[i]) td.setAttribute('data-label', headers[i]);
      });
    });

    table.classList.add('brem-mobile-cards-ready');
    if (wrap) wrap.classList.add('brem-mobile-cards');
  }

  function processAll() {
    if (!MQ.matches) return;
    document.querySelectorAll('.driver-app .table-wrap table, .admin-app .table-wrap table').forEach(labelTable);
  }

  function onResize() {
    if (MQ.matches) processAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', processAll);
  } else {
    processAll();
  }

  window.addEventListener('resize', debounce(onResize, 150));
  window.BremMobileTableCards = { refresh: processAll };

  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(debounce(function () {
      if (MQ.matches) processAll();
    }, 250));
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
