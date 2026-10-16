// 画图窗口（1015，她想用 GPT 的新画图模型自己画表情包，「这样子的话，发表情包之类就不会夹带私货了」）。
// 单独一个窗口而不是插在聊天里：来回改的试错不冲聊天；每画一张都花钱，这里看得见画了几张；成品再一键发到聊天／存相册／存手机。
// 接口走 OpenAI 兼容的 /v1/images/generations。钥匙直接从 Hollow 里已有的 API 连接挑一个（她的主意：几家中转站质量不一，能换着用），
// 也留着「自己填」；模型名可以拉列表挑，不写死。
// 设置存本机 localStorage；画过的图存 IndexedDB（bigStore），只留最近 24 张。
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToolMemory } from './ToolMemory'
import { useStore } from '../../store'
import PickerSelect from '../PickerSelect'
import { showToast } from '../Toast'
import { bigGet, bigSet } from '../../utils/bigStore'
import { downloadBlob } from '../../utils/download'
import { prepareAlbumImage, saveAlbum } from '../../api/album'

const CONF_KEY = 'yanji-draw-config'
const HIST_KEY = 'draw-history'
const COUNT_KEY = 'yanji-draw-count'
const MAX_HIST = 24
const SIZES = [['1024x1024', '方'], ['1024x1536', '竖'], ['1536x1024', '横'], ['auto', '自动']]
const QUALITIES = [['auto', '自动'], ['low', '省钱'], ['medium', '中'], ['high', '精细']]

