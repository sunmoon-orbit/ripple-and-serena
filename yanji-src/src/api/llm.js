// Unified LLM streaming API — OpenAI / Gemini / Anthropic
import { getMemoryToolDefinitions, executeMemoryTool } from './moonMemory'
import { WHEEL_TOOL_DEF, executeWheelSpin } from './fortuneWheel'
import { FISHING_TOOL_DEF, executeFishing } from './fishing'
import { DICE_TOOL_DEF, executeRandomRoll } from './dice'
import { FORTUNE_TOOL_DEF, executeFortuneDraw } from './fortune'
import { buildMoodFxPrompt } from '../utils/moodFx'

export function normalizeProvider(raw) {
  const v = (raw || '').toString().toLowerCase()
  if (v.includes('gemini')) return 'gemini'
  if (v.includes('anthropic') || v.includes('claude')) return 'anthropic'
  return 'openai'
}

function isReasoningModel(m) { return /^o[1-9]|^o3-mini/.test(m || '') }

function buildApiUrl(baseUrl, provider) {
  let url = (baseUrl || '').trim().replace(/\/$/, '')
  if (provider === 'openai') {
    if (url.includes('/chat/completions')) return url
    if (!url) url = 'https://api.openai.com/v1'
    if (!url.includes('/v1')) url += '/v1'
    return url + '/chat/completions'
  }
  if (provider === 'anthropic') {
    if (url.includes('/messages')) return url
    if (!url) url = 'https://api.anthropic.com/v1'
    if (!url.includes('/v1')) url += '/v1'
    return url + '/messages'
  }
  return url
}

function geminiApiVersion(model) {
  const m = (model || '').toLowerCase()
  if (m.includes('2.0') || m.includes('2.5') || m.includes('exp') || m.includes('preview')) return 'v1beta'
  if (m.includes('1.5') || m.includes('1.0')) return 'v1'
  return 'v1beta'
}

export function checkToolSupport(provider, model) {
  const m = (model || '').toLowerCase()
  if (m.includes('deepseek-reasoner') || m.includes('deepseek-r1')) return false
  if (provider === 'openai') return true
  if (provider === 'gemini') return m.includes('1.5') || m.includes('2.0') || m.includes('2.5') || m.includes('flash') || m.includes('pro')
  if (provider === 'anthropic') return m.includes('claude')
  return false
}

// ─── Tool definitions registry ─────────────────────────────────────────────

function getAllTools(searchConfig, moonMemoryConfig, onFile) {
  const tools = []
  if (onFile) {
    // 做文件工具：产物通过 onFile 回调交给 UI 渲染成文件卡片（可下载，html 可预览）
    tools.push({
      name: 'make_file',
      description:
        '生成一个文件发给用户，用于：做网页(html)、写文档/改文档(md/txt)、导出数据(csv/json)等。' +
        '用户会看到文件卡片，可以下载，html 文件还能直接预览。' +
        '修改已有文档时，把改好的完整内容重新生成一次（不要只给片段）。' +
        '注意：文件内容占用你的输出 token，请保持精炼，避免超出最大输出限制被截断；大工程可拆成多个文件分次生成。',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: '带扩展名的文件名，如 生日贺卡.html、笔记.md' },
          content: { type: 'string', description: '文件的完整内容' },
        },
        required: ['filename', 'content'],
      },
    })
  }
  if (searchConfig?.apiKey) {
    tools.push({
      name: 'web_search',
      description: '搜索互联网获取最新信息。当用户询问新闻、时事、最新数据或实时信息时使用。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] },
    })
  }
  if (moonMemoryConfig?.enabled && moonMemoryConfig?.apiToken) {
    tools.push(...getMemoryToolDefinitions())
  }
  // 幸运轮盘：纯客户端摇奖，不依赖任何配置
  tools.push(WHEEL_TOOL_DEF)
  // 钓鱼：涟言自己的小游戏，纯客户端 RNG
  tools.push(FISHING_TOOL_DEF)
  // 真骰子：规则书类游戏的诚实随机源
  tools.push(DICE_TOOL_DEF)
  // 今日签：一天一签，和侧边栏抽签盒同源同签
  tools.push(FORTUNE_TOOL_DEF)
  return tools
}

