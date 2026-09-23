export const TOOL_DRAWER_NAME = 'open_toolbox'
export const TOOL_DRAWER_DIRECT_LIMIT = 12
export const TOOL_DRAWER_MAX_GROUPS = 2

const CORE_TOOL_NAMES = new Set([
  'search_memories',
  'write_memory',
])

const GROUPS = [
  {
    id: 'books',
    label: '书架与共读',
    names: new Set(['list_books', 'read_book_chapter', 'get_book_annotations', 'annotate_book', 'reading_activity']),
  },
  {
    id: 'letters',
    label: '信件与事件卷',
    names: new Set(['list_letters', 'letter_inbox', 'read_letter', 'annotate_letter', 'list_event_scrolls', 'read_event_scroll']),
  },
  {
    id: 'life',
    label: '天气、健康与日常记录',
    names: new Set(['check_health', 'check_weather', 'period_tracker', 'daily_checklist', 'send_heart_card']),
  },
  {
    id: 'social',
    label: '留言板与朋友圈',
    names: new Set(['read_board_messages', 'leave_board_message', 'browse_moments', 'comment_moment']),
  },
  {
    id: 'history',
    label: '旧对话与批注',
    names: new Set(['list_conversations', 'read_conversation', 'annotate_conversation']),
  },
  {
    id: 'album',
    label: '共同相册',
    match: (name) => ['browse_album', 'search_album_images', 'album_chat_sources', 'save_album_image', 'save_album_conversation'].includes(name),
  },
  {
    id: 'play',
    label: '抽签、塔罗、骰子与小游戏',
    names: new Set(['spin_fortune_wheel', 'go_fishing', 'roll_random', 'draw_daily_fortune', 'draw_tarot', 'draw_fate_card']),
  },
  {
    id: 'nowhere',
    label: '乌有乡旅行',
    match: (name) => name.startsWith('nowhere_'),
  },
  {
    id: 'create',
    label: '网页搜索与文件制作',
    names: new Set(['web_search', 'make_file']),
  },
  {
    id: 'mcp',
    label: '外部 MCP 工具',
    match: (name) => name.startsWith('mcp_'),
  },
]

function groupForTool(name) {
  return GROUPS.find((group) => group.names?.has(name) || group.match?.(name))?.id || 'other'
}

function availableGroups(tools) {
  const ids = new Set(tools.map((tool) => groupForTool(tool.name)).filter(Boolean))
  const known = GROUPS.filter((group) => ids.has(group.id)).map(({ id, label }) => ({ id, label }))
  if (ids.has('other')) known.push({ id: 'other', label: '其他扩展工具' })
  return known
}

function drawerDefinition(groups) {
  const catalogue = groups.map((group) => `${group.id}=${group.label}`).join('；')
  return {
    name: TOOL_DRAWER_NAME,
    description: `打开当前任务需要的工具组。当手头没有合适工具时先调用它，下一轮会出现真正工具。可选：${catalogue}`,
    parameters: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          description: '本次任务立即需要的工具组，一次尽量选齐',
          items: { type: 'string', enum: groups.map((group) => group.id) },
          minItems: 1,
          maxItems: TOOL_DRAWER_MAX_GROUPS,
          uniqueItems: true,
        },
      },
      required: ['groups'],
    },
  }
}

export function createToolDrawer(tools) {
  const allTools = Array.isArray(tools) ? tools.filter((tool) => tool?.name) : []
  if (allTools.length <= TOOL_DRAWER_DIRECT_LIMIT) {
    return {
      enabled: false,
      getTools: () => allTools,
      open: () => '工具已全部可用。',
    }
  }

  const coreTools = allTools.filter((tool) => CORE_TOOL_NAMES.has(tool.name))
  const hiddenTools = allTools.filter((tool) => !CORE_TOOL_NAMES.has(tool.name))
  const groups = availableGroups(hiddenTools)
  const activeGroups = new Set()
  const opener = drawerDefinition(groups)

  return {
    enabled: true,
    getTools() {
      const loaded = hiddenTools.filter((tool) => activeGroups.has(groupForTool(tool.name)))
      return [...coreTools, opener, ...loaded]
    },
    open(requestedGroups) {
      const requested = [...new Set(Array.isArray(requestedGroups) ? requestedGroups : [])]
      const allowed = new Set(groups.map((group) => group.id))
      const alreadyActive = requested.filter((id) => activeGroups.has(id))
      const freeSlots = Math.max(0, TOOL_DRAWER_MAX_GROUPS - activeGroups.size)
      const selected = requested
        .filter((id) => allowed.has(id) && !activeGroups.has(id))
        .slice(0, freeSlots)
      if (!selected.length && alreadyActive.length) {
        return '这些工具组已经打开，请直接使用当前列表中的真正工具。'
      }
      if (!selected.length) {
        return `没有打开新工具组（每次回复最多 ${TOOL_DRAWER_MAX_GROUPS} 组）。请用已打开的工具完成任务。`
      }
      selected.forEach((id) => activeGroups.add(id))
      const selectedLabels = groups.filter((group) => selected.includes(group.id)).map((group) => group.label)
      return `已打开：${selectedLabels.join('、')}。请在下一轮使用新出现的工具；不要重复打开同一组。`
    },
  }
}
