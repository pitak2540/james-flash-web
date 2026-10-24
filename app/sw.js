// JAMES Flash service worker — app-shell cache so the PWA installs and runs offline
const CACHE = 'jamesflash-v0_8-immo';
const ASSETS = ['./', './index.html', './style.css', './mathexpr.js', './charts.js', './app.js', './dist/james-web.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {})); });
self.addEventListener('activate', (e) => { e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); await self.clients.claim(); })()); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // never touch USB/BLE or cross-origin
  e.respondWith((async () => {
    try { const res = await fetch(e.request); if (res && res.ok) { const c = await caches.open(CACHE); c.put(e.request, res.clone()); } return res; }
    catch (err) { const cached = await caches.match(e.request); return cached || (await caches.match('./index.html')) || Response.error(); }
  })());
});
