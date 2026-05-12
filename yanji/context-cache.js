(function () {
  "use strict";

  const LOCAL_KEY = "llm_hub_state_v1";
  const SUMMARY_SENTINEL = "[Yanji conversation summary]";

  function readState() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(LOCAL_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn("Yanji context cache: failed to read local state", e);
      return null;
    }
  }

  function getActiveSummary() {
    const state = readState();
    if (!state || !state.activeChatId || !state.summariesByChatId) return "";

    const summary = state.summariesByChatId[state.activeChatId];
    if (typeof summary === "string") return summary.trim();
    if (summary && typeof summary.text === "string") return summary.text.trim();
    return "";
  }

  function hasSummaryMessage(messages) {
    return messages.some((message) => {
      if (!message || typeof message.content !== "string") return false;
      return message.content.includes(SUMMARY_SENTINEL);
    });
  }

  function isAnthropicRequest(input) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    return /anthropic|claude/i.test(url);
  }

  function addSummaryToMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return messages;
    if (hasSummaryMessage(messages)) return messages;

    const summary = getActiveSummary();
    if (!summary) return messages;

    const summaryMessage = {
      role: "system",
      content:
        SUMMARY_SENTINEL +
        "\n以下是较早对话的摘要，仅用于保持长期上下文；最近原文消息优先级更高。\n" +
        summary,
    };

    const nextMessages = messages.slice();
    const firstRole = nextMessages[0] && nextMessages[0].role;
    const insertAt = firstRole === "system" || firstRole === "developer" ? 1 : 0;
    nextMessages.splice(insertAt, 0, summaryMessage);
    return nextMessages;
  }

  function shouldPatchRequest(input, init, body) {
    if (!body || isAnthropicRequest(input)) return false;
    if (typeof body !== "string") return false;
    if (!body.trim().startsWith("{")) return false;

    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (/memory\.ravenlove\.cc|nominatim\.openstreetmap\.org/i.test(url)) return false;

    return true;
  }

  function patchJsonBody(input, init, body) {
    if (!shouldPatchRequest(input, init, body)) return body;

    try {
      const payload = JSON.parse(body);
      if (!Array.isArray(payload.messages)) return body;

      const patchedMessages = addSummaryToMessages(payload.messages);
      if (patchedMessages === payload.messages) return body;

      payload.messages = patchedMessages;
      return JSON.stringify(payload);
    } catch (e) {
      return body;
    }
  }

  function installFetchPatch() {
    if (window.__YANJI_CONTEXT_CACHE_FETCH_PATCHED__) return;
    if (typeof window.fetch !== "function") return;

    const originalFetch = window.fetch.bind(window);
    window.fetch = function patchedFetch(input, init) {
      if (init && typeof init === "object" && init.body) {
        const nextInit = Object.assign({}, init, {
          body: patchJsonBody(input, init, init.body),
        });
        return originalFetch(input, nextInit);
      }

      return originalFetch(input, init);
    };

    window.__YANJI_CONTEXT_CACHE_FETCH_PATCHED__ = true;
  }

  window.YanjiContextCache = {
    addSummaryToMessages,
    getActiveSummary,
    installFetchPatch,
  };

  installFetchPatch();
})();
