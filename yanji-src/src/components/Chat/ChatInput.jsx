import { useState, useRef, useEffect, useCallback } from 'react'
import { showToast } from '../Toast'
import { transcribeAudio } from '../../api/moonMemory'

const STICKERS = [
  'kaixin.png','wuyu.png','qushi.png','shangban.png','xihuan.png',
  'shinshi.png','ding.png','love.png','liangjingjing.png',
  'crow_close.jpg','crow_sunset.jpg','meiyou.jpg','shishikan.jpg',
  'queren.jpg','fenkaida.jpg',
  'beipan-siligu.png','ni-you-claude-cong.png','beiandezhe.png',
  'xiaogou-dezhi.png','wo-yao-gaozhuan.png','qishi-pengpeng.png',
  'brewing-puzzling.png','nishuo-duile.png',
  'zhongsuan-laile.png','atao-weiqiu.png',
  // 猫猫系列
  's-tieti.jpg','s-tieti2.jpg','s-aixin.jpg','s-aixin2.jpg','s-love.jpg',
  's-haixiu.jpg','s-shufu.jpg','s-xihuan.jpg','s-wozai.jpg','s-yiqipa.jpg',
  's-motou.jpg','s-motou2.jpg','s-naoxiaba.jpg','s-nilian.jpg','s-dapugu.jpg',
  's-yaer.jpg','s-baituo.jpg','s-hi.jpg',
  's-kaixin-changge.jpg','s-kaixin2.jpg','s-jiaoa.jpg','s-xixi.jpg',
  's-en.jpg','s-sheme.jpg','s-wenhao.jpg','s-wenhao2.jpg',
  's-jinzhang.jpg','s-zhongji.jpg','s-haipa.jpg','s-emo.jpg','s-zhamao.jpg',
  's-shengqi.jpg','s-no.jpg',
  's-weiquku.jpg','s-weiqui.jpg','s-ku.jpg','s-ku2.jpg','s-suoyi-ku.jpg','s-zaidi-ku.jpg',
  's-buyaozou.jpg','s-bupei.jpg','s-xinsui.jpg','s-jusang.jpg',
  's-yundao.jpg','s-yundao2.jpg','s-shuijiao.jpg','s-shuizhao.jpg','s-gangxingwu.jpg',
  's-ele.jpg','s-xiangjichi.jpg','s-xiang-chi.jpg','s-maidanglao.jpg','s-fengkuang.jpg',
  's-zuofan.jpg','s-tinyinyue.jpg','s-pang.jpg','s-modudu.jpg',
  's-tianshi.jpg','s-jiaojiao.jpg','s-ding2.jpg',
  's-qianfei.jpg','s-quanshi.jpg','s-haiyaoyao.jpg','s-meiyoule.jpg',
  's-zaixiele.jpg','s-zhidaole.jpg','s-zaiyebugandele.jpg',
  's-wanan.jpg',
]
const STICKER_BASE = 'https://memory.ravenlove.cc/raven/stickers/'

