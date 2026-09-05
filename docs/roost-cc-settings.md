# 归巢 CC 设置

入口：聊天页顶部滑杆图标。

- 模型列表：从 Claude Code 状态栏快照、`~/.claude.json` 的模型选项缓存和近期使用记录动态读取，不在前端写死。接口只返回模型标识与展示名，不返回会话内容、凭证或完整配置。
- 默认模型：在项目 `.claude/settings.local.json` 中只更新 `model` 字段，保留 hooks、permissions 等其他配置；留空删除覆盖。对下次从项目目录启动的 CC 生效，CLI 启动参数及组织策略可能覆盖。
- 当前模型：显式点击后，向当前可接收消息的 tmux Claude Code pane 发送经过严格字符校验的 `/model <模型>`。接口只表示指令已排队，最终结果以 Claude Code 终端反馈及随后状态栏快照为准；没有可用 pane 时返回 409，不会另起会话。
- 上下文：读取当前 Claude Code statusLine 生成的 `rate_limits_latest.json`，同时使用真实 `context_used_percent` 与 `context_window_size`；不再固定按 20 万 token 推算。百分比表示当前占用，不作为压缩倒计时；实际压缩仍沿用独立的终端事件提示。
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
