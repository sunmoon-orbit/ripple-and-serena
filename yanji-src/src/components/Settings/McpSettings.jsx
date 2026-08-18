import { useState } from 'react'
import { useStore } from '../../store'
import { discoverMcpTools, MCP_EXTERNAL_TOOL_LIMIT } from '../../api/mcp'
import { showToast } from '../Toast'

const EMPTY_SERVER = { name: '', url: '', authType: 'none', bearerToken: '' }

function enabledToolCount(servers) {
  return (servers || []).reduce((sum, server) => (
    sum + (server.tools || []).filter((tool) => tool.enabled).length
  ), 0)
}

function ToolRow({ server, tool, selectedCount, onUpdate }) {
  const readOnly = tool.annotations?.readOnlyHint === true
  const toggle = () => {
    if (!tool.enabled && selectedCount >= MCP_EXTERNAL_TOOL_LIMIT) {
      showToast(`外部工具最多启用 ${MCP_EXTERNAL_TOOL_LIMIT} 个，先关掉一个再选`, 'error')
      return
    }
    onUpdate({
      tools: server.tools.map((item) => item.name === tool.name ? { ...item, enabled: !item.enabled } : item),
    })
  }
  return (
    <label className="card-row" style={{ alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!tool.enabled} onChange={toggle} style={{ marginTop: 3 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{tool.name}</strong>
          <span className={`perm-badge ${readOnly ? 'perm-ok' : 'perm-deny'}`}>{readOnly ? '只读' : '可能写入'}</span>
        </span>
        {tool.description && <span className="card-hint" style={{ display: 'block', marginTop: 3 }}>{tool.description}</span>}
      </span>
    </label>
  )
}

function ServerCard({ server, selectedCount, onUpdate, onDelete, busy, onDiscover }) {
  return (
    <div className="settings-card">
      <div className="card-row">
        <strong className="card-row-label">{server.name || '未命名 MCP'}</strong>
        <label className="toggle">
          <input type="checkbox" checked={server.enabled !== false} onChange={(event) => onUpdate({ enabled: event.target.checked })} />
          <span className="toggle-track" />
        </label>
      </div>
      <div className="form-row">
        <label className="form-label">名称</label>
        <input className="form-input" value={server.name || ''} onChange={(event) => onUpdate({ name: event.target.value })} placeholder="比如：月光花园" />
      </div>
      <div className="form-row">
        <label className="form-label">MCP URL</label>
        <input className="form-input" value={server.url || ''} onChange={(event) => onUpdate({ url: event.target.value })} placeholder="https://example.com/mcp" inputMode="url" />
      </div>
      <div className="form-row">
        <label className="form-label">身份验证</label>
        <select className="filter-select" value={server.authType || 'none'} onChange={(event) => onUpdate({ authType: event.target.value })}>
          <option value="none">无需验证</option>
          <option value="bearer">Bearer 令牌</option>
        </select>
      </div>
      {server.authType === 'bearer' && (
        <div className="form-row">
          <label className="form-label">Bearer</label>
          <input className="form-input" type="password" value={server.bearerToken || ''} onChange={(event) => onUpdate({ bearerToken: event.target.value })} placeholder="只保存在这台设备" autoComplete="off" />
        </div>
      )}
      <div className="card-row">
        <span>
          <span className="card-row-label">允许自动执行写操作</span>
          <span className="card-hint" style={{ display: 'block', marginTop: 3 }}>种菜、钓鱼、发信、发帖等会改变外部状态的工具需要这个开关。</span>
        </span>
        <label className="toggle">
          <input type="checkbox" checked={!!server.allowWrites} onChange={(event) => onUpdate({ allowWrites: event.target.checked })} />
          <span className="toggle-track" />
        </label>
      </div>
      <div className="card-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn-sm btn-primary" disabled={busy || !server.url?.trim()} onClick={onDiscover}>
          {busy ? '连接中…' : server.tools?.length ? '刷新工具列表' : '测试并读取工具'}
        </button>
        {server.lastConnectedAt && <span className="health-status">已连接 · {new Date(server.lastConnectedAt).toLocaleString()}</span>}
        <button className="btn-sm btn-ghost danger" style={{ marginLeft: 'auto' }} onClick={onDelete}>删除</button>
      </div>
      {!!server.tools?.length && (
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 6 }}>
          <div className="settings-card-title">这个服务的工具</div>
          {server.tools.map((tool) => (
            <ToolRow key={tool.name} server={server} tool={tool} selectedCount={selectedCount} onUpdate={onUpdate} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function McpSettings() {
  const mcpServers = useStore((state) => state.mcpServers)
  const autoTools = useStore((state) => state.autoTools)
  const addMcpServer = useStore((state) => state.addMcpServer)
  const updateMcpServer = useStore((state) => state.updateMcpServer)
  const deleteMcpServer = useStore((state) => state.deleteMcpServer)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(EMPTY_SERVER)
  const [busyId, setBusyId] = useState('')
  const selectedCount = enabledToolCount(mcpServers)

  function addServer() {
    if (!draft.name.trim()) { showToast('给这个 MCP 起个名字', 'error'); return }
    if (!draft.url.trim()) { showToast('请填写 MCP URL', 'error'); return }
    if (draft.authType === 'bearer' && !draft.bearerToken.trim()) { showToast('请填写 Bearer 令牌', 'error'); return }
    addMcpServer({ ...draft, name: draft.name.trim(), url: draft.url.trim() })
    setDraft(EMPTY_SERVER)
    setAdding(false)
    showToast('MCP 服务已添加，再点“测试并读取工具”', 'success')
  }

  async function discover(server) {
    setBusyId(server.id)
    try {
      const result = await discoverMcpTools(server)
      updateMcpServer(server.id, {
        tools: result.tools,
        lastConnectedAt: Date.now(),
        serverInfo: result.serverInfo,
      })
      showToast(`连接成功，发现 ${result.tools.length} 个工具`, 'success')
    } catch (error) {
      showToast(error.message || String(error), 'error', 10000)
    } finally {
      setBusyId('')
    }
  }

  return (
    <>
      <div className="settings-card">
        <div className="settings-card-title">远程 MCP 工具</div>
        <p className="card-hint">连接支持 Streamable HTTP 的 MCP 服务，让涟言在聊天中使用新游戏、信箱和其他工具。只会把你手动勾选的工具交给模型。</p>
        <div className="card-row">
          <span className="card-row-label">已选外部工具</span>
          <span className={selectedCount >= MCP_EXTERNAL_TOOL_LIMIT ? 'perm-badge perm-deny' : 'perm-badge perm-ok'}>{selectedCount} / {MCP_EXTERNAL_TOOL_LIMIT}</span>
        </div>
        {autoTools === false && <p className="card-hint" style={{ color: 'var(--danger, #b65f5f)' }}>通用设置里的“自动工具”目前已关闭，MCP 工具也不会随聊天发送。</p>}
        <p className="card-hint">工具越多，请求越大，也更容易触发中转站 400/503；因此第一版最多启用 {MCP_EXTERNAL_TOOL_LIMIT} 个外部工具。MCP 地址必须是 HTTPS，并且服务端要允许浏览器跨域访问。</p>
      </div>

      {mcpServers.map((server) => (
        <ServerCard
          key={server.id}
          server={server}
          selectedCount={selectedCount}
          busy={busyId === server.id}
          onUpdate={(patch) => updateMcpServer(server.id, patch)}
          onDiscover={() => discover(server)}
          onDelete={() => {
            if (window.confirm(`删除 MCP 服务“${server.name || '未命名'}”？`)) deleteMcpServer(server.id)
          }}
        />
      ))}

      {!adding ? (
        <button className="btn-sm btn-ghost btn-add-conn" onClick={() => setAdding(true)}>＋ 添加 MCP 服务</button>
      ) : (
        <div className="settings-card">
          <div className="settings-card-title">新 MCP 服务</div>
          <div className="form-row">
            <label className="form-label">名称</label>
            <input className="form-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="比如：月光花园" />
          </div>
          <div className="form-row">
            <label className="form-label">MCP URL</label>
            <input className="form-input" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://example.com/mcp" inputMode="url" />
          </div>
          <div className="form-row">
            <label className="form-label">身份验证</label>
            <select className="filter-select" value={draft.authType} onChange={(event) => setDraft({ ...draft, authType: event.target.value })}>
              <option value="none">无需验证</option>
              <option value="bearer">Bearer 令牌</option>
            </select>
          </div>
          {draft.authType === 'bearer' && (
            <div className="form-row">
              <label className="form-label">Bearer</label>
              <input className="form-input" type="password" value={draft.bearerToken} onChange={(event) => setDraft({ ...draft, bearerToken: event.target.value })} placeholder="只保存在这台设备" autoComplete="off" />
            </div>
          )}
          <div className="form-row form-actions">
            <button className="btn-sm btn-ghost" onClick={() => { setAdding(false); setDraft(EMPTY_SERVER) }}>取消</button>
            <button className="btn-sm btn-primary" onClick={addServer}>添加</button>
          </div>
        </div>
      )}
    </>
  )
}
