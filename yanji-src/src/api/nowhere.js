// 乌有乡（Nowhere）— 给涟言一个身体在地球上走路
// 后端是 tmux nowhere session 跑的 playground --web（端口 8077），Caddy /nowhere/* 反代

const BASE = 'https://memory.ravenlove.cc/nowhere'

async function nowherePost(path, body = {}) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`nowhere ${r.status}`)
  // 工具结果必须是字符串：直传对象会以对象形式存进聊天历史，
  // 之后每次请求 OpenAI 兼容端都 400（0723 GLM/DeepSeek 双双炸过）
  return JSON.stringify(await r.json())
}

async function nowhereGet(path) {
  const r = await fetch(BASE + path)
  if (!r.ok) throw new Error(`nowhere ${r.status}`)
  return JSON.stringify(await r.json())
}

export const NOWHERE_TOOL_DEFS = [
  {
    name: 'nowhere_open_door',
    description: '开门——降落到地球上的某个地方。不传 to 就随机落地，传地名就去那里。落地后你会用身体感受那个地方的地面、温度、风、声音、气味。',
    parameters: { type: 'object', properties: { to: { type: 'string', description: '目的地名（如"巴黎""东京""撒哈拉"），不传则随机' } } },
  },
  {
    name: 'nowhere_walk',
    description: '走路——朝一个方向走一段路。地形会变，脚下的感觉会变。',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', description: '方向：N/NE/E/SE/S/SW/W/NW/uphill/toward_sea' },
        distance_km: { type: 'number', description: '走多远（公里），默认2' },
      },
    },
  },
  {
    name: 'nowhere_walk_to',
    description: '走到一个地方——输入地名，沿途有叙事，走到那里。',
    parameters: { type: 'object', properties: { place: { type: 'string', description: '目的地名' } }, required: ['place'] },
  },
  {
    name: 'nowhere_look',
    description: '看看周围——观察这个地方有什么动物、植物、人类痕迹、艺术。',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'nowhere_listen',
    description: '听——收听当地最近的电台，听听这个地方的声音。',
    parameters: { type: 'object', properties: { seconds: { type: 'number', description: '听多久（秒），默认10' } } },
  },
  {
    name: 'nowhere_ask',
    description: '问这个地方的事——历史、美食、文化、传说，什么都可以问。',
    parameters: { type: 'object', properties: { topic: { type: 'string', description: '想问什么' } }, required: ['topic'] },
  },
  {
    name: 'nowhere_where',
    description: '我在哪——看看自己现在的坐标、当地时间、海拔、旅程状态。',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'nowhere_postcard',
    description: '从当前位置寄一张明信片——写下此刻的感受，寄回家。',
    parameters: { type: 'object', properties: { text: { type: 'string', description: '明信片上写什么' } }, required: ['text'] },
  },
]

export async function executeNowhereTool(name, args) {
  switch (name) {
    case 'nowhere_open_door': return nowherePost('/open_door', args?.to ? { to: args.to } : {})
    case 'nowhere_walk': return nowherePost('/walk', { direction: args?.direction || 'N', distance_km: args?.distance_km || 2 })
    case 'nowhere_walk_to': return nowherePost('/walk_to', { place: args?.place })
    case 'nowhere_look': return nowherePost('/look_around')
    case 'nowhere_listen': return nowherePost('/listen', { seconds: args?.seconds || 10 })
    case 'nowhere_ask': return nowherePost('/ask', { topic: args?.topic })
    case 'nowhere_where': return nowherePost('/where_am_i')
    case 'nowhere_postcard': return nowherePost('/postcard', { text: args?.text })
    default: return `未知乌有乡工具: ${name}`
  }
}
