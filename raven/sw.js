// v20260617b — 预缓存推送图标 + cache-first（根治图标回退 Chrome）；每条推送唯一 tag，多条独立不折叠
const ICON_CACHE = 'raven-icons-v1'
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

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

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
  e.waitUntil(
    self.registration.showNotification(data.title || '阿言', {
      body: data.body || '',
      // icon: 暖金底深色 R，深色通知卡上不隐身；badge 必须单色透明，否则 Android 回退 Chrome 图标
      icon: data.icon || 'https://memory.ravenlove.cc/raven/push-icon-192.png',
      badge: 'https://memory.ravenlove.cc/raven/badge-96.png',
      // 唯一 tag：多条推送各自独立显示，不互相覆盖（错过的也都留着）
      tag: 'raven-' + Date.now(),
    })
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