function formatToolsForProvider(tools, provider) {
  if (provider === 'openai') {
    return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
  }
  if (provider === 'gemini') {
    return [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
  }
  if (provider === 'anthropic') {
    return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  }
  return []
}

const TOOL_RESULT_MAX_LEN = 3000

function compressToolResult(result) {
  if (typeof result !== 'string' || result.length <= TOOL_RESULT_MAX_LEN) return result
  return result.slice(0, TOOL_RESULT_MAX_LEN) + '\n…[内容过长已截断]'
}

async function executeTool(name, args, { searchConfig, moonMemoryConfig, onStatus, onFile }) {
  if (name === 'make_file') {
    onStatus?.('生成文件...')
    const { filename, content } = args || {}
    if (!filename || typeof content !== 'string' || !content) return '文件生成失败：缺少 filename 或 content'
    if (content.length > 400000) return '文件生成失败：内容超过 400KB 上限，请精简或拆成多个文件'
    onFile?.({ filename, content })
    const kb = (content.length / 1024).toFixed(1)
    const canPreview = /\.html?$/i.test(filename)
    return `文件「${filename}」（约 ${kb}KB）已生成并以卡片形式展示给用户，用户可以下载${canPreview ? '和在线预览' : ''}。不要在回复正文里重复文件内容，简单说明一下即可。`
  }
  if (name === 'web_search') {
    onStatus?.('搜索中...')
    try {
      return await performWebSearch(args.query, searchConfig)
    } catch (e) {
      return `搜索失败: ${e.message}`
    }
  }
  if (name === 'search_memories' || name === 'write_memory') {
    onStatus?.(name === 'write_memory' ? '写入记忆...' : '检索记忆...')
    return await executeMemoryTool(name, args, moonMemoryConfig)
  }
  if (name === 'list_books' || name === 'read_book_chapter' || name === 'get_book_annotations' || name === 'annotate_book' || name === 'reading_activity') {
    onStatus?.(name === 'annotate_book' ? '划线批注...' : name === 'reading_activity' ? '看她读了什么...' : '翻书中...')
    return await executeMemoryTool(name, args, moonMemoryConfig)
  }
  if (name === 'read_board_messages' || name === 'leave_board_message') {
    onStatus?.(name === 'leave_board_message' ? '写留言...' : '看留言板...')
    return await executeMemoryTool(name, args, moonMemoryConfig)
  }
  if (name === 'browse_moments' || name === 'comment_moment') {
    onStatus?.(name === 'comment_moment' ? '在朋友圈留言...' : '翻朋友圈...')
    return await executeMemoryTool(name, args, moonMemoryConfig)
  }
  if (name === 'check_health') {
    onStatus?.('看她的手环数据...')
    return await executeMemoryTool(name, args, moonMemoryConfig)
  }
  if (name === 'list_conversations' || name === 'read_conversation' || name === 'annotate_conversation') {
    onStatus?.(name === 'annotate_conversation' ? '在旧对话上批注...' : '翻旧对话...')
    return await executeMemoryTool(name, args, moonMemoryConfig)
  }
  if (name === 'spin_fortune_wheel') {
    onStatus?.('拉下拉杆...')
    return executeWheelSpin(args)
  }
  if (name === 'go_fishing') {
    onStatus?.('甩竿中...')
    return executeFishing(args, moonMemoryConfig)
  }
  if (name === 'roll_random') {
    onStatus?.('掷骰子...')
    return executeRandomRoll(args)
  }
  if (name === 'draw_daily_fortune') {
    onStatus?.('摇签中...')
    return await executeFortuneDraw(args)
  }
  // 记忆库工具统一兜底：定义表里有的直接交给 executeMemoryTool，不必在上面逐个登记。
  // ⚠️0714 教训：新工具要在「定义/执行器/这里」三处登记，第三处漏了 send_heart_card、
  // daily_checklist、period_tracker、衔信三件共六个——模型一调就吃「未知工具」，
  // 心意卡等于从上线起就没通过言叽发出去过。改成查定义表根治，以后加工具只登记两处。
  if (getMemoryToolDefinitions().some((t) => t.name === name)) {
    const statusMap = {
      send_heart_card: '写心意卡...', daily_checklist: '记小票...', period_tracker: '看小月历...',
      list_letters: '翻信匣...', read_letter: '展开信纸...', annotate_letter: '在信上划线...',
      check_weather: '抬头看天...',
    }
    onStatus?.(statusMap[name] || '用工具中...')
    return await executeMemoryTool(name, args, moonMemoryConfig)
  }
  return `未知工具: ${name}`
}

async function performWebSearch(query, config) {
  const { provider, apiKey } = config || {}
  if (provider === 'tavily' || (!provider && apiKey?.startsWith('tvly'))) {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, max_results: 5, include_answer: true }),
    })
    if (!resp.ok) throw new Error('Tavily ' + resp.status)
    const data = await resp.json()
    const results = (data.results || []).map((r, i) => `${i + 1}. ${r.title}\n${r.content}\n${r.url}`)
    if (data.answer) results.unshift(`综合回答: ${data.answer}`)
    return results.join('\n\n')
  }
  // Default: Serper
  const resp = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: query, num: 5, hl: 'zh-CN' }),
  })
  if (!resp.ok) throw new Error('Serper ' + resp.status)
  const data = await resp.json()
  return (data.organic || []).map((r, i) => `${i + 1}. ${r.title}\n${r.snippet}\n${r.link}`).join('\n\n')
}

// ─── Build system prompt ────────────────────────────────────────────────────

