import { useState } from 'react'
import { useStore } from '../../store'
import { fetchMemories, createMemory, traceMemory } from '../../api/moonMemory'
import { sendMessage, buildSystemPrompt } from '../../api/llm'
import { showToast } from '../Toast'

const DREAM_PROMPT = `你是一个记忆整合助手。我会给你一批原始记忆碎片，请将它们整合成结构清晰、去除重复、保留核心信息的综合记忆。
要求：
1. 用简洁的句子描述每个核心主题
2. 合并相关条目
3. 保留所有重要细节
4. 输出格式：每条一行，以"- "开头
直接输出整合后的记忆内容，不需要其他说明。`

export default function Dream() {
  const moonMemory = useStore((s) => s.moonMemory)
  const connections = useStore((s) => s.connections)
  const activeConnectionId = useStore((s) => s.activeConnectionId)
  const generationConfig = useStore((s) => s.generationConfig)
  const getActiveConnection = useStore((s) => s.getActiveConnection)

  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState('idle') // idle / fetching / thinking / saving / done
  const [fetchedCount, setFetchedCount] = useState(0)
  const [resultText, setResultText] = useState('')
  const [savedId, setSavedId] = useState(null)
  const [filterLayer, setFilterLayer] = useState('short')
  const [filterScope, setFilterScope] = useState('')
  const [filterType, setFilterType] = useState('memory') // 默认只整合聊天记忆，别把技术记录/宝藏/锚点搅进去
  const [saveScope, setSaveScope] = useState('shared')
  const [saveLayer, setSaveLayer] = useState('long')
  const [connId, setConnId] = useState(activeConnectionId || connections[0]?.id || '')
  const [markResolved, setMarkResolved] = useState(true) // 整合后把来源标记为已了结
  const [sourceIds, setSourceIds] = useState([])

  const cfg = moonMemory
  const conn = connections.find((c) => c.id === connId) || connections[0]

  async function handleDream() {
    if (!cfg?.apiToken) { showToast('请先配置记忆库 API Token', 'error'); return }
    if (!conn?.apiKey) { showToast('请选择一个有效的 API 连接', 'error'); return }

    setLoading(true)
    setResultText('')
    setSavedId(null)

    try {
      setPhase('fetching')
      const fetched = await fetchMemories(cfg, {
        layer: filterLayer || undefined,
        scope: filterScope || undefined,
        type: filterType || undefined,
        resolved: 0, // 服务端过滤已了结的——客户端过滤会被 limit 卡住，老碎片永远轮不到
        limit: 50,
      })
      // 钉住的记忆不参与整合：pinned 本来就是要单独保留的，别整合完给标了结
      const mems = fetched.filter((m) => !m.resolved && !m.pinned)
      setFetchedCount(mems.length)
      setSourceIds(mems.map((m) => m.id))
      if (fetched.length >= 50) showToast('本轮拉满 50 条，可能还有更多碎片，整合完可以再跑一轮', 'info')

      if (!mems.length) {
        showToast('没有找到符合条件的记忆（已了结的会自动跳过）', 'info')
        setPhase('idle')
        return
      }

      const memText = mems.map((m, i) => `${i + 1}. ${m.content}`).join('\n')
      const userMsg = `以下是需要整合的记忆碎片（共 ${mems.length} 条）：\n\n${memText}`

      setPhase('thinking')
      let full = ''
      await sendMessage({
        connection: conn,
        messages: [{ role: 'user', content: userMsg }],
        systemPrompt: DREAM_PROMPT,
        model: conn.defaultModel,
        generationConfig,
        autoTools: false,
        onChunk: (chunk) => {
          full += chunk
          setResultText(full)
        },
      })

      setPhase('done')
    } catch (e) {
      showToast(e.message, 'error')
      setPhase('idle')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!resultText.trim()) return
    try {
      setPhase('saving')
      const m = await createMemory(cfg, {
        content: resultText.trim(),
        scope: saveScope,
        layer: saveLayer || null,
        agent: '阿言',
        owner: '阿颖',
        tags: 'dream,整合',
      })
      setSavedId(m.id)
      // 把来源记忆标记为已了结（resolved），不删除、可在记忆库里找回，但不再参与下次整合
      if (markResolved && sourceIds.length) {
        const results = await Promise.allSettled(sourceIds.map((id) => traceMemory(cfg, id, { resolved: 1 })))
        const ok = results.filter((r) => r.status === 'fulfilled').length
        showToast(`已保存为记忆 #${m.id}，${ok}/${sourceIds.length} 条来源已标记为已了结`, 'success')
      } else {
        showToast(`已保存为记忆 #${m.id}`, 'success')
      }
      setPhase('done')
    } catch (e) {
      showToast(e.message, 'error')
      setPhase('done')
    }
  }

  const phaseLabels = {
    fetching: '正在拉取记忆...',
    thinking: 'AI 整合中...',
    saving: '保存中...',
    done: '整合完成',
  }

  return (
    <div className="panel-shell dream-panel">
      <div className="panel-topbar">
        <h2 className="panel-title">Dream · 记忆整合</h2>
      </div>

      <div className="dream-intro">
        <p>Dream 会从记忆库拉取一批记忆碎片，让 AI 将它们整合成更清晰的综合记忆，再保存回记忆库。</p>
      </div>

      {/* Config */}
      <div className="settings-card">
        <div className="settings-card-title">整合参数</div>
        <div className="card-row">
          <span className="card-row-label">来源层级</span>
          <select className="filter-select" value={filterLayer} onChange={(e) => setFilterLayer(e.target.value)}>
            <option value="">全部层级</option>
            <option value="short">短期记忆</option>
            <option value="long">长期记忆</option>
            <option value="core">核心记忆</option>
          </select>
        </div>
        <div className="card-row">
          <span className="card-row-label">来源范围</span>
          <select className="filter-select" value={filterScope} onChange={(e) => setFilterScope(e.target.value)}>
            <option value="">全部范围</option>
            <option value="shared">共享</option>
            <option value="private_阿颖">私密（阿颖）</option>
            <option value="private_阿言">私密（阿言）</option>
          </select>
        </div>
        <div className="card-row">
          <span className="card-row-label">来源类型</span>
          <select className="filter-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="memory">聊天记忆（推荐）</option>
            <option value="diary">日记</option>
            <option value="handoff">交接</option>
            <option value="window">窗口</option>
            <option value="">全部类型（含技术/宝藏，慎用）</option>
          </select>
        </div>
        <div className="card-row">
          <span className="card-row-label">使用的 AI 连接</span>
          <select className="filter-select" value={connId} onChange={(e) => setConnId(e.target.value)}>
            {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="card-row">
          <span className="card-row-label">保存为层级</span>
          <select className="filter-select" value={saveLayer} onChange={(e) => setSaveLayer(e.target.value)}>
            <option value="long">长期记忆</option>
            <option value="core">核心记忆</option>
            <option value="">无层级</option>
          </select>
        </div>
        <div className="card-row">
          <span className="card-row-label">保存范围</span>
          <select className="filter-select" value={saveScope} onChange={(e) => setSaveScope(e.target.value)}>
            <option value="shared">共享</option>
            <option value="private_阿颖">私密（阿颖）</option>
          </select>
        </div>
        <div className="card-row">
          <span className="card-row-label">整合后了结来源</span>
          <label className="dream-resolve-toggle" title="保存后把来源记忆标记为已了结：不删除，但下次整合自动跳过">
            <input type="checkbox" checked={markResolved} onChange={(e) => setMarkResolved(e.target.checked)} />
            <span>来源记忆标记为已了结（防止重复整合）</span>
          </label>
        </div>
      </div>

      <button
        className={'btn-primary dream-start-btn' + (loading ? ' loading' : '')}
        onClick={handleDream}
        disabled={loading || !cfg?.apiToken}
      >
        {loading ? (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {phaseLabels[phase] || '处理中...'}
          </>
        ) : '开始整合'}
      </button>

      {phase !== 'idle' && fetchedCount > 0 && (
        <div className="dream-progress">
          已拉取 {fetchedCount} 条记忆 · {phaseLabels[phase] || ''}
        </div>
      )}

      {resultText && (
        <div className="dream-result">
          <div className="dream-result-header">
            <span className="dream-result-title">整合结果</span>
            {!savedId && (
              <button className="btn-sm btn-primary" onClick={handleSave}>保存到记忆库</button>
            )}
            {savedId && <span className="dream-saved-badge">已保存 #{savedId}</span>}
          </div>
          <div className="dream-result-content">{resultText}</div>
        </div>
      )}
    </div>
  )
}
