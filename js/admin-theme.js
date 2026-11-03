/* BREM Admin 테마 토글 (다크 기본 / 라이트 전환).
   - <html data-theme="dark|light"> 속성으로 CSS 변수 전환
   - 선택은 localStorage('bremAdminTheme')에 기기별로 기억
   - PC ERP(admin.html)와 관리자 어플(admin-app.html) 공통 사용 */
(function () {
  'use strict';
  var KEY = 'bremAdminTheme';

  function current() {
    try {
      var saved = localStorage.getItem(KEY);
      return saved === 'light' ? 'light' : 'dark';
    } catch (e) {
      return 'dark';
    }
  }

  function syncButtons(theme) {
    var light = theme === 'light';
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i += 1) {
      var btn = buttons[i];
      btn.setAttribute('aria-pressed', String(light));
      var icon = btn.querySelector('[data-theme-icon]');
      var label = btn.querySelector('[data-theme-label]');
      if (icon) icon.textContent = light ? '\u2600' : '\u263E'; // ☀ / ☾
      if (label) label.textContent = light ? '라이트' : '다크';
      btn.title = light ? '라이트 모드 (클릭 시 다크)' : '다크 모드 (클릭 시 라이트)';
    }
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    syncButtons(theme);
  }

  function toggle() {
    apply(current() === 'light' ? 'dark' : 'light');
  }

  document.addEventListener('click', function (e) {
    var target = e.target;
    var btn = target && target.closest ? target.closest('[data-theme-toggle]') : null;
    if (btn) {
      e.preventDefault();
      toggle();
    }
  });

  function init() { apply(current()); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
