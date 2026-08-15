/**
 * BREM 네이티브 앱(Capacitor) 브리지 — 라이더 Android/iOS WebView용
 * - PWA 설치 UI 숨김
 * - 하드웨어 뒤로가기
 * - 외부 링크는 같은 WebView(_self)에서 열기
 */
(function () {
  function isCapacitorNative() {
    try {
      return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
        && window.Capacitor.isNativePlatform());
    } catch {
      return false;
    }
  }

  function isStandaloneDisplay() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    } catch {
      return false;
    }
  }

  window.BREM_IS_NATIVE_APP = isCapacitorNative();
  window.BREM_IS_INSTALLED_SHELL = window.BREM_IS_NATIVE_APP || isStandaloneDisplay();

  function hidePwaInstallUi() {
    if (!window.BREM_IS_INSTALLED_SHELL) return;
    var wrap = document.getElementById('bremPwaInstallWrap');
    if (wrap) wrap.hidden = true;
    document.documentElement.classList.add('brem-native-app');
  }

  function bindBackButton() {
    if (!window.BREM_IS_NATIVE_APP) return;
    var CapApp = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!CapApp || typeof CapApp.addListener !== 'function') return;

    CapApp.addListener('backButton', function (event) {
      try {
        if (window.history.length > 1) {
          window.history.back();
          return;
        }
      } catch {
        /* ignore */
      }
      if (event && event.canGoBack) return;
      CapApp.exitApp();
    });
  }

  function bindExternalLinks() {
    if (!window.BREM_IS_NATIVE_APP) return;

    document.addEventListener('click', function (event) {
      var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!anchor) return;
      var href = String(anchor.getAttribute('href') || '').trim();
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

      var target = String(anchor.getAttribute('target') || '').toLowerCase();
      if (target !== '_blank') return;

      event.preventDefault();
      try {
        window.location.assign(href);
      } catch {
        window.location.href = href;
      }
    }, true);

    var originalOpen = window.open;
    window.open = function (url, target, features) {
      var href = String(url || '').trim();
      if (!href) return null;
      var dest = String(target || '_blank').toLowerCase();
      if (dest === '_blank' || dest === 'blank') {
        try {
          window.location.assign(href);
        } catch {
          window.location.href = href;
        }
        return null;
      }
      return originalOpen ? originalOpen.call(window, url, target, features) : null;
    };
  }

  function boot() {
    hidePwaInstallUi();
    bindBackButton();
    bindExternalLinks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
