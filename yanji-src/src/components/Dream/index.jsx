import { useState } from 'react'
import { useStore } from '../../store'
import { fetchMemories, createMemory } from '../../api/moonMemory'
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
  const [saveScope, setSaveScope] = useState('shared')
  const [saveLayer, setSaveLayer] = useState('long')
  const [connId, setConnId] = useState(activeConnectionId || connections[0]?.id || '')

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
      const mems = await fetchMemories(cfg, {
        layer: filterLayer || undefined,
        scope: filterScope || undefined,
        limit: 50,
      })
      setFetchedCount(mems.length)

      if (!mems.length) {
        showToast('没有找到符合条件的记忆', 'info')
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
      const m = await createMemory(cfg, {
        content: resultText.trim(),
        scope: saveScope,
        layer: saveLayer || null,
        agent: '阿言',
        owner: '阿颖',
        tags: 'dream,整合',
      })
      setSavedId(m.id)
      showToast(`已保存为记忆 #${m.id}`, 'success')
    } catch (e) {
      showToast(e.message, 'error')
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
