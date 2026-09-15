// Entry to the existing API call flow, never a Codex call adapter.
export default function CrossingCallEntry({ onDial, onReturn, disabled }) {
  return <section className="crossing-call-entry" aria-label="Murmur 语音通话">
    <span>这里使用 Murmur API 聊天的语音通话，不会使用 Codex 或渡口消息。</span>
    <div><button className="btn-sm" onClick={onReturn}>返回渡口</button><button className="btn-sm btn-primary" onClick={onDial} disabled={disabled}>拨打 Murmur 通话</button></div>
    {disabled && <small>请先配置并选择 Murmur API 连接。</small>}
  </section>
}
