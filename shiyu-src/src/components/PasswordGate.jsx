import { useState } from 'react'
import { useStore, hashPassword } from '../store'
import { loginZhaohua } from '../api'
import Feather from './Feather'
import { APP, IS_ZHAOHUA } from '../config'

// 密码门（2026-07-20 随新开场翻新）：
// 开屏飘落的那根羽毛就躺在这里；输入框改成墨线——聚焦时墨痕从中间向两侧洇开。
// 解锁成功后整扇门淡出再放行。
export default function PasswordGate({ onUnlock }) {
  const passwordHash = useStore((s) => s.passwordHash)
  const setPassword  = useStore((s) => s.setPassword)
  const setConn = useStore((s) => s.setConn)
  const isSetup = !passwordHash && !IS_ZHAOHUA

  const [pw,  setPw]  = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [out, setOut] = useState(false) // 解锁淡出中

  function pass() {
    setOut(true)
    setTimeout(onUnlock, 420)
  }

  async function submit() {
    if (out) return
    if (IS_ZHAOHUA) {
      try {
        const token = await loginZhaohua(pw)
        setConn({ apiToken: token })
        if (!passwordHash) setPassword(pw)
        pass()
      } catch (error) {
        setErr(error.message || '密码不对'); setPw('')
      }
      return
    }
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
      {IS_ZHAOHUA ? <span className="gate-feather2 zhaohua-light gate-light" /> : <Feather className="gate-feather2" />}

      {/* 标题 */}
      <div className="gate-brand">
        <h1 className="gate-title-cn">{APP.name}</h1>
        <p className="gate-brand-sub">{IS_ZHAOHUA ? 'Zhaohua · luminous memory' : 'Plume · picking up feathers'}</p>
      </div>

      {/* 输入区 */}
      <div className="gate-inputs">
        {err && <p className="gate-err-text gate-err-shake" key={err}>{err}</p>}
        <div className="ink-field">
          <input
            className="ink-input" type="password"
            value={pw} autoFocus
            placeholder={IS_ZHAOHUA ? '昭华访问密码' : isSetup ? '设置访问密码' : '···'}
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
