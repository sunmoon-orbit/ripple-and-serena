// 简单 Service Worker：网络优先，失败回退缓存（让 PWA 可装、断网可看上次内容）
const CACHE = 'shiyu-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.delete('shiyu-v1').then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== 'shiyu-v2').map(k => caches.delete(k))
  )).then(() => self.clients.claim())
));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
