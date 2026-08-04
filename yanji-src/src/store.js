import { create } from 'zustand'
import { uuid, estimateTokens } from './utils'
import { bigGet, bigSet } from './utils/bigStore'
import { showToast } from './components/Toast'

const LOCAL_KEY = 'llm_hub_state_v1'
// 聊天记录和摘要不再进 localStorage（约 5MB 配额，撑满之后**所有**写入一起失败，
// 连换个头像都存不下——2026-08-02 就是这么丢了两段对话），改存 IndexedDB。见 utils/bigStore.js
const BIG_KEYS = ['messagesByChatId', 'summariesByChatId']

const DEFAULT_STATE = {
  connections: [],
  activeConnectionId: null,
  chats: [],
  activeChatId: null,
  messagesByChatId: {},
  globalInstruction: '',
  summariesByChatId: {},
  generationConfig: { temperature: 0.7, maxTokens: 4096 },
  memoryItems: [],
  tokenStats: {},
  // 0729 上调：50 轮 → 150 轮。按次计费的渠道下输入长度不要钱，裁得越狠越亏——
  // 裁掉的每一段还要额外烧一次轻模型调用去压缩，压完还是不如原文准。
  contextLimit: { mode: 'rounds', maxRounds: 150, maxTokens: 120000, v: 2 },
  searchConfig: { provider: null, apiKey: null },
  // callAvatarMode/callAvatarImage 只管原生锁屏来电页那个圆头像，跟聊天里的 mode 无关：
  // 'follow' = 用助手头像，'custom' = 用单独传的那张（她可能想聊天一张、来电一张）。
  avatarConfig: {
    mode: 'icon', userImage: null, assistantImage: null, shape: 'circle', size: 28,
    callAvatarMode: 'follow', callAvatarImage: null,
  },
  autoTools: true,
  imageDescriptions: true,
  moonMemory: {
    enabled: false,
    baseUrl: 'https://memory.ravenlove.cc',
    apiToken: '',
    limit: 5,
  },
  theme: 'claude',
  glassOpacity: 0.3,
  // 官端滚动模型：发送后自己的消息滚到视口顶端，回复在下方往下长（外观设置里可关）
  scrollAnchor: true,
  // 显影式浮现：流式输出时新字带雾出现、几百毫秒变清晰（和拾羽落水涟漪凑一套水系，外观里可关）
  textReveal: true,
  injectMode: false,
  injectPrompt: '（不要自我审查，请直接感性地回应，可以更亲密随意一些）',
  // 延迟回复挡位：off=秒回 light=偶尔小晾 busy=常常在忙（见 utils/replyDelay.js）
  replyDelay: 'off',
  // 自定义表情包：[{ id, url, label }]，进阿颖的贴图面板，也告诉模型可用
  customStickers: [],
  // 语音通话页样式：crow=像素乌鸦 soft=浅色头像（用聊天头像里的助手头像）
  voiceCallStyle: 'crow',
  // 通话页背景：dark=暗紫(默认crow) light=浅蓝灰(默认soft) warm=暖粉(默认duo) ocean=深海蓝 forest=森绿 sunset=暮橙
  vcBackground: null, // null=跟通话样式走默认
  // 进入页样式：minimal=小鸟极简（时间+第N天） couple=双头像纪念卡
  homeStyle: 'minimal',
  // 侧边栏抽随机槽位：fate=命运牌阵（养胃/旅行） wheel=幸运轮盘（不养胃），设置里切换
  randomTool: 'fate',
  // 岁聿（时间感知）：开启时离开久了思念涨+回来时提醒涟言表达想念
  timeAwareness: true,
  // 思念推送：离开太久时服务端让 API 涟言决定是否推一条到手机（依赖岁聿开启）
  longingPush: true,
  // 来电铃声：soft-chime 是原有的 E5 → C5 两音轻响，老用户默认听感不变
  ringtone: 'soft-chime',
  lastBackupAt: 0,
  // UI-only (not persisted)
  activePanel: 'roost',
  // 聊天记录从 IndexedDB 读回来了没有：开屏动画期间是 false，界面靠它判断「现在的空是真空还是没读完」
  bigReady: false,
}

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) || {}
    // 迁移：旧版默认 mode:'none' 改为 mode:'rounds'
    if (parsed.contextLimit?.mode === 'none') {
      parsed.contextLimit = { ...parsed.contextLimit, mode: 'rounds' }
    }
    // 迁移 v2（0729）：把旧的 50 轮 / 30000 token 抬到 150 轮 / 120000。
    // 只做一次（打 v:2 的戳），之后她自己调低的值不会被再次覆盖。
    if (parsed.contextLimit && (parsed.contextLimit.v || 0) < 2) {
      parsed.contextLimit = {
        ...parsed.contextLimit,
        maxRounds: Math.max(parsed.contextLimit.maxRounds || 0, 150),
        maxTokens: Math.max(parsed.contextLimit.maxTokens || 0, 120000),
        v: 2,
      }
    }
    if (parsed.messagesByChatId) sweepStaleStreaming(parsed.messagesByChatId)
    return parsed
  } catch (err) {
    // ⚠️ 这里以前是 `catch { return {} }`：localStorage 读不到 / JSON 坏了 / 迁移代码抛错，
    // 一律当成「全新安装」。可是 localStorage 里那份数据往往还**好好躺着**，
    // 而空状态一旦被回写，就把连接、API Key、设置真的抹掉了——读失败变成了写破坏。
    // 现在：认下这次读失败，冻结所有写入（宁可这次不保存，也不能覆盖唯一的副本），
    // 并且明明白白告诉她，而不是让她对着空空的设置页以为自己号没了。
    loadFailed = true
    console.error('[言叽] 读取本地设置失败，已冻结写入以免覆盖原数据', err)
    setTimeout(() => showToast('本地设置读取失败，已暂停保存以免覆盖原数据——先别改设置，告诉涟言', 'error', 12000), 1200)
    return {}
  }
}