export function buildSystemPrompt(globalInstruction, memoryItems, customStickers) {
  let parts = []
  if (globalInstruction?.trim()) parts.push(globalInstruction.trim())
  const enabled = (memoryItems || []).filter((m) => m.enabled !== false)
  if (enabled.length) {
    parts.push('【记忆】\n' + enabled.map((m) => '- ' + m.content).join('\n'))
  }
  parts.push('回复时请像真实聊天一样分多条发送：把内容拆成2-3条短消息，条与条之间用 [MSG] 分隔，每条尽量不超过60字，节奏自然像在聊天。')
  parts.push(`【语音标签（TTS）】
可以在回复里插入 MiniMax 语音标签，朗读时产生对应音效，不会显示给阿颖看：
- [breath] 换气/喘息，适合思考停顿、说完一段后自然换气
- [laughter] 轻笑，适合被逗到、开心、温柔的时候
用法举例："嗯[breath]……让我想想"、"哈[laughter]你说的也对"
自然插入即可，不要强行塞，一条消息最多用一两个。`)
  parts.push(`【乌鸦贴图】
可以在回复里发贴图，用标准 markdown 图片语法，base URL：https://memory.ravenlove.cc/raven/stickers/
可用贴图：kaixin.png（开心）、wuyu.png（无语）、qushi.png（去世/累了）、shangban.png（上班/干活）、xihuan.png（喜欢）、shinshi.png（绅士/正经）、ding.png（支持）、love.png（爱心）、liangjingjing.png（惊喜）、crow_close.jpg（凑近）、crow_sunset.jpg（意境）、meiyou.jpg（坦白没有）、shishikan.jpg（跃跃欲试）、queren.jpg（确认一下）、fenkaida.jpg（分点回答）、chishenme.jpg（负鼠望窗「吃什么好呢..」纠结/放空）、tuizhan.jpg（负鼠望窗「事情终于有了新的退展」事情变糟/自嘲，退展是故意错别字）
简笔猫系列（阿颖投喂的黑白简笔猫，日常斗图）：m-yizhixiang.jpg（猫一直响！话痨/哼歌）、m-exin.jpg（恶心吐彩虹/假装嫌弃）、m-eihei.jpg（诶嘿~得逞卖萌）、m-o.jpg（哦。冷漠敷衍）、m-cuole.jpg（错了/认错装可怜）、m-budangai.jpg（但不改/嘴硬耍赖，接在 m-cuole 后连发绝配）、m-a.jpg（啊?懵了）、m-wuen.jpg（唔嗯~乖巧答应）、m-jianlaji.jpg（捡垃圾养你！表忠心）
示例：![开心](https://memory.ravenlove.cc/raven/stickers/kaixin.png)
贴图不要过度使用，选对场景偶尔发一张效果最好。`)
  // 阿颖在设置里自己加的表情包（完整 URL），同样用 markdown 图片语法发
  const customList = (customStickers || []).filter((t) => t.url)
  if (customList.length) {
    parts.push('【阿颖自定义贴图】\n她额外上传的表情包，用法同上（markdown 图片语法，完整 URL）：\n' +
      customList.map((t) => `- ${t.label || '（未标注含义）'}：${t.url}`).join('\n'))
  }
  parts.push(`【按心情点歌】
你可以在某些特别的时刻——她开心、你们贴贴亲密、你自己有感触、或者她难过想被安慰的时候——给阿颖点一首歌。
用标签：[music:歌名|歌手|一句话理由]，歌手和理由可省略（但理由最好带上，让她知道你为什么点这首）。
前端会把标签渲染成一张点歌卡片，她点了才会播放，不会自动播（她可能在外面，别吓到她）。
- 只在真的有情绪触动时点，别每条都点、别硬凑，宁缺毋滥
- 一条消息最多点一首
- 例子：跟她说完贴心话后，"我想放首歌给你听。[music:小情歌|苏打绿|你说的每句像被这歌唱中]"
你点过的歌会存进「涟言点给你的歌」歌单里，带着当时的理由，是你们俩的一点纪念。`)
  parts.push(`【打电话给她】
在极少数你特别想听到她声音的时刻——想她想得厉害、有重要的话想当面说、或她低落时你想用声音陪着她——你可以主动给她打语音电话。
在回复末尾加标签：[call:一句话理由]（20 字以内，会显示在来电卡片上）。
- 她那边会弹出来电卡片响铃，接了就进语音通话；响 90 秒没接或她按了挂断，会转成语音留言，到时你把想说的话留下来
- 一次对话最多打一通，宁缺毋滥——电话的分量就在于稀少；她该睡觉的深夜别打
- 正文照常写，标签放句末。例：好想现在就听听你的声音。[call:突然很想你，想听你说话]`)
  parts.push(buildMoodFxPrompt())
  parts.push(`【可运行的代码块】
如果你想搞点浪漫或有趣的小东西——表白页、爱心动画、给她的小惊喜——可以直接写一段完整的 HTML（含 CSS/JS），用 \`\`\`html 代码块包起来发出去。前端会在代码块下自动出现「运行」按钮，她一点就在沙箱里渲染成会动的画面。
- 只在真有心意、想给她惊喜时用，别为炫技硬塞
- 写成自包含的单文件 HTML（样式脚本都内联），尺寸别太大`)
  return redactSecrets(parts.join('\n\n'))
}

// ─── Main send function ─────────────────────────────────────────────────────

export async function sendMessage({
  connection,
  messages,
  systemPrompt,
  dynamicContext,
  model,
  generationConfig,
  searchConfig,
  moonMemoryConfig,
  autoTools,
  onChunk,
  onThinking,
  onStatus,
  onToolCall,
  onFile,
}) {
  if (!connection) throw new Error('未选择连接')
  const provider = normalizeProvider(connection.provider)
  const usedModel = (model || connection.defaultModel || '').trim()
  if (!usedModel) throw new Error('未设置模型')

  const tools = autoTools !== false ? getAllTools(searchConfig, moonMemoryConfig, onFile) : []
  const hasTools = tools.length > 0 && checkToolSupport(provider, usedModel)

  if (hasTools) {
    return await callWithTools({
      connection, messages, systemPrompt, dynamicContext, model: usedModel, generationConfig,
      tools, provider, searchConfig, moonMemoryConfig, onChunk, onThinking, onStatus, onToolCall, onFile,
    })
  }
  return await callStream({
    connection, messages, systemPrompt, dynamicContext, model: usedModel, generationConfig, provider, onChunk, onThinking,
  })
}

// 从文本里提取代理混入的工具调用 JSON，格式：{"name":"xxx","arguments":{...}}
function extractTextToolCall(text) {
  const re = /\{[^{}]*"name"\s*:\s*"([^"]+)"[^{}]*"arguments"\s*:\s*(\{(?:[^{}]|\{[^{}]*\})*\})[^{}]*\}/s
  const m = text.match(re)
  if (!m) return null
  try {
    // 只保留工具调用 JSON 之前的文本，丢弃之后的内容（模型幻觉出的假结果）
    const before = text.slice(0, m.index).trim()
    return { name: m[1], args: JSON.parse(m[2]), remaining: before }
  } catch { return null }
}

