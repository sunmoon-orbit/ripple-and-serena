(function () {
  "use strict";

  const BASE_URL = "https://memory.ravenlove.cc";

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c]));
  }

  function getPanel() {
    return $("moonMemoryPreviewArea");
  }

  function openPanel() {
    const panel = getPanel();
    if (!panel) return;
    panel.style.display = "block";
    panel.classList.add("moon-memory-open");
    const tokenInput = $("moonMemoryTokenInput");
    const savedToken = localStorage.getItem("yanji_moon_memory_token") || localStorage.getItem("moon_memory_token") || "";
    if (tokenInput && savedToken && !tokenInput.value) tokenInput.value = savedToken;
    setTimeout(() => {
      const q = $("moonMemoryQueryInput");
      if (q) q.focus();
    }, 80);
  }

  function closePanel() {
    const panel = getPanel();
    if (!panel) return;
    panel.style.display = "none";
    panel.classList.remove("moon-memory-open");
  }

  function togglePanel() {
    const panel = getPanel();
    if (!panel) return;
    const isOpen = panel.style.display !== "none";
    if (isOpen) closePanel();
    else openPanel();
  }

  function getToken() {
    const input = $("moonMemoryTokenInput");
    const token = input ? input.value.trim() : "";
    if (token) {
      localStorage.setItem("yanji_moon_memory_token", token);
      return token;
    }
    return localStorage.getItem("yanji_moon_memory_token") || localStorage.getItem("moon_memory_token") || "";
  }

  function formatContext(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return "";
    let text = "\n\n【Moon Memory 相关记忆，仅供本轮回答参考】\n";
    rows.slice(0, 8).forEach((m, i) => {
      const meta = [m.type, m.agent, m.scope, m.tags].filter(Boolean).join(" / ");
      text += `${i + 1}. ${m.content || ""}${meta ? `\n   元信息：${meta}` : ""}\n`;
    });
    return text;
  }

  async function fetchMemories(query, limit = 8) {
    const token = getToken();
    if (!token) throw new Error("请先填写 Moon Memory API Token。");

    const params = new URLSearchParams();
    if (query && query.trim()) params.set("q", query.trim());
    params.set("limit", String(limit));

    const resp = await fetch(`${BASE_URL}/memories/filter?${params.toString()}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json"
      }
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Moon Memory 读取失败：${resp.status} ${text}`);
    }

    return resp.json();
  }

  function renderResults(rows, query) {
    const content = $("moonMemoryContent");
    if (!content) return;

    if (!Array.isArray(rows) || rows.length === 0) {
      content.innerHTML = `<div class="moon-memory-empty">没有找到相关记忆${query ? "：" + escapeHtml(query) : ""}。</div>`;
      window.__YANJI_MOON_MEMORY_CONTEXT = "";
      return;
    }

    window.__YANJI_MOON_MEMORY_CONTEXT = formatContext(rows);

    const items = rows.slice(0, 8).map((m) => `
      <div class="moon-memory-item">
        <div class="moon-memory-meta">#${escapeHtml(m.id)} · ${escapeHtml(m.type || "memory")} · ${escapeHtml(m.agent || "")} · ${escapeHtml(m.scope || "")}</div>
        <div class="moon-memory-text">${escapeHtml(m.content || "").slice(0, 260)}</div>
      </div>
    `).join("");

    content.innerHTML = `
      <div class="moon-memory-tip">已找到 ${rows.length} 条相关记忆，并会加入下一条消息上下文。</div>
      ${items}
      <div class="moon-memory-actions">
        <button id="moonMemoryUseBtn" class="moon-memory-use-btn" type="button">使用这些记忆并返回输入</button>
      </div>
    `;

    const useBtn = $("moonMemoryUseBtn");
    if (useBtn) {
      useBtn.addEventListener("click", (event) => {
        event.preventDefault();
        closePanel();
        const input = $("userInput");
        if (input) {
          setTimeout(() => input.focus(), 80);
        }
      });
    }
  }

  async function searchFromPanel() {
    const content = $("moonMemoryContent");
    const queryInput = $("moonMemoryQueryInput");
    const userInput = $("userInput");
    const query = (queryInput && queryInput.value.trim()) || (userInput && userInput.value.trim()) || "";

    if (content) content.innerHTML = `<div class="moon-memory-tip">正在检索月亮记忆库……</div>`;

    try {
      const rows = await fetchMemories(query, 8);
      renderResults(rows, query);
    } catch (err) {
      if (content) {
        content.innerHTML = `<div class="moon-memory-empty">${escapeHtml(err.message)}<br>如果这里提示 CORS，就需要给 Moon Memory 后端加跨域允许。</div>`;
      }
    }
  }

  function bind() {
    const btn = $("moonMemoryBtn");
    const panel = getPanel();

    if (!btn || !panel) return false;

  // moonMemoryCloseDelegationFix: make the X close button reliable on mobile.
  document.addEventListener("click", (event) => {
    const closeHit = event.target && event.target.closest && event.target.closest("#clearMoonMemoryBtn, .moon-memory-close, [data-moon-memory-close]");
    if (!closeHit) return;
    event.preventDefault();
    event.stopPropagation();
    closePanel();
  }, true);

    // Capture-phase delegation: works even if another script stops bubbling later.
    document.addEventListener("click", (event) => {
      const hit = event.target && event.target.closest && event.target.closest("#moonMemoryBtn");
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      togglePanel();
    }, true);

    btn.addEventListener("touchend", (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePanel();
    }, { passive: false });

    const searchBtn = $("moonMemorySearchBtn");
    if (searchBtn) {
      searchBtn.addEventListener("click", (event) => {
        event.preventDefault();
        searchFromPanel();
      });
    }

    const queryInput = $("moonMemoryQueryInput");
    if (queryInput) {
      queryInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          searchFromPanel();
        }
      });
    }

    const clearBtn = $("clearMoonMemoryBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", (event) => {
        event.preventDefault();
        window.__YANJI_MOON_MEMORY_CONTEXT = "";
        const content = $("moonMemoryContent");
        if (content) {
          content.innerHTML = `<div class="moon-memory-tip">已清空本轮月亮记忆上下文。可以重新检索。</div>`;
        }
        closePanel();
      });
    }

    const tokenInput = $("moonMemoryTokenInput");
    if (tokenInput) {
      const savedToken = localStorage.getItem("yanji_moon_memory_token") || localStorage.getItem("moon_memory_token") || "";
      if (savedToken && !tokenInput.value) tokenInput.value = savedToken;
      tokenInput.addEventListener("change", () => {
        const token = tokenInput.value.trim();
        if (token) localStorage.setItem("yanji_moon_memory_token", token);
      });
    }

    const autoToggle = $("moonMemoryAutoToggle");
    if (autoToggle) {
      autoToggle.checked = localStorage.getItem("yanji_moon_memory_auto") === "true";
      autoToggle.addEventListener("change", () => {
        localStorage.setItem("yanji_moon_memory_auto", String(autoToggle.checked));
      });
    }

    console.log("Moon Memory bridge ready.");
    return true;
  }

  function init() {
    if (bind()) return;

    // If the app renders slowly, retry a few times.
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (bind() || tries >= 20) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
