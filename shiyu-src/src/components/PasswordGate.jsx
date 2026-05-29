import { useState } from 'react'
import { useStore, hashPassword } from '../store'

export default function PasswordGate({ onUnlock }) {
  const passwordHash = useStore((s) => s.passwordHash)
  const setPassword  = useStore((s) => s.setPassword)
  const isSetup = !passwordHash

  const [pw,  setPw]  = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')

  function submit() {
    if (isSetup) {
      if (pw.length < 4) return setErr('密码至少 4 位')
      if (pw !== pw2)    return setErr('两次输入不一致')
      setPassword(pw); onUnlock()
    } else {
      if (hashPassword(pw) === passwordHash) onUnlock()
      else { setErr('密码不对'); setPw('') }
    }
  }

  return (
    <div className="gate-minimal">
      {/* 羽毛 */}
      <img
        src={`${import.meta.env.BASE_URL}icon-192.png`}
        alt="拾羽"
        className="gate-feather"
      />

      {/* 标题 */}
      <div className="gate-brand">
        <h1 className="gate-brand-title">拾 羽</h1>
        <p className="gate-brand-sub">picking up feathers</p>
      </div>

      {/* 输入区 */}
      <div className="gate-inputs">
        {err && <p className="gate-err-text">{err}</p>}
        <input
          className="gate-input" type="password"
          value={pw} autoFocus
          placeholder={isSetup ? '设置访问密码' : '···'}
          onChange={(e) => { setPw(e.target.value); setErr('') }}
          onKeyDown={(e) => e.key === 'Enter' && (isSetup ? null : submit())}
        />
        {isSetup && (
          <>
            <input
              className="gate-input" type="password"
              value={pw2} placeholder="再次输入"
              onChange={(e) => { setPw2(e.target.value); setErr('') }}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <button className="gate-btn" onClick={submit}>设置并进入</button>
          </>
        )}
      </div>
    </div>
  )
}
