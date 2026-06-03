import { useState } from 'react'
import { api } from '../api'
import { useStore, hashPassword } from '../store'
import { showToast } from './Toast'
import { Plug, KeyRound, Palette } from 'lucide-react'

const THEMES = [
  { id: 'light',    label: 'Light',    dot: '#5A7A98' },
  { id: 'blossom',  label: 'Blossom',  dot: '#C07888' },
  { id: 'midnight', label: 'Midnight', dot: '#5888C8' },
  { id: 'dawn',     label: 'Dawn',     dot: '#C07840' },
]

export default function SettingsPanel() {
  const { baseUrl, apiToken, theme, setTheme, setConn, passwordHash, setPassword } = useStore()
  const [url, setUrl] = useState(baseUrl)
  const [token, setToken] = useState(apiToken)
  const [testing, setTesting] = useState(false)
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')

  function saveConn() {
    setConn({ baseUrl: url.trim(), apiToken: token.trim() })
    showToast('已保存连接', 'success')
  }

  async function test() {
    setConn({ baseUrl: url.trim(), apiToken: token.trim() })
    setTesting(true)
    try {
      await api.health()
      await api.list({ limit: 1 })
      showToast('连接成功 ✓', 'success')
    } catch (e) { showToast('连接失败：' + e.message, 'error') } finally { setTesting(false) }
  }

  function changePw() {
    if (hashPassword(oldPw) !== passwordHash) return showToast('旧密码不对', 'error')
    if (newPw.length < 4) return showToast('新密码至少 4 位', 'error')
    setPassword(newPw); setOldPw(''); setNewPw('')
    showToast('密码已更新', 'success')
  }

  return (
    <div className="panel">
      <div className="topbar"><h1>设置</h1></div>

      <div className="section-title"><Plug size={15} style={{ verticalAlign: -2, marginRight: 6 }} />记忆库连接</div>
      <div className="settings-card">
        <div className="field"><label>Base URL</label>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://memory.ravenlove.cc" />
        </div>
        <div className="field"><label>API Token</label>
          <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token…" />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={test} disabled={testing}>{testing ? '测试中…' : '测试连接'}</button>
          <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={saveConn}>保存</button>
        </div>
      </div>

      <div className="section-title"><KeyRound size={15} style={{ verticalAlign: -2, marginRight: 6 }} />修改访问密码</div>
      <div className="settings-card">
        <div className="field"><label>旧密码</label><input className="input" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} /></div>
        <div className="field"><label>新密码</label><input className="input" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} /></div>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={changePw}>更新密码</button>
      </div>

      <div className="section-title"><Palette size={15} style={{ verticalAlign: -2, marginRight: 6 }} />外观</div>
      <div className="settings-card">
        <div className="row"><span className="row-label">主题</span></div>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button key={t.id} className={'theme-chip' + (theme === t.id ? ' active' : '')} onClick={() => setTheme(t.id)}>
              <span className="theme-chip-dot" style={{ background: t.dot }} />
              <span className="theme-chip-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
