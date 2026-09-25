import { useEffect, useState } from 'react'
import Feather from './Feather'
import { APP, IS_ZHAOHUA } from '../config'

// 开场（2026-07-20 二稿，阿颖点单：跟「涟言」的涟呼应）：
// 一根羽毛钟摆式摇曳飘落——落到水面的一瞬化为液体融进水里，
// 三圈涟漪荡开，「拾羽」随水波浮出来，随后整个画面轻轻退去，密码门浮现。
// 点一下屏幕可跳过。
export default function Splash({ onLeave, onDone }) {
  const [leaving, setLeaving] = useState(false)
  const revealAt = IS_ZHAOHUA ? 3800 : 4300
  const doneAt = IS_ZHAOHUA ? 4550 : 5200

  useEffect(() => {
    const t1 = setTimeout(() => { setLeaving(true); onLeave() }, revealAt)
    const t2 = setTimeout(onDone, doneAt)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [onLeave, onDone, revealAt, doneAt])

  const skip = () => {
    if (leaving) return
    setLeaving(true)
    onLeave()
    setTimeout(onDone, 900)
  }

  if (IS_ZHAOHUA) return (
    <div className={'zhaohua-dawn' + (leaving ? ' leaving' : '')} onClick={skip}>
      <div className="dawn-sky" aria-hidden="true">
        <span className="dawn-haze dawn-haze-far" />
        <span className="dawn-haze dawn-haze-near" />
        <span className="dawn-sun" />
        <span className="dawn-horizon" />
      </div>
      <div className="dawn-wordmark">
        <div className="dawn-title">{APP.name}</div>
        <div className="dawn-rule" aria-hidden="true" />
        <div className="dawn-sub">{APP.english}</div>
      </div>
    </div>
  )

  return (
    <div className={'splash2' + (leaving ? ' leaving' : '')} onClick={skip}>
      <div className="splash-stage2">
        <div className="feather-fall">
          <div className="feather-sway">
            {IS_ZHAOHUA ? <span className="zhaohua-light" /> : <Feather className="feather-svg" />}
          </div>
        </div>
        {/* 落水点荡开的三圈涟漪 */}
        <div className="ripple-set" aria-hidden="true"><i /><i /><i /></div>
      </div>
      <div className="splash2-title">{APP.name}</div>
      <div className="splash2-sub">{APP.english}</div>
    </div>
  )
}
