self.addEventListener('fetch', (event) => {
  // pass-through: no offline caching, just satisfy PWA install criteria
  event.respondWith(fetch(event.request))
})

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try { payload = event.data.json() } catch { payload = { title: '言叽', body: event.data.text() } }

  const base = self.registration.scope
  event.waitUntil(
    self.registration.showNotification(payload.title || '言叽', {
      body: payload.body || '',
      icon: base + 'icon-192.png',
      // badge 必须单色透明，否则 Android 会回退成 Chrome 图标
      badge: 'https://memory.ravenlove.cc/raven/badge-96.png',
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
