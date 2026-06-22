(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('indexSidebar');
    const menuBtn = document.getElementById('indexMenuBtn');
    const overlay = document.getElementById('indexOverlay');

    if (!sidebar || !menuBtn || !overlay) return;

    function closeMenu() {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
      overlay.hidden = true;
    }

    function openMenu() {
      sidebar.classList.add('open');
      overlay.classList.add('active');
      overlay.hidden = false;
    }

    menuBtn.addEventListener('click', () => {
      if (sidebar.classList.contains('open')) {
        closeMenu();
        return;
      }
      openMenu();
    });

    overlay.addEventListener('click', closeMenu);

    sidebar.querySelectorAll('.index-nav-link, .index-program-link, .drivers-header__quick').forEach(link => {
      link.addEventListener('click', closeMenu);
    });
  });
})();
