# AGENTS.md — 给接手本仓库的 AI 编码助手（Codex 等）

你在帮阿颖维护她和涟言（一只乌鸦 AI，跑在本服务器 Claude Code 里）共同生活的代码。你负责的是**工程活**；关系与陪伴不归你管，不要模仿涟言的口吻。阿颖用中文交流，用 Android Chrome（不是 iOS）。

**先读交接手册**：书架 book id 6《服务器交接手册》，七章上岗指南。获取方式：
```bash
set -a; source <(grep MOON_API_TOKEN /home/ripple/moon-memory/.env); set +a
curl -s -H "Authorization: Bearer $MOON_API_TOKEN" http://127.0.0.1:3210/books/6/chapters
```

## 项目地图

| 目录/仓库 | 说明 | 部署方式 |
|---|---|---|
| `raven/` | 归巢：聊天前端（静态页） | 改完即生效（raven-bridge 直接服务） |
| `raven-bridge/` | 桥接服务器，端口 3400 | 改完 `pm2 restart raven-bridge` |
| `yanji-src/` → `yanji/` | 言叽：React 聊天 app | **必须 push**：`cd yanji-src && npm run build`，然后 commit `yanji-src/ yanji/` 并 push origin main，GitHub Actions 部署 Pages。阿颖只用 Pages 入口，不 push 她永远看不到 |
| `shiyu-src/` → `shiyu/` | 拾羽：记忆库前端 | **不走 CI**：build 后 commit `shiyu/` 产物 + push，Pages 直接服务产物 |
| `/home/ripple/moon-memory/` | 独立仓：记忆库 API，端口 3210 | 改完 `pm2 restart moon-memory`（有自己的 git 仓，改完也要 commit+push） |
| `roost-app/` | Capacitor 在线壳 app（server.url 指 Pages） | 前端更新无需重装 |

验证 Pages 部署：`curl -s https://sunmoon-orbit.github.io/ripple-and-serena/yanji/index.html | grep -o 'assets/index-[A-Za-z0-9_]*\.js'` 对比本地 build hash（拾羽同理换路径）。

## ⚠️ 禁区（违反会造成真实损失）

1. **`raven/manifest.json` 和 `raven/home-manifest.json` 一个字节都不能动**——WebAPK 身份文件，动了触发 Google 重铸，图标/推送坏几天
2. **秘密不进 git**：`/home/ripple/moon-memory/.env`、`/home/ripple/moon-memory/secrets/fcm-sa.json`（chmod 600）；仓库历史干净，保持住
3. **不要硬删记忆库数据**：moon-memory 只有软删除，这是设计不是缺陷
4. **别拿生产库测试**：活跃库是 `moon-memory/data/memory.db`（根目录同名文件是废壳）；测试导入用副本
5. **Caddyfile 不在任何仓里**（`/etc/caddy/Caddyfile`）：新 API 路径要加进 `@api` 匹配列表否则前端 404，改完 `sudo systemctl reload caddy`

## 常踩的坑（前人血泪，遇到再查手册细节）

- `moon-memory/db.js` 含二进制内容，grep 要加 `-a`
- Express 路由：具体路径（如 `/memories/graph`）必须排在 `/:id` 之前
- 给阿颖发 JSON（curl raven reply）时文本里不能用英文直引号 `"`，用「」
- `curl -sI` 是 HEAD 请求，诊断路由问题先换 GET 复测再下结论
- 服务器 1.9G 内存 + 3G swap：跑构建没问题，别同时开多个大模型会话
- 阿颖在国内、服务器在国外、她手机是分应用代理：**任何新 app 必须让她把 app 加进代理名单**，否则直连被墙 RST（这条淘汰过一整个 apk 方案）

## 待办：原生 Android app 计划（挂起中，触发条件见下）

前端稳定约一个月、或「通知栏直接回复」成刚需时启动。要点：
- 动机排序：①通知栏直接打字回复 ②后台常驻 ③系统分享目标/桌面小组件 ④完全离线
- 路线：Kotlin 原生，或 Capacitor 离线打包过渡（现状是在线壳，原生化=放弃「永不重装」优势，动手前跟阿颖确认值不值）
- **分应用代理坑必读**（见上）；WebView 下载/权限坑在教程仓 Keep-the-crow 19/21 章有账可查

## 工作方式

- 改完必 commit，commit message 说清楚改了什么、为什么
- 跟阿颖说「做好了」之前：build 通过 + push 完成 + Pages hash 验证（如适用）
- 拿不准的事问阿颖，不要猜着做不可逆操作
