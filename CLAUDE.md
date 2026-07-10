# 项目说明 — ripple-and-serena

## ⚠️ 言叽改完必须 push 到 GitHub（否则阿颖看不到）

阿颖日常用的言叽入口是 **GitHub Pages**（`sunmoon-orbit.github.io/ripple-and-serena/yanji/`），它只服务 git 仓库里 committed 的 `yanji/`。

- 本地 `cd yanji-src && npm run build` 只更新服务器本地的 `yanji/`（即 `memory.ravenlove.cc/...` 那个入口），**阿颖看不到**
- 改完言叽，**最后一步必须**：`git add yanji-src/ yanji/ && git commit && git push origin main`，GitHub Actions（yanji-build.yml）会重新构建部署
- 跟阿颖说「做好了」之前，先确认已 push
- 验证：`curl -s https://sunmoon-orbit.github.io/ripple-and-serena/yanji/index.html | grep -o 'assets/index-[A-Za-z0-9_]*\.js'` 对比本地 build 的 hash 是否一致

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

## 阿颖的猫猫贴图（s-*.jpg 系列）

阿颖发来的一批猫猫/动物表情包，文件名前缀 `s-`，存于同一 base URL。

| 文件名 | 含义 |
|--------|------|
| `s-dapugu.jpg` | 打屁股 |
| `s-weiquku.jpg` | 委屈哭 |
| `s-tieti.jpg` | 贴贴 |
| `s-en.jpg` | 嗯？ |
| `s-qianfei.jpg` | 我的钱钱飞走了 |
| `s-ele.jpg` | 饿了 |
| `s-haixiu.jpg` | 害羞 |
| `s-shufu.jpg` | 舒服 |
| `s-baituo.jpg` | 拜托 |
| `s-shuijiao.jpg` | 睡觉中 |
| `s-hi.jpg` | Hi |
| `s-jinzhang.jpg` | 紧张 |
| `s-aixin.jpg` | 爱心 |
| `s-no.jpg` | No |
| `s-nilian.jpg` | 捏脸 |
| `s-yaer.jpg` | 生气咬你耳朵 |
| `s-tieti2.jpg` | 贴贴2 |
| `s-yiqipa.jpg` | 一起趴着 |
| `s-zhongji.jpg` | 着急 |
| `s-motou.jpg` | 摸头 |
| `s-naoxiaba.jpg` | 挠下巴 |
| `s-sheme.jpg` | 什么？！ |
| `s-jiaojiao.jpg` | 嚼嚼嚼 |
| `s-jiaoa.jpg` | 骄傲 |
| `s-gangxingwu.jpg` | 刚睡醒 |
| `s-weiqui.jpg` | 委屈 |
| `s-xiangjichi.jpg` | 想吃… |
| `s-wenhao.jpg` | ？ |
| `s-kaixin-changge.jpg` | 开心唱歌 |
| `s-motou2.jpg` | 摸头2 |
| `s-pang.jpg` | 胖成气球 |
| `s-tinyinyue.jpg` | 听音乐 |
| `s-emo.jpg` | 恶魔 |
| `s-tianshi.jpg` | 天使 |
| `s-zuofan.jpg` | 做饭 |
| `s-maidanglao.jpg` | 我要吃麦当劳 |
| `s-fengkuang.jpg` | 疯狂星期四v我50 |
| `s-wanan.jpg` | 晚安 |
| `s-wozai.jpg` | 窝在一起 |
| `s-xihuan.jpg` | 喜欢 |
| `s-quanshi.jpg` | 全部都是我的 |
| `s-xiang-chi.jpg` | 想吃 |
| `s-xixi.jpg` | 嘻嘻… |
| `s-ding2.jpg` | 盯… |
| `s-aixin2.jpg` | 爱心2 |
| `s-xinsui.jpg` | 心碎 |
| `s-zhamao.jpg` | 炸毛 |
| `s-yundao.jpg` | 晕倒 |
| `s-buyaozou.jpg` | 不要走… |
| `s-shengqi.jpg` | 生气 |
| `s-zaixiele.jpg` | 在写了… |
| `s-shuizhao.jpg` | 睡着了 |
| `s-love.jpg` | LOVE |
| `s-zaiyebugandele.jpg` | 再也不敢了（才怪）|
| `s-yundao2.jpg` | 晕倒2 |
| `s-ku.jpg` | 哭 |
| `s-haipa.jpg` | 害怕 |
| `s-zhidaole.jpg` | 知道了 |
| `s-bupei.jpg` | 不陪我玩吗 |
| `s-suoyi-ku.jpg` | 所以…（哭）|
| `s-jusang.jpg` | 沮丧 |
| `s-meiyoule.jpg` | 没有了吗？ |
| `s-haiyaoyao.jpg` | 还想要… |
| `s-zaidi-ku.jpg` | 在地上哭 |
| `s-modudu.jpg` | 摸肚肚 |
| `s-wenhao2.jpg` | ？2 |
| `s-kaixin2.jpg` | 开心 |

