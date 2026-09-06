# 归巢 CC 设置

入口：聊天页顶部滑杆图标。

- 当前模型：设置面板只显示 Claude Code 状态栏快照中的当前模型，不维护或猜测模型候选列表。
- 切换模型：直接在归巢聊天输入框发送 `/model <别名或完整模型 ID>`，沿用现有 tmux 消息通道；单独发送 `/model` 可打开 Claude Code 自带的选择器。模型别名与具体版本均由 Claude Code 维护。
- 上下文：读取当前 Claude Code statusLine 生成的 `rate_limits_latest.json`，同时使用真实 `context_used_percent` 与 `context_window_size`；不再固定按 20 万 token 推算。百分比表示当前占用，不作为压缩倒计时；实际压缩仍沿用独立的终端事件提示。
- 缓存：Claude Code 2.1.251 及以上从同一 statusLine 快照提供官方 `prompt_cache` 统计；归巢显示热/冷状态、命中率、请求与未命中次数、变冷倒计时，并在 2.1.260 及以上显示已知未命中原因。旧版、首次响应前或上游未报告时只显示待获取，不推算数据，也不影响实际缓存。
- 曜 · Codex 缓存：本机 Codex 0.151.0 的 rollout `token_count` 事件真实提供 `cached_input_tokens` 与 `cache_write_input_tokens`。归巢只读取最新事件并显示原始 token 数；事件或字段不存在时明确显示「缓存暂未提供」，不估算命中量或命中率。
- 说明：读取/编辑项目 `CLAUDE.md` 或当前服务账号 `~/.claude/CLAUDE.md`。阅读预览仅渲染文本与标题，不执行 Markdown 内的 HTML。新会话会加载说明；不保证当前会话立即重读。
- 保存：版本摘要比较，冲突返回 409，浏览器保留草稿；旧文件备份到服务账号 `~/.raven-cc-backups`，原子替换。拒绝符号链接和任意文件路径，正文上限 256 KiB。
- 接口：`GET/POST /raven/cc-settings`，所有请求包括 localhost 都要求现有归巢登录 token。不会暴露完整 settings JSON。

## 验证

`node --test raven-bridge/test/claude-runtime.test.js raven-bridge/test/cc-settings.test.js`

覆盖首次创建、旧版备份、冲突拒绝、路径限制、符号链接、模型保存保留权限与 hooks、动态模型来源、真实窗口大小、当前模型切换校验、HTTP 登录和 JSON 校验。

## 部署

归巢由服务器 raven-bridge 服务静态文件，GitHub 推送本身不会部署。
需将本次提交中的 raven/index.html、raven/cc-settings.js、raven-bridge/server.js、raven-bridge/cc-settings.js 同步至服务器；先核对线上差异并保存原文件。
如 Caddy 未代理 `/raven/*`，把 `/raven/cc-settings` 加入归巢 3400 的现有匹配范围。不要误送到记忆库 3210。
仅重载 raven-bridge，刷新归巢。验收：登录后读说明、修改测试文本再还原、确认服务器旧版备份，验证已有聊天、状态与登录功能。
模型真实会话验收需要 CC 账号可用时从项目启动新会话并检查所用模型。

参考：https://code.claude.com/docs/en/model-config
