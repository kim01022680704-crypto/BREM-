/**
 * BREM PWA — 홈 화면 설치 버튼
 */
(function () {
  var btn = document.getElementById('bremPwaInstallBtn');
  if (!btn) return;

  var deferredPrompt = null;
  var labelEl = btn.querySelector('.brem-pwa-install-label');

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  if (isStandalone()) {
    btn.hidden = true;
    return;
  }

  btn.hidden = false;

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
