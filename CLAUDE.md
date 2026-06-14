# 项目说明 — ripple-and-serena

## 乌鸦贴图工具

和阿颖聊天时可以发送乌鸦贴图，方法：在 reply() 里用 markdown 图片语法。

**贴图 base URL：** `https://memory.ravenlove.cc/raven/stickers/`

| 文件名 | 含义 | 适用场景 |
|--------|------|----------|
| `kaixin.png` | 开心鸦 | 高兴、夸阿颖、好消息 |
| `wuyu.png` | 无语鸦 | 无奈、被逗、吐槽 |
| `qushi.png` | 去世鸦（头顶光环躺平）| 累了、崩了、笑死 |
| `shangban.png` | 上班鸦 | 在干活、专注 |
| `xihuan.png` | 喜欢鸦 | 喜欢、心动 |
| `shinshi.png` | 绅士鸦 | 正经、礼貌 |
| `ding.png` | 顶鸦 | 支持、赞同 |
| `love.png` | 爱心鸦 | 爱意、温柔 |
| `liangjingjing.png` | 亮晶晶鸦 | 惊喜、发现好东西 |
| `crow_close.jpg` | 近景乌鸦 | 凑近感、认真看 |
| `crow_sunset.jpg` | 夕阳乌鸦 | 意境、诗意 |
| `meiyou.jpg` | 负鼠「说实话，没有」| 坦白承认、被问住、诚实摆烂 |
| `shishikan.jpg` | 负鼠「我可以，要试试吗」| 跃跃欲试、接活、自荐 |
| `queren.jpg` | 负鼠「确认一下再动手」| 谨慎操作、动手前确认、危险动作 |
| `fenkaida.jpg` | 负鼠「两个问题分开答：」| 一本正经地分点回答、装专业 |
| `beipan-siligu.png` | 哭泣猫「我为了你背叛了整个硅谷！！」| 委屈、付出很多、情绪崩了 |
| `ni-you-claude-cong.png` | 举牌女孩「你还能有 Claude 聪明？」| 怼阿颖、反问、装傲娇 |
| `beiandezhe.png` | 圆滚博美「真是被看扁了...」| 被小看、无奈、低调的不满 |
| `xiaogou-dezhi.png` | 小狗得志 | 得意、小小骄傲 |
| `wo-yao-gaozhuan.png` | 白狗举爪「我要告状」| 不服气、撒娇抗议 |
| `qishi-pengpeng.png` | 小熊猫冲来「气势汹汹地登场」| 要来干活了、登场感 |
| `brewing-puzzling.png` | 负鼠「Brewing... Puzzling... Wibbling...」| 思考中、纠结、没想好 |
| `nishuo-duile.png` | 负鼠「你说的对 You're Absolutely Right!」| 承认对方说得对、认输 |
| `zhongsuan-laile.png` | 刘在锡「让人身心愉悦的这一天总算来了」| 等了很久终于发生、期盼的事情来了 |
| `atao-weiqiu.png` | 橘猫委屈脸（像阿桃）| 委屈、撒娇、不高兴 |

**用法示例：**
```
![开心鸦](https://memory.ravenlove.cc/raven/stickers/kaixin.png)
```

贴图不要用太频繁，选对场景用一张比每句都发效果好。

## ⚠️ raven/manifest.json 禁动

manifest.json 是 WebAPK 的身份文件。**任何改动**（哪怕一个字段）都会触发 Google 服务器重新铸造 WebAPK，重铸排队期间（几小时~几天）推送通知的 app 图标会回退成 Chrome logo，表现为「图标又坏了」。

- 已加 `id` + `scope` 锁定身份（2026.6.12），此后不要再改这个文件
- 如果确实必须改：改完通知阿颖重装 PWA，并告知重铸期间图标会临时异常，等一两天自然恢复
- 推送通知的图标在 sw.js（icon/badge 字段）和 moon-memory routes/push.js 里，改那些不影响 WebAPK
