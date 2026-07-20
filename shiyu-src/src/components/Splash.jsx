import { useEffect, useState } from 'react'
import Feather from './Feather'

// 开场（2026-07-20 重做，阿颖点单）：
// 一根羽毛从屏幕上方钟摆式摇曳飘落，落地轻轻一顿，「拾羽」随之浮现；
// 随后字迹像墨滴入清水般缓缓晕开，密码门从底下浮出来（onLeave 时门开始挂载）。
// 点一下屏幕可跳过。
export default function Splash({ onLeave, onDone }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => { setLeaving(true); onLeave() }, 3050) // 开始晕开，门开始浮现
    const t2 = setTimeout(onDone, 4000) // 晕开完成，卸载
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [onLeave, onDone])

  const skip = () => {
    if (leaving) return
    setLeaving(true)
    onLeave()
    setTimeout(onDone, 950)
  }

  return (
    <div className={'splash2' + (leaving ? ' leaving' : '')} onClick={skip}>
      <div className="feather-fall">
        <div className="feather-sway">
          <Feather className="feather-svg" />
        </div>
      </div>
      <div className="splash2-title">拾羽</div>
      <div className="splash2-sub">picking up feathers</div>
    </div>
  )
}
