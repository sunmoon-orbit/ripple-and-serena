(function () {
  "use strict";

  const { defaultState, loadState, saveState } = window.LLMHubState;
  const config = window.APP_CONFIG || {};
  
  let state = loadState();
  let supabase = null;
  let currentUser = null;
  let syncInProgress = false;
  
  const els = {};

  // 初始化 Supabase 客户端
  function initSupabase() {
    if (!config.supabaseUrl || !config.supabasePublicKey) {
      console.warn("Supabase 配置不完整，云同步不可用");
      return false;
    }
    try {
      supabase = window.supabase.createClient(config.supabaseUrl, config.supabasePublicKey);
      return true;
    } catch (e) {
      console.error("Supabase 初始化失败:", e);
      return false;
    }
  }

  function initDomRefs() {
    els.exportDataButton = document.getElementById("exportDataButton");
    els.importFileInput = document.getElementById("importFileInput");
    
    // 登录相关
    els.notLoggedInArea = document.getElementById("notLoggedInArea");
    els.loggedInArea = document.getElementById("loggedInArea");
    els.showLoginTab = document.getElementById("showLoginTab");
    els.showRegisterTab = document.getElementById("showRegisterTab");
    els.loginForm = document.getElementById("loginForm");
    els.registerForm = document.getElementById("registerForm");
    els.loginEmail = document.getElementById("loginEmail");
    els.loginPassword = document.getElementById("loginPassword");
    els.loginButton = document.getElementById("loginButton");
    els.registerEmail = document.getElementById("registerEmail");
    els.registerPassword = document.getElementById("registerPassword");
    els.registerButton = document.getElementById("registerButton");
    els.authMessage = document.getElementById("authMessage");
    
    // 已登录相关
    els.userEmail = document.getElementById("userEmail");
    els.syncIndicator = document.getElementById("syncIndicator");
    els.lastSyncTime = document.getElementById("lastSyncTime");
    els.syncNowButton = document.getElementById("syncNowButton");
    els.pullFromCloudButton = document.getElementById("pullFromCloudButton");
    els.logoutButton = document.getElementById("logoutButton");
  }

  function showAuthMessage(msg, isError) {
    if (!els.authMessage) return;
    els.authMessage.textContent = msg;
    els.authMessage.className = "auth-message" + (isError ? " error" : " success");
    els.authMessage.style.display = "block";
  }

  function hideAuthMessage() {
    if (els.authMessage) {
      els.authMessage.style.display = "none";
    }
  }

  function updateUIForUser(user) {
    currentUser = user;
    if (user) {
      if (els.notLoggedInArea) els.notLoggedInArea.style.display = "none";
      if (els.loggedInArea) els.loggedInArea.style.display = "block";
      if (els.userEmail) els.userEmail.textContent = user.email;
      updateLastSyncTime();
    } else {
      if (els.notLoggedInArea) els.notLoggedInArea.style.display = "block";
      if (els.loggedInArea) els.loggedInArea.style.display = "none";
    }
  }

  function updateLastSyncTime() {
    const lastSync = localStorage.getItem("llm_hub_last_sync");
    if (els.lastSyncTime) {
      if (lastSync) {
        const d = new Date(parseInt(lastSync, 10));
        els.lastSyncTime.textContent = "上次同步：" + d.toLocaleString();
      } else {
        els.lastSyncTime.textContent = "上次同步：从未";
      }
    }
  }

  function setSyncIndicator(status) {
    if (!els.syncIndicator) return;
    if (status === "syncing") {
      els.syncIndicator.textContent = "◐";
      els.syncIndicator.className = "sync-indicator syncing";
      els.syncIndicator.title = "同步中...";
    } else if (status === "success") {
      els.syncIndicator.textContent = "●";
      els.syncIndicator.className = "sync-indicator success";
      els.syncIndicator.title = "已同步";
    } else if (status === "error") {
      els.syncIndicator.textContent = "●";
      els.syncIndicator.className = "sync-indicator error";
      els.syncIndicator.title = "同步失败";
    } else {
      els.syncIndicator.textContent = "○";
      els.syncIndicator.className = "sync-indicator";
      els.syncIndicator.title = "未同步";
    }
  }

  // ========== 认证功能 ==========
  async function handleLogin() {
    if (!supabase) return;
    const email = (els.loginEmail.value || "").trim();
    const password = els.loginPassword.value || "";
    
    if (!email || !password) {
      showAuthMessage("请填写邮箱和密码", true);
      return;
    }

    els.loginButton.disabled = true;
    els.loginButton.textContent = "登录中...";
    hideAuthMessage();

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) throw error;
      
      showAuthMessage("登录成功！", false);
      updateUIForUser(data.user);
      
      // 登录后自动从云端拉取数据
      setTimeout(() => pullFromCloud(), 500);
      
    } catch (e) {
      showAuthMessage("登录失败：" + (e.message || String(e)), true);
    } finally {
      els.loginButton.disabled = false;
      els.loginButton.textContent = "登录";
    }
  }

  async function handleRegister() {
    if (!supabase) return;
    const email = (els.registerEmail.value || "").trim();
    const password = els.registerPassword.value || "";
    
    if (!email || !password) {
      showAuthMessage("请填写邮箱和密码", true);
      return;
    }
    if (password.length < 6) {
      showAuthMessage("密码至少需要6位", true);
      return;
    }

    els.registerButton.disabled = true;
    els.registerButton.textContent = "注册中...";
    hideAuthMessage();

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });
      
      if (error) throw error;
      
      if (data.user && !data.user.confirmed_at) {
        showAuthMessage("注册成功！请查收验证邮件后再登录。", false);
      } else {
        showAuthMessage("注册成功！", false);
        updateUIForUser(data.user);
      }
      
    } catch (e) {
      showAuthMessage("注册失败：" + (e.message || String(e)), true);
    } finally {
      els.registerButton.disabled = false;
      els.registerButton.textContent = "注册";
    }
  }

  async function handleLogout() {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
      updateUIForUser(null);
      setSyncIndicator("idle");
    } catch (e) {
      console.error("登出失败:", e);
    }
  }

  // ========== 云同步功能 ==========
  
  // 智能合并两个数据集
  function mergeData(localData, incomingData) {
    const result = Object.assign({}, defaultState);
    
    // 合并 connections（根据 ID 去重，保留两边都有的）
    const connMap = new Map();
    (localData.connections || []).forEach(c => connMap.set(c.id, c));
    (incomingData.connections || []).forEach(c => {
      if (!connMap.has(c.id)) {
        connMap.set(c.id, c);
      }
      // 如果两边都有同一个连接，保留本地的（因为可能有API Key更新）
    });
    result.connections = Array.from(connMap.values());
    
    // 合并 chats（根据 ID 去重，同 ID 取 updatedAt 较新的）
    const chatMap = new Map();
    (localData.chats || []).forEach(c => chatMap.set(c.id, c));
    (incomingData.chats || []).forEach(c => {
      const existing = chatMap.get(c.id);
      if (!existing) {
        chatMap.set(c.id, c);
      } else {
        // 保留更新时间较新的
        const existingTime = existing.updatedAt || existing.createdAt || 0;
        const incomingTime = c.updatedAt || c.createdAt || 0;
        if (incomingTime > existingTime) {
          chatMap.set(c.id, c);
        }
      }
    });
    result.chats = Array.from(chatMap.values());
    
    // 合并 messagesByChatId
    result.messagesByChatId = {};
    const allChatIds = new Set([
      ...Object.keys(localData.messagesByChatId || {}),
      ...Object.keys(incomingData.messagesByChatId || {})
    ]);
    
    allChatIds.forEach(chatId => {
      const localMsgs = (localData.messagesByChatId || {})[chatId] || [];
      const incomingMsgs = (incomingData.messagesByChatId || {})[chatId] || [];
      
      // 根据消息 ID 去重，合并两边的消息
      const msgMap = new Map();
      localMsgs.forEach(m => msgMap.set(m.id, m));
      incomingMsgs.forEach(m => {
        if (!msgMap.has(m.id)) {
          msgMap.set(m.id, m);
        }
      });
      
      // 按创建时间排序
      const merged = Array.from(msgMap.values());
      merged.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      result.messagesByChatId[chatId] = merged;
    });
    
    // 合并 memoryItems（根据 ID 去重）
    const memoryMap = new Map();
    (localData.memoryItems || []).forEach(m => memoryMap.set(m.id, m));
    (incomingData.memoryItems || []).forEach(m => {
      if (!memoryMap.has(m.id)) {
        memoryMap.set(m.id, m);
      }
    });
    result.memoryItems = Array.from(memoryMap.values());
    
    // 合并 summariesByChatId（保留较新的或较长的）
    result.summariesByChatId = Object.assign(
      {},
      incomingData.summariesByChatId || {},
      localData.summariesByChatId || {}
    );
    
    // 合并 tokenStats
    result.tokenStats = Object.assign(
      {},
      incomingData.tokenStats || {},
      localData.tokenStats || {}
    );
    
    // 配置类的保留本地
    result.globalInstruction = localData.globalInstruction || incomingData.globalInstruction || "";
    result.generationConfig = localData.generationConfig || incomingData.generationConfig || defaultState.generationConfig;
    result.contextLimit = localData.contextLimit || incomingData.contextLimit || defaultState.contextLimit;
    result.autoMemory = localData.autoMemory || incomingData.autoMemory || defaultState.autoMemory;
    
    // 活动状态保留本地
    result.activeConnectionId = localData.activeConnectionId || incomingData.activeConnectionId;
    result.activeChatId = localData.activeChatId || incomingData.activeChatId;
    
    return result;
  }

  async function syncToCloud() {
    if (!supabase || !currentUser || syncInProgress) return;
    
    syncInProgress = true;
    setSyncIndicator("syncing");
    
    try {
      state = loadState();
      
      // 准备要同步的数据
      const syncData = {
        connections: state.connections,
        chats: state.chats,
        activeChatId: state.activeChatId,
        activeConnectionId: state.activeConnectionId,
        messagesByChatId: state.messagesByChatId,
        globalInstruction: state.globalInstruction,
        summariesByChatId: state.summariesByChatId,
        generationConfig: state.generationConfig,
        memoryItems: state.memoryItems,
        tokenStats: state.tokenStats,
        contextLimit: state.contextLimit,
      };

      const { error } = await supabase
        .from("user_data")
        .upsert({
          user_id: currentUser.id,
          data: syncData,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: "user_id",
        });

      if (error) throw error;

      localStorage.setItem("llm_hub_last_sync", String(Date.now()));
      updateLastSyncTime();
      setSyncIndicator("success");
      
    } catch (e) {
      console.error("同步失败:", e);
      setSyncIndicator("error");
    } finally {
      syncInProgress = false;
    }
  }

  async function pullFromCloud(forceOverwrite = false) {
    if (!supabase || !currentUser || syncInProgress) return;
    
    syncInProgress = true;
    setSyncIndicator("syncing");
    
    try {
      const { data, error } = await supabase
        .from("user_data")
        .select("data, updated_at")
        .eq("user_id", currentUser.id)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          // 没有数据，首次使用，把本地数据推上去
          setSyncIndicator("success");
          await syncToCloud();
          return;
        }
        throw error;
      }

      if (data && data.data) {
        const cloudData = data.data;
        const localData = loadState();
        
        let finalData;
        if (forceOverwrite) {
          // 完全覆盖
          finalData = Object.assign({}, defaultState, cloudData);
        } else {
          // 智能合并
          finalData = mergeData(localData, cloudData);
        }
        
        saveState(finalData);
        state = finalData;
        
        localStorage.setItem("llm_hub_last_sync", String(Date.now()));
        updateLastSyncTime();
        setSyncIndicator("success");
        
        const mode = forceOverwrite ? "覆盖" : "合并";
        window.alert(`已从云端${mode}数据，刷新页面后生效。`);
      }
      
    } catch (e) {
      console.error("拉取失败:", e);
      setSyncIndicator("error");
      window.alert("从云端拉取失败：" + (e.message || String(e)));
    } finally {
      syncInProgress = false;
    }
  }

  // ========== 本地导入导出 ==========
  function handleExportData() {
    state = loadState();
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = "llm-hub-data-" + stamp + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleImportDataFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const text = String(ev.target.result || "");
        const imported = JSON.parse(text);
        if (!imported || typeof imported !== "object") {
          throw new Error("JSON 格式不正确。");
        }
        if (
          !Array.isArray(imported.connections) ||
          !Array.isArray(imported.chats)
        ) {
          throw new Error("数据结构好像不是这个工具导出的。");
        }
        
        // 让用户选择合并还是覆盖
        const choice = window.confirm(
          "检测到导入文件。\n\n" +
          "【确定】= 智能合并（保留本地 + 导入新的，不丢数据）\n" +
          "【取消】= 完全覆盖（丢弃本地，只保留导入的）\n\n" +
          "推荐选择【确定】进行合并。"
        );
        
        const localData = loadState();
        let finalData;
        
        if (choice) {
          // 智能合并
          finalData = mergeData(localData, imported);
        } else {
          // 再次确认覆盖
          if (!window.confirm("确定要完全覆盖本地数据吗？这将丢失所有本地记录！")) {
            e.target.value = "";
            return;
          }
          finalData = Object.assign({}, defaultState, imported);
        }
        
        saveState(finalData);
        state = finalData;
        
        // 如果已登录，自动同步到云端
        if (currentUser) {
          await syncToCloud();
        }
        
        const mode = choice ? "合并" : "覆盖";
        window.alert(`导入${mode}完成，刷新页面后生效。`);
      } catch (err) {
        window.alert("导入失败：" + (err.message || String(err)));
      } finally {
        e.target.value = "";
      }
    };
    reader.onerror = () => {
      window.alert("读取文件失败。");
      e.target.value = "";
    };
    reader.readAsText(file, "utf-8");
  }

  // ========== 事件绑定 ==========
  function initEventListeners() {
    if (els.exportDataButton) {
      els.exportDataButton.addEventListener("click", handleExportData);
    }
    if (els.importFileInput) {
      els.importFileInput.addEventListener("change", handleImportDataFile);
    }
    
    // 登录/注册切换
    if (els.showLoginTab) {
      els.showLoginTab.addEventListener("click", () => {
        els.showLoginTab.classList.add("active");
        els.showRegisterTab.classList.remove("active");
        els.loginForm.style.display = "block";
        els.registerForm.style.display = "none";
        hideAuthMessage();
      });
    }
    if (els.showRegisterTab) {
      els.showRegisterTab.addEventListener("click", () => {
        els.showRegisterTab.classList.add("active");
        els.showLoginTab.classList.remove("active");
        els.registerForm.style.display = "block";
        els.loginForm.style.display = "none";
        hideAuthMessage();
      });
    }
    
    // 登录/注册按钮
    if (els.loginButton) {
      els.loginButton.addEventListener("click", handleLogin);
    }
    if (els.registerButton) {
      els.registerButton.addEventListener("click", handleRegister);
    }
    
    // 同步按钮
    if (els.syncNowButton) {
      els.syncNowButton.addEventListener("click", async () => {
        els.syncNowButton.disabled = true;
        await syncToCloud();
        els.syncNowButton.disabled = false;
        if (!syncInProgress) {
          window.alert("同步完成！");
        }
      });
    }
    if (els.pullFromCloudButton) {
      els.pullFromCloudButton.addEventListener("click", async () => {
        // 让用户选择合并还是覆盖
        const choice = window.confirm(
          "从云端拉取数据：\n\n" +
          "【确定】= 智能合并（保留本地 + 云端新的，不丢数据）\n" +
          "【取消】= 完全覆盖（丢弃本地，只保留云端的）\n\n" +
          "推荐选择【确定】进行合并。"
        );
        
        if (!choice) {
          // 用户选择覆盖，再次确认
          if (!window.confirm("确定要完全覆盖本地数据吗？这将丢失所有本地记录！")) {
            return;
          }
        }
        
        els.pullFromCloudButton.disabled = true;
        await pullFromCloud(!choice); // choice=true时合并，choice=false时覆盖
        els.pullFromCloudButton.disabled = false;
      });
    }
    if (els.logoutButton) {
      els.logoutButton.addEventListener("click", handleLogout);
    }

    // 回车键登录/注册
    if (els.loginPassword) {
      els.loginPassword.addEventListener("keypress", (e) => {
        if (e.key === "Enter") handleLogin();
      });
    }
    if (els.registerPassword) {
      els.registerPassword.addEventListener("keypress", (e) => {
        if (e.key === "Enter") handleRegister();
      });
    }
  }

  // ========== 初始化 ==========
  async function init() {
    initDomRefs();
    initEventListeners();
    
    if (initSupabase()) {
      // 检查当前登录状态
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user) {
        updateUIForUser(session.user);
      }
      
      // 监听登录状态变化
      supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" && session) {
          updateUIForUser(session.user);
        } else if (event === "SIGNED_OUT") {
          updateUIForUser(null);
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // 暴露同步函数给其他模块使用
  let syncTimer = null;
  
  // 带防抖的自动同步（2秒内多次调用只执行一次）
  function autoSync() {
    if (!currentUser) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncToCloud();
    }, 2000);
  }

  window.LLMHubSync = {
    syncToCloud,
    pullFromCloud,
    autoSync,
    isLoggedIn: () => !!currentUser,
  };
})();
