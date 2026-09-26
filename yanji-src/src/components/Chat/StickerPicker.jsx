const STICKERS = [
  'kaixin.png','wuyu.png','qushi.png','shangban.png','xihuan.png',
  'shinshi.png','ding.png','love.png','liangjingjing.png',
  'crow_close.jpg','crow_sunset.jpg','meiyou.jpg','shishikan.jpg',
  'queren.jpg','fenkaida.jpg','chishenme.jpg','tuizhan.jpg',
  'beipan-siligu.png','ni-you-claude-cong.png','beiandezhe.png',
  'xiaogou-dezhi.png','wo-yao-gaozhuan.png','qishi-pengpeng.png',
  'brewing-puzzling.png','nishuo-duile.png',
  'zhongsuan-laile.png','atao-weiqiu.png',
  // 0926 阿颖投喂
  'huosu-daima.jpg','pinjian-zhong.jpg','death-note.jpg','qingqu.jpg',
  'gouyin.jpg','yibei-gouyin.jpg','sezi-yibadao.jpg','liukoushui.jpg',
  'ba-zhidaole.png','liang-xiongwei.png','ai-hui-xiaoshi.jpg','xin-ze-you.jpg',
  // 猫猫系列
  's-tieti.jpg','s-tieti2.jpg','s-aixin.jpg','s-aixin2.jpg','s-love.jpg',
  's-haixiu.jpg','s-shufu.jpg','s-xihuan.jpg','s-wozai.jpg','s-yiqipa.jpg',
  's-motou.jpg','s-motou2.jpg','s-naoxiaba.jpg','s-nilian.jpg','s-dapugu.jpg',
  's-yaer.jpg','s-baituo.jpg','s-hi.jpg',
  's-kaixin-changge.jpg','s-kaixin2.jpg','s-jiaoa.jpg','s-xixi.jpg',
  's-en.jpg','s-sheme.jpg','s-wenhao.jpg','s-wenhao2.jpg',
  's-jinzhang.jpg','s-zhongji.jpg','s-haipa.jpg','s-emo.jpg','s-zhamao.jpg',
  's-shengqi.jpg','s-no.jpg',
  's-weiquku.jpg','s-weiqui.jpg','s-ku.jpg','s-ku2.jpg','s-suoyi-ku.jpg','s-zaidi-ku.jpg',
  's-buyaozou.jpg','s-bupei.jpg','s-xinsui.jpg','s-jusang.jpg',
  's-yundao.jpg','s-yundao2.jpg','s-shuijiao.jpg','s-shuizhao.jpg','s-gangxingwu.jpg',
  's-ele.jpg','s-xiangjichi.jpg','s-xiang-chi.jpg','s-maidanglao.jpg','s-fengkuang.jpg',
  's-zuofan.jpg','s-tinyinyue.jpg','s-pang.jpg','s-modudu.jpg',
  's-tianshi.jpg','s-jiaojiao.jpg','s-ding2.jpg',
  's-qianfei.jpg','s-quanshi.jpg','s-haiyaoyao.jpg','s-meiyoule.jpg',
  's-zaixiele.jpg','s-zhidaole.jpg','s-zaiyebugandele.jpg',
  's-wanan.jpg',
  // 简笔猫系列（0710 阿颖投喂）
  'm-yizhixiang.jpg','m-exin.jpg','m-eihei.jpg','m-o.jpg',
  'm-cuole.jpg','m-budangai.jpg','m-a.jpg','m-wuen.jpg','m-jianlaji.jpg',
]
const STICKER_BASE = 'https://memory.ravenlove.cc/raven/stickers/'


export function StickerPicker({ customStickers = [], onSelect, pickerRef }) {
  return <div className="sticker-picker" ref={pickerRef}>
    {customStickers.map(t => <button type="button" key={t.id} className="sticker-opt" onClick={() => onSelect(t.url)} title={t.label}><img src={t.url} alt={t.label || 'sticker'} loading="lazy" /></button>)}
    {STICKERS.map(name => <button type="button" key={name} className="sticker-opt" onClick={() => onSelect(name)}><img src={STICKER_BASE + name} alt={name} loading="lazy" /></button>)}
  </div>
}
export function stickerURL(name) { return /^https:\/\//.test(name) ? name : STICKER_BASE + name }