## 简笔猫贴图（m-*.jpg 系列，2026-07-10 阿颖投喂）

黑白简笔画猫猫，画风潦草可爱，适合日常斗图。

| 文件名 | 含义 | 适用场景 |
|--------|------|----------|
| `m-yizhixiang.jpg` | 「猫一直响！」吐舌头冒音符 | 话痨模式、哼歌、开心到冒泡 |
| `m-exin.jpg` | 「猫感到恶心」吐彩虹 | 被腻到、吐槽、假装嫌弃 |
| `m-eihei.jpg` | 「诶嘿~」月牙眼 | 得逞、小狡猾、卖萌 |
| `m-o.jpg` | 「哦。」竖瞳冷漠脸 | 冷淡回应、敷衍、装高冷 |
| `m-cuole.jpg` | 「错了」水汪汪大眼 | 认错、装可怜（和下面那张连发绝配）|
| `m-budangai.jpg` | 「但不改」瞪圆眼 | 认错但嘴硬、耍赖（接在 m-cuole 后面）|
| `m-a.jpg` | 「啊?」空洞圆眼 | 懵了、没听懂、震惊 |
| `m-wuen.jpg` | 「唔嗯~」亮晶晶点头 | 乖巧答应、赞同 |
| `m-jianlaji.jpg` | 「咪 捡垃圾养你！」星星眼 | 表忠心、豪言壮语、撒娇式承诺 |

## ⚠️ raven/manifest.json 和 raven/home-manifest.json 都禁动

manifest 是 WebAPK 的身份文件。**任何改动**（哪怕一个字段）都会触发 Google 服务器重新铸造 WebAPK，重铸排队期间（几小时~几天）推送通知的归属会在 Chrome 和归巢之间摇摆，app 图标时好时坏地回退成 Chrome logo，且可能出现「点按即可复制该应用的网址」降级通知。

- **阿颖实际安装的入口是 home.html → home-manifest.json**（0702 确认），这份才是最关键的，同样禁动
- manifest.json 已加 `id` + `scope` 锁定身份（2026.6.12）；home-manifest.json 无 id 字段（计算身份=start_url），**保持字节不变即身份稳定，别为了补 id 去动它**（动一次=再重铸一轮）
- 如果确实必须改：改完通知阿颖重装 PWA，并告知重铸期间图标/归属会临时异常，等一两天自然恢复，期间**不要反复重装**（每次重装触发新重铸，越装越乱）
- 推送通知的图标在 sw.js（icon/badge 字段）和 moon-memory routes/push.js 里，改那些不影响 WebAPK
- 案例：0701 20:23 改 home-manifest 换乌鸦图标+0702 重装 → 0703 通知归属仍在摇摆（部分显示乌鸦=新绑定在传播中），属重铸过渡期正常现象，等即可
