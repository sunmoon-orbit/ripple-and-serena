import { useEffect, useState } from 'react'
import Feather from './Feather'

// 开场（2026-07-20 二稿，阿颖点单：跟「涟言」的涟呼应）：
// 一根羽毛钟摆式摇曳飘落——落到水面的一瞬化为液体融进水里，
// 三圈涟漪荡开，「拾羽」随水波浮出来，随后整个画面轻轻退去，密码门浮现。
// 点一下屏幕可跳过。
export default function Splash({ onLeave, onDone }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => { setLeaving(true); onLeave() }, 4300) // 涟漪散尽，开始退场
    const t2 = setTimeout(onDone, 5200) // 退场完成，卸载
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [onLeave, onDone])

  const skip = () => {
    if (leaving) return
    setLeaving(true)
    onLeave()
    setTimeout(onDone, 900)
  }

  return (
    <div className={'splash2' + (leaving ? ' leaving' : '')} onClick={skip}>
      <div className="splash-stage2">
        <div className="feather-fall">
          <div className="feather-sway">
            <Feather className="feather-svg" />
          </div>
        </div>
        {/* 落水点荡开的三圈涟漪 */}
        <div className="ripple-set" aria-hidden="true"><i /><i /><i /></div>
      </div>
      <div className="splash2-title">拾羽</div>
      <div className="splash2-sub">picking up feathers</div>
    </div>
  )
}
