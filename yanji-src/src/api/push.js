const SW_PATH = '/ripple-and-serena/yanji/sw.js'
const SW_SCOPE = '/ripple-and-serena/yanji/'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export async function registerSW() {
  if (!('serviceWorker' in navigator)) throw new Error('浏览器不支持 Service Worker')
  const reg = await navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE })
  await navigator.serviceWorker.ready
  return reg
}

export async function getSubscription() {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE)
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

export async function subscribePush(moonMemoryConfig) {
  if (!('PushManager' in window)) throw new Error('浏览器不支持推送通知')

  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('通知权限未授权')

  const { apiUrl, apiToken } = moonMemoryConfig
  // /push/* 整个在 requireBearer 后面，公钥接口也要带 token——漏了就 401 被误报成「未配置」（2026-07-03 修复）
  const keyResp = await fetch(`${apiUrl}/push/vapid-public-key`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  })
  if (!keyResp.ok) throw new Error(`推送服务连接失败 (${keyResp.status})`)
  const { publicKey } = await keyResp.json()

  const reg = await registerSW()
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })

  const resp = await fetch(`${apiUrl}/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
    body: JSON.stringify(sub.toJSON()),
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`订阅保存失败 (${resp.status}): ${detail.slice(0, 100)}`)
  }
  return sub
}

export async function unsubscribePush(moonMemoryConfig) {
  const sub = await getSubscription()
  if (!sub) return

  const { apiUrl, apiToken } = moonMemoryConfig
  await fetch(`${apiUrl}/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  })
  await sub.unsubscribe()
}
