const http = require('http')
const https = require('https')
const dns = require('dns').promises
const net = require('net')

const MAX_BYTES = 768 * 1024
const MAX_REDIRECTS = 3
const CACHE_TTL = 10 * 60 * 1000
const cache = new Map()

function isPrivateAddress(address) {
  if (!net.isIP(address)) return true
  if (address.includes(':')) {
    const ip = address.toLowerCase()
    return ip === '::1' || ip === '::' || ip.startsWith('fc') || ip.startsWith('fd') ||
      ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb') ||
      ip.startsWith('::ffff:127.') || ip.startsWith('::ffff:10.') || ip.startsWith('::ffff:192.168.')
  }
  const p = address.split('.').map(Number)
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
}

async function publicAddresses(hostname) {
  const rows = await dns.lookup(hostname, { all: true, verbatim: true })
  if (!rows.length || rows.some(row => isPrivateAddress(row.address))) throw new Error('private address')
  return rows
}

function pinnedLookup(chosen) {
  return (_host, opts, cb) => opts?.all
    ? cb(null, [chosen])
    : cb(null, chosen.address, chosen.family)
}

function decodeEntities(s = '') {
  return s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
}

function meta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'),
  ]
  for (const re of patterns) { const m = re.exec(html); if (m) return decodeEntities(m[1].trim()) }
  return ''
}

function parseHtml(html, pageUrl) {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = meta(html, 'og:title') || meta(html, 'twitter:title') || decodeEntities(titleMatch?.[1]?.replace(/\s+/g, ' ').trim() || '')
  const description = meta(html, 'og:description') || meta(html, 'description') || meta(html, 'twitter:description')
  const imageRaw = meta(html, 'og:image') || meta(html, 'twitter:image')
  let image = ''
  try { if (imageRaw) image = new URL(imageRaw, pageUrl).href } catch {}
  const text = decodeEntities(html
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  return { title: title.slice(0, 300), description: description.slice(0, 800), image, text: text.slice(0, 6000) }
}

async function download(rawUrl, redirects = 0) {
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid url')
  const addresses = await publicAddresses(url.hostname)
  const chosen = addresses[0]
  const transport = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: 'GET', timeout: 6500,
      headers: { 'User-Agent': 'Yanji-LinkPreview/1.0', Accept: 'text/html,application/xhtml+xml;q=0.9' },
      lookup: pinnedLookup(chosen),
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        if (redirects >= MAX_REDIRECTS) return reject(new Error('too many redirects'))
        let next
        try { next = new URL(res.headers.location, url).href } catch { return reject(new Error('bad redirect')) }
        return download(next, redirects + 1).then(resolve, reject)
      }
      const type = String(res.headers['content-type'] || '').toLowerCase()
      if (res.statusCode < 200 || res.statusCode >= 300 || !type.includes('text/html')) {
        res.resume(); return reject(new Error('not html'))
      }
      const chunks = []
      let size = 0
      res.on('data', chunk => {
        size += chunk.length
        if (size > MAX_BYTES) req.destroy(new Error('page too large'))
        else chunks.push(chunk)
      })
      res.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), finalUrl: url.href }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

async function getLinkPreview(rawUrl) {
  const normalized = new URL(rawUrl).href
  const hit = cache.get(normalized)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value
  const { html, finalUrl } = await download(normalized)
  const parsed = parseHtml(html, finalUrl)
  const host = new URL(finalUrl).hostname.replace(/^www\./, '')
  const value = { url: finalUrl, site: host, title: parsed.title || host, description: parsed.description, image: parsed.image, text: parsed.text, status: parsed.text.length > 120 ? 'read' : 'preview' }
  cache.set(normalized, { at: Date.now(), value })
  return value
}

module.exports = { getLinkPreview, isPrivateAddress, parseHtml, pinnedLookup }
