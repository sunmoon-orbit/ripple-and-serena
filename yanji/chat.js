(function () {
  "use strict";

  const {
    uuid,
    loadState,
    saveState,
    getActiveConnection,
    setActiveConnection,
    getActiveChat,
    getMessages,
  } = window.LLMHubState;

  let state = loadState();
  const els = {};
  let isSending = false;
  let pendingImages = []; // 待发送的图片

  // ========== DOM 引用 ==========
  function initDomRefs() {
    // 侧边栏
    els.sidebar = document.getElementById("sidebar");
    els.openSidebarBtn = document.getElementById("openSidebarBtn");
    els.closeSidebarBtn = document.getElementById("closeSidebarBtn");
    els.newChatButton = document.getElementById("newChatButton");
    els.chatSearchInput = document.getElementById("chatSearchInput");
    els.chatList = document.getElementById("chatList");
    
    // 聊天头部
    els.currentChatTitle = document.getElementById("currentChatTitle");
    els.currentConnectionName = document.getElementById("currentConnectionName");
    els.switchModelBtn = document.getElementById("switchModelBtn");
    els.modelSwitchPanel = document.getElementById("modelSwitchPanel");
    els.closeModelPanel = document.getElementById("closeModelPanel");
    els.connectionSelect = document.getElementById("connectionSelect");
    els.activeModelInput = document.getElementById("activeModelInput");
    els.modelList = document.getElementById("modelList");
    els.applyCustomModel = document.getElementById("applyCustomModel");
    
    // 消息区域
    els.messagesContainer = document.getElementById("messagesContainer");
    els.emptyState = document.getElementById("emptyState");
    
    // 输入区域
    els.userInput = document.getElementById("userInput");
    els.sendButton = document.getElementById("sendButton");
    els.statusBar = document.getElementById("statusBar");
    
    // 图片上传
    els.imageUploadBtn = document.getElementById("imageUploadBtn");
    els.imageInput = document.getElementById("imageInput");
    els.imagePreviewArea = document.getElementById("imagePreviewArea");
    els.imagePreviewList = document.getElementById("imagePreviewList");
    
    // 位置和搜索
    els.locationBtn = document.getElementById("locationBtn");
    els.searchBtn = document.getElementById("searchBtn");
    els.searchPreviewArea = document.getElementById("searchPreviewArea");
    els.searchPreviewContent = document.getElementById("searchPreviewContent");
    els.clearSearchBtn = document.getElementById("clearSearchBtn");
    
    // 重命名弹窗
    els.renameChatModal = document.getElementById("renameChatModal");
    els.closeRenameChatModal = document.getElementById("closeRenameChatModal");
    els.renameChatInput = document.getElementById("renameChatInput");
    els.renameChatCancel = document.getElementById("renameChatCancel");
    els.renameChatConfirm = document.getElementById("renameChatConfirm");
  }

  // ========== 侧边栏 ==========
  function openSidebar() {
    els.sidebar.classList.add("open");
    els.sidebar.classList.remove("collapsed");
    showBackdrop();
  }

  function closeSidebar() {
    els.sidebar.classList.remove("open");
    hideBackdrop();
  }

  function showBackdrop() {
    let backdrop = document.querySelector(".sidebar-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "sidebar-backdrop";
      backdrop.addEventListener("click", closeSidebar);
      document.body.appendChild(backdrop);
    }
    backdrop.classList.add("show");
  }

  function hideBackdrop() {
    const backdrop = document.querySelector(".sidebar-backdrop");
    if (backdrop) backdrop.classList.remove("show");
  }

  // ========== 聊天列表 ==========
  let searchKeyword = "";

  function filterChats(chats) {
    if (!searchKeyword) return chats;
    return chats.filter((c) => {
      if (c.title && c.title.toLowerCase().includes(searchKeyword)) return true;
      const msgs = state.messagesByChatId[c.id] || [];
      return msgs.some((m) => m.content && m.content.toLowerCase().includes(searchKeyword));
    });
  }

  function renderChatList() {
    if (!els.chatList) return;
    els.chatList.innerHTML = "";
    
    const sorted = [...state.chats].sort(
      (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)
    );
    const filtered = filterChats(sorted);
    
    if (filtered.length === 0) {
      els.chatList.innerHTML = '<div class="empty-text" style="padding: 20px; text-align: center;">暂无对话</div>';
      return;
    }
    
    filtered.forEach((chat) => {
      const div = document.createElement("div");
      div.className = "chat-item" + (chat.id === state.activeChatId ? " active" : "");
      
      const conn = state.connections.find((c) => c.id === chat.connectionId);
      const connName = conn ? conn.name : "";
      const time = formatTime(chat.updatedAt || chat.createdAt);
      
      div.innerHTML = `
        <div class="chat-item-content">
          <div class="chat-item-title">${escapeHtml(chat.title || "新对话")}</div>
          <div class="chat-item-meta">${escapeHtml(connName)} · ${time}</div>
        </div>
        <div class="chat-item-actions">
          <button class="chat-item-btn rename" title="重命名">✎</button>
          <button class="chat-item-btn delete" title="删除">🗑</button>
        </div>
      `;
      
      div.querySelector(".chat-item-content").addEventListener("click", () => {
        selectChat(chat.id);
        if (window.innerWidth <= 768) closeSidebar();
      });
      
      div.querySelector(".rename").addEventListener("click", (e) => {
        e.stopPropagation();
        openRenameModal(chat.id);
      });
      
      div.querySelector(".delete").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteChat(chat.id);
      });
      
      els.chatList.appendChild(div);
    });
  }

  function formatTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return Math.floor(diff / 60000) + "分钟前";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "小时前";
    if (diff < 604800000) return Math.floor(diff / 86400000) + "天前";
    
    return d.toLocaleDateString();
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

  // ========== 聊天操作 ==========
  function selectChat(chatId) {
    state.activeChatId = chatId;
    const chat = state.chats.find((c) => c.id === chatId);
    if (chat) {
      state.activeConnectionId = chat.connectionId;
    }
    saveState(state);
    renderChatList();
    renderMessages();
    updateHeader();
    updateConnectionSelect();
  }

  function createNewChat() {
    const conn = getActiveConnection(state);
    if (!conn) {
      alert("请先在【连接】页面配置一个 API 连接。");
      return;
    }
    
    const model = conn.defaultModel || "";
    const chat = {
      id: uuid(),
      title: "新对话",
      connectionId: conn.id,
      model: model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    state.chats.push(chat);
    state.activeChatId = chat.id;
    state.messagesByChatId[chat.id] = [];
    saveState(state);
    
    renderChatList();
    renderMessages();
    updateHeader();
    
    if (window.innerWidth <= 768) closeSidebar();
  }

  function deleteChat(id) {
    if (!confirm("确定要删除这个对话吗？")) return;
    
    state.chats = state.chats.filter((c) => c.id !== id);
    delete state.messagesByChatId[id];
    delete state.summariesByChatId[id];
    
    if (state.activeChatId === id) {
      state.activeChatId = state.chats[0] ? state.chats[0].id : null;
    }
    
    saveState(state);
    renderChatList();
    renderMessages();
    updateHeader();
    
    if (window.LLMHubSync && window.LLMHubSync.autoSync) {
      window.LLMHubSync.autoSync();
    }
  }

  let renamingChatId = null;

  function openRenameModal(chatId) {
    renamingChatId = chatId;
    const chat = state.chats.find((c) => c.id === chatId);
    els.renameChatInput.value = chat ? chat.title : "";
    els.renameChatModal.classList.remove("hidden");
    els.renameChatInput.focus();
  }

  function closeRenameModal() {
    els.renameChatModal.classList.add("hidden");
    renamingChatId = null;
  }

  function confirmRename() {
    if (!renamingChatId) return;
    const title = els.renameChatInput.value.trim();
    if (!title) return;
    
    const chat = state.chats.find((c) => c.id === renamingChatId);
    if (chat) {
      chat.title = title;
      chat.updatedAt = Date.now();
      saveState(state);
      renderChatList();
      updateHeader();
      
      if (window.LLMHubSync && window.LLMHubSync.autoSync) {
        window.LLMHubSync.autoSync();
      }
    }
    closeRenameModal();
  }

  // ========== 头部信息 ==========
  function updateHeader() {
    const chat = getActiveChat(state);
    const conn = getActiveConnection(state);
    
    if (els.currentChatTitle) {
      els.currentChatTitle.textContent = chat ? chat.title : "新对话";
    }
    
    if (els.currentConnectionName) {
      if (conn) {
        const model = chat && chat.model ? chat.model : conn.defaultModel;
        els.currentConnectionName.textContent = conn.name + (model ? " · " + model : "");
        els.currentConnectionName.style.display = "inline";
      } else {
        els.currentConnectionName.style.display = "none";
      }
    }
  }

  function updateConnectionSelect() {
    if (!els.connectionSelect) return;
    els.connectionSelect.innerHTML = "";
    
    state.connections.forEach((conn) => {
      const opt = document.createElement("option");
      opt.value = conn.id;
      opt.textContent = conn.name;
      if (conn.id === state.activeConnectionId) opt.selected = true;
      els.connectionSelect.appendChild(opt);
    });
    
    const chat = getActiveChat(state);
    const conn = getActiveConnection(state);
    if (els.activeModelInput) {
      els.activeModelInput.value = (chat && chat.model) || (conn && conn.defaultModel) || "";
    }
    
    // 更新模型列表
    renderModelList();
  }

  function toggleModelPanel() {
    els.modelSwitchPanel.classList.toggle("hidden");
    if (!els.modelSwitchPanel.classList.contains("hidden")) {
      renderModelList();
    }
  }

  // 渲染模型列表
  function renderModelList() {
    if (!els.modelList) return;
    els.modelList.innerHTML = "";
    
    const chat = getActiveChat(state);
    const currentModel = chat ? chat.model : "";
    const currentConnId = chat ? chat.connectionId : state.activeConnectionId;
    
    // 获取当前选中连接的模型
    const selectedConnId = els.connectionSelect ? els.connectionSelect.value : currentConnId;
    const conn = state.connections.find(c => c.id === selectedConnId);
    
    if (!conn) {
      els.modelList.innerHTML = '<div class="empty-text">请先选择连接</div>';
      return;
    }
    
    // 获取模型列表
    let models = [];
    
    // 如果连接配置了模型列表
    if (conn.modelList && conn.modelList.length > 0) {
      models = conn.modelList;
    } else {
      // 使用内置模型列表
      const provider = (conn.provider || "").toLowerCase();
      if (provider.includes("openai")) {
        models = ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o3-mini", "o1", "o1-mini"];
      } else if (provider.includes("gemini")) {
        models = ["gemini-2.5-flash-preview-05-20", "gemini-2.5-pro-preview-05-06", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
      } else if (provider.includes("anthropic") || provider.includes("claude")) {
        models = ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-3-haiku-20240307"];
      } else if (provider.includes("deepseek")) {
        models = ["deepseek-chat", "deepseek-reasoner"];
      } else {
        // 默认显示一些通用模型
        models = [conn.defaultModel].filter(Boolean);
      }
    }
    
    // 如果当前模型不在列表中，加到最前面
    if (currentModel && !models.includes(currentModel) && selectedConnId === currentConnId) {
      models.unshift(currentModel);
    }
    
    if (models.length === 0) {
      els.modelList.innerHTML = '<div class="empty-text">没有可用模型，请在下方输入</div>';
      return;
    }
    
    models.forEach(model => {
      const div = document.createElement("div");
      div.className = "model-item" + (model === currentModel && selectedConnId === currentConnId ? " active" : "");
      div.innerHTML = `
        <span class="model-item-name">${model}</span>
        <span class="model-item-provider">${conn.name}</span>
      `;
      div.addEventListener("click", () => selectModel(selectedConnId, model));
      els.modelList.appendChild(div);
    });
  }

  // 选择模型
  function selectModel(connId, model) {
    let chat = getActiveChat(state);
    
    // 如果没有当前对话，创建一个
    if (!chat) {
      const conn = state.connections.find(c => c.id === connId);
      if (!conn) return;
      
      chat = {
        id: uuid(),
        title: "新对话",
        connectionId: connId,
        model: model,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      state.chats.push(chat);
      state.activeChatId = chat.id;
      state.messagesByChatId[chat.id] = [];
    } else {
      // 更新现有对话的模型
      chat.connectionId = connId;
      chat.model = model;
    }
    
    state.activeConnectionId = connId;
    saveState(state);
    
    // 更新 UI
    updateHeader();
    updateConnectionSelect();
    renderChatList();
    
    // 关闭面板
    els.modelSwitchPanel.classList.add("hidden");
  }

  function handleConnectionChange() {
    const connId = els.connectionSelect.value;
    
    // 只更新模型列表，不立即切换对话的连接
    renderModelList();
  }

  function handleModelChange() {
    const chat = getActiveChat(state);
    if (chat && els.activeModelInput) {
      chat.model = els.activeModelInput.value.trim();
      saveState(state);
      updateHeader();
    }
  }
  
  function applyCustomModel() {
    const connId = els.connectionSelect ? els.connectionSelect.value : state.activeConnectionId;
    const model = els.activeModelInput ? els.activeModelInput.value.trim() : "";
    
    if (!model) {
      alert("请输入模型名称");
      return;
    }
    
    selectModel(connId, model);
  }

  // ========== 消息渲染 ==========
  function renderMessages() {
    if (!els.messagesContainer) return;
    
    const chat = getActiveChat(state);
    const messages = chat ? getMessages(state, chat.id) : [];
    
    // 清空容器
    els.messagesContainer.innerHTML = "";
    
    if (messages.length === 0) {
      els.messagesContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">💬</div>
          <h2>开始新对话</h2>
          <p>在下方输入消息，开始与 AI 聊天</p>
        </div>
      `;
      return;
    }
    
    messages.forEach((msg, idx) => {
      const div = document.createElement("div");
      div.className = "message " + msg.role;
      div.dataset.msgId = msg.id;
      
      const formatted = formatMessageContent(msg.content);
      const time = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : "";
      const tokens = msg.tokenUsage ? `📊 ${msg.tokenUsage.totalTokens || 0} tokens` : "";
      
      // 图片显示
      let imagesHtml = "";
      if (msg.images && msg.images.length > 0) {
        imagesHtml = '<div class="message-images">';
        msg.images.forEach(img => {
          imagesHtml += `<img src="${img}" class="message-image" onclick="window.open('${img}', '_blank')">`;
        });
        imagesHtml += '</div>';
      }
      
      div.innerHTML = `
        <div class="message-bubble">
          ${imagesHtml}
          <div class="message-content">${formatted}</div>
        </div>
        <div class="message-meta">
          <span>${time}</span>
          ${tokens ? `<span>${tokens}</span>` : ""}
          <div class="message-actions">
            <button class="msg-action-btn copy-btn">复制</button>
            ${msg.role === "user" ? `<button class="msg-action-btn edit-btn">编辑</button>` : ""}
            ${msg.role === "assistant" ? `<button class="msg-action-btn regen-btn">重新生成</button>` : ""}
          </div>
        </div>
      `;
      
      div.querySelector(".copy-btn").addEventListener("click", () => {
        navigator.clipboard.writeText(msg.content);
        const btn = div.querySelector(".copy-btn");
        btn.textContent = "已复制";
        setTimeout(() => btn.textContent = "复制", 1500);
      });
      
      const editBtn = div.querySelector(".edit-btn");
      if (editBtn) {
        editBtn.addEventListener("click", () => startEditMessage(chat.id, msg.id, idx));
      }
      
      const regenBtn = div.querySelector(".regen-btn");
      if (regenBtn) {
        regenBtn.addEventListener("click", () => regenerateMessage(chat.id, idx));
      }
      
      els.messagesContainer.appendChild(div);
    });
    
    els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
  }
  
  // 重新生成回复
  async function regenerateMessage(chatId, msgIdx) {
    const messages = state.messagesByChatId[chatId] || [];
    if (msgIdx < 1) return;
    
    // 删除当前消息及之后的所有消息
    state.messagesByChatId[chatId] = messages.slice(0, msgIdx);
    saveState(state);
    renderMessages();
    
    // 重新发送
    const chat = state.chats.find((c) => c.id === chatId);
    if (!chat) return;
    
    const conn = state.connections.find((c) => c.id === chat.connectionId);
    if (!conn) return;
    
    await sendMessage(chat, conn, null, []);
  }

  function formatMessageContent(content, isStreaming = false) {
    if (!content) return "";
    
    // 使用 marked.js 渲染 Markdown
    if (window.marked) {
      // 配置 marked
      marked.setOptions({
        highlight: function(code, lang) {
          if (window.hljs && lang && hljs.getLanguage(lang)) {
            try {
              return hljs.highlight(code, { language: lang }).value;
            } catch (e) {}
          }
          return code;
        },
        breaks: true,
        gfm: true,
      });
      
      let html = marked.parse(content);
      
      // 流式输出时添加光标
      if (isStreaming) {
        html += '<span class="streaming-cursor"></span>';
      }
      
      return html;
    }
    
    // 降级处理
    let html = escapeHtml(content);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code class="language-${lang}">${code}</code></pre>`;
    });
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\n/g, "<br>");
    
    if (isStreaming) {
      html += '<span class="streaming-cursor"></span>';
    }
    
    return html;
  }

  // ========== 消息编辑 ==========
  let editingMessageId = null;

  function startEditMessage(chatId, msgId, msgIdx) {
    editingMessageId = msgId;
    const messages = state.messagesByChatId[chatId] || [];
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;
    
    const msgDiv = els.messagesContainer.querySelector(`[data-msg-id="${msgId}"]`);
    if (!msgDiv) return;
    
    const bubble = msgDiv.querySelector(".message-bubble");
    const originalContent = msg.content;
    
    bubble.innerHTML = `
      <textarea class="edit-textarea">${escapeHtml(originalContent)}</textarea>
      <div class="edit-actions">
        <button class="ghost-button cancel-edit">取消</button>
        <button class="primary-button save-edit">保存并重新生成</button>
      </div>
    `;
    
    const textarea = bubble.querySelector(".edit-textarea");
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    
    bubble.querySelector(".cancel-edit").addEventListener("click", () => {
      editingMessageId = null;
      renderMessages();
    });
    
    bubble.querySelector(".save-edit").addEventListener("click", () => {
      const newContent = textarea.value.trim();
      if (newContent) {
        finishEditMessage(chatId, msgId, msgIdx, newContent);
      }
    });
  }

  async function finishEditMessage(chatId, msgId, msgIdx, newContent) {
    const messages = state.messagesByChatId[chatId] || [];
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;
    
    msg.content = newContent;
    state.messagesByChatId[chatId] = messages.slice(0, msgIdx + 1);
    saveState(state);
    renderMessages();
    editingMessageId = null;
    
    // 重新生成回复
    const chat = state.chats.find((c) => c.id === chatId);
    if (!chat) return;
    
    const conn = state.connections.find((c) => c.id === chat.connectionId);
    if (!conn) return;
    
    isSending = true;
    setStatus("思考中...");
    
    try {
      const historyMsgs = state.messagesByChatId[chatId].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      
      const limitedMsgs = applyContextLimit(historyMsgs);
      const globalInstruction = buildFullInstruction();
      const result = await callLLM(conn, limitedMsgs, globalInstruction, chat.model);
      
      const assistantMsg = {
        id: uuid(),
        role: "assistant",
        content: result.text,
        createdAt: Date.now(),
        tokenUsage: result.usage || null,
      };
      
      state.messagesByChatId[chatId].push(assistantMsg);
      chat.updatedAt = Date.now();
      saveState(state);
      renderChatList();
      renderMessages();
      
      if (window.LLMHubSync && window.LLMHubSync.autoSync) {
        window.LLMHubSync.autoSync();
      }
    } catch (e) {
      console.error(e);
      const assistantMsg = {
        id: uuid(),
        role: "assistant",
        content: "[请求出错] " + (e.message || String(e)),
        createdAt: Date.now(),
      };
      state.messagesByChatId[chatId].push(assistantMsg);
      saveState(state);
      renderMessages();
    } finally {
      isSending = false;
      setStatus("");
    }
  }

  // ========== 发送消息 ==========
  function setStatus(text) {
    if (els.statusBar) els.statusBar.textContent = text;
  }

  // ========== 图片上传处理 ==========
  function handleImageUpload() {
    if (els.imageInput) {
      els.imageInput.click();
    }
  }

  function handleImageSelected(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    Array.from(files).forEach(file => {
      if (!file.type.startsWith("image/")) return;
      
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target.result;
        pendingImages.push(base64);
        renderImagePreview();
      };
      reader.readAsDataURL(file);
    });
    
    // 清空 input 以便重复选择同一文件
    e.target.value = "";
  }

  function renderImagePreview() {
    if (!els.imagePreviewArea || !els.imagePreviewList) return;
    
    if (pendingImages.length === 0) {
      els.imagePreviewArea.style.display = "none";
      return;
    }
    
    els.imagePreviewArea.style.display = "block";
    els.imagePreviewList.innerHTML = "";
    
    pendingImages.forEach((img, idx) => {
      const div = document.createElement("div");
      div.className = "image-preview-item";
      div.innerHTML = `
        <img src="${img}" alt="预览">
        <button class="image-preview-remove" data-idx="${idx}">×</button>
      `;
      
      div.querySelector(".image-preview-remove").addEventListener("click", () => {
        pendingImages.splice(idx, 1);
        renderImagePreview();
      });
      
      els.imagePreviewList.appendChild(div);
    });
  }

  function clearPendingImages() {
    pendingImages = [];
    renderImagePreview();
  }

  // ========== 位置信息 ==========
  let currentLocation = null;

  async function handleGetLocation() {
    if (!navigator.geolocation) {
      alert("你的浏览器不支持获取位置");
      return;
    }
    
    setStatus("获取位置中...");
    els.locationBtn.classList.add("active");
    
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000
        });
      });
      
      currentLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
      
      // 尝试反向地理编码获取地址
      try {
        const geoUrl = `https://nominatim.openstreetmap.org/reverse?lat=${currentLocation.latitude}&lon=${currentLocation.longitude}&format=json&accept-language=zh`;
        const resp = await fetch(geoUrl);
        const data = await resp.json();
        currentLocation.address = data.display_name || null;
        currentLocation.city = data.address?.city || data.address?.town || data.address?.county || null;
      } catch (e) {
        console.warn("反向地理编码失败:", e);
      }
      
      setStatus(`📍 已获取位置${currentLocation.city ? ': ' + currentLocation.city : ''}`);
      
      // 自动插入位置信息到输入框
      const locText = currentLocation.address 
        ? `[我的位置: ${currentLocation.address}]`
        : `[我的位置: ${currentLocation.latitude.toFixed(4)}, ${currentLocation.longitude.toFixed(4)}]`;
      
      if (els.userInput.value) {
        els.userInput.value = locText + "\n" + els.userInput.value;
      } else {
        els.userInput.value = locText + "\n";
      }
      els.userInput.focus();
      
    } catch (e) {
      console.error("获取位置失败:", e);
      els.locationBtn.classList.remove("active");
      
      let errMsg = "获取位置失败";
      if (e.code === 1) errMsg = "你拒绝了位置权限";
      else if (e.code === 2) errMsg = "无法获取位置";
      else if (e.code === 3) errMsg = "获取位置超时";
      
      setStatus(errMsg);
      setTimeout(() => setStatus(""), 3000);
    }
  }

  // ========== 联网搜索 ==========
  let pendingSearchResults = null;

  async function handleWebSearch() {
    const query = els.userInput.value.trim();
    if (!query) {
      alert("请先输入要搜索的内容");
      return;
    }
    
    // 检查是否配置了搜索 API
    const searchConfig = state.searchConfig || {};
    if (!searchConfig.apiKey) {
      // 显示配置提示
      const key = prompt("请输入搜索 API Key\n\n推荐使用 Serper.dev（免费2500次/月）\n获取地址: https://serper.dev\n\n直接粘贴 API Key 即可：");
      if (!key || !key.trim()) return;
      
      const trimmedKey = key.trim();
      
      // 自动识别格式
      let provider = "serper"; // 默认用 serper
      let apiKey = trimmedKey;
      
      // 如果用户用了旧格式 provider:key
      if (trimmedKey.includes(":")) {
        const parts = trimmedKey.split(":");
        provider = parts[0].toLowerCase();
        apiKey = parts.slice(1).join(":"); // 处理key中可能包含冒号的情况
      }
      
      // 验证 provider
      if (provider !== "serper" && provider !== "tavily") {
        provider = "serper"; // 默认 serper
      }
      
      state.searchConfig = { provider, apiKey };
      saveState(state);
    }
    
    setStatus("搜索中...");
    els.searchBtn.classList.add("active");
    
    try {
      const results = await performWebSearch(query, state.searchConfig);
      pendingSearchResults = results;
      renderSearchPreview(results);
      setStatus(`找到 ${results.length} 条结果`);
    } catch (e) {
      console.error("搜索失败:", e);
      setStatus("搜索失败: " + e.message);
      setTimeout(() => setStatus(""), 3000);
    }
    
    els.searchBtn.classList.remove("active");
  }

  async function performWebSearch(query, config) {
    const { provider, apiKey } = config;
    
    if (provider === "serper") {
      const resp = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey
        },
        body: JSON.stringify({ q: query, num: 5, hl: "zh-CN" })
      });
      
      if (!resp.ok) throw new Error("Serper API 错误: " + resp.status);
      
      const data = await resp.json();
      return (data.organic || []).map(item => ({
        title: item.title,
        snippet: item.snippet,
        url: item.link
      }));
    }
    
    if (provider === "tavily") {
      const resp = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: query,
          max_results: 5,
          include_answer: true
        })
      });
      
      if (!resp.ok) throw new Error("Tavily API 错误: " + resp.status);
      
      const data = await resp.json();
      const results = (data.results || []).map(item => ({
        title: item.title,
        snippet: item.content,
        url: item.url
      }));
      
      // Tavily 有时会返回一个综合答案
      if (data.answer) {
        results.unshift({
          title: "AI 综合回答",
          snippet: data.answer,
          url: null
        });
      }
      
      return results;
    }
    
    throw new Error("未知的搜索服务: " + provider);
  }

  function renderSearchPreview(results) {
    if (!els.searchPreviewArea || !els.searchPreviewContent) return;
    
    if (!results || results.length === 0) {
      els.searchPreviewArea.style.display = "none";
      return;
    }
    
    els.searchPreviewArea.style.display = "block";
    els.searchPreviewContent.innerHTML = results.map(r => `
      <div class="search-result-item">
        <div class="search-result-title">${escapeHtml(r.title)}</div>
        <div class="search-result-snippet">${escapeHtml(r.snippet?.slice(0, 150) || '')}</div>
      </div>
    `).join("");
  }

  function clearSearchResults() {
    pendingSearchResults = null;
    if (els.searchPreviewArea) {
      els.searchPreviewArea.style.display = "none";
    }
    els.searchBtn.classList.remove("active");
  }

  function getSearchContext() {
    if (!pendingSearchResults || pendingSearchResults.length === 0) return "";
    
    let context = "\n\n[联网搜索结果]\n";
    pendingSearchResults.forEach((r, i) => {
      context += `${i + 1}. ${r.title}\n${r.snippet || ''}\n${r.url ? '来源: ' + r.url : ''}\n\n`;
    });
    return context;
  }

  async function handleSend() {
    if (isSending) return;
    
    let content = els.userInput.value.trim();
    if (!content) return;
    
    // 附加搜索结果到消息
    const searchContext = getSearchContext();
    if (searchContext) {
      content += searchContext;
    }
    
    let chat = getActiveChat(state);
    
    // 如果没有当前对话，创建一个
    if (!chat) {
      const conn = getActiveConnection(state);
      if (!conn) {
        alert("请先在【连接】页面配置一个 API 连接。");
        return;
      }
      
      chat = {
        id: uuid(),
        title: content.slice(0, 30) + (content.length > 30 ? "..." : ""),
        connectionId: conn.id,
        model: conn.defaultModel || "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      state.chats.push(chat);
      state.activeChatId = chat.id;
      state.messagesByChatId[chat.id] = [];
    }
    
    const conn = state.connections.find((c) => c.id === chat.connectionId);
    if (!conn) {
      alert("找不到该对话关联的连接配置。");
      return;
    }
    
    // 收集待发送的图片
    const images = [...pendingImages];
    clearPendingImages();
    clearSearchResults();
    
    // 添加用户消息（包含图片）
    const userMsg = {
      id: uuid(),
      role: "user",
      content: content,
      createdAt: Date.now(),
    };
    
    if (images.length > 0) {
      userMsg.images = images;
    }
    
    state.messagesByChatId[chat.id].push(userMsg);
    
    // 如果是第一条消息，用它作为标题
    if (state.messagesByChatId[chat.id].length === 1) {
      chat.title = content.slice(0, 30) + (content.length > 30 ? "..." : "");
    }
    
    chat.updatedAt = Date.now();
    saveState(state);
    
    els.userInput.value = "";
    autoResizeInput();
    renderChatList();
    renderMessages();
    
    // 调用 API
    isSending = true;
    setStatus("思考中...");
    
    await sendMessage(chat, conn, content, images);
  }
  
  // 统一的发送消息逻辑（支持流式输出）
  async function sendMessage(chat, conn, userText, images) {
    try {
      const historyMsgs = state.messagesByChatId[chat.id].map((m) => ({
        role: m.role,
        content: m.content,
        images: m.images || [],
      }));
      
      const limitedMsgs = applyContextLimit(historyMsgs);
      
      // RAG 记忆检索（自然方式）
      let ragMemoryPrompt = "";
      if (state.ragMemory && state.ragMemory.enabled && window.LLMHubRAG) {
        try {
          setStatus("回忆中...");
          const userId = await window.LLMHubRAG.getCurrentUserId();
          if (userId && userText) {
            const { prompt } = await window.LLMHubRAG.recallMemories(
              userText, 
              state.connections, 
              userId
            );
            ragMemoryPrompt = prompt;
          }
        } catch (e) {
          console.warn("RAG 记忆检索失败:", e);
        }
        setStatus("思考中...");
      }
      
      const globalInstruction = buildFullInstruction(ragMemoryPrompt);
      
      // 创建临时的助手消息用于流式显示
      const assistantMsgId = uuid();
      const assistantMsg = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        tokenUsage: null,
      };
      
      state.messagesByChatId[chat.id].push(assistantMsg);
      renderMessages();
      
      // 检查是否启用自动工具
      const autoToolsEnabled = state.autoTools !== false; // 默认开启
      const provider = normalizeProvider(conn.provider);
      
      // 检查模型是否支持工具调用
      const modelSupportsTools = checkToolSupport(provider, chat.model);
      
      let result;
      
      if (autoToolsEnabled && state.searchConfig?.apiKey && modelSupportsTools) {
        // 尝试使用带工具调用的方式
        try {
          result = await callLLMWithTools(conn, limitedMsgs, globalInstruction, chat.model, assistantMsgId, chat.id);
        } catch (toolError) {
          console.warn("工具调用失败，回退到普通模式:", toolError);
          // 回退到普通流式模式
          result = await fallbackToStream(conn, limitedMsgs, globalInstruction, chat.model, assistantMsgId, chat.id);
        }
      } else {
        // 普通流式输出
        result = await fallbackToStream(conn, limitedMsgs, globalInstruction, chat.model, assistantMsgId, chat.id);
      }
      
      // 更新最终结果
      const msgIdx = state.messagesByChatId[chat.id].findIndex(m => m.id === assistantMsgId);
      if (msgIdx !== -1) {
        state.messagesByChatId[chat.id][msgIdx].content = result.text;
        state.messagesByChatId[chat.id][msgIdx].tokenUsage = result.usage || null;
      }
      
      chat.updatedAt = Date.now();
      saveState(state);
      renderChatList();
      renderMessages();
      
      if (window.LLMHubSync && window.LLMHubSync.autoSync) {
        window.LLMHubSync.autoSync();
      }
      
      // 自动记忆提取（本地版）
      maybeExtractMemory(chat.id, conn);
      
      // RAG 记忆形成（向量版）
      maybeFormRAGMemory(chat.id, conn);
    } catch (e) {
      console.error(e);
      const assistantMsg = {
        id: uuid(),
        role: "assistant",
        content: "[请求出错] " + (e.message || String(e)),
        createdAt: Date.now(),
      };
      // 移除之前的空消息
      state.messagesByChatId[chat.id] = state.messagesByChatId[chat.id].filter(m => m.content !== "");
      state.messagesByChatId[chat.id].push(assistantMsg);
      chat.updatedAt = Date.now();
      saveState(state);
      renderChatList();
      renderMessages();
    } finally {
      isSending = false;
      setStatus("");
    }
  }
  
  // 更新流式消息显示
  function updateStreamingMessage(msgId, content) {
    const msgDiv = els.messagesContainer.querySelector(`[data-msg-id="${msgId}"]`);
    if (!msgDiv) return;
    
    const bubble = msgDiv.querySelector(".message-content");
    if (bubble) {
      bubble.innerHTML = formatMessageContent(content, true);
    }
    
    // 滚动到底部
    els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
  }

  // ========== 上下文限制 ==========
  function applyContextLimit(messages) {
    const limit = state.contextLimit || {};
    const mode = limit.mode || "none";
    
    if (mode === "none") return messages;
    
    if (mode === "rounds") {
      const maxRounds = limit.maxRounds || 50;
      const maxMessages = maxRounds * 2;
      if (messages.length <= maxMessages) return messages;
      return messages.slice(-maxMessages);
    }
    
    if (mode === "tokens") {
      const maxTokens = limit.maxTokens || 30000;
      let total = 0;
      const result = [];
      
      for (let i = messages.length - 1; i >= 0; i--) {
        const est = estimateTokens(messages[i].content);
        if (total + est > maxTokens && result.length > 0) break;
        total += est;
        result.unshift(messages[i]);
      }
      
      return result;
    }
    
    return messages;
  }

  function estimateTokens(text) {
    if (!text) return 0;
    let tokens = 0;
    for (const char of text) {
      if (/[\u4e00-\u9fff]/.test(char)) {
        tokens += 1.5;
      } else {
        tokens += 0.25;
      }
    }
    return Math.ceil(tokens);
  }

  // ========== 全局指令 ==========
  function buildFullInstruction(ragMemoryPrompt) {
    let instruction = state.globalInstruction || "";
    
    const items = state.memoryItems || [];
    const enabled = items.filter((m) => m.enabled !== false);
    
    if (enabled.length > 0) {
      if (instruction) instruction += "\n\n";
      instruction += "【记忆】\n";
      enabled.forEach((m) => {
        instruction += "- " + m.content + "\n";
      });
    }
    
    // 添加 RAG 向量记忆（自然方式）
    if (ragMemoryPrompt) {
      if (instruction) instruction += "\n\n";
      instruction += ragMemoryPrompt;
    }
    
    return instruction.trim();
  }

  // ========== API 调用 ==========
  function normalizeProvider(raw) {
    const v = (raw || "").toString().toLowerCase();
    if (v.includes("gemini")) return "gemini";
    if (v.includes("anthropic") || v.includes("claude")) return "anthropic";
    if (v.includes("deepseek")) return "openai";
    return "openai";
  }

  // 智能处理 API URL，避免重复拼接
  function buildApiUrl(baseUrl, provider, endpoint) {
    let url = (baseUrl || "").trim().replace(/\/$/, "");
    
    if (provider === "openai") {
      // 如果已经包含完整路径，直接返回
      if (url.includes("/chat/completions")) {
        return url;
      }
      // 如果没有填，用默认值
      if (!url) {
        url = "https://api.openai.com/v1";
      }
      // 如果没有 /v1，加上
      if (!url.includes("/v1")) {
        url += "/v1";
      }
      return url + "/chat/completions";
    }
    
    if (provider === "anthropic") {
      if (url.includes("/messages")) {
        return url;
      }
      if (!url) {
        url = "https://api.anthropic.com/v1";
      }
      if (!url.includes("/v1")) {
        url += "/v1";
      }
      return url + "/messages";
    }
    
    // Gemini 的 URL 比较特殊，在各自的函数里处理
    return url;
  }

  // 判断 Gemini 模型应该用 v1 还是 v1beta
  function getGeminiApiVersion(model) {
    // 2.0+ 和实验性模型用 v1beta
    if (!model) return "v1beta";
    const m = model.toLowerCase();
    if (m.includes("2.0") || m.includes("2.5") || m.includes("exp") || m.includes("preview")) {
      return "v1beta";
    }
    // 1.5 及之前的稳定版用 v1
    if (m.includes("1.5") || m.includes("1.0")) {
      return "v1";
    }
    // 默认用 v1beta（更新的 API）
    return "v1beta";
  }

  // ========== 自动工具调用 ==========
  
  // 检查模型是否支持工具调用
  function checkToolSupport(provider, model) {
    const m = (model || "").toLowerCase();
    
    // DeepSeek 目前不支持 function calling
    if (m.includes("deepseek")) return false;
    
    // OpenAI: 大多数现代模型支持
    if (provider === "openai") {
      // gpt-4, gpt-4o, gpt-4.1, gpt-3.5-turbo, o1, o3 等都支持
      if (m.includes("gpt-4") || m.includes("gpt-3.5") || m.startsWith("o1") || m.startsWith("o3")) {
        return true;
      }
      // 如果是 OpenAI 官方域名，默认支持
      return true;
    }
    
    // Gemini: 1.5 及以上支持
    if (provider === "gemini") {
      if (m.includes("1.5") || m.includes("2.0") || m.includes("2.5") || m.includes("flash") || m.includes("pro")) {
        return true;
      }
      return false;
    }
    
    // Anthropic: Claude 3 系列支持
    if (provider === "anthropic") {
      if (m.includes("claude-3") || m.includes("claude-sonnet") || m.includes("claude-opus")) {
        return true;
      }
      return false;
    }
    
    return false;
  }
  
  // 回退到流式输出
  async function fallbackToStream(conn, limitedMsgs, globalInstruction, model, assistantMsgId, chatId) {
    let fullText = "";
    const onChunk = (chunk) => {
      fullText += chunk;
      const msgIdx = state.messagesByChatId[chatId].findIndex(m => m.id === assistantMsgId);
      if (msgIdx !== -1) {
        state.messagesByChatId[chatId][msgIdx].content = fullText;
      }
      updateStreamingMessage(assistantMsgId, fullText);
    };
    
    return await callLLMStream(conn, limitedMsgs, globalInstruction, model, onChunk);
  }
  
  // 定义可用工具
  function getToolDefinitions() {
    const tools = [];
    
    // 搜索工具
    if (state.searchConfig?.apiKey) {
      tools.push({
        name: "web_search",
        description: "搜索互联网获取最新信息。当用户询问新闻、时事、最新数据、不确定的事实、或任何可能需要实时信息的问题时使用。",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "搜索关键词"
            }
          },
          required: ["query"]
        }
      });
    }
    
    // 位置工具
    tools.push({
      name: "get_location", 
      description: "获取用户当前地理位置。当用户询问附近的地点、本地天气、或需要知道用户在哪里时使用。",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    });
    
    return tools;
  }
  
  // 转换工具定义为各平台格式
  function formatToolsForProvider(tools, provider) {
    if (provider === "openai") {
      return tools.map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
    }
    
    if (provider === "gemini") {
      return [{
        functionDeclarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }))
      }];
    }
    
    if (provider === "anthropic") {
      return tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
    }
    
    return [];
  }
  
  // 执行工具调用
  async function executeTool(toolName, toolArgs) {
    console.log(`执行工具: ${toolName}`, toolArgs);
    
    if (toolName === "web_search") {
      setStatus("🔍 搜索中...");
      try {
        const results = await performWebSearch(toolArgs.query, state.searchConfig);
        let resultText = `搜索"${toolArgs.query}"的结果：\n\n`;
        results.forEach((r, i) => {
          resultText += `${i + 1}. ${r.title}\n${r.snippet || ''}\n${r.url ? '来源: ' + r.url : ''}\n\n`;
        });
        return resultText;
      } catch (e) {
        return `搜索失败: ${e.message}`;
      }
    }
    
    if (toolName === "get_location") {
      setStatus("📍 获取位置...");
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
          });
        });
        
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        
        // 尝试获取地址
        try {
          const geoUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=zh`;
          const resp = await fetch(geoUrl);
          const data = await resp.json();
          return `用户当前位置：${data.display_name}\n坐标：${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        } catch {
          return `用户当前位置坐标：${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        }
      } catch (e) {
        if (e.code === 1) return "用户拒绝了位置权限";
        return `无法获取位置: ${e.message}`;
      }
    }
    
    return `未知工具: ${toolName}`;
  }
  
  // 带工具调用的LLM请求（非流式，支持多轮工具调用）
  async function callLLMWithTools(connection, messages, globalInstruction, overrideModel, assistantMsgId, chatId) {
    const provider = normalizeProvider(connection.provider);
    const baseUrl = connection.baseUrl;
    const apiKey = connection.apiKey;
    const model = overrideModel || connection.defaultModel;
    
    const config = state.generationConfig || {};
    const temperature = config.temperature ?? 0.7;
    const maxTokens = config.maxTokens || 4096;
    
    const tools = getToolDefinitions();
    const formattedTools = formatToolsForProvider(tools, provider);
    
    // 构建消息历史
    let conversationMessages = [...messages];
    let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finalText = "";
    let iterationCount = 0;
    const maxIterations = 5; // 防止无限循环
    
    while (iterationCount < maxIterations) {
      iterationCount++;
      setStatus(iterationCount === 1 ? "思考中..." : "继续思考...");
      
      let response;
      
      // OpenAI 格式
      if (provider === "openai") {
        const url = buildApiUrl(baseUrl, "openai");
        
        const bodyMessages = [];
        if (globalInstruction) {
          bodyMessages.push({ role: "system", content: globalInstruction });
        }
        
        // 正确处理各种消息类型
        conversationMessages.forEach(m => {
          if (m.role === "tool") {
            // 工具结果消息
            bodyMessages.push({
              role: "tool",
              tool_call_id: m.tool_call_id,
              content: m.content
            });
          } else if (m.role === "assistant" && m.tool_calls) {
            // 带工具调用的助手消息
            bodyMessages.push({
              role: "assistant",
              content: m.content || null,
              tool_calls: m.tool_calls
            });
          } else if (m.images && m.images.length > 0) {
            // 带图片的消息
            const contentParts = [];
            contentParts.push({ type: "text", text: m.content || "" });
            m.images.forEach(img => {
              contentParts.push({
                type: "image_url",
                image_url: { url: img }
              });
            });
            bodyMessages.push({ role: m.role, content: contentParts });
          } else {
            // 普通消息
            bodyMessages.push({ role: m.role, content: m.content });
          }
        });
        
        const body = {
          model,
          messages: bodyMessages,
          temperature,
          max_tokens: maxTokens,
        };
        
        if (formattedTools.length > 0) {
          body.tools = formattedTools;
          body.tool_choice = "auto";
        }
        
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + apiKey
          },
          body: JSON.stringify(body)
        });
        
        if (!resp.ok) {
          const errText = await resp.text();
          console.error("OpenAI API 错误:", resp.status, errText);
          throw new Error("API 错误: " + resp.status + " - " + errText.slice(0, 200));
        }
        response = await resp.json();
        
        const choice = response.choices[0];
        const message = choice.message;
        
        // 累计 token
        if (response.usage) {
          totalUsage.promptTokens += response.usage.prompt_tokens || 0;
          totalUsage.completionTokens += response.usage.completion_tokens || 0;
          totalUsage.totalTokens += response.usage.total_tokens || 0;
        }
        
        // 检查是否有工具调用
        if (message.tool_calls && message.tool_calls.length > 0) {
          // 显示正在调用工具
          const toolNames = message.tool_calls.map(tc => tc.function.name).join(", ");
          updateStreamingMessage(assistantMsgId, `🔧 正在调用: ${toolNames}...`);
          
          // 添加助手消息（包含工具调用）
          conversationMessages.push({
            role: "assistant",
            content: message.content || "",
            tool_calls: message.tool_calls
          });
          
          // 执行每个工具调用
          for (const toolCall of message.tool_calls) {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments || "{}");
            const toolResult = await executeTool(toolName, toolArgs);
            
            conversationMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: toolResult
            });
          }
          
          // 继续循环，让模型处理工具结果
          continue;
        }
        
        // 没有工具调用，返回最终文本
        finalText = message.content || "";
        break;
      }
      
      // Gemini 格式
      if (provider === "gemini") {
        const apiVersion = getGeminiApiVersion(model);
        let safeBase = baseUrl || `https://generativelanguage.googleapis.com/${apiVersion}`;
        if (!safeBase.includes("/v1")) {
          safeBase = safeBase.replace(/\/$/, "") + "/" + apiVersion;
        }
        safeBase = safeBase.replace(/\/$/, "");
        
        const url = safeBase + "/models/" + encodeURIComponent(model) + ":generateContent?key=" + apiKey;
        
        const contents = [];
        if (globalInstruction) {
          contents.push({ role: "user", parts: [{ text: "[系统指令]\n" + globalInstruction }] });
          contents.push({ role: "model", parts: [{ text: "好的，我会遵循这些指令。" }] });
        }
        
        conversationMessages.forEach(m => {
          const role = m.role === "assistant" ? "model" : "user";
          if (m.functionResponse) {
            contents.push({
              role: "function",
              parts: [{ functionResponse: m.functionResponse }]
            });
          } else if (m.functionCall) {
            contents.push({
              role: "model",
              parts: [{ functionCall: m.functionCall }]
            });
          } else if (m.images && m.images.length > 0) {
            // 带图片的消息
            const parts = [];
            m.images.forEach(img => {
              const match = img.match(/^data:(.+);base64,(.+)$/);
              if (match) {
                parts.push({
                  inline_data: {
                    mime_type: match[1],
                    data: match[2]
                  }
                });
              }
            });
            parts.push({ text: m.content || "" });
            contents.push({ role, parts });
          } else {
            contents.push({ role, parts: [{ text: m.content }] });
          }
        });
        
        const body = {
          contents,
          generationConfig: { temperature, maxOutputTokens: maxTokens },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
          ],
        };
        
        if (formattedTools.length > 0) {
          body.tools = formattedTools;
        }
        
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        
        if (!resp.ok) throw new Error("Gemini API 错误: " + resp.status);
        response = await resp.json();
        
        const candidate = response.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        
        // 检查是否有函数调用
        const functionCallPart = parts.find(p => p.functionCall);
        if (functionCallPart) {
          const fc = functionCallPart.functionCall;
          updateStreamingMessage(assistantMsgId, `🔧 正在调用: ${fc.name}...`);
          
          conversationMessages.push({
            role: "assistant",
            content: "",
            functionCall: fc
          });
          
          const toolResult = await executeTool(fc.name, fc.args || {});
          
          conversationMessages.push({
            role: "function",
            content: toolResult,
            functionResponse: {
              name: fc.name,
              response: { result: toolResult }
            }
          });
          
          continue;
        }
        
        // 提取文本
        finalText = parts.filter(p => p.text).map(p => p.text).join("");
        break;
      }
      
      // Anthropic 格式
      if (provider === "anthropic") {
        const url = buildApiUrl(baseUrl, "anthropic");
        
        const bodyMessages = conversationMessages.map(m => {
          if (m.tool_use_id) {
            return {
              role: "user",
              content: [{
                type: "tool_result",
                tool_use_id: m.tool_use_id,
                content: m.content
              }]
            };
          }
          
          // 处理带图片的消息
          if (m.images && m.images.length > 0) {
            const contentParts = [];
            m.images.forEach(img => {
              const match = img.match(/^data:(.+);base64,(.+)$/);
              if (match) {
                contentParts.push({
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: match[1],
                    data: match[2]
                  }
                });
              }
            });
            contentParts.push({ type: "text", text: m.content || "" });
            return { role: m.role, content: contentParts };
          }
          
          return { role: m.role, content: m.content };
        });
        
        const body = {
          model,
          max_tokens: maxTokens,
          messages: bodyMessages
        };
        
        if (globalInstruction) {
          body.system = globalInstruction;
        }
        
        if (formattedTools.length > 0) {
          body.tools = formattedTools;
        }
        
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify(body)
        });
        
        if (!resp.ok) throw new Error("Anthropic API 错误: " + resp.status);
        response = await resp.json();
        
        // 累计 token
        if (response.usage) {
          totalUsage.promptTokens += response.usage.input_tokens || 0;
          totalUsage.completionTokens += response.usage.output_tokens || 0;
          totalUsage.totalTokens += (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
        }
        
        // 检查是否有工具调用
        const toolUseBlock = response.content?.find(b => b.type === "tool_use");
        if (toolUseBlock) {
          updateStreamingMessage(assistantMsgId, `🔧 正在调用: ${toolUseBlock.name}...`);
          
          // 添加助手消息
          conversationMessages.push({
            role: "assistant",
            content: response.content
          });
          
          const toolResult = await executeTool(toolUseBlock.name, toolUseBlock.input || {});
          
          conversationMessages.push({
            role: "user",
            tool_use_id: toolUseBlock.id,
            content: toolResult
          });
          
          continue;
        }
        
        // 提取文本
        finalText = response.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
        break;
      }
      
      break;
    }
    
    // 更新显示
    updateStreamingMessage(assistantMsgId, finalText);
    setStatus("");
    
    return {
      text: finalText,
      usage: totalUsage
    };
  }

  async function callLLM(connection, messages, globalInstruction, overrideModel) {
    const provider = normalizeProvider(connection.provider);
    const baseUrl = connection.baseUrl;
    const apiKey = connection.apiKey;
    const model = overrideModel || connection.defaultModel;
    
    if (!model) {
      throw new Error("未设置模型名称。");
    }
    
    const config = state.generationConfig || {};
    const temperature = config.temperature ?? 0.7;
    const maxTokens = config.maxTokens || 4096;

    // OpenAI 及兼容格式
    if (provider === "openai") {
      const url = buildApiUrl(baseUrl, "openai");
      
      const bodyMessages = [];
      if (globalInstruction && globalInstruction.trim()) {
        bodyMessages.push({ role: "system", content: globalInstruction });
      }
      messages.forEach((m) => {
        bodyMessages.push({ role: m.role, content: m.content });
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
        }),
      });
      
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error("OpenAI 接口错误：" + resp.status + " " + text);
      }
      
      const data = await resp.json();
      const choice = data.choices && data.choices[0];
      if (!choice || !choice.message || typeof choice.message.content !== "string") {
        throw new Error("响应格式异常。");
      }
      
      const usage = data.usage || {};
      return {
        text: choice.message.content.trim(),
        usage: {
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0,
        },
      };
    }

    // Gemini
    if (provider === "gemini") {
      // 自动选择 API 版本
      const apiVersion = getGeminiApiVersion(model);
      let safeBase = baseUrl || `https://generativelanguage.googleapis.com/${apiVersion}`;
      
      // 如果用户填的是完整 URL（包含版本），就用用户的
      // 如果用户只填了基础域名，就自动加版本
      if (safeBase.includes("googleapis.com") && !safeBase.includes("/v1")) {
        safeBase = safeBase.replace(/\/$/, "") + "/" + apiVersion;
      }
      safeBase = safeBase.replace(/\/$/, "");
      
      const url = safeBase + "/models/" + encodeURIComponent(model) + ":generateContent?key=" + apiKey;
      
      const contents = [];
      
      // 系统指令作为开头
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error("Gemini 接口错误：" + resp.status + " " + text);
      }
      
      const data = await resp.json();
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content ||
          !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
        throw new Error("Gemini 响应格式异常。");
      }
      
      const usage = data.usageMetadata || {};
      return {
        text: data.candidates[0].content.parts[0].text.trim(),
        usage: {
          promptTokens: usage.promptTokenCount || 0,
          completionTokens: usage.candidatesTokenCount || 0,
          totalTokens: (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0),
        },
      };
    }

    // Anthropic Claude
    if (provider === "anthropic") {
      const url = buildApiUrl(baseUrl, "anthropic");
      
      const bodyMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      
      const reqBody = {
        model,
        max_tokens: maxTokens,
        messages: bodyMessages,
      };
      
      if (globalInstruction && globalInstruction.trim()) {
        reqBody.system = globalInstruction;
      }
      
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(reqBody),
      });
      
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error("Anthropic 接口错误：" + resp.status + " " + text);
      }
      
      const data = await resp.json();
      if (!data.content || !data.content[0] || typeof data.content[0].text !== "string") {
        throw new Error("Anthropic 响应格式异常。");
      }
      
      const usage = data.usage || {};
      return {
        text: data.content[0].text.trim(),
        usage: {
          promptTokens: usage.input_tokens || 0,
          completionTokens: usage.output_tokens || 0,
          totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
        },
      };
    }

    throw new Error("不支持的 provider: " + provider);
  }

  // ========== 流式 API 调用 ==========
  async function callLLMStream(connection, messages, globalInstruction, overrideModel, onChunk) {
    const provider = normalizeProvider(connection.provider);
    const baseUrl = connection.baseUrl;
    const apiKey = connection.apiKey;
    const model = overrideModel || connection.defaultModel;
    
    if (!model) {
      throw new Error("未设置模型名称。");
    }
    
    const config = state.generationConfig || {};
    const temperature = config.temperature ?? 0.7;
    const maxTokens = config.maxTokens || 4096;

    // OpenAI 流式
    if (provider === "openai") {
      const url = buildApiUrl(baseUrl, "openai");
      
      const bodyMessages = [];
      if (globalInstruction && globalInstruction.trim()) {
        bodyMessages.push({ role: "system", content: globalInstruction });
      }
      
      // 处理消息（包含图片）
      messages.forEach((m) => {
        if (m.images && m.images.length > 0) {
          // 多模态消息
          const contentParts = [];
          contentParts.push({ type: "text", text: m.content });
          m.images.forEach(img => {
            contentParts.push({
              type: "image_url",
              image_url: { url: img }
            });
          });
          bodyMessages.push({ role: m.role, content: contentParts });
        } else {
          bodyMessages.push({ role: m.role, content: m.content });
        }
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
          stream: true,
        }),
      });
      
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error("OpenAI 接口错误：" + resp.status + " " + text);
      }
      
      return await processOpenAIStream(resp, onChunk);
    }

    // Gemini 流式
    if (provider === "gemini") {
      const apiVersion = getGeminiApiVersion(model);
      let safeBase = baseUrl || `https://generativelanguage.googleapis.com/${apiVersion}`;
      
      if (!safeBase.includes("/v1")) {
        safeBase = safeBase.replace(/\/$/, "") + `/${apiVersion}`;
      }
      safeBase = safeBase.replace(/\/$/, "");
      
      const url = safeBase + "/models/" + encodeURIComponent(model) + ":streamGenerateContent?alt=sse&key=" + apiKey;
      
      const contents = [];
      
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
      
      // 处理消息（包含图片）
      messages.forEach((m) => {
        const role = m.role === "assistant" ? "model" : "user";
        const parts = [];
        
        if (m.images && m.images.length > 0) {
          m.images.forEach(img => {
            // 提取 base64 数据
            const match = img.match(/^data:(.+);base64,(.+)$/);
            if (match) {
              parts.push({
                inline_data: {
                  mime_type: match[1],
                  data: match[2]
                }
              });
            }
          });
        }
        
        parts.push({ text: m.content });
        contents.push({ role, parts });
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error("Gemini 接口错误：" + resp.status + " " + text);
      }
      
      return await processGeminiStream(resp, onChunk);
    }

    // Anthropic 流式
    if (provider === "anthropic") {
      const url = buildApiUrl(baseUrl, "anthropic");
      
      // 处理消息（包含图片）
      const bodyMessages = messages.map((m) => {
        if (m.images && m.images.length > 0) {
          const contentParts = [];
          m.images.forEach(img => {
            const match = img.match(/^data:(.+);base64,(.+)$/);
            if (match) {
              contentParts.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: match[1],
                  data: match[2]
                }
              });
            }
          });
          contentParts.push({ type: "text", text: m.content });
          return { role: m.role, content: contentParts };
        }
        return { role: m.role, content: m.content };
      });
      
      const reqBody = {
        model,
        max_tokens: maxTokens,
        messages: bodyMessages,
        stream: true,
      };
      
      if (globalInstruction && globalInstruction.trim()) {
        reqBody.system = globalInstruction;
      }
      
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(reqBody),
      });
      
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error("Anthropic 接口错误：" + resp.status + " " + text);
      }
      
      return await processAnthropicStream(resp, onChunk);
    }

    throw new Error("不支持的 provider: " + provider);
  }

  // 处理 OpenAI 流式响应
  async function processOpenAIStream(resp, onChunk) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let usage = null;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");
      
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onChunk(delta);
          }
          if (json.usage) {
            usage = {
              promptTokens: json.usage.prompt_tokens || 0,
              completionTokens: json.usage.completion_tokens || 0,
              totalTokens: json.usage.total_tokens || 0,
            };
          }
        } catch (e) {}
      }
    }
    
    return { text: fullText, usage };
  }

  // 处理 Gemini 流式响应
  async function processGeminiStream(resp, onChunk) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let usage = null;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");
      
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        
        try {
          const json = JSON.parse(data);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            fullText += text;
            onChunk(text);
          }
          if (json.usageMetadata) {
            usage = {
              promptTokens: json.usageMetadata.promptTokenCount || 0,
              completionTokens: json.usageMetadata.candidatesTokenCount || 0,
              totalTokens: (json.usageMetadata.promptTokenCount || 0) + (json.usageMetadata.candidatesTokenCount || 0),
            };
          }
        } catch (e) {}
      }
    }
    
    return { text: fullText, usage };
  }

  // 处理 Anthropic 流式响应
  async function processAnthropicStream(resp, onChunk) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let usage = null;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");
      
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        
        try {
          const json = JSON.parse(data);
          if (json.type === "content_block_delta" && json.delta?.text) {
            fullText += json.delta.text;
            onChunk(json.delta.text);
          }
          if (json.type === "message_delta" && json.usage) {
            usage = {
              promptTokens: 0,
              completionTokens: json.usage.output_tokens || 0,
              totalTokens: json.usage.output_tokens || 0,
            };
          }
          if (json.type === "message_start" && json.message?.usage) {
            usage = {
              promptTokens: json.message.usage.input_tokens || 0,
              completionTokens: 0,
              totalTokens: json.message.usage.input_tokens || 0,
            };
          }
        } catch (e) {}
      }
    }
    
    return { text: fullText, usage };
  }

  // ========== 输入框自适应 ==========
  function autoResizeInput() {
    if (!els.userInput) return;
    els.userInput.style.height = "auto";
    els.userInput.style.height = Math.min(els.userInput.scrollHeight, 150) + "px";
  }

  // ========== 事件绑定 ==========
  function initEventListeners() {
    // 侧边栏
    if (els.openSidebarBtn) {
      els.openSidebarBtn.addEventListener("click", openSidebar);
    }
    if (els.closeSidebarBtn) {
      els.closeSidebarBtn.addEventListener("click", closeSidebar);
    }
    
    // 新建对话
    if (els.newChatButton) {
      els.newChatButton.addEventListener("click", createNewChat);
    }
    
    // 搜索
    if (els.chatSearchInput) {
      els.chatSearchInput.addEventListener("input", (e) => {
        searchKeyword = (e.target.value || "").toLowerCase().trim();
        renderChatList();
      });
    }
    
    // 模型切换面板
    if (els.switchModelBtn) {
      els.switchModelBtn.addEventListener("click", toggleModelPanel);
    }
    if (els.closeModelPanel) {
      els.closeModelPanel.addEventListener("click", () => {
        els.modelSwitchPanel.classList.add("hidden");
      });
    }
    if (els.connectionSelect) {
      els.connectionSelect.addEventListener("change", handleConnectionChange);
    }
    if (els.activeModelInput) {
      els.activeModelInput.addEventListener("change", handleModelChange);
      els.activeModelInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          applyCustomModel();
        }
      });
    }
    if (els.applyCustomModel) {
      els.applyCustomModel.addEventListener("click", applyCustomModel);
    }
    // 点击连接标识也可以打开模型切换面板
    if (els.currentConnectionName) {
      els.currentConnectionName.addEventListener("click", toggleModelPanel);
    }
    
    // 发送消息
    if (els.sendButton) {
      els.sendButton.addEventListener("click", handleSend);
    }
    if (els.userInput) {
      els.userInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });
      els.userInput.addEventListener("input", autoResizeInput);
    }
    
    // 图片上传
    if (els.imageUploadBtn) {
      els.imageUploadBtn.addEventListener("click", handleImageUpload);
    }
    if (els.imageInput) {
      els.imageInput.addEventListener("change", handleImageSelected);
    }
    
    // 位置获取
    if (els.locationBtn) {
      els.locationBtn.addEventListener("click", handleGetLocation);
    }
    
    // 联网搜索
    if (els.searchBtn) {
      els.searchBtn.addEventListener("click", handleWebSearch);
    }
    if (els.clearSearchBtn) {
      els.clearSearchBtn.addEventListener("click", clearSearchResults);
    }
    
    // 支持粘贴图片
    document.addEventListener("paste", (e) => {
      if (!els.userInput || document.activeElement !== els.userInput) return;
      
      const items = e.clipboardData?.items;
      if (!items) return;
      
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          
          const reader = new FileReader();
          reader.onload = (ev) => {
            pendingImages.push(ev.target.result);
            renderImagePreview();
          };
          reader.readAsDataURL(file);
        }
      }
    });
    
    // 重命名弹窗
    if (els.closeRenameChatModal) {
      els.closeRenameChatModal.addEventListener("click", closeRenameModal);
    }
    if (els.renameChatCancel) {
      els.renameChatCancel.addEventListener("click", closeRenameModal);
    }
    if (els.renameChatConfirm) {
      els.renameChatConfirm.addEventListener("click", confirmRename);
    }
    if (els.renameChatInput) {
      els.renameChatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") confirmRename();
      });
    }
    
    // 点击空白处关闭模型面板
    document.addEventListener("click", (e) => {
      if (els.modelSwitchPanel && !els.modelSwitchPanel.classList.contains("hidden")) {
        if (!els.modelSwitchPanel.contains(e.target) && e.target !== els.switchModelBtn) {
          els.modelSwitchPanel.classList.add("hidden");
        }
      }
    });
  }

  // ========== 自动记忆提取 ==========
  async function maybeExtractMemory(chatId, connection) {
    const config = state.autoMemory || {};
    if (!config.enabled) {
      console.log("自动记忆未启用");
      return;
    }
    
    const messages = state.messagesByChatId[chatId] || [];
    const rounds = Math.floor(messages.length / 2);
    const extractAfter = config.extractAfterRounds || 3;
    
    console.log(`自动记忆检查: 当前轮数=${rounds}, 触发轮数=${extractAfter}`);
    
    // 每隔 N 轮提取一次
    if (rounds < extractAfter || rounds % extractAfter !== 0) {
      console.log("未达到触发条件，跳过");
      return;
    }
    
    console.log("触发自动记忆提取...");
    
    // 异步提取，不阻塞主流程
    setTimeout(async () => {
      try {
        await extractMemoryFromChat(chatId, connection, messages);
      } catch (e) {
        console.error("自动记忆提取失败:", e);
      }
    }, 500);
  }

  async function extractMemoryFromChat(chatId, connection, messages) {
    // 取最近的几轮对话来分析
    const recentMessages = messages.slice(-10);
    if (recentMessages.length < 2) return;
    
    // 构建对话文本
    const conversationText = recentMessages.map(m => {
      const role = m.role === "user" ? "用户" : "AI";
      return `${role}: ${m.content}`;
    }).join("\n\n");
    
    // 现有记忆
    const existingMemories = (state.memoryItems || [])
      .filter(m => m.enabled !== false)
      .map(m => "- " + m.content)
      .join("\n");
    
    const extractPrompt = `你是一个记忆提取助手。分析以下对话，提取值得长期记住的用户信息。

【现有记忆】
${existingMemories || "（暂无）"}

【最近对话】
${conversationText}

【任务】
1. 从对话中提取新的、值得记住的用户信息（偏好、习惯、身份、重要事件等）
2. 不要重复已有记忆中的信息
3. 只提取明确的事实，不要推测
4. 每条记忆应简洁，一句话概括

【输出格式】
如果有新记忆，用 JSON 数组输出，例如：
["用户喜欢喝咖啡", "用户是程序员"]

如果没有值得记住的新信息，输出空数组：
[]

只输出 JSON 数组，不要其他内容。`;

    const extractMessages = [
      { role: "user", content: extractPrompt }
    ];
    
    const result = await callLLM(connection, extractMessages, "", connection.defaultModel);
    
    // 解析结果
    try {
      const text = result.text.trim();
      // 尝试提取 JSON 数组
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) return;
      
      const newMemories = JSON.parse(match[0]);
      if (!Array.isArray(newMemories) || newMemories.length === 0) return;
      
      // 添加新记忆
      let added = 0;
      newMemories.forEach(content => {
        if (typeof content !== "string" || !content.trim()) return;
        
        // 检查是否已存在类似记忆
        const exists = (state.memoryItems || []).some(m => 
          m.content.toLowerCase().includes(content.toLowerCase().slice(0, 20)) ||
          content.toLowerCase().includes(m.content.toLowerCase().slice(0, 20))
        );
        
        if (!exists) {
          state.memoryItems.push({
            id: uuid(),
            content: content.trim(),
            enabled: true,
            createdAt: Date.now(),
            autoExtracted: true, // 标记为自动提取
          });
          added++;
        }
      });
      
      if (added > 0) {
        saveState(state);
        console.log(`自动提取了 ${added} 条新记忆`);
        
        if (window.LLMHubSync && window.LLMHubSync.autoSync) {
          window.LLMHubSync.autoSync();
        }
      }
    } catch (e) {
      console.error("解析记忆提取结果失败:", e);
    }
  }

  // ========== RAG 向量记忆形成 ==========
  async function maybeFormRAGMemory(chatId, connection) {
    const config = state.ragMemory || {};
    if (!config.enabled || !window.LLMHubRAG) return;
    
    const messages = state.messagesByChatId[chatId] || [];
    const rounds = Math.floor(messages.length / 2);
    
    // 每 3 轮形成一次记忆
    if (rounds < 3 || rounds % 3 !== 0) return;
    
    // 异步执行，不阻塞
    setTimeout(async () => {
      try {
        const userId = await window.LLMHubRAG.getCurrentUserId();
        if (!userId) return;
        
        const savedMemories = await window.LLMHubRAG.formMemories(
          messages,
          connection,
          state.connections,
          userId,
          chatId
        );
        
        if (savedMemories.length > 0) {
          console.log(`RAG: 形成了 ${savedMemories.length} 条新记忆`);
        }
      } catch (e) {
        console.error("RAG 记忆形成失败:", e);
      }
    }, 1000);
  }

  // ========== 初始化 ==========
  function init() {
    initDomRefs();
    initEventListeners();
    
    renderChatList();
    renderMessages();
    updateHeader();
    updateConnectionSelect();
    
    // 桌面端默认展开侧边栏
    if (window.innerWidth > 768) {
      els.sidebar.classList.remove("collapsed");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