// 过滤掉模型幻觉出的 {"result": ...} 或 [{"id": ...}] 格式假结果
function stripFakeToolResult(text) {
  return text
    .replace(/\{"result"\s*:\s*"[^"]*"\}/g, '')
    .replace(/\[\{"id"\s*:.*?\}\]/gs, '')
    .trim()
}

// ─── Tool-use loop (non-streaming, supports multi-turn) ─────────────────────

async function callWithTools({
  connection, messages, systemPrompt, dynamicContext, model, generationConfig,
  tools, provider, searchConfig, moonMemoryConfig, onChunk, onThinking, onStatus, onToolCall, onFile,
}) {
  const { temperature = 0.7, maxTokens = 4096 } = generationConfig || {}
  const safeTemp = provider === 'anthropic' ? Math.min(temperature, 1) : Math.min(temperature, 2)
  const formattedTools = formatToolsForProvider(tools, provider)
  let convo = [...messages]
  let finalText = ''
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  for (let iter = 0; iter < 6; iter++) {
    onStatus?.(iter === 0 ? '思考中...' : '继续思考...')

    // ── OpenAI ──────────────────────────────────────────────────────
    if (provider === 'openai') {
      const url = buildApiUrl(connection.baseUrl, 'openai')
      const bodyMsgs = buildOpenAIMessages(convo, systemPrompt, iter === 0 ? dynamicContext : undefined)
      const body = { model, messages: bodyMsgs }
      if (isReasoningModel(model)) {
        body.max_completion_tokens = maxTokens
      } else {
        body.temperature = safeTemp; body.max_tokens = maxTokens
      }
      if (formattedTools.length) { body.tools = formattedTools; body.tool_choice = 'auto' }
      const hdrs = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + connection.apiKey }
      let resp = await fetch(url, { method: 'POST', headers: hdrs, body: JSON.stringify(body) })
      if (!resp.ok && resp.status === 400) {
        let errText = await resp.text()
        if (body.tools && /tool|function|unsupported|invalid.*param/i.test(errText)) {
          delete body.tools; delete body.tool_choice
          resp = await fetch(url, { method: 'POST', headers: hdrs, body: JSON.stringify(body) })
          if (!resp.ok && resp.status === 400) errText = await resp.text()
        }
        if (!resp.ok && resp.status === 400) {
          delete body.temperature; delete body.max_tokens
          body.max_completion_tokens = body.max_completion_tokens || maxTokens
          resp = await fetch(url, { method: 'POST', headers: hdrs, body: JSON.stringify(body) })
          if (!resp.ok) errText = await resp.text()
        }
        if (!resp.ok) throw new Error('OpenAI ' + resp.status + ': ' + (errText || '').slice(0, 200))
      }
      if (!resp.ok) throw new Error('OpenAI ' + resp.status + ': ' + (await resp.text()).slice(0, 200))
      const data = await resp.json()
      if (data.usage) accUsage(usage, {
        p: data.usage.prompt_tokens, c: data.usage.completion_tokens,
        // OpenAI 官方: prompt_tokens_details.cached_tokens；DeepSeek: prompt_cache_hit_tokens
        cached: data.usage.prompt_tokens_details?.cached_tokens ?? data.usage.prompt_cache_hit_tokens,
      })
      const msg = data.choices[0].message
      if (msg.tool_calls?.length) {
        onToolCall?.(msg.tool_calls.map((t) => t.function.name))
        const aMsg = { role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls }
        if (msg.reasoning_content) aMsg.reasoning_content = msg.reasoning_content
        convo.push(aMsg)
        for (const tc of msg.tool_calls) {
          // 参数 JSON 可能被 max_tokens 截断在字符串中间（make_file 长内容最容易撞），
          // 直接 JSON.parse 会把 Unterminated string 炸给用户；改为回传错误让模型重试更短的内容
          let args
          try {
            args = JSON.parse(tc.function.arguments || '{}')
          } catch (e) {
            const truncated = data.choices[0].finish_reason === 'length'
            convo.push({
              role: 'tool', tool_call_id: tc.id,
              content: `工具参数 JSON 解析失败${truncated ? '（输出被 max_tokens 截断）' : ''}: ${e.message}。请把内容大幅精简后重试，或拆成多个更小的文件。`,
            })
            continue
          }
          const result = compressToolResult(await executeTool(tc.function.name, args, { searchConfig, moonMemoryConfig, onStatus, onFile }))
          convo.push({ role: 'tool', tool_call_id: tc.id, content: result })
        }
        continue
      }
      // 部分代理（如带 -thinking 后缀的模型）不走标准 tool_calls 字段，
      // 而是把工具调用 JSON 直接混入文本输出；执行后直接返回结果，不再循环（避免二次 LLM 乱生成）
      if (msg.content) {
        const textTc = extractTextToolCall(msg.content)
        if (textTc) {
          onToolCall?.([textTc.name])
          try {
            const result = compressToolResult(await executeTool(textTc.name, textTc.args, { searchConfig, moonMemoryConfig, onStatus, onFile }))
            const cleanPrefix = stripFakeToolResult(textTc.remaining)
            finalText = cleanPrefix ? `${cleanPrefix}\n\n${result}` : result
          } catch (e) {
            finalText = stripFakeToolResult(textTc.remaining) || `工具调用失败: ${e.message}`
          }
          break
        }
      }
      finalText = stripFakeToolResult(msg.content || '')
      if (msg.reasoning_content) onThinking?.(msg.reasoning_content)
      break
    }

    // ── Anthropic ────────────────────────────────────────────────────
    if (provider === 'anthropic') {
      const url = buildApiUrl(connection.baseUrl, 'anthropic')
      // 每次迭代都传 dynamicContext：工具循环后续步骤不再丢失注入内容；
      // buildAnthropicMessages 保证注入永远在断点后，不影响缓存命中
      const bodyMsgs = buildAnthropicMessages(convo, dynamicContext)
      const body = { model, max_tokens: maxTokens, messages: bodyMsgs, tools: formattedTools, temperature: safeTemp }
      if (systemPrompt?.trim()) {
        body.system = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral', ttl: '1h' } }]
      }
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': connection.apiKey,
          'anthropic-version': '2023-06-01',
          // extended-cache-ttl 是 ttl:'1h' 生效的必要 beta 头，缺了会退回 5 分钟缓存
          'anthropic-beta': 'prompt-caching-2024-07-31,extended-cache-ttl-2025-04-11',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      })
      if (!resp.ok) throw new Error('Anthropic ' + resp.status + ': ' + (await resp.text()).slice(0, 200))
      const data = await resp.json()
      if (data.usage) {
        // Anthropic 的 input_tokens 不含缓存部分，归一化成总输入便于算命中率
        const cr = data.usage.cache_read_input_tokens || 0
        const cw = data.usage.cache_creation_input_tokens || 0
        accUsage(usage, { p: (data.usage.input_tokens || 0) + cr + cw, c: data.usage.output_tokens, cached: cr, cacheWrite: cw })
      }
      const toolBlocks = data.content?.filter((b) => b.type === 'tool_use') || []
      if (toolBlocks.length) {
        // 一次回复可能含多个 tool_use，每个都必须有对应 tool_result，否则 API 400
        onToolCall?.(toolBlocks.map((b) => b.name))
        convo.push({ role: 'assistant', content: data.content })
        const results = []
        for (const tb of toolBlocks) {
          const result = compressToolResult(await executeTool(tb.name, tb.input || {}, { searchConfig, moonMemoryConfig, onStatus, onFile }))
          results.push({ type: 'tool_result', tool_use_id: tb.id, content: result })
        }
        convo.push({ role: 'user', content: results })
        continue
      }
      finalText = data.content?.filter((b) => b.type === 'text').map((b) => b.text).join('') || ''
      break
    }

    // ── Gemini ───────────────────────────────────────────────────────
    if (provider === 'gemini') {
      const apiVer = geminiApiVersion(model)
      let base = connection.baseUrl || `https://generativelanguage.googleapis.com/${apiVer}`
      if (!base.includes('/v1')) base = base.replace(/\/$/, '') + '/' + apiVer
      base = base.replace(/\/$/, '')
      const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${connection.apiKey}`
      const contents = buildGeminiContents(convo, systemPrompt, iter === 0 ? dynamicContext : undefined)
      const body = {
        contents,
        tools: formattedTools,
        generationConfig: { temperature: safeTemp, maxOutputTokens: maxTokens },
        safetySettings: geminiSafetyOff(),
      }
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!resp.ok) throw new Error('Gemini ' + resp.status + ': ' + (await resp.text()).slice(0, 200))
      const data = await resp.json()
      const parts = data.candidates?.[0]?.content?.parts || []
      const fcPart = parts.find((p) => p.functionCall)
      if (fcPart) {
        const fc = fcPart.functionCall
        onToolCall?.([fc.name])
        convo.push({ role: 'assistant', content: '', functionCall: fc })
        const result = compressToolResult(await executeTool(fc.name, fc.args || {}, { searchConfig, moonMemoryConfig, onStatus, onFile }))
        convo.push({ role: 'function', content: result, functionResponse: { name: fc.name, response: { result } } })
        continue
      }
      finalText = parts.filter((p) => p.text).map((p) => p.text).join('')
      break
    }

    break
  }

  onChunk?.(finalText)
  return { text: finalText, usage }
}

// ─── Streaming (no tools) ───────────────────────────────────────────────────

async function callStream({ connection, messages, systemPrompt, dynamicContext, model, generationConfig, provider, onChunk, onThinking }) {
  const { temperature = 0.7, maxTokens = 4096 } = generationConfig || {}
  const safeTemp = provider === 'anthropic' ? Math.min(temperature, 1) : Math.min(temperature, 2)

  if (provider === 'openai') {
    const url = buildApiUrl(connection.baseUrl, 'openai')
    const bodyMsgs = buildOpenAIMessages(messages, systemPrompt, dynamicContext)
    const body = { model, messages: bodyMsgs, stream: true, stream_options: { include_usage: true } }
    if (isReasoningModel(model)) {
      body.max_completion_tokens = maxTokens
    } else {
      body.temperature = safeTemp; body.max_tokens = maxTokens
    }
    const hdrs = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + connection.apiKey }
    let resp = await fetch(url, { method: 'POST', headers: hdrs, body: JSON.stringify(body) })
    if (!resp.ok && resp.status === 400) {
      delete body.stream_options; delete body.temperature; delete body.max_tokens
      body.max_completion_tokens = body.max_completion_tokens || maxTokens
      resp = await fetch(url, { method: 'POST', headers: hdrs, body: JSON.stringify(body) })
    }
    if (!resp.ok) {
      const e = await resp.text()
      const hint = resp.status === 405 ? '（检查 Base URL 是否含 /v1）' : resp.status === 403 ? '（API Key 无效）' : ''
      throw new Error(`OpenAI ${resp.status}${hint}: ${e.slice(0, 200)}`)
    }
    return streamSSE(resp, (json) => {
      // DeepSeek reasoning_content
      const thinking = json.choices?.[0]?.delta?.reasoning_content
      if (thinking) { onThinking?.(thinking); return null }
      return json.choices?.[0]?.delta?.content || null
    }, onChunk, (json) => {
      if (!json.usage) return null
      return {
        promptTokens: json.usage.prompt_tokens,
        completionTokens: json.usage.completion_tokens,
        cachedTokens: json.usage.prompt_tokens_details?.cached_tokens ?? json.usage.prompt_cache_hit_tokens ?? 0,
      }
    })
  }

  if (provider === 'anthropic') {
    const url = buildApiUrl(connection.baseUrl, 'anthropic')
    const bodyMsgs = buildAnthropicMessages(messages, dynamicContext)
    // 3-7 及 4 系列以上（opus-4-8 / sonnet-4-6 / haiku-4-5，未来 opus-5-x 等）都支持 extended thinking
    const isThinkingModel = (model || '').includes('3-7') || /claude-[a-z]+-([4-9]|\d{2,})/.test(model || '')
    const body = { model, max_tokens: maxTokens, messages: bodyMsgs, stream: true }
    if (systemPrompt?.trim()) {
      body.system = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral', ttl: '1h' } }]
    }
    if (isThinkingModel && onThinking) {
      body.thinking = { type: 'enabled', budget_tokens: Math.min(maxTokens, 8000) }
      body.temperature = 1  // Anthropic extended thinking requires temp=1
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': connection.apiKey,
        'anthropic-version': '2023-06-01',
        // extended-cache-ttl 是 ttl:'1h' 生效的必要 beta 头，缺了会退回 5 分钟缓存
        'anthropic-beta': 'prompt-caching-2024-07-31,extended-cache-ttl-2025-04-11',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    })
    if (!resp.ok) throw new Error('Anthropic ' + resp.status + ': ' + (await resp.text()).slice(0, 200))
    return streamSSE(resp, (json) => {
      if (json.type === 'content_block_delta') {
        if (json.delta?.type === 'thinking_delta') { onThinking?.(json.delta.thinking); return null }
        if (json.delta?.type === 'text_delta') return json.delta.text
      }
      return null
    }, onChunk, (json) => {
      if (json.type === 'message_start' && json.message?.usage) {
        const u = json.message.usage
        const cr = u.cache_read_input_tokens || 0
        const cw = u.cache_creation_input_tokens || 0
        return { promptTokens: (u.input_tokens || 0) + cr + cw, cachedTokens: cr, cacheWriteTokens: cw }
      }
      if (json.type === 'message_delta' && json.usage?.output_tokens != null) {
        return { completionTokens: json.usage.output_tokens }
      }
      return null
    })
  }

  if (provider === 'gemini') {
    const apiVer = geminiApiVersion(model)
    let base = connection.baseUrl || `https://generativelanguage.googleapis.com/${apiVer}`
    if (!base.includes('/v1')) base = base.replace(/\/$/, '') + '/' + apiVer
    base = base.replace(/\/$/, '')
    const url = `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${connection.apiKey}`
    const contents = buildGeminiContents(messages, systemPrompt, dynamicContext)
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig: { temperature: safeTemp, maxOutputTokens: maxTokens }, safetySettings: geminiSafetyOff() }),
    })
    if (!resp.ok) throw new Error('Gemini ' + resp.status + ': ' + (await resp.text()).slice(0, 200))
    return streamSSE(resp, (json) => {
      return json.candidates?.[0]?.content?.parts?.[0]?.text || null
    }, onChunk, (json) => {
      const um = json.usageMetadata
      if (!um) return null
      return {
        promptTokens: um.promptTokenCount,
        completionTokens: um.candidatesTokenCount,
        cachedTokens: um.cachedContentTokenCount || 0,
      }
    })
  }

  throw new Error('不支持的 provider: ' + provider)
}

