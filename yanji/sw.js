self.addEventListener('fetch', (event) => {
  // pass-through: no offline caching, just satisfy PWA install criteria
  event.respondWith(fetch(event.request))
})

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try { payload = event.data.json() } catch { payload = { title: '言叽', body: event.data.text() } }

  // 绝对 URL（用 SW scope 拼，自动适配部署域名）：系统级通知不在 SW 上下文里，
  // 相对路径加载不到图标会回退成 Chrome 图标
  const base = self.registration.scope
  event.waitUntil(
    self.registration.showNotification(payload.title || '言叽', {
      body: payload.body || '',
      icon: base + 'icon-192.png',
      badge: base + 'icon-192.png',
      data: { url: payload.url || base },
      vibrate: [200, 100, 200],
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || self.registration.scope
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes('ripple-and-serena/yanji') && 'focus' in c) return c.focus()
      }
      return clients.openWindow(url)
    })
  )
})
