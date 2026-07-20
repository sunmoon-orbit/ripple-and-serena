// network-first：在线总拿最新，断网才回退缓存（让 PWA 可装、离线可看上次内容）。
// 版本号变更时在 activate 清掉旧缓存，避免旧版本 HTML（含过期 theme-color）在网络抖动时被回退吐出。
const CACHE = 'shiyu-v6';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // 只缓存本站 app shell；跨域请求（记忆库 API memory.ravenlove.cc）一律直连不缓存，
  // 避免 SW 把 API 的错误页/旧数据缓存下来、网络抖动时吐出 HTML 或过期记忆（2026-07-04）
  const sameOrigin = new URL(e.request.url).origin === self.location.origin;
  if (!sameOrigin) return;
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
