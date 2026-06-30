# 言叽：语音、情绪与思考总结（2026.6.30）

记录言叽这一批功能的设计与实现，方便日后维护和接续。涉及前端 `yanji-src/` 与后端 `moon-memory/`。

## 1. 语音转文字（STT）

### 背景
安卓 Chrome 的 Web Speech API（`webkitSpeechRecognition`）在目标设备上不可用：`continuous=true` 只采音、永不返回结果；`continuous=false` 也频繁 `aborted`。结论是**彻底弃用浏览器内置语音识别**，改走「录音上传 → 服务端转写」。

### 链路
- 前端用 `MediaRecorder` 录音，停止后拿到音频 `Blob`。
- `api/moonMemory.js` 的 `transcribeAudio(config, blob)` 把音频以 `multipart/form-data` POST 到 `/stt`（**不要手动设 `Content-Type`**，让浏览器带 boundary）。
- 后端 `moon-memory/routes/stt.js`：`multer` 收音频 → 转发 SiliconFlow `/v1/audio/transcriptions`（模型 `FunAudioLLM/SenseVoiceSmall`，中文友好）→ 返回 `{ text }`。Node 20 原生 `fetch`/`FormData`/`Blob`，无需 `form-data` 包。
- `server.js` 以 `requireBearer` 挂载 `/stt`；**Caddy `@api` 路径列表需包含 `/stt`**，否则前端经 `memory.ravenlove.cc` 访问不到。

### 两个入口
- 聊天输入框麦克风（`ChatInput.jsx`）：点一下录音、再点停止 → 转写填入输入框。
- 语音通话（`VoiceCall.jsx`）：push-to-talk 大按钮，点一下说话、再点发送；AI 回复用 TTS 自动朗读。

### 环境
- `SILICONFLOW_API_KEY`（STT）、`MINIMAX_API_KEY`（TTS，`routes/tts.js`）已在 `.env`。

## 2. 语音条 UI

- 用户语音消息在 message 上带 `voice: true` 和 `voiceDuration`（秒）字段，经 store `...msg` 自动持久化。
- `MessageBubble.jsx` 对 `msg.voice` 渲染「语音条」：复用助手 `.voice-bar`/`.vb-wave`/`.vb-bar` 同款波形，加 `.user-vb` 修饰类在橙色气泡上换白配色（与文字气泡配色统一：用户橙、助手浅）。
- 三角播放键仅为外观统一，**不播放**（不存音频）；整条点击在「语音条 / 转写文字」两视图间切换（`voiceTextMode` 状态）。
- `handleSend(text, images, opts)` 第三参数 `opts.voice / opts.voiceDuration` 透传到 message。

## 3. 情绪系统（`utils/emotion.js`）

### 模型
12 个情绪槽（6 正向 6 负向），值域 0–100，存 `localStorage('yanji-emotion-state')`。读取时按 `DECAY_PER_24H` 做时间衰减（`applyDecayAndGet`）。

### AI 自评回路
- `buildEmotionPrompt(state)` 把当前情绪 + 行为规则注入 `dynamicContext`，要求 AI 每次回复结尾追加 `<es>{...}</es>`（短字段名增量 JSON）。
- 显示前用 `stripEmotionTag` 流式剥离、`extractEmotionUpdate` 回合末提取，`applyEmotionDelta` 落库。`<es>` 对用户不可见。

### 两个曾导致「情绪永远 0」的坑（已修，重要）
1. **JSON 前导 `+`**：提示里示例是 `{"j":+8}`，AI 照写带 `+`，但 JSON 不允许数字前导 `+`，`JSON.parse` 每条都失败。`extractEmotionUpdate` 解析前先 `replace(/([:,]\s*)\+/g, '$1')` 清理。
2. **dynamicContext 没注入到非 Claude 模型**（真凶）：`buildOpenAIMessages` / `buildGeminiContents` 当初没接 `dynamicContext` 参数，只有 `buildAnthropicMessages` 注入。结果切到 OpenAI 兼容 / Gemini 模型后，**情绪提示词、当前时间、核心记忆全部丢失**。现三个 build 函数统一接 `dynamicContext`，注入到最后一条用户消息前（工具循环里用 `iter===0 ? dynamicContext : undefined` 只首轮注入）。

> 维护提醒：任何「每轮动态注入」的新内容，三个 provider 的消息构建函数都要改，别只改一个。

## 4. 时间感知联动（思念 × 时间）

`utils/emotion.js` 的 `applyTimeAway()`：state 记 `lastSeen`，每条新用户消息时计算距上次互动的小时数。
- `< 1h`：算还在一起，思念不涨，只刷新 `lastSeen`。
- `>= 1h`：思念 `+3`，之后每多 1 小时再 `+2`，封顶 `+45`。

`handleSend` 用 `applyTimeAway()` 取代 `applyDecayAndGet()`；离开 `>= 2h` 时再往 `dynParts` 推一条「时间感知」提示，告诉涟言过了多久、思念涨了多少，便于自然表达想念。

## 5. 思考链标题总结

- `MessageBubble.jsx` 的思考块**不用原生 `<details>`**（受控 `open` 在移动端会与原生 toggle 状态错位、收不起来），改纯按钮 + 条件渲染；`thinkOpen` 跟随 `isStreaming`（流式展开、结束收起）。
- 展示与总结都剥掉模型塞进来的标签：`replace(/<\/?[a-zA-Z_][\w:-]*>/g, '')`（涵盖 `<think>`、`<next_thinking>` 等；否则总结模型会去「评论」标签结构而非总结）。
- `api/llm.js` 的 `summarizeThinking()` 单独发一次请求生成一句中文标题；`maxTokens` 给足（1000），避免推理模型把额度耗在思考上导致正文（标题）为空。

## 部署提醒

- 言叽走 GitHub Actions（`yanji-build.yml`，仅在 `yanji-src/**` 改动时触发），阿颖用的是 GitHub Pages 入口，**改完必须 commit + push**。
- 拾羽（`shiyu-src/`）**不走 CI**，靠提交构建产物 `shiyu/` 目录 + GitHub Pages 直接服务；改完要本地 `npm run build` 再连 `shiyu/` 一起提交。
- `moon-memory` 是独立仓库（分支 `master`）；改 `routes/` 后 `pm2 restart moon-memory`，动 Caddy 后 `systemctl reload caddy`。
