const SW_PATH = '/ripple-and-serena/yanji/sw.js'
const SW_SCOPE = '/ripple-and-serena/yanji/'

// ── APK 原生推送（FCM）────────────────────────────────────────
// Capacitor 在线壳里 Web Push 是死的（WebView 无 PushManager 订阅通道），
// 走壳注入的 PushNotifications 插件拿 FCM token 上报服务器（2026-07-17）。

const FCM_TOKEN_KEY = 'yanji_fcm_token'

export function isNativeApp() {
  // 两代原生壳：Capacitor（已弃用）和 Kotlin WebView（yanji-native，注入 YanjiNative 桥）
  return !!window.Capacitor?.isNativePlatform?.() || !!window.YanjiNative?.isNative
}

function isKotlinApp() {
  return !!window.YanjiNative?.isNative
}

function nativePush() {
  return window.Capacitor?.Plugins?.PushNotifications || null
}

export function getNativePushToken() {
  try { return localStorage.getItem(FCM_TOKEN_KEY) } catch { return null }
}

// 开机重报 token（0804）。
// FCM token 会在**重装 APK、清数据、Google 主动轮换**时变成新的一个，
// 旧的立刻作废。原生端的 onNewToken 只把新 token 写进 prefs，注释里写着
// 「前端下次打开时重新上报」——但那个上报从来没实现过：subscribeNativePush
// 唯一的调用点是设置页那个开关。于是重装之后推送**静默失效**，
// 开关还显示「开着」（它只读 localStorage），除非她碰巧去拨一下开关，
// 否则永远收不到通知，也收不到来电。0804 覆盖安装后就是这样，
// 服务器 fcm_tokens 里言叽那条已经被 UNREGISTERED 清掉了。
//
// 所以每次开机无条件补报一次，**不比对本地存的那个**：
// token 没变、服务器那条却被删掉的情况同样会发生（重装期间 app 短暂不存在，
// 期间任何一条推送都会拿到 UNREGISTERED，服务器就把行删了）。
// 只比对「变没变」的话，这种情况永远修不好。服务端是 UPSERT，重报无副作用。
// 只在「她本来就开着推送」时做（localStorage 有值），不替她打开没开过的功能。
export async function refreshNativePushToken(moonConfig) {
  if (!isKotlinApp()) return null
  if (!getNativePushToken()) return null              // 没开过推送，不多事
  if (!moonConfig?.apiUrl || !moonConfig?.apiToken) return null

  // 这里**不能**调 retryFcmToken 后干等 15 秒：开机路径上不该阻塞。
  // 取不到就算了，下次开机再对——反正设置页那个开关仍是手动兜底。
  const token = window.YanjiNative?.getFcmToken?.()
  if (!token) return null

  const resp = await fetch(`${moonConfig.apiUrl}/push/fcm-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${moonConfig.apiToken}` },
    body: JSON.stringify({ token }),
  })
  if (!resp.ok) throw new Error(`token 重报失败 (${resp.status})`)
  // 服务器收下了才写本地，否则下次开机会以为已经报过、不再重试
  try { localStorage.setItem(FCM_TOKEN_KEY, token) } catch { /* noop */ }
  return token
}

// Kotlin 壳：token 由 MainActivity 启动时异步预取存 prefs，这里轮询等它就位
async function getKotlinFcmToken() {
  // 启动时那次可能已失败，点开关时主动再拉一次（旧 APK 无此方法则跳过）
  window.YanjiNative?.retryFcmToken?.()
  for (let i = 0; i < 15; i++) {
    const t = window.YanjiNative?.getFcmToken?.()
    if (t) return t
    await new Promise((r) => setTimeout(r, 1000))
  }
  // 超时时带上 Google 返回的具体失败原因（新 APK 才有 getFcmError 桥）
  const err = window.YanjiNative?.getFcmError?.()
  throw new Error(err
    ? `Google 推送注册失败：${err}`
    : '获取推送 token 超时——检查 Google Play 服务是否在代理名单里，或重启 app 再试')
}

export async function subscribeNativePush(moonMemoryConfig) {
  if (isKotlinApp()) {
    const token = await getKotlinFcmToken()
    const { apiUrl, apiToken } = moonMemoryConfig
    const resp = await fetch(`${apiUrl}/push/fcm-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ token }),
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      throw new Error(`token 保存失败 (${resp.status}): ${detail.slice(0, 100)}`)
    }
    const data = await resp.json().catch(() => ({}))
    try { localStorage.setItem(FCM_TOKEN_KEY, token) } catch { /* noop */ }
    if (data.fcmConfigured === false) throw new Error('token 已保存，但服务器 FCM 尚未配置完成')
    return token
  }

  const PN = nativePush()
  if (!PN) throw new Error('推送插件不可用——APK 版本太旧，去下载页装最新的安装包')

  let perm = await PN.checkPermissions()
  if (perm.receive !== 'granted') perm = await PN.requestPermissions()
  if (perm.receive !== 'granted') throw new Error('通知权限未授权，去系统设置里允许言叽的通知')

  const token = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('获取推送 token 超时——检查 Google Play 服务是否在代理名单里')),
      20000
    )
    PN.addListener('registration', (r) => { clearTimeout(timer); resolve(r.value) })
    PN.addListener('registrationError', (e) => {
      clearTimeout(timer)
      reject(new Error(`推送注册失败: ${JSON.stringify(e).slice(0, 120)}`))
    })
    PN.register()
  })

  const { apiUrl, apiToken } = moonMemoryConfig
  const resp = await fetch(`${apiUrl}/push/fcm-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
    body: JSON.stringify({ token }),
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`token 保存失败 (${resp.status}): ${detail.slice(0, 100)}`)
  }
  const data = await resp.json().catch(() => ({}))
  try { localStorage.setItem(FCM_TOKEN_KEY, token) } catch { /* 私密模式等 */ }
  // 服务器还没配服务账号时如实告知，别让她以为已经通了
  if (data.fcmConfigured === false) throw new Error('token 已保存，但服务器 FCM 尚未配置完成')
  return token
}

export async function unsubscribeNativePush(moonMemoryConfig) {
  const token = getNativePushToken()
  const { apiUrl, apiToken } = moonMemoryConfig
  if (token) {
    await fetch(`${apiUrl}/push/fcm-unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ token }),
    }).catch(() => {})
  }
  try { localStorage.removeItem(FCM_TOKEN_KEY) } catch { /* noop */ }
  if (!isKotlinApp()) await nativePush()?.unregister?.().catch?.(() => {})
}

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
    // app:'yanji' 自报家门——不报的话服务端按归巢算，言叽的通知会从归巢弹出来（0725）
    body: JSON.stringify({ ...sub.toJSON(), app: 'yanji' }),
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`订阅保存失败 (${resp.status}): ${detail.slice(0, 100)}`)
  }
  return sub
}

// 回话落地通知：她把言叽切后台等回复时，服务端广播一条（Web Push + FCM 双通道全走）
export async function notifyReplyReady(moonMemory, preview) {
  const base = (moonMemory?.baseUrl || moonMemory?.apiUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
  await fetch(`${base}/push/reply-ready`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${moonMemory.apiToken}` },
    body: JSON.stringify({ preview }),
  })
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
