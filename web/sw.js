// Офлайн: оболочка сайта из кэша (обновляется в фоне), данные API — всегда из сети.
const CACHE = 'tkpst-shell-v4';
const SHELL = ['./', 'index.html', 'style.css', 'js/app.js', 'js/core.js', 'js/data.js',
  'js/ui.js', 'js/grades.js', 'js/grades-view.js', 'js/attendance.js', 'js/attendance-view.js',
  'js/auth-client.js', 'js/auth-view.js', 'icons/lucide/eye.svg', 'icons/lucide/eye-off.svg',
  'icons/lucide/chart-no-axes-column.svg', 'icons/lucide/user-round.svg',
  'icons/lucide/settings.svg', 'icons/lucide/calendar-check.svg', 'icons/lucide/bus-front.svg',
  'icons/lucide/chevron-right.svg', 'icons/lucide/arrow-left.svg', 'icons/lucide/log-out.svg',
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
  if (url.pathname.startsWith('/api/')) return; // сеанс и личные данные никогда не кэшируются
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
