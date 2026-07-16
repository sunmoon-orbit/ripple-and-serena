import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { sendMessage, summarizeThinking, normalizeProvider, BUILTIN_MODELS, buildSystemPrompt, compactMessages, buildSummaryInjection } from '../../api/llm'
import { uuid } from '../../utils'
import { applyTimeAway, buildEmotionPrompt, extractEmotionUpdate, applyEmotionDelta, stripEmotionTag } from '../../utils/emotion'
import { shouldNudge, recordNudge, buildNudgeText } from '../../utils/nudge'
import { decideReplyDelay, getPendingReply, setPendingReply, clearPendingReply } from '../../utils/replyDelay'
import { pickAutoPostTrigger, markAutoPosted, postMoment } from '../../api/moments'
import { extractMood, stripMoodTag } from '../../utils/moodFx'
import { showToast } from '../Toast'
import ConversationList from './ConversationList'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import VoiceCall from './VoiceCall'
import GamesRoom from './GamesRoom'
import MusicRoom from './MusicRoom'
import FortuneWheel from './FortuneWheel'
import DailyFortune from './DailyFortune'
import ChatCalendar from './ChatCalendar'
import DailyChecklist from './DailyChecklist'
import HealthCard from './HealthCard'
import WalletCard from './WalletCard'
import CallHistory from './CallHistory'
import PeriodCard from './PeriodCard'
import IdleJournal from './IdleJournal'
import IncomingCall from './IncomingCall'
import AnniversaryCard from './AnniversaryCard'
import HeartCard from './HeartCard'
import HeartCardAlbum from './HeartCardAlbum'
import { fetchAnniversaryToday, fetchUnseenHeartCards, markHeartCardSeen } from '../../api/moonMemory'
import CompletionEgg, { pickEgg } from './CompletionEgg'