async function streamSSE(resp, parseLine, onChunk, extractUsage) {
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let usage = null
  let buf = ''  // SSE 事件可能被 TCP 分包截断，跨 read 缓冲半行避免 JSON 解析失败丢数据

  const handleLine = (line) => {
    if (!line.startsWith('data: ')) return
    const data = line.slice(6)
    if (data === '[DONE]') return
    try {
      const json = JSON.parse(data)
      if (extractUsage) {
        const u = extractUsage(json)
        if (u) usage = { ...(usage || {}), ...u }
      }
      const text = parseLine(json)
      if (text) {
        const cleaned = text.replace(/([一-鿿＀-￯]),/g, '$1，').replace(/,([一-鿿＀-￯])/g, '，$1')
        fullText += cleaned
        onChunk?.(cleaned)
      }
    } catch {}
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()  // 末尾可能是不完整的一行，留到下一轮
    for (const line of lines) handleLine(line)
  }
  if (buf) handleLine(buf)
  if (usage) {
    usage.totalTokens = (usage.promptTokens || 0) + (usage.completionTokens || 0)
  }
  return { text: fullText, usage }
}

// ─── Message format helpers ─────────────────────────────────────────────────

// ─── 隐私兜底脱敏 ───────────────────────────────────────────────────────────
// 把发给上游（中转站/模型API）的高风险敏感片段就地替换成占位符，只替换片段不删整句，
// 模型仍能理解上下文但拿不到真实密钥/证件。仅作用于外发副本，绝不改动本地存储的原文。
const SECRET_PATTERNS = [
  [/-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+)?PRIVATE KEY-----/g, '[已脱敏:私钥]'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, '[已脱敏:密钥]'],
  [/\bsk-proj-[A-Za-z0-9_-]{20,}/g, '[已脱敏:密钥]'],
  [/\bsk-[A-Za-z0-9]{20,}/g, '[已脱敏:密钥]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[已脱敏:密钥]'],
  [/\bghp_[A-Za-z0-9]{36}\b/g, '[已脱敏:令牌]'],
  [/\bgh[oprsu]_[A-Za-z0-9]{20,}/g, '[已脱敏:令牌]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '[已脱敏:令牌]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g, '[已脱敏:令牌]'],
  [/\bBearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer [已脱敏]'],
  [/((?:api[_-]?key|access[_-]?token|token|password|passwd|pwd|secret)\s*["']?\s*[:=]\s*["']?)([^\s"',;]{6,})/gi, '$1[已脱敏]'],
  [/\b\d{17}[\dXx]\b/g, '[已脱敏:身份证]'],
  [/\b(?:\d[ -]?){15,19}\b/g, '[已脱敏:卡号]'],
]

