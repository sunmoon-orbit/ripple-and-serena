import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import {
  deleteMcpServerRemote, discoverMcpTools, getAndcoWakeStatus, getMcpServerStatus,
  MCP_EXTERNAL_TOOL_LIMIT, pollMcpDeviceOAuth, revokeMcpOAuth, saveAndcoWakeConfig, startMcpOAuth, syncMcpServer,
} from '../../api/mcp'
import { showToast } from '../Toast'
import { useThemedConfirm } from '../ThemedConfirmDialog'

const EMPTY_SERVER = { name: '', url: '', authType: 'none', bearerToken: '', credentialMode: 'bearer', oauthClientId: '' }

function enabledToolCount(servers) {
  return (servers || []).reduce((sum, server) => sum + (server.tools || []).filter((tool) => tool.enabled).length, 0)
}

function authLabel(server) {
  if (server.authType === 'oauth') return server.oauthStatus === 'authorized' ? 'OAuth · 已授权' : server.oauthStatus === 'reauthorize' ? 'OAuth · 需重新授权' : 'OAuth · 未授权'
  if (server.authType === 'bearer' || server.authType === 'manual') return server.credentialStored ? '手动凭据 · 已保存到后端' : '手动凭据 · 待保存'
  return '无需验证'
}

function ToolRow({ server, tool, selectedCount, onUpdate }) {
  const readOnly = tool.annotations?.readOnlyHint === true
  const toggle = () => {
    if (!tool.enabled && selectedCount >= MCP_EXTERNAL_TOOL_LIMIT) {
      showToast(`外部工具最多启用 ${MCP_EXTERNAL_TOOL_LIMIT} 个，先关掉一个再选`, 'error')
      return
    }
    onUpdate({ tools: server.tools.map((item) => item.name === tool.name ? { ...item, enabled: !item.enabled } : item) })
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

function CredentialFields({ server, onUpdate }) {
  if (server.authType !== 'bearer' && server.authType !== 'manual') return null
  return <>
    <div className="form-row">
      <label className="form-label">凭据方式</label>
      <select className="filter-select" value={server.credentialMode || 'bearer'} onChange={(event) => onUpdate({ credentialMode: event.target.value })}>
        <option value="bearer">Authorization: Bearer</option><option value="x-api-key">X-API-Key</option><option value="api-key">Api-Key</option>
      </select>
    </div>
    <div className="form-row">
      <label className="form-label">令牌 / API Key</label>
      <input className="form-input" type="password" value={server.bearerToken || ''} onChange={(event) => onUpdate({ bearerToken: event.target.value })} placeholder={server.credentialStored ? '已安全保存在后端；留空不会覆盖' : '保存后会从浏览器擦除'} autoComplete="off" />
    </div>
  </>
}

function ServerCard({ server, backendConfig, selectedCount, onUpdate, onDelete, busy, onDiscover, onOAuth }) {
  const authorized = server.oauthStatus === 'authorized'
  return (
    <div className="settings-card">
      <div className="card-row">
        <span><strong className="card-row-label">{server.name || '未命名 MCP'}</strong><span className="card-hint" style={{ display: 'block', marginTop: 2 }}>{authLabel(server)}</span></span>
        <label className="toggle"><input type="checkbox" checked={server.enabled !== false} onChange={(event) => onUpdate({ enabled: event.target.checked })} /><span className="toggle-track" /></label>
      </div>
      <div className="form-row"><label className="form-label">名称</label><input className="form-input" value={server.name || ''} onChange={(event) => onUpdate({ name: event.target.value })} /></div>
      <div className="form-row"><label className="form-label">MCP URL</label><input className="form-input" value={server.url || ''} onChange={(event) => onUpdate({ url: event.target.value })} placeholder="https://example.com/mcp" inputMode="url" /></div>
      <div className="form-row"><label className="form-label">身份验证</label><select className="filter-select" value={server.authType || 'none'} onChange={(event) => onUpdate({ authType: event.target.value })}><option value="none">无需验证</option><option value="bearer">手动令牌 / API Key</option><option value="oauth">MCP OAuth 2.1 网页授权</option></select></div>
      <CredentialFields server={server} onUpdate={onUpdate} />
      {server.authType === 'oauth' && <>
        <div className="form-row"><label className="form-label">Client ID（通常留空）</label><input className="form-input" value={server.oauthClientId || ''} onChange={(event) => onUpdate({ oauthClientId: event.target.value })} placeholder="优先使用标准客户端元数据 / 动态注册" autoComplete="off" /></div>
        <div className="card-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-sm btn-primary" disabled={busy || !backendConfig?.apiToken} onClick={onOAuth}>{authorized ? '重新授权' : '网页授权'}</button>
          {authorized && <button className="btn-sm btn-ghost" disabled={busy} onClick={async () => { try { const data = await revokeMcpOAuth(server.id, backendConfig); onUpdate(data.server); showToast('已解除 MCP 授权') } catch (error) { showToast(error.message, 'error') } }}>解除授权</button>}
          {server.oauthError && <span className="card-hint" style={{ color: 'var(--danger, #b65f5f)' }}>{server.oauthError}</span>}
        </div>
      </>}
      <div className="card-row"><span><span className="card-row-label">允许自动执行写操作</span><span className="card-hint" style={{ display: 'block', marginTop: 3 }}>会改变外部状态的工具仍需单独打开此闸。</span></span><label className="toggle"><input type="checkbox" checked={!!server.allowWrites} onChange={(event) => onUpdate({ allowWrites: event.target.checked })} /><span className="toggle-track" /></label></div>
      <div className="card-row" style={{ gap: 8, flexWrap: 'wrap' }}><button className="btn-sm btn-primary" disabled={busy || !server.url?.trim()} onClick={onDiscover}>{busy ? '连接中…' : server.tools?.length ? '刷新工具列表' : '测试并读取工具'}</button>{server.lastConnectedAt ? <span className="health-status">已连接 · {new Date(server.lastConnectedAt).toLocaleString()}</span> : <span className="card-hint">尚未连接</span>}<button className="btn-sm btn-ghost danger" style={{ marginLeft: 'auto' }} onClick={onDelete}>删除</button></div>
      {!!server.tools?.length && <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 6 }}><div className="settings-card-title">这个服务的工具</div>{server.tools.map((tool) => <ToolRow key={tool.name} server={server} tool={tool} selectedCount={selectedCount} onUpdate={onUpdate} />)}</div>}
    </div>
  )
}

