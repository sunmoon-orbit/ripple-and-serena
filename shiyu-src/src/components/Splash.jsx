import { useEffect } from 'react'

// 开场动画：暖橘小球（阿颖）+ 渡鸦黑小球（阿言）弹跳，带地面投影与压扁回弹
export default function Splash({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className="splash">
      <div className="splash-stage">
        <div className="ball-col">
          <div className="ball ball-accent" />
          <div className="ball-shadow" />
        </div>
        <div className="ball-col">
          <div className="ball ball-raven" />
          <div className="ball-shadow delay" />
        </div>
      </div>
      <div className="splash-title">拾羽记忆库</div>
    </div>
  )
}
