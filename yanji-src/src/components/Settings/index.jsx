import { useState, useEffect } from 'react'
import { useStore } from '../../store'
import { normalizeProvider, BUILTIN_MODELS } from '../../api/llm'
import { checkHealth, fetchPushSchedule, savePushSchedule } from '../../api/moonMemory'
import { showToast } from '../Toast'
import { uuid } from '../../utils'
import { subscribePush, unsubscribePush, getSubscription } from '../../api/push'

function Section({ title, children }) {
  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      {children}
    </div>
  )
}

function ConnectionCard({ conn, onSave, onDelete, onActivate, isActive }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ ...conn })
  const provider = normalizeProvider(form.provider)
  const models = BUILTIN_MODELS[provider] || []

  function save() {
    onSave(conn.id, form)
    setEditing(false)
    showToast('已保存', 'success')
  }

  return (
    <div className={'settings-card conn-card' + (isActive ? ' conn-card-active' : '')}>
      {!editing ? (
        <>
          <div className="conn-card-header">
            <div className="conn-card-info">
              <div className="conn-card-name">{conn.name || '未命名'}</div>
              <div className="conn-card-meta">{conn.provider} · {conn.defaultModel || '—'}</div>
            </div>
            <div className="conn-card-actions">
              {!isActive && (
                <button className="btn-sm btn-ghost" onClick={() => onActivate(conn.id)}>激活</button>
              )}
              {isActive && <span className="conn-active-badge">当前</span>}
              <button className="btn-sm btn-ghost" onClick={() => { setForm({ ...conn }); setEditing(true) }}>编辑</button>
              <button className="btn-sm btn-ghost danger" onClick={() => { if (confirm('删除连接？')) onDelete(conn.id) }}>删除</button>
            </div>
          </div>
        </>
      ) : (
        <div className="conn-edit-form">
          <div className="form-row">
            <label className="form-label">名称</label>
            <input className="form-input" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="连接名称" />
          </div>
          <div className="form-row">
            <label className="form-label">Provider</label>
            <select className="filter-select" value={form.provider || 'openai'} onChange={(e) => setForm({ ...form, provider: e.target.value, defaultModel: '' })}>
              <option value="openai">OpenAI / 兼容</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
              <option value="deepseek">DeepSeek</option>
            </select>
          </div>
          <div className="form-row">
            <label className="form-label">API Key</label>
            <input className="form-input" type="password" value={form.apiKey || ''} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-..." />
          </div>
          <div className="form-row">
            <label className="form-label">Base URL</label>
            <input className="form-input" value={form.baseUrl || ''} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="（留空使用默认）" />
          </div>
          <div className="form-row">
            <label className="form-label">默认模型</label>
            {models.length > 0 ? (
              <select className="filter-select" value={form.defaultModel || ''} onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}>
                <option value="">自定义...</option>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input className="form-input" value={form.defaultModel || ''} onChange={(e) => setForm({ ...form, defaultModel: e.target.value })} placeholder="模型名称" />
            )}
          </div>
          {form.defaultModel === '' && models.length > 0 && (
            <div className="form-row">
              <label className="form-label"></label>
              <input className="form-input" value={form.customModel || ''} onChange={(e) => setForm({ ...form, customModel: e.target.value, defaultModel: e.target.value })} placeholder="自定义模型名..." />
            </div>
          )}
          <div className="form-row form-actions">
            <button className="btn-sm btn-ghost" onClick={() => setEditing(false)}>取消</button>
            <button className="btn-sm btn-primary" onClick={save}>保存</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Settings() {
  const store = useStore()
  const {
    connections, activeConnectionId, tokenStats, moonMemory, theme,
    globalInstruction, generationConfig, contextLimit, searchConfig, autoTools,
    addConnection, updateConnection, deleteConnection, setActiveConnection,
    setGlobalInstruction, setGenerationConfig, setContextLimit, setSearchConfig,
    setAutoTools, setMoonMemory, setTheme, memoryItems, addMemoryItem, toggleMemoryItem, deleteMemoryItem,
  } = store

  const [addingConn, setAddingConn] = useState(false)
  const [newConn, setNewConn] = useState({ name: '', provider: 'openai', apiKey: '', baseUrl: '', defaultModel: '' })
  const [fetchedModels, setFetchedModels] = useState([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [moonHealthStatus, setMoonHealthStatus] = useState('')
  const [newMemContent, setNewMemContent] = useState('')
  const [tab, setTab] = useState('connections')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [pushTimes, setPushTimes] = useState(null)
  const [pushTimesSaving, setPushTimesSaving] = useState(false)

  useEffect(() => {
    getSubscription().then((sub) => setPushEnabled(!!sub)).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'moon' && moonMemory?.apiToken && pushTimes === null) {
      fetchPushSchedule(moonMemory).then((r) => setPushTimes(r.times)).catch(() => {})
    }
  }, [tab, moonMemory?.apiToken])

  async function savePushTimes() {
    if (!pushTimes) return
    setPushTimesSaving(true)
    try {
      const r = await savePushSchedule(moonMemory, pushTimes)
      setPushTimes(r.times)
      showToast('推送时间已保存', 'success')
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setPushTimesSaving(false)
    }
  }

  async function togglePush() {
    if (!moonMemory?.enabled || !moonMemory?.baseUrl || !moonMemory?.apiToken) {
      showToast('请先配置并启用拾羽记忆库', 'error'); return
    }
    setPushLoading(true)
    try {
      const moonConfig = { apiUrl: (moonMemory.baseUrl || '').replace(/\/$/, ''), apiToken: moonMemory.apiToken }
      if (pushEnabled) {
        await unsubscribePush(moonConfig)
        setPushEnabled(false)
        showToast('已关闭推送通知')
      } else {
        await subscribePush(moonConfig)
        setPushEnabled(true)
        showToast('推送通知已开启！')
      }
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setPushLoading(false)
    }
  }

  const TABS = [
    { id: 'connections', label: '连接' },
    { id: 'memory', label: '记忆注入' },
    { id: 'moon', label: '拾羽记忆库' },
    { id: 'general', label: '通用' },
    { id: 'appearance', label: '外观' },
    { id: 'monitor', label: 'API 监控' },
  ]

  const THEMES = [
    { id: 'default', name: '暮山紫', color: '#bfb5d8' },
    { id: 'xilan', name: '夕岚', color: '#deb7b8' },
    { id: 'claude', name: 'Claude', color: '#c8745a' },
  ]

  async function checkMoonHealth() {
    try {
      setMoonHealthStatus('检查中...')
      await checkHealth(moonMemory)
      setMoonHealthStatus('连接正常')
    } catch (e) {
      setMoonHealthStatus('连接失败: ' + e.message)
    }
  }

  function handleAddConn() {
    if (!newConn.apiKey.trim()) { showToast('请填写 API Key', 'error'); return }
    addConnection({ ...newConn, id: uuid() })
    setNewConn({ name: '', provider: 'openai', apiKey: '', baseUrl: '', defaultModel: '' })
    setFetchedModels([])
    setAddingConn(false)
    showToast('连接已添加', 'success')
  }

  async function handleFetchModels() {
    if (!newConn.apiKey.trim()) { showToast('请先填写 API Key', 'error'); return }
    const defaultUrls = { openai: 'https://api.openai.com/v1', deepseek: 'https://api.deepseek.com/v1' }
    const base = (newConn.baseUrl.trim() || defaultUrls[newConn.provider] || '').replace(/\/$/, '')
    if (!base) { showToast('请填写 Base URL', 'error'); return }
    setFetchingModels(true)
    try {
      const resp = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${newConn.apiKey}` } })
      if (!resp.ok) throw new Error(resp.status)
      const data = await resp.json()
      const ids = (data.data || []).map((m) => m.id).filter(Boolean).sort()
      if (!ids.length) throw new Error('未返回模型列表')
      setFetchedModels(ids)
      showToast(`拉取到 ${ids.length} 个模型`, 'success')
    } catch (e) {
      showToast('拉取失败：' + e.message, 'error')
    } finally {
      setFetchingModels(false)
    }
  }

  const totalStats = Object.values(tokenStats).reduce((acc, s) => ({
    calls: acc.calls + (s.calls || 0),
    totalTokens: acc.totalTokens + (s.totalTokens || 0),
    promptTokens: acc.promptTokens + (s.promptTokens || 0),
    completionTokens: acc.completionTokens + (s.completionTokens || 0),
  }), { calls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0 })

  return (
    <div className="panel-shell settings-panel">
      <div className="panel-topbar">
        <h2 className="panel-title">设置</h2>
      </div>

      {/* Tab bar */}
      <div className="settings-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={'settings-tab' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="settings-content">

        {/* ── Connections ──────────────────────────────────────── */}
        {tab === 'connections' && (
          <Section title="API 连接">
            {connections.map((conn) => (
              <ConnectionCard
                key={conn.id}
                conn={conn}
                isActive={conn.id === activeConnectionId}
                onSave={(id, patch) => updateConnection(id, patch)}
                onDelete={deleteConnection}
                onActivate={setActiveConnection}
              />
            ))}
            {!addingConn && (
              <button className="btn-sm btn-ghost btn-add-conn" onClick={() => setAddingConn(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                添加连接
              </button>
            )}
            {addingConn && (
              <div className="settings-card">
                <div className="settings-card-title">新连接</div>
                <div className="form-row">
                  <label className="form-label">名称</label>
                  <input className="form-input" value={newConn.name} onChange={(e) => setNewConn({ ...newConn, name: e.target.value })} placeholder="连接名称" />
                </div>
                <div className="form-row">
                  <label className="form-label">Provider</label>
                  <select className="filter-select" value={newConn.provider} onChange={(e) => setNewConn({ ...newConn, provider: e.target.value, defaultModel: '' })}>
                    <option value="openai">OpenAI / 兼容</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Gemini</option>
                    <option value="deepseek">DeepSeek</option>
                  </select>
                </div>
                <div className="form-row">
                  <label className="form-label">API Key</label>
                  <input className="form-input" type="password" value={newConn.apiKey} onChange={(e) => setNewConn({ ...newConn, apiKey: e.target.value })} placeholder="sk-..." />
                </div>
                <div className="form-row">
                  <label className="form-label">Base URL</label>
                  <input className="form-input" value={newConn.baseUrl} onChange={(e) => { setNewConn({ ...newConn, baseUrl: e.target.value }); setFetchedModels([]); }} placeholder="（留空使用默认）" />
                </div>
                <div className="form-row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn-sm btn-ghost" onClick={handleFetchModels} disabled={fetchingModels}>
                    {fetchingModels ? '拉取中…' : '拉取模型'}
                  </button>
                </div>
                <div className="form-row">
                  <label className="form-label">默认模型</label>
                  {fetchedModels.length > 0 ? (
                    <select className="filter-select" style={{ flex: 1 }} value={newConn.defaultModel} onChange={(e) => setNewConn({ ...newConn, defaultModel: e.target.value })}>
                      <option value="">请选择模型…</option>
                      {fetchedModels.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <input className="form-input" value={newConn.defaultModel} onChange={(e) => setNewConn({ ...newConn, defaultModel: e.target.value })} placeholder="模型名称（或点「拉取模型」）" />
                  )}
                </div>
                <div className="form-row form-actions">
                  <button className="btn-sm btn-ghost" onClick={() => { setAddingConn(false); setFetchedModels([]); }}>取消</button>
                  <button className="btn-sm btn-primary" onClick={handleAddConn}>添加</button>
                </div>
              </div>
            )}
          </Section>
        )}

        {/* ── Memory Injection ─────────────────────────────────── */}
        {tab === 'memory' && (
          <Section title="记忆注入（System Prompt）">
            <div className="settings-card">
              <div className="card-row">
                <label className="form-label">全局指令</label>
              </div>
              <textarea
                className="form-input form-textarea"
                rows={5}
                value={globalInstruction}
                onChange={(e) => setGlobalInstruction(e.target.value)}
                placeholder="输入全局系统指令，每次对话都会注入..."
              />
            </div>
            <div className="settings-card">
              <div className="settings-card-title">记忆条目</div>
              {memoryItems.length === 0 && <div className="panel-empty" style={{ padding: '12px 0' }}>暂无记忆条目</div>}
              {memoryItems.map((item) => (
                <div key={item.id} className="card-row memory-item-row">
                  <input type="checkbox" checked={item.enabled !== false} onChange={() => toggleMemoryItem(item.id)} className="mem-checkbox" />
                  <span className="mem-item-content">{item.content}</span>
                  <button className="mem-action-btn danger" onClick={() => deleteMemoryItem(item.id)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
              <div className="card-row">
                <input
                  className="form-input"
                  placeholder="添加记忆条目..."
                  value={newMemContent}
                  onChange={(e) => setNewMemContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newMemContent.trim()) {
                      addMemoryItem(newMemContent.trim())
                      setNewMemContent('')
                    }
                  }}
                />
                <button className="btn-sm btn-primary" onClick={() => {
                  if (newMemContent.trim()) { addMemoryItem(newMemContent.trim()); setNewMemContent('') }
                }}>添加</button>
              </div>
            </div>
          </Section>
        )}

        {/* ── Moon Memory ──────────────────────────────────────── */}
        {tab === 'moon' && (
          <Section title="拾羽记忆库">
            <div className="settings-card">
              <div className="card-row">
                <span className="card-row-label">启用拾羽记忆库</span>
                <label className="toggle">
                  <input type="checkbox" checked={moonMemory.enabled} onChange={(e) => setMoonMemory({ enabled: e.target.checked })} />
                  <span className="toggle-track" />
                </label>
              </div>
              <div className="form-row">
                <label className="form-label">Base URL</label>
                <input className="form-input" value={moonMemory.baseUrl || ''} onChange={(e) => setMoonMemory({ baseUrl: e.target.value })} placeholder="https://memory.ravenlove.cc" />
              </div>
              <div className="form-row">
                <label className="form-label">API Token</label>
                <input className="form-input" type="password" value={moonMemory.apiToken || ''} onChange={(e) => setMoonMemory({ apiToken: e.target.value })} placeholder="Bearer token..." />
              </div>
              <div className="form-row">
                <label className="form-label">每次检索条数</label>
                <input className="form-input" type="number" min="1" max="20" value={moonMemory.limit || 5} onChange={(e) => setMoonMemory({ limit: Number(e.target.value) })} />
              </div>
              <div className="card-row">
                <button className="btn-sm btn-ghost" onClick={checkMoonHealth}>测试连接</button>
                {moonHealthStatus && <span className="health-status">{moonHealthStatus}</span>}
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-card-title">AI 工具权限</div>
              <div className="card-row">
                <span className="card-row-label">AI 可读取记忆</span>
                <span className="perm-badge perm-ok">允许</span>
              </div>
              <div className="card-row">
                <span className="card-row-label">AI 可写入记忆</span>
                <span className="perm-badge perm-ok">允许</span>
              </div>
              <div className="card-row">
                <span className="card-row-label">AI 可删除记忆</span>
                <span className="perm-badge perm-deny">禁止</span>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-card-title">推送通知</div>
              <div className="card-row">
                <span className="card-row-label">每日问候推送</span>
                <label className="toggle">
                  <input type="checkbox" checked={pushEnabled} disabled={pushLoading} onChange={togglePush} />
                  <span className="toggle-track" />
                </label>
              </div>
              {!('PushManager' in window) && (
                <div className="card-row" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  此浏览器不支持推送通知
                </div>
              )}
              {pushTimes !== null && (
                <>
                  <div className="settings-card-title" style={{ marginTop: 10 }}>推送时间</div>
                  <div className="push-times-list">
                    {pushTimes.map((t, i) => (
                      <div key={i} className="push-time-row">
                        <input
                          type="time"
                          className="form-input push-time-input"
                          value={t}
                          onChange={(e) => {
                            const next = [...pushTimes]
                            next[i] = e.target.value
                            setPushTimes(next)
                          }}
                        />
                        <button className="mem-action-btn danger" onClick={() => setPushTimes(pushTimes.filter((_, j) => j !== i))}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="card-row" style={{ gap: 8 }}>
                    <button className="btn-sm btn-ghost" onClick={() => setPushTimes([...pushTimes, '08:00'])}>+ 添加时间</button>
                    <button className="btn-sm btn-primary" disabled={pushTimesSaving} onClick={savePushTimes}>保存</button>
                  </div>
                </>
              )}
            </div>
          </Section>
        )}

        {/* ── General ──────────────────────────────────────────── */}
        {tab === 'general' && (
          <>
            <Section title="生成参数">
              <div className="settings-card">
                <div className="card-row">
                  <span className="card-row-label">Temperature</span>
                  <input className="form-input form-input-sm" type="number" min="0" max="2" step="0.1" value={generationConfig.temperature ?? 0.7} onChange={(e) => setGenerationConfig({ temperature: Number(e.target.value) })} />
                </div>
                <div className="card-row">
                  <span className="card-row-label">Max Tokens</span>
                  <input className="form-input form-input-sm" type="number" min="256" max="32000" step="256" value={generationConfig.maxTokens ?? 4096} onChange={(e) => setGenerationConfig({ maxTokens: Number(e.target.value) })} />
                </div>
              </div>
            </Section>
            <Section title="上下文限制">
              <div className="settings-card">
                <div className="card-row">
                  <span className="card-row-label">模式</span>
                  <select className="filter-select" value={contextLimit.mode} onChange={(e) => setContextLimit({ mode: e.target.value })}>
                    <option value="none">不限制</option>
                    <option value="rounds">按轮数</option>
                    <option value="tokens">按 Token 数</option>
                  </select>
                </div>
                {contextLimit.mode === 'rounds' && (
                  <div className="card-row">
                    <span className="card-row-label">最大轮数</span>
                    <input className="form-input form-input-sm" type="number" value={contextLimit.maxRounds ?? 50} onChange={(e) => setContextLimit({ maxRounds: Number(e.target.value) })} />
                  </div>
                )}
                {contextLimit.mode === 'tokens' && (
                  <div className="card-row">
                    <span className="card-row-label">最大 Tokens</span>
                    <input className="form-input form-input-sm" type="number" value={contextLimit.maxTokens ?? 30000} onChange={(e) => setContextLimit({ maxTokens: Number(e.target.value) })} />
                  </div>
                )}
              </div>
            </Section>
            <Section title="工具">
              <div className="settings-card">
                <div className="card-row">
                  <span className="card-row-label">自动工具调用</span>
                  <label className="toggle">
                    <input type="checkbox" checked={autoTools !== false} onChange={(e) => setAutoTools(e.target.checked)} />
                    <span className="toggle-track" />
                  </label>
                </div>
                <div className="card-row">
                  <span className="card-row-label">搜索 Provider</span>
                  <select className="filter-select" value={searchConfig.provider || ''} onChange={(e) => setSearchConfig({ provider: e.target.value || null })}>
                    <option value="">未配置</option>
                    <option value="serper">Serper.dev</option>
                    <option value="tavily">Tavily</option>
                  </select>
                </div>
                {searchConfig.provider && (
                  <div className="form-row">
                    <label className="form-label">搜索 API Key</label>
                    <input className="form-input" type="password" value={searchConfig.apiKey || ''} onChange={(e) => setSearchConfig({ apiKey: e.target.value })} placeholder="API Key" />
                  </div>
                )}
              </div>
            </Section>
          </>
        )}

        {/* ── Appearance ───────────────────────────────────────── */}
        {tab === 'appearance' && (
          <Section title="主题">
            <div className="settings-card">
              <div className="theme-picker">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    className={'theme-option' + (( theme || 'default') === t.id ? ' active' : '')}
                    onClick={() => setTheme(t.id)}
                  >
                    <span className="theme-dot" style={{ background: t.color }} />
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* ── API Monitor ──────────────────────────────────────── */}
        {tab === 'monitor' && (
          <Section title="API 用量监控">
            <div className="settings-card">
              <div className="settings-card-title">本地统计（仅本设备）</div>
              <div className="card-row">
                <span className="card-row-label">总调用次数</span>
                <span className="monitor-value">{totalStats.calls}</span>
              </div>
              <div className="card-row">
                <span className="card-row-label">总 Token 用量</span>
                <span className="monitor-value">{totalStats.totalTokens.toLocaleString()}</span>
              </div>
              <div className="card-row">
                <span className="card-row-label">输入 Tokens</span>
                <span className="monitor-value">{totalStats.promptTokens.toLocaleString()}</span>
              </div>
              <div className="card-row">
                <span className="card-row-label">输出 Tokens</span>
                <span className="monitor-value">{totalStats.completionTokens.toLocaleString()}</span>
              </div>
            </div>
            {connections.length > 0 && (
              <div className="settings-card">
                <div className="settings-card-title">按连接统计</div>
                {connections.map((conn) => {
                  const s = tokenStats[conn.id]
                  if (!s) return null
                  return (
                    <div key={conn.id} className="monitor-conn-row">
                      <div className="monitor-conn-name">{conn.name}</div>
                      <div className="monitor-conn-stats">
                        {s.calls} 次 · {(s.totalTokens || 0).toLocaleString()} tokens
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>
        )}

      </div>
    </div>
  )
}