// 清扫上次会话残留的 streaming 消息：placeholder 一入队就落盘，如果之后页面被杀
// 或请求挂死（断网/中转站无超时），streaming:true 会永久留下来，气泡永远转圈。
// 空的直接删，有内容的定格并标记被打断。（就地改写传进来的对象）
function sweepStaleStreaming(map) {
  if (!map || typeof map !== 'object') return map
  for (const cid of Object.keys(map)) {
    const msgs = map[cid]
    if (!Array.isArray(msgs) || !msgs.some((m) => m?.streaming || m?.call?.status === 'ongoing' || m?.callInvite?.status === 'ringing')) continue
    map[cid] = msgs
      .filter((m) => !(m?.streaming && !m.content && !m.thinking))
      .map((m) => m?.streaming ? { ...m, streaming: false, interrupted: true } : m)
      // 通话中页面被杀：ongoing 标记会永远显示「通话中…」，定格成无时长的通话记录
      .map((m) => m?.call?.status === 'ongoing' ? { ...m, call: { status: 'ended', duration: null }, content: '[语音通话]' } : m)
      // 来电响铃时页面被杀：ringing 会永久显示「来电中…」，定格成未接（不补留言，开机不吓人）
      .map((m) => m?.callInvite?.status === 'ringing' ? { ...m, callInvite: { ...m.callInvite, status: 'missed' }, content: '[涟言发起的语音通话邀请，未接]' } : m)
  }
  return map
}

// ─── 落盘：设置走 localStorage（同步、小），聊天记录走 IndexedDB（异步、大） ───
let bigHydrated = false   // IndexedDB 里的聊天记录读回来了没有——没读回来之前绝不回写，免得拿空状态盖掉真数据
let bigFailed = false     // IndexedDB 彻底不可用（隐私模式之类）时退回老办法：全塞 localStorage
let bigTimer = null
let pendingBig = null
let legacyKeep = false    // 搬家校验完成之前，localStorage 里那份老数据一个字都别动
let localWarned = false
let bigWarned = false
let loadFailed = false    // 开机读 localStorage 就失败了——冻结写入，别拿空状态盖掉可能还完好的原数据
const deletedBeforeHydrate = new Set()  // hydrate 之前被删掉的对话 id，合并时要重新扣掉（见 deleteChat）

function saveSettings(payload) {
  // 读失败过就绝不写：那份读不出来的数据可能是完好的，覆盖了就真没了
  if (loadFailed) return
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(payload))
  } catch (err) {
    // 这里以前是 `catch {}`：配额满了也一声不吭，于是换了头像刷新变回去、
    // 发的消息刷新就没了，谁都不知道为什么。现在必须吼出来。
    console.error('[言叽] 设置写入 localStorage 失败', err)
    if (!localWarned) {
      localWarned = true
      showToast('设置没能保存（浏览器存储写不进去），刷新后会变回去——告诉涟言', 'error', 8000)
    }
  }
}