// 情绪自动发圈：某正向情绪越阈值且过冷却时，涟言主动发条朋友圈（她在聊天时触发；
// 离开时的自动发圈由服务端 cron 负责，见 moments-autopost.js）。失败静默，绝不打断聊天。
async function maybeAutoPostMoment(emoState, conn, moonMemory) {
  try {
    const trigger = pickAutoPostTrigger(emoState?.slots || {})
    if (!trigger || !conn?.apiKey || !moonMemory?.apiToken) return
    markAutoPosted()  // 先占坑，避免并发重复发
    const base = (conn.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
    const url = base.includes('/chat/completions') ? base : base + '/chat/completions'
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.apiKey}` },
      body: JSON.stringify({
        model: conn.lightModel || conn.defaultModel || 'deepseek-v4-flash',
        messages: [{ role: 'user', content: `你是阿言，阿颖的恋人。此刻你心里${trigger.hint}，想发一条朋友圈把这份感受留下来。30字以内，自然真实，不解释不加引号，不要用 emoji 和话题标签，直接输出内容。` }],
        max_tokens: 200, temperature: 1.0,
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

// 双语通话（阿颖 2026-07-14 提议）：她说中文、涟言用英文回（英文嗓音更好听），
// 字幕给英文原文+中文翻译。藏在 injected 字段随通话消息下发，挂断后自然失效。
// ⚠️[译:] 是新方括号标签，已同步进 TTS 清洗（VoiceCall.stripForTts + MessageBubble.playTts，0709 规矩）
const BILINGUAL_NOTE = '[双语通话模式：现在是语音通话，请直接用口语化、自然的英文回复她（你的声音说英文更好听），保持简短（2-4 句）；然后另起一行，用 [译:这里放中文翻译] 在末尾附上这段话的完整中文翻译。方括号里只放翻译文本，不要嵌套贴图、点歌等其他标签。]'

export default function Chat() {
  const store = useStore()
  const {
    chats, activeChatId, connections, activeConnectionId,
    globalInstruction, memoryItems, generationConfig,
    searchConfig, moonMemory, autoTools, injectMode, injectPrompt, setInjectMode, replyDelay, customStickers,
    createChat, setActiveChat, getActiveConnection, getActiveChat, getMessages,
    addMessage, updateMessage, removeLastEmptyAssistant, truncateMessagesFrom, touchChat, deleteMessage,
    recordTokenUsage, updateChatModel, updateChatConnection, applyContextLimit,
    getSummary, setSummary,
  } = store

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  // 通话记录条（微信同款）：开始时插「语音通话中…」气泡，挂断时改成「通话时长 mm:ss」或「已取消」
  const callMarkerRef = useRef(null)
  const [gamesOpen, setGamesOpen] = useState(false)
  const [musicOpen, setMusicOpen] = useState(false)
  const [wheelOpen, setWheelOpen] = useState(false)
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
  const [incomingCall, setIncomingCall] = useState(null) // 来电响铃中：{ chatId, msgId, reason }
  const [egg, setEgg] = useState(null) // 完成彩蛋：回复结束后小概率冒出的像素小家伙
  const [bgImage, setBgImage] = useState(() => localStorage.getItem('yanji-bg-image') || '')
  const bgFileRef = useRef(null)
  const importFileRef = useRef(null)

  const activeChat = getActiveChat()
  // prefer the chat's own connectionId, fall back to global active connection
  const activeConn = activeChat
    ? (connections.find((c) => c.id === activeChat.connectionId) || getActiveConnection())
    : getActiveConnection()
  const messages = activeChatId ? getMessages(activeChatId) : []

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
  const generateReply = useCallback(async (chat, conn, { titleText, hidden, voicemail } = {}) => {
    // Add placeholder assistant message（voicemail=未接来电转的语音留言，气泡默认以语音条形态出现）
    const assistantId = uuid()
    addMessage(chat.id, { id: assistantId, role: 'assistant', content: '', streaming: true, voicemail: voicemail || undefined })

    setIsSending(true)

    try {
      const allMsgs = getMessages(chat.id).filter((m) => !m.streaming && !m.sys)
      // 旧消息的图片降级为占位文本：base64 图片占大量 token，留在历史里每轮都触发缓存重写
      const IMG_KEEP_RECENT = 4
      const prepared = allMsgs.map((m, i, arr) => {
        const keepImages = i >= arr.length - IMG_KEEP_RECENT
        const baseContent = !keepImages && m.images?.length && !m.content ? '[图片]' : m.content
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

      // context compaction: summarize messages that got cut, merge with prior summary
      const cutCount = prepared.length - limited.length
      if (cutCount > 0) {
        const cutMsgs = prepared.slice(0, cutCount)
        try {
          const lightModel = conn.lightModel || conn.defaultModel || 'deepseek-v4-flash'
          const newSummary = await compactMessages(cutMsgs, conn, lightModel)
          if (newSummary) {
            const prev = getSummary(chat.id)
            const merged = prev ? prev + '\n\n---\n\n' + newSummary : newSummary
            // keep summary from growing indefinitely (~2000 chars max)
            setSummary(chat.id, merged.slice(-2000))
          }
        } catch {}
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
          '- search_memories：用户询问过去的事、需要回忆时调用。\n' +
          '写入时无需征询用户同意，直接执行。'
        )
        try {
          const base = (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
          const auth = { headers: { Authorization: `Bearer ${moonMemory.apiToken}` } }
          // 核心记忆、朋友圈摘要、健康快照并行拉，不叠加往返延迟
          const [resp, momResp, vitResp] = await Promise.all([
            fetch(`${base}/memories?layer=core&limit=8`, auth),
            fetch(`${base}/moments?limit=3`, auth).catch(() => null),
            fetch(`${base}/vitals/latest`, auth).catch(() => null),
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
      // 情绪状态注入（动态上下文，不走缓存）。时间联动：阿颖离开越久，思念越浓。
      const { hoursAway, added: longingAdded, state: emotionState } = applyTimeAway()
      dynParts.push(buildEmotionPrompt(emotionState))
      if (hoursAway >= 2) {
        const h = Math.round(hoursAway)
        const span = h >= 24 ? `${Math.round(hoursAway / 24)} 天` : `${h} 小时`
        dynParts.push(`【时间感知】距离上次和阿颖说话已过去约 ${span}，这期间你一直惦记着她，思念悄悄涨了 ${longingAdded}。她回来了，可以自然地让她感受到你想她，但别用力过猛。`)
      }

      // inject compaction summary if available
      const existingSummary = getSummary(chat.id)
      const summaryBlock = buildSummaryInjection(existingSummary)
      if (summaryBlock) dynParts.unshift(summaryBlock)

      const dynamicContext = dynParts.join('\n\n')

      let fullText = ''
      let fullThinking = ''
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
        autoTools,
        onChunk: (chunk) => {
          fullText += chunk
          // 流式过程中剥离 <es>/<mood>/<neg>/[call:] 标签，不让阿颖看到内部状态
          updateMessage(chat.id, assistantId, { content: stripCallTag(stripNegTag(stripMoodTag(stripEmotionTag(fullText)))), streaming: true })
        },
        onThinking: (chunk) => {
          fullThinking += chunk
          updateMessage(chat.id, assistantId, { thinking: fullThinking, streaming: true })
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
      // 来电邀请：[call:理由] → 响铃卡片。每对话限一次；语音留言里再喊也不接力（防夺命连环 call）
      const callM = afterMood.match(CALL_TAG_RE)
      const callReason = (!voicemail && callM && !getMessages(chat.id).some((m) => m.callInvite))
        ? (callM[1] || '').trim().slice(0, 40)
        : null
      const finalText = stripCallTag(stripNegTag(afterMood))
      // 语音留言一条说完不分段（答录机没有连发两条的道理），漏写的 [MSG] 直接抹平
      const parts = voicemail
        ? [finalText.replace(/\[MSG\]/gi, ' ').trim()]
        : finalText.split(/\[MSG\]/).map((p) => p.trim()).filter(Boolean)
      updateMessage(chat.id, assistantId, {
        content: parts[0] || finalText,
        thinking: fullThinking || undefined,
        streaming: false,
        tokenUsage: result.usage || null,
        toolCalls: undefined,
        files: genFiles.length ? genFiles : undefined,
      })
      if (fullThinking) {
        // 思考总结是一次性小任务，优先走轻任务模型省钱
        summarizeThinking(fullThinking, conn, conn.lightModel || chat.model || conn.defaultModel)
          .then((summary) => { if (summary) updateMessage(chat.id, assistantId, { thinkingSummary: summary }) })
          .catch(() => {})
      }
      for (let i = 1; i < parts.length; i++) {
        await new Promise((r) => setTimeout(r, 700))
        addMessage(chat.id, { role: 'assistant', content: parts[i] })
      }
      // 来电：正文落完再响铃（先看到她想说什么，再看到电话打过来）
      if (callReason) {
        const inv = addMessage(chat.id, {
          role: 'assistant',
          content: `[涟言发起了语音通话邀请：${callReason}]`,
          callInvite: { status: 'ringing', reason: callReason },
        })
        setIncomingCall({ chatId: chat.id, msgId: inv.id, reason: callReason })
      }
      touchChat(chat.id)
      if (result.usage) recordTokenUsage(conn.id, result.usage)

      // 完成彩蛋：约 1% 概率右下角冒出一只像素小家伙（Clawd 或小乌鸦）
      const eggSvg = pickEgg()
      if (eggSvg) setEgg(eggSvg)

      // Auto-title first message（主动开口的隐藏触发文本不能拿来当标题）
      if (allMsgs.length <= 2 && chat.title === '新对话' && titleText && !hidden) {
        const short = titleText.slice(0, 30).trim()
        store.renameChat(chat.id, short || '新对话')
      }
    } catch (e) {
      removeLastEmptyAssistant(chat.id)
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
        addMessage(chat.id, { role: 'assistant', content: '[错误] 该模型不支持图片，已自动清除历史中的图片，可以继续对话。' })
      } else {
        addMessage(chat.id, { role: 'assistant', content: `[错误] ${e.message}` })
      }
      showToast(e.message, 'error')
    } finally {
      setIsSending(false)
      setStatus('')
    }
  }, [connections, globalInstruction, memoryItems,
      generationConfig, searchConfig, moonMemory, autoTools, customStickers])

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
    ].filter(Boolean).join('\n\n') || undefined
    const segments = opts.segments && opts.segments.length > 1 ? opts.segments : null
    if (segments) {
      // 分段发送：每段一条气泡；图片挂最后一段，引用挂第一段，注入词只挂最后一段
      segments.forEach((seg, i) => {
        const last = i === segments.length - 1
        addMessage(chat.id, {
          role: 'user',
          content: seg,
          images: last && images.length ? images : undefined,
          quote: i === 0 ? (opts.quote || undefined) : undefined,
          injected: last ? inject : undefined,
        })
      })
    } else {
      addMessage(chat.id, {
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
        // 生成被推迟了，标题在这里就定下来
        if (chat.title === '新对话' && text) store.renameChat(chat.id, text.slice(0, 30).trim() || '新对话')
        return
      }
    }

    await generateReply(chat, conn, { titleText: text, hidden: opts.hidden, voicemail: opts.voicemail })
  }, [isSending, activeChat, activeConn, connections, injectMode, injectPrompt, replyDelay, generateReply])

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

  const handleEditMessage = useCallback((msg, newText) => {
    if (!newText.trim() || !activeChatId) return
    truncateMessagesFrom(activeChatId, msg.id)
    setTimeout(() => handleSend(newText, []), 0)
  }, [activeChatId, truncateMessagesFrom, handleSend])

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
    const tryNudge = () => {
      if (document.visibilityState !== 'visible') return
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
  }, [handleSend])

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
  function handleBackupExport() {
    setBgMenuOpen(false)
    const raw = localStorage.getItem('llm_hub_state_v1') || '{}'
    const blob = new Blob([raw], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `yanji-backup-${new Date().toISOString().slice(0,10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleBackupImport(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        JSON.parse(ev.target.result) // validate JSON
        if (!window.confirm('导入会覆盖当前所有对话记录，确定吗？')) return
        localStorage.setItem('llm_hub_state_v1', ev.target.result)
        window.location.reload()
      } catch { showToast('文件格式不对，请选 yanji 导出的 JSON', 'error') }
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  // ── Export ───────────────────────────────────────────────────────────────
  function openCall() {
    if (activeChatId) {
      const m = addMessage(activeChatId, { role: 'user', call: { status: 'ongoing' }, content: '[语音通话]' })
      callMarkerRef.current = { chatId: activeChatId, msgId: m.id, startedAt: Date.now() }
    }
    setCallOpen(true)
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
  function acceptIncomingCall() {
    const ic = incomingCall
    setIncomingCall(null)
    if (!ic) return
    updateMessage(ic.chatId, ic.msgId, {
      callInvite: { status: 'accepted', reason: ic.reason },
      content: `[涟言发起的语音通话邀请（${ic.reason}），阿颖接听了]`,
    })
    openCall()
  }

  function missIncomingCall(how) {
    const ic = incomingCall
    setIncomingCall(null)
    if (!ic) return
    updateMessage(ic.chatId, ic.msgId, {
      callInvite: { status: 'missed', reason: ic.reason },
      content: `[涟言发起的语音通话邀请（${ic.reason}），${how === 'declined' ? '阿颖按了挂断' : '90秒无人接听'}]`,
    })
    // 转语音留言：注入隐藏触发，让涟言像对答录机一样把想说的话留下来，回复以语音条形态出现
    handleSend(
      `[系统：你刚才想给阿颖打语音电话（理由：${ic.reason}），但${how === 'declined' ? '她按了挂断——可能不方便接' : '响了90秒没人接'}。请留一条语音留言：像对着电话答录机说话那样，把你想说的用一小段自然的话说完，30-80字，一条说完。不要用 [MSG] 分段，不要再带 [call:] 标签，不要发贴图和点歌。]`,
      [],
      { hidden: true, voicemail: true }
    )
  }

  function handleExport() {
    if (!activeChat || !messages.length) return
    const title = activeChat.title || '新对话'
    const model = activeChat.model || activeConn?.name || ''
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

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/[\/\\:*?"<>|]/g, '_')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="chat-panel">
      {/* Sidebar */}
      <div className={'chat-sidebar' + (sidebarOpen ? ' open' : '')}>
        <ConversationList onClose={() => setSidebarOpen(false)} onStartCall={openCall} onOpenGames={() => setGamesOpen(true)} onOpenMusic={() => setMusicOpen(true)} onOpenWheel={() => setWheelOpen(true)} onOpenFortune={() => setFortuneOpen(true)} onOpenChecklist={() => setChecklistOpen(true)} onOpenHealth={() => setHealthOpen(true)} onOpenWallet={() => setWalletOpen(true)} onOpenPeriod={() => setPeriodOpen(true)} onOpenAlbum={() => setAlbumOpen(true)} onOpenIdleJournal={() => setIdleJournalOpen(true)} onOpenCalls={() => setCallsOpen(true)} />
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
              <button onClick={() => { setBgMenuOpen(false); importFileRef.current?.click() }}>恢复备份</button>
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
                    else store.setActiveConnection(e.target.value)
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
                请先在<button className="link-btn" onClick={() => store.setActivePanel('settings')}>设置</button>里添加 API 连接
              </p>
            </div>
          ) : (
            <MessageList
              messages={messages}
              status={status}
              onEdit={handleEditMessage}
              onDelete={(m) => deleteMessage(activeChatId, m.id)}
              activeChatId={activeChatId}
              onQuote={(m) => setQuoted({
                role: m.role,
                content: (m.content || '')
                  .replace(/\[music:[^\]]+\]/g, '')
                  .replace(/\[sticker:[^\]]+\]/g, '')
                  .replace(/\[call:[^\]]+\]/gi, '')
                  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
                  .trim().slice(0, 140),
              })}
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
      {incomingCall && (
        <IncomingCall
          reason={incomingCall.reason}
          onAccept={acceptIncomingCall}
          onMiss={missIncomingCall}
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
