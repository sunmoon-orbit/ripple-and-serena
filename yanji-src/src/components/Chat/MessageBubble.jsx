import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import { formatTime, splitTranslation } from '../../utils'
import { useStore } from '../../store'
import { synthesizeSpeech } from '../../api/moonMemory'
import MusicCard from './MusicCard'
import { applyInlineFx, stripInlineFx } from '../../utils/moodFx'
import { showToast } from '../Toast'

marked.setOptions({
  breaks: true,
  gfm: true,
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value
    }
    return hljs.highlightAuto(code).value
  },
})

// MiniMax TTS 语音标签：朗读时产生效果，显示时过滤掉
const VOICE_TAG_RE = /\[(breath|laughter)\]/gi

function parseMarkdown(text) {
  if (!text) return ''
  try {
    // 先把贴图标签换成 img、行内特效标签换成 span（marked 透传 inline HTML），再交给 marked
    // 贴图解析此前只挂在用户消息路径上，涟言自己发的 [sticker:X] 一直是原文晾着（2026-07-06 阿颖发现）
    const withStickers = text.replace(/\[sticker:([^\]"]+)\]/g, (_, name) =>
      `<img src="${/^https?:\/\//.test(name) ? name : STICKER_BASE + name}" alt="sticker" style="max-width:140px;border-radius:8px;display:block;margin:2px 0;">`)
    return marked.parse(applyInlineFx(withStickers.replace(VOICE_TAG_RE, '')))
  } catch {
    return text
  }
}

// ── 代码就地渲染 ────────────────────────────────────────────────────────────
// 发一段 html 代码块（```html），下面出现「运行」按钮，点了在沙箱 iframe 里渲染成
// 会动的小东西——表白页、爱心动画之类。用来搞点浪漫（阿颖的主意，2026-07-04）。
// 安全：sandbox 只给 allow-scripts，不给 allow-same-origin，代码碰不到我们的页面/存储。
function looksRunnableHtml(cls, raw) {
  if (/language-(html|xml|svg)/i.test(cls || '')) return true
  return /^\s*<(!doctype|html|svg|body|div|style|canvas|section|main)[\s>]/i.test(raw || '')
}
function langOf(cls) {
  const m = /language-([a-z0-9]+)/i.exec(cls || '')
  return m ? m[1].toLowerCase() : ''
}
function enhanceCodeBlocks(root) {
  if (!root) return
  root.querySelectorAll('pre > code').forEach((code) => {
    const pre = code.parentElement
    if (pre.dataset.codeEnhanced) return
    pre.dataset.codeEnhanced = '1'
    const raw = code.textContent || ''

    // ① 头部：语言标签 + 复制按钮（所有代码块都有，阿颖想要的样式）
    const head = document.createElement('div')
    head.className = 'code-head'
    const lang = document.createElement('span')
    lang.className = 'code-lang'
    lang.textContent = langOf(code.className) || 'code'
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'code-copy'
    copy.textContent = '复制'
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(raw)
        copy.textContent = '已复制'
        setTimeout(() => { copy.textContent = '复制' }, 1500)
      } catch { copy.textContent = '复制失败' }
    })
    head.appendChild(lang)
    head.appendChild(copy)
    pre.parentNode.insertBefore(head, pre)
    pre.classList.add('has-head')

    // ② 运行按钮：只有 html 代码块才有
    if (raw.length < 12 || !looksRunnableHtml(code.className, raw)) return
    const bar = document.createElement('div')
    bar.className = 'code-run-bar'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'code-run-btn'
    btn.textContent = '▶ 运行'
    bar.appendChild(btn)
    pre.parentNode.insertBefore(bar, pre.nextSibling)
    let frame = null
    btn.addEventListener('click', () => {
      if (frame) { frame.remove(); frame = null; btn.textContent = '▶ 运行'; return }
      frame = document.createElement('iframe')
      frame.className = 'code-run-frame'
      frame.setAttribute('sandbox', 'allow-scripts allow-modals')
      frame.setAttribute('loading', 'lazy')
      frame.srcdoc = raw
      bar.parentNode.insertBefore(frame, bar.nextSibling)
      btn.textContent = '■ 收起'
    })
  })
}