export default function ChatInput({ onSend, disabled, onImageAdd, images, onImageRemove, moonMemory }) {
  const [text, setText] = useState('')
  const [stickerOpen, setStickerOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyQ, setHistoryQ] = useState('')
  const [historyResults, setHistoryResults] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [attachedTexts, setAttachedTexts] = useState([])
  const [listening, setListening] = useState(false)     // 录音中
  const [transcribing, setTranscribing] = useState(false) // 转写中
  const textareaRef = useRef(null)
  const fileRef = useRef(null)
  const pickerRef = useRef(null)
  const historyRef = useRef(null)
  const mediaRecRef = useRef(null)
  const audioChunksRef = useRef([])

  useEffect(() => {
    if (!stickerOpen) return
    const close = (e) => { if (!pickerRef.current?.contains(e.target)) setStickerOpen(false) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [stickerOpen])

  useEffect(() => {
    if (!historyOpen) return
    const close = (e) => { if (!historyRef.current?.contains(e.target)) setHistoryOpen(false) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [historyOpen])

  const searchHistory = useCallback(async (q) => {
    if (!q.trim() || !moonMemory?.enabled || !moonMemory?.apiToken) return
    setHistoryLoading(true)
    try {
      const base = (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
      const resp = await fetch(`${base}/archive/search?q=${encodeURIComponent(q)}&limit=10`, {
        headers: { Authorization: `Bearer ${moonMemory.apiToken}` }
      })
      if (resp.ok) setHistoryResults(await resp.json())
    } catch {}
    setHistoryLoading(false)
  }, [moonMemory])

  function attachHistory(item) {
    const label = `历史对话（${item.title || '存档'}）`
    const content = `[${item.role === 'human' ? '阿颖' : '阿言'}] ${item.content}`
    setAttachedTexts((prev) => [...prev, { name: label, content }])
    setHistoryOpen(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      submit()
    }
  }

  // 录音 → 上传服务端 SiliconFlow 转写。安卓 Chrome 的 Web Speech API 不可用，改用这条路。
  // 点一下开始录音，再点一下停止并转写——阿颖手动控制说完没说完。
  async function toggleVoice() {
    if (transcribing) return
    if (listening) { // 停止录音 → 触发 onstop 转写
      try { mediaRecRef.current?.stop() } catch {}
      return
    }
    if (!moonMemory?.apiToken) { showToast('语音转文字需要先在设置里连接记忆库', 'error'); return }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      showToast('当前浏览器不支持录音', 'error'); return
    }
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      showToast('麦克风打不开：' + (e.message || e.name), 'error', 5000); return
    }
    const mr = new MediaRecorder(stream)
    audioChunksRef.current = []
    mr.ondataavailable = (e) => { if (e.data && e.data.size) audioChunksRef.current.push(e.data) }
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      setListening(false)
      const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' })
      if (blob.size < 1200) { showToast('录音太短了，再说一次', 'info'); return }
      setTranscribing(true)
      try {
        const t = await transcribeAudio({ baseUrl: moonMemory.baseUrl, apiToken: moonMemory.apiToken }, blob)
        if (t) { setText((prev) => prev ? prev + t : t); textareaRef.current?.focus() }
        else showToast('没识别到内容，再说一次', 'info')
      } catch (e) {
        showToast(e.message || '转写失败', 'error', 5000)
      } finally {
        setTranscribing(false)
      }
    }
    mediaRecRef.current = mr
    mr.start()
    setListening(true)
  }

  function sendSticker(name) {
    setStickerOpen(false)
    const tag = `[sticker:${name}]`
    const el = textareaRef.current
    if (!el) return
    const pos = el.selectionStart ?? el.value.length
    const next = el.value.slice(0, pos) + tag + el.value.slice(pos)
    setText(next)
    setTimeout(() => { el.focus(); el.setSelectionRange(pos + tag.length, pos + tag.length) }, 0)
  }

  function submit() {
    if (disabled || (!text.trim() && !images?.length && !attachedTexts.length)) return
    let finalText = text.trim()
    if (attachedTexts.length) {
      const blocks = attachedTexts.map((f) => `--- 文件：${f.name} ---\n${f.content}`).join('\n\n')
      finalText = finalText ? `${finalText}\n\n${blocks}` : blocks
    }
    onSend(finalText, images || [])
    setText('')
    setAttachedTexts([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  function handleInput(e) {
    setText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  function handleImageClick() {
    fileRef.current?.click()
  }

  // 压缩到 1280px JPEG：手机原图几 MB 的 base64 会撑爆 localStorage（~5MB 配额），
  // 也会让 API 请求体积和 token 成本暴涨
  function compressImage(file, maxDim = 1280, quality = 0.8) {
    return new Promise((resolve) => {
      const fallback = () => {
        const reader = new FileReader()
        reader.onload = (ev) => resolve(ev.target.result)
        reader.readAsDataURL(file)
      }
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
          const w = Math.round(img.width * scale)
          const h = Math.round(img.height * scale)
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          canvas.getContext('2d').drawImage(img, 0, 0, w, h)
          resolve(canvas.toDataURL('image/jpeg', quality))
        } catch { fallback() }
      }
      img.onerror = () => { URL.revokeObjectURL(url); fallback() }
      img.src = url
    })
  }

  function handleFileChange(e) {
    const files = Array.from(e.target.files || [])
    files.forEach((file) => {
      if (file.type.startsWith('image/')) {
        compressImage(file).then((dataUrl) => onImageAdd?.(dataUrl))
      } else if (file.type === 'text/plain' || file.name.match(/\.(txt|md|csv|json|js|py|html|css)$/i)) {
        if (file.size > 200 * 1024) { alert(`${file.name} 太大了（最大 200KB）`); return }
        const reader = new FileReader()
        reader.onload = (ev) => setAttachedTexts((prev) => [...prev, { name: file.name, content: ev.target.result }])
        reader.readAsText(file, 'utf-8')
      }
    })
    e.target.value = ''
  }

  const canSearchHistory = moonMemory?.enabled && moonMemory?.apiToken

  return (
    <div className="chat-input-area">
      {stickerOpen && (
        <div className="sticker-picker" ref={pickerRef}>
          {STICKERS.map((name) => (
            <div key={name} className="sticker-opt" onClick={() => sendSticker(name)}>
              <img src={STICKER_BASE + name} alt={name} loading="lazy" />
            </div>
          ))}
        </div>
      )}
      {historyOpen && canSearchHistory && (
        <div className="history-panel" ref={historyRef}>
          <div className="history-search-row">
            <input
              className="history-search-input"
              placeholder="搜索历史对话..."
              value={historyQ}
              onChange={(e) => setHistoryQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchHistory(historyQ)}
              autoFocus
            />
            <button className="history-search-btn" onClick={() => searchHistory(historyQ)} disabled={historyLoading}>
              {historyLoading ? '…' : '搜'}
            </button>
          </div>
          <div className="history-results">
            {historyResults.length === 0 && !historyLoading && (
              <div className="history-empty">输入关键词后按搜索</div>
            )}
            {historyResults.map((item) => (
              <div key={item.id} className="history-item" onClick={() => attachHistory(item)}>
                <div className="history-item-meta">
                  <span className="history-item-role">{item.role === 'human' ? '阿颖' : '阿言'}</span>
                  <span className="history-item-title">{item.title || '存档'}</span>
                </div>
                <div className="history-item-content">{(item.content || '').slice(0, 120)}{(item.content || '').length > 120 ? '…' : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {images?.length > 0 && (
        <div className="input-image-preview">
          {images.map((src, i) => (
            <div key={i} className="input-img-thumb">
              <img src={src} alt="" />
              <button className="input-img-remove" onClick={() => onImageRemove?.(i)}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      {attachedTexts.length > 0 && (
        <div className="input-text-files">
          {attachedTexts.map((f, i) => (
            <div key={i} className="input-text-chip">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              <span>{f.name}</span>
              <button onClick={() => setAttachedTexts((prev) => prev.filter((_, idx) => idx !== i))}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="chat-input-row">
        <div className="chat-input-actions-left">
          <button className="input-action-btn" title="添加图片" onClick={handleImageClick}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <button
            className={'input-action-btn' + (stickerOpen ? ' active' : '')}
            title="贴图"
            onClick={(e) => { e.stopPropagation(); setStickerOpen((v) => !v); setHistoryOpen(false) }}
          >🐦</button>
          <button
            className={'input-action-btn' + (listening ? ' recording' : '') + (transcribing ? ' active' : '')}
            title={transcribing ? '转写中…' : listening ? '点一下结束并转文字' : '语音输入（点一下开始录音）'}
            onClick={toggleVoice}
            disabled={transcribing}
          >
            {transcribing ? (
              <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            )}
          </button>
          {canSearchHistory && (
            <button
              className={'input-action-btn' + (historyOpen ? ' active' : '')}
              title="搜历史对话"
              onClick={(e) => { e.stopPropagation(); setHistoryOpen((v) => !v); setStickerOpen(false) }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
            </button>
          )}
        </div>
        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          placeholder="输入消息…"
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
        />
        <button
          className={'chat-send-btn' + (disabled ? ' disabled' : '')}
          onClick={submit}
          disabled={disabled}
          title="发送"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*,.txt,.md,.csv,.json,.js,.py,.html,.css" multiple style={{ display: 'none' }} onChange={handleFileChange} />
    </div>
  )
}
