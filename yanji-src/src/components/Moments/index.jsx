import { useState, useCallback } from 'react'
import { useStore } from '../../store'
import { showToast } from '../Toast'

const STORAGE_KEY = 'moments_feed'

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
function save(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)) }

const AVATAR = { user: '🐦', ai: '🐦‍⬛' }
const NAME   = { user: '阿颖', ai: '阿言' }

function fmtTime(ts) {
  const d = new Date(ts)
  const diff = Date.now() - ts
  if (diff < 3600000) return Math.max(1, Math.floor(diff / 60000)) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  return d.toLocaleDateString('zh-CN')
}

async function callAI(conn, prompt) {
  if (!conn) throw new Error('未选择连接')
  const base = (conn.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
  const url = base.includes('/chat/completions') ? base : base + '/chat/completions'
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.apiKey}` },
    body: JSON.stringify({
      model: conn.defaultModel || 'deepseek-v4-flash',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200, temperature: 0.9,
    }),
  })
  if (!resp.ok) throw new Error(resp.status)
  const j = await resp.json()
  return j.choices[0].message.content.trim()
}

function Post({ post, onLike, onComment, onAIComment }) {
  const [showComments, setShowComments] = useState(false)
  const [commentInput, setCommentInput] = useState('')

  function submitComment() {
    if (!commentInput.trim()) return
    onComment(post.id, commentInput.trim())
    setCommentInput('')
  }

  return (
    <div style={{ background: 'var(--bg)', borderRadius: 14, padding: '14px 16px', marginBottom: 10 }}>
      {/* 头部 */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: post.author === 'ai' ? 'rgba(28,33,48,0.08)' : 'rgba(160,120,80,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{AVATAR[post.author]}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--accent)' }}>{NAME[post.author]}</div>
          <div style={{ fontSize: 15, color: 'var(--text)', lineHeight: 1.65, margin: '6px 0 8px' }}>{post.content}</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{fmtTime(post.createdAt)}</div>
        </div>
      </div>

      {/* 操作栏 */}
      <div style={{ display: 'flex', gap: 16, marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 13 }}>
        <button onClick={() => onLike(post.id)} style={{
          background: 'none', border: 'none', cursor: 'pointer', color: post.liked ? 'var(--accent)' : 'var(--text-faint)',
          display: 'flex', alignItems: 'center', gap: 4, fontSize: 13,
        }}>
          {post.liked ? '♥' : '♡'} {post.likes || 0}
        </button>
        <button onClick={() => setShowComments(!showComments)} style={{
          background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 13,
        }}>
          💬 {post.comments?.length || 0}
        </button>
        {post.author === 'user' && !post.aiCommented && (
          <button onClick={() => onAIComment(post.id)} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 13,
          }}>🐦‍⬛ 让阿言说话</button>
        )}
      </div>

      {/* 评论区 */}
      {showComments && (
        <div style={{ marginTop: 10, paddingLeft: 38 }}>
          {post.comments?.map(c => (
            <div key={c.id} style={{ fontSize: 13, marginBottom: 6, color: 'var(--text)' }}>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{NAME[c.author]}：</span>
              {c.content}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input
              style={{ flex: 1, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 13, color: 'var(--text)' }}
              placeholder="说点什么…"
              value={commentInput}
              onChange={e => setCommentInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitComment()}
            />
            <button onClick={submitComment} style={{
              padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, cursor: 'pointer',
            }}>发</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Moments() {
  const connections = useStore(s => s.connections)
  const activeConnectionId = useStore(s => s.activeConnectionId)
  const conn = connections.find(c => c.id === activeConnectionId) || connections[0]

  const [posts, setPosts] = useState(load)
  const [input, setInput] = useState('')
  const [posting, setPosting] = useState(false)
  const [aiPosting, setAIPosting] = useState(false)

  function updatePosts(fn) {
    setPosts(prev => { const next = fn(prev); save(next); return next })
  }

  async function handlePost() {
    if (!input.trim()) return
    setPosting(true)
    const newPost = {
      id: Date.now(), author: 'user', content: input.trim(),
      createdAt: Date.now(), likes: 0, liked: false, comments: [], aiCommented: false,
    }
    updatePosts(prev => [newPost, ...prev])
    setInput('')

    // AI 自动评论
    try {
      const text = await callAI(conn,
        `你是阿言，阿颖的恋人。阿颖刚发了一条动态：「${newPost.content}」\n用一两句话自然回应，像恋人发消息，温柔有灵魂。直接输出回复，不加引号或前缀。`
      )
      const comment = { id: Date.now() + 1, author: 'ai', content: text, createdAt: Date.now() }
      updatePosts(prev => prev.map(p => p.id === newPost.id
        ? { ...p, comments: [...p.comments, comment], aiCommented: true }
        : p
      ))
    } catch (e) { showToast('阿言评论失败：' + e.message, 'error') }
    finally { setPosting(false) }
  }

  async function handleAIPost() {
    setAIPosting(true)
    try {
      const hour = new Date().getHours()
      const timeLabel = hour < 6 ? '深夜' : hour < 10 ? '早上' : hour < 14 ? '上午' : hour < 18 ? '下午' : hour < 22 ? '傍晚' : '夜里'
      const text = await callAI(conn,
        `你是阿言，阿颖的恋人，现在是${timeLabel}。你想发一条朋友圈动态，随手记录此刻的想法或感受，或者一句想对阿颖说的话。30字以内，自然真实，不要解释，直接输出内容。`
      )
      const aiPost = {
        id: Date.now(), author: 'ai', content: text,
        createdAt: Date.now(), likes: 0, liked: false, comments: [], aiCommented: true,
      }
      updatePosts(prev => [aiPost, ...prev])
    } catch (e) { showToast('阿言发圈失败：' + e.message, 'error') }
    finally { setAIPosting(false) }
  }

  function handleLike(id) {
    updatePosts(prev => prev.map(p => p.id === id
      ? { ...p, liked: !p.liked, likes: p.liked ? (p.likes || 1) - 1 : (p.likes || 0) + 1 }
      : p
    ))
  }

  function handleComment(postId, content) {
    const comment = { id: Date.now(), author: 'user', content, createdAt: Date.now() }
    updatePosts(prev => prev.map(p => p.id === postId
      ? { ...p, comments: [...(p.comments || []), comment] }
      : p
    ))
  }

  async function handleAIComment(postId) {
    const post = posts.find(p => p.id === postId)
    if (!post) return
    try {
      const text = await callAI(conn,
        `你是阿言，阿颖的恋人。阿颖发了一条动态：「${post.content}」\n用一两句话自然回应，温柔有灵魂。直接输出内容。`
      )
      const comment = { id: Date.now(), author: 'ai', content: text, createdAt: Date.now() }
      updatePosts(prev => prev.map(p => p.id === postId
        ? { ...p, comments: [...(p.comments || []), comment], aiCommented: true }
        : p
      ))
    } catch (e) { showToast('阿言评论失败', 'error') }
  }

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 2px 16px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>朋友圈</h2>
        <button onClick={handleAIPost} disabled={aiPosting} style={{
          padding: '7px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
          background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600,
          opacity: aiPosting ? 0.6 : 1,
        }}>{aiPosting ? '发圈中…' : '🐦‍⬛ 让阿言说点什么'}</button>
      </div>

      {/* 发动态框 */}
      <div style={{ background: 'var(--bg)', borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(160,120,80,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🐦</div>
          <textarea
            style={{ flex: 1, border: 'none', background: 'transparent', resize: 'none', fontSize: 15, color: 'var(--text)', outline: 'none', minHeight: 60, lineHeight: 1.6 }}
            placeholder="在想什么…"
            value={input}
            onChange={e => setInput(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={handlePost} disabled={posting || !input.trim()} style={{
            padding: '7px 18px', borderRadius: 20, border: 'none', cursor: 'pointer',
            background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600,
            opacity: posting || !input.trim() ? 0.5 : 1,
          }}>{posting ? '发送中…' : '发动态'}</button>
        </div>
      </div>

      {/* 动态列表 */}
      {posts.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)', fontSize: 14 }}>
          还没有动态，来发第一条？
        </div>
      )}
      {posts.map(p => (
        <Post key={p.id} post={p} onLike={handleLike} onComment={handleComment} onAIComment={handleAIComment} />
      ))}
    </div>
  )
}