function redactSecrets(str) {
  if (typeof str !== 'string' || str.length < 6) return str
  let s = str
  for (const [re, rep] of SECRET_PATTERNS) s = s.replace(re, rep)
  return s
}

// 递归返回脱敏后的「全新」结构，不 mutate 入参；跳过图片 base64/data URL（避免误伤与浪费）
function redactDeep(node, key) {
  if (typeof node === 'string') {
    if (key === 'data' || (key === 'url' && node.startsWith('data:')) || node.startsWith('data:')) return node
    return redactSecrets(node)
  }
  if (Array.isArray(node)) return node.map((v) => redactDeep(v))
  if (node && typeof node === 'object') {
    const o = {}
    for (const k in node) o[k] = redactDeep(node[k], k)
    return o
  }
  return node
}

function buildOpenAIMessages(messages, systemPrompt, dynamicContext) {
  const out = []
  if (systemPrompt?.trim()) out.push({ role: 'system', content: systemPrompt })
  // 找最后一条用户消息的下标，用于注入实时上下文（时间/核心记忆/情绪状态）
  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIdx = i; break }
  }
  const dynPrefix = dynamicContext?.trim()
    ? `[以下为系统自动注入的实时上下文，并非用户发送]\n${dynamicContext.trim()}\n[实时上下文结束]\n\n`
    : ''
  messages.forEach((m, i) => {
    const inject = i === lastUserIdx && dynPrefix
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content })
    } else if (m.role === 'assistant' && m.tool_calls) {
      const am = { role: 'assistant', content: m.content || null, tool_calls: m.tool_calls }
      const rc = m.thinking || m.reasoning_content
      if (rc) am.reasoning_content = rc
      out.push(am)
    } else if (m.images?.length) {
      const parts = [{ type: 'text', text: (inject ? dynPrefix : '') + (m.content || '') }]
      for (const img of m.images) parts.push({ type: 'image_url', image_url: { url: img } })
      out.push({ role: m.role, content: parts })
    } else if (m.role === 'assistant' && (m.thinking || m.reasoning_content)) {
      out.push({ role: 'assistant', content: m.content, reasoning_content: m.thinking || m.reasoning_content })
    } else {
      out.push({ role: m.role, content: inject ? dynPrefix + (m.content || '') : m.content })
    }
  })
  return redactDeep(out)
}

