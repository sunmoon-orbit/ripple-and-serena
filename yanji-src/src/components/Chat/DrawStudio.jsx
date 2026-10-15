// 画图窗口（1015，她想用 GPT 的新画图模型自己画表情包，「这样子的话，发表情包之类就不会夹带私货了」）。
// 单独一个窗口而不是插在聊天里：来回改的试错不冲聊天；每画一张都花钱，这里看得见画了几张；成品再一键发到聊天／存相册／存手机。
// 接口走 OpenAI 兼容的 /v1/images/generations，地址、钥匙、模型名都她自己填（官方或中转站都行），不写死模型。
// 设置存本机 localStorage；画过的图存 IndexedDB（bigStore），只留最近 24 张。
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToolMemory } from './ToolMemory'
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

function loadConf() {
  try { return { baseUrl: '', apiKey: '', model: '', size: '1024x1024', quality: 'auto', transparent: false, ...JSON.parse(localStorage.getItem(CONF_KEY) || '{}') } }
  catch { return { baseUrl: '', apiKey: '', model: '', size: '1024x1024', quality: 'auto', transparent: false } }
}
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
  const [conf, setConf] = useState(loadConf)
  const [showConf, setShowConf] = useState(() => !loadConf().apiKey)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [hist, setHist] = useState([])
  const [count, setCount] = useState(loadCount)
  const [view, setView] = useState(null)   // 点开大图的那一张
  const timer = useRef(null)

  useEffect(() => { bigGet(HIST_KEY).then(h => setHist(Array.isArray(h) ? h : [])).catch(() => {}) }, [])
  useEffect(() => () => clearInterval(timer.current), [])
  const patch = (p) => setConf(c => { const n = { ...c, ...p }; try { localStorage.setItem(CONF_KEY, JSON.stringify(n)) } catch {}; return n })
  const saveHist = (h) => { setHist(h); bigSet(HIST_KEY, h).catch(() => {}) }

  async function draw() {
    const text = prompt.trim()
    if (!text) { showToast('先写想画什么', 'error'); return }
    if (!conf.apiKey || !conf.model) { setShowConf(true); showToast('先填钥匙和模型名', 'error'); return }
    setBusy(true); setElapsed(0)
    const t0 = Date.now(); timer.current = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000)
    try {
      const body = { model: conf.model.trim(), prompt: text, n: 1 }
      if (conf.size !== 'auto') body.size = conf.size
      if (conf.quality !== 'auto') body.quality = conf.quality
      if (conf.transparent) body.background = 'transparent'
      const r = await fetch(endpoint(conf.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conf.apiKey.trim()}` },
        body: JSON.stringify(body),
      })
      const raw = await r.text()
      let d = null; try { d = JSON.parse(raw) } catch {}
      if (!r.ok) throw new Error(d?.error?.message || raw.slice(0, 200) || `HTTP ${r.status}`)
      const item = d?.data?.[0]
      let dataUrl = ''
      if (item?.b64_json) dataUrl = `data:image/png;base64,${item.b64_json}`
      else if (item?.url) {
        try { dataUrl = await toDataUrl(await (await fetch(item.url)).blob()) } catch { dataUrl = item.url }   // 拿不到就先存地址（中转站给的链接可能会过期）
      }
      if (!dataUrl) throw new Error('接口回来了，但里面没有图')
      const entry = { id: Date.now(), prompt: text, model: body.model, size: conf.size, dataUrl, at: new Date().toISOString(), usage: d?.usage || null }
      saveHist([entry, ...hist].slice(0, MAX_HIST))
      setCount(bumpCount())
      setView(entry)
    } catch (e) {
      showToast('没画出来：' + (e.message || e), 'error')
    } finally {
      clearInterval(timer.current); setBusy(false)
    }
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
            {showConf ? '收起设置' : `设置 · ${conf.model || '还没填模型'}`}<span>这个月画了 {count} 张</span>
          </button>
          {showConf && (
            <div className="draw-conf">
              <label>接口地址<input value={conf.baseUrl} onChange={e => patch({ baseUrl: e.target.value })} placeholder="空着就是 OpenAI 官方；中转站填它给的地址" autoComplete="off" /></label>
              <label>钥匙<input type="password" value={conf.apiKey} onChange={e => patch({ apiKey: e.target.value })} placeholder="sk-…" autoComplete="off" /></label>
              <label>模型名<input value={conf.model} onChange={e => patch({ model: e.target.value })} placeholder="比如 gpt-image-1，照你那边的写" autoComplete="off" /></label>
              <small>只存在这台手机上。每画一张都按次扣钱，「省钱」那档最便宜。</small>
            </div>
          )}

          <textarea className="draw-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
            placeholder="想画什么？比如：一只黑色小乌鸦捂着脸害羞，Q 版表情包，白底，粗线条" />
          <div className="draw-opts">
            <div className="draw-seg">{SIZES.map(([v, l]) => <button key={v} className={conf.size === v ? 'on' : ''} onClick={() => patch({ size: v })}>{l}</button>)}</div>
            <div className="draw-seg">{QUALITIES.map(([v, l]) => <button key={v} className={conf.quality === v ? 'on' : ''} onClick={() => patch({ quality: v })}>{l}</button>)}</div>
            <label className="draw-check"><input type="checkbox" checked={conf.transparent} onChange={e => patch({ transparent: e.target.checked })} />透明底（做贴纸）</label>
          </div>
          <button className="draw-go" disabled={busy} onClick={draw}>{busy ? `在画… ${elapsed} 秒` : '画'}</button>

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
