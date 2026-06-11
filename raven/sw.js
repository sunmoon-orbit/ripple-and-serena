self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', () => self.clients.claim())
self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)))

self.addEventListener('push', (e) => {
  let data = { title: '阿言', body: '点这里回来～' }
  try { data = e.data.json() } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title || '阿言', {
      body: data.body || '',
      icon: data.icon || 'https://memory.ravenlove.cc/raven/home-icon-192.png',
      badge: 'https://memory.ravenlove.cc/raven/home-icon-192.png',
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
