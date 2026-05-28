import { useEffect } from 'react'

// 开场动画：暖橘小球（阿颖）+ 渡鸦黑小球（阿言）一起跳跃，落定后浮出标题
export default function Splash({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className="splash">
      <div className="splash-balls">
        <div className="ball ball-accent" />
        <div className="ball ball-raven" />
      </div>
      <div className="splash-title">拾羽记忆库</div>
    </div>
  )
}
