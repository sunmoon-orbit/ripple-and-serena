(function () {
  "use strict";

  installApiCompatPatch();

  function installApiCompatPatch() {
    if (window.__YANJI_API_COMPAT_PATCH__) return;
    if (typeof window.fetch !== "function") return;
    window.__YANJI_API_COMPAT_PATCH__ = true;

    const nativeFetch = window.fetch.bind(window);
    const RETRY_STATUS = new Set([400, 403, 405, 406, 415, 422]);

    function parseJsonBody(body) {
      if (!body || typeof body !== "string") return null;
      try {
        return JSON.parse(body);
      } catch (e) {
        return null;
      }
    }

    function inferProvider(url, headers) {
      const u = (url || "").toLowerCase();
      if (u.includes("generativelanguage.googleapis.com") || u.includes(":generatecontent")) return "gemini";
      if (u.includes("api.anthropic.com") || (u.includes("/messages") && headers && headers.has("x-api-key"))) return "anthropic";
      return "openai";
    }

    function isLikelyLLMRequest(url, body) {
      const u = (url || "").toLowerCase();
      if (u.includes("/chat/completions")) return true;
      if (u.includes("/messages")) return true;
      if (u.includes(":streamgeneratecontent") || u.includes(":generatecontent")) return true;
      return !!(body && (body.model || body.messages || body.contents));
    }

    function isStreamRequest(url, body) {
      const u = (url || "").toLowerCase();
      return !!(body && body.stream === true) || u.includes(":streamgeneratecontent");
    }

    function buildGeminiNonStreamUrl(url) {
      return String(url)
        .replace(":streamGenerateContent?alt=sse&", ":generateContent?")
        .replace(":streamGenerateContent?alt=sse", ":generateContent")
        .replace(":streamGenerateContent", ":generateContent");
    }

    function extractText(provider, data) {
      if (!data) return "";
      if (provider === "anthropic") {
        return (data.content || [])
          .filter((b) => b && b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("");
      }
      if (provider === "gemini") {
        return (data.candidates?.[0]?.content?.parts || [])
          .filter((p) => p && typeof p.text === "string")
          .map((p) => p.text)
          .join("");
      }
      return data.choices?.[0]?.message?.content || data.choices?.[0]?.text || "";
    }

    function jsonLine(obj) {
      return "data: " + JSON.stringify(obj) + "\n\n";
    }

    function makeSyntheticStreamResponse(provider, data) {
      const text = extractText(provider, data);
      let payload = "";

      if (provider === "anthropic") {
        payload += jsonLine({ type: "content_block_delta", delta: { type: "text_delta", text } });
        payload += jsonLine({ type: "message_stop" });
      } else if (provider === "gemini") {
        payload += jsonLine({
          candidates: [{ content: { parts: [{ text }] } }],
          usageMetadata: data.usageMetadata || undefined
        });
      } else {
        payload += jsonLine({
          choices: [{ delta: { content: text } }],
          usage: data.usage || undefined
        });
        payload += "data: [DONE]\n\n";
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(payload));
          controller.close();
        }
      });

      return new Response(stream, {
        status: 200,
        statusText: "OK",
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Yanji-Compat-Fallback": "non-stream"
        }
      });
    }

    async function retryWithoutTools(url, options, body) {
      if (!body || !body.tools) return null;
      const nextBody = Object.assign({}, body);
      delete nextBody.tools;
      delete nextBody.tool_choice;

      const resp = await nativeFetch(url, Object.assign({}, options, {
        body: JSON.stringify(nextBody)
      }));
      return resp.ok ? resp : null;
    }

    async function retryAsNonStream(url, options, body, provider) {
      const nextBody = Object.assign({}, body || {});
      delete nextBody.stream;
      delete nextBody.tools;
      delete nextBody.tool_choice;

      const nextUrl = provider === "gemini" ? buildGeminiNonStreamUrl(url) : url;
      const resp = await nativeFetch(nextUrl, Object.assign({}, options, {
        body: JSON.stringify(nextBody)
      }));

      if (!resp.ok) return null;
      const data = await resp.json();
      return makeSyntheticStreamResponse(provider, data);
    }

    window.fetch = async function yanjiCompatFetch(input, init) {
      if (!init || typeof input !== "string") {
        return nativeFetch(input, init);
      }

      const url = input;
      const method = (init.method || "GET").toUpperCase();
      if (method !== "POST") return nativeFetch(input, init);

      const body = parseJsonBody(init.body);
      if (!isLikelyLLMRequest(url, body)) return nativeFetch(input, init);

      const headers = new Headers(init.headers || {});
      const provider = inferProvider(url, headers);

      // Anthropic official browser direct access requires this header; most proxy sites ignore it.
      if (provider === "anthropic" && headers.has("x-api-key")) {
        headers.set("anthropic-dangerous-direct-browser-access", "true");
      }

      const options = Object.assign({}, init, { headers });

      let resp;
      try {
        resp = await nativeFetch(url, options);
      } catch (err) {
        // Some proxy sites fail browser streaming/CORS directly. Try non-stream fallback once.
        if (isStreamRequest(url, body)) {
          const fallback = await retryAsNonStream(url, options, body, provider).catch(() => null);
          if (fallback) return fallback;
        }
        throw err;
      }

      if (resp.ok || !RETRY_STATUS.has(resp.status)) return resp;

      // Some proxy sites do not support tools/function calling.
      const noToolsResp = await retryWithoutTools(url, options, body).catch(() => null);
      if (noToolsResp) return noToolsResp;

      // Some proxy sites do not support browser SSE streaming.
      if (isStreamRequest(url, body)) {
        const nonStreamResp = await retryAsNonStream(url, options, body, provider).catch(() => null);
        if (nonStreamResp) return nonStreamResp;
      }

      return resp;
    };
  }

  if (!("serviceWorker" in navigator)) return;

  const v = (window.LLM_HUB_VERSION || "v1").toString();
  const swUrl = "sw.js?v=" + encodeURIComponent(v);

  navigator.serviceWorker
    .register(swUrl)
    .then((reg) => {
      // iOS sometimes does not actively check updates; trigger an update manually.
      try {
        reg.update();
      } catch (e) {}

      // Refresh once the new Service Worker takes control.
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    })
    .catch((err) => {
      console.warn("Service Worker 注册失败：", err);
    });
})();