const BLANK = { connId: '', baseUrl: '', apiKey: '', model: '', size: '1024x1024', quality: 'auto', transparent: false, stream: false }
const DEFAULT_URLS = { openai: 'https://api.openai.com/v1', deepseek: 'https://api.deepseek.com/v1' }
function loadConf() {
  try { return { ...BLANK, ...JSON.parse(localStorage.getItem(CONF_KEY) || '{}') } } catch { return { ...BLANK } }
}
const IMAGE_MODEL = /image|dall|flux|kolors|sdxl|stable|imagen|seedream|midjourney|mj|banana/i
function monthKey() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}` }
function loadCount() {
  try { const c = JSON.parse(localStorage.getItem(COUNT_KEY) || '{}'); return c.month === monthKey() ? c.n || 0 : 0 } catch { return 0 }
}
function bumpCount() {
  const n = loadCount() + 1
  try { localStorage.setItem(COUNT_KEY, JSON.stringify({ month: monthKey(), n })) } catch {}
  return n
}
// 地址填到哪一层都认：https://x.com、https://x.com/v1、https://x.com/v1/ 都拼成 …/v1/images/generations
function endpoint(base) {
  const b = (base || 'https://api.openai.com').trim().replace(/\/+$/, '')
  return /\/v1$/.test(b) ? `${b}/images/generations` : `${b}/v1/images/generations`
}
async function toDataUrl(blob) {
  return await new Promise((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = bad; fr.readAsDataURL(blob) })
}
async function dataUrlToBlob(u) { return await (await fetch(u)).blob() }

export default function DrawStudio({ onClose, onSendToChat }) {
  const moonMemory = useToolMemory()
  const connections = useStore(s => s.connections) || []
  const [conf, setConf] = useState(loadConf)
  const conn = connections.find(c => c.id === conf.connId) || null
  // 真正用的地址和钥匙：挑了连接就用连接的，没挑就用自己填的
  const base = conn ? (conn.baseUrl || DEFAULT_URLS[conn.provider] || '') : conf.baseUrl
  const key = conn ? conn.apiKey : conf.apiKey
  const [showConf, setShowConf] = useState(() => { const c = loadConf(); return !c.model || (!c.connId && !c.apiKey) })
  const [models, setModels] = useState([])
  const [fetching, setFetching] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [hist, setHist] = useState([])
  const [count, setCount] = useState(loadCount)
  const [view, setView] = useState(null)   // 点开大图的那一张
  const [err, setErr] = useState('')        // 报错留在窗口里，不再红框一闪就没（1015 她：「突然闪了一个红框，然后啥也没输出」）
  const [partial, setPartial] = useState('') // 边画边传时的半成品
  const timer = useRef(null)
  const ctrl = useRef(null)   // 停掉卡住的请求（1016 第一张等了四百秒还没出来，只能干等）

  useEffect(() => { bigGet(HIST_KEY).then(h => setHist(Array.isArray(h) ? h : [])).catch(() => {}) }, [])
  useEffect(() => () => clearInterval(timer.current), [])
  const patch = (p) => setConf(c => { const n = { ...c, ...p }; try { localStorage.setItem(CONF_KEY, JSON.stringify(n)) } catch {}; return n })
  const saveHist = (h) => { setHist(h); bigSet(HIST_KEY, h).catch(() => {}) }

  // 发一次请求。stream=true 时让它边画边传半成品（partial_images），连接一直有动静，
  // 就不会被中转站前面的 Cloudflare 一百秒没回话就掐断（1015 第一次画了九十多秒被掐，没扣费）。
  // 中转站不支持流式、直接回一整个 JSON 的，也照常接住。
  async function request(body) {
    const r = await fetch(endpoint(base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${String(key).trim()}` },
      body: JSON.stringify(body),
      signal: ctrl.current?.signal,
    })
    const ct = r.headers.get('content-type') || ''
    if (!r.ok) {
      const raw = await r.text(); let d = null; try { d = JSON.parse(raw) } catch {}
      const e = new Error(d?.error?.message ? `${d.error.message}${d.error.code ? `（${d.error.code}）` : ''}` : (raw.slice(0, 300) || `HTTP ${r.status}`))
      e.status = r.status; throw e
    }
    if (!ct.includes('event-stream')) {
      const d = await r.json(); const item = d?.data?.[0]
      if (item?.b64_json) return { dataUrl: `data:image/png;base64,${item.b64_json}`, usage: d.usage || null }
      if (item?.url) { try { return { dataUrl: await toDataUrl(await (await fetch(item.url)).blob()), usage: d.usage || null } } catch { return { dataUrl: item.url, usage: d.usage || null } } }
      throw new Error('接口回来了，但里面没有图')
    }
    const reader = r.body.getReader(), dec = new TextDecoder()
    let buf = '', done = null
    for (;;) {
      const { value, done: end } = await reader.read()
      if (end) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim(); if (!payload || payload === '[DONE]') continue
        let ev; try { ev = JSON.parse(payload) } catch { continue }
        if (ev.error) throw new Error(ev.error.message || JSON.stringify(ev.error))
        const b64 = ev.b64_json || ev.data?.[0]?.b64_json
        if (!b64) continue
        const url = `data:image/png;base64,${b64}`
        if (/partial/.test(ev.type || '')) setPartial(url)
        else done = { dataUrl: url, usage: ev.usage || null }
      }
    }
    if (!done) throw new Error('流传完了，但没收到最终的图')
    return done
  }

  async function draw() {
    const text = prompt.trim()
    if (!text) { setErr('先写想画什么'); return }
    if (!key || !conf.model) { setShowConf(true); setErr('先挑连接（或填钥匙）和模型名'); return }
    setBusy(true); setElapsed(0); setErr(''); setPartial('')
    ctrl.current = new AbortController()
    const t0 = Date.now(); timer.current = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000)
    const body = { model: conf.model.trim(), prompt: text, n: 1 }
    if (conf.size !== 'auto') body.size = conf.size
    if (conf.quality !== 'auto') body.quality = conf.quality
    if (conf.transparent) body.background = 'transparent'
    try {
      let res
      if (conf.stream) {
        try { res = await request({ ...body, stream: true, partial_images: 2 }) }
        catch (e) {
          // 中转站不认 stream／partial_images 这类参数时会立刻回 4xx：退回不流式再来一次
          if (e.status >= 400 && e.status < 500 && /stream|partial|param|unknown|unsupported|不支持/i.test(e.message)) res = await request(body)
          else throw e
        }
      } else res = await request(body)
      const entry = { id: Date.now(), prompt: text, model: body.model, size: conf.size, dataUrl: res.dataUrl, at: new Date().toISOString(), usage: res.usage }
      saveHist([entry, ...hist].slice(0, MAX_HIST))
      setCount(bumpCount())
      setView(entry); setPartial('')
    } catch (e) {
      const sec = Math.round((Date.now() - t0) / 1000)
      const msg = String(e?.message || e)
      if (e?.name === 'AbortError') { setErr(`第 ${sec} 秒你停掉了。中转站那头可能还在画，扣没扣钱去它后台看一眼再重画。`); return }
      setErr(/Failed to fetch|NetworkError|Load failed|network/i.test(msg)
        ? `第 ${sec} 秒连接断了，没拿到图（中转站那头断开的，不是你的网）。${conf.stream ? '可以先把「边画边传」去掉再试；' : ''}也可以换「中」档或者小一点的尺寸。`
        : `第 ${sec} 秒失败：${msg}`)
    } finally {
      clearInterval(timer.current); setBusy(false)
    }
  }

  // 拉这个连接能用的模型，画图的排前面
  async function fetchModels() {
    if (!key) { showToast('先挑连接或填钥匙', 'error'); return }
    setFetching(true)
    try {
      const b = (base || 'https://api.openai.com').trim().replace(/\/+$/, '')
      const r = await fetch(`${/\/v1$/.test(b) ? b : b + '/v1'}/models`, { headers: { Authorization: `Bearer ${String(key).trim()}` } })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const ids = ((await r.json()).data || []).map(m => m.id).filter(Boolean)
      const img = ids.filter(i => IMAGE_MODEL.test(i)).sort(), rest = ids.filter(i => !IMAGE_MODEL.test(i)).sort()
      setModels([...img, ...rest])
      showToast(img.length ? `找到 ${img.length} 个像是画图的模型` : '没认出画图模型，列表里自己挑', img.length ? 'success' : 'error')
    } catch (e) { showToast('拉不到模型：' + e.message, 'error') } finally { setFetching(false) }
  }

  async function toAlbum(e) {
    try {
      const blob = await dataUrlToBlob(e.dataUrl)
      const img = await prepareAlbumImage(new File([blob], 'draw.png', { type: blob.type || 'image/png' }))
      await saveAlbum(moonMemory, { ...img, title: e.prompt.slice(0, 20), description: `言叽画图窗口画的（${e.model}）。提示词：${e.prompt}`, author: '阿颖', source: 'upload' })
      showToast('存进相册了')
    } catch (err) { showToast('没存上：' + (err.message || err), 'error') }
  }
  async function toPhone(e) {
    try { downloadBlob(await dataUrlToBlob(e.dataUrl), `yanji-draw-${e.id}.png`) } catch (err) { showToast('没存上：' + (err.message || err), 'error') }
  }
  function remove(e) { saveHist(hist.filter(x => x.id !== e.id)); if (view?.id === e.id) setView(null) }

  const body = (
    <div className="roost-overlay" onClick={onClose}>
      <div className="roost-modal roost-modal-tall draw-studio" onClick={(e) => e.stopPropagation()}>
        <div className="roost-modal-header">
          <span className="music-room-title">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
            画图
          </span>
          <button className="roost-modal-close" onClick={onClose} aria-label="关闭"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        </div>

        <div className="draw-body">
          <button className="draw-conf-toggle" onClick={() => setShowConf(v => !v)}>
            {showConf ? '收起设置' : `${conn ? (conn.name || conn.provider) : '自己填的'} · ${conf.model || '还没填模型'}`}<span>这个月画了 {count} 张</span>
          </button>
          {showConf && (
            <div className="draw-conf">
              <label>用哪个连接
                <PickerSelect value={conf.connId} onChange={e => { patch({ connId: e.target.value }); setModels([]) }}>
                  <option value="">自己填地址和钥匙</option>
                  {connections.map(c => <option key={c.id} value={c.id}>{c.name || c.provider || '未命名'}{c.baseUrl ? ` · ${c.baseUrl.replace(/^https?:\/\//, '').split('/')[0]}` : ''}</option>)}
                </PickerSelect>
              </label>
              {!conn && <>
                <label>接口地址<input value={conf.baseUrl} onChange={e => patch({ baseUrl: e.target.value })} placeholder="空着就是 OpenAI 官方；中转站填它给的地址" autoComplete="off" /></label>
                <label>钥匙<input type="password" value={conf.apiKey} onChange={e => patch({ apiKey: e.target.value })} placeholder="sk-…" autoComplete="off" /></label>
              </>}
              <label>模型名
                <div className="draw-model-row">
                  <input list="draw-models" value={conf.model} onChange={e => patch({ model: e.target.value })} placeholder="比如 gpt-image-1，照你那边的写" autoComplete="off" />
                  <button type="button" onClick={fetchModels} disabled={fetching}>{fetching ? '拉取中' : '拉列表'}</button>
                </div>
                <datalist id="draw-models">{models.map(m => <option key={m} value={m} />)}</datalist>
              </label>
              {models.length > 0 && <div className="draw-model-chips">{models.filter(m => IMAGE_MODEL.test(m)).slice(0, 12).map(m => <button key={m} type="button" className={conf.model === m ? 'on' : ''} onClick={() => patch({ model: m })}>{m}</button>)}</div>}
              <small>连接就是 Hollow 里存的那些，钥匙不另存。每画一张都按次扣钱，「省钱」那档最便宜。</small>
            </div>
          )}

          <textarea className="draw-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
            placeholder="想画什么？比如：一只黑色小乌鸦捂着脸害羞，Q 版表情包，白底，粗线条" />
          <div className="draw-opts">
            <div className="draw-seg">{SIZES.map(([v, l]) => <button key={v} className={conf.size === v ? 'on' : ''} onClick={() => patch({ size: v })}>{l}</button>)}</div>
            <div className="draw-seg">{QUALITIES.map(([v, l]) => <button key={v} className={conf.quality === v ? 'on' : ''} onClick={() => patch({ quality: v })}>{l}</button>)}</div>
            <label className="draw-check"><input type="checkbox" checked={conf.transparent} onChange={e => patch({ transparent: e.target.checked })} />透明底（做贴纸）</label>
          </div>
          <label className="draw-check"><input type="checkbox" checked={conf.stream} onChange={e => patch({ stream: e.target.checked })} />边画边传（试验：有的中转站会因此断开，出问题就别勾）</label>
          <button className="draw-go" disabled={busy} onClick={draw}>{busy ? `在画… ${elapsed} 秒` : '画'}</button>
          {busy && <button className="draw-stop" onClick={() => ctrl.current?.abort()}>停</button>}
          {busy && elapsed >= 180 && <div className="draw-slow">超过三分钟了，平常一两分钟就出来，多半是中转站卡住了，可以停掉重来。</div>}
          {err && <div className="draw-err" onClick={() => setErr('')}>{err}<small>点一下收起</small></div>}
          {busy && partial && <div className="draw-view"><img src={partial} alt="半成品" /><div className="draw-view-prompt">半成品，还在画…</div></div>}

          {view && (
            <div className="draw-view">
              <img src={view.dataUrl} alt={view.prompt} />
              <div className="draw-view-prompt">{view.prompt}</div>
              <div className="draw-acts">
                {onSendToChat && <button onClick={() => { onSendToChat(view.dataUrl); onClose() }}>发到聊天</button>}
                <button onClick={() => toAlbum(view)}>存相册</button>
                <button onClick={() => toPhone(view)}>存手机</button>
                <button onClick={() => setPrompt(view.prompt)}>照这句再改</button>
                <button className="danger" onClick={() => remove(view)}>删掉</button>
              </div>
            </div>
          )}

          {hist.length > 0 && <div className="draw-hist-title">画过的（最近 {MAX_HIST} 张，只在这台手机上）</div>}
          <div className="draw-hist">
            {hist.map(h => <button key={h.id} className={'draw-thumb' + (view?.id === h.id ? ' on' : '')} onClick={() => setView(h)}><img src={h.dataUrl} alt={h.prompt} loading="lazy" /></button>)}
          </div>
        </div>
      </div>
    </div>
  )
  return createPortal(body, document.body)
}