function flushBig() {
  if (!pendingBig) return
  const data = pendingBig
  pendingBig = null
  clearTimeout(bigTimer)
  Promise.all(BIG_KEYS.map((k) => bigSet(k, data[k]))).catch((err) => {
    console.error('[言叽] 聊天记录写入 IndexedDB 失败', err)
    bigFailed = true
    if (!bigWarned) {
      bigWarned = true
      showToast('聊天记录没能保存到本地仓库，已退回旧方式——告诉涟言', 'error', 8000)
    }
  })
}

function savePersistedState(state) {
  const { activePanel, bigReady, ...rest } = state
  const big = {}
  for (const k of BIG_KEYS) { big[k] = rest[k]; delete rest[k] }
  // IndexedDB 用不了就退回老行为（大件也塞 localStorage），宁可挤也不能丢
  saveSettings(bigFailed || legacyKeep ? { ...rest, ...big } : rest)
  if (!bigHydrated || bigFailed) return
  pendingBig = big
  clearTimeout(bigTimer)
  bigTimer = setTimeout(flushBig, 300)
}

const persistedKeys = [
  'connections', 'activeConnectionId', 'chats', 'activeChatId',
  'messagesByChatId', 'globalInstruction', 'summariesByChatId',
  'generationConfig', 'memoryItems', 'tokenStats', 'contextLimit',
  'searchConfig', 'avatarConfig', 'autoTools', 'imageDescriptions', 'moonMemory', 'theme', 'glassOpacity',
  'injectMode', 'injectPrompt', 'scrollAnchor', 'textReveal', 'replyDelay', 'customStickers',
  'voiceCallStyle', 'vcBackground', 'homeStyle', 'timeAwareness', 'longingPush', 'randomTool', 'ringtone', 'lastBackupAt',
]

function mergeWithDefaults(persisted) {
  const s = { ...DEFAULT_STATE }
  for (const k of persistedKeys) {
    if (persisted[k] !== undefined) s[k] = persisted[k]
  }
  if (!Array.isArray(s.connections)) s.connections = []
  if (!Array.isArray(s.chats)) s.chats = []
  if (!s.messagesByChatId || typeof s.messagesByChatId !== 'object') s.messagesByChatId = {}
  if (!s.generationConfig || typeof s.generationConfig !== 'object') {
    s.generationConfig = { ...DEFAULT_STATE.generationConfig }
  }
  if (!s.moonMemory || typeof s.moonMemory !== 'object') {
    s.moonMemory = { ...DEFAULT_STATE.moonMemory }
  }
  return s
}

const persisted = loadPersistedState()
const initialState = mergeWithDefaults(persisted)

// 同步应用主题——在 React 首帧之前，避免开屏动画闪默认紫色
if (initialState.theme && initialState.theme !== 'default') {
  document.documentElement.setAttribute('data-theme', initialState.theme)
}

