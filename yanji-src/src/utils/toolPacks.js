// 按用途给一个 MCP 服务的工具分包（1013）。点子来自 3265807971-cloud/mcp-toolpacks（MIT）：
// 工具是按「谁提供的」打包的，可人想的是「我现在要干什么」。这里只做最轻的一版：
// 按工具名里的词归包，一包一个开关。包「开没开」是从成员现算出来的，不另存，
// 所以不会出现开关说开了、实际没开的情况。认不出的归「其他」，不猜。
const PACKS = [
  { id: 'album', title: '相册', test: /album/ },
  { id: 'journal', title: '日记和信', test: /journal|letter|board|heart_card/ },
  { id: 'books', title: '共读', test: /book|reading/ },
  { id: 'health', title: '健康和经期', test: /health|period|vitals|sleep/ },
  { id: 'memory', title: '记忆', test: /memor|semantic_search|archive|event_scroll|window_boot|consolidation|get_stats/ },
  { id: 'toys', title: '小玩意', test: /tarot|weather|anniversar|current_time|dice|fish|lottery/ },
]

export function groupTools(tools = []) {
  const buckets = new Map(PACKS.map((pack) => [pack.id, { id: pack.id, title: pack.title, names: [] }]))
  const rest = { id: 'other', title: '其他', names: [] }
  for (const tool of tools) {
    const name = String(tool?.name || '')
    if (!name) continue
    const pack = PACKS.find((item) => item.test.test(name.toLowerCase()))
    ;(pack ? buckets.get(pack.id) : rest).names.push(name)
  }
  const groups = [...buckets.values(), rest].filter((group) => group.names.length)
  // 只分出一包（或全进了「其他」）就等于没分，不显示
  return groups.filter((group) => group.id !== 'other').length >= 2 ? groups : []
}

// 一包里开着几个；全开才算这包开着
export function packState(tools = [], names = []) {
  const wanted = new Set(names)
  const on = tools.filter((tool) => wanted.has(tool.name) && tool.enabled).length
  return { on, total: names.length, open: names.length > 0 && on === names.length }
}

// 拨一包：全开着就整包关；否则把没开的补开。超过名额就原样返回并说差几个，一个都不动。
export function togglePack(tools = [], names = [], { selectedCount = 0, limit = Infinity, serverEnabled = true } = {}) {
  const wanted = new Set(names)
  const { on, total, open } = packState(tools, names)
  if (open) return { tools: tools.map((tool) => wanted.has(tool.name) ? { ...tool, enabled: false } : tool), blocked: 0 }
  const adding = total - on
  const over = serverEnabled ? selectedCount + adding - limit : 0
  if (over > 0) return { tools, blocked: over }
  return { tools: tools.map((tool) => wanted.has(tool.name) ? { ...tool, enabled: true } : tool), blocked: 0 }
}
