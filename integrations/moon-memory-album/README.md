# 共同相册：接入与维护记录

2026-09-23：用户明确授权在现有后端分支追加功能、提交推送和部署。首版后端提交 `45e8aa9` 已推送至 `fix/yanji-agent-auth-proactive-gates`，相册增量已应用到生产服务；两个工作目录原有未提交改动均保留。这里保留补丁作为接入参考，正式维护以 moon-memory `services/album-*.cjs` 和 `test/album.test.cjs` 为准。前端位于 `yanji-src/src/components/Chat/PhotoAlbum.jsx`，入口替换 Murmur 顶栏的视角翻转按钮，心意卡册不受影响。

## 接入

1. 将 `album-download.cjs`、`album-store.cjs`、`album-router.cjs`、`album-mcp.cjs`、`album-conversation-card.cjs` 放到后端 `services/`。将 `fonts/album-card/` 中两款 OFL 字体安装到服务用户的字体目录并运行 `fc-cache`，否则少见颜文字会缺字。
2. 在 `routes/moments.js` 的 `const router = express.Router();` 后、任何 `/:id` 路由前挂载：

   ```js
   router.use('/album', require('../services/album-router.cjs').createAlbumRouter());
   ```

3. 将 `sharp` 从 `devDependencies` 移入运行依赖，保留已有版本并同步锁文件；生产环境需要能加载此模块。
4. 在 `mcp.js` 引入 `const albumMcp = require('./services/album-mcp.cjs');`，向 `TOOLS` 加入 `...albumMcp.tools`。
5. 在 `callTool` 的只读权限检查之后接入：

   ```js
   if (albumMcp.tools.some(tool => tool.name === name)) return albumMcp.call(name, args);
   ```

6. 在 `tools/call` 响应的 `content` 字段，仅对 `read_album_photo` 直接传回 `toolResult.content`；其他工具保持现有文本 JSON 包装。这样 MCP 能返回真正的图片块，而不是 base64 文本。
7. 保持 `WORK_TOOLS` 只读工作白名单不变。相册涉及私人照片，不能借此放开现有技术工作凭证。跨端使用需要连接已获授权的完整 MCP 端点。客户端看不到当前附件字节/可访问链接时，不能声称已收藏；可由用户在言叽上传。

REST 路径全部位于现有 `/moments/album` 下，沿用 `/moments` Bearer 认证和已有反代前缀。大图和缩略图也必须带认证，不能额外挂成公开静态目录。上线前需确认实际反代确实转发此子路径。

## 存储和行为

- 新增独立 `data/album/album.sqlite` 和随机名图片文件，不改记忆主库。首次真实使用才创建目录与数据库。
- 原图统一解码、旋转、去元信息、缩放后保存；缩略图服务端生成。GIF 收藏为静态首帧。前端先压缩手机照片，缩略页只加载缩略图，点开详情才请求大图。
- 网上收藏接收真实 HTTPS 图片直链；限制端口、解析后的公网 IP、DNS 固定、跳转次数、时间及字节量。需要登录/防盗链/网页而非图片的地址可能失败，失败不产生成功记录。
- 同样的图片、标题、说明、作者和来源重复请求不会重复入册。删除是软隐藏，保留文件。默认总存储上限 200 MiB，含隐藏照片；满额返回错误，不清理用户照片。
- API 模型工具：`browse_album`、`album_chat_sources`、`save_album_image`、`save_album_conversation`。聊天附件通过消息 ID 在本地读取，不让模型抄写 base64。对话卡仅使用选中消息正文，不是屏幕截图，不包含隐藏思考或工具输出。
- MCP 工具：`browse_album`、`save_album_image`、`read_album_photo`、`read_album_avatar`、`search_album_images`、`save_album_conversation_card`。最后一项是明确的写操作：官方 ChatGPT、Codex 或 CC 只提交用户要求收藏的 1–8 条可见 `user/assistant` 正文，由服务器用同步头像生成模型视角 PNG；不得提交系统/开发者提示、隐藏思考或未经筛选的整窗历史。
- 言叽的双方自定义头像会覆盖同步为固定的 `card-avatar-{role}.webp`，不保留头像历史；外部入口通过鉴权 REST 或 `read_album_avatar` 读取。每日相册备份包含当前头像。
- 删除采用 30 天软删除：只有前端用户能移入回收站和恢复，模型没有删除工具；过期记录在相册访问和每日备份前彻底清理，释放原图与缩略图空间。
- 已通过 `services/album-backup.cjs` 接入原有备份流程：先清理已过 30 天的回收站，再对相册 SQLite 做一致性快照，将数据库、大图和缩略图打包成 `album.tar.gz.part-*`，与原备份一起发布。恢复时合并分块并解压到后端 `data/`。
- `album-search.cjs` 使用 Wikimedia Commons 固定 API 搜索图片和授权元数据。模型只拿真实的缩略图直链、作者、许可与来源页，再调用收藏；乌有乡和命运牌阵只在一次旅行中建议最多带回一张，也允许空手回来。

## 离线验证

后端测试使用内存 SQLite、临时目录和合成图片，不读取生产数据：

```sh
NODE_PATH=/home/ripple/codex-work/moon-memory/node_modules node --test integrations/moon-memory-album/album.test.cjs
```

前端浏览器测试使用模拟接口：

```sh
cd yanji-src
node test/browser/photo-album.test.mjs
npm test
npm run build
```

验证记录：前端 36 项测试、360px 宽度浏览器的翻页/大图/聊天附件/头像覆盖同步/模型收藏流程及生产构建通过。后端 8 项隔离测试覆盖媒体、配额、地址限制、头像覆盖、服务端对话卡、备份与 REST 鉴权，并通过 MCP 回归测试。测试只使用临时目录与合成图片。
