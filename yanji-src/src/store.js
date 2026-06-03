import { create } from 'zustand'
import { uuid, estimateTokens } from './utils'

const LOCAL_KEY = 'llm_hub_state_v1'

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
  contextLimit: { mode: 'none', maxRounds: 50, maxTokens: 30000 },
  searchConfig: { provider: null, apiKey: null },
  avatarConfig: { mode: 'icon', userImage: null, assistantImage: null },
  autoTools: true,
  moonMemory: {
    enabled: false,
    baseUrl: 'https://memory.ravenlove.cc',
    apiToken: '',
    limit: 5,
  },
  theme: 'claude',
  // UI-only (not persisted)
  activePanel: 'roost',
}

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed || {}
  } catch {
    return {}
  }
}

function savePersistedState(state) {
  try {
    const { activePanel, ...rest } = state
    localStorage.setItem(LOCAL_KEY, JSON.stringify(rest))
  } catch {}
}

const persistedKeys = [
  'connections', 'activeConnectionId', 'chats', 'activeChatId',
  'messagesByChatId', 'globalInstruction', 'summariesByChatId',
  'generationConfig', 'memoryItems', 'tokenStats', 'contextLimit',
  'searchConfig', 'avatarConfig', 'autoTools', 'moonMemory', 'theme',
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

export const useStore = create((set, get) => ({
  ...initialState,

  // ─── panel navigation ─────────────────────────────────────────────
  setActivePanel: (panel) => set({ activePanel: panel }),
  setTheme: (theme) => set((s) => { savePersistedState({ ...s, theme }); return { theme } }),
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
    set((s) => {
      const chats = s.chats.filter((c) => c.id !== id)
      const messagesByChatId = { ...s.messagesByChatId }
      delete messagesByChatId[id]
      const activeChatId = s.activeChatId === id ? (chats[0]?.id ?? null) : s.activeChatId
      savePersistedState({ ...s, chats, messagesByChatId, activeChatId })
      return { chats, messagesByChatId, activeChatId }
    })
  },
  updateChatModel: (chatId, model) => {
    set((s) => {
      const chats = s.chats.map((c) => c.id === chatId ? { ...c, model } : c)
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
      const msgs = (s.messagesByChatId[chatId] || []).map((m) =>
        m.id === msgId ? { ...m, ...patch } : m
      )
      const messagesByChatId = { ...s.messagesByChatId, [chatId]: msgs }
      savePersistedState({ ...s, messagesByChatId })
      return { messagesByChatId }
    })
  },
  truncateMessagesFrom: (chatId, msgId) => {
    set((s) => {
      const msgs = s.messagesByChatId[chatId] || []
      const idx = msgs.findIndex((m) => m.id === msgId)
      const truncated = idx >= 0 ? msgs.slice(0, idx) : msgs
      const messagesByChatId = { ...s.messagesByChatId, [chatId]: truncated }
      savePersistedState({ ...s, messagesByChatId })
      return { messagesByChatId }
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
    if (mode === 'rounds') {
      const max = (contextLimit.maxRounds || 50) * 2
      return messages.length > max ? messages.slice(-max) : messages
    }
    if (mode === 'tokens') {
      const maxTok = contextLimit.maxTokens || 30000
      let total = 0
      const result = []
      for (let i = messages.length - 1; i >= 0; i--) {
        const est = estimateTokens(messages[i].content)
        if (total + est > maxTok && result.length > 0) break
        total += est
        result.unshift(messages[i])
      }
      return result
    }
    return messages
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
  setMoonMemory: (patch) => {
    set((s) => {
      const moonMemory = { ...s.moonMemory, ...patch }
      savePersistedState({ ...s, moonMemory })
      return { moonMemory }
    })
  },
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
      const tokenStats = {
        ...s.tokenStats,
        [connId]: {
          promptTokens: prev.promptTokens + (usage.promptTokens || 0),
          completionTokens: prev.completionTokens + (usage.completionTokens || 0),
          totalTokens: prev.totalTokens + (usage.totalTokens || 0),
          calls: prev.calls + 1,
          lastUsed: Date.now(),
        },
      }
      savePersistedState({ ...s, tokenStats })
      return { tokenStats }
    })
  },
}))
