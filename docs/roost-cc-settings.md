# 归巢 CC 设置

入口：聊天页顶部滑杆图标。

- 模型：在项目 `.claude/settings.local.json` 中只更新 `model` 字段，保留 hooks、permissions 等其他配置。支持 sonnet / opus / haiku 及完整模型 ID；留空删除该覆盖。对下次从项目目录启动的 CC 生效，CLI 启动参数及组织策略可能覆盖。不会发送终端按键，不声称已切换当前会话。
- 说明：读取/编辑项目 `CLAUDE.md` 或当前服务账号 `~/.claude/CLAUDE.md`。阅读预览仅渲染文本与标题，不执行 Markdown 内的 HTML。新会话会加载说明；不保证当前会话立即重读。
- 保存：版本摘要比较，冲突返回 409，浏览器保留草稿；旧文件备份到服务账号 `~/.raven-cc-backups`，原子替换。拒绝符号链接和任意文件路径，正文上限 256 KiB。
- 接口：`GET/POST /raven/cc-settings`，所有请求包括 localhost 都要求现有归巢登录 token。不会暴露完整 settings JSON。

## 验证

`node --test raven-bridge/test/cc-settings.test.js`

覆盖首次创建、旧版备份、冲突拒绝、路径限制、符号链接、模型保存保留权限与 hooks、HTTP 登录和 JSON 校验。

## 部署

归巢由服务器 raven-bridge 服务静态文件，GitHub 推送本身不会部署。
需将本次提交中的 raven/index.html、raven/cc-settings.js、raven-bridge/server.js、raven-bridge/cc-settings.js 同步至服务器；先核对线上差异并保存原文件。
如 Caddy 未代理 `/raven/*`，把 `/raven/cc-settings` 加入归巢 3400 的现有匹配范围。不要误送到记忆库 3210。
仅重载 raven-bridge，刷新归巢。验收：登录后读说明、修改测试文本再还原、确认服务器旧版备份，验证已有聊天、状态与登录功能。
模型真实会话验收需要 CC 账号可用时从项目启动新会话并检查所用模型。

参考：https://code.claude.com/docs/en/model-config
