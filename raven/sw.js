// v20260616b
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', () => self.clients.claim())
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
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
      tag: 'raven-push',
      renotify: true,
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