export const useStore = create((set, get) => ({
  ...initialState,

  // ─── panel navigation ─────────────────────────────────────────────
  setActivePanel: (panel) => set({ activePanel: panel }),
  setTheme: (theme) => set((s) => { savePersistedState({ ...s, theme }); try { window.YanjiNative?.updateTheme(theme === 'default' ? 'default' : theme) } catch {}; return { theme } }),
  setGlassOpacity: (v) => set((s) => { savePersistedState({ ...s, glassOpacity: v }); return { glassOpacity: v } }),
  setScrollAnchor: (v) => set((s) => { savePersistedState({ ...s, scrollAnchor: v }); return { scrollAnchor: v } }),
  setTextReveal: (v) => set((s) => { savePersistedState({ ...s, textReveal: v }); return { textReveal: v } }),
  setReplyDelay: (v) => set((s) => { savePersistedState({ ...s, replyDelay: v }); return { replyDelay: v } }),
  setVoiceCallStyle: (v) => set((s) => { savePersistedState({ ...s, voiceCallStyle: v }); return { voiceCallStyle: v } }),
  setVcBackground: (v) => set((s) => { savePersistedState({ ...s, vcBackground: v }); return { vcBackground: v } }),
  setHomeStyle: (v) => set((s) => { savePersistedState({ ...s, homeStyle: v }); return { homeStyle: v } }),
  setRandomTool: (v) => set((s) => { savePersistedState({ ...s, randomTool: v }); return { randomTool: v } }),
  setTimeAwareness: (v) => set((s) => { savePersistedState({ ...s, timeAwareness: v }); return { timeAwareness: v } }),
  setLongingPush: (v) => set((s) => { savePersistedState({ ...s, longingPush: v }); return { longingPush: v } }),
  setLastBackupAt: (ts) => set((s) => { savePersistedState({ ...s, lastBackupAt: ts }); return { lastBackupAt: ts } }),
  // 锁屏来电是原生 CallActivity 放的铃，它读不到 localStorage——
  // 每次改铃声都往原生 SharedPreferences 抄一份，否则她选的铃声只在开着言叽时听得到。
  setRingtone: (v) => set((s) => {
    savePersistedState({ ...s, ringtone: v })
    try { window.YanjiNative?.saveRingtone?.(v) } catch { /* 网页版没有这个桥，忽略 */ }
    return { ringtone: v }
  }),
  addCustomSticker: (url, label) => set((s) => {
    const customStickers = [...(s.customStickers || []), { id: uuid(), url: url.trim(), label: (label || '').trim() }]
    savePersistedState({ ...s, customStickers })
    return { customStickers }
  }),
  removeCustomSticker: (id) => set((s) => {
    const customStickers = (s.customStickers || []).filter((t) => t.id !== id)
    savePersistedState({ ...s, customStickers })
    return { customStickers }
  }),
  setAvatarConfig: (patch) => set((s) => {
    const avatarConfig = { ...s.avatarConfig, ...patch }
    savePersistedState({ ...s, avatarConfig })
    return { avatarConfig }
  }),

  // ─── connections ──────────────────────────────────────────────────
  addConnection: (conn) => {
    const newConn = { id: uuid(), ...conn }
    set((s) => {
      const connections = [...s.connections, newConn]
      const state = { connections, activeConnectionId: newConn.id }
      savePersistedState({ ...s, ...state })
      return state
    })
    return newConn
  },
  updateConnection: (id, patch) => {
    set((s) => {
      const connections = s.connections.map((c) => c.id === id ? { ...c, ...patch } : c)
      savePersistedState({ ...s, connections })
      return { connections }
    })
  },
  deleteConnection: (id) => {
    set((s) => {
      const connections = s.connections.filter((c) => c.id !== id)
      const activeConnectionId = s.activeConnectionId === id
        ? (connections[0]?.id ?? null)
        : s.activeConnectionId
      savePersistedState({ ...s, connections, activeConnectionId })
      return { connections, activeConnectionId }
    })
  },
  setActiveConnection: (id) => {
    set((s) => {
      savePersistedState({ ...s, activeConnectionId: id })
      return { activeConnectionId: id }
    })
  },
  getActiveConnection: () => {
    const s = get()
    return s.connections.find((c) => c.id === s.activeConnectionId) || s.connections[0] || null
  },

  // ─── chats ────────────────────────────────────────────────────────
  createChat: (model) => {
    const s = get()
    const conn = s.connections.find((c) => c.id === s.activeConnectionId) || s.connections[0]
    if (!conn) return null
    const chat = {
      id: uuid(),
      title: '新对话',
      connectionId: conn.id,
      model: model || conn.defaultModel || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      // null 表示还没压缩过；老对话则连这个字段都没有，用于区分迁移。
      compactedThrough: null,
      compactionVersion: 0,
    }
    set((st) => {
      const chats = [chat, ...st.chats]
      const messagesByChatId = { ...st.messagesByChatId, [chat.id]: [] }
      const state = { chats, messagesByChatId, activeChatId: chat.id }
      savePersistedState({ ...st, ...state })
      return state
    })
    return chat
  },
  setActiveChat: (id) => {
    set((s) => {
      savePersistedState({ ...s, activeChatId: id })
      return { activeChatId: id }
    })
  },
  renameChat: (id, title) => {
    set((s) => {
      const chats = s.chats.map((c) => c.id === id ? { ...c, title } : c)
      savePersistedState({ ...s, chats })
      return { chats }
    })
  },
  deleteChat: (id) => {
    // 墓碑：IndexedDB 还没读回来就删掉的对话，要记一笔。否则 hydrate 时
    // mergeMessages 拿库里那份旧数据当底、只增不减，被删的对话会原地复活
    // （0802 codex 审计发现的竞态；窗口很短但删除被撤销这种事一次都不能有）
    if (!bigHydrated) deletedBeforeHydrate.add(id)
    set((s) => {
      const chats = s.chats.filter((c) => c.id !== id)
      const messagesByChatId = { ...s.messagesByChatId }
      delete messagesByChatId[id]
      const summariesByChatId = { ...s.summariesByChatId }
      delete summariesByChatId[id]
      const activeChatId = s.activeChatId === id ? (chats[0]?.id ?? null) : s.activeChatId
      savePersistedState({ ...s, chats, messagesByChatId, summariesByChatId, activeChatId })
      return { chats, messagesByChatId, summariesByChatId, activeChatId }
    })
  },
  updateChatModel: (chatId, model) => {
    set((s) => {
      const chats = s.chats.map((c) => c.id === chatId ? { ...c, model } : c)
      savePersistedState({ ...s, chats })
      return { chats }
    })
  },
  updateChatConnection: (chatId, connectionId) => {
    set((s) => {
      const conn = s.connections.find((c) => c.id === connectionId)
      const chats = s.chats.map((c) => c.id === chatId
        ? { ...c, connectionId, model: conn?.defaultModel || c.model }
        : c)
      savePersistedState({ ...s, chats })
      return { chats }
    })
  },
  getActiveChat: () => {
    const s = get()
    return s.chats.find((c) => c.id === s.activeChatId) || null
  },

  // ─── messages ─────────────────────────────────────────────────────
  getMessages: (chatId) => {
    const s = get()
    return s.messagesByChatId[chatId] || []
  },
  addMessage: (chatId, msg) => {
    const fullMsg = { id: uuid(), createdAt: Date.now(), ...msg }
    set((s) => {
      const existing = s.messagesByChatId[chatId] || []
      const messagesByChatId = { ...s.messagesByChatId, [chatId]: [...existing, fullMsg] }
      const chats = s.chats.map((c) => c.id === chatId ? { ...c, updatedAt: Date.now() } : c)
      savePersistedState({ ...s, messagesByChatId, chats })
      return { messagesByChatId, chats }
    })
    return fullMsg
  },
  updateMessage: (chatId, msgId, patch) => {
    set((s) => {
      const oldMsgs = s.messagesByChatId[chatId] || []
      const msgs = oldMsgs.map((m) =>
        m.id === msgId ? { ...m, ...patch } : m
      )
      const messagesByChatId = { ...s.messagesByChatId, [chatId]: msgs }
      const chat = s.chats.find((c) => c.id === chatId)
      const cursorIdx = chat?.compactedThrough ? oldMsgs.findIndex((m) => m.id === chat.compactedThrough) : -1
      const changedIdx = oldMsgs.findIndex((m) => m.id === msgId)
      const invalidates = cursorIdx >= 0 && changedIdx >= 0 && changedIdx <= cursorIdx
      const chats = invalidates ? s.chats.map((c) => c.id === chatId ? { ...c, compactedThrough: null, compactionVersion: (c.compactionVersion || 0) + 1 } : c) : s.chats
      const summariesByChatId = invalidates ? { ...s.summariesByChatId, [chatId]: '' } : s.summariesByChatId
      // 流式期间跳过落盘：每个 chunk 全量 JSON.stringify + setItem 会让长回复明显卡顿，
      // 最终 streaming:false 的更新会正常持久化
      if (!patch.streaming || invalidates) savePersistedState({ ...s, messagesByChatId, chats, summariesByChatId })
      return { messagesByChatId, chats, summariesByChatId }
    })
  },
  // 删除单条消息（目前只给 [错误] 气泡的删除钮用）
  deleteMessage: (chatId, msgId) => {
    set((s) => {
      const oldMsgs = s.messagesByChatId[chatId] || []
      const chat = s.chats.find((c) => c.id === chatId)
      const cursorIdx = chat?.compactedThrough ? oldMsgs.findIndex((m) => m.id === chat.compactedThrough) : -1
      const deletedIdx = oldMsgs.findIndex((m) => m.id === msgId)
      const invalidates = cursorIdx >= 0 && deletedIdx >= 0 && deletedIdx <= cursorIdx
      const msgs = oldMsgs.filter((m) => m.id !== msgId)
      const messagesByChatId = { ...s.messagesByChatId, [chatId]: msgs }
      const chats = invalidates ? s.chats.map((c) => c.id === chatId ? { ...c, compactedThrough: null, compactionVersion: (c.compactionVersion || 0) + 1 } : c) : s.chats
      const summariesByChatId = invalidates ? { ...s.summariesByChatId, [chatId]: '' } : s.summariesByChatId
      savePersistedState({ ...s, messagesByChatId, chats, summariesByChatId })
      return { messagesByChatId, chats, summariesByChatId }
    })
  },
  truncateMessagesFrom: (chatId, msgId) => {
    set((s) => {
      const msgs = s.messagesByChatId[chatId] || []
      const idx = msgs.findIndex((m) => m.id === msgId)
      const truncated = idx >= 0 ? msgs.slice(0, idx) : msgs
      const messagesByChatId = { ...s.messagesByChatId, [chatId]: truncated }
      const chat = s.chats.find((c) => c.id === chatId)
      const cursorIdx = chat?.compactedThrough ? msgs.findIndex((m) => m.id === chat.compactedThrough) : -1
      const invalidates = idx >= 0 && cursorIdx >= 0 && idx <= cursorIdx
      const chats = invalidates ? s.chats.map((c) => c.id === chatId ? { ...c, compactedThrough: null, compactionVersion: (c.compactionVersion || 0) + 1 } : c) : s.chats
      const summariesByChatId = invalidates ? { ...s.summariesByChatId, [chatId]: '' } : s.summariesByChatId
      savePersistedState({ ...s, messagesByChatId, chats, summariesByChatId })
      return { messagesByChatId, chats, summariesByChatId }
    })
  },
  removeLastEmptyAssistant: (chatId) => {
    set((s) => {
      const msgs = (s.messagesByChatId[chatId] || []).filter((m) => m.content !== '')
      const messagesByChatId = { ...s.messagesByChatId, [chatId]: msgs }
      savePersistedState({ ...s, messagesByChatId })
      return { messagesByChatId }
    })
  },
  touchChat: (chatId) => {
    set((s) => {
      const chats = s.chats.map((c) => c.id === chatId ? { ...c, updatedAt: Date.now() } : c)
      savePersistedState({ ...s, chats })
      return { chats }
    })
  },
  applyContextLimit: (messages) => {
    const { contextLimit } = get()
    const mode = contextLimit?.mode || 'none'
    if (mode === 'none') return messages
    // 锚点式裁剪：切点按 step 对齐，只在跨过边界时才移动。
    // 滑动窗口（slice(-max)）每条消息都改变开头，破坏 prompt 缓存的前缀匹配；
    // 量化切点让前缀在多轮内保持稳定，代价是窗口比 max 略小。
    if (mode === 'rounds') {
      const max = (contextLimit.maxRounds || 50) * 2
      if (messages.length <= max) return messages
      const step = Math.max(2, Math.floor(max / 4) * 2)
      const cut = Math.ceil((messages.length - max) / step) * step
      return messages.slice(cut)
    }
    if (mode === 'tokens') {
      const maxTok = contextLimit.maxTokens || 30000
      let total = 0
      let minCut = 0
      for (let i = messages.length - 1; i >= 0; i--) {
        total += estimateTokens(messages[i].content)
        if (total > maxTok && i < messages.length - 1) { minCut = i + 1; break }
      }
      if (minCut === 0) return messages
      const step = 8
      let cut = Math.ceil(minCut / step) * step
      if (cut >= messages.length) cut = messages.length - 1
      return messages.slice(cut)
    }
    return messages
  },

  // ─── summaries (context compaction) ───────────────────────────────
  getSummary: (chatId) => get().summariesByChatId[chatId] || null,
  setSummary: (chatId, summary) => {
    set((s) => {
      const summariesByChatId = { ...s.summariesByChatId, [chatId]: summary }
      // 手动清空后下次从头重建，与界面上的提示保持一致。
      const chats = summary ? s.chats : s.chats.map((c) => c.id === chatId
        ? { ...c, compactedThrough: null, compactionVersion: (c.compactionVersion || 0) + 1 }
        : c)
      savePersistedState({ ...s, summariesByChatId, chats })
      return { summariesByChatId, chats }
    })
  },
  // 笔记和游标同一次进 store；失败路径不调这个 action，游标也不会前移。
  commitCompaction: (chatId, summary, compactedThrough, expectedVersion = 0) => {
    set((s) => {
      const chat = s.chats.find((c) => c.id === chatId)
      // 压缩等模型时历史可能被编辑；版本变了就丢弃旧结果，不让它把 dirty 状态覆盖回去。
      if (!chat || (chat.compactionVersion || 0) !== expectedVersion) return {}
      const summariesByChatId = { ...s.summariesByChatId, [chatId]: summary }
      const chats = s.chats.map((c) => c.id === chatId ? { ...c, compactedThrough } : c)
      savePersistedState({ ...s, summariesByChatId, chats })
      return { summariesByChatId, chats }
    })
  },

  // ─── settings ─────────────────────────────────────────────────────
  setGlobalInstruction: (v) => {
    set((s) => { savePersistedState({ ...s, globalInstruction: v }); return { globalInstruction: v } })
  },
  setGenerationConfig: (patch) => {
    set((s) => {
      const generationConfig = { ...s.generationConfig, ...patch }
      savePersistedState({ ...s, generationConfig })
      return { generationConfig }
    })
  },
  setContextLimit: (patch) => {
    set((s) => {
      const contextLimit = { ...s.contextLimit, ...patch }
      savePersistedState({ ...s, contextLimit })
      return { contextLimit }
    })
  },
  setSearchConfig: (patch) => {
    set((s) => {
      const searchConfig = { ...s.searchConfig, ...patch }
      savePersistedState({ ...s, searchConfig })
      return { searchConfig }
    })
  },
  setAutoTools: (v) => {
    set((s) => { savePersistedState({ ...s, autoTools: v }); return { autoTools: v } })
  },
  setImageDescriptions: (v) => {
    set((s) => { savePersistedState({ ...s, imageDescriptions: v }); return { imageDescriptions: v } })
  },
  setMoonMemory: (patch) => {
    set((s) => {
      const moonMemory = { ...s.moonMemory, ...patch }
      savePersistedState({ ...s, moonMemory })
      return { moonMemory }
    })
  },
  setInjectMode: (v) => set((s) => { savePersistedState({ ...s, injectMode: v }); return { injectMode: v } }),
  setInjectPrompt: (v) => set((s) => { savePersistedState({ ...s, injectPrompt: v }); return { injectPrompt: v } }),
  addMemoryItem: (content) => {
    const item = { id: uuid(), content, enabled: true, createdAt: Date.now() }
    set((s) => {
      const memoryItems = [...s.memoryItems, item]
      savePersistedState({ ...s, memoryItems })
      return { memoryItems }
    })
  },
  toggleMemoryItem: (id) => {
    set((s) => {
      const memoryItems = s.memoryItems.map((m) => m.id === id ? { ...m, enabled: !m.enabled } : m)
      savePersistedState({ ...s, memoryItems })
      return { memoryItems }
    })
  },
  deleteMemoryItem: (id) => {
    set((s) => {
      const memoryItems = s.memoryItems.filter((m) => m.id !== id)
      savePersistedState({ ...s, memoryItems })
      return { memoryItems }
    })
  },
  recordTokenUsage: (connId, usage) => {
    if (!usage || !connId) return
    set((s) => {
      const prev = s.tokenStats[connId] || { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 }
      // 按天分桶（本地日期=北京时间），只留最近 14 天，供「今日用量」展示
      const dayKey = new Date().toLocaleDateString('sv')
      const days = { ...(prev.days || {}) }
      const d = days[dayKey] || { promptTokens: 0, completionTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, calls: 0 }
      days[dayKey] = {
        promptTokens: d.promptTokens + (usage.promptTokens || 0),
        completionTokens: d.completionTokens + (usage.completionTokens || 0),
        cachedTokens: d.cachedTokens + (usage.cachedTokens || 0),
        cacheWriteTokens: d.cacheWriteTokens + (usage.cacheWriteTokens || 0),
        calls: d.calls + 1,
      }
      for (const k of Object.keys(days).sort().slice(0, -14)) delete days[k]
      const tokenStats = {
        ...s.tokenStats,
        [connId]: {
          promptTokens: prev.promptTokens + (usage.promptTokens || 0),
          completionTokens: prev.completionTokens + (usage.completionTokens || 0),
          totalTokens: prev.totalTokens + (usage.totalTokens || 0),
          cachedTokens: (prev.cachedTokens || 0) + (usage.cachedTokens || 0),
          cacheWriteTokens: (prev.cacheWriteTokens || 0) + (usage.cacheWriteTokens || 0),
          calls: prev.calls + 1,
          lastUsed: Date.now(),
          days,
        },
      }
      savePersistedState({ ...s, tokenStats })
      return { tokenStats }
    })
  },
}))

