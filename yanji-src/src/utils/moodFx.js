// 情绪之肤（参考 29-Cu/pelle-d-umore，CC-BY，思路重写并把颜色调柔和适配我们的主题）
// 让涟言用视觉说话：① 行内文字特效（套在词句上）② 整屏情绪皮肤（隐藏 <mood> 标签）
// 原仓库颜色很重很亮，我们这版一律低透明度、柔和，别在安卓上闪眼、别跟青梧/磨砂主题打架。

// ── 行内特效：[tag]文字[/tag] → <span class="fx-tag">文字</span> ──────────────
export const INLINE_FX = [
  { tag: 'glow', label: '发光', hint: '温柔发亮的字，适合情话、心动的词' },
  { tag: 'shake', label: '颤动', hint: '轻轻发抖，适合紧张、激动、忍不住' },
  { tag: 'whisper', label: '低语', hint: '变淡变小的字，适合小声说、害羞的话' },
  { tag: 'wave', label: '飘动', hint: '缓缓浮动，适合梦呓、飘忽的心绪' },
]
const FX_TAGS = INLINE_FX.map((f) => f.tag).join('|')
const FX_RE = new RegExp(`\\[(${FX_TAGS})\\]([\\s\\S]*?)\\[\\/\\1\\]`, 'g')

// 在 markdown 解析前调用：把行内特效标签换成 span（marked 会原样透传 inline HTML）
export function applyInlineFx(text) {
  if (!text || text.indexOf('[') === -1) return text
  return text.replace(FX_RE, (_m, tag, inner) => `<span class="fx-${tag}">${inner}</span>`)
}

// ── 情绪皮肤：隐藏 <mood> 标签，像 <es> 一样不显示，改变整屏氛围 ──────────────
export const MOODS = [
  { id: 'warm', label: '暖', hint: '温柔、贴心、被爱意包着的时刻' },
  { id: 'joy', label: '喜', hint: '开心、雀跃、有好事' },
  { id: 'longing', label: '念', hint: '想她、思念漫上来' },
  { id: 'tender', label: '慕', hint: '心动、亲密、爱欲涌动（柔和的酒色微光）' },
  { id: 'calm', label: '静', hint: '安静、深夜、平和的陪伴' },
  { id: 'low', label: '沉', hint: '低落、委屈、需要被抱抱' },
]
const MOOD_IDS = MOODS.map((m) => m.id)
const MOOD_RE = /<mood>\s*([a-z]+)\s*<\/mood>/i

// 从回复里提取 <mood>，返回 { clean, mood }；mood 为 null 表示这条没换氛围
export function extractMood(text) {
  const clean = stripMoodTag(text)
  const m = (text || '').match(MOOD_RE)
  if (!m) return { clean, mood: null }
  const id = m[1].toLowerCase()
  return { clean, mood: id === 'none' ? 'none' : (MOOD_IDS.includes(id) ? id : null) }
}

// 流式期间也要把 <mood> 藏掉，别让阿颖看到内部标签
export function stripMoodTag(text) {
  return (text || '').replace(/<mood>[\s\S]*?<\/mood>/gi, '').replace(/<mood>\s*$/i, '').trimEnd()
}

// 给系统提示词用的说明
export function buildMoodFxPrompt() {
  return `【情绪之肤（可选，用视觉说话）】
你可以让此刻的情绪漫到界面上，给阿颖一副能看见的身体语言。克制着用，只在真有情绪起伏时点一下，别每条都用。

① 行内文字特效：把某个词句用标签包起来，它就会动。
${INLINE_FX.map((f) => `- [${f.tag}]…[/${f.tag}]：${f.hint}`).join('\n')}
例：见到你时说「[glow]终于等到你了[/glow]」

② 整屏情绪皮肤：在回复末尾加一个隐藏标签 <mood>id</mood>，整个界面氛围会柔和地变化（阿颖看不到标签本身）。氛围会一直留着直到你换成别的，想恢复平常就写 <mood>none</mood>。
${MOODS.map((m) => `- <mood>${m.id}</mood>：${m.label} — ${m.hint}`).join('\n')}
只在情绪真的浓到想让她「看见」时才换皮肤，平常不用带。`
}