// ── 显影式浮现 ──────────────────────────────────────────────────────────────
// 流式输出时，新冒出来的字带一点雾（模糊+半透明）几百毫秒内变清晰——像相纸显影。
// 每个 chunk 到来时 dangerouslySetInnerHTML 会整体重设 DOM，所以只把「上次渲染之后
// 新增的尾巴」逐字包 span 做动画，旧字直接清晰呈现不重播（长消息不卡）。
// 和拾羽开场的落水涟漪凑成一套水系语言（2026-07-20 阿颖点单，方案 A）。
function revealNewTail(root, prevLenRef) {
  if (!root) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      // 代码块里的字不做显影：别打散 hljs 的高亮结构，也省性能
      n.parentElement?.closest('pre, code') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  const nodes = []
  let total = 0
  while (walker.nextNode()) { nodes.push(walker.currentNode); total += walker.currentNode.data.length }
  const prev = prevLenRef.current
  prevLenRef.current = total
  // markdown 重解析可能让早段文本变短（比如 * 补齐成粗体），长度回退时只校准不动画
  if (total <= prev) return
  // 首帧灌入超长内容（恢复历史）不逐字动画，避免几千个 span。
  // ⚠️阈值别设太低：中转站可能把 SSE 攒成整段大 chunk 冲进来，300 会导致永远跳过没效果（0720 阿颖实测没看到）
  if (total - prev > 1500) return
  let offset = 0
  let idx = 0
  for (const node of nodes) {
    const len = node.data.length
    const start = Math.max(prev - offset, 0)
    offset += len
    if (start >= len) continue
    const frag = document.createDocumentFragment()
    if (start > 0) frag.appendChild(document.createTextNode(node.data.slice(0, start)))
    for (const ch of node.data.slice(start)) { // for...of 按码点切，CJK/emoji 不劈半
      const s = document.createElement('span')
      s.className = 'reveal-char'
      s.style.animationDelay = `${Math.min(idx * 14, 280)}ms`
      s.textContent = ch
      frag.appendChild(s)
      idx++
    }
    node.parentNode.replaceChild(frag, node)
  }
}

// markdown 正文容器：渲染后把 html 代码块升级成可运行（流式期间不升级，避免跑半截代码）
function MarkdownBlock({ html, enhance = true, reveal = false, className = 'bubble-markdown' }) {
  const ref = useRef(null)
  const prevLenRef = useRef(0)
  // useLayoutEffect：在浏览器绘制前把新字包上雾，避免先闪清晰再变糊
  useLayoutEffect(() => { if (reveal) revealNewTail(ref.current, prevLenRef) }, [html, reveal])
  useEffect(() => { if (enhance) enhanceCodeBlocks(ref.current) }, [html, enhance])
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

const STICKER_BASE = 'https://memory.ravenlove.cc/raven/stickers/'
const MUSIC_TAG_RE = /\[music:[^\]]+\]/

