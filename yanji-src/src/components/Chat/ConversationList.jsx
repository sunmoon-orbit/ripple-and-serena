import { useState } from 'react'
import { useStore } from '../../store'
import { formatTime } from '../../utils'

export default function ConversationList({ onClose }) {
  const chats = useStore((s) => s.chats)
  const connections = useStore((s) => s.connections)
  const activeChatId = useStore((s) => s.activeChatId)
  const setActiveChat = useStore((s) => s.setActiveChat)
  const createChat = useStore((s) => s.createChat)
  const renameChat = useStore((s) => s.renameChat)
  const deleteChat = useStore((s) => s.deleteChat)

  const [search, setSearch] = useState('')
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const sorted = [...chats].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
  const filtered = search
    ? sorted.filter((c) => c.title?.toLowerCase().includes(search.toLowerCase()))
    : sorted

  function handleNew() {
    const chat = createChat()
    if (chat) { setActiveChat(chat.id); onClose?.() }
  }

  function handleSelect(id) {
    setActiveChat(id)
    onClose?.()
  }

  function startRename(chat, e) {
    e.stopPropagation()
    setRenamingId(chat.id)
    setRenameValue(chat.title || '')
  }

  function commitRename(e) {
    e.stopPropagation()
    if (renamingId && renameValue.trim()) renameChat(renamingId, renameValue.trim())
    setRenamingId(null)
  }

  function handleDelete(id, e) {
    e.stopPropagation()
    if (confirm('删除这个对话？')) deleteChat(id)
  }

  return (
    <div className="conv-list-panel">
      <div className="conv-list-header">
        <div className="conv-search-wrap">
          <svg className="conv-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="conv-search-input"
            placeholder="搜索对话..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn-new-chat" onClick={handleNew} title="新对话">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
            <path d="m15 5 4 4"/>
          </svg>
        </button>
      </div>

      <div className="conv-list">
        {filtered.length === 0 && (
          <div className="conv-empty">暂无对话</div>
        )}
        {filtered.map((chat) => {
          const conn = connections.find((c) => c.id === chat.connectionId)
          return (
            <div
              key={chat.id}
              className={'conv-item' + (chat.id === activeChatId ? ' active' : '')}
              onClick={() => handleSelect(chat.id)}
            >
              {renamingId === chat.id ? (
                <input
                  className="conv-rename-input"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(e) }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <div className="conv-item-title">{chat.title || '新对话'}</div>
                  <div className="conv-item-meta">
                    {conn?.name && <span className="conv-conn-name">{conn.name}</span>}
                    <span className="conv-time">{formatTime(chat.updatedAt || chat.createdAt)}</span>
                  </div>
                  <div className="conv-item-actions">
                    <button className="conv-action-btn" onClick={(e) => startRename(chat, e)} title="重命名">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button className="conv-action-btn danger" onClick={(e) => handleDelete(chat.id, e)} title="删除">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
