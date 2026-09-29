// Офлайн: оболочка сайта из кэша (обновляется в фоне), данные API — всегда из сети.
const CACHE = 'tkpst-shell-v1';
const SHELL = ['./', 'index.html', 'style.css', 'js/app.js', 'js/core.js', 'js/data.js',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API — напрямую
  if (url.pathname.endsWith('overrides.json')) return; // изменения админа — всегда из сети, не кэшируем
  // Сначала сеть (чтобы обновления приходили сразу), без сети — кэш.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return r;
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('index.html')))
  );
});
