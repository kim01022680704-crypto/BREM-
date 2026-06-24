const CACHE_NAME = 'brem-pwa-v8';
const SHELL_URLS = [
  '/home.html',
  '/driver.html',
  '/css/brand.css',
  '/css/home.css',
  '/css/login.css',
  '/css/driver.css',
  '/css/admin.css',
  '/assets/brand/pwa-icon-192.png',
  '/assets/brand/pwa-icon-512.png',
  '/assets/brand/pwa-icon-maskable-512.png',
  '/assets/brand/favicon.svg',
  '/js/pwa-register.js'
];

function isAdminOrScript(pathname) {
  return pathname === '/admin.html'
    || pathname.endsWith('.js')
    || pathname.startsWith('/js/');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (isAdminOrScript(url.pathname)) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
