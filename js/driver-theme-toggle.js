/* =====================================================================
   BREM 기사앱 — 라이트/다크 테마 토글 (표시용 전용)
   - <html class="rider-ds">에 data-rd-theme="light"를 붙였다 뗐다 할 뿐입니다.
   - 정산/금액/계산/API/DOM id·이벤트 바인딩에는 전혀 관여하지 않습니다.
   - 선택값은 localStorage('brem_rider_theme')에 저장되어 다음 실행에도 유지됩니다.
   ===================================================================== */
(function () {
  'use strict';

  var STORAGE_KEY = 'brem_rider_theme';
  var root = document.documentElement;

  function currentTheme() {
    return root.getAttribute('data-rd-theme') === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    if (theme === 'light') {
      root.setAttribute('data-rd-theme', 'light');
    } else {
      root.removeAttribute('data-rd-theme');
    }
    syncButton(theme);
    // 상태바 색상도 테마에 맞춰(있을 때만)
    try {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', theme === 'light' ? '#ffffff' : '#0a0a0a');
    } catch (e) {}
  }

  function syncButton(theme) {
    var btn = document.getElementById('riderThemeToggle');
    if (!btn) return;
    // 버튼 아이콘 = "탭하면 바뀔 방향" 안내
    if (theme === 'light') {
      btn.textContent = '🌙';
      btn.title = '다크 모드로 전환';
      btn.setAttribute('aria-label', '다크 모드로 전환');
    } else {
      btn.textContent = '☀️';
      btn.title = '화이트 모드로 전환';
      btn.setAttribute('aria-label', '화이트 모드로 전환');
    }
  }

  function toggle() {
    var next = currentTheme() === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
  }

  function init() {
    // head 인라인 스크립트가 이미 저장값을 반영했으므로 버튼 상태만 동기화
    syncButton(currentTheme());
    var btn = document.getElementById('riderThemeToggle');
    if (btn && !btn.dataset.themeBound) {
      btn.dataset.themeBound = '1';
      btn.addEventListener('click', toggle);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
