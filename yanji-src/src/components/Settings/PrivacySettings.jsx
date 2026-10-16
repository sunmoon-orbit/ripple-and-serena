import React, { useEffect, useState } from 'react'
import { getPrivacyRules, refreshPrivacyRules, savePrivacyRules, redactText } from '../../utils/privacyShield'

// 一行一条：「真名 => 代称」。代称留空就是直接抹掉。
const toText = rules => rules.map(r => `${r.from} => ${r.to}`).join('\n')
const parse = text => text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
  const i = l.indexOf('=>')
  return i < 0 ? { from: l, to: '' } : { from: l.slice(0, i).trim(), to: l.slice(i + 2).trim() }
}).filter(r => r.from)

export default function PrivacySettings() {
  const [text, setText] = useState(() => toText(getPrivacyRules()))
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [probe, setProbe] = useState('')

  useEffect(() => { refreshPrivacyRules().then(r => setText(toText(r))).catch(e => setMsg(`没拉到服务器上的表：${e.message}（先用本机缓存那份）`)) }, [])

  async function save() {
    setBusy(true); setMsg('')
    try { const r = await savePrivacyRules(parse(text)); setText(toText(r)); setMsg(`存好了，${r.length} 条，所有设备共用`) }
    catch (e) { setMsg(`没存上：${e.message}`) }
    finally { setBusy(false) }
  }

  return (
    <div className="settings-card">
      <div className="settings-card-title">出门脱敏</div>
      <div className="privacy-hint">
        发给中转站（和其他第三方服务）的每一个请求，出门前都按这张表把词换掉，包括聊天、勾选的记忆、查记忆查回来的内容。换哪家中转站都照样生效。手机号、身份证号不用写，会自动抹掉。发到我们自己服务器的不换。
      </div>
      <textarea
        className="form-input form-textarea"
        rows={6}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={'一行一条：要藏的词 => 换成什么\n例如：\n某某某 => 阿颖\n某某小区 => 家里'}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="btn-sm btn-primary" disabled={busy} onClick={save}>{busy ? '在存…' : '保存'}</button>
      </div>
      {msg && <div className="privacy-hint" style={{ marginTop: 6 }}>{msg}</div>}
      <div className="form-row" style={{ marginTop: 10 }}>
        <label className="form-label">试一句（看出门后变成什么，保存后才按新表算）</label>
        <input className="form-input" value={probe} onChange={e => setProbe(e.target.value)} placeholder="随便写一句带真名的话" />
        {probe && <div className="privacy-hint" style={{ marginTop: 4 }}>→ {redactText(probe)}</div>}
      </div>
    </div>
  )
}
