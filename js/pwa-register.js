/**
 * BREM PWA — Service Worker 등록
 */
(function () {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {});
  });
})();
