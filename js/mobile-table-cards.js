/**
 * BREM mobile UI — labels table cells for card layout (layout only).
 */
(function () {
  var DRIVER_MQ = window.matchMedia('(max-width: 430px)');
  var ADMIN_MQ = window.matchMedia('(max-width: 768px)');
  var SKIP = '.bulk-guide-table, .bulk-preview-table, .lease-bulk-guide-table, .baemin-weekday-quota-table';
  var ADMIN_WRAP_SEL =
    '.table-wrap, .table-scroll, .lease-table-wrap, .dashboard-baemin-table-wrap, .baemin-coverage-table-wrap, .promotion-table-wrap, .mission-assignment-table-wrap, .payroll-notices-table-wrap';
  var ADMIN_TABLE_SEL = [
    '.admin-app .table-wrap table',
    '.admin-app .table-scroll table',
    '.admin-app .lease-table-wrap table',
    '.admin-app .dashboard-baemin-table-wrap table',
    '.admin-app .baemin-coverage-table-wrap table',
    '.admin-app .promotion-table-wrap table',
    '.admin-app .mission-assignment-table-wrap table',
    '.admin-app .payroll-notices-table-wrap table'
  ].join(', ');

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function findWrap(table) {
    return table.closest(ADMIN_WRAP_SEL) || table.parentElement;
  }

  function shouldSkip(table) {
    if (table.closest('.drivers-page')) return true;
    if (table.closest('.driver-payslip-table-block')) return true;
    return table.matches(SKIP);
  }

  function labelTable(table) {
    if (!table || shouldSkip(table)) return;
    var wrap = findWrap(table);
    var headers = [];
    table.querySelectorAll('thead th').forEach(function (th, i) {
      var labelEl = th.querySelector('.th-sort-label');
      var label = labelEl ? labelEl.textContent : (th.textContent || '');
      headers[i] = label.replace(/\s+/g, ' ').replace(/↕/g, '').trim();
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

  function clearTable(table) {
    if (!table) return;
    table.classList.remove('brem-mobile-cards-ready');
    var wrap = findWrap(table);
    if (wrap) wrap.classList.remove('brem-mobile-cards');
    table.querySelectorAll('tbody td[data-label]').forEach(function (td) {
      td.removeAttribute('data-label');
    });
  }

  function processScope(selector, enabled) {
    document.querySelectorAll(selector).forEach(function (table) {
      if (enabled) labelTable(table);
      else clearTable(table);
    });
  }

  function processAll() {
    processScope(ADMIN_TABLE_SEL, ADMIN_MQ.matches);
    processScope('.driver-app .table-wrap table', DRIVER_MQ.matches);
  }

  function onResize() {
    processAll();
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
      processAll();
    }, 250));
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
