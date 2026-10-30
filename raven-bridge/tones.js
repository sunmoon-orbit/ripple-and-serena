// 铃声库（1030 她要的）：
//   「午休就 good afternoon……平常的小提醒就有其他的」——闹钟按时间段挑我录的那几段，卡片也能点名要哪段；
//   「你的来电是不是可以设置自定义铃声？毕竟我们有接歌曲库」——听歌面板里一首歌截前 40 秒存成铃声；
//   「我也可以自己设闹钟……加那个音乐声音，或者是你之前录好的声音」——她自己设闹钟时从这里挑。
// 文件放 raven-uploads/tones/，清单 tones.json：[{ f, label, kind: 'voice'|'song', at }]
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { execFile } = require('child_process')

const FFMPEG = '/home/ripple/opt/ffmpeg/ffmpeg'
const NAME_RE = /^[\w.-]{1,80}\.mp3$/
// 没点名时按闹钟的钟点挑（北京时间）：早上 / 中午 / 其他
const BANDS = [
  { from: 4 * 60, to: 11 * 60, f: 'voice-morning.mp3' },
  { from: 11 * 60, to: 15 * 60, f: 'voice-afternoon.mp3' },
]
const GENERAL = 'voice-general.mp3'

module.exports = function makeTones(UPLOAD_DIR) {
  const DIR = path.join(UPLOAD_DIR, 'tones')
  const INDEX = path.join(DIR, 'tones.json')
  fs.mkdirSync(DIR, { recursive: true })

  const list = () => { try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')) } catch { return [] } }
  const save = l => { fs.writeFileSync(INDEX + '.tmp', JSON.stringify(l, null, 1)); fs.renameSync(INDEX + '.tmp', INDEX) }
  const exists = f => NAME_RE.test(f) && fs.existsSync(path.join(DIR, f))

  function pickForTime(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '')
    if (m) {
      const min = +m[1] * 60 + +m[2]
      const band = BANDS.find(b => min >= b.from && min < b.to)
      if (band && exists(band.f)) return path.join(DIR, band.f)
    }
    if (exists(GENERAL)) return path.join(DIR, GENERAL)
    return path.join(UPLOAD_DIR, 'alarm-tone.mp3')
  }

  function download(u, dest, hops = 0) {
    return new Promise((resolve, reject) => {
      if (!/^https?:\/\//.test(u)) return reject(new Error('bad url'))
      const mod = u.startsWith('https') ? https : http
      const r = mod.get(u, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 4) {
          res.resume(); return resolve(download(new URL(res.headers.location, u).href, dest, hops + 1))
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)) }
        let size = 0
        const out = fs.createWriteStream(dest)
        res.on('data', c => { size += c.length; if (size > 40 * 1024 * 1024) { r.destroy(); out.destroy(); reject(new Error('too big')) } })
        res.pipe(out)
        out.on('finish', () => resolve())
        out.on('error', reject)
      })
      r.on('timeout', () => { r.destroy(); reject(new Error('timeout')) })
      r.on('error', reject)
    })
  }

  // 截前 40 秒，头淡入半秒、尾淡出三秒，响铃循环时不会「咔」一下
  function trim(src, dest) {
    return new Promise((resolve, reject) => {
      execFile(FFMPEG, ['-y', '-loglevel', 'error', '-i', src, '-t', '40', '-vn',
        '-af', 'afade=t=in:d=0.5,afade=t=out:st=37:d=3', '-ac', '2', '-b:a', '128k', dest],
        { timeout: 60000 }, err => err ? reject(err) : resolve())
    })
  }

  function send(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(obj))
  }
  function sendFile(res, file) {
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length, 'Cache-Control': 'private, no-store' })
      res.end(buf)
    })
  }

  // 返回 true 表示这个请求归这里管
  return function handle(req, res, url, authed) {
    const p = url.pathname
    if (p === '/raven/alarm-tone' && req.method === 'GET') {
      if (!authed) { res.writeHead(401); res.end(); return true }
      const f = url.searchParams.get('f') || ''
      sendFile(res, exists(f) ? path.join(DIR, f) : pickForTime(url.searchParams.get('at')))
      return true
    }
    if (p === '/raven/tone' && req.method === 'GET') {
      if (!authed) { res.writeHead(401); res.end(); return true }
      const f = url.searchParams.get('f') || ''
      if (!exists(f)) { res.writeHead(404); res.end(); return true }
      sendFile(res, path.join(DIR, f))
      return true
    }
    if (p !== '/raven/tones') return false
    if (!authed) { send(res, 401, { error: 'unauthorized' }); return true }
    if (req.method === 'GET') { send(res, 200, list().filter(t => exists(t.f))); return true }
    if (req.method === 'DELETE') {
      const f = url.searchParams.get('f') || ''
      const l = list(), t = l.find(x => x.f === f)
      if (!t || t.kind !== 'song') { send(res, 400, { error: '只能删歌做的铃声' }); return true }
      try { fs.unlinkSync(path.join(DIR, f)) } catch {}
      save(l.filter(x => x.f !== f)); send(res, 200, { ok: true }); return true
    }
    if (req.method === 'POST') {
      let body = ''
      req.on('data', c => { body += c; if (body.length > 8000) req.destroy() })
      req.on('end', async () => {
        let j; try { j = JSON.parse(body) } catch { return send(res, 400, { error: 'bad json' }) }
        const label = String(j.label || '').slice(0, 60) || '一首歌'
        const f = `song-${Date.now()}.mp3`, tmp = path.join(DIR, f + '.src')
        try {
          await download(String(j.url || ''), tmp)
          await trim(tmp, path.join(DIR, f))
          const l = list(); l.unshift({ f, label, kind: 'song', at: new Date().toISOString() }); save(l)
          send(res, 201, { f, label })
        } catch (e) {
          send(res, 502, { error: '没取到这首歌：' + (e.message || e) })
        } finally { fs.unlink(tmp, () => {}) }
      })
      return true
    }
    send(res, 405, { error: 'method not allowed' })
    return true
  }
}
