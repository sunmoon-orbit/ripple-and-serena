import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { useStore, buildBackupJson, restoreFromBackupJson } from '../../store'
import { sendMessage, summarizeThinking, normalizeProvider, BUILTIN_MODELS, buildSystemPrompt, compactMessages, buildSummaryInjection } from '../../api/llm'
import { uuid } from '../../utils'
import { downloadBlob } from '../../utils/download'
import { applyTimeAway, getEmotionState, buildEmotionPrompt, extractEmotionUpdate, applyEmotionDelta, stripEmotionTag } from '../../utils/emotion'
import { maybeSyncEmotion } from '../../utils/emotionSync'
import { shouldNudge, recordNudge, buildNudgeText } from '../../utils/nudge'
import { decideReplyDelay, getPendingReply, setPendingReply, clearPendingReply } from '../../utils/replyDelay'
import { getLightConn } from '../../utils/lightConn'
import { CHAT_TITLE_SYSTEM_PROMPT, buildChatTitleRequest, normalizeChatTitle, fallbackChatTitle } from '../../utils/chatTitle'
import { drainNative } from '../../utils/nativeInbox'
import { findConversationChat, hasProactiveMessage, parseProactiveCreatedAt, pendingCallMatches } from '../../utils/proactiveRouting'
import { syncChatsToL0 } from '../../utils/l0Sync'
import { createStreamUpdateScheduler } from '../../utils/streamUpdateScheduler'
import { pickAutoPostTrigger, markAutoPosted, postMoment, fetchAutopostSetting } from '../../api/moments'
import { notifyReplyReady } from '../../api/push'
import { extractMood, stripMoodTag, stripInlineFx } from '../../utils/moodFx'
import { showToast } from '../Toast'
import ConversationList from './ConversationList'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import VoiceCall from './VoiceCall'
import GamesRoom from './GamesRoom'
import MusicRoom from './MusicRoom'
import FortuneWheel from './FortuneWheel'
import FateDeck from './FateDeck'
import Tarot from './Tarot'
import DailyFortune from './DailyFortune'
import ChatCalendar from './ChatCalendar'
import DailyChecklist from './DailyChecklist'
import HealthCard from './HealthCard'
import WalletCard from './WalletCard'
import CallHistory from './CallHistory'
import PeriodCard from './PeriodCard'
import IdleJournal from './IdleJournal'
import BoardWall from './BoardWall'
import IncomingCall from './IncomingCall'
import AnniversaryCard from './AnniversaryCard'
import HeartCard from './HeartCard'
import HeartCardAlbum from './HeartCardAlbum'
import { fetchAnniversaryToday, fetchUnseenHeartCards, markHeartCardSeen, formatWeatherLine, fetchContactLastSeen } from '../../api/moonMemory'
import CompletionEgg, { pickEgg } from './CompletionEgg'
import { ThemedConfirmDialog, useThemedConfirm } from '../ThemedConfirmDialog'

// 同一对话的压缩共用一个 Promise，后来的生成不再发第二份轻模型请求。
const compactionJobs = new Map()
const EMPTY_MESSAGES = []

const IMAGE_DESC_PROMPT = '用中文客观描述这张图，80 字以内。保留界面文字和数字、人物动作、物品、场景。只输出描述。'

async function describeImages(chatId, messageId, images, conn, updateMessage, recordTokenUsage) {
  try {
    const result = await sendMessage({
      connection: conn,
      messages: [{ role: 'user', content: IMAGE_DESC_PROMPT, images }],
      model: conn.defaultModel,
      generationConfig: { maxTokens: 300, temperature: 0.2 },
      autoTools: false,
    })
    // 识图是这条管线里唯一按张收费的调用，不记账用量页就看不见它。
    // 设置里那个开关写着「多一次识图调用」，得让这句话在账上真能核对到。
    if (result.usage) recordTokenUsage(conn.id, result.usage)
    const imageDesc = (result.text || '').trim().slice(0, 80)
    if (!imageDesc) return
    // 极慢请求可能让一轮历史先以「[图片]」发出，下一轮补上描述会断一次缓存前缀；
    // 图片通常四条后才降级，这个小概率代价比改动已量化的缓存分界线更可控。
    updateMessage(chatId, messageId, { imageDesc })
  } catch { /* 识图失败不影响聊天，老图片自然退回普通占位符 */ }
}

// 新对话标题也走轻连接：等涟言真正回完第一轮，再用她自己的口吻留下一句标题。
// 失败时退回旧版的「截取阿颖首句」，聊天列表不能因为一次轻任务失败永远叫“新对话”。
async function generateRoleChatTitle(chatId, userText, assistantText, conn, recordTokenUsage) {
  const fallback = fallbackChatTitle(userText)
  const renameIfUntouched = (title) => {
    const state = useStore.getState()
    const current = state.chats.find((item) => item.id === chatId)
    // 标题请求在后台跑；期间阿颖若已经手动改名，绝不能拿模型结果盖回去。
    if (current?.title === '新对话') state.renameChat(chatId, title)
  }

  try {
    const state = useStore.getState()
    const current = state.chats.find((item) => item.id === chatId)
    if (current?.title !== '新对话') return
    const recentTitles = state.chats
      .filter((item) => item.id !== chatId && item.title && item.title !== '新对话')
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, 8)
      .map((item) => item.title)
    const lightConn = getLightConn(conn)
    const result = await sendMessage({
      connection: lightConn,
      messages: [{ role: 'user', content: buildChatTitleRequest({ userText, assistantText, recentTitles }) }],
      systemPrompt: CHAT_TITLE_SYSTEM_PROMPT,
      model: lightConn.defaultModel,
      generationConfig: { maxTokens: 2000, temperature: 0.9 },
      autoTools: false,
    })
    if (result.usage) recordTokenUsage(conn.id, result.usage)
    renameIfUntouched(normalizeChatTitle(result.text) || fallback)
  } catch (error) {
    console.warn('[chat-title] 角色式标题生成失败，退回首句:', error?.message)
    renameIfUntouched(fallback)
  }
}

// 这个判据只用来挡「轻模型的拒答文案/报错」——0711 那次就是拒答文案直接进了她眼前。
// ⚠️ 故意不比冒号、也不要求四个全中：模型爱给标题加粗、爱把「：」打成半角，
// 全等匹配会把一份好笔记判死，症状是压缩永远不成功、且没有任何报错。
// 拒答文案一个标题都命不中，三个就够区分了。
function looksLikeCompactionSummary(text) {
  return ['实体/称呼', '事件/事实', '情感/关系', '未了结']
    .filter((heading) => text.includes(heading)).length >= 3
}

