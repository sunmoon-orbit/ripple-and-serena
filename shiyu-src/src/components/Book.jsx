import Feather from './Feather'

// 一本小书（1110，她要的第二种开场：「书页快速翻动……书本合上然后进入密码界面……密码正确，书本打开进入记忆库」）
// state: flip＝摊开着哗啦啦翻几页再合上（开屏用）；closed＝合着（密码门上）；open＝封面掀开（解锁）
// 书脊在容器正中：封面和书页都贴在右半边、绕左边缘转；合上时整本往左挪半本，看起来居中。
export default function Book({ state = 'closed' }) {
  return (
    <div className={'book book-' + state} aria-hidden="true">
      <div className="book-inner">
        <div className="book-base" />
        {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="book-leaf" style={{ '--i': i }} />)}
        <div className="book-cover">
          <div className="book-face"><Feather className="book-emblem" /></div>
          <div className="book-face book-inside" />
        </div>
      </div>
    </div>
  )
}
