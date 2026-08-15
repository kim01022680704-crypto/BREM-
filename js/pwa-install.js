/**
 * BREM PWA — 홈 화면 설치 버튼
 */
(function () {
  var wrap = document.getElementById('bremPwaInstallWrap');
  var btn = document.getElementById('bremPwaInstallBtn');
  if (!wrap || !btn) return;

  var deferredPrompt = null;
  var labelEl = btn.querySelector('.brem-pwa-install-label');

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function isNativeApp() {
    try {
      return !!(window.BREM_IS_NATIVE_APP
        || (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
          && window.Capacitor.isNativePlatform()));
    } catch {
      return false;
    }
  }

  if (isStandalone() || isNativeApp()) {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (labelEl) labelEl.textContent = '앱 설치 (모바일)';
  });

  btn.addEventListener('click', function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.finally(function () {
      deferredPrompt = null;
    });
  });
})();
