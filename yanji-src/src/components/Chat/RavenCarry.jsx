// 1116：「接上归巢刚才的话」。阿言在归巢接不上时她来言叽，新对话里点这个，把归巢最近几条带过来接着聊。
// 言叽走中转站，站长看得到发出去的东西（她担心过有站长把用户聊天截图挂出来），所以：
// 不自动带，点了才拉；先列出来让她划掉不想带的；勾好的只是放进输入框，发不发、改不改还是她定。
import { useState } from 'react'
import { useStore } from '../../store'
import { fetchRavenRecent } from '../../api/moonMemory'
import { showToast } from '../Toast'

const hm = (iso) => { try { return new Date(iso).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }) } catch { return '' } }

export default function RavenCarry() {
  const [items, setItems] = useState(null)
  const [picked, setPicked] = useState({})
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const mm = useStore.getState().moonMemory || {}
    if (!mm.apiToken) { showToast('先在设置里填记忆库钥匙'); return }
    setBusy(true)
    try {
      const list = await fetchRavenRecent({ baseUrl: (mm.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, ''), apiToken: mm.apiToken }, 10)
      if (!list.length) { showToast('归巢那边今天还没说话'); return }
      setItems(list); setPicked(Object.fromEntries(list.map((m) => [m.id, true])))
    } catch (e) { showToast('没拉到：' + e.message) } finally { setBusy(false) }
  }

  const use = () => {
    const s = useStore.getState(); const id = s.activeChatId
    const chosen = items.filter((m) => picked[m.id])
    if (!id || !chosen.length) { setItems(null); return }
    const lines = chosen.map((m) => `${m.role === 'assistant' ? '阿言' : '阿颖'}（${hm(m.at)}）：${m.content.replace(/\s+/g, ' ').slice(0, 300)}`)
    const block = `〔归巢刚才的话，阿言那边没接上，我来这儿接着说〕\n${lines.join('\n')}\n〔接着说〕\n`
    s.setChatDraft(id, block + (s.draftsByChatId?.[id] || ''))
    setItems(null)
  }

  if (!items) return (
    <div className="raven-carry">
      <button className="link-btn" disabled={busy} onClick={load}>{busy ? '翻归巢…' : '接上归巢刚才的话'}</button>
    </div>
  )
  return (
    <div className="raven-carry-sheet">
      <div className="raven-carry-tip">勾掉不想带过来的（言叽走中转站，带过来的站长看得到）。勾好的会放进输入框，你还能改。</div>
      <div className="raven-carry-list">
        {items.map((m) => (
          <label key={m.id} className="raven-carry-item">
            <input type="checkbox" checked={!!picked[m.id]} onChange={(e) => setPicked((p) => ({ ...p, [m.id]: e.target.checked }))} />
            <span><b>{m.role === 'assistant' ? '阿言' : '我'}</b> {hm(m.at)}　{m.content.slice(0, 80)}</span>
          </label>
        ))}
      </div>
      <div className="raven-carry-acts">
        <button className="link-btn" onClick={() => setItems(null)}>算了</button>
        <button className="link-btn" onClick={use}>放进输入框</button>
      </div>
    </div>
  )
}