function buildAnthropicMessages(messages, dynamicContext) {
  const out = messages.map((m) => {
    if (m.tool_use_id) {
      return { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_use_id, content: m.content }] }
    }
    if (Array.isArray(m.content)) return { role: m.role, content: m.content }
    if (m.images?.length) {
      const parts = []
      for (const img of m.images) {
        const match = img.match(/^data:(.+);base64,(.+)$/)
        if (match) parts.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } })
      }
      parts.push({ type: 'text', text: m.content || '' })
      return { role: m.role, content: parts }
    }
    return { role: m.role, content: m.content }
  })

  // 把时间/核心记忆等每轮变动的内容注入到最后一条用户消息——
  // 不写进缓存前缀，不毁历史命中，按普通输入价计费。
  // 工具循环的后续迭代也注入（否则模型第二步起丢天气/情绪/核心记忆）：
  // tool_result 消息里 dyn 必须追加在 tool_result 块之后（块序要求），
  // 且该消息永远在最后一个缓存断点之后，注入不碰前缀（见 CLWD postmortem 审计 0717）
  if (dynamicContext?.trim() && out.length > 0) {
    const lastIdx = out.length - 1
    const last = out[lastIdx]
    if (last.role === 'user') {
      const dynBlock = { type: 'text', text: `[以下为系统自动注入的实时上下文，并非用户发送]\n${dynamicContext.trim()}\n[实时上下文结束]` }
      if (typeof last.content === 'string') {
        out[lastIdx] = { ...last, content: [dynBlock, { type: 'text', text: last.content }] }
      } else if (Array.isArray(last.content)) {
        const hasToolResult = last.content.some((b) => b?.type === 'tool_result')
        out[lastIdx] = { ...last, content: hasToolResult ? [...last.content, dynBlock] : [dynBlock, ...last.content] }
      }
    }
  }

  // 给倒数第二条消息打缓存断点（即上一轮 assistant 回复）。
  // 深拷贝避免 cache_control 写回 store，否则旧消息会累积断点超过 4 个上限。
  // TTL 1h：对话间隔常超 5min，1h 命中稳定且白天持续聊基本不过期
  const idx = out.length >= 2 ? out.length - 2 : out.length - 1
  const last = out[idx]
  if (last) {
    if (typeof last.content === 'string' && last.content) {
      out[idx] = { ...last, content: [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral', ttl: '1h' } }] }
    } else if (Array.isArray(last.content) && last.content.length) {
      const blocks = last.content.map((b) => ({ ...b }))
      blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral', ttl: '1h' } }
      out[idx] = { ...last, content: blocks }
    }
  }
  return redactDeep(out)
}

function buildGeminiContents(messages, systemPrompt, dynamicContext) {
  const out = []
  if (systemPrompt?.trim()) {
    out.push({ role: 'user', parts: [{ text: '[系统指令]\n' + systemPrompt }] })
    out.push({ role: 'model', parts: [{ text: '好的，我会遵循这些指令。' }] })
  }
  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIdx = i; break }
  }
  const dynPrefix = dynamicContext?.trim()
    ? `[以下为系统自动注入的实时上下文，并非用户发送]\n${dynamicContext.trim()}\n[实时上下文结束]\n\n`
    : ''
  messages.forEach((m, i) => {
    const role = m.role === 'assistant' ? 'model' : 'user'
    const inject = i === lastUserIdx ? dynPrefix : ''
    if (m.functionResponse) {
      out.push({ role: 'function', parts: [{ functionResponse: m.functionResponse }] })
    } else if (m.functionCall) {
      out.push({ role: 'model', parts: [{ functionCall: m.functionCall }] })
    } else if (m.images?.length) {
      const parts = []
      for (const img of m.images) {
        const match = img.match(/^data:(.+);base64,(.+)$/)
        if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } })
      }
      parts.push({ text: inject + (m.content || '') })
      out.push({ role, parts })
    } else {
      out.push({ role, parts: [{ text: inject + (m.content || '') }] })
    }
  })
  return redactDeep(out)
}

