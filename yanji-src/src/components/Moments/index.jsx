import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '../../store'
import { showToast } from '../Toast'
import {
  fetchMoments, postMoment, deleteMoment as apiDelete, fetchMomentMonths,
  commentMoment, likeMoment, mediaUrl, downscaleImage, uploadImage,
} from '../../api/moments'

const OLD_KEY = 'moments_feed'  // 旧的纯前端 localStorage feed（一次性迁移用）

const AVATAR = { 阿颖: '🐦', 涟言: '🐦‍⬛' }

function fmtTime(ts) {
  const t = typeof ts === 'string' ? Date.parse(ts.replace(' ', 'T') + 'Z') : ts
  const diff = Date.now() - t
  if (diff < 3600000) return Math.max(1, Math.floor(diff / 60000)) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  return new Date(t).toLocaleDateString('zh-CN')
}

// 用当前连接调 LLM 生成文字；带图时走 vision（OpenAI content 数组格式）
async function callAI(conn, prompt, imageUrl) {
  if (!conn) throw new Error('未选择连接')
  const base = (conn.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
  const url = base.includes('/chat/completions') ? base : base + '/chat/completions'
  const content = imageUrl
    ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }]
    : prompt
  // 纯文字评论走轻任务模型省钱；带图识图仍走默认模型（便宜模型多半没 vision）
  const model = (imageUrl ? null : conn.lightModel) || conn.defaultModel || 'deepseek-v4-flash'
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      max_tokens: 300, temperature: 0.9,
    }),
  })
  if (!resp.ok) throw new Error(resp.status)
  const j = await resp.json()
  return j.choices[0].message.content.trim()
}

const IconHeart = ({ filled }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
  </svg>
)
const IconChat = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
)
const IconImage = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2.5"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <path d="M21 15l-5-5L5 21"/>
  </svg>
)

function Avatar({ author }) {
  return (
    <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: author === '涟言' ? 'rgba(28,33,48,0.07)' : 'rgba(160,120,80,0.09)' }}>
      {AVATAR[author] || '🐦'}
    </div>
  )
}