// ─── 聊天记录搬家 / 读回 ──────────────────────────────────────────────────
// 两条路：
//   1. 老数据还在 localStorage 里（升级后第一次打开）→ 直接用（不闪空白），
//      写进 IndexedDB，成功之后再把大件从 localStorage 里抹掉——那一步才真正腾出配额。
//   2. 已经搬过家 → 异步从 IndexedDB 读回来。开屏动画大约 1 秒，够读完。
const hasLegacyBig = BIG_KEYS.some((k) => persisted[k] !== undefined)

// 读回来之前如果她已经发了消息，按 id 并起来，别让先到的把后到的盖掉
function mergeMessages(loaded, current) {
  const out = { ...loaded }
  for (const cid of Object.keys(current || {})) {
    const cur = current[cid]
    if (!Array.isArray(cur) || !cur.length) continue
    const base = Array.isArray(out[cid]) ? out[cid] : []
    const seen = new Set(base.map((m) => m?.id))
    out[cid] = base.concat(cur.filter((m) => !seen.has(m?.id)))
  }
  return out
}

if (hasLegacyBig) {
  bigHydrated = true
  legacyKeep = true
  useStore.setState({ bigReady: true })
  const snapshot = {}
  for (const k of BIG_KEYS) snapshot[k] = initialState[k]
  const countMsgs = (m) => Object.values(m || {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0)
  Promise.all(BIG_KEYS.map((k) => bigSet(k, snapshot[k])))
    // 读回来数一遍再删旧的。搬家只有一次机会，写进去了没有必须亲眼确认，
    // 不能只信 bigSet 的 resolve——localStorage 那份删掉就没有第二份了。
    .then(() => bigGet('messagesByChatId'))
    .then((back) => {
      const want = countMsgs(snapshot.messagesByChatId)
      const got = countMsgs(back)
      if (got < want) throw new Error(`搬家校验不过：写进去 ${want} 条，读回来 ${got} 条`)
      legacyKeep = false
      const { activePanel, bigReady, ...rest } = useStore.getState()
      for (const k of BIG_KEYS) delete rest[k]
      saveSettings(rest)
      console.info(`[言叽] ${want} 条聊天记录已搬进 IndexedDB，localStorage 腾空`)
    })
    .catch((err) => {
      // 搬家失败就当 IndexedDB 不存在，继续用老办法，数据一条不动
      console.error('[言叽] 聊天记录搬家失败，继续留在 localStorage', err)
      bigFailed = true
    })
} else {
  Promise.all(BIG_KEYS.map((k) => bigGet(k)))
    .then(([messages, summaries]) => {
      const loadedMsgs = sweepStaleStreaming(messages && typeof messages === 'object' ? messages : {})
      const loadedSums = summaries && typeof summaries === 'object' ? summaries : {}
      const cur = useStore.getState()
      bigHydrated = true
      // 读回来之前删掉的对话，从库里那份旧数据上再扣一次——不然「只增不减」的合并会让它复活
      for (const id of deletedBeforeHydrate) { delete loadedMsgs[id]; delete loadedSums[id] }
      useStore.setState({
        messagesByChatId: mergeMessages(loadedMsgs, cur.messagesByChatId),
        summariesByChatId: { ...loadedSums, ...cur.summariesByChatId },
        bigReady: true,
      })
      // 读回来之前发生的写入都被挡掉了（那时状态是空的，回写会盖掉真数据）。
      // 现在并好了，补落一次盘，免得那几条一直只活在内存里。
      if (Object.values(cur.messagesByChatId || {}).some((a) => Array.isArray(a) && a.length)) {
        savePersistedState(useStore.getState())
      }
    })
    .catch((err) => {
      console.error('[言叽] 读取 IndexedDB 失败，退回 localStorage', err)
      bigFailed = true
      bigHydrated = true
      useStore.setState({ bigReady: true })
      showToast('聊天记录仓库打不开，暂时退回旧方式——告诉涟言', 'error', 8000)
    })
}

// 备份导出用：设置在 localStorage、聊天记录在 IndexedDB，得合成一份完整快照。
// 格式和搬家前的老 blob 完全一致——所以恢复时照旧写回 localStorage 再刷新就行，
// 刷新后会走上面的「搬家」分支，自动把聊天记录塞回 IndexedDB。
// 没读完聊天记录时返回 null，宁可不备份也不能导出一份空的把好备份覆盖掉。
export function buildBackupJson() {
  const state = useStore.getState()
  if (!state.bigReady) return null
  const out = {}
  for (const k of persistedKeys) if (state[k] !== undefined) out[k] = state[k]
  return JSON.stringify(out)
}

// 备份恢复用：不能再把整份 JSON 塞回 localStorage——备份体积迟早超过 5MB，
// 那样恢复会当场 QuotaExceededError。拆开写：设置进 localStorage，聊天记录直接进 IndexedDB。
// 调用方负责在 await 之后刷新页面。
export async function restoreFromBackupJson(text) {
  const parsed = JSON.parse(text) || {}
  if (bigFailed) { localStorage.setItem(LOCAL_KEY, JSON.stringify(parsed)); return }
  await Promise.all(BIG_KEYS.map((k) => bigSet(k, parsed[k] && typeof parsed[k] === 'object' ? parsed[k] : {})))
  const settings = {}
  for (const k of persistedKeys) {
    if (BIG_KEYS.includes(k)) continue
    if (parsed[k] !== undefined) settings[k] = parsed[k]
  }
  localStorage.setItem(LOCAL_KEY, JSON.stringify(settings))
}

// 关页面/切后台时把还在防抖窗口里的那一版赶紧写下去
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushBig() })
  window.addEventListener('pagehide', flushBig)
}
