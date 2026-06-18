(function () {
  var file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (file === '') file = 'index.html';

  var pageMap = {
    'index.html': 'home',
    'portal-rider.html': 'rider',
    'portal-process.html': 'process',
    'portal-promotion.html': 'promotion',
    'portal-event.html': 'event',
    'portal-contact.html': 'contact'
  };

  var current = pageMap[file] || '';
  document.querySelectorAll('[data-nav]').forEach(function (link) {
    if (link.getAttribute('data-nav') === current) {
      link.classList.add('is-active');
    }
  });
})();