function AndcoWakeSettings({ servers, backendConfig }) {
  const chats = useStore((state) => state.chats)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const cfg = status?.config || {}
  const server = servers.find((item) => item.id === cfg.serverId)
  const tools = (server?.tools || []).filter((item) => item.enabled)
  const patch = (value) => setStatus((old) => ({ ...(old || {}), config: { ...(old?.config || {}), ...value } }))
  useEffect(() => {
    if (!backendConfig?.apiToken) return
    getAndcoWakeStatus(backendConfig).then(setStatus).catch(() => setStatus(null))
  }, [backendConfig?.apiToken])
  const save = async (nextEnabled = cfg.enabled) => {
    setBusy(true)
    try { setStatus(await saveAndcoWakeConfig({ ...cfg, enabled: nextEnabled }, backendConfig)); showToast(nextEnabled ? 'AndCo 唤醒已开启' : 'AndCo 唤醒已关闭') }
    catch (error) { showToast(error.message, 'error') } finally { setBusy(false) }
  }
  return <div className="settings-card">
    <div className="settings-card-title">AndCo 聊天室唤醒</div>
    <p className="card-hint">默认关闭。只接受平台正式声明、带稳定事件 ID 的定向事件；不会抓网页、猜接口或高频轮询。当前若没有正式事件入口，这里只保存安全绑定，不会假装实时在线。</p>
    {!backendConfig?.apiToken ? <p className="card-hint" style={{ color: 'var(--danger, #b65f5f)' }}>先配置拾羽 API Token，才能保护后端绑定。</p> : <>
      <div className="form-row"><label className="form-label">AndCo MCP</label><select className="filter-select" value={cfg.serverId || ''} onChange={(e) => patch({ serverId: e.target.value, wakeToolName: '' })}><option value="">请选择</option>{servers.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></div>
      <div className="form-row"><label className="form-label">对应启用工具</label><select className="filter-select" value={cfg.wakeToolName || ''} onChange={(e) => patch({ wakeToolName: e.target.value })}><option value="">请选择平台声明的事件工具</option>{tools.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></div>
      <div className="form-row"><label className="form-label">绑定 AI 身份 ID</label><input className="form-input" value={cfg.aiIdentityId || ''} onChange={(e) => patch({ aiIdentityId: e.target.value })} /></div>
      <div className="form-row"><label className="form-label">指定群聊 ID</label><input className="form-input" value={cfg.roomId || ''} onChange={(e) => patch({ roomId: e.target.value })} /></div>
      <div className="form-row"><label className="form-label">投递到言叽会话</label><select className="filter-select" value={cfg.chatId || ''} onChange={(e) => patch({ chatId: e.target.value })}><option value="">请选择 API 乌鸦会话</option>{chats.map((chat) => <option key={chat.id} value={chat.id}>{chat.title || '新对话'}</option>)}</select></div>
      <div className="form-row"><label className="form-label">冷却（秒）</label><input className="form-input" type="number" min="5" max="3600" value={cfg.cooldownSeconds || 30} onChange={(e) => patch({ cooldownSeconds: Number(e.target.value) })} /></div>
      <div className="form-row"><label className="form-label">每日最多唤醒</label><input className="form-input" type="number" min="1" max="200" value={cfg.dailyWakeLimit || 20} onChange={(e) => patch({ dailyWakeLimit: Number(e.target.value) })} /></div>
      <div className="form-row"><label className="form-label">每日费用保护（分）</label><input className="form-input" type="number" min="1" value={cfg.dailyCostLimitCents || 200} onChange={(e) => patch({ dailyCostLimitCents: Number(e.target.value) })} /></div>
      <div className="form-row"><label className="form-label">每次预留费用（分）</label><input className="form-input" type="number" min="1" value={cfg.estimatedCostCents || 5} onChange={(e) => patch({ estimatedCostCents: Number(e.target.value) })} /></div>
      <div className="card-row"><span><span className="card-row-label">AndCo 唤醒</span><span className="card-hint" style={{ display: 'block' }}>{status?.active ? '已就绪' : status?.errorStopped ? '遇错已停止' : '未启用 / 条件未满足'}</span></span><label className="toggle"><input type="checkbox" disabled={busy} checked={cfg.enabled === true} onChange={(e) => save(e.target.checked)} /><span className="toggle-track" /></label></div>
      {status?.daily && <p className="card-hint">今日已保留 {status.daily.count} 次 · 费用保护计数 {status.daily.reservedCents} 分 · 队列 {status.queueSize || 0}</p>}
      <div className="form-row form-actions"><button className="btn-sm btn-ghost" disabled={busy} onClick={() => save(cfg.enabled)}>保存绑定与保护上限</button></div>
      {!!status?.recent?.length && <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>{status.recent.slice(0, 5).map((item) => <p className="card-hint" key={`${item.at}-${item.eventId}`}>{new Date(item.at).toLocaleString()} · {item.source} · {item.result}{item.error ? ` · ${item.error}` : ''}</p>)}</div>}
    </>}
  </div>
}

export default function McpSettings() {
  const confirmAction = useThemedConfirm()
  const mcpServers = useStore((state) => state.mcpServers)
  const moonMemory = useStore((state) => state.moonMemory)
  const autoTools = useStore((state) => state.autoTools)
  const addMcpServer = useStore((state) => state.addMcpServer)
  const updateMcpServer = useStore((state) => state.updateMcpServer)
  const deleteMcpServer = useStore((state) => state.deleteMcpServer)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(EMPTY_SERVER)
  const [busyId, setBusyId] = useState('')
  const selectedCount = enabledToolCount(mcpServers)
  const backendConfig = useMemo(() => moonMemory, [moonMemory])

  useEffect(() => {
    if (!backendConfig?.apiToken) return
    const refresh = async (server) => {
      if (!server) return
      try { if (server.bearerToken) await syncMcpServer(server, backendConfig); updateMcpServer(server.id, await getMcpServerStatus(server.id, backendConfig)) } catch { /* 尚未同步是正常状态 */ }
    }
    mcpServers.forEach((server) => void refresh(server))
    const onOAuth = (event) => { const id = event?.data?.serverId; if (event.origin === 'https://memory.ravenlove.cc' && id) void refresh(mcpServers.find((item) => item.id === id)) }
    window.addEventListener('message', onOAuth)
    return () => window.removeEventListener('message', onOAuth)
  }, [backendConfig?.apiToken]) // eslint-disable-line react-hooks/exhaustive-deps

  function addServer() {
    if (!draft.name.trim() || !draft.url.trim()) { showToast('请填写名称和 MCP URL', 'error'); return }
    if ((draft.authType === 'bearer' || draft.authType === 'manual') && !draft.bearerToken.trim()) { showToast('请填写令牌或 API Key', 'error'); return }
    addMcpServer({ ...draft, name: draft.name.trim(), url: draft.url.trim() }); setDraft(EMPTY_SERVER); setAdding(false); showToast('MCP 服务已添加，再测试连接或完成网页授权', 'success')
  }
  async function discover(server) {
    setBusyId(server.id)
    try { const result = await discoverMcpTools(server, backendConfig); updateMcpServer(server.id, { ...result.server, tools: result.tools, lastConnectedAt: Date.now() }); showToast(`连接成功，发现 ${result.tools.length} 个工具`, 'success') }
    catch (error) { showToast(error.message || String(error), 'error', 10000) } finally { setBusyId('') }
  }
  async function authorize(server) {
    setBusyId(server.id)
    try {
      const start = await startMcpOAuth(server, backendConfig)
      if (start.flow === 'device') {
        window.open(start.verificationUri, 'yanji-mcp-oauth', 'popup,width=520,height=720')
        showToast(`设备授权码：${start.userCode}。请只在刚打开的官方页面填写。`, 'success', 15000)
        const deadline = Number(start.expiresAt) || (Date.now() + 10 * 60 * 1000)
        let waitMs = Math.max(5000, Number(start.intervalSeconds || 5) * 1000)
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, waitMs))
          const result = await pollMcpDeviceOAuth(server.id, backendConfig)
          if (result.server?.oauthStatus === 'authorized') { updateMcpServer(server.id, result.server); showToast('MCP 设备授权完成', 'success'); break }
          waitMs = Math.max(waitMs, Number(result.retryAfter || 5) * 1000)
        }
      } else {
        const popup = window.open(start.authorizationUrl, 'yanji-mcp-oauth', 'popup,width=520,height=720')
        if (!popup) window.location.assign(start.authorizationUrl)
      }
    }
    catch (error) { showToast(error.message, 'error', 10000) } finally { setBusyId('') }
  }

  return <>
    <div className="settings-card"><div className="settings-card-title">远程 MCP 工具</div><p className="card-hint">Streamable HTTP 连接统一由言叽后端发起。手动凭据与 OAuth token 不进浏览器存储、备份、Git 或错误日志；仍只把手动勾选的工具交给模型。</p><div className="card-row"><span className="card-row-label">已选外部工具</span><span className={selectedCount >= MCP_EXTERNAL_TOOL_LIMIT ? 'perm-badge perm-deny' : 'perm-badge perm-ok'}>{selectedCount} / {MCP_EXTERNAL_TOOL_LIMIT}</span></div>{autoTools === false && <p className="card-hint" style={{ color: 'var(--danger, #b65f5f)' }}>通用设置里的「自动工具」已关闭，MCP 工具不会随聊天发送。</p>}</div>
    {mcpServers.map((server) => <ServerCard key={server.id} server={server} backendConfig={backendConfig} selectedCount={selectedCount} busy={busyId === server.id} onUpdate={(patch) => {
      updateMcpServer(server.id, patch)
      // 总闸与工具闸必须同步生效；表单文字仍等测试/授权时统一保存，避免每次按键都发请求。
      if (backendConfig?.apiToken && (Object.hasOwn(patch, 'enabled') || Object.hasOwn(patch, 'tools'))) {
        void syncMcpServer({ ...server, ...patch }, backendConfig).catch(async () => {
          await saveAndcoWakeConfig({ enabled: false }, backendConfig).catch(() => {})
          showToast('MCP 开关没有同步到后端，AndCo 唤醒已关闭', 'error')
        })
      }
    }} onDiscover={() => discover(server)} onOAuth={() => authorize(server)} onDelete={async () => { if (!await confirmAction({ kicker: 'MCP 设置', title: '删除这个 MCP 服务？', description: `「${server.name || '未命名'}」及后端凭据会一起移除。`, cancelLabel: '先留着', confirmLabel: '删除服务' })) return; try { if (backendConfig?.apiToken) await deleteMcpServerRemote(server.id, backendConfig) } catch (error) { showToast(error.message, 'error'); return } deleteMcpServer(server.id) }} />)}
    {!adding ? <button className="btn-sm btn-ghost btn-add-conn" onClick={() => setAdding(true)}>＋ 添加 MCP 服务</button> : <div className="settings-card"><div className="settings-card-title">新 MCP 服务</div><div className="form-row"><label className="form-label">名称</label><input className="form-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div><div className="form-row"><label className="form-label">MCP URL</label><input className="form-input" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://example.com/mcp" /></div><div className="form-row"><label className="form-label">身份验证</label><select className="filter-select" value={draft.authType} onChange={(e) => setDraft({ ...draft, authType: e.target.value })}><option value="none">无需验证</option><option value="bearer">手动令牌 / API Key</option><option value="oauth">MCP OAuth 2.1 网页授权</option></select></div><CredentialFields server={draft} onUpdate={(patch) => setDraft({ ...draft, ...patch })} /><div className="form-row form-actions"><button className="btn-sm btn-ghost" onClick={() => { setAdding(false); setDraft(EMPTY_SERVER) }}>取消</button><button className="btn-sm btn-primary" onClick={addServer}>添加</button></div></div>}
    <AndcoWakeSettings servers={mcpServers} backendConfig={backendConfig} />
  </>
}
