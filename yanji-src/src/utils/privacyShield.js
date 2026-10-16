// 出门脱敏（1016 阿颖提的）：记忆库里有真名、经历这些，查记忆的工具会把它们带进发给中转站的请求里。
// 中转站会换着用，所以不能靠挑一家靠谱的，得在我们自己这头拦：
// 所有发往「不是我们自己服务器」的请求，请求体里的词先按替换表换成代称，手机号、身份证号直接抹掉。
// 只换出去、不换回来：代称本来就是能看的称呼（真名→阿颖），中转站回话里出现它也不用还原。
// 替换表存在记忆库服务器上（/privacy/redact），所有设备共用；本地留一份缓存，离线也照样拦。
import { useStore } from '../store'

const CACHE = 'yanji-privacy-rules'
const OUR_HOSTS = ['memory.ravenlove.cc']

let rules = []
try { rules = JSON.parse(localStorage.getItem(CACHE)) || [] } catch {}
let compiled = null

// 前后不能是字母数字或 base64 字符，免得改坏图片的 base64 和时间戳这类长数字
const EDGE_L = '(?<![A-Za-z0-9+/])'
const EDGE_R = '(?![A-Za-z0-9+/])'
const BUILTIN = [
  [new RegExp(`${EDGE_L}1[3-9]\\d{9}${EDGE_R}`, 'g'), '[手机号]'],
  [new RegExp(`${EDGE_L}\\d{17}[\\dXx]${EDGE_R}`, 'g'), '[证件号]'],
  // 登录地址这类 IP、邮箱也会暴露是谁、在哪（1016 扫记忆库时看到有她老家的 IP）
  [/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, '[IP]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '[邮箱]'],
]

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// 写进 JSON 字符串里也不能破坏结构：代称里的引号、反斜杠、换行去掉
const safeTo = s => String(s || '').replace(/["\\\n\r\t]/g, '')

function compile() {
  compiled = rules
    .filter(r => r?.from && !/["\\\n\r\t]/.test(r.from))
    .sort((a, b) => b.from.length - a.from.length)
    .map(r => {
      const latin = /^[\x20-\x7e]+$/.test(r.from)
      // 英文词按整词换（Serena 不会误伤 Serenade），大小写不敏感；中文直接换
      const re = latin ? new RegExp(`(?<![A-Za-z0-9])${esc(r.from)}(?![A-Za-z0-9])`, 'gi') : new RegExp(esc(r.from), 'g')
      return [re, safeTo(r.to)]
    })
}

export function redactText(str) {
  if (typeof str !== 'string' || !str) return str
  if (!compiled) compile()
  let out = str
  for (const [re, to] of compiled) out = out.replace(re, to)
  for (const [re, to] of BUILTIN) out = out.replace(re, to)
  return out
}

export function getPrivacyRules() { return rules.slice() }

function setRules(next) {
  rules = Array.isArray(next) ? next : []
  compiled = null
  try { localStorage.setItem(CACHE, JSON.stringify(rules)) } catch {}
}

function moonAuth() {
  const m = useStore.getState().moonMemory || {}
  if (!m.apiToken) return null
  return { base: String(m.baseUrl || 'https://memory.ravenlove.cc').replace(/\/+$/, ''), token: m.apiToken }
}

export async function refreshPrivacyRules() {
  const a = moonAuth(); if (!a) return getPrivacyRules()
  const r = await fetch(`${a.base}/privacy/redact`, { headers: { Authorization: `Bearer ${a.token}` } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  setRules((await r.json()).rules)
  return getPrivacyRules()
}

export async function savePrivacyRules(next) {
  const a = moonAuth(); if (!a) throw new Error('先在「拾羽记忆库」填好 Token')
  const r = await fetch(`${a.base}/privacy/redact`, {
    method: 'PUT', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: next }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  setRules(d.rules)
  return getPrivacyRules()
}

function isOurs(url) {
  try {
    const u = new URL(url, location.href)
    if (u.protocol === 'data:' || u.protocol === 'blob:') return true
    const hosts = [location.host, ...OUR_HOSTS]
    try { hosts.push(new URL(useStore.getState().moonMemory?.baseUrl).host) } catch {}
    return hosts.includes(u.host)
  } catch { return true }
}

export function installPrivacyShield() {
  if (window.__yanjiPrivacyShield) return
  window.__yanjiPrivacyShield = true
  const orig = window.fetch.bind(window)
  window.fetch = (input, init) => {
    try {
      const url = typeof input === 'string' ? input : input?.url
      if (init && typeof init.body === 'string' && !isOurs(url)) init = { ...init, body: redactText(init.body) }
    } catch {}
    return orig(input, init)
  }
  refreshPrivacyRules().catch(() => {})
}
