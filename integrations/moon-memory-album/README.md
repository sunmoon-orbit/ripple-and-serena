# 共同相册：待接入的 moon-memory 补丁

状态：后端文件尚未安装到 moon-memory，尚未部署。这里是隔离的待审补丁，避免覆盖后端工作目录已有改动。前端位于 `yanji-src/src/components/Chat/PhotoAlbum.jsx`，入口替换 Murmur 顶栏的视角翻转按钮，心意卡册不受影响。

## 接入

1. 将 `album-download.cjs`、`album-store.cjs`、`album-router.cjs`、`album-mcp.cjs` 放到后端 `services/`。
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
- MCP 工具：`browse_album`、`save_album_image`、`read_album_photo`。MCP 不授予浏览器或聊天软件额外附件访问能力；调用方必须有真实图片链接/字节。
- 备份需同时包含相册数据库与图片文件。现有只备份 memory.db 的机制不自动覆盖它；正式上线需检查实际备份脚本并补全。

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

后端分支和生产操作权限确认后，完成实际挂载、验证带/不带认证的请求、MCP 工具发现与图片块、备份覆盖，再发布前端并核对 Pages 资源 hash。未接入时不要将前端构建推送为已可用版本。
