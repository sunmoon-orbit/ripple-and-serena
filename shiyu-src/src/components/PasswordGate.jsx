import { useState } from 'react'
import { useStore, hashPassword } from '../store'
import Feather from './Feather'

// 密码门（2026-07-20 随新开场翻新）：
// 开屏飘落的那根羽毛就躺在这里；输入框改成墨线——聚焦时墨痕从中间向两侧洇开。
// 解锁成功后整扇门淡出再放行。
export default function PasswordGate({ onUnlock }) {
  const passwordHash = useStore((s) => s.passwordHash)
  const setPassword  = useStore((s) => s.setPassword)
  const isSetup = !passwordHash

  const [pw,  setPw]  = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [out, setOut] = useState(false) // 解锁淡出中

  function pass() {
    setOut(true)
    setTimeout(onUnlock, 420)
  }

  function submit() {
    if (out) return
    if (isSetup) {
      if (pw.length < 4) return setErr('密码至少 4 位')
      if (pw !== pw2)    return setErr('两次输入不一致')
      setPassword(pw); pass()
    } else {
      if (hashPassword(pw) === passwordHash) pass()
      else { setErr('密码不对'); setPw('') }
    }
  }

  return (
    <div className={'gate-minimal gate-ink' + (out ? ' gate-out' : '')}>
      {/* 开屏落下的那根羽毛，落地后微微歪着 */}
      <Feather className="gate-feather2" />

      {/* 标题 */}
      <div className="gate-brand">
        <h1 className="gate-title-cn">拾羽</h1>
        <p className="gate-brand-sub">Plume · picking up feathers</p>
      </div>

      {/* 输入区 */}
      <div className="gate-inputs">
        {err && <p className="gate-err-text gate-err-shake" key={err}>{err}</p>}
        <div className="ink-field">
          <input
            className="ink-input" type="password"
            value={pw} autoFocus
            placeholder={isSetup ? '设置访问密码' : '···'}
            onChange={(e) => { setPw(e.target.value); setErr('') }}
            onKeyDown={(e) => e.key === 'Enter' && (isSetup ? null : submit())}
          />
        </div>
        {isSetup && (
          <>
            <div className="ink-field">
              <input
                className="ink-input" type="password"
                value={pw2} placeholder="再次输入"
                onChange={(e) => { setPw2(e.target.value); setErr('') }}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            </div>
            <button className="gate-btn" onClick={submit}>设置并进入</button>
          </>
        )}
        {!isSetup && (
          <button className={'gate-enter' + (pw ? ' show' : '')} onClick={submit} tabIndex={pw ? 0 : -1}>
            进入
          </button>
        )}
      </div>
    </div>
  )
}