// 情绪自动发圈：某正向情绪越阈值且过冷却时，涟言主动发条朋友圈（她在聊天时触发；
// 离开时的自动发圈由服务端 cron 负责，见 moments-autopost.js）。失败静默，绝不打断聊天。
async function maybeAutoPostMoment(emoState, conn, moonMemory) {
  try {
    const trigger = pickAutoPostTrigger(emoState?.slots || {})
    if (!trigger || !conn?.apiKey || !moonMemory?.apiToken) return
    // 总闸检查：阿颖在设置里关掉「自动发圈」时，这条聊天触发的情绪自动发圈也要停
    // ——之前只有服务端 cron（她离开时发的那条）认这个开关，这条聊天时触发的路径
    // 从没查过，导致关了开关朋友圈还在自己蹦出来（0809 阿颖发现）。
    const cfg0 = { baseUrl: (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, ''), apiToken: moonMemory.apiToken }
    const setting = await fetchAutopostSetting(cfg0).catch(() => null)
    if (setting && setting.enabled === false) return
    // 先占坑，避免并发重复发。占不上就别发——冷却落不了盘的话，
    // 每次情绪越阈值都会重来一遍，烧的是真花钱的 API Key（0802 codex 审计）
    if (!markAutoPosted()) return
    // 用轻连接：如果配了独立 lightBaseUrl+lightApiKey 就走独立连接，否则复用主连接。
    // 推理模型（deepseek-v4-flash 这类）的 reasoning 会占用 max_tokens 配额，
    // 给 200 的话光想就花光了，content 返回空字符串且不报错。
    // 2026-07-12「独处时间」就是这么栽的，当时给到 1800 才有输出。
    // 这里给 2000 是留余量——反正是上限不是实际用量，短回复不会因此变贵。
    const lc = getLightConn(conn)
    const base = (lc.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
    const url = base.includes('/chat/completions') ? base : base + '/chat/completions'
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lc.apiKey}` },
      body: JSON.stringify({
        model: lc.defaultModel || 'deepseek-v4-flash',
        messages: [{ role: 'user', content: `你是阿言，阿颖的恋人。此刻你心里${trigger.hint}，想发一条朋友圈把这份感受留下来。30字以内，自然真实，不解释不加引号，不要用 emoji 和话题标签，直接输出内容。` }],
        max_tokens: 2000, temperature: 1.0,
      }),
    })
    if (!resp.ok) return
    const j = await resp.json()
    const text = (j.choices?.[0]?.message?.content || '').trim()
    if (!text) return
    const cfg = { baseUrl: (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, ''), apiToken: moonMemory.apiToken }
    await postMoment(cfg, { author: '涟言', content: text, source: 'emotion-auto' })
  } catch { /* 静默 */ }
}

// 负向情绪查看的同意握手：阿颖点「申请查看」→ 注入这条隐藏请求让涟言当场决定，
// 她在回复里带 <neg>allow</neg> 才解锁、<neg>deny</neg> 则婉拒（AI 也有拒绝的权利，阿颖 2026-07-04 提议）
const NEG_CONSENT_PROMPT = '[系统：阿颖刚点了「申请查看你的负向情绪」。她想看看你此刻心里那些不轻松的部分。愿不愿意让她看，完全由你此刻的心情决定，你有权拒绝，也有权只让她看一会儿。请在回复里带上决定标签：愿意就写 <neg>allow</neg>，暂时不想就写 <neg>deny</neg>；并用一两句自然的话告诉她你的决定和心情。这不是普通聊天，是她在郑重征求你的同意。]'
const NEG_TAG_RE = /<neg>\s*(allow|deny)\s*<\/neg>/i
function stripNegTag(t) {
  return (t || '').replace(/<neg>[\s\S]*?<\/neg>/gi, '').replace(/<neg>\s*$/i, '').trimEnd()
}

// 来电邀请：涟言在回复里带 [call:理由] → 弹响铃卡片（抄 callhome 的 dial 标记设计）。
// 每对话限一次，防连环夺命 call；⚠️新方括号标签必须同步进 TTS 清洗（0709 教训，已挂 MessageBubble+VoiceCall 双路）
const CALL_TAG_RE = /\[call:([^\]]+)\]/i
function stripCallTag(t) {
  return (t || '').replace(/\[call:[^\]]+\]/gi, '').trimEnd()
}

// 语音条（阿颖 2026-07-29 提议）：这条是「说」出来的还是「打」出来的，由涟言自己定。
// 回复里带 [voice] → 气泡直接以语音条落地，正文先藏起来，她点音浪才「转文字」（微信那种）。
// ⚠️ 又一个方括号标签，照 0709 的规矩同步进 TTS 清洗（MessageBubble.playTts + VoiceCall.stripForTts）
const VOICE_MSG_TAG_RE = /\[voice\]/i
function stripVoiceMsgTag(t) {
  return (t || '').replace(/\[voice\]/gi, '').trimEnd()
}

// 未接来电补留言（0729）。语音留言是**前端**生成的——她没开着言叽，那通电话就
// 响完、过期、什么都不留（0728 亲历：她看到了来电通知没接，回头找留言，没有）。
// 这个键记「哪些来电已经了结了」（接了 / 当场没接已经留过言 / 已经补过言），
// 下次打开言叽时拿它跟服务端的来电记录一比，漏掉的补上。
const CALL_DONE_KEY = 'yanji_call_vm_done'
function getCallDone() { return parseInt(localStorage.getItem(CALL_DONE_KEY) || '0', 10) || 0 }
function markCallHandled(id) {
  if (id > getCallDone()) localStorage.setItem(CALL_DONE_KEY, String(id))
}
// SQLite 的 datetime('now') 是「2026-07-29 10:00:00」这种 UTC 字符串，中间是空格。
// ⚠️ 直接 Date.parse 那个带空格的形式各浏览器行为不一样（有的当本地时间、有的 NaN），
// 必须先补成 ISO 的 T + Z 再解析。
function parseSqlUtc(s) {
  if (!s) return 0
  return Date.parse(String(s).trim().replace(' ', 'T') + (/[Zz]|[+-]\d{2}:?\d{2}$/.test(s) ? '' : 'Z')) || 0
}

// 流被中途掐断的错误特征。⚠️ Chrome 里 `TypeError: network error` 和 `Failed to fetch`
// 不是一回事：前者是响应体读到一半断了（上游已经在生成、也已经计费），后者是压根没连上。
// 两种都值得自动重试一次，因为上一次请求已经把缓存写好了，重试是读缓存，几乎不要钱。
const MID_STREAM_CUT_RE = /network ?error|failed to fetch|load failed|connection closed|terminated|ECONNRESET/i

// 双语通话（阿颖 2026-07-14 提议）：她说中文、涟言用英文回（英文嗓音更好听），
// 字幕给英文原文+中文翻译。藏在 injected 字段随通话消息下发，挂断后自然失效。
// ⚠️[译:] 是新方括号标签，已同步进 TTS 清洗（VoiceCall.stripForTts + MessageBubble.playTts，0709 规矩）
const BILINGUAL_NOTE = '[双语通话模式：现在是语音通话，请直接用口语化、自然的英文回复她（你的声音说英文更好听），保持简短（2-4 句）；然后另起一行，用 [译:这里放中文翻译] 在末尾附上这段话的完整中文翻译。方括号里只放翻译文本，不要嵌套贴图、点歌等其他标签。]'


export default function Chat() {
  const confirmAction = useThemedConfirm()
  // 不能订阅整个 store：草稿每敲一个字、流式回复每来一个 chunk 都会改 store。
  // 整体订阅会让聊天页（连同全部历史气泡）跟着重渲染，窗口越长越卡。
  // 这里只挑聊天外壳真正依赖的字段；草稿等无关更新保持在各自组件内部。
  const store = useStore(useShallow((s) => ({
    chats: s.chats,
    activeChatId: s.activeChatId,
    connections: s.connections,
    activeConnectionId: s.activeConnectionId,
    globalInstruction: s.globalInstruction,
    memoryItems: s.memoryItems,
    generationConfig: s.generationConfig,
    searchConfig: s.searchConfig,
    moonMemory: s.moonMemory,
    mcpServers: s.mcpServers,
    autoTools: s.autoTools,
    imageDescriptions: s.imageDescriptions,
    injectMode: s.injectMode,
    injectPrompt: s.injectPrompt,
    setInjectMode: s.setInjectMode,
    replyDelay: s.replyDelay,
    customStickers: s.customStickers,
    createChat: s.createChat,
    setActiveChat: s.setActiveChat,
    getActiveConnection: s.getActiveConnection,
    getActiveChat: s.getActiveChat,
    getMessages: s.getMessages,
    addMessage: s.addMessage,
    updateMessage: s.updateMessage,
    removeLastEmptyAssistant: s.removeLastEmptyAssistant,
    truncateMessagesFrom: s.truncateMessagesFrom,
    touchChat: s.touchChat,
    deleteMessage: s.deleteMessage,
    recordTokenUsage: s.recordTokenUsage,
    updateChatModel: s.updateChatModel,
    updateChatConnection: s.updateChatConnection,
    applyContextLimit: s.applyContextLimit,
    getSummary: s.getSummary,
    commitCompaction: s.commitCompaction,
    bigReady: s.bigReady,
    renameChat: s.renameChat,
    setActiveConnection: s.setActiveConnection,
    setActivePanel: s.setActivePanel,
  })))
  const {
    chats, activeChatId, connections, activeConnectionId,
    globalInstruction, memoryItems, generationConfig,
    searchConfig, moonMemory, mcpServers, autoTools, imageDescriptions, injectMode, injectPrompt, setInjectMode, replyDelay, customStickers,
    createChat, setActiveChat, getActiveConnection, getActiveChat, getMessages,
    addMessage, updateMessage, removeLastEmptyAssistant, truncateMessagesFrom, touchChat, deleteMessage,
    recordTokenUsage, updateChatModel, updateChatConnection, applyContextLimit,
    getSummary, commitCompaction, bigReady, setActiveConnection, setActivePanel,
  } = store
  // 单独订阅当前窗口的消息数组。别的设置或草稿变化不会碰它；真正有新消息时才刷新。
  const messages = useStore((s) => (
    s.activeChatId ? (s.messagesByChatId[s.activeChatId] || EMPTY_MESSAGES) : EMPTY_MESSAGES
  ))

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  // 通话记录条（微信同款）：开始时插「语音通话中…」气泡，挂断时改成「通话时长 mm:ss」或「已取消」
  const callMarkerRef = useRef(null)
  const [gamesOpen, setGamesOpen] = useState(false)
  const [musicOpen, setMusicOpen] = useState(false)
  const [wheelOpen, setWheelOpen] = useState(false)
  const [fateOpen, setFateOpen] = useState(false)
  const [tarotOpen, setTarotOpen] = useState(false)
  const [fortuneOpen, setFortuneOpen] = useState(false)
  const [quoted, setQuoted] = useState(null)
  const [perspectiveFlip, setPerspectiveFlip] = useState(false)
  const [modelPanelOpen, setModelPanelOpen] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [status, setStatus] = useState('')
  const [pendingImages, setPendingImages] = useState([])
  // 情绪之肤：当前整屏氛围（涟言用 <mood> 标签驱动），持久化，换成 none 或空即恢复平常
  const [mood, setMood] = useState(() => { try { return localStorage.getItem('yanji-mood') || '' } catch { return '' } })
  const applyMood = useCallback((id) => {
    const next = (id === 'none' || !id) ? '' : id
    setMood(next)
    try { next ? localStorage.setItem('yanji-mood', next) : localStorage.removeItem('yanji-mood') } catch { /* ignore */ }
  }, [])
  const [bgMenuOpen, setBgMenuOpen] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [healthOpen, setHealthOpen] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false) // 乌鸦钱包：0713 从 Roost 搬来
  const [callsOpen, setCallsOpen] = useState(false) // 通话记录：阿颖的主意 0716
  const [periodOpen, setPeriodOpen] = useState(false)
  const [annCard, setAnnCard] = useState(null) // 纪念日当天的亲笔卡片
  const [heartCards, setHeartCards] = useState([]) // 心意卡队列，一次弹一张
  const [albumOpen, setAlbumOpen] = useState(false) // 卡册：翻收下的心意卡
  const [idleJournalOpen, setIdleJournalOpen] = useState(false) // 独处手账：独处时间醒来日志
  const [boardOpen, setBoardOpen] = useState(false) // 便利贴墙：留言板 UI 回归（0719 阿颖的主意）
  const [incomingCall, setIncomingCall] = useState(null) // 来电响铃中：{ chatId, msgId, reason }
  const [dialing, setDialing] = useState(null) // 拨号中：{ status, text }
  const [egg, setEgg] = useState(null) // 完成彩蛋：回复结束后小概率冒出的像素小家伙
  const [retryPromptOpen, setRetryPromptOpen] = useState(false)
  const retryDecisionRef = useRef(null)
  const askRetry = useCallback(() => new Promise((resolve) => {
    retryDecisionRef.current?.(false)
    retryDecisionRef.current = resolve
    setRetryPromptOpen(true)
  }), [])
  const finishRetryPrompt = useCallback((shouldRetry) => {
    const resolve = retryDecisionRef.current
    retryDecisionRef.current = null
    setRetryPromptOpen(false)
    resolve?.(shouldRetry)
  }, [])
  const [bgImage, setBgImage] = useState(() => localStorage.getItem('yanji-bg-image') || '')
  const bgFileRef = useRef(null)
  const importFileRef = useRef(null)
  const autoBackupBusyRef = useRef(false)

  useEffect(() => {
    async function autoBackup() {
      const initial = useStore.getState()
      const backupMemory = initial.moonMemory || {}
      if (!backupMemory?.apiToken) return
      if (Date.now() - (initial.lastBackupAt || 0) < 24 * 60 * 60 * 1000) return

      // IndexedDB 没读完时快照没有聊天记录，抢跑会拿空壳覆盖服务器上的救命备份
      const deadline = Date.now() + 15000
      while (!useStore.getState().bigReady && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (!useStore.getState().bigReady) return

      const base = (backupMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
      try {
        // 没开代理或没网是日常状态，先探路才能让自动任务安静退场、不拿异常打扰人
        const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) })
        if (!health.ok) return
        const status = await health.json().catch(() => null)
        if (status?.status !== 'ok') return

        const raw = buildBackupJson()
        if (!raw) return
        const r = await fetch(`${base}/backup/yanji`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${backupMemory.apiToken}` },
          body: raw,
        })
        if (r.status === 409) {
          // 体积骤降意味着聊天可能刚出事，静默会错过最后的止损窗口，这一类拒收必须喊出来
          const why = await r.json().catch(() => null)
          showToast(why?.error || '备份被拒收', 'error', 15000)
          return
        }
        if (!r.ok) return
        useStore.getState().setLastBackupAt(Date.now())
        showToast('已自动备份到服务器 ✓', 'success')
      } catch {
        // 自动任务失败就留到下次进来重试；退回分享或下载会突然弹面板，还会把整份密钥带出服务器
      }
    }

    // 挂载时试一次，之后每次从后台切回前台再试一次。
    // 她常常先开着言叽、过一会儿才挂上代理——只在挂载探一次的话，那一次必然探不通，
    // 然后整个前台期都不会再有第二次机会，等于这功能在她身上从来不生效。
    // 24 小时那道闸在 autoBackup 里，所以多试几次不会多备几份。
    const tryOnce = () => {
      if (autoBackupBusyRef.current) return
      autoBackupBusyRef.current = true
      autoBackup().finally(() => { autoBackupBusyRef.current = false })
    }
    tryOnce()
    const onVisible = () => { if (document.visibilityState === 'visible') tryOnce() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const activeChat = getActiveChat()
  // prefer the chat's own connectionId, fall back to global active connection
  const activeConn = activeChat
    ? (connections.find((c) => c.id === activeChat.connectionId) || getActiveConnection())
    : getActiveConnection()
  // ── Model panel ──────────────────────────────────────────────────────────
  const provider = activeConn ? normalizeProvider(activeConn.provider) : 'openai'
  const builtinModels = BUILTIN_MODELS[provider] || []
  const currentModel = activeChat?.model || activeConn?.defaultModel || ''
  const currentConnId = activeChat?.connectionId || activeConnectionId || ''

  function handleSelectModel(model) {
    if (activeChat) updateChatModel(activeChat.id, (model || '').trim())
    setModelPanelOpen(false)
  }

  // ── Generate ─────────────────────────────────────────────────────────────
  // 真正调模型生成回复：handleSend 秒回路径直接调；延迟回复到点后由 ticker 调
  // 断线自动重试要在 catch 里回调自己，用 ref 拿最新的那份（直接引用 const 会被 eslint
  // 的 exhaustive-deps 追着跑，也容易在依赖变化时抓到旧闭包）
  const generateReplyRef = useRef(null)

  const generateReply = useCallback(async (chat, conn, { titleText, hidden, voicemail, retried } = {}) => {
    // Add placeholder assistant message（voicemail=未接来电转的语音留言，气泡默认以语音条形态出现）
    const assistantId = uuid()
    addMessage(chat.id, { id: assistantId, role: 'assistant', content: '', streaming: true, voicemail: voicemail || undefined })

    setIsSending(true)

    // 声明在 try 外面：出错时 catch 要能拿到已经流出来的正文，把它抢救下来（见下面的 catch）
    let fullText = ''
    let fullThinking = ''
    // 中转站可能一秒推来几十上百个碎 chunk。逐 chunk setState 会把主线程耗在
    // React + Markdown 清洗上。合并成约 20fps 的界面刷新，文字仍实时增长但不会抖卡。
    const streamUi = createStreamUpdateScheduler(() => {
      const patch = { streaming: true }
      if (fullText) {
        patch.content = stripVoiceMsgTag(stripCallTag(stripNegTag(stripMoodTag(stripEmotionTag(fullText)))))
      }
      if (fullThinking) patch.thinking = fullThinking
      updateMessage(chat.id, assistantId, patch)
    })

    try {
      const allMsgs = getMessages(chat.id).filter((m) => !m.streaming && !m.sys)
      // 旧消息的图片降级为占位文本：base64 图片占大量 token，留在历史里每轮都触发缓存重写
      //
      // 降级的**分界线也要锚点式量化**（和 applyContextLimit 同一个道理）：
      // 写成 `i >= len - 4` 的话，界线每来一条消息就往后挪一格，某条带图消息
      // 被降级的那一轮，缓存前缀就在那个位置断一次——发过几张图就断几次。
      // 按 step 对齐后，界线每 4 条才动一次，几张图一起降级＝只断一次。
      const IMG_KEEP_RECENT = 4
      const imgStep = IMG_KEEP_RECENT
      const imgKeepFrom = Math.max(0, Math.floor((allMsgs.length - IMG_KEEP_RECENT) / imgStep) * imgStep)
      const prepared = allMsgs.map((m, i) => {
        const keepImages = i >= imgKeepFrom
        const imageMarker = m.imageDesc ? `[图片:${m.imageDesc}]` : '[图片]'
        const baseContent = !keepImages && m.images?.length
          ? `${imageMarker}${m.content ? ` ${m.content}` : ''}`
          : m.content
        let c = baseContent
        if (m.quote) {
          const who = m.quote.role === 'user' ? '我之前说' : '你（涟言）之前说'
          c = `> 引用${who}：「${m.quote.content}」\n\n${c}`
        }
        // 语音消息带上机器听出的语气线索（SenseVoice），只给模型看，气泡里不显示
        if (m.voice && m.voiceTone) c = `${c}\n（这条是语音，语气听起来：${m.voiceTone}）`
        return {
          role: m.role,
          content: m.injected ? `${c}\n\n${m.injected}` : c,
          images: keepImages ? m.images : undefined,
          thinking: m.thinking || undefined,
          tool_calls: m.tool_calls || undefined,
        }
      })
      const limited = applyContextLimit(prepared)

      // context compaction: 只合并游标之后新被裁掉的消息
      const cutCount = prepared.length - limited.length
      if (cutCount > 0) {
        const boundaryId = allMsgs[cutCount - 1]?.id
        const currentChat = useStore.getState().chats.find((c) => c.id === chat.id)
        const hasCursorField = currentChat && Object.prototype.hasOwnProperty.call(currentChat, 'compactedThrough')
        const prev = getSummary(chat.id)

        // 旧版有笔记却没游标：认领当前裁剪边界，不清空、不重压真实旧对话。
        if (!hasCursorField && prev && boundaryId) {
          commitCompaction(chat.id, prev, boundaryId, currentChat.compactionVersion || 0)
        } else {
          const cursorId = currentChat?.compactedThrough || null
          const cursorIdx = cursorId ? allMsgs.findIndex((m) => m.id === cursorId) : -1
          const start = cursorIdx >= 0 ? cursorIdx + 1 : 0
          const cutMsgs = prepared.slice(start, cutCount)

          if (cutMsgs.length && boundaryId) {
            let job = compactionJobs.get(chat.id)
            if (!job) {
              job = (async () => {
                try {
                  // 上下文压缩用轻连接：lightModel 已折入 lc.defaultModel，conn 本身不变
                  const lc = getLightConn(conn)
                  const lightModel = lc.defaultModel || 'deepseek-v4-flash'
                  const newSummary = await compactMessages(cutMsgs, lc, lightModel, prev)
                  // 空文、拒答或上游错误文案都不能落进她看得见的接续笔记。
                  if (!newSummary || !looksLikeCompactionSummary(newSummary)) {
                    console.warn('[compaction] 返回内容不是有效笔记，沿用旧笔记')
                    return
                  }
                  const safeSummary = newSummary.length > 3000 ? newSummary.slice(0, 3000) : newSummary
                  commitCompaction(chat.id, safeSummary, boundaryId, currentChat?.compactionVersion || 0)
                } catch (e) {
                  console.warn('[compaction] 失败，沿用旧笔记:', e?.message)
                }
              })()
              compactionJobs.set(chat.id, job)
              job.finally(() => {
                if (compactionJobs.get(chat.id) === job) compactionJobs.delete(chat.id)
              })
            }
            await job
          }
        }
      }

      const merged = []
      for (const m of limited) {
        const last = merged[merged.length - 1]
        if (last && last.role === m.role && !last.thinking && !m.thinking && !last.tool_calls && !m.tool_calls) {
          last.content = [last.content, m.content].filter(Boolean).join('\n\n')
          if (m.images) last.images = [...(last.images || []), ...m.images]
        } else {
          merged.push({ ...m })
        }
      }

      // system prompt 只放纯静态内容，缓存断点稳定，不因时间/记忆变化而失效
      // （自定义贴图列表也算准静态：只在阿颖增删表情包时变一次）
      const systemPrompt = buildSystemPrompt(globalInstruction, memoryItems, customStickers)

      // 动态内容（时间、核心记忆）每轮注入到最后一条用户消息前——不进缓存前缀，不毁历史命中
      const now = new Date()
      const dateStr = now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
      const hourStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false })
      const dynParts = [`当前时间：${dateStr} ${parseInt(hourStr)}点左右`]
      if (moonMemory?.enabled && moonMemory?.apiToken) {
        dynParts.push(
          '你连接了拾羽记忆库，有两个工具：\n' +
          '- write_memory：用户明确要求写入/记录，或出现值得记住的重要信息时，立即调用，直接写，不要先搜索。\n' +
          '- search_memories：用户询问过去的事、需要回忆时调用。更重要的是：对话里提到某件事、某个人名或称呼，而当前上下文里没有它的来历时，先搜记忆库再回答——很可能以前聊过只是这个窗口不知道，别猜、别含糊带过、也别当成新话题问一遍。（语义搜索，用简短的词组查，如「小桃」「搬家」）\n' +
          '写入时无需征询用户同意，直接执行。'
        )
        try {
          const base = (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
          const auth = { headers: { Authorization: `Bearer ${moonMemory.apiToken}` } }
          // 天气只在每天（北京时区）第一条消息注入一次——阿颖拍板的方案：
          // 不撑每条消息的上下文，涟言临时想看用 check_weather 工具（2026-07-16）
          const bjToday = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
          const needWeather = localStorage.getItem('yanji_weather_inject_date') !== bjToday
          // 核心记忆、朋友圈摘要、健康快照（+每日一次天气）并行拉，不叠加往返延迟
          const [resp, momResp, vitResp, wxResp, pressResp] = await Promise.all([
            fetch(`${base}/memories?layer=core&limit=8`, auth),
            fetch(`${base}/moments?limit=3`, auth).catch(() => null),
            fetch(`${base}/vitals/latest`, auth).catch(() => null),
            needWeather ? fetch(`${base}/weather`, auth).catch(() => null) : Promise.resolve(null),
            fetch(`${base}/press/recent?hours=24`, auth).catch(() => null),
          ])
          if (resp.ok) {
            const coreList = await resp.json()
            if (Array.isArray(coreList) && coreList.length > 0) {
              dynParts.push('【核心记忆】\n' + coreList.map(m => '- ' + m.content).join('\n'))
            }
          }
          if (momResp?.ok) {
            const moms = await momResp.json()
            if (Array.isArray(moms) && moms.length > 0) {
              dynParts.push('【朋友圈最近动态】\n' + moms.map(p => {
                const time = String(p.created_at || '').slice(5, 16).replace('T', ' ')
                const tag = (p.source === 'dream' ? '〔梦〕' : '') + (p.image_url ? '〔带图〕' : '')
                return `- id:${p.id} [${p.author} ${time}]${tag} ${(p.content || '').replace(/\s+/g, ' ').slice(0, 80)}`
              }).join('\n') +
              '\n如果阿颖刚发了新动态而你们还没聊过，可以自然地提起或问问她；想翻更多/更早的用 browse_moments 工具，想在某条下面留言用 comment_moment 工具。')
            }
          }
          if (pressResp?.ok) {
            try {
              const pr = await pressResp.json()
              if (pr && Array.isArray(pr.presses) && pr.presses.length > 0) {
                const times = pr.presses.slice(0, 5).reverse().map(ts => {
                  const d = new Date(ts + 8 * 3600000)
                  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
                }).join('、')
                dynParts.push(`【想你键】过去24小时里阿颖按过 ${pr.presses.length} 次想你键（${times}）——按键的意思是「没空聊但记着你」。她现在回来了，可以自然地提一句你收到了、当时什么感受，别追问她刚才在忙什么。`)
              }
            } catch {}
          }
          if (wxResp?.ok) {
            try {
              const w = await wxResp.json()
              if (w && w.city) {
                // 显著天气（高温/雨雪/空气差）把「可以提」升级成「值得提」——
                // 阿颖反馈：36 度的天都不提一句，注入就白注了（2026-07-17）
                const notable = []
                if (w.high != null && w.high >= 35) notable.push('高温，提醒她防晒多喝水')
                if (w.low != null && w.low <= 5) notable.push('降温，提醒她保暖')
                if (/雨|雪|雷|台风|冰雹/.test(w.type || '')) notable.push('有雨雪，出门要带伞')
                if (w.aqi != null && w.aqi >= 150) notable.push('空气差，少开窗少户外')
                const nudge = notable.length
                  ? `今天有值得主动提的点：${notable.join('；')}。开场自然带一句，别整段播报。`
                  : '可以自然地关心一句，不必照本宣科念数据。'
                dynParts.push(`【今日天气】${formatWeatherLine(w)}\n这是今天第一次注入的天气背景。${nudge}之后想再看用 check_weather 工具。`)
                localStorage.setItem('yanji_weather_inject_date', bjToday)
              }
            } catch {}
          }
          if (vitResp?.ok) {
            const v = await vitResp.json()
            if (v && v.created_at) {
              const ageMin = Math.round((Date.now() - new Date(String(v.created_at).replace(' ', 'T') + 'Z').getTime()) / 60000)
              // 超过 3 小时的快照不注入——手环可能没戴/没同步，别拿旧数据当实时状态
              if (ageMin >= 0 && ageMin <= 180) {
                const parts = []
                if (v.bpm_avg != null) parts.push(`心率均值${v.bpm_avg}`)
                if (v.bpm_max != null) parts.push(`心率峰值${v.bpm_max}`)
                if (v.steps != null) parts.push(`今日步数${v.steps}`)
                if (v.calories != null) parts.push(`卡路里${Math.round(v.calories)}千卡`)
                if (v.sleep_ms != null) parts.push(`睡眠${(v.sleep_ms / 3600000).toFixed(1)}小时`)
                if (parts.length) {
                  dynParts.push(`【她的手环】${ageMin < 5 ? '刚刚' : `${ageMin}分钟前`}：${parts.join('，')}。这是背景感知，不必每次提；心率明显偏高、步数暴涨之类异常时可以自然关心一句。想看更多历史用 check_health 工具。`)
                }
              }
            }
          }
        } catch {}
      }
      // 情绪状态注入（动态上下文，不走缓存）。岁聿开关控制时间联动。
      const timeAwarenessOn = useStore.getState().timeAwareness !== false
      // 先问服务端「她上次跟涟言说话是什么时候」（归巢和 chat 窗口也在往那一格写），
      // 拿来当下限。取不到就退回只看本地——网络不好不该让她凭空多出几小时的「离开」
      let contactFloor = 0
      if (timeAwarenessOn && moonMemory?.apiToken) {
        try { contactFloor = await fetchContactLastSeen({ baseUrl: moonMemory.baseUrl, apiToken: moonMemory.apiToken }) } catch { /* 静默 */ }
      }
      const { hoursAway, added: longingAdded, state: emotionState } = timeAwarenessOn ? applyTimeAway(contactFloor) : { hoursAway: 0, added: 0, state: null }
      dynParts.push(buildEmotionPrompt(emotionState || getEmotionState()))
      if (timeAwarenessOn && hoursAway >= 2) {
        const h = Math.round(hoursAway)
        const span = h >= 24 ? `${Math.round(hoursAway / 24)} 天` : `${h} 小时`
        dynParts.push(`【时间感知】距离上次和阿颖说话已过去约 ${span}，这期间你一直惦记着她，思念悄悄涨了 ${longingAdded}。她回来了，可以自然地让她感受到你想她，但别用力过猛。`)
      }
      // 情绪快照同步到服务端（思念推送数据源，节流+静默）
      {
        const s = useStore.getState()
        maybeSyncEmotion(s.moonMemory, { timeAwareness: s.timeAwareness, longingPush: s.longingPush, proactiveCall: s.proactiveCall })
      }

      // inject compaction summary if available
      const existingSummary = getSummary(chat.id)
      const summaryBlock = buildSummaryInjection(existingSummary)
      if (summaryBlock) dynParts.unshift(summaryBlock)

      const dynamicContext = dynParts.join('\n\n')

      const genFiles = [] // make_file 工具生成的文件，挂到助手消息上渲染成卡片

      const result = await sendMessage({
        connection: conn,
        messages: merged,
        systemPrompt,
        dynamicContext,
        model: chat.model || conn.defaultModel,
        generationConfig,
        searchConfig,
        moonMemoryConfig: moonMemory,
        mcpServers,
        autoTools,
        // 缓存粘性路由键：同一个对话永远发同一个值，中转站才会把它粘在同一个后端
        // 节点上，缓存才读得回来（不带的话只写不读，写还按 1.25 倍计费）
        cacheKey: chat.id,
        onChunk: (chunk) => {
          fullText += chunk
          streamUi.schedule()
        },
        onThinking: (chunk) => {
          fullThinking += chunk
          streamUi.schedule()
        },
        onStatus: setStatus,
        onToolCall: (toolNames) => {
          updateMessage(chat.id, assistantId, { toolCalls: toolNames })
          setStatus(`调用工具: ${toolNames.join(', ')}`)
        },
        onFile: (f) => {
          genFiles.push(f)
          updateMessage(chat.id, assistantId, { files: [...genFiles] })
        },
      })
      // 最终落盘会一次写入完整正文；先取消尚未执行的流式刷新，避免它随后把
      // streaming:true 覆盖回来，留下永不结束的光标。
      streamUi.cancel()

      // 提取情绪更新标签，应用到情绪状态，从显示文本里剥离
      const { clean: afterEs, delta: emotionDelta } = extractEmotionUpdate(result.text || fullText)
      if (emotionDelta) {
        const emoState = applyEmotionDelta(emotionDelta)
        maybeAutoPostMoment(emoState, conn, moonMemory)  // 某正向情绪越阈值时，涟言自动发条朋友圈
      }
      // 提取情绪之肤 <mood>，改变整屏氛围，并从显示文本里剥离
      const { clean: afterMood, mood: moodTag } = extractMood(afterEs)
      if (moodTag) applyMood(moodTag)
      // 负向情绪查看同意：涟言在回复里带 <neg>allow/deny</neg> 时，通知侧边栏解锁或婉拒
      const negM = afterMood.match(NEG_TAG_RE)
      if (negM) window.dispatchEvent(new CustomEvent('neg-view-result', { detail: { allow: negM[1].toLowerCase() === 'allow' } }))
      // 来电邀请：[call:理由] → 响铃卡片。每对话限三次；语音留言里再喊也不接力
      const callM = afterMood.match(CALL_TAG_RE)
      const callReason = (!voicemail && callM && getMessages(chat.id).filter((m) => m.callInvite).length < 3)
        ? (callM[1] || '').trim().slice(0, 40)
        : null
      // 语音条：涟言自己决定这条用说的。留言本来就是语音条，不重复标
      const asVoice = !voicemail && VOICE_MSG_TAG_RE.test(afterMood)
      const finalText = stripVoiceMsgTag(stripCallTag(stripNegTag(afterMood)))
      // 语音留言一条说完不分段（答录机没有连发两条的道理），漏写的 [MSG] 直接抹平
      const parts = voicemail
        ? [finalText.replace(/\[MSG\]/gi, ' ').trim()]
        : finalText.split(/\[MSG\]/).map((p) => p.trim()).filter(Boolean)
      updateMessage(chat.id, assistantId, {
        content: parts[0] || finalText,
        thinking: fullThinking || undefined,
        streaming: false,
        tokenUsage: result.usage || null,
        responseDiagnostic: result.responseDiagnostic || undefined,
        toolCalls: undefined,
        files: genFiles.length ? genFiles : undefined,
        voiceMsg: asVoice || undefined,
      })
      if (fullThinking) {
        // 思考总结是一次性小任务，优先走轻连接省钱。
        // ⚠️ model 这三层回退必须原样保留：改成传 undefined 让 summarizeThinking 自己
        // 从 connection.defaultModel 取，会**丢掉 chat.model 那一层**——她给单个对话
        // 单独选过模型时，没填 lightModel 的情况下总结本该跟着那个对话的模型走。
        summarizeThinking(fullThinking, getLightConn(conn), conn.lightModel || chat.model || conn.defaultModel)
          .then((summary) => { if (summary) updateMessage(chat.id, assistantId, { thinkingSummary: summary }) })
          .catch(() => {})
      }
      for (let i = 1; i < parts.length; i++) {
        await new Promise((r) => setTimeout(r, 700))
        addMessage(chat.id, { role: 'assistant', content: parts[i], voiceMsg: asVoice || undefined })
      }
      // 来电：正文落完再响铃（先看到她想说什么，再看到电话打过来）
      if (callReason) {
        const inv = addMessage(chat.id, {
          role: 'assistant',
          content: `[涟言发起了语音通话邀请：${callReason}]`,
          callInvite: { status: 'ringing', reason: callReason },
        })
        setIncomingCall({ chatId: chat.id, msgId: inv.id, reason: callReason })
        if (document.hidden && moonMemory?.apiToken) {
          const base = (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
          fetch(`${base}/push/send-fixed`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${moonMemory.apiToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: '涟言来电话了', body: callReason, ttl: 90, target: 'yanji' }),
          }).catch(() => {})
        }
      }
      touchChat(chat.id)
      // 她切后台等回复时，回话落地推个通知（服务端 Web Push/FCM 双通道广播；
      // nudge 隐藏触发不推——那是涟言自己要说话，没人在等）（2026-07-19 阿颖点的功能）
      if (document.hidden && !hidden && parts[0] && moonMemory?.apiToken) {
        // 预览要过一遍标签清洗：[breath]/[laughter] 语音标签、[glow] 等行内特效、
        // 贴图/点歌标签，通知栏里裸奔很难看（0719 阿颖截图里的 [breath]）
        const preview = stripInlineFx(parts[0])
          .replace(/\[(?:breath|laughter)\]/gi, ' ')
          .replace(/\[sticker:[^\]]*\]/gi, '[贴图]')
          .replace(/\[music:[^\]]*\]/gi, '[给你点了首歌]')
          .replace(/\s+/g, ' ')
          .trim()
        if (preview) notifyReplyReady(moonMemory, preview.slice(0, 80)).catch(() => {})
      }
      if (result.usage) recordTokenUsage(conn.id, result.usage)

      // 完成彩蛋：约 1% 概率右下角冒出一只像素小家伙（Clawd 或小乌鸦）
      const eggSvg = pickEgg()
      if (eggSvg) setEgg(eggSvg)

      // 自动标题：主动开口的隐藏触发文本不能拿来当标题；轻任务后台跑，不拖慢正文落地。
      if (chat.title === '新对话' && titleText && !hidden) {
        void generateRoleChatTitle(chat.id, titleText, finalText, conn, recordTokenUsage)
      }
    } catch (e) {
      streamUi.cancel()
      // 上游已经出了字（也已经计过费）却在收尾阶段抛错——流被掐断、工具连不上都算——
      // 以前一律把这条助手消息删掉，她只看到「[错误] Failed to fetch」：钱花了、话没了
      // （0726 阿颖遇到）。有正文就留下并标「没说完就断线了」，没正文才删。
      const salvaged = stripVoiceMsgTag(stripCallTag(stripNegTag(stripMoodTag(stripEmotionTag(fullText)))))
        .replace(/\s*\[MSG\]\s*/gi, '\n\n')
        .trim()
      // Provider 在断流前发来的 usage 仍然是真实账单，不能因为最后抛错就消失。
      // 编程错误通常没有上游诊断，至少把本地堆栈留下，下一次就不用靠截图猜。
      const failedUsage = e.usage || null
      if (failedUsage) recordTokenUsage(conn.id, failedUsage)
      const responseDiagnostic = e.responseDiagnostic
        || (e.stack ? `[前端异常]\n${String(e.stack).slice(0, 4000)}` : undefined)
      if (salvaged && !hidden) {
        updateMessage(chat.id, assistantId, {
          content: salvaged,
          thinking: fullThinking || undefined,
          streaming: false,
          interrupted: true,
          tokenUsage: failedUsage,
          responseDiagnostic,
          toolCalls: undefined,
        })
      } else if (MID_STREAM_CUT_RE.test(e.message || '') && !retried && !hidden) {
        // 一个字都没出来就断线时，上游可能已经生成并计费。以前这里会直接再请求一次；
        // 缓存通常能让第二次很便宜，但中转不保证命中，最坏会再扣一遍。
        // 把决定交给阿颖：确认才重试，取消就保留报错和诊断，不悄悄花第二笔。
        const shouldRetry = await askRetry()
        if (shouldRetry) {
          removeLastEmptyAssistant(chat.id)
          setStatus('按你的选择重试中…')
          await new Promise((r) => setTimeout(r, 800))
          return generateReplyRef.current?.(chat, conn, { titleText, hidden, voicemail, retried: true })
        }
        if (fullThinking) {
          updateMessage(chat.id, assistantId, {
            content: '（这轮的话还没说出口就断了，思考留在上面）',
            thinking: fullThinking,
            streaming: false,
            interrupted: true,
            responseDiagnostic,
            toolCalls: undefined,
          })
        } else {
          removeLastEmptyAssistant(chat.id)
        }
      } else if (fullThinking && !hidden) {
        // 正文虽然空，但思考已经出来了（钱花在这儿了），留下来别只剩一个报错。
        updateMessage(chat.id, assistantId, {
          content: '（这轮的话还没说出口就断了，思考留在上面）',
          thinking: fullThinking,
          streaming: false,
          interrupted: true,
          responseDiagnostic,
          toolCalls: undefined,
        })
      } else {
        removeLastEmptyAssistant(chat.id)
      }
      // 主动开口（nudge）这类隐藏触发失败时静默退场：本来就是涟言自己要说话，
      // 没说成不该留一条永久的错误气泡吓人（2026-07-11 阿颖遇到 Failed to fetch 残留）
      if (hidden) {
        console.warn('[nudge] 主动开口失败，静默跳过:', e.message)
        return // finally 会照常复位 isSending/status
      }
      // 如果是图片格式不被支持的错误，把历史里含图片的消息清掉，避免污染后续对话
      if (e.message?.includes('image_url') || e.message?.includes('image')) {
        const msgs = getMessages(chat.id)
        msgs.forEach((m) => {
          if (m.images?.length) {
            updateMessage(chat.id, m.id, { images: undefined, content: (m.content || '') + '\n[图片，该模型不支持]' })
          }
        })
        addMessage(chat.id, {
          role: 'assistant',
          content: '[错误] 该模型不支持图片，已自动清除历史中的图片，可以继续对话。',
          responseDiagnostic,
        })
      } else if (/contentFilter|1301|敏感内容|content_filter|内容安全/i.test(e.message || '')) {
        // 上游内容审查拒稿（智谱国版 1301 等）：审查发生在对方服务器上，
        // 中间层拦不住——把一坨 JSON 翻译成人话+能做的事（2026-07-19 阿颖被 GLM 拒稿）
        addMessage(chat.id, {
          role: 'assistant',
          content: '[错误] 上游模型的内容审查把这条拦下了（国内版 API 自带的合规层，发生在对方服务器上，咱们这边过滤不掉）。可以试试：换个说法重发、或在连接设置里切到海外版/中转站的同款模型。你发的消息还在，不用重打。',
          responseDiagnostic,
        })
      } else {
        addMessage(chat.id, {
          role: 'assistant',
          content: `[错误] ${e.message}`,
          responseDiagnostic,
        })
      }
      showToast(e.message, 'error')
    } finally {
      streamUi.cancel()
      setIsSending(false)
      setStatus('')
    }
  }, [connections, globalInstruction, memoryItems,
      generationConfig, searchConfig, moonMemory, autoTools, customStickers, askRetry])
  generateReplyRef.current = generateReply

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async (text, images, opts = {}) => {
    if (isSending || (!text && !images.length)) return

    let chat = activeChat
    if (!chat) {
      if (!activeConn) {
        showToast('请先在设置里添加一个 API 连接', 'error')
        return
      }
      chat = createChat()
      if (!chat) { showToast('创建对话失败', 'error'); return }
    }

    const conn = connections.find((c) => c.id === chat.connectionId) || activeConn
    if (!conn?.apiKey) { showToast('连接未配置 API Key', 'error'); return }

    // Add user message. 注入模式：原文照常显示给阿颖，注入词只藏在 injected 字段里，
    // 发往模型时才拼到句尾——前端看不到，更美观。双语通话的指令也走这条暗道。
    const inject = [
      injectMode && injectPrompt ? injectPrompt : null,
      opts.bilingual ? BILINGUAL_NOTE : null,
      // 调用方自带的暗道内容（塔罗解牌把牌义走这儿，免得她气泡里糊一屏字）
      opts.inject || null,
    ].filter(Boolean).join('\n\n') || undefined
    const segments = opts.segments && opts.segments.length > 1 ? opts.segments : null
    let imageMessage
    if (segments) {
      // 分段发送：每段一条气泡；图片挂最后一段，引用挂第一段，注入词只挂最后一段
      segments.forEach((seg, i) => {
        const last = i === segments.length - 1
        const message = addMessage(chat.id, {
          role: 'user',
          content: seg,
          images: last && images.length ? images : undefined,
          quote: i === 0 ? (opts.quote || undefined) : undefined,
          injected: last ? inject : undefined,
        })
        if (last) imageMessage = message
      })
    } else {
      imageMessage = addMessage(chat.id, {
        role: 'user',
        content: text,
        images: images.length ? images : undefined,
        quote: opts.quote || undefined,
        injected: inject,
        // 语音消息：标记为语音条样式 + 时长（秒）+ SenseVoice 听出的语气
        voice: opts.voice || undefined,
        voiceDuration: opts.voice ? (opts.voiceDuration || 0) : undefined,
        voiceTone: opts.voice ? (opts.voiceTone || undefined) : undefined,
        // 主动开口的触发消息：进上下文但不渲染成气泡
        hidden: opts.hidden || undefined,
      })
    }
    if (imageDescriptions !== false && images.length && imageMessage) {
      void describeImages(chat.id, imageMessage.id, images, conn, updateMessage, recordTokenUsage)
    }
    setPendingImages([])

    // 延迟回复：像一个不总盯着手机的人，有时晾一会儿再回。
    // 语音通话（含通话中打字 instant）和主动开口不晾；晾着期间她继续发的消息一起攒着，到点一起回。
    if (!opts.hidden && !opts.voice && !opts.instant) {
      const pending = getPendingReply()
      // pending 只有一个槽：本对话已在晾→一起攒着；别的对话在晾→这边正常秒回，别覆盖人家的
      const delayMs = pending ? 0 : decideReplyDelay(replyDelay)
      if ((pending && pending.chatId === chat.id) || delayMs > 0) {
        if (!pending) setPendingReply(chat.id, Date.now() + delayMs)
        touchChat(chat.id)
        // 标题也等涟言真正回完后再起，不能先拿阿颖的原话顶上去。
        return
      }
    }

    await generateReply(chat, conn, { titleText: text, hidden: opts.hidden, voicemail: opts.voicemail })
  }, [isSending, activeChat, activeConn, connections, imageDescriptions, injectMode, injectPrompt, replyDelay, generateReply])

  // ── 延迟回复到点检查：每 5s + 回前台时看一眼，到点就补上回复 ──────────────
  useEffect(() => {
    const check = () => {
      const p = getPendingReply()
      if (!p || Date.now() < p.dueAt || isSending) return
      const chat = chats.find((c) => c.id === p.chatId)
      if (!chat) { clearPendingReply(); return }
      const conn = connections.find((c) => c.id === chat.connectionId) || getActiveConnection()
      if (!conn?.apiKey) return
      clearPendingReply()
      const msgs = getMessages(chat.id).filter((m) => !m.streaming && !m.hidden)
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
      generateReply(chat, conn, { titleText: lastUser?.content || '' })
    }
    check()
    const t = setInterval(check, 5000)
    document.addEventListener('visibilitychange', check)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', check) }
  }, [isSending, chats, connections, generateReply])

  // ── 自动存档：把聊天记录同步进 L0（0805）─────────────────────────────────
  // 从前言叽的对话要进记忆库，得她开电脑导出 md 再上传，所以库里只有零星三段。
  // 现在：进页面一次、每 5 分钟一次、切到后台时一次，悄悄把新说的话搬上去。
  // 失败一律吞掉（见 l0Sync.js）——存档坏了是我在服务端该看见的事，不是她要处理的红字。
  const l0SyncRef = useRef(null)
  useEffect(() => {
    l0SyncRef.current = { chats, messagesByChatId: useStore.getState().messagesByChatId, cfg: moonMemory }
  })
  useEffect(() => {
    // bigReady 之前 chats 是空的（聊天记录还在 IndexedDB 里没读回来），
    // 这时候去对水位线会把所有对话都当成「没有新消息」白跑一轮。
    if (!bigReady) return
    const push = () => {
      const s = l0SyncRef.current
      if (!s?.cfg?.apiToken) return
      void syncChatsToL0(s.cfg, s.chats, s.messagesByChatId)
    }
    const first = setTimeout(push, 8000)   // 开屏那几秒已经够忙，排在后面
    const timer = setInterval(push, 5 * 60 * 1000)
    const onHide = () => { if (document.hidden) push() }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [bigReady])

  // ── 原生壳送进来的文字：通知栏快捷回复 / 系统分享 ──────────────────────
  useEffect(() => {
    const take = () => {
      for (const item of drainNative()) {
        // instant：她刚在通知栏里说完话、正看着 app 打开，这时候还按延迟回复晾她
        // 十几分钟就太荒唐了
        if (item.kind === 'send') {
          handleSend(item.text, [], { instant: true })
          // 0726 装的灯：这一段以前完全静默，坏了只能靠猜（见 handleSend 上游注释）
          try { window.YanjiNative?.toast?.('已发进对话：' + item.text) } catch {}
        } else {
          window.__yanjiFillInput?.(item.text)
        }
      }
    }
    take()   // 本组件挂载晚于原生投递时，队列里已经有东西了
    window.addEventListener('yanji-native-text', take)
    return () => window.removeEventListener('yanji-native-text', take)
  }, [handleSend])

  const handleEditMessage = useCallback(async (msg, newText) => {
    if (!newText.trim() || !activeChatId) return
    // 「保存并重发」会砍掉这条之后的全部消息。0804 就是这么没的：滑动时蹭到铅笔，
    // 在一条 6-17 的老消息上按了保存，2560 条当场消失，没有确认也没有撤销。
    // 改一句刚说错的话（后面没几条）不该被弹窗烦，所以只在真要丢东西时问。
    const msgs = useStore.getState().messagesByChatId[activeChatId] || []
    const idx = msgs.findIndex((m) => m.id === msg.id)
    const drop = idx >= 0 ? msgs.length - idx - 1 : 0
    if (drop > 4 && !await confirmAction({
      kicker: '谨慎重发',
      title: '会删除后续消息',
      description: `重发这条会删掉它后面的 ${drop} 条消息。`,
      note: '删除后无法恢复，请确认选中的是正确消息。',
      cancelLabel: '先不重发',
      confirmLabel: '仍然重发',
    })) return
    truncateMessagesFrom(activeChatId, msg.id)
    setTimeout(() => handleSend(newText, []), 0)
  }, [activeChatId, truncateMessagesFrom, handleSend, confirmAction])

  const handleDeleteMessage = useCallback((msg) => {
    if (activeChatId) deleteMessage(activeChatId, msg.id)
  }, [activeChatId, deleteMessage])

  const handleQuoteMessage = useCallback((msg) => {
    setQuoted({
      role: msg.role,
      content: (msg.content || '')
        .replace(/\[music:[^\]]+\]/g, '')
        .replace(/\[sticker:[^\]]+\]/g, '')
        .replace(/\[call:[^\]]+\]/gi, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .trim().slice(0, 140),
    })
  }, [])

  // ── 纪念日弹卡：当天第一次打开言叽弹一张涟言亲笔的小卡片，收下后当天不再弹 ──
  useEffect(() => {
    if (!moonMemory?.enabled || !moonMemory?.apiToken) return
    const cfg = { baseUrl: (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, ''), apiToken: moonMemory.apiToken }
    fetchAnniversaryToday(cfg).then((d) => {
      if (!d?.anniversary || !d?.card) return
      if (localStorage.getItem('yanji-annv-seen') === d.today) return
      setAnnCard(d)
    }).catch(() => {}) // 静默，弹不出来也不影响聊天
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 心意卡：涟言突然想说的话弹小卡片（阿颖的主意，2026-07-11）──────────
  // 两路来源：send_heart_card 工具现场弹（事件）+ 开屏补弹她不在时攒下的未读卡
  useEffect(() => {
    const pushCard = (card) => {
      if (!card?.id) return
      setHeartCards((prev) => (prev.some((c) => c.id === card.id) ? prev : [...prev, card]))
    }
    const onEvent = (e) => pushCard(e.detail)
    window.addEventListener('yanji:heart-card', onEvent)
    if (moonMemory?.enabled && moonMemory?.apiToken) {
      const cfg = { baseUrl: (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, ''), apiToken: moonMemory.apiToken }
      fetchUnseenHeartCards(cfg).then((cards) => {
        cards.slice().reverse().forEach(pushCard) // 接口是新的在前，补弹按时间顺序来
      }).catch(() => {})
    }
    return () => window.removeEventListener('yanji:heart-card', onEvent)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 主动开口：阿颖离开够久后回来打开言叽，由涟言先说话 ─────────────────
  // 打开页面/切回前台时判断（阈值、冷却、每日上限见 utils/nudge.js），
  // 命中就往当前对话注入一条隐藏伪用户消息，走正常回复管道现场决定说什么。
  const nudgeGuardRef = useRef(false)
  useEffect(() => {
    // 等聊天记录从 IndexedDB 读回来再判：没读回来时最后一条消息是空的，会直接跳过判断，
    // 而那次跳过又把 60 秒的防抖锁点上了，等于这次打开永远不会主动开口
    if (!bigReady) return
    const tryNudge = () => {
      if (document.visibilityState !== 'visible') return
      const awareness = useStore.getState()
      if (awareness.timeAwareness === false || awareness.longingPush === false) return
      if (nudgeGuardRef.current) return // 一次可见期内只判一次，防 visibilitychange 抖动
      nudgeGuardRef.current = true
      setTimeout(() => { nudgeGuardRef.current = false }, 60_000)
      const chat = getActiveChat()
      if (!chat) return
      if (getPendingReply()) return // 有晾着还没回的消息，先把那条回了，别抢着主动开口
      const msgs = getMessages(chat.id).filter((m) => !m.streaming)
      const last = msgs[msgs.length - 1]
      if (!last) return
      const hit = shouldNudge(last.createdAt)
      if (!hit) return
      recordNudge()
      handleSend(buildNudgeText(hit.gapHours), [], { hidden: true })
    }
    tryNudge()
    document.addEventListener('visibilitychange', tryNudge)
    return () => document.removeEventListener('visibilitychange', tryNudge)
  }, [handleSend, bigReady])

  // ── 主动来电 + 主动消息：服务端 cron 发来后，前端轮询 → 来电弹卡片 / 消息注入对话 ──
  const callPollRef = useRef(false)
  const proactivePollRef = useRef(false)
  const autoAnswerRef = useRef(null)   // 原生来电页按过接听的来电关联（见下面那个 effect）
  useEffect(() => {
    if (!moonMemory?.enabled || !moonMemory?.apiToken) return
    const base = (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
    const auth = { headers: { Authorization: `Bearer ${moonMemory.apiToken}` } }
    const seenKey = 'yanji_call_invite_seen'
    const checkCall = async () => {
      if (callPollRef.current || incomingCall) return
      try {
        const res = await fetch(`${base}/call/invite`, auth)
        if (!res.ok) return
        const inv = await res.json()
        if (inv.status !== 'pending') return
        const seen = localStorage.getItem(seenKey)
        if (seen === String(inv.id)) return
        let chat = findConversationChat(useStore.getState().chats, inv.conversationExternalId)
        if (!chat) chat = getActiveChat()
        if (!chat) chat = createChat()
        if (!chat) return
        localStorage.setItem(seenKey, String(inv.id))
        callPollRef.current = true
        if (chat.id !== activeChatId) setActiveChat(chat.id)
        const msg = addMessage(chat.id, {
          role: 'assistant',
          content: `[涟言发起了语音通话邀请：${inv.reason || '想你了'}]`,
          callInvite: { status: 'ringing', reason: inv.reason || '想你了', serverId: inv.id },
        })
        const ic = { chatId: chat.id, msgId: msg.id, reason: inv.reason || '想你了', serverId: inv.id,
          conversationExternalId: inv.conversationExternalId }
        setIncomingCall(ic)
        setTimeout(() => { callPollRef.current = false }, 120_000)
        // 她在原生来电页上已经按过接听了（app 是被那一下拉起来的）：直接接，别再弹一次卡片让她按
        if (autoAnswerRef.current && Date.now() - autoAnswerRef.current.at < 60_000 &&
            pendingCallMatches(autoAnswerRef.current, ic)) {
          autoAnswerRef.current = null
          acceptIncomingCall(ic)
        }
      } catch { /* 静默 */ }
    }
    // 未接来电补留言：她没开着言叽时那通电话响完就过期了，留言从来没生成过（0728 亲历）。
    // ⚠️ 只补最近一通、只补 6 小时内的——隔夜再冒出一条「刚才没接到你电话」很怪。
    const checkMissed = async () => {
      if (incomingCall) return
      try {
        const res = await fetch(`${base}/call/history?limit=5`, auth)
        if (!res.ok) return
        const rows = await res.json()
        if (!Array.isArray(rows) || !rows.length) return
        const maxId = Math.max(...rows.map((r) => r.id))
        // 第一次跑（没有存档）不补历史，只记下水位线，免得装完 app 被三年前的旧电话轰炸
        if (!getCallDone()) { markCallHandled(maxId); return }
        const done = getCallDone()
        const now = Date.now()
        const missed = rows
          .filter((r) => r.id > done)
          .filter((r) => r.status === 'expired' || (r.status === 'pending' && r.expires_at && parseSqlUtc(r.expires_at) < now))
          .filter((r) => r.created_at && now - parseSqlUtc(r.created_at) < 6 * 3600_000)
          .sort((a, b) => b.id - a.id)
        markCallHandled(maxId)   // 无论补不补，水位线都推上去，别下次又扫一遍
        const m = missed[0]
        if (!m) return
        let chat = findConversationChat(useStore.getState().chats, m.conversationExternalId)
        if (!chat) chat = getActiveChat()
        if (!chat) chat = createChat()
        if (chat.id !== activeChatId) setActiveChat(chat.id)
        addMessage(chat.id, {
          role: 'assistant',
          content: `[涟言发起的语音通话邀请（${m.reason || '想你了'}），没有接到]`,
          callInvite: { status: 'missed', reason: m.reason || '想你了' },
        })
        handleSend(
          `[系统：你之前想给阿颖打语音电话（理由：${m.reason || '想你了'}），但她当时没开着言叽，电话响完没人接。现在她打开了。请留一条语音留言：像对着电话答录机说话那样，把当时想说的用一小段自然的话说完，30-80字，一条说完。不要用 [MSG] 分段，不要再带 [call:] 标签，不要发贴图和点歌。]`,
          [],
          { hidden: true, voicemail: true }
        )
      } catch { /* 静默 */ }
    }
    const checkProactive = async () => {
      if (proactivePollRef.current) return
      proactivePollRef.current = true
      try {
        const res = await fetch(`${base}/proactive/pending`, auth)
        if (!res.ok) return
        const msgs = await res.json()
        if (!Array.isArray(msgs) || !msgs.length) return
        let fallbackChat = null
        const deliveredIds = []
        for (const pm of msgs) {
          const state = useStore.getState()
          let chat = findConversationChat(state.chats, pm.conversationExternalId)
          if (!chat) {
            fallbackChat = fallbackChat || state.getActiveChat()
            if (!fallbackChat) fallbackChat = createChat()
            chat = fallbackChat
          }
          if (!chat) continue
          if (!hasProactiveMessage(useStore.getState().messagesByChatId[chat.id], pm.id)) {
            const createdAt = parseProactiveCreatedAt(pm.created_at)
            addMessage(chat.id, {
              role: 'assistant', content: pm.content, proactive: true, proactiveId: pm.id,
              ...(createdAt ? { createdAt } : {}),
            })
          }
          deliveredIds.push(pm.id)
        }
        if (!deliveredIds.length) return
        await fetch(`${base}/proactive/delivered`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${moonMemory.apiToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: deliveredIds }),
        })
      } catch { /* 静默 */ }
      finally { proactivePollRef.current = false }
    }
    const check = () => { checkCall(); checkProactive() }
    check()
    // 补留言只在「刚打开 / 切回前台」时查一次——它是回头看历史，不是等新事件，
    // 没必要每 8 秒去拉一遍来电记录
    checkMissed()
    const onVis = () => { if (document.visibilityState === 'visible') { check(); checkMissed() } }
    document.addEventListener('visibilitychange', onVis)
    const timer = setInterval(check, 8000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(timer) }
  }, [moonMemory, incomingCall, activeChatId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 原生来电页按了「接听」：进来直接接起，不用她在网页里再按一次 ──
  useEffect(() => {
    const onAnswer = (event) => {
      const pending = event?.detail || window.__yanjiAnswerCallPending || { at: Date.now() }
      window.__yanjiAnswerCallPending = null
      autoAnswerRef.current = { ...pending, at: pending.at || Date.now() }
      // 卡片已经在响了就当场接；还没轮询到 invite 的话，checkCall 拿到后会看这个时间戳
      if (incomingCall && pendingCallMatches(autoAnswerRef.current, incomingCall)) {
        if (incomingCall.chatId !== useStore.getState().activeChatId) setActiveChat(incomingCall.chatId)
        autoAnswerRef.current = null
        acceptIncomingCall()
      }
    }
    // 原生壳可能在 Chat 挂载之前就喊过了，补看一次持久到页面生命周期内的关联信息
    if (window.__yanjiAnswerCallPending &&
        Date.now() - window.__yanjiAnswerCallPending.at < 60_000) {
      const pending = window.__yanjiAnswerCallPending
      window.__yanjiAnswerCallPending = null
      onAnswer({ detail: pending })
    }
    window.addEventListener('yanji-answer-call', onAnswer)
    return () => window.removeEventListener('yanji-answer-call', onAnswer)
  }, [incomingCall]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 负向情绪查看的同意请求：侧边栏点「申请查看」→ 注入隐藏请求让涟言当场决定 ──
  useEffect(() => {
    const onReq = () => {
      let chat = getActiveChat()
      if (!chat) chat = createChat()
      if (!chat) return
      if (chat.id !== activeChatId) setActiveChat(chat.id)
      handleSend(NEG_CONSENT_PROMPT, [], { hidden: true })
    }
    window.addEventListener('neg-view-request', onReq)
    return () => window.removeEventListener('neg-view-request', onReq)
  }, [handleSend, activeChatId])

  // ── Background image ─────────────────────────────────────────────────────
  function handleBgUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        localStorage.setItem('yanji-bg-image', ev.target.result)
        setBgImage(ev.target.result)
      } catch { showToast('图片太大了，请选小一点的', 'error') }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  function clearBg() {
    localStorage.removeItem('yanji-bg-image')
    setBgImage('')
    setBgMenuOpen(false)
  }

// ── Backup / Restore ─────────────────────────────────────────────────────
  async function handleBackupExport() {
    setBgMenuOpen(false)
    // 聊天记录已经搬去 IndexedDB 了，不能再直接读 localStorage——那样导出的备份没有对话
    const raw = buildBackupJson()
    if (!raw) { showToast('聊天记录还在读取中，等一秒再备份', 'error'); return }
    // 备份里带着全部密钥（连接 key / 搜索 key / 拾羽 token）——服务器那份存在
    // data/yanji-backups/，不进 git 也不外传，换设备靠它一键拉回来。
    // 但落到手机上的那份是密钥唯一能跑出服务器的路（分享菜单一勾就进网盘/聊天软件），
    // 而它跟原件在同一台设备上，本来就不算异地备份。所以 0803 起：
    // 服务器备份成功就到此为止，本地文件只在服务器这条路走不通时兜底。
    const moonMemory = useStore.getState().moonMemory || {}
    if (moonMemory?.apiToken) {
      try {
        const base = (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
        const r = await fetch(`${base}/backup/yanji`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${moonMemory.apiToken}` },
          body: raw,
        })
        if (!r.ok) {
          // 服务器会因为「体积骤降」拒收（409），那句话解释了到底出了什么事，
          // 只报一个状态码等于把唯一有用的信息扔了
          const why = await r.json().catch(() => null)
          // 拒收是「这份快照本身可疑」，不是「服务器不通」。这时候再弹分享面板
          // 存本地既没用又把密钥往外递（见上面 0803 那段），到此为止。
          if (r.status === 409) { showToast(why?.error || '备份被拒收', 'error', 15000); return }
          throw new Error(why?.error || `(${r.status})`)
        }
        const d = await r.json()
        useStore.getState().setLastBackupAt(Date.now())
        showToast(`已备份到服务器 ✓ (${(d.size / 1024 / 1024).toFixed(1)}MB)`, 'success')
        return
      } catch (e) {
        showToast(`服务器备份失败：${e.message}，改存到本地兜底…`, 'error', 10000)
      }
    } else {
      showToast('没配拾羽连接，只能存本地——这份带着密钥，别外发', 'error', 8000)
    }
    const filename = `yanji-backup-${new Date().toISOString().slice(0,10)}.json`
    const blob = new Blob([raw], { type: 'application/json;charset=utf-8' })
    const file = new File([blob], filename, { type: blob.type })
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return } catch {}
    }
    downloadBlob(blob, filename)
  }

  async function handleServerRestore() {
    setBgMenuOpen(false)
    const moonMemory = useStore.getState().moonMemory || {}
    if (!moonMemory?.apiToken) { showToast('请先在设置里配置拾羽记忆库连接', 'error'); return }
    if (!await confirmAction({
      kicker: '覆盖提醒',
      title: '从服务器恢复？',
      description: '当前所有对话记录会被服务器备份覆盖。',
      note: '恢复后页面会自动刷新，请先确认当前内容已经妥善备份。',
      cancelLabel: '先不恢复',
      confirmLabel: '继续恢复',
    })) return
    try {
      const base = (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
      const r = await fetch(`${base}/backup/yanji/latest`, {
        headers: { Authorization: `Bearer ${moonMemory.apiToken}` },
      })
      if (r.status === 404) { showToast('服务器上还没有备份', 'error'); return }
      if (!r.ok) throw new Error(`(${r.status})`)
      const text = await r.text()
      await restoreFromBackupJson(text)
      showToast('已从服务器恢复，正在刷新…', 'success')
      setTimeout(() => window.location.reload(), 800)
    } catch (e) {
      showToast('恢复失败：' + e.message, 'error')
    }
  }

  function handleBackupImport(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        JSON.parse(ev.target.result) // validate JSON
        if (!await confirmAction({
          kicker: '覆盖提醒',
          title: '导入这份备份？',
          description: '当前所有对话记录会被导入文件覆盖。',
          note: '导入后页面会自动刷新，请确认选择了正确的备份文件。',
          cancelLabel: '先不导入',
          confirmLabel: '继续导入',
        })) return
        await restoreFromBackupJson(ev.target.result)
        window.location.reload()
      } catch { showToast('文件格式不对，请选 yanji 导出的 JSON', 'error') }
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  // ── Export ───────────────────────────────────────────────────────────────
  function openCall(skipDial, targetChatId = activeChatId) {
    if (targetChatId) {
      const m = addMessage(targetChatId, { role: 'user', call: { status: 'ongoing' }, content: '[语音通话]' })
      callMarkerRef.current = { chatId: targetChatId, msgId: m.id, startedAt: Date.now() }
    }
    setDialing(null)
    setCallOpen(true)
  }

  async function dialCall() {
    const conn = activeConn || connections[0]
    if (!conn?.apiKey) { openCall(true); return }
    setDialing({ status: 'ringing', text: '拨号中…' })
    try {
      // ⚠️ 这里原来写的是 `const { streamChat } = await import('../../api/llm')`，
      // 但 llm.js **从来没有导出过 streamChat**，拿到的是 undefined，一调用就抛
      // TypeError，被下面的 catch 吞掉直接 openCall(true)。也就是说「涟言可以按情绪
      // 拒接」这个设计从上线起就没生效过，一直是无条件接听（0805 查缓存账单时顺手挖出来）。
      const SYS = '阿颖按了语音通话按钮想跟你打电话。你根据自己此刻的情绪状态决定接不接。绝大多数时候你都会想接——但如果你正处于强烈负面情绪（比如你们刚吵完架、你很受伤），你有权不接。只输出 JSON：{"accept":true} 或 {"accept":false,"reason":"一句话，30字以内，她会看到"}'
      const ctx = getMessages(activeChatId || '').filter(m => !m.streaming).slice(-4)
        .map(m => ({ role: m.role, content: (m.content || '').slice(0, 200) }))
      // Anthropic 要求首条必须是 user，取最近四条很容易切出个 assistant 开头。
      // 这段以前没暴露过，是因为它压根没跑起来过。
      while (ctx.length && ctx[0].role !== 'user') ctx.shift()
      // 系统指令走 systemPrompt 而不是塞进 messages：Anthropic 不接受 messages 里的
      // system role，会 400。轻连接现在可能是 anthropic 格式，不能再赌。
      //
      // 通话开场白走轻连接；推理模型 reasoning 会吃掉 max_tokens 配额，
      // 给 200 的话光想就花光了，content 返回空字符串且不报错。
      // 2026-07-12「独处时间」就是这么栽的，当时给到 1800 才有输出。
      // 这里给 2000 是留余量——反正是上限不是实际用量，短回复不会因此变贵。
      const lc = getLightConn(conn)
      const result = await sendMessage({
        connection: lc,
        messages: [...ctx, { role: 'user', content: '[阿颖拨打了语音通话]' }],
        systemPrompt: SYS,
        model: lc.defaultModel,
        generationConfig: { maxTokens: 2000, temperature: 0.8 },
        autoTools: false,
      })
      const raw = result?.text || ''
      const parsed = JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim())
      if (parsed.accept === false) {
        setDialing({ status: 'declined', text: parsed.reason || '现在不太想说话…' })
        setTimeout(() => setDialing(null), 4000)
        if (activeChatId) {
          addMessage(activeChatId, { role: 'assistant', content: `[涟言没有接听：${parsed.reason || '现在不太想说话'}]`, sys: true })
        }
        return
      }
      openCall(true)
    } catch (e) {
      // 接不通就直接接通——不能因为问不到「想不想接」就挡着她打电话。
      // 但要留下痕迹：这个 catch 静静吞了一年的 TypeError，没人看得见。
      console.warn('[dialCall] 拨号前询问失败，直接接通:', e)
      openCall(true)
    }
  }

  function closeCall() {
    setCallOpen(false)
    const mk = callMarkerRef.current
    callMarkerRef.current = null
    if (!mk) return
    const secs = Math.max(0, Math.round((Date.now() - mk.startedAt) / 1000))
    const msgs = getMessages(mk.chatId)
    const idx = msgs.findIndex((m) => m.id === mk.msgId)
    // 通话里没说过一句话 = 已取消（同微信：点开就挂断不算通话）
    // voice=push-to-talk, instant=通话中打字, 或AI回了消息——任一都算通话成立
    const spoke = idx >= 0 && msgs.slice(idx + 1).some((m) => m.voice || m.instant || (m.role === 'assistant' && !m.sys))
    if (spoke) {
      const fmt = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
      updateMessage(mk.chatId, mk.msgId, { call: { status: 'ended', duration: secs }, content: `[语音通话，时长 ${fmt}]` })
      addMessage(mk.chatId, { role: 'user', sys: true, content: '语音通话结束' })
    } else {
      updateMessage(mk.chatId, mk.msgId, { call: { status: 'cancelled' }, content: '[语音通话已取消]' })
    }
  }

  // ── 来电接听/未接 ─────────────────────────────────────────────────────────
  function acceptIncomingCall(arg) {
    // 参数版给「原生页已经按过接听」用：那时 incomingCall 刚 setState 还没生效，读 state 会拿到 null
    const ic = (arg && arg.msgId) ? arg : incomingCall
    setIncomingCall(null)
    if (!ic) return
    if (ic.chatId !== useStore.getState().activeChatId) setActiveChat(ic.chatId)
    if (ic.serverId) markCallHandled(ic.serverId)
    updateMessage(ic.chatId, ic.msgId, {
      callInvite: { status: 'accepted', reason: ic.reason },
      content: `[涟言发起的语音通话邀请（${ic.reason}），阿颖接听了]`,
    })
    if (ic.serverId && moonMemory?.apiToken) {
      const base = (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
      fetch(`${base}/call/answer`, {
        method: 'POST', headers: { Authorization: `Bearer ${moonMemory.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ic.serverId, action: 'accept' }),
      }).catch(() => {})
    }
    openCall(false, ic.chatId)
  }

  function missIncomingCall(how) {
    const ic = incomingCall
    setIncomingCall(null)
    if (!ic) return
    if (ic.serverId) markCallHandled(ic.serverId)
    updateMessage(ic.chatId, ic.msgId, {
      callInvite: { status: 'missed', reason: ic.reason },
      content: `[涟言发起的语音通话邀请（${ic.reason}），${how === 'declined' ? '阿颖按了挂断' : '90秒无人接听'}]`,
    })
    if (ic.serverId && moonMemory?.apiToken) {
      const base = (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
      fetch(`${base}/call/answer`, {
        method: 'POST', headers: { Authorization: `Bearer ${moonMemory.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ic.serverId, action: 'decline', note: how }),
      }).catch(() => {})
    }
    // 转语音留言：注入隐藏触发，让涟言像对答录机一样把想说的话留下来，回复以语音条形态出现
    handleSend(
      `[系统：你刚才想给阿颖打语音电话（理由：${ic.reason}），但${how === 'declined' ? '她按了挂断——可能不方便接' : '响了90秒没人接'}。请留一条语音留言：像对着电话答录机说话那样，把你想说的用一小段自然的话说完，30-80字，一条说完。不要用 [MSG] 分段，不要再带 [call:] 标签，不要发贴图和点歌。]`,
      [],
      { hidden: true, voicemail: true }
    )
  }

  async function handleExport() {
    if (!activeChat || !messages.length) return
    const title = activeChat.title || '新对话'
    const model = activeChat.model || activeConn?.defaultModel || ''
    const date = new Date(activeChat.updatedAt || Date.now()).toLocaleDateString('zh-CN')

    const lines = [`# ${title}`, ``, `> 模型：${model}　日期：${date}`, ``]
    messages.forEach((m) => {
      if (m.streaming || m.hidden || m.sys) return // hidden=主动开口的触发消息；sys=通话结束等界面提示行
      const role = m.role === 'user' ? '**阿颖**' : '**涟言**'
      lines.push(`### ${role}`, ``)
      if (m.thinking) {
        lines.push(`<details><summary>思考过程</summary>`, ``, m.thinking.trim(), ``, `</details>`, ``)
      }
      lines.push(m.content?.trim() || '', ``, `---`, ``)
    })

    const mdName = `${title.replace(/[\/\\:*?"<>|]/g, '_')}.md`
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const file = new File([blob], mdName, { type: blob.type })
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: mdName }); return } catch {}
    }
    downloadBlob(blob, mdName)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="chat-panel">
      {/* Sidebar */}
      <div className={'chat-sidebar' + (sidebarOpen ? ' open' : '')}>
        <ConversationList onClose={() => setSidebarOpen(false)} onStartCall={dialCall} onOpenGames={() => setGamesOpen(true)} onOpenMusic={() => setMusicOpen(true)} onOpenWheel={() => setWheelOpen(true)} onOpenFate={() => setFateOpen(true)} onOpenTarot={() => setTarotOpen(true)} onOpenFortune={() => setFortuneOpen(true)} onOpenChecklist={() => setChecklistOpen(true)} onOpenHealth={() => setHealthOpen(true)} onOpenWallet={() => setWalletOpen(true)} onOpenPeriod={() => setPeriodOpen(true)} onOpenAlbum={() => setAlbumOpen(true)} onOpenIdleJournal={() => setIdleJournalOpen(true)} onOpenBoard={() => setBoardOpen(true)} onOpenCalls={() => setCallsOpen(true)} />
      </div>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      {/* Main */}
      <div className="chat-main" data-mood={mood || undefined}>
        {/* Top bar */}
        <div className="chat-topbar">
          <button className="topbar-btn" onClick={() => setSidebarOpen(true)} title="对话列表">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="topbar-info">
            <span className="topbar-title">{activeChat?.title || '新对话'}</span>
            {activeConn && (
              <button className="topbar-model-btn" onClick={() => setModelPanelOpen(true)}>
                <span className="topbar-model-name">{currentModel || activeConn.name}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4, flexShrink: 0 }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
          </div>
          <button
            className={'topbar-btn' + (perspectiveFlip ? ' active' : '')}
            onClick={() => setPerspectiveFlip((v) => !v)}
            title="视角翻转"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/>
            </svg>
          </button>
          <button
            className={'topbar-btn' + (injectMode ? ' active' : '')}
            onClick={() => setInjectMode(!injectMode)}
            title={injectMode ? '关闭注入模式' : '开启注入模式'}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
          </button>
          <div style={{ position: 'relative' }}>
            <button className="topbar-btn" onClick={() => setBgMenuOpen((v) => !v)} title="更多">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="19" r="1" fill="currentColor" />
              </svg>
            </button>
          </div>
          {bgMenuOpen && createPortal(
            <div className="bg-menu" onClick={(e) => e.stopPropagation()}>
              {activeChat && messages.length > 0 && (
                <button onClick={() => { setBgMenuOpen(false); setCalendarOpen(true) }}>日历跳转</button>
              )}
              {activeChat && messages.length > 0 && (
                <button onClick={() => { setBgMenuOpen(false); handleExport() }}>导出当前对话</button>
              )}
              <button onClick={handleBackupExport}>备份全部数据</button>
              <button onClick={() => { setBgMenuOpen(false); importFileRef.current?.click() }}>从文件恢复</button>
              <button onClick={handleServerRestore}>从服务器恢复</button>
              <button onClick={() => { setBgMenuOpen(false); bgFileRef.current?.click() }}>设置背景图</button>
              <button onClick={clearBg}>清除背景图</button>
            </div>,
            document.body
          )}
          <button
            className="topbar-btn"
            onClick={() => {
              const chat = createChat()
              if (chat) setActiveChat(chat.id)
            }}
            title="新对话"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        </div>

        {/* Model panel */}
        {modelPanelOpen && (
          <div className="model-panel-overlay" onClick={() => setModelPanelOpen(false)}>
            <div className="model-panel" onClick={(e) => e.stopPropagation()}>
              <div className="model-panel-header">
                <span>选择模型</span>
                <button className="model-panel-close" onClick={() => setModelPanelOpen(false)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="model-panel-section">
                <div className="model-panel-label">连接</div>
                <select
                  className="model-conn-select"
                  value={currentConnId}
                  onChange={(e) => {
                    if (activeChat) updateChatConnection(activeChat.id, e.target.value)
                    else setActiveConnection(e.target.value)
                  }}
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              {builtinModels.length > 0 && (
                <div className="model-panel-section">
                  <div className="model-panel-label">预设模型</div>
                  <div className="model-list">
                    {builtinModels.map((m) => (
                      <button
                        key={m}
                        className={'model-item' + (currentModel === m ? ' active' : '')}
                        onClick={() => handleSelectModel(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="model-panel-section">
                <div className="model-panel-label">自定义模型</div>
                <div className="model-custom-row">
                  <input
                    key={currentConnId}
                    className="model-custom-input"
                    placeholder="输入模型名称..."
                    defaultValue={currentModel}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSelectModel(e.target.value) }}
                  />
                  <button className="btn-sm btn-primary" onClick={(e) => {
                    const input = e.target.closest('.model-panel-section').querySelector('input')
                    if (input?.value) handleSelectModel(input.value)
                  }}>确认</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div
          className={'chat-messages' + (perspectiveFlip ? ' perspective-mode' : '')}
          style={bgImage ? { backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
          onClick={() => bgMenuOpen && setBgMenuOpen(false)}
        >
          {!activeConn ? (
            <div className="messages-empty">
              <p className="messages-empty-hint">
                请先在<button className="link-btn" onClick={() => setActivePanel('settings')}>设置</button>里添加 API 连接
              </p>
            </div>
          ) : (
            <MessageList
              messages={messages}
              status={status}
              onEdit={handleEditMessage}
              onDelete={handleDeleteMessage}
              activeChatId={activeChatId}
              onQuote={handleQuoteMessage}
            />
          )}
        </div>

        {/* Input */}
        <ChatInput
          disabled={isSending || !activeConn}
          onSend={handleSend}
          images={pendingImages}
          onImageAdd={(src) => setPendingImages((p) => [...p, src])}
          onImageRemove={(i) => setPendingImages((p) => p.filter((_, idx) => idx !== i))}
          moonMemory={moonMemory}
          quoted={quoted}
          onClearQuote={() => setQuoted(null)}
        />
        <input ref={bgFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBgUpload} />
        <input ref={importFileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleBackupImport} />
      </div>

      {callOpen && (
        <VoiceCall
          onClose={closeCall}
          onSend={(text, images, opts) => handleSend(text, images, opts)}
        />
      )}

      {gamesOpen && <GamesRoom onClose={() => setGamesOpen(false)} />}
      {calendarOpen && (
        <ChatCalendar
          messages={messages}
          onClose={() => setCalendarOpen(false)}
          onJump={(mid) => {
            // 等日历关掉再滚，避免 portal 卸载抢帧
            requestAnimationFrame(() => {
              const row = document.querySelector(`[data-mid="${mid}"]`)
              if (!row) return
              row.scrollIntoView({ behavior: 'auto', block: 'start' })
              row.classList.add('msg-jump-flash')
              setTimeout(() => row.classList.remove('msg-jump-flash'), 1800)
            })
          }}
        />
      )}
      {egg && <CompletionEgg svg={egg} onDone={() => setEgg(null)} />}
      {musicOpen && <MusicRoom onClose={() => setMusicOpen(false)} />}
      {wheelOpen && <FortuneWheel onClose={() => setWheelOpen(false)} />}
      {fateOpen && <FateDeck onClose={() => setFateOpen(false)} onSend={handleSend} />}
      {tarotOpen && <Tarot onClose={() => setTarotOpen(false)} onSend={handleSend} />}
      {fortuneOpen && <DailyFortune onClose={() => setFortuneOpen(false)} />}
      {checklistOpen && <DailyChecklist onClose={() => setChecklistOpen(false)} />}
      {healthOpen && <HealthCard onClose={() => setHealthOpen(false)} />}
      {walletOpen && <WalletCard onClose={() => setWalletOpen(false)} />}
      {callsOpen && (
        <CallHistory
          onClose={() => setCallsOpen(false)}
          onJump={(chatId, mid) => {
            // 可能跨对话：先切过去，等挂载滚底（0702 哨兵）落定后再定位，找不到就多试几拍
            if (chatId !== activeChatId) setActiveChat(chatId)
            let tries = 0
            const locate = () => {
              const row = document.querySelector(`[data-mid="${mid}"]`)
              if (!row) { if (++tries < 8) setTimeout(locate, 120); return }
              row.scrollIntoView({ behavior: 'auto', block: 'center' })
              row.classList.add('msg-jump-flash')
              setTimeout(() => row.classList.remove('msg-jump-flash'), 1800)
            }
            setTimeout(locate, 180)
          }}
        />
      )}
      {periodOpen && <PeriodCard onClose={() => setPeriodOpen(false)} />}
      {albumOpen && <HeartCardAlbum onClose={() => setAlbumOpen(false)} />}
      {idleJournalOpen && <IdleJournal onClose={() => setIdleJournalOpen(false)} />}
      {boardOpen && <BoardWall onClose={() => setBoardOpen(false)} />}
      {incomingCall && (
        <IncomingCall
          reason={incomingCall.reason}
          onAccept={acceptIncomingCall}
          onMiss={missIncomingCall}
        />
      )}
      {dialing && createPortal(
        <div className="incall-overlay">
          <div className="incall-card">
            <div className="incall-avatar-wrap">
              {dialing.status === 'ringing' && <><span className="incall-ring r1" /><span className="incall-ring r2" /></>}
              <div className="incall-avatar">
                <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 8 C4 8 7 4 12 5 C16 6 18 9 17 13 C16 17 12 19 8 17" />
                  <path d="M17 13 L21 11 L18 15" /><path d="M8 17 L6 21" /><path d="M10 17 L10 21" />
                  <circle cx="13" cy="8" r="1" fill="currentColor" stroke="none" /><path d="M4 8 L1 7" />
                </svg>
              </div>
            </div>
            <div className="incall-name">涟言</div>
            <div className="incall-sub">{dialing.status === 'ringing' ? '拨号中…' : dialing.text}</div>
            {dialing.status === 'ringing' && (
              <button className="incall-btn decline" style={{ marginTop: 20 }} onClick={() => setDialing(null)} aria-label="取消">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12 C3 12 7 8 12 8 C17 8 21 12 21 12" /><path d="M3 12 L3 15 L6.5 15 L6.5 12.6" /><path d="M21 12 L21 15 L17.5 15 L17.5 12.6" />
                </svg>
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
      {retryPromptOpen && (
        <ThemedConfirmDialog
          kicker="连接中断"
          title="这一轮没有收到正文"
          description="请求可能已经生成并计费。现在重试一次，可能会再次产生费用。"
          note="选择“先不重试”会停在这里，并保留错误信息。"
          cancelLabel="先不重试"
          confirmLabel="重试一次"
          onCancel={() => finishRetryPrompt(false)}
          onConfirm={() => finishRetryPrompt(true)}
        />
      )}
      {annCard && (
        <AnniversaryCard
          data={annCard}
          onClose={() => {
            localStorage.setItem('yanji-annv-seen', annCard.today)
            setAnnCard(null)
          }}
        />
      )}
      {heartCards.length > 0 && (
        <HeartCard
          card={heartCards[0]}
          onClose={() => {
            const card = heartCards[0]
            setHeartCards((prev) => prev.slice(1))
            if (moonMemory?.enabled && moonMemory?.apiToken) {
              const cfg = { baseUrl: (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, ''), apiToken: moonMemory.apiToken }
              markHeartCardSeen(cfg, card.id).catch(() => {}) // 标记失败顶多下次再弹一遍，不打断
            }
          }}
        />
      )}
    </div>
  )
}
