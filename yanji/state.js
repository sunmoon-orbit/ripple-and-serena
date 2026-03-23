(function () {
  "use strict";

  const LOCAL_KEY = "llm_hub_state_v1";

  const defaultState = {
    connections: [],
    activeConnectionId: null,
    chats: [],
    activeChatId: null,
    messagesByChatId: {},
    globalInstruction: "",
    summariesByChatId: {},
    generationConfig: {
      temperature: 0.7,
      maxTokens: 4096,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
    // 记忆条目：每条可单独启用/禁用
    memoryItems: [],
    // Token统计：按连接ID记录
    tokenStats: {},
    // 上下文限制配置
    contextLimit: {
      mode: "none", // none / rounds / tokens
      maxRounds: 50,
      maxTokens: 30000,
    },
    // 自动记忆配置
    autoMemory: {
      enabled: false,
      extractAfterRounds: 3, // 每隔几轮对话提取一次
    },
    // RAG 向量记忆配置
    ragMemory: {
      enabled: false, // 是否启用 RAG 记忆
    },
    // 联网搜索配置
    searchConfig: {
      provider: null, // serper / tavily
      apiKey: null,
    },
    // 自动工具调用
    autoTools: true, // 是否让模型自动决定何时搜索/获取位置
  };

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return (
      Date.now().toString(16) +
      Math.random().toString(16).slice(2) +
      Math.random().toString(16).slice(2)
    );
  }

  function normalizeState(parsed) {
    const state = Object.assign({}, defaultState, parsed || {});
    if (!Array.isArray(state.connections)) state.connections = [];
    if (!Array.isArray(state.chats)) state.chats = [];
    if (!state.messagesByChatId || typeof state.messagesByChatId !== "object") {
      state.messagesByChatId = {};
    }
    if (!state.summariesByChatId || typeof state.summariesByChatId !== "object") {
      state.summariesByChatId = {};
    }
    if (!state.generationConfig || typeof state.generationConfig !== "object") {
      state.generationConfig = Object.assign({}, defaultState.generationConfig);
    } else {
      state.generationConfig = Object.assign(
        {},
        defaultState.generationConfig,
        state.generationConfig
      );
    }
    // 记忆条目
    if (!Array.isArray(state.memoryItems)) state.memoryItems = [];
    // Token统计
    if (!state.tokenStats || typeof state.tokenStats !== "object") {
      state.tokenStats = {};
    }
    // 上下文限制
    if (!state.contextLimit || typeof state.contextLimit !== "object") {
      state.contextLimit = {
        mode: "none",
        maxRounds: 50,
        maxTokens: 30000,
      };
    }
    return state;
  }

  function loadState() {
    try {
      const raw = window.localStorage.getItem(LOCAL_KEY);
      if (!raw) return normalizeState(null);
      const parsed = JSON.parse(raw);
      return normalizeState(parsed);
    } catch (e) {
      console.error("读取本地数据失败，将使用默认状态", e);
      return normalizeState(null);
    }
  }

  function saveState(state) {
    try {
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("保存本地数据失败", e);
    }
  }

  function getActiveConnection(state) {
    if (!state.activeConnectionId) return null;
    return (
      state.connections.find((c) => c.id === state.activeConnectionId) || null
    );
  }

  function setActiveConnection(state, id) {
    state.activeConnectionId = id;
  }

  function getActiveChat(state) {
    if (!state.activeChatId) return null;
    return state.chats.find((c) => c.id === state.activeChatId) || null;
  }

  function getMessages(state, chatId) {
    if (!chatId) return [];
    return state.messagesByChatId[chatId] || [];
  }

  function ensureInitialConnection(state) {
    if (state.connections.length || state.activeConnectionId) return state;
    const geminiUrl = "https://generativelanguage.googleapis.com/v1beta";
    const conn = {
      id: uuid(),
      name: "示例 · Gemini",
      provider: "gemini",
      baseUrl: geminiUrl,
      apiKey: "",
      defaultModel: "gemini-2.0-flash",
      modelList: ["gemini-2.0-flash", "gemini-2.0-pro"],
    };
    state.connections.push(conn);
    state.activeConnectionId = conn.id;
    return state;
  }

  window.LLMHubState = {
    LOCAL_KEY,
    defaultState,
    uuid,
    loadState,
    saveState,
    getActiveConnection,
    setActiveConnection,
    getActiveChat,
    getMessages,
    ensureInitialConnection,
  };
})();