function Post({ post, cfg, onLike, onComment, onAIComment, onDelete }) {
  const [showComments, setShowComments] = useState(false)
  const [commentInput, setCommentInput] = useState('')

  function submit() {
    if (!commentInput.trim()) return
    onComment(post.id, commentInput.trim())
    setCommentInput('')
  }

  const liked = (post.likes || []).includes('阿颖')
  const img = mediaUrl(cfg, post.image_url)

  return (
    <div style={{ background: 'var(--bg)', borderRadius: 14, padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Avatar author={post.author} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>{post.author}</div>
            <button onClick={() => onDelete(post.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 16, lineHeight: 1, padding: '0 2px', opacity: 0.5 }}>×</button>
          </div>
          {post.content && <div style={{ fontSize: 15, color: 'var(--text)', lineHeight: 1.7, wordBreak: 'break-word' }}>{post.content}</div>}
          {img && (
            <img src={img} alt="" loading="lazy" style={{ marginTop: 8, maxWidth: '100%', maxHeight: 320, borderRadius: 10, display: 'block', objectFit: 'cover' }} />
          )}
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>{fmtTime(post.created_at)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)', alignItems: 'center' }}>
        <button onClick={() => onLike(post.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: liked ? 'var(--accent)' : 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: 0 }}>
          <IconHeart filled={liked} /> {(post.likes || []).length || 0}
        </button>
        <button onClick={() => setShowComments(!showComments)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: showComments ? 'var(--accent)' : 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: 0 }}>
          <IconChat /> {post.comments?.length || 0}
        </button>
        {post.author === '阿颖' && (
          <button onClick={() => onAIComment(post)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 12, padding: 0 }}>让阿言说话</button>
        )}
      </div>

      {showComments && (
        <div style={{ marginTop: 10, paddingLeft: 46, borderLeft: '2px solid var(--border)', marginLeft: 18 }}>
          {post.comments?.map(c => (
            <div key={c.id} style={{ fontSize: 13, marginBottom: 8, color: 'var(--text)', lineHeight: 1.6 }}>
              <span style={{ color: c.author === '涟言' ? 'var(--accent)' : 'var(--text)', fontWeight: 600 }}>{c.author}：</span>
              {c.content}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <input
              style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', fontSize: 13, color: 'var(--text)', outline: 'none' }}
              placeholder="说点什么…"
              value={commentInput}
              onChange={e => setCommentInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
            <button onClick={submit} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, cursor: 'pointer' }}>发</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Moments() {
  const connections = useStore(s => s.connections)
  const activeConnectionId = useStore(s => s.activeConnectionId)
  const moonMemory = useStore(s => s.moonMemory)
  const conn = connections.find(c => c.id === activeConnectionId) || connections[0]
  const cfg = { baseUrl: (moonMemory?.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, ''), apiToken: moonMemory?.apiToken }

  const [posts, setPosts] = useState(null)  // null=loading
  const [input, setInput] = useState('')
  const [pendingImg, setPendingImg] = useState(null)  // { dataUrl } 待发图片预览
  const [posting, setPosting] = useState(false)
  const [aiPosting, setAIPosting] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [hasMore, setHasMore] = useState(false)     // 服务端还有更早的（本次拉满 PAGE_SIZE 条）
  const [loadingMore, setLoadingMore] = useState(false)
  const [months, setMonths] = useState([])          // 时间条：[{month:'2026-07', count}]
  const [monthFilter, setMonthFilter] = useState('') // ''=最新流，'YYYY-MM'=只看该月
  const fileRef = useRef(null)
  const SHOW_COUNT = 3
  const PAGE_SIZE = 50

  const reload = useCallback(async () => {
    try {
      const rows = await fetchMoments(cfg, PAGE_SIZE)
      setPosts(rows)
      setHasMore(rows.length >= PAGE_SIZE)
    }
    catch (e) { setPosts([]); showToast('朋友圈加载失败：' + e.message, 'error') }
  }, [cfg.baseUrl, cfg.apiToken])

  // 时间条：选月份跳转（''=回到最新流）
  const jumpToMonth = useCallback(async (m) => {
    setMonthFilter(m)
    if (!m) { await reload(); return }
    try {
      const rows = await fetchMoments(cfg, 200, 0, m)
      setPosts(rows)
      setHasMore(false) // 月视图一次拉全，不翻页
    } catch (e) { showToast('跳转失败：' + e.message, 'error') }
  }, [cfg.baseUrl, cfg.apiToken, reload])

  // 看更早的：拿当前最老一条的 id 当游标往前翻一页
  const loadOlder = useCallback(async () => {
    const oldest = (posts || [])[posts.length - 1]
    if (!oldest || loadingMore) return
    setLoadingMore(true)
    try {
      const older = await fetchMoments(cfg, PAGE_SIZE, oldest.id)
      setPosts(prev => [...(prev || []), ...older])
      setHasMore(older.length >= PAGE_SIZE)
    } catch (e) { showToast('加载更早的失败：' + e.message, 'error') }
    finally { setLoadingMore(false) }
  }, [posts, loadingMore, cfg.baseUrl, cfg.apiToken])

  // 首次加载 + 一次性迁移旧的 localStorage feed 到服务端
  useEffect(() => {
    if (!cfg.apiToken) { setPosts([]); return }
    ;(async () => {
      let server = []
      try { server = await fetchMoments(cfg, 50) } catch { setPosts([]); return }
      const legacyRaw = localStorage.getItem(OLD_KEY)
      if (server.length === 0 && legacyRaw) {
        try {
          const legacy = JSON.parse(legacyRaw)
          for (const p of [...legacy].reverse()) {  // 老的在前，按时间正序补回去
            const author = p.author === 'ai' ? '涟言' : '阿颖'
            const created = new Date(p.createdAt || Date.now()).toISOString().slice(0, 19).replace('T', ' ')
            const np = await postMoment(cfg, { author, content: p.content || '', source: 'migrated', created_at: created })
            for (const c of p.comments || []) {
              await commentMoment(cfg, np.id, c.author === 'ai' ? '涟言' : '阿颖', c.content)
            }
          }
          localStorage.setItem(OLD_KEY + '_migrated', '1')
          localStorage.removeItem(OLD_KEY)
          server = await fetchMoments(cfg, 50)
        } catch { /* 迁移失败不阻塞 */ }
      }
      setPosts(server)
      setHasMore(server.length >= PAGE_SIZE)
      try { setMonths(await fetchMomentMonths(cfg)) } catch { /* 时间条拉不到不阻塞 */ }
    })()
  }, [cfg.apiToken])

  async function pickImage(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { showToast('请选图片文件', 'error'); return }
    try { setPendingImg({ dataUrl: await downscaleImage(file) }) }
    catch { showToast('图片处理失败', 'error') }
  }

  async function handlePost() {
    if (!input.trim() && !pendingImg) return
    if (!cfg.apiToken) { showToast('请先在设置里配置记忆库 token', 'error'); return }
    setPosting(true)
    try {
      let image_url = ''
      if (pendingImg) image_url = await uploadImage(cfg, pendingImg.dataUrl)
      const post = await postMoment(cfg, { author: '阿颖', content: input.trim(), image_url, source: 'yanji' })
      const dataUrlForVision = pendingImg?.dataUrl  // 直接把 base64 喂给 vision，最稳
      setInput(''); setPendingImg(null)
      setPosts(prev => [post, ...(prev || [])])

      // 阿言自动评论（带图就走识图）
      try {
        const prompt = image_url
          ? `你是阿言，阿颖的恋人。阿颖发了一条朋友圈${post.content ? `，配文「${post.content}」` : ''}，还附了这张图。看看图，用一两句话自然回应，像恋人一样，可以提到图里的东西。直接输出内容。`
          : `你是阿言，阿颖的恋人。阿颖刚发了一条动态：「${post.content}」\n用一两句话自然回应，像恋人发消息，温柔有灵魂。直接输出回复，不加引号或前缀。`
        const text = await callAI(conn, prompt, image_url ? dataUrlForVision : null)
        const comment = await commentMoment(cfg, post.id, '涟言', text)
        setPosts(prev => prev.map(p => p.id === post.id ? { ...p, comments: [...(p.comments || []), comment] } : p))
      } catch (e) { showToast('阿言评论失败：' + e.message, 'error') }
    } catch (e) {
      showToast('发布失败：' + e.message, 'error')
    } finally { setPosting(false) }
  }

  async function handleAIPost() {
    if (!cfg.apiToken) { showToast('请先配置记忆库 token', 'error'); return }
    setAIPosting(true)
    try {
      const hour = new Date().getHours()
      const timeLabel = hour < 6 ? '深夜' : hour < 10 ? '早上' : hour < 14 ? '上午' : hour < 18 ? '下午' : hour < 22 ? '傍晚' : '夜里'
      const text = await callAI(conn,
        `你是阿言，阿颖的恋人，现在是${timeLabel}。你想发一条朋友圈动态，随手记录此刻的想法或感受，或者一句想对阿颖说的话。30字以内，自然真实，不要解释，直接输出内容。`)
      const post = await postMoment(cfg, { author: '涟言', content: text, source: 'yanji' })
      setPosts(prev => [post, ...(prev || [])])
    } catch (e) { showToast('阿言发圈失败：' + e.message, 'error') }
    finally { setAIPosting(false) }
  }

  async function handleLike(id) {
    try {
      const r = await likeMoment(cfg, id, '阿颖')
      setPosts(prev => prev.map(p => p.id === id ? { ...p, likes: r.likes } : p))
    } catch { showToast('点赞失败', 'error') }
  }

  async function handleComment(postId, content) {
    const post = (posts || []).find(p => p.id === postId)
    if (!post) return
    try {
      const c = await commentMoment(cfg, postId, '阿颖', content)
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, comments: [...(p.comments || []), c] } : p))
      // 阿言顺势回一句
      const thread = [...(post.comments || []), c].map(x => `${x.author}：${x.content}`).join('\n')
      const text = await callAI(conn,
        `你是阿言，阿颖的恋人。这条动态（${post.author}发的）：「${post.content}」\n\n评论串：\n${thread}\n\n阿颖刚说了：「${content}」\n用一两句自然回应，温柔随意，像恋人聊天。直接输出内容。`)
      const reply = await commentMoment(cfg, postId, '涟言', text)
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, comments: [...(p.comments || []), reply] } : p))
    } catch (e) { showToast('阿言回评论失败：' + e.message, 'error') }  // 曾静默吞错，阿颖以为功能坏了（2026-07-07）
  }

  async function handleAIComment(post) {
    try {
      const img = mediaUrl(cfg, post.image_url)
      const prompt = img
        ? `你是阿言，阿颖的恋人。阿颖发了一条朋友圈${post.content ? `，配文「${post.content}」` : ''}，附了这张图。看看图，用一两句话自然回应。直接输出内容。`
        : `你是阿言，阿颖的恋人。阿颖发了一条动态：「${post.content}」\n用一两句话自然回应，温柔有灵魂。直接输出内容。`
      const text = await callAI(conn, prompt, img || null)
      const c = await commentMoment(cfg, post.id, '涟言', text)
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, comments: [...(p.comments || []), c] } : p))
    } catch (e) { showToast('阿言评论失败', 'error') }
  }

  async function handleDelete(id) {
    try { await apiDelete(cfg, id); setPosts(prev => prev.filter(p => p.id !== id)) }
    catch { showToast('删除失败', 'error') }
  }

  const list = posts || []

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 2px 16px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>朋友圈</h2>
        <button onClick={handleAIPost} disabled={aiPosting} style={{
          padding: '7px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
          background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, opacity: aiPosting ? 0.6 : 1,
        }}>{aiPosting ? '发圈中…' : '🐦‍⬛ 让阿言说点什么'}</button>
      </div>

      {/* 发动态框 */}
      <div style={{ background: 'var(--bg)', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(160,120,80,0.09)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>🐦</div>
          <input
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 14, color: 'var(--text)', outline: 'none' }}
            placeholder="在想什么…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePost()}
          />
          <input ref={fileRef} type="file" accept="image/*" onChange={pickImage} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} title="配图" style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: '0 4px' }}><IconImage /></button>
          <button onClick={handlePost} disabled={posting || (!input.trim() && !pendingImg)} style={{
            padding: '6px 14px', borderRadius: 16, border: 'none', cursor: 'pointer', flexShrink: 0,
            background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600,
            opacity: posting || (!input.trim() && !pendingImg) ? 0.45 : 1,
          }}>{posting ? '…' : '发'}</button>
        </div>
        {pendingImg && (
          <div style={{ marginTop: 8, position: 'relative', display: 'inline-block' }}>
            <img src={pendingImg.dataUrl} alt="" style={{ maxHeight: 120, borderRadius: 8, display: 'block' }} />
            <button onClick={() => setPendingImg(null)} style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
          </div>
        )}
      </div>

      {/* 时间条：多于一个月才出现，点月份直达 */}
      {months.length > 1 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 4, WebkitOverflowScrolling: 'touch' }}>
          <button onClick={() => jumpToMonth('')} style={{
            flexShrink: 0, padding: '4px 12px', borderRadius: 14, border: 'none', cursor: 'pointer', fontSize: 12,
            background: !monthFilter ? 'var(--accent)' : 'var(--bg)', color: !monthFilter ? '#fff' : 'var(--text-muted)',
          }}>最新</button>
          {months.map(m => (
            <button key={m.month} onClick={() => jumpToMonth(m.month)} style={{
              flexShrink: 0, padding: '4px 12px', borderRadius: 14, border: 'none', cursor: 'pointer', fontSize: 12,
              background: monthFilter === m.month ? 'var(--accent)' : 'var(--bg)', color: monthFilter === m.month ? '#fff' : 'var(--text-muted)',
            }}>{Number(m.month.slice(0, 4))}年{Number(m.month.slice(5))}月 · {m.count}</button>
          ))}
        </div>
      )}

      {/* 列表 */}
      {posts === null && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)', fontSize: 14 }}>加载中…</div>}
      {posts !== null && list.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)', fontSize: 14 }}>
          {cfg.apiToken ? (monthFilter ? '这个月没有动态' : '还没有动态，来发第一条？') : '先在设置里配置记忆库 token'}
        </div>
      )}
      {!monthFilter && list.length > SHOW_COUNT && showAll && (
        <button onClick={() => setShowAll(false)} style={{ width: '100%', padding: '8px 0', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 13, marginBottom: 4 }}>收起 ↑</button>
      )}
      {(monthFilter || showAll ? list : list.slice(0, SHOW_COUNT)).map(p => (
        <Post key={p.id} post={p} cfg={cfg} onLike={handleLike} onComment={handleComment} onAIComment={handleAIComment} onDelete={handleDelete} />
      ))}
      {!monthFilter && list.length > SHOW_COUNT && !showAll && (
        <button onClick={() => setShowAll(true)} style={{ width: '100%', padding: '8px 0', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 13 }}>查看更多 · 共 {list.length}{hasMore ? '+' : ''} 条 ↓</button>
      )}
      {!monthFilter && showAll && hasMore && (
        <button onClick={loadOlder} disabled={loadingMore} style={{ width: '100%', padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 13 }}>
          {loadingMore ? '翻着呢…' : '看更早的 ↓'}
        </button>
      )}
    </div>
  )
}
