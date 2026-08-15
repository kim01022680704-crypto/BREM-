/**
 * BREM PWA — Service Worker 등록
 */
(function () {
  if (!('serviceWorker' in navigator)) return;
  // Capacitor 네이티브 WebView에서는 SW 등록을 건너뛴다 (원격 URL + 앱 셸과 충돌 방지)
  try {
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform()) {
      return;
    }
  } catch {
    /* continue */
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function (registration) {
        registration.update();
      })
      .catch(function () {});
  });
})();
