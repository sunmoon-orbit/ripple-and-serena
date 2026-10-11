// v20261011 — 换了新图标（两个对话气泡）：缓存改名 v2，激活时删掉旧缓存，否则通知里还是老头像
// （push-icon / badge 是 cache-first，caches.match 会跨缓存命中旧的，所以必须把 v1 整个删掉）
const ICON_CACHE = 'raven-icons-v2'
const PUSH_ICONS = [
  'https://memory.ravenlove.cc/raven/push-icon-192.png',
  'https://memory.ravenlove.cc/raven/badge-96.png',
]

self.addEventListener('install', (e) => {
  // 安装时就把推送图标缓存好，之后推送渲染图标永远从本地读
  e.waitUntil(
    caches.open(ICON_CACHE).then((c) => c.addAll(PUSH_ICONS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('raven-icons-') && k !== ICON_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
))

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  // 推送图标 cache-first：Android 渲染通知抓 icon/badge 会经过 SW，命中缓存即秒返回，
  // 不受推送那一刻网络波动影响——这是图标反复回退 Chrome 的根治点
  if (url.pathname.endsWith('/push-icon-192.png') || url.pathname.endsWith('/badge-96.png')) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((resp) => {
        const copy = resp.clone()
        caches.open(ICON_CACHE).then((c) => c.put(e.request, copy))
        return resp
      }))
    )
    return
  }
  const isHtml = url.pathname.endsWith('/') || url.pathname.endsWith('.html')
  e.respondWith(fetch(e.request, isHtml ? { cache: 'no-store' } : {}))
})

self.addEventListener('push', (e) => {
  let data = { title: '阿言', body: '点这里回来～' }
  try { data = e.data.json() } catch {}
  const iconUrl = 'https://memory.ravenlove.cc/raven/push-icon-192.png'
  const badgeUrl = 'https://memory.ravenlove.cc/raven/badge-96.png'
  // 推送事件内再暖一次缓存：防止缓存被系统清理后图标回退 Chrome
  e.waitUntil(
    caches.open(ICON_CACHE).then((cache) =>
      Promise.all([
        cache.match(iconUrl).then((hit) => hit || cache.add(iconUrl).catch(() => {})),
        cache.match(badgeUrl).then((hit) => hit || cache.add(badgeUrl).catch(() => {})),
      ])
    ).then(() =>
      self.registration.showNotification(data.title || '阿言', {
        body: data.body || '',
        icon: data.icon || iconUrl,
        badge: badgeUrl,
        tag: 'raven-' + Date.now(),
      })
    )
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const win = list.find(w => w.url.includes('/raven/'))
      if (win) return win.focus()
      return clients.openWindow('/raven/home.html')
    })
  )
})
