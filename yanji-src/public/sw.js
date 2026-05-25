self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try { payload = event.data.json() } catch { payload = { title: '言叽', body: event.data.text() } }

  event.waitUntil(
    self.registration.showNotification(payload.title || '言叽', {
      body: payload.body || '',
      icon: '/ripple-and-serena/yanji/icon-192.png',
      badge: '/ripple-and-serena/yanji/icon-192.png',
      data: { url: payload.url || '/ripple-and-serena/yanji/' },
      vibrate: [200, 100, 200],
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/ripple-and-serena/yanji/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes('ripple-and-serena/yanji') && 'focus' in c) return c.focus()
      }
      return clients.openWindow(url)
    })
  )
})
