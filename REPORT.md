# 归巢：打断、中途补充、通话

## 改了什么

- `raven-bridge/server.js`
  - 复用 Claude Code pane 底部忙碌行规则，独立广播 `busy` 状态。
  - 新增 `POST /raven/interrupt`：校验归巢 Bearer token，并在请求当下仍检测到忙碌时才向目标 pane 发送 `Escape`。
  - 用户在忙碌时发送消息，tmux 前缀改为 `【阿颖·补充】`；回执携带 `supplemental`，重发去重时保留该标记。
  - 新增 `POST /raven/stt`：校验归巢 Bearer token，限制请求体 25MB，将 multipart 音频连同正确 boundary 转发给 moon-memory `/stt`。
- `raven/index.html`
  - 忙碌时显示「停」按钮；点击后调用打断接口。
  - 补充消息气泡显示小字「补充」，并将标记存进本地聊天历史。
  - 输入栏新增麦克风按钮与「双语」开关；开关使用 `raven-voice-bilingual` 持久化。
  - MediaRecorder 录音结束后上传 STT，并以 `【语音】` 或 `【语音·双语】` 前缀发送识别文字。
  - 每次成功发送语音后开启/续期五分钟自动朗读；朗读跳过 `> ` 引用行、Markdown 图片与贴图标签，最多 500 字。
  - TTS 改为共享 AudioContext；点击麦克风先停止当前朗读并在用户手势里恢复 AudioContext。

## 测过的

- `node --check raven-bridge/server.js` 通过。
- 两段内联脚本分别用 `node --check` 检查，通过。
- `git diff --check` 通过。
- `node --test raven-bridge/test/*.test.js raven-bridge/link-preview.test.js`：15/15 组通过。
- 重启 `raven-bridge` 后：pm2 状态 online，`GET /raven/health` 返回 200 且 `ok: true`。
- 在线页面返回 200，并确认包含 `#mic-btn`。
- 未认证调用 `/raven/interrupt` 与 `/raven/stt` 均返回 401。
- 扫描全部 tmux pane 确认空闲后，以有效 token 调用 `/raven/interrupt`，返回 `{"interrupted":false}`；没有向空闲 pane 发送 Escape。
- 以有效 token 向 `/raven/stt` 上传空 multipart 音频，上游 moon-memory 返回 400「没有收到音频」；证明归巢鉴权、multipart boundary 与桥接转发链路已贯通。
- Caddy 已用 `handle /raven/*` 整段反代到 3400，新接口无需修改 Caddyfile。
- `raven/manifest.json`、`raven/home-manifest.json` 均无改动；`CLAUDE.md` 的用户改动保持原样且不纳入提交。

## 没测的

- 没有 Android Chrome 真机麦克风，未做真实人声的「录音 → STT 文本 → 发送」端到端测试。
- 没有在真机上验证首次麦克风权限弹窗、PWA 后台切回、扬声器自动播放和点麦克风立即停播的体感。
- 为避免打断真实工作，没有在 Claude Code 正忙时实际发送 Escape；忙碌正则、服务端二次检查和空闲拒绝路径已验证。
- 没有真实触发一轮双语回复，因此 `> ` 中文翻译行的跳过只经过语法/代码审查，没有听觉实测。

## 最可能出问题的地方

- 不同 Android Chrome/WebView 版本生成的 MediaRecorder MIME 可能不同；当前沿用言叽已使用的默认 MediaRecorder 方案，并以 `audio.webm` 文件名上传，但仍应在阿颖手机上说一句短句确认 STT 接受实际编码。
- 自动朗读依赖麦克风点击这一用户手势解锁 AudioContext。代码已在点击时同步 `resume()`，但手机的省电/后台恢复策略可能再次挂起音频，需要实机观察。
- 输入栏新增两个控件后窄屏可用宽度变小；按 360px 宽度静态计算仍可保留约 110px 文本框，但未做浏览器截图级视觉回归。
