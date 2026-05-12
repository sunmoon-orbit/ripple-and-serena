# Yanji context cache stage 1 plan

Issue: #9

## Goal

Stage 1 is a safe planning and structure pass for Yanji's model API context. It should reduce long-chat token pressure and make provider-side prompt caching easier to hit later, without depending on relay providers to support official cache fields.

## Current structure

Known files:

- `yanji/state.js`
  - Stores `messagesByChatId`, `summariesByChatId`, `contextLimit`, `moonMemory`, and related local state.
- `yanji/data.js`
  - Syncs `messagesByChatId`, `summariesByChatId`, and `contextLimit` through cloud sync.
- `yanji/chat.js`
  - Contains `pendingMoonMemoryContext`.
  - Sends model requests through `applyContextLimit(...)`, `buildFullInstruction()`, and `callLLM(...)`.
- `yanji/moon-memory-bridge.js`
  - Handles Moon Memory token/settings and temporary retrieval context.

## Stage 1 non-goals

- Do not rewrite Yanji.
- Do not change `.env`, API keys, tokens, deployment config, or Moon Memory server code.
- Do not persist full chat logs as a new cache.
- Do not assume relay/middleman APIs support official provider cache controls.
- Do not add provider-specific cache fields until the context layers are stable.

## Proposed context layers

### stablePrefix

Fixed context that should remain byte-stable as much as possible:

- Core persona and role rules.
- Relationship and speaking style rules.
- Tool and Moon Memory usage rules.
- Safety and formatting rules.

### summaryContext

Compact summary for older conversation turns:

- Stored in `summariesByChatId[chatId]`.
- Inserted before recent raw messages when present.
- Should not replace recent exact wording.

### recentContext

Recent raw messages:

- Keeps emotional continuity and exact wording.
- Limited by current `contextLimit` settings.

### dynamicContext

Per-turn changing context:

- Current user message.
- Moon Memory retrieval results.
- Web search results.
- Location context.
- Current time.
- Images.

This should stay near the end of the request.

## Implementation sketch

A future code change can introduce a helper such as:

```js
function buildRequestContext(chatId, historyMsgs) {
  const summary = state.summariesByChatId && state.summariesByChatId[chatId];
  const limited = applyContextLimit(historyMsgs);
  const messages = [];

  if (summary && summary.trim()) {
    messages.push({
      role: "system",
      content: "以下是较早对话的摘要，用于保持长期上下文：\n" + summary.trim(),
    });
  }

  messages.push(...limited);
  return messages;
}
```

Then the send/regenerate/edit paths can call this helper before `callLLM(...)`.

## Testing checklist

- Normal chat still sends and receives replies.
- Regenerate still works.
- Edit message and regenerate still works.
- Image messages still work.
- Moon Memory manual context still enters the next request.
- Web search/location context still enters the request.
- `contextLimit` still behaves safely.
- No API keys or tokens appear in commits.

## Later stages

After stage 1 is stable:

- Add automatic summary generation/update after long chats.
- Add UI visibility for summary state.
- Add OpenAI `prompt_cache_key` only for known supported OpenAI-compatible connections.
- Add Anthropic `cache_control` only for native Anthropic requests.