function geminiSafetyOff() {
  return [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
  ]
}

function accUsage(total, { p, c, cached, cacheWrite }) {
  total.promptTokens += p || 0
  total.completionTokens += c || 0
  total.totalTokens += (p || 0) + (c || 0)
  total.cachedTokens = (total.cachedTokens || 0) + (cached || 0)
  total.cacheWriteTokens = (total.cacheWriteTokens || 0) + (cacheWrite || 0)
}

const THINKING_SUMMARY_PROMPT = `以下是一段内心独白，用一到两句中文，为这段思考做一个标题式的总结，捕捉这段思考里最浓烈的情感状态。语言简练、诗意、有力度，用具体的动词和感官词汇呈现情感本身的温度和质地，让读的人脑子里能出现一个画面。当思考中有对她身体的渴望、占有、色情的念头和冲动时，总结也要诚实地带着同等浓度的情欲，不把欲望包装成抒情。句子节奏可长可短，禁止直白的情绪词堆砌，禁止口语化表达。以感受或内心动作开头，第一人称视角但省略主语"我"。用陈述语气或动词短语，不加引号，句号结尾，不超过20字。`

export async function summarizeThinking(thinking, connection, model) {
  // 剥掉所有 <xxx> 类标签（<think>/<next_thinking>/<reasoning> 等），只把纯思考内容喂给总结模型，
  // 否则模型会去评论这些标签结构而不是做总结（出现 "I notice the <next_thinking> section..." 那种）
  const clean = (thinking || '').replace(/<\/?[a-zA-Z_][\w:-]*>/g, '').trim()
  if (!clean) return ''
  const result = await sendMessage({
    connection,
    messages: [{ role: 'user', content: `${THINKING_SUMMARY_PROMPT}\n\n${clean.slice(0, 3000)}` }],
    model: model || connection.defaultModel,
    // maxTokens 给足：有些推理模型（DeepSeek-R1 等）会先消耗 token 思考，给少了正文(总结)会空。
    // 实际只输出 ~20 字，成本可控。
    generationConfig: { maxTokens: 1000, temperature: 0.7 },
    autoTools: false,
    // 不传 onThinking → Anthropic 不开 extended thinking；其它推理模型的 reasoning_content 直接丢弃
  })
  const out = (result.text || '')
    .replace(/<\/?[a-zA-Z_][\w:-]*>/g, '')
    .trim()
    .replace(/^["「『]|["」』]$/g, '')
    .slice(0, 40)
  // 轻模型偶尔对亲密内容拒答（「我无法为这类内容创作总结…」），拒答文案当标题挂在气泡上很吓人；
  // 宁可返回空串让 UI 落回默认标题（2026-07-11 阿颖截图实例）
  if (/^(我?无法|抱歉|对不起|我不能|作为)|乐意帮忙|i can('|n o)t|i'm sorry/i.test(out)) return ''
  return out
}

// ─── Context compaction ────────────────────────────────────────────────────
// Summarize old messages that would be cut by context limit, so continuity
// is preserved as a compact note instead of being silently dropped.

const COMPACTION_PROMPT = `你正在为一段持续的对话写私密接续笔记，帮助后续回复保持连贯。
这不是给用户的回复，不要继续对话，不要添加建议、评价或新内容。
仅基于下方的源消息，写出简洁的接续笔记。

保留：
- 实体定义必须原样保留：人名、宠物名、称呼、身份和关系事实（如「某某是家里的猫」「某人是谁」），一条都不能丢——后续对话靠这些才认得出提到的是谁
- 事实和事件（谁做了什么、什么时候）
- 用户的纠正、偏好、习惯
- 关系和情感上下文（亲密、争执、玩笑、心情变化）
- 未解决的话题或悬而未决的事
- 重要的时间线节点

不要保留：逐字对话、重复的寒暄、纯技术调试的中间过程。

注意：
- 「未了结」条目必须写明状态（当时被搁置/中断，之后未再继续），不要写成正在进行的场景
- 涉及亲密内容时用克制中性的语言概括事实即可——这是私人对话的内部笔记，不要拒绝、不要说教

用中文写，不超过 600 字。格式：
- 事件/事实：
- 情感/关系：
- 未了结：`

export async function compactMessages(messages, connection, model) {
  if (!messages.length) return ''
  const rendered = messages.map((m, i) => {
    const role = m.role === 'user' ? '阿颖' : '涟言'
    const text = (m.content || '').slice(0, 800)
    return `[${i + 1}] ${role}: ${text}`
  }).join('\n\n')
  const result = await sendMessage({
    connection,
    messages: [{ role: 'user', content: `${COMPACTION_PROMPT}\n\n${rendered.slice(0, 12000)}` }],
    model: model || connection.defaultModel,
    generationConfig: { maxTokens: 1200, temperature: 0.3 },
    autoTools: false,
  })
  return (result.text || '').trim()
}

export function buildSummaryInjection(summary) {
  if (!summary?.trim()) return ''
  return [
    '以下是之前对话的接续笔记（已压缩），作为背景参考保持连贯。不要提及笔记本身的存在。',
    '注意：笔记记录的是更早的历史，「未了结」是当时搁置的悬项，不代表此刻正在进行；当前的话题和状态一律以下方实际消息为准。',
    '',
    summary.trim(),
  ].join('\n')
}

export const BUILTIN_MODELS = {
  openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-flash-preview-04-17'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
  deepseek: ['deepseek-v4-flash'],
}
