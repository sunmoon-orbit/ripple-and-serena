(function () {
  "use strict";

  function normalizeProvider(raw) {
    const v = (raw || "").toString().toLowerCase();
    if (v.includes("gemini")) return "gemini";
    if (v.includes("anthropic") || v.includes("claude")) return "anthropic";
    if (v.includes("openai")) return "openai";
    if (v.includes("deepseek")) return "openai";
    return "openai";
  }

  const {
    loadState,
    saveState,
    getActiveConnection,
    ensureInitialConnection,
    getMessages,
  } = window.LLMHubState;

  let state = ensureInitialConnection(loadState());
  const els = {};

  function initDomRefs() {
    els.globalInstructionInput = document.getElementById(
      "globalInstructionInput"
    );
    els.temperatureSlider = document.getElementById("temperatureSlider");
    els.maxTokensSlider = document.getElementById("maxTokensSlider");
    els.frequencyPenaltySlider = document.getElementById("frequencyPenaltySlider");
    els.presencePenaltySlider = document.getElementById("presencePenaltySlider");
    els.temperatureValue = document.getElementById("temperatureValue");
    els.maxTokensValue = document.getElementById("maxTokensValue");
    els.frequencyPenaltyValue = document.getElementById("frequencyPenaltyValue");
    els.presencePenaltyValue = document.getElementById("presencePenaltyValue");

    els.summaryChatSelect = document.getElementById("summaryChatSelect");
    els.chatSummaryInput = document.getElementById("chatSummaryInput");
    els.generateSummaryButton = document.getElementById(
      "generateSummaryButton"
    );
    els.saveSummaryButton = document.getElementById("saveSummaryButton");

    // 记忆条目相关
    els.memoryItemsList = document.getElementById("memoryItemsList");
    els.addMemoryItemButton = document.getElementById("addMemoryItemButton");
    els.memoryItemModal = document.getElementById("memoryItemModal");
    els.memoryItemModalTitle = document.getElementById("memoryItemModalTitle");
    els.memoryItemContent = document.getElementById("memoryItemContent");
    els.memoryItemSaveButton = document.getElementById("memoryItemSaveButton");
    els.memoryItemCancelButton = document.getElementById("memoryItemCancelButton");
    els.closeMemoryItemModal = document.getElementById("closeMemoryItemModal");

    // 上下文限制相关
    els.contextLimitMode = document.getElementById("contextLimitMode");
    els.contextLimitRoundsField = document.getElementById("contextLimitRoundsField");
    els.contextLimitTokensField = document.getElementById("contextLimitTokensField");
    els.maxRoundsSlider = document.getElementById("maxRoundsSlider");
    els.maxRoundsValue = document.getElementById("maxRoundsValue");
    els.maxContextTokensSlider = document.getElementById("maxContextTokensSlider");
    els.maxContextTokensValue = document.getElementById("maxContextTokensValue");
    
    // 自动记忆相关
    els.autoMemoryEnabled = document.getElementById("autoMemoryEnabled");
    els.autoMemoryIntervalField = document.getElementById("autoMemoryIntervalField");
    els.autoMemoryIntervalSlider = document.getElementById("autoMemoryIntervalSlider");
    els.autoMemoryIntervalValue = document.getElementById("autoMemoryIntervalValue");
    
    // RAG 自然记忆相关
    els.ragMemoryEnabled = document.getElementById("ragMemoryEnabled");
    els.ragMemorySection = document.getElementById("ragMemorySection");
    els.ragMemoriesList = document.getElementById("ragMemoriesList");
    els.refreshRagMemoriesBtn = document.getElementById("refreshRagMemoriesBtn");
    els.addRagMemoryBtn = document.getElementById("addRagMemoryBtn");
  }

  function renderGlobalInstruction() {
    els.globalInstructionInput.value = state.globalInstruction || "";
  }

  function renderGenerationConfig() {
    const cfg = state.generationConfig || {};
    if (els.temperatureSlider) {
      const v = typeof cfg.temperature === "number" ? cfg.temperature : 0.7;
      els.temperatureSlider.value = v;
      if (els.temperatureValue) {
        els.temperatureValue.textContent = v.toFixed(2);
      }
    }
    if (els.maxTokensSlider) {
      const v = typeof cfg.maxTokens === "number" ? cfg.maxTokens : 4096;
      els.maxTokensSlider.value = v;
      if (els.maxTokensValue) {
        els.maxTokensValue.textContent = String(Math.round(v));
      }
    }
    if (els.frequencyPenaltySlider) {
      const v = typeof cfg.frequencyPenalty === "number" ? cfg.frequencyPenalty : 0;
      els.frequencyPenaltySlider.value = v;
      if (els.frequencyPenaltyValue) {
        els.frequencyPenaltyValue.textContent = v.toFixed(2);
      }
    }
    if (els.presencePenaltySlider) {
      const v = typeof cfg.presencePenalty === "number" ? cfg.presencePenalty : 0;
      els.presencePenaltySlider.value = v;
      if (els.presencePenaltyValue) {
        els.presencePenaltyValue.textContent = v.toFixed(2);
      }
    }
  }

  function renderContextLimit() {
    const cfg = state.contextLimit || { mode: "none", maxRounds: 50, maxTokens: 30000 };
    
    if (els.contextLimitMode) {
      els.contextLimitMode.value = cfg.mode || "none";
    }
    
    // 显示/隐藏对应的设置字段
    if (els.contextLimitRoundsField) {
      els.contextLimitRoundsField.style.display = cfg.mode === "rounds" ? "block" : "none";
    }
    if (els.contextLimitTokensField) {
      els.contextLimitTokensField.style.display = cfg.mode === "tokens" ? "block" : "none";
    }
    
    if (els.maxRoundsSlider) {
      const v = typeof cfg.maxRounds === "number" ? cfg.maxRounds : 50;
      els.maxRoundsSlider.value = v;
      if (els.maxRoundsValue) {
        els.maxRoundsValue.textContent = String(v);
      }
    }
    
    if (els.maxContextTokensSlider) {
      const v = typeof cfg.maxTokens === "number" ? cfg.maxTokens : 30000;
      els.maxContextTokensSlider.value = v;
      if (els.maxContextTokensValue) {
        els.maxContextTokensValue.textContent = String(v);
      }
    }
  }

  function renderAutoMemory() {
    const cfg = state.autoMemory || { enabled: false, extractAfterRounds: 3 };
    
    if (els.autoMemoryEnabled) {
      els.autoMemoryEnabled.checked = cfg.enabled || false;
    }
    
    // 显示/隐藏频率设置
    if (els.autoMemoryIntervalField) {
      els.autoMemoryIntervalField.style.display = cfg.enabled ? "block" : "none";
    }
    
    if (els.autoMemoryIntervalSlider) {
      const v = typeof cfg.extractAfterRounds === "number" ? cfg.extractAfterRounds : 3;
      els.autoMemoryIntervalSlider.value = v;
      if (els.autoMemoryIntervalValue) {
        els.autoMemoryIntervalValue.textContent = String(v);
      }
    }
  }

  // ========== RAG 自然记忆 ==========
  function renderRagMemory() {
    const cfg = state.ragMemory || { enabled: false };
    
    if (els.ragMemoryEnabled) {
      els.ragMemoryEnabled.checked = cfg.enabled || false;
    }
    
    // 显示/隐藏记忆管理区
    if (els.ragMemorySection) {
      els.ragMemorySection.style.display = cfg.enabled ? "block" : "none";
    }
    
    // 如果启用了，加载记忆列表
    if (cfg.enabled) {
      loadRagMemories();
    }
  }

  async function loadRagMemories() {
    if (!els.ragMemoriesList || !window.LLMHubRAG) return;
    
    els.ragMemoriesList.innerHTML = '<div class="empty-text">加载中...</div>';
    
    try {
      const userId = await window.LLMHubRAG.getCurrentUserId();
      if (!userId) {
        els.ragMemoriesList.innerHTML = '<div class="empty-text">请先登录 Supabase</div>';
        return;
      }
      
      const memories = await window.LLMHubRAG.getAllMemories(userId);
      
      if (!memories || memories.length === 0) {
        els.ragMemoriesList.innerHTML = '<div class="empty-text">还没有自然记忆，聊几轮后会自动形成。</div>';
        return;
      }
      
      els.ragMemoriesList.innerHTML = "";
      
      memories.forEach((mem) => {
        const div = document.createElement("div");
        div.className = "memory-item rag-memory";
        div.dataset.id = mem.id;
        
        // 记忆强度指示器
        const strength = document.createElement("span");
        strength.className = "memory-strength";
        const strengthLevel = Math.min(5, Math.max(1, Math.ceil((mem.importance || 0.5) * 5)));
        strength.textContent = "●".repeat(strengthLevel) + "○".repeat(5 - strengthLevel);
        strength.title = `重要性: ${((mem.importance || 0.5) * 100).toFixed(0)}%，触发次数: ${mem.access_count || 0}`;
        
        const content = document.createElement("div");
        content.className = "memory-content";
        content.textContent = mem.content;
        
        // 时间信息
        const time = document.createElement("span");
        time.className = "memory-time";
        const date = new Date(mem.created_at);
        time.textContent = date.toLocaleDateString();
        
        const actions = document.createElement("div");
        actions.className = "memory-actions";
        
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "small-button";
        delBtn.textContent = "删除";
        delBtn.addEventListener("click", () => deleteRagMemory(mem.id));
        
        actions.appendChild(delBtn);
        
        div.appendChild(strength);
        div.appendChild(content);
        div.appendChild(time);
        div.appendChild(actions);
        els.ragMemoriesList.appendChild(div);
      });
    } catch (e) {
      console.error("加载 RAG 记忆失败:", e);
      els.ragMemoriesList.innerHTML = '<div class="empty-text">加载失败：' + e.message + '</div>';
    }
  }

  async function deleteRagMemory(memoryId) {
    if (!window.confirm("确定要删除这条记忆吗？")) return;
    
    try {
      const success = await window.LLMHubRAG.deleteMemory(memoryId);
      if (success) {
        loadRagMemories();
      } else {
        alert("删除失败");
      }
    } catch (e) {
      alert("删除失败：" + e.message);
    }
  }

  async function addRagMemoryManually() {
    const content = prompt("输入要记住的内容：");
    if (!content || !content.trim()) return;
    
    if (!window.LLMHubRAG) {
      alert("RAG 模块未加载");
      return;
    }
    
    try {
      const userId = await window.LLMHubRAG.getCurrentUserId();
      if (!userId) {
        alert("请先登录 Supabase");
        return;
      }
      
      const saved = await window.LLMHubRAG.addMemory(
        content.trim(),
        state.connections,
        userId,
        0.7
      );
      
      if (saved) {
        loadRagMemories();
      } else {
        alert("添加失败");
      }
    } catch (e) {
      alert("添加失败：" + e.message);
    }
  }

  // ========== 记忆条目管理 ==========
  let editingMemoryItemId = null;

  function renderMemoryItems() {
    if (!els.memoryItemsList) return;
    els.memoryItemsList.innerHTML = "";

    if (!state.memoryItems || !state.memoryItems.length) {
      els.memoryItemsList.innerHTML = '<div class="empty-text">还没有记忆条目，点下方按钮添加。</div>';
      return;
    }

    state.memoryItems.forEach((item) => {
      const div = document.createElement("div");
      let className = "memory-item";
      if (item.enabled === false) className += " disabled";
      if (item.autoExtracted) className += " auto-extracted";
      div.className = className;
      div.dataset.id = item.id;

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "memory-toggle";
      toggle.textContent = item.enabled === false ? "○" : "●";
      toggle.title = item.enabled === false ? "点击启用" : "点击禁用";
      toggle.addEventListener("click", () => toggleMemoryItem(item.id));

      const content = document.createElement("div");
      content.className = "memory-content";
      content.textContent = item.content;
      
      // 自动提取标记
      if (item.autoExtracted) {
        const badge = document.createElement("span");
        badge.className = "memory-auto-badge";
        badge.textContent = "自动";
        content.appendChild(badge);
      }

      const actions = document.createElement("div");
      actions.className = "memory-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "small-button";
      editBtn.textContent = "编辑";
      editBtn.addEventListener("click", () => openMemoryItemModal(item));

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "small-button";
      delBtn.textContent = "删除";
      delBtn.addEventListener("click", () => deleteMemoryItem(item.id));

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      div.appendChild(toggle);
      div.appendChild(content);
      div.appendChild(actions);
      els.memoryItemsList.appendChild(div);
    });
  }

  function openMemoryItemModal(item) {
    if (!els.memoryItemModal) return;
    if (item) {
      editingMemoryItemId = item.id;
      els.memoryItemModalTitle.textContent = "编辑记忆";
      els.memoryItemContent.value = item.content || "";
    } else {
      editingMemoryItemId = null;
      els.memoryItemModalTitle.textContent = "添加记忆";
      els.memoryItemContent.value = "";
    }
    els.memoryItemModal.classList.remove("hidden");
    els.memoryItemContent.focus();
  }

  function closeMemoryItemModal() {
    if (!els.memoryItemModal) return;
    els.memoryItemModal.classList.add("hidden");
    editingMemoryItemId = null;
  }

  function saveMemoryItem() {
    const content = (els.memoryItemContent.value || "").trim();
    if (!content) {
      window.alert("记忆内容不能为空。");
      return;
    }

    if (editingMemoryItemId) {
      // 编辑现有条目
      const idx = state.memoryItems.findIndex((m) => m.id === editingMemoryItemId);
      if (idx >= 0) {
        state.memoryItems[idx].content = content;
      }
    } else {
      // 添加新条目
      const newItem = {
        id: window.LLMHubState.uuid(),
        content: content,
        enabled: true,
        createdAt: Date.now(),
      };
      state.memoryItems.push(newItem);
    }

    saveState(state);
    renderMemoryItems();
    closeMemoryItemModal();
    // 自动同步
    if (window.LLMHubSync && window.LLMHubSync.autoSync) {
      window.LLMHubSync.autoSync();
    }
  }

  function deleteMemoryItem(id) {
    if (!window.confirm("确定要删除这条记忆吗？")) return;
    state.memoryItems = state.memoryItems.filter((m) => m.id !== id);
    saveState(state);
    renderMemoryItems();
    // 自动同步
    if (window.LLMHubSync && window.LLMHubSync.autoSync) {
      window.LLMHubSync.autoSync();
    }
  }

  function toggleMemoryItem(id) {
    const item = state.memoryItems.find((m) => m.id === id);
    if (item) {
      item.enabled = item.enabled === false ? true : false;
      saveState(state);
      renderMemoryItems();
      // 自动同步
      if (window.LLMHubSync && window.LLMHubSync.autoSync) {
        window.LLMHubSync.autoSync();
      }
    }
  }

  function renderChatOptions() {
    els.summaryChatSelect.innerHTML = "";

    if (!state.chats.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "当前还没有会话";
      els.summaryChatSelect.appendChild(opt);
      els.summaryChatSelect.disabled = true;
      els.chatSummaryInput.value = "";
      els.chatSummaryInput.placeholder =
        "先在聊天页面创建一个会话，这里才有东西可以总结。";
      return;
    }

    els.summaryChatSelect.disabled = false;

    const chatsSorted = [...state.chats].sort(
      (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)
    );

    chatsSorted.forEach((chat) => {
      const opt = document.createElement("option");
      opt.value = chat.id;
      const title = chat.title || "未命名会话";
      opt.textContent = title;
      els.summaryChatSelect.appendChild(opt);
    });

    const firstId = chatsSorted[0].id;
    els.summaryChatSelect.value = firstId;
    renderSummaryForChat(firstId);
  }

  function renderSummaryForChat(chatId) {
    if (!chatId) {
      els.chatSummaryInput.value = "";
      return;
    }
    const summary = state.summariesByChatId[chatId] || "";
    els.chatSummaryInput.value = summary;
    if (!summary) {
      els.chatSummaryInput.placeholder = "这里可以写一句话概括这个会话，比如：Gemini 2.5 官方线，用来做工具和查资料。";
    } else {
      els.chatSummaryInput.placeholder = "";
    }
  }

  function handleGlobalInstructionChange() {
    state.globalInstruction = els.globalInstructionInput.value;
    saveState(state);
    // 自动同步
    if (window.LLMHubSync && window.LLMHubSync.autoSync) {
      window.LLMHubSync.autoSync();
    }
  }

  function handleChatSelectChange() {
    const chatId = els.summaryChatSelect.value;
    renderSummaryForChat(chatId);
  }

  function handleSaveSummary() {
    const chatId = els.summaryChatSelect.value;
    if (!chatId) {
      window.alert("先选一个会话再保存摘要。");
      return;
    }
    const text = els.chatSummaryInput.value.trim();
    state.summariesByChatId[chatId] = text;
    const chat = state.chats.find((c) => c.id === chatId);
    if (chat) {
      chat.updatedAt = Date.now();
    }
    saveState(state);
    window.alert("已保存摘要。");
    // 自动同步
    if (window.LLMHubSync && window.LLMHubSync.autoSync) {
      window.LLMHubSync.autoSync();
    }
  }

  async function callLLM(connection, messages, globalInstruction, overrideModel) {
    const provider = normalizeProvider(connection.provider);
    const baseUrl = connection.baseUrl;
    const apiKey = connection.apiKey;
    const model = overrideModel || connection.defaultModel;

    if (!model) {
      throw new Error("未设置模型名称。");
    }
    if (!apiKey) {
      throw new Error("当前连接未填写 API Key。");
    }

    const gen = (window.LLMHubState && window.LLMHubState.loadState
      ? window.LLMHubState.loadState().generationConfig
      : {
          temperature: 0.7,
          maxTokens: 4096,
          frequencyPenalty: 0,
          presencePenalty: 0,
        });

    const temperature =
      typeof gen.temperature === "number" ? gen.temperature : 0.7;
    const maxTokens =
      typeof gen.maxTokens === "number" ? Math.round(gen.maxTokens) : 4096;
    const frequencyPenalty =
      typeof gen.frequencyPenalty === "number" ? gen.frequencyPenalty : 0;
    const presencePenalty =
      typeof gen.presencePenalty === "number" ? gen.presencePenalty : 0;

    if (provider === "openai") {
      const url =
        (baseUrl || "https://api.openai.com/v1").replace(/\/$/, "") +
        "/chat/completions";
      const bodyMessages = [];
      if (globalInstruction && globalInstruction.trim()) {
        bodyMessages.push({ role: "system", content: globalInstruction });
      }
      messages.forEach((m) => {
        bodyMessages.push({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        });
      });

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model,
          messages: bodyMessages,
          temperature,
          max_tokens: maxTokens,
          frequency_penalty: frequencyPenalty,
          presence_penalty: presencePenalty,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error("OpenAI 兼容接口错误：" + resp.status + " " + text);
      }
      const data = await resp.json();
      const choice = data.choices && data.choices[0];
      if (
        !choice ||
        !choice.message ||
        typeof choice.message.content !== "string"
      ) {
        throw new Error("响应格式异常（没有 content 字段）。");
      }
      return choice.message.content.trim();
    }

    if (provider === "gemini") {
      const safeBase = (
        baseUrl || "https://generativelanguage.googleapis.com/v1beta"
      ).replace(/\/$/, "");
      const url =
        safeBase + "/models/" + encodeURIComponent(model) + ":generateContent?key=" + apiKey;

      const contents = [];
      
      // 把系统指令作为第一条 user 消息
      if (globalInstruction && globalInstruction.trim()) {
        contents.push({
          role: "user",
          parts: [{ text: "[系统指令]\n" + globalInstruction }],
        });
        contents.push({
          role: "model",
          parts: [{ text: "好的，我会遵循这些指令。" }],
        });
      }
      
      messages.forEach((m) => {
        const role = m.role === "assistant" ? "model" : "user";
        contents.push({
          role,
          parts: [{ text: m.content }],
        });
      });

      const body = {
        contents,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
        ],
      };

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error("Gemini 接口错误：" + resp.status + " " + text);
      }
      const data = await resp.json();
      if (
        !data.candidates ||
        !data.candidates[0] ||
        !data.candidates[0].content ||
        !data.candidates[0].content.parts ||
        !data.candidates[0].content.parts[0] ||
        typeof data.candidates[0].content.parts[0].text !== "string"
      ) {
        throw new Error("Gemini 响应格式异常。");
      }
      return data.candidates[0].content.parts[0].text.trim();
    }

    if (provider === "anthropic") {
      const safeBase = (baseUrl || "https://api.anthropic.com/v1").replace(
        /\/$/,
        ""
      );
      const url = safeBase + "/messages";

      const finalMessages = [];

      messages.forEach((m) => {
        if (m.role === "user" || m.role === "assistant") {
          finalMessages.push({
            role: m.role,
            content: m.content,
          });
        }
      });

      const body = {
        model,
        max_tokens: maxTokens,
        temperature,
        messages: finalMessages.length
          ? finalMessages
          : [{ role: "user", content: "Hello" }],
      };
      if (globalInstruction && globalInstruction.trim()) {
        body.system = globalInstruction;
      }

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error("Claude 接口错误：" + resp.status + " " + text);
      }
      const data = await resp.json();
      if (
        !data.content ||
        !data.content[0] ||
        typeof data.content[0].text !== "string"
      ) {
        throw new Error("Claude 响应格式异常。");
      }
      return data.content[0].text.trim();
    }

    throw new Error("未知提供商类型：" + provider);
  }

  async function handleGenerateSummary() {
    const chatId = els.summaryChatSelect.value;
    if (!chatId) {
      window.alert("先选中一个会话再生成摘要。");
      return;
    }
    const conn = getActiveConnection(state);
    if (!conn) {
      window.alert("还没有设置当前连接，请先在“连接”页面设置。");
      return;
    }
    const messages = getMessages(state, chatId);
    if (!messages.length) {
      window.alert("这个会话还没有内容，没法总结。");
      return;
    }

    try {
      els.generateSummaryButton.disabled = true;
      els.generateSummaryButton.textContent = "生成中…";
      const system =
        "你是一个摘要助手，请用简洁的一段话总结下面这段对话，突出长期有用的信息和双方的关系背景。用中文输出。";
      const summaryText = await callLLM(
        conn,
        messages,
        system,
        state.chats.find((c) => c.id === chatId)?.model || conn.defaultModel
      );
      state.summariesByChatId[chatId] = summaryText;
      const chat = state.chats.find((c) => c.id === chatId);
      if (chat) chat.updatedAt = Date.now();
      saveState(state);
      renderSummaryForChat(chatId);
    } catch (e) {
      window.alert("生成摘要时出错：" + (e.message || String(e)));
    } finally {
      els.generateSummaryButton.disabled = false;
      els.generateSummaryButton.textContent = "用当前连接的模型生成摘要";
    }
  }

  function initEventListeners() {
    if (els.globalInstructionInput) {
      const handler = () => {
        state.globalInstruction = els.globalInstructionInput.value || "";
        saveState(state);
      };
      els.globalInstructionInput.addEventListener("input", handler);
      els.globalInstructionInput.addEventListener("blur", handler);
    }

    if (els.temperatureSlider) {
      els.temperatureSlider.addEventListener("input", () => {
        const v = parseFloat(els.temperatureSlider.value);
        state.generationConfig.temperature = isNaN(v) ? 0.7 : v;
        if (els.temperatureValue) {
          els.temperatureValue.textContent =
            state.generationConfig.temperature.toFixed(2);
        }
        saveState(state);
      });
    }

    if (els.maxTokensSlider) {
      els.maxTokensSlider.addEventListener("input", () => {
        const v = parseInt(els.maxTokensSlider.value, 10);
        state.generationConfig.maxTokens = isNaN(v) ? 4096 : v;
        if (els.maxTokensValue) {
          els.maxTokensValue.textContent = String(
            Math.round(state.generationConfig.maxTokens)
          );
        }
        saveState(state);
      });
    }

    if (els.frequencyPenaltySlider) {
      els.frequencyPenaltySlider.addEventListener("input", () => {
        const v = parseFloat(els.frequencyPenaltySlider.value);
        state.generationConfig.frequencyPenalty = isNaN(v) ? 0 : v;
        if (els.frequencyPenaltyValue) {
          els.frequencyPenaltyValue.textContent =
            state.generationConfig.frequencyPenalty.toFixed(2);
        }
        saveState(state);
      });
    }

    if (els.presencePenaltySlider) {
      els.presencePenaltySlider.addEventListener("input", () => {
        const v = parseFloat(els.presencePenaltySlider.value);
        state.generationConfig.presencePenalty = isNaN(v) ? 0 : v;
        if (els.presencePenaltyValue) {
          els.presencePenaltyValue.textContent =
            state.generationConfig.presencePenalty.toFixed(2);
        }
        saveState(state);
      });
    }

    document.addEventListener("click", (evt) => {
      const btn = evt.target.closest("button[data-help]");
      if (!btn) return;
      const key = btn.getAttribute("data-help");
      if (key === "temperature") {
        window.alert(
          "温度：数值越高，模型越敢乱飞，回答更有想象力但也更不稳定；数值越低，回答更老实、更像按部就班。"
        );
      } else if (key === "max_tokens") {
        window.alert(
          "最大回复长度：控制一次最多能回多少字。太小会被截断，太大会浪费额度，4096 一般够用。"
        );
      } else if (key === "frequency_penalty") {
        window.alert(
          "重复惩罚：数值越大，模型越不敢反复重复同一句话，适合压住啰嗦和口头禅。"
        );
      } else if (key === "presence_penalty") {
        window.alert(
          "话题新鲜度：数值越大，模型越愿意引入新话题、新信息，不会老围着一个点打转。"
        );
      }
    });

    if (els.summaryChatSelect) {
      els.summaryChatSelect.addEventListener("change", handleChatSelectChange);
    }
    if (els.saveSummaryButton) {
      els.saveSummaryButton.addEventListener("click", handleSaveSummary);
    }
    if (els.generateSummaryButton) {
      els.generateSummaryButton.addEventListener("click", handleGenerateSummary);
    }

    // 记忆条目事件
    if (els.addMemoryItemButton) {
      els.addMemoryItemButton.addEventListener("click", () => openMemoryItemModal(null));
    }
    if (els.memoryItemSaveButton) {
      els.memoryItemSaveButton.addEventListener("click", saveMemoryItem);
    }
    if (els.memoryItemCancelButton) {
      els.memoryItemCancelButton.addEventListener("click", closeMemoryItemModal);
    }
    if (els.closeMemoryItemModal) {
      els.closeMemoryItemModal.addEventListener("click", closeMemoryItemModal);
    }

    // 上下文限制事件
    if (els.contextLimitMode) {
      els.contextLimitMode.addEventListener("change", () => {
        if (!state.contextLimit) state.contextLimit = {};
        state.contextLimit.mode = els.contextLimitMode.value;
        saveState(state);
        renderContextLimit();
        // 自动同步
        if (window.LLMHubSync && window.LLMHubSync.autoSync) {
          window.LLMHubSync.autoSync();
        }
      });
    }
    if (els.maxRoundsSlider) {
      els.maxRoundsSlider.addEventListener("input", () => {
        const v = parseInt(els.maxRoundsSlider.value, 10);
        if (!state.contextLimit) state.contextLimit = {};
        state.contextLimit.maxRounds = isNaN(v) ? 50 : v;
        if (els.maxRoundsValue) {
          els.maxRoundsValue.textContent = String(state.contextLimit.maxRounds);
        }
        saveState(state);
        // 自动同步（有防抖）
        if (window.LLMHubSync && window.LLMHubSync.autoSync) {
          window.LLMHubSync.autoSync();
        }
      });
    }
    if (els.maxContextTokensSlider) {
      els.maxContextTokensSlider.addEventListener("input", () => {
        const v = parseInt(els.maxContextTokensSlider.value, 10);
        if (!state.contextLimit) state.contextLimit = {};
        state.contextLimit.maxTokens = isNaN(v) ? 30000 : v;
        if (els.maxContextTokensValue) {
          els.maxContextTokensValue.textContent = String(state.contextLimit.maxTokens);
        }
        saveState(state);
        // 自动同步（有防抖）
        if (window.LLMHubSync && window.LLMHubSync.autoSync) {
          window.LLMHubSync.autoSync();
        }
      });
    }
    
    // 自动记忆事件
    if (els.autoMemoryEnabled) {
      els.autoMemoryEnabled.addEventListener("change", () => {
        if (!state.autoMemory) state.autoMemory = {};
        state.autoMemory.enabled = els.autoMemoryEnabled.checked;
        saveState(state);
        renderAutoMemory();
        if (window.LLMHubSync && window.LLMHubSync.autoSync) {
          window.LLMHubSync.autoSync();
        }
      });
    }
    if (els.autoMemoryIntervalSlider) {
      els.autoMemoryIntervalSlider.addEventListener("input", () => {
        const v = parseInt(els.autoMemoryIntervalSlider.value, 10);
        if (!state.autoMemory) state.autoMemory = {};
        state.autoMemory.extractAfterRounds = isNaN(v) ? 3 : v;
        if (els.autoMemoryIntervalValue) {
          els.autoMemoryIntervalValue.textContent = String(state.autoMemory.extractAfterRounds);
        }
        saveState(state);
        if (window.LLMHubSync && window.LLMHubSync.autoSync) {
          window.LLMHubSync.autoSync();
        }
      });
    }
    
    // RAG 自然记忆事件
    if (els.ragMemoryEnabled) {
      els.ragMemoryEnabled.addEventListener("change", () => {
        if (!state.ragMemory) state.ragMemory = {};
        state.ragMemory.enabled = els.ragMemoryEnabled.checked;
        saveState(state);
        renderRagMemory();
        if (window.LLMHubSync && window.LLMHubSync.autoSync) {
          window.LLMHubSync.autoSync();
        }
      });
    }
    if (els.refreshRagMemoriesBtn) {
      els.refreshRagMemoriesBtn.addEventListener("click", loadRagMemories);
    }
    if (els.addRagMemoryBtn) {
      els.addRagMemoryBtn.addEventListener("click", addRagMemoryManually);
    }
  }

function init() {
    initDomRefs();
    renderGlobalInstruction();
    renderGenerationConfig();
    renderContextLimit();
    renderAutoMemory();
    renderRagMemory();
    renderMemoryItems();
    renderChatOptions();
    initEventListeners();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();