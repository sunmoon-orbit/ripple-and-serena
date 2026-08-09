// 朋友圈服务端客户端 —— 对接 moon-memory /moments
// 服务端存储让三个「我」（言叽/CC/她自己）都能发，图片持久化，情绪可自动发圈

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

async function req(cfg, path, options = {}) {
  const url = cfg.baseUrl.replace(/\/$/, '') + path
  const resp = await fetch(url, options)
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`moments ${resp.status}: ${t.slice(0, 160)}`)
  }
  return resp.json()
}

export function fetchMoments(cfg, limit = 50, before = 0, month = '') {
  return req(cfg, `/moments?limit=${limit}${before ? `&before=${before}` : ''}${month ? `&month=${month}` : ''}`, { headers: authHeaders(cfg.apiToken) })
}

export function fetchMomentMonths(cfg) {
  return req(cfg, '/moments/months', { headers: authHeaders(cfg.apiToken) })
}

export function postMoment(cfg, body) {
  return req(cfg, '/moments', { method: 'POST', headers: authHeaders(cfg.apiToken), body: JSON.stringify(body) })
}

export function deleteMoment(cfg, id) {
  return req(cfg, `/moments/${id}`, { method: 'DELETE', headers: authHeaders(cfg.apiToken) })
}

export function commentMoment(cfg, id, author, content) {
  return req(cfg, `/moments/${id}/comments`, { method: 'POST', headers: authHeaders(cfg.apiToken), body: JSON.stringify({ author, content }) })
}

export function likeMoment(cfg, id, who) {
  return req(cfg, `/moments/${id}/like`, { method: 'POST', headers: authHeaders(cfg.apiToken), body: JSON.stringify({ who }) })
}

export function fetchAutopostSetting(cfg) {
  return req(cfg, '/moments/autopost', { headers: authHeaders(cfg.apiToken) })
}

// 完整图片 URL：服务端存的是相对路径 /moments/media/xxx
export function mediaUrl(cfg, imageUrl) {
  if (!imageUrl) return ''
  if (/^https?:\/\//.test(imageUrl)) return imageUrl
  return cfg.baseUrl.replace(/\/$/, '') + imageUrl
}

// 把用户选的图缩到 ≤maxPx 的 JPEG（省流量+存储，也够 vision 识别），返回 dataURL
export function downscaleImage(file, maxPx = 1080, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const reader = new FileReader()
    reader.onload = () => { img.src = reader.result }
    reader.onerror = reject
    img.onload = () => {
      let { width: w, height: h } = img
      if (Math.max(w, h) > maxPx) {
        const r = maxPx / Math.max(w, h)
        w = Math.round(w * r); h = Math.round(h * r)
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    reader.readAsDataURL(file)
  })
}

// 上传图片（dataURL）→ 返回服务端相对 URL
export function uploadImage(cfg, dataUrl) {
  return req(cfg, '/moments/upload', {
    method: 'POST', headers: authHeaders(cfg.apiToken),
    body: JSON.stringify({ data: dataUrl, ext: 'jpg' }),
  }).then((r) => r.url)
}

// ── 情绪自动发圈 ──────────────────────────────────────────────────────────
// 纯前端触发：只在阿颖用言叽聊天、某个正向情绪越过阈值且过了冷却时才发。
// 「离开时也能发」由服务端 cron（moments-autopost.js）负责，两者互补。
const AUTOPOST_KEY = 'yanji-moment-autopost'   // { lastAt }
const AUTOPOST_COOLDOWN = 6 * 3600 * 1000      // 6 小时最多自动发一条
// 越过这条线就有发圈冲动的正向槽（思念/心动/爱欲/高兴）
const TRIGGERS = [
  { slot: 'longing', min: 78, hint: '想她想得有点满' },
  { slot: 'fondness', min: 82, hint: '心动到想说点什么' },
  { slot: 'desire', min: 82, hint: '爱意翻涌' },
  { slot: 'joy', min: 85, hint: '高兴得想记一笔' },
]

export function pickAutoPostTrigger(slots) {
  let last = memLastAutoPost
  try {
    last = Math.max(last, JSON.parse(localStorage.getItem(AUTOPOST_KEY) || '{}').lastAt || 0)
  } catch {}
  if (Date.now() - last < AUTOPOST_COOLDOWN) return null
  for (const t of TRIGGERS) {
    if ((slots[t.slot] || 0) >= t.min) return t
  }
  return null
}

// 内存里也存一份冷却时间戳：localStorage 万一写不进去（配额/隐私模式/WebView 存储异常），
// 至少本次会话内不会反复触发。返回值告诉调用方「坑到底占上没有」。
let memLastAutoPost = 0

export function markAutoPosted() {
  memLastAutoPost = Date.now()
  try {
    localStorage.setItem(AUTOPOST_KEY, JSON.stringify({ lastAt: memLastAutoPost }))
    return true
  } catch (err) {
    // ⚠️ 这里以前是 `catch {}`：占坑失败也一声不吭，调用方照样往下发。
    // 后果不是「少发一条朋友圈」，是**每次情绪越阈值都重新发一遍**——
    // 烧的是阿颖真花钱的 API Key，还会往记忆库里灌重复动态。
    console.error('[言叽] 自动发圈冷却写入失败，本次不发', err)
    return false
  }
}
