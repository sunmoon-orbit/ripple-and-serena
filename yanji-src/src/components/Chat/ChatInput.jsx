import { useState, useRef, useEffect } from 'react'

const STICKERS = [
  'kaixin.png','wuyu.png','qushi.png','shangban.png','xihuan.png',
  'shinshi.png','ding.png','love.png','liangjingjing.png',
  'crow_close.jpg','crow_sunset.jpg','meiyou.jpg','shishikan.jpg',
  'queren.jpg','fenkaida.jpg',
  'beipan-siligu.png','ni-you-claude-cong.png','beiandezhe.png',
  'xiaogou-dezhi.png','wo-yao-gaozhuan.png','qishi-pengpeng.png',
  'brewing-puzzling.png','nishuo-duile.png',
]
const STICKER_BASE = 'https://memory.ravenlove.cc/raven/stickers/'

export default function ChatInput({ onSend, disabled, onImageAdd, images, onImageRemove }) {
  const [text, setText] = useState('')
  const [stickerOpen, setStickerOpen] = useState(false)
  const textareaRef = useRef(null)
  const fileRef = useRef(null)
  const pickerRef = useRef(null)

  useEffect(() => {
    if (!stickerOpen) return
    const close = (e) => { if (!pickerRef.current?.contains(e.target)) setStickerOpen(false) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [stickerOpen])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
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
    if (disabled || (!text.trim() && !images?.length)) return
    onSend(text.trim(), images || [])
    setText('')
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
      if (!file.type.startsWith('image/')) return
      compressImage(file).then((dataUrl) => onImageAdd?.(dataUrl))
    })
    e.target.value = ''
  }

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
            onClick={(e) => { e.stopPropagation(); setStickerOpen((v) => !v) }}
          >🐦</button>
        </div>
        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          placeholder="输入消息... (Shift+Enter 换行)"
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
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />
    </div>
  )
}
