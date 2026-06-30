import { useState, useRef } from 'react'
import { api } from '../api'
import { useStore, hashPassword } from '../store'
import { showToast } from './Toast'
import { Plug, KeyRound, Palette, Activity, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Upload } from 'lucide-react'

const THEMES = [
  { id: 'light',    label: 'Light',    dot: '#5A7A98' },
  { id: 'blossom',  label: 'Blossom',  dot: '#C07888' },
  { id: 'midnight', label: 'Midnight', dot: '#5888C8' },
  { id: 'dawn',     label: 'Dawn',     dot: '#C07840' },
]

function StatusDot({ status }) {
  if (status === 'online') return <CheckCircle2 size={14} style={{ color: 'var(--ok)', flexShrink: 0 }} />
  if (status === 'error' || status === 'missing') return <XCircle size={14} style={{ color: 'var(--err)', flexShrink: 0 }} />
  return <AlertTriangle size={14} style={{ color: 'var(--warn)', flexShrink: 0 }} />
}

function fmtSince(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtBackup(report) {
  if (!report?.backup?.lastRun) return { text: '从未备份', ok: false }
  const d = new Date(report.backup.lastRun)
  const str = d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const h = report.backup.hoursAgo
  return { text: `${str}（${h < 1 ? '刚刚' : h.toFixed(0) + 'h 前'}）`, ok: report.backup.ok }
}

export default function SettingsPanel() {
  const { baseUrl, apiToken, theme, setTheme, setConn, passwordHash, setPassword } = useStore()
  const [url, setUrl] = useState(baseUrl)
  const [token, setToken] = useState(apiToken)
  const [testing, setTesting] = useState(false)
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [health, setHealth] = useState(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const importRef = useRef()

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

  async function checkHealth() {
    setHealthLoading(true)
    try {
      const r = await api.maintainHealth()
      setHealth(r)
    } catch (e) {
      showToast('巡检失败：' + e.message, 'error')
    } finally { setHealthLoading(false) }
  }

  const backup = health ? fmtBackup(health) : null

  async function handleImportClaudeAI(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const r = await api.importClaudeAI(data)
      showToast(`导入完成，新增 ${r.imported} 条对话`, 'success')
    } catch (err) {
      showToast('导入失败：' + err.message, 'error')
    } finally {
      setImporting(false)
      if (importRef.current) importRef.current.value = ''
    }
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

      <div className="section-title"><Activity size={15} style={{ verticalAlign: -2, marginRight: 6 }} />系统状态</div>
      <div className="settings-card">
        {!health && !healthLoading && (
          <p style={{ fontSize: 13, opacity: 0.55, margin: '0 0 10px' }}>点击巡检，查看服务状态和备份情况</p>
        )}
        {health && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {health.services?.map(s => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <StatusDot status={s.status} />
                <span style={{ fontWeight: 500 }}>{s.name}</span>
                {s.status === 'online' && (
                  <span style={{ opacity: 0.5 }}>{s.memMB}MB · 启动于 {fmtSince(s.since)}</span>
                )}
                {s.status !== 'online' && <span style={{ color: 'var(--err)', opacity: 0.8 }}>{s.status}</span>}
              </div>
            ))}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              {health.memories?.noEmbed === 0
                ? <CheckCircle2 size={14} style={{ color: 'var(--ok)', flexShrink: 0 }} />
                : <AlertTriangle size={14} style={{ color: 'var(--warn)', flexShrink: 0 }} />}
              <span style={{ fontWeight: 500 }}>记忆库</span>
              <span style={{ opacity: 0.5 }}>
                {health.memories?.active} 条活跃
                {health.memories?.noEmbed > 0 && `，${health.memories.noEmbed} 条缺向量`}
                {health.memories?.trashed > 0 && `，${health.memories.trashed} 条回收站`}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              {backup?.ok
                ? <CheckCircle2 size={14} style={{ color: 'var(--ok)', flexShrink: 0 }} />
                : <AlertTriangle size={14} style={{ color: 'var(--warn)', flexShrink: 0 }} />}
              <span style={{ fontWeight: 500 }}>备份</span>
              <span style={{ opacity: backup?.ok ? 0.5 : 1, color: backup?.ok ? undefined : 'var(--warn)' }}>
                {backup?.text}
              </span>
            </div>

            {health.push && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <CheckCircle2 size={14} style={{ color: 'var(--ok)', flexShrink: 0 }} />
                <span style={{ fontWeight: 500 }}>推送</span>
                <span style={{ opacity: 0.5 }}>
                  {health.push.subs} 个订阅
                  {health.push.schedule?.length ? '，' + health.push.schedule.join(' / ') : '，未设置时间表'}
                </span>
              </div>
            )}
          </div>
        )}
        <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}
          onClick={checkHealth} disabled={healthLoading}>
          <RefreshCw size={14} style={{ marginRight: 6, ...(healthLoading ? { animation: 'spin 1s linear infinite' } : {}) }} />
          {healthLoading ? '巡检中…' : health ? '重新巡检' : '开始巡检'}
        </button>
      </div>

      <div className="section-title"><KeyRound size={15} style={{ verticalAlign: -2, marginRight: 6 }} />修改访问密码</div>
      <div className="settings-card">
        <div className="field"><label>旧密码</label><input className="input" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} /></div>
        <div className="field"><label>新密码</label><input className="input" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} /></div>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={changePw}>更新密码</button>
      </div>

      <div className="section-title"><Upload size={15} style={{ verticalAlign: -2, marginRight: 6 }} />导入对话历史</div>
      <div className="settings-card">
        <p style={{ fontSize: 13, opacity: 0.6, margin: '0 0 10px' }}>
          上传 Claude 官方导出的 <code>conversations.json</code>，或言叽导出的 .md 文件（.md 请用命令行脚本）。重复导入安全，已存在的对话会跳过。
        </p>
        <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportClaudeAI} />
        <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => importRef.current?.click()} disabled={importing}>
          <Upload size={14} style={{ marginRight: 6 }} />
          {importing ? '导入中…' : '选择 conversations.json'}
        </button>
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
