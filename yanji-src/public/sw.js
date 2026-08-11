self.addEventListener('install', (event) => {
  // 新版本一部署就接管，不让旧 service worker 在后台继续等到所有窗口关闭。
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  // pass-through: no offline caching, just satisfy PWA install criteria
  // HTML 导航强制重新验证，避免 APK/WebView 退出重进后仍拿到旧 index.html，
  // 进而继续加载已经修掉 bug 的旧 bundle；带 hash 的静态资源照常走浏览器缓存。
  const request = event.request
  event.respondWith(
    request.mode === 'navigate'
      ? fetch(request, { cache: 'no-store' })
      : fetch(request)
  )
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
