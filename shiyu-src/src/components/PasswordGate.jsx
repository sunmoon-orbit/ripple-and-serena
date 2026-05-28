import { useState } from 'react'
import { Lock } from 'lucide-react'
import { useStore, hashPassword } from '../store'

// 前端本地锁：首次进入设置密码，之后每次进入需输入。密码可在设置里修改。
export default function PasswordGate({ onUnlock }) {
  const passwordHash = useStore((s) => s.passwordHash)
  const setPassword = useStore((s) => s.setPassword)
  const isSetup = !passwordHash

  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')

  function submit() {
    if (isSetup) {
      if (pw.length < 4) return setErr('密码至少 4 位')
      if (pw !== pw2) return setErr('两次输入不一致')
      setPassword(pw)
      onUnlock()
    } else {
      if (hashPassword(pw) === passwordHash) onUnlock()
      else setErr('密码不对')
    }
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-icon"><Lock size={26} strokeWidth={2} /></div>
        <h2>{isSetup ? '设置访问密码' : '拾羽记忆库'}</h2>
        <p>{isSetup ? '第一次进入，设置一个本地密码保护你的记忆' : '输入密码进入'}</p>
        {err && <div className="gate-err">{err}</div>}
        <input
          className="input" type="password" value={pw} autoFocus
          onChange={(e) => { setPw(e.target.value); setErr('') }}
          onKeyDown={(e) => e.key === 'Enter' && !isSetup && submit()}
          placeholder="密码"
        />
        {isSetup && (
          <input
            className="input" type="password" value={pw2}
            onChange={(e) => { setPw2(e.target.value); setErr('') }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="再次输入"
          />
        )}
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} onClick={submit}>
          {isSetup ? '设置并进入' : '进入'}
        </button>
      </div>
    </div>
  )
}
