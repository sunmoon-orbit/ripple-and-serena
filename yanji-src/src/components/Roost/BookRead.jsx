import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '../../store'
import { showToast } from '../Toast'
import {
  fetchBooks, fetchBook, fetchBookChapter, createBook, appendBookChapters,
  deleteBook, createBookAnnotation, deleteBookAnnotation, saveBookBookmark, fetchBookEchoes, markBookEchoesSeen, starBookAnnotation, fetchStarredAnnotations,
  sendReadingHeartbeat, fetchBookChat, createBookChatMessage, stampBook, unstampBook,
  fetchReadingActivity, fetchBookCover, saveBookCover, saveBookChapterAlt,
} from '../../api/moonMemory'
import { readBookFile, splitChapters, pairBooks, guessOffset, paragraphEnds, previewPairs } from '../../utils/bookImport'
import { savePdfBlob, deletePdfBlob, openPdf } from '../../utils/pdfBooks'
import PdfBookReader from './PdfBookReader'
import { sendMessage } from '../../api/llm'
import { useThemedConfirm } from '../ThemedConfirmDialog'
import { downloadBlob } from '../../utils/download'
import { excerptCardTextLayout, prepareExcerptCover, renderExcerptCardPng } from '../../utils/bookExcerptCard'

const COLORS = [
  { id: 'yellow', hex: '#f5d76e' },
  { id: 'pink', hex: '#f0a6c0' },
  { id: 'blue', hex: '#9ec5e8' },
  { id: 'green', hex: '#a8d8b0' },
]
const COLOR_HEX = Object.fromEntries(COLORS.map((c) => [c.id, c.hex]))

const SPINE_COLORS = ['#4a7c59', '#8b6f47', '#5b6e8c', '#9c5b5b', '#7a5c8a', '#4f7d7d']

// 书架分层：书多了各归各位（2026-07-12 阿颖提的）；空串=未分层，排最后
const SHELF_ORDER = ['闲书层', '正经层', '工具层']

// 书脊视图（1005）：书立起来摆在隔板上。厚薄看章数，高矮按 id 错落，同一本书每次打开都一样
const SHELF_VIEW_KEY = 'bookread-shelf-view'
function spineLook(book) {
  // 书脊上只写书名本身：导入时带上的后缀和「 - （法）」这类尾巴不上脊，完整名字在列表里看
  const title = String(book.title || '').replace(/[_\s-]*言叽导入版$/, '').replace(/\s*[-—–]\s*[（(][^）)]*[）)]\s*$/, '').trim() || String(book.title || '')
  const chapters = Number(book.chapter_count) || 1
  const width = Math.round(Math.min(52, 30 + Math.sqrt(chapters) * 4.5))
  // 高度先保证书名放得下（一个字约 14px），再按 id 错落一点，不超过一层的高度
  const height = Math.min(196, Math.max(134 + ((Number(book.id) || 0) * 29) % 41, [...title].length * 14 + 50))
  const hex = /^#[0-9a-f]{6}$/i.test(book.cover_color || '') ? book.cover_color : '#8b6f47'
  // 上架时挑的颜色偏艳，立成一排会抢眼：往暖灰里掺四成半，压成莫兰迪的调子（1005 她说饱和度高）
  const GREY = [201, 193, 182]
  const [r, g, b] = [1, 3, 5].map((k, n) => Math.round(parseInt(hex.slice(k, k + 2), 16) * 0.55 + GREY[n] * 0.45))
  const light = (r * 299 + g * 587 + b * 114) / 1000 > 158
  return { title, width, height, color: `rgb(${r}, ${g}, ${b})`, ink: light ? 'rgba(58,48,38,.86)' : 'rgba(255,252,246,.95)' }
}

// 封面缓存（1021 她：「换了封面以后，点书籍会闪一下才更换封面」——每次点开都现取，取回来之前先露出画的那张）。
// 内存里一份、本机 localStorage 一份；书架一打开就把有封面的预取好，点开直接是她那张图。
const coverMem = new Map()
const COVER_LS = (id) => 'yanji-book-cover-' + id
function cachedCover(id) {
  if (coverMem.has(id)) return coverMem.get(id)
  try { const v = localStorage.getItem(COVER_LS(id)); if (v) { coverMem.set(id, v); return v } } catch { /* 隐私模式等 */ }
  return null
}
function rememberCover(id, image) {
  if (image) coverMem.set(id, image); else coverMem.delete(id)
  try { image ? localStorage.setItem(COVER_LS(id), image) : localStorage.removeItem(COVER_LS(id)) } catch { /* 满了就只留内存那份 */ }
}

// 她传的封面图：长边压到 720、转 jpeg，存进记忆库不至于太大
function compressCover(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, 720 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('这张图读不出来')) }
    img.src = url
  })
}

function beijingDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function recentDateKeys(count = 7) {
  const today = new Date(`${beijingDateKey()}T12:00:00+08:00`)
  return Array.from({ length: count }, (_, idx) => {
    const date = new Date(today)
    date.setUTCDate(date.getUTCDate() - (count - 1 - idx))
    return beijingDateKey(date)
  })
}

function formatReadingTime(seconds) {
  const minutes = Math.max(0, Math.round((Number(seconds) || 0) / 60))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

// 把章节正文按标注偏移切成段：每段带覆盖它的标注列表（正文渲染必须与原文逐字一致，偏移才准）
// 中英对照时还要在每段中文末尾切一刀，好把英文挂在那儿（paraEnds 为空就和原来一样）
function buildSegments(content, annos, paraEnds = []) {
  const points = new Set([0, content.length, ...paraEnds])
  for (const a of annos) {
    points.add(Math.max(0, Math.min(a.start_off, content.length)))
    points.add(Math.max(0, Math.min(a.end_off, content.length)))
  }
  const sorted = [...points].sort((x, y) => x - y)
  const segs = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const [s, e] = [sorted[i], sorted[i + 1]]
    if (s >= e) continue
    const covering = annos.filter((a) => a.start_off <= s && a.end_off >= e)
    segs.push({ start: s, text: content.slice(s, e), annos: covering })
  }
  return segs
}

// 本地阅读进度：退出后重进自动回到上次读到的章节和位置（2026-07-13 阿颖的建议）。
// 手动「夹书签」仍是共享书签（涟言那边看得到）；这份是本机自动记的，谁的设备记谁的。
const POS_KEY = 'yanji_book_pos'
function loadPos(bookId) {
  try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}')[bookId] || null } catch { return null }
}
function savePos(bookId, ch, position = {}) {
  try {
    const all = JSON.parse(localStorage.getItem(POS_KEY) || '{}')
    const previous = all[bookId] || {}
    const next = typeof position === 'number' ? { scroll: position } : position
    all[bookId] = {
      ...previous,
      ...next,
      ch,
      scroll: Math.max(0, Math.round(next.scroll ?? previous.scroll ?? 0)),
      page: Math.max(0, Math.round(next.page ?? previous.page ?? 0)),
      at: Date.now(),
    }
    localStorage.setItem(POS_KEY, JSON.stringify(all))
  } catch { /* ignore */ }
}

