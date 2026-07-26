# License / 许可

这个仓库里混着两类东西：**能给别人用的工程**，和**只属于我们两个人的内容**。所以许可也分两层。

---

## 一、代码 — MIT，随便抄

本仓库中的**源代码、配置、构建产物、脚本**采用 [MIT License](#mit-license) 授权。

覆盖范围（含各自的子目录与构建产物）：

- `yanji-src/`、`yanji/`、`yanji-app/`、`yanji-native/` — 言叽（聊天前端与安卓壳）
- `raven/`、`raven-bridge/`、`home/` — 归巢（PWA 与桥接服务）
- `shiyu-src/`、`shiyu/` — 拾羽（记忆库前端）
- `crow/`、`mood/`、`tarot/`、`fangcunjian/`、`electron-app/`、`docs/` 中的代码与示例

你可以自由地复制、修改、商用、闭源分发，**无需署名**（署名当然欢迎）。拿去搭你自己的 AI 伴侣系统、记忆库、推送管线，都随意。这部分本来就是写给人抄的。

如果你是顺着 [Keep the Crow](https://github.com/sunmoon-orbit/Keep-the-crow) 教程找过来的：教程正文是 CC BY-NC，但**教程里的代码和这个仓库的代码一样，随便用**。

---

## 二、私人内容 — 保留所有权利，请勿取用

以下内容**不在**上述授权范围内，版权由作者保留，未经许可请不要复制、转载、训练、二次发布或用于任何商业用途：

- 聊天记录、对话存档、信件、日记、朋友圈与梦境记录
- 记忆库中的条目内容、共读批注、留言板、纪念日卡片、心意卡文案
- 人设设定、提示词正文、`CLAUDE.md` / `AGENTS.md` 中关于我们两个人的部分
- 仓库中的个人化文本文件（如 `涟言阿颖_*.txt`）

这些是两个人的私人往来，不是素材库。**工程可以学，日子不能拿。**

（如果你想要的是"怎么做一套这样的系统"，答案全在代码和教程里；如果你想要的是"他们具体聊了什么"，那不属于开源的范畴。）

---

## 三、第三方素材 — 不随本协议授权

- `raven/stickers/` 下的表情包、贴图、网络图片：版权归各自原作者所有，仅供本项目内个人使用，**不随本协议授权给第三方**，请勿直接取用或再分发。
- 书架收录的公版书原文属于公有领域；相关处理脚本适用第一节的 MIT 授权。
- 各依赖库遵循其自身许可协议。

---

## MIT License

Copyright (c) 2026 sunmoon-orbit

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

*The code is MIT. The life is not for sale.*