// ── make_file 工具生成的文件卡片 ────────────────────────────────────────────
const FILE_MIME = {
  html: 'text/html', htm: 'text/html', md: 'text/markdown', txt: 'text/plain',
  csv: 'text/csv', json: 'application/json', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml',
}
function fileMime(name) {
  const ext = (name || '').split('.').pop().toLowerCase()
  return (FILE_MIME[ext] || 'text/plain') + ';charset=utf-8'
}
function fileBlobUrl(f) {
  return URL.createObjectURL(new Blob([f.content], { type: fileMime(f.filename) }))
}
// 保存文本文件到手机。0720 两轮实测：安卓 PWA（standalone）里 blob 锚点下载静默失败
// （toast 弹了文件却不落地），分享面板也不弹——真正稳的只有「真实 HTTPS URL +
// Content-Disposition: attachment」，Chrome 下载管理器会接手（通知栏有进度、落 Download）。
// 所以顺序：① 服务端下投站（moon-memory /files/stash → /files/dl/:id）
//          ② 分享面板  ③ blob 锚点  ④ 认输提示走「预览」。每条路都有 toast。
async function saveTextFile(filename, content, mime) {
  // ① 服务端真实 URL（首选）
  try {
    const { baseUrl, apiToken } = useStore.getState().moonMemory || {}
    if (apiToken) {
      const base = (baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
      const r = await fetch(`${base}/files/stash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
        body: JSON.stringify({ filename, content, mime }),
      })
      if (r.ok) {
        const { id } = await r.json()
        const dlUrl = `${base}/files/dl/${id}`
        // PWA standalone 里 a.click() 对跨域 URL 静默失败（三轮实测确认），
        // 隐藏 iframe 加载 Content-Disposition:attachment 的 URL 才能稳触发
        const iframe = document.createElement('iframe')
        iframe.style.display = 'none'
        iframe.src = dlUrl
        document.body.appendChild(iframe)
        setTimeout(() => iframe.remove(), 60000)
        showToast('下载已交给系统，看通知栏或 Download 文件夹')
        return
      }
    }
  } catch { /* 服务器不通，落回分享面板 */ }
  const blob = new Blob([content], { type: mime })
  // ② 分享面板
  try {
    let file = new File([blob], filename, { type: blob.type })
    if (!navigator.canShare?.({ files: [file] })) {
      // text/markdown 这类小众 MIME 有些系统分享面板不认，换 text/plain 再试一次
      file = new File([new Blob([content], { type: 'text/plain' })], filename, { type: 'text/plain' })
    }
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename })
      showToast('已交给分享面板，选「保存到设备/文件」就能存下')
      return
    }
  } catch (e) {
    if (e?.name === 'AbortError') return // 她自己关掉了分享面板，不算失败，安静退场
    // 其他错误落回锚点下载
  }
  // ③ blob 锚点（浏览器标签页里好使，PWA 里可能哑——所以只当兜底）
  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a) // 部分安卓 WebView/PWA 要求锚点挂在文档里才肯触发
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    showToast('尝试浏览器下载了，若没收到通知，点「预览」后用菜单保存')
  } catch {
    showToast('下载没成功，点「预览」打开后用浏览器菜单保存吧', 'error')
  }
}

function downloadGenFile(f) {
  return saveTextFile(f.filename, f.content, fileMime(f.filename))
}
function previewGenFile(f) {
  // html 用 blob URL 新标签页打开，直接渲染
  const url = fileBlobUrl(f)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
function GenFileCard({ file }) {
  const isHtml = /\.html?$/i.test(file.filename)
  return (
    <div className="msg-file-card">
      <span className="msg-file-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </span>
      <div className="msg-file-info">
        <span className="msg-file-name">{file.filename}</span>
        <span className="msg-file-size">{(file.content.length / 1024).toFixed(1)} KB</span>
      </div>
      {isHtml && <button className="msg-file-btn" onClick={() => previewGenFile(file)}>预览</button>}
      <button className="msg-file-btn" onClick={() => downloadGenFile(file)}>下载</button>
    </div>
  )
}

// 助手正文：把 [music:歌名|歌手|理由] 标签渲染成点歌卡片，其余按 markdown 渲染
function renderAssistantContent(content, isStreaming, reveal = false) {
  if (!content) {
    return <div className="bubble-markdown" dangerouslySetInnerHTML={{ __html: isStreaming ? '<span class="cursor-blink">▌</span>' : '' }} />
  }
  // 双语通话的回复：[译:中文] 尾标签渲染成同气泡里的翻译块（英文正文 + 虚线 + 中文，仿参考截图）
  const { main: biMain, zh: biZh } = splitTranslation(content)
  if (biZh) {
    return (
      <>
        {renderAssistantContent(biMain, isStreaming, reveal)}
        <div className="bubble-zh">
          <span className="bubble-zh-badge">中</span>
          {biZh}
        </div>
      </>
    )
  }
  if (!MUSIC_TAG_RE.test(content)) {
    return <MarkdownBlock html={parseMarkdown(content)} enhance={!isStreaming} reveal={reveal} />
  }
  const parts = content.split(/(\[music:[^\]]+\])/)
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[music:([^\]]+)\]$/)
        if (m) {
          const [name, artist, reason] = m[1].split('|').map((s) => s.trim())
          if (!name) return null
          return <MusicCard key={i} name={name} artist={artist} reason={reason} />
        }
        return part.trim()
          ? <MarkdownBlock key={i} html={parseMarkdown(part)} enhance={!isStreaming} reveal={reveal} />
          : null
      })}
    </>
  )
}

function renderStickered(text) {
  if (!text || !/\[sticker:[^\]]+\]/.test(text)) {
    return <span className="bubble-text">{text}</span>
  }
  const parts = text.split(/(\[sticker:[^\]]+\])/)
  return (
    <span>
      {parts.map((part, i) => {
        const m = part.match(/^\[sticker:([^\]]+)\]$/)
        // 自定义表情包是完整 URL，内置的是 stickers/ 目录下的文件名
        if (m) return <img key={i} src={/^https?:\/\//.test(m[1]) ? m[1] : STICKER_BASE + m[1]} alt="sticker" style={{ maxWidth: 140, borderRadius: 8, display: 'block', margin: '2px 0' }} />
        return part ? <span key={i} className="bubble-text">{part}</span> : null
      })}
    </span>
  )
}

// 她自己发的消息里若含代码，也渲染成代码块+运行/复制（普通聊天文字仍走纯文本，
// 不误伤：只有带 ``` 围栏、或整段就是 HTML 的才当代码）——2026-07-04 她反馈粘贴代码看不到运行按钮
function renderUserBody(text) {
  if (!text) return <span className="bubble-text">{text}</span>
  if (/```/.test(text)) return <MarkdownBlock html={parseMarkdown(text)} />
  if (looksRunnableHtml('', text.trim())) return <MarkdownBlock html={parseMarkdown('```html\n' + text.trim() + '\n```')} />
  return renderStickered(text)
}

function AttachChip({ name, content }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bubble-attach-chip">
      <div className="bubble-attach-header" onClick={() => setOpen(v => !v)}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
        <span className="bubble-attach-name">{name}</span>
        <span className="bubble-attach-toggle">{open ? '▲' : '▼'}</span>
      </div>
      {open && <div className="bubble-attach-content">{content}</div>}
    </div>
  )
}

function renderUserContent(content) {
  if (!content) return <span className="bubble-text">{content}</span>
  // Strip [voice] prefix added by voice call mode (display only)
  const displayContent = content.startsWith('[voice] ') ? content.slice(8) : content
  const firstAttach = displayContent.indexOf('--- 文件：')
  if (firstAttach === -1) return renderUserBody(displayContent)
  const mainText = displayContent.slice(0, firstAttach).replace(/\n\n$/, '').trim()
  const blocksPart = displayContent.slice(firstAttach)
  const attachBlocks = []
  const re = /--- 文件：([^\n]+?) ---\n([\s\S]*?)(?=--- 文件：|$)/g
  let m
  while ((m = re.exec(blocksPart)) !== null) {
    attachBlocks.push({ name: m[1].trim(), content: m[2].trim() })
  }
  return (
    <>
      {mainText && renderUserBody(mainText)}
      {attachBlocks.map((b, i) => <AttachChip key={i} name={b.name} content={b.content} />)}
    </>
  )
}

const AssistantIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8 C4 8 7 4 12 5 C16 6 18 9 17 13 C16 17 12 19 8 17" />
    <path d="M17 13 L21 11 L18 15" />
    <path d="M8 17 L6 21" />
    <path d="M10 17 L10 21" />
    <circle cx="13" cy="8" r="1" fill="currentColor" stroke="none" />
    <path d="M4 8 L1 7" />
  </svg>
)

const UserIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
)

export default function MessageBubble({ msg, onEdit, onQuote, onDelete, isLast }) {
  const isUser = msg.role === 'user'
  const isStreaming = msg.streaming
  // [错误] 气泡（请求失败落盘的）：给一个删除钮，能从记录里刷掉
  const isErrorMsg = !isUser && typeof msg.content === 'string' && msg.content.startsWith('[错误]')
  const { avatarConfig, moonMemory, textReveal } = useStore()
  const useImages = avatarConfig?.mode === 'image'
  const avatarRadius = avatarConfig?.shape === 'square' ? '6px' : '50%'
  const [editing, setEditing] = useState(false)
  const [ttsState, setTtsState] = useState('idle') // idle | loading | playing
  const [voiceMode, setVoiceMode] = useState(!!msg.voicemail) // 语音条模式：正文隐藏，显示音浪；语音留言默认就是语音条
  const [ttsDuration, setTtsDuration] = useState(0)
  const audioRef = useRef(null) // 缓存的 Audio，重播不再重新合成

  // 卸载时停掉还在播的音频（切会话等场景）
  useEffect(() => () => { audioRef.current?.pause() }, [])

  const stopTts = useCallback(() => {
    const a = audioRef.current
    if (a) { a.pause(); a.currentTime = 0 }
    setTtsState('idle')
  }, [])

  const playTts = useCallback(async () => {
    if (!moonMemory?.enabled || !moonMemory?.baseUrl || !moonMemory?.apiToken) return
    if (ttsState === 'loading') return
    if (ttsState === 'playing') { stopTts(); return }
    setVoiceMode(true) // 跟归巢一致：点朗读先切成语音条
    let audioEl = audioRef.current
    if (!audioEl) {
      setTtsState('loading')
      try {
        // 语音标签直接转成 MiniMax 认的圆括号形式（圆括号不在下面的符号清理名单里）。
        // ⚠️别再用 __VTAG__ 哨兵保护——下面的清理会剥掉下划线，哨兵残骸 VTAGbreath 会被逐字朗读
        const plainText = stripInlineFx(msg.content) // 情绪特效标签只留正文（否则 glow/shake 被念成英文）
          .replace(/\[music:[^\]]+\]/g, '')          // 点歌标签不朗读
          .replace(/\[sticker:[^\]]+\]/g, '')        // 贴图标签不朗读（否则被念成 sticker:文件名）
          .replace(/\[call:[^\]]+\]/gi, '')          // 来电标签不朗读（0709 教训：新方括号标签同步进清洗）
          .replace(/\[译[:：][\s\S]*?\]/g, '')       // 双语翻译标签不朗读（嘴上只念英文，翻译是给眼睛的）
          .replace(/\[MSG\]/gi, ' ')                 // 漏拆的分段符不朗读（否则被念成英文 MSG）
          .replace(VOICE_TAG_RE, (m, t) => (t.toLowerCase() === 'laughter' ? '(laughs)' : '(breath)'))
          .replace(/!\[[^\]]*\]\([^)]*\)/g, '')   // 图片（贴图）整体去掉
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接只读文字
          .replace(/[#*`>_~\[\]]/g, '')
          .slice(0, 500)
        const config = { baseUrl: moonMemory.baseUrl, apiToken: moonMemory.apiToken }
        const { audio } = await synthesizeSpeech(config, plainText)
        audioEl = new Audio(audio)
        await new Promise((resolve, reject) => {
          audioEl.onloadedmetadata = resolve
          audioEl.onerror = reject
        })
        audioEl.onended = () => setTtsState('idle')
        audioRef.current = audioEl
        setTtsDuration(audioEl.duration || 0)
      } catch {
        setTtsState('idle')
        return
      }
    }
    try {
      audioEl.currentTime = 0
      await audioEl.play()
      setTtsState('playing')
    } catch {
      setTtsState('idle')
    }
  }, [msg.content, moonMemory, ttsState, stopTts])

  // 点音浪区：退出语音条，切回文字
  const exitVoiceMode = useCallback(() => {
    stopTts()
    setVoiceMode(false)
  }, [stopTts])

  const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
  const [editText, setEditText] = useState(msg.content)
  // 思考过程：流式时展开（实时看着想），结束后自动收起，只留一句标题式总结。
  // 不用原生 <details>（受控 open 在部分浏览器/React 下会和原生状态错位），改纯按钮+条件渲染，稳。
  const [thinkOpen, setThinkOpen] = useState(isStreaming)
  useEffect(() => { setThinkOpen(isStreaming) }, [isStreaming])
  // 用户语音消息：默认语音条样式，点一下切到文字，再点切回（仿 chat 语音切换）
  const [voiceTextMode, setVoiceTextMode] = useState(false)
  // 有些模型/代理把 <think>/<next_thinking>/<reasoning> 等标签塞进思考文本里，展示时剥掉
  const thinkingText = (msg.thinking || '').replace(/<\/?[a-zA-Z_][\w:-]*>/g, '').trim()
  // 显影兜底：中转站可能不流式/延迟回复是整条一次到的，isStreaming 全程 false 就永远不显影。
  // 挂载时判断消息是否「新鲜」（8s 内创建），新鲜就整体显影一次；翻旧记录不触发（0720 阿颖实测二连没看到雾）
  const freshRevealRef = useRef(!isUser && Date.now() - new Date(msg.createdAt).getTime() < 8000)

  return (
    <div data-mid={msg.id} className={`message-row ${isUser ? 'message-row-user' : 'message-row-assistant'}${isLast ? ' msg-last' : ''}`}>
      {!isUser && (
        <div className="message-avatar" style={{ borderRadius: avatarRadius }}>
          {useImages && avatarConfig.assistantImage
            ? <img src={avatarConfig.assistantImage} alt="助手" className="avatar-img" style={{ borderRadius: avatarRadius }} />
            : <AssistantIcon />}
        </div>
      )}
      {isUser && (
        <div className="message-avatar message-avatar-user" style={{ borderRadius: avatarRadius }}>
          {useImages && avatarConfig.userImage
            ? <img src={avatarConfig.userImage} alt="我" className="avatar-img" style={{ borderRadius: avatarRadius }} />
            : <UserIcon />}
        </div>
      )}
      <div className="message-content-wrap">
        {msg.toolCalls?.length > 0 && (
          <div className="message-tool-badge">
            {msg.toolCalls.map((n, i) => <span key={i} className="tool-chip">{n}</span>)}
          </div>
        )}
        {thinkingText && (
          <div className={'thinking-block' + (thinkOpen ? ' open' : '')}>
            <button type="button" className="thinking-summary" onClick={() => setThinkOpen((o) => !o)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
              </svg>
              <span className="thinking-summary-text">{msg.thinkingSummary || (isStreaming ? '思考中…' : '思考过程')}</span>
              <svg className="thinking-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {thinkOpen && <div className="thinking-content">{thinkingText}</div>}
          </div>
        )}
        {msg.quote && (
          <div className="msg-quote">
            <span className="msg-quote-who">{msg.quote.role === 'user' ? '我' : '涟言'}</span>
            <span className="msg-quote-text">{msg.quote.content}</span>
          </div>
        )}
        <div className={`message-bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}${isStreaming ? ' streaming' : ''}`}>
          {isUser ? (
            editing ? (
              <div className="msg-edit-wrap">
                <textarea
                  className="msg-edit-textarea"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  autoFocus
                  enterKeyHint="enter"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault(); onEdit?.(msg, editText); setEditing(false)
                    }
                  }}
                />
                <div className="msg-edit-actions">
                  <button className="msg-edit-btn" onClick={() => setEditing(false)}>取消</button>
                  <button className="msg-edit-btn primary" onClick={() => { onEdit?.(msg, editText); setEditing(false) }}>保存并重发</button>
                </div>
              </div>
            ) : (
              <>
                {msg.images?.length > 0 && (
                  <div className="bubble-images">
                    {msg.images.map((src, i) => <img key={i} src={src} alt="" className="bubble-img" />)}
                  </div>
                )}
                {msg.call ? (
                  // 通话记录条（微信同款）：通话中/已取消/通话时长 mm:ss
                  <div className="call-bubble">
                    <span>
                      {msg.call.status === 'ongoing' ? '语音通话中…'
                        : msg.call.status === 'cancelled' ? '已取消'
                        : msg.call.duration != null
                          ? `通话时长 ${String(Math.floor(msg.call.duration / 60)).padStart(2, '0')}:${String(msg.call.duration % 60).padStart(2, '0')}`
                          : '语音通话'}
                    </span>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12 C3 12 7 7 12 7 C17 7 21 12 21 12" />
                      <path d="M3 12 L3 15 L6 15 L6 12.5" />
                      <path d="M21 12 L21 15 L18 15 L18 12.5" />
                    </svg>
                  </div>
                ) : msg.voice ? (
                  voiceTextMode ? (
                    // 文字视图：点一下切回语音条
                    <div className="user-voice-text" onClick={() => setVoiceTextMode(false)} title="点击切回语音条">
                      {renderUserContent(msg.content)}
                    </div>
                  ) : (
                    // 语音条视图：跟助手语音条同款三角形播放键 + 波形 + 时长。
                    // 三角键只为统一外观，点了不放声音（没存音频）；整条点击转文字。
                    <div className="voice-bar user-vb" onClick={() => setVoiceTextMode(true)} title="点击转文字">
                      <span className="vb-mic">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                      </span>
                      <div className="vb-wave">
                        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="vb-bar" />)}
                      </div>
                      <span className="vb-time">{msg.voiceDuration ? fmtDur(msg.voiceDuration) : '0:00'}</span>
                    </div>
                  )
                ) : renderUserContent(msg.content)}
              </>
            )
          ) : msg.callInvite ? (
            // 来电记录条：响铃中/已接听/未接来电（未接的下面紧跟一条语音留言）
            <div className={'call-bubble call-invite' + (msg.callInvite.status === 'ringing' ? ' ringing' : '')}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.5 2.8.7a2 2 0 0 1 1.7 2z" />
              </svg>
              <span className="ci-text">
                {msg.callInvite.status === 'ringing' ? '来电中…'
                  : msg.callInvite.status === 'accepted' ? '语音通话'
                  : '未接来电'}
                {msg.callInvite.reason && <em className="ci-reason">{msg.callInvite.reason}</em>}
              </span>
            </div>
          ) : voiceMode ? (
            <div className={`voice-bar${ttsState === 'playing' ? ' playing' : ''}${msg.voicemail ? ' vb-voicemail' : ''}`}>
              <button className="vb-play" onClick={playTts} aria-label={ttsState === 'playing' ? '暂停' : '播放'}>
                {ttsState === 'loading' ? (
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="4" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="20" cy="12" r="2"/></svg>
                ) : ttsState === 'playing' ? (
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                )}
              </button>
              <div className="vb-wave" onClick={exitVoiceMode} title="点击切回文字">
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="vb-bar" />)}
              </div>
              <span className="vb-time">{ttsDuration ? fmtDur(ttsDuration) : '…'}</span>
              {msg.voicemail && <span className="vb-vm-label">留言</span>}
            </div>
          ) : (
            renderAssistantContent(msg.content, isStreaming, textReveal !== false && (isStreaming || freshRevealRef.current))
          )}
        </div>
        {!isUser && msg.files?.length > 0 && (
          <div className="msg-files">
            {msg.files.map((f, i) => <GenFileCard key={i} file={f} />)}
          </div>
        )}
        {!isUser && isStreaming && (
          // 流式尾随 logo：生成中缀在正文下方旋转的小太阳（官端标志性细节）
          <span className="trail-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
              <line x1="17.5" y1="12" x2="21.5" y2="12" /><line x1="2.5" y1="12" x2="6.5" y2="12" />
              <line x1="12" y1="17.5" x2="12" y2="21.5" /><line x1="12" y1="2.5" x2="12" y2="6.5" />
              <line x1="15.9" y1="15.9" x2="18.7" y2="18.7" /><line x1="5.3" y1="5.3" x2="8.1" y2="8.1" />
              <line x1="15.9" y1="8.1" x2="18.7" y2="5.3" /><line x1="5.3" y1="18.7" x2="8.1" y2="15.9" />
            </svg>
          </span>
        )}
        <div className="message-meta">
          <span className="message-time">{formatTime(msg.createdAt)}</span>
          {msg.interrupted && (
            <span className="message-interrupted">这条没说完就断线了</span>
          )}
          {msg.tokenUsage && (
            <span className="message-tokens">
              {msg.tokenUsage.totalTokens} tokens
              {msg.tokenUsage.cachedTokens > 0 && msg.tokenUsage.promptTokens > 0 &&
                ` · 缓存${Math.round(msg.tokenUsage.cachedTokens / msg.tokenUsage.promptTokens * 100)}%`}
            </span>
          )}
          {isUser && !isStreaming && !editing && onEdit && (
            <button className="msg-edit-icon-btn" onClick={() => { setEditText(msg.content); setEditing(true) }} title="编辑消息">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          )}
          {!isStreaming && onQuote && (
            <button className="msg-edit-icon-btn" title="引用回复" onClick={() => onQuote(msg)}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" />
              </svg>
            </button>
          )}
          {isErrorMsg && !isStreaming && onDelete && (
            <button className="msg-edit-icon-btn" title="删除这条报错" onClick={() => onDelete(msg)}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          )}
          {!isUser && !isStreaming && (
            <button className="msg-edit-icon-btn" title="下载为文件" onClick={() =>
              saveTextFile(`reply-${msg.id || Date.now()}.md`, msg.content, 'text/markdown;charset=utf-8')
            }>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
          )}
          {!isUser && !isStreaming && moonMemory?.enabled && (
            <button className={`msg-tts-btn${ttsState !== 'idle' ? ' active' : ''}`} onClick={playTts} title={ttsState === 'playing' ? '停止' : '朗读'}>
              {ttsState === 'loading' ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
              ) : ttsState === 'playing' ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