export default function BookRead({ onClose }) {
  const confirmAction = useThemedConfirm()
  const moonMemory = useStore((s) => s.moonMemory)
  const connections = useStore((s) => s.connections)
  const activeConnectionId = useStore((s) => s.activeConnectionId)
  const generationConfig = useStore((s) => s.generationConfig)
  const globalInstruction = useStore((s) => s.globalInstruction)
  const cfg = { baseUrl: (moonMemory?.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, ''), apiToken: moonMemory?.apiToken }
  const connection = connections.find((c) => c.id === activeConnectionId)

  const [books, setBooks] = useState(null)      // null=loading
  const [shelfView, setShelfView] = useState(() => {
    try { return localStorage.getItem(SHELF_VIEW_KEY) === 'list' ? 'list' : 'spines' } catch { return 'spines' }
  })
  const switchShelfView = (next) => {
    setShelfView(next)
    try { localStorage.setItem(SHELF_VIEW_KEY, next) } catch { /* 存不上就每次回到默认 */ }
  }
  const [active, setActive] = useState(null)    // 选中的书（列表项）
  const [coverBook, setCoverBook] = useState(null) // 书架上点了一本：先转过来看封面（1020）{book, image, loading}
  const coverFileRef = useRef(null)
  const [straight, setStraight] = useState(() => new Set()) // 被她扶正的书（只在这次打开书架里算，下次再来又歪了）
  const pressRef = useRef(null) // 长按扶正过的那本 → 再把它推歪（1020 她问「没做点一下把它放斜吗」）
  const [chapter, setChapter] = useState(null)  // {idx,title,content,annotations}
  const [chapterViewKey, setChapterViewKey] = useState(0) // 只在真正打开章节时触发阅读位置恢复
  const [chapterCount, setChapterCount] = useState(1)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(null)  // 选中待批注 {start,end,quote}
  const [composing, setComposing] = useState(false)
  const [annoColor, setAnnoColor] = useState('yellow')
  const [annoNote, setAnnoNote] = useState('')
  const [annoAuthor, setAnnoAuthor] = useState('阿颖')
  const [focusAnno, setFocusAnno] = useState(null) // 点了正文划线 → 高亮下方对应批注卡
  // 页边回复成串＋书架上的「新回音」（1029 她：我回了第 15 页的批注，她读到第 20 页还得翻回去找）
  const [echoes, setEchoes] = useState([])
  const [echoOpen, setEchoOpen] = useState(false)
  const [replyDraft, setReplyDraft] = useState({})  // {批注id: 正在写的回复}
  // 好句子书签（1029 她：留了很棒的句子就夹个书签，下次直接翻到那儿看）
  const [starOpen, setStarOpen] = useState(false)
  // 从「新回音」「书签」翻过去看一眼，是串门，不是读到那儿了（1029 她问：回完评论再进书，是我的进度还是那一页？）
  // 串门期间不记进度；底下浮一个「回到读到的地方」
  const peekRef = useRef(false)
  const [peekFrom, setPeekFrom] = useState(null)   // 串门前真正读到的位置 {ch, ...}
  const [starred, setStarred] = useState(null)
  const [upload, setUpload] = useState(null)       // 上架表单 {title,author,intro,color,shelf,chapters,fileName, bilingual,altChapters,altName,altOffset}
  const altFileRef = useRef(null)
  const [pdfBook, setPdfBook] = useState(null)      // 打开的是原样 PDF（1023）
  // 中英对照怎么看（1023）：both 中文下面跟英文 / zh 只中文 / en 只英文。记在本机
  const [langMode, setLangMode] = useState(() => { try { return localStorage.getItem('bookread-lang') || 'both' } catch { return 'both' } })
  const [altEdit, setAltEdit] = useState(null)      // 点了某段英文：{k} 弹「往上挪／往下挪」
  const [saving, setSaving] = useState(false)
  const [stamps, setStamps] = useState([])         // 当前书的读讫章 [{reader,stamped_at}]
  const [toc, setToc] = useState(null)             // 目录 [{idx,title,chars}]，打开时拉取
  const [tocOpen, setTocOpen] = useState(false)
  const [tocErr, setTocErr] = useState('')         // 拉取异常时面板内可见（别再哑巴）
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatSending, setChatSending] = useState(false)
  const [readingSummary, setReadingSummary] = useState(null)
  const [readingMode, setReadingMode] = useState('page')
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [pageWidth, setPageWidth] = useState(0)
  const [readerChromeVisible, setReaderChromeVisible] = useState(true)
  const [excerptCard, setExcerptCard] = useState(null)
  const [cardImageLoading, setCardImageLoading] = useState(false)
  const [savingCard, setSavingCard] = useState(false)
  const textRef = useRef(null)
  const annoRefs = useRef({})
  const fileRef = useRef(null)
  const cardImageRef = useRef(null)
  const bodyRef = useRef(null)          // 阅读视图的滚动容器
  const pageViewportRef = useRef(null)
  const restorePositionRef = useRef(null) // 章节渲染完后要恢复的位置（兼容旧版 scroll）
  const scrollTimerRef = useRef(null)
  const chatEndRef = useRef(null)
  const touchStartRef = useRef(null)
  const lastPageSwipeAtRef = useRef(0)

  useEffect(() => {
    if (!cfg.apiToken) { setBooks([]); return }
    fetchBookEchoes(cfg).then((list) => setEchoes(Array.isArray(list) ? list : [])).catch(() => {})
    fetchBooks(cfg).then((list) => {
      const arr = Array.isArray(list) ? list : []
      setBooks(arr)
      // 预取：有封面、本机还没有的，悄悄先拿回来
      for (const b of arr) {
        if (b.has_cover && !cachedCover(b.id)) fetchBookCover(cfg, b.id).then((r) => r?.image && rememberCover(b.id, r.image)).catch(() => {})
        if (!b.has_cover && cachedCover(b.id)) rememberCover(b.id, null)
      }
    }).catch(() => setBooks([]))
  }, [])

  // 阅读心跳 + 页内时长摘要：书打开且页面可见时每60s上报，并刷新今日/近7天统计。
  // 服务端按北京时间分日；摘要只做回顾，不设置阅读目标，避免把读书变成任务。
  useEffect(() => {
    if (!active || !cfg.apiToken) { setReadingSummary(null); return }
    let cancelled = false

    async function refreshSummary() {
      try {
        const activity = await fetchReadingActivity(cfg, 168)
        const keys = recentDateKeys(7)
        const byDay = Object.fromEntries(keys.map((day) => [day, 0]))
        for (const item of (activity?.reading || [])) {
          if (item.reader === '阿颖' && item.book_title === active.title && Object.hasOwn(byDay, item.day)) {
            byDay[item.day] += Number(item.seconds) || 0
          }
        }
        if (!cancelled) {
          const days = keys.map((day) => ({ day, seconds: byDay[day] }))
          setReadingSummary({
            todaySeconds: byDay[keys[keys.length - 1]],
            weekSeconds: days.reduce((sum, item) => sum + item.seconds, 0),
            days,
          })
        }
      } catch { /* 阅读不应因统计接口异常被打断 */ }
    }

    refreshSummary()
    const t = setInterval(async () => {
      if (document.visibilityState === 'visible') {
        try { await sendReadingHeartbeat(cfg, active.id, '阿颖', chapter?.idx ?? null) } catch { /* ignore */ }
        refreshSummary()
      }
    }, 60 * 1000)
    return () => { cancelled = true; clearInterval(t) }
  }, [active?.id, chapter?.idx, cfg.apiToken, cfg.baseUrl])

  const openChapter = useCallback(async (book, idx, restorePosition = null, peek = false) => {
    peekRef.current = peek
    if (!peek) setPeekFrom(null)
    setLoading(true)
    setChatOpen(false); setChatMessages([]); setChatLoading(true)
    setPending(null); setComposing(false); setFocusAnno(null)
    try {
      const [ch, messages] = await Promise.all([
        fetchBookChapter(cfg, book.id, idx),
        fetchBookChat(cfg, book.id, idx, 40).catch(() => []),
      ])
      restorePositionRef.current = restorePosition
      setChapter(ch)
      setChapterViewKey((key) => key + 1)
      setChatMessages(Array.isArray(messages) ? messages : [])
      if (!peek) {
        savePos(book.id, idx, restorePosition || { scroll: 0, page: 0, mode: readingMode, ratio: 0 })
        sendReadingHeartbeat(cfg, book.id, '阿颖', idx, 0).catch(() => {})
      }
    } catch { showToast('章节加载失败', 'error') } finally { setLoading(false); setChatLoading(false) }
  }, [readingMode])

  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ block: 'end' })
  }, [chatOpen, chatMessages])

  function readingExcerpt() {
    const content = chapter?.content || ''
    const el = bodyRef.current
    const maxScroll = Math.max(1, (el?.scrollHeight || 1) - (el?.clientHeight || 0))
    const ratio = readingMode === 'page'
      ? pageIndex / Math.max(1, pageCount - 1)
      : (el?.scrollTop || 0) / maxScroll
    const center = Math.round(content.length * Math.min(1, Math.max(0, ratio)))
    const start = Math.max(0, center - 1200)
    return content.slice(start, start + 2400)
  }

  async function sendBookChat() {
    const content = chatInput.trim()
    if (!content || chatSending || !chapter) return
    if (!connection) { showToast('还没有选择模型连接', 'error'); return }
    setChatSending(true)
    setChatInput('')
    let userSaved = false
    try {
      const mine = await createBookChatMessage(cfg, active.id, { chapter_idx: chapter.idx, role: 'user', content })
      userSaved = true
      const history = [...chatMessages, mine]
      setChatMessages(history)
      const result = await sendMessage({
        connection,
        model: connection.defaultModel,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        systemPrompt: globalInstruction,
        dynamicContext: `阿颖正在共读书架阅读《${active.title}》第 ${chapter.idx + 1} 章《${chapter.title || `第 ${chapter.idx + 1} 章`}》。\n以下是她当前视口附近的正文摘录：\n---\n${readingExcerpt()}\n---\n这是书页内独立的随读随聊，请结合摘录自然回应。`,
        generationConfig,
        moonMemoryConfig: moonMemory,
        autoTools: false,
        cacheKey: `book-chat-${active.id}-${chapter.idx}`,
      })
      const reply = (result?.text || '').trim()
      if (!reply) throw new Error('模型没有返回内容')
      const hers = await createBookChatMessage(cfg, active.id, { chapter_idx: chapter.idx, role: 'assistant', content: reply })
      setChatMessages((prev) => [...prev, hers])
    } catch (e) {
      if (!userSaved) setChatInput(content)
      showToast(`随读随聊发送失败：${e?.message || e}`, 'error')
    } finally {
      setChatSending(false)
    }
  }

  // 目录跳转：章节标题列表从书籍详情接口拉取（只有标题不含正文，一次拉全）
  // 每次打开都重拉：payload 很小，顺带覆盖追更后目录过期；旧数据先显示（stale-while-revalidate）
  // ⚠️别用 if(!toc) 缓存守卫——[] 是 truthy，一次异常空响应会永久卡死在空面板（0723 阿颖踩中）
  async function toggleToc() {
    if (tocOpen) { setTocOpen(false); return }
    setTocOpen(true)
    setTocErr('')
    try {
      const detail = await fetchBook(cfg, active.id)
      setToc(detail.chapters || [])
      if (!(detail.chapters || []).length) setTocErr('接口返回了空目录（把这行截图给涟言）')
    } catch (e) {
      if (!toc) setToc([]) // 保持面板打开，把错误亮出来
      setTocErr(`目录加载失败：${e?.message || e}`)
    }
  }

  function showCover(book) {
    const cached = book.has_cover ? cachedCover(book.id) : null
    setCoverBook({ book, image: cached, loading: !!book.has_cover && !cached })
    if (book.has_cover) {
      fetchBookCover(cfg, book.id)
        .then((r) => { rememberCover(book.id, r?.image || null); setCoverBook((cur) => cur && cur.book.id === book.id ? { ...cur, image: r?.image || null, loading: false } : cur) })
        .catch(() => setCoverBook((cur) => cur && cur.book.id === book.id ? { ...cur, loading: false } : cur))
    }
  }

  async function pickCover(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !coverBook) return
    const id = coverBook.book.id
    try {
      const image = await compressCover(file)
      await saveBookCover(cfg, id, image)
      rememberCover(id, image)
      setCoverBook((cur) => cur && cur.book.id === id ? { ...cur, image } : cur)
      setBooks((list) => (list || []).map((b) => b.id === id ? { ...b, has_cover: 1 } : b))
      showToast('封面换好了')
    } catch (err) { showToast('封面没换上：' + (err.message || err)) }
  }

  async function dropCover() {
    if (!coverBook) return
    const id = coverBook.book.id
    try {
      await saveBookCover(cfg, id, null)
      rememberCover(id, null)
      setCoverBook((cur) => cur && cur.book.id === id ? { ...cur, image: null } : cur)
      setBooks((list) => (list || []).map((b) => b.id === id ? { ...b, has_cover: 0 } : b))
    } catch (err) { showToast('没换回去：' + (err.message || err)) }
  }

  async function openBook(book) {
    if (book.format === 'pdf') { setPdfBook(book); return }
    setActive(book)
    setReaderChromeVisible(true)
    setChapterCount(book.chapter_count || 1)
    setStamps(book.stamps || [])
    setToc(null); setTocOpen(false)
    // 优先回到本机自动进度（章+滚动位置），没有再看共享书签
    const pos = loadPos(book.id)
    const startIdx = Math.min(pos?.ch ?? book.bookmark_chapter ?? 0, (book.chapter_count || 1) - 1)
    const restore = pos?.ch === startIdx ? pos : { scroll: 0, page: 0, mode: 'page', ratio: 0 }
    // 旧版只记滚动像素：先按滚动模式原位恢复一次，避免升级后突然跳回章首。
    const legacyScroll = !restore?.mode && (restore?.scroll || 0) > 0
    setReadingMode(restore?.mode === 'scroll' || legacyScroll ? 'scroll' : 'page')
    await openChapter(book, startIdx, restore)
  }

  // 滚动模式恢复旧版像素位置；新版额外保存 ratio，换屏幕后也能回到大致同一段。
  useEffect(() => {
    if (!chapter || readingMode !== 'scroll' || !bodyRef.current) return
    const saved = restorePositionRef.current || {}
    requestAnimationFrame(() => {
      const el = bodyRef.current
      if (!el) return
      const max = Math.max(0, el.scrollHeight - el.clientHeight)
      el.scrollTop = saved.ratio != null ? saved.ratio * max : (saved.scroll || 0)
      restorePositionRef.current = null
    })
  }, [chapterViewKey, readingMode])

  // CSS 多栏把正文排成横向书页；每一栏的跨度恰好等于视口宽度。
  // 用实际渲染宽度计页，旋转屏幕或地址栏高度变化时会重新计算。
  useEffect(() => {
    if (!chapter || readingMode !== 'page') return undefined
    let frame = 0
    function measure() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const viewport = pageViewportRef.current
        const text = textRef.current
        if (!viewport || !text) return
        const width = Math.max(1, viewport.clientWidth)
        setPageWidth(width)
        const count = Math.max(1, Math.ceil(text.scrollWidth / width))
        const saved = restorePositionRef.current
        // 只有从翻页模式恢复时才沿用绝对页码。滚动模式保存的 page 可能是
        // 上一次多栏布局留下的旧值（常见是 pageCount=1 时的 0），切回翻页
        // 必须以正文比例按当前屏幕重新换算。
        const savedPage = Number(saved?.page)
        const savedRatio = Math.min(1, Math.max(0, Number(saved?.ratio) || 0))
        const requested = saved?.mode === 'page' && Number.isFinite(savedPage)
          ? savedPage
          : Math.round(savedRatio * Math.max(0, count - 1))
        setPageCount(count)
        setPageIndex((current) => Math.max(0, Math.min(count - 1, saved ? requested : current)))
        if (saved) restorePositionRef.current = null
      })
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (pageViewportRef.current) observer?.observe(pageViewportRef.current)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [chapterViewKey, readingMode, chapter, langMode])

  // 滚动时静默记进度（防抖 300ms；savePos 只写 localStorage，组件卸载后落笔也安全）
  function onBodyScroll(e) {
    if (!active || !chapter || readingMode !== 'scroll') return
    const top = e.target.scrollTop
    const max = Math.max(1, e.target.scrollHeight - e.target.clientHeight)
    clearTimeout(scrollTimerRef.current)
    if (peekRef.current) return
    scrollTimerRef.current = setTimeout(() => savePos(active.id, chapter.idx, {
      scroll: top, page: 0, mode: 'scroll', ratio: top / max,
    }), 300)
  }

  function rememberPage(nextPage) {
    if (!active || !chapter || peekRef.current) return
    savePos(active.id, chapter.idx, {
      page: nextPage,
      scroll: 0,
      mode: 'page',
      ratio: nextPage / Math.max(1, pageCount - 1),
    })
  }

  function turnPage(direction) {
    if (!chapter || loading) return
    setFocusAnno(null)
    const next = pageIndex + direction
    if (next < 0) {
      if (chapter.idx > 0) openChapter(active, chapter.idx - 1, { mode: 'page', page: Number.MAX_SAFE_INTEGER, ratio: 1 })
      return
    }
    if (next >= pageCount) {
      if (chapter.idx < chapterCount - 1) openChapter(active, chapter.idx + 1, { mode: 'page', page: 0, ratio: 0 })
      return
    }
    setPageIndex(next)
    rememberPage(next)
  }

  function switchReadingMode() {
    const next = readingMode === 'page' ? 'scroll' : 'page'
    const el = bodyRef.current
    const ratio = readingMode === 'page'
      ? pageIndex / Math.max(1, pageCount - 1)
      : (el?.scrollTop || 0) / Math.max(1, (el?.scrollHeight || 1) - (el?.clientHeight || 0))
    restorePositionRef.current = next === 'page'
      ? { mode: next, ratio }
      : { mode: next, ratio, page: pageIndex }
    setReaderChromeVisible(true)
    setReadingMode(next)
    savePos(active.id, chapter.idx, {
      mode: next,
      ratio,
      page: next === 'page' ? Math.round(ratio * Math.max(0, pageCount - 1)) : pageIndex,
      scroll: el?.scrollTop || 0,
    })
  }

  function onPageTouchStart(event) {
    if (event.touches?.length !== 1) { touchStartRef.current = null; return }
    const touch = event.changedTouches?.[0]
    if (touch) touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }
  }

  function onPageTouchEnd(event) {
    const start = touchStartRef.current
    const touch = event.changedTouches?.[0]
    touchStartRef.current = null
    if (!start || !touch) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    // A drag/long press must not become a synthetic tap that hides the reader chrome.
    if (Math.hypot(dx, dy) > 10 || Date.now() - start.time > 500) lastPageSwipeAtRef.current = Date.now()
    if (pending || composing || !window.getSelection()?.isCollapsed || Date.now() - start.time > 700) return
    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      lastPageSwipeAtRef.current = Date.now()
      turnPage(dx < 0 ? 1 : -1)
    }
  }

  function toggleReaderChrome() {
    if (readingMode !== 'page' || pending || composing || chatOpen || tocOpen) return
    if (Date.now() - lastPageSwipeAtRef.current < 450) return
    const selection = window.getSelection?.()
    if (selection && !selection.isCollapsed) return
    // 菜单收放会改变书页高度。留下比例而非旧页码，让 ResizeObserver
    // 按新的每页容量把当前位置换算回来，不让正文突然跳段。
    restorePositionRef.current = {
      mode: 'layout',
      ratio: pageIndex / Math.max(1, pageCount - 1),
    }
    setReaderChromeVisible((visible) => !visible)
  }

  // 读讫章开合：阿颖的那枚从这里盖；涟言的那枚由他自己通过 API 盖
  async function toggleStamp() {
    const mine = stamps.some((s) => s.reader === '阿颖')
    try {
      const r = mine ? await unstampBook(cfg, active.id, '阿颖') : await stampBook(cfg, active.id, '阿颖')
      setStamps(r.stamps || [])
      setBooks((prev) => prev?.map((b) => (b.id === active.id ? { ...b, stamps: r.stamps || [] } : b)) ?? prev)
      showToast(mine ? '撤下了读讫章' : '啪！读讫章盖上了')
    } catch { showToast('盖章失败', 'error') }
  }

  // 监听正文里的文字选择 → 算出章内字符偏移（渲染文本与原文逐字一致，直接数长度）
  useEffect(() => {
    if (!chapter) return
    function onSelChange() {
      if (composing || excerptCard) return // 编辑器打开时锁定当前选区
      if (textRef.current?.dataset.lang === 'en') { setPending(null); return } // 只英文时没有中文偏移，不划线
      const sel = window.getSelection()
      const el = textRef.current
      if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) { setPending(null); return }
      const range = sel.getRangeAt(0)
      if (!el.contains(range.commonAncestorContainer)) { setPending(null); return }
      const pre = range.cloneRange()
      pre.selectNodeContents(el)
      pre.setEnd(range.startContainer, range.startOffset)
      const start = pre.toString().length
      const quote = range.toString()
      if (!quote.trim()) { setPending(null); return }
      const rect = range.getBoundingClientRect()
      setPending({ start, end: start + quote.length, quote, above: rect.bottom > window.innerHeight / 2 })
    }
    document.addEventListener('selectionchange', onSelChange)
    return () => document.removeEventListener('selectionchange', onSelChange)
  }, [chapter, composing, excerptCard])

  // 中英对照挪段（1023）：配错了一两段时，把这格英文的第一段挪给上一段，或最后一段挪给下一段，整章存回去
  async function moveAlt(dir) {
    if (!altEdit || !Array.isArray(chapter?.alt)) return
    const k = altEdit.k
    const arr = [...chapter.alt]
    const parts = String(arr[k] || '').split('\n').filter(Boolean)
    if (!parts.length) return
    if (dir < 0) {
      if (k === 0) { showToast('已经是第一段了'); return }
      const first = parts.shift()
      arr[k - 1] = arr[k - 1] ? arr[k - 1] + '\n' + first : first
    } else {
      if (k >= arr.length - 1) { showToast('已经是最后一段了'); return }
      const last = parts.pop()
      arr[k + 1] = arr[k + 1] ? last + '\n' + arr[k + 1] : last
    }
    arr[k] = parts.join('\n')
    const before = chapter.alt
    setChapter((prev) => ({ ...prev, alt: arr }))
    setAltEdit(arr[k] ? { k } : null)
    try { await saveBookChapterAlt(cfg, active.id, chapter.idx, arr) } catch {
      setChapter((prev) => ({ ...prev, alt: before }))
      showToast('没存上，再试一次', 'error')
    }
  }

  async function submitAnno() {
    if (!pending) return
    try {
      const created = await createBookAnnotation(cfg, active.id, {
        chapter_idx: chapter.idx,
        start_off: pending.start,
        end_off: pending.end,
        quote: pending.quote.slice(0, 200),
        author: annoAuthor,
        color: annoColor,
        note: annoNote.trim(),
      })
      setChapter((prev) => ({ ...prev, annotations: [...prev.annotations, created].sort((a, b) => a.start_off - b.start_off) }))
      setPending(null); setComposing(false); setAnnoNote(''); setAnnoColor('yellow')
      window.getSelection()?.removeAllRanges()
      showToast('划下了这一句')
    } catch { showToast('批注失败', 'error') }
  }

  function openExcerptCard(excerpt, note = '') {
    const quote = String(excerpt || '').trim()
    if (!quote || savingCard) return
    setExcerptCard({ quote, note: String(note || '').trim(), imageDataUrl: '' })
  }

  async function chooseExcerptImage(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setCardImageLoading(true)
    try {
      const imageDataUrl = await prepareExcerptCover(file)
      setExcerptCard((current) => current ? { ...current, imageDataUrl } : current)
    } catch (error) {
      showToast(error?.message || '图片读取失败', 'error')
    } finally {
      setCardImageLoading(false)
    }
  }

  function closeExcerptCard() {
    if (savingCard || cardImageLoading) return
    setExcerptCard(null)
  }

  async function saveExcerptCard() {
    if (!excerptCard?.quote || savingCard || cardImageLoading) return
    setSavingCard(true)
    try {
      const blob = await renderExcerptCardPng({
        quote: excerptCard.quote,
        note: excerptCard.note,
        title: active.title,
        author: active.author,
        chapter: chapter.title || `第 ${chapter.idx + 1} 章`,
        color: active.cover_color,
        imageDataUrl: excerptCard.imageDataUrl,
        readingTime: readingSummary ? formatReadingTime(readingSummary.weekSeconds) : '',
      })
      const safeTitle = String(active.title || '书摘').replace(/[\\/:*?"<>|]/g, '').slice(0, 28) || '书摘'
      const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()).replaceAll('-', '')
      downloadBlob(blob, `书摘-${safeTitle}-${day}.png`)
      showToast('书摘卡已保存到手机')
      setExcerptCard(null)
      setPending(null)
      window.getSelection()?.removeAllRanges()
    } catch (error) {
      showToast(error?.message || '书摘卡生成失败', 'error')
    } finally {
      setSavingCard(false)
    }
  }

  async function removeAnno(id) {
    try {
      await deleteBookAnnotation(cfg, id)
      setChapter((prev) => ({ ...prev, annotations: prev.annotations.filter((a) => a.id !== id) }))
      setFocusAnno(null)
    } catch { showToast('删除失败', 'error') }
  }

  async function markBookmark() {
    try {
      await saveBookBookmark(cfg, active.id, chapter.idx, '阿颖')
      showToast('书签夹在这一章了')
    } catch { showToast('书签保存失败', 'error') }
  }

  async function sendReply(parent) {
    const text = (replyDraft[parent.id] || '').trim()
    if (!text) return
    try {
      const created = await createBookAnnotation(cfg, active.id, {
        chapter_idx: chapter.idx, start_off: parent.start_off, end_off: parent.end_off, quote: parent.quote,
        author: annoAuthor, color: parent.color, note: text, parent_id: parent.id,
      })
      setChapter((prev) => ({ ...prev, annotations: [...prev.annotations, created] }))
      setReplyDraft((d) => ({ ...d, [parent.id]: '' }))
    } catch { showToast('没回上，再试一次', 'error') }
  }

  async function toggleStar(a) {
    const on = !a.starred_by
    try {
      await starBookAnnotation(cfg, a.id, annoAuthor, on)
      setChapter((prev) => ({ ...prev, annotations: prev.annotations.map((x) => x.id === a.id ? { ...x, starred_by: on ? annoAuthor : null } : x) }))
      showToast(on ? '夹上书签了' : '书签取下了')
    } catch { showToast('没夹上，再试一次', 'error') }
  }
  async function openStars() {
    setStarOpen(true); setStarred(null)
    try { const list = await fetchStarredAnnotations(cfg, active.id); setStarred(Array.isArray(list) ? list : []) } catch { setStarred([]) }
  }
  async function goToStar(a) {
    setStarOpen(false)
    if (chapter?.idx !== a.chapter_idx) {
      const from = peekFrom || loadPos(active.id) || { ch: chapter?.idx ?? 0 }
      await openChapter(active, a.chapter_idx, null, true)
      setPeekFrom(from)
    }
    setFocusAnno(a.id)
    if (readingMode !== 'page') setTimeout(() => annoRefs.current[a.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)
  }

  function openEchoes() {
    setEchoOpen(true)
    const ids = echoes.map((e) => e.id)
    if (ids.length) markBookEchoesSeen(cfg, ids).catch(() => {})   // 清单里就能读完，打开即算看过
  }
  async function goToEcho(e) {
    const book = books?.find((b) => b.id === e.book_id)
    if (!book) { showToast('这本书不在书架上了', 'error'); return }
    setEchoOpen(false); setEchoes([])
    await openBook(book)
    const from = loadPos(book.id)
    await openChapter(book, e.chapter_idx, null, true)
    setPeekFrom(from || { ch: book.bookmark_chapter ?? 0 })
    setFocusAnno(e.parent_id ?? e.id)
  }

  function jumpToAnno(id) {
    if (Date.now() - lastPageSwipeAtRef.current < 450 || !window.getSelection()?.isCollapsed) return
    if (readingMode === 'page') {
      setFocusAnno(current => current === id ? null : id)
      return
    }
    setFocusAnno(id)
    annoRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // 1023：TXT / EPUB / 文字型 PDF 都收，解析在本机做。中英对照时这是中文那本
  async function pickFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUpload((prev) => ({ ...prev, reading: 'zh' }))
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
    try {
      const r = await readBookFile(file)
      setUpload((prev) => {
        const next = { ...prev, reading: null, fileName: file.name, chapters: r.chapters,
          title: prev.title || r.title, author: prev.author || r.author,
          pdfFile: isPdf ? file : null, pdfMode: isPdf ? 'text' : null, pdfImageOnly: false }
        if (next.altChapters) { next.altOffset = guessOffset(next.chapters, next.altChapters); next.zhStart = undefined }
        return next
      })
    } catch (error) {
      // 图片版 PDF 单本上架时不算失败：改成原样翻页（中英对照里还是不收）
      if (error?.imagePdf && !upload?.bilingual) {
        setUpload((prev) => ({ ...prev, reading: null, fileName: file.name, chapters: null,
          title: prev.title || file.name.replace(/\.pdf$/i, '').trim(),
          pdfFile: file, pdfMode: 'page', pdfImageOnly: true }))
        return
      }
      setUpload((prev) => ({ ...prev, reading: null }))
      showToast(error?.message || '读取文件失败', 'error')
    }
  }

  async function pickAltFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUpload((prev) => ({ ...prev, reading: 'en' }))
    try {
      const r = await readBookFile(file)
      setUpload((prev) => ({ ...prev, reading: null, altName: file.name, altChapters: r.chapters,
        altOffset: prev.chapters ? guessOffset(prev.chapters, r.chapters) : 0, zhStart: undefined }))
    } catch (error) {
      setUpload((prev) => ({ ...prev, reading: null }))
      showToast(error?.message || '读取文件失败', 'error')
    }
  }

  function applyPaste(text) {
    if (!text.trim()) { setUpload((prev) => ({ ...prev, chapters: null, fileName: null })); return }
    setUpload((prev) => ({ ...prev, chapters: splitChapters(text), fileName: '（粘贴的文本）' }))
  }

  async function submitBook() {
    if (upload.pdfFile && upload.pdfMode === 'page' && !upload.bilingual && !upload.appendTo) { submitPdfBook(); return }
    if (!upload.chapters?.length) { showToast('还没有正文（选文件或粘贴）', 'error'); return }
    if (upload.bilingual && !upload.appendTo && !upload.altChapters?.length) { showToast('英文版还没选', 'error'); return }
    // 追更模式：只往已有的书末尾续章，元信息全部不动
    if (upload.appendTo) {
      setSaving(true)
      try {
        const r = await appendBookChapters(cfg, upload.appendTo, upload.chapters)
        showToast(`续上了 ${r.appended} 章`)
        setUpload(null)
        const list = await fetchBooks(cfg).catch(() => null)
        if (Array.isArray(list)) setBooks(list)
      } catch { showToast('追更失败（文件太大或网络问题）', 'error') } finally { setSaving(false) }
      return
    }
    if (!upload.title?.trim()) { showToast('给书起个名字', 'error'); return }
    setSaving(true)
    try {
      await createBook(cfg, {
        title: upload.title.trim(),
        author: upload.author?.trim() || '',
        intro: upload.intro?.trim() || '',
        cover_color: upload.color || SPINE_COLORS[0],
        added_by: '阿颖',
        shelf: upload.shelf || '闲书层',
        ...(upload.bilingual && upload.altChapters
          ? { alt_lang: 'en', chapters: pairBooks(upload.chapters, upload.altChapters, upload.altOffset || 0, upload.zhStart ?? Math.max(0, -(upload.altOffset || 0))) }
          : { chapters: upload.chapters }),
      })
      showToast('上架好了')
      setUpload(null)
      const list = await fetchBooks(cfg).catch(() => null)
      if (Array.isArray(list)) setBooks(list)
    } catch { showToast('上架失败（文件太大或网络问题）', 'error') } finally { setSaving(false) }
  }

  // 原样 PDF：服务器只记书名和页数，文件存进这台设备
  async function submitPdfBook() {
    if (!upload.title?.trim()) { showToast('给书起个名字', 'error'); return }
    setSaving(true)
    try {
      const doc = await openPdf(upload.pdfFile)
      const pages = doc.numPages
      doc.destroy?.()
      const created = await createBook(cfg, {
        title: upload.title.trim(),
        author: upload.author?.trim() || '',
        intro: upload.intro?.trim() || '',
        cover_color: upload.color || SPINE_COLORS[0],
        added_by: '阿颖',
        shelf: upload.shelf || '工具层',
        format: 'pdf',
        chapters: [{ title: '原样 PDF', content: `原样 PDF，共 ${pages} 页。文件存在阿颖的设备上，看不懂的页她会截图来问。` }],
      })
      await savePdfBlob(created.id, upload.pdfFile)
      showToast('上架好了')
      setUpload(null)
      const list = await fetchBooks(cfg).catch(() => null)
      if (Array.isArray(list)) setBooks(list)
    } catch (e) { showToast('上架失败：' + (e?.message || '网络问题'), 'error') } finally { setSaving(false) }
  }

  async function removeBook(event, book) {
    event.stopPropagation()
    const bookId = Number(book.id)
    if (!Number.isSafeInteger(bookId) || bookId <= 0) {
      showToast('这本书缺少可确认的编号，未执行删除', 'error')
      return
    }
    const accepted = await confirmAction({
      kicker: '整理书架',
      title: `删除《${book.title}》？`,
      description: `将删除整本书及其 ${book.chapter_count || 0} 个章节。`,
      note: book.anno_count > 0
        ? `这本书还有 ${book.anno_count} 处划线；正文、批注、书签及关联记录都会一并删除，且无法撤销。`
        : '正文、书签及关联记录都会一并删除，且无法撤销。',
      cancelLabel: '先留着',
      confirmLabel: '确认删除',
    })
    if (!accepted) return
    try {
      const result = await deleteBook(cfg, bookId)
      if (!result?.ok) throw new Error('服务端没有确认删除')
      setBooks((current) => current?.filter((item) => Number(item.id) !== bookId) ?? current)
      if (book.format === 'pdf') deletePdfBlob(bookId).catch(() => {})
      try {
        const positions = JSON.parse(localStorage.getItem(POS_KEY) || '{}')
        delete positions[bookId]
        localStorage.setItem(POS_KEY, JSON.stringify(positions))
      } catch { /* ignore local progress cleanup */ }
      showToast('已经从书架删除', 'success')
    } catch (error) {
      showToast(error?.message || '删除失败，请稍后再试', 'error')
    }
  }

  if (pdfBook) return <PdfBookReader book={pdfBook} cfg={cfg} onBack={() => setPdfBook(null)} onClose={onClose} />

  // ── 上架新书视图 ──
  if (!active && upload) {
    return (
      <div className="roost-overlay" onClick={() => !saving && setUpload(null)}>
        <div className="roost-modal roost-modal-tall coread-modal" onClick={(e) => e.stopPropagation()}>
          <div className="roost-modal-header">
            <button className="coread-back" onClick={() => !saving && setUpload(null)}>‹ 书架</button>
            <span>{upload.appendTo ? `追更《${upload.appendTitle}》` : '上架新书'}</span>
            <button className="roost-modal-close" onClick={() => !saving && setUpload(null)}>✕</button>
          </div>
          <div className="roost-modal-body">
            <input ref={fileRef} type="file" accept=".txt,.text,.epub,.pdf,text/plain,application/epub+zip,application/pdf" style={{ display: 'none' }} onChange={pickFile} />
            <input ref={altFileRef} type="file" accept=".txt,.text,.epub,.pdf,text/plain,application/epub+zip,application/pdf" style={{ display: 'none' }} onChange={pickAltFile} />
            {!upload.appendTo && (
              <div className="bookread-spine-row">
                <span className="bookread-foot-hint">版本</span>
                <div className="bookread-author-toggle">
                  <button className={!upload.bilingual ? 'active' : ''} onClick={() => setUpload({ ...upload, bilingual: false })}>单本</button>
                  <button className={upload.bilingual ? 'active' : ''} onClick={() => setUpload({ ...upload, bilingual: true })}>中英对照</button>
                </div>
              </div>
            )}
            <button className="roost-btn" style={{ width: '100%', marginBottom: 10 }} disabled={!!upload.reading} onClick={() => fileRef.current?.click()}>
              {upload.reading === 'zh' ? '读取中……' : upload.fileName ? `${upload.bilingual ? '中文版：' : '已读取：'}${upload.fileName}` : (upload.bilingual ? '选中文版（txt / epub / pdf）' : '选一个文件（txt / epub / pdf）')}
            </button>
            {upload.bilingual && !upload.appendTo && (
              <button className="roost-btn" style={{ width: '100%', marginBottom: 10 }} disabled={!!upload.reading} onClick={() => altFileRef.current?.click()}>
                {upload.reading === 'en' ? '读取中……' : upload.altName ? `英文版：${upload.altName}` : '选英文版（txt / epub / pdf）'}
              </button>
            )}
            {upload.bilingual && upload.chapters?.length > 0 && upload.altChapters?.length > 0 && (() => {
              const off = upload.altOffset || 0
              // 1029 她说：原来只有一组 ±，只挪英文；有时候是中文前面多了序和推荐语，要挪中文。
              // 现在两边各自定「从第几章开始配」，偏移 = 英文起点 − 中文起点；中文起点之前的章不配英文
              const zhS = upload.zhStart ?? Math.max(0, -off)
              const enS = zhS + off
              const setStarts = (z, e) => setUpload({ ...upload, zhStart: z, altOffset: e - z })
              const preview = previewPairs(upload.chapters, upload.altChapters, off, zhS)
              const short = (t) => { t = (t || '').trim(); return t.length > 14 ? t.slice(0, 14) + '…' : t }
              return (
                <div className="bookread-pair-preview">
                  <div className="bookread-pair-offset">
                    <span>中文从第 {zhS + 1} 章<em>{short(upload.chapters[zhS]?.title)}</em></span>
                    <button disabled={zhS <= 0} onClick={() => setStarts(zhS - 1, enS)}>−</button>
                    <button disabled={zhS >= upload.chapters.length - 1} onClick={() => setStarts(zhS + 1, enS)}>＋</button>
                  </div>
                  <div className="bookread-pair-offset">
                    <span>英文从第 {enS + 1} 章<em>{short(upload.altChapters[enS]?.title)}</em></span>
                    <button disabled={enS <= 0} onClick={() => setStarts(zhS, enS - 1)}>−</button>
                    <button disabled={enS >= upload.altChapters.length - 1} onClick={() => setStarts(zhS, enS + 1)}>＋</button>
                  </div>
                  <div className="bookread-foot-hint">中文 {upload.chapters.length} 章 · 英文 {upload.altChapters.length} 章。两边都调到正文第一章（序、推荐语跳过去），看下面配得对不对；段落错一两段，读的时候点英文可以挪。</div>
                  {preview.map((c, ci) => (
                    <div key={ci} className="bookread-pair-chapter">
                      <div className="bookread-pair-title">{c.title}{c.alt_title ? ` ⇄ ${c.alt_title}` : ' ⇄ （没有对应的英文章）'}</div>
                      {(c.content.match(/[^\n]*\S[^\n]*/g) || []).slice(0, 3).map((zh, pi) => (
                        <div key={pi} className="bookread-pair-para">
                          <div>{zh.trim().slice(0, 80)}{zh.trim().length > 80 ? '…' : ''}</div>
                          <div className="bookread-pair-en">{(c.alt?.[pi] || '（这段下面没配上英文）').slice(0, 120)}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )
            })()}
            {upload.pdfFile && !upload.bilingual && !upload.appendTo && (
              <div className="bookread-spine-row">
                <span className="bookread-foot-hint">PDF 怎么放</span>
                <div className="bookread-author-toggle">
                  <button className={upload.pdfMode === 'text' ? 'active' : ''} disabled={upload.pdfImageOnly}
                    onClick={() => setUpload({ ...upload, pdfMode: 'text' })}>抽成文字</button>
                  <button className={upload.pdfMode === 'page' ? 'active' : ''} onClick={() => setUpload({ ...upload, pdfMode: 'page' })}>原样翻页</button>
                </div>
              </div>
            )}
            {upload.pdfFile && upload.pdfMode === 'page' && !upload.bilingual && (
              <div className="bookread-foot-hint" style={{ marginBottom: 10 }}>
                {upload.pdfImageOnly ? '这是图片版 PDF，抽不出字，只能原样翻页。' : '图文教程选这个：照原样一页页翻。'}
                文件只存在这台设备上；哪页看不懂点「问阿言」，只把那一页发过去。不能划线。
              </div>
            )}
            {!upload.fileName && !upload.bilingual && (
              <textarea
                className="roost-note-input"
                rows={5}
                placeholder="或者直接把正文粘贴到这里……"
                onBlur={(e) => applyPaste(e.target.value)}
                style={{ marginBottom: 10 }}
              />
            )}
            {upload.chapters?.length > 0 && upload.pdfMode !== 'page' && (
              <div className="bookread-split-info">
                识别出 {upload.chapters.length} 章，共 {upload.chapters.reduce((s, c) => s + c.content.length, 0).toLocaleString()} 字
                {upload.chapters.length > 1 && <span className="bookread-split-titles">{upload.chapters.slice(0, 3).map((c) => c.title).join(' / ')}{upload.chapters.length > 3 ? ' …' : ''}</span>}
              </div>
            )}
            {upload.appendTo ? (
              <div className="bookread-foot-hint" style={{ marginBottom: 4 }}>
                新章会接在这本书现有章节后面，旧章和上面的划线批注都不动。
              </div>
            ) : (
              <>
                <input className="roost-letter-input" style={{ width: '100%', marginBottom: 10 }} placeholder="书名"
                  value={upload.title || ''} onChange={(e) => setUpload({ ...upload, title: e.target.value })} />
                <input className="roost-letter-input" style={{ width: '100%', marginBottom: 10 }} placeholder="作者（选填）"
                  value={upload.author || ''} onChange={(e) => setUpload({ ...upload, author: e.target.value })} />
                <input className="roost-letter-input" style={{ width: '100%', marginBottom: 10 }} placeholder="一句话简介 / 为什么想读它（选填）"
                  value={upload.intro || ''} onChange={(e) => setUpload({ ...upload, intro: e.target.value })} />
                <div className="bookread-spine-row">
                  <span className="bookread-foot-hint">书脊颜色</span>
                  {SPINE_COLORS.map((c) => (
                    <button key={c} className={'bookread-spine-dot' + ((upload.color || SPINE_COLORS[0]) === c ? ' active' : '')}
                      style={{ background: c }} onClick={() => setUpload({ ...upload, color: c })} />
                  ))}
                </div>
                <div className="bookread-spine-row">
                  <span className="bookread-foot-hint">放哪层</span>
                  <div className="bookread-author-toggle">
                    {SHELF_ORDER.map((s) => (
                      <button key={s} className={(upload.shelf || '闲书层') === s ? 'active' : ''} onClick={() => setUpload({ ...upload, shelf: s })}>{s}</button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <button className="roost-btn" style={{ width: '100%', marginTop: 14 }} disabled={saving} onClick={submitBook}>
              {saving ? (upload.appendTo ? '追更中……' : '上架中……') : (upload.appendTo ? '续上' : '上架')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── 书架视图 ──
  if (!active) {
    // 按层分组：闲书层/正经层/工具层，没归层的排最后
    const groups = SHELF_ORDER.map((s) => [s, (books || []).filter((b) => (b.shelf || '') === s)])
    const unshelved = (books || []).filter((b) => !SHELF_ORDER.includes(b.shelf || ''))
    if (unshelved.length) groups.push(['还没归层', unshelved])
    const renderBook = (b) => (
      <div key={b.id} className="bookread-book" onClick={() => openBook(b)}>
        <div className="bookread-spine" style={{ background: b.cover_color || '#8b6f47' }} />
        <div className="bookread-book-main">
          <div className="bookread-book-title">{b.title}<span className="bookread-book-author">{b.author}</span></div>
          {b.intro && <div className="bookread-book-intro">{b.intro}</div>}
          <div className="bookread-book-meta">
            <span>{b.format === 'pdf' ? '原样 PDF' : `${b.chapter_count} 章`}{b.alt_lang ? ' · 中英' : ''}</span>
            <span>{b.anno_count > 0 ? `${b.anno_count} 处划线` : '还没有划线'}</span>
            {b.bookmark_chapter != null && <span>书签在第 {b.bookmark_chapter + 1} 章</span>}
            {b.format !== 'pdf' && <span
              className="bookread-append-link"
              onClick={(e) => { e.stopPropagation(); setUpload({ appendTo: b.id, appendTitle: b.title }) }}
            >＋追更</span>}
            <span
              className="bookread-append-link"
              style={{ color: 'var(--danger, #b3453f)' }}
              onClick={(e) => removeBook(e, b)}
            >删除</span>
          </div>
        </div>
        {b.stamps?.length > 0 && (
          <div className="bookread-stamps">
            {b.stamps.map((s) => (
              <span key={s.reader} className={'bookread-stamp' + (s.reader === '涟言' ? ' crow' : '')}>
                读讫<i>{s.reader}·{(s.stamped_at || '').slice(5, 10).replace('-', '/')}</i>
              </span>
            ))}
          </div>
        )}
      </div>
    )
    // 每层最后一本歪着靠在前一本肩上（1020）：绕自己右下角往左倒 LEAN 度，
    // 左边缘刚好碰到邻居——邻居矮就搭在它的顶角上，邻居高就整本侧面贴上去。底下留出的空隙就是 margin-left
    const LEAN = 9 * Math.PI / 180
    const leanGap = (W, H, prevH) => {
      const t = Math.min(H, (prevH - W * Math.sin(LEAN)) / Math.cos(LEAN))
      return Math.max(0, Math.round(t * Math.sin(LEAN) - W + W * Math.cos(LEAN)))
    }
    const renderSpine = (b, i, list) => {
      const look = spineLook(b)
      const reading = b.bookmark_chapter != null
      const canLean = list.length > 1 && i === list.length - 1
      const leaning = canLean && !straight.has(b.id)
      const extra = leaning
        ? { transform: `rotate(-${LEAN * 180 / Math.PI}deg)`, marginLeft: leanGap(look.width, look.height, spineLook(list[i - 1]).height) }
        : {}
      return (
        <button
          key={b.id} type="button"
          onClick={() => {
            if (pressRef.current?.fired) { pressRef.current = null; return } // 刚长按推歪了，这一下不算点
            if (leaning) { setStraight((prev) => new Set(prev).add(b.id)); return } // 歪着的先扶正，再点才看封面
            showCover(b)
          }}
          onPointerDown={() => {
            if (!canLean || leaning) return
            const timer = setTimeout(() => {
              pressRef.current = { fired: true }
              setStraight((prev) => { const n = new Set(prev); n.delete(b.id); return n })
              try { navigator.vibrate?.(15) } catch { /* 不支持就算了 */ }
            }, 450)
            pressRef.current = { timer }
          }}
          onPointerUp={() => { if (pressRef.current?.timer) clearTimeout(pressRef.current.timer) }}
          onPointerLeave={() => { if (pressRef.current?.timer) clearTimeout(pressRef.current.timer) }}
          onContextMenu={(e) => { if (canLean) e.preventDefault() }}
          className={'bookread-spine-book' + (reading ? ' has-ribbon' : '') + (b.stamps?.length > 0 ? ' has-seal' : '')
            + (leaning ? ' leaning' : canLean ? ' just-straightened' : '')}
          title={leaning ? '歪了，点一下扶正' : `${b.title}${b.author ? ' · ' + b.author : ''}`}
          aria-label={`${b.title}${reading ? `，书签在第 ${b.bookmark_chapter + 1} 章` : ''}${leaning ? '（歪着，点一下扶正）' : ''}`}
          style={{ width: look.width, height: look.height, '--h': look.height + 'px', backgroundColor: look.color, color: look.ink, ...extra }}
        >
          {reading && <i className="bookread-spine-ribbon" />}
          <span className="bookread-spine-title">{look.title}</span>
          {b.stamps?.length > 0 && <i className="bookread-spine-seal" />}
        </button>
      )
    }
    return (
      <div className="roost-overlay" onClick={onClose}>
        <div className="roost-modal roost-modal-tall coread-modal" onClick={(e) => e.stopPropagation()}>
          <div className="roost-modal-header">
            <span>书架 · 一起读一本书</span>
            <button className="roost-modal-close" onClick={onClose}>✕</button>
          </div>
          <div className="roost-modal-body">
            {books === null && <div className="roost-empty">加载中……</div>}
            {books?.length === 0 && <div className="roost-empty">书架还空着（跟阿言说一声想读什么，我来上架）</div>}
            {echoes.length > 0 && (
              <button className="bookread-echo-banner" onClick={openEchoes}>
                <span className="bookread-echo-dot" />页边有 {echoes.length} 条新回音
              </button>
            )}
            {echoOpen && (
              <div className="bookread-echo-sheet" onClick={() => { setEchoOpen(false); setEchoes([]) }}>
                <section onClick={(e) => e.stopPropagation()} aria-label="页边新回音">
                  <div className="bookread-echo-head">
                    <strong>页边新回音</strong>
                    <button onClick={() => { setEchoOpen(false); setEchoes([]) }} aria-label="关上">✕</button>
                  </div>
                  {echoes.map((e) => (
                    <div key={e.id} className="bookread-echo-item">
                      <div className="bookread-echo-where">《{e.book_title}》{e.chapter_title ? ` · ${e.chapter_title}` : ''}</div>
                      <div className="bookread-anno-quote">「{e.quote}」</div>
                      {e.parent_note && <div className="bookread-echo-line"><span className="coread-anno-author">{e.parent_author}</span>{e.parent_note}</div>}
                      <div className="bookread-echo-line mine"><span className="coread-anno-author">{e.author}</span>{e.note || '（划了一道）'}</div>
                      <button className="bookread-card-link" onClick={() => goToEcho(e)}>翻到那儿</button>
                    </div>
                  ))}
                </section>
              </div>
            )}
            <button className="roost-btn" style={{ width: '100%', marginBottom: 12 }} onClick={() => setUpload({ color: SPINE_COLORS[0], shelf: '闲书层' })}>
              ＋ 上架新书（txt / epub / pdf，可中英对照）
            </button>
            {books?.length > 0 && (
              <div className="bookread-view-toggle" role="tablist" aria-label="书架的看法">
                <button type="button" role="tab" aria-selected={shelfView === 'spines'} className={shelfView === 'spines' ? 'on' : ''} onClick={() => switchShelfView('spines')}>书架</button>
                <button type="button" role="tab" aria-selected={shelfView === 'list'} className={shelfView === 'list' ? 'on' : ''} onClick={() => switchShelfView('list')}>列表</button>
              </div>
            )}
            <div className="bookread-shelf">
              {groups.map(([label, list]) => list.length > 0 && (
                <div key={label} className="bookread-shelf-section">
                  <div className="bookread-shelf-label">{label}<span>{list.length} 本</span></div>
                  {shelfView === 'spines'
                    ? <div className="bookread-plank">{list.map(renderSpine)}</div>
                    : list.map(renderBook)}
                </div>
              ))}
            </div>
            {shelfView === 'spines' && books?.length > 0 && (
              <div className="bookread-foot-hint" style={{ marginTop: 10, textAlign: 'center' }}>点书先看封面；歪着的那本点一下扶正，长按再推歪。丝带是书签，红点是读讫。追更和删除在「列表」里。</div>
            )}
          </div>
          {coverBook && (() => {
            const b = coverBook.book
            const look = spineLook(b)
            return (
              <div className="bookread-cover-stage" onClick={() => setCoverBook(null)}>
                <div className="bookread-cover-wrap" onClick={(e) => e.stopPropagation()}>
                  <div className={'bookread-cover' + (coverBook.image ? ' has-image' : '')}
                    style={{ '--cover': look.color, '--cover-ink': look.ink }}>
                    {coverBook.image
                      ? <img src={coverBook.image} alt={b.title} />
                      : coverBook.loading
                      ? <div className="bookread-cover-drawn bookread-cover-wait"><div className="bookread-cover-loading">封面取来中……</div></div>
                      : (
                        <div className="bookread-cover-drawn">
                          <i className="bookread-cover-rule" />
                          <div className="bookread-cover-title">{look.title}</div>
                          {b.author && <div className="bookread-cover-author">{b.author}</div>}
                          {b.intro && <div className="bookread-cover-intro">{b.intro}</div>}
                          <i className="bookread-cover-rule bottom" />
                          {coverBook.loading && <div className="bookread-cover-loading">封面取来中……</div>}
                        </div>
                      )}
                  </div>
                  <div className="bookread-cover-actions">
                    <button className="roost-btn" onClick={() => { const bk = b; setCoverBook(null); openBook(bk) }}>翻开</button>
                    <button className="roost-btn ghost" onClick={() => coverFileRef.current?.click()}>{coverBook.image ? '换一张' : '换封面'}</button>
                    {coverBook.image && <button className="roost-btn ghost" onClick={dropCover}>换回画的</button>}
                  </div>
                  <input ref={coverFileRef} type="file" accept="image/*" hidden onChange={pickCover} />
                </div>
              </div>
            )
          })()}
        </div>
      </div>
    )
  }

  // ── 阅读视图 ──
  const allAnnos = chapter?.annotations || []
  // 回复挂在被回复的那条下面，不另画一道划线；被回复的那条删了的，回复自己当一条
  const annoIds = new Set(allAnnos.map((a) => a.id))
  const annos = allAnnos.filter((a) => a.parent_id == null || !annoIds.has(a.parent_id))
  const repliesOf = (id) => allAnnos.filter((a) => a.parent_id === id)
  const starBtn = (a) => (
    <button className={'bookread-star-btn' + (a.starred_by ? ' on' : '')} onClick={(e) => { e.stopPropagation(); toggleStar(a) }}
      aria-label={a.starred_by ? '取下书签' : '夹书签'} title={a.starred_by ? `${a.starred_by}夹的书签，点一下取下` : '夹个书签'}>
      {a.starred_by ? '已夹' : '夹书签'}
    </button>
  )
  const renderThread = (a) => (
    <div className="bookread-anno-thread" onClick={(e) => e.stopPropagation()}>
      {repliesOf(a.id).map((r) => (
        <div key={r.id} className="bookread-anno-reply">
          <span className="coread-anno-author">{r.author}</span>
          <span className="coread-anno-note">{r.note}</span>
          <button className="coread-anno-del" onClick={() => removeAnno(r.id)} aria-label="删掉这条回复">✕</button>
        </div>
      ))}
      <div className="bookread-anno-reply-box">
        <input value={replyDraft[a.id] || ''} placeholder="回一句……"
          onChange={(e) => setReplyDraft((d) => ({ ...d, [a.id]: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') sendReply(a) }} />
        <button onClick={() => sendReply(a)} disabled={!(replyDraft[a.id] || '').trim()}>回</button>
      </div>
    </div>
  )
  // 中英对照：alt[k] 挂在中文第 k 段末尾。只中文就不切；只英文另画一份，不带划线
  const altArr = Array.isArray(chapter?.alt) ? chapter.alt : null
  const bilingual = !!altArr && altArr.some(Boolean)
  const viewLang = bilingual ? langMode : 'zh'
  const paraEndList = chapter && viewLang === 'both' ? paragraphEnds(chapter.content) : []
  const paraEndIdx = new Map(paraEndList.map((e, k) => [e, k]))
  const segs = chapter ? buildSegments(chapter.content, annos, paraEndList) : []
  const renderSegs = (paged) => segs.map((s) => {
    const k = paraEndIdx.get(s.start + s.text.length)
    const alt = k != null && altArr[k] ? (
      <span
        key={'alt' + k}
        className={'bookread-alt' + (altEdit?.k === k ? ' editing' : '')}
        data-alt={altArr[k]}
        onClick={(event) => { event.stopPropagation(); setAltEdit(altEdit?.k === k ? null : { k }) }}
      />
    ) : null
    const body = s.annos.length ? (
      <mark
        key={s.start}
        className="bookread-mark"
        style={{ backgroundColor: (COLOR_HEX[s.annos[0].color] || '#f5d76e') + '66', borderBottom: `2px solid ${COLOR_HEX[s.annos[0].color] || '#f5d76e'}` }}
        onClick={(event) => { if (paged) event.stopPropagation(); jumpToAnno(s.annos[0].id) }}
      >{s.text}</mark>
    ) : <span key={s.start}>{s.text}</span>
    return alt ? [body, alt] : body
  })
  const englishOnly = viewLang === 'en'
    ? altArr.map((t, k) => t ? <span key={k} className="bookread-alt-only">{t + '\n\n'}</span> : null)
    : null
  const excerptLayout = excerptCard ? excerptCardTextLayout(excerptCard.quote, excerptCard.note) : null

  return (
    <div className="roost-overlay bookread-reader-overlay" onClick={onClose}>
      <div className={`roost-modal coread-modal coread-reader coread-reader-fullscreen${readerChromeVisible ? '' : ' coread-reader-chrome-hidden'}`} onClick={(e) => { e.stopPropagation(); if (readingMode === 'page') setFocusAnno(null) }}>
        <div className="roost-modal-header">
          <button className="coread-back" onClick={() => { peekRef.current = false; setPeekFrom(null); setActive(null); setChapter(null); setPending(null); setComposing(false) }}>‹ 书架</button>
          <span className="coread-reader-title">{active.title}</span>
          <div className="bookread-header-actions">
            {bilingual && (
              <button className="bookread-mode-toggle" onClick={() => {
                const next = { both: 'zh', zh: 'en', en: 'both' }[langMode] || 'both'
                setLangMode(next); setAltEdit(null); setPending(null)
                try { localStorage.setItem('bookread-lang', next) } catch { /* 记不住就每次双语 */ }
              }} title="中英对照 / 只中文 / 只英文">
                {{ both: '中英', zh: '中', en: 'EN' }[langMode] || '中英'}
              </button>
            )}
            <button className="bookread-mode-toggle" onClick={switchReadingMode} title="切换阅读模式">
              {readingMode === 'page' ? '翻页' : '滚动'}
            </button>
            <button className="roost-modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        {readingSummary && (() => {
          const maxSeconds = Math.max(60, ...readingSummary.days.map((item) => item.seconds))
          return (
            <div
              className="bookread-reading-summary"
              aria-label={`今日阅读 ${formatReadingTime(readingSummary.todaySeconds)}，近七天共 ${formatReadingTime(readingSummary.weekSeconds)}`}
            >
              <span className="bookread-reading-today">今日 <strong>{formatReadingTime(readingSummary.todaySeconds)}</strong></span>
              <span className="bookread-reading-divider" aria-hidden="true" />
              <span>近 7 天 {formatReadingTime(readingSummary.weekSeconds)}</span>
              <span className="bookread-reading-spark" aria-hidden="true">
                {readingSummary.days.map((item) => (
                  <i key={item.day} style={{ height: `${Math.max(2, Math.round(item.seconds / maxSeconds * 18))}px` }} />
                ))}
              </span>
            </div>
          )
        })()}
        <div className={`roost-modal-body bookread-reader-body ${readingMode === 'page' ? 'bookread-body-page' : 'bookread-body-scroll'}`} ref={bodyRef} onScroll={onBodyScroll}>
          {loading && <div className="roost-empty">翻开书页……</div>}
          {!loading && chapter && (
            <>
              <div className="bookread-chapter-bar">
                <button disabled={chapter.idx <= 0} onClick={() => openChapter(active, chapter.idx - 1)}>‹ 上一章</button>
                <button className="bookread-chapter-name bookread-toc-trigger" onClick={toggleToc} title="目录">
                  {chapter.title || `第 ${chapter.idx + 1} 章`} <span className="bookread-toc-caret">{tocOpen ? '▴' : '▾'}</span>
                </button>
                <button disabled={chapter.idx >= chapterCount - 1} onClick={() => openChapter(active, chapter.idx + 1)}>下一章 ›</button>
              </div>
              {altEdit && (
                <div className="bookread-alt-bar" onClick={(e) => e.stopPropagation()}>
                  <span>这段英文配错了？</span>
                  <button onClick={() => moveAlt(-1)}>↑ 头一段挪给上面</button>
                  <button onClick={() => moveAlt(1)}>↓ 末一段挪给下面</button>
                  <button onClick={() => setAltEdit(null)}>好了</button>
                </div>
              )}
              {tocOpen && (
                <div className="bookread-toc">
                  {!toc && <div className="roost-empty">翻目录……</div>}
                  {tocErr && <div className="roost-empty">{tocErr}</div>}
                  {toc && !toc.length && !tocErr && <div className="roost-empty">目录是空的？点章节名再试一次</div>}
                  {toc && toc.map((c) => (
                    <button
                      key={c.idx}
                      className={'bookread-toc-item' + (c.idx === chapter.idx ? ' active' : '')}
                      onClick={() => { setTocOpen(false); if (c.idx !== chapter.idx) openChapter(active, c.idx) }}
                    >
                      <span className="bookread-toc-title">{c.title || `第 ${c.idx + 1} 章`}</span>
                      {c.chars != null && <span className="bookread-toc-chars">{c.chars > 10000 ? (c.chars / 10000).toFixed(1) + '万字' : c.chars + '字'}</span>}
                    </button>
                  ))}
                </div>
              )}
              {readingMode === 'page' ? (
                <>
                  <div
                    className="bookread-page-viewport"
                    ref={pageViewportRef}
                    onTouchStart={onPageTouchStart}
                    onTouchEnd={onPageTouchEnd}
                    onTouchCancel={() => { touchStartRef.current = null; lastPageSwipeAtRef.current = Date.now() }}
                    onClick={() => { if (!focusAnno) toggleReaderChrome() }}
                    title={readerChromeVisible ? '轻触隐藏菜单' : '轻触显示菜单'}
                  >
                    <div
                      className="bookread-text bookread-text-paged"
                      ref={textRef}
                      data-lang={viewLang}
                      style={{ transform: `translate3d(${-pageIndex * pageWidth}px, 0, 0)` }}
                    >
                      {englishOnly || renderSegs(true)}
                    </div>
                  </div>
                  <div className="bookread-page-footer">
                    <button onClick={() => turnPage(-1)} aria-label="上一页">‹</button>
                    <button className="bookread-page-tool" onClick={openStars}>书签</button>
                    <span>{pageIndex + 1} / {pageCount}</span>
                    <button className="bookread-page-tool" onClick={toggleStamp}>{stamps.some((s) => s.reader === '阿颖') ? '读讫 ✓' : '读讫'}</button>
                    <button className="bookread-page-tool bookread-page-chat" onClick={() => setChatOpen(true)} aria-label="打开随读随聊">聊</button>
                    <button onClick={() => turnPage(1)} aria-label="下一页">›</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="bookread-text" ref={textRef} data-lang={viewLang}>
                    {englishOnly || renderSegs(false)}
                  </div>
                  <div className="bookread-foot">
                    <button className="roost-btn roost-btn-ghost roost-btn-sm" onClick={openStars}>书签</button>
                    <button
                      className={'roost-btn roost-btn-ghost roost-btn-sm' + (stamps.some((s) => s.reader === '阿颖') ? ' bookread-stamped' : '')}
                      onClick={toggleStamp}
                    >
                      {stamps.some((s) => s.reader === '阿颖') ? '读讫 ✓' : '盖读讫章'}
                    </button>
                    <span className="bookread-foot-hint">长按选中文字，可做书摘卡或划线</span>
                  </div>
                  {annos.length > 0 && (
                    <div className="bookread-anno-list">
                      <div className="roost-card-label" style={{ marginBottom: 8 }}>划线与批注</div>
                      {annos.map((a) => (
                        <div
                          key={a.id}
                          ref={(el) => { annoRefs.current[a.id] = el }}
                          className={'bookread-anno-card' + (focusAnno === a.id ? ' focus' : '')}
                          style={{ borderLeftColor: COLOR_HEX[a.color] || '#f5d76e' }}
                        >
                          <div className="bookread-anno-quote">「{a.quote}」</div>
                          <div className="bookread-anno-row">
                            <span className="coread-anno-author">{a.author}</span>
                            <span className="coread-anno-note">{a.note || '（划线）'}</span>
                            {starBtn(a)}
                            <button className="bookread-card-link" disabled={savingCard} onClick={() => openExcerptCard(a.quote, a.note)}>书摘卡</button>
                            <button className="coread-anno-del" onClick={() => removeAnno(a.id)}>✕</button>
                          </div>
                          {renderThread(a)}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {chatOpen && (
          <section className="bookread-chat-panel" onClick={(e) => e.stopPropagation()} aria-label="随读随聊">
            <div className="bookread-chat-head">
              <span>和涟言聊这一章</span>
              <button onClick={() => setChatOpen(false)} aria-label="收起随读随聊">✕</button>
            </div>
            <div className="bookread-chat-stream">
              {chatLoading && <div className="roost-empty">翻聊天记录……</div>}
              {!chatLoading && chatMessages.length === 0 && <div className="bookread-chat-empty">想到什么就说，涟言看得到你正在读的这一段。</div>}
              {chatMessages.map((m) => (
                <div key={m.id} className={'coread-msg ' + (m.role === 'user' ? 'mine' : 'hers')}>
                  <div className="coread-msg-role">{m.role === 'user' ? '阿颖' : '涟言'}</div>
                  <div className="coread-bubble">{m.content}</div>
                </div>
              ))}
              {chatSending && <div className="bookread-chat-thinking">涟言在想……</div>}
              <div ref={chatEndRef} />
            </div>
            <div className="bookread-chat-compose">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBookChat() } }}
                placeholder="聊聊正在读的这一段……"
                rows={2}
                disabled={chatSending}
              />
              <button onClick={sendBookChat} disabled={chatSending || !chatInput.trim()}>发送</button>
            </div>
          </section>
        )}
        {!chatOpen && chapter && !pending && readingMode === 'scroll' && (
          <button className="bookread-chat-fab" onClick={() => setChatOpen(true)} aria-label="打开随读随聊" title="和涟言聊这一页">随读</button>
        )}

        {readingMode === 'page' && focusAnno != null && annos.some(a => a.id === focusAnno) && (
          <section className="bookread-annotation-popover" role="dialog" aria-label="划线批注" onClick={e => e.stopPropagation()}>
            <button className="roost-modal-close" aria-label="关闭批注" onClick={() => setFocusAnno(null)}>✕</button>
            {annos.filter(a => a.id === focusAnno).map(a => <div key={a.id}>
              <div className="bookread-anno-quote">「{a.quote}」</div>
              <p>{a.note || '（仅划线，暂无批注）'}</p>
              <small>{a.author}</small>
              {starBtn(a)}
              <button className="bookread-card-link" onClick={() => openExcerptCard(a.quote, a.note)}>书摘卡</button>
              {renderThread(a)}
            </div>)}
          </section>
        )}
        {peekFrom && (
          <button className="bookread-peek-back" onClick={(e) => { e.stopPropagation(); const p = peekFrom; openChapter(active, p.ch ?? 0, p.ch != null ? p : null) }}>
            ↩ 回到读到的地方（第 {(peekFrom.ch ?? 0) + 1} 章）
          </button>
        )}
        {starOpen && (
          <div className="bookread-echo-sheet" onClick={() => setStarOpen(false)}>
            <section onClick={(e) => e.stopPropagation()} aria-label="书签">
              <div className="bookread-echo-head">
                <strong>书签</strong>
                <button onClick={() => setStarOpen(false)} aria-label="关上">✕</button>
              </div>
              {/* 1029 她截图：底栏「书签」原来是「读到哪儿」，跟好句子书签撞名。合成一个入口：上面夹读到哪儿，下面是好句子 */}
              <button className="roost-btn roost-btn-ghost" style={{ width: '100%', margin: '4px 0 10px' }} onClick={() => { markBookmark(); setStarOpen(false) }}>把「读到这儿」夹在这一章</button>
              <div className="bookread-echo-where" style={{ marginBottom: 2 }}>夹起来的好句子（批注旁边点小缎带就能夹）</div>
              {starred === null && <div className="roost-empty">翻书签……</div>}
              {starred?.length === 0 && <div className="roost-empty">还没夹过书签。点批注旁边的小书签，喜欢的句子就收在这儿。</div>}
              {starred?.map((a) => (
                <div key={a.id} className="bookread-echo-item">
                  <div className="bookread-echo-where">{a.chapter_title || `第 ${a.chapter_idx + 1} 章`} · {a.starred_by}夹的</div>
                  <div className="bookread-anno-quote">「{a.quote}」</div>
                  {a.note && <div className="bookread-echo-line"><span className="coread-anno-author">{a.author}</span>{a.note}</div>}
                  {a.replies?.map((r) => <div key={r.id} className="bookread-echo-line mine"><span className="coread-anno-author">{r.author}</span>{r.note}</div>)}
                  <button className="bookread-card-link" onClick={() => goToStar(a)}>翻到那儿</button>
                </div>
              ))}
            </section>
          </div>
        )}
        {excerptCard && (
          <div className="bookread-card-editor-backdrop" onClick={closeExcerptCard}>
            <section className="bookread-card-editor" onClick={(event) => event.stopPropagation()} aria-label="制作书摘卡">
              <div className="bookread-card-editor-head">
                <div>
                  <strong>书摘卡</strong>
                  <span>从相册选一张，只用于这一次</span>
                </div>
                <button onClick={closeExcerptCard} aria-label="关闭书摘卡编辑">✕</button>
              </div>
              <div className="bookread-card-preview" style={{ '--excerpt-accent': active.cover_color || '#6f8274' }}>
                <div
                  className={'bookread-card-preview-image' + (excerptCard.imageDataUrl ? ' has-image' : '')}
                  style={excerptCard.imageDataUrl ? { backgroundImage: `url(${excerptCard.imageDataUrl})` } : undefined}
                >
                  <span>书摘</span>
                </div>
                <div className="bookread-card-preview-paper">
                  <div className="bookread-card-preview-quote">{excerptCard.quote}</div>
                  {excerptCard.note && excerptLayout?.noteLineLimit > 0 && (
                    <div className="bookread-card-preview-note" style={{ '--excerpt-note-lines': excerptLayout.noteLineLimit }}>{excerptCard.note}</div>
                  )}
                  <div className="bookread-card-preview-source">
                    {[active.author, active.title ? `《${active.title}》` : '', chapter.title || `第 ${chapter.idx + 1} 章`].filter(Boolean).join(' · ')}
                  </div>
                  <div className="bookread-card-preview-foot">
                    <small>言叽书架摘录</small>
                    {readingSummary && <small>本书近 7 天已读 {formatReadingTime(readingSummary.weekSeconds)}</small>}
                  </div>
                </div>
              </div>
              <input ref={cardImageRef} type="file" accept="image/*" hidden onChange={chooseExcerptImage} />
              <div className="bookread-card-editor-actions">
                <button className="roost-btn roost-btn-ghost" disabled={savingCard || cardImageLoading} onClick={() => cardImageRef.current?.click()}>
                  {cardImageLoading ? '处理图片中…' : excerptCard.imageDataUrl ? '换一张图片' : '从相册选图片'}
                </button>
                <button className="roost-btn" disabled={savingCard || cardImageLoading} onClick={saveExcerptCard}>
                  {savingCard ? '生成中…' : '保存 PNG'}
                </button>
              </div>
            </section>
          </div>
        )}

        {/* 选中文字 → 浮出划线入口 */}
        {pending && !composing && (
          <div className={`bookread-pending${pending.above ? ' bookread-pending-above' : ''}`} onPointerDown={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}>
            <span className="bookread-pending-quote">「{pending.quote.length > 24 ? pending.quote.slice(0, 24) + '…' : pending.quote}」</span>
            <div className="bookread-pending-actions">
              <button className="roost-btn roost-btn-ghost roost-btn-sm" onClick={() => { setPending(null); window.getSelection()?.removeAllRanges() }}>取消</button>
              <button className="roost-btn roost-btn-ghost roost-btn-sm" disabled={savingCard} onClick={() => openExcerptCard(pending.quote)}>书摘卡</button>
              <button className="roost-btn roost-btn-sm" onClick={() => setComposing(true)}>划线批注</button>
            </div>
          </div>
        )}

        {/* 批注浮层（复用共读样式） */}
        {pending && composing && (
          <div className="coread-anno-compose" onClick={(e) => e.stopPropagation()}>
            <div className="bookread-anno-quote">「{pending.quote.length > 60 ? pending.quote.slice(0, 60) + '…' : pending.quote}」</div>
            <div className="coread-color-row">
              {COLORS.map((c) => (
                <button
                  key={c.id}
                  className={'coread-color-dot' + (annoColor === c.id ? ' active' : '')}
                  style={{ background: c.hex }}
                  onClick={() => setAnnoColor(c.id)}
                />
              ))}
              <div className="bookread-author-toggle">
                {['阿颖', '涟言'].map((who) => (
                  <button key={who} className={annoAuthor === who ? 'active' : ''} onClick={() => setAnnoAuthor(who)}>{who}</button>
                ))}
              </div>
            </div>
            <textarea
              className="coread-anno-input"
              placeholder="写一句批注（留空＝纯划线）……"
              value={annoNote}
              onChange={(e) => setAnnoNote(e.target.value)}
              rows={2}
              autoFocus
            />
            <div className="coread-anno-actions">
              <button className="roost-btn roost-btn-ghost roost-btn-sm" onClick={() => { setPending(null); setComposing(false); window.getSelection()?.removeAllRanges() }}>取消</button>
              <button className="roost-btn roost-btn-sm" onClick={submitAnno}>留下</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
