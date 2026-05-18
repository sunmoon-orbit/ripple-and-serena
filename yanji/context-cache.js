(function () {
  "use strict";

  const LOCAL_KEY = "llm_hub_state_v1";
  const SUMMARY_SENTINEL = "[Yanji conversation summary]";
  const DEBUG_FLAG = "__YANJI_CONTEXT_CACHE_DEBUG__";
  const LAST_PATCH_KEY = "__YANJI_CONTEXT_CACHE_LAST_PATCH__";

  function getRequestUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return "";
  }

  function getSafeRequestPath(input) {
    const url = getRequestUrl(input);
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.origin + parsed.pathname;
    } catch (e) {
      return url.split("?")[0];
    }
  }

  function recordDebug(event) {
    if (!window[DEBUG_FLAG]) return;
    window[LAST_PATCH_KEY] = Object.assign(
      {
        at: new Date().toISOString(),
      },
      event || {}
    );
    console.log("Yanji context cache debug:", window[LAST_PATCH_KEY]);
  }

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

  function buildSummaryText(summary) {
    return (
      SUMMARY_SENTINEL +
      "\n以下是较早对话的摘要，仅用于保持长期上下文；最近原文消息优先级更高。\n" +
      summary
    );
  }

  function hasSummaryText(text) {
    return typeof text === "string" && text.includes(SUMMARY_SENTINEL);
  }

  function hasSummaryMessage(messages) {
    return messages.some((message) => {
      if (!message || typeof message.content !== "string") return false;
      return hasSummaryText(message.content);
    });
  }

  function hasSummaryPart(parts) {
    if (!Array.isArray(parts)) return false;
    return parts.some((part) => part && hasSummaryText(part.text));
  }

  function isAnthropicRequest(input) {
    return /anthropic|claude/i.test(getRequestUrl(input));
  }

  function isKnownNonModelRequest(input) {
    return /memory\.ravenlove\.cc|nominatim\.openstreetmap\.org/i.test(getRequestUrl(input));
  }

  function isLikelyOpenAIStylePayload(input, payload) {
    const url = getRequestUrl(input);
    if (/\/chat\/completions|\/responses|openai|deepseek/i.test(url)) return true;
    if (payload && typeof payload.model === "string" && Array.isArray(payload.messages)) return true;
    return false;
  }

  function isLikelyGeminiPayload(input, payload) {
    const url = getRequestUrl(input);
    if (/generativelanguage|googleapis|gemini/i.test(url)) return true;
    if (payload && Array.isArray(payload.contents)) return true;
    return false;
  }

  function findSummaryInsertIndex(messages) {
    let index = 0;
    while (index < messages.length) {
      const role = messages[index] && messages[index].role;
      if (role !== "system" && role !== "developer") break;
      index += 1;
    }
    return index;
  }

  function addSummaryToMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return messages;
    if (hasSummaryMessage(messages)) return messages;

    const summary = getActiveSummary();
    if (!summary) return messages;

    const summaryMessage = {
      role: "system",
      content: buildSummaryText(summary),
    };

    const nextMessages = messages.slice();
    nextMessages.splice(findSummaryInsertIndex(nextMessages), 0, summaryMessage);
    return nextMessages;
  }

  function addSummaryToGeminiPayload(payload) {
    if (!payload || !Array.isArray(payload.contents)) return payload;

    const summary = getActiveSummary();
    if (!summary) return payload;

    const systemInstruction = payload.systemInstruction || {};
    const parts = Array.isArray(systemInstruction.parts) ? systemInstruction.parts : [];
    if (hasSummaryPart(parts)) return payload;

    return Object.assign({}, payload, {
      systemInstruction: Object.assign({}, systemInstruction, {
        parts: parts.concat([{ text: buildSummaryText(summary) }]),
      }),
    });
  }

  function shouldParseBody(input, body) {
    if (!body || isAnthropicRequest(input) || isKnownNonModelRequest(input)) return false;
    if (typeof body !== "string") return false;
    if (!body.trim().startsWith("{")) return false;
    return true;
  }

  function patchJsonBody(input, init, body) {
    if (!shouldParseBody(input, body)) {
      recordDebug({
        patched: false,
        reason: "skipped-request",
        url: getSafeRequestPath(input),
      });
      return body;
    }

    try {
      const payload = JSON.parse(body);

      if (Array.isArray(payload.messages) && isLikelyOpenAIStylePayload(input, payload)) {
        const patchedMessages = addSummaryToMessages(payload.messages);
        const patched = patchedMessages !== payload.messages;
        recordDebug({
          patched,
          kind: "openai-compatible",
          url: getSafeRequestPath(input),
          messageCount: patchedMessages.length,
          hasSummary: hasSummaryMessage(patchedMessages),
        });
        if (!patched) return body;

        payload.messages = patchedMessages;
        return JSON.stringify(payload);
      }

      if (Array.isArray(payload.contents) && isLikelyGeminiPayload(input, payload)) {
        const patchedPayload = addSummaryToGeminiPayload(payload);
        const parts = patchedPayload.systemInstruction && patchedPayload.systemInstruction.parts;
        const patched = patchedPayload !== payload;
        recordDebug({
          patched,
          kind: "gemini-native",
          url: getSafeRequestPath(input),
          contentCount: payload.contents.length,
          hasSummary: hasSummaryPart(parts),
        });
        if (!patched) return body;

        return JSON.stringify(patchedPayload);
      }

      recordDebug({
        patched: false,
        reason: "not-model-payload",
        url: getSafeRequestPath(input),
      });
      return body;
    } catch (e) {
      recordDebug({
        patched: false,
        reason: "json-parse-failed",
        url: getSafeRequestPath(input),
      });
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

  // ========== 通用 TTL 缓存（供 fetchMoonMemories 等共用）==========
  const _cache = new Map();
  const _CACHE_TTL = 5 * 60 * 1000; // 5 分钟

  function cacheGet(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > _CACHE_TTL) { _cache.delete(key); return null; }
    return entry.data;
  }

  function cacheSet(key, data) {
    _cache.set(key, { data, ts: Date.now() });
  }

  function cacheClear(prefix) {
    if (!prefix) { _cache.clear(); return; }
    for (const k of _cache.keys()) {
      if (k.startsWith(prefix)) _cache.delete(k);
    }
  }

  window.YanjiContextCache = {
    addSummaryToMessages,
    addSummaryToGeminiPayload,
    getActiveSummary,
    installFetchPatch,
    cacheGet,
    cacheSet,
    cacheClear,
    getLastPatchDebug: function () {
      return window[LAST_PATCH_KEY] || null;
    },
    setDebug: function (enabled) {
      window[DEBUG_FLAG] = !!enabled;
      return window[DEBUG_FLAG];
    },
  };

  installFetchPatch();
})();